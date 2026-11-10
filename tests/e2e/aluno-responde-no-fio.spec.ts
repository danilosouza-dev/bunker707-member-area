import { expect, paginaFalsaPlayerJs, test } from "./fixtures";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { chatRoleLabel } from "../../src/lib/webinar-room-client";
import { WEBINAR_ADMIN_COPY } from "../../src/server/webinars/editor-model";

// O fio das Perguntas (docs/30 §1.3 e §2.4; decisao do produtor de 10/11/2026): a aluna perguntou e a equipe respondeu
// por escrito; na aba Perguntas da sala ela clica em Responder, escreve e a resposta entra no fio ("2 respostas" ao
// fechar); no console, o produtor ve "Nova resposta do aluno" na pergunta, responde no fio e o selo some; a aluna ve a
// resposta do Apresentador na releitura das perguntas. A pergunta e a primeira resposta entram direto no banco (o que o
// teste confere e o fio).

const { id: webinarId, sessaoId, slug, titulo } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";
const novas = WEBINAR_COPY.salaV2.perguntas;
const doConsole = WEBINAR_ADMIN_COPY.console.questions;
const PERGUNTA = "Vai ter replay desta live?";
const RESPOSTA_DA_ALUNA = "E fica no aplicativo também?";
const RESPOSTA_DA_EQUIPE = "Fica sim, no mesmo lugar.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  const contas = await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
  // A aluna ja aceitou as regras do chat (o texto de agora) e ja perguntou; a equipe respondeu por escrito.
  unwrap(await db.from("webinar_chat_consents").upsert({ consent_version: 2, display_mode: "first_name_initial", user_id: contas.aluna.id }, { onConflict: "user_id" }), "Gravando o aceite da aluna");
  unwrap(
    await db.from("webinar_questions").insert({
      anonymous: false,
      answer_text: "Vai sim, fica 7 dias.",
      answered_at: new Date(Date.now() - 60_000).toISOString(),
      answered_by: contas.produtor.id,
      body: PERGUNTA,
      display_name: "Aluna T.",
      offset_ms: 30_000,
      session_id: sessaoId,
      status: "answered",
      user_id: contas.aluna.id
    }),
    "Gravando a pergunta respondida"
  );
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
});

test("a aluna responde no fio da propria pergunta", async ({ page }) => {
  await paginaFalsaPlayerJs(page, ORIGEM_DA_BUNNY);
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto(`/webinarios/${slug}/sala?sessao=${sessaoId}`);
  const sala = page.getByRole("dialog", { name: titulo });
  await expect(sala).toBeVisible();

  await sala.locator("#room-railbtn-perguntas").click();
  const pergunta = sala.locator("[data-room-question]").filter({ hasText: PERGUNTA });
  await expect(pergunta).toBeVisible();
  // A minha pergunta respondida: o fio ja aberto com a resposta da Equipe, e o Responder na linha de acoes.
  await expect(pergunta.getByText("Vai sim, fica 7 dias.")).toBeVisible();
  const responder = pergunta.getByRole("button", { exact: true, name: novas.responder });
  await expect(responder).toHaveAttribute("aria-expanded", "false");
  await responder.click();

  const campo = pergunta.getByRole("textbox", { name: novas.suaResposta });
  await expect(campo).toBeFocused();
  const enviar = pergunta.locator("[data-room-reply-field]").getByRole("button", { exact: true, name: novas.responder });
  await expect(enviar).toBeDisabled();
  await campo.fill(RESPOSTA_DA_ALUNA);
  const gravacao = page.waitForResponse((response) => response.url().includes("/questions/") && response.url().endsWith("/replies") && response.request().method() === "POST");
  await enviar.click();
  expect((await gravacao).status()).toBe(201);

  // A resposta entra no fio, o campo fecha e o botao do fio conta as duas.
  await expect(pergunta.locator("[data-room-reply]").filter({ hasText: RESPOSTA_DA_ALUNA })).toBeVisible();
  await expect(pergunta.locator("[data-room-reply-field]")).toHaveCount(0);
  await pergunta.getByRole("button", { name: novas.ocultarRespostas }).click();
  await expect(pergunta.getByRole("button", { name: novas.respostas(2) })).toBeVisible();
});

test.describe("o console", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("o produtor ve 'Nova resposta do aluno', responde no fio e o selo some", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto(`/admin/comunicacao/webinarios/${webinarId}/sala?sessao=${sessaoId}`);
    await page.locator("#console-tabbtn-perguntas, #console-railbtn-perguntas").first().click();

    const pergunta = page.locator("[data-console-question]").filter({ hasText: PERGUNTA });
    await expect(pergunta).toBeVisible();
    await expect(pergunta.getByText(doConsole.newReply)).toBeVisible();
    await expect(pergunta.locator('[data-console-reply][data-reply-role="student"]').filter({ hasText: RESPOSTA_DA_ALUNA })).toBeVisible();

    await pergunta.locator("[data-console-reply-open]").click();
    const campo = pergunta.getByRole("textbox", { name: doConsole.replyLabel });
    await expect(campo).toBeFocused();
    await campo.fill(RESPOSTA_DA_EQUIPE);
    await pergunta.locator("[data-room-reply-field]").getByRole("button", { exact: true, name: doConsole.reply }).click();

    await expect(pergunta.locator('[data-console-reply][data-reply-role="host"]').filter({ hasText: RESPOSTA_DA_EQUIPE })).toBeVisible();
    await expect(pergunta.getByText(doConsole.newReply)).toHaveCount(0);
    await expect(pergunta.locator("[data-room-reply-field]")).toHaveCount(0);
  });
});

test("a aluna ve a resposta do Apresentador no fio", async ({ page }) => {
  await paginaFalsaPlayerJs(page, ORIGEM_DA_BUNNY);
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto(`/webinarios/${slug}/sala?sessao=${sessaoId}`);
  const sala = page.getByRole("dialog", { name: titulo });
  await sala.locator("#room-railbtn-perguntas").click();
  const pergunta = sala.locator("[data-room-question]").filter({ hasText: PERGUNTA });
  const daEquipe = pergunta.locator("[data-room-reply]").filter({ hasText: RESPOSTA_DA_EQUIPE });
  await expect(daEquipe).toBeVisible();
  await expect(daEquipe.getByText(chatRoleLabel("host") ?? "Apresentador").first()).toBeVisible();
});
