import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import {
  JIT_ON,
  LIVE_WEBINAR,
  PRODUCT_WEBINAR,
  RECORDING,
  WEBINAR,
  bancoDoJit,
  escolaDoJit,
  recordingRow
} from "./support/webinarios-v4-jit-banco.mjs";

// A rota do "Comeca quando voce entra" (docs/30 §1.2, §1.6, A14, D25 e D33; docs/18 §2.2), sem banco: o banco do
// just-in-time em memoria (com o indice unico por horario e as datas no formato do PostgREST) e a sessao do aluno pelo
// teste; o relogio fixo pelo mock de Date do node:test. POST /api/webinars/[id]/jit {}: 401 sem sessao, 400 sem id ou
// com corpo, 404 sem acesso (o webinario de produto) ou inexistente, 409 banned (banido de todos), 409 off (desligado,
// Live ao vivo, sem video, cancelado), 409 closed fora do horario (com a hora do proximo); o horario atual quando ainda
// aceita entrada, senao o proximo; dois alunos no mesmo horario recebem a mesma sessao (23505 le a que existe); a
// sessao nasce com a Simulacao copiada das regras (com a decisao), o chat da sala, a Entrada atrasada e o video base;
// nunca pede vaga, nem com limite de vagas; o historico webinar_jit_entered; a resposta sem cache e com a hora em "Z".

const sessao = (globalThis.__jitRotasSessao ??= { user: null });

function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }
  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__jitRotasSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiSessionUser = requireApiUser;`);
    }
    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    return nextResolve(specifier, context);
  }
});

const route = await import("../src/app/api/webinars/[id]/jit/route.ts");
const sessionRoute = await import("../src/app/api/webinars/[id]/session/route.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { simulationAckFor, normalizeSimulationRules } = await import("../src/server/webinars/simulation-model.ts");

/** Um instante pela hora de Sao Paulo (UTC-3). */
const sp = (texto) => Date.parse(`${texto}-03:00`);
const iso = (texto) => new Date(sp(texto)).toISOString();

let proximoAluno = 900;

function novoAluno() {
  proximoAluno += 1;
  const id = `77777777-8888-4777-8777-${String(proximoAluno).padStart(12, "0")}`;
  sessao.user = { id };
  return id;
}

const relogios = new WeakSet();

function montar(t, { agora = "2026-10-29T10:07:00", ...options } = {}) {
  if (relogios.has(t)) {
    t.mock.timers.setTime(sp(agora));
  } else {
    t.mock.timers.enable({ apis: ["Date"], now: sp(agora) });
    relogios.add(t);
  }
  const db = bancoDoJit({ tables: escolaDoJit(options) });
  actionStubs.db = db;
  return { db, userId: novoAluno() };
}

const contexto = (id = WEBINAR) => ({ params: Promise.resolve({ id }) });

async function entrar({ body = "{}", webinarId = WEBINAR } = {}) {
  const response = await route.POST(new Request(`http://localhost/api/webinars/${webinarId}/jit`, { body, headers: { "content-type": "application/json" }, method: "POST" }), contexto(webinarId));
  return { body: await response.json(), headers: response.headers, status: response.status };
}

const jitSessions = (db) => db.tables.webinar_sessions.filter((row) => row.jit === true);

test("guardas: 401 sem sessao, 400 sem id ou com corpo, 404 sem acesso ou inexistente; a resposta sem cache", async (t) => {
  montar(t);
  sessao.user = null;
  assert.equal((await entrar()).status, 401);

  novoAluno();
  assert.equal((await entrar({ webinarId: "nao-e-id" })).status, 400);
  assert.equal((await entrar({ body: JSON.stringify({ sessionId: WEBINAR }) })).status, 400, "o corpo e so {}");

  const semAcesso = await entrar({ webinarId: PRODUCT_WEBINAR });
  assert.equal(semAcesso.status, 404, "o webinario de quem tem o produto");
  assert.equal(semAcesso.body.error, WEBINAR_COPY.aluno.naoDisponivel);
  assert.equal(semAcesso.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal((await entrar({ webinarId: "abababab-0000-4000-8000-0000000000ff" })).status, 404, "inexistente, sem dizer se existe");
});

test("409: banido de todos os webinarios, desligado, Live ao vivo, sem video e cancelado; nada nasce", async (t) => {
  const { db, userId } = montar(t);
  db.tables.webinar_user_bans.push({ created_at: new Date().toISOString(), created_by: null, reason: null, session_id: null, user_id: userId });
  const banido = await entrar();
  assert.deepEqual([banido.status, banido.body.reason, banido.body.error], [409, "banned", WEBINAR_COPY.aoVivo.banido]);

  const desligado = montar(t, { jit: { ...JIT_ON, enabled: false } });
  const off = await entrar();
  assert.deepEqual([off.status, off.body.reason, off.body.error], [409, "off", WEBINAR_COPY.jit.servidor.desligado]);
  assert.equal(jitSessions(desligado.db).length, 0);

  montar(t);
  const aoVivo = await entrar({ webinarId: LIVE_WEBINAR });
  assert.deepEqual([aoVivo.status, aoVivo.body.reason], [409, "off"], "so a Live gravada");

  const semVideo = montar(t);
  semVideo.db.tables.webinar_recordings = [recordingRow({ bunny_library_id: null, bunny_video_id: null, embed_url: null })];
  assert.deepEqual([(await entrar()).status, jitSessions(semVideo.db).length], [409, 0]);

  const cancelado = montar(t, { webinar: { cancel_reason: "Mudou", cancelled_at: new Date().toISOString() } });
  const recusa = await entrar();
  assert.deepEqual([recusa.status, recusa.body.error], [409, WEBINAR_COPY.jit.servidor.cancelado]);
  assert.equal(jitSessions(cancelado.db).length, 0);
});

test("fora do horario: 409 closed com a hora do proximo; a cada 60 min, antes de a sala abrir, tambem", async (t) => {
  const { db } = montar(t, { agora: "2026-10-29T03:00:00" });
  const madrugada = await entrar();
  assert.deepEqual([madrugada.status, madrugada.body.reason, madrugada.body.scheduledAt], [409, "closed", iso("2026-10-29T08:00:00")]);
  assert.equal(madrugada.body.error, WEBINAR_COPY.jit.servidor.foraDoHorario);
  assert.equal(jitSessions(db).length, 0);

  montar(t, { jit: { ...JIT_ON, everyMinutes: 60, lateJoinMinutes: 5 } });
  const cedo = await entrar();
  assert.deepEqual([cedo.status, cedo.body.scheduledAt], [409, iso("2026-10-29T11:00:00")], "10:07 com a sala das 11:00 ainda fechada");
});

test("o horario: o atual quando ainda aceita entrada (ate o fim), senao o proximo (Entrada atrasada de 5 min)", async (t) => {
  const atual = montar(t);
  const dentro = await entrar();
  assert.equal(dentro.status, 200);
  assert.equal(dentro.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(dentro.body.data.scheduledAt, iso("2026-10-29T10:00:00"), "a sessao das 10:00, aos 7 min, com a hora em Z (o banco devolve +00:00)");
  assert.equal(jitSessions(atual.db).length, 1);
  assert.equal(dentro.body.data.roomHref, `/webinarios/agentes-quando-voce-entra/sala?sessao=${dentro.body.data.sessionId}`);

  const proximo = montar(t, { jit: { ...JIT_ON, lateJoinMinutes: 5 } });
  const depois = await entrar();
  assert.equal(depois.status, 200);
  assert.equal(depois.body.data.scheduledAt, iso("2026-10-29T10:15:00"), "aos 7 min com Entrada atrasada de 5: o horario seguinte");
  assert.equal(jitSessions(proximo.db)[0].late_join_minutes, 5);
});

test("dois alunos no mesmo horario recebem a mesma sessao (o indice unico e o 23505); outro horario, outra sessao", async (t) => {
  const { db } = montar(t);
  const ana = novoAluno();
  const [primeira, segunda] = await Promise.all([entrar(), (async () => {
    sessao.user = { id: ana };
    return entrar();
  })()]);
  assert.equal(primeira.status, 200);
  assert.equal(segunda.status, 200);
  assert.equal(primeira.body.data.sessionId, segunda.body.data.sessionId, "a mesma turma");
  assert.equal(jitSessions(db).length, 1);
  assert.ok(db.calls.writes.some((write) => write.table === "webinar_sessions" && write.error === "23505"), "o segundo insert bateu no indice unico");

  const terceiro = novoAluno();
  sessao.user = { id: terceiro };
  assert.equal((await entrar()).body.data.sessionId, primeira.body.data.sessionId, "o terceiro tambem");

  t.mock.timers.setTime(sp("2026-10-29T11:20:00"));
  const outra = await entrar();
  assert.notEqual(outra.body.data.sessionId, primeira.body.data.sessionId);
  assert.equal(outra.body.data.scheduledAt, iso("2026-10-29T11:15:00"));
  assert.equal(jitSessions(db).length, 2);

  const historico = db.tables.student_events.filter((row) => row.event_type === "webinar_jit_entered");
  assert.equal(historico.length, 4);
  // Os dois primeiros entraram ao mesmo tempo: a ordem entre eles nao importa, so que um criou e o outro nao.
  const created = historico.map((row) => row.metadata.created);
  assert.deepEqual([[...created.slice(0, 2)].sort(), created.slice(2)], [[false, true], [false, true]], "so quem criou a sessao leva created");
  assert.ok(historico.every((row) => row.entity_type === "webinar" && row.metadata.slot === "current" && row.metadata.webinar_id === WEBINAR));
});

test("o Responder tudo padrao do Assistente vale para a sessao que nasce (so na criacao); desligado, nasce sem", async (t) => {
  const ligado = montar(t);
  ligado.db.tables.webinars.find((row) => row.id === WEBINAR).assistant_settings = { enabled: true, replyAllDefault: true };
  assert.equal((await entrar()).status, 200);
  assert.equal(jitSessions(ligado.db)[0].assistant_reply_all, true);

  const desligado = montar(t);
  assert.equal((await entrar()).status, 200);
  assert.notEqual(jitSessions(desligado.db)[0].assistant_reply_all, true);
});

test("a sessao nasce com a Simulacao copiada (com a decisao), o chat da sala, a Entrada atrasada e o video base; sempre simulated e jit", async (t) => {
  const rules = normalizeSimulationRules({
    countRule: { base: 40, jitter: 5, mode: "curve", peak: 120 },
    joins: { enabled: true, everySeconds: 30, max: 20, names: "generic" },
    saleNotices: { enabled: true, items: [{ offsetMs: 12 * 60_000, text: "Carlos acabou de garantir a vaga" }] },
    showLiveBadge: true
  });
  const decidedAt = "2026-10-28T15:00:00.000Z";
  const ackText = simulationAckFor({ nowMs: Date.parse(decidedAt), responsible: "Produtora de Teste", rules });
  const simulation = {
    ackText,
    countRule: rules.countRule,
    decidedAt,
    decidedBy: "00000000-0000-4000-8000-0000000000f1",
    joins: { enabled: true, every_seconds: 30, max: 20, names: "generic" },
    saleNotices: { enabled: true, items: [{ offset_ms: 12 * 60_000, text: "Carlos acabou de garantir a vaga" }] },
    showLiveBadge: true
  };
  const { db } = montar(t, { jit: { ...JIT_ON, lateJoinMinutes: 30, simulation } });
  const resposta = await entrar();
  assert.equal(resposta.status, 200);
  const [row] = jitSessions(db);
  assert.equal(row.id, resposta.body.data.sessionId);
  assert.deepEqual(
    {
      chat_mode: row.chat_mode,
      chat_slow_mode_seconds: row.chat_slow_mode_seconds,
      jit: row.jit,
      kind: row.kind,
      late_join_minutes: row.late_join_minutes,
      recording_id: row.recording_id,
      source_session_id: row.source_session_id,
      status: row.status
    },
    { chat_mode: "moderated", chat_slow_mode_seconds: 20, jit: true, kind: "simulated", late_join_minutes: 30, recording_id: RECORDING, source_session_id: null, status: "scheduled" }
  );
  assert.deepEqual(row.simulated_count_rule, { base: 40, jitter: 5, mode: "curve", peak: 120 });
  assert.deepEqual(row.simulated_joins, { enabled: true, every_seconds: 30, max: 20, names: "generic" });
  assert.deepEqual(row.simulated_sale_notices, { enabled: true, items: [{ offset_ms: 12 * 60_000, text: "Carlos acabou de garantir a vaga" }] });
  assert.equal(row.show_live_badge, true);
  assert.equal(row.simulation_ack_text, ackText, "a frase decidida vai junto");
  assert.equal(Date.parse(row.simulation_decided_at), Date.parse(decidedAt));
  assert.equal(row.simulation_decided_by, "00000000-0000-4000-8000-0000000000f1");

  const semSimulacao = montar(t);
  await entrar();
  const [simples] = jitSessions(semSimulacao.db);
  assert.deepEqual([simples.show_live_badge, simples.simulated_count_rule, simples.simulated_joins, simples.simulated_sale_notices, simples.simulation_decided_by], [false, null, null, null, null]);
});

test("nunca pede vaga: com Garantir vaga e limite de vagas, a sala da sessao jit abre sem vaga (GET .../session)", async (t) => {
  const { db } = montar(t, { webinar: { capacity: 10, registration_required: true } });
  const resposta = await entrar();
  assert.equal(resposta.status, 200);
  assert.equal(db.tables.webinar_registrations.length, 0, "nenhuma vaga criada");

  const sala = await sessionRoute.GET(new Request(`http://localhost/api/webinars/${WEBINAR}/session?sessao=${resposta.body.data.sessionId}`), contexto());
  const payload = await sala.json();
  assert.equal(sala.status, 200, JSON.stringify(payload));
  assert.equal(payload.data.session.id, resposta.body.data.sessionId);
  assert.equal(payload.data.session.kind, "simulated");
  assert.deepEqual(payload.data.session.join, { ok: true }, "sem vaga e mesmo assim entra (a turma da espera)");
  assert.equal(payload.data.registeredCount, null, "nem o numero de vagas");
});
