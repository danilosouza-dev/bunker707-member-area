import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_GRAVADA_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaEncerradaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Roteiro de chat e console da sessao, fase 2b (docs/30 §2.2, §2.4, §2.6, §5.2, §6.6 D6, §8.3, §8.5 e §8.6; docs/18 §3)
// contra o banco LOCAL de verdade, com a migracao 202610290001 aplicada: o analista recebe 403 em tudo; o produtor
// grava a transcricao da gravacao base e o roteiro (as frases resolvidas ao salvar), importa o CSV; abrir a sessao
// pela mao poe o roteiro pronto no chat uma vez (a RPC de novo nao repete) e "Soltar agora" entra no minuto do
// servidor uma vez; a mensagem da equipe; a moderacao (liberar, fixar, promover so com o aceite, apagar); as
// enquetes (modelo, abrir, a resposta da aluna contada, encerrar e compartilhar); as perguntas; a Simulacao com a
// frase de §8.6 conferida no servidor; encerrar pela mao (presenca congelada e o replay criado uma vez); "Remover
// minhas mensagens" a pedido; e a rota de 5 s do console (403, 404, 200). Usa a Live gravada de teste da 2c
// (webinario e gravacao) mais uma sessao marcada ha 2 min, so para esta rodada.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const scriptActions = await import("../../src/server/webinars/script-actions.ts");
const roomActions = await import("../../src/server/webinars/room-actions.ts");
const consoleQueries = await import("../../src/server/webinars/console-queries.ts");
const consoleModel = await import("../../src/server/webinars/console-model.ts");
const { getWebinarEditorData } = await import("../../src/server/webinars/queries.ts");
const consoleRoute = await import("../../src/app/api/admin/webinars/[id]/console/route.ts");

const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const aluna = usuarioDeTeste(contas.aluna);
const aluno = usuarioDeTeste(contas.alunoSemAcesso);
const pessoas = [aluna.id, aluno.id, produtor.id, analista.id];
const webinarId = LIVE_GRAVADA_DE_TESTE.id;
const SESSAO = "bbbbbbbb-0000-4000-8000-0000000000b1";
const MIN = 60_000;
const VTT = ["WEBVTT", "", "00:00:30.000 --> 00:00:35.000", "Agora vamos começar a aula de hoje", "", "00:00:36.000 --> 00:00:40.000", "Olá pessoal, sejam bem-vindos", ""].join("\n");

let scheduledAt = "";

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function limparRastros() {
  unwrap(await db.from("webinar_chat_consents").delete().in("user_id", pessoas), "Apagando os aceites de teste");
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
  unwrap(await db.from("notifications").delete().in("user_id", pessoas).eq("kind", "webinar"), "Apagando o sino de webinario de teste");
}

async function sessao() {
  return unwrap(await db.from("webinar_sessions").select("*").eq("id", SESSAO).single(), "Lendo a sessao de teste");
}

async function mensagens(filtro = {}) {
  let query = db.from("webinar_chat_messages").select("*").eq("session_id", SESSAO).order("created_at", { ascending: true });
  for (const [column, value] of Object.entries(filtro)) {
    query = query.eq(column, value);
  }
  return unwrap(await query, "Lendo as mensagens da sessao");
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravadaEncerradaDeTeste(db);
  const inicio = new Date(Date.now() - 2 * MIN);
  inicio.setUTCMilliseconds(0);
  scheduledAt = inicio.toISOString();
  unwrap(
    await db.from("webinar_sessions").insert({ id: SESSAO, kind: "simulated", recording_id: LIVE_GRAVADA_DE_TESTE.gravacaoId, scheduled_at: scheduledAt, status: "scheduled", webinar_id: webinarId }),
    "Gravando a sessao marcada de teste"
  );
  unwrap(
    await db.from("webinar_chat_consents").insert({ consent_version: 1, display_mode: "first_name_initial", user_id: aluna.id }),
    "Gravando o aceite da aluna"
  );
  unwrap(
    await db.from("webinar_chat_messages").insert([
      { approved: false, author_user_id: aluna.id, body: "Posso perguntar?", display_name: "Aluna T.", offset_ms: -30_000, role: "student", session_id: SESSAO, source: "audience", webinar_id: webinarId },
      { approved: true, author_user_id: aluno.id, body: "Sem aceite", display_name: "Aluno 231", offset_ms: -20_000, role: "student", session_id: SESSAO, source: "audience", webinar_id: webinarId }
    ]),
    "Gravando as mensagens da turma"
  );
  unwrap(
    await db.from("webinar_questions").insert({ anonymous: false, body: "Vai ter replay?", display_name: "Aluna T.", offset_ms: -10_000, session_id: SESSAO, upvotes: 2, user_id: aluna.id }),
    "Gravando a pergunta da aluna"
  );
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
  await limparRastros();
});

test("1. permissao: o analista recebe 403 em todas as acoes e sem sessao e 401; nada e gravado", async () => {
  actAs(analista);
  const chamadas = [
    () => scriptActions.saveScriptItems({ items: [], webinarId }),
    () => scriptActions.saveTranscript({ format: "vtt", text: VTT, webinarId }),
    () => scriptActions.importScriptCsv({ csv: "Tempo;Nome;Papel;Mensagem\n0:10;Duda;Aluno;oi", webinarId }),
    () => roomActions.openSessionNow({ sessionId: SESSAO }),
    () => roomActions.sendTeamMessage({ body: "oi", sessionId: SESSAO }),
    () => roomActions.savePolls({ polls: [], webinarId }),
    () => roomActions.saveSimulation({ sessionId: SESSAO, showLiveBadge: false }),
    () => roomActions.removeStudentMessages({ reason: "pediu", userId: aluna.id })
  ];
  for (const chamada of chamadas) {
    const result = await chamada();
    assert.deepEqual([result.ok, result.status], [false, 403]);
  }
  actAs(null);
  const semSessao = await scriptActions.saveScriptItems({ items: [], webinarId });
  assert.equal(semSessao.status, 401);
  assert.equal((await sessao()).status, "scheduled");
  const roteiro = unwrap(await db.from("webinar_chat_script_items").select("id").eq("webinar_id", webinarId), "Lendo o roteiro");
  assert.equal(roteiro.length, 0);
});

test("2. transcricao e roteiro: as cues na gravacao base, as frases resolvidas ao salvar (pronta / nao achada), o CSV acrescentado e exportado", async () => {
  actAs(produtor);
  const base = { body: "Mensagem", kind: "message", offsetMs: null, personaName: "Duda", personaRole: "student", phrase: null, phraseDelayMs: 0, status: "draft" };
  const antes = ok(await scriptActions.saveScriptItems({ items: [{ ...base, phrase: "vamos começar", phraseDelayMs: 2_000, triggerKind: "on_phrase" }], webinarId }));
  assert.deepEqual([antes.items[0].status, antes.items[0].resolvedOffsetMs], ["unresolved", null], "sem transcricao a frase fica sem minuto");

  const transcricao = ok(await scriptActions.saveTranscript({ format: "vtt", text: VTT, webinarId }));
  assert.deepEqual([transcricao.ready, transcricao.unresolved, transcricao.transcript.cues], [1, 0, 2]);
  const linhas = unwrap(await db.from("webinar_recording_transcripts").select("recording_id, source_format, cues, created_by").eq("recording_id", LIVE_GRAVADA_DE_TESTE.gravacaoId), "Lendo a transcricao");
  assert.equal(linhas.length, 1);
  assert.deepEqual([linhas[0].source_format, linhas[0].cues.length, linhas[0].created_by], ["vtt", 2, produtor.id]);
  assert.deepEqual([transcricao.items[0].status, transcricao.items[0].resolvedOffsetMs], ["ready", 32_000]);

  const salvo = ok(
    await scriptActions.saveScriptItems({
      items: [
        { ...base, body: "Boa noite!", offsetMs: 10_000, triggerKind: "at_offset" },
        { ...base, id: transcricao.items[0].id, body: "Agora sim!", phrase: "vamos começar", phraseDelayMs: 2_000, triggerKind: "on_phrase" },
        { ...base, body: "Frase que não existe", phrase: "frase que ninguém disse aqui", triggerKind: "on_phrase" },
        { ...base, body: "Pelo botão", personaRole: "team", triggerKind: "manual" }
      ],
      webinarId
    })
  );
  assert.deepEqual(
    salvo.items.map((item) => [item.position, item.status, item.resolvedOffsetMs ?? item.offsetMs]),
    [
      [0, "ready", 10_000],
      [1, "ready", 32_000],
      [2, "unresolved", null],
      [3, "ready", null]
    ]
  );
  assert.deepEqual(salvo.summary, { disabled: 0, manual: 1, ready: 2, unresolved: 1 });

  const importado = ok(await scriptActions.importScriptCsv({ csv: ["Tempo;Nome;Papel;Mensagem", "0:50;Rafa;Aluno;Chegando agora", "abc;Lia;Aluno;tempo torto"].join("\n"), webinarId }));
  assert.deepEqual([importado.imported, importado.errors.length, importado.items.length], [1, 1, 5]);
  assert.equal(importado.items[4].offsetMs, 50_000);

  const exportado = ok(await scriptActions.exportScriptCsv({ webinarId }));
  assert.equal(exportado.rows, 3, "os tres com minuto (10 s, 32 s e 50 s); o manual e a frase nao achada ficam de fora");
  assert.match(exportado.csv, /00:32;Duda;Aluno;Agora sim!/);

  const auditoria = unwrap(await db.from("admin_audit_log").select("action, metadata").eq("entity_id", webinarId).in("action", ["webinar.script_saved", "webinar.transcript_saved", "webinar.script_imported"]), "Lendo a auditoria");
  assert.ok(auditoria.length >= 4);
  assert.doesNotMatch(JSON.stringify(auditoria), /Boa noite|Agora sim/, "a auditoria nunca leva o texto das mensagens");
});

test("3. abrir pela mao: a sessao vai ao ar, o roteiro pronto entra uma vez (a RPC de novo nao repete) e o sino avisa quem tinha vaga; Soltar agora entra uma vez no minuto do servidor", async () => {
  actAs(produtor);
  unwrap(await db.from("webinar_registrations").insert({ session_id: SESSAO, status: "registered", user_id: aluna.id, webinar_id: webinarId }), "Vaga da aluna");

  const aberta = ok(await roomActions.openSessionNow({ sessionId: SESSAO }));
  assert.deepEqual([aberta.changed, aberta.fired, aberta.notified], [true, 3, 1], "tres prontos (10 s, 32 s, 50 s); o manual espera o botao");
  const linha = await sessao();
  assert.equal(linha.status, "live");
  assert.equal(new Date(linha.started_at).toISOString(), scheduledAt, "a gravada comeca na hora marcada");
  assert.ok(linha.script_fired_at);

  const doRoteiro = await mensagens({ source: "scripted" });
  assert.deepEqual(
    doRoteiro.map((row) => [row.offset_ms, row.display_name, row.role, row.master, row.approved]),
    [
      [10_000, "Duda", "student", false, true],
      [32_000, "Duda", "student", false, true],
      [50_000, "Rafa", "student", false, true]
    ]
  );
  assert.equal(new Date(doRoteiro[0].created_at).getTime(), Date.parse(scheduledAt) + 10_000, "created_at = hora marcada + minuto do item");

  const deNovo = unwrap(await db.rpc("webinar_open_session", { p_now: new Date().toISOString(), p_session_id: SESSAO }), "RPC de novo");
  assert.deepEqual([deNovo.changed, deNovo.fired], [false, 0]);
  assert.equal((await mensagens({ source: "scripted" })).length, 3, "o roteiro nao repete");
  const outraVez = await roomActions.openSessionNow({ sessionId: SESSAO });
  assert.equal(outraVez.status, 409, "no ar nao abre de novo");

  const sino = unwrap(await db.from("notifications").select("title").eq("user_id", aluna.id).eq("kind", "webinar"), "Lendo o sino");
  assert.deepEqual(sino.map((row) => row.title), ["Começou agora"]);

  const manual = (await db.from("webinar_chat_script_items").select("id").eq("webinar_id", webinarId).eq("trigger_kind", "manual").single()).data;
  const solto = ok(await scriptActions.fireScriptItem({ itemId: manual.id, sessionId: SESSAO }));
  assert.equal(solto.message.role, "team");
  assert.equal(solto.message.body, "Pelo botão");
  assert.ok(Math.abs(solto.message.offsetMs - (Date.now() - Date.parse(scheduledAt))) < 10_000, "o minuto e o do relogio do servidor");
  const repetido = await scriptActions.fireScriptItem({ itemId: manual.id, sessionId: SESSAO });
  assert.equal(repetido.status, 409);
  assert.equal((await mensagens({ source: "scripted" })).length, 4);
});

test("4. a mensagem da equipe, o retrato do console e a moderacao: liberar, fixar, promover so com o aceite, apagar; quem pode escrever e o modo lento", async () => {
  actAs(produtor);
  const enviada = ok(await roomActions.sendTeamMessage({ body: "Bem-vindos à sessão de teste!", sessionId: SESSAO }));
  assert.deepEqual([enviada.message.role, enviada.message.source, enviada.message.approved], ["host", "team", true]);

  const retrato = await consoleQueries.getConsoleSnapshot(webinarId, SESSAO);
  const porCorpo = (body) => retrato.messages.find((message) => message.body === body);
  assert.equal(porCorpo("Posso perguntar?").promotable, true, "a aluna tem o aceite");
  assert.equal(porCorpo("Posso perguntar?").approved, false);
  assert.equal(porCorpo("Sem aceite").promotable, false);
  assert.equal(retrato.scriptItems.length, 5);
  assert.equal(Object.keys(retrato.scriptFired).length, 4);
  assert.equal(retrato.questions.length, 1);
  assert.equal(retrato.session.status, "live");

  const pendente = porCorpo("Posso perguntar?");
  const liberada = ok(await roomActions.moderateMessage({ action: "approve", messageId: pendente.id }));
  assert.equal(liberada.message.approved, true);
  const fixada = ok(await roomActions.moderateMessage({ action: "pin", messageId: pendente.id }));
  assert.equal(fixada.pinnedMessageId, pendente.id);
  assert.equal((await sessao()).pinned_message_id, pendente.id);

  const semAceite = await roomActions.moderateMessage({ action: "promote", messageId: porCorpo("Sem aceite").id });
  assert.deepEqual([semAceite.ok, semAceite.status], [false, 409]);
  const promovida = ok(await roomActions.moderateMessage({ action: "promote", messageId: pendente.id }));
  assert.deepEqual([promovida.message.master, promovida.message.source], [true, "original"]);

  const apagada = ok(await roomActions.moderateMessage({ action: "delete", messageId: porCorpo("Sem aceite").id }));
  assert.equal(apagada.message.id, porCorpo("Sem aceite").id);
  const depois = await consoleQueries.getConsoleSnapshot(webinarId, SESSAO);
  assert.equal(depois.messages.some((message) => message.body === "Sem aceite"), false, "apagada some do console");
  assert.equal(depois.pinnedMessageId, pendente.id);

  const modo = ok(await roomActions.setSessionChatMode({ chatMode: "moderated", sessionId: SESSAO, slowModeSeconds: 20 }));
  assert.deepEqual([modo.chatMode, modo.slowModeSeconds], ["moderated", 20]);
  assert.deepEqual([(await sessao()).chat_mode, (await sessao()).chat_slow_mode_seconds], ["moderated", 20]);
});

test("5. enquetes e perguntas: o modelo, abrir na sessao (sem duplicar), a resposta da aluna contada no retrato, encerrar e compartilhar; responder por escrito vira linha da equipe", async () => {
  actAs(produtor);
  const salvas = ok(await roomActions.savePolls({ polls: [{ anonymous: false, kind: "single", options: [{ label: "Sim" }, { label: "Não" }], question: "Vem na próxima?" }], webinarId }));
  const modelo = salvas.polls[0];
  assert.equal(modelo.sessionId, null);

  const aberta = ok(await roomActions.launchPoll({ pollId: modelo.id, sessionId: SESSAO }));
  assert.deepEqual([aberta.poll.status, aberta.poll.sessionId, aberta.poll.templatePollId], ["open", SESSAO, modelo.id]);
  const deNovo = ok(await roomActions.launchPoll({ pollId: modelo.id, sessionId: SESSAO }));
  assert.equal(deNovo.poll.id, aberta.poll.id);

  unwrap(
    await db.from("webinar_poll_answers").insert({ offset_ms: 150_000, option_ids: [aberta.poll.options[0].id], poll_id: aberta.poll.id, session_id: SESSAO, user_id: aluna.id }),
    "A resposta da aluna"
  );
  const retrato = await consoleQueries.getConsoleSnapshot(webinarId, SESSAO);
  const lancada = retrato.polls.launched.find((poll) => poll.id === aberta.poll.id);
  assert.deepEqual(lancada.counts, { answers: 1, byOption: { [aberta.poll.options[0].id]: 1, [aberta.poll.options[1].id]: 0 } });
  assert.equal(retrato.polls.templates.length, 1);

  const encerrada = ok(await roomActions.closePoll({ pollId: aberta.poll.id, sessionId: SESSAO, shareResults: true }));
  assert.equal(encerrada.poll.status, "closed");
  assert.ok(encerrada.poll.resultsSharedAt);

  const [pergunta] = retrato.questions;
  const respondida = ok(await roomActions.answerQuestion({ answerText: "Vai, fica 7 dias no replay.", questionId: pergunta.id }));
  assert.deepEqual([respondida.question.status, respondida.question.answeredBy, respondida.message.kind, respondida.message.source], ["answered", produtor.id, "answer", "team"]);
  // Fase 4c (202610300004): a resposta da equipe fica marcada como da equipe (a do Assistente e 'ai').
  const origem = unwrap(await db.from("webinar_questions").select("answer_source").eq("id", pergunta.id).single(), "Lendo a origem da resposta");
  assert.equal(origem.answer_source, "team");
  const dispensada = ok(await roomActions.setQuestionStatus({ questionId: pergunta.id, status: "dismissed" }));
  assert.equal(dispensada.question.status, "dismissed");
  assert.equal(consoleModel.sortQuestionsForBoard((await consoleQueries.getConsoleSnapshot(webinarId, SESSAO)).questions)[0].status, "dismissed");
});

test("6. Simulação (§8.6): a frase errada recusa no campo; a frase de hoje com o nome liga o selo e fica registrada com quem e quando; o editor mostra a decisao", async () => {
  actAs(produtor);
  const frase = consoleModel.consoleAckSentence({ badgeOn: true, nowMs: Date.now(), responsible: "Produtor de Teste" });

  const errada = await roomActions.saveSimulation({ ackText: frase.replace("Produtor de Teste", "Outra Pessoa"), acknowledged: true, sessionId: SESSAO, showLiveBadge: true });
  assert.deepEqual([errada.status, Object.keys(errada.fieldErrors ?? {})], [400, ["acknowledged"]]);

  const ligado = ok(await roomActions.saveSimulation({ ackText: frase, acknowledged: true, sessionId: SESSAO, showLiveBadge: true }));
  assert.equal(ligado.session.showLiveBadge, true);
  const linha = await sessao();
  assert.deepEqual([linha.show_live_badge, linha.simulation_ack_text, linha.simulation_decided_by], [true, frase, produtor.id]);
  assert.ok(linha.simulation_decided_at);

  const editor = await getWebinarEditorData(webinarId);
  const noEditor = editor.sessions.find((session) => session.id === SESSAO);
  assert.equal(noEditor.showLiveBadge, true);
  assert.equal(editor.deciderNames[produtor.id], "Produtor de Teste");
  assert.equal(editor.transcript.cues, 2);
  assert.equal(editor.scriptItems.length, 5);
  assert.equal(editor.polls.length, 1);
  assert.equal(editor.runningSessionId, SESSAO);

  const auditoria = unwrap(await db.from("admin_audit_log").select("metadata").eq("action", "webinar.simulation_saved").eq("entity_id", webinarId), "Lendo a auditoria da Simulacao");
  assert.equal(auditoria.length, 1);
  assert.deepEqual([auditoria[0].metadata.show_live_badge, auditoria[0].metadata.ack_text, auditoria[0].metadata.decided_by], [true, frase, produtor.id]);
});

test("7. encerrar pela mao: a presenca congela, a sessao vira Encerrada e o replay nasce uma vez; o botao do replay devolve a mesma sessao, fecha e reabre", async () => {
  actAs(produtor);
  unwrap(
    await db.from("webinar_presence_samples").insert([
      { bucket: 0, offset_seconds: 5, samples: 2, session_id: SESSAO, state: "playing", user_id: aluna.id },
      { bucket: 1, offset_seconds: 35, samples: 2, session_id: SESSAO, state: "playing", user_id: aluna.id }
    ]),
    "A presenca da aluna"
  );

  const encerrada = ok(await roomActions.endSessionNow({ sessionId: SESSAO }));
  assert.equal(encerrada.replayCreated, true, "a gravacao esta pronta e nao havia replay");
  assert.equal(encerrada.summary.unique, 1);
  const linha = await sessao();
  assert.equal(linha.status, "ended");
  assert.ok(linha.ended_at);
  assert.equal(linha.presence_curve.unique, 1);
  const presenca = unwrap(await db.from("webinar_attendance").select("seconds, reached_end").eq("session_id", SESSAO).eq("user_id", aluna.id).single(), "Lendo a presenca resumida");
  assert.equal(presenca.seconds, 60);

  const replays = unwrap(await db.from("webinar_sessions").select("id, status, source_session_id, recording_id").eq("webinar_id", webinarId).eq("kind", "replay"), "Lendo o replay");
  assert.equal(replays.length, 1);
  assert.deepEqual([replays[0].status, replays[0].source_session_id, replays[0].recording_id], ["live", SESSAO, LIVE_GRAVADA_DE_TESTE.gravacaoId]);

  const mesmo = ok(await roomActions.createReplaySession({ webinarId }));
  assert.deepEqual([mesmo.created, mesmo.session.id], [false, replays[0].id]);
  const fechado = ok(await roomActions.cancelReplaySession({ webinarId }));
  assert.equal(fechado.sessionId, replays[0].id);
  const reaberto = ok(await roomActions.createReplaySession({ webinarId }));
  assert.deepEqual([reaberto.created, reaberto.session.id, reaberto.session.status], [true, replays[0].id, "live"]);

  const deNovo = await roomActions.endSessionNow({ sessionId: SESSAO });
  assert.equal(deNovo.status, 409, "encerrada nao encerra de novo");
  const depois = await roomActions.sendTeamMessage({ body: "tarde demais", sessionId: SESSAO });
  assert.equal(depois.status, 409);
});

test("8. Remover minhas mensagens a pedido: o chat (inclusive a linha mestre), a pergunta e a resposta de enquete somem, o aceite e retirado, o historico e a auditoria com o motivo", async () => {
  actAs(produtor);
  const removido = ok(await roomActions.removeStudentMessages({ reason: "pedido pelo e-mail de 29/10", userId: aluna.id }));
  // 3 mensagens: a pendente desta sessao e as 2 da aluna na live gravada encerrada (seedLiveGravadaEncerradaDeTeste).
  assert.deepEqual([removido.messages, removido.questions, removido.answers, removido.consentRevoked], [3, 1, 1, true]);

  const dela = await mensagens({ author_user_id: aluna.id });
  assert.ok(dela.every((row) => row.deleted_reason === "consent_revoked" && row.deleted_at));
  const aceite = unwrap(await db.from("webinar_chat_consents").select("revoked_at").eq("user_id", aluna.id).single(), "Lendo o aceite");
  assert.ok(aceite.revoked_at);
  const historico = unwrap(await db.from("student_events").select("event_type, metadata").eq("user_id", aluna.id).eq("entity_type", "webinar"), "Lendo o historico");
  assert.deepEqual(historico.map((row) => [row.event_type, row.metadata.revoked, row.metadata.by_team]), [["webinar_chat_consented", true, true]]);
  const auditoria = unwrap(await db.from("admin_audit_log").select("metadata, entity_id").eq("action", "webinar.student_messages_removed").eq("entity_id", aluna.id), "Lendo a auditoria");
  assert.equal(auditoria[0].metadata.reason, "pedido pelo e-mail de 29/10");

  const retrato = await consoleQueries.getConsoleSnapshot(webinarId, SESSAO);
  assert.equal(retrato.messages.some((message) => message.authorUserId === aluna.id), false);
});

test("9. a rota de 5 s do console: 403 para o analista, 404 para a sessao de outro webinario, 200 com o retrato para o produtor, sem cache", async () => {
  const contexto = { params: Promise.resolve({ id: webinarId }) };
  const pedido = (sessionId) => new Request(`http://localhost/api/admin/webinars/${webinarId}/console?sessao=${sessionId}`);

  actAs(analista);
  assert.equal((await consoleRoute.GET(pedido(SESSAO), contexto)).status, 403);
  actAs(null);
  assert.equal((await consoleRoute.GET(pedido(SESSAO), contexto)).status, 401);

  actAs(produtor);
  assert.equal((await consoleRoute.GET(pedido("bbbbbbbb-0000-4000-8000-0000000000ff"), contexto)).status, 404);
  assert.equal((await consoleRoute.GET(new Request(`http://localhost/api/admin/webinars/${webinarId}/console`), contexto)).status, 400, "sem ?sessao=");
  const resposta = await consoleRoute.GET(pedido(SESSAO), contexto);
  assert.equal(resposta.status, 200, await resposta.clone().text());
  assert.match(resposta.headers.get("cache-control") ?? "", /no-store/);
  const { data } = await resposta.json();
  assert.equal(data.session.id, SESSAO);
  assert.equal(data.session.status, "ended");
  assert.equal(typeof data.serverTime, "string");
  assert.ok(Array.isArray(data.messages));
  assert.equal(data.polls.launched.length, 1);
});
