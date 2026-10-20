import type { Page } from "@playwright/test";
import { estadoDoPopUpDaAluna, expect, reabrirPopUpParaAluna, test, zerarComunicacao } from "./fixtures";

// Pop-up da home no navegador (docs/22 §1.3; docs/18 §3.1): o produtor publica um pop-up para todos os
// alunos e a aluna o ve na home, 3 s depois de abrir; "Não mostrar de novo" fecha e vale numa sessao
// nova do navegador; "Lembrar depois" fecha e adia. O pop-up e publicado pela tela (e nao gravado
// direto no banco) porque a lista de pop-ups no ar fica 60 s em cache no servidor e so a publicacao a
// renova. O beforeAll e o afterAll apagam tudo: um pop-up esquecido abriria na home dos outros arquivos.

const TITULO = "Pop-up E2E: turma nova de agentes";
const TEXTO = "A turma nova começa segunda. Garanta seu lugar.";

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

/** Abre a home numa sessao nova do navegador e devolve o pop-up que o servidor mandou (ou null). */
async function abrirHomeEmSessaoNova(page: Page) {
  // O limite de 1 por sessao fica no sessionStorage: sem ele, quem decide e o servidor.
  await page.evaluate(() => window.sessionStorage.clear());
  const resumo = page.waitForResponse((response) => response.url().includes("/api/notifications/summary?popup=1"));
  await page.reload();
  const { data } = (await (await resumo).json()) as { data: { popup: { title: string } | null } };

  return data.popup;
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("publica um pop-up para todos os alunos", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("radio", { name: "Pop-up na home" })).toBeChecked();

    const titulo = page.getByLabel("Título", { exact: true });
    await titulo.fill(TITULO);
    await expect(titulo).toHaveValue(TITULO);
    const texto = page.getByLabel("Texto (opcional)", { exact: true });
    await texto.fill(TEXTO);
    await expect(texto).toHaveValue(TEXTO);

    await expect(page.getByRole("radio", { name: "Todos os alunos" })).toBeChecked();
    await expect(page.getByText(/^≈ \d+ alunos? agora$/)).toBeVisible();

    await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
    await expect(page.getByText("Pop-up publicado.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: TITULO })).toBeVisible();
  });
});

test.describe("aluna", () => {
  test("vê o pop-up na home; Não mostrar de novo fecha e ele não volta numa sessão nova", async ({ page }) => {
    await page.goto("/");

    // Aparece 3 s depois de abrir a home (o resumo com o pop-up e pedido 1,5 s depois).
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await expect(popUp.getByText(TEXTO)).toBeVisible();
    await expect(popUp.getByRole("button", { name: "Lembrar depois" })).toBeVisible();

    await popUp.getByRole("button", { name: "Não mostrar de novo" }).click();
    await expect(popUp).toHaveCount(0);
    // O evento vai por sendBeacon: espera o servidor gravar antes de abrir a sessao nova.
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.dismissedAt ?? null).not.toBeNull();

    expect(await abrirHomeEmSessaoNova(page)).toBeNull();
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
    expect(await abrirHomeEmSessaoNova(page)).toBeNull();
  });
});
