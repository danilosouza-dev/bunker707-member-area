import type { Locator, Page } from "@playwright/test";
import { expect, gerarAudioDeTeste, test, zerarComunicacao } from "./fixtures";

// Audio do aviso no sino, "ouvido" como no WhatsApp (docs/23 §1.4 e §8.3; docs/18 §3.1): o produtor envia uma
// notificacao com um audio de 2 s (WAV gerado pela fixture, enviado pela tela para o bucket
// communication-audio). A aluna ve "Áudio do aviso, ainda não ouvido", toca ate o fim e ve "Áudio ouvido";
// depois de recarregar, e numa sessao nova do navegador da mesma conta, a onda continua verde e o nome e
// "Áudio do aviso, ouvido" (o servidor guarda o que foi ouvido).

const TITULO = "Áudio E2E: recado de dois segundos";

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

/** Abre o sino e devolve o grupo do audio do aviso. */
async function audioDoAviso(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: /^Notificações/ }).click();
  const aviso = page.getByRole("dialog", { name: "Notificações" }).getByRole("article", { name: TITULO });
  await expect(aviso).toBeVisible();

  return aviso.getByRole("group", { name: /^Áudio do aviso/ });
}

/** A onda inteira verde: nenhuma barra apagada ou so clara. */
async function esperarOndaVerde(grupo: Locator) {
  await expect(grupo.locator("span.bg-emerald-400").first()).toBeVisible();
  await expect(grupo.locator("span.bg-white\\/30")).toHaveCount(0);
  await expect(grupo.locator("span.bg-white\\/60")).toHaveCount(0);
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("envia uma notificação com um áudio de 2 segundos", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos/novo");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Título", { exact: true }).fill(TITULO);

    const audio = gerarAudioDeTeste(2);
    const escolha = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Enviar arquivo" }).click();
    await (await escolha).setFiles({ buffer: audio.buffer, mimeType: audio.mimeType, name: audio.name });
    await expect(page.getByRole("button", { name: "Trocar áudio" })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { exact: true, name: "Enviar agora" }).click();
    await expect(page.getByText(/^Notificação enviada para \d+ alunos?\.$/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
  });
});

test.describe("aluna", () => {
  test("ouve até o fim e o sino guarda: verde depois de recarregar e numa sessão nova", async ({ browser, page }) => {
    const grupo = await audioDoAviso(page);
    await expect(grupo).toHaveAccessibleName("Áudio do aviso, ainda não ouvido");

    await grupo.getByRole("button", { name: "Tocar áudio" }).click();
    // Tocando ate o fim (2 s): o sinal "Áudio ouvido" aparece e o nome volta a dizer o estado.
    await expect(grupo.getByText("Áudio ouvido", { exact: true })).toBeAttached({ timeout: 15_000 });
    await expect(grupo).toHaveAccessibleName("Áudio do aviso, ouvido");
    await esperarOndaVerde(grupo);

    // O fim do audio vai ao servidor (fetch na hora do "ended"): espera gravar antes de recarregar.
    await expect
      .poll(async () => {
        const resposta = await page.request.get("/api/notifications");
        const { data } = (await resposta.json()) as { data: { items: { audioProgress: { completed: boolean } | null; title: string }[] } };
        return data.items.find((item) => item.title === TITULO)?.audioProgress?.completed ?? false;
      })
      .toBe(true);

    const depoisDeRecarregar = await audioDoAviso(page);
    await expect(depoisDeRecarregar).toHaveAccessibleName("Áudio do aviso, ouvido");
    await expect(depoisDeRecarregar.getByText("Áudio ouvido", { exact: true })).toBeAttached();
    await esperarOndaVerde(depoisDeRecarregar);

    // Outro navegador (outro aparelho), mesma conta: o ouvido vem do servidor.
    const contexto = await browser.newContext({ storageState: "tests/e2e/.auth/aluna.json" });
    const outraPagina = await contexto.newPage();
    const noOutroAparelho = await audioDoAviso(outraPagina);
    await expect(noOutroAparelho).toHaveAccessibleName("Áudio do aviso, ouvido");
    await esperarOndaVerde(noOutroAparelho);
    await contexto.close();
  });
});
