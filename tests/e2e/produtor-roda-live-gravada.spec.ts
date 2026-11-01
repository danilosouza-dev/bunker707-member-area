import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { LIVE_GRAVADA_DE_TESTE, limparWebinarios, seedLiveGravadaEncerradaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";

// O produtor roda uma Live gravada (docs/30 §2.2 "Roteiro de chat", §2.4 e §10.2; fase 2b): importa um CSV no
// Roteiro de chat (a previa com a contagem, Importar), salva uma enquete pronta, abre o console da sessao marcada,
// abre a sessao pela mao (o roteiro pronto entra no chat), manda uma mensagem da equipe e lanca a enquete; a 375 px
// o console cabe sem rolar de lado e a 1280 x 720 a pagina nao rola (o console tem a altura da janela e cada parte rola
// por dentro, docs/31 V2-13). Usa a Live gravada de teste da 2c (webinario e gravacao) mais uma sessao
// marcada ha 1 min, so para esta rodada; a aluna nao participa aqui (a Sala dela esta em aluno-assiste-live-gravada).
// Fase 4 (docs/30 §2.2 e §2.4): o editor da Live gravada ganhou os cards Oferta e Assistente e o console da sessao
// gravada, os paineis Oferta e Atendimento; o roteiro, as enquetes e o chat da equipe seguem iguais. O painel com abas
// (docs/31 V2-15): o Chat na tela; o Roteiro, as Enquetes, a Oferta e o Atendimento no ⋯ "Mais painéis", montados e
// escondidos ate a pessoa escolher.

const { id, titulo } = LIVE_GRAVADA_DE_TESTE;
const SESSAO = "bbbbbbbb-0000-4000-8000-0000000000e1";
const CSV = ["Tempo;Nome;Papel;Mensagem", "0:05;Duda;Aluno;Boa noite, turma!", "0:10;Equipe;Equipe;Bem-vindos ao encontro", "abc;Lia;Aluno;tempo torto"].join("\n");
const entradas = WEBINAR_COPY.consoleV2.entradas;

/** Escolhe uma entrada no ⋯ do painel do console e devolve a secao dela, ja na tela (um grupo com o nome da entrada). */
async function abrirNoMais(page: Page, entrada: string) {
  await page.locator("[data-console-more-trigger]").click();
  await page.getByRole("menuitemradio", { exact: true, name: entrada }).click();
  const secao = page.locator("section[data-console-more]").and(page.getByRole("group", { exact: true, name: entrada }));
  await expect(secao).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: WEBINAR_COPY.consoleV2.maisEscolhido(entrada) })).toBeVisible();
  return secao;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await limparWebinarios(db);
  await seedLiveGravadaEncerradaDeTeste(db);
  const inicio = new Date(Date.now() - 60_000);
  inicio.setUTCMilliseconds(0);
  unwrap(
    await db.from("webinar_sessions").insert({ id: SESSAO, kind: "simulated", recording_id: LIVE_GRAVADA_DE_TESTE.gravacaoId, scheduled_at: inicio.toISOString(), status: "scheduled", webinar_id: id }),
    "Gravando a sessao marcada de teste"
  );
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
});

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("importa o CSV no Roteiro de chat (previa com os erros por linha) e salva uma enquete pronta", async ({ page }) => {
    await page.goto(`/admin/comunicacao/webinarios/${id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();

    // Fase 4: os cards novos do webinario ja gravado (cada um salva pela propria Server Action).
    await expect(page.getByRole("region", { exact: true, name: WEBINAR_COPY.oferta.card.titulo })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: WEBINAR_COPY.assistente.card.titulo })).toBeVisible();

    const roteiro = page.getByRole("region", { name: "Roteiro de chat" });
    await expect(roteiro.getByText(/0 entram sozinhas/)).toBeVisible();
    await roteiro.locator("input[data-script-csv-input]").setInputFiles({ buffer: Buffer.from(CSV, "utf8"), mimeType: "text/csv", name: "roteiro.csv" });

    const previa = page.getByRole("dialog");
    await expect(previa.getByText("2 mensagens prontas para entrar.")).toBeVisible();
    await expect(previa.getByText(/Linha 4: Tempo inválido/)).toBeVisible();
    await previa.getByRole("button", { exact: true, name: "Importar" }).click();
    await expect(page.getByText("2 mensagens entraram no roteiro.")).toBeVisible();
    await expect(roteiro.getByText(/2 entram sozinhas/)).toBeVisible();
    await expect(roteiro.locator("[data-script-row='0'] textarea")).toHaveValue("Boa noite, turma!");

    const enquetes = page.getByRole("region", { name: "Enquetes" });
    await enquetes.getByRole("button", { name: "Adicionar enquete" }).click();
    await enquetes.getByLabel("Pergunta 1").fill("Vem na próxima?");
    await enquetes.getByPlaceholder("Opção 1").fill("Sim");
    await enquetes.getByPlaceholder("Opção 2").fill("Não");
    await enquetes.getByRole("button", { name: "Salvar enquetes" }).click();
    await expect(page.getByText("Enquetes salvas.")).toBeVisible();
  });

  test("abre o console, poe a sessao no ar (o roteiro entra no chat), manda uma mensagem da equipe e lanca a enquete", async ({ page }) => {
    await page.goto(`/admin/comunicacao/webinarios/${id}/sala?sessao=${SESSAO}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Console da sessão" })).toBeVisible();
    await expect(page.locator("#console-session")).toHaveValue(SESSAO);

    await page.getByRole("button", { exact: true, name: "Abrir sessão" }).click();
    const confirmacao = page.getByRole("dialog");
    await expect(confirmacao.getByText("Abrir a sessão agora?")).toBeVisible();
    await confirmacao.getByRole("button", { exact: true, name: "Abrir sessão" }).click();
    await expect(page.getByText("Sessão aberta. O roteiro pronto entrou no chat.")).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Encerrar sessão" })).toBeVisible();

    // O painel com abas da gravada (docs/31 V2-15): Chat e Perguntas, sem Mãos nem Pessoas, e o Chat na tela.
    await expect(page.getByRole("tab")).toHaveText(["Chat", /^Perguntas/]);
    await expect(page.getByRole("tab", { exact: true, name: "Chat" })).toHaveAttribute("aria-selected", "true");

    // Fase 4: na sessao gravada o console tem tambem a Oferta (Mostrar agora / Esconder) e o Atendimento, no ⋯.
    const oferta = await abrirNoMais(page, entradas.oferta);
    await expect(oferta.getByRole("region", { exact: true, name: WEBINAR_COPY.oferta.console.titulo })).toBeVisible();
    const atendimento = await abrirNoMais(page, entradas.atendimento);
    await expect(atendimento.getByRole("region", { exact: true, name: WEBINAR_COPY.assistente.console.titulo })).toBeVisible();
    await expect(oferta).toBeHidden();
    await expect(page.getByRole("tab", { exact: true, name: "Chat" })).toHaveAttribute("aria-selected", "false");

    // O roteiro pronto entrou: a fila no ⋯ › Roteiro.
    const roteiro = await abrirNoMais(page, entradas.roteiro);
    await expect(roteiro.locator("[data-script-fired='true']")).toHaveCount(2);

    // De volta ao Chat: as mensagens do roteiro estao la.
    await page.getByRole("tab", { exact: true, name: "Chat" }).click();
    await expect(roteiro).toBeHidden();
    const chat = page.getByRole("log", { name: "Chat" });
    await expect(chat.getByText("Boa noite, turma!")).toBeVisible();
    await expect(chat.getByText("Bem-vindos ao encontro")).toBeVisible();

    await page.getByPlaceholder("Escreva para a turma").fill("Bem-vindos à sessão de teste");
    await page.getByRole("button", { exact: true, name: "Enviar" }).click();
    await expect(page.getByText("Mensagem enviada.")).toBeVisible();
    await expect(chat.getByText("Bem-vindos à sessão de teste")).toBeVisible();
    await expect(chat.getByText("Apresentador").first()).toBeVisible();

    const enquetes = (await abrirNoMais(page, entradas.enquetes)).getByRole("region", { name: "Enquetes" });
    await enquetes.getByRole("button", { exact: true, name: "Abrir" }).click();
    await expect(enquetes.getByText("Nesta sessão")).toBeVisible();
    await expect(enquetes.getByText("0 respostas")).toBeVisible();
    await expect(enquetes.getByRole("button", { exact: true, name: "Encerrar" })).toBeVisible();
    await expect(enquetes.getByRole("button", { exact: true, name: "Abrir" })).toHaveCount(0);
  });

  test("a 375 px o console cabe sem rolar de lado", async ({ page }) => {
    await page.setViewportSize({ height: 740, width: 375 });
    await page.goto(`/admin/comunicacao/webinarios/${id}/sala?sessao=${SESSAO}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Console da sessão" })).toBeVisible();
    await expect(page.getByRole("log", { name: "Chat" })).toBeVisible();

    const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
    expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);
  });

  test("a 1280 x 720 o console tem a altura da janela e a pagina nao rola: so o painel rola por dentro", async ({ page }) => {
    await page.setViewportSize({ height: 720, width: 1280 });
    await page.goto(`/admin/comunicacao/webinarios/${id}/sala?sessao=${SESSAO}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Console da sessão" })).toBeVisible();
    await expect(page.getByRole("log", { name: "Chat" })).toBeVisible();

    // Os rotulos so para o leitor de tela do painel (como o "Escreva para a turma" do chat) ficam dentro do painel que
    // rola; fora dele, esticariam o documento e a pagina inteira rolaria para fora da tela.
    const alturas = await page.evaluate(() => {
      window.scrollTo({ behavior: "instant", top: 100_000 });
      return { pagina: document.documentElement.scrollHeight, rolou: window.scrollY, tela: window.innerHeight };
    });
    expect(alturas.pagina).toBeLessThanOrEqual(alturas.tela);
    expect(alturas.rolou).toBe(0);
    await expect(page.getByRole("heading", { level: 1, name: "Console da sessão" })).toBeInViewport();
  });
});
