import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Lembretes e avisos de live (docs/30 §2.7, §6.4 passo 2 e D27; entrega 1c), sem banco: um banco falso com roteiro
// (copia do de tests/comunicacao-job.test.mjs) guarda as sessoes e as vagas em memoria, aplica os filtros das
// consultas e anota o que o job grava. Aqui: o tick que marca a vaga, grava o sino e enfileira o e-mail uma vez por
// vaga; o tick seguinte que nao repete; a regra dos 50 min (so o de 1 h, com o de 24 h dado como feito); o "Hoje
// as" do 24 h atrasado; o texto da equipe; o e-mail desligado e o perfil sem e-mail; a equipe fora; webinario
// cancelado ou nao publicado sem lembrete; a marca perdida para outro tick; a sessao que encerra sozinha 2 h depois
// do fim previsto; a migracao pendente; o nome e as contagens do job; e os avisos de cancelada, remarcada e "Comecou
// agora" (notify.ts); o "Quem pode" na hora de enviar (a vaga e a ancora no Segmento e no "both"; no "Produto ou
// segmento", sem ancora, so o produto de agora ou o segmento de agora) e a vaga barrada conferida de novo so 15 min
// depois. O job contra o banco local fica para tests/integration/webinarios.test.mjs.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const { WEBINAR_REMINDER_ACCESS_MEMO, processWebinarReminders, scheduledStamp, webinarDedupeKey, webinarNoticeExpiresAt } = await import("../src/server/webinars/reminders.ts");
const { queueWebinarCancelledNotices, queueWebinarRescheduledNotices, queueWebinarStartedNotices } = await import("../src/server/webinars/notify.ts");
const { WEBINAR_REMINDERS_JOB_NAME, webinarRemindersJob } = await import("../src/server/jobs/webinar-reminders-job.ts");
const { EMAIL_KINDS, webinarIdempotencyKey } = await import("../src/server/email/outbox-rules.ts");
const { formatWebinarWhen } = await import("../src/lib/webinar-time.ts");

/**
 * Banco falso com roteiro: cada consulta (from ou rpc) e anotada com a operacao, o que foi gravado e os
 * filtros, e a resposta vem de `respond(consulta)`.
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

/** Um filtro do PostgREST sobre uma linha em memoria (eq, in, is, gte, lte e o `or` de session_id). */
function casa(row, [metodo, coluna, valor]) {
  switch (metodo) {
    case "eq":
      return row[coluna] === valor;
    case "in":
      return valor.includes(row[coluna]);
    case "is":
      return valor === null ? row[coluna] == null : row[coluna] === valor;
    case "gte":
      return row[coluna] >= valor;
    case "lte":
      return row[coluna] <= valor;
    case "or":
      return String(coluna)
        .split(",")
        .some((parte) => {
          const [col, op, val] = parte.split(".");
          return op === "eq" ? row[col] === val : row[col] == null;
        });
    default:
      return true;
  }
}

const aplicaFiltros = (rows, filters) => rows.filter((row) => filters.every((filtro) => casa(row, filtro)));
const filterOf = (query, name) => query.filters.find(([method]) => method === name);

const AGORA = "2026-11-04T23:30:00.000Z"; // 20:30 de 4/11 em Sao Paulo
const HORA_MARCADA = "2026-11-05T23:00:00.000Z"; // quinta, 5/11, 20:00 em Sao Paulo
const CRIADO = "2026-10-28T12:00:00.000Z";
const WEBINAR_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const SESSAO_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const ALUNA = "cccccccc-3333-4333-8333-333333333333";
const ALUNO = "dddddddd-4444-4444-8444-444444444444";
const EQUIPE = "eeeeeeee-5555-4555-8555-555555555555";
const ZEROS = { autoEnded: 0, emails: 0, pendingMigration: false, reminders1h: 0, reminders24h: 0, skipped: 0, withoutAccess: 0 };

function webinarRow(extra = {}) {
  return {
    access_mode: "everyone",
    allow_student_camera: true,
    audience: { kind: "everyone" },
    auto_record: true,
    cancel_reason: null,
    cancelled_at: null,
    capacity: null,
    chat_retention_days: 730,
    cover_url: null,
    created_at: CRIADO,
    created_by: null,
    deleted_at: null,
    description: null,
    duration_minutes: 60,
    host_user_id: null,
    id: WEBINAR_ID,
    kind: "live",
    product_id: null,
    published_at: CRIADO,
    quality: {},
    recording_retention_days: 730,
    registration_required: true,
    reminder_texts: {},
    reminders: { email: true, h1: true, h24: true },
    replay_days_on_home: 7,
    replay_lesson_target: null,
    room_settings: {},
    scheduled_at: HORA_MARCADA,
    show_banner: true,
    show_on_home: true,
    show_registered_count: false,
    slug: "live-de-agentes",
    status: "published",
    title: "Live de agentes",
    updated_at: CRIADO,
    ...extra
  };
}

function sessaoRow(extra = {}) {
  return {
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: CRIADO,
    ended_at: null,
    id: SESSAO_ID,
    kind: "live",
    late_join_minutes: null,
    recording_anchor_at: null,
    recording_id: null,
    scheduled_at: HORA_MARCADA,
    source_session_id: null,
    started_at: null,
    status: "scheduled",
    updated_at: CRIADO,
    webinar_id: WEBINAR_ID,
    ...extra
  };
}

/** Vaga geral do webinario (session_id nulo: vale para a sessao unica da Live ao vivo). */
function vagaRow(userId, extra = {}) {
  return {
    calendar_token: `token-${userId.slice(0, 8)}`,
    cancelled_at: null,
    cancelled_notice_sent_at: null,
    created_at: CRIADO,
    id: `ffffffff-0000-4000-8000-${userId.slice(0, 12)}`,
    registered_at: CRIADO,
    reminder_1h_sent_at: null,
    reminder_24h_sent_at: null,
    session_id: null,
    source: null,
    source_campaign_id: null,
    started_notice_sent_at: null,
    status: "registered",
    updated_at: CRIADO,
    user_id: userId,
    webinar_id: WEBINAR_ID,
    ...extra
  };
}

const perfil = (id, email, full_name) => ({ avatar_url: null, created_at: CRIADO, email, full_name, id, last_sign_in_at: null, phone: null });
const perfis = [perfil(ALUNA, "ana@exemplo.test", "Ana Souza"), perfil(ALUNO, "bruno@exemplo.test", "Bruno Lima")];

/**
 * O banco dos webinarios em memoria: as sessoes e as vagas mudam com os updates (as marcas dos lembretes, o
 * status da sessao); `marcasPerdidas` faz a marca daquela vaga falhar (outro tick chegou antes);
 * `emailJaNaFila` responde o upsert da fila como repetido.
 */
function bancoDosWebinarios({ acessos = [], emailJaNaFila = false, equipe = [], marcasPerdidas = [], perfis: contatos = perfis, sessoes = [sessaoRow()], turmas = [], vagas = [], webinars = [webinarRow()] } = {}) {
  const estado = { sessoes: sessoes.map((row) => ({ ...row })), vagas: vagas.map((row) => ({ ...row })) };
  let emails = 0;
  const db = scriptedDb((query) => {
    const single = query.filters.some(([method]) => method === "maybeSingle");
    const le = (rows) => {
      const achadas = aplicaFiltros(rows, query.filters);
      return { data: single ? (achadas[0] ?? null) : achadas, error: null };
    };
    const grava = (rows) => {
      const achadas = aplicaFiltros(rows, query.filters);
      achadas.forEach((row) => Object.assign(row, query.payload));
      return achadas;
    };

    switch (`${query.table}:${query.op}`) {
      case "webinar_sessions:select":
        return le([...estado.sessoes].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
      case "webinar_sessions:update":
        return { data: grava(estado.sessoes), error: null };
      case "webinars:select":
        return le(webinars);
      case "webinar_registrations:select":
        return le(estado.vagas);
      case "webinar_registrations:update": {
        const alvo = filterOf(query, "eq");
        if (alvo && alvo[1] === "id" && marcasPerdidas.includes(alvo[2])) {
          return { data: [], error: null };
        }
        return { data: grava(estado.vagas).map((row) => ({ id: row.id })), error: null };
      }
      case "admin_roles:select":
        return { data: equipe.map((user_id) => ({ user_id })), error: null };
      case "entitlements:select":
        return le(acessos);
      case "cohort_memberships:select":
        return le(turmas);
      case "profiles:select":
        return le(contatos);
      case "email_outbox:upsert":
        emails += 1;
        return { data: emailJaNaFila ? [] : [{ id: `email-${emails}` }], error: null };
      case "email_outbox:select":
        return { data: { id: "email-antigo" }, error: null };
      default:
        return { data: null, error: null };
    }
  });

  return Object.assign(db, { estado });
}

const sinos = (db) => db.queries.filter((query) => query.table === "notifications" && query.op === "upsert").flatMap((query) => query.payload);
const emailsNaFila = (db) => db.queries.filter((query) => query.table === "email_outbox" && query.op === "upsert").map((query) => query.payload);
const marcas = (db) => db.queries.filter((query) => query.table === "webinar_registrations" && query.op === "update").map((query) => query.payload);
const tabelas = (db, desde = 0) => db.queries.slice(desde).map((query) => `${query.table}:${query.op}`);
const contexto = (supabase, now = new Date(AGORA)) => ({ runId: "run", signal: new AbortController().signal, supabase, tickRunId: "tick", tickStartedAt: now });

/** Roda `fn` com console[metodo] capturado; devolve [resultado, linhas]. */
async function silenciando(metodo, fn) {
  const linhas = [];
  const original = console[metodo];
  console[metodo] = (...args) => linhas.push(args.join(" "));

  try {
    return [await fn(), linhas];
  } finally {
    console[metodo] = original;
  }
}

/* ------------------------------------------------------------------------------------------------
 * O tick dos lembretes
 * ---------------------------------------------------------------------------------------------- */

test("24 h antes: o tick marca a vaga, grava o sino e enfileira o e-mail uma vez por vaga; a equipe fica fora; o tick seguinte nao repete", async () => {
  const db = bancoDosWebinarios({ equipe: [EQUIPE], vagas: [vagaRow(ALUNA), vagaRow(ALUNO), vagaRow(EQUIPE)] });

  const result = await processWebinarReminders({ db, now: new Date(AGORA) });

  assert.deepEqual(result, { ...ZEROS, emails: 2, reminders24h: 2 });

  // As sessoes abertas, numa consulta so: scheduled/waiting de 60 dias atras ate 24 h a frente.
  const [sessoes] = db.queries;
  assert.equal(sessoes.table, "webinar_sessions");
  assert.deepEqual(filterOf(sessoes, "in"), ["in", "status", ["scheduled", "waiting"]]);
  assert.deepEqual(filterOf(sessoes, "gte"), ["gte", "scheduled_at", "2026-09-05T23:30:00.000Z"]);
  assert.deepEqual(filterOf(sessoes, "lte"), ["lte", "scheduled_at", "2026-11-05T23:30:00.000Z"]);

  // A marca vem antes do envio e so pega a vaga ainda sem marca; a equipe nao e marcada.
  const gravacoes = db.queries.filter((query) => query.table === "webinar_registrations" && query.op === "update");
  assert.deepEqual(gravacoes.map((query) => query.payload), [{ reminder_24h_sent_at: AGORA }, { reminder_24h_sent_at: AGORA }]);
  assert.ok(gravacoes.every((query) => query.filters.some(([method, column, value]) => method === "is" && column === "reminder_24h_sent_at" && value === null)));
  assert.deepEqual(
    db.estado.vagas.map((vaga) => [vaga.user_id, vaga.reminder_24h_sent_at]),
    [
      [ALUNA, AGORA],
      [ALUNO, AGORA],
      [EQUIPE, null]
    ]
  );

  const linhas = sinos(db);
  assert.deepEqual(linhas.map((linha) => linha.user_id), [ALUNA, ALUNO]);
  assert.deepEqual(linhas[0], {
    body: "Amanhã às 20:00: Live de agentes. Sua vaga está garantida.",
    dedupe_key: `webinar:${SESSAO_ID}:h24:202611052300`,
    expires_at: "2026-11-06T02:00:00.000Z",
    href: "/webinarios/live-de-agentes",
    kind: "webinar",
    payload: { kind: "h24", sessionId: SESSAO_ID, webinarId: WEBINAR_ID },
    title: "Lembrete da live",
    user_id: ALUNA
  });

  const fila = emailsNaFila(db);
  assert.equal(fila.length, 2);
  assert.equal(fila[0].kind, "webinar_reminder_24h");
  assert.equal(fila[0].to_email, "ana@exemplo.test");
  assert.equal(fila[0].user_id, ALUNA);
  assert.equal(fila[0].subject, "Amanhã às 20:00: Live de agentes");
  assert.equal(fila[0].idempotency_key, `webinar:h24:${SESSAO_ID}:202611052300:${ALUNA}`);
  assert.deepEqual(fila[0].metadata, { session_id: SESSAO_ID, webinar_id: WEBINAR_ID }, "metadata so com ids");
  assert.match(fila[0].html, /Olá, Ana\. Sua vaga está garantida para Live de agentes, amanhã, 05\/11\/2026 às 20:00 \(horário de Brasília\)/);
  assert.match(fila[0].html, /href="https:\/\/membros\.exemplo\.test\/webinarios\/live-de-agentes"/);
  assert.doesNotMatch(fila[0].text, /<[a-z]/i);
  assert.equal(db.queries.filter((query) => query.table === "admin_roles").length, 1, "a equipe e lida uma vez");
  assert.equal(db.queries.filter((query) => query.table === "profiles").length, 1, "os perfis sao lidos uma vez");

  // Tick seguinte: as marcas ja estao gravadas; nada sai e nenhuma linha nova no sino ou na fila.
  const antes = db.queries.length;
  assert.deepEqual(await processWebinarReminders({ db, now: new Date("2026-11-04T23:31:00.000Z") }), ZEROS);
  assert.deepEqual(tabelas(db, antes), ["webinar_sessions:select", "webinars:select", "webinar_registrations:select", "admin_roles:select"]);
});

test("regra dos 50 min (docs/30 §2.7): a 40 min da hora com os dois pendentes sai so o de 1 h, e o de 24 h e dado como feito", async () => {
  const db = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)] });
  const agora = "2026-11-05T22:20:00.000Z";

  const result = await processWebinarReminders({ db, now: new Date(agora) });

  assert.deepEqual(result, { ...ZEROS, emails: 1, reminders1h: 1 });
  assert.deepEqual(marcas(db), [{ reminder_1h_sent_at: agora }, { reminder_24h_sent_at: agora }]);

  const [linha] = sinos(db);
  assert.equal(linha.body, "Começa em 1 hora: Live de agentes. Entre pela área de membros.");
  assert.equal(linha.dedupe_key, `webinar:${SESSAO_ID}:h1:202611052300`);
  assert.deepEqual(linha.payload, { kind: "h1", sessionId: SESSAO_ID, webinarId: WEBINAR_ID });

  const [email] = emailsNaFila(db);
  assert.equal(email.kind, "webinar_reminder_1h");
  assert.equal(email.subject, "Começa em 1 hora: Live de agentes");
  assert.equal(email.idempotency_key, `webinar:h1:${SESSAO_ID}:202611052300:${ALUNA}`);
  assert.match(email.html, /Olá, Ana\. Live de agentes começa às 20:00 \(horário de Brasília\)/);

  // Depois disso nada mais sai para a vaga.
  assert.deepEqual(await processWebinarReminders({ db, now: new Date("2026-11-05T22:21:00.000Z") }), ZEROS);
});

test("24 h atrasado no proprio dia: sai 'Hoje às'; a 55 min com os dois pendentes sai so o de 24 h ajustado (o de 1 h espera)", async () => {
  const noDia = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)] });
  await processWebinarReminders({ db: noDia, now: new Date("2026-11-05T15:00:00.000Z") });
  assert.equal(sinos(noDia)[0].body, "Hoje às 20:00: Live de agentes. Sua vaga está garantida.");
  assert.equal(emailsNaFila(noDia)[0].subject, "Hoje às 20:00: Live de agentes");
  assert.equal(emailsNaFila(noDia)[0].kind, "webinar_reminder_24h");

  const faltando55 = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)] });
  const result = await processWebinarReminders({ db: faltando55, now: new Date("2026-11-05T22:05:00.000Z") });
  assert.deepEqual([result.reminders24h, result.reminders1h], [1, 0]);
  assert.deepEqual(marcas(faltando55), [{ reminder_24h_sent_at: "2026-11-05T22:05:00.000Z" }]);
  assert.equal(sinos(faltando55)[0].body, "Hoje às 20:00: Live de agentes. Sua vaga está garantida.");
});

test("texto da equipe (card Vaga e lembretes): o sino e o e-mail levam o texto escolhido; o 'Hoje às' continua o padrao", async () => {
  const webinar = webinarRow({ reminder_texts: { h24: "Amanhã a gente se vê na live. Traga perguntas." } });
  const db = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)], webinars: [webinar] });
  await processWebinarReminders({ db, now: new Date(AGORA) });
  assert.equal(sinos(db)[0].body, "Amanhã a gente se vê na live. Traga perguntas.");
  assert.match(emailsNaFila(db)[0].html, /Olá, Ana\.<\/p>/);
  assert.match(emailsNaFila(db)[0].html, /Amanhã a gente se vê na live\. Traga perguntas\./);
  assert.equal(emailsNaFila(db)[0].subject, "Amanhã às 20:00: Live de agentes");

  const noDia = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)], webinars: [webinar] });
  await processWebinarReminders({ db: noDia, now: new Date("2026-11-05T15:00:00.000Z") });
  assert.equal(sinos(noDia)[0].body, "Hoje às 20:00: Live de agentes. Sua vaga está garantida.");
});

test("e-mail desligado no webinario: so o sino, sem ler perfis; perfil sem e-mail: so o sino, com aviso no log; e-mail ja na fila nao conta", async () => {
  const desligado = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)], webinars: [webinarRow({ reminders: { email: false, h1: true, h24: true } })] });
  const result = await processWebinarReminders({ db: desligado, now: new Date(AGORA) });
  assert.deepEqual([result.reminders24h, result.emails], [1, 0]);
  assert.equal(sinos(desligado).length, 1);
  assert.ok(!desligado.queries.some((query) => query.table === "email_outbox" || query.table === "profiles"));

  const semEmail = bancoDosWebinarios({ perfis: [perfil(ALUNA, null, "Ana")], vagas: [vagaRow(ALUNA)] });
  const [resultado, avisos] = await silenciando("warn", () => processWebinarReminders({ db: semEmail, now: new Date(AGORA) }));
  assert.deepEqual([resultado.reminders24h, resultado.emails], [1, 0]);
  assert.equal(sinos(semEmail).length, 1);
  assert.ok(avisos.some((linha) => linha.includes(ALUNA) && linha.includes("sem e-mail")), avisos.join("\n"));

  const repetido = bancoDosWebinarios({ emailJaNaFila: true, vagas: [vagaRow(ALUNA)] });
  assert.deepEqual(await processWebinarReminders({ db: repetido, now: new Date(AGORA) }), { ...ZEROS, reminders24h: 1 });
});

test("webinario cancelado, rascunho ou com os lembretes desligados: nenhuma vaga e lida; sessao cancelada nunca entra na consulta", async () => {
  for (const webinar of [
    webinarRow({ cancelled_at: "2026-11-01T12:00:00.000Z" }),
    webinarRow({ status: "draft" }),
    webinarRow({ reminders: { email: true, h1: false, h24: false } })
  ]) {
    const db = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)], webinars: [webinar] });
    assert.deepEqual(await processWebinarReminders({ db, now: new Date(AGORA) }), ZEROS);
    assert.ok(!db.queries.some((query) => query.table === "webinar_registrations"), "nenhuma vaga lida");
  }

  const cancelada = bancoDosWebinarios({ sessoes: [sessaoRow({ status: "cancelled" })], vagas: [vagaRow(ALUNA)] });
  assert.deepEqual(await processWebinarReminders({ db: cancelada, now: new Date(AGORA) }), ZEROS);
  assert.deepEqual(tabelas(cancelada), ["webinar_sessions:select"], "a sessao cancelada fica fora pela propria consulta");
});

test("outro tick marcou a vaga no meio: a vaga conta como pulada e nada sai por aqui; a outra segue", async () => {
  const perdida = vagaRow(ALUNA);
  const db = bancoDosWebinarios({ marcasPerdidas: [perdida.id], vagas: [perdida, vagaRow(ALUNO)] });

  const result = await processWebinarReminders({ db, now: new Date(AGORA) });

  assert.deepEqual(result, { ...ZEROS, emails: 1, reminders24h: 1, skipped: 1 });
  assert.deepEqual(sinos(db).map((linha) => linha.user_id), [ALUNO]);
  assert.deepEqual(emailsNaFila(db).map((email) => email.user_id), [ALUNO]);
});

test("encerramento automatico: 2 h depois do fim previsto a sessao sem inicio vira 'ended' (so de scheduled/waiting); a que ainda cabe fica", async () => {
  const passou = sessaoRow({ id: "11111111-aaaa-4aaa-8aaa-111111111111", scheduled_at: "2026-11-04T20:00:00.000Z" }); // fim 21:00 + 2 h = 23:00 < 23:30
  const esperando = sessaoRow({ id: "22222222-aaaa-4aaa-8aaa-222222222222", scheduled_at: "2026-11-04T19:00:00.000Z", status: "waiting" });
  const noLimite = sessaoRow({ id: "33333333-aaaa-4aaa-8aaa-333333333333", scheduled_at: "2026-11-04T21:30:00.000Z" }); // fim 22:30 + 2 h = 00:30
  const db = bancoDosWebinarios({ sessoes: [passou, esperando, noLimite], vagas: [vagaRow(ALUNA)] });

  const result = await processWebinarReminders({ db, now: new Date(AGORA) });

  assert.deepEqual(result, { ...ZEROS, autoEnded: 2 });
  const encerradas = db.queries.filter((query) => query.table === "webinar_sessions" && query.op === "update");
  assert.deepEqual(
    encerradas.map((query) => [query.payload, filterOf(query, "eq")[2], filterOf(query, "in")[2]]),
    [
      [{ status: "ended" }, esperando.id, ["scheduled", "waiting"]],
      [{ status: "ended" }, passou.id, ["scheduled", "waiting"]]
    ]
  );
  assert.deepEqual(db.estado.sessoes.map((sessao) => sessao.status), ["ended", "ended", "scheduled"]);
  assert.ok(!db.queries.some((query) => query.table === "webinar_registrations"), "sessao ja passada nao manda lembrete");
});

test("sem sessao na janela: uma consulta so, nada no log e o job nao grava em job_runs; tick abortado nao le nada", async () => {
  const db = bancoDosWebinarios({ sessoes: [] });
  const [result, infos] = await silenciando("info", () => processWebinarReminders({ db, now: new Date(AGORA) }));

  assert.deepEqual(result, ZEROS);
  assert.deepEqual(tabelas(db), ["webinar_sessions:select"]);
  assert.deepEqual(infos, []);
  await webinarRemindersJob.run(contexto(db));
  assert.ok(!db.queries.some((query) => query.table === "job_runs"));

  const controller = new AbortController();
  controller.abort();
  const abortado = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)] });
  assert.deepEqual(await processWebinarReminders({ db: abortado, now: new Date(AGORA), signal: controller.signal }), ZEROS);
  assert.equal(abortado.queries.length, 0);
});

test("banco sem a migracao 202610290001: devolve zeros, registra e o job termina sem erro (o tick continua verde)", async () => {
  const db = scriptedDb(() => ({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.webinar_sessions' in the schema cache" } }));
  const [result, infos] = await silenciando("info", () => processWebinarReminders({ db, now: new Date(AGORA) }));

  assert.deepEqual(result, { ...ZEROS, pendingMigration: true });
  assert.ok(infos.some((linha) => linha.includes("migracao 202610300001 pendente")), infos.join("\n"));
  await silenciando("info", () => assert.doesNotReject(() => webinarRemindersJob.run(contexto(db))));

  const semRelacao = scriptedDb(() => ({ data: null, error: { code: "42P01", message: 'relation "public.webinar_sessions" does not exist' } }));
  const [outro] = await silenciando("info", () => processWebinarReminders({ db: semRelacao, now: new Date(AGORA) }));
  assert.equal(outro.pendingMigration, true);
});

test("erro de banco que nao e migracao pendente continua sendo falha do job (aparece em job_runs)", async () => {
  const db = scriptedDb(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));

  await assert.rejects(() => webinarRemindersJob.run(contexto(db)), /statement timeout/);
});

test("o nome do job segue a regra do registro do tick; com trabalho, as contagens vao para job_runs com o tick_run_id", async () => {
  assert.equal(WEBINAR_REMINDERS_JOB_NAME, "webinar-reminders");
  assert.equal(webinarRemindersJob.name, WEBINAR_REMINDERS_JOB_NAME);
  assert.match(webinarRemindersJob.name, /^[a-z0-9][a-z0-9-]{0,119}$/);

  const db = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)] });
  const [, infos] = await silenciando("info", () => webinarRemindersJob.run(contexto(db)));

  const [metricas] = db.queries.filter((query) => query.table === "job_runs");
  assert.ok(metricas, "houve trabalho: as contagens vao para job_runs");
  assert.equal(metricas.op, "update");
  assert.equal(metricas.payload.metadata.tick_run_id, "tick", "o tick_run_id do run-tick.ts fica");
  assert.deepEqual(Object.keys(metricas.payload.metadata.webinars).sort(), ["auto_ended", "emails", "job_ms", "reminders_1h", "reminders_24h", "skipped", "without_access"]);
  assert.deepEqual([metricas.payload.metadata.webinars.reminders_24h, metricas.payload.metadata.webinars.emails], [1, 1]);
  assert.ok(metricas.filters.some(([method, column, value]) => method === "eq" && column === "id" && value === "run"), "a linha do proprio job");
  assert.ok(
    infos.some((linha) => /^\[webinarios\] tick tick: 1 lembrete\(s\) de 24 h, 0 de 1 h, 1 e-mail\(s\) na fila, 0 sessao\(oes\) encerrada\(s\) sozinha\(s\), 0 pulada\(s\), 0 fora do Quem pode\.$/.test(linha)),
    infos.join("\n")
  );
});

test("chaves: o dedupe do sino e a chave do e-mail levam a hora marcada (a sessao remarcada manda de novo); o fim no sino e a hora marcada + duracao + 2 h, nunca antes do piso", () => {
  assert.equal(scheduledStamp(HORA_MARCADA), "202611052300");
  assert.equal(webinarDedupeKey(SESSAO_ID, "started", HORA_MARCADA), `webinar:${SESSAO_ID}:started:202611052300`);
  assert.notEqual(webinarDedupeKey(SESSAO_ID, "h24", HORA_MARCADA), webinarDedupeKey(SESSAO_ID, "h24", "2026-11-06T23:00:00.000Z"));
  assert.equal(webinarIdempotencyKey({ kind: "cancelled", sessionId: SESSAO_ID, stamp: "202611052300", userId: ALUNA }), `webinar:cancelled:${SESSAO_ID}:202611052300:${ALUNA}`);
  assert.equal(webinarNoticeExpiresAt({ durationMinutes: 60, floorMs: Date.parse(AGORA), scheduledAt: HORA_MARCADA }), "2026-11-06T02:00:00.000Z");
  assert.equal(webinarNoticeExpiresAt({ durationMinutes: 60, floorMs: Date.parse("2026-11-10T00:00:00.000Z"), scheduledAt: HORA_MARCADA }), "2026-11-10T00:00:00.000Z");
  assert.deepEqual(EMAIL_KINDS.slice(3), ["webinar_reminder_24h", "webinar_reminder_1h", "webinar_cancelled", "webinar_recording_failed"]);
});

/* ------------------------------------------------------------------------------------------------
 * Os avisos fora do tick (notify.ts): cancelada, remarcada e "Comecou agora"
 * ---------------------------------------------------------------------------------------------- */

test("live cancelada: sino e e-mail para quem tinha vaga nas sessoes abertas, uma vez por vaga (marca cancelled_notice_sent_at); a equipe fora; o motivo vai no e-mail", async () => {
  const encerrada = sessaoRow({ id: "44444444-aaaa-4aaa-8aaa-444444444444", scheduled_at: "2026-10-20T23:00:00.000Z", status: "ended" });
  const db = bancoDosWebinarios({
    equipe: [EQUIPE],
    perfis: [perfil(ALUNA, "ana@exemplo.test", "Ana Souza"), perfil(ALUNO, null, "Bruno")],
    sessoes: [sessaoRow({ status: "cancelled" }), encerrada],
    vagas: [vagaRow(ALUNA), vagaRow(ALUNO), vagaRow(EQUIPE)],
    webinars: [webinarRow({ cancel_reason: "O apresentador adoeceu.", cancelled_at: AGORA })]
  });

  const [result, avisos] = await silenciando("warn", () => queueWebinarCancelledNotices(db, WEBINAR_ID, new Date(AGORA)));

  assert.deepEqual(result, { emails: 1, notifications: 2 });
  assert.deepEqual(marcas(db), [{ cancelled_notice_sent_at: AGORA }, { cancelled_notice_sent_at: AGORA }]);

  const linhas = sinos(db);
  assert.deepEqual(
    linhas.map((linha) => [linha.user_id, linha.title, linha.body, linha.dedupe_key, linha.expires_at]),
    [
      [ALUNA, "Live cancelada", "Live cancelada: Live de agentes.", `webinar:${SESSAO_ID}:cancelled:202611052300`, "2026-11-11T23:30:00.000Z"],
      [ALUNO, "Live cancelada", "Live cancelada: Live de agentes.", `webinar:${SESSAO_ID}:cancelled:202611052300`, "2026-11-11T23:30:00.000Z"]
    ]
  );
  assert.deepEqual(linhas[0].payload, { kind: "cancelled", sessionId: SESSAO_ID, webinarId: WEBINAR_ID });
  assert.equal(linhas[0].href, "/webinarios/live-de-agentes");

  const [email] = emailsNaFila(db);
  assert.equal(emailsNaFila(db).length, 1);
  assert.equal(email.kind, "webinar_cancelled");
  assert.equal(email.subject, "Live cancelada: Live de agentes");
  assert.equal(email.to_email, "ana@exemplo.test");
  assert.equal(email.idempotency_key, `webinar:cancelled:${SESSAO_ID}:202611052300:${ALUNA}`);
  assert.deepEqual(email.metadata, { session_id: SESSAO_ID, webinar_id: WEBINAR_ID });
  assert.match(email.html, /Olá, Ana\. A live Live de agentes foi cancelada\./);
  assert.match(email.html, /Motivo: O apresentador adoeceu\./);
  assert.ok(avisos.some((linha) => linha.includes(ALUNO) && linha.includes("sem e-mail")), avisos.join("\n"));
  assert.ok(
    !db.queries.some((query) => query.table === "webinar_registrations" && query.op === "select" && query.filters.some(([method, value]) => method === "or" && value.includes(encerrada.id))),
    "sessao encerrada nao entra"
  );

  // Chamada repetida (duas abas, dois cliques): as marcas ja estao gravadas, nada sai.
  assert.deepEqual(await queueWebinarCancelledNotices(db, WEBINAR_ID, new Date(AGORA)), { emails: 0, notifications: 0 });
  assert.equal(sinos(db).length, 2);

  // Com o e-mail desligado no webinario, so o sino.
  const soSino = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)], webinars: [webinarRow({ cancelled_at: AGORA, reminders: { email: false, h1: true, h24: true } })] });
  assert.deepEqual(await queueWebinarCancelledNotices(soSino, WEBINAR_ID, new Date(AGORA)), { emails: 0, notifications: 1 });
  assert.ok(!soSino.queries.some((query) => query.table === "email_outbox"));
});

test("hora marcada mudou: as marcas dos lembretes das vagas da sessao sao zeradas e o sino avisa a hora nova (uma vez por hora nova); sem e-mail; a equipe fora", async () => {
  const NOVA = "2026-11-06T23:00:00.000Z";
  const db = bancoDosWebinarios({
    equipe: [EQUIPE],
    sessoes: [sessaoRow({ scheduled_at: NOVA })],
    vagas: [
      vagaRow(ALUNA, { reminder_1h_sent_at: "2026-11-05T22:00:00.000Z", reminder_24h_sent_at: "2026-11-04T23:00:00.000Z" }),
      vagaRow(EQUIPE, { reminder_24h_sent_at: "2026-11-04T23:00:00.000Z" })
    ]
  });

  const result = await queueWebinarRescheduledNotices(db, SESSAO_ID, new Date(AGORA));

  assert.deepEqual(result, { emails: 0, notifications: 1 });
  const [zera] = db.queries.filter((query) => query.table === "webinar_registrations" && query.op === "update");
  assert.deepEqual(zera.payload, { reminder_1h_sent_at: null, reminder_24h_sent_at: null });
  assert.ok(zera.filters.some(([method, column, value]) => method === "eq" && column === "webinar_id" && value === WEBINAR_ID));
  assert.ok(zera.filters.some(([method, column, value]) => method === "eq" && column === "status" && value === "registered"));
  assert.ok(zera.filters.some(([method, value]) => method === "or" && value === `session_id.eq.${SESSAO_ID},session_id.is.null`));
  assert.deepEqual(
    db.estado.vagas.map((vaga) => [vaga.reminder_24h_sent_at, vaga.reminder_1h_sent_at]),
    [
      [null, null],
      [null, null]
    ],
    "as vagas da sessao voltam a receber os lembretes"
  );
  assert.ok(tabelas(db).indexOf("webinar_registrations:update") < tabelas(db).indexOf("notifications:upsert"), "as marcas primeiro, o aviso depois");

  const [linha] = sinos(db);
  assert.equal(linha.user_id, ALUNA);
  assert.equal(linha.title, "A live mudou de hora");
  assert.equal(linha.body, `A live mudou para ${formatWebinarWhen(NOVA)}: Live de agentes. Sua vaga continua garantida.`);
  assert.match(linha.body, /^A live mudou para Sexta, 6\/11 às 20:00: /);
  assert.equal(linha.dedupe_key, `webinar:${SESSAO_ID}:rescheduled:202611062300`);
  assert.equal(linha.expires_at, "2026-11-07T02:00:00.000Z");
  assert.ok(!db.queries.some((query) => query.table === "email_outbox"), "sem e-mail na mudanca de hora");

  // Sessao encerrada ou webinario que nao esta publicado: nada.
  const encerrada = bancoDosWebinarios({ sessoes: [sessaoRow({ status: "ended" })], vagas: [vagaRow(ALUNA)] });
  assert.deepEqual(await queueWebinarRescheduledNotices(encerrada, SESSAO_ID, new Date(AGORA)), { emails: 0, notifications: 0 });
  assert.ok(!encerrada.queries.some((query) => query.table === "webinar_registrations"));
});

test("Comecou agora: sino para quem tinha vaga, uma vez por vaga (marca started_notice_sent_at), com o texto da equipe se houver; nada num webinario cancelado", async () => {
  const comecou = "2026-11-05T23:02:00.000Z";
  const db = bancoDosWebinarios({
    sessoes: [sessaoRow({ started_at: comecou, status: "live" })],
    vagas: [vagaRow(ALUNA), vagaRow(ALUNO, { started_notice_sent_at: "2026-11-05T23:01:00.000Z" })]
  });

  const result = await queueWebinarStartedNotices(db, SESSAO_ID, new Date(comecou));

  assert.deepEqual(result, { emails: 0, notifications: 1 });
  assert.deepEqual(marcas(db), [{ started_notice_sent_at: comecou }, { started_notice_sent_at: comecou }], "a marca e tentada nas duas; so a primeira pega");
  const [linha] = sinos(db);
  assert.deepEqual(
    [linha.user_id, linha.title, linha.body, linha.dedupe_key, linha.expires_at],
    [ALUNA, "Começou agora", "Começou agora: Live de agentes. Entrar.", `webinar:${SESSAO_ID}:started:202611052300`, "2026-11-06T02:02:00.000Z"]
  );
  assert.deepEqual(linha.payload, { kind: "started", sessionId: SESSAO_ID, webinarId: WEBINAR_ID });
  assert.deepEqual(await queueWebinarStartedNotices(db, SESSAO_ID, new Date(comecou)), { emails: 0, notifications: 0 }, "repetir nao manda de novo");

  const personalizado = bancoDosWebinarios({ sessoes: [sessaoRow({ status: "live" })], vagas: [vagaRow(ALUNA)], webinars: [webinarRow({ reminder_texts: { started: "Estamos ao vivo. Entre agora." } })] });
  await queueWebinarStartedNotices(personalizado, SESSAO_ID, new Date(comecou));
  assert.equal(sinos(personalizado)[0].body, "Estamos ao vivo. Entre agora.");

  const cancelado = bancoDosWebinarios({ sessoes: [sessaoRow({ status: "live" })], vagas: [vagaRow(ALUNA)], webinars: [webinarRow({ cancelled_at: AGORA })] });
  assert.deepEqual(await queueWebinarStartedNotices(cancelado, SESSAO_ID, new Date(comecou)), { emails: 0, notifications: 0 });
  assert.ok(!cancelado.queries.some((query) => query.table === "webinar_registrations"));
});

/** Um acesso do aluno (linha de entitlements). */
const acessoDe = (user_id, extra = {}) => ({
    created_at: CRIADO,
    ends_at: null,
    id: `acesso-${user_id.slice(0, 8)}`,
    product_id: "curso-x",
    source_event_id: null,
    source_provider: "hotmart",
    starts_at: CRIADO,
    status: "active",
    target_id: "curso-x",
    target_type: "standalone_course",
    updated_at: CRIADO,
    user_id,
    ...extra
  });

test("Quem tem o produto (e com o segmento): o reembolsado nao recebe lembrete, Comecou agora, cancelada nem remarcada; a vaga dele fica sem a marca", async () => {
  const SEGMENTO = { kind: "rules", root: { items: [{ days: 7, op: "within", type: "sign_in" }], match: "all" } };
  const acesso = acessoDe;
  // A aluna tem o curso; o aluno foi reembolsado (acesso revogado).
  const acessos = [acesso(ALUNA), acesso(ALUNO, { status: "revoked" })];
  const vagas = () => [vagaRow(ALUNA), vagaRow(ALUNO)];
  const leuAcessos = (db) => db.queries.filter((query) => query.table === "entitlements");

  for (const accessMode of ["product", "both"]) {
    // O "both" grava 'product' + audience_restricts (202610300001).
    const webinar = (extra = {}) =>
      webinarRow({ access_mode: "product", audience: accessMode === "both" ? SEGMENTO : { kind: "everyone" }, audience_restricts: accessMode === "both", product_id: "curso-x", ...extra });

    // 24 h antes, no tick.
    const tick = bancoDosWebinarios({ acessos, vagas: vagas(), webinars: [webinar()] });
    assert.deepEqual(await processWebinarReminders({ db: tick, now: new Date(AGORA) }), { ...ZEROS, emails: 1, reminders24h: 1, withoutAccess: 1 }, accessMode);
    assert.deepEqual(sinos(tick).map((linha) => linha.user_id), [ALUNA], `${accessMode}: so a aluna com o curso`);
    assert.deepEqual(emailsNaFila(tick).map((email) => email.user_id), [ALUNA]);
    assert.deepEqual(
      tick.estado.vagas.map((vaga) => [vaga.user_id, vaga.reminder_24h_sent_at]),
      [
        [ALUNA, AGORA],
        [ALUNO, null]
      ],
      "a vaga do reembolsado fica sem a marca (volta a receber se o acesso voltar)"
    );
    const [leitura] = leuAcessos(tick);
    assert.deepEqual(filterOf(leitura, "in"), ["in", "user_id", [ALUNA, ALUNO]], "os acessos so de quem tem vaga, na hora de enviar");

    // "Comecou agora".
    const comecou = bancoDosWebinarios({ acessos, sessoes: [sessaoRow({ status: "live" })], vagas: vagas(), webinars: [webinar()] });
    assert.deepEqual(await queueWebinarStartedNotices(comecou, SESSAO_ID, new Date(AGORA)), { emails: 0, notifications: 1 });
    assert.deepEqual(sinos(comecou).map((linha) => linha.user_id), [ALUNA]);
    assert.equal(comecou.estado.vagas.find((vaga) => vaga.user_id === ALUNO).started_notice_sent_at, null);

    // Live cancelada.
    const cancelada = bancoDosWebinarios({ acessos, vagas: vagas(), webinars: [webinar({ cancel_reason: null, cancelled_at: AGORA })] });
    assert.deepEqual(await queueWebinarCancelledNotices(cancelada, WEBINAR_ID, new Date(AGORA)), { emails: 1, notifications: 1 });
    assert.deepEqual(sinos(cancelada).map((linha) => linha.user_id), [ALUNA]);
    assert.deepEqual(emailsNaFila(cancelada).map((email) => email.user_id), [ALUNA]);

    // Hora nova.
    const remarcada = bancoDosWebinarios({ acessos, sessoes: [sessaoRow({ scheduled_at: "2026-11-06T23:00:00.000Z" })], vagas: vagas(), webinars: [webinar()] });
    assert.deepEqual(await queueWebinarRescheduledNotices(remarcada, SESSAO_ID, new Date(AGORA)), { emails: 0, notifications: 1 });
    assert.deepEqual(sinos(remarcada).map((linha) => linha.user_id), [ALUNA]);
  }

  // O acesso a plataforma inteira vale como o produto; o acesso vencido nao.
  const plataforma = bancoDosWebinarios({
    acessos: [acesso(ALUNA, { target_id: "platform", target_type: "platform" }), acesso(ALUNO, { ends_at: "2026-11-01T00:00:00.000Z" })],
    vagas: vagas(),
    webinars: [webinarRow({ access_mode: "product", product_id: "curso-x" })]
  });
  await processWebinarReminders({ db: plataforma, now: new Date(AGORA) });
  assert.deepEqual(sinos(plataforma).map((linha) => linha.user_id), [ALUNA]);

  // Todos, e Segmento com um segmento que nao pede produto: os acessos nem sao lidos (a vaga e a ancora do segmento e
  // toda vaga recebe).
  for (const accessMode of ["everyone", "audience"]) {
    const db = bancoDosWebinarios({ acessos, vagas: vagas(), webinars: [webinarRow({ access_mode: accessMode, audience: SEGMENTO, product_id: null })] });
    await processWebinarReminders({ db, now: new Date(AGORA) });
    assert.deepEqual(sinos(db).map((linha) => linha.user_id), [ALUNA, ALUNO], accessMode);
    assert.equal(leuAcessos(db).length, 0, `${accessMode}: sem ler os acessos`);
  }

  // Produto ou segmento (sem ancora, D41): os acessos sao sempre lidos e a vaga nao segura ninguem. Fora do segmento
  // agora (o aluno nunca entrou na area), sem o produto da live nao recebe: nem o reembolsado, nem quem nunca teve o
  // produto.
  const either = bancoDosWebinarios({ acessos, vagas: vagas(), webinars: [webinarRow({ access_mode: "either", audience: SEGMENTO, product_id: "curso-x" })] });
  await processWebinarReminders({ db: either, now: new Date(AGORA) });
  assert.deepEqual(sinos(either).map((linha) => linha.user_id), [ALUNA], "either: o reembolsado do produto da live nao recebe");
  assert.equal(leuAcessos(either).length, 1);
  const semProduto = bancoDosWebinarios({ acessos: [acesso(ALUNA)], vagas: vagas(), webinars: [webinarRow({ access_mode: "either", audience: SEGMENTO, product_id: "curso-x" })] });
  await processWebinarReminders({ db: semProduto, now: new Date(AGORA) });
  assert.deepEqual(sinos(semProduto).map((linha) => linha.user_id), [ALUNA], "either: sem o produto e fora do segmento agora, a vaga nao basta");
});

test("o tick de minuto sem lembrete vencido nao le acesso nenhum; com lembrete vencido, so os acessos de quem vai receber", async () => {
  const leuAcessos = (db) => db.queries.filter((query) => query.table === "entitlements");
  const live = webinarRow({ access_mode: "product", product_id: "curso-x" });
  const acessos = [acessoDe(ALUNA), acessoDe(ALUNO)];

  // O de 24 h ja saiu para as duas vagas e faltam 20 h: nada vence, nada de acessos.
  const semVencido = bancoDosWebinarios({
    acessos,
    sessoes: [sessaoRow({ scheduled_at: new Date(Date.parse(AGORA) + 20 * 60 * 60_000).toISOString() })],
    vagas: [vagaRow(ALUNA, { reminder_24h_sent_at: AGORA }), vagaRow(ALUNO, { reminder_24h_sent_at: AGORA })],
    webinars: [live]
  });
  assert.deepEqual(await processWebinarReminders({ db: semVencido, now: new Date(AGORA) }), ZEROS);
  assert.equal(leuAcessos(semVencido).length, 0, "nenhuma consulta de acessos sem lembrete vencido");

  // So a vaga do aluno esta vencida: os acessos so dele.
  const umVencido = bancoDosWebinarios({ acessos, vagas: [vagaRow(ALUNA, { reminder_24h_sent_at: AGORA }), vagaRow(ALUNO)], webinars: [live] });
  await processWebinarReminders({ db: umVencido, now: new Date(AGORA) });
  assert.deepEqual(sinos(umVencido).map((linha) => linha.user_id), [ALUNO]);
  assert.deepEqual(leuAcessos(umVencido).map((query) => filterOf(query, "in")), [["in", "user_id", [ALUNO]]]);
});

test("segmento com Turma: a vaga segura so quem ainda esta na turma (as turmas de quem vai receber, lidas na hora)", async () => {
  const TURMA = { kind: "rules", root: { items: [{ cohortIds: ["turma-mentoria"], type: "cohort" }], match: "all" } };
  // As duas tem o curso; so a aluna continua na turma (o aluno foi tirado dela).
  const acessos = [acessoDe(ALUNA), acessoDe(ALUNO)];
  const turmas = [{ cohort_id: "turma-mentoria", created_at: CRIADO, product_id: "curso-x", user_id: ALUNA }];
  const db = bancoDosWebinarios({ acessos, turmas, vagas: [vagaRow(ALUNA), vagaRow(ALUNO)], webinars: [webinarRow({ access_mode: "audience", audience: TURMA, product_id: null })] });

  await processWebinarReminders({ db, now: new Date(AGORA) });
  assert.deepEqual(sinos(db).map((linha) => linha.user_id), [ALUNA], "o aluno tirado da turma nao recebe");
  assert.ok(db.queries.some((query) => query.table === "cohort_memberships"), "as turmas sao lidas");

  // Sem regra de Turma, nada de turmas.
  const semTurma = bancoDosWebinarios({ acessos, vagas: [vagaRow(ALUNA), vagaRow(ALUNO)], webinars: [webinarRow({ access_mode: "product", product_id: "curso-x" })] });
  await processWebinarReminders({ db: semTurma, now: new Date(AGORA) });
  assert.ok(!semTurma.queries.some((query) => query.table === "cohort_memberships"));
});

test("Segmento que pede um produto: a vaga e a ancora, mas sem o produto nao recebe; no Produto ou segmento (sem ancora), so quem passa agora", async () => {
  // O segmento "ganharam acesso ao Curso X hoje": as duas vagas foram garantidas em 28/10 (o "hoje" ja passou).
  const GANHOU_X_HOJE = { kind: "rules", root: { items: [{ negate: false, period: { kind: "today" }, productIds: ["curso-x"], type: "access_recent" }], match: "all" } };
  // A aluna ainda tem o Curso X; o aluno foi reembolsado do Curso X.
  const acessos = [acessoDe(ALUNA), acessoDe(ALUNO, { status: "revoked" })];
  const vagas = () => [vagaRow(ALUNA), vagaRow(ALUNO)];
  const webinar = (extra = {}) => webinarRow({ access_mode: "audience", audience: GANHOU_X_HOJE, product_id: null, ...extra });

  const tick = bancoDosWebinarios({ acessos, vagas: vagas(), webinars: [webinar()] });
  await processWebinarReminders({ db: tick, now: new Date(AGORA) });
  assert.deepEqual(sinos(tick).map((linha) => linha.user_id), [ALUNA], "Segmento: a vaga segura a aluna com X; o reembolsado nao recebe o lembrete");
  assert.deepEqual(emailsNaFila(tick).map((email) => email.user_id), [ALUNA]);
  assert.equal(tick.estado.vagas.find((vaga) => vaga.user_id === ALUNO).reminder_24h_sent_at, null);

  const comecou = bancoDosWebinarios({ acessos, sessoes: [sessaoRow({ status: "live" })], vagas: vagas(), webinars: [webinar()] });
  await queueWebinarStartedNotices(comecou, SESSAO_ID, new Date(AGORA));
  assert.deepEqual(sinos(comecou).map((linha) => linha.user_id), [ALUNA], "Segmento: nem o Comecou agora");

  // No "Produto ou segmento" (Mentoria ou o mesmo segmento) nao ha ancora: a aluna ainda tem X, mas ganhou em 28/10 e
  // nao tem a Mentoria; nenhuma das duas vagas recebe.
  const either = (lista) => bancoDosWebinarios({ acessos: lista, vagas: vagas(), webinars: [webinarRow({ access_mode: "either", audience: GANHOU_X_HOJE, product_id: "mentoria" })] });
  const semAncora = either(acessos);
  assert.deepEqual(await processWebinarReminders({ db: semAncora, now: new Date(AGORA) }), { ...ZEROS, withoutAccess: 2 });
  assert.deepEqual(sinos(semAncora), []);

  // Quem tem a Mentoria agora recebe, mesmo fora do segmento e sem X; quem ganhou X hoje (no segmento agora) tambem.
  const hoje = "2026-11-04T15:00:00.000Z";
  const passaAgora = either([acessoDe(ALUNA, { created_at: hoje, starts_at: hoje, updated_at: hoje }), acessoDe(ALUNO, { product_id: "mentoria", target_id: "mentoria" })]);
  await processWebinarReminders({ db: passaAgora, now: new Date(AGORA) });
  assert.deepEqual(sinos(passaAgora).map((linha) => linha.user_id), [ALUNA, ALUNO]);
});

test("Produto ou segmento: quem nao tem o produto da live recebe se estiver no segmento agora, como entra na pagina; o segmento so dessas pessoas", async () => {
  // O aluno tinha o curso, garantiu vaga, foi reembolsado e entra na area todo dia. A pagina abre pelo segmento de
  // agora; os avisos tambem chegam.
  const SEGMENTO = { kind: "rules", root: { items: [{ days: 7, op: "within", type: "sign_in" }], match: "all" } };
  const ontem = new Date(Date.parse(AGORA) - 24 * 60 * 60_000).toISOString();
  const acessos = [acessoDe(ALUNA), acessoDe(ALUNO, { status: "revoked" })];
  const contatos = [perfil(ALUNA, "ana@exemplo.test", "Ana Souza"), { ...perfil(ALUNO, "bruno@exemplo.test", "Bruno Lima"), last_sign_in_at: ontem }];
  const live = webinarRow({ access_mode: "either", audience: SEGMENTO, product_id: "curso-x" });
  const vagas = () => [vagaRow(ALUNA), vagaRow(ALUNO)];

  const tick = bancoDosWebinarios({ acessos, perfis: contatos, vagas: vagas(), webinars: [live] });
  assert.deepEqual(await processWebinarReminders({ db: tick, now: new Date(AGORA) }), { ...ZEROS, emails: 2, reminders24h: 2 });
  assert.deepEqual(sinos(tick).map((linha) => linha.user_id), [ALUNA, ALUNO]);
  // O segmento (o progresso entra com o perfil) so do aluno: a aluna entra pelo produto, sem ler o segmento dela.
  assert.deepEqual(
    tick.queries.filter((query) => query.table === "lesson_progress").map((query) => filterOf(query, "in")),
    [["in", "user_id", [ALUNO]]]
  );

  const comecou = bancoDosWebinarios({ acessos, perfis: contatos, sessoes: [sessaoRow({ status: "live" })], vagas: vagas(), webinars: [live] });
  await queueWebinarStartedNotices(comecou, SESSAO_ID, new Date(AGORA));
  assert.deepEqual(sinos(comecou).map((linha) => linha.user_id), [ALUNA, ALUNO], "e o Comecou agora");

  // Fora do segmento (nunca entrou): sem o produto, a vaga nao segura.
  const fora = bancoDosWebinarios({ acessos, vagas: vagas(), webinars: [live] });
  assert.deepEqual(await processWebinarReminders({ db: fora, now: new Date(AGORA) }), { ...ZEROS, emails: 1, reminders24h: 1, withoutAccess: 1 });
  assert.deepEqual(sinos(fora).map((linha) => linha.user_id), [ALUNA]);
});

test("Produto ou segmento: lembretes, Comecou agora e cancelada so para quem passa agora (o produto ou o segmento de agora), sem conta de data", async () => {
  // "Curso X ou ganhou acesso hoje a qualquer produto" (o pedido do produtor): as vagas sao de 28/10 e o "hoje" ja
  // passou. Os dois tem um ebook antigo (que seguraria a ancora do Segmento); o aluno teve a plataforma ate 2025 e foi
  // reembolsado do Curso X. Nenhum dos dois passa agora: ninguem recebe, qualquer que seja a historia das linhas.
  const GANHOU_HOJE = { kind: "rules", root: { items: [{ negate: false, period: { kind: "today" }, productIds: [], type: "access_recent" }], match: "all" } };
  const live = (extra = {}) => webinarRow({ access_mode: "either", audience: GANHOU_HOJE, product_id: "curso-x", ...extra });
  const ebook = (user_id) => acessoDe(user_id, { id: `ebook-${user_id.slice(0, 8)}`, product_id: "ebook", target_id: "ebook" });
  const plataformaDe2025 = acessoDe(ALUNO, {
    created_at: "2024-06-01T00:00:00.000Z",
    ends_at: "2025-06-01T00:00:00.000Z",
    id: "plataforma",
    product_id: null,
    starts_at: "2024-06-01T00:00:00.000Z",
    target_id: "platform",
    target_type: "platform",
    updated_at: "2024-06-01T00:00:00.000Z"
  });
  const ninguem = [ebook(ALUNA), ebook(ALUNO), plataformaDe2025, acessoDe(ALUNO, { id: "curso-x-bruno", status: "revoked" })];
  const vagas = () => [vagaRow(ALUNA), vagaRow(ALUNO)];

  const tick = bancoDosWebinarios({ acessos: ninguem, vagas: vagas(), webinars: [live()] });
  assert.deepEqual(await processWebinarReminders({ db: tick, now: new Date(AGORA) }), { ...ZEROS, withoutAccess: 2 });
  assert.deepEqual(sinos(tick), []);
  assert.ok(tick.estado.vagas.every((vaga) => vaga.reminder_24h_sent_at === null), "as vagas ficam sem a marca");

  const comecou = bancoDosWebinarios({ acessos: ninguem, sessoes: [sessaoRow({ status: "live" })], vagas: vagas(), webinars: [live()] });
  assert.deepEqual(await queueWebinarStartedNotices(comecou, SESSAO_ID, new Date(AGORA)), { emails: 0, notifications: 0 });

  const cancelada = bancoDosWebinarios({ acessos: ninguem, vagas: vagas(), webinars: [live({ cancel_reason: null, cancelled_at: AGORA })] });
  assert.deepEqual(await queueWebinarCancelledNotices(cancelada, WEBINAR_ID, new Date(AGORA)), { emails: 0, notifications: 0 });

  // Agora a aluna ganhou um acesso hoje (no segmento) e o aluno voltou a ter o Curso X (o produto): os dois recebem.
  const hoje = "2026-11-04T15:00:00.000Z";
  const passam = [ebook(ALUNA), acessoDe(ALUNA, { created_at: hoje, id: "curso-y-ana", product_id: "curso-y", starts_at: hoje, target_id: "curso-y", updated_at: hoje }), ebook(ALUNO), acessoDe(ALUNO)];
  const depois = bancoDosWebinarios({ acessos: passam, vagas: vagas(), webinars: [live()] });
  assert.deepEqual(await processWebinarReminders({ db: depois, now: new Date(AGORA) }), { ...ZEROS, emails: 2, reminders24h: 2 });
  assert.deepEqual(sinos(depois).map((linha) => linha.user_id), [ALUNA, ALUNO]);
});

test("Produto ou segmento: no mesmo lote, o segmento de agora de quem nao tem o produto da live le so os acessos dela (nunca os das outras vagas)", async () => {
  // "Curso X ou ganhou acesso hoje a qualquer produto" (o pedido do produtor), vagas de 28/10. O aluno foi reembolsado
  // do Curso X e tem um ebook antigo (fora do "hoje"); a aluna ganhou a Mentoria hoje. So a aluna recebe: o acesso de
  // hoje dela nao pode pôr o aluno no segmento (a pagina dele, que le so os acessos dele, da "não disponível").
  const GANHOU_HOJE = { kind: "rules", root: { items: [{ negate: false, period: { kind: "today" }, productIds: [], type: "access_recent" }], match: "all" } };
  const live = webinarRow({ access_mode: "either", audience: GANHOU_HOJE, product_id: "curso-x" });
  const hoje = "2026-11-04T15:00:00.000Z";
  const acessos = [
    acessoDe(ALUNA, { created_at: hoje, id: "mentoria-ana", product_id: "mentoria", starts_at: hoje, target_id: "mentoria", updated_at: hoje }),
    acessoDe(ALUNO, { created_at: "2026-01-10T12:00:00.000Z", id: "ebook-bruno", product_id: "ebook", starts_at: "2026-01-10T12:00:00.000Z", target_id: "ebook", updated_at: "2026-01-10T12:00:00.000Z" }),
    acessoDe(ALUNO, { status: "revoked" })
  ];

  const lote = bancoDosWebinarios({ acessos, vagas: [vagaRow(ALUNA), vagaRow(ALUNO)], webinars: [live] });
  assert.deepEqual(await processWebinarReminders({ db: lote, now: new Date(AGORA) }), { ...ZEROS, emails: 1, reminders24h: 1, withoutAccess: 1 });
  assert.deepEqual(sinos(lote).map((linha) => linha.user_id), [ALUNA]);

  const comecou = bancoDosWebinarios({ acessos, sessoes: [sessaoRow({ status: "live" })], vagas: [vagaRow(ALUNA), vagaRow(ALUNO)], webinars: [live] });
  await queueWebinarStartedNotices(comecou, SESSAO_ID, new Date(AGORA));
  assert.deepEqual(sinos(comecou).map((linha) => linha.user_id), [ALUNA], "nem o Comecou agora");

  // O mesmo aluno com um acesso de hoje (dele): entra pelo segmento de agora, como na pagina.
  const comAcessoDeHoje = [...acessos, acessoDe(ALUNO, { created_at: hoje, id: "curso-y-bruno", product_id: "curso-y", starts_at: hoje, target_id: "curso-y", updated_at: hoje })];
  const dele = bancoDosWebinarios({ acessos: comAcessoDeHoje, vagas: [vagaRow(ALUNA), vagaRow(ALUNO)], webinars: [live] });
  await processWebinarReminders({ db: dele, now: new Date(AGORA) });
  assert.deepEqual(sinos(dele).map((linha) => linha.user_id), [ALUNA, ALUNO]);
});

test("a vaga barrada pelo Quem pode nao e conferida a cada minuto: de novo so 15 min depois (a memoria do processo do job); o acesso que volta faz o lembrete sair", async () => {
  const live = webinarRow({ access_mode: "product", product_id: "curso-x" });
  const acessos = [acessoDe(ALUNA), acessoDe(ALUNO, { status: "revoked" })];
  const db = bancoDosWebinarios({ acessos, vagas: [vagaRow(ALUNA), vagaRow(ALUNO)], webinars: [live] });
  const memo = new Map();
  const minuto = (n) => new Date(Date.parse(AGORA) + n * 60_000);
  const acessosLidos = (desde) => db.queries.slice(desde).filter((query) => query.table === "entitlements").map((query) => filterOf(query, "in"));
  const tick = async (n) => {
    const desde = db.queries.length;
    const result = await processWebinarReminders({ accessMemo: memo, db, now: minuto(n) });
    return [result, acessosLidos(desde)];
  };

  assert.deepEqual(await tick(0), [{ ...ZEROS, emails: 1, reminders24h: 1, withoutAccess: 1 }, [["in", "user_id", [ALUNA, ALUNO]]]]);
  for (const n of [1, 2, 3, 14]) {
    assert.deepEqual(await tick(n), [ZEROS, []], `minuto ${n}: a vaga barrada nem e conferida`);
  }
  assert.deepEqual(await tick(15), [{ ...ZEROS, withoutAccess: 1 }, [["in", "user_id", [ALUNO]]]], "15 min depois: conferida de novo, ainda sem acesso");

  // O acesso volta: o lembrete sai na conferencia seguinte (ate 15 min depois).
  acessos[1] = acessoDe(ALUNO);
  assert.deepEqual(await tick(16), [ZEROS, []]);
  assert.deepEqual(await tick(30), [{ ...ZEROS, emails: 1, reminders24h: 1 }, [["in", "user_id", [ALUNO]]]]);
  assert.deepEqual(sinos(db).map((linha) => linha.user_id), [ALUNA, ALUNO]);
  assert.equal(memo.size, 0, "nada barrado na memoria");

  // O job usa a memoria do processo e conta a vaga barrada como trabalho (without_access em job_runs).
  WEBINAR_REMINDER_ACCESS_MEMO.clear();
  try {
    const jobDb = bancoDosWebinarios({ acessos: [acessoDe(ALUNO, { status: "revoked" })], vagas: [vagaRow(ALUNO)], webinars: [live] });
    const [, infos] = await silenciando("info", () => webinarRemindersJob.run(contexto(jobDb)));
    const [metricas] = jobDb.queries.filter((query) => query.table === "job_runs");
    assert.ok(metricas, "so a vaga barrada: houve trabalho");
    assert.equal(metricas.payload.metadata.webinars.without_access, 1);
    assert.ok(infos.some((linha) => linha.endsWith("1 fora do Quem pode.")), infos.join("\n"));
    const desde = jobDb.queries.length;
    await silenciando("info", () => webinarRemindersJob.run(contexto(jobDb, minuto(1))));
    assert.equal(jobDb.queries.slice(desde).filter((query) => query.table === "entitlements").length, 0, "o tick seguinte do job nao rele");
  } finally {
    WEBINAR_REMINDER_ACCESS_MEMO.clear();
  }
});

test("os avisos nunca derrubam a acao do admin: erro de banco vira log e contagens zeradas", async () => {
  const db = scriptedDb(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));

  const [resultados, erros] = await silenciando("error", () =>
    Promise.all([
      queueWebinarCancelledNotices(db, WEBINAR_ID, new Date(AGORA)),
      queueWebinarRescheduledNotices(db, SESSAO_ID, new Date(AGORA)),
      queueWebinarStartedNotices(db, SESSAO_ID, new Date(AGORA))
    ])
  );

  assert.deepEqual(resultados, [
    { emails: 0, notifications: 0 },
    { emails: 0, notifications: 0 },
    { emails: 0, notifications: 0 }
  ]);
  assert.equal(erros.length, 3);
  assert.ok(erros.every((linha) => linha.startsWith("[webinarios]") && linha.includes("statement timeout")), erros.join("\n"));
});
