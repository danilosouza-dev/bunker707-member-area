import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Deploy antes da migracao 202610170004 (retencao): a Vercel pode publicar o codigo antes de alguem rodar a
// migracao no SQL Editor. A fila de e-mail e caminho critico (boas-vindas com o convite, e-mail de compra),
// entao o job `email-outbox` precisa funcionar num banco que so tem as colunas criadas em 202610170002.
//
// O banco falso abaixo conhece SO essas colunas, lidas do proprio arquivo da migracao, e responde como o
// PostgREST quando o pedido cita uma coluna que nao existe (codigo 42703). O job roda de verdade: busca a
// fila, reserva a linha, envia pelo provedor falso e grava o resultado.

const outbox = await import("../src/server/email/outbox.ts");

const MIGRATION_0002 = new URL("../supabase/migrations/202610170002_email_outbox.sql", import.meta.url);

/** Colunas de `email_outbox` como a 0002 cria (uma por linha, recuadas em 2 espacos). */
async function columnsCreatedBy0002() {
  const sql = await readFile(MIGRATION_0002, "utf8");
  const body = /create table if not exists public\.email_outbox \(([\s\S]*?)\n\);/.exec(sql)?.[1];
  assert.ok(body, "achei o create table de email_outbox na 0002");

  // Coluna = linha com exatamente 2 espacos antes do nome; os `check` de varias linhas tem 4.
  const names = body.split("\n").map((line) => /^ {2}([a-z_]+) /.exec(line)?.[1]);

  return new Set(names.filter((name) => name && name !== "check" && name !== "constraint"));
}

const toTime = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : value);

/**
 * PostgREST de mentira para uma tabela so: select/update/eq/lt/lte/gte/order/limit sobre linhas em memoria,
 * recusando (como o PostgREST) qualquer coluna que a tabela nao tem.
 */
function bancoSoCom(columns, rows) {
  const pedidos = [];

  function builder(table) {
    const state = { error: null, filters: [], head: false, limit: null, op: "select", orders: [], patch: null, selected: null };
    const fail = (column) => {
      state.error ??= { code: "42703", message: `column ${table}.${column} does not exist` };
    };
    const check = (column) => {
      if (!columns.has(column)) {
        fail(column);
      }
    };
    const filter = (column, test) => {
      check(column);
      state.filters.push((row) => test(toTime(row[column])));
      return chain;
    };
    const chain = {
      eq: (column, value) => filter(column, (current) => current === toTime(value)),
      gte: (column, value) => filter(column, (current) => current !== null && current >= toTime(value)),
      limit: (count) => ((state.limit = count), chain),
      lt: (column, value) => filter(column, (current) => current !== null && current < toTime(value)),
      lte: (column, value) => filter(column, (current) => current !== null && current <= toTime(value)),
      order: (column, options = {}) => {
        check(column);
        state.orders.push({ ascending: options.ascending !== false, column });
        return chain;
      },
      select: (list = "*", options = {}) => {
        state.selected = list === "*" ? [...columns] : list.split(",").map((name) => name.trim());
        state.selected.forEach(check);
        state.head = Boolean(options.head);
        return chain;
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
      update: (patch) => {
        Object.keys(patch).forEach(check);
        state.op = "update";
        state.patch = patch;
        return chain;
      }
    };

    function run() {
      pedidos.push({ op: state.op, selected: state.selected, table });

      if (state.error) {
        return { count: null, data: null, error: state.error };
      }

      let matched = rows.filter((row) => state.filters.every((test) => test(row)));

      if (state.op === "update") {
        matched.forEach((row) => Object.assign(row, state.patch, { updated_at: new Date().toISOString() }));
      }

      for (const { ascending, column } of [...state.orders].reverse()) {
        matched = [...matched].sort((a, b) => (toTime(a[column]) > toTime(b[column]) ? 1 : -1) * (ascending ? 1 : -1));
      }

      if (state.limit !== null) {
        matched = matched.slice(0, state.limit);
      }

      if (state.head) {
        return { count: matched.length, data: null, error: null };
      }

      if (!state.selected) {
        return { count: null, data: null, error: null };
      }

      return { count: null, data: matched.map((row) => Object.fromEntries(state.selected.map((name) => [name, row[name]]))), error: null };
    }

    return chain;
  }

  return {
    from(table) {
      return builder(table);
    },
    pedidos
  };
}

function linhaNaFila(columns, overrides = {}) {
  const now = new Date().toISOString();
  const row = {
    attempts: 0,
    bounced_at: null,
    created_at: now,
    delivered_at: null,
    html: "<p>Boas-vindas</p>",
    id: "00000000-0000-4000-8000-0000000000e1",
    idempotency_key: "welcome:00000000-0000-4000-8000-000000000042",
    kind: "welcome",
    last_error: null,
    metadata: { password_hint: "invite" },
    next_attempt_at: now,
    provider: null,
    provider_message_id: null,
    sent_at: null,
    status: "queued",
    subject: "Seu acesso à Bunker707",
    text: "Boas-vindas",
    to_email: "aluna.nova@bunker707.test",
    updated_at: now,
    user_id: "00000000-0000-4000-8000-000000000042",
    ...overrides
  };

  assert.deepEqual(Object.keys(row).sort(), [...columns].sort(), "a linha de teste tem exatamente as colunas da 0002");

  return row;
}

test("as colunas lidas da 0002 sao as da fila original, sem a marca da retencao", async () => {
  const columns = await columnsCreatedBy0002();

  assert.equal(columns.size, 20);
  assert.ok(columns.has("to_email") && columns.has("html") && columns.has("idempotency_key"));
  assert.equal(columns.has("anonymized_at"), false, "anonymized_at so nasce na 0004");

  const lidasPeloJob = outbox.EMAIL_OUTBOX_COLUMNS.split(",");
  assert.deepEqual(lidasPeloJob.filter((name) => !columns.has(name)), [], "o job so le colunas que a 0002 cria");
});

test("banco sem a migracao 0004: o job envia a fila, grava sent e conta o dia sem citar coluna que nao existe", async () => {
  const columns = await columnsCreatedBy0002();
  const fila = [linhaNaFila(columns)];
  const db = bancoSoCom(columns, fila);
  const enviados = [];

  const result = await outbox.processEmailOutbox({
    dailyLimit: 10,
    db,
    from: "Teste <teste@bunker707.test>",
    pauseMs: 0,
    provider: {
      name: "fake",
      async send(message) {
        enviados.push(message);
        return { ok: true, providerMessageId: "msg-sem-0004" };
      }
    },
    replyTo: null
  });

  assert.equal(result.sent, 1, JSON.stringify(result));
  assert.equal(result.failed, 0);
  assert.equal(result.queued, 0);
  assert.deepEqual(
    enviados.map((message) => [message.to, message.subject, message.idempotencyKey]),
    [["aluna.nova@bunker707.test", "Seu acesso à Bunker707", "welcome:00000000-0000-4000-8000-000000000042"]]
  );
  assert.equal(fila[0].status, "sent");
  assert.equal(fila[0].provider_message_id, "msg-sem-0004");
  assert.ok(fila[0].sent_at);
  assert.ok(db.pedidos.length > 0 && db.pedidos.every((pedido) => pedido.table === "email_outbox"));
});

test("banco sem a migracao 0004: o limite do dia conta o que ja saiu e o resto espera, sem erro", async () => {
  const columns = await columnsCreatedBy0002();
  const hoje = new Date().toISOString();
  const fila = [
    linhaNaFila(columns, { id: "00000000-0000-4000-8000-0000000000e2", idempotency_key: "welcome:ja-saiu", sent_at: hoje, status: "sent" }),
    linhaNaFila(columns, { id: "00000000-0000-4000-8000-0000000000e3", idempotency_key: "welcome:espera" })
  ];
  const db = bancoSoCom(columns, fila);

  const result = await outbox.processEmailOutbox({
    dailyLimit: 1,
    db,
    from: "Teste <teste@bunker707.test>",
    pauseMs: 0,
    provider: { name: "fake", send: async () => assert.fail("o limite do dia ja tinha acabado") },
    replyTo: null
  });

  assert.equal(result.remainingToday, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.queued, 1, "a linha continua na fila para o dia seguinte");
  assert.equal(fila[1].status, "queued");
});
