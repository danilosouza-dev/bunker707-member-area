import type { Page } from "@playwright/test";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";
import { adiantarFluxo, expect, fotoDoProdutor, idDoFluxo, rodarTick, test, tirarFotoDoProdutor, zerarComunicacao } from "./fixtures";

// Notificacao seguinte no navegador (docs/23 §2.2 e §8.3; docs/18 §3.1): o produtor, com foto no perfil, cria
// uma notificacao "Quem envia: Eu" com o icone Promoção, um botao para um curso e 1 dia no sino, mais uma
// notificacao seguinte "2 horas depois do envio, para quem não abriu" escrita na folha, e envia. A aluna A
// ve a foto, o icone e o "Termina em 23 h" e abre o cartao; o aluno B so toca em "Marcar todas como lidas".
// Tick (matricula) -> adiantarFluxo -> tick (decide e envia): so B recebe a seguinte, e o relatorio conta.
// A 375 px: a folha de tela cheia, "Quando sai" em duas linhas e as pilulas da previa.

const TITULO = "Seguinte E2E: condição especial do curso";
const TEXTO = "Só nesta semana, uma condição especial para quem já estuda com a gente.";
const BOTAO = "Ver a condição";
const SEGUINTE = "Seguinte E2E: a condição acaba logo";
const RASCUNHO = "Seguinte E2E: rascunho no celular";
const SESSAO_DO_ALUNO_B = "tests/e2e/.auth/aluno-sem-acesso.json";

test.describe.configure({ mode: "serial" });

let fotoDoProdutorUrl = "";
let enviadas = 0;
let enderecoDoAviso = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  fotoDoProdutorUrl = await fotoDoProdutor();
});

test.afterAll(async () => {
  await zerarComunicacao();
  await tirarFotoDoProdutor();
});

/** O sino da pagina (o nome diz quantas chegaram) e o painel. */
function sino(page: Page) {
  return { painel: page.getByRole("dialog", { name: "Notificações" }) };
}

/** Ids repetidos na pagina (a folha da seguinte abre por cima do editor, com os mesmos campos). */
async function idsRepetidos(page: Page) {
  return page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id).filter(Boolean);

    return Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
  });
}

/** Le a notificacao de titulo dado em GET /api/notifications (null: nao esta no sino). */
async function itemDoSino(page: Page, titulo: string) {
  const resposta = await page.request.get("/api/notifications");
  const { data } = (await resposta.json()) as { data: { items: { openedAt: string | null; readAt: string | null; title: string }[] } };

  return data.items.find((item) => item.title === titulo) ?? null;
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("cria a notificação com foto, ícone, botão e 1 dia no sino, mais uma seguinte para quem não abriu, e envia", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos/novo");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Título", { exact: true }).fill(TITULO);
    await page.getByLabel("Texto (opcional)", { exact: true }).fill(TEXTO);

    // Quem envia: Eu. Com a foto no perfil, a dica nao pede foto.
    await page.getByRole("combobox", { name: "Quem envia" }).click();
    await page.getByRole("option", { name: "Eu (Produtor de Teste)" }).click();
    await expect(page.getByRole("combobox", { name: "Quem envia" })).toContainText("Eu (Produtor de Teste)");
    await expect(page.getByText("O aluno vê a foto e o nome de quem envia. Só pessoas da equipe aparecem aqui.")).toBeVisible();
    await expect(page.getByText("Você ainda não tem foto")).toHaveCount(0);

    // Icone Promoção: a cor vira Vermelho sozinha e o rotulo diz a escolha.
    await page.getByRole("radiogroup", { name: "Ícone ao lado do título" }).getByRole("radio", { name: "Promoção" }).click();
    await expect(page.getByText("Ícone ao lado do título · Promoção", { exact: false })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Cor do ícone" }).getByRole("radio", { name: "Vermelho" })).toBeChecked();
    await expect(page.getByText("Cor do ícone · Vermelho")).toBeVisible();

    // Botao para um curso a venda (algo para abrir: "não abriu" aparece entre as escolhas da seguinte).
    await page.getByRole("switch", { name: "Levar o aluno a algum lugar" }).click();
    await page.getByLabel("Texto do botão", { exact: true }).fill(BOTAO);
    await page.getByRole("radiogroup", { name: "Para onde o botão leva" }).getByText("Um produto").click();
    await page.getByRole("group", { name: "Produto", exact: true }).getByText(ESCOLA_DE_TESTE.cursoBloqueado.titulo).click();
    await expect(page.getByRole("radio", { name: new RegExp(ESCOLA_DE_TESTE.cursoBloqueado.titulo) })).toBeChecked();

    // Quando: agora, e fica 1 dia no sino.
    await page.getByRole("radiogroup", { name: "Fica no sino por" }).getByText("1 dia", { exact: true }).click();
    await expect(page.getByRole("radiogroup", { name: "Fica no sino por" }).getByRole("radio", { name: "1 dia" })).toBeChecked();

    // Depois desta notificação: a seguinte abre na folha; o titulo e escrito la.
    await page.getByRole("button", { name: "Adicionar notificação seguinte" }).click();
    const folha = page.getByRole("dialog", { name: "Notificação seguinte 1" });
    await expect(folha).toBeVisible();
    // Os campos da folha (titulo, botao, regras, previa) tem ids proprios: nada repete os do editor embaixo.
    expect(await idsRepetidos(page)).toEqual([]);
    await folha.getByLabel("Título", { exact: true }).fill(SEGUINTE);
    await folha.getByRole("button", { name: "Concluir" }).click();
    await expect(folha).toHaveCount(0);

    const cartao = page.getByRole("article", { name: "Notificação seguinte 1" });
    await expect(cartao.getByText(SEGUINTE)).toBeVisible();
    await cartao.getByRole("spinbutton", { name: "Quanto tempo" }).fill("2");
    await cartao.getByRole("combobox", { name: "Unidade" }).click();
    await page.getByRole("option", { name: "horas", exact: true }).click();
    await expect(cartao.getByRole("combobox", { name: "A partir de quando" })).toContainText("depois do envio");
    await cartao.getByRole("radio", { name: "não abriu", exact: true }).click();
    await expect(cartao.getByText("2 horas depois do envio · para quem não abriu")).toBeVisible();

    await page.getByRole("button", { exact: true, name: "Enviar agora" }).click();
    const enviado = page.getByText(/^Notificação enviada para \d+ alunos?\.$/);
    await expect(enviado).toBeVisible();
    enviadas = Number(/(\d+)/.exec((await enviado.textContent()) ?? "")?.[1] ?? 0);
    expect(enviadas).toBeGreaterThan(1);

    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: TITULO })).toBeVisible();
    enderecoDoAviso = new URL(page.url()).pathname;
  });
});

test.describe("aluna A", () => {
  test("vê a foto de quem envia, o ícone antes do título e Termina em 23 h, e abre o cartão", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { exact: true, name: "Notificações, 1 nova" }).click();
    const { painel } = sino(page);
    const aviso = painel.getByRole("article", { name: TITULO });
    await expect(aviso).toBeVisible();

    // O circulo e a foto do produtor (o src gravado no perfil).
    await expect(aviso.locator(`img[src="${fotoDoProdutorUrl}"]`)).toBeVisible();
    await expect(aviso.getByText("Produtor de Teste", { exact: true })).toBeVisible();

    // O icone vem dentro do titulo, antes do texto; o nome do cartao continua sendo so o titulo.
    const tituloDoCartao = aviso.locator("p").first();
    await expect(tituloDoCartao.locator("svg.lucide-badge-percent")).toBeVisible();
    expect(await tituloDoCartao.evaluate((element) => element.firstChild === element.firstElementChild && Boolean(element.firstElementChild?.querySelector("svg")))).toBe(true);
    await expect(aviso.getByText("· Termina em 23 h")).toBeVisible();

    // Abrir: tocar no cartao (fora do botao) grava o "abriu" no servidor.
    await aviso.getByText(TEXTO).click();
    await expect.poll(async () => (await itemDoSino(page, TITULO))?.openedAt ?? null).not.toBeNull();
  });
});

test.describe("aluno B", () => {
  test.use({ storageState: SESSAO_DO_ALUNO_B });

  test("só toca em Marcar todas como lidas: fica lida, mas não aberta", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { exact: true, name: "Notificações, 1 nova" }).click();
    const { painel } = sino(page);
    await expect(painel.getByRole("article", { name: TITULO })).toBeVisible();

    await painel.getByRole("button", { name: "Marcar todas como lidas" }).click();
    await expect(painel.getByRole("button", { name: "Marcar todas como lidas" })).toHaveCount(0);
    await expect.poll(async () => (await itemDoSino(page, TITULO))?.readAt ?? null).not.toBeNull();
    expect((await itemDoSino(page, TITULO))?.openedAt ?? null).toBeNull();
  });
});

test.describe("a seguinte sai", () => {
  test("tick, adiantarFluxo e tick: B recebe a seguinte, A não", async ({ browser }) => {
    // 1. O tick matricula quem recebeu a notificacao; 2. a espera de 2 h vira agora; 3. o tick decide e envia.
    await rodarTick();
    const flowId = await idDoFluxo({ aviso: TITULO });
    expect(await adiantarFluxo(flowId)).toBeGreaterThan(0);
    await rodarTick();

    const contextoB = await browser.newContext({ storageState: SESSAO_DO_ALUNO_B });
    const paginaB = await contextoB.newPage();
    await paginaB.goto("/");
    await paginaB.getByRole("button", { exact: true, name: "Notificações, 1 nova" }).click();
    await expect(sino(paginaB).painel.getByRole("article", { name: SEGUINTE })).toBeVisible();
    await contextoB.close();

    const contextoA = await browser.newContext({ storageState: "tests/e2e/.auth/aluna.json" });
    const paginaA = await contextoA.newPage();
    await paginaA.goto("/");
    const sinoDaA = paginaA.getByRole("button", { exact: true, name: "Notificações" });
    await expect(sinoDaA).toBeVisible();
    await sinoDaA.click();
    await expect(sino(paginaA).painel.getByRole("article", { name: TITULO })).toBeVisible();
    await expect(sino(paginaA).painel.getByRole("article", { name: SEGUINTE })).toHaveCount(0);
    await contextoA.close();
  });
});

test.describe("relatório", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("a seguinte conta quem recebeu: todos menos a aluna que abriu", async ({ page }) => {
    await page.goto(enderecoDoAviso);
    const cartao = page.locator("#relatorio-seguintes").getByRole("article", { name: "Notificação seguinte 1" });
    await expect(cartao).toBeVisible();
    const receberam = cartao.locator("div").filter({ has: page.locator("dt", { hasText: /^Receberam$/ }) }).locator("dd");
    await expect(receberam).toHaveText(String(enviadas - 1));
  });
});

test.describe("a 375 px", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json", viewport: { height: 812, width: 375 } });

  test("no rascunho, a seguinte abre na folha de tela cheia, Quando sai fica em duas linhas e a prévia ganha as pílulas", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos/novo");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Título", { exact: true }).fill(RASCUNHO);
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Adicionar notificação seguinte" }).click();
    const folha = page.getByRole("dialog", { name: "Notificação seguinte 1" });
    await expect(folha).toBeVisible();
    await expect.poll(async () => folha.boundingBox()).toEqual({ height: 812, width: 375, x: 0, y: 0 });
    await folha.getByLabel("Título", { exact: true }).fill("Seguinte no celular");
    await folha.getByRole("button", { name: "Concluir" }).click();
    await expect(folha).toHaveCount(0);

    // Quando sai: o numero e a unidade numa linha, "depois do envio" embaixo.
    const cartao = page.getByRole("article", { name: "Notificação seguinte 1" });
    const numero = await cartao.getByRole("spinbutton", { name: "Quanto tempo" }).boundingBox();
    const unidade = await cartao.getByRole("combobox", { name: "Unidade" }).boundingBox();
    const base = await cartao.getByRole("combobox", { name: "A partir de quando" }).boundingBox();
    expect(numero && unidade && base).toBeTruthy();
    expect(Math.abs((numero?.y ?? 0) - (unidade?.y ?? 0))).toBeLessThan(2);
    expect(base?.y ?? 0).toBeGreaterThanOrEqual((numero?.y ?? 0) + (numero?.height ?? 0));
    expect(numero?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Editar notificação: a mesma folha, de novo em tela cheia; Concluir fecha.
    await cartao.getByRole("button", { name: "Editar notificação" }).click();
    await expect(folha).toBeVisible();
    await expect.poll(async () => folha.boundingBox()).toEqual({ height: 812, width: 375, x: 0, y: 0 });
    await folha.getByRole("button", { name: "Concluir" }).click();
    await expect(folha).toHaveCount(0);

    const pilulas = page.getByRole("group", { name: "Qual notificação a prévia mostra" });
    await expect(pilulas.getByRole("button")).toHaveText(["Esta notificação", "Seguinte 1"]);
    await expect(pilulas.getByRole("button", { name: "Esta notificação" })).toHaveAttribute("aria-pressed", "true");

    // Nada passa da largura do celular (sem rolagem lateral na pagina).
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
