import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { SENHA_DE_TESTE, limparWebinarios, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Webinarios, fase 4 (docs/30 §1.6, §2.4, §3.4, §4.2, §5.1, §6.6, D24 e §11; docs/18 §3) contra o banco LOCAL de
// verdade, com as migracoes 202610300004, 202610300005 e 202610300006 aplicadas:
// - o Assistente: webinar_ai_requests e unico por alvo (insertAiRequest devolve `created: false` na segunda vez: o
//   Assistente nunca responde duas vezes), "Falar com a equipe" pela rota POST /api/webinars/[id]/handoff (a marca na
//   pergunta do proprio aluno, uma vez; a de outro aluno: 404) e as linhas ai/* de webinar_report (respostas sem as
//   apagadas, tempo medio, corrigidas, apagadas e pedidos de equipe) fora das mensagens de alunos;
// - "Comeca quando voce entra": ensureJitSessionRow duas vezes no mesmo horario (e duas ao mesmo tempo) da uma sessao
//   so, que copia a Simulacao das regras com a decisao registrada; a rota POST /api/webinars/[id]/jit leva dois alunos
//   para a mesma sessao do horario e grava webinar_jit_entered; o check deixa `jit` so na sessao gravada; e a
//   webinar_chat_window da sessao jit traz a mensagem aprovada da turma de outra sessao jit do mesmo dia de Sao Paulo
//   (inclusive depois da meia-noite UTC), nunca a pendente, a de outro dia nem a da sessao marcada, e a promovida uma
//   vez so;
// - a traducao: webinar_text_translations com a chave (sha256 do texto normalizado, idioma) unica, insertTranslations
//   que fica com a primeira, e a preferencia do aluno pela rota /api/webinars/preferences (desligada sem
//   WEBINAR_TRANSLATION_ENABLED=on; ligada, grava webinar_viewer_prefs e webinar_chat_language_set);
// - o aluno logado recebe 42501 nas cinco tabelas novas e na RPC da janela do chat.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const { ensureJitSessionRow } = await import("../../src/server/webinars/jit-store.ts");
const { insertAiRequest } = await import("../../src/server/webinars/assistant-store.ts");
const { fetchTranslations, insertTranslations } = await import("../../src/server/webinars/translation-store.ts");
const { fetchWebinarReport } = await import("../../src/server/webinars/store.ts");
const { translationSourceHash } = await import("../../src/server/webinars/text-hash.ts");
const { defaultJitSettings } = await import("../../src/server/webinars/model.ts");
const jitRoute = await import("../../src/app/api/webinars/[id]/jit/route.ts");
const handoffRoute = await import("../../src/app/api/webinars/[id]/handoff/route.ts");
const preferencesRoute = await import("../../src/app/api/webinars/preferences/route.ts");

const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const pessoas = [aluna.id, alunoSemAcesso.id, produtor.id];

const JIT = {
  gravacaoId: "bbbbbbbb-0000-4000-8000-000000000502",
  id: "bbbbbbbb-0000-4000-8000-000000000501",
  slug: "teste-v4-comeca-quando-entra",
  titulo: "Live de Teste v4: Começa quando você entra"
};
/** As sessoes fixas da turma do dia (10/06/2020 em Sao Paulo) e as de fora dela. */
const TURMA = {
  dasDoze: "bbbbbbbb-0000-4000-8000-000000000510",
  dasDozeEQuinze: "bbbbbbbb-0000-4000-8000-000000000511",
  dasVinteETresETrinta: "bbbbbbbb-0000-4000-8000-000000000512",
  doDiaSeguinte: "bbbbbbbb-0000-4000-8000-000000000513",
  marcada: "bbbbbbbb-0000-4000-8000-000000000514"
};
const MENSAGEM = {
  daEquipe: "bbbbbbbb-0000-4000-8000-000000000527",
  daMinhaSessao: "bbbbbbbb-0000-4000-8000-000000000520",
  daSessaoMarcada: "bbbbbbbb-0000-4000-8000-000000000525",
  daTurma: "bbbbbbbb-0000-4000-8000-000000000521",
  depoisDaMeiaNoiteUtc: "bbbbbbbb-0000-4000-8000-000000000523",
  doOutroDia: "bbbbbbbb-0000-4000-8000-000000000524",
  pendente: "bbbbbbbb-0000-4000-8000-000000000522",
  promovida: "bbbbbbbb-0000-4000-8000-000000000526"
};
const PERGUNTA = { daAluna: "bbbbbbbb-0000-4000-8000-000000000530", doAluno: "bbbbbbbb-0000-4000-8000-000000000531" };
const TEXTO = "Boa noite,   turma!";
const ENV_TRADUCAO = process.env.WEBINAR_TRANSLATION_ENABLED;

const contexto = (id = JIT.id) => ({ params: Promise.resolve({ id }) });

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
  unwrap(await db.from("webinar_viewer_prefs").delete().in("user_id", pessoas), "Apagando o idioma do chat de teste");
  unwrap(await db.from("webinar_text_translations").delete().eq("source_hash", translationSourceHash(TEXTO)), "Apagando a traducao de teste");
}

/** A Live gravada com "Comeca quando voce entra" ligado o dia inteiro, a cada 15 min, com o video base de 1 h. */
async function seedJit() {
  unwrap(
    await db.from("webinars").insert({
      access_mode: "everyone",
      created_by: produtor.id,
      duration_minutes: 60,
      host_user_id: produtor.id,
      id: JIT.id,
      jit_settings: { enabled: true, endHour: 24, everyMinutes: 15, lateJoinMinutes: null, simulation: null, startHour: 0 },
      kind: "simulated",
      published_at: new Date(Date.now() - 86_400_000).toISOString(),
      registration_required: false,
      room_settings: { anonymousQuestions: true, chatMode: "open", displayName: "first_name_initial" },
      slug: JIT.slug,
      status: "published",
      title: JIT.titulo
    }),
    "Gravando a live gravada do just-in-time"
  );
  unwrap(
    await db.from("webinar_recordings").insert({
      bunny_library_id: "1",
      bunny_video_id: "teste-v4-jit",
      duration_seconds: 3600,
      embed_url: "https://iframe.mediadelivery.net/embed/1/teste-v4-jit",
      id: JIT.gravacaoId,
      provider: "bunny",
      source: "bunny",
      status: "ready",
      webinar_id: JIT.id
    }),
    "Gravando o video base"
  );
  // A turma de 10/06/2020 (Sao Paulo): 12:00, 12:15 e 23:30 (02:30 UTC do dia 11); 00:15 do dia 11; e uma marcada.
  const sessao = (id, scheduledAt, jit, status = "ended") => ({ id, jit, kind: "simulated", recording_id: JIT.gravacaoId, scheduled_at: scheduledAt, status, webinar_id: JIT.id });
  unwrap(
    await db
      .from("webinar_sessions")
      .insert([
        sessao(TURMA.dasDoze, "2020-06-10T15:00:00.000Z", true),
        sessao(TURMA.dasDozeEQuinze, "2020-06-10T15:15:00.000Z", true, "live"),
        sessao(TURMA.dasVinteETresETrinta, "2020-06-11T02:30:00.000Z", true),
        sessao(TURMA.doDiaSeguinte, "2020-06-11T03:15:00.000Z", true),
        sessao(TURMA.marcada, "2020-06-10T18:00:00.000Z", false)
      ]),
    "Gravando as sessoes da turma"
  );
  const mensagem = (id, sessionId, offsetMs, body, extra = {}) => ({
    approved: true,
    author_user_id: aluna.id,
    body,
    display_name: "Aluna T.",
    id,
    master: false,
    offset_ms: offsetMs,
    role: "student",
    session_id: sessionId,
    source: "audience",
    webinar_id: JIT.id,
    ...extra
  });
  unwrap(
    await db.from("webinar_chat_messages").insert([
      mensagem(MENSAGEM.daMinhaSessao, TURMA.dasDozeEQuinze, 20_000, "da minha sessão", { author_user_id: alunoSemAcesso.id, display_name: "Aluno S." }),
      mensagem(MENSAGEM.daTurma, TURMA.dasDoze, 30_000, "da turma do dia"),
      mensagem(MENSAGEM.pendente, TURMA.dasDoze, 40_000, "ainda na moderação", { approved: false }),
      mensagem(MENSAGEM.depoisDaMeiaNoiteUtc, TURMA.dasVinteETresETrinta, 50_000, "às 23:30 de Brasília"),
      mensagem(MENSAGEM.doOutroDia, TURMA.doDiaSeguinte, 60_000, "do outro dia"),
      mensagem(MENSAGEM.daSessaoMarcada, TURMA.marcada, 70_000, "da sessão marcada"),
      mensagem(MENSAGEM.promovida, TURMA.dasDoze, 80_000, "promovida pela equipe", { master: true }),
      mensagem(MENSAGEM.daEquipe, TURMA.dasDoze, 90_000, "da equipe noutra sessão", { author_user_id: produtor.id, display_name: "Equipe", role: "team", source: "team" })
    ]),
    "Gravando o chat da turma"
  );
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedJit();
});

after(async () => {
  actAs(null);
  if (ENV_TRADUCAO === undefined) {
    delete process.env.WEBINAR_TRANSLATION_ENABLED;
  } else {
    process.env.WEBINAR_TRANSLATION_ENABLED = ENV_TRADUCAO;
  }
  await limparWebinarios(db);
  await limparRastros();
});

test("1. ensureJitSessionRow: o mesmo horario duas vezes (e duas ao mesmo tempo) da uma sessao so, gravada, jit e com a Simulacao copiada das regras", async () => {
  const decididaEm = "2026-10-29T12:00:00.000Z";
  const settings = {
    ...defaultJitSettings(),
    enabled: true,
    simulation: {
      ackText: "Decisão do produtor em 29/10/2026: teste.",
      countRule: { base: 30, jitter: 0, mode: "fixed", peak: 30 },
      decidedAt: decididaEm,
      decidedBy: produtor.id,
      joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" },
      saleNotices: { enabled: false, items: [] },
      showLiveBadge: true
    }
  };
  const pedido = (scheduledAt) => ({ chat_mode: "open", chat_slow_mode_seconds: null, late_join_minutes: null, recording_id: JIT.gravacaoId, scheduled_at: scheduledAt, settings, source_session_id: null, webinar_id: JIT.id });

  const primeira = await ensureJitSessionRow(db, pedido("2030-01-15T13:00:00.000Z"));
  const segunda = await ensureJitSessionRow(db, pedido("2030-01-15T13:00:00.000Z"));
  assert.deepEqual([primeira.created, segunda.created], [true, false]);
  assert.equal(segunda.row.id, primeira.row.id, "o mesmo horario, a mesma sessao");

  const juntas = await Promise.all([ensureJitSessionRow(db, pedido("2030-01-15T13:15:00.000Z")), ensureJitSessionRow(db, pedido("2030-01-15T13:15:00.000Z"))]);
  assert.deepEqual(juntas.map((resultado) => resultado.created).sort(), [false, true], "o indice unico deixa uma criar e a outra le (23505)");
  assert.equal(juntas[0].row.id, juntas[1].row.id);

  const linhas = unwrap(
    await db
      .from("webinar_sessions")
      .select("id, jit, kind, status, show_live_badge, simulated_count_rule, simulation_ack_text, simulation_decided_by, simulation_decided_at")
      .eq("webinar_id", JIT.id)
      .gte("scheduled_at", "2030-01-15T00:00:00.000Z"),
    "Lendo as sessoes jit criadas"
  );
  assert.equal(linhas.length, 2, "uma por horario");
  for (const linha of linhas) {
    assert.deepEqual([linha.jit, linha.kind, linha.status, linha.show_live_badge], [true, "simulated", "scheduled", true]);
    assert.deepEqual(linha.simulated_count_rule, { base: 30, jitter: 0, mode: "fixed", peak: 30 });
    assert.equal(linha.simulation_ack_text, "Decisão do produtor em 29/10/2026: teste.");
    assert.equal(linha.simulation_decided_by, produtor.id);
    assert.equal(Date.parse(linha.simulation_decided_at), Date.parse(decididaEm), "compara o instante: o PostgREST escreve +00:00");
  }

  const ruim = await db.from("webinar_sessions").insert({ jit: true, kind: "live", scheduled_at: "2030-01-15T14:00:00.000Z", status: "scheduled", webinar_id: JIT.id });
  assert.equal(ruim.error?.code, "23514", `jit so na sessao gravada: ${JSON.stringify(ruim.error)}`);
});

test("2. POST /api/webinars/[id]/jit: dois alunos no mesmo horario caem na mesma sessao, sem vaga, e webinar_jit_entered fica no historico", async () => {
  const entrar = async (user) => {
    actAs(user);
    const resposta = await jitRoute.POST(new Request(`http://localhost/api/webinars/${JIT.id}/jit`, { body: "{}", headers: { "content-type": "application/json" }, method: "POST" }), contexto());
    return { body: await resposta.json(), status: resposta.status };
  };

  actAs(null);
  const semSessao = await jitRoute.POST(new Request(`http://localhost/api/webinars/${JIT.id}/jit`, { body: "{}", headers: { "content-type": "application/json" }, method: "POST" }), contexto());
  assert.equal(semSessao.status, 401);

  const daAluna = await entrar(aluna);
  assert.equal(daAluna.status, 200, JSON.stringify(daAluna.body));
  const doAluno = await entrar(alunoSemAcesso);
  assert.equal(doAluno.status, 200, JSON.stringify(doAluno.body));
  assert.equal(doAluno.body.data.sessionId, daAluna.body.data.sessionId, "a turma e quem entra no mesmo horario");
  assert.equal(daAluna.body.data.roomHref, `/webinarios/${JIT.slug}/sala?sessao=${daAluna.body.data.sessionId}`);

  const horario = Date.parse(daAluna.body.data.scheduledAt);
  assert.equal(new Date(horario).getUTCMinutes() % 15, 0, "o horario e um limite de 15 min");
  assert.ok(horario <= Date.now() + 15 * 60_000 && horario > Date.now() - 15 * 60_000 - 60_000, "o horario de agora (ou o proximo, com a sala aberta)");

  const sessao = unwrap(await db.from("webinar_sessions").select("jit, kind, recording_id, scheduled_at").eq("id", daAluna.body.data.sessionId).single(), "Lendo a sessao do horario");
  assert.deepEqual([sessao.jit, sessao.kind, sessao.recording_id], [true, "simulated", JIT.gravacaoId]);
  assert.equal(Date.parse(sessao.scheduled_at), horario);
  assert.equal(unwrap(await db.from("webinar_registrations").select("id").eq("webinar_id", JIT.id), "Lendo as vagas").length, 0, "nunca pede vaga");

  const eventos = unwrap(
    await db.from("student_events").select("user_id, metadata").eq("event_type", "webinar_jit_entered").eq("entity_id", daAluna.body.data.sessionId),
    "Lendo webinar_jit_entered"
  );
  assert.deepEqual(eventos.map((evento) => [evento.user_id, evento.metadata.created]).sort(), [
    [aluna.id, true],
    [alunoSemAcesso.id, false]
  ].sort());
});

test("3. webinar_chat_window da sessao jit: a turma do dia (aprovada, outra sessao jit do mesmo dia de Sao Paulo), nunca a pendente, a de outro dia nem a da sessao marcada; a promovida uma vez", async () => {
  const janela = async (sessionId) => unwrap(await db.rpc("webinar_chat_window", { p_from_ms: 0, p_session_id: sessionId, p_to_ms: 120_000, p_user_id: null }), "Lendo a janela");

  const daJit = await janela(TURMA.dasDozeEQuinze);
  assert.deepEqual(
    daJit.map((linha) => linha.id),
    [MENSAGEM.daMinhaSessao, MENSAGEM.daTurma, MENSAGEM.depoisDaMeiaNoiteUtc, MENSAGEM.promovida],
    "a propria, a turma das 12:00, a das 23:30 de Brasilia (02:30 UTC do dia seguinte) e a promovida, na ordem do offset"
  );
  assert.deepEqual(daJit.map((linha) => linha.offset_ms), [20_000, 30_000, 50_000, 80_000], "pelo segundo em que foram escritas");

  const daMarcada = await janela(TURMA.marcada);
  assert.deepEqual(daMarcada.map((linha) => linha.id), [MENSAGEM.daSessaoMarcada, MENSAGEM.promovida], "fora das sessoes jit nada muda: a propria e a linha mestre");
});

test("4. o Assistente: webinar_ai_requests unico por alvo, Falar com a equipe pela rota e as linhas ai/* de webinar_report fora das mensagens de alunos", async () => {
  const sessao = TURMA.dasDozeEQuinze;
  const agora = Date.now();
  unwrap(
    await db.from("webinar_questions").insert([
      { body: "Quanto custa?", display_name: "Aluna T.", id: PERGUNTA.daAluna, offset_ms: 25_000, session_id: sessao, status: "answered", user_id: aluna.id },
      // Em lote, a coluna que falta numa linha vai nula (nao o padrao): o status vai explicito nas duas.
      { body: "Tem certificado?", display_name: "Aluno S.", id: PERGUNTA.doAluno, offset_ms: 26_000, session_id: sessao, status: "open", user_id: alunoSemAcesso.id }
    ]),
    "Gravando as perguntas"
  );

  const pedido = { requested_at: new Date(agora - 4000).toISOString(), session_id: sessao, target_id: MENSAGEM.daMinhaSessao, target_kind: "chat", user_id: alunoSemAcesso.id, webinar_id: JIT.id };
  const primeiro = await insertAiRequest(db, pedido);
  const repetido = await insertAiRequest(db, { ...pedido, requested_at: new Date(agora).toISOString() });
  assert.equal(primeiro.created, true);
  assert.deepEqual(repetido, { created: false, request: null }, "o Assistente nunca responde duas vezes ao mesmo alvo");
  unwrap(await db.from("webinar_ai_requests").update({ answered_at: new Date(agora).toISOString(), status: "answered" }).eq("id", primeiro.request.id), "Respondendo o pedido do chat");
  unwrap(
    await db.from("webinar_ai_requests").insert([
      { answered_at: new Date(agora).toISOString(), requested_at: new Date(agora - 8000).toISOString(), session_id: sessao, status: "answered", target_id: PERGUNTA.daAluna, target_kind: "question", user_id: aluna.id, webinar_id: JIT.id },
      { requested_at: new Date(agora - 2000).toISOString(), session_id: sessao, skip_reason: "claimed", status: "skipped", target_id: MENSAGEM.daEquipe, target_kind: "chat", user_id: aluna.id, webinar_id: JIT.id }
    ]),
    "Gravando os outros pedidos"
  );
  const resposta = (body, extra = {}) => ({ body, display_name: "Assistente", kind: "answer", offset_ms: 27_000, role: "ai", session_id: sessao, source: "ai", webinar_id: JIT.id, ...extra });
  unwrap(
    await db.from("webinar_chat_messages").insert([
      resposta("Respondendo no chat.", { reply_to_id: MENSAGEM.daMinhaSessao }),
      resposta("Corrigida pela equipe.", { edited_at: new Date(agora).toISOString(), edited_by: produtor.id }),
      resposta("Apagada pela equipe.", { deleted_at: new Date(agora).toISOString(), deleted_by: produtor.id, deleted_reason: "team" })
    ]),
    "Gravando as respostas do Assistente"
  );
  unwrap(await db.from("webinar_questions").update({ answer_source: "ai", answer_text: "R$ 997." }).eq("id", PERGUNTA.daAluna), "Marcando a resposta do Assistente");

  // "Falar com a equipe": a pergunta da propria aluna, uma vez; a do outro aluno nao existe para ela.
  const pedirEquipe = async (id) => {
    actAs(aluna);
    const resposta = await handoffRoute.POST(
      new Request(`http://localhost/api/webinars/${JIT.id}/handoff`, { body: JSON.stringify({ id, sessionId: sessao, target: "question" }), headers: { "content-type": "application/json" }, method: "POST" }),
      contexto()
    );
    return { body: await resposta.json(), status: resposta.status };
  };
  const pedido1 = await pedirEquipe(PERGUNTA.daAluna);
  assert.deepEqual([pedido1.status, pedido1.body.data], [200, { requested: true }], JSON.stringify(pedido1.body));
  const pedido2 = await pedirEquipe(PERGUNTA.daAluna);
  assert.deepEqual([pedido2.status, pedido2.body.data], [200, { requested: false }], "ja estava pedido");
  assert.equal((await pedirEquipe(PERGUNTA.doAluno)).status, 404, "a pergunta de outro aluno: 404 sem dizer se existe");
  actAs(null);
  // E o pedido de equipe que veio pelo chat.
  unwrap(await db.from("webinar_chat_messages").update({ handoff_requested_at: new Date(agora).toISOString() }).eq("id", MENSAGEM.daMinhaSessao), "Marcando o pedido pelo chat");

  const rows = await fetchWebinarReport(db, sessao);
  const ai = Object.fromEntries(rows.filter((row) => row.metric === "ai").map((row) => [row.item, row.total]));
  assert.deepEqual(ai, { avg_seconds: 6, deleted: 1, edited: 1, handoffs: 2, replies: 2 }, "respostas sem a apagada; (4 s + 8 s) / 2; a pergunta e a mensagem que pediram a equipe");
  assert.equal(rows.find((row) => row.metric === "chat_total")?.total, 1, "as respostas do Assistente nao sao mensagens de aluno");
  const marca = unwrap(await db.from("webinar_questions").select("handoff_requested_at, answer_source").eq("id", PERGUNTA.daAluna).single(), "Lendo a pergunta");
  assert.ok(marca.handoff_requested_at);
  assert.equal(marca.answer_source, "ai");

  // A mensagem do chat do tipo pergunta abre a pergunta ligada (message_id) e o "Falar com a equipe" marca as duas: o
  // pedido conta uma vez (revisao da fase 4, 202610300007).
  unwrap(
    await db.from("webinar_questions").insert({
      body: "Pelo chat",
      display_name: "Aluno S.",
      handoff_requested_at: new Date(agora).toISOString(),
      message_id: MENSAGEM.daMinhaSessao,
      offset_ms: 20_000,
      session_id: sessao,
      user_id: alunoSemAcesso.id
    }),
    "Gravando a pergunta ligada a mensagem"
  );
  const depois = await fetchWebinarReport(db, sessao);
  assert.equal(depois.find((row) => row.metric === "ai" && row.item === "handoffs")?.total, 2, "a pergunta da aba e o pedido pelo chat (mensagem + pergunta ligada = 1)");
});

test("5. a traducao: uma por texto e idioma (sha256 do texto normalizado), a repetida fica com a primeira; a preferencia do aluno pela rota, desligada sem o ambiente", async () => {
  const chave = translationSourceHash(TEXTO);
  assert.equal(chave, translationSourceHash("Boa noite, turma!"), "os espacos juntados dao a mesma chave");
  assert.match(chave, /^[0-9a-f]{64}$/);

  const linha = { body: "Good evening, class!", language: "en", provider: "teste", sourceHash: chave, sourceLanguage: "pt" };
  assert.equal(await insertTranslations(db, [linha]), 1);
  assert.equal(await insertTranslations(db, [{ ...linha, body: "Good night, class!" }]), 0, "a repetida nao entra");
  const guardadas = await fetchTranslations(db, { hashes: [chave], language: "en" });
  assert.equal(guardadas.get(chave)?.body, "Good evening, class!");
  const direto = await db.from("webinar_text_translations").insert({ body: "Hi", language: "en", provider: "teste", source_hash: chave });
  assert.equal(direto.error?.code, "23505", "a chave (source_hash, language) e unica");
  assert.equal((await insertTranslations(db, [{ ...linha, body: "Buenas noches, clase!", language: "es" }])), 1, "outro idioma e outra linha");

  const pedirIdioma = async (chatLanguage) => {
    actAs(aluna);
    const resposta = await preferencesRoute.PUT(new Request("http://localhost/api/webinars/preferences", { body: JSON.stringify({ chatLanguage }), headers: { "content-type": "application/json" }, method: "PUT" }));
    return { body: await resposta.json(), status: resposta.status };
  };

  delete process.env.WEBINAR_TRANSLATION_ENABLED;
  const desligada = await pedirIdioma("en");
  assert.deepEqual([desligada.status, desligada.body.data], [200, { chatLanguage: null, enabled: false }]);
  assert.equal(unwrap(await db.from("webinar_viewer_prefs").select("user_id").eq("user_id", aluna.id), "Lendo o idioma").length, 0, "desligada: nada gravado");

  process.env.WEBINAR_TRANSLATION_ENABLED = "on";
  const ligada = await pedirIdioma("en");
  assert.deepEqual([ligada.status, ligada.body.data], [200, { chatLanguage: "en", enabled: true }]);
  assert.equal((await pedirIdioma("fr")).status, 400, "so pt, en, es ou nulo");
  actAs(aluna);
  const lida = await preferencesRoute.GET();
  assert.deepEqual((await lida.json()).data, { chatLanguage: "en", enabled: true });
  actAs(null);
  const prefs = unwrap(await db.from("webinar_viewer_prefs").select("chat_language").eq("user_id", aluna.id).single(), "Lendo o idioma gravado");
  assert.equal(prefs.chat_language, "en");
  const historico = unwrap(await db.from("student_events").select("metadata").eq("user_id", aluna.id).eq("event_type", "webinar_chat_language_set"), "Lendo o historico do idioma");
  assert.deepEqual(historico.map((evento) => evento.metadata), [{ language: "en" }]);
});

test("6. so a service_role: o aluno logado recebe 42501 nas tabelas do Assistente, dos atendentes, dos pedidos, do idioma e das traducoes, e na RPC da janela do chat", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");

  for (const tabela of ["webinar_assistant_knowledge", "webinar_attendants", "webinar_ai_requests", "webinar_viewer_prefs", "webinar_text_translations"]) {
    const leitura = await cliente.from(tabela).select("*").limit(1);
    assert.equal(leitura.error?.code, "42501", `${tabela}: ${JSON.stringify(leitura.error)}`);
  }
  const gravar = await cliente.from("webinar_viewer_prefs").upsert({ chat_language: "es", user_id: aluna.id });
  assert.equal(gravar.error?.code, "42501", JSON.stringify(gravar.error));
  const janela = await cliente.rpc("webinar_chat_window", { p_from_ms: 0, p_session_id: TURMA.dasDozeEQuinze, p_to_ms: 120_000, p_user_id: null });
  assert.equal(janela.error?.code, "42501", JSON.stringify(janela.error));

  await cliente.auth.signOut();
  const prefs = unwrap(await db.from("webinar_viewer_prefs").select("chat_language").eq("user_id", aluna.id).single(), "Conferindo");
  assert.equal(prefs.chat_language, "en", "nada mudou pelo navegador");
});
