import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { MIN, SESSION, WEBINAR, bancoFalso, escola, iso } from "./support/webinarios-sala-banco.mjs";

// As pessoas que comentam e a pergunta simulada (pedido do produtor de 11/11/2026; docs/30 D75 a D78; docs/18 §2.1 e
// §2.2), sem banco: o banco falso das rotas da Sala com a escola de mentira virada Live ao vivo no ar, a permissao e a
// sessao da equipe como dubles e "next/cache" so anotando. Aqui:
// - o modelo puro (persona-model.ts): o nome repetido (sem caixa nem espacos) no formulario da pessoa e no Novo
//   comentário, a pessoa da lista que sumiu, o limite da Pergunta (500), o estado do formulario (a pessoa escolhida ou
//   nova, o Tipo) e o repetir, que mantem a pessoa e o Tipo e limpa o texto; as copias da pessoa nos itens dela;
// - as regras da sala (room-rules.ts, room-model.ts): a pergunta simulada so a partir da hora dela, nunca `mine`, o
//   aluno nunca responde no fio dela (so a equipe), e a mensagem do item Pergunta nunca aparece no chat;
// - as Server Actions: criar, editar (a copia vai para os itens da pessoa) e remover a pessoa (os itens ficam com a
//   copia, fora da lista), o nome repetido no campo Nome, o arquivado e a permissao; o "Enviar agora" de Tipo Pergunta
//   (a pergunta simulada na sessao, sem aluno e sem mensagem no chat); o "Guardar na lista" de Tipo Pergunta; o "Soltar
//   agora" e o tick da live de um item Pergunta (a mensagem do roteiro e a pergunta ligada a ela, uma vez so);
// - as leituras: a aba Perguntas do aluno com o nome e a foto da pessoa, sem a pergunta antes da hora; o voto do aluno
//   vale, a resposta dele no fio nao; o console com a lista de pessoas, a pergunta com `simulated` e o chat sem a
//   mensagem do item Pergunta.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const estado = (globalThis.__pessoas ??= { negar: false, revalidados: [] });
const EQUIPE = "00000000-0000-4000-8000-0000000000e1";
const ALUNO = "11111111-1111-4111-8111-111111111111";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole() {
          if (globalThis.__pessoas.negar) {
            const error = new Error("Sem permissão para Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === "@/server/auth/session") {
      const source = `
        export async function getAuthenticatedUser() { return globalThis.__adminActionStubs.role.user; }
        export async function getAdminAccessForUser() { return null; }
        export function getUserDisplayName(user) {
          const fullName = (user.user_metadata?.full_name ?? "").trim() || "Equipe";
          return { fullName, name: fullName.split(/\\s+/)[0] };
        }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier.endsWith("/db/supabase/client")) {
      const source = `
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === "next/cache") {
      const source = `
        export function revalidatePath(path) { globalThis.__pessoas.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__pessoas.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__pessoas.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "equipe.teste@bunker707.test", id: EQUIPE, user_metadata: { full_name: "Equipe de Teste" } } };

const persona = await import("../src/server/webinars/persona-model.ts");
const rules = await import("../src/server/webinars/room-rules.ts");
const { isScriptedQuestionMessage } = await import("../src/server/webinars/room-model.ts");
const { questionFromRow } = await import("../src/server/webinars/chat-rows.ts");
const { sessionFromRow } = await import("../src/server/webinars/rows.ts");
const personaActions = await import("../src/server/webinars/persona-actions.ts");
const scriptActions = await import("../src/server/webinars/script-actions.ts");
const tick = await import("../src/server/webinars/live-script-tick.ts");
const roomQueries = await import("../src/server/webinars/room-queries.ts");
const roomWrites = await import("../src/server/webinars/room-writes.ts");
const consoleQueries = await import("../src/server/webinars/console-queries.ts");
const { clearScriptedAvatarCache } = await import("../src/server/webinars/persona-store.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const PESSOAS = WEBINAR_COPY.pessoas;
const COMENTARIOS = WEBINAR_COPY.naTela.comentarios;
const FOTO = "webinars/personas/0123456789abcdef01234567.webp";
const OUTRA_FOTO = "webinars/personas/89abcdef0123456789abcdef.webp";
const ORIGEM = "https://projeto.supabase.co";
const ADRIANO = "eeeeeeee-0000-4000-8000-0000000000a1";
const MENSAGENS = { comentario: COMENTARIOS.erros.comentario, nome: COMENTARIOS.erros.nome, nomeRepetido: PESSOAS.erros.nomeRepetido, pergunta: PESSOAS.erros.pergunta, sumiu: PESSOAS.erros.sumiu };

const ITENS = {
  dele: "dddddddd-0000-4000-8000-0000000000b1",
  tambem: "dddddddd-0000-4000-8000-0000000000b2",
  outro: "dddddddd-0000-4000-8000-0000000000b3",
  pergunta: "dddddddd-0000-4000-8000-0000000000b4"
};

function item(id, extra = {}) {
  return {
    body: `Comentário ${id.slice(-2)}`,
    created_at: iso(Date.now() - 60 * MIN),
    created_by: null,
    generated_by_ai: false,
    id,
    kind: "message",
    offset_ms: null,
    persona_avatar_path: null,
    persona_id: null,
    persona_name: "Adriano Souza",
    persona_role: "student",
    phrase: null,
    phrase_delay_ms: 0,
    position: 0,
    resolved_offset_ms: null,
    resolved_transcript_id: null,
    status: "ready",
    trigger_kind: "manual",
    updated_at: iso(Date.now() - 60 * MIN),
    webinar_id: WEBINAR,
    ...extra
  };
}

/** A Live ao vivo no ar ha 10 min, com "Adriano Souza" na lista e o roteiro: dois itens dele, um de fora e um Pergunta. */
function cenario() {
  const tables = escola({ kind: "live", status: "live" });
  const now = Date.now();
  Object.assign(
    tables.webinar_sessions.find((row) => row.id === SESSION),
    { kind: "live", recording_anchor_at: null, recording_id: null, scheduled_at: iso(now - 15 * MIN), show_live_badge: false, source_session_id: null, started_at: iso(now - 10 * MIN), status: "live" }
  );
  tables.webinar_personas = [{ avatar_path: FOTO, created_at: iso(now - 60 * MIN), created_by: null, id: ADRIANO, name: "Adriano Souza", role: "student", updated_at: iso(now - 60 * MIN), webinar_id: WEBINAR }];
  tables.webinar_chat_script_items = [
    item(ITENS.dele, { persona_avatar_path: FOTO, persona_id: ADRIANO, position: 0 }),
    item(ITENS.tambem, { offset_ms: 12 * MIN, persona_avatar_path: FOTO, persona_id: ADRIANO, position: 1, trigger_kind: "at_offset" }),
    item(ITENS.outro, { persona_name: "Caio D.", persona_role: "team", position: 2 }),
    item(ITENS.pergunta, { body: "Quanto custa o curso?", kind: "question", offset_ms: 9 * MIN, persona_avatar_path: FOTO, persona_id: ADRIANO, position: 3, trigger_kind: "at_offset" })
  ];
  tables.admin_audit_log = [];
  return tables;
}

function usar(tables = cenario()) {
  const db = bancoFalso({ tables });
  actionStubs.db = db;
  estado.negar = false;
  estado.revalidados.length = 0;
  clearScriptedAvatarCache();
  return db;
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

const audits = (db, action) => db.tables.admin_audit_log.filter((row) => row.action === action);
const linhaDoItem = (db, id) => db.tables.webinar_chat_script_items.find((row) => row.id === id);

/** O contexto da sala do aluno na Live ao vivo no ar (o que as escritas da sala conferem). */
function contexto(db) {
  return { durationMs: 60 * MIN, session: sessionFromRow(db.tables.webinar_sessions.find((row) => row.id === SESSION)), sessions: [], webinar: { id: WEBINAR } };
}

/** Uma pergunta simulada gravada (a do "Enviar agora" ou a do item), com a hora dada. */
function perguntaSimulada(db, extra = {}) {
  const row = {
    anonymous: false,
    answer_text: null,
    answered_at: null,
    answered_by: null,
    answered_live: false,
    body: "Tem certificado?",
    created_at: iso(Date.now() - MIN),
    deleted_at: null,
    deleted_reason: null,
    display_name: "Adriano Souza",
    id: `ffffffff-0000-4000-8000-${String(db.tables.webinar_questions?.length ?? 0).padStart(12, "0")}`,
    message_id: null,
    offset_ms: 9 * MIN,
    persona_avatar_path: FOTO,
    persona_id: ADRIANO,
    persona_role: "student",
    session_id: SESSION,
    source: "scripted",
    status: "open",
    updated_at: iso(Date.now() - MIN),
    upvotes: 0,
    user_id: null,
    ...extra
  };
  (db.tables.webinar_questions ??= []).push(row);
  return row;
}

/* ------------------------------------------------------------------------------------------------
 * O modelo puro
 * ---------------------------------------------------------------------------------------------- */

test("modelo: o nome da pessoa de 1 a 60, unico na lista sem caixa nem espacos (a propria pessoa fica de fora na edicao)", () => {
  const lista = [
    { id: "a", name: "Adriano Souza" },
    { id: "b", name: "Bia C." }
  ];
  const msgs = { nome: PESSOAS.erros.nome, nomeRepetido: PESSOAS.erros.nomeRepetido };
  assert.deepEqual(persona.personaDraftErrors({ name: "  adriano   SOUZA " }, lista, msgs), { name: "Já existe uma pessoa com esse nome." });
  assert.deepEqual(persona.personaDraftErrors({ id: "a", name: "Adriano  souza" }, lista, msgs), {}, "a edicao da propria pessoa");
  assert.deepEqual(persona.personaDraftErrors({ id: "b", name: "Adriano Souza" }, lista, msgs), { name: PESSOAS.erros.nomeRepetido }, "o nome de outra pessoa");
  assert.deepEqual(persona.personaDraftErrors({ name: "   " }, lista, msgs), { name: PESSOAS.erros.nome });
  assert.deepEqual(persona.personaDraftErrors({ name: "x".repeat(61) }, lista, msgs), { name: PESSOAS.erros.nome });
  assert.deepEqual(persona.personaDraftErrors({ name: "x".repeat(60) }, lista, msgs), {});
  assert.equal(persona.personaCleanName("  Adriano \t  Souza "), "Adriano Souza", "a lista guarda o nome sem espacos sobrando, com a caixa da equipe");
  assert.deepEqual(persona.sortPersonas([{ name: "bia" }, { name: "Ádria" }, { name: "Caio" }]).map((entry) => entry.name), ["Ádria", "bia", "Caio"]);
  assert.equal(persona.personaUsage([{ personaId: "a" }, { personaId: "a" }, { personaId: null }], "a"), 2);
});

test("modelo: o Novo comentário (a pessoa da lista ou a nova, o Tipo) e o repetir, que mantem a pessoa e o Tipo e limpa o texto", () => {
  const adriano = { avatarPath: FOTO, id: ADRIANO, name: "Adriano Souza", role: "student" };
  const comEle = persona.commentFormFor(adriano, "question");
  assert.deepEqual(comEle, { body: "", kind: "question", personaAvatarPath: FOTO, personaId: ADRIANO, personaName: "Adriano Souza", personaRole: "student" });
  assert.deepEqual(persona.commentFormFor(null), { body: "", kind: "message", personaAvatarPath: null, personaId: null, personaName: "", personaRole: "student" });
  // Repetir (D78): depois do Enviar agora, a mesma pessoa e o mesmo Tipo, sem o texto.
  assert.deepEqual(persona.commentFormAfterSend({ ...comEle, body: "Quanto custa?" }, ADRIANO), comEle);
  // A pessoa nova vira a da lista pelo id que o servidor devolveu.
  const nova = { body: "Oi", kind: "message", personaAvatarPath: null, personaId: null, personaName: "Duda", personaRole: "team" };
  assert.deepEqual(persona.commentFormAfterSend(nova, "novo-id"), { ...nova, body: "", personaId: "novo-id" });

  const lista = [{ id: ADRIANO, name: "Adriano Souza" }];
  assert.deepEqual(persona.commentFormErrors({ ...comEle, body: "Oi" }, lista, MENSAGENS), {});
  assert.deepEqual(persona.commentFormErrors({ ...comEle, body: "x".repeat(501) }, lista, MENSAGENS), { body: PESSOAS.erros.pergunta }, "a Pergunta ate 500, como a do aluno");
  assert.deepEqual(persona.commentFormErrors({ ...comEle, body: "x".repeat(501), kind: "message" }, lista, MENSAGENS), {}, "o comentario ate 1.000");
  assert.deepEqual(persona.commentFormErrors({ ...comEle, body: "Oi" }, [], MENSAGENS), { personaId: PESSOAS.erros.sumiu }, "a pessoa que saiu da lista");
  assert.deepEqual(persona.commentFormErrors({ ...nova, personaName: "ADRIANO  souza" }, lista, MENSAGENS), { personaName: PESSOAS.erros.nomeRepetido });
  assert.deepEqual(persona.commentFormErrors({ ...nova, personaName: "ADRIANO  souza" }, lista, MENSAGENS, { listAvailable: false }), {}, "sem a lista no banco, o nome digitado como antes");
  assert.deepEqual(persona.commentFormErrors({ ...nova, body: " ", personaName: "" }, lista, MENSAGENS), { body: COMENTARIOS.erros.comentario, personaName: COMENTARIOS.erros.nome });
  assert.equal(persona.commentBodyMax("question"), 500);
  assert.equal(persona.commentBodyMax("message"), 1000);
});

test("regras: a pergunta simulada so a partir da hora dela, nunca `mine`, e so a equipe responde no fio; a mensagem do item Pergunta fica fora do chat", () => {
  const db = usar();
  const futura = questionFromRow(perguntaSimulada(db, { created_at: iso(Date.now() + 5 * MIN) }));
  const agora = questionFromRow(perguntaSimulada(db));
  assert.equal(agora.simulated, true);
  assert.equal(agora.userId, null);
  assert.equal(rules.questionVisibleAt(futura, Date.now()), false, "a gravada abre o item Pergunta com a hora marcada mais o minuto dele");
  assert.equal(rules.questionVisibleAt(agora, Date.now()), true);
  assert.equal(rules.questionVisibleAt({ createdAt: iso(Date.now() + MIN), simulated: false }, Date.now()), true, "a do aluno sempre");
  const vista = rules.toStudentQuestion({ ...agora, status: "answered" }, ALUNO, false);
  assert.deepEqual([vista.mine, vista.canReply, vista.displayName], [false, false, "Adriano Souza"]);
  assert.equal("simulated" in vista, false, "a sala nunca sabe que e simulada");
  assert.equal(rules.questionReplyRefusal({ question: { status: "answered", userId: null }, replies: 0, staff: false, userId: ALUNO }), "not_owner");
  assert.equal(rules.questionReplyRefusal({ question: { status: "answered", userId: null }, replies: 0, staff: true, userId: EQUIPE }), null, "a equipe responde no fio");
  assert.equal(rules.toStudentQuestion({ ...agora, status: "dismissed" }, ALUNO, false), null, "a dispensada some para todos");
  assert.equal(isScriptedQuestionMessage({ kind: "question", source: "scripted" }), true);
  assert.equal(isScriptedQuestionMessage({ kind: "question", source: "audience" }), false, "a pergunta do aluno pelo chat continua no chat");
  assert.equal(isScriptedQuestionMessage({ kind: "message", source: "scripted" }), false);
});

/* ------------------------------------------------------------------------------------------------
 * As Server Actions da lista
 * ---------------------------------------------------------------------------------------------- */

test("criar a pessoa: entra na lista com o nome limpo, a foto e o Aparece como; o nome repetido volta no campo Nome; auditoria sem o nome", async () => {
  const db = usar();
  const criada = ok(await personaActions.savePersona({ avatarPath: OUTRA_FOTO, name: "  Bia   Costa ", role: "team", webinarId: WEBINAR }));
  assert.deepEqual([criada.created, criada.items, criada.persona.name, criada.persona.role, criada.persona.avatarPath], [true, 0, "Bia Costa", "team", OUTRA_FOTO]);
  assert.deepEqual(
    db.tables.webinar_personas.map((row) => row.name),
    ["Adriano Souza", "Bia Costa"]
  );
  assert.equal(db.tables.webinar_personas.at(-1).created_by, EQUIPE);
  const [auditoria] = audits(db, "webinar.persona_saved");
  assert.deepEqual(Object.keys(auditoria.metadata).sort(), ["created", "items", "persona_id", "role", "with_photo"]);
  assert.doesNotMatch(JSON.stringify(auditoria), /Bia/);

  const repetida = await personaActions.savePersona({ avatarPath: null, name: "ADRIANO souza", role: "student", webinarId: WEBINAR });
  assert.deepEqual([repetida.ok, repetida.status, repetida.fieldErrors?.name?.[0]], [false, 400, "Já existe uma pessoa com esse nome."]);
  const vazia = await personaActions.savePersona({ avatarPath: null, name: "  ", role: "student", webinarId: WEBINAR });
  assert.deepEqual([vazia.status, vazia.fieldErrors?.name?.[0]], [400, PESSOAS.erros.nome]);
  const fora = await personaActions.savePersona({ avatarPath: "https://golpe.com/foto.webp", name: "Lia", role: "student", webinarId: WEBINAR });
  assert.deepEqual([fora.status, fora.fieldErrors?.avatarPath?.[0]], [400, COMENTARIOS.erros.fotoSumiu], "a foto so da nossa pasta");
  estado.negar = true;
  assert.equal((await personaActions.savePersona({ avatarPath: null, name: "Lia", role: "student", webinarId: WEBINAR })).status, 403);
  estado.negar = false;
  db.tables.webinars.find((row) => row.id === WEBINAR).status = "archived";
  assert.equal((await personaActions.savePersona({ avatarPath: null, name: "Lia", role: "student", webinarId: WEBINAR })).status, 409, "o arquivado e so de leitura");
  assert.equal(db.tables.webinar_personas.length, 2, "nada a mais gravado");
});

test("editar a pessoa: o nome, a foto e o papel vao para todos os itens do roteiro dela; os de fora e as mensagens ja enviadas nao mudam", async () => {
  const db = usar();
  db.tables.webinar_chat_messages.push({ approved: true, author_user_id: null, body: "Já enviado", created_at: iso(Date.now() - MIN), display_name: "Adriano Souza", id: "eeeeeeee-0000-4000-8000-0000000000c1", kind: "message", master: false, offset_ms: MIN, persona_avatar_path: FOTO, role: "student", script_item_id: ITENS.dele, session_id: SESSION, source: "scripted", webinar_id: WEBINAR });
  const editada = ok(await personaActions.savePersona({ avatarPath: OUTRA_FOTO, id: ADRIANO, name: "Adriano S.", role: "team", webinarId: WEBINAR }));
  assert.deepEqual([editada.created, editada.items], [false, 3]);
  for (const id of [ITENS.dele, ITENS.tambem, ITENS.pergunta]) {
    const linha = linhaDoItem(db, id);
    assert.deepEqual([linha.persona_name, linha.persona_role, linha.persona_avatar_path, linha.persona_id], ["Adriano S.", "team", OUTRA_FOTO, ADRIANO], id);
  }
  assert.deepEqual([linhaDoItem(db, ITENS.outro).persona_name, linhaDoItem(db, ITENS.outro).persona_avatar_path], ["Caio D.", null], "o item de fora fica");
  const enviada = db.tables.webinar_chat_messages.find((row) => row.body === "Já enviado");
  assert.deepEqual([enviada.display_name, enviada.persona_avatar_path], ["Adriano Souza", FOTO], "o que a turma viu nao muda");
  const sumiu = await personaActions.savePersona({ avatarPath: null, id: "eeeeeeee-0000-4000-8000-0000000000ff", name: "X", role: "student", webinarId: WEBINAR });
  assert.equal(sumiu.status, 404);
});

test("remover a pessoa: os itens dela ficam com a copia e sem a ligacao; a auditoria conta quantos eram", async () => {
  const db = usar();
  const removida = ok(await personaActions.deletePersona({ id: ADRIANO }));
  assert.deepEqual(removida, { id: ADRIANO, items: 3 });
  assert.equal(db.tables.webinar_personas.length, 0);
  for (const id of [ITENS.dele, ITENS.tambem, ITENS.pergunta]) {
    const linha = linhaDoItem(db, id);
    assert.deepEqual([linha.persona_id, linha.persona_name, linha.persona_avatar_path], [null, "Adriano Souza", FOTO], id);
  }
  assert.deepEqual(audits(db, "webinar.persona_removed")[0].metadata, { items: 3, persona_id: ADRIANO });
  assert.equal((await personaActions.deletePersona({ id: ADRIANO })).status, 404, "de novo: ja saiu");
});

/* ------------------------------------------------------------------------------------------------
 * O Novo comentário com a pessoa e o Tipo Pergunta
 * ---------------------------------------------------------------------------------------------- */

test("Enviar agora, Tipo Pergunta: a pergunta simulada na sessao (sem aluno, com a copia da pessoa), nada no chat; o Replay recusa", async () => {
  const db = usar();
  const mensagens = db.tables.webinar_chat_messages.length;
  const enviado = ok(await scriptActions.sendScriptedComment({ body: "  Quanto tempo de acesso?  ", kind: "question", personaId: ADRIANO, personaName: "Adriano Souza", sessionId: SESSION }));
  assert.equal(enviado.message, null);
  assert.equal(db.tables.webinar_chat_messages.length, mensagens, "nada no chat");
  const linha = db.tables.webinar_questions.find((row) => row.id === enviado.question.id);
  assert.deepEqual(
    [linha.source, linha.user_id, linha.display_name, linha.body, linha.persona_id, linha.persona_role, linha.persona_avatar_path, linha.message_id, linha.anonymous, linha.session_id],
    ["scripted", null, "Adriano Souza", "Quanto tempo de acesso?", ADRIANO, "student", FOTO, null, false, SESSION]
  );
  assert.ok(Math.abs(linha.offset_ms - 10 * MIN) < 5_000, "o minuto da sessao, como a pergunta do aluno");
  assert.equal(enviado.question.simulated, true);
  const [auditoria] = audits(db, "webinar.script_comment_sent");
  assert.deepEqual([auditoria.metadata.kind, auditoria.metadata.question_id, auditoria.metadata.message_id], ["question", linha.id, null]);

  // A pessoa nova com Pergunta: entra na lista, e a pergunta sai com ela.
  const nova = ok(await scriptActions.sendScriptedComment({ body: "Tem bonus?", kind: "question", personaName: "Lia M.", personaRole: "student", sessionId: SESSION }));
  assert.equal(nova.created, true);
  assert.equal(db.tables.webinar_questions.find((row) => row.id === nova.question.id).persona_id, nova.persona.id);
  const longa = await scriptActions.sendScriptedComment({ body: "x".repeat(501), kind: "question", personaId: ADRIANO, personaName: "Adriano Souza", sessionId: SESSION });
  assert.deepEqual([longa.status, longa.fieldErrors?.body?.[0]], [400, PESSOAS.erros.pergunta]);
  const noReplay = await scriptActions.sendScriptedComment({ body: "Oi", kind: "question", personaId: ADRIANO, personaName: "Adriano Souza", sessionId: "cccccccc-0000-4000-8000-000000000004" });
  assert.deepEqual([noReplay.status, noReplay.error], [409, PESSOAS.erros.replay]);
});

test("Guardar na lista, Tipo Pergunta: o item Pergunta ligado a pessoa; Soltar agora abre a pergunta ligada a mensagem do item", async () => {
  const db = usar();
  const guardado = ok(await scriptActions.saveScriptComment({ body: "E o suporte?", kind: "question", personaId: ADRIANO, personaName: "Adriano Souza", sessionId: SESSION }));
  const novo = linhaDoItem(db, guardado.item.id);
  assert.deepEqual([novo.kind, novo.trigger_kind, novo.persona_id, novo.persona_avatar_path], ["question", "manual", ADRIANO, FOTO]);
  assert.equal(guardado.created, false, "a pessoa ja estava na lista");

  const solta = ok(await scriptActions.fireScriptItem({ itemId: guardado.item.id, sessionId: SESSION }));
  assert.deepEqual([solta.message.kind, solta.message.source, solta.message.scriptItemId], ["question", "scripted", guardado.item.id], "o registro de que o item entrou");
  const perguntas = db.tables.webinar_questions.filter((row) => row.message_id === solta.message.id);
  assert.equal(perguntas.length, 1);
  assert.deepEqual(
    [perguntas[0].source, perguntas[0].user_id, perguntas[0].display_name, perguntas[0].persona_id, perguntas[0].persona_avatar_path, perguntas[0].body, perguntas[0].offset_ms],
    ["scripted", null, "Adriano Souza", ADRIANO, FOTO, "E o suporte?", solta.message.offsetMs]
  );
  assert.equal(audits(db, "webinar.script_fired")[0].metadata.question_id, perguntas[0].id);
  // A repeticao (a chave unica do roteiro e o indice unico da pergunta por mensagem) fica com o banco de verdade:
  // tests/integration/webinarios-pessoas.test.mjs.
});

test("o tick da live solta o item Pergunta do minuto: a mensagem do roteiro e a pergunta simulada ligada a ela, com a foto da pessoa", async () => {
  const db = usar();
  const feito = await tick.runLiveScriptTick({ db, now: new Date() });
  assert.equal(feito.released, 1, "so o item Pergunta dos 9 minutos venceu (os 12 minutos ainda nao)");
  const mensagem = db.tables.webinar_chat_messages.find((row) => row.script_item_id === ITENS.pergunta);
  assert.equal(mensagem.kind, "question");
  const [pergunta] = db.tables.webinar_questions.filter((row) => row.message_id === mensagem.id);
  assert.deepEqual([pergunta.source, pergunta.persona_id, pergunta.persona_avatar_path, pergunta.display_name], ["scripted", ADRIANO, FOTO, "Adriano Souza"]);
  assert.equal((await tick.runLiveScriptTick({ db, now: new Date() })).released, 0, "uma vez so");
});

/* ------------------------------------------------------------------------------------------------
 * A leitura: a aba Perguntas do aluno, o voto, o fio e o console
 * ---------------------------------------------------------------------------------------------- */

test("a aba Perguntas do aluno: a simulada com o nome e a foto da pessoa, como a de um aluno, e nunca antes da hora dela; o aluno vota, mas nao responde no fio", async () => {
  const db = usar();
  const agora = perguntaSimulada(db);
  perguntaSimulada(db, { body: "Pergunta do futuro", created_at: iso(Date.now() + 10 * MIN) });
  const lista = await roomQueries.listStudentQuestions(db, { id: SESSION, webinarId: WEBINAR }, ALUNO, "recent");
  assert.deepEqual(lista.map((entry) => entry.body), ["Tem certificado?"], "a de hora futura ainda nao aparece");
  const [vista] = lista;
  assert.deepEqual([vista.displayName, vista.avatarUrl, vista.mine, vista.canReply], ["Adriano Souza", `${ORIGEM}/storage/v1/object/public/content-assets/${FOTO}`, false, false]);
  assert.equal("simulated" in vista, false, "o selo Simulada nunca chega a sala");

  const voto = await roomWrites.voteStudentQuestion({ context: contexto(db), db, questionId: agora.id, userId: ALUNO });
  assert.deepEqual(voto, { upvotes: 1, voted: true }, "a turma pode votar");
  const futura = db.tables.webinar_questions.find((row) => row.body === "Pergunta do futuro");
  await assert.rejects(() => roomWrites.voteStudentQuestion({ context: contexto(db), db, questionId: futura.id, userId: ALUNO }), /Pergunta não encontrada/);

  agora.status = "answered";
  agora.answer_text = "Sim, ao final.";
  await assert.rejects(
    () => roomWrites.replyStudentQuestion({ body: { body: "Obrigado!" }, context: contexto(db), db, questionId: agora.id, userId: ALUNO }),
    (error) => error.status === 403 && error.message === WEBINAR_COPY.salaV2.perguntas.soQuemPerguntou
  );
});

test("o console: a lista de pessoas no retrato, a pergunta simulada marcada (com a foto da pessoa) e o chat sem a mensagem do item Pergunta", async () => {
  const db = usar();
  await tick.runLiveScriptTick({ db, now: new Date() });
  perguntaSimulada(db, { body: "Depois", created_at: iso(Date.now() + 10 * MIN) });
  const retrato = await consoleQueries.getConsoleSnapshot(WEBINAR, SESSION, new Date());
  assert.deepEqual(
    [retrato.personas.available, retrato.personas.personas.map((entry) => [entry.id, entry.name, entry.avatarPath])],
    [true, [[ADRIANO, "Adriano Souza", FOTO]]]
  );
  assert.equal(retrato.scriptItems.find((entry) => entry.id === ITENS.dele).personaId, ADRIANO, "o item com a pessoa");
  assert.ok(ITENS.pergunta in retrato.scriptFired, "o item Pergunta conta como entrou");
  assert.equal(retrato.messages.some((entry) => entry.scriptItemId === ITENS.pergunta), false, "a mensagem do item Pergunta fora do chat");
  assert.deepEqual(
    retrato.questions.map((entry) => [entry.body, entry.simulated, entry.avatarUrl]),
    [["Quanto custa o curso?", true, `${ORIGEM}/storage/v1/object/public/content-assets/${FOTO}`]],
    "a de hora futura ainda nao"
  );
  // No Replay, sem lista.
  const replay = await consoleQueries.getConsoleSnapshot(WEBINAR, "cccccccc-0000-4000-8000-000000000004", new Date());
  assert.equal(replay?.personas?.available ?? false, false);
});
