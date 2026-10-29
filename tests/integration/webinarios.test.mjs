import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import {
  ESCOLA_DE_TESTE,
  limparWebinarios,
  seedEscolaDeTeste,
  seedWebinarioDeTeste,
  SENHA_DE_TESTE,
  usuarioDeTeste,
  WEBINARIO_DE_TESTE
} from "../fixtures/escola-de-teste.mjs";

// Webinarios, fase 1 (docs/30 §1.2, §4.7, §5.1 e §10; docs/18 §3) contra o banco LOCAL de verdade, com a
// migracao 202610280001 aplicada: a politica do historico recusa o aluno gravando 'webinar'; a rota da sessao
// responde 401 sem sessao, 404 fora do acesso e 200 dentro; Garantir vaga duas vezes nao duplica (201 e depois
// 200) e grava webinar_registered uma vez; o job do tick manda o lembrete de 24 h pelo sino e pela fila de
// e-mail uma vez por vaga (o tick seguinte nao repete) e a equipe nunca recebe; cancelar o webinario avisa quem
// tinha vaga, uma vez. O teste anda com a hora marcada da sessao (como o teste dos avisos agendados adianta o
// send_at) em vez de esperar. Fase 4e (migracao 202610290008): o "Comeca quando voce entra" cria a sessao do horario
// uma vez para dois alunos (o indice unico por horario), sem vaga nem com limite de vagas; o banco recusa a segunda
// sessao jit no mesmo horario (23505) e a jit fora de `simulated` (23514); a jit nunca recebe lembrete, nem com a vaga
// geral do webinario, e nao entra nas sessoes do editor.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const sessionRoute = await import("../../src/app/api/webinars/[id]/session/route.ts");
const registerRoute = await import("../../src/app/api/webinars/[id]/register/route.ts");
const { processWebinarReminders } = await import("../../src/server/webinars/reminders.ts");
const { queueWebinarCancelledNotices } = await import("../../src/server/webinars/notify.ts");
const { runJobsTick } = await import("../../src/server/jobs/run-tick.ts");
const { webinarRemindersJob, WEBINAR_REMINDERS_JOB_NAME } = await import("../../src/server/jobs/webinar-reminders-job.ts");
const { listNotifications } = await import("../../src/server/communications/inbox.ts");
const jitRoute = await import("../../src/app/api/webinars/[id]/jit/route.ts");
const { getWebinarEditorData } = await import("../../src/server/webinars/queries.ts");

const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const pessoas = [aluna.id, alunoSemAcesso.id, produtor.id];
const webinarId = WEBINARIO_DE_TESTE.id;
const sessaoId = WEBINARIO_DE_TESTE.sessaoId;
const paginaDaLive = `/webinarios/${WEBINARIO_DE_TESTE.slug}`;
const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;
const quemTemOCurso = { kind: "rules", root: { items: [{ op: "has", productIds: [ESCOLA_DE_TESTE.curso.id], type: "product" }], match: "all" } };
const ninguem = { kind: "rules", root: { items: [{ op: "has", productIds: ["produto-que-ninguem-tem"], type: "product" }], match: "all" } };

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
  unwrap(await db.from("notifications").delete().in("user_id", pessoas).eq("kind", "webinar"), "Apagando o sino de webinario de teste");
  unwrap(
    await db.from("email_outbox").delete().in("user_id", pessoas).in("kind", ["webinar_reminder_24h", "webinar_reminder_1h", "webinar_cancelled"]),
    "Apagando os e-mails de webinario de teste"
  );
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedWebinarioDeTeste(db);
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
  await limparRastros();
});

const contexto = { params: Promise.resolve({ id: webinarId }) };

async function sessao(user) {
  actAs(user);
  return sessionRoute.GET(new Request(`http://localhost/api/webinars/${webinarId}/session`), contexto);
}

async function garantirVaga(user, body = {}) {
  actAs(user);
  return registerRoute.POST(
    new Request(`http://localhost/api/webinars/${webinarId}/register`, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" }),
    contexto
  );
}

async function cancelarVaga(user) {
  actAs(user);
  return registerRoute.DELETE(
    new Request(`http://localhost/api/webinars/${webinarId}/register`, { body: "{}", headers: { "content-type": "application/json" }, method: "DELETE" }),
    contexto
  );
}

async function avisosDeLive(user) {
  const pagina = await listNotifications({ limit: 20, userId: user.id });
  return pagina.items.filter((item) => item.href === paginaDaLive);
}

async function vagas(userId) {
  return unwrap(
    await db
      .from("webinar_registrations")
      .select("id,session_id,status,reminder_24h_sent_at,reminder_1h_sent_at,cancelled_notice_sent_at")
      .eq("webinar_id", webinarId)
      .eq("user_id", userId),
    "Lendo as vagas"
  );
}

async function eventos(userId) {
  return unwrap(
    await db.from("student_events").select("event_type,entity_id,metadata").eq("user_id", userId).eq("entity_type", "webinar").order("created_at"),
    "Lendo o historico"
  );
}

async function emails(userId, kind) {
  return unwrap(await db.from("email_outbox").select("id,kind,to_email,subject,idempotency_key").eq("user_id", userId).eq("kind", kind), "Lendo a fila de e-mail");
}

async function acesso(accessMode, audience) {
  unwrap(await db.from("webinars").update({ access_mode: accessMode, audience }).eq("id", webinarId), "Mudando quem pode ver");
}

async function marcarPara(instante) {
  unwrap(await db.from("webinar_sessions").update({ scheduled_at: instante.toISOString() }).eq("id", sessaoId), "Movendo a hora marcada");
  unwrap(await db.from("webinars").update({ scheduled_at: instante.toISOString() }).eq("id", webinarId), "Movendo a hora marcada do webinario");
}

test("1. a politica do historico: a aluna logada nao grava entity_type 'webinar' (42501); o proprio login continua passando", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");

  const recusa = await cliente.from("student_events").insert({
    entity_id: sessaoId,
    entity_type: "webinar",
    event_type: "webinar_registered",
    metadata: {},
    user_id: aluna.id
  });
  assert.equal(recusa.error?.code, "42501", JSON.stringify(recusa.error));

  const aceita = await cliente.from("student_events").insert({ entity_type: "auth", event_type: "login", metadata: {}, user_id: aluna.id });
  assert.equal(aceita.error, null, `o navegador continua gravando o proprio login: ${JSON.stringify(aceita.error)}`);
  unwrap(await db.from("student_events").delete().eq("user_id", aluna.id).eq("event_type", "login").eq("entity_type", "auth"), "Apagando o login de teste");
  await cliente.auth.signOut();
});

test("2. a rota da sessao: 401 sem sessao, 404 para quem nao pode ver (sem dizer se existe), 200 com a fase e a vaga", async () => {
  assert.equal((await sessao(null)).status, 401);

  await acesso("audience", quemTemOCurso);
  const semAcesso = await sessao(alunoSemAcesso);
  assert.equal(semAcesso.status, 404, await semAcesso.clone().text());

  const comAcesso = await sessao(aluna);
  assert.equal(comAcesso.status, 200, await comAcesso.clone().text());
  const { data } = await comAcesso.json();
  assert.equal(data.session.id, sessaoId);
  assert.equal(data.session.kind, "live");
  assert.equal(data.me.registered, false);
  assert.equal(typeof data.serverTime, "string");
  assert.equal(data.webinar.slug, WEBINARIO_DE_TESTE.slug);

  await acesso("everyone", { kind: "everyone" });
  assert.equal((await sessao(alunoSemAcesso)).status, 200, "aberto para todos, o aluno sem curso tambem ve");
});

test("3. Garantir vaga: 201 com o calendario, repetir devolve 200 sem duplicar, um webinar_registered; cancelar grava cancelled: true uma vez", async () => {
  const primeira = await garantirVaga(aluna, { source: "email" });
  assert.equal(primeira.status, 201, await primeira.clone().text());
  const corpo = (await primeira.json()).data;
  assert.equal(corpo.registration.sessionId, sessaoId);
  assert.match(corpo.calendarUrl, /\/api\/webinars\/.+\/calendar\?token=/);
  assert.match(corpo.googleUrl, /^https:\/\/calendar\.google\.com\//);

  const segunda = await garantirVaga(aluna, {});
  assert.equal(segunda.status, 200, await segunda.clone().text());

  const linhas = await vagas(aluna.id);
  assert.equal(linhas.length, 1, "uma vaga por aluno e sessao");
  assert.equal(linhas[0].status, "registered");

  const historico = await eventos(aluna.id);
  assert.deepEqual(
    historico.map((linha) => [linha.event_type, linha.entity_id, linha.metadata.source, linha.metadata.cancelled ?? null]),
    [["webinar_registered", sessaoId, "email", null]]
  );

  // Quem nao pode ver tambem nao garante vaga: 404, mesmo com o corpo certo.
  await acesso("audience", ninguem);
  assert.equal((await garantirVaga(alunoSemAcesso, {})).status, 404);
  await acesso("everyone", { kind: "everyone" });

  const cancelada = await cancelarVaga(aluna);
  assert.equal(cancelada.status, 200, await cancelada.clone().text());
  assert.equal((await cancelada.json()).data.cancelled, true);
  assert.equal((await vagas(aluna.id))[0].status, "cancelled");
  const depois = await eventos(aluna.id);
  assert.equal(depois.length, 2);
  assert.equal(depois[1].metadata.cancelled, true);

  const deNovo = await cancelarVaga(aluna);
  assert.equal((await deNovo.json()).data.cancelled, false, "repetir nao grava de novo");
  assert.equal((await eventos(aluna.id)).length, 2);

  // A vaga volta (para o tick abaixo) como uma vaga nova.
  const volta = await garantirVaga(aluna, {});
  assert.equal(volta.status, 201, await volta.clone().text());
  assert.equal((await vagas(aluna.id)).length, 1);
});

test("4. o tick: o lembrete de 24 h sai uma vez por vaga (sino + fila de e-mail), a equipe fica de fora, o tick seguinte nao repete; depois o de 1 h", async () => {
  // O produtor tambem tem vaga (direto no banco): a equipe nunca recebe lembrete.
  unwrap(
    await db.from("webinar_registrations").insert({ session_id: sessaoId, status: "registered", user_id: produtor.id, webinar_id: webinarId }),
    "Vaga do produtor"
  );

  // Daqui a 3 dias (a fixture): fora da janela, nada sai.
  const cedo = await processWebinarReminders({ db });
  assert.equal(cedo.pendingMigration, false);
  assert.equal(cedo.reminders24h + cedo.reminders1h, 0, JSON.stringify(cedo));
  assert.equal((await avisosDeLive(aluna)).length, 0);

  // A hora marcada passa para daqui a 23 h 59 min: o job do tick, pelo registro, manda o de 24 h.
  await marcarPara(new Date(Date.now() + 24 * HORA_MS - MINUTO_MS));
  const tick = await runJobsTick({ jobs: [webinarRemindersJob], supabase: db });
  assert.deepEqual(tick.failed, [], JSON.stringify(tick));
  assert.ok(tick.ran.includes(WEBINAR_REMINDERS_JOB_NAME));

  const vagaDaAluna = (await vagas(aluna.id))[0];
  assert.ok(vagaDaAluna.reminder_24h_sent_at, "a marca do lembrete de 24 h");
  assert.equal(vagaDaAluna.reminder_1h_sent_at, null);

  const lembretes = await avisosDeLive(aluna);
  assert.equal(lembretes.length, 1, JSON.stringify(lembretes));
  assert.match(`${lembretes[0].title} ${lembretes[0].body}`, /Boas-vindas/);

  const filaDaAluna = await emails(aluna.id, "webinar_reminder_24h");
  assert.equal(filaDaAluna.length, 1, "um e-mail de 24 h na fila");
  assert.equal(filaDaAluna[0].to_email, contas.aluna.email);

  assert.equal((await avisosDeLive(produtor)).length, 0, "a equipe nao recebe");
  assert.equal((await emails(produtor.id, "webinar_reminder_24h")).length, 0);

  // O tick seguinte, na mesma janela: nada de novo.
  const repeticao = await processWebinarReminders({ db });
  assert.equal(repeticao.reminders24h, 0, JSON.stringify(repeticao));
  assert.equal((await avisosDeLive(aluna)).length, 1);
  assert.equal((await emails(aluna.id, "webinar_reminder_24h")).length, 1);

  // Uma hora antes: o de 1 h, uma vez.
  await marcarPara(new Date(Date.now() + 59 * MINUTO_MS));
  const tickDe1h = await processWebinarReminders({ db });
  assert.equal(tickDe1h.reminders1h, 1, JSON.stringify(tickDe1h));
  assert.equal((await avisosDeLive(aluna)).length, 2);
  assert.equal((await emails(aluna.id, "webinar_reminder_1h")).length, 1);
  assert.equal((await processWebinarReminders({ db })).reminders1h, 0, "repetir nao manda de novo");
});

test("5. cancelar o webinario avisa quem tinha vaga uma vez (sino + e-mail com o motivo); a equipe nao", async () => {
  unwrap(
    await db.from("webinars").update({ cancel_reason: "Imprevisto com o apresentador.", cancelled_at: new Date().toISOString() }).eq("id", webinarId),
    "Cancelando"
  );

  const primeiro = await queueWebinarCancelledNotices(db, webinarId, new Date());
  assert.deepEqual(primeiro, { emails: 1, notifications: 1 });
  const segundo = await queueWebinarCancelledNotices(db, webinarId, new Date());
  assert.deepEqual(segundo, { emails: 0, notifications: 0 }, "repetir nao manda de novo");

  assert.equal((await avisosDeLive(aluna)).length, 3, "dois lembretes e o cancelamento");
  const fila = await emails(aluna.id, "webinar_cancelled");
  assert.equal(fila.length, 1);
  assert.match(fila[0].subject, /cancelada/i);
  assert.equal((await emails(produtor.id, "webinar_cancelled")).length, 0);
  assert.ok((await vagas(aluna.id))[0].cancelled_notice_sent_at);
});

test("6. Comeca quando voce entra (fase 4e): a sessao do horario nasce uma vez para dois alunos, sem vaga; o banco garante uma por horario; nada de lembrete; fora do editor", async () => {
  const jitId = "bbbbbbbb-0000-4000-8000-0000000000e1";
  const slug = "teste-comeca-quando-voce-entra";
  const agora = new Date().toISOString();
  unwrap(
    await db.from("webinars").upsert(
      {
        access_mode: "everyone",
        capacity: 5,
        created_by: produtor.id,
        description: "Live gravada de teste com o Comeca quando voce entra.",
        duration_minutes: 60,
        id: jitId,
        // A janela inteira do dia, a cada 15 min, ate o fim do video: sempre ha um horario aceitando entrada.
        jit_settings: { enabled: true, endHour: 24, everyMinutes: 15, lateJoinMinutes: null, simulation: null, startHour: 0 },
        kind: "simulated",
        published_at: agora,
        registration_required: true,
        slug,
        status: "published",
        title: "Live Gravada de Teste: Quando você entra"
      },
      { onConflict: "id" }
    ),
    "Gravando o webinario do jit"
  );
  unwrap(
    await db.from("webinar_recordings").insert({
      duration_seconds: 3600,
      embed_url: "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc",
      provider: "bunny",
      session_id: null,
      source: "bunny",
      status: "ready",
      webinar_id: jitId
    }),
    "Gravando o video base do jit"
  );

  const contextoJit = { params: Promise.resolve({ id: jitId }) };
  const entrar = async (user) => {
    actAs(user);
    return jitRoute.POST(new Request(`http://localhost/api/webinars/${jitId}/jit`, { body: "{}", headers: { "content-type": "application/json" }, method: "POST" }), contextoJit);
  };

  const primeira = await entrar(aluna);
  assert.equal(primeira.status, 200, await primeira.clone().text());
  const daAluna = (await primeira.json()).data;
  const segunda = await entrar(alunoSemAcesso);
  assert.equal(segunda.status, 200, await segunda.clone().text());
  const doOutro = (await segunda.json()).data;
  assert.equal(doOutro.sessionId, daAluna.sessionId, "a mesma turma");
  assert.equal(daAluna.roomHref, `/webinarios/${slug}/sala?sessao=${daAluna.sessionId}`);

  const linhas = unwrap(await db.from("webinar_sessions").select("id,jit,kind,status,scheduled_at,recording_id").eq("webinar_id", jitId), "Lendo as sessoes do jit");
  assert.equal(linhas.length, 1);
  assert.deepEqual([linhas[0].jit, linhas[0].kind, linhas[0].status], [true, "simulated", "scheduled"]);
  assert.equal(Date.parse(linhas[0].scheduled_at), Date.parse(daAluna.scheduledAt), "o mesmo instante (o banco devolve +00:00)");
  assert.ok(linhas[0].recording_id, "o video base");
  assert.equal(unwrap(await db.from("webinar_registrations").select("id").eq("webinar_id", jitId), "Lendo as vagas do jit").length, 0, "nenhuma vaga");

  // A sala da sessao jit abre sem vaga, mesmo com limite de vagas.
  actAs(aluna);
  const sala = await sessionRoute.GET(new Request(`http://localhost/api/webinars/${jitId}/session?sessao=${daAluna.sessionId}`), contextoJit);
  assert.equal(sala.status, 200, await sala.clone().text());
  assert.deepEqual((await sala.json()).data.session.join, { ok: true });

  // O banco: uma sessao jit por horario (23505) e so na Live gravada (23514).
  const repetida = await db.from("webinar_sessions").insert({ jit: true, kind: "simulated", scheduled_at: daAluna.scheduledAt, status: "scheduled", webinar_id: jitId });
  assert.equal(repetida.error?.code, "23505", JSON.stringify(repetida.error));
  const aoVivo = await db.from("webinar_sessions").insert({ jit: true, kind: "live", scheduled_at: new Date(Date.parse(daAluna.scheduledAt) + 3 * HORA_MS).toISOString(), status: "scheduled", webinar_id: jitId });
  assert.equal(aoVivo.error?.code, "23514", JSON.stringify(aoVivo.error));

  // Nenhum lembrete para a sessao jit, nem com a vaga geral do webinario (sem sessao).
  unwrap(await db.from("webinar_registrations").insert({ session_id: null, status: "registered", user_id: aluna.id, webinar_id: jitId }), "Vaga geral no jit");
  await processWebinarReminders({ db });
  const avisos = (await listNotifications({ limit: 50, userId: aluna.id })).items.filter((item) => item.href === `/webinarios/${slug}`);
  assert.deepEqual(avisos, []);

  // O historico: um webinar_jit_entered por entrada, created so para quem criou.
  const historico = unwrap(await db.from("student_events").select("user_id,metadata").eq("event_type", "webinar_jit_entered").eq("entity_id", daAluna.sessionId), "Lendo o historico do jit");
  assert.deepEqual(historico.map((linha) => linha.metadata.created).sort(), [false, true]);

  // O editor nao lista nem conta a sessao jit.
  const editor = await getWebinarEditorData(jitId);
  assert.deepEqual([editor.sessions.length, editor.draft.sessions.length, editor.jit.enabled], [0, 0, true]);
  actAs(null);
});
