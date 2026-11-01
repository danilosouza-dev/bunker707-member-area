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
