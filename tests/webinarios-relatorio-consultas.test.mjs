import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { ALUNA, ALUNO, EQUIPE, GRAVACAO_ID, SESSAO_ID, WEBINAR_ID, bancoDosWebinarios, gravacaoRow, resumoDePresenca, rpcs, scriptedDb, sessaoRow, silenciando, vagaRow, webinarRow } from "./support/webinarios-banco-falso.mjs";

// As leituras da aba Relatorio (docs/30 §3.4, §3.7 e §4.6; entrega 2c), sem banco e sem Next: "next/cache" vira um
// duble que imita o Data Cache (uma entrada por chave e argumentos, devolvida para sempre), e o cliente do banco vira
// o banco falso dos webinarios. Aqui: a chave do cache com o minuto do relogio (duas leituras no mesmo minuto, uma
// RPC; no minuto seguinte, outra), os nomes lidos fora do cache a cada vez, a pagina inteira (o seletor de sessao e a
// padrao, a sessao pedida, a lista por aluno com nome, e-mail, hora da vaga, aparelho e pontuacao, as enquetes com
// os rotulos, as perguntas citadas, a Simulacao), o CSV "Attendee" (colunas do Zoom, BOM, ponto e virgula, nome do
// arquivo, sessao de outro webinario) e a migracao pendente. Contra o banco local: tests/integration/webinarios-relatorio.test.mjs.

const cache = (globalThis.__webinariosRelatorioCache ??= { calls: [], entries: new Map(), keyParts: null, options: null });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
          export function unstable_cache(fn, keyParts, options) {
            const state = globalThis.__webinariosRelatorioCache;
            state.keyParts = keyParts;
            state.options = options;
            return async (...args) => {
              const key = JSON.stringify([keyParts, args]);
              state.calls.push(args);
              if (!state.entries.has(key)) {
                state.entries.set(key, await fn(...args));
              }
              return state.entries.get(key);
            };
          }
          export function revalidateTag() {}
          export function updateTag() {}
          export function revalidatePath() {}
          export function unstable_noStore() {}
          export function cacheTag() {}
          export function cacheLife() {}`)}`
      };
    }

    const resolved = nextResolve(specifier, context);

    // db.ts importa o cliente por caminho relativo: o mesmo duble de admin-action-stubs vale aqui.
    if (typeof resolved.url === "string" && resolved.url.endsWith("/src/server/db/supabase/client.ts")) {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; } export function hasSupabaseConfig() { return true; }"
      };
    }

    return resolved;
  }
});

const queries = await import("../src/server/webinars/report-queries.ts");
const { ATTENDEE_CSV_HEADERS } = await import("../src/server/webinars/report-page-model.ts");

const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:40:10.000Z");
const ENQUETE = "c1c1c1c1-0000-4000-8000-000000000001";
const OPCAO_A = "b1b1b1b1-0000-4000-8000-000000000001";
const OPCAO_B = "b2b2b2b2-0000-4000-8000-000000000002";
const PERGUNTA = "d1d1d1d1-0000-4000-8000-000000000001";
const REPLAY_ID = "22222222-aaaa-4aaa-8aaa-222222222222";
const FUTURA_ID = "33333333-aaaa-4aaa-8aaa-333333333333";

/** As linhas da RPC webinar_report da sessao de teste (as mesmas da conferencia da migracao, com ids reais). */
const RPC_ROWS = [
  { metric: "avg_present", item: "", total: "1", students: "1" },
  { metric: "chat_minute", item: "0", total: 2, students: 2 },
  { metric: "chat_total", item: "", total: 2, students: 2 },
  { metric: "drop", item: "2", total: 1, students: 1 },
  { metric: "hot", item: ALUNA, total: 100, students: 1 },
  { metric: "hot", item: ALUNO, total: 65, students: 1 },
  { metric: "peak", item: "0", total: 3, students: 3 },
  { metric: "poll", item: `${ENQUETE}:${OPCAO_A}`, total: 1, students: 1 },
  { metric: "poll", item: `${ENQUETE}:${OPCAO_B}`, total: 1, students: 1 },
  { metric: "presence", item: "0", total: 3, students: 3 },
  { metric: "presence", item: "1", total: 3, students: 3 },
  { metric: "presence", item: "2", total: 2, students: 2 },
  { metric: "question", item: "open", total: 1, students: 1 },
  { metric: "reached_end", item: "", total: 1, students: 1 },
  { metric: "reaction", item: "fire", total: 2, students: 2 },
  { metric: "registration", item: "attended", total: 2, students: 2 },
  { metric: "registration", item: "registered", total: 2, students: 2 },
  { metric: "registration_source", item: "email", total: 1, students: 1 },
  { metric: "replay", item: "viewers", total: 0, students: 0 },
  { metric: "sim_script", item: "fired", total: 2, students: 0 },
  { metric: "sim_script", item: "missed", total: 1, students: 0 },
  { metric: "top_chat", item: ALUNA, total: 1, students: 1 },
  { metric: "top_chat", item: ALUNO, total: 1, students: 1 },
  { metric: "top_question", item: PERGUNTA, total: 2, students: 1 },
  { metric: "unique", item: "", total: 3, students: 3 },
  { metric: "watch_avg", item: "", total: 1730, students: 3 },
  { metric: "watch_max", item: "", total: 3600, students: 3 }
];

const presente = (userId, extra = {}) => ({
  entries: 1,
  first_at: "2026-11-05T23:00:10.000Z",
  last_at: "2026-11-05T23:29:40.000Z",
  messages: "1",
  polls: 1,
  questions: 0,
  reached_end: true,
  reactions: 1,
  registered: true,
  seconds: 1800,
  source: "email",
  user_id: userId,
  ...extra
});

function bancoDaPagina(extra = {}) {
  const encerrada = sessaoRow({ ended_at: "2026-11-05T23:31:00.000Z", presence_curve: resumoDePresenca(), show_live_badge: true, simulation_ack_text: "Decisão do produtor em 05/11/2026: o selo fica ligado.", simulation_decided_at: "2026-11-05T12:00:00.000Z", simulation_decided_by: EQUIPE, started_at: "2026-11-05T23:00:00.000Z", status: "ended" });
  const replay = sessaoRow({ id: REPLAY_ID, kind: "replay", recording_id: GRAVACAO_ID, scheduled_at: "2026-11-05T23:31:00.000Z", source_session_id: SESSAO_ID, status: "live" });
  const futura = sessaoRow({ id: FUTURA_ID, scheduled_at: "2026-11-07T23:00:00.000Z", status: "scheduled" });
  const db = bancoDosWebinarios({
    enquetes: [{ anonymous: false, closed_at: null, created_at: "2026-11-05T23:05:00.000Z", created_by: null, id: ENQUETE, kind: "single", open_offset_ms: 300000, opened_at: null, position: 0, question: "Qual ferramenta você usa?", results_shared_at: null, session_id: SESSAO_ID, status: "closed", template_poll_id: null, updated_at: "2026-11-05T23:05:00.000Z", webinar_id: WEBINAR_ID }],
    eventos: [
      { entity_id: SESSAO_ID, entity_type: "webinar", event_type: "webinar_joined", metadata: { device: "mobile", kind: "simulated" }, user_id: ALUNA },
      { entity_id: SESSAO_ID, entity_type: "webinar", event_type: "webinar_joined", metadata: { device: "desktop", kind: "simulated" }, user_id: ALUNA },
      { entity_id: SESSAO_ID, entity_type: "webinar", event_type: "webinar_joined", metadata: {}, user_id: ALUNO },
      { entity_id: REPLAY_ID, entity_type: "webinar", event_type: "webinar_joined", metadata: { device: "desktop", kind: "replay" }, user_id: ALUNO }
    ],
    opcoes: [
      { created_at: "", id: OPCAO_A, label: "Planilha", poll_id: ENQUETE, position: 0 },
      { created_at: "", id: OPCAO_B, label: "Agente", poll_id: ENQUETE, position: 1 }
    ],
    perfis: [
      { avatar_url: null, created_at: "", email: "ana@exemplo.test", full_name: "Ana Souza", id: ALUNA, last_sign_in_at: null, phone: null },
      { avatar_url: null, created_at: "", email: "bruno@exemplo.test", full_name: "  ", id: ALUNO, last_sign_in_at: null, phone: null },
      { avatar_url: null, created_at: "", email: "equipe@exemplo.test", full_name: "Carla Produtora", id: EQUIPE, last_sign_in_at: null, phone: null }
    ],
    perguntas: [{ anonymous: false, answer_text: "Sim.", answered_at: "2026-11-05T23:20:00.000Z", answered_by: EQUIPE, answered_live: false, body: "Funciona no celular?", created_at: "", deleted_at: null, deleted_reason: null, display_name: "Ana S.", id: PERGUNTA, message_id: null, offset_ms: 600000, session_id: SESSAO_ID, status: "answered", updated_at: "", upvotes: 2, user_id: ALUNA }],
    presentes: [presente(ALUNA, { messages: "2" }), presente(ALUNO, { entries: 2, polls: 0, reached_end: false, registered: false, seconds: 600, source: null })],
    relatorio: RPC_ROWS,
    roteiro: [
      { status: "ready", trigger_kind: "at_offset", webinar_id: WEBINAR_ID },
      { status: "ready", trigger_kind: "on_phrase", webinar_id: WEBINAR_ID },
      { status: "ready", trigger_kind: "manual", webinar_id: WEBINAR_ID },
      { status: "draft", trigger_kind: "at_offset", webinar_id: WEBINAR_ID },
      { status: "ready", trigger_kind: "at_offset", webinar_id: "aaaaaaaa-9999-4999-8999-999999999999" }
    ],
    sessoes: [encerrada, replay, futura],
    vagas: [vagaRow(ALUNA, { registered_at: "2026-11-01T12:00:00.000Z", source: "email" }), vagaRow(ALUNO, { registered_at: "2026-11-02T12:00:00.000Z", session_id: null, status: "cancelled" })],
    ...extra
  });
  actionStubs.db = db;
  return db;
}

const semCache = (sessionId) => queries.loadWebinarReportPage(actionStubs.db, WEBINAR_ID, { sessionId, view: async () => (await queries.getWebinarReport(SESSAO_ID, { now: T0 })).view });

test("o cache: chave ['webinars-report', 'v1'] + sessao + minuto, 60 s e a tag webinars; duas leituras no mesmo minuto fazem uma RPC, o minuto seguinte outra; os nomes vem fora do cache a cada vez", async () => {
  const db = bancoDaPagina();
  cache.calls.length = 0;

  assert.deepEqual(cache.keyParts, ["webinars-report", "v1"]);
  assert.deepEqual(cache.options, { revalidate: 60, tags: ["webinars"] });

  const primeira = await queries.getWebinarReport(SESSAO_ID, { now: T0 });
  assert.equal(primeira.status, "ok");
  assert.equal(primeira.view.presence.unique, 3);
  assert.deepEqual(primeira.view.presence.peak, { b: 0, n: 3 });
  assert.equal(primeira.people[ALUNA].name, "Ana Souza");
  assert.equal(primeira.people[ALUNA].email, "ana@exemplo.test", "o e-mail vem junto; a tela decide quem ve");
  assert.equal(primeira.people[ALUNO].name, "Aluno", "perfil sem nome vira Aluno");
  assert.deepEqual(cache.calls.at(-1), [SESSAO_ID, Math.floor(T0 / MIN)]);

  const segunda = await queries.getWebinarReport(SESSAO_ID, { now: T0 + 20_000 });
  assert.equal(segunda.status, "ok");
  assert.equal(rpcs(db, "webinar_report").length, 1, "mesmo minuto: uma RPC so");
  assert.equal(db.queries.filter((query) => query.table === "profiles").length, 2, "os nomes sao lidos a cada vez, fora do cache");

  await queries.getWebinarReport(SESSAO_ID, { now: T0 + 61_000 });
  assert.equal(rpcs(db, "webinar_report").length, 2, "o minuto seguinte tem a propria entrada");
  assert.equal(queries.webinarReportCacheMinute(T0 + 61_000), Math.floor(T0 / MIN) + 1);
});

test("a pagina: as sessoes com relatorio (a futura fica de fora, o replay por ultimo), a padrao e a ultima hora marcada, ?sessao= escolhe outra; webinario que nao existe e null", async () => {
  bancoDaPagina();

  const page = await semCache(null);
  assert.ok(page);
  assert.deepEqual(page.webinar, { durationMinutes: 60, id: WEBINAR_ID, kind: "simulated", registrationRequired: true, slug: "live-de-agentes", status: "published", title: "Live de agentes" });
  assert.equal(page.hasReplay, true);
  assert.deepEqual(
    page.sessions.map((session) => [session.kind, session.label, session.selected, session.href]),
    [
      ["simulated", "Sessão · 05/11/2026 às 20:00", true, `/admin/comunicacao/webinarios/${WEBINAR_ID}/relatorio?sessao=${SESSAO_ID}`],
      ["replay", "Replay · 05/11/2026 às 20:31", false, `/admin/comunicacao/webinarios/${WEBINAR_ID}/relatorio?sessao=${REPLAY_ID}`]
    ]
  );
  assert.equal(page.selected?.session.id, SESSAO_ID);

  const replay = await semCache(REPLAY_ID);
  assert.equal(replay?.selected?.session.id, REPLAY_ID);
  assert.deepEqual(replay?.sessions.map((session) => session.selected), [false, true]);

  const futura = await semCache(FUTURA_ID);
  assert.equal(futura?.selected?.session.id, SESSAO_ID, "sessao fora da lista: vale a padrao");

  bancoDaPagina({ webinars: [] });
  assert.equal(await semCache(null), null);
});

test("a sessao escolhida: lista por aluno com nome, e-mail, hora da vaga, aparelho e pontuacao; enquetes com rotulos; perguntas citadas; Simulacao; CSV", async () => {
  bancoDaPagina();

  const page = await semCache(SESSAO_ID);
  const selected = page?.selected;
  assert.ok(selected);
  assert.equal(selected.report.presence.unique, 3);
  assert.equal(selected.durationMs, 1_800_000, "a duracao vem da curva congelada");
  assert.equal(selected.csvHref, `/api/admin/webinars/${WEBINAR_ID}/relatorio/csv?sessao=${SESSAO_ID}`);

  assert.deepEqual(
    selected.attendees.map((attendee) => [attendee.userId, attendee.name, attendee.email, attendee.registeredAt, attendee.device, attendee.score, attendee.registered]),
    [
      [ALUNA, "Ana Souza", "ana@exemplo.test", "2026-11-01T12:00:00.000Z", "mobile", 100, true],
      // Bruno: 1 mensagem + 1 reacao (0,5) + 10 min (1) = 2,5 pontos; Ana: 2 + 0,5 + 1 enquete + 30 min (3) = 6,5 -> 38 %.
      // O aparelho de Bruno veio sem `device` (e o do replay e de outra sessao): fica vazio.
      [ALUNO, "Aluno", "bruno@exemplo.test", "2026-11-02T12:00:00.000Z", null, 38, false]
    ]
  );

  assert.deepEqual(selected.polls, [
    {
      anonymous: false,
      id: ENQUETE,
      options: [
        { id: OPCAO_A, label: "Planilha", percent: 50, students: 1, total: 1 },
        { id: OPCAO_B, label: "Agente", percent: 50, students: 1, total: 1 }
      ],
      question: "Qual ferramenta você usa?",
      total: 2
    }
  ]);
  assert.deepEqual(selected.questions, { [PERGUNTA]: { answeredBy: EQUIPE, body: "Funciona no celular?", displayName: "Ana S.", status: "answered" } });
  assert.equal(selected.people[EQUIPE].name, "Carla Produtora", "quem respondeu e quem decidiu o selo entram nos nomes");
  assert.deepEqual(selected.simulation, {
    ackText: "Decisão do produtor em 05/11/2026: o selo fica ligado.",
    decidedAt: "2026-11-05T12:00:00.000Z",
    decidedByName: "Carla Produtora",
    script: { fired: 2, missed: 1, ready: 2 },
    showLiveBadge: true
  });
});

test("a pontuacao da lista por aluno segue a conta M3 (mensagem 1, pergunta 2, reacao 0,5, enquete 1, cada 10 min 1; 0-100 pelo maior)", async () => {
  bancoDaPagina({
    presentes: [
      presente(ALUNA, { messages: "60", polls: 0, questions: 0, reactions: 0, seconds: 0 }), // 50 (teto)
      presente(ALUNO, { messages: 0, polls: 1, questions: 2, reactions: 4, seconds: 1200 }) // 0 + 4 + 2 + 1 + 2 = 9
    ]
  });

  const page = await semCache(SESSAO_ID);
  assert.deepEqual(
    page?.selected?.attendees.map((attendee) => [attendee.userId, attendee.score]),
    [
      [ALUNA, 100],
      [ALUNO, 18]
    ]
  );
});

test("o CSV Attendee: as colunas do Zoom, BOM e ponto e virgula, Sim/Não, datas em Sao Paulo, quem so tem vaga sem as colunas de presenca; sessao de outro webinario e null", async () => {
  const db = bancoDaPagina({
    presentes: [presente(ALUNA, { messages: "2" }), { entries: null, first_at: null, last_at: null, messages: 0, polls: 0, questions: 0, reached_end: false, reactions: 0, registered: true, seconds: null, source: "email", user_id: ALUNO }]
  });

  const result = await queries.loadWebinarReportCsv(db, { sessionId: SESSAO_ID, webinarId: WEBINAR_ID });
  assert.ok(result);
  assert.equal(result.count, 2);
  assert.equal(result.fileName, "webinario-live-de-agentes-2026-11-05-2000-attendee.csv");
  assert.ok(result.csv.startsWith("﻿"), "BOM para o Excel");
  const [cabecalho, ana, bruno] = result.csv.replace(/^﻿/, "").trimEnd().split("\r\n");
  assert.deepEqual(cabecalho.split(";"), [...ATTENDEE_CSV_HEADERS]);
  assert.deepEqual(ATTENDEE_CSV_HEADERS, [
    "Compareceu",
    "Nome",
    "E-mail",
    "Hora da vaga",
    "Entrou",
    "Saiu",
    "Entradas",
    "Tempo na sessão (min)",
    "Até o fim (95 %)",
    "Mensagens",
    "Reações",
    "Perguntas",
    "Enquetes respondidas",
    "Oferta clicada (variante)",
    "Pontuação (0–100)",
    "Dispositivo"
  ]);
  assert.deepEqual(ana.split(";"), ["Sim", "Ana Souza", "ana@exemplo.test", "01/11/2026 às 09:00", "05/11/2026 às 20:00", "05/11/2026 às 20:29", "1", "30", "Sim", "2", "1", "0", "1", "", "100", "celular"]);
  assert.deepEqual(bruno.split(";"), ["Não", "Aluno", "bruno@exemplo.test", "02/11/2026 às 09:00", "", "", "", "", "", "0", "0", "0", "0", "", "0", ""]);

  assert.equal(await queries.loadWebinarReportCsv(db, { sessionId: SESSAO_ID, webinarId: "aaaaaaaa-9999-4999-8999-999999999999" }), null);
  assert.equal(await queries.loadWebinarReportCsv(db, { sessionId: FUTURA_ID.replace("3333", "0000"), webinarId: WEBINAR_ID }), null);
});

test("banco sem a migracao: pending_migration; outro erro do banco: error (registrado), nada entra no cache", async () => {
  cache.entries.clear();
  actionStubs.db = scriptedDb(() => ({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.webinar_sessions' in the schema cache" } }));
  assert.deepEqual(await queries.getWebinarReport("00000000-0000-4000-8000-000000000001", { now: T0 }), { status: "pending_migration" });

  actionStubs.db = scriptedDb(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));
  const [result, erros] = await silenciando("error", () => queries.getWebinarReport("00000000-0000-4000-8000-000000000002", { now: T0 }));
  assert.deepEqual(result, { status: "error" });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /statement timeout/);

  actionStubs.db = bancoDaPagina();
  const ok = await queries.getWebinarReport("00000000-0000-4000-8000-000000000002", { now: T0 });
  assert.equal(ok.status, "ok", "o erro nao ficou guardado: a leitura seguinte vai ao banco");
  assert.equal(await queries.getWebinarAttendees(SESSAO_ID).then((rows) => rows.length), 2);
  assert.ok(gravacaoRow().id && webinarRow().id);
});
