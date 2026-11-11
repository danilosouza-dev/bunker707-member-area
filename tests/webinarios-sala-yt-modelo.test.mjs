import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// A sala no estilo do YouTube (docs/31; docs/18 §2.2), as regras puras, sem navegador: as teclas dos menus da sala
// (menuKeyStep e menuOpenKey, o RoomMenu) e o tempo da dica (tooltipStep, a RoomTooltip: aparece em 150 ms, some em 75
// so quando o ponteiro e o foco do teclado saem, o ponteiro pode ir ate ela e o Esc so para ali quando ela estava na
// tela), e o toque no trilho a direita (railStep: abre naquela aba, fecha no item aberto so com a barra na tela). As
// fatias seguintes acrescentam aqui as regras delas.

const model = await import("../src/components/member/webinars/room/room-layout-model.ts");

test("menuKeyStep: as setas andam com volta, Home e End vao as pontas, o Esc fecha devolvendo o foco e o Tab fecha sem mexer nele", () => {
  const passo = (key, index, count = 3) => model.menuKeyStep({ count, index, key });

  // As setas, com a volta nas pontas.
  assert.deepEqual(passo("ArrowDown", 0), { index: 1, kind: "move" });
  assert.deepEqual(passo("ArrowDown", 2), { index: 0, kind: "move" }, "da ultima para a primeira");
  assert.deepEqual(passo("ArrowUp", 2), { index: 1, kind: "move" });
  assert.deepEqual(passo("ArrowUp", 0), { index: 2, kind: "move" }, "da primeira para a ultima");
  // Com o foco fora das opcoes, a seta para baixo vai a primeira e a para cima a ultima.
  assert.deepEqual(passo("ArrowDown", -1), { index: 0, kind: "move" });
  assert.deepEqual(passo("ArrowUp", -1), { index: 2, kind: "move" });
  assert.deepEqual(passo("ArrowDown", 7), { index: 0, kind: "move" }, "um indice que nao existe conta como fora");

  // As pontas.
  assert.deepEqual(passo("Home", 2), { index: 0, kind: "move" });
  assert.deepEqual(passo("End", 0), { index: 2, kind: "move" });

  // Fechar: o Esc devolve o foco ao botao; o Tab deixa o foco seguir para o proximo controle.
  assert.deepEqual(passo("Escape", 1), { kind: "close", refocus: true });
  assert.deepEqual(passo("Tab", 1), { kind: "close", refocus: false });

  // O resto (as letras, os atalhos da sala, o Enter que vira o clique da opcao) nao e do menu.
  for (const tecla of ["r", "Enter", " ", "ArrowLeft", "ArrowRight", "PageDown"]) {
    assert.deepEqual(passo(tecla, 1), { kind: "none" }, tecla);
  }

  // Sem opcoes, as setas nao andam; o Esc e o Tab continuam fechando.
  assert.deepEqual(passo("ArrowDown", -1, 0), { kind: "none" });
  assert.deepEqual(passo("End", -1, 0), { kind: "none" });
  assert.deepEqual(passo("Escape", -1, 0), { kind: "close", refocus: true });
  // Uma opcao so: as setas ficam nela.
  assert.deepEqual(passo("ArrowDown", 0, 1), { index: 0, kind: "move" });
  assert.deepEqual(passo("ArrowUp", 0, 1), { index: 0, kind: "move" });
});

test("menuOpenKey: a seta para baixo, o Enter e o Espaco abrem o menu com o foco no botao; nenhuma outra tecla", () => {
  for (const tecla of ["ArrowDown", "Enter", " "]) {
    assert.equal(model.menuOpenKey(tecla), true, tecla);
  }
  for (const tecla of ["ArrowUp", "Escape", "Tab", "Home", "a", "Spacebar", ""]) {
    assert.equal(model.menuOpenKey(tecla), false, tecla);
  }
});

test("tooltipStep: aparece so 150 ms depois do ponteiro ou do foco, some em 75, volta se o ponteiro voltar a tempo e fica com o ponteiro sobre ela", () => {
  const { tooltipStep, TOOLTIP_DELAYS_MS } = model;
  assert.deepEqual(TOOLTIP_DELAYS_MS, { hide: 75, show: 150 });
  const passos = (inicio, eventos) => eventos.reduce((estado, evento) => tooltipStep(estado, evento).state, inicio);

  // O ponteiro entra: ainda nao esta na tela, e a espera e de 150 ms; so o fim da espera a mostra.
  const entrou = tooltipStep("hidden", { kind: "enter" });
  assert.deepEqual(entrou, { delayMs: 150, state: "showing", stopped: false });
  assert.deepEqual(tooltipStep("showing", { kind: "elapsed" }), { delayMs: null, state: "shown", stopped: false });
  // O foco do teclado faz o mesmo.
  assert.deepEqual(tooltipStep("hidden", { kind: "focus" }), { delayMs: 150, state: "showing", stopped: false });
  // Entrar de novo durante a espera nao a recomeca (o mesmo passo).
  assert.equal(tooltipStep("showing", { kind: "enter" }).state, "showing");
  // Sair antes dos 150 ms: ela nunca aparece.
  assert.equal(passos("hidden", [{ kind: "enter" }, { kind: "leave" }]), "hidden");
  assert.equal(passos("hidden", [{ kind: "focus" }, { kind: "blur" }]), "hidden");

  // Na tela, o ponteiro sai: 75 ms saindo (ainda na tela) e entao some.
  const saindo = tooltipStep("shown", { kind: "leave" });
  assert.deepEqual(saindo, { delayMs: 75, state: "hiding", stopped: false });
  assert.equal(tooltipStep("hiding", { kind: "elapsed" }).state, "hidden");
  // Volta nesse tempo (o ponteiro atravessou o vao de 8 px ate a dica): ela fica.
  assert.deepEqual(tooltipStep("hiding", { kind: "enter" }), { delayMs: null, state: "shown", stopped: false });
  // O ponteiro que vai do botao para a propria dica nao a esconde (WCAG 1.4.13).
  assert.deepEqual(tooltipStep("shown", { kind: "leave", toTooltip: true }), { delayMs: null, state: "shown", stopped: false });

  // O foco que sai a esconde do mesmo jeito.
  assert.equal(tooltipStep("shown", { kind: "blur" }).state, "hiding");
  assert.equal(passos("shown", [{ kind: "blur" }, { kind: "elapsed" }]), "hidden");

  // Um fim de espera atrasado nao muda nada: na tela continua na tela, escondida continua escondida.
  assert.equal(tooltipStep("shown", { kind: "elapsed" }).state, "shown");
  assert.equal(tooltipStep("hidden", { kind: "elapsed" }).state, "hidden");
  assert.equal(tooltipStep("hidden", { kind: "leave" }).state, "hidden");
});

test("tooltipStep: o ponteiro e o foco do teclado seguram a dica cada um no seu; ela so sai quando os dois saem", () => {
  const { tooltipStep } = model;
  const passos = (inicio, eventos) => eventos.reduce((estado, evento) => tooltipStep(estado, evento).state, inicio);

  // O foco do teclado no botao e a dica na tela: o ponteiro passa e sai, e ela fica (WCAG 1.4.13, persistente).
  assert.deepEqual(tooltipStep("shown", { focused: true, kind: "leave" }), { delayMs: null, state: "shown", stopped: false });
  assert.equal(passos("hidden", [{ kind: "focus" }, { kind: "elapsed" }, { kind: "enter" }, { focused: true, kind: "leave" }]), "shown");
  // Ainda esperando para aparecer pelo foco: o ponteiro que passa nao cancela a espera.
  assert.deepEqual(tooltipStep("showing", { focused: true, kind: "leave" }), { delayMs: 150, state: "showing", stopped: false });
  // O ponteiro em cima e o foco que sai (o Tab para o proximo): ela fica.
  assert.deepEqual(tooltipStep("shown", { hovered: true, kind: "blur" }), { delayMs: null, state: "shown", stopped: false });
  assert.equal(passos("hidden", [{ kind: "enter" }, { kind: "focus" }, { kind: "elapsed" }, { hovered: true, kind: "blur" }]), "shown");
  // Quando o outro tambem sai, ela sai: 75 ms saindo e some.
  assert.equal(passos("shown", [{ hovered: true, kind: "blur" }, { focused: false, kind: "leave" }]), "hiding");
  assert.equal(passos("shown", [{ focused: true, kind: "leave" }, { hovered: false, kind: "blur" }, { kind: "elapsed" }]), "hidden");
  // Saindo pelo ponteiro e o foco do teclado chega a tempo: ela volta.
  assert.equal(passos("hiding", [{ kind: "focus" }]), "shown");
  // O Esc vence os dois: esconde na hora, com o ponteiro em cima e o foco no botao.
  assert.equal(passos("shown", [{ hovered: true, kind: "blur" }, { kind: "escape" }]), "hidden");
});

test("tooltipStep: o Esc esconde na hora e so para ali (stopped) quando a dica estava na tela; senao ele segue para a sala", () => {
  for (const naTela of ["shown", "hiding"]) {
    assert.deepEqual(model.tooltipStep(naTela, { kind: "escape" }), { delayMs: null, state: "hidden", stopped: true }, naTela);
  }
  // Ainda esperando para aparecer: a espera acaba, e o Esc segue (a sala fecha a camada de cima ou pergunta se quer sair).
  assert.deepEqual(model.tooltipStep("showing", { kind: "escape" }), { delayMs: null, state: "hidden", stopped: false });
  assert.deepEqual(model.tooltipStep("hidden", { kind: "escape" }), { delayMs: null, state: "hidden", stopped: false });
});

test("railStep (o trilho a direita): o item fechado abre o painel naquela aba, outro item troca a aba e mantem aberto, o item aberto fecha; sem a barra (encerrada) o item aberto nao fecha", () => {
  const passo = (extra) => model.railStep({ closable: true, item: "chat", panelShown: true, tab: "chat", ...extra });

  // O painel fechado: qualquer item abre o painel na aba dele (tambem o da aba que estava escolhida antes de fechar).
  assert.deepEqual(passo({ item: "perguntas", panelShown: false, tab: "chat" }), { panelOpen: true, tab: "perguntas" });
  assert.deepEqual(passo({ item: "chat", panelShown: false, tab: "chat" }), { panelOpen: true, tab: "chat" }, "a aba de antes, com o painel fechado, abre");
  // O painel aberto noutra aba: troca a aba e continua aberto (nunca fecha e abre de novo).
  assert.deepEqual(passo({ item: "participantes", tab: "chat" }), { panelOpen: true, tab: "participantes" });
  assert.deepEqual(passo({ item: "chat", tab: "enquetes" }), { panelOpen: true, tab: "chat" });
  // O item da aba que esta na tela fecha o painel, com a barra na tela; a aba fica, para reabrir no mesmo lugar.
  assert.deepEqual(passo({ item: "perguntas", tab: "perguntas" }), { panelOpen: false, tab: "perguntas" });
  assert.deepEqual(passo({}), { panelOpen: false, tab: "chat" });

  // Sem a barra (a sessao encerrada) o painel fica sempre na tela: o toque no item aberto nao fecha nada (a regra antiga
  // do balao, setPanelOpen(!panelOpen), deixaria o painel fechado sem nenhum jeito de reabrir).
  assert.deepEqual(passo({ closable: false }), { panelOpen: true, tab: "chat" });
  assert.deepEqual(passo({ closable: false, item: "perguntas", tab: "perguntas" }), { panelOpen: true, tab: "perguntas" });
  // E continua trocando de aba.
  assert.deepEqual(passo({ closable: false, item: "perguntas" }), { panelOpen: true, tab: "perguntas" });

  // Depois do passo, o painel na tela pela regra da sala (roomPanelShown): o fechar so vale com a barra.
  const encerrada = passo({ closable: false });
  assert.equal(model.roomPanelShown({ barShown: false, panelOpen: encerrada.panelOpen, settingsTakeover: false }), true);
  const fechou = passo({});
  assert.equal(model.roomPanelShown({ barShown: true, panelOpen: fechou.panelOpen, settingsTakeover: false }), false);
});

// Y8: as Perguntas no estilo do YouTube (room-questions-model.ts): o filtro dos chips, o vazio que diz o filtro e a
// linha de chips que rola de lado.
const questionsModel = await import("../src/components/member/webinars/room/room-questions-model.ts");
const { WEBINAR_COPY: COPY } = await import("../src/lib/webinar-copy.ts");

test("questionsShown: Todas mostra tudo; Sem resposta so a aberta (nunca a dispensada); Respondidas so a respondida; Minhas toda minha, inclusive a minha dispensada", () => {
  const pergunta = (id, status, mine) => ({ id, mine, status });
  const lista = [pergunta("aberta", "open", false), pergunta("respondida", "answered", false), pergunta("dispensada-minha", "dismissed", true), pergunta("minha-aberta", "open", true)];
  const ids = (filtro) => questionsModel.questionsShown(lista, filtro).map((item) => item.id);
  assert.deepEqual(ids("all"), ["aberta", "respondida", "dispensada-minha", "minha-aberta"]);
  assert.deepEqual(ids("open"), ["aberta", "minha-aberta"], "a dispensada nao e sem resposta");
  assert.deepEqual(ids("answered"), ["respondida"]);
  assert.deepEqual(ids("mine"), ["dispensada-minha", "minha-aberta"], "a minha dispensada entra em Minhas");
  // Uma copia: filtrar nunca mexe na lista lida.
  assert.notEqual(questionsModel.questionsShown(lista, "all"), lista);
  assert.equal(lista.length, 4);
});

test("questionsEmptyPhrase: o vazio diz o filtro; os chips e a ordem tem os nomes das frases", () => {
  const novas = COPY.salaV2.perguntas;
  assert.equal(questionsModel.questionsEmptyPhrase("all"), COPY.sala.semPerguntas);
  assert.equal(questionsModel.questionsEmptyPhrase("open"), "Nenhuma pergunta sem resposta.");
  assert.equal(questionsModel.questionsEmptyPhrase("answered"), "Nenhuma pergunta respondida ainda.");
  assert.equal(questionsModel.questionsEmptyPhrase("mine"), "Você ainda não fez perguntas.");
  assert.deepEqual(questionsModel.QUESTIONS_FILTERS.map(questionsModel.questionsFilterLabel), ["Todas", novas.semResposta, "Respondidas", novas.minhas]);
  assert.deepEqual(questionsModel.QUESTIONS_ORDERS.map(questionsModel.questionsOrderLabel), ["Mais votadas", "Mais recentes"]);
});

test("chipArrows: no comeco so a seta da direita, no meio as duas, no fim so a da esquerda e, cabendo, nenhuma (com a folga de 1 px)", () => {
  const setas = (scrollLeft, clientWidth = 374, scrollWidth = 420) => questionsModel.chipArrows({ clientWidth, scrollLeft, scrollWidth });
  assert.deepEqual(setas(0), { left: false, right: true }, "no comeco");
  assert.deepEqual(setas(20), { left: true, right: true }, "no meio");
  assert.deepEqual(setas(46), { left: true, right: false }, "no fim");
  assert.deepEqual(setas(45.5), { left: true, right: false }, "o fim com o scrollLeft fracionado");
  assert.deepEqual(setas(0.5), { left: false, right: true }, "o comeco com o scrollLeft fracionado");
  assert.deepEqual(setas(0, 420, 420), { left: false, right: false }, "cabendo");
  assert.deepEqual(setas(0, 500, 420), { left: false, right: false }, "sobrando");
});

test("chipScrollBy: o clique na seta rola 80 % da largura visivel, para o lado da seta", () => {
  assert.equal(questionsModel.chipScrollBy({ clientWidth: 374, direction: 1 }), 299);
  assert.equal(questionsModel.chipScrollBy({ clientWidth: 374, direction: -1 }), -299);
  assert.equal(questionsModel.chipScrollBy({ clientWidth: 100, direction: 1 }), 80);
});

// Y9: o comentario do YouTube no chat (src/lib/webinar-room-client.ts): o tempo relativo, o "@assistente" em trechos e
// o nome igual ao papel.
const roomClient = await import("../src/lib/webinar-room-client.ts");
const assistantModel = await import("../src/server/webinars/assistant-model.ts");

test("chatAgoLabel: a live pelo sentAt, a gravada pelo zero mais o offset, o Replay sem tempo, o futuro preso em agora e o skew contando", () => {
  const ZERO = Date.parse("2026-11-05T23:00:00.000Z");
  const MIN = 60_000;
  const agora = ZERO + 43 * MIN;
  // A live: a hora que o servidor gravou, contra o agora do servidor.
  assert.equal(roomClient.chatAgoLabel({ kind: "live", nowMs: agora, offsetMs: 0, sentAt: new Date(ZERO + 41 * MIN).toISOString() }), "há 2 minutos");
  assert.equal(roomClient.chatAgoLabel({ kind: "live", nowMs: agora, offsetMs: 41 * MIN, sentAt: null, zeroMs: ZERO }), "", "a live sem sentAt fica sem tempo (nunca a conta pelo zero)");
  // A gravada: o zero (a hora marcada) mais o offset.
  assert.equal(roomClient.chatAgoLabel({ kind: "simulated", nowMs: agora, offsetMs: 33 * MIN, sentAt: null, zeroMs: ZERO }), "há 10 minutos");
  assert.equal(roomClient.chatAgoLabel({ kind: "simulated", nowMs: agora, offsetMs: 33 * MIN, zeroMs: null }), "", "sem o zero, sem tempo");
  // O Replay: nenhum tempo.
  assert.equal(roomClient.chatAgoLabel({ kind: "replay", nowMs: agora, offsetMs: 33 * MIN, sentAt: new Date(ZERO).toISOString(), zeroMs: ZERO }), "");
  // O futuro (a minha mensagem a frente do player na gravada, o relogio atrasado): sempre "agora", nunca "em 2 minutos".
  assert.equal(roomClient.chatAgoLabel({ kind: "simulated", nowMs: agora, offsetMs: 45 * MIN, zeroMs: ZERO }), "agora");
  assert.equal(roomClient.chatAgoLabel({ kind: "live", nowMs: agora, offsetMs: 0, sentAt: new Date(agora + 5 * MIN).toISOString() }), "agora");
  // Abaixo de 45 s, "agora".
  assert.equal(roomClient.chatAgoLabel({ kind: "live", nowMs: agora, offsetMs: 0, sentAt: new Date(agora - 30_000).toISOString() }), "agora");
  // O skew conta: com o aparelho 3 minutos atrasado, so o agora do aparelho daria "agora"; a sala passa o agora do
  // aparelho mais a diferenca para o servidor.
  const skewMs = 3 * MIN;
  const doAparelho = agora - skewMs;
  const sentAt = new Date(ZERO + 41 * MIN).toISOString();
  assert.equal(roomClient.chatAgoLabel({ kind: "live", nowMs: doAparelho, offsetMs: 0, sentAt }), "agora");
  assert.equal(roomClient.chatAgoLabel({ kind: "live", nowMs: doAparelho + skewMs, offsetMs: 0, sentAt }), "há 2 minutos");
  // O instante (o dateTime do <time>) pela mesma regra.
  assert.equal(roomClient.chatTimeAt({ kind: "simulated", offsetMs: 33 * MIN, zeroMs: ZERO }), ZERO + 33 * MIN);
  assert.equal(roomClient.chatTimeAt({ kind: "replay", offsetMs: 33 * MIN, zeroMs: ZERO }), null);
});

test("commentSegments: o '@assistente' em trecho proprio (a mencao primeiro, ou no meio, em qualquer caixa), pela mesma regra do servidor", () => {
  assert.deepEqual(roomClient.commentSegments("@assistente o certificado sai quando?"), [
    { mention: true, text: "@assistente" },
    { mention: false, text: " o certificado sai quando?" }
  ]);
  assert.deepEqual(roomClient.commentSegments("Oi @Assistente, tudo bem?"), [
    { mention: false, text: "Oi " },
    { mention: true, text: "@Assistente" },
    { mention: false, text: ", tudo bem?" }
  ]);
  assert.deepEqual(roomClient.commentSegments("sem mencao"), [{ mention: false, text: "sem mencao" }]);
  assert.deepEqual(roomClient.commentSegments(""), []);
  // A mesma regra do mentionsAssistant (copiada, sem o navegador carregar o modelo do Assistente).
  for (const texto of ["@assistente", "x@assistente", "@assistentes", "nome@assistente.com", "(@assistente)", "@ASSISTENTE!", "oi\n@assistente", "@assistente_x", "@assistente @assistente", "@assistente@assistente", "ola"]) {
    const trechos = roomClient.commentSegments(texto);
    assert.equal(trechos.some((trecho) => trecho.mention), assistantModel.mentionsAssistant(texto), texto);
    assert.equal(trechos.map((trecho) => trecho.text).join(""), texto, `${texto}: os trechos refazem o texto`);
  }
});

test("roleBadgeOnly: o nome igual ao papel (sem acento nem caixa) mostra so o selo; um nome de pessoa ou sem papel, nao", () => {
  assert.equal(roomClient.roleBadgeOnly("Assistente", "Assistente"), true);
  assert.equal(roomClient.roleBadgeOnly("equipe ", "Equipe"), true);
  assert.equal(roomClient.roleBadgeOnly("Equípe", "Equipe"), true, "sem acento");
  assert.equal(roomClient.roleBadgeOnly("Marina R.", "Equipe"), false);
  assert.equal(roomClient.roleBadgeOnly("Assistente", null), false, "sem papel");
  assert.equal(roomClient.roleBadgeOnly("", "Equipe"), false);
});

// Y10: a pergunta como o comentario do YouTube (room-questions-model.ts): o fio "1 resposta" so com a resposta
// escrita, aberto na minha e fechado nas outras (com o clique do aluno trocando o padrao), e a situacao na linha de acoes.
test("questionHasThread e questionThreadOpenByDefault: so a resposta escrita tem fio; a minha com texto abre, a minha so ao vivo sem texto nao tem fio, a de outro com texto fica fechada", () => {
  const pergunta = (extra) => ({ answerText: null, answeredLive: false, id: "q", mine: false, status: "open", ...extra });
  const minhaEscrita = pergunta({ answerText: "Fica 7 dias.", mine: true, status: "answered" });
  const minhaAoVivo = pergunta({ answeredLive: true, mine: true, status: "answered" });
  const deOutroEscrita = pergunta({ answerText: "Sim.", status: "answered" });
  assert.equal(questionsModel.questionHasThread(minhaEscrita), true);
  assert.equal(questionsModel.questionThreadOpenByDefault(minhaEscrita), true, "a minha com texto abre");
  assert.equal(questionsModel.questionHasThread(minhaAoVivo), false, "so ao vivo, sem texto, nao tem fio");
  assert.equal(questionsModel.questionThreadOpenByDefault(minhaAoVivo), false);
  assert.equal(questionsModel.questionHasThread(deOutroEscrita), true);
  assert.equal(questionsModel.questionThreadOpenByDefault(deOutroEscrita), false, "a de outro com texto fica fechada");
  assert.equal(questionsModel.questionHasThread(pergunta({ answerText: "   ", mine: true, status: "answered" })), false, "texto so de espacos nao e resposta");
  assert.equal(questionsModel.questionHasThread(pergunta({ answerText: "Sim.", mine: true })), false, "a aberta de novo nao mostra a resposta antiga");
});

test("questionThreadCount: a resposta escrita conta uma e cada resposta do fio mais uma; a respondida so ao vivo ganha fio quando alguem escreve; a aberta de novo, zero", () => {
  const pergunta = (extra) => ({ answerText: null, answeredLive: false, id: "q", mine: false, replies: [], status: "open", ...extra });
  const fio = [{ id: "r1" }, { id: "r2" }];
  assert.equal(questionsModel.questionThreadCount(pergunta({ answerText: "Sim.", status: "answered" })), 1);
  assert.equal(questionsModel.questionThreadCount(pergunta({ answerText: "Sim.", replies: fio, status: "answered" })), 3);
  assert.equal(questionsModel.questionThreadCount(pergunta({ answeredLive: true, status: "answered" })), 0, "so ao vivo, sem nada escrito");
  assert.equal(questionsModel.questionThreadCount(pergunta({ answeredLive: true, replies: fio, status: "answered" })), 2, "o fio comeca com o que foi escrito depois");
  assert.equal(questionsModel.questionHasThread(pergunta({ answeredLive: true, replies: fio, status: "answered" })), true);
  assert.equal(questionsModel.questionThreadCount(pergunta({ answerText: "Sim.", replies: fio })), 0, "a aberta de novo nao mostra o fio antigo");
  // Sem a lista (uma pergunta de antes do fio), como antes.
  assert.equal(questionsModel.questionThreadCount({ answerText: "Sim.", mine: false, status: "answered" }), 1);
});

test("questionThreadOpen: o clique troca o padrao e continua valendo; a minha respondida depois abre sozinha", () => {
  const minha = { answerText: null, answeredLive: false, id: "q1", mine: true, status: "open" };
  const deOutro = { answerText: "Sim.", answeredLive: false, id: "q2", mine: false, status: "answered" };
  const nenhum = new Set();
  assert.equal(questionsModel.questionThreadOpen(minha, nenhum), false, "sem resposta, sem fio");
  // A equipe responde por escrito: na releitura, a minha abre sozinha.
  const respondida = { ...minha, answerText: "Fica 7 dias.", status: "answered" };
  assert.equal(questionsModel.questionThreadOpen(respondida, nenhum), true);
  // O clique fecha a minha e abre a de outro; um segundo clique volta ao padrao.
  const clicadas = new Set(["q1", "q2"]);
  assert.equal(questionsModel.questionThreadOpen(respondida, clicadas), false);
  assert.equal(questionsModel.questionThreadOpen(deOutro, nenhum), false);
  assert.equal(questionsModel.questionThreadOpen(deOutro, clicadas), true);
  assert.equal(questionsModel.questionThreadOpen({ ...deOutro, answerText: null, answeredLive: true }, clicadas), false, "sem texto nunca abre, nem clicada");
});

test("questionReplyOpenStep: o Responder abre o campo com o rascunho vazio; clicado de novo na mesma pergunta, o rascunho fica; noutra pergunta, o campo muda e comeca vazio", () => {
  const fechado = { draft: "", openId: null, status: null };
  assert.deepEqual(questionsModel.questionReplyOpenStep(fechado, "q1"), { draft: "", openId: "q1", status: null });
  const escrevendo = { draft: "Obrigada! E o certificado?", openId: "q1", status: "Muitas tentativas. Espere um pouco." };
  assert.deepEqual(questionsModel.questionReplyOpenStep(escrevendo, "q1"), escrevendo, "o mesmo Responder nao apaga o que foi escrito");
  assert.deepEqual(questionsModel.questionReplyOpenStep(escrevendo, "q2"), { draft: "", openId: "q2", status: null }, "noutra pergunta, o campo muda e comeca vazio");
});

test("questionReplyGone: o campo de responder fecha quando a pergunta dele saiu da lista ou deixou de aceitar a resposta; sem campo aberto, nunca", () => {
  const lista = [
    { canReply: true, id: "q1" },
    { canReply: false, id: "q2" }
  ];
  assert.equal(questionsModel.questionReplyGone(lista, null), false, "sem campo aberto");
  assert.equal(questionsModel.questionReplyGone(lista, "q1"), false, "a respondida que aceita resposta");
  assert.equal(questionsModel.questionReplyGone(lista, "q2"), true, "a equipe reabriu, dispensou ou o fio encheu");
  assert.equal(questionsModel.questionReplyGone(lista, "q9"), true, "apagada: saiu da lista");
  assert.equal(questionsModel.questionReplyGone([], "q1"), true);
});

test("questionStatusOf: Respondida ao vivo, Dispensada (so o autor a recebe) e nada nas outras", () => {
  assert.equal(questionsModel.questionStatusOf({ answeredLive: true, status: "answered" }), "live");
  assert.equal(questionsModel.questionStatusOf({ answeredLive: false, status: "answered" }), null, "a escrita: o fio ja diz");
  assert.equal(questionsModel.questionStatusOf({ answeredLive: false, status: "dismissed" }), "dismissed");
  assert.equal(questionsModel.questionStatusOf({ answeredLive: false, status: "open" }), null);
  assert.equal(questionsModel.questionStatusOf({ answeredLive: true, status: "open" }), null, "aberta de novo: sem o ao vivo de antes");
  assert.equal(COPY.salaV2.perguntas.respostas(1), "1 resposta");
  assert.equal(COPY.salaV2.perguntas.respostas(3), "3 respostas");
});

// Y11: o campo "Adicione um comentário" (room-composer-model.ts): quando ele fica aberto, a linha embaixo e o que o
// Enter faz no chat e nas Perguntas.
const composerModel = await import("../src/components/member/webinars/room/room-composer-model.ts");

test("composerExpandedStep: o foco abre; o blur com rascunho fica aberto (o clique no Enviar tira o foco antes do click); o blur vazio fecha; o Cancelar e o envio fecham", () => {
  const passo = (estado, type, draft = "") => composerModel.composerExpandedStep(estado, { draft, type });
  assert.equal(passo(false, "focus"), true, "o foco abre");
  assert.equal(passo(true, "focus", "oi"), true);
  // O clique no Enviar: o mousedown tira o foco do campo antes do click; com rascunho, o rodape continua ate o click.
  assert.equal(passo(true, "blur", "minha pergunta"), true, "o blur com rascunho fica aberto");
  assert.equal(passo(true, "blur", ""), false, "o blur sem rascunho fecha");
  assert.equal(passo(false, "blur", "texto"), false, "o blur nunca abre");
  assert.equal(passo(true, "cancel", "texto"), false, "o Cancelar fecha");
  assert.equal(passo(true, "sent", ""), false, "o envio fecha");
});

test("composerLine: com o foco a linha de 2 px, aberto com rascunho e sem o foco a de 1 px mais forte, senao a do campo vazio", () => {
  assert.equal(composerModel.composerLine({ draft: "", expanded: true, focused: true }), "focus");
  assert.equal(composerModel.composerLine({ draft: "oi", expanded: true, focused: true }), "focus");
  assert.equal(composerModel.composerLine({ draft: "oi", expanded: true, focused: false }), "draft");
  assert.equal(composerModel.composerLine({ draft: "", expanded: false, focused: false }), "idle");
  assert.equal(composerModel.composerLine({ draft: "oi", expanded: false, focused: false }), "idle", "fechado, a linha do campo vazio");
});

test("composerKey: no chat o Enter envia e o Shift+Enter quebra; nas Perguntas o Enter quebra e o Ctrl ou o ⌘ com o Enter envia; o IME nunca envia", () => {
  const tecla = (mode, extra = {}) => composerModel.composerKey({ composing: false, ctrl: false, key: "Enter", meta: false, mode, shift: false, ...extra });
  assert.equal(tecla("enter"), "submit", "o Enter envia no chat");
  assert.equal(tecla("enter", { shift: true }), "newline", "o Shift+Enter quebra no chat");
  assert.equal(tecla("mod-enter"), "newline", "o Enter quebra nas Perguntas");
  assert.equal(tecla("mod-enter", { ctrl: true }), "submit", "o Ctrl+Enter envia nas Perguntas");
  assert.equal(tecla("mod-enter", { meta: true }), "submit", "o ⌘+Enter envia nas Perguntas");
  assert.equal(tecla("mod-enter", { shift: true }), "newline");
  assert.equal(tecla("enter", { composing: true }), null, "o IME confirma o texto, nunca envia");
  assert.equal(tecla("mod-enter", { composing: true, ctrl: true }), null);
  assert.equal(tecla("enter", { key: "a" }), null, "outra tecla, nada");
});

test("composerKey: com o envio em andamento ou o campo desligado, a tecla de envio fica parada e o mesmo texto nao vai duas vezes", () => {
  const tecla = (mode, extra = {}) => composerModel.composerKey({ composing: false, ctrl: false, key: "Enter", meta: false, mode, shift: false, ...extra });
  assert.equal(tecla("mod-enter", { blocked: true, ctrl: true }), "hold", "o Ctrl+Enter durante o envio da pergunta nao envia de novo");
  assert.equal(tecla("mod-enter", { blocked: true, meta: true }), "hold", "o ⌘+Enter tambem");
  assert.equal(tecla("enter", { blocked: true }), "hold", "o Enter durante o envio do chat nao envia de novo nem quebra a linha");
  assert.equal(tecla("mod-enter", { blocked: true }), "newline", "o Enter sozinho nas Perguntas continua quebrando a linha");
  assert.equal(tecla("enter", { blocked: true, shift: true }), "newline", "o Shift+Enter continua quebrando a linha");
  assert.equal(tecla("enter", { blocked: true, composing: true }), null, "o IME continua sem enviar");
  assert.equal(tecla("mod-enter", { blocked: false, ctrl: true }), "submit", "livre, envia");
});

test("replyFieldKey: o Esc cancela com o foco no texto, no Cancelar ou no Responder; o Ctrl ou o ⌘ com o Enter envia so do texto", () => {
  const tecla = (extra = {}) => composerModel.replyFieldKey({ ctrl: false, inText: true, key: "Escape", meta: false, ...extra });
  assert.equal(tecla(), "cancel");
  assert.equal(tecla({ inText: false }), "cancel", "no Cancelar e no Responder o Esc tambem cancela (nao chega a sala)");
  assert.equal(tecla({ ctrl: true, key: "Enter" }), "submit");
  assert.equal(tecla({ key: "Enter", meta: true }), "submit");
  assert.equal(tecla({ key: "Enter" }), null);
  assert.equal(tecla({ ctrl: true, inText: false, key: "Enter" }), null);
});

const replyField = await import("../src/components/member/webinars/room/room-reply-field.tsx");

test("returnFocusFromReply: o campo de responder saiu com o foco nele (caiu no body): o foco volta ao Responder da pergunta; um foco noutro controle fica", () => {
  const focados = [];
  const no = (nome) => ({ focus: () => focados.push(nome), nome });
  const responder = no("Responder da q6");
  const body = { nome: "body" };
  const pedidos = [];
  const aba = (achado = responder) => ({ querySelector: (selector) => (pedidos.push(selector), achado) });
  const seletor = '[data-room-question="q6"] [data-room-reply-open]';
  assert.equal(replyField.returnFocusFromReply(aba(), body, body, seletor), true);
  assert.deepEqual(focados, ["Responder da q6"]);
  assert.deepEqual(pedidos, [seletor]);
  assert.equal(replyField.returnFocusFromReply(aba(), null, body, seletor), true);
  const antes = focados.length;
  assert.equal(replyField.returnFocusFromReply(aba(), no("Curtir"), body, seletor), false, "o aluno ja foi a outro controle");
  assert.equal(replyField.returnFocusFromReply(aba(null), body, body, seletor), false);
  assert.equal(replyField.returnFocusFromReply(null, body, body, seletor), false);
  assert.equal(focados.length, antes);
});
