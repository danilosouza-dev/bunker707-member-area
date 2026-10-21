import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Job "comunicacao" do tick de minuto (docs/22 §4.2 e §4.3): sem trabalho, termina rapido sem ler os alunos;
// banco sem a migracao 202610200001 nao derruba o tick (o job registra e termina); recalculo de pop-up que
// falha espera a faixa seguinte de 15 minutos (sem last_error, que daria 409 no editor); notificacao
// agendada sem aprovacao que passou de 500 alunos volta para aprovacao em vez de sair; e a contagem de
// comentarios por aluno e lida em paginas (o PostgREST corta RPC em 1000 linhas). O envio e o recalculo
// de verdade estao em tests/integration/avisos-e-notificacoes.test.mjs e tests/integration/pop-ups.test.mjs.

const { dispatchInboxCampaign, processCommunications } = await import("../src/server/communications/dispatch.ts");
const { COMMENT_COUNTS_PAGE, fetchCommentCounts } = await import("../src/server/communications/audience-facts.ts");
const { COMMUNICATIONS_JOB_NAME, communicationsJob } = await import("../src/server/jobs/communications-job.ts");

/** Banco falso: toda consulta, com qualquer filtro, devolve `result`; registra tabelas e RPCs pedidas. */
function fakeDb(result) {
  const calls = { from: [], rpc: [] };
  const chain = () =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
          }

          return () => chain();
        }
      }
    );

  return {
    calls,
    from(table) {
      calls.from.push(table);
      return chain();
    },
    rpc(name) {
      calls.rpc.push(name);
      return chain();
    }
  };
}

/**
 * Banco falso com roteiro: cada consulta (from ou rpc) e anotada com a operacao, o que foi gravado e os
 * filtros, e a resposta vem de `respond(consulta)`. Serve para conferir o que o job grava.
 */
function scriptedDb(respond) {
  const queries = [];

  function chain(query) {
    return new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (resolve, reject) => Promise.resolve(respond(query)).then(resolve, reject);
          }

          return (...args) => {
            if (["delete", "insert", "select", "update", "upsert"].includes(property) && !query.op) {
              query.op = property;
              query.payload = args[0];
            } else {
              query.filters.push([property, ...args]);
            }

            return chain(query);
          };
        }
      }
    );
  }

  return {
    queries,
    from(table) {
      const query = { filters: [], op: null, payload: undefined, table };
      queries.push(query);
      return chain(query);
    },
    rpc(name, args) {
      const query = { args, filters: [], op: "rpc", payload: undefined, table: name };
      queries.push(query);
      return chain(query);
    }
  };
}

const filterOf = (query, name) => query.filters.find(([method]) => method === name);
const isPopupQuery = (query) => query.filters.some(([method, column, value]) => method === "eq" && column === "kind" && value === "popup");
const contexto = (supabase) => ({ runId: "run", signal: new AbortController().signal, supabase, tickRunId: "tick", tickStartedAt: new Date() });

test("banco sem aviso para enviar nem pop-up no ar: o job termina sem ler os alunos", async () => {
  const db = fakeDb({ data: [], error: null });
  const result = await processCommunications({ db, now: new Date("2026-10-20T15:00:00.000Z") });

  assert.deepEqual(result, { awaitingApproval: 0, dispatched: 0, failed: 0, pendingMigration: false, refreshed: 0, sending: 0 });
  assert.deepEqual([...new Set(db.calls.from)], ["campaigns"], "so procura avisos vencidos e pop-ups no ar");
  assert.deepEqual(db.calls.rpc, [], "nenhuma leitura de comentarios ou alunos");
  await communicationsJob.run(contexto(db));
});

test("banco sem a migracao da Comunicacao: o job registra e termina sem erro (o tick continua verde)", async () => {
  const db = fakeDb({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.campaigns' in the schema cache" } });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));

  try {
    const result = await processCommunications({ db });
    assert.equal(result.pendingMigration, true);
    await assert.doesNotReject(() => communicationsJob.run(contexto(db)));
  } finally {
    console.error = original;
  }

  assert.ok(errors.some((line) => line.includes("migracao 202610200001 pendente")), errors.join("\n"));
});

test("erro de banco que nao e migracao pendente continua sendo falha do job (aparece em job_runs)", async () => {
  const db = fakeDb({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });

  await assert.rejects(() => communicationsJob.run(contexto(db)), /statement timeout/);
});

test("o nome do job segue a regra do registro do tick", () => {
  assert.equal(COMMUNICATIONS_JOB_NAME, "comunicacao");
  assert.equal(communicationsJob.name, COMMUNICATIONS_JOB_NAME);
  assert.match(communicationsJob.name, /^[a-z0-9][a-z0-9-]{0,119}$/);
});

/* ------------------------------------------------------------------------------------------------
 * Recalculo que falha, aprovacao na hora do envio e comentarios em paginas
 * ---------------------------------------------------------------------------------------------- */

const POPUP = {
  audience: { kind: "everyone" },
  audience_refreshed_at: "2026-10-20T14:40:00.000Z",
  id: "0f8f7c2e-3b1a-4c55-9d7e-2a6b8c9d0e1f",
  kind: "popup",
  status: "active",
  updated_at: "2026-10-20T10:00:00.000000+00:00"
};

test("recalculo do pop-up que falha grava so a hora do recalculo: tenta de novo na faixa seguinte, nao a cada minuto", async () => {
  const now = new Date("2026-10-20T15:07:42.000Z");
  const db = scriptedDb((query) => {
    if (query.table === "campaigns" && query.op === "select") {
      return { data: isPopupQuery(query) ? [POPUP] : [], error: null };
    }

    if (query.table === "campaigns" && query.op === "update") {
      return { data: [{ ...POPUP, ...query.payload }], error: null };
    }

    if (query.table === "profiles") {
      return { count: null, data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    }

    return { count: 0, data: [], error: null };
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));

  try {
    const result = await processCommunications({ db, now });
    assert.equal(result.failed, 1, JSON.stringify(result));
    assert.equal(result.refreshed, 0);
  } finally {
    console.error = original;
  }

  const busca = db.queries.find((query) => query.table === "campaigns" && query.op === "select" && isPopupQuery(query));
  assert.ok(
    busca.filters.some(([method, value]) => method === "or" && value.includes('audience_refreshed_at.lt."2026-10-20T15:00:00.000Z"')),
    "vencido = recalculado antes do comeco da faixa de 15 minutos"
  );

  const gravacoes = db.queries.filter((query) => query.table === "campaigns" && query.op === "update");
  assert.deepEqual(gravacoes.map((query) => query.payload), [{ audience_refreshed_at: now.toISOString() }], "so a hora; nada de last_error");
  assert.ok(gravacoes[0].filters.some(([method, column, values]) => method === "in" && column === "status" && values.includes("active")));
  assert.ok(errors.some((line) => line.includes("nao recalculado")), errors.join("\n"));
});

/** Fatos de `total` alunos (o segmento "todos" nao olha os fatos). */
function alunos(total) {
  return {
    context: { commentRanks: {}, lessonTotals: {}, now: Date.parse("2026-10-20T15:00:00.000Z") },
    facts: Array.from({ length: total }, (_, index) => ({ userId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` })),
    people: new Map()
  };
}

const AGENDADA = {
  approved_at: null,
  audience: { kind: "everyone" },
  dispatch_attempts: 0,
  id: "5a1d7c2e-3b1a-4c55-9d7e-2a6b8c9d0e1f",
  kind: "inbox",
  recipients_count: null,
  send_at: "2026-10-20T14:59:00.000Z",
  status: "sending",
  updated_by: "00000000-0000-4000-8000-0000000000aa"
};

function envioDb(recipients) {
  return scriptedDb((query) => {
    if (query.table === "campaigns" && query.op === "update") {
      return { data: [{ ...AGENDADA, ...query.payload }], error: null };
    }

    if (query.table === "notifications" && query.op === "select" && filterOf(query, "eq")?.[1] === "campaign_id" && query.payload === "id") {
      return { count: recipients, data: null, error: null };
    }

    return { data: [], error: null };
  });
}

test("notificacao agendada sem aprovacao que passou de 500 alunos volta para 'Aguardando aprovação' em vez de sair", async () => {
  const now = new Date("2026-10-20T15:00:00.000Z");
  const db = envioDb(0);
  const result = await dispatchInboxCampaign({ campaign: AGENDADA, db, loaded: alunos(501), now });

  assert.deepEqual(result, { recipients: 0, status: "pending_approval" });
  assert.ok(!db.queries.some((query) => query.table === "notifications"), "nenhuma linha do sino");

  const [volta] = db.queries.filter((query) => query.table === "campaigns" && query.op === "update");
  assert.deepEqual(volta.payload, {
    audience_count: 501,
    audience_counted_at: now.toISOString(),
    dispatch_started_at: null,
    requested_at: now.toISOString(),
    requested_by: AGENDADA.updated_by,
    send_at: null,
    status: "pending_approval"
  });
  assert.ok(volta.filters.some(([method, column, values]) => method === "in" && column === "status" && values.includes("sending")), "so sai do envio reservado");

  const [auditoria] = db.queries.filter((query) => query.table === "admin_audit_log");
  assert.equal(auditoria.payload.action, "communication.approval_requested");
  assert.equal(auditoria.payload.actor_id, AGENDADA.updated_by);
  assert.equal(auditoria.payload.count, 501);
  assert.deepEqual(auditoria.payload.metadata, { kind: "inbox", reason: "grew_after_schedule" });
});

test("ate 500 alunos, ou aprovada (ou publicada por quem pode publicar para muitos), a notificacao agendada sai", async () => {
  const now = new Date("2026-10-20T15:00:00.000Z");

  const ate500 = envioDb(500);
  assert.deepEqual(await dispatchInboxCampaign({ campaign: AGENDADA, db: ate500, loaded: alunos(500), now }), { recipients: 500, status: "sent" });

  const aprovada = envioDb(501);
  const resultado = await dispatchInboxCampaign({ campaign: { ...AGENDADA, approved_at: "2026-10-20T12:00:00.000Z" }, db: aprovada, loaded: alunos(501), now });
  assert.deepEqual(resultado, { recipients: 501, status: "sent" });
  const linhas = aprovada.queries.filter((query) => query.table === "notifications" && query.op === "upsert").flatMap((query) => query.payload);
  assert.equal(linhas.length, 501);
  assert.ok(!aprovada.queries.some((query) => query.table === "admin_audit_log"));
});

test("comentarios por aluno: a RPC e lida em paginas de 1000 na ordem do autor (o PostgREST corta em 1000 sem erro)", async () => {
  const linha = (index) => ({
    author_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    comments_30d: 2,
    comments_7d: 1,
    comments_90d: "3",
    comments_total: "4"
  });
  const db = scriptedDb((query) => {
    const [, from] = filterOf(query, "range");
    const total = 1_003;

    return { data: Array.from({ length: Math.max(0, Math.min(COMMENT_COUNTS_PAGE, total - from)) }, (_, offset) => linha(from + offset)), error: null };
  });

  const counts = await fetchCommentCounts(db);

  assert.equal(COMMENT_COUNTS_PAGE, 1_000);
  assert.equal(counts.size, 1_003, "quem passa do teto tambem conta");
  assert.deepEqual(counts.get(linha(1_002).author_id), { d30: 2, d7: 1, d90: 3, total: 4 });
  assert.deepEqual(
    db.queries.map((query) => [query.table, filterOf(query, "order")?.[1], filterOf(query, "range")?.slice(1)]),
    [
      ["communication_comment_counts", "author_id", [0, 999]],
      ["communication_comment_counts", "author_id", [1000, 1999]]
    ]
  );

  const exata = scriptedDb((query) => ({ data: filterOf(query, "range")[1] === 0 ? Array.from({ length: 1_000 }, (_, index) => linha(index)) : [], error: null }));
  assert.equal((await fetchCommentCounts(exata)).size, 1_000);
  assert.equal(exata.queries.length, 2, "pagina cheia: confere a seguinte (vazia) antes de parar");
});


/* ------------------------------------------------------------------------------------------------
 * Comunicacao v2 (docs/23 §4.3): a fase dos fluxos no mesmo job, o carregador de fatos por chave, a
 * bisseccao, o lote devolvido e as contagens em job_runs. O motor de verdade (banco local) esta em
 * tests/integration/fluxos.test.mjs.
 * ---------------------------------------------------------------------------------------------- */

const { EMPTY_FLOWS, processFlows } = await import("../src/server/communications/flow-engine.ts");
const { createFactsLoader } = await import("../src/server/communications/facts-loader.ts");
const flowStore = await import("../src/server/communications/flow-store.ts");

const FORA_DA_FAIXA = new Date("2026-10-20T15:07:00.000Z");
const NA_FAIXA = new Date("2026-10-20T15:15:20.000Z");
const AVISO = "7b2e8d1c-3b1a-4c55-9d7e-2a6b8c9d0e1f";
const FLUXO = "1c2d3e4f-3b1a-4c55-9d7e-2a6b8c9d0e1f";
const naoOuviuOAviso = {
  kind: "rules",
  root: { items: [{ action: "audio_completed", negate: true, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" }], match: "all" }
};
const temFiltro = (query, method, column, value) => query.filters.some(([name, col, val]) => name === method && col === column && (value === undefined || val === value));

function fluxoDoConstrutor(extra = {}) {
  return {
    entry_audience: naoOuviuOAviso,
    entry_mode: "current",
    entry_refreshed_at: null,
    goal: null,
    id: FLUXO,
    origin: "builder",
    source_campaign_id: null,
    status: "active",
    updated_at: "2026-10-20T10:00:00.000000+00:00",
    watched_page_keys: [],
    ...extra
  };
}

test("fluxos sem trabalho: tres consultas pequenas, nenhuma RPC e nenhum aluno lido (no minuto da faixa, uma a mais)", async () => {
  const db = scriptedDb(() => ({ count: 0, data: [], error: null }));
  const result = await processFlows({ db, now: FORA_DA_FAIXA });

  assert.equal(result.worked, false);
  assert.deepEqual(db.queries.map((query) => query.table).sort(), ["communication_flow_tasks", "communication_flows", "communication_flows"]);
  assert.ok(db.queries.every((query) => query.op === "select"), "so leitura");

  const tarefas = db.queries.find((query) => query.table === "communication_flow_tasks");
  assert.ok(temFiltro(tarefas, "eq", "flow_active", true), "so o indice parcial dos fluxos no ar (pausado nao custa nada)");
  assert.ok(temFiltro(tarefas, "limit", 1));

  const naFaixa = scriptedDb(() => ({ count: 0, data: [], error: null }));
  await processFlows({ db: naFaixa, now: NA_FAIXA });
  assert.equal(naFaixa.queries.length, 4);
});

test("aviso com seguintes ainda agendado: so mais uma leitura pequena de campaigns, nada de alunos nem de RPC", async () => {
  const db = scriptedDb((query) => {
    if (query.table === "communication_flows" && temFiltro(query, "eq", "origin", "notice")) {
      return { data: [{ id: FLUXO, source_campaign_id: AVISO }], error: null };
    }

    return { count: 0, data: [], error: null };
  });
  const result = await processFlows({ db, now: FORA_DA_FAIXA });

  assert.equal(result.worked, false);
  assert.deepEqual(db.queries.map((query) => query.table).sort(), ["campaigns", "communication_flow_tasks", "communication_flows", "communication_flows"]);
  const avisos = db.queries.find((query) => query.table === "campaigns");
  assert.ok(temFiltro(avisos, "eq", "status", "sent"));
});

test("as duas fases dividem os fatos do tick: alunos lidos uma vez, e as linhas do aviso citado uma vez (dois pop-ups e a entrada de um fluxo)", async () => {
  const popup = (id) => ({ ...POPUP, audience: naoOuviuOAviso, id });
  const db = scriptedDb((query) => {
    if (query.table === "campaigns" && query.op === "select") {
      if (isPopupQuery(query)) {
        return { data: [popup("0f8f7c2e-3b1a-4c55-9d7e-2a6b8c9d0e01"), popup("0f8f7c2e-3b1a-4c55-9d7e-2a6b8c9d0e02")], error: null };
      }

      if (query.payload === "id,status,sent_at,deleted_at") {
        return { data: [{ deleted_at: null, id: AVISO, sent_at: "2026-10-19T12:00:00.000Z", status: "sent" }], error: null };
      }
    }

    if (query.table === "campaigns" && query.op === "update") {
      return { data: [{ ...POPUP, ...query.payload }], error: null };
    }

    if (query.table === "communication_flows" && query.op === "select" && temFiltro(query, "eq", "origin", "builder")) {
      return { data: [fluxoDoConstrutor()], error: null };
    }

    if (query.table === "communication_flows" && query.op === "update") {
      return { data: [{ id: FLUXO }], error: null };
    }

    return { count: 0, data: [], error: null };
  });
  const infos = [];
  const original = console.info;
  console.info = (...args) => infos.push(args.join(" "));

  try {
    await communicationsJob.run(contexto(db));
  } finally {
    console.info = original;
  }

  assert.equal(db.queries.filter((query) => query.table === "profiles").length, 1, "fatos base uma vez por tick");
  assert.equal(db.queries.filter((query) => query.table === "notifications" && query.op === "select").length, 1, "linhas do aviso citado uma vez por tick");
  assert.equal(db.queries.filter((query) => query.payload === "id,status,sent_at,deleted_at").length, 1);
  assert.equal(db.queries.filter((query) => query.table === "campaigns" && query.op === "update").length, 2, "os dois pop-ups recalculados");

  const fezEntrada = db.queries.find((query) => query.table === "communication_flows" && query.op === "update");
  assert.deepEqual(Object.keys(fezEntrada.payload).sort(), ["entry_count", "entry_counted_at", "entry_refreshed_at"], "so colunas do job (nao mudam a versao do editor)");
  assert.ok(temFiltro(fezEntrada, "eq", "updated_at", fluxoDoConstrutor().updated_at), "so se ninguem mudou o fluxo no meio");

  const [metricas] = db.queries.filter((query) => query.table === "job_runs");
  assert.ok(metricas, "houve trabalho de fluxo: as contagens vao para job_runs");
  assert.equal(metricas.op, "update");
  assert.equal(metricas.payload.metadata.tick_run_id, "tick", "o tick_run_id do run-tick.ts fica");
  assert.deepEqual(Object.keys(metricas.payload.metadata.flows).sort(), [
    "backfilled",
    "claimed",
    "decided",
    "deferred",
    "entered",
    "failed",
    "finished",
    "job_ms",
    "ms",
    "sent",
    "skipped",
    "woken"
  ]);
  assert.ok(temFiltro(metricas, "eq", "id", "run"), "a linha do proprio job");
  assert.ok(infos.some((line) => /^\[comunicacao\] fluxos: 0 conferidas, 0 enviadas, 0 adiadas, 0 puladas, 0 falha\(s\), 0 entraram, \d+ ms\.$/.test(line)), infos.join("\n"));
});

test("sem trabalho de fluxo, o job nao grava nada em job_runs (o run-tick.ts registra o inicio e o fim)", async () => {
  const db = scriptedDb(() => ({ count: 0, data: [], error: null }));

  await communicationsJob.run(contexto(db));
  assert.ok(!db.queries.some((query) => query.table === "job_runs"));
});

test("o carregador por chave le os alunos uma vez e cada aviso uma vez, e marca so as chaves lidas", async () => {
  const OUTRO = "8c3f9e2d-3b1a-4c55-9d7e-2a6b8c9d0e1f";
  const db = scriptedDb((query) => {
    if (query.table === "campaigns") {
      return { data: (filterOf(query, "in")?.[2] ?? []).map((id) => ({ deleted_at: null, id, sent_at: "2026-10-19T12:00:00.000Z", status: "sent" })), error: null };
    }

    return { count: 0, data: [], error: null };
  });
  const facts = createFactsLoader(db, FORA_DA_FAIXA);
  const base = await facts.load([]);
  const comAviso = await facts.load([AVISO]);
  await facts.load([AVISO]);
  const comOsDois = await facts.load([OUTRO, AVISO]);

  assert.equal(db.queries.filter((query) => query.table === "profiles").length, 1);
  assert.deepEqual(
    db.queries.filter((query) => query.table === "campaigns").map((query) => filterOf(query, "in")[2]),
    [[AVISO], [OUTRO]]
  );
  assert.deepEqual([...base.context.messageKeys], []);
  assert.deepEqual([...comAviso.context.messageKeys], [`campaign:${AVISO}`]);
  assert.deepEqual([...comOsDois.context.messageKeys].sort(), [`campaign:${AVISO}`, `campaign:${OUTRO}`].sort());
});

test("o carregador guarda a falha: a leitura que cai nunca vira rejeicao solta, e quem espera recebe o erro", async () => {
  const db = scriptedDb(() => ({ count: null, data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);

  try {
    const facts = createFactsLoader(db, FORA_DA_FAIXA);
    facts.load([AVISO]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(() => facts.load([]), /statement timeout/);
  } finally {
    process.off("unhandledRejection", listener);
  }

  assert.deepEqual(unhandled, []);
});

test("fase dos fluxos para no signal: com o tick abortado, nada e reservado", async () => {
  const controller = new AbortController();
  controller.abort();
  const db = scriptedDb((query) => (query.table === "communication_flow_tasks" ? { data: [{ node_id: "x" }], error: null } : { count: 0, data: [], error: null }));
  const result = await processFlows({ db, now: FORA_DA_FAIXA, signal: controller.signal });

  assert.equal(result.claimed, 0);
  assert.ok(!db.queries.some((query) => query.op === "rpc"), "nenhuma reserva");
});

test("banco sem a migracao 202610200002: a fase dos fluxos registra e volta (pendingMigration), o job continua verde", async () => {
  const db = scriptedDb((query) =>
    query.table.startsWith("communication_flow")
      ? { data: null, error: { code: "42P01", message: 'relation "public.communication_flow_tasks" does not exist' } }
      : { count: 0, data: [], error: null }
  );
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));

  try {
    const result = await processFlows({ db, now: FORA_DA_FAIXA });
    assert.equal(result.pendingMigration, true);
    await assert.doesNotReject(() => communicationsJob.run(contexto(db)));
  } finally {
    console.error = original;
  }

  assert.ok(errors.some((line) => line.includes("migracao 202610200002 pendente")), errors.join("\n"));
  assert.deepEqual(EMPTY_FLOWS.worked, false);
});

const tarefaReservada = (n) => ({
  anchor_at: "2026-10-20T14:00:00.000+00:00",
  attempts: 1,
  claimed_at: `2026-10-20T15:07:00.00012${n}+00:00`,
  deadline_at: null,
  deferrals: 0,
  due_at: "2026-10-20T15:00:00+00:00",
  flow_active: true,
  flow_id: FLUXO,
  node_id: `3d4e5f60-3b1a-4c55-9d7e-2a6b8c9d0e0${n}`,
  not_before: null,
  status: "running",
  user_id: `00000000-0000-4000-8000-00000000000${n}`
});

test("lote que falha antes de aplicar (fatos fora do ar) devolve as reservas e a tentativa; nada e aplicado", async () => {
  const reservadas = [tarefaReservada(1), tarefaReservada(2)];
  const db = scriptedDb((query) => {
    if (query.table === "communication_flow_tasks") {
      return { data: [{ node_id: "x" }], error: null };
    }

    if (query.op === "rpc" && query.table === "communication_claim_flow_tasks") {
      return { data: reservadas, error: null };
    }

    if (query.op === "rpc" && query.table === "communication_release_flow_tasks") {
      return { data: 2, error: null };
    }

    if (query.table === "communication_flows" && temFiltro(query, "in", "id")) {
      return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    }

    return { count: 0, data: [], error: null };
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let result;

  try {
    result = await processFlows({ db, now: FORA_DA_FAIXA });
  } finally {
    console.error = original;
  }

  const devolucao = db.queries.find((query) => query.table === "communication_release_flow_tasks");
  assert.deepEqual(
    devolucao.args.p_claims,
    reservadas.map((task) => ({ claimed_at: task.claimed_at, node_id: task.node_id, user_id: task.user_id })),
    "o carimbo exato de cada reserva"
  );
  assert.ok(!db.queries.some((query) => query.table === "communication_apply_flow_results"));
  assert.equal(result.claimed, 2);
  assert.ok(errors.some((line) => line.includes("devolvido")), errors.join("\n"));
});

test("bisseccao: uma tarefa ruim (erro 23xxx) termina sozinha como 'failed'; as outras do lote sao aplicadas", async () => {
  const tarefas = [tarefaReservada(1), tarefaReservada(2), tarefaReservada(3)];
  const ruim = tarefas[1].node_id;
  const chamadas = [];
  const db = scriptedDb((query) => {
    const results = query.args.p_results;
    chamadas.push(results.map((item) => [item.node_id === ruim ? "ruim" : "boa", item.action]));

    if (results.some((item) => item.node_id === ruim && item.action === "send")) {
      return { data: null, error: { code: "23514", message: 'new row for relation "notifications" violates check constraint "notifications_expires_v2"' } };
    }

    return { data: results.map((item) => ({ outcome: item.action === "send" ? "send" : item.result, sent_notification_id: null, task_node_id: item.node_id, task_user_id: item.user_id })), error: null };
  });
  const decisao = { action: "send", campaignId: AVISO, children: [], deadlineAt: null, expiresAt: Date.parse("2026-10-21T15:00:00.000Z") };
  const original = console.error;
  console.error = () => undefined;
  let outcomes;

  try {
    outcomes = await flowStore.applyFlowResults(db, { now: FORA_DA_FAIXA, results: tarefas.map((task) => ({ decision: decisao, task })) });
  } finally {
    console.error = original;
  }

  assert.deepEqual(outcomes.map((row) => row.outcome), ["send", "failed", "send"]);
  assert.ok(chamadas.some((call) => JSON.stringify(call) === JSON.stringify([["ruim", "finish"]])), "a ruim vai sozinha, como falha");
  assert.deepEqual(chamadas[0].length, 3, "primeiro o lote inteiro");
  assert.equal(chamadas.flat().filter(([tipo, action]) => tipo === "boa" && action === "send").length >= 2, true);
  assert.equal(db.queries[0].args.p_daily_cap, 3);
  assert.equal(db.queries[0].args.p_min_gap_minutes, 60);
  assert.equal(db.queries[0].args.p_max_deferrals, 7);
  assert.equal(db.queries[0].args.p_day_start, "2026-10-20T03:00:00.000Z", "dia de Sao Paulo");
  assert.equal(db.queries[0].args.p_results[0].claimed_at, tarefas[0].claimed_at, "carimbo da reserva exatamente como veio");
});

test("bisseccao nao engole erro de conexao ou de tempo: o lote inteiro falha (o job aparece em job_runs)", async () => {
  const db = scriptedDb(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));
  const decisao = { action: "defer", deadlineAt: null, dueAt: Date.parse("2026-10-21T15:00:00.000Z") };

  await assert.rejects(
    () => flowStore.applyFlowResults(db, { now: FORA_DA_FAIXA, results: [tarefaReservada(1), tarefaReservada(2)].map((task) => ({ decision: decisao, task })) }),
    /statement timeout/
  );
  assert.equal(db.queries.length, 1);
});

test("erros proprios dos RPCs dos fluxos viram a frase da tela com o status certo", () => {
  const erro = (code, message) => flowStore.flowRpcError({ code, message }, "Comunicacao: gravar fluxo");

  assert.deepEqual([erro("BK409", "Este fluxo mudou em outra tela.").status, erro("BK409", "Este fluxo mudou em outra tela.").message], [
    409,
    "Este fluxo mudou em outra tela há instantes. Recarregue a página para ver a versão atual."
  ]);
  assert.equal(erro("BK404", "Este fluxo nao existe mais.").status, 404);
  assert.equal(erro("BK422", "Para mudar a ordem, remova e crie de novo.").message, "Para mudar a ordem, remova e crie de novo.");
  assert.equal(erro("BK422", "Neste fluxo, quem entra foi decidido ao ativar.").message, "Neste fluxo, quem entra foi decidido ao ativar. Duplique para mudar.");
  assert.equal(erro("BK422", "O jeito de entrar nao muda depois de ativar.").message, "O jeito de entrar não muda depois de ativar. Duplique para mudar.");
  assert.equal(erro("BK422", "Para mudar a referencia de tempo, remova este passo e crie outro.").message, "Para mudar a referência de tempo, remova este passo e crie outro.");
  assert.equal(erro("23514", "check").code, "23514", "erro de banco guarda o codigo (bisseccao)");
});

test("nenhum select embute campaigns em communication_flows (ou o contrario) sem a dica da FK (senao PGRST201)", async () => {
  const { readFile } = await import("node:fs/promises");
  const files = ["flow-store.ts", "flow-queries.ts", "flow-facts.ts", "flow-engine.ts"];
  let checked = 0;

  for (const file of files) {
    let source;

    try {
      source = await readFile(new URL(`../src/server/communications/${file}`, import.meta.url), "utf8");
    } catch {
      continue;
    }

    checked += 1;

    for (const [, text] of source.matchAll(/select\(\s*[`"']([^`"']*)[`"']/g)) {
      for (const [, name, hint] of text.matchAll(/\b(campaigns|communication_flows)(![a-z_]+)?\s*\(/g)) {
        assert.ok(
          hint === "!communication_flows_source_campaign_id_fkey" || hint === "!campaigns_flow_id_fkey",
          `${file}: embed de ${name} sem a dica da FK em "${text}"`
        );
      }
    }
  }

  assert.ok(checked >= 3);
});
