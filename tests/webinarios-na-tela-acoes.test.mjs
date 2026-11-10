import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { DEFAULTS, MIN, REPLAY, SESSION, UNIQUE, WEBINAR, bancoFalso, escola, iso } from "./support/webinarios-sala-banco.mjs";

// As Server Actions da "Na tela" (docs/30 §2.4; especificacao de 10/11/2026, §5.3 e §9), sem banco: o banco falso das
// rotas da Sala (tests/support/webinarios-sala-banco.mjs: as tabelas como listas, os filtros do PostgREST e cada escrita
// anotada em `calls.writes`, na ordem) com a escola de mentira (uma Live gravada no ar). A permissao e a sessao da
// equipe sao dubles; "next/cache" so anota. Aqui:
// - R1, o "Fixar ao enviar" (sendTeamMessage com `pin`): publica e fixa num passo, deixa exatamente uma fixada (a de
//   antes perde o pinned_at), grava a linha da sessao POR ULTIMO (o carimbo que a consulta de 5 s da sala compara) e a
//   auditoria leva `pinned: true`; sem `pin`, nada muda na sessao; numa sessao encerrada, cancelada ou no Replay, 409 e
//   nada gravado; desafixar continua permitido na sessao encerrada;
// - R2, a enquete fixada (a exibicao `poll` de webinar_screen_displays): pinPoll fixa uma copia desta sessao aberta ou
//   encerrada com o resultado compartilhado (a fixada de antes sai como `replaced`, a mesma de novo nao grava nada),
//   com a copia { v: 1, name: pergunta } e a sessao atualizada por ultimo; unpinPoll tira (`team`); o "Abrir e fixar"
//   (launchPoll com `pin`) abre e fixa; o Encerrar sem compartilhar desafixa (`poll_closed`) e com o resultado
//   compartilhado mantem; Replay, sessao encerrada ou cancelada: 409 e nada gravado; o conflito do indice unico
//   (outra pessoa fixou entre o tirar e o gravar) tenta uma vez mais, e na segunda vez responde 409; banco sem a
//   202611100002: 409 com o aviso da migracao antes de qualquer escrita, e o Encerrar segue sem desafixar.

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
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { pollPinnable } = await import("../src/server/webinars/screen-model.ts");

// O indice unico parcial da 202611100002 (uma exibicao ativa por tipo e sessao: hidden_at nulo) no banco falso.
UNIQUE.webinar_screen_displays = [["session_id", "kind", "hidden_at"]];
DEFAULTS.webinar_screen_displays = { hidden_at: null, hidden_by: null, hidden_offset_ms: null, hidden_reason: null, item_id: null, poll_id: null, shown_offset_ms: null };

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

/* ------------------------------------------------------------------------------------------------
 * R2: a enquete fixada
 * ---------------------------------------------------------------------------------------------- */

const MODELO = "dddddddd-0000-4000-8000-000000000001";
const ABERTA = "dddddddd-0000-4000-8000-000000000002";
const OUTRA_ABERTA = "dddddddd-0000-4000-8000-000000000003";
const COMPARTILHADA = "dddddddd-0000-4000-8000-000000000004";
const ENCERRADA_SEM = "dddddddd-0000-4000-8000-000000000005";
const DA_ENCERRADA = "dddddddd-0000-4000-8000-000000000006";
const DO_REPLAY = "dddddddd-0000-4000-8000-000000000007";

function enquete(id, extra = {}) {
  return {
    anonymous: false,
    closed_at: null,
    created_at: iso(Date.now() - 30 * MIN),
    created_by: EQUIPE,
    id,
    kind: "single",
    open_offset_ms: null,
    opened_at: iso(Date.now() - 5 * MIN),
    position: 0,
    question: `Pergunta ${id.slice(-1)}?`,
    results_shared_at: null,
    session_id: SESSION,
    status: "open",
    template_poll_id: MODELO,
    updated_at: iso(Date.now() - 5 * MIN),
    webinar_id: WEBINAR,
    ...extra
  };
}

const opcoes = (pollId) => [
  { created_at: iso(Date.now() - 30 * MIN), id: randomUUID(), label: "Sim", poll_id: pollId, position: 0 },
  { created_at: iso(Date.now() - 30 * MIN), id: randomUUID(), label: "Não", poll_id: pollId, position: 1 }
];

function cenarioDasEnquetes() {
  const tables = cenario();
  const fechada = iso(Date.now() - 2 * MIN);
  tables.webinar_polls = [
    enquete(MODELO, { opened_at: null, question: "Vem na próxima?", session_id: null, status: "draft", template_poll_id: null }),
    enquete(ABERTA, { question: "Gostou da aula?" }),
    enquete(OUTRA_ABERTA, { question: "Quer o material?" }),
    enquete(COMPARTILHADA, { closed_at: fechada, results_shared_at: fechada, status: "closed" }),
    enquete(ENCERRADA_SEM, { closed_at: fechada, status: "closed" }),
    enquete(DA_ENCERRADA, { session_id: ENCERRADA }),
    enquete(DO_REPLAY, { session_id: REPLAY })
  ];
  tables.webinar_poll_options = tables.webinar_polls.flatMap((poll) => opcoes(poll.id));
  tables.webinar_screen_displays = [];
  return tables;
}

/** As exibicoes `poll` ativas de uma sessao (o que a turma ve fixado). */
const fixadasDaTela = (db, sessionId = SESSION) => db.tables.webinar_screen_displays.filter((row) => row.session_id === sessionId && row.kind === "poll" && row.hidden_at === null);
const exibicao = (db, id) => db.tables.webinar_screen_displays.find((row) => row.id === id);

/** Outra pessoa da equipe fixa outra enquete logo depois de cada um dos proximos `vezes` "tirar da tela" (a corrida). */
function comConcorrente(db, vezes) {
  const from = db.from;
  let restantes = vezes;
  db.from = (name) => {
    const chain = from(name);
    if (name !== "webinar_screen_displays") {
      return chain;
    }
    let atualiza = false;
    const update = chain.update;
    chain.update = (payload) => {
      atualiza = true;
      return update(payload);
    };
    const then = chain.then;
    chain.then = (resolve, reject) =>
      then((value) => {
        if (atualiza && restantes > 0) {
          restantes -= 1;
          db.tables.webinar_screen_displays.push({
            created_at: iso(Date.now()),
            hidden_at: null,
            hidden_by: null,
            hidden_offset_ms: null,
            hidden_reason: null,
            id: randomUUID(),
            item_id: null,
            kind: "poll",
            poll_id: OUTRA_ABERTA,
            session_id: SESSION,
            shown_at: iso(Date.now()),
            shown_by: "00000000-0000-4000-8000-0000000000e9",
            shown_offset_ms: 0,
            snapshot: { name: "Quer o material?", v: 1 }
          });
        }
        return value;
      }, reject).then(resolve, reject);
    return chain;
  };
  return db;
}

/** O banco sem a 202611100002: toda consulta a webinar_screen_displays responde "a tabela nao existe". */
function semMigracao(db) {
  const from = db.from;
  const semTabela = () => {
    const chain = new Proxy(
      {},
      {
        get: (_target, property) =>
          property === "then"
            ? (resolve, reject) => Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "public.webinar_screen_displays" does not exist' } }).then(resolve, reject)
            : () => chain
      }
    );
    return chain;
  };
  db.from = (name) => {
    db.calls.from.push(name);
    return name === "webinar_screen_displays" ? semTabela() : from(name);
  };
  return db;
}

test("pollPinnable: so a copia da sessao, aberta ou encerrada com o resultado compartilhado (o que a turma ve)", () => {
  assert.equal(pollPinnable({ resultsSharedAt: null, sessionId: SESSION, status: "open" }), true);
  assert.equal(pollPinnable({ resultsSharedAt: iso(Date.now()), sessionId: SESSION, status: "closed" }), true);
  assert.equal(pollPinnable({ resultsSharedAt: null, sessionId: SESSION, status: "closed" }), false, "encerrada sem compartilhar");
  assert.equal(pollPinnable({ resultsSharedAt: null, sessionId: null, status: "draft" }), false, "o modelo");
  assert.equal(pollPinnable({ resultsSharedAt: null, sessionId: SESSION, status: "draft" }), false);
});

test("Fixar a enquete: a exibicao poll com a copia da pergunta, quem e quando, a sessao por ultimo e a auditoria; outra enquete troca (replaced) e continua uma so; a mesma de novo nao grava nada", async () => {
  const db = usar(cenarioDasEnquetes());
  const antes = db.calls.writes.length;

  const fixada = ok(await roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION }));
  assert.equal(fixada.changed, true);
  assert.deepEqual(escritas(db, antes), ["update webinar_screen_displays", "insert webinar_screen_displays", "update webinar_sessions"], "tira a de antes, grava a nova e o carimbo por ultimo");
  const carimbo = db.calls.writes.filter((write) => write.table === "webinar_sessions").at(-1);
  assert.deepEqual(Object.keys(carimbo.payload), ["updated_at"], "so o carimbo muda na sessao");
  const linha = exibicao(db, fixada.displayId);
  assert.deepEqual([linha.kind, linha.poll_id, linha.item_id, linha.session_id, linha.shown_by], ["poll", ABERTA, null, SESSION, EQUIPE]);
  assert.deepEqual(linha.snapshot, { name: "Gostou da aula?", v: 1 }, "a copia { v: 1, name: pergunta }");
  assert.ok(Math.abs(linha.shown_offset_ms - 10 * MIN) < 10_000, "o minuto da sessao pelo relogio do servidor");
  const [auditoria] = audits(db, "webinar.poll_pinned");
  assert.deepEqual(auditoria.metadata, { display_id: fixada.displayId, poll_id: ABERTA, replaced: 0, session_id: SESSION });

  // A compartilhada (encerrada com o resultado) tambem fixa, e tira a de antes como `replaced`.
  const trocada = ok(await roomActions.pinPoll({ pollId: COMPARTILHADA, sessionId: SESSION }));
  assert.deepEqual(
    fixadasDaTela(db).map((row) => row.poll_id),
    [COMPARTILHADA],
    "uma enquete fixada por sessao"
  );
  const saiu = exibicao(db, fixada.displayId);
  assert.equal(saiu.hidden_reason, "replaced");
  assert.equal(saiu.hidden_by, EQUIPE);
  assert.ok(saiu.hidden_at >= saiu.shown_at);
  assert.equal(audits(db, "webinar.poll_pinned").at(-1).metadata.replaced, 1);

  // A mesma enquete de novo (dois cliques): nada muda, nem o carimbo.
  const deNovo = db.calls.writes.length;
  const igual = ok(await roomActions.pinPoll({ pollId: COMPARTILHADA, sessionId: SESSION }));
  assert.deepEqual([igual.changed, igual.displayId], [false, trocada.displayId]);
  assert.deepEqual(escritas(db, deNovo), []);
  assert.equal(audits(db, "webinar.poll_pinned").length, 2);
});

test("Fixar a enquete: encerrada sem compartilhar, o modelo, de outra sessao 409/404; no Replay, na sessao encerrada ou cancelada 409; nada gravado", async () => {
  const db = usar(cenarioDasEnquetes());
  const antes = db.calls.writes.length;
  const erros = WEBINAR_COPY.naTela.erros;

  const semCompartilhar = await roomActions.pinPoll({ pollId: ENCERRADA_SEM, sessionId: SESSION });
  assert.deepEqual([semCompartilhar.ok, semCompartilhar.status, semCompartilhar.error], [false, 409, erros.enqueteNaoFixa]);
  const modelo = await roomActions.pinPoll({ pollId: MODELO, sessionId: SESSION });
  assert.deepEqual([modelo.ok, modelo.status], [false, 404], "o modelo nao e da sessao");
  const deOutra = await roomActions.pinPoll({ pollId: DA_ENCERRADA, sessionId: SESSION });
  assert.deepEqual([deOutra.ok, deOutra.status], [false, 404], "a copia de outra sessao");

  const noReplay = await roomActions.pinPoll({ pollId: DO_REPLAY, sessionId: REPLAY });
  assert.deepEqual([noReplay.ok, noReplay.status, noReplay.error], [false, 409, erros.replay]);
  const naEncerrada = await roomActions.pinPoll({ pollId: DA_ENCERRADA, sessionId: ENCERRADA });
  assert.deepEqual([naEncerrada.ok, naEncerrada.status, naEncerrada.error], [false, 409, erros.sessaoFechada]);
  const naCancelada = await roomActions.pinPoll({ pollId: ABERTA, sessionId: CANCELADA });
  assert.deepEqual([naCancelada.ok, naCancelada.status], [false, 409]);

  for (const sessionId of [REPLAY, ENCERRADA, CANCELADA]) {
    const desafixar = await roomActions.unpinPoll({ sessionId });
    assert.deepEqual([desafixar.ok, desafixar.status], [false, 409], `desafixar recusado em ${sessionId}`);
  }

  assert.deepEqual(escritas(db, antes), [], "nada gravado");
  assert.equal(audits(db, "webinar.poll_pinned").length, 0);
});

test("Desafixar a enquete: sai da tela com o motivo team e a sessao por ultimo; a enquete continua aberta; sem fixada, nada muda", async () => {
  const db = usar(cenarioDasEnquetes());
  const fixada = ok(await roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION }));
  const antes = db.calls.writes.length;

  const desafixada = ok(await roomActions.unpinPoll({ sessionId: SESSION }));
  assert.deepEqual(desafixada, { pollId: ABERTA, sessionId: SESSION, unpinned: true });
  assert.deepEqual(escritas(db, antes), ["update webinar_screen_displays", "update webinar_sessions"]);
  const saiu = exibicao(db, fixada.displayId);
  assert.deepEqual([saiu.hidden_reason, saiu.hidden_by], ["team", EQUIPE]);
  assert.ok(Number.isFinite(saiu.hidden_offset_ms));
  assert.equal(fixadasDaTela(db).length, 0);
  assert.equal(db.tables.webinar_polls.find((row) => row.id === ABERTA).status, "open", "a enquete continua aberta");
  assert.deepEqual(audits(db, "webinar.poll_unpinned").map((row) => row.metadata), [{ display_id: fixada.displayId, poll_id: ABERTA, session_id: SESSION }]);

  const vazio = db.calls.writes.length;
  const nada = ok(await roomActions.unpinPoll({ sessionId: SESSION }));
  assert.deepEqual(nada, { pollId: null, sessionId: SESSION, unpinned: false });
  assert.deepEqual(escritas(db, vazio), ["update webinar_screen_displays"], "so a tentativa de tirar, sem carimbo");
  assert.equal(audits(db, "webinar.poll_unpinned").length, 1);
});

test("Abrir e fixar: a copia nasce aberta e fixada (a de antes sai), a sessao por ultimo e uma linha de auditoria; com a copia ja aberta, so fixa; sem pin, como antes", async () => {
  const tables = cenarioDasEnquetes();
  // So o modelo e a outra aberta (de outro modelo) nesta sessao.
  tables.webinar_polls = tables.webinar_polls.filter((row) => row.id === MODELO || row.id === OUTRA_ABERTA).map((row) => (row.id === OUTRA_ABERTA ? { ...row, template_poll_id: null } : row));
  const db = usar(tables);
  ok(await roomActions.pinPoll({ pollId: OUTRA_ABERTA, sessionId: SESSION }));
  const antes = db.calls.writes.length;

  const aberta = ok(await roomActions.launchPoll({ pin: true, pollId: MODELO, sessionId: SESSION }));
  assert.equal(aberta.pinned, true);
  assert.deepEqual([aberta.poll.status, aberta.poll.templatePollId, aberta.poll.question], ["open", MODELO, "Vem na próxima?"]);
  assert.deepEqual(escritas(db, antes), [
    "insert webinar_polls",
    "insert webinar_poll_options",
    "update webinar_screen_displays",
    "insert webinar_screen_displays",
    "update webinar_sessions"
  ]);
  assert.deepEqual(
    fixadasDaTela(db).map((row) => [row.poll_id, row.snapshot.name]),
    [[aberta.poll.id, "Vem na próxima?"]]
  );
  const lancada = audits(db, "webinar.poll_launched").at(-1);
  assert.equal(lancada.metadata.pinned, true);
  assert.equal(lancada.metadata.replaced, 1);
  assert.equal(audits(db, "webinar.poll_pinned").length, 1, "o Abrir e fixar e uma linha so (poll_launched com pinned)");

  // A copia ja aberta: o "Abrir e fixar" nao duplica, so fixa (depois de desafixar).
  ok(await roomActions.unpinPoll({ sessionId: SESSION }));
  const deNovo = ok(await roomActions.launchPoll({ pin: true, pollId: MODELO, sessionId: SESSION }));
  assert.deepEqual([deNovo.poll.id, deNovo.pinned], [aberta.poll.id, true]);
  assert.equal(db.tables.webinar_polls.filter((row) => row.template_poll_id === MODELO).length, 1, "sem copia nova");
  assert.deepEqual(
    fixadasDaTela(db).map((row) => row.poll_id),
    [aberta.poll.id]
  );
  assert.equal(audits(db, "webinar.poll_pinned").length, 2);

  // Ja fixada: nada muda.
  const parado = db.calls.writes.length;
  assert.equal(ok(await roomActions.launchPoll({ pin: true, pollId: MODELO, sessionId: SESSION })).pinned, true);
  assert.deepEqual(escritas(db, parado), []);

  // Sem pin, a copia aberta volta como antes, sem fixar nada.
  const semPin = ok(await roomActions.launchPoll({ pollId: MODELO, sessionId: SESSION }));
  assert.equal(semPin.pinned, false);
});

test("Encerrar sem compartilhar desafixa (poll_closed) antes do carimbo; com o resultado compartilhado a enquete continua fixada; encerrar outra enquete nao mexe na fixada", async () => {
  const db = usar(cenarioDasEnquetes());
  const fixada = ok(await roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION }));

  // Outra enquete encerrada sem compartilhar: a fixada continua, e a encerrada nao pode mais ser fixada.
  const outra = ok(await roomActions.closePoll({ pollId: OUTRA_ABERTA, sessionId: SESSION }));
  assert.equal(outra.unpinned, false);
  assert.deepEqual(
    fixadasDaTela(db).map((row) => row.poll_id),
    [ABERTA]
  );
  const fixarEncerrada = await roomActions.pinPoll({ pollId: OUTRA_ABERTA, sessionId: SESSION });
  assert.deepEqual([fixarEncerrada.ok, fixarEncerrada.status], [false, 409]);

  // Compartilhar o resultado: continua fixada (agora com as barras).
  const antes = db.calls.writes.length;
  const compartilhada = ok(await roomActions.closePoll({ pollId: ABERTA, sessionId: SESSION, shareResults: true }));
  assert.equal(compartilhada.unpinned, false);
  assert.ok(compartilhada.poll.resultsSharedAt);
  assert.deepEqual(escritas(db, antes), ["update webinar_polls", "update webinar_sessions"], "nada sai da tela");
  assert.deepEqual(
    fixadasDaTela(db).map((row) => row.poll_id),
    [ABERTA]
  );

  assert.equal(exibicao(db, fixada.displayId).hidden_at, null, "a mesma exibicao, sem trocar");

  // Fixada e encerrada sem compartilhar: sai da tela (a turma ja nao ve a enquete).
  const db2 = usar(cenarioDasEnquetes());
  const nova = ok(await roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION }));
  const depois = db2.calls.writes.length;
  const encerrada = ok(await roomActions.closePoll({ pollId: ABERTA, sessionId: SESSION }));
  assert.equal(encerrada.unpinned, true);
  assert.deepEqual(escritas(db2, depois), ["update webinar_polls", "update webinar_screen_displays", "update webinar_sessions"], "a enquete, a tela e o carimbo por ultimo");
  const saiu = db2.tables.webinar_screen_displays.find((row) => row.id === nova.displayId);
  assert.deepEqual([saiu.hidden_reason, saiu.hidden_by], ["poll_closed", EQUIPE]);
  assert.ok(Number.isFinite(saiu.hidden_offset_ms));
  assert.equal(fixadasDaTela(db2).length, 0);
  assert.equal(audits(db2, "webinar.poll_closed").at(-1).metadata.unpinned, true);
});

test("dois cliques juntos: o conflito do indice unico (outra fixou entre o tirar e o gravar) tenta mais uma vez e fica uma so; na segunda vez, 409 sem a exibicao nova", async () => {
  const db = comConcorrente(usar(cenarioDasEnquetes()), 1);
  const fixada = ok(await roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION }));
  assert.deepEqual(
    fixadasDaTela(db).map((row) => row.poll_id),
    [ABERTA],
    "uma fixada so, a desta acao"
  );
  const rival = db.tables.webinar_screen_displays.find((row) => row.poll_id === OUTRA_ABERTA);
  assert.equal(rival.hidden_reason, "replaced", "a da outra pessoa saiu como trocada");
  assert.equal(exibicao(db, fixada.displayId).hidden_at, null);
  assert.equal(audits(db, "webinar.poll_pinned").at(-1).metadata.replaced, 1);
  const conflitos = db.calls.writes.filter((write) => write.table === "webinar_screen_displays").map((write) => write.op);
  assert.deepEqual(conflitos, ["update", "update", "insert"], "tirar, (o insert recusado nao grava), tirar de novo e gravar");

  const db2 = comConcorrente(usar(cenarioDasEnquetes()), 2);
  const antes = db2.calls.writes.length;
  const recusada = await roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION });
  assert.deepEqual([recusada.ok, recusada.status], [false, 409]);
  assert.ok(!db2.tables.webinar_screen_displays.some((row) => row.poll_id === ABERTA), "a nossa nao entrou");
  assert.ok(!escritas(db2, antes).includes("update webinar_sessions"), "sem carimbo");
  assert.equal(audits(db2, "webinar.poll_pinned").length, 0);
});

test("banco sem a 202611100002: Fixar, Desafixar e Abrir e fixar respondem 409 com o aviso da migracao antes de gravar; Abrir e Encerrar seguem como antes", async () => {
  const db = semMigracao(usar(cenarioDasEnquetes()));
  const aviso = WEBINAR_COPY.exportar.migracaoPendente("202611100002");
  const antes = db.calls.writes.length;

  for (const chamada of [
    () => roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION }),
    () => roomActions.unpinPoll({ sessionId: SESSION }),
    () => roomActions.launchPoll({ pin: true, pollId: MODELO, sessionId: SESSION })
  ]) {
    const result = await chamada();
    assert.deepEqual([result.ok, result.status, result.error], [false, 409, aviso]);
  }
  assert.deepEqual(escritas(db, antes), [], "nada gravado: nem a enquete do Abrir e fixar");

  const encerrada = ok(await roomActions.closePoll({ pollId: ABERTA, sessionId: SESSION }));
  assert.deepEqual([encerrada.poll.status, encerrada.unpinned], ["closed", false]);
  const aberta = ok(await roomActions.launchPoll({ pollId: MODELO, sessionId: SESSION }));
  assert.equal(aberta.pinned, false);
});

test("sem permissão: Fixar e Desafixar a enquete respondem 403 sem tocar no banco", async () => {
  const db = usar(cenarioDasEnquetes());
  estado.negar = true;
  for (const chamada of [() => roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION }), () => roomActions.unpinPoll({ sessionId: SESSION }), () => roomActions.launchPoll({ pin: true, pollId: MODELO, sessionId: SESSION })]) {
    const result = await chamada();
    assert.deepEqual([result.ok, result.status], [false, 403]);
  }
  assert.equal(db.calls.from.length, 0);
  estado.negar = false;
});
