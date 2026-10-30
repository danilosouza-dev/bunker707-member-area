import { expect, test } from "./fixtures";
import { LIVE_GRAVADA_DE_TESTE, limparWebinarios, seedLiveGravadaEncerradaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";

// O produtor roda uma Live gravada (docs/30 §2.2 "Roteiro de chat", §2.4 e §10.2; fase 2b): importa um CSV no
// Roteiro de chat (a previa com a contagem, Importar), salva uma enquete pronta, abre o console da sessao marcada,
// abre a sessao pela mao (o roteiro pronto entra no chat), manda uma mensagem da equipe e lanca a enquete; a 375 px
// o console cabe sem rolar de lado. Usa a Live gravada de teste da 2c (webinario e gravacao) mais uma sessao
// marcada ha 1 min, so para esta rodada; a aluna nao participa aqui (a Sala dela esta em aluno-assiste-live-gravada).
// Fase 4 (docs/30 §2.2 e §2.4): o editor da Live gravada ganhou os cards Oferta e Assistente e o console da sessao
// gravada, os paineis Oferta e Atendimento; o roteiro, as enquetes e o chat da equipe seguem iguais.

const { id, titulo } = LIVE_GRAVADA_DE_TESTE;
const SESSAO = "bbbbbbbb-0000-4000-8000-0000000000e1";
const CSV = ["Tempo;Nome;Papel;Mensagem", "0:05;Duda;Aluno;Boa noite, turma!", "0:10;Equipe;Equipe;Bem-vindos ao encontro", "abc;Lia;Aluno;tempo torto"].join("\n");

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

    // Fase 4: na sessao gravada o console tem tambem a Oferta (Mostrar agora / Esconder) e o Atendimento.
    await expect(page.getByRole("region", { exact: true, name: WEBINAR_COPY.oferta.console.titulo })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: WEBINAR_COPY.assistente.console.titulo })).toBeVisible();

    const chat = page.getByRole("list", { name: "Chat" });
    await expect(chat.getByText("Boa noite, turma!")).toBeVisible();
    await expect(chat.getByText("Bem-vindos ao encontro")).toBeVisible();
    await expect(page.locator("[data-script-fired='true']")).toHaveCount(2);

    await page.getByPlaceholder("Escreva para a turma").fill("Bem-vindos à sessão de teste");
    await page.getByRole("button", { exact: true, name: "Enviar" }).click();
    await expect(page.getByText("Mensagem enviada.")).toBeVisible();
    await expect(chat.getByText("Bem-vindos à sessão de teste")).toBeVisible();
    await expect(chat.getByText("Apresentador").first()).toBeVisible();

    const enquetes = page.getByRole("region", { name: "Enquetes" });
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
    await expect(page.getByRole("list", { name: "Chat" })).toBeVisible();

    const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
    expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);
  });
});
