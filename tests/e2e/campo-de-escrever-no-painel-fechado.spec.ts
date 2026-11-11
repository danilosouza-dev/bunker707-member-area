import type { Locator, Page } from "@playwright/test";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { CONSOLE_PANEL_KEY, ROOM_PANEL_KEY } from "../../src/lib/webinar-room-prefs";
import { WEBINAR_ADMIN_COPY } from "../../src/server/webinars/editor-model";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparFotoDoPerfil, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { LIVE_AO_VIVO_DE_TESTE, expect, paginaFalsaPlayerJs, salaFalsaDoJitsi, seedLiveAoVivoDeTeste, test } from "./fixtures";

// O campo de escrever que nascia estreito (docs/30 D81 e D82; docs/31 §13.3; o teste do produtor de 11/11/2026): com o
// painel guardado fechado no navegador, a sala (pelo link Entrar da pagina do webinario, sem recarregar) e o console da
// Live ao vivo (pelo Abrir o console do editor) montavam o campo dentro do painel escondido; ao abrir o painel, o campo
// ficava com 266 x 4 px e sem a frase ate a primeira tecla. Aqui: guardar o painel fechado, entrar pelo link, abrir o
// painel e esperar o campo com pelo menos 20 px de altura e a frase. Ao lado do campo, a foto ou as iniciais de quem
// escreve: na sala, as da aluna ja antes do aceite do chat (so ela ve); no console, as do produtor (nunca so o icone).

const GRAVADA = LIVE_GRAVADA_NO_AR_DE_TESTE;
const AO_VIVO = LIVE_AO_VIVO_DE_TESTE;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  const contas = await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  // Sem foto no Perfil: o avatar do campo mostra as iniciais.
  await limparFotoDoPerfil(db, [contas.aluna.id, contas.produtor.id]);
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
  await seedLiveAoVivoDeTeste(db, { comecouHa: 5 * 60_000, status: "live" });
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
});

/** O painel guardado fechado neste navegador antes da primeira pagina (o mesmo valor do X do painel). */
async function guardarPainelFechado(page: Page, chave: string) {
  await page.addInitScript((nome) => window.localStorage.setItem(nome, "0"), chave);
}

/** O campo inteiro na tela: a linha da frase (20 px ou mais), nunca o 0px de antes, e a frase no lugar. */
async function esperarCampoInteiro(campo: Locator, frase: string) {
  await expect(campo).toBeVisible();
  await expect.poll(async () => (await campo.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(20);
  expect(await campo.evaluate((area) => (area as HTMLTextAreaElement).style.height)).not.toBe("0px");
  await expect(campo).toHaveAttribute("placeholder", frase);
}

test("a aluna entra na sala pelo link com o painel guardado fechado: ao abrir o Chat, o campo vem inteiro com a frase e as iniciais dela, antes do aceite", async ({ page }) => {
  await guardarPainelFechado(page, ROOM_PANEL_KEY);
  await paginaFalsaPlayerJs(page, ORIGEM_DA_BUNNY);
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto(`/webinarios/${GRAVADA.slug}`);
  await page.getByRole("main").getByRole("link", { exact: true, name: "Entrar" }).click();
  const sala = page.getByRole("dialog", { name: GRAVADA.titulo });
  await expect(sala).toBeVisible();

  // O painel fechado: o campo montado e escondido.
  const campo = sala.getByRole("textbox", { name: WEBINAR_COPY.sala.escreva });
  await expect(campo).toBeHidden();

  await sala.locator("#room-railbtn-chat").click();
  await esperarCampoInteiro(campo, WEBINAR_COPY.sala.escreva);
  // As iniciais da aluna (Aluna de Teste: "Aluna T.") ao lado do campo, sem aceite nenhum.
  await expect(sala.getByTestId("room-consent")).toHaveCount(0);
  await expect(sala.locator("form").filter({ has: campo }).getByText("AT", { exact: true })).toBeVisible();
});

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("o produtor abre o console da live pelo editor com o painel guardado fechado: ao abrir o Chat, Escreva para a turma vem inteiro, com as iniciais dele", async ({ page }) => {
    await guardarPainelFechado(page, CONSOLE_PANEL_KEY);
    await salaFalsaDoJitsi(page);
    await page.setViewportSize({ height: 800, width: 1280 });
    await page.goto(`/admin/comunicacao/webinarios/${AO_VIVO.id}`);
    await page.getByRole("link", { name: WEBINAR_COPY.admin.abrirConsole }).first().click();
    await expect(page.locator("[data-console-root]")).toBeVisible();

    const frase = WEBINAR_ADMIN_COPY.console.chat.composer;
    const campo = page.locator("#console-composer");
    await expect(campo).toBeHidden();

    await page.locator('[data-console-rail="chat"]').click();
    await esperarCampoInteiro(campo, frase);
    // As iniciais do produtor (Produtor de Teste: "Produtor T."), nunca so o icone da equipe.
    await expect(page.locator("form").filter({ has: campo }).getByText("PT", { exact: true })).toBeVisible();
  });
});
