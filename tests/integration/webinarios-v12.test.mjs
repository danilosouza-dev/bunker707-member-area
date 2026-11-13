import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  LIVE_AO_VIVO_ENCERRADA_DE_TESTE,
  LIVE_GRAVADA_NO_AR_DE_TESTE,
  limparWebinarios,
  seedEscolaDeTeste,
  seedLiveAoVivoEncerradaDeTeste,
  seedLiveGravadaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// A rodada v12 dos webinarios (quarto teste do produtor de 12/11/2026; docs/30 D106 e D107) contra o banco LOCAL de
// verdade, na Live gravada no ar. Sem migracao: a chave fica em `webinars.room_settings` e a conta do Chat sai do
// retrato que o console ja le.
// - a chave "Mostrar quantas pessoas estão na sala" pelo console (setShowPresentCount): grava so a chave dela, sem
//   apagar as outras do room_settings; o retrato do console traz o que ficou; a sala do aluno e o sinal de 15 s deixam
//   de levar o numero, e voltam a levar com a chave ligada de novo; fica no registro de auditoria; o analista (sem
//   escrever no chat) recebe 403; a sessao encerrada, 409; a sessao que nao existe, 404;
// - a chave chega ao aluno sem esperar os 10 min do acesso guardado: o sinal de 15 s rele a chave a parte (uma leitura
//   por webinario a cada 15 s) e diz na resposta se o numero esta escondido; a acao do console esquece o que estava
//   guardado, e a mudanca feita por fora (o editor, outro processo) vale depois dos 15 s;
// - as mensagens novas do Chat do console (consoleChatNewCount) sobre o retrato de verdade: a mensagem do aluno conta
//   para quem esta no console; a que a propria pessoa escreveu nao conta para ela, e conta para o colega da equipe; o
//   que ja estava na marca nao conta.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const chatRoute = await import("../../src/app/api/webinars/[id]/chat/route.ts");
const sessionRoute = await import("../../src/app/api/webinars/[id]/session/route.ts");
const heartbeatRoute = await import("../../src/app/api/webinars/[id]/heartbeat/route.ts");
const roomActions = await import("../../src/server/webinars/room-actions.ts");
const consoleQueries = await import("../../src/server/webinars/console-queries.ts");
const v2 = await import("../../src/server/webinars/console-v2-model.ts");
const { clearV9ColumnsMemory } = await import("../../src/server/webinars/chat-store.ts");
const { clearAuthorPhotoCache } = await import("../../src/server/webinars/author-photos.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { loadPresentCountShown, resetRoomAccessCache } = await import("../../src/server/webinars/room-route.ts");
const { PRESENT_COUNT_REFRESH_MS } = await import("../../src/server/webinars/present-count-memory.ts");
const { CHAT_CONSENT_VERSION } = await import("../../src/server/webinars/model.ts");

const aluna = usuarioDeTeste(contas.aluna);
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const professor = usuarioDeTeste(contas.professor);
const pessoas = [aluna.id, produtor.id, analista.id, professor.id];
const { id: webinarId, sessaoId } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const contexto = { params: Promise.resolve({ id: webinarId }) };
const ACEITE = { consent: true, consentVersion: CHAT_CONSENT_VERSION };

const pedido = (path, method = "GET", body) =>
  new Request(`http://localhost/api/webinars/${webinarId}/${path}`, body === undefined ? { method } : { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method });
const json = async (response) => ({ body: await response.json(), status: response.status });

function ok(result) {
  assert.equal(result.ok, true, result.ok ? "" : `${result.status}: ${result.error}`);
  return result.data;
}

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
  unwrap(await db.from("notifications").delete().in("user_id", pessoas).eq("kind", "webinar"), "Apagando o sino de webinario de teste");
}

const configuracoes = async () => unwrap(await db.from("webinars").select("room_settings, updated_at").eq("id", webinarId).single(), "Lendo as configuracoes da sala");

async function configurar(roomSettings) {
  const atual = (await configuracoes()).room_settings ?? {};
  unwrap(await db.from("webinars").update({ room_settings: { ...atual, ...roomSettings } }).eq("id", webinarId), "Gravando as configuracoes da sala");
  resetRoomAccessCache();
}

const retratoDoConsole = async (viewer) => {
  const retrato = await consoleQueries.getConsoleSnapshot(webinarId, sessaoId, new Date(), viewer.id);
  assert.ok(retrato, "o retrato do console");
  return retrato;
};

async function alunaEscreve(body) {
  resetRoomLimits();
  actAs(aluna);
  const resposta = await json(await chatRoute.POST(pedido("chat", "POST", { body, kind: "message", sessionId: sessaoId, ...ACEITE }), contexto));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  return resposta.body.data.message;
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravadaDeTeste(db, { comecouHa: 120_000 });
  await seedLiveAoVivoEncerradaDeTeste(db);
  resetRoomLimits();
  resetRoomAccessCache();
  clearV9ColumnsMemory();
  clearAuthorPhotoCache();
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
  await limparRastros();
  clearV9ColumnsMemory();
});

test("1. a chave do numero de pessoas pelo console: grava so a chave dela, o retrato do console traz o que ficou, e a sala do aluno deixa de levar o numero; ligada de novo, volta", async () => {
  const retrato = async () => {
    actAs(aluna);
    const resposta = await json(await sessionRoute.GET(pedido(`session?sessao=${sessaoId}`), contexto));
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    return resposta.body.data;
  };
  const sinal = async () => {
    actAs(aluna);
    const resposta = await json(await heartbeatRoute.POST(pedido("heartbeat", "POST", { offsetSeconds: 120, sessionId: sessaoId, state: "playing", visible: true }), contexto));
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    return resposta.body.data;
  };

  // Uma chave de outra parte da sala, para conferir que a do numero nao a apaga.
  await configurar({ showPresentCount: true, waitingRoom: true });
  const ligado = await sinal();
  assert.deepEqual([ligado.presentHidden, ligado.presentNow], [false, 1], "ligada (o padrao), a aluna presente conta");
  assert.equal((await retratoDoConsole(produtor)).showPresentCount, true);

  // A equipe desliga pelo console. (O registro de auditoria so acrescenta: o teste le o que entrou a partir de agora.)
  const inicio = new Date().toISOString();
  const antes = (await configuracoes()).updated_at;
  actAs(produtor);
  assert.deepEqual(ok(await roomActions.setShowPresentCount({ sessionId: sessaoId, shown: false })), { sessionId: sessaoId, shown: false });
  // O acesso da aluna continua guardado na memoria (10 min), de proposito: a chave tem que chegar mesmo assim.
  const gravado = await configuracoes();
  assert.equal(gravado.room_settings.showPresentCount, false);
  assert.equal(gravado.room_settings.waitingRoom, true, "as outras chaves da sala ficam como estavam");
  assert.notEqual(gravado.updated_at, antes, "o webinario muda de versao: o editor aberto noutra aba recebe o conflito no Salvar");
  const doConsole = await retratoDoConsole(produtor);
  assert.equal(doConsole.showPresentCount, false, "o retrato do console traz a chave gravada");
  assert.equal(doConsole.presentNow, 1, "o console continua vendo o numero");
  const escondido = await retrato();
  assert.deepEqual([escondido.presentHidden, escondido.presentNow], [true, 0], "o numero nem chega a sala do aluno");
  const semNumero = await sinal();
  assert.deepEqual([semNumero.presentHidden, semNumero.presentNow], [true, 0], "nem pelo sinal de 15 s, que ja diz que o numero esta escondido");
  const registro = unwrap(
    await db.from("admin_audit_log").select("action, actor_id, entity_id, metadata").eq("action", "webinar.show_present_count").eq("entity_id", webinarId).gte("occurred_at", inicio),
    "Lendo o registro da chave"
  );
  assert.equal(registro.length, 1);
  assert.equal(registro[0].actor_id, produtor.id);
  assert.deepEqual(registro[0].metadata, { session_id: sessaoId, shown: false });

  // Ligada de novo, o numero volta.
  actAs(produtor);
  ok(await roomActions.setShowPresentCount({ sessionId: sessaoId, shown: true }));
  assert.equal((await configuracoes()).room_settings.showPresentCount, true);
  assert.equal((await retratoDoConsole(produtor)).showPresentCount, true);
  const visivel = await retrato();
  assert.deepEqual([visivel.presentHidden, visivel.presentNow], [false, 1]);
  const deVolta = await sinal();
  assert.deepEqual([deVolta.presentHidden, deVolta.presentNow], [false, 1], "o sinal volta a levar o numero, sem esperar o acesso guardado vencer");
});

test("1b. a chave mudada por fora deste processo (o editor, outra funcao): o sinal usa a que leu por ate 15 s e depois le de novo; sem a linha do webinario, vale o que o contexto guardou", async () => {
  await configurar({ showPresentCount: true });
  const agora = Date.now();
  assert.equal(await loadPresentCountShown(webinarId, true, agora), true, "a primeira leitura vai ao banco");

  // A chave muda no banco sem passar pela acao do console (nada esquece a memoria deste processo).
  const atual = (await configuracoes()).room_settings ?? {};
  unwrap(await db.from("webinars").update({ room_settings: { ...atual, showPresentCount: false } }).eq("id", webinarId), "Mudando a chave por fora");
  assert.equal(await loadPresentCountShown(webinarId, true, agora + PRESENT_COUNT_REFRESH_MS - 1), true, "dentro dos 15 s, a que ja foi lida");
  assert.equal(await loadPresentCountShown(webinarId, true, agora + PRESENT_COUNT_REFRESH_MS), false, "depois dos 15 s, o banco de novo");
  assert.equal(await loadPresentCountShown(webinarId, true, agora + PRESENT_COUNT_REFRESH_MS + 1), false, "e fica guardada de novo");

  // Os sinais que chegam juntos na virada esperam a mesma leitura; o webinario que nao existe usa o que o contexto guardou.
  resetRoomAccessCache();
  const juntos = await Promise.all([loadPresentCountShown(webinarId, true, agora), loadPresentCountShown(webinarId, true, agora), loadPresentCountShown(webinarId, true, agora)]);
  assert.deepEqual(juntos, [false, false, false]);
  assert.equal(await loadPresentCountShown("bbbbbbbb-0000-4000-8000-00000000ffff", true, agora), true);
  assert.equal(await loadPresentCountShown("bbbbbbbb-0000-4000-8000-00000000fffe", false, agora), false);
  await configurar({ showPresentCount: true });
});

test("2. quem nao pode e onde nao vale: o analista recebe 403; a sessao encerrada, 409; a sessao que nao existe, 404; o pedido estragado, 400; nada e gravado", async () => {
  await configurar({ showPresentCount: true });
  actAs(analista);
  const semPermissao = await roomActions.setShowPresentCount({ sessionId: sessaoId, shown: false });
  assert.deepEqual([semPermissao.ok, semPermissao.status], [false, 403]);

  actAs(produtor);
  const encerrada = await roomActions.setShowPresentCount({ sessionId: LIVE_AO_VIVO_ENCERRADA_DE_TESTE.sessaoId, shown: false });
  assert.deepEqual([encerrada.ok, encerrada.status], [false, 409], "a sessao encerrada nao aceita mais acoes da equipe");
  const inexistente = await roomActions.setShowPresentCount({ sessionId: "bbbbbbbb-0000-4000-8000-00000000ffff", shown: false });
  assert.deepEqual([inexistente.ok, inexistente.status], [false, 404]);
  const estragado = await roomActions.setShowPresentCount({ sessionId: sessaoId, shown: "nao" });
  assert.deepEqual([estragado.ok, estragado.status], [false, 400]);

  assert.equal((await configuracoes()).room_settings.showPresentCount, true, "a chave da gravada continua ligada");
  const daEncerrada = unwrap(await db.from("webinars").select("room_settings").eq("id", LIVE_AO_VIVO_ENCERRADA_DE_TESTE.id).single(), "Lendo a live encerrada");
  assert.notEqual(daEncerrada.room_settings?.showPresentCount, false, "nada gravado na live encerrada");
});

test("3. as mensagens novas do Chat do console sobre o retrato de verdade: a do aluno conta; a propria nao conta para quem escreveu e conta para o colega; o que ja estava na marca nao conta", async () => {
  // O Chat sai da tela de quem esta no console: a marca guarda o que ja estava la.
  const antes = await retratoDoConsole(produtor);
  const marca = v2.consoleChatSeenIds(antes.messages);
  assert.equal(v2.consoleChatNewCount({ messages: antes.messages, seenIds: marca, viewerId: produtor.id }), 0, "nada de novo no instante da marca");

  // A aluna comenta.
  const daAluna = await alunaEscreve("Boa noite, pessoal!");
  const comAluna = await retratoDoConsole(produtor);
  const lida = comAluna.messages.find((message) => message.id === daAluna.id);
  assert.ok(lida, "a mensagem da aluna no retrato do console");
  assert.deepEqual([lida.source, lida.kind, lida.authorUserId], ["audience", "message", aluna.id]);
  assert.equal(v2.consoleChatNewCount({ messages: comAluna.messages, seenIds: marca, viewerId: produtor.id }), 1, "o comentario do aluno avisa quem apresenta");
  assert.equal(v2.consoleChatNewCount({ messages: comAluna.messages, seenIds: null, viewerId: produtor.id }), 0, "com o Chat na tela, nenhum numero");

  // O produtor responde no chat: nao e novidade para ele; e para o colega da equipe.
  actAs(produtor);
  const doProdutor = ok(await roomActions.sendTeamMessage({ body: "Boa noite! Já vamos começar.", sessionId: sessaoId })).message;
  const comOsDois = await retratoDoConsole(produtor);
  assert.ok(comOsDois.messages.some((message) => message.id === doProdutor.id && message.source === "team" && message.authorUserId === produtor.id));
  assert.equal(v2.consoleChatNewCount({ messages: comOsDois.messages, seenIds: marca, viewerId: produtor.id }), 1, "a propria mensagem nao conta");
  assert.equal(v2.consoleChatNewCount({ messages: comOsDois.messages, seenIds: marca, viewerId: professor.id }), 2, "para o colega, as duas");

  // Voltou ao Chat e saiu de novo: a marca nova ja tem as duas, e so a proxima conta.
  const marcaNova = v2.consoleChatSeenIds(comOsDois.messages);
  assert.equal(v2.consoleChatNewCount({ messages: comOsDois.messages, seenIds: marcaNova, viewerId: produtor.id }), 0);
  await alunaEscreve("Tem certificado?");
  const depois = await retratoDoConsole(produtor);
  assert.equal(v2.consoleChatNewCount({ messages: depois.messages, seenIds: marcaNova, viewerId: produtor.id }), 1);
});
