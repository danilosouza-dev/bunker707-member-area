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

