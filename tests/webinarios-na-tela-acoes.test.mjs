import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { DEFAULTS, MIN, OTHER_SESSION, OTHER_WEBINAR, REPLAY, SESSION, UNIQUE, WEBINAR, bancoFalso, escola, iso } from "./support/webinarios-sala-banco.mjs";

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
//   202611100002: 409 com o aviso da migracao antes de qualquer escrita, e o Encerrar segue sem desafixar;
// - R3 e R4, o banner e o QR Code (screen-actions.ts, com o Storage falso do content-assets e o fetch do endereco
//   publico): Mostrar troca o do mesmo tipo e mantem o outro, a copia congelada e o minuto, a sessao por ultimo, o mesmo
//   item como esta nao grava nada, editar na tela mantem a copia e o Mostrar de novo grava outra exibicao, item arquivado
//   ou de outro webinario 404, Replay e sessao encerrada 409, o conflito do indice unico tenta de novo; Tirar da tela
//   (team) e a enquete so pelo Desafixar; Enviar imagem grava em webinars/screen/<24 hex>.webp e devolve so o caminho e
//   as medidas, e recusa o que nao e WebP, mais de 200.000 bytes, lado fora de 16 a 1.280 px e o animado
//   (webpIsAnimated); Salvar confere a imagem no bucket (Range de 64 bytes) com as medidas relidas, deriva o nome, as
//   regras de cada campo, o limite de 20 e a edicao; Excluir recusado enquanto esta na tela; as linhas de auditoria sem
//   texto nem link; sem a migracao, 409 com o aviso; sem permissao, 403.

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

/**
 * Outra pessoa da equipe fixa outra enquete (ou mostra o que `rival` devolver) logo depois de cada um dos proximos
 * `vezes` "tirar da tela" (a corrida).
 */
function comConcorrente(db, vezes, rival = null) {
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
          db.tables.webinar_screen_displays.push(rival ? rival() : {
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

/** O banco sem a 202611100002: toda consulta as tabelas (por padrao, webinar_screen_displays) responde "a tabela nao existe". */
function semMigracao(db, tabelas = ["webinar_screen_displays"]) {
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
    return tabelas.includes(name) ? semTabela() : from(name);
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

/* ------------------------------------------------------------------------------------------------
 * R3 e R4: o banner e o QR Code (screen-actions.ts)
 * ---------------------------------------------------------------------------------------------- */

const screenActions = await import("../src/server/webinars/screen-actions.ts");
const { webpIsAnimated } = await import("../src/server/catalog/webp.ts");
const { SCREEN_LIMITS, screenItemShowState } = await import("../src/server/webinars/screen-model.ts");
const { screenDisplayFromRow, screenItemFromRow } = await import("../src/server/webinars/screen-rows.ts");

DEFAULTS.webinar_screen_items = {
  archived_at: null,
  body: null,
  button_label: null,
  closable: true,
  created_by: null,
  image_alt: null,
  image_height: null,
  image_path: null,
  image_width: null,
  link_url: null,
  place: "bottom_right",
  size: "m",
  title: null
};

const BANNER = "eeeeeeee-0000-4000-8000-000000000001";
const BANNER_2 = "eeeeeeee-0000-4000-8000-000000000002";
const QR = "eeeeeeee-0000-4000-8000-000000000003";
const ARQUIVADO = "eeeeeeee-0000-4000-8000-000000000004";
const DE_OUTRO = "eeeeeeee-0000-4000-8000-000000000005";
const ERROS = WEBINAR_COPY.naTela.erros;

function itemDaTela(id, extra = {}) {
  return {
    archived_at: null,
    body: "Só até o fim da aula.",
    button_label: "Quero",
    closable: true,
    created_at: iso(Date.now() - 30 * MIN),
    created_by: EQUIPE,
    id,
    image_alt: null,
    image_height: null,
    image_path: null,
    image_width: null,
    kind: "banner",
    link_url: "https://exemplo.com/vaga",
    name: "Banner da vaga",
    place: "bottom_right",
    size: "m",
    title: "Garanta sua vaga",
    updated_at: iso(Date.now() - 30 * MIN),
    webinar_id: WEBINAR,
    ...extra
  };
}

function cenarioDaTela() {
  const tables = cenario();
  tables.webinar_screen_items = [
    itemDaTela(BANNER),
    itemDaTela(BANNER_2, { body: null, button_label: null, link_url: null, name: "Aviso", place: "top_left", title: "Intervalo de 5 min" }),
    itemDaTela(QR, { body: null, button_label: null, kind: "qr", link_url: "https://exemplo.com/material", name: "Material", place: "top_right", title: "Baixe o material" }),
    itemDaTela(ARQUIVADO, { archived_at: iso(Date.now() - MIN), name: "Velho" }),
    itemDaTela(DE_OUTRO, { name: "De outra live", webinar_id: OTHER_WEBINAR })
  ];
  tables.webinar_screen_displays = [];
  return tables;
}

/** As exibicoes ativas de um tipo numa sessao. */
const naTela = (db, kind, sessionId = SESSION) => db.tables.webinar_screen_displays.filter((row) => row.session_id === sessionId && row.kind === kind && row.hidden_at === null);

/** Cabecalho WebP VP8X (32 bytes, ou `total`) com o canvas e as flags; `anim`: um chunk ANIM logo depois do VP8X. */
function webpBytes(width, height, { anim = false, flags = 0, total = 32 } = {}) {
  const bytes = new Uint8Array(Math.max(total, anim ? 44 : 32));
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16);
  bytes[20] = flags;
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  if (anim) {
    bytes.set([0x41, 0x4e, 0x49, 0x4d, 0x06, 0x00, 0x00, 0x00], 30);
  }
  return bytes;
}

const dataUrlDe = (bytes) => `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;

/**
 * O Storage falso do content-assets (os objetos por "bucket/caminho", com o tipo gravado) e o fetch do endereco publico
 * (so os primeiros bytes, pelo Range). Devolve os envios, as conferencias e os pedidos, e o `restaurar` do fetch.
 */
function comStorage(db, objetos = new Map()) {
  const envios = [];
  const conferidos = [];
  const pedidos = [];
  db.storage = {
    from(bucket) {
      return {
        getPublicUrl: (path) => ({ data: { publicUrl: `https://projeto.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        info: async (path) => {
          conferidos.push(`${bucket}/${path}`);
          const objeto = objetos.get(`${bucket}/${path}`);
          return objeto ? { data: { contentType: objeto.contentType, size: objeto.bytes.length }, error: null } : { data: null, error: { message: "Object not found", status: 400, statusCode: "404" } };
        },
        upload: async (path, bytes, options) => {
          envios.push({ bucket, contentType: options.contentType, path });
          objetos.set(`${bucket}/${path}`, { bytes: new Uint8Array(bytes), contentType: options.contentType });
          return { error: null };
        }
      };
    }
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const endereco = String(url);
    const marca = "/storage/v1/object/public/";
    const objeto = objetos.get(endereco.slice(endereco.indexOf(marca) + marca.length));
    pedidos.push(new Headers(init?.headers).get("range"));
    if (!objeto) {
      return new Response(null, { status: 404 });
    }
    const fim = Number(/bytes=0-(\d+)/.exec(new Headers(init?.headers).get("range") ?? "")?.[1] ?? objeto.bytes.length - 1);
    return new Response(objeto.bytes.slice(0, fim + 1), { status: 206 });
  };
  return { conferidos, envios, objetos, pedidos, restaurar: () => (globalThis.fetch = original) };
}

const CAMINHO = "webinars/screen/0123456789abcdef01234567.webp";

test("webpIsAnimated: a flag de animacao do VP8X e o chunk ANIM; o WebP parado, o VP8 comum e o que nao e WebP, nao", () => {
  assert.equal(webpIsAnimated(webpBytes(800, 450)), false);
  assert.equal(webpIsAnimated(webpBytes(800, 450, { flags: 0x10 })), false, "so com transparencia");
  assert.equal(webpIsAnimated(webpBytes(800, 450, { flags: 0x02 })), true, "a flag de animacao");
  assert.equal(webpIsAnimated(webpBytes(800, 450, { anim: true })), true, "o chunk ANIM sem a flag");
  const vp8 = Uint8Array.from("524946464806000057454250565038203c060000d0a2009d012ad00238043ed1".match(/../g).map((pair) => Number.parseInt(pair, 16)));
  assert.equal(webpIsAnimated(vp8), false);
  assert.equal(webpIsAnimated(new Uint8Array(64)), false);
  assert.equal(webpIsAnimated("RIFF"), false);
});

test("screenItemShowState: Mostrar sem nada do tipo, Mostrar no lugar do atual com outro, Na tela com ele como esta (o nome nao conta) e Mostrar de novo depois de editado", () => {
  const banner = screenItemFromRow(itemDaTela(BANNER));
  const exibicaoDe = (item, extra = {}) =>
    screenDisplayFromRow({ created_at: iso(Date.now()), hidden_at: null, hidden_by: null, hidden_offset_ms: null, hidden_reason: null, id: randomUUID(), item_id: item.id, kind: item.kind, poll_id: null, session_id: SESSION, shown_at: iso(Date.now()), shown_by: EQUIPE, shown_offset_ms: 0, snapshot: { body: item.body, buttonLabel: item.buttonLabel, closable: item.closable, image: item.image, linkUrl: item.linkUrl, name: item.name, place: item.place, size: item.size, title: item.title, v: 1 }, ...extra });
  const qr = screenItemFromRow(itemDaTela(QR, { body: null, button_label: null, kind: "qr", link_url: "https://exemplo.com/material", title: "Baixe" }));
  const outro = screenItemFromRow(itemDaTela(BANNER_2, { title: "Outro" }));

  assert.equal(screenItemShowState(banner, []), "show");
  assert.equal(screenItemShowState(banner, [exibicaoDe(qr)]), "show", "o QR Code na tela nao conta para o banner");
  assert.equal(screenItemShowState(banner, [exibicaoDe(outro)]), "replace");
  assert.equal(screenItemShowState(banner, [exibicaoDe(banner)]), "on");
  assert.equal(screenItemShowState({ ...banner, name: "Outro nome" }, [exibicaoDe(banner)]), "on", "o nome so a equipe ve");
  assert.equal(screenItemShowState({ ...banner, title: "Novo título" }, [exibicaoDe(banner)]), "again");
  assert.equal(screenItemShowState({ ...banner, place: "center" }, [exibicaoDe(banner)]), "again");
  assert.equal(screenItemShowState(banner, [exibicaoDe(banner, { snapshot: { quebrada: true } })]), "again", "a copia que nao passa no zod");
  assert.equal(screenItemShowState(banner, [{ ...exibicaoDe(banner), hiddenAt: iso(Date.now()) }]), "show", "a que ja saiu");
});

test("Mostrar: o banner entra com a copia congelada e o minuto, o carimbo por ultimo e a auditoria; outro banner troca (replaced) e o QR Code continua; o mesmo como esta nao grava nada", async () => {
  const db = usar(cenarioDaTela());
  const antes = db.calls.writes.length;

  const mostrado = ok(await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION }));
  assert.deepEqual([mostrado.changed, mostrado.kind, mostrado.replaced], [true, "banner", 0]);
  assert.deepEqual(escritas(db, antes), ["update webinar_screen_displays", "insert webinar_screen_displays", "update webinar_sessions"], "tira o do mesmo tipo, grava o novo e o carimbo por ultimo");
  const carimbo = db.calls.writes.filter((write) => write.table === "webinar_sessions").at(-1);
  assert.deepEqual(Object.keys(carimbo.payload), ["updated_at"]);
  const linha = exibicao(db, mostrado.displayId);
  assert.deepEqual([linha.kind, linha.item_id, linha.poll_id, linha.session_id, linha.shown_by], ["banner", BANNER, null, SESSION, EQUIPE]);
  assert.deepEqual(linha.snapshot, {
    body: "Só até o fim da aula.",
    buttonLabel: "Quero",
    closable: true,
    image: null,
    // O item do banco de antes da 202611150001 (sem link_target) vale "so o botao", e a copia guarda isso (docs/30 D87).
    linkTarget: "button",
    linkUrl: "https://exemplo.com/vaga",
    name: "Banner da vaga",
    place: "bottom_right",
    size: "m",
    title: "Garanta sua vaga",
    v: 1
  });
  assert.ok(Math.abs(linha.shown_offset_ms - 10 * MIN) < 10_000, "o minuto da sessao pelo relogio do servidor");
  assert.deepEqual(audits(db, "webinar.screen_shown").map((row) => row.metadata), [{ display_id: mostrado.displayId, item_id: BANNER, kind: "banner", replaced: 0, session_id: SESSION }]);
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}/sala`), "o console revalidado");

  const qr = ok(await screenActions.showScreenItem({ itemId: QR, sessionId: SESSION }));
  const outro = ok(await screenActions.showScreenItem({ itemId: BANNER_2, sessionId: SESSION }));
  assert.equal(outro.replaced, 1);
  assert.deepEqual(
    naTela(db, "banner").map((row) => row.item_id),
    [BANNER_2],
    "um banner por sessao"
  );
  assert.deepEqual(
    naTela(db, "qr").map((row) => row.id),
    [qr.displayId],
    "o QR Code continua"
  );
  const saiu = exibicao(db, mostrado.displayId);
  assert.deepEqual([saiu.hidden_reason, saiu.hidden_by], ["replaced", EQUIPE]);
  assert.ok(saiu.hidden_at >= saiu.shown_at);

  // O mesmo banner de novo, como esta (dois cliques): nada muda, nem o carimbo.
  const parado = db.calls.writes.length;
  const igual = ok(await screenActions.showScreenItem({ itemId: BANNER_2, sessionId: SESSION }));
  assert.deepEqual([igual.changed, igual.displayId], [false, outro.displayId]);
  assert.deepEqual(escritas(db, parado), []);
  assert.equal(audits(db, "webinar.screen_shown").length, 3);
});

test("Editar o item na tela: a turma continua com a copia mostrada, o botao vira Mostrar de novo e o Mostrar grava uma exibicao nova (a de antes sai como replaced)", async () => {
  const db = usar(cenarioDaTela());
  const primeira = ok(await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION }));

  const editado = ok(await screenActions.saveScreenItem({ body: null, buttonLabel: "Quero", id: BANNER, kind: "banner", linkUrl: "https://exemplo.com/vaga", name: "Banner da vaga", title: "Últimas vagas", webinarId: WEBINAR }));
  assert.equal(editado.created, false);
  assert.equal(editado.item.title, "Últimas vagas");
  assert.equal(exibicao(db, primeira.displayId).snapshot.title, "Garanta sua vaga", "a copia congelada nao muda");
  assert.equal(exibicao(db, primeira.displayId).hidden_at, null, "e continua na tela");
  const ativos = db.tables.webinar_screen_displays.map(screenDisplayFromRow);
  assert.equal(screenItemShowState(editado.item, ativos), "again");

  const deNovo = ok(await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION }));
  assert.deepEqual([deNovo.changed, deNovo.replaced], [true, 1]);
  assert.notEqual(deNovo.displayId, primeira.displayId, "outra exibicao: aparece de novo para quem fechou");
  assert.equal(exibicao(db, deNovo.displayId).snapshot.title, "Últimas vagas");
  assert.equal(exibicao(db, primeira.displayId).hidden_reason, "replaced");
});

test("Mostrar recusa: item arquivado, de outro webinario ou inexistente 404; Replay, sessao encerrada ou cancelada 409; nada gravado", async () => {
  const db = usar(cenarioDaTela());
  const antes = db.calls.writes.length;

  for (const itemId of [ARQUIVADO, DE_OUTRO, randomUUID()]) {
    const recusado = await screenActions.showScreenItem({ itemId, sessionId: SESSION });
    assert.deepEqual([recusado.ok, recusado.status, recusado.error], [false, 404, ERROS.itemSumiu], itemId);
  }
  const outraSessao = await screenActions.showScreenItem({ itemId: BANNER, sessionId: OTHER_SESSION });
  assert.deepEqual([outraSessao.ok, outraSessao.status], [false, 404], "o item e do webinario da sessao");

  const noReplay = await screenActions.showScreenItem({ itemId: BANNER, sessionId: REPLAY });
  assert.deepEqual([noReplay.ok, noReplay.status, noReplay.error], [false, 409, ERROS.replay]);
  const naEncerrada = await screenActions.showScreenItem({ itemId: BANNER, sessionId: ENCERRADA });
  assert.deepEqual([naEncerrada.ok, naEncerrada.status, naEncerrada.error], [false, 409, ERROS.sessaoFechada]);
  const naCancelada = await screenActions.showScreenItem({ itemId: BANNER, sessionId: CANCELADA });
  assert.deepEqual([naCancelada.ok, naCancelada.status], [false, 409]);

  assert.deepEqual(escritas(db, antes), [], "nada gravado");
  assert.equal(audits(db, "webinar.screen_shown").length, 0);
});

test("dois cliques no Mostrar: o conflito do indice unico (outro banner entrou entre o tirar e o gravar) tenta mais uma vez e fica um so; na segunda vez, 409 sem a exibicao nova", async () => {
  const rival = () => ({
    created_at: iso(Date.now()),
    hidden_at: null,
    hidden_by: null,
    hidden_offset_ms: null,
    hidden_reason: null,
    id: randomUUID(),
    item_id: BANNER_2,
    kind: "banner",
    poll_id: null,
    session_id: SESSION,
    shown_at: iso(Date.now()),
    shown_by: "00000000-0000-4000-8000-0000000000e9",
    shown_offset_ms: 0,
    snapshot: { body: null, buttonLabel: null, closable: true, image: null, linkUrl: null, name: "Aviso", place: "top_left", size: "m", title: "Intervalo de 5 min", v: 1 }
  });
  const db = comConcorrente(usar(cenarioDaTela()), 1, rival);
  const mostrado = ok(await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION }));
  assert.deepEqual(
    naTela(db, "banner").map((row) => row.id),
    [mostrado.displayId]
  );
  assert.equal(db.tables.webinar_screen_displays.find((row) => row.item_id === BANNER_2).hidden_reason, "replaced", "o da outra pessoa saiu como trocado");
  assert.equal(audits(db, "webinar.screen_shown").at(-1).metadata.replaced, 1);

  const db2 = comConcorrente(usar(cenarioDaTela()), 2, rival);
  const antes = db2.calls.writes.length;
  const recusado = await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION });
  assert.deepEqual([recusado.ok, recusado.status], [false, 409]);
  assert.ok(!db2.tables.webinar_screen_displays.some((row) => row.item_id === BANNER), "o nosso nao entrou");
  assert.ok(!escritas(db2, antes).includes("update webinar_sessions"), "sem carimbo");
  assert.equal(audits(db2, "webinar.screen_shown").length, 0);
});

test("dois cliques no Mostrar com o outro mostrado depois do nosso instante: nunca um hidden_at antes do shown_at (o check _window_v7); a segunda tentativa usa o relogio de agora no tirar e no gravar", async () => {
  // O outro banner entrou depois do instante que a nossa acao leu (o integrado pegou isso: o tirar com o relogio
  // de antes esbarrava no check e a acao inteira caia em 500).
  const rival = (shownAt) => () => ({
    created_at: shownAt,
    hidden_at: null,
    hidden_by: null,
    hidden_offset_ms: null,
    hidden_reason: null,
    id: randomUUID(),
    item_id: BANNER_2,
    kind: "banner",
    poll_id: null,
    session_id: SESSION,
    shown_at: shownAt,
    shown_by: "00000000-0000-4000-8000-0000000000e9",
    shown_offset_ms: 0,
    snapshot: { body: null, buttonLabel: null, closable: true, image: null, linkUrl: null, name: "Aviso", place: "top_left", size: "m", title: "Intervalo de 5 min", v: 1 }
  });
  const inicio = Date.now();
  const db = comConcorrente(usar(cenarioDaTela()), 1, () => rival(iso(Date.now()))());
  const mostrado = ok(await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION }));
  const outro = db.tables.webinar_screen_displays.find((row) => row.item_id === BANNER_2);
  const nosso = db.tables.webinar_screen_displays.find((row) => row.id === mostrado.displayId);
  assert.equal(outro.hidden_reason, "replaced");
  assert.ok(Date.parse(outro.hidden_at) >= Date.parse(outro.shown_at), "o outro sai depois de ter entrado");
  assert.equal(nosso.shown_at, outro.hidden_at, "o nosso entra no instante em que o outro saiu");
  assert.ok(Date.parse(nosso.shown_at) >= inicio);

  // Um servidor com o relogio adiantado (o outro entrou "no futuro"): ele nunca sai com um hidden_at antes do shown_at
  // dela; o nosso esbarra duas vezes e a acao responde 409, sem 500 e sem carimbo.
  const db2 = comConcorrente(usar(cenarioDaTela()), 1, rival(iso(Date.now() + 60 * MIN)));
  const antes = db2.calls.writes.length;
  const recusado = await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION });
  assert.deepEqual([recusado.ok, recusado.status], [false, 409]);
  assert.equal(db2.tables.webinar_screen_displays.find((row) => row.item_id === BANNER_2).hidden_at, null, "o do relogio adiantado fica");
  assert.ok(!escritas(db2, antes).includes("update webinar_sessions"), "sem carimbo");
});

test("Tirar da tela: sai com o motivo team, o minuto e o carimbo por ultimo; a que ja saiu nao grava nada; a enquete fixada so pelo Desafixar; na sessao encerrada 409", async () => {
  const db = usar(cenarioDaTela());
  const mostrado = ok(await screenActions.showScreenItem({ itemId: QR, sessionId: SESSION }));
  const antes = db.calls.writes.length;

  const tirado = ok(await screenActions.hideScreenItem({ displayId: mostrado.displayId }));
  assert.deepEqual(tirado, { displayId: mostrado.displayId, hidden: true, sessionId: SESSION });
  assert.deepEqual(escritas(db, antes), ["update webinar_screen_displays", "update webinar_sessions"]);
  const saiu = exibicao(db, mostrado.displayId);
  assert.deepEqual([saiu.hidden_reason, saiu.hidden_by], ["team", EQUIPE]);
  assert.ok(Number.isFinite(saiu.hidden_offset_ms));
  assert.deepEqual(audits(db, "webinar.screen_hidden").map((row) => row.metadata), [{ display_id: mostrado.displayId, item_id: QR, kind: "qr", session_id: SESSION }]);

  const parado = db.calls.writes.length;
  const deNovo = ok(await screenActions.hideScreenItem({ displayId: mostrado.displayId }));
  assert.equal(deNovo.hidden, false);
  assert.deepEqual(escritas(db, parado), [], "ja tinha saido: nada");

  const sumiu = await screenActions.hideScreenItem({ displayId: randomUUID() });
  assert.deepEqual([sumiu.ok, sumiu.status, sumiu.error], [false, 404, ERROS.exibicaoSumiu]);

  // A enquete fixada (a exibicao poll) sai pelo Desafixar, nunca pelo Tirar da tela.
  db.tables.webinar_polls = [enquete(ABERTA, { question: "Gostou?" })];
  db.tables.webinar_poll_options = opcoes(ABERTA);
  const fixada = ok(await roomActions.pinPoll({ pollId: ABERTA, sessionId: SESSION }));
  const enqueteRecusada = await screenActions.hideScreenItem({ displayId: fixada.displayId });
  assert.deepEqual([enqueteRecusada.ok, enqueteRecusada.status], [false, 400]);
  assert.equal(exibicao(db, fixada.displayId).hidden_at, null);

  // Na sessao encerrada (o banner ficou de uma sessao que acabou): 409, nada muda.
  const daEncerrada = { ...exibicao(db, mostrado.displayId), hidden_at: null, hidden_by: null, hidden_offset_ms: null, hidden_reason: null, id: randomUUID(), session_id: ENCERRADA };
  db.tables.webinar_screen_displays.push(daEncerrada);
  const encerrada = await screenActions.hideScreenItem({ displayId: daEncerrada.id });
  assert.deepEqual([encerrada.ok, encerrada.status, encerrada.error], [false, 409, ERROS.sessaoFechada]);
});

test("S3 (revisao de 11/11/2026): Tirar da tela nunca grava hidden_at antes do shown_at (o relogio de outra instancia adiantado; o check _window_v7 daria 500)", async () => {
  const db = usar(cenarioDaTela());
  const mostrado = ok(await screenActions.showScreenItem({ itemId: QR, sessionId: SESSION }));
  // Outra instancia, com o relogio 2 min adiantado, gravou a exibicao "no futuro".
  const futuro = iso(Date.now() + 2 * MIN);
  exibicao(db, mostrado.displayId).shown_at = futuro;
  const tirado = ok(await screenActions.hideScreenItem({ displayId: mostrado.displayId }));
  assert.equal(tirado.hidden, true);
  const saiu = exibicao(db, mostrado.displayId);
  assert.ok(Date.parse(saiu.hidden_at) >= Date.parse(saiu.shown_at), `hidden_at ${saiu.hidden_at} antes do shown_at ${saiu.shown_at}`);
  assert.equal(saiu.hidden_at, futuro, "sai no instante em que entrou");

  // O caso comum (o shown_at no passado): sai agora.
  const db2 = usar(cenarioDaTela());
  const outro = ok(await screenActions.showScreenItem({ itemId: QR, sessionId: SESSION }));
  const antes = Date.now();
  ok(await screenActions.hideScreenItem({ displayId: outro.displayId }));
  assert.ok(Math.abs(Date.parse(exibicao(db2, outro.displayId).hidden_at) - antes) < 5_000);
});

test("Enviar imagem: grava em content-assets/webinars/screen/<24 hex>.webp e devolve so o caminho e as medidas do servidor; a mesma imagem cai no mesmo caminho; a auditoria", async () => {
  const db = usar(cenarioDaTela());
  const storage = comStorage(db);

  try {
    const enviada = ok(await screenActions.uploadScreenImage({ image: dataUrlDe(webpBytes(800, 450)) }));
    assert.match(enviada.path, /^webinars\/screen\/[a-f0-9]{24}\.webp$/);
    assert.deepEqual(Object.keys(enviada).sort(), ["height", "path", "width"], "nunca um endereco");
    assert.deepEqual([enviada.width, enviada.height], [800, 450]);
    assert.deepEqual(storage.envios, [{ bucket: "content-assets", contentType: "image/webp", path: enviada.path }]);
    const [auditoria] = audits(db, "webinar.screen_image_uploaded");
    assert.deepEqual(auditoria.metadata, { height: 450, path: enviada.path, size_bytes: 32, width: 800 });

    const deNovo = ok(await screenActions.uploadScreenImage({ image: dataUrlDe(webpBytes(800, 450)) }));
    assert.equal(deNovo.path, enviada.path, "o nome pelo conteudo");
    const lados = ok(await screenActions.uploadScreenImage({ image: dataUrlDe(webpBytes(1280, 16)) }));
    assert.deepEqual([lados.width, lados.height], [1280, 16], "os limites valem");
  } finally {
    storage.restaurar();
  }
});

test("Enviar imagem recusa, no campo image e sem enviar nada: o que nao e WebP, mais de 200.000 bytes, lado fora de 16 a 1.280 px e WebP animado", async () => {
  const db = usar(cenarioDaTela());
  const storage = comStorage(db);

  try {
    const casos = [
      [`data:image/png;base64,${Buffer.from("png").toString("base64")}`, ERROS.imagemFormato],
      [dataUrlDe(new Uint8Array(40)), ERROS.imagemFormato],
      [dataUrlDe(webpBytes(800, 450, { total: SCREEN_LIMITS.imageBytes + 1 })), ERROS.imagemPesada],
      [dataUrlDe(webpBytes(1281, 450)), ERROS.imagemLado],
      [dataUrlDe(webpBytes(800, 15)), ERROS.imagemLado],
      [dataUrlDe(webpBytes(800, 450, { flags: 0x02 })), ERROS.imagemAnimada],
      [dataUrlDe(webpBytes(800, 450, { anim: true })), ERROS.imagemAnimada]
    ];
    for (const [image, frase] of casos) {
      const recusada = await screenActions.uploadScreenImage({ image });
      assert.deepEqual([recusada.ok, recusada.status, recusada.fieldErrors?.image?.[0]], [false, 400, frase], frase);
    }
    const enorme = await screenActions.uploadScreenImage({ image: `data:image/webp;base64,${"A".repeat(300_000)}` });
    assert.deepEqual([enorme.ok, enorme.status], [false, 400], "o texto passa do teto antes de decodificar");
    assert.deepEqual(storage.envios, [], "nada enviado");
    assert.equal(audits(db, "webinar.screen_image_uploaded").length, 0);
  } finally {
    storage.restaurar();
  }
});

test("Salvar: o banner novo com a imagem conferida no bucket (Range de 64 bytes) e as medidas relidas, o nome pelo titulo; o QR Code sem legenda leva o dominio; a auditoria sem texto nem link", async () => {
  const db = usar(cenarioDaTela());
  const storage = comStorage(db);

  try {
    const imagem = ok(await screenActions.uploadScreenImage({ image: dataUrlDe(webpBytes(640, 360)) }));
    const antes = db.calls.writes.length;
    const salvo = ok(
      await screenActions.saveScreenItem({
        body: "  Só hoje.  ",
        buttonLabel: "",
        closable: false,
        imageAlt: "Foto da turma",
        imagePath: imagem.path,
        kind: "banner",
        linkUrl: "https://exemplo.com/oferta",
        place: "middle_left",
        size: "l",
        title: "Bônus da aula",
        webinarId: WEBINAR
      })
    );
    assert.equal(salvo.created, true);
    assert.deepEqual(salvo.item.image, { alt: "Foto da turma", height: 360, path: imagem.path, width: 640 }, "as medidas lidas do arquivo, nunca do navegador");
    assert.deepEqual([salvo.item.name, salvo.item.body, salvo.item.buttonLabel, salvo.item.closable, salvo.item.place, salvo.item.size], ["Bônus da aula", "Só hoje.", null, false, "middle_left", "l"]);
    assert.deepEqual(storage.conferidos, [`content-assets/${imagem.path}`]);
    assert.deepEqual(storage.pedidos, ["bytes=0-63"], "so o comeco do arquivo");
    assert.deepEqual(escritas(db, antes), ["insert webinar_screen_items"], "a sessao nao muda: o item nao esta na tela");
    const linha = db.tables.webinar_screen_items.find((row) => row.id === salvo.item.id);
    assert.deepEqual([linha.created_by, linha.webinar_id, linha.image_width, linha.image_height], [EQUIPE, WEBINAR, 640, 360]);

    const qr = ok(await screenActions.saveScreenItem({ kind: "qr", linkUrl: "https://www.exemplo.com/material?utm=aula", webinarId: WEBINAR }));
    assert.deepEqual([qr.item.name, qr.item.place, qr.item.size, qr.item.title, qr.item.body, qr.item.image], ["exemplo.com", "top_right", "m", null, null, null], "o QR Code nasce em cima a direita, Medio");
    const comLegenda = ok(await screenActions.saveScreenItem({ kind: "qr", linkUrl: "https://exemplo.com/grupo", title: "Entre no grupo", webinarId: WEBINAR }));
    assert.equal(comLegenda.item.name, "Entre no grupo", "o nome pela legenda");

    const auditorias = audits(db, "webinar.screen_item_saved");
    assert.deepEqual(auditorias.map((row) => row.metadata), [
      { created: true, image: true, item_id: salvo.item.id, kind: "banner" },
      { created: true, image: false, item_id: qr.item.id, kind: "qr" },
      { created: true, image: false, item_id: comLegenda.item.id, kind: "qr" }
    ]);
    assert.doesNotMatch(JSON.stringify(auditorias), /exemplo\.com|Bônus|Só hoje/, "nem o texto nem o link na auditoria");
  } finally {
    storage.restaurar();
  }
});

test("Salvar a edicao: a imagem que o item ja tinha nao e conferida de novo; trocar de tipo, item arquivado ou de outro webinario recusados", async () => {
  const tables = cenarioDaTela();
  Object.assign(tables.webinar_screen_items.find((row) => row.id === BANNER), { image_alt: "Turma", image_height: 300, image_path: CAMINHO, image_width: 400 });
  const db = usar(tables);
  const storage = comStorage(db);

  try {
    const editado = ok(await screenActions.saveScreenItem({ id: BANNER, imageAlt: "Turma reunida", imagePath: CAMINHO, kind: "banner", title: "Novo", webinarId: WEBINAR }));
    assert.deepEqual(editado.item.image, { alt: "Turma reunida", height: 300, path: CAMINHO, width: 400 });
    assert.deepEqual(storage.conferidos, [], "a mesma imagem do item nao vai ao Storage");
    assert.equal(audits(db, "webinar.screen_item_saved").at(-1).metadata.created, false);

    const antes = db.calls.writes.length;
    const tipo = await screenActions.saveScreenItem({ id: BANNER, kind: "qr", linkUrl: "https://exemplo.com", webinarId: WEBINAR });
    assert.deepEqual([tipo.ok, tipo.status], [false, 400]);
    for (const id of [ARQUIVADO, DE_OUTRO, randomUUID()]) {
      const recusado = await screenActions.saveScreenItem({ id, kind: "banner", title: "Oi", webinarId: WEBINAR });
      assert.deepEqual([recusado.ok, recusado.status, recusado.error], [false, 404, ERROS.itemSumiu], id);
    }
    assert.deepEqual(escritas(db, antes), []);
  } finally {
    storage.restaurar();
  }
});

test("Salvar recusa com o erro no campo: as regras do item, a imagem fora do bucket, sumida, de outro tipo, pesada ou animada; nada gravado", async () => {
  const db = usar(cenarioDaTela());
  const storage = comStorage(db);
  const guardar = (caminho, bytes, contentType = "image/webp") => storage.objetos.set(`content-assets/${caminho}`, { bytes, contentType });
  const PNG = "webinars/screen/aaaaaaaaaaaaaaaaaaaaaaaa.webp";
  const PESADA = "webinars/screen/bbbbbbbbbbbbbbbbbbbbbbbb.webp";
  const ANIMADA = "webinars/screen/cccccccccccccccccccccccc.webp";
  const GRANDE = "webinars/screen/dddddddddddddddddddddddd.webp";
  guardar(PNG, webpBytes(400, 300), "image/png");
  guardar(PESADA, webpBytes(400, 300, { total: SCREEN_LIMITS.imageBytes + 1 }));
  guardar(ANIMADA, webpBytes(400, 300, { flags: 0x02 }));
  guardar(GRANDE, webpBytes(1600, 900));

  try {
    const antes = db.calls.writes.length;
    const casos = [
      [{ kind: "banner", webinarId: WEBINAR }, "title", ERROS.imagemOuTitulo],
      [{ buttonLabel: "Quero", kind: "banner", title: "Oi", webinarId: WEBINAR }, "linkUrl", ERROS.botaoSemLink],
      [{ kind: "banner", linkUrl: "http://exemplo.com", title: "Oi", webinarId: WEBINAR }, "linkUrl", ERROS.link],
      [{ kind: "banner", linkUrl: "javascript:alert(1)", title: "Oi", webinarId: WEBINAR }, "linkUrl", ERROS.link],
      [{ kind: "qr", linkUrl: `https://exemplo.com/${"a".repeat(230)}`, webinarId: WEBINAR }, "linkUrl", ERROS.qrLink],
      [{ kind: "qr", webinarId: WEBINAR }, "linkUrl", ERROS.link],
      [{ closable: false, kind: "banner", place: "center", size: "l", title: "Oi", webinarId: WEBINAR }, "size", ERROS.meioGrande],
      [{ imagePath: CAMINHO, kind: "banner", webinarId: WEBINAR }, "imageAlt", ERROS.descricao],
      [{ imagePath: "https://outro.site/foto.webp", kind: "banner", title: "Oi", webinarId: WEBINAR }, "imagePath", ERROS.imagemSumiu],
      [{ imagePath: CAMINHO, kind: "banner", title: "Oi", webinarId: WEBINAR }, "imagePath", ERROS.imagemSumiu],
      [{ imagePath: PNG, kind: "banner", title: "Oi", webinarId: WEBINAR }, "imagePath", ERROS.imagemFormato],
      [{ imagePath: PESADA, kind: "banner", title: "Oi", webinarId: WEBINAR }, "imagePath", ERROS.imagemPesada],
      [{ imagePath: ANIMADA, kind: "banner", title: "Oi", webinarId: WEBINAR }, "imagePath", ERROS.imagemAnimada],
      [{ imagePath: GRANDE, kind: "banner", title: "Oi", webinarId: WEBINAR }, "imagePath", ERROS.imagemLado]
    ];
    for (const [entrada, campo, frase] of casos) {
      const recusado = await screenActions.saveScreenItem(entrada);
      assert.deepEqual([recusado.ok, recusado.status, recusado.fieldErrors?.[campo]?.[0]], [false, 400, frase], `${campo}: ${frase}`);
    }
    assert.deepEqual(escritas(db, antes), [], "nada gravado");
    assert.equal(audits(db, "webinar.screen_item_saved").length, 0);
  } finally {
    storage.restaurar();
  }
});

test("Salvar: ate 20 itens prontos por webinario (o arquivado nao conta); o 21o recusado com 409", async () => {
  const tables = cenarioDaTela();
  // Os 3 ativos do cenario + 16 = 19 ativos (mais o arquivado e o de outro webinario, que nao contam).
  for (let index = 0; index < 16; index += 1) {
    tables.webinar_screen_items.push(itemDaTela(randomUUID(), { name: `Item ${index}` }));
  }
  const db = usar(tables);

  ok(await screenActions.saveScreenItem({ kind: "banner", title: "O vigésimo", webinarId: WEBINAR }));
  const antes = db.calls.writes.length;
  const recusado = await screenActions.saveScreenItem({ kind: "banner", title: "O vigésimo primeiro", webinarId: WEBINAR });
  assert.deepEqual([recusado.ok, recusado.status, recusado.error], [false, 409, ERROS.limite(20)]);
  assert.deepEqual(escritas(db, antes), []);
  // Editar um dos 20 continua permitido.
  ok(await screenActions.saveScreenItem({ id: BANNER, kind: "banner", title: "Editado", webinarId: WEBINAR }));
});

test("Excluir: recusado (409 \"Tire da tela para excluir.\") enquanto esta na tela de uma sessao no ar; aceito depois de tirar; o que ficou na tela de uma sessao encerrada nao segura; o ja arquivado nao muda nada", async () => {
  const db = usar(cenarioDaTela());
  const mostrado = ok(await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION }));
  const antes = db.calls.writes.length;

  const recusado = await screenActions.archiveScreenItem({ id: BANNER });
  assert.deepEqual([recusado.ok, recusado.status, recusado.error], [false, 409, ERROS.tireDaTela]);
  assert.deepEqual(escritas(db, antes), []);

  ok(await screenActions.hideScreenItem({ displayId: mostrado.displayId }));
  const arquivado = ok(await screenActions.archiveScreenItem({ id: BANNER }));
  assert.deepEqual(arquivado, { archived: true, id: BANNER });
  assert.ok(db.tables.webinar_screen_items.find((row) => row.id === BANNER).archived_at, "arquivado, nunca apagado");
  assert.deepEqual(audits(db, "webinar.screen_item_archived").map((row) => row.metadata), [{ item_id: BANNER, kind: "banner" }]);
  const deNovo = ok(await screenActions.archiveScreenItem({ id: BANNER }));
  assert.equal(deNovo.archived, false);
  assert.equal(audits(db, "webinar.screen_item_archived").length, 1);

  // A exibicao que ficou aberta numa sessao encerrada nao impede.
  db.tables.webinar_screen_displays.push({ ...exibicao(db, mostrado.displayId), hidden_at: null, hidden_by: null, hidden_offset_ms: null, hidden_reason: null, id: randomUUID(), item_id: QR, kind: "qr", session_id: ENCERRADA });
  ok(await screenActions.archiveScreenItem({ id: QR }));

  const sumiu = await screenActions.archiveScreenItem({ id: randomUUID() });
  assert.deepEqual([sumiu.ok, sumiu.status], [false, 404]);
});

test("banco sem a 202611100002: Salvar, Mostrar e Tirar respondem 409 com o aviso da migracao antes de gravar", async () => {
  const db = semMigracao(usar(cenarioDaTela()), ["webinar_screen_displays", "webinar_screen_items"]);
  const aviso = WEBINAR_COPY.exportar.migracaoPendente("202611100002");
  const antes = db.calls.writes.length;

  const salvar = await screenActions.saveScreenItem({ kind: "banner", title: "Oi", webinarId: WEBINAR });
  assert.deepEqual([salvar.ok, salvar.status, salvar.error], [false, 409, aviso]);
  const mostrar = await screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION });
  assert.deepEqual([mostrar.ok, mostrar.status, mostrar.error], [false, 409, aviso]);
  // Sem a tabela nada pode estar na tela: o Tirar diz que ja saiu.
  const tirar = await screenActions.hideScreenItem({ displayId: randomUUID() });
  assert.deepEqual([tirar.ok, tirar.status], [false, 404]);
  assert.deepEqual(escritas(db, antes), []);
});

test("sem permissão: Salvar, Excluir, Enviar imagem, Mostrar e Tirar respondem 403 sem tocar no banco", async () => {
  const db = usar(cenarioDaTela());
  estado.negar = true;
  for (const chamada of [
    () => screenActions.saveScreenItem({ kind: "banner", title: "Oi", webinarId: WEBINAR }),
    () => screenActions.archiveScreenItem({ id: BANNER }),
    () => screenActions.uploadScreenImage({ image: dataUrlDe(webpBytes(800, 450)) }),
    () => screenActions.showScreenItem({ itemId: BANNER, sessionId: SESSION }),
    () => screenActions.hideScreenItem({ displayId: randomUUID() })
  ]) {
    const result = await chamada();
    assert.deepEqual([result.ok, result.status], [false, 403]);
  }
  assert.equal(db.calls.from.length, 0);
  estado.negar = false;
});

/* ------------------------------------------------------------------------------------------------
 * Rodada v9 (P11, docs/30 D89): o comentario ou a pergunta na tela (showScreenComment, hideScreenComment)
 * ---------------------------------------------------------------------------------------------- */

const screenQueries = await import("../src/server/webinars/screen-queries.ts");
const AVISO_V9 = WEBINAR_COPY.exportar.migracaoPendente("202611150001");
const MSG_ALUNA = "dddddddd-0000-4000-8000-000000000a01";
const MSG_PENDENTE = "dddddddd-0000-4000-8000-000000000a02";
const MSG_APAGADA = "dddddddd-0000-4000-8000-000000000a03";
const MSG_DE_OUTRA = "dddddddd-0000-4000-8000-000000000a04";
const MSG_EQUIPE = "dddddddd-0000-4000-8000-000000000a05";
const PERGUNTA = "dddddddd-0000-4000-8000-000000000b01";
const PERGUNTA_DISPENSADA = "dddddddd-0000-4000-8000-000000000b02";
const PERGUNTA_DE_OUTRA = "dddddddd-0000-4000-8000-000000000b03";

/** A escola com mensagens e perguntas na sessao no ar (e uma de cada em outra sessao) e a tabela dos comentarios na tela. */
function cenarioDoComentario() {
  const tables = cenario();
  const base = { ...DEFAULTS.webinar_chat_messages, author_user_id: ALUNA, created_at: iso(Date.now() - MIN), display_name: "Ana M.", offset_ms: 60_000, role: "student", session_id: SESSION, source: "audience", webinar_id: WEBINAR };
  tables.webinar_chat_messages.push(
    { ...base, body: "Como faz isso?", id: MSG_ALUNA },
    { ...base, approved: false, body: "Esperando a equipe", id: MSG_PENDENTE },
    { ...base, body: "Apagada", deleted_at: iso(Date.now()), deleted_reason: "team", id: MSG_APAGADA },
    { ...base, body: "De outra sessão", id: MSG_DE_OUTRA, session_id: OTHER_SESSION, webinar_id: OTHER_WEBINAR },
    { ...base, author_user_id: EQUIPE, body: "Bem-vindos!", display_name: "Produtor T.", id: MSG_EQUIPE, role: "host", source: "team" }
  );
  const pergunta = { ...DEFAULTS.webinar_questions, body: "Posso fazer?", created_at: iso(Date.now() - MIN), display_name: "Ana M.", offset_ms: 60_000, session_id: SESSION, updated_at: iso(Date.now()), user_id: ALUNA };
  tables.webinar_questions.push({ ...pergunta, id: PERGUNTA }, { ...pergunta, id: PERGUNTA_DISPENSADA, status: "dismissed" }, { ...pergunta, id: PERGUNTA_DE_OUTRA, session_id: OTHER_SESSION });
  tables.webinar_screen_comments = [];
  tables.webinar_screen_displays = [];
  return tables;
}

DEFAULTS.webinar_screen_comments = { hidden_at: null, hidden_by: null, hidden_offset_ms: null, hidden_reason: null, message_id: null, question_id: null, shown_offset_ms: null };
const comentarios = (db) => db.tables.webinar_screen_comments;
const ativos = (db, sessionId = SESSION) => comentarios(db).filter((row) => row.session_id === sessionId && row.hidden_at === null);

test("Mostrar na tela: a mensagem do chat entra so com a referencia (nunca o texto), o carimbo por ultimo e a auditoria sem texto; a mesma de novo nao grava nada; outra troca (replaced); a sala le o cartao da origem", async () => {
  const db = usar(cenarioDoComentario());
  const antes = db.calls.writes.length;

  const mostrado = ok(await screenActions.showScreenComment({ messageId: MSG_ALUNA, sessionId: SESSION }));
  assert.deepEqual([mostrado.changed, mostrado.source, mostrado.sourceId, mostrado.replaced], [true, "chat", MSG_ALUNA, 0]);
  assert.deepEqual(escritas(db, antes), ["update webinar_screen_comments", "insert webinar_screen_comments", "update webinar_sessions"], "tira o que estava, grava o novo e o carimbo por ultimo");
  const [linha] = ativos(db);
  assert.deepEqual([linha.source, linha.message_id, linha.question_id, linha.shown_by], ["chat", MSG_ALUNA, null, EQUIPE]);
  assert.ok(Math.abs(linha.shown_offset_ms - 10 * MIN) < 10_000, "o minuto da sessao");
  assert.doesNotMatch(JSON.stringify(linha), /Como faz isso|Ana M\./, "nem o texto nem o nome sao copiados para a exibicao");
  const [auditoria] = audits(db, "webinar.screen_comment_shown");
  assert.deepEqual(auditoria.metadata, { display_id: mostrado.displayId, replaced: 0, session_id: SESSION, source: "chat", source_id: MSG_ALUNA });
  assert.doesNotMatch(JSON.stringify(auditoria), /Como faz isso/, "o texto nunca vai para a auditoria");
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}/sala`));

  // A sala le o cartao da origem: o nome que o chat mostra, o texto, sem papel (aluno) e sem foto (sem aceite em dia).
  const cartao = await screenQueries.loadScreenComment(db, { id: SESSION, webinarId: WEBINAR }, Date.now());
  assert.deepEqual(cartao, { avatar: "person", avatarUrl: null, body: "Como faz isso?", displayId: mostrado.displayId, name: "Ana M.", role: null, shownAt: linha.shown_at, source: "chat", sourceId: MSG_ALUNA });

  // A mesma de novo: nada gravado.
  const meio = db.calls.writes.length;
  const deNovo = ok(await screenActions.showScreenComment({ messageId: MSG_ALUNA, sessionId: SESSION }));
  assert.deepEqual([deNovo.changed, deNovo.displayId], [false, mostrado.displayId]);
  assert.deepEqual(escritas(db, meio), []);

  // Outra (a da equipe) entra no lugar: um por vez.
  const outra = ok(await screenActions.showScreenComment({ messageId: MSG_EQUIPE, sessionId: SESSION }));
  assert.deepEqual([outra.changed, outra.replaced], [true, 1]);
  assert.equal(ativos(db).length, 1, "um comentario na tela por sessao");
  assert.equal(comentarios(db).find((row) => row.id === mostrado.displayId).hidden_reason, "replaced");
  const daEquipe = await screenQueries.loadScreenComment(db, { id: SESSION, webinarId: WEBINAR }, Date.now());
  assert.deepEqual([daEquipe.name, daEquipe.role, daEquipe.body], ["Produtor T.", "host", "Bem-vindos!"], "a equipe com o selo do papel");
});

test("Mostrar na tela: a pergunta da sessao entra; a dispensada, a de outra sessao, a mensagem que espera a equipe, a apagada e a de outra sessao voltam 404 sem gravar; duas ou nenhuma origem, 400", async () => {
  const db = usar(cenarioDoComentario());
  const pergunta = ok(await screenActions.showScreenComment({ questionId: PERGUNTA, sessionId: SESSION }));
  assert.deepEqual([pergunta.source, pergunta.sourceId], ["question", PERGUNTA]);
  const [linha] = ativos(db);
  assert.deepEqual([linha.source, linha.question_id, linha.message_id], ["question", PERGUNTA, null]);
  const cartao = await screenQueries.loadScreenComment(db, { id: SESSION, webinarId: WEBINAR }, Date.now());
  assert.deepEqual([cartao.source, cartao.name, cartao.body, cartao.role, cartao.avatar], ["question", "Ana M.", "Posso fazer?", null, "person"]);

  const antes = db.calls.writes.length;
  for (const [rotulo, input] of [
    ["a pergunta dispensada (so o autor a ve)", { questionId: PERGUNTA_DISPENSADA }],
    ["a pergunta de outra sessao", { questionId: PERGUNTA_DE_OUTRA }],
    ["a pergunta que nao existe", { questionId: randomUUID() }],
    ["a mensagem que espera a equipe", { messageId: MSG_PENDENTE }],
    ["a mensagem apagada", { messageId: MSG_APAGADA }],
    ["a mensagem de outra sessao", { messageId: MSG_DE_OUTRA }]
  ]) {
    const recusado = await screenActions.showScreenComment({ ...input, sessionId: SESSION });
    assert.deepEqual([recusado.ok, recusado.status, recusado.error], [false, 404, WEBINAR_COPY.naTela.erros.comentarioSumiu], rotulo);
  }
  assert.equal((await screenActions.showScreenComment({ messageId: MSG_ALUNA, questionId: PERGUNTA, sessionId: SESSION })).status, 400, "as duas origens");
  assert.equal((await screenActions.showScreenComment({ sessionId: SESSION })).status, 400, "nenhuma origem");
  assert.deepEqual(escritas(db, antes), [], "nada gravado nas recusas");
  assert.equal(ativos(db)[0].question_id, PERGUNTA, "a pergunta continua na tela");
});

test("Tirar da tela: o comentario sai com o motivo team, o carimbo muda e a auditoria registra; sem nada na tela, nada muda; a sala nao recebe mais o cartao", async () => {
  const db = usar(cenarioDoComentario());
  const vazio = ok(await screenActions.hideScreenComment({ sessionId: SESSION }));
  assert.equal(vazio.hidden, false);
  assert.equal(audits(db, "webinar.screen_comment_hidden").length, 0);

  const mostrado = ok(await screenActions.showScreenComment({ messageId: MSG_ALUNA, sessionId: SESSION }));
  const antes = db.calls.writes.length;
  const tirado = ok(await screenActions.hideScreenComment({ sessionId: SESSION }));
  assert.equal(tirado.hidden, true);
  assert.deepEqual(escritas(db, antes), ["update webinar_screen_comments", "update webinar_sessions"]);
  const linha = comentarios(db).find((row) => row.id === mostrado.displayId);
  assert.deepEqual([linha.hidden_reason, linha.hidden_by, Boolean(linha.hidden_at)], ["team", EQUIPE, true]);
  assert.deepEqual(audits(db, "webinar.screen_comment_hidden")[0].metadata, { display_id: mostrado.displayId, session_id: SESSION, source: "chat" });
  assert.equal(await screenQueries.loadScreenComment(db, { id: SESSION, webinarId: WEBINAR }, Date.now()), null);
});

test("a origem removida sai da tela: a mensagem que a equipe apaga e a pergunta dispensada tiram o comentario na hora (motivo removed) e mudam o carimbo; a leitura nunca desenha a origem apagada", async () => {
  const db = usar(cenarioDoComentario());
  const mostrado = ok(await screenActions.showScreenComment({ messageId: MSG_ALUNA, sessionId: SESSION }));
  // Um carimbo antigo de proposito: a troca nao depende de duas escritas cairem em milissegundos diferentes.
  sessao(db).updated_at = "2026-01-01T00:00:00.000Z";
  const carimboAntes = sessao(db).updated_at;
  ok(await roomActions.moderateMessage({ action: "delete", messageId: MSG_ALUNA }));
  const linha = comentarios(db).find((row) => row.id === mostrado.displayId);
  assert.deepEqual([linha.hidden_reason, linha.hidden_by, Boolean(linha.hidden_at)], ["removed", null, true], "saiu sozinho quando a mensagem foi apagada");
  assert.notEqual(sessao(db).updated_at, carimboAntes, "o carimbo muda: a sala ve em ate 5 s");
  assert.equal(ativos(db).length, 0);

  const daPergunta = ok(await screenActions.showScreenComment({ questionId: PERGUNTA, sessionId: SESSION }));
  ok(await roomActions.setQuestionStatus({ questionId: PERGUNTA, status: "dismissed" }));
  assert.equal(comentarios(db).find((row) => row.id === daPergunta.displayId).hidden_reason, "removed", "a pergunta dispensada some para a turma");

  // A defesa da leitura: uma exibicao ainda ativa de uma origem apagada (outro caminho apagou) nunca e desenhada.
  comentarios(db).push({ ...DEFAULTS.webinar_screen_comments, created_at: iso(Date.now()), id: randomUUID(), message_id: MSG_APAGADA, session_id: SESSION, shown_at: iso(Date.now()), shown_by: EQUIPE, source: "chat" });
  assert.equal(await screenQueries.loadScreenComment(db, { id: SESSION, webinarId: WEBINAR }, Date.now()), null);
});

test("o comentario na tela: no Replay e na sessao encerrada ou cancelada, 409; sem permissao, 403 sem tocar no banco; banco sem a 202611150001, 409 com o aviso e a sala segue sem comentario", async () => {
  const db = usar(cenarioDoComentario());
  for (const [sessionId, frase] of [[REPLAY, WEBINAR_COPY.naTela.erros.replay], [ENCERRADA, WEBINAR_COPY.naTela.erros.sessaoFechada], [CANCELADA, WEBINAR_COPY.naTela.erros.sessaoFechada]]) {
    const mostrar = await screenActions.showScreenComment({ messageId: MSG_ALUNA, sessionId });
    assert.deepEqual([mostrar.status, mostrar.error], [409, frase], sessionId);
    const tirar = await screenActions.hideScreenComment({ sessionId });
    assert.deepEqual([tirar.status, tirar.error], [409, frase], sessionId);
  }
  assert.equal(comentarios(db).length, 0);

  estado.negar = true;
  const reads = db.calls.from.length;
  assert.equal((await screenActions.showScreenComment({ messageId: MSG_ALUNA, sessionId: SESSION })).status, 403);
  assert.equal((await screenActions.hideScreenComment({ sessionId: SESSION })).status, 403);
  assert.equal(db.calls.from.length, reads, "sem tocar no banco");
  estado.negar = false;

  const sem = semMigracao(usar(cenarioDoComentario()), ["webinar_screen_comments"]);
  const antes = sem.calls.writes.length;
  const mostrar = await screenActions.showScreenComment({ messageId: MSG_ALUNA, sessionId: SESSION });
  assert.deepEqual([mostrar.ok, mostrar.status, mostrar.error], [false, 409, AVISO_V9]);
  const tirar = await screenActions.hideScreenComment({ sessionId: SESSION });
  assert.deepEqual([tirar.ok, tirar.status, tirar.error], [false, 409, AVISO_V9]);
  assert.deepEqual(escritas(sem, antes), []);
  assert.equal(await screenQueries.loadScreenComment(sem, { id: SESSION, webinarId: WEBINAR }, Date.now()), null, "sem a tabela, a sala segue como antes");
  // Apagar uma mensagem num banco sem a tabela continua funcionando (nao ha o que tirar da tela).
  ok(await roomActions.moderateMessage({ action: "delete", messageId: MSG_ALUNA }));
});
