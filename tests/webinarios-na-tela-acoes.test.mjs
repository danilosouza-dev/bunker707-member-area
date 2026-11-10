import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { MIN, REPLAY, SESSION, WEBINAR, bancoFalso, escola, iso } from "./support/webinarios-sala-banco.mjs";

// As Server Actions da "Na tela" (docs/30 §2.4; especificacao de 10/11/2026, §5.3 e §9), sem banco: o banco falso das
// rotas da Sala (tests/support/webinarios-sala-banco.mjs: as tabelas como listas, os filtros do PostgREST e cada escrita
// anotada em `calls.writes`, na ordem) com a escola de mentira (uma Live gravada no ar). A permissao e a sessao da
// equipe sao dubles; "next/cache" so anota. Aqui:
// - R1, o "Fixar ao enviar" (sendTeamMessage com `pin`): publica e fixa num passo, deixa exatamente uma fixada (a de
//   antes perde o pinned_at), grava a linha da sessao POR ULTIMO (o carimbo que a consulta de 5 s da sala compara) e a
//   auditoria leva `pinned: true`; sem `pin`, nada muda na sessao; numa sessao encerrada, cancelada ou no Replay, 409 e
//   nada gravado; desafixar continua permitido na sessao encerrada.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const estado = (globalThis.__naTelaAcoes ??= { negar: false, revalidados: [] });
const EQUIPE = "00000000-0000-4000-8000-0000000000e1";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole() {
          if (globalThis.__naTelaAcoes.negar) {
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
        export function revalidatePath(path) { globalThis.__naTelaAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__naTelaAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__naTelaAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "equipe.teste@bunker707.test", id: EQUIPE, user_metadata: { full_name: "Equipe de Teste" } } };

const roomActions = await import("../src/server/webinars/room-actions.ts");

/* ------------------------------------------------------------------------------------------------
 * Cenario: a escola de mentira com a sessao da Live gravada no ar e uma encerrada
 * ---------------------------------------------------------------------------------------------- */

const ENCERRADA = "cccccccc-0000-4000-8000-0000000000e2";
const CANCELADA = "cccccccc-0000-4000-8000-0000000000e3";
const ALUNA = "11111111-1111-4111-8111-111111111111";

function cenario() {
  const tables = escola();
  const now = Date.now();
  const noAr = tables.webinar_sessions.find((row) => row.id === SESSION);
  Object.assign(noAr, { started_at: iso(now - 10 * MIN), status: "live" });
  tables.webinar_sessions.push(
    { ...noAr, ended_at: iso(now - 30 * MIN), id: ENCERRADA, scheduled_at: iso(now - 2 * 60 * MIN), started_at: iso(now - 2 * 60 * MIN), status: "ended" },
    { ...noAr, id: CANCELADA, scheduled_at: iso(now + 60 * MIN), started_at: null, status: "cancelled" }
  );
  tables.admin_audit_log = [];
  tables.webinar_presenters = [];
  return tables;
}

function usar(tables = cenario()) {
  const db = bancoFalso({ tables });
  actionStubs.db = db;
  estado.negar = false;
  estado.revalidados.length = 0;
  return db;
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

const audits = (db, action) => db.tables.admin_audit_log.filter((row) => row.action === action);
const sessao = (db, id = SESSION) => db.tables.webinar_sessions.find((row) => row.id === id);
const mensagem = (db, id) => db.tables.webinar_chat_messages.find((row) => row.id === id);
const fixadas = (db, sessionId = SESSION) => db.tables.webinar_chat_messages.filter((row) => row.session_id === sessionId && row.pinned_at);
/** As escritas do teste (sem a auditoria), na ordem, como "op tabela". */
const escritas = (db, desde = 0) =>
  db.calls.writes
    .slice(desde)
    .filter((write) => write.table !== "admin_audit_log")
    .map((write) => `${write.op} ${write.table}`);

function linhaDoChat(extra = {}) {
  return {
    approved: true,
    approved_at: null,
    approved_by: null,
    author_user_id: ALUNA,
    body: "Boa noite!",
    created_at: iso(Date.now() - 5 * MIN),
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    display_name: "Bia C.",
    id: randomUUID(),
    kind: "message",
    master: false,
    offset_ms: 300_000,
    pinned_at: null,
    reply_to_id: null,
    role: "student",
    script_item_id: null,
    session_id: SESSION,
    source: "audience",
    webinar_id: WEBINAR,
    ...extra
  };
}

/* ------------------------------------------------------------------------------------------------
 * R1: o "Fixar ao enviar"
 * ---------------------------------------------------------------------------------------------- */

test("Fixar ao enviar: publica e fixa num passo, troca a fixada de antes (exatamente uma por sessao), grava a sessao por ultimo e audita pinned: true", async () => {
  const tables = cenario();
  const antiga = linhaDoChat({ author_user_id: EQUIPE, body: "Fixada de antes", display_name: "Equipe T.", pinned_at: iso(Date.now() - 4 * MIN), role: "team", source: "team" });
  tables.webinar_chat_messages.push(antiga);
  tables.webinar_sessions.find((row) => row.id === SESSION).pinned_message_id = antiga.id;
  const db = usar(tables);
  const antes = db.calls.writes.length;

  const enviada = ok(await roomActions.sendTeamMessage({ body: "Link da aula: https://exemplo.com/aula", pin: true, sessionId: SESSION }));

  assert.equal(enviada.message.source, "team");
  assert.ok(enviada.message.pinnedAt, "a mensagem devolvida ja vem fixada");
  assert.equal(sessao(db).pinned_message_id, enviada.message.id, "a sessao aponta a mensagem nova");
  assert.deepEqual(
    fixadas(db).map((row) => row.id),
    [enviada.message.id],
    "exatamente uma fixada: a de antes perdeu o pinned_at"
  );
  assert.equal(mensagem(db, antiga.id).pinned_at, null);
  // A ordem: a mensagem nasce, ganha o pinned_at, a de antes perde o dela e a linha da sessao (o carimbo) vem por ultimo.
  assert.deepEqual(escritas(db, antes), ["insert webinar_chat_messages", "update webinar_chat_messages", "update webinar_chat_messages", "update webinar_sessions"]);
  const carimbo = db.calls.writes.filter((write) => write.table === "webinar_sessions").at(-1);
  assert.deepEqual(carimbo.payload, { pinned_message_id: enviada.message.id }, "so a fixada muda na sessao");

  const [auditoria] = audits(db, "webinar.team_message");
  assert.equal(auditoria.metadata.pinned, true, "a auditoria diz que a mensagem foi fixada");
  assert.equal(auditoria.metadata.message_id, enviada.message.id);
  assert.doesNotMatch(JSON.stringify(db.tables.admin_audit_log), /exemplo\.com/, "o texto nunca vai para a auditoria");
});

test("Fixar ao enviar duas vezes seguidas: a segunda troca a primeira e continua uma so; sem pin, nada muda na fixada nem na sessao", async () => {
  const db = usar();

  const primeira = ok(await roomActions.sendTeamMessage({ body: "Primeira", pin: true, sessionId: SESSION }));
  const segunda = ok(await roomActions.sendTeamMessage({ body: "Segunda", pin: true, sessionId: SESSION }));
  assert.deepEqual(
    fixadas(db).map((row) => row.id),
    [segunda.message.id]
  );
  assert.equal(mensagem(db, primeira.message.id).pinned_at, null);
  assert.equal(sessao(db).pinned_message_id, segunda.message.id);

  const antes = db.calls.writes.length;
  const comum = ok(await roomActions.sendTeamMessage({ body: "Sem fixar", sessionId: SESSION }));
  assert.equal(comum.message.pinnedAt, null);
  assert.equal(sessao(db).pinned_message_id, segunda.message.id, "a fixada continua a mesma");
  assert.deepEqual(escritas(db, antes), ["insert webinar_chat_messages"], "sem pin, so a mensagem e gravada");
  assert.deepEqual(
    audits(db, "webinar.team_message").map((row) => row.metadata.pinned),
    [true, true, false]
  );
});

test("Fixar ao enviar numa sessao encerrada, cancelada ou no Replay: 409 e nada gravado (nem a mensagem, nem a fixada); desafixar na encerrada continua", async () => {
  const tables = cenario();
  const antiga = linhaDoChat({ author_user_id: EQUIPE, body: "Fixada da encerrada", pinned_at: iso(Date.now() - 40 * MIN), role: "team", session_id: ENCERRADA, source: "team" });
  tables.webinar_chat_messages.push(antiga);
  tables.webinar_sessions.find((row) => row.id === ENCERRADA).pinned_message_id = antiga.id;
  const db = usar(tables);
  const antes = db.calls.writes.length;

  for (const sessionId of [ENCERRADA, CANCELADA, REPLAY]) {
    const recusada = await roomActions.sendTeamMessage({ body: "Tarde demais", pin: true, sessionId });
    assert.deepEqual([recusada.ok, recusada.status], [false, 409], `recusada em ${sessionId}`);
  }
  assert.deepEqual(escritas(db, antes), [], "nada gravado");
  assert.equal(sessao(db, ENCERRADA).pinned_message_id, antiga.id, "a fixada de antes continua");

  // Fixar pela linha (o mesmo Fixar) tambem recusa na encerrada; desafixar continua sempre permitido.
  const outra = linhaDoChat({ session_id: ENCERRADA });
  db.tables.webinar_chat_messages.push(outra);
  const fixar = await roomActions.moderateMessage({ action: "pin", messageId: outra.id });
  assert.deepEqual([fixar.ok, fixar.status], [false, 409]);
  const desafixada = ok(await roomActions.moderateMessage({ action: "unpin", messageId: antiga.id }));
  assert.equal(desafixada.pinnedMessageId, null);
  assert.equal(sessao(db, ENCERRADA).pinned_message_id, null);
  assert.equal(audits(db, "webinar.team_message").length, 0);
});

test("Fixar pela linha e Fixar ao enviar usam a mesma rotina: a fixada pela linha e trocada pela enviada, e a enviada pela linha", async () => {
  const tables = cenario();
  const daAluna = linhaDoChat();
  tables.webinar_chat_messages.push(daAluna);
  const db = usar(tables);

  ok(await roomActions.moderateMessage({ action: "pin", messageId: daAluna.id }));
  const antes = db.calls.writes.length;
  const enviada = ok(await roomActions.sendTeamMessage({ body: "Agora esta", pin: true, sessionId: SESSION }));
  assert.deepEqual(escritas(db, antes), ["insert webinar_chat_messages", "update webinar_chat_messages", "update webinar_chat_messages", "update webinar_sessions"]);
  assert.deepEqual(
    fixadas(db).map((row) => row.id),
    [enviada.message.id]
  );

  const deNovo = db.calls.writes.length;
  ok(await roomActions.moderateMessage({ action: "pin", messageId: daAluna.id }));
  assert.deepEqual(escritas(db, deNovo), ["update webinar_chat_messages", "update webinar_chat_messages", "update webinar_sessions"], "a mensagem, a de antes e a sessao por ultimo");
  assert.deepEqual(
    fixadas(db).map((row) => row.id),
    [daAluna.id]
  );
  assert.equal(sessao(db).pinned_message_id, daAluna.id);
});

test("sem permissão: o Fixar ao enviar responde 403 sem tocar no banco", async () => {
  const db = usar();
  estado.negar = true;
  const result = await roomActions.sendTeamMessage({ body: "oi", pin: true, sessionId: SESSION });
  assert.deepEqual([result.ok, result.status], [false, 403]);
  assert.equal(db.calls.from.length, 0);
  estado.negar = false;
});
