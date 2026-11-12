import { expect, paginaFalsaPlayerJs, test, zerarHistoricoDeWebinarios } from "./fixtures";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { WEBINAR_ADMIN_COPY } from "../../src/server/webinars/editor-model";

// A rodada v9 dos webinarios (teste do produtor de 12/11/2026; docs/30 D85, D88 e D89; docs/31 §14.4 e §14.5), na Live
// gravada no ar, com o produtor no console e a aluna na sala (1280 px):
// - Mostrar na tela: pelo ⋯ da mensagem da aluna no chat do console, o comentario vai para a frente da turma; a
//   entrada Na tela o lista em "Na tela agora"; a aluna ve o cartao na base do palco, com o nome e o texto;
// - Responder como: o produtor escolhe "Outro nome", escreve "Equipe Bunker 707" e responde por escrito; a aluna ve a
//   resposta na aba Perguntas assinada pelo nome escolhido, e o chat nao ganha mensagem nenhuma com a resposta.

const { id: webinarId, sessaoId, slug, titulo } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";
const CONSOLE = `/admin/comunicacao/webinarios/${webinarId}/sala?sessao=${sessaoId}`;
const naTela = WEBINAR_COPY.naTela;
const perguntas = WEBINAR_ADMIN_COPY.console.questions;
const COMENTARIO = "Essa aula mudou a minha semana!";
const PERGUNTA = "A gravação fica disponível depois?";
const RESPOSTA = "Fica sim, por 30 dias, na página do webinário.";
const ASSINATURA = "Equipe Bunker 707";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  const contas = await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
  unwrap(await db.from("webinar_chat_consents").upsert({ consent_version: 2, display_mode: "first_name_initial", user_id: contas.aluna.id }, { onConflict: "user_id" }), "Gravando o aceite da aluna");
  unwrap(
    await db.from("webinar_chat_messages").insert({
      approved: true,
      author_user_id: contas.aluna.id,
      body: COMENTARIO,
      display_name: "Aluna T.",
      offset_ms: 30_000,
      role: "student",
      session_id: sessaoId,
      source: "audience",
      webinar_id: webinarId
    }),
    "Gravando o comentario da aluna"
  );
  unwrap(
    await db.from("webinar_questions").insert({ anonymous: false, body: PERGUNTA, display_name: "Aluna T.", offset_ms: 40_000, session_id: sessaoId, status: "open", user_id: contas.aluna.id }),
    "Gravando a pergunta da aluna"
  );
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

test.describe("o console", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("o produtor mostra o comentario na tela e responde a pergunta como 'Equipe Bunker 707'", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto(CONSOLE);
    await expect(page.getByRole("heading", { level: 1, name: "Console da sessão" })).toBeVisible();

    // Mostrar na tela, pelo ⋯ da mensagem.
    const chat = page.getByRole("log", { name: "Chat" });
    const daAluna = chat.locator("li").filter({ hasText: COMENTARIO }).first();
    await expect(daAluna).toBeVisible({ timeout: 15_000 });
    await daAluna.hover();
    await daAluna.getByRole("button", { name: /^Mais ações da mensagem de / }).click();
    await page.getByRole("menuitem", { exact: true, name: naTela.console.mostrarNaTela }).click();
    await expect(page.getByText(naTela.console.avisos.comentarioNaTela)).toBeVisible();
    // A mesma mensagem agora oferece o Tirar da tela.
    await daAluna.hover();
    await daAluna.getByRole("button", { name: /^Mais ações da mensagem de / }).click();
    await expect(page.getByRole("menuitem", { exact: true, name: naTela.console.tirarDaTela })).toBeVisible();
    await page.keyboard.press("Escape");

    // Responder como: Outro nome.
    await page.locator("#console-tabbtn-perguntas, #console-railbtn-perguntas").first().click();
    const pergunta = page.locator("[data-console-question]").filter({ hasText: PERGUNTA });
    await expect(pergunta).toBeVisible();
    await page.locator("[data-console-answer-author-select]").selectOption("custom");
    const responder = pergunta.getByRole("button", { exact: true, name: perguntas.answerWritten });
    await pergunta.getByRole("textbox", { name: perguntas.answerPlaceholder }).fill(RESPOSTA);
    // Sem o nome, nao responde: a frase diz por que.
    await expect(responder).toBeDisabled();
    await expect(page.getByText(perguntas.authorNameInvalid(2, 40))).toBeVisible();
    await page.locator("[data-console-answer-author-name]").fill(ASSINATURA);
    await expect(responder).toBeEnabled();
    await responder.click();
    await expect(pergunta.locator('[data-console-answer][data-console-answer-as="custom"]')).toBeVisible({ timeout: 10_000 });
    await expect(pergunta.getByText(RESPOSTA)).toBeVisible();

    // No banco: a resposta com quem assina, e nenhuma mensagem nova no chat.
    const db = createLocalAdminClient();
    const gravada = unwrap(await db.from("webinar_questions").select("answer_author, status").eq("session_id", sessaoId).eq("body", PERGUNTA).single(), "Lendo a resposta gravada") as {
      answer_author: { as: string; name: string } | null;
      status: string;
    };
    expect(gravada.status).toBe("answered");
    expect(gravada.answer_author).toMatchObject({ as: "custom", name: ASSINATURA });
    const noChat = unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", sessaoId), "Lendo o chat") as { id: string }[];
    expect(noChat).toHaveLength(1);
  });
});

test("a aluna ve o comentario no palco e a resposta assinada so na aba Perguntas", async ({ page }) => {
  await paginaFalsaPlayerJs(page, ORIGEM_DA_BUNNY);
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto(`/webinarios/${slug}/sala?sessao=${sessaoId}`);
  const sala = page.getByRole("dialog", { name: titulo });
  await expect(sala).toBeVisible();

  // Com a capa "Ativar som" no palco, o comentario fica na faixa abaixo do video (como o banner).
  const naFaixa = sala.locator('[data-room-screen-comment-row="chat"]').filter({ visible: true });
  await expect(naFaixa).toBeVisible({ timeout: 15_000 });
  await expect(naFaixa).toContainText(COMENTARIO);

  // Com o som ativado, o cartao vai para a base do palco.
  await sala.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.ativarSom }).click();
  const cartao = sala.locator('section[data-room-screen-comment="chat"]').filter({ visible: true });
  await expect(cartao).toBeVisible({ timeout: 15_000 });
  await expect(cartao.locator("[data-room-screen-comment-body]")).toHaveText(COMENTARIO);
  await expect(cartao).toContainText("Aluna T.");
  await expect(cartao.getByText(naTela.aluno.comentarioNaTela)).toBeVisible();

  // O chat nao ganhou a resposta.
  await expect(sala.getByRole("log").first()).not.toContainText(RESPOSTA);

  // A aba Perguntas: a resposta assinada pelo nome que a equipe escolheu.
  await sala.locator("#room-railbtn-perguntas").click();
  const pergunta = sala.locator("[data-room-question]").filter({ hasText: PERGUNTA });
  await expect(pergunta).toBeVisible();
  await expect(pergunta.getByText(RESPOSTA)).toBeVisible();
  // Quem assina e o nome escolhido, sem o nome de quem escreveu.
  await expect(pergunta.getByText(ASSINATURA).first()).toBeVisible();
  await expect(pergunta).not.toContainText("Produtor de Teste");
});
