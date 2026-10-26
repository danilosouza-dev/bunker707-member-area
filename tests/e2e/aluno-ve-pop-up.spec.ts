import type { Locator, Page } from "@playwright/test";
import { estadoDoPopUpDaAluna, expect, idDoAviso, popUpsQueAbremNaHome, reabrirPopUpParaAluna, test, zerarComunicacao } from "./fixtures";

// Pop-up da home no navegador (docs/22 §1.3; docs/25; docs/18 §3.1): o produtor publica um pop-up para todos
// os alunos e a aluna o ve na home, 3 s depois de abrir; "Não mostrar de novo" fecha e vale numa sessao
// nova do navegador; "Lembrar depois" fecha e adia. O pop-up e publicado pela tela (e nao gravado
// direto no banco) porque a lista de pop-ups no ar fica 60 s em cache no servidor e so a publicacao a
// renova. O beforeAll e o afterAll apagam tudo: um pop-up esquecido abriria na home dos outros arquivos.
// v3b-1: o resumo da home vem com `?page=home` e traz o plano da aluna (sem conteudo); o conteudo so vem no
// POST /show, logo antes de abrir.
// L6a (docs/27 §13.11.1): a janela abre e fecha com fade e escala de 95 %. No Tailwind 4 a escala e a propriedade
// `scale`, que precisa estar na transicao (com `transform` ela pulava sem animar); com menos movimento, nada anima.
// A entrada so anima porque o Dialog.Root nasce fechado e abre no quadro seguinte (o host monta a janela ja aberta, e o
// Base UI so marca o data-starting-style quando o Root ja montado passa de fechado para aberto).

const TITULO = "Pop-up E2E: turma nova de agentes";
const TEXTO = "A turma nova começa segunda. Garanta seu lugar.";

/**
 * Coletor das transicoes da janela do pop-up: entra antes de qualquer script da pagina e guarda o nome de cada
 * propriedade que [data-member-popup] comecou a animar (o transitionrun sobe ate o document).
 */
async function gravarTransicoesDaJanela(page: Page) {
  await page.addInitScript(() => {
    const transicoes: string[] = [];
    Object.assign(window, { __transicoesDaJanela: transicoes });
    document.addEventListener(
      "transitionrun",
      (evento) => {
        if (evento.target instanceof Element && evento.target.matches("[data-member-popup]")) {
          transicoes.push(evento.propertyName);
        }
      },
      true
    );
  });
}

const transicoesDaJanela = (page: Page) => page.evaluate(() => (window as typeof window & { __transicoesDaJanela?: string[] }).__transicoesDaJanela);

/** A transicao calculada da janela, uma propriedade por item ("opacity, scale" vira ["opacity", "scale"]). */
const transicaoCalculada = (janela: Locator) => janela.evaluate((elemento) => getComputedStyle(elemento).transitionProperty.split(/,\s*/));

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("publica um pop-up para todos os alunos", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("radio", { exact: true, name: "Pop-up" })).toBeChecked();

    const titulo = page.getByLabel("Título", { exact: true });
    await titulo.fill(TITULO);
    await expect(titulo).toHaveValue(TITULO);
    const texto = page.getByLabel("Texto (opcional)", { exact: true });
    await texto.fill(TEXTO);
    await expect(texto).toHaveValue(TEXTO);

    await expect(page.getByRole("radio", { name: "Todos os alunos" })).toBeChecked();
    await expect(page.getByText(/^≈ \d+ alunos? agora$/)).toBeVisible();

    await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
    await expect(page.getByText("Pop-up publicado. Em até 1 minuto ele começa a aparecer para quem já está na área.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: TITULO })).toBeVisible();
  });
});

test.describe("aluna", () => {
  test("vê o pop-up na home; Não mostrar de novo fecha e ele não volta numa sessão nova", async ({ page }) => {
    await gravarTransicoesDaJanela(page);
    await page.goto("/");

    // Aparece 3 s depois de abrir a home (o resumo com o pop-up e pedido 1,5 s depois).
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await expect(popUp.getByText(TEXTO)).toBeVisible();
    await expect(popUp.getByRole("button", { name: "Lembrar depois" })).toBeVisible();

    // A janela cresce ao abrir: a transicao calculada lista a escala e o navegador anima opacidade e escala.
    await expect(popUp).toHaveAttribute("data-member-popup", "");
    expect(await transicaoCalculada(popUp)).toEqual(["opacity", "scale"]);
    await expect.poll(() => transicoesDaJanela(page)).toEqual(expect.arrayContaining(["opacity", "scale"]));
    const escalasAoAbrir = (await transicoesDaJanela(page))?.filter((nome) => nome === "scale").length ?? 0;

    await popUp.getByRole("button", { name: "Não mostrar de novo" }).click();
    await expect(popUp).toHaveCount(0);
    // E encolhe ao fechar: a escala anima de novo antes de a janela sair da pagina.
    expect((await transicoesDaJanela(page))?.filter((nome) => nome === "scale").length ?? 0).toBeGreaterThan(escalasAoAbrir);
    // O evento vai por sendBeacon: espera o servidor gravar antes de abrir a sessao nova.
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.dismissedAt ?? null).not.toBeNull();

    expect(await popUpsQueAbremNaHome(page)).not.toContain(await idDoAviso(TITULO));
    await expect(page.getByRole("dialog", { name: TITULO })).toHaveCount(0);
  });

  test("Lembrar depois fecha o pop-up e adia: numa sessão nova ele não aparece", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    await page.goto("/");

    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await popUp.getByRole("button", { name: "Lembrar depois" }).click();
    await expect(popUp).toHaveCount(0);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.snoozeCount ?? 0).toBe(1);

    const estado = await estadoDoPopUpDaAluna(TITULO);
    expect(estado?.dismissedAt).toBeNull();
    expect(Date.parse(estado?.snoozedUntil ?? "")).toBeGreaterThan(Date.now());
    expect(await popUpsQueAbremNaHome(page)).not.toContain(await idDoAviso(TITULO));
  });
});

test.describe("menos movimento", () => {
  test.use({ reducedMotion: "reduce" });

  test("a janela abre e fecha sem transição", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    await gravarTransicoesDaJanela(page);
    await page.goto("/");

    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await expect(popUp).toHaveAttribute("data-member-popup", "");
    expect(await transicaoCalculada(popUp)).toEqual(["none"]);
    expect(await transicoesDaJanela(page)).toEqual([]);

    await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
    expect(await transicoesDaJanela(page)).toEqual([]);
  });
});
