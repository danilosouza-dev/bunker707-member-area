import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparWebinarios, seedEscolaDeTeste, SENHA_DE_TESTE, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Webinarios, fase 2c (docs/30 §1.6, §3.4, §3.6, §3.7, §4.4, §4.5 e §4.6; docs/18 §3) contra o banco LOCAL de verdade,
// com a migracao 202610290001 aplicada: o tick das sessoes gravadas abre a sessao na hora marcada (status live,
// started_at = hora marcada, "Comecou agora" uma vez por vaga, a equipe fora) e o tick seguinte nao repete; com as
// amostras de presenca, as mensagens, a reacao, a pergunta e a enquete gravadas pela service role, o tick encerra a
// sessao depois da duracao do video (webinar_attendance resumida, presence_curve congelada) e cria a sessao replay,
// uma so; webinar_report e webinar_attendees conferidos contra numeros calculados a mao aqui; a pagina do relatorio e
// o CSV; as RPCs recusam o aluno logado (42501); a rota do CSV recusa o analista (403) e serve o produtor com a
// auditoria webinar_export. Fase 4 (202610290005 e 202610290006): a Oferta com a janela, os cliques e a compra ligada
// pelo webhook com o valor (offer / offer_revenue), as Respostas do Assistente (ai) e o resumo da Simulacao (sim_*)
// na RPC com dados reais, sem mexer em nenhum numero real; e os CSVs com os nomes do Zoom pelas rotas da sessao e do
// painel. O teste anda com a hora marcada (como o teste dos lembretes) em vez de esperar.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const { runJobsTick } = await import("../../src/server/jobs/run-tick.ts");
const { webinarSessionsJob, WEBINAR_SESSIONS_JOB_NAME } = await import("../../src/server/jobs/webinar-sessions-job.ts");
const { runSessionsTick } = await import("../../src/server/webinars/sessions-tick.ts");
const { fetchWebinarReport } = await import("../../src/server/webinars/store.ts");
const { fetchAttendees } = await import("../../src/server/webinars/chat-store.ts");
const { getWebinarReportPage, loadWebinarReportCsv } = await import("../../src/server/webinars/report-queries.ts");
const { listNotifications } = await import("../../src/server/communications/inbox.ts");
const csvRoute = await import("../../src/app/api/admin/webinars/[id]/relatorio/csv/route.ts");
const panelCsvRoute = await import("../../src/app/api/admin/webinars/painel/csv/route.ts");

const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const analista = usuarioDeTeste(contas.analista);
const produtor = usuarioDeTeste(contas.produtor);
const pessoas = [aluna.id, alunoSemAcesso.id, produtor.id];
const MINUTO_MS = 60_000;

const LIVE = {
  gravacaoId: "bbbbbbbb-0000-4000-8000-000000000023",
  id: "bbbbbbbb-0000-4000-8000-000000000021",
  sessaoId: "bbbbbbbb-0000-4000-8000-000000000022",
  slug: "teste-live-gravada-relatorio",
  titulo: "Live Gravada de Teste: Relatório"
};
const VIDEO_SEGUNDOS = 600; // 20 baldes de 30 s; "ate o fim" = balde 18 em diante

let enqueteId = "";
let opcaoA = "";
let perguntaId = "";

// A venda de teste da Oferta (fase 4): o vinculo, o evento do webhook com o valor e o acesso, apagados antes e depois.
const VENDA = { evento: "evt-teste-relatorio-oferta", produto: "teste-oferta-relatorio", transacao: "T-TESTE-RELATORIO-OFERTA" };

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
  unwrap(await db.from("notifications").delete().in("user_id", pessoas).eq("kind", "webinar"), "Apagando o sino de webinario de teste");
  unwrap(await db.from("sale_grants").delete().eq("transaction_id", VENDA.transacao), "Apagando a venda de teste da oferta");
  unwrap(await db.from("webhook_events").delete().eq("external_event_id", VENDA.evento), "Apagando o webhook de teste da oferta");
  unwrap(await db.from("entitlements").delete().eq("target_id", VENDA.produto), "Apagando o acesso de teste da oferta");
}

/** A live gravada marcada para `scheduledAt`, com o video de 10 min pronto e as vagas da aluna, do aluno sem acesso e do produtor (equipe). */
async function seedLiveGravada(scheduledAt) {
  unwrap(
    await db.from("webinars").upsert(
      {
        access_mode: "everyone",
        created_by: produtor.id,
        duration_minutes: 60,
        host_user_id: produtor.id,
        id: LIVE.id,
        kind: "simulated",
        published_at: new Date().toISOString(),
        registration_required: true,
        show_on_home: true,
        slug: LIVE.slug,
        status: "published",
        title: LIVE.titulo
      },
      { onConflict: "id" }
    ),
    "Gravando a live gravada"
  );
  unwrap(
    await db.from("webinar_recordings").upsert(
      { bunny_library_id: "1", bunny_video_id: "teste-relatorio", duration_seconds: VIDEO_SEGUNDOS, embed_url: "https://iframe.mediadelivery.net/embed/1/teste-relatorio", id: LIVE.gravacaoId, provider: "bunny", source: "bunny", status: "ready", webinar_id: LIVE.id },
      { onConflict: "id" }
    ),
    "Gravando o video"
  );
  unwrap(
    await db.from("webinar_sessions").upsert({ id: LIVE.sessaoId, kind: "simulated", recording_id: LIVE.gravacaoId, scheduled_at: scheduledAt.toISOString(), status: "scheduled", webinar_id: LIVE.id }, { onConflict: "id" }),
    "Gravando a sessao"
  );
  unwrap(
    await db.from("webinar_registrations").insert([
      { session_id: LIVE.sessaoId, source: "email", status: "registered", user_id: aluna.id, webinar_id: LIVE.id },
      { session_id: LIVE.sessaoId, status: "registered", user_id: alunoSemAcesso.id, webinar_id: LIVE.id },
      { session_id: LIVE.sessaoId, status: "registered", user_id: produtor.id, webinar_id: LIVE.id }
    ]),
    "Gravando as vagas"
  );
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravada(new Date(Date.now() - MINUTO_MS));
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
  await limparRastros();
});

async function sessao() {
  return unwrap(await db.from("webinar_sessions").select("id,kind,status,started_at,ended_at,scheduled_at,presence_curve,script_fired_at,recording_id,source_session_id").eq("id", LIVE.sessaoId).single(), "Lendo a sessao");
}

async function replays() {
  return unwrap(await db.from("webinar_sessions").select("id,kind,status,recording_id,source_session_id,late_join_minutes").eq("webinar_id", LIVE.id).eq("kind", "replay"), "Lendo os replays");
}

async function comecouAgora(user) {
  const pagina = await listNotifications({ limit: 20, userId: user.id });
  return pagina.items.filter((item) => item.href === `/webinarios/${LIVE.slug}` && /Começou agora/.test(`${item.title} ${item.body}`));
}

function amostra(userId, bucket, samples = 2) {
  const at = new Date(Date.now() - 10 * MINUTO_MS + bucket * 30_000).toISOString();
  return { bucket, first_at: at, last_at: at, offset_seconds: bucket * 30, samples, session_id: LIVE.sessaoId, state: "playing", user_id: userId };
}

const linha = (rows, metric, item = "") => rows.find((row) => row.metric === metric && row.item === item);

test("1. o tick abre a sessao gravada na hora marcada: live, started_at = hora marcada, o roteiro marcado, Comecou agora uma vez por vaga (a equipe fora); o tick seguinte nao repete", async () => {
  const tick = await runJobsTick({ jobs: [webinarSessionsJob], supabase: db });
  assert.deepEqual(tick.failed, [], JSON.stringify(tick));
  assert.ok(tick.ran.includes(WEBINAR_SESSIONS_JOB_NAME));

  const aberta = await sessao();
  assert.equal(aberta.status, "live");
  assert.equal(aberta.started_at, aberta.scheduled_at, "na gravada, started_at e a hora marcada");
  assert.ok(aberta.script_fired_at, "o roteiro (vazio) foi dado como solto");
  assert.equal((await comecouAgora(aluna)).length, 1);
  assert.equal((await comecouAgora(alunoSemAcesso)).length, 1);
  assert.equal((await comecouAgora(produtor)).length, 0, "a equipe nao recebe");

  const corridas = unwrap(await db.from("job_runs").select("metadata").eq("job", WEBINAR_SESSIONS_JOB_NAME), "Lendo job_runs");
  assert.ok(
    corridas.some((corrida) => corrida.metadata?.webinars_sessions?.opened === 1),
    `as contagens do job em job_runs: ${JSON.stringify(corridas.map((corrida) => corrida.metadata))}`
  );

  const repeticao = await runSessionsTick({ db });
  assert.deepEqual([repeticao.opened, repeticao.finished, repeticao.replays], [0, 0, 0], JSON.stringify(repeticao));
  assert.equal((await comecouAgora(aluna)).length, 1, "nenhum aviso repetido");
});

test("2. com presenca, chat, reacao, pergunta e enquete, o tick encerra depois do video: webinar_attendance resumida, presence_curve congelada e o replay criado uma vez", async () => {
  // Aluna: os 20 baldes (ate o fim). Aluno sem acesso: baldes 0-5 e 10-12 (dois trechos: buraco de 4 baldes). Produtor: equipe, 20 baldes.
  const amostras = [
    ...Array.from({ length: 20 }, (_, bucket) => amostra(aluna.id, bucket)),
    ...[0, 1, 2, 3, 4, 5, 10, 11, 12].map((bucket) => amostra(alunoSemAcesso.id, bucket, 1)),
    ...Array.from({ length: 20 }, (_, bucket) => amostra(produtor.id, bucket))
  ];
  unwrap(await db.from("webinar_presence_samples").insert(amostras), "Gravando as amostras");
  unwrap(
    await db.from("webinar_chat_messages").insert([
      { author_user_id: aluna.id, body: "Boa noite!", display_name: "Aluna T.", offset_ms: 30_000, role: "student", session_id: LIVE.sessaoId, source: "audience", webinar_id: LIVE.id },
      { author_user_id: aluna.id, body: "Ficou claro.", display_name: "Aluna T.", offset_ms: 90_000, role: "student", session_id: LIVE.sessaoId, source: "audience", webinar_id: LIVE.id },
      { author_user_id: produtor.id, body: "Oi, turma.", display_name: "Produtor", offset_ms: 10_000, role: "team", session_id: LIVE.sessaoId, source: "team", webinar_id: LIVE.id }
    ]),
    "Gravando as mensagens"
  );
  unwrap(await db.from("webinar_reactions").insert({ offset_ms: 60_000, reaction: "fire", session_id: LIVE.sessaoId, user_id: aluna.id }), "Gravando a reacao");
  const pergunta = unwrap(
    await db.from("webinar_questions").insert({ anonymous: false, body: "Vai ter replay?", display_name: "Aluno S.", offset_ms: 120_000, session_id: LIVE.sessaoId, status: "open", upvotes: 2, user_id: alunoSemAcesso.id }).select("id").single(),
    "Gravando a pergunta"
  );
  perguntaId = pergunta.id;
  const enquete = unwrap(
    await db.from("webinar_polls").insert({ kind: "single", position: 0, question: "Qual ferramenta?", session_id: LIVE.sessaoId, status: "closed", webinar_id: LIVE.id }).select("id").single(),
    "Gravando a enquete"
  );
  enqueteId = enquete.id;
  const opcoes = unwrap(
    await db.from("webinar_poll_options").insert([{ label: "Planilha", poll_id: enqueteId, position: 0 }, { label: "Agente", poll_id: enqueteId, position: 1 }]).select("id,position"),
    "Gravando as opcoes"
  );
  opcaoA = opcoes.find((opcao) => opcao.position === 0).id;
  unwrap(await db.from("webinar_poll_answers").insert({ offset_ms: 200_000, option_ids: [opcaoA], poll_id: enqueteId, session_id: LIVE.sessaoId, user_id: aluna.id }), "Gravando a resposta");

  // Ainda dentro do video (comecou ha 1-2 min, o video tem 10): nada encerra.
  const cedo = await runSessionsTick({ db });
  assert.equal(cedo.finished, 0, JSON.stringify(cedo));

  // A hora marcada passa para 15 min atras: o video de 10 min acabou.
  const inicio = new Date(Date.now() - 15 * MINUTO_MS).toISOString();
  unwrap(await db.from("webinar_sessions").update({ scheduled_at: inicio, started_at: inicio }).eq("id", LIVE.sessaoId), "Movendo a hora marcada");

  const tick = await runJobsTick({ jobs: [webinarSessionsJob], supabase: db });
  assert.deepEqual(tick.failed, [], JSON.stringify(tick));

  const encerrada = await sessao();
  assert.equal(encerrada.status, "ended");
  assert.ok(encerrada.ended_at);
  const curva = encerrada.presence_curve;
  assert.ok(curva, "a curva congelada");
  assert.equal(curva.unique, 2, "so alunos (o produtor e equipe)");
  assert.deepEqual(curva.peak, { b: 0, n: 2 });
  assert.equal(curva.reachedEnd, 1);
  assert.equal(curva.watchMax, 600);
  assert.equal(curva.watchAvg, Math.round((600 + 135) / 2));
  assert.equal(curva.durationMs, VIDEO_SEGUNDOS * 1000);
  assert.deepEqual(
    curva.buckets.filter((ponto) => [0, 6, 10, 13, 19].includes(ponto.b)),
    [
      { b: 0, n: 2 },
      { b: 6, n: 1 },
      { b: 10, n: 2 },
      { b: 13, n: 1 },
      { b: 19, n: 1 }
    ]
  );

  const presenca = unwrap(await db.from("webinar_attendance").select("user_id,entries,seconds,max_bucket,reached_end").eq("session_id", LIVE.sessaoId), "Lendo webinar_attendance");
  const daAluna = presenca.find((row) => row.user_id === aluna.id);
  const doAluno = presenca.find((row) => row.user_id === alunoSemAcesso.id);
  assert.deepEqual([daAluna.entries, daAluna.seconds, daAluna.max_bucket, daAluna.reached_end], [1, 600, 19, true]);
  assert.deepEqual([doAluno.entries, doAluno.seconds, doAluno.max_bucket, doAluno.reached_end], [2, 135, 12, false], "90 s sem sinal abre outro trecho; 9 baldes x 15 s");

  const criados = await replays();
  assert.equal(criados.length, 1, "um replay por webinario");
  assert.deepEqual([criados[0].status, criados[0].recording_id, criados[0].source_session_id, criados[0].late_join_minutes], ["live", LIVE.gravacaoId, LIVE.sessaoId, null]);

  const repeticao = await runSessionsTick({ db });
  assert.deepEqual([repeticao.opened, repeticao.finished, repeticao.replays], [0, 0, 0], JSON.stringify(repeticao));
  assert.equal((await replays()).length, 1, "o tick seguinte nao cria outro replay");
});

test("3. webinar_report e webinar_attendees contra numeros calculados a mao: so alunos, so chat de aluno, pontuacao M3", async () => {
  const rows = await fetchWebinarReport(db, LIVE.sessaoId);
  assert.ok(rows.length > 0, "a RPC devolve linhas");
  assert.equal(linha(rows, "unique").total, 2);
  assert.equal(linha(rows, "presence", "0").total, 2);
  assert.equal(linha(rows, "presence", "6").total, 1);
  const pico = rows.find((row) => row.metric === "peak");
  assert.deepEqual([pico?.item, pico?.total], ["0", 2], "o pico traz o balde no item");
  assert.equal(linha(rows, "registration", "registered").total, 2, "a vaga do produtor (equipe) nao conta");
  assert.equal(linha(rows, "registration", "attended").total, 2);
  assert.equal(linha(rows, "registration", "absent").total, 0);
  assert.equal(linha(rows, "registration_source", "email").total, 1);
  assert.equal(linha(rows, "chat_total").total, 2, "a mensagem da equipe fica fora");
  assert.equal(linha(rows, "chat_total").students, 1);
  assert.equal(linha(rows, "chat_minute", "0").total, 1);
  assert.equal(linha(rows, "chat_minute", "1").total, 1);
  assert.deepEqual([linha(rows, "top_chat", aluna.id).total, linha(rows, "top_chat", produtor.id)], [2, undefined]);
  assert.equal(linha(rows, "reaction", "fire").total, 1);
  assert.equal(linha(rows, "question", "open").total, 1);
  assert.equal(linha(rows, "top_question", perguntaId).total, 2);
  assert.equal(linha(rows, "poll", `${enqueteId}:${opcaoA}`).total, 1);
  assert.equal(linha(rows, "reached_end").total, 1);
  assert.equal(linha(rows, "watch_avg").total, Math.round((600 + 135) / 2));
  assert.equal(linha(rows, "watch_max").total, 600);
  assert.ok(linha(rows, "drop", "6"), "a queda do balde 6 (2 -> 1)");
  assert.ok(linha(rows, "drop", "13"), "a queda do balde 13 (2 -> 1)");
  // Mais quentes: aluna 2 msgs + 0,5 + 1 enquete + 1 (10 min) = 4,5 -> 100; aluno 1 pergunta x 2 = 2 -> 44.
  assert.equal(linha(rows, "hot", aluna.id).total, 100);
  assert.equal(linha(rows, "hot", alunoSemAcesso.id).total, 44);
  assert.equal(linha(rows, "replay", "viewers").total, 0);
  assert.equal(linha(rows, "sim_script", "fired").total, 0);

  const presentes = await fetchAttendees(db, LIVE.sessaoId);
  assert.deepEqual(presentes.map((row) => row.userId), [aluna.id, alunoSemAcesso.id], "mais tempo primeiro; a equipe fora");
  assert.deepEqual([presentes[0].registered, presentes[0].source, presentes[0].seconds, presentes[0].entries, presentes[0].reachedEnd, presentes[0].messages, presentes[0].reactions, presentes[0].questions, presentes[0].polls], [true, "email", 600, 1, true, 2, 1, 0, 1]);
  assert.deepEqual([presentes[1].seconds, presentes[1].entries, presentes[1].reachedEnd, presentes[1].messages, presentes[1].questions], [135, 2, false, 0, 1]);
});

test("4. a pagina do relatorio e o CSV: a sessao encerrada e a padrao, o replay e a outra opcao, nomes de profiles, pontuacao e as colunas do Zoom", async () => {
  const page = await getWebinarReportPage(LIVE.id);
  assert.ok(page);
  assert.equal(page.hasReplay, true);
  assert.deepEqual(page.sessions.map((session) => [session.kind, session.selected]), [["simulated", true], ["replay", false]]);
  const selected = page.selected;
  assert.ok(selected);
  assert.equal(selected.report.presence.unique, 2);
  assert.equal(selected.durationMs, VIDEO_SEGUNDOS * 1000);
  assert.deepEqual(
    selected.attendees.map((attendee) => [attendee.name, attendee.registered, attendee.score, attendee.reachedEnd]),
    [
      [ESCOLA_DE_TESTE.contas.aluna.nome, true, 100, true],
      [ESCOLA_DE_TESTE.contas.alunoSemAcesso.nome, true, 44, false]
    ]
  );
  assert.equal(selected.attendees[0].email, ESCOLA_DE_TESTE.contas.aluna.email);
  assert.equal(selected.polls[0]?.question, "Qual ferramenta?");
  assert.deepEqual(selected.polls[0]?.options.map((option) => [option.label, option.total]), [["Planilha", 1], ["Agente", 0]]);
  assert.equal(selected.questions[perguntaId]?.body, "Vai ter replay?");
  assert.equal(selected.simulation.showLiveBadge, false);

  const csv = await loadWebinarReportCsv(db, { sessionId: LIVE.sessaoId, webinarId: LIVE.id });
  assert.ok(csv);
  assert.equal(csv.count, 2);
  assert.match(csv.fileName, /^webinario-teste-live-gravada-relatorio-\d{4}-\d{2}-\d{2}-\d{4}-attendee\.csv$/);
  const [cabecalho, primeira] = csv.csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(cabecalho, "Compareceu;Nome;E-mail;Hora da vaga;Entrou;Saiu;Entradas;Tempo na sessão (min);Até o fim (95 %);Mensagens;Reações;Perguntas;Enquetes respondidas;Oferta clicada (variante);Pontuação (0–100);Dispositivo");
  assert.match(primeira, new RegExp(`^Sim;${ESCOLA_DE_TESTE.contas.aluna.nome};${ESCOLA_DE_TESTE.contas.aluna.email};`));
  assert.match(primeira, /;1;10;Sim;2;1;0;1;;100;$/);
});

test("5. as RPCs sao so do service_role: o aluno logado recebe 42501 em webinar_report, webinar_attendees, webinar_open_session e webinar_close_session", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");

  for (const [nome, args] of [
    ["webinar_report", { p_session_id: LIVE.sessaoId }],
    ["webinar_attendees", { p_session_id: LIVE.sessaoId }],
    ["webinar_open_session", { p_now: new Date().toISOString(), p_session_id: LIVE.sessaoId }],
    ["webinar_close_session", { p_now: new Date().toISOString(), p_session_id: LIVE.sessaoId }]
  ]) {
    const negado = await cliente.rpc(nome, args);
    assert.equal(negado.error?.code, "42501", `${nome}: ${JSON.stringify(negado.error)}`);
  }

  await cliente.auth.signOut();
  assert.equal((await sessao()).status, "ended", "nada mudou");
});

test("6. a rota do CSV: 401 sem sessao, 403 para o analista, 400 sem a sessao, 404 noutro webinario e 200 para o produtor com a auditoria webinar_export", async () => {
  const pedir = (user, query = `?sessao=${LIVE.sessaoId}`, id = LIVE.id) => {
    actAs(user);
    return csvRoute.GET(new Request(`http://localhost/api/admin/webinars/${id}/relatorio/csv${query}`), { params: Promise.resolve({ id }) });
  };

  assert.equal((await pedir(null)).status, 401);
  assert.equal((await pedir(analista)).status, 403);
  assert.equal((await pedir(produtor, "")).status, 400);
  assert.equal((await pedir(produtor, `?sessao=${LIVE.sessaoId}`, "bbbbbbbb-0000-4000-8000-000000000099")).status, 404);

  // A auditoria e so de insercao (o service_role nao apaga): conta so o que este pedido gravou.
  const antes = new Date(Date.now() - 2000).toISOString();
  const resposta = await pedir(produtor);
  assert.equal(resposta.status, 200, await resposta.clone().text());
  assert.match(resposta.headers.get("content-type") ?? "", /^text\/csv/);
  assert.match(resposta.headers.get("content-disposition") ?? "", /attachment; filename="webinario-teste-live-gravada-relatorio-.*-attendee\.csv"/);
  assert.equal(resposta.headers.get("cache-control"), "private, no-store, max-age=0");
  // O Excel precisa do BOM; o text() do Response o tira, entao confere nos bytes.
  const bytes = new Uint8Array(await resposta.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "o arquivo comeca com o BOM do UTF-8");
  const corpo = await resposta.text();
  assert.match(corpo, /^Compareceu;Nome;E-mail;/);
  assert.match(corpo, new RegExp(ESCOLA_DE_TESTE.contas.aluna.email));

  const auditoria = unwrap(await db.from("admin_audit_log").select("action,actor_id,entity_id,entity_type,count,metadata").eq("action", "webinar_export").eq("entity_id", LIVE.id).gte("occurred_at", antes), "Lendo a auditoria");
  assert.equal(auditoria.length, 1);
  assert.deepEqual([auditoria[0].actor_id, auditoria[0].entity_type, auditoria[0].count], [produtor.id, "webinar", 2]);
  assert.deepEqual(auditoria[0].metadata, { kind: "simulated", report: "attendee", session_id: LIVE.sessaoId, webinar_id: LIVE.id });
});

test("7. fase 4 na RPC com dados reais: a Oferta (janela, cliques, compra pelo webhook com o valor), as Respostas do Assistente e o resumo da Simulacao, sem mexer nos numeros reais", async () => {
  const oferta = unwrap(
    await db
      .from("webinar_offers")
      .insert({ product_id: VENDA.produto, show_at_offset_ms: 0, status: "active", title: "Oferta de teste", trigger_kind: "at_offset", webinar_id: LIVE.id })
      .select("id")
      .single(),
    "Gravando a oferta"
  );
  unwrap(
    await db.from("webinar_offer_variants").insert([
      { checkout_url: "https://pay.example.com/a", headline: "Entre agora", label: "A", offer_id: oferta.id },
      { checkout_url: "https://pay.example.com/b", headline: "Ultima chance", label: "B", offer_id: oferta.id }
    ]),
    "Gravando as variantes"
  );
  // A janela da sessao: do comeco aos 2:30 (baldes 0 a 5): a aluna e o aluno sem acesso estavam la; o produtor e equipe.
  unwrap(await db.from("webinar_offer_displays").insert({ hide_offset_ms: 150_000, offer_id: oferta.id, session_id: LIVE.sessaoId, show_offset_ms: 0 }), "Gravando a janela");
  const variante = async (user) => unwrap(await db.rpc("webinar_offer_variant", { p_offer_id: oferta.id, p_user_id: user.id }), "Lendo a variante");
  const varianteDaAluna = await variante(aluna);
  const clicouHa = new Date(Date.now() - 10 * MINUTO_MS).toISOString();
  unwrap(
    await db.from("webinar_offer_clicks").insert([
      { click_token: "teste-relatorio-clique-aluna", clicked_at: clicouHa, offer_id: oferta.id, offset_ms: 120_000, session_id: LIVE.sessaoId, user_id: aluna.id, variant_label: varianteDaAluna },
      { click_token: "teste-relatorio-clique-aluno", clicked_at: clicouHa, offer_id: oferta.id, offset_ms: 130_000, session_id: LIVE.sessaoId, user_id: alunoSemAcesso.id, variant_label: await variante(alunoSemAcesso) }
    ]),
    "Gravando os cliques"
  );
  // A compra so vem do webhook (sale_grants), com o valor gravado em webhook_events (M8); o job liga ao ultimo clique.
  const acesso = unwrap(
    await db.from("entitlements").insert({ source_event_id: VENDA.evento, source_provider: "hotmart", status: "active", target_id: VENDA.produto, target_type: "product", user_id: aluna.id }).select("id").single(),
    "Gravando o acesso"
  );
  const evento = unwrap(
    await db
      .from("webhook_events")
      .insert({ amount_cents: 19_700, currency: "BRL", event_type: "PURCHASE_APPROVED", external_event_id: VENDA.evento, payload: {}, provider: "hotmart" })
      .select("id")
      .single(),
    "Gravando o webhook"
  );
  unwrap(
    await db.from("sale_grants").insert({ entitlement_id: acesso.id, opened: true, product_id: VENDA.produto, provider: "hotmart", transaction_id: VENDA.transacao, user_id: aluna.id, webhook_event_id: evento.id }),
    "Gravando a venda"
  );
  assert.ok(unwrap(await db.rpc("webinar_offer_conversions", { p_limit: 500, p_now: new Date().toISOString() }), "Ligando a compra") >= 1);
  const ligados = unwrap(await db.from("webinar_offer_clicks").select("user_id, converted_sale_grant_id").eq("offer_id", oferta.id), "Lendo os cliques");
  assert.deepEqual(
    ligados.filter((clique) => clique.converted_sale_grant_id).map((clique) => clique.user_id),
    [aluna.id],
    "so o clique da aluna virou compra (o do aluno sem acesso nao tem venda)"
  );

  // O Assistente: uma resposta, uma corrigida, uma apagada; o pedido respondido em 6 s; a pergunta pediu a equipe.
  const agora = Date.now();
  unwrap(
    await db.from("webinar_chat_messages").insert([
      { body: "Sim.", display_name: "Assistente", kind: "answer", offset_ms: 95_000, role: "ai", session_id: LIVE.sessaoId, source: "ai", webinar_id: LIVE.id },
      { body: "Corrigida.", display_name: "Assistente", edited_at: new Date(agora).toISOString(), edited_by: produtor.id, kind: "answer", offset_ms: 96_000, role: "ai", session_id: LIVE.sessaoId, source: "ai", webinar_id: LIVE.id },
      { body: "Apagada.", deleted_at: new Date(agora).toISOString(), deleted_by: produtor.id, deleted_reason: "team", display_name: "Assistente", kind: "answer", offset_ms: 97_000, role: "ai", session_id: LIVE.sessaoId, source: "ai", webinar_id: LIVE.id }
    ]),
    "Gravando as respostas do Assistente"
  );
  unwrap(
    await db.from("webinar_ai_requests").insert({
      answered_at: new Date(agora).toISOString(),
      requested_at: new Date(agora - 6000).toISOString(),
      session_id: LIVE.sessaoId,
      status: "answered",
      target_id: perguntaId,
      target_kind: "question",
      user_id: alunoSemAcesso.id,
      webinar_id: LIVE.id
    }),
    "Gravando o pedido ao Assistente"
  );
  unwrap(
    await db
      .from("webinar_questions")
      .update({ answer_source: "ai", answer_text: "Sim, por 7 dias.", answered_at: new Date(agora).toISOString(), handoff_requested_at: new Date(agora).toISOString(), status: "answered" })
      .eq("id", perguntaId),
    "Respondendo a pergunta pelo Assistente"
  );

  // A Simulacao da sessao gravada: a regra, um aviso de venda e o resumo congelado.
  unwrap(
    await db
      .from("webinar_sessions")
      .update({
        simulated_count_rule: { base: 40, jitter: 0, mode: "fixed", peak: 40 },
        simulated_sale_notices: { enabled: true, items: [{ offset_ms: 60_000, text: "Ana garantiu a vaga" }] },
        simulation_summary: { counter_max: 240, joins_shown: 18, sale_notices_shown: 2 }
      })
      .eq("id", LIVE.sessaoId),
    "Gravando a Simulacao"
  );

  const rows = await fetchWebinarReport(db, LIVE.sessaoId);
  assert.deepEqual([linha(rows, "offer", "seen").total, linha(rows, "offer", "seen").students], [2, 2], "os dois alunos na janela; a equipe fora");
  assert.deepEqual([linha(rows, "offer", "clicks").total, linha(rows, "offer", "purchases").students], [2, 1]);
  assert.equal(linha(rows, "offer", `${varianteDaAluna}:purchases`).students, 1, "a compra cai na variante da aluna");
  assert.deepEqual([linha(rows, "offer_revenue", "BRL").total, linha(rows, "offer_revenue", "BRL").students], [19_700, 1], "o valor do webhook, uma venda");
  assert.deepEqual(
    ["replies", "avg_seconds", "edited", "deleted", "handoffs"].map((item) => linha(rows, "ai", item).total),
    [2, 6, 1, 1, 1]
  );
  assert.deepEqual(
    [linha(rows, "sim_counter", "max").total, linha(rows, "sim_joins", "shown").total, linha(rows, "sim_sales", "shown").total],
    [240, 18, 2]
  );
  assert.equal(linha(rows, "unique").total, 2, "nada simulado nem do Assistente entra nos presentes");
  assert.equal(linha(rows, "chat_total").total, 2, "as respostas do Assistente ficam fora das mensagens de alunos");

  const page = await getWebinarReportPage(LIVE.id, { sessionId: LIVE.sessaoId });
  const selected = page?.selected;
  assert.ok(selected);
  assert.equal(selected.report.offer.present, true);
  assert.deepEqual(selected.report.offer.revenue, [{ cents: 19_700, currency: "BRL", sales: 1 }]);
  assert.equal(selected.report.assistant.present, true);
  assert.deepEqual(selected.simulation.rules?.countMode, "fixed");
  assert.deepEqual(selected.simulation.totals, { counterMax: 240, joinsShown: 18, saleNoticesShown: 2 });
});

// Uma linha do CSV em celulas (";" fora de aspas; "" dentro de aspas vira "): toCsv poe entre aspas a celula com ";",
// como a frase do cabecalho do Performance. Nenhuma celula destes arquivos quebra linha.
function celulas(texto) {
  const saida = [];
  let celula = "";
  let entreAspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        celula += '"';
        i += 1;
      } else if (c === '"') {
        entreAspas = false;
      } else {
        celula += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === ";") {
      saida.push(celula);
      celula = "";
    } else {
      celula += c;
    }
  }
  saida.push(celula);
  return saida;
}

test("8. os CSVs com os nomes do Zoom pelas rotas: Q&A com o Assistente, Attendee com a variante, Performance e Simulacao separados, Registration sem a equipe, o Performance do periodo", async () => {
  actAs(produtor);
  const pedir = (relatorio) =>
    csvRoute.GET(new Request(`http://localhost/api/admin/webinars/${LIVE.id}/relatorio/csv?sessao=${LIVE.sessaoId}&relatorio=${relatorio}`), { params: Promise.resolve({ id: LIVE.id }) });
  const linhas = async (resposta) => {
    assert.equal(resposta.status, 200, await resposta.clone().text());
    return (await resposta.text()).trimEnd().split("\r\n").map(celulas);
  };

  const qa = await linhas(await pedir("qa"));
  assert.equal(qa[0].join(";"), "Nº;Hora;Minuto do vídeo;Nome;E-mail;Pergunta;Votos;Situação;Respondida por;Resposta;Ao vivo;Hora da resposta");
  assert.deepEqual(qa[1].slice(2, 10), ["02:00", ESCOLA_DE_TESTE.contas.alunoSemAcesso.nome, ESCOLA_DE_TESTE.contas.alunoSemAcesso.email, "Vai ter replay?", "2", "Respondida", "Assistente", "Sim, por 7 dias."]);

  const attendee = await linhas(await pedir("attendee"));
  const daAluna = attendee.find((linha) => linha[1] === ESCOLA_DE_TESTE.contas.aluna.nome);
  assert.match(daAluna?.[13] ?? "", /^[AB]$/, "Oferta clicada (variante)");

  const performance = await linhas(await pedir("performance"));
  assert.equal(performance[0][0], "Estes números são reais; a simulação não entra em nenhum deles.");
  assert.deepEqual(performance[2].slice(5, 8), ["2", "2", "100 %"], "vagas, presentes e comparecimento reais");
  assert.deepEqual(performance[2].slice(20, 24), ["2", "2", "1", "50 %"], "viram, cliques, compras e conversao");
  assert.ok(!performance.flat().includes("240"), "o contador simulado nunca entra");

  const simulacao = await linhas(await pedir("simulacao"));
  assert.equal(simulacao[0][0], "Estes números são da simulação e não entram em nenhum outro número.");
  assert.ok(simulacao.some((linha) => linha[0] === "Contador" && linha[4] === "real + número fixo · maior número mostrado: 240 · participantes de verdade: 2"));
  assert.ok(simulacao.some((linha) => linha[0] === "Aviso de venda" && linha[1] === "01:00" && linha[5] === "Sim"));

  const vagas = await linhas(await pedir("registration"));
  assert.deepEqual(vagas.slice(1).map((linha) => linha[0]).sort(), [ESCOLA_DE_TESTE.contas.aluna.nome, ESCOLA_DE_TESTE.contas.alunoSemAcesso.nome].sort(), "a vaga do produtor (equipe) fica fora");
  assert.equal(vagas.find((linha) => linha[0] === ESCOLA_DE_TESTE.contas.aluna.nome)?.[4], "email");

  const survey = await linhas(await pedir("survey"));
  assert.deepEqual(survey, [["Nome", "E-mail", "Hora", "Pergunta", "Resposta"]], "sem pesquisa do fim, so as colunas (A20)");

  const sessao = unwrap(await db.from("webinar_sessions").select("scheduled_at").eq("id", LIVE.sessaoId).single(), "Lendo a hora marcada");
  const inicio = new Date(Date.parse(sessao.scheduled_at) - 86_400_000).toISOString();
  const fim = new Date(Date.now() + 86_400_000).toISOString();
  const antes = new Date(Date.now() - 2000).toISOString();
  const periodo = await panelCsvRoute.GET(new Request(`http://localhost/api/admin/webinars/painel/csv?tipo=gravadas&inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}&relatorio=performance&webinario=${LIVE.id}`));
  const doPeriodo = await linhas(periodo);
  assert.deepEqual(doPeriodo.slice(2).map((linha) => [linha[0], linha[1]]), [[LIVE.titulo, LIVE.sessaoId]], "so a sessao gravada do webinario (o replay nao e do painel)");
  const auditoria = unwrap(await db.from("admin_audit_log").select("count,metadata").eq("action", "webinar_export").is("entity_id", null).gte("occurred_at", antes), "Lendo a auditoria do periodo");
  assert.deepEqual(auditoria.map((linha) => [linha.count, linha.metadata.report, linha.metadata.kind, linha.metadata.sessions]), [[1, "performance", "simulated", 1]]);

  actAs(analista);
  assert.equal((await pedir("qa")).status, 403);
  actAs(null);
});
