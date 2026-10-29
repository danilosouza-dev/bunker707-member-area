import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { atendente, EQUIPE, EQUIPE_2, montarEscola, OUTRA_SESSAO, SESSAO, WEBINAR } from "./support/webinarios-v4-assistente-banco.mjs";

// As Server Actions do Assistente e do Atendimento (docs/30 §1.6, §2.2, §2.4, §2.6, §6.6 e D24; docs/18 §2.2), sem
// banco: o banco em memoria de tests/support/webinarios-v4-assistente-banco.mjs, a permissao por um duble que recusa
// quando o teste pede e "next/cache" so anotando. Aqui: 403 sem messaging.write em toda acao (nada gravado); o card do
// editor (ler, salvar com as perguntas trocadas, o "Responder tudo" padrao nas sessoes que ainda nao comecaram, o zod
// por campo, a auditoria so com contagens, o banco sem a 202610300004); o "Responder tudo" da sessao; "Atender" /
// "Pausar" com a auditoria so na troca; Assumir, Passar para (so quem atende) e Devolver; "Corrigir resposta" so na do
// Assistente (e a pergunta da aba junto); o retrato do Atendimento que distribui as perguntas novas entre os online; a
// resposta da equipe que grava answer_source 'team' e vai ao sino quando o aluno pediu a equipe, a sessao acabou ou ele
// saiu da sala (uma vez por pergunta).

process.env.WEBINAR_ASSISTANT_ENABLED = "on";
process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const estado = (globalThis.__assistenteAcoes ??= { negar: false, revalidados: [] });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const data = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });
    if (specifier === "@/server/auth/permissions") {
      return data(`
        export async function requireRole() {
          if (globalThis.__assistenteAcoes.negar) {
            const error = new Error("Sem permissão para Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`);
    }
    if (specifier === "@/server/auth/session") {
      return data(`
        export async function getAuthenticatedUser() { return globalThis.__adminActionStubs.role.user; }
        export async function getAdminAccessForUser() { return null; }
        export function getUserDisplayName(user) {
          const fullName = (user.user_metadata?.full_name ?? "").trim() || "Equipe";
          return { fullName, name: fullName.split(/\\s+/)[0] };
        }`);
    }
    if (specifier === "next/cache") {
      return data(`
        export function revalidatePath(path) { globalThis.__assistenteAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__assistenteAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__assistenteAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`);
    }
    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "equipe@bunker707.test", id: EQUIPE, user_metadata: { full_name: "Equipe Teste" } } };

const acoes = await import("../src/server/webinars/assistant-actions.ts");
const roomActions = await import("../src/server/webinars/room-actions.ts");
const { resetAssistantAvailabilityCache } = await import("../src/server/webinars/assistant-provider.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const COPY = WEBINAR_COPY.assistente;

function montar(opcoes, extra) {
  estado.negar = false;
  estado.revalidados = [];
  resetAssistantAvailabilityCache();
  return montarEscola(opcoes, extra);
}

const auditoria = (db, action) => db.tables.admin_audit_log.filter((row) => row.action === action);
const agora = () => new Date().toISOString();

function perguntaDoAluno(userId, extra = {}) {
  return { anonymous: false, answer_source: null, answer_text: null, answered_at: null, answered_by: null, answered_live: false, assigned_at: null, assigned_to: null, body: "Tem certificado?", created_at: agora(), deleted_at: null, deleted_reason: null, display_name: "Ana S.", handoff_requested_at: null, id: crypto.randomUUID(), message_id: null, offset_ms: 590_000, session_id: SESSAO, status: "open", upvotes: 0, user_id: userId, ...extra };
}

function mensagem(extra = {}) {
  return { approved: true, approved_at: null, approved_by: null, assigned_at: null, assigned_to: null, author_user_id: null, body: "oi", created_at: agora(), deleted_at: null, deleted_by: null, deleted_reason: null, display_name: "Ana S.", edited_at: null, edited_by: null, handoff_requested_at: null, id: crypto.randomUUID(), kind: "message", master: false, offset_ms: 590_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: SESSAO, source: "audience", webinar_id: WEBINAR, ...extra };
}

/* ------------------------------------------------------------------------------------------------
 * Permissao
 * ---------------------------------------------------------------------------------------------- */

test("403 sem messaging.write em toda acao do Assistente e do Atendimento; nada e gravado", async () => {
  const { db } = montar();
  estado.negar = true;
  const pedidos = [
    acoes.loadAssistantEditor({ webinarId: WEBINAR }),
    acoes.saveAssistant({ items: [], settings: { enabled: true, replyAllDefault: true }, webinarId: WEBINAR }),
    acoes.setReplyAll({ on: true, sessionId: SESSAO }),
    acoes.pingAttendant({ sessionId: SESSAO, status: "online" }),
    acoes.assign({ id: crypto.randomUUID(), sessionId: SESSAO, target: "question", userId: EQUIPE }),
    acoes.editAssistantAnswer({ body: "corrigida", messageId: crypto.randomUUID() }),
    acoes.loadAttendanceSnapshot({ sessionId: SESSAO })
  ];
  for (const result of await Promise.all(pedidos)) {
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  }
  assert.deepEqual(db.calls.writes, []);
  assert.deepEqual(db.tables.admin_audit_log, []);
});

/* ------------------------------------------------------------------------------------------------
 * O card do editor
 * ---------------------------------------------------------------------------------------------- */

test("loadAssistantEditor: o Assistente, as perguntas cadastradas e se o ambiente e a IA deixam; sem a 202610300004, o aviso", async () => {
  montar();
  const lido = await acoes.loadAssistantEditor({ webinarId: WEBINAR });
  assert.equal(lido.ok, true, JSON.stringify(lido));
  assert.equal(lido.data.pendingMigration, false);
  assert.deepEqual(lido.data.settings, { enabled: true, replyAllDefault: false });
  assert.deepEqual(lido.data.items.map((item) => item.question), ["Quanto custa a Formacao?"]);
  assert.equal(lido.data.envEnabled, true);
  assert.equal(lido.data.aiAvailable, true);

  process.env.WEBINAR_ASSISTANT_ENABLED = "off";
  try {
    montar();
    const desligado = await acoes.loadAssistantEditor({ webinarId: WEBINAR });
    assert.equal(desligado.data.envEnabled, false);
    assert.equal(desligado.data.aiAvailable, false);
  } finally {
    process.env.WEBINAR_ASSISTANT_ENABLED = "on";
  }

  montar({ semIa: true });
  assert.equal((await acoes.loadAssistantEditor({ webinarId: WEBINAR })).data.aiAvailable, false);

  montar({}, { semMigracao: true });
  const pendente = await acoes.loadAssistantEditor({ webinarId: WEBINAR });
  assert.deepEqual(pendente.data, { migration: "202610300004", pendingMigration: true });
});

test("saveAssistant: grava o Assistente, troca as perguntas (atualiza, cria, apaga), aplica o Responder tudo padrao as sessoes que nao comecaram e audita so contagens", async () => {
  const { db } = montar({ kind: "live" });
  const existente = db.tables.webinar_assistant_knowledge[0];
  const salvo = await acoes.saveAssistant({
    items: [
      { answer: "  Sim, ao fim da formacao.  ", question: "Tem certificado?" },
      { answer: "R$ 897 com o cupom.", id: existente.id, question: "Quanto custa a Formacao?" }
    ],
    settings: { enabled: true, replyAllDefault: true },
    webinarId: WEBINAR
  });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  assert.equal(salvo.data.sessionsUpdated, 1, "so a sessao agendada; a que esta no ar segue o console");
  assert.equal(typeof salvo.data.updatedAt, "string", "a versao do webinario volta para o editor (o proximo Salvar nao da 409)");
  assert.deepEqual(db.tables.webinars[0].assistant_settings, { enabled: true, replyAllDefault: true });
  assert.deepEqual(
    db.tables.webinar_assistant_knowledge.map((row) => [row.position, row.question, row.answer]).sort((a, b) => a[0] - b[0]),
    [
      [0, "Tem certificado?", "Sim, ao fim da formacao."],
      [1, "Quanto custa a Formacao?", "R$ 897 com o cupom."]
    ]
  );
  assert.equal(db.tables.webinar_sessions.find((row) => row.id === OUTRA_SESSAO).assistant_reply_all, true);
  assert.equal(db.tables.webinar_sessions.find((row) => row.id === SESSAO).assistant_reply_all, false);
  const [registro] = auditoria(db, "webinar.assistant_saved");
  assert.deepEqual(registro.metadata, { enabled: true, items: 2, reply_all_default: true, sessions_updated: 1 });
  assert.equal(registro.count, 2);
  assert.ok(!JSON.stringify(registro).includes("cupom"), "nunca o texto na auditoria");
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}`));

  const apagando = await acoes.saveAssistant({ items: [], settings: { enabled: false, replyAllDefault: true }, webinarId: WEBINAR });
  assert.equal(apagando.ok, true);
  assert.equal(apagando.data.sessionsUpdated, 0, "o padrao nao mudou: as sessoes ficam como estao");
  assert.deepEqual(db.tables.webinar_assistant_knowledge, []);

  const invalido = await acoes.saveAssistant({ items: [{ answer: "ok", question: "x" }], settings: { enabled: true, replyAllDefault: false }, webinarId: WEBINAR });
  assert.equal(invalido.ok, false);
  assert.equal(invalido.status, 400);
  assert.ok(invalido.fieldErrors["items.0.question"]);

  montar({}, { semMigracao: true });
  const semMigracao = await acoes.saveAssistant({ items: [], settings: { enabled: true, replyAllDefault: false }, webinarId: WEBINAR });
  assert.equal(semMigracao.ok, false);
  assert.equal(semMigracao.status, 409);
  assert.equal(semMigracao.error, COPY.erros.precisaMigracao("202610300004"));
});

/* ------------------------------------------------------------------------------------------------
 * O console
 * ---------------------------------------------------------------------------------------------- */

test("setReplyAll liga e desliga o Responder tudo da sessao com auditoria; sessao que nao existe, 404", async () => {
  const { db } = montar();
  const ligado = await acoes.setReplyAll({ on: true, sessionId: SESSAO });
  assert.deepEqual(ligado.data, { on: true, sessionId: SESSAO });
  assert.equal(db.tables.webinar_sessions.find((row) => row.id === SESSAO).assistant_reply_all, true);
  assert.deepEqual(auditoria(db, "webinar.assistant_reply_all")[0].metadata, { on: true, session_id: SESSAO });
  const inexistente = await acoes.setReplyAll({ on: true, sessionId: crypto.randomUUID() });
  assert.equal(inexistente.status, 404);
  assert.equal(inexistente.error, COPY.erros.sessaoInexistente);
});

test("pingAttendant: Atender e Pausar gravam a batida; a auditoria so na troca de situacao", async () => {
  const { db } = montar();
  assert.equal((await acoes.pingAttendant({ sessionId: SESSAO, status: "online" })).data.status, "online");
  await acoes.pingAttendant({ sessionId: SESSAO, status: "online" });
  await acoes.pingAttendant({ sessionId: SESSAO, status: "away" });
  assert.deepEqual(db.tables.webinar_attendants.map((row) => [row.user_id, row.status]), [[EQUIPE, "away"]]);
  assert.deepEqual(auditoria(db, "webinar.attendant_status").map((row) => row.metadata.status), ["online", "away"]);
});

test("assign: Assumir, Passar para (so quem atende nesta sessao) e Devolver; alvo de outra sessao, 404", async () => {
  const { db, userId } = montar();
  const pergunta = perguntaDoAluno(userId);
  db.tables.webinar_questions.push(pergunta);

  const assumida = await acoes.assign({ id: pergunta.id, sessionId: SESSAO, target: "question", userId: EQUIPE });
  assert.equal(assumida.ok, true, JSON.stringify(assumida));
  assert.equal(pergunta.assigned_to, EQUIPE);
  assert.ok(pergunta.assigned_at);

  const naoAtende = await acoes.assign({ id: pergunta.id, sessionId: SESSAO, target: "question", userId: EQUIPE_2 });
  assert.equal(naoAtende.status, 400);
  assert.deepEqual(naoAtende.fieldErrors, { userId: [COPY.erros.atendenteInvalido] });
  assert.equal(pergunta.assigned_to, EQUIPE);

  db.tables.webinar_attendants.push(atendente(EQUIPE_2));
  assert.equal((await acoes.assign({ id: pergunta.id, sessionId: SESSAO, target: "question", userId: EQUIPE_2 })).ok, true);
  assert.equal(pergunta.assigned_to, EQUIPE_2);
  assert.equal((await acoes.assign({ id: pergunta.id, sessionId: SESSAO, target: "question", userId: null })).ok, true);
  assert.equal(pergunta.assigned_to, null);
  assert.deepEqual(
    auditoria(db, "webinar.attendance_assigned").map((row) => [row.metadata.from, row.metadata.to]),
    [
      [null, EQUIPE],
      [EQUIPE, EQUIPE_2],
      [EQUIPE_2, null]
    ]
  );

  const deOutra = perguntaDoAluno(userId, { session_id: OUTRA_SESSAO });
  db.tables.webinar_questions.push(deOutra);
  assert.equal((await acoes.assign({ id: deOutra.id, sessionId: SESSAO, target: "question", userId: EQUIPE })).status, 404);
  const daEquipe = mensagem({ author_user_id: EQUIPE, role: "team", source: "team" });
  db.tables.webinar_chat_messages.push(daEquipe);
  assert.equal((await acoes.assign({ id: daEquipe.id, sessionId: SESSAO, target: "chat", userId: EQUIPE })).status, 404, "so mensagem da turma");
});

test("editAssistantAnswer: corrige so a resposta do Assistente (e a pergunta da aba que ela respondeu), com a marca de quem corrigiu; na de aluno, 409", async () => {
  const { db, userId } = montar();
  const pergunta = perguntaDoAluno(userId, { answer_source: "ai", answer_text: "Errado.", answered_at: agora(), status: "answered" });
  const resposta = mensagem({ body: "Errado.", display_name: "Assistente", kind: "answer", role: "ai", source: "ai" });
  const doAluno = mensagem({ author_user_id: userId });
  db.tables.webinar_questions.push(pergunta);
  db.tables.webinar_chat_messages.push(resposta, doAluno);
  db.tables.webinar_ai_requests.push({ answered_at: agora(), created_at: agora(), error_code: null, id: crypto.randomUUID(), model: "m", provider: "openai", reply_message_id: resposta.id, requested_at: agora(), session_id: SESSAO, skip_reason: null, status: "answered", target_id: pergunta.id, target_kind: "question", user_id: userId, webinar_id: WEBINAR });

  const corrigida = await acoes.editAssistantAnswer({ body: "Sim, ha certificado.", messageId: resposta.id });
  assert.equal(corrigida.ok, true, JSON.stringify(corrigida));
  assert.equal(corrigida.data.message.body, "Sim, ha certificado.");
  assert.equal(resposta.body, "Sim, ha certificado.");
  assert.equal(resposta.edited_by, EQUIPE);
  assert.ok(resposta.edited_at);
  assert.equal(pergunta.answer_text, "Sim, ha certificado.");
  const [registro] = auditoria(db, "webinar.assistant_answer_edited");
  assert.deepEqual(registro.metadata, { length: 20, message_id: resposta.id, question_id: pergunta.id, session_id: SESSAO });
  assert.ok(estado.revalidados.includes("webinars"), "o relatorio conta as corrigidas");

  const deAluno = await acoes.editAssistantAnswer({ body: "nao pode", messageId: doAluno.id });
  assert.equal(deAluno.status, 409);
  assert.equal(deAluno.error, COPY.erros.soRespostaDoAssistente);
  assert.equal(doAluno.body, "oi");
});

test("loadAttendanceSnapshot: distribui as perguntas novas entre quem esta atendendo (rodizio, audita a contagem) e devolve o retrato com nomes, fila e marcas", async () => {
  const { db, userId } = montar();
  db.tables.webinar_attendants.push(atendente(EQUIPE), atendente(EQUIPE_2));
  const assumida = perguntaDoAluno(userId, { assigned_at: agora(), assigned_to: EQUIPE, created_at: new Date(Date.now() - 50_000).toISOString() });
  const nova1 = perguntaDoAluno(userId, { created_at: new Date(Date.now() - 40_000).toISOString() });
  const nova2 = perguntaDoAluno(userId, { created_at: new Date(Date.now() - 30_000).toISOString() });
  const chamada = mensagem({ author_user_id: userId, body: "@assistente cade?", created_at: new Date(Date.now() - 20_000).toISOString(), handoff_requested_at: agora() });
  db.tables.webinar_questions.push(assumida, nova1, nova2);
  db.tables.webinar_chat_messages.push(chamada);

  const lido = await acoes.loadAttendanceSnapshot({ sessionId: SESSAO });
  assert.equal(lido.ok, true, JSON.stringify(lido));
  const retrato = lido.data;
  assert.equal(retrato.pendingMigration, false);
  assert.equal(retrato.distributed, 3);
  assert.equal(assumida.assigned_to, EQUIPE, "nunca tira de quem assumiu");
  assert.equal(nova1.assigned_to, EQUIPE_2);
  assert.equal(nova2.assigned_to, EQUIPE);
  assert.equal(chamada.assigned_to, EQUIPE_2);
  assert.deepEqual(retrato.queue.map((item) => [item.target, item.id, item.assignedTo]), [
    ["chat", chamada.id, EQUIPE_2],
    ["question", assumida.id, EQUIPE],
    ["question", nova1.id, EQUIPE_2],
    ["question", nova2.id, EQUIPE]
  ]);
  assert.equal(retrato.queue[0].handoffRequested, true);
  assert.deepEqual(retrato.attendants.map((item) => [item.name, item.online, item.openCount]), [
    ["Bia A.", true, 2],
    ["Equipe T.", true, 2]
  ]);
  assert.deepEqual(retrato.me, { online: true, status: "online" });
  assert.deepEqual(retrato.assistant, { aiAvailable: true, envEnabled: true, replyAll: false, settingsEnabled: true });
  assert.equal(retrato.questionMarks[nova1.id].assignedName, "Bia A.");
  assert.equal(retrato.open, true);
  assert.deepEqual(auditoria(db, "webinar.attendance_distributed").map((row) => [row.count, row.metadata.session_id]), [[3, SESSAO]]);

  const deNovo = await acoes.loadAttendanceSnapshot({ sessionId: SESSAO });
  assert.equal(deNovo.data.distributed, 0);
  assert.equal(auditoria(db, "webinar.attendance_distributed").length, 1, "nada distribuido, nada auditado");

  const { db: encerrada, userId: aluno2 } = montar();
  encerrada.tables.webinar_sessions.find((row) => row.id === SESSAO).status = "ended";
  encerrada.tables.webinar_attendants.push(atendente(EQUIPE));
  encerrada.tables.webinar_questions.push(perguntaDoAluno(aluno2));
  const fechada = await acoes.loadAttendanceSnapshot({ sessionId: SESSAO });
  assert.equal(fechada.data.distributed, 0, "sessao encerrada nao distribui");
  assert.equal(fechada.data.open, false);

  montar({}, { semMigracao: true });
  assert.deepEqual((await acoes.loadAttendanceSnapshot({ sessionId: SESSAO })).data, { migration: "202610300004", pendingMigration: true });
});

/* ------------------------------------------------------------------------------------------------
 * A resposta da equipe (room-actions.ts)
 * ---------------------------------------------------------------------------------------------- */

test("answerQuestion: a resposta da equipe grava answer_source 'team' e vai ao sino quando o aluno pediu a equipe (uma vez por pergunta)", async () => {
  const { db, userId } = montar();
  const pediu = perguntaDoAluno(userId, { answer_source: "ai", answer_text: "da IA", handoff_requested_at: agora(), status: "answered" });
  db.tables.webinar_questions.push(pediu);
  // O aluno ainda esta na sala (balde de agora), mas pediu a equipe: vai ao sino mesmo assim.
  db.tables.webinar_presence_samples.push({ bucket: 20, session_id: SESSAO, user_id: userId });

  const respondida = await roomActions.answerQuestion({ answerText: "Sim, com certificado digital.", questionId: pediu.id });
  assert.equal(respondida.ok, true, JSON.stringify(respondida));
  assert.equal(respondida.data.notified, true);
  assert.equal(pediu.answer_source, "team");
  assert.equal(pediu.answered_by, EQUIPE);
  const [sino] = db.tables.notifications;
  assert.equal(sino.kind, "webinar");
  assert.equal(sino.user_id, userId);
  assert.equal(sino.dedupe_key, `webinar:${SESSAO}:answer:${pediu.id}`);
  assert.equal(sino.title, COPY.sino.titulo("Live do Assistente"));
  assert.equal(sino.body, "Sim, com certificado digital.");
  assert.equal(sino.href, "/webinarios/live-do-assistente");
  assert.deepEqual(sino.payload, { kind: "answer", sessionId: SESSAO, targetId: pediu.id, webinarId: WEBINAR });

  await roomActions.answerQuestion({ answerText: "De novo.", questionId: pediu.id });
  assert.equal(db.tables.notifications.length, 1, "o mesmo aviso nunca entra duas vezes");
});

test("answerQuestion: com o aluno na sala e sem pedido, nada no sino; fora da sala ou com a sessao encerrada, vai ao sino; a equipe nunca recebe", async () => {
  const { db, userId } = montar();
  const presente = perguntaDoAluno(userId);
  db.tables.webinar_questions.push(presente);
  db.tables.webinar_presence_samples.push({ bucket: 20, session_id: SESSAO, user_id: userId });
  const naSala = await roomActions.answerQuestion({ answerText: "Respondida na hora.", questionId: presente.id });
  assert.equal(naSala.data.notified, false);
  assert.equal(presente.answer_source, "team");
  assert.equal(db.tables.notifications.length, 0);

  const ausente = perguntaDoAluno("abcdabcd-0000-4000-8000-0000000000a1");
  db.tables.webinar_questions.push(ausente);
  assert.equal((await roomActions.answerQuestion({ answerText: "Respondida depois.", questionId: ausente.id })).data.notified, true);

  const daEquipe = perguntaDoAluno(EQUIPE_2);
  db.tables.webinar_questions.push(daEquipe);
  assert.equal((await roomActions.answerQuestion({ answerText: "Para a equipe.", questionId: daEquipe.id })).data.notified, false);
  assert.equal(db.tables.notifications.length, 1);

  db.tables.webinar_sessions.find((row) => row.id === SESSAO).status = "ended";
  const depoisDoFim = perguntaDoAluno(userId);
  db.tables.webinar_questions.push(depoisDoFim);
  assert.equal((await roomActions.answerQuestion({ answerText: "Respondida no dia seguinte.", questionId: depoisDoFim.id })).data.notified, true);
  assert.equal(db.tables.notifications.length, 2);
});

test("sendTeamMessage respondendo a mensagem do aluno que pediu a equipe vai ao sino; setQuestionStatus answered grava 'team'; sem a 202610300004 a resposta segue sem a marca", async () => {
  const { db, userId } = montar();
  const pediu = mensagem({ author_user_id: userId, body: "@assistente nao entendi", handoff_requested_at: agora() });
  db.tables.webinar_chat_messages.push(pediu);
  db.tables.webinar_presence_samples.push({ bucket: 20, session_id: SESSAO, user_id: userId });
  const enviada = await roomActions.sendTeamMessage({ body: "Te explico: e assim.", kind: "answer", replyToId: pediu.id, sessionId: SESSAO });
  assert.equal(enviada.ok, true, JSON.stringify(enviada));
  assert.equal(db.tables.notifications.length, 1);
  assert.equal(db.tables.notifications[0].dedupe_key, `webinar:${SESSAO}:answer:${pediu.id}`);
  assert.equal(auditoria(db, "webinar.team_message")[0].metadata.notified, true);

  const aberta = perguntaDoAluno(userId);
  db.tables.webinar_questions.push(aberta);
  const marcada = await roomActions.setQuestionStatus({ questionId: aberta.id, status: "answered" });
  assert.equal(marcada.ok, true, JSON.stringify(marcada));
  assert.equal(aberta.answer_source, "team");

  const { db: semMigracao, userId: aluno } = montar({}, { semMigracao: true });
  const pergunta = { ...perguntaDoAluno(aluno) };
  for (const coluna of ["answer_source", "assigned_at", "assigned_to", "handoff_requested_at"]) {
    delete pergunta[coluna];
  }
  semMigracao.tables.webinar_questions.push(pergunta);
  const semMarca = await roomActions.answerQuestion({ answerText: "Ok.", questionId: pergunta.id });
  assert.equal(semMarca.ok, true, JSON.stringify(semMarca));
  assert.equal(pergunta.status, "answered");
  assert.equal("answer_source" in pergunta, false);
});

test("chat moderado: a resposta do Assistente espera a equipe; ao liberar, a pergunta da aba fica respondida (answer_source ai)", async () => {
  const { answerWithAssistant } = await import("../src/server/webinars/assistant.ts");
  const { iaFalsa } = await import("./support/webinarios-v4-assistente-banco.mjs");
  const { db, userId } = montar({ chatMode: "moderated" });
  iaFalsa.responder = () => "Tem certificado sim, ao fim da formação.";
  const pergunta = perguntaDoAluno(userId, { body: "Tem certificado?" });
  db.tables.webinar_questions.push(pergunta);
  const feito = await answerWithAssistant({ body: pergunta.body, messageId: null, messageKind: null, offsetMs: 590_000, origin: "questions_tab", recordingId: null, sessionId: SESSAO, target: "question", targetId: pergunta.id, userId, webinarId: WEBINAR });
  assert.equal(feito.status, "answered");
  const resposta = db.tables.webinar_chat_messages.find((row) => row.id === feito.messageId);
  assert.equal(resposta.approved, false, "na fila da equipe");
  assert.equal(pergunta.status, "open");

  const liberada = await roomActions.moderateMessage({ action: "approve", messageId: resposta.id });
  assert.equal(liberada.ok, true, JSON.stringify(liberada));
  assert.equal(resposta.approved, true);
  assert.deepEqual([pergunta.status, pergunta.answer_text, pergunta.answer_source, pergunta.answered_by], ["answered", "Tem certificado sim, ao fim da formação.", "ai", null]);
});
