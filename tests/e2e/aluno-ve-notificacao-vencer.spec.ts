import type { Page } from "@playwright/test";
import {
  PROFESSOR_DE_NOME_LONGO,
  apagarProfessorDeNomeLongo,
  envelhecerNotificacao,
  expect,
  garantirProfessorDeNomeLongo,
  test,
  zerarComunicacao
} from "./fixtures";

// Tempo no sino (docs/23 §1.1, §1.3 e §8.3; docs/18 §3.1): o produtor envia uma notificacao "1 dia" em nome
// de uma pessoa da equipe de nome comprido. A 375 px, a linha "quem envia · há 10 minutos · Termina em 23 h"
// fica numa linha so: o nome encurta com reticencias e o tempo e o "Termina em" aparecem inteiros. Depois que
// a fixture volta a linha 2 dias no tempo (created_at e expires_at juntos), recarregar tira a notificacao da
// lista e do numero do sino.

const TITULO = "Validade E2E: inscrições abertas até amanhã";
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarComunicacao();
  await garantirProfessorDeNomeLongo();
});

test.afterAll(async () => {
  await zerarComunicacao();
  await apagarProfessorDeNomeLongo();
});

/** O sino da conta da pagina pelo servidor: o numero (novas), o que falta ler e se a notificacao esta na lista. */
async function resumoDoSino(page: Page) {
  const resposta = await page.request.get("/api/notifications");
  const { data } = (await resposta.json()) as { data: { items: { title: string }[]; unread: number; unseen: number } };

  return { naLista: data.items.some((item) => item.title === TITULO), unread: data.unread, unseen: data.unseen };
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("envia uma notificação de 1 dia em nome do professor de nome comprido", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos/novo");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Título", { exact: true }).fill(TITULO);

    await page.getByRole("combobox", { name: "Quem envia" }).click();
    await page.getByRole("option", { name: `${PROFESSOR_DE_NOME_LONGO.nome} · Professor` }).click();
    await expect(page.getByText(`Quando sair, ${PROFESSOR_DE_NOME_LONGO.nome} recebe um e-mail avisando`, { exact: false })).toBeVisible();

    await page.getByRole("radiogroup", { name: "Fica no sino por" }).getByText("1 dia", { exact: true }).click();

    // Na prévia "Celular" (375 px), a mesma linha: o nome encurta e o tempo e o "Termina em" ficam inteiros.
    await page.getByRole("radiogroup", { name: "Aparelho da prévia" }).getByText("Celular", { exact: true }).click();
    const previa = page.getByRole("figure", { name: "Prévia da notificação no sino, no celular" });
    const linhaDaPrevia = previa.locator("article p:has(> time)");
    const nomeNaPrevia = linhaDaPrevia.locator("> span").first();
    await expect(nomeNaPrevia).toHaveText(PROFESSOR_DE_NOME_LONGO.nome);
    await expect(linhaDaPrevia.getByText("· Termina em 23 h", { exact: true })).toBeVisible();
    expect(await nomeNaPrevia.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await nomeNaPrevia.evaluate((element) => getComputedStyle(element).textOverflow)).toBe("ellipsis");
    for (const parte of [linhaDaPrevia.locator("> time"), linhaDaPrevia.getByText("· Termina em 23 h", { exact: true })]) {
      expect(await parte.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }

    await page.getByRole("button", { exact: true, name: "Enviar agora" }).click();
    await expect(page.getByText(/^Notificação enviada para \d+ alunos?\.$/)).toBeVisible();

    // Enviada ha 10 minutos: o tempo vira "há 10 minutos" e o fim continua a menos de 1 dia.
    expect(await envelhecerNotificacao(TITULO, 10 * MINUTO)).toBeGreaterThan(1);
  });
});

test.describe("aluna a 375 px", () => {
  test.use({ viewport: { height: 812, width: 375 } });

  test("a linha de quem envia fica numa linha: o nome encurta, o tempo e o Termina em aparecem inteiros", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { exact: true, name: "Notificações, 1 nova" }).click();
    const aviso = page.getByRole("dialog", { name: "Notificações" }).getByRole("article", { name: TITULO });
    await expect(aviso).toBeVisible();

    const linha = aviso.locator("p:has(> time)");
    const nome = linha.locator("> span").first();
    const tempo = linha.locator("> time");
    const fim = linha.getByText("· Termina em 23 h", { exact: true });
    await expect(nome).toHaveText(PROFESSOR_DE_NOME_LONGO.nome);
    await expect(tempo).toHaveText(/^há 1[01] minutos$/);
    await expect(fim).toBeVisible();

    // Uma linha so (12 px de texto, 16 px de linha), com o nome cortado por reticencias.
    expect((await linha.boundingBox())?.height ?? 0).toBeLessThan(24);
    expect(await nome.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await nome.evaluate((element) => getComputedStyle(element).textOverflow)).toBe("ellipsis");

    // O tempo e o "Termina em" inteiros, dentro do cartao.
    const cartao = await aviso.boundingBox();

    for (const parte of [tempo, fim]) {
      expect(await parte.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      const caixa = await parte.boundingBox();
      expect(caixa).not.toBeNull();
      expect((caixa?.x ?? 0) + (caixa?.width ?? 0)).toBeLessThanOrEqual((cartao?.x ?? 0) + (cartao?.width ?? 0));
      expect(caixa?.x ?? -1).toBeGreaterThanOrEqual(cartao?.x ?? 0);
    }

    // Sem rolagem lateral na pagina.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});

test.describe("depois de vencer", () => {
  test("recarregar tira a notificação da lista e do número do sino", async ({ browser, page }) => {
    // O aluno B nunca abriu o sino: antes de vencer, o numero conta a notificacao.
    const contextoB = await browser.newContext({ storageState: "tests/e2e/.auth/aluno-sem-acesso.json" });
    const paginaB = await contextoB.newPage();
    await paginaB.goto("/");
    await expect(paginaB.getByRole("button", { exact: true, name: "Notificações, 1 nova" })).toBeVisible();

    await page.goto("/");
    expect(await resumoDoSino(page)).toEqual({ naLista: true, unread: 1, unseen: 0 });

    // 2 dias atras: criada anteontem, venceu ontem (expires_at > created_at continua valendo).
    expect(await envelhecerNotificacao(TITULO, 2 * DIA)).toBeGreaterThan(1);

    await paginaB.reload();
    await expect(paginaB.getByRole("button", { exact: true, name: "Notificações" })).toBeVisible();
    expect(await resumoDoSino(paginaB)).toEqual({ naLista: false, unread: 0, unseen: 0 });
    await contextoB.close();

    await page.reload();
    expect(await resumoDoSino(page)).toEqual({ naLista: false, unread: 0, unseen: 0 });
    await page.getByRole("button", { exact: true, name: "Notificações" }).click();
    const painel = page.getByRole("dialog", { name: "Notificações" });
    await expect(painel).toBeVisible();
    await expect(painel.getByRole("article", { name: TITULO })).toHaveCount(0);
  });
});
