import { bloquearRedeExterna, expect, test, zerarSessoesDeTv } from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Modo TV no navegador: a aluna abre "Assistir na TV" na aula e ve o codigo; uma segunda tela, sem
// login (como uma TV), abre /tv, digita o codigo e conecta; a aula passa a mostrar o controle remoto;
// encerrar na aula derruba a TV. O video nao toca (a rede externa e cortada): o que se prova aqui e o
// pareamento, o controle e o encerramento.

const { curso } = ESCOLA_DE_TESTE;
const ENDERECO_DA_TV = "http://127.0.0.1:3100/tv";
const SEM_LOGIN = { cookies: [], origins: [] };

test.beforeAll(zerarSessoesDeTv);

test("a aluna pareia uma TV pelo codigo, ve o controle remoto na aula e encerra; a TV mostra a sessao encerrada", async ({ browser, page }) => {
  await page.goto(`/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Assistir na TV" }).click();

  const dialogo = page.getByRole("dialog", { name: "Assistir na TV" });
  await expect(dialogo.getByText("Codigo de conexao")).toBeVisible();
  await expect(dialogo.getByText("Aguardando a TV")).toBeVisible();
  const codigo = (await dialogo.locator("p.font-mono").first().innerText()).replace(/\s+/g, "");
  expect(codigo).toMatch(/^[A-Z0-9]{6}$/);

  // A TV: outra janela, sem login e sem rede externa.
  const tv = await browser.newContext({ storageState: SEM_LOGIN });
  await bloquearRedeExterna(tv);
  const telaDaTv = await tv.newPage();
  await telaDaTv.goto(ENDERECO_DA_TV);
  await telaDaTv.waitForLoadState("networkidle");
  await expect(telaDaTv.getByRole("heading", { level: 1, name: "Assistir na TV" })).toBeVisible();
  const campo = telaDaTv.getByLabel("Codigo de conexao");
  await campo.fill(codigo);
  await expect(campo).toHaveValue(codigo);
  await telaDaTv.getByRole("button", { name: "Conectar esta TV" }).click();
  await expect(telaDaTv.getByText("Conectado ao controle remoto")).toBeVisible();
  await expect(telaDaTv.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();

  // A aula percebe a TV conectada (consulta a cada 2 s) e mostra o controle remoto.
  await expect(dialogo.getByRole("group", { name: "Controle remoto da TV" })).toBeVisible({ timeout: 10_000 });
  await expect(dialogo.getByRole("button", { name: "Retroceder 10 segundos" })).toBeVisible();
  await expect(dialogo.getByRole("button", { name: "Avancar 10 segundos" })).toBeVisible();

  // Encerrar na aula derruba a TV.
  await dialogo.getByRole("button", { name: "Encerrar na TV" }).click();
  await expect(dialogo.getByText("Sessao encerrada")).toBeVisible();
  await expect(telaDaTv.getByRole("heading", { level: 1, name: "Sessao encerrada" })).toBeVisible();
  await tv.close();
});

test("codigo errado na TV: aviso e a tela de conectar continua", async ({ browser }) => {
  const tv = await browser.newContext({ storageState: SEM_LOGIN });
  await bloquearRedeExterna(tv);
  const telaDaTv = await tv.newPage();
  await telaDaTv.goto(ENDERECO_DA_TV);
  await telaDaTv.waitForLoadState("networkidle");
  const campo = telaDaTv.getByLabel("Codigo de conexao");
  await campo.fill("ZZZZZZ");
  await expect(campo).toHaveValue("ZZZZZZ");
  await telaDaTv.getByRole("button", { name: "Conectar esta TV" }).click();

  // Ha dois "alert" na pagina (o aviso e o anunciador de rota do Next): filtra pelo texto.
  await expect(telaDaTv.getByRole("alert").filter({ hasText: "Codigo invalido, expirado ou ja utilizado." })).toBeVisible();
  await expect(telaDaTv.getByRole("button", { name: "Conectar esta TV" })).toBeVisible();
  await tv.close();
});
