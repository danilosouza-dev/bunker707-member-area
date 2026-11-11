import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { DEFAULTS, MIN, OTHER_WEBINAR, REPLAY, SESSION, UNIQUE, WEBINAR, bancoFalso, escola, iso } from "./support/webinarios-sala-banco.mjs";

// A "Nova enquete" do console (D83; pedido do produtor de 11/11/2026: "poderia ser possível criar diretamente no console
// a enquete"), sem banco: o banco falso das rotas da Sala (tests/support/webinarios-sala-banco.mjs: as tabelas como
// listas e cada escrita anotada em `calls.writes`, na ordem) com a escola de mentira (a Live gravada no ar e as sessoes
// encerrada, cancelada e o Replay). A permissao e a sessao da equipe sao dubles; "next/cache" so anota. Aqui:
// - createConsolePoll cria UMA enquete pronta (session_id nulo) no fim das prontas, sem mexer nas outras (nem na criada
//   por outra pessoa da equipe no meio), com a auditoria `webinar.poll_created` so com ids e contagens;
// - "Abrir agora" e "Abrir e fixar" abrem (e fixam) pelo mesmo caminho do Abrir das prontas (a copia aberta da nova,
//   o carimbo da sessao por ultimo, `webinar.poll_launched`), so com a sessao aceitando a equipe; fora disso, so
//   "Guardar nas prontas"; o fixar que falha depois de guardar volta como `launchError`, com a enquete nas prontas;
// - o teto de 20 prontas por webinario (CHAT_LIMITS.pollTemplatesMax): 409 antes de gravar e, na corrida que passa
//   dele, so a que ficou de fora do teto pela ordem das prontas (created_at, id) desfaz a propria (a revisao v8, achado
//   7: nunca as duas); as recusas (campos pelo mesmo zod do editor, sessao que nao existe, webinario
//   arquivado, banco sem a 202611100002 no fixar, sem permissao) nunca gravam nada;
// - o savePolls do editor so apaga dos modelos que o card carregou (`loadedIds`): a enquete criada no console com a
//   pagina do editor aberta fica, o teto conta com ela, e o pedido sem os ids (a pagina de antes) nao apaga nada.
// O mesmo contra o banco local esta em tests/integration/webinarios-enquete-no-console.test.mjs.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const estado = (globalThis.__enqueteNoConsole ??= { negar: false, revalidados: [] });
const EQUIPE = "00000000-0000-4000-8000-0000000000e1";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole() {
          if (globalThis.__enqueteNoConsole.negar) {
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
        export function revalidatePath(path) { globalThis.__enqueteNoConsole.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__enqueteNoConsole.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__enqueteNoConsole.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "equipe.teste@bunker707.test", id: EQUIPE, user_metadata: { full_name: "Equipe de Teste" } } };

const roomActions = await import("../src/server/webinars/room-actions.ts");
const { CHAT_MESSAGES } = await import("../src/server/webinars/chat-schemas.ts");
const { CHAT_LIMITS } = await import("../src/server/webinars/model.ts");
const { GENERIC_ACTION_ERROR } = await import("../src/lib/action-result.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

// O indice unico parcial da 202611100002 (uma exibicao ativa por tipo e sessao) e as colunas com padrao das enquetes.
UNIQUE.webinar_screen_displays = [["session_id", "kind", "hidden_at"]];
DEFAULTS.webinar_screen_displays = { hidden_at: null, hidden_by: null, hidden_offset_ms: null, hidden_reason: null, item_id: null, poll_id: null, shown_offset_ms: null };
DEFAULTS.webinar_polls = { closed_at: null, open_offset_ms: null, opened_at: null, results_shared_at: null, template_poll_id: null };

/* ------------------------------------------------------------------------------------------------
 * Cenario: a Live gravada no ar com duas prontas e uma copia aberta; as sessoes encerrada, cancelada e o Replay no ar
 * ---------------------------------------------------------------------------------------------- */

const ENCERRADA = "cccccccc-0000-4000-8000-0000000000e2";
const CANCELADA = "cccccccc-0000-4000-8000-0000000000e3";
const PRONTA_1 = "dddddddd-0000-4000-8000-000000000001";
const PRONTA_2 = "dddddddd-0000-4000-8000-000000000002";
const COPIA_ABERTA = "dddddddd-0000-4000-8000-000000000003";
const DE_OUTRO_WEBINAR = "dddddddd-0000-4000-8000-000000000004";
const SESSAO_FECHADA = "Essa sessão não aceita mais ações da equipe.";

function enquete(id, extra = {}) {
  return {
    anonymous: false,
    closed_at: null,
    created_at: iso(Date.now() - 30 * MIN),
    created_by: EQUIPE,
    id,
    kind: "single",
    open_offset_ms: null,
    opened_at: null,
    position: 0,
    question: `Pergunta ${id.slice(-1)}?`,
    results_shared_at: null,
    session_id: null,
    status: "draft",
    template_poll_id: null,
    updated_at: iso(Date.now() - 30 * MIN),
    webinar_id: WEBINAR,
    ...extra
  };
}

const opcoes = (pollId) => [
  { created_at: iso(Date.now() - 30 * MIN), id: randomUUID(), label: "Sim", poll_id: pollId, position: 0 },
  { created_at: iso(Date.now() - 30 * MIN), id: randomUUID(), label: "Não", poll_id: pollId, position: 1 }
];

function cenario() {
  const tables = escola();
  const now = Date.now();
  const noAr = tables.webinar_sessions.find((row) => row.id === SESSION);
  Object.assign(noAr, { started_at: iso(now - 10 * MIN), status: "live" });
  Object.assign(tables.webinar_sessions.find((row) => row.id === REPLAY), { status: "live" });
  tables.webinar_sessions.push(
    { ...noAr, ended_at: iso(now - 30 * MIN), id: ENCERRADA, scheduled_at: iso(now - 2 * 60 * MIN), started_at: iso(now - 2 * 60 * MIN), status: "ended" },
    { ...noAr, id: CANCELADA, scheduled_at: iso(now + 60 * MIN), started_at: null, status: "cancelled" }
  );
  tables.webinar_polls = [
    enquete(PRONTA_1, { position: 0, question: "Vem na próxima?" }),
    enquete(PRONTA_2, { position: 1, question: "Gostou da aula?" }),
    enquete(COPIA_ABERTA, { opened_at: iso(now - 5 * MIN), question: "Vem na próxima?", session_id: SESSION, status: "open", template_poll_id: PRONTA_1 }),
    enquete(DE_OUTRO_WEBINAR, { position: 7, webinar_id: OTHER_WEBINAR })
  ];
  tables.webinar_poll_options = tables.webinar_polls.flatMap((poll) => opcoes(poll.id));
  tables.webinar_screen_displays = [];
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
const prontas = (db, webinarId = WEBINAR) => db.tables.webinar_polls.filter((row) => row.webinar_id === webinarId && row.session_id === null);
/** As escritas do teste (sem a auditoria), na ordem, como "op tabela". */
const escritas = (db, desde = 0) =>
  db.calls.writes
    .slice(desde)
    .filter((write) => write.table !== "admin_audit_log")
    .map((write) => `${write.op} ${write.table}`);
const nova = (extra = {}) => ({ kind: "multiple", options: [{ label: "  Prompts  " }, { label: "Agentes" }], question: "  Qual tema na próxima?  ", sessionId: SESSION, ...extra });

/**
 * Outra pessoa da equipe grava uma enquete pronta no meio: logo antes da proxima gravacao em webinar_polls (a nossa),
 * entra a dela, como a corrida de dois consoles abertos.
 */
function comOutraPessoaNoMeio(db, linha) {
  const from = db.from;
  let feito = false;
  db.from = (name) => {
    const chain = from(name);
    if (name !== "webinar_polls" || feito) {
      return chain;
    }
    const insert = chain.insert;
    chain.insert = (payload) => {
      if (!feito) {
        feito = true;
        db.tables.webinar_polls.push(linha);
        db.tables.webinar_poll_options.push(...opcoes(linha.id));
      }
      return insert(payload);
    };
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
  db.from = (name) => (name === "webinar_screen_displays" ? (db.calls.from.push(name), semTabela()) : from(name));
  return db;
}

/** Toda gravacao em webinar_screen_displays esbarra no indice unico (outra pessoa fixou entre o tirar e o gravar, duas vezes). */
function comFixarSempreOcupado(db) {
  const from = db.from;
  db.from = (name) => {
    const chain = from(name);
    if (name !== "webinar_screen_displays") {
      return chain;
    }
    const insert = chain.insert;
    chain.insert = (payload) => {
      insert(payload);
      const ocupado = { select: () => ocupado, single: () => ocupado, then: (resolve, reject) => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key (webinar_screen_displays)" } }).then(resolve, reject) };
      return ocupado;
    };
    return chain;
  };
  return db;
}

/* ------------------------------------------------------------------------------------------------
 * Guardar nas prontas
 * ---------------------------------------------------------------------------------------------- */

test("Guardar nas prontas: UMA enquete pronta no fim (depois da maior posicao), sem sessao, com as opcoes na ordem e sem espacos; as outras, a copia aberta e a tela nao mudam; a auditoria so com ids e contagens; o editor revalidado", async () => {
  const db = usar();
  const antes = structuredClone(db.tables.webinar_polls);

  const criada = ok(await roomActions.createConsolePoll(nova()));
  assert.deepEqual([criada.launched, criada.launchError, criada.pinned], [null, null, false]);
  assert.deepEqual(
    [criada.poll.sessionId, criada.poll.status, criada.poll.templatePollId, criada.poll.position, criada.poll.kind, criada.poll.anonymous, criada.poll.question],
    [null, "draft", null, 2, "multiple", false, "Qual tema na próxima?"]
  );
  assert.deepEqual(criada.poll.options.map((option) => option.label), ["Prompts", "Agentes"]);
  assert.deepEqual(escritas(db), ["insert webinar_polls", "insert webinar_poll_options"], "so a pronta nova: nenhuma copia, nada na sessao nem na tela");
  assert.deepEqual(db.tables.webinar_polls.filter((row) => row.id !== criada.poll.id), antes, "as outras enquetes como estavam");
  assert.equal(prontas(db).length, 3);

  const [linha] = audits(db, "webinar.poll_created");
  assert.equal(linha.entity_id, WEBINAR);
  assert.deepEqual(linha.metadata, { kind: "multiple", launch: "save", options: 2, poll_id: criada.poll.id, session_id: SESSION });
  assert.doesNotMatch(JSON.stringify(audits(db, "webinar.poll_created")), /Qual tema|Prompts/, "a pergunta e as opcoes nunca vao para a auditoria");
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}`), "o card do editor relido");
});

test("uma pronta criada por outra pessoa da equipe no meio fica: a nova entra depois dela e nenhuma outra muda", async () => {
  const db = comOutraPessoaNoMeio(usar(), enquete("dddddddd-0000-4000-8000-0000000000aa", { created_at: iso(Date.now()), position: 2, question: "Da outra pessoa?" }));
  const criada = ok(await roomActions.createConsolePoll(nova()));
  assert.deepEqual(
    prontas(db)
      .sort((a, b) => a.position - b.position)
      .map((row) => [row.position, row.question]),
    [
      [0, "Vem na próxima?"],
      [1, "Gostou da aula?"],
      [2, "Da outra pessoa?"],
      [2, "Qual tema na próxima?"]
    ],
    "a posicao vem da leitura de antes; a ordem de criacao desempata"
  );
  assert.equal(criada.poll.position, 2);
  assert.equal(escritas(db).filter((write) => write.startsWith("delete")).length, 0, "nada apagado");
});

/* ------------------------------------------------------------------------------------------------
 * Abrir agora e Abrir e fixar, pelo caminho do Abrir
 * ---------------------------------------------------------------------------------------------- */

test("Abrir agora: guarda e abre na sessao pelo caminho do Abrir (a copia aberta da nova no minuto do servidor, o carimbo por ultimo, poll_launched); nada fixado", async () => {
  const db = usar();
  const criada = ok(await roomActions.createConsolePoll(nova({ launch: "open" })));
  assert.equal(criada.launchError, null);
  assert.equal(criada.pinned, false);
  assert.deepEqual([criada.launched.sessionId, criada.launched.status, criada.launched.templatePollId, criada.launched.question], [SESSION, "open", criada.poll.id, "Qual tema na próxima?"]);
  assert.deepEqual(criada.launched.options.map((option) => option.label), ["Prompts", "Agentes"]);
  assert.ok(Math.abs(criada.launched.openOffsetMs - 10 * MIN) < 10_000, "o minuto da sessao pelo relogio do servidor");
  assert.deepEqual(escritas(db), ["insert webinar_polls", "insert webinar_poll_options", "insert webinar_polls", "insert webinar_poll_options", "update webinar_sessions"]);
  const carimbo = db.calls.writes.find((write) => write.op === "update" && write.table === "webinar_sessions");
  assert.deepEqual(Object.keys(carimbo.payload), ["updated_at"], "so o carimbo muda na sessao");
  assert.deepEqual(audits(db, "webinar.poll_launched").map((row) => [row.metadata.poll_id, row.metadata.template_poll_id, row.metadata.session_id]), [[criada.launched.id, criada.poll.id, SESSION]]);
  assert.equal(db.tables.webinar_screen_displays.length, 0);
  assert.equal(audits(db, "webinar.poll_created")[0].metadata.launch, "open");
});

test("Abrir e fixar: guarda, abre e fixa (a fixada de antes sai como replaced), o carimbo por ultimo e a linha poll_launched com pinned", async () => {
  const db = usar();
  ok(await roomActions.pinPoll({ pollId: COPIA_ABERTA, sessionId: SESSION }));
  const antes = db.calls.writes.length;

  const criada = ok(await roomActions.createConsolePoll(nova({ launch: "pin" })));
  assert.equal(criada.pinned, true);
  assert.equal(criada.launchError, null);
  assert.deepEqual(escritas(db, antes), [
    "insert webinar_polls",
    "insert webinar_poll_options",
    "insert webinar_polls",
    "insert webinar_poll_options",
    "update webinar_screen_displays",
    "insert webinar_screen_displays",
    "update webinar_sessions"
  ]);
  const ativas = db.tables.webinar_screen_displays.filter((row) => row.session_id === SESSION && row.kind === "poll" && row.hidden_at === null);
  assert.deepEqual(ativas.map((row) => [row.poll_id, row.snapshot.name]), [[criada.launched.id, "Qual tema na próxima?"]]);
  assert.equal(db.tables.webinar_screen_displays.find((row) => row.poll_id === COPIA_ABERTA).hidden_reason, "replaced");
  const lancada = audits(db, "webinar.poll_launched").at(-1);
  assert.deepEqual([lancada.metadata.pinned, lancada.metadata.replaced], [true, 1]);
});

test("o fixar que falha depois de guardar (o indice unico ocupado duas vezes): a enquete fica nas prontas e aberta, e o resultado volta com launchError em vez de falhar", async () => {
  const db = comFixarSempreOcupado(usar());
  const criada = ok(await roomActions.createConsolePoll(nova({ launch: "pin" })));
  assert.deepEqual(criada.launchError, { message: GENERIC_ACTION_ERROR, status: 409 });
  assert.deepEqual([criada.launched, criada.pinned], [null, false]);
  assert.ok(prontas(db).some((row) => row.id === criada.poll.id), "a nova esta nas prontas: o formulario fecha sem criar outra");
  assert.equal(db.tables.webinar_polls.filter((row) => row.template_poll_id === criada.poll.id && row.status === "open").length, 1, "a copia abriu (a turma ve a enquete)");
  assert.equal(escritas(db).at(-1), "update webinar_sessions", "o carimbo da sessao mudou mesmo assim");
});

/* ------------------------------------------------------------------------------------------------
 * O teto e as recusas
 * ---------------------------------------------------------------------------------------------- */

test("o teto de 20 prontas por webinario: a 20a entra; a 21a recebe 409 (Até 20 enquetes por webinário.) e nada e gravado; as copias e as de outro webinario nao contam", async () => {
  assert.equal(CHAT_LIMITS.pollTemplatesMax, 20);
  assert.equal(CHAT_MESSAGES.tooManyPolls, "Até 20 enquetes por webinário.");
  const tables = cenario();
  for (let index = 2; index < 19; index += 1) {
    tables.webinar_polls.push(enquete(randomUUID(), { position: index }));
  }
  const db = usar(tables);
  assert.equal(prontas(db).length, 19);
  const vigesima = ok(await roomActions.createConsolePoll(nova()));
  assert.equal(vigesima.poll.position, 19);
  assert.equal(prontas(db).length, 20);

  const antes = db.calls.writes.length;
  const recusada = await roomActions.createConsolePoll(nova({ launch: "open" }));
  assert.deepEqual([recusada.ok, recusada.status, recusada.error], [false, 409, CHAT_MESSAGES.tooManyPolls]);
  assert.deepEqual(escritas(db, antes), [], "nada gravado");
  assert.equal(audits(db, "webinar.poll_created").length, 1);
});

test("a corrida no teto: duas pessoas criando com 19 prontas; quem passou dos 20 desfaz a propria e recebe o mesmo 409, a da outra pessoa fica", async () => {
  const tables = cenario();
  for (let index = 2; index < 19; index += 1) {
    tables.webinar_polls.push(enquete(randomUUID(), { position: index }));
  }
  const DA_OUTRA = "dddddddd-0000-4000-8000-0000000000bb";
  // A da outra pessoa entra antes da nossa (1 s antes, como o banco carimba): a 20a pela ordem e a dela.
  const db = comOutraPessoaNoMeio(usar(tables), enquete(DA_OUTRA, { created_at: iso(Date.now() - 1000), position: 19, question: "Da outra pessoa?" }));
  const recusada = await roomActions.createConsolePoll(nova({ launch: "open" }));
  assert.deepEqual([recusada.ok, recusada.status, recusada.error], [false, 409, CHAT_MESSAGES.tooManyPolls]);
  assert.equal(prontas(db).length, 20, "nunca passa do teto");
  assert.ok(prontas(db).some((row) => row.id === DA_OUTRA), "a da outra pessoa fica");
  assert.ok(!prontas(db).some((row) => row.question === "Qual tema na próxima?"), "a nossa foi desfeita");
  assert.deepEqual(escritas(db), ["insert webinar_polls", "insert webinar_poll_options", "delete webinar_polls"], "nada aberto");
  assert.equal(audits(db, "webinar.poll_created").length, 0);
});

test("revisao v8, achado 7: as duas criacoes ao mesmo tempo no teto (nenhuma viu a outra antes de gravar): a que entrou primeiro fica e abre; so a de depois desfaz", async () => {
  const tables = cenario();
  for (let index = 2; index < 19; index += 1) {
    tables.webinar_polls.push(enquete(randomUUID(), { position: index }));
  }
  const DEPOIS = "dddddddd-0000-4000-8000-0000000000cc";
  const db = usar(tables);
  // A outra pessoa grava a dela logo depois da nossa (as opcoes da nossa ja entrando), 1 s mais tarde: 21 prontas.
  const from = db.from;
  let feito = false;
  db.from = (name) => {
    const chain = from(name);
    if (name === "webinar_poll_options" && !feito) {
      const insert = chain.insert;
      chain.insert = (payload) => {
        feito = true;
        const linha = enquete(DEPOIS, { created_at: iso(Date.now() + 1000), position: 19, question: "Da outra pessoa?" });
        db.tables.webinar_polls.push(linha);
        db.tables.webinar_poll_options.push(...opcoes(linha.id));
        return insert(payload);
      };
    }
    return chain;
  };
  const nossa = ok(await roomActions.createConsolePoll(nova({ launch: "open" })));
  assert.ok(nossa.launched, "a nossa (a 20a pela ordem) fica e abre");
  assert.ok(prontas(db).some((row) => row.id === nossa.poll.id));
  assert.equal(audits(db, "webinar.poll_created").length, 1);
  // A da outra pessoa e a 21a pela mesma ordem: a acao dela, ao contar de novo, desfaz so a dela.
  const ordem = prontas(db).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : 1));
  assert.equal(ordem.findIndex((row) => row.id === DEPOIS), 20);
  assert.ok(ordem.findIndex((row) => row.id === nossa.poll.id) < 20);
});

test("fora da sessao: Abrir agora e Abrir e fixar na sessao encerrada, cancelada e no Replay recebem 409 antes de gravar; Guardar nas prontas nelas funciona; sessao que nao existe 404", async () => {
  const db = usar();
  for (const sessionId of [ENCERRADA, CANCELADA, REPLAY]) {
    for (const launch of ["open", "pin"]) {
      const antes = db.calls.writes.length;
      const recusada = await roomActions.createConsolePoll(nova({ launch, sessionId }));
      assert.deepEqual([recusada.ok, recusada.status, recusada.error], [false, 409, SESSAO_FECHADA], `${sessionId} ${launch}`);
      assert.deepEqual(escritas(db, antes), [], "nada gravado");
    }
  }
  assert.equal(prontas(db).length, 2);

  const guardada = ok(await roomActions.createConsolePoll(nova({ sessionId: ENCERRADA })));
  assert.deepEqual([guardada.poll.sessionId, guardada.launched], [null, null], "na sessao encerrada, so nas prontas");
  assert.equal(prontas(db).length, 3);

  const sumiu = await roomActions.createConsolePoll(nova({ sessionId: randomUUID() }));
  assert.deepEqual([sumiu.ok, sumiu.status], [false, 404]);
});

test("os campos pelo mesmo zod do editor: pergunta vazia, uma opcao so, opcao vazia, 21 opcoes e o tipo desconhecido recebem 400 com o erro no caminho do campo; nada gravado", async () => {
  const db = usar();
  const casos = [
    [{ question: "   " }, "question", CHAT_MESSAGES.pollQuestion],
    [{ question: "x".repeat(CHAT_LIMITS.pollQuestion + 1) }, "question", CHAT_MESSAGES.pollQuestion],
    [{ options: [{ label: "Só uma" }] }, "options", CHAT_MESSAGES.options],
    [{ options: [{ label: "Sim" }, { label: "  " }] }, "options.1.label", CHAT_MESSAGES.option],
    [{ options: Array.from({ length: CHAT_LIMITS.pollOptionsMax + 1 }, (_, index) => ({ label: `Opção ${index + 1}` })) }, "options", CHAT_MESSAGES.options],
    [{ kind: "ranking" }, "kind", null],
    [{ launch: "agora" }, "launch", CHAT_MESSAGES.invalid]
  ];
  for (const [extra, campo, frase] of casos) {
    const recusada = await roomActions.createConsolePoll(nova(extra));
    assert.deepEqual([recusada.ok, recusada.status], [false, 400], campo);
    assert.ok(recusada.fieldErrors?.[campo], `${campo}: ${JSON.stringify(recusada.fieldErrors)}`);
    if (frase) {
      assert.equal(recusada.fieldErrors[campo][0], frase);
    }
  }
  assert.equal(CHAT_MESSAGES.option, "Escreva cada opção (até 120 caracteres).");
  assert.deepEqual(escritas(db), []);
});

test("o webinario arquivado: 409 com a frase do Desarquivar e nada gravado; banco sem a 202611100002: Abrir e fixar 409 com o aviso da migracao antes de gravar, Guardar e Abrir agora seguem", async () => {
  const arquivado = cenario();
  arquivado.webinars.find((row) => row.id === WEBINAR).status = "archived";
  const db = usar(arquivado);
  const recusada = await roomActions.createConsolePoll(nova());
  assert.deepEqual([recusada.ok, recusada.status, recusada.error], [false, 409, "Esse webinário está arquivado. Desarquive para mexer nele."]);
  assert.deepEqual(escritas(db), []);

  const semTela = semMigracao(usar());
  const aviso = WEBINAR_COPY.exportar.migracaoPendente("202611100002");
  const fixar = await roomActions.createConsolePoll(nova({ launch: "pin" }));
  assert.deepEqual([fixar.ok, fixar.status, fixar.error], [false, 409, aviso]);
  assert.deepEqual(escritas(semTela), [], "nada nasce sem a migracao");
  ok(await roomActions.createConsolePoll(nova()));
  const aberta = ok(await roomActions.createConsolePoll(nova({ launch: "open", question: "Outra?" })));
  assert.equal(aberta.launched.status, "open");
});

test("sem permissão: a Nova enquete responde 403 sem tocar no banco", async () => {
  const db = usar();
  estado.negar = true;
  for (const launch of ["save", "open", "pin"]) {
    const result = await roomActions.createConsolePoll(nova({ launch }));
    assert.deepEqual([result.ok, result.status], [false, 403]);
  }
  assert.equal(db.calls.from.length, 0);
  estado.negar = false;
});

/* ------------------------------------------------------------------------------------------------
 * O card Enquetes do editor com a pagina aberta: so apaga do que carregou
 * ---------------------------------------------------------------------------------------------- */

test("o Salvar do editor com a pagina velha (loadedIds sem a enquete do console) nao apaga a criada no console; tirar do card uma carregada apaga so ela; sem loadedIds, nada sai", async () => {
  const db = usar();
  // O editor abriu e carregou as duas prontas; depois, no console, a Nova enquete.
  const carregados = [PRONTA_1, PRONTA_2];
  const doConsole = ok(await roomActions.createConsolePoll(nova())).poll;

  // O editor tira a segunda e salva a primeira como carregou.
  const salvo = ok(
    await roomActions.savePolls({
      loadedIds: carregados,
      polls: [{ id: PRONTA_1, kind: "single", options: [{ label: "Sim" }, { label: "Não" }], question: "Vem na próxima?" }],
      webinarId: WEBINAR
    })
  );
  assert.deepEqual([salvo.created, salvo.updated, salvo.deleted], [0, 1, 1]);
  assert.deepEqual(salvo.polls.map((poll) => poll.question).sort(), ["Qual tema na próxima?", "Vem na próxima?"], "a do console fica e volta para o card");
  assert.ok(prontas(db).some((row) => row.id === doConsole.id));
  assert.ok(!prontas(db).some((row) => row.id === PRONTA_2), "a que o editor carregou e tirou sai");
  assert.ok(db.tables.webinar_polls.some((row) => row.id === COPIA_ABERTA), "a copia lancada nunca sai pelo Salvar");

  // Sem os ids carregados (o pedido da pagina de antes), nada sai.
  const semIds = ok(await roomActions.savePolls({ polls: [], webinarId: WEBINAR }));
  assert.deepEqual([semIds.deleted, semIds.polls.length], [0, 2]);
});

test("o teto no Salvar do editor conta a criada no console sem a pagina ter carregado: 20 no card mais 1 do console, 409 antes de gravar", async () => {
  const db = usar();
  ok(await roomActions.createConsolePoll(nova()));
  const vinte = Array.from({ length: 20 }, (_, index) => ({ kind: "single", options: [{ label: "Sim" }, { label: "Não" }], question: `Pergunta ${index + 1}?` }));
  const antes = db.calls.writes.length;
  const recusado = await roomActions.savePolls({ loadedIds: [PRONTA_1, PRONTA_2], polls: vinte, webinarId: WEBINAR });
  assert.deepEqual([recusado.ok, recusado.status, recusado.error], [false, 409, CHAT_MESSAGES.tooManyPolls]);
  assert.deepEqual(escritas(db, antes), []);
  // Com a do console carregada e tirada, os 20 cabem.
  const doConsole = prontas(db).find((row) => row.question === "Qual tema na próxima?");
  const salvo = ok(await roomActions.savePolls({ loadedIds: [PRONTA_1, PRONTA_2, doConsole.id], polls: vinte, webinarId: WEBINAR }));
  assert.deepEqual([salvo.created, salvo.deleted, salvo.polls.length], [20, 3, 20]);
});
