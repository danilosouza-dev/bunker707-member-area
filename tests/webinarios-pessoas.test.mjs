import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { MIN, OTHER_WEBINAR, SESSION, WEBINAR, bancoFalso, escola, iso } from "./support/webinarios-sala-banco.mjs";

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
//   mensagem do item Pergunta;
// - as correcoes da revisao v8: importar o CSV liga e cria as pessoas (e a corrida de duas importacoes reaproveita a
//   que entrou; achado 3); a lista com mais de 1.000 pessoas vem inteira no Salvar e na edicao, e a pessoa que a leitura
//   nao trouxe e buscada pelo id (achado 4);
// - a lista da escola (pedido do produtor de 13/11/2026; docs/30 D117): a pessoa criada noutro webinario aparece aqui,
//   o nome dela e recusado aqui, o roteiro, o Novo comentário e a importacao usam a pessoa de outro webinario, e remover
//   daqui tira de todos (pelo webinario de onde a equipe remove, que confere o arquivado).

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
const personaStore = await import("../src/server/webinars/persona-store.ts");
const { clearScriptedAvatarCache } = personaStore;
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
  db.tables.webinars.find((row) => row.id === WEBINAR).status = "archived";
  assert.equal((await personaActions.deletePersona({ id: ADRIANO, webinarId: WEBINAR })).status, 409, "do arquivado, so de leitura");
  assert.equal(db.tables.webinar_personas.length, 1, "nada saiu");
  db.tables.webinars.find((row) => row.id === WEBINAR).status = "published";
  assert.equal((await personaActions.deletePersona({ id: ADRIANO })).status, 400, "sem o webinario de onde a equipe remove");
  const removida = ok(await personaActions.deletePersona({ id: ADRIANO, webinarId: WEBINAR }));
  assert.deepEqual(removida, { id: ADRIANO, items: 3 });
  assert.equal(db.tables.webinar_personas.length, 0);
  for (const id of [ITENS.dele, ITENS.tambem, ITENS.pergunta]) {
    const linha = linhaDoItem(db, id);
    assert.deepEqual([linha.persona_id, linha.persona_name, linha.persona_avatar_path], [null, "Adriano Souza", FOTO], id);
  }
  const [auditoria] = audits(db, "webinar.persona_removed");
  assert.deepEqual([auditoria.entity_id, auditoria.metadata], [WEBINAR, { items: 3, persona_id: ADRIANO }]);
  assert.equal((await personaActions.deletePersona({ id: ADRIANO, webinarId: WEBINAR })).status, 404, "de novo: ja saiu");
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

/* ------------------------------------------------------------------------------------------------
 * Correcoes da revisao v8 (11/11/2026): a importacao do CSV e a lista com mais de 1.000 pessoas
 * ---------------------------------------------------------------------------------------------- */

test("revisao v8, achado 3: importar o CSV liga cada linha a pessoa com o mesmo nome (com a copia dela) e o nome que falta entra na lista (o papel da primeira linha, sem foto)", async () => {
  const db = usar();
  const csv = ["Tempo;Nome;Papel;Mensagem", "12;adriano   SOUZA;Equipe;Oi de novo", "12:30;Lia M.;Equipe;Bem-vindos", "13;lia  m.;Aluno;Mais uma"].join("\n");
  const importado = ok(await scriptActions.importScriptCsv({ csv, webinarId: WEBINAR }));
  assert.equal(importado.imported, 3);

  assert.equal(db.tables.webinar_personas.length, 2, "so a Lia entrou; o Adriano ja estava");
  const lia = db.tables.webinar_personas.find((row) => row.name === "Lia M.");
  assert.deepEqual([lia.role, lia.avatar_path, lia.created_by, lia.webinar_id], ["team", null, EQUIPE, WEBINAR], "o papel da primeira linha dela, sem foto");

  const novos = importado.items.slice(-3);
  assert.deepEqual(
    novos.map((entry) => [entry.personaId, entry.personaName, entry.personaRole, entry.personaAvatarPath]),
    [
      [ADRIANO, "Adriano Souza", "student", FOTO],
      [lia.id, "Lia M.", "team", null],
      [lia.id, "Lia M.", "team", null]
    ],
    "a copia da pessoa da lista, nunca \"(fora da lista)\""
  );
  for (const entry of novos) {
    assert.equal(linhaDoItem(db, entry.id).persona_id, entry.personaId, "a ligacao gravada no banco");
  }
  assert.equal(linhaDoItem(db, ITENS.outro).persona_id, null, "os itens que ja estavam nao mudam");
  const [auditoria] = audits(db, "webinar.script_imported");
  assert.equal(auditoria.metadata.personas_created, 1);
  assert.doesNotMatch(JSON.stringify(auditoria), /Lia/, "a auditoria so conta");

  // De novo, substituindo: ninguem entra outra vez na lista.
  ok(await scriptActions.importScriptCsv({ csv, replace: true, webinarId: WEBINAR }));
  assert.equal(db.tables.webinar_personas.length, 2);
  assert.ok(db.tables.webinar_chat_script_items.every((row) => row.persona_id !== null));
});

test("revisao v8, achado 3: duas importacoes ao mesmo tempo com o mesmo nome novo: a segunda reaproveita a pessoa que a primeira gravou (o indice unico do nome)", async () => {
  const db = usar();
  const OUTRA_IMPORTACAO = "eeeeeeee-0000-4000-8000-0000000000a9";
  // A outra importacao grava "LIA m." entre a leitura da lista e a gravacao desta.
  const from = db.from.bind(db);
  let primeira = true;
  db.from = (name) => {
    const chain = from(name);
    if (name === "webinar_personas") {
      const insert = chain.insert;
      chain.insert = (payload) => {
        if (primeira) {
          primeira = false;
          db.tables.webinar_personas.push({ avatar_path: null, created_at: iso(Date.now()), created_by: null, id: OUTRA_IMPORTACAO, name: "LIA m.", role: "student", updated_at: iso(Date.now()), webinar_id: WEBINAR });
        }
        return insert(payload);
      };
    }
    return chain;
  };

  const importado = ok(await scriptActions.importScriptCsv({ csv: ["Tempo;Nome;Papel;Mensagem", "12;Lia M.;Equipe;Oi", "13;Rui P.;Aluno;Ola"].join("\n"), webinarId: WEBINAR }));
  const rui = db.tables.webinar_personas.find((row) => row.name === "Rui P.");
  assert.ok(rui, "o lote recusado cai para uma por vez, e o Rui entra");
  assert.deepEqual(
    db.tables.webinar_personas.map((row) => row.name).sort(),
    ["Adriano Souza", "LIA m.", "Rui P."],
    "uma Lia so"
  );
  assert.deepEqual(
    importado.items.slice(-2).map((entry) => [entry.personaId, entry.personaName, entry.personaRole]),
    [
      [OUTRA_IMPORTACAO, "LIA m.", "student"],
      [rui.id, "Rui P.", "student"]
    ]
  );
  assert.equal(audits(db, "webinar.script_imported")[0].metadata.personas_created, 1);
});

/** O webinario com 1.005 pessoas na lista (a "Zuleica" por ultimo, pelo nome: fora das 1.000 primeiras). */
function comMilPessoas() {
  const tables = cenario();
  for (let index = 0; index < 1004; index += 1) {
    tables.webinar_personas.push({ avatar_path: null, created_at: iso(Date.now() - 60 * MIN), created_by: null, id: `eeeeeeee-1111-4000-8000-${String(index).padStart(12, "0")}`, name: `Pessoa ${String(index).padStart(4, "0")}`, role: "student", updated_at: iso(Date.now() - 60 * MIN), webinar_id: WEBINAR });
  }
  const ZULEICA = "eeeeeeee-1111-4000-8000-999999999999";
  tables.webinar_personas.push({ avatar_path: OUTRA_FOTO, created_at: iso(Date.now() - 60 * MIN), created_by: null, id: ZULEICA, name: "Zuleica T.", role: "team", updated_at: iso(Date.now() - 60 * MIN), webinar_id: WEBINAR });
  return { ZULEICA, tables };
}

test("revisao v8, achado 4: a lista com mais de 1.000 pessoas vem inteira; o Salvar roteiro nao solta o item da 1.005a e a edicao dela nao volta 404", async () => {
  const { ZULEICA, tables } = comMilPessoas();
  const db = usar(tables);
  const lista = await personaStore.listPersonas(db);
  assert.equal(lista.personas.length, 1006, "o Adriano, as 1.004 e a Zuleica, apesar do teto de 1.000 do PostgREST");
  assert.equal(lista.personas.at(-1).id, ZULEICA);

  // O Salvar do editor com um item ligado a Zuleica: a ligacao e a copia dela ficam.
  const base = { body: "Oi, gente", kind: "message", offsetMs: 2 * MIN, phrase: null, phraseDelayMs: 0, status: "draft", triggerKind: "at_offset" };
  const salvo = ok(await scriptActions.saveScriptItems({ items: [{ ...base, personaId: ZULEICA, personaName: "Zuleica T.", personaRole: "team" }], loadedIds: [], webinarId: WEBINAR }));
  const daZuleica = salvo.items.find((entry) => entry.body === "Oi, gente");
  assert.deepEqual([daZuleica.personaId, daZuleica.personaName, daZuleica.personaRole, daZuleica.personaAvatarPath], [ZULEICA, "Zuleica T.", "team", OUTRA_FOTO]);

  // Editar a Zuleica: nunca 404.
  const editada = ok(await personaActions.savePersona({ avatarPath: null, id: ZULEICA, name: "Zuleica Torres", role: "team", webinarId: WEBINAR }));
  assert.deepEqual([editada.created, editada.items, editada.persona.name], [false, 1, "Zuleica Torres"]);
  // O nome repetido de uma pessoa de depois das 1.000 primeiras tambem e conferido.
  const repetida = await personaActions.savePersona({ avatarPath: null, name: "ZULEICA  torres", role: "student", webinarId: WEBINAR });
  assert.deepEqual([repetida.status, repetida.fieldErrors?.name?.[0]], [400, PESSOAS.erros.nomeRepetido]);

  // O Duplicar nao copia mais a lista (D117): ela e da escola, e a copia ja enxerga todas.
  assert.equal(personaStore.copyPersonasToWebinar, undefined);
});

test("D117 a lista da escola: a pessoa criada noutro webinario aparece aqui; o nome dela e recusado aqui; o roteiro, o Novo comentário e a importacao a usam; editar troca a copia nos dois roteiros", async () => {
  const tables = cenario();
  const BIA = "eeeeeeee-0000-4000-8000-0000000000b9";
  const DO_OUTRO = "dddddddd-0000-4000-8000-0000000000c9";
  tables.webinar_personas.push({ avatar_path: OUTRA_FOTO, created_at: iso(Date.now() - 30 * MIN), created_by: null, id: BIA, name: "Bia Costa", role: "team", updated_at: iso(Date.now() - 30 * MIN), webinar_id: OTHER_WEBINAR });
  tables.webinar_chat_script_items.push(item(DO_OUTRO, { persona_avatar_path: OUTRA_FOTO, persona_id: BIA, persona_name: "Bia Costa", persona_role: "team", position: 0, webinar_id: OTHER_WEBINAR }));
  const db = usar(tables);

  // A lista e uma so: a Bia, criada na outra live, aparece aqui (no editor e no console).
  const lista = await personaStore.listPersonas(db);
  assert.deepEqual(lista.personas.map((entry) => [entry.name, entry.webinarId]), [["Adriano Souza", WEBINAR], ["Bia Costa", OTHER_WEBINAR]]);
  const retrato = await consoleQueries.loadConsoleSnapshot(db, { kind: "live", now: new Date(), session: db.tables.webinar_sessions.find((row) => row.id === SESSION) });
  assert.deepEqual(retrato.personas.personas.map((entry) => entry.name), ["Adriano Souza", "Bia Costa"], "o console desta live tambem ve a Bia");

  // O nome dela e da escola: repetido aqui volta no campo Nome, e a pessoa nova guarda esta live como origem.
  const repetida = await personaActions.savePersona({ avatarPath: null, name: "BIA  costa", role: "student", webinarId: WEBINAR });
  assert.deepEqual([repetida.status, repetida.fieldErrors?.name?.[0]], [400, PESSOAS.erros.nomeRepetido]);
  const nova = ok(await personaActions.savePersona({ avatarPath: null, name: "Caio D.", role: "student", webinarId: WEBINAR }));
  assert.equal(db.tables.webinar_personas.find((row) => row.id === nova.persona.id).webinar_id, WEBINAR, "a origem");

  // O roteiro desta live liga o item a Bia, com a copia dela.
  const base = { body: "Bem-vindos!", kind: "message", offsetMs: 2 * MIN, phrase: null, phraseDelayMs: 0, status: "draft", triggerKind: "at_offset" };
  const salvo = ok(await scriptActions.saveScriptItems({ items: [{ ...base, personaId: BIA, personaName: "Bia Costa", personaRole: "team" }], loadedIds: [], webinarId: WEBINAR }));
  const daBia = salvo.items.find((entry) => entry.body === "Bem-vindos!");
  assert.deepEqual([daBia.personaId, daBia.personaName, daBia.personaRole, daBia.personaAvatarPath], [BIA, "Bia Costa", "team", OUTRA_FOTO]);

  // O Novo comentário do console desta live com a Bia (antes: "Essa pessoa nao esta mais na lista").
  const enviado = ok(await scriptActions.sendScriptedComment({ body: "Oi, turma", kind: "message", personaId: BIA, personaName: "Bia Costa", sessionId: SESSION }));
  assert.deepEqual([enviado.created, enviado.persona.id], [false, BIA]);

  // A importacao do CSV liga a linha com o nome dela a Bia, sem criar outra.
  const csv = "Tempo;Nome;Papel;Mensagem\n5;bia costa;Aluno;Cheguei!";
  const importado = ok(await scriptActions.importScriptCsv({ csv, replace: false, webinarId: WEBINAR }));
  assert.equal(importado.items.find((entry) => entry.body === "Cheguei!").personaId, BIA);
  assert.equal(db.tables.webinar_personas.filter((row) => row.name_key === "bia costa" || /bia costa/i.test(row.name)).length, 1, "uma Bia so");

  // Editar a Bia daqui troca a copia nos roteiros das duas lives.
  const editada = ok(await personaActions.savePersona({ avatarPath: null, id: BIA, name: "Bia C.", role: "team", webinarId: WEBINAR }));
  assert.ok(editada.items >= 3, "o item da outra live e os dois desta");
  for (const row of db.tables.webinar_chat_script_items.filter((entry) => entry.persona_id === BIA)) {
    assert.deepEqual([row.persona_name, row.persona_avatar_path], ["Bia C.", null], row.webinar_id);
  }
  assert.ok(db.tables.webinar_chat_script_items.some((entry) => entry.persona_id === BIA && entry.webinar_id === OTHER_WEBINAR), "a outra live tambem");

  // Remover daqui tira de todos: o item da outra live fica com a copia, fora da lista.
  ok(await personaActions.deletePersona({ id: BIA, webinarId: WEBINAR }));
  const doOutro = linhaDoItem(db, DO_OUTRO);
  assert.deepEqual([doOutro.persona_id, doOutro.persona_name], [null, "Bia C."]);
});

test("revisao v8, achado 4: a pessoa que a leitura da lista nao trouxe (entrou depois dela) e buscada pelo id, nunca solta o item", async () => {
  const db = usar();
  const NOVA = "eeeeeeee-2222-4000-8000-000000000001";
  // A lista lida pelo Salvar ainda nao tem a Nina (outra aba a criou logo depois da leitura).
  const from = db.from.bind(db);
  let leituras = 0;
  db.from = (name) => {
    const chain = from(name);
    if (name === "webinar_personas") {
      const range = chain.range;
      chain.range = (start, end) => {
        const paged = range(start, end);
        const then = paged.then;
        // Depois que a primeira leitura da lista respondeu, a Nina entra.
        paged.then = (resolve, reject) =>
          then((value) => {
            leituras += 1;
            if (leituras === 1) {
              db.tables.webinar_personas.push({ avatar_path: FOTO, created_at: iso(Date.now()), created_by: null, id: NOVA, name: "Nina R.", role: "team", updated_at: iso(Date.now()), webinar_id: WEBINAR });
            }
            return resolve(value);
          }, reject);
        return paged;
      };
    }
    return chain;
  };
  // A pagina do roteiro ja leva o item com a Nina (o editor dela a escolheu na outra aba, que ja tinha a lista nova).
  const base = { body: "Chegou a Nina", kind: "message", offsetMs: 3 * MIN, phrase: null, phraseDelayMs: 0, status: "draft", triggerKind: "at_offset" };
  const salvo = ok(await scriptActions.saveScriptItems({ items: [{ ...base, personaId: NOVA, personaName: "Nina R.", personaRole: "team" }], loadedIds: [], webinarId: WEBINAR }));
  const daNina = salvo.items.find((entry) => entry.body === "Chegou a Nina");
  assert.deepEqual([daNina.personaId, daNina.personaAvatarPath], [NOVA, FOTO]);
  assert.ok(
    db.calls.reads.some((read) => read.table === "webinar_personas" && read.filters.some(([op, column, value]) => op === "in" && column === "id" && value.includes(NOVA))),
    "a Nina foi buscada pelo id"
  );
  // Uma pessoa que nao existe (ou de outro webinario) continua soltando o item, com a copia enviada.
  const sumida = ok(await scriptActions.saveScriptItems({ items: [{ ...base, body: "Sem pessoa", personaId: "eeeeeeee-2222-4000-8000-0000000000ff", personaName: "Ninguem", personaRole: "student" }], loadedIds: [], webinarId: WEBINAR }));
  assert.equal(sumida.items.find((entry) => entry.body === "Sem pessoa").personaId, null);
});
