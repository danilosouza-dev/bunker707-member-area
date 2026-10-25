import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Ajudante de ponteiro do editor Livre (docs/27 §13.9, L4a; docs/18 §1.1), pacote A: followFreePointer com uma
// janela falsa (um EventTarget que guarda os ouvintes e tem relogio proprio) e um alvo cujo setPointerCapture lanca.
// Prova o limiar (antes dele e so clique, e o Esc desliga o gesto), a captura so depois do limiar, o cancelamento por
// Esc, blur, pointercancel e buttons 0, o lostpointercapture ignorado, as teclas engolidas durante o gesto (menos
// Shift, Alt, Control e Meta), o click engolido depois (sai no primeiro click, no proximo pointerdown ou em 350 ms),
// o pointerId filtrado, os pointerTypes de cada chamada, a funcao que desliga o gesto (e deixa o bloqueador) e que
// nenhum ouvinte sobra na janela. Tudo pelo Node, sem janela de verdade: o arquivo nao toca na janela ao carregar.
// L4b (docs/27 L39 e L44, decisao 5 do produtor e critica C10): o toque so quando a chamada pede, o Alt e o Shift no
// onMove, freeAutoScrollStep e a rolagem sozinha (um requestAnimationFrame falso e uma area falsa que rola): so
// depois do limiar, so armada depois de o ponto estar dentro da area e fora da faixa, o onMove so quando rolou e o
// laco que para em todo fim de gesto.

assert.equal(typeof globalThis.window, "undefined", "o Node nao tem janela");
assert.equal(typeof globalThis.document, "undefined", "o Node nao tem documento");

const pointer = await import("../src/components/admin/v2/communication/popup-free/free-pointer-drag.ts");

function captura(options) {
  return typeof options === "boolean" ? options : Boolean(options?.capture);
}

/**
 * Janela falsa: os ouvintes ficam numa lista (tipo + captura, como o navegador identifica), o relogio anda a mao e os
 * quadros (requestAnimationFrame) so rodam quando o teste chama quadro().
 */
class JanelaFalsa extends EventTarget {
  agora = 0;
  ouvintes = [];
  quadros = new Map();
  relogios = new Map();
  #proximo = 1;

  requestAnimationFrame(fn) {
    const id = this.#proximo;

    this.#proximo += 1;
    this.quadros.set(id, fn);

    return id;
  }

  cancelAnimationFrame(id) {
    this.quadros.delete(id);
  }

  /** Roda os quadros pedidos ate agora (os pedidos dentro deles ficam para o proximo). */
  quadro() {
    const pedidos = [...this.quadros.values()];

    this.quadros.clear();

    for (const fn of pedidos) {
      fn(this.agora);
    }
  }

  addEventListener(type, listener, options) {
    const capture = captura(options);

    if (!this.ouvintes.some((item) => item.type === type && item.listener === listener && item.capture === capture)) {
      this.ouvintes.push({ capture, listener, type });
    }

    super.addEventListener(type, listener, options);
  }

  removeEventListener(type, listener, options) {
    const capture = captura(options);

    this.ouvintes = this.ouvintes.filter((item) => !(item.type === type && item.listener === listener && item.capture === capture));
    super.removeEventListener(type, listener, options);
  }

  setTimeout(fn, ms) {
    const id = this.#proximo;

    this.#proximo += 1;
    this.relogios.set(id, { fn, quando: this.agora + ms });

    return id;
  }

  clearTimeout(id) {
    this.relogios.delete(id);
  }

  avancar(ms) {
    this.agora += ms;

    for (const [id, relogio] of [...this.relogios]) {
      if (relogio.quando <= this.agora) {
        this.relogios.delete(id);
        relogio.fn();
      }
    }
  }

  tipos() {
    return this.ouvintes.map((item) => `${item.type}${item.capture ? " (captura)" : ""}`).sort();
  }
}

/** O alvo do pointerdown: a janela vem do ownerDocument, e a captura sempre falha (ponteiro ja solto). */
function alvoFalso(janela) {
  const alvo = new EventTarget();

  alvo.ownerDocument = { defaultView: janela };
  alvo.capturas = [];
  alvo.setPointerCapture = (id) => {
    alvo.capturas.push(id);
    throw new DOMException("Sem ponteiro ativo.", "NotFoundError");
  };

  return alvo;
}

/**
 * A area que rola sozinha (a area de desenho, a lista das Camadas): caixa parada na tela (padrao 50..450 x 50..350,
 * com a faixa de 32 px dentro da borda) e rolagem limitada de 0 ao maximo, como o navegador faz. Anota cada scrollBy.
 */
function areaFalsa({ caixa = { bottom: 350, left: 50, right: 450, top: 50 }, maximo = { x: 600, y: 600 }, rolagem = { x: 100, y: 100 } } = {}) {
  const area = {
    rolagens: [],
    scrollLeft: rolagem.x,
    scrollTop: rolagem.y,
    getBoundingClientRect: () => ({ ...caixa, height: caixa.bottom - caixa.top, width: caixa.right - caixa.left, x: caixa.left, y: caixa.top }),
    scrollBy(dx, dy) {
      area.rolagens.push([dx, dy]);
      area.scrollLeft = Math.min(maximo.x, Math.max(0, area.scrollLeft + dx));
      area.scrollTop = Math.min(maximo.y, Math.max(0, area.scrollTop + dy));
    }
  };

  return area;
}

/** Comeca um gesto (mouse, botao 0, ponteiro 1 em 100,100, limiar 4) e anota o que cada handler recebe. */
function montar({ comeco = {}, handlers = {} } = {}) {
  const janela = new JanelaFalsa();
  const alvo = alvoFalso(janela);
  const chamadas = [];
  const dispose = pointer.followFreePointer(
    { button: 0, clientX: 100, clientY: 100, currentTarget: alvo, isPrimary: true, pointerId: 1, pointerType: "mouse", ...comeco },
    {
      onCancel: () => chamadas.push(["cancel"]),
      onDrop: (ponto) => chamadas.push(["drop", ponto]),
      onMove: (ponto) => chamadas.push(["move", ponto]),
      onStart: () => chamadas.push(["start", [...alvo.capturas]]),
      threshold: 4,
      ...handlers
    }
  );

  return { alvo, chamadas, dispose, janela };
}

function disparar(janela, type, campos = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), campos);

  janela.dispatchEvent(event);

  return event;
}

function ponteiro(janela, type, x, y, campos = {}) {
  return disparar(janela, type, { buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, pointerId: 1, ...campos });
}

function tecla(janela, key, campos = {}) {
  return disparar(janela, "keydown", { key, ...campos });
}

/** Comeca o gesto e passa do limiar (o primeiro onMove em 110,100). */
function arrastando(opcoes) {
  const montado = montar(opcoes);

  ponteiro(montado.janela, "pointermove", 110, 100);
  assert.deepEqual(montado.chamadas, [["start", [1]], ["move", { x: 110, y: 100 }]]);

  return montado;
}

/**
 * Comeca um gesto com a rolagem sozinha ligada numa area falsa. O onMove anota o ponto e as teclas em `movimentos`;
 * `pedidas` conta quantas vezes a area foi lida (so nos quadros).
 */
function rolando({ area = areaFalsa(), comeco = {}, onMove } = {}) {
  const movimentos = [];
  const lida = { pedidas: 0 };
  const montado = montar({
    comeco,
    handlers: {
      autoScroll: () => {
        lida.pedidas += 1;

        return area;
      },
      onMove: onMove ?? ((ponto, teclas) => movimentos.push([ponto, teclas]))
    }
  });

  return { ...montado, area, lida, movimentos };
}

const SEM_TECLAS = { altKey: false, shiftKey: false };

const DO_GESTO = ["blur", "dragstart (captura)", "keydown (captura)", "pointercancel (captura)", "pointermove (captura)", "pointerup (captura)"];
const DO_BLOQUEADOR = ["click (captura)", "pointerdown (captura)"];
/** Cancelado com o botao ainda apertado: o bloqueador espera o botao solto (pointerup, pointercancel ou buttons 0). */
const DO_BOTAO_APERTADO = ["click (captura)", "pointercancel (captura)", "pointerdown (captura)", "pointermove (captura)", "pointerup (captura)"];

test("ponteiro: toque, botão 2, ponteiro que não é o principal e caneta sem pedir não ligam nada; os pointerTypes vêm de cada chamada", () => {
  assert.deepEqual(pointer.FREE_POINTER_MOUSE, ["mouse"]);
  assert.deepEqual(pointer.FREE_POINTER_MOUSE_AND_PEN, ["mouse", "pen"]);

  for (const comeco of [{ pointerType: "touch" }, { button: 2 }, { button: 1 }, { isPrimary: false }, { pointerType: "pen" }]) {
    const { chamadas, dispose, janela } = montar({ comeco });

    assert.equal(janela.ouvintes.length, 0, JSON.stringify(comeco));
    ponteiro(janela, "pointermove", 160, 100);
    dispose();
    assert.deepEqual(chamadas, [], JSON.stringify(comeco));
  }

  // Sem pedir o toque, ele nao entra, nem pedindo mouse e caneta (o teste seguinte pede).
  assert.equal(montar({ comeco: { pointerType: "touch" }, handlers: { pointerTypes: pointer.FREE_POINTER_MOUSE_AND_PEN } }).janela.ouvintes.length, 0);
  // So a caneta: o mouse fica de fora.
  assert.equal(montar({ handlers: { pointerTypes: ["pen"] } }).janela.ouvintes.length, 0);

  // A caneta pedida nesta chamada (o desenho e a ficha do Fundo) arrasta como o mouse.
  const caneta = montar({ comeco: { pointerType: "pen" }, handlers: { pointerTypes: pointer.FREE_POINTER_MOUSE_AND_PEN } });
  assert.deepEqual(caneta.janela.tipos(), DO_GESTO);
  ponteiro(caneta.janela, "pointermove", 100, 120);
  ponteiro(caneta.janela, "pointerup", 100, 120);
  assert.deepEqual(caneta.chamadas, [["start", [1]], ["move", { x: 100, y: 120 }], ["drop", { x: 100, y: 120 }]]);

  // Sem janela (alvo fora de um documento): nada liga e a funcao devolvida nao quebra.
  const solto = new EventTarget();
  solto.ownerDocument = { defaultView: null };
  const nada = pointer.followFreePointer(
    { button: 0, clientX: 0, clientY: 0, currentTarget: solto, isPrimary: true, pointerId: 1, pointerType: "mouse" },
    { onCancel: () => assert.fail("cancel"), onDrop: () => assert.fail("drop"), onMove: () => assert.fail("move"), threshold: 4 }
  );
  assert.equal(typeof nada, "function");
  nada();
});

test("ponteiro: o toque só entra quando a chamada pede (o solto e as alças do desenho); o padrão continua só o mouse", () => {
  assert.deepEqual(pointer.FREE_POINTER_MOUSE_PEN_AND_TOUCH, ["mouse", "pen", "touch"]);
  // As listas de antes nao mudaram: as Camadas e o Elementos (padrao) seguem so com o mouse, a sequencia e o Fundo
  // com mouse e caneta.
  assert.deepEqual(pointer.FREE_POINTER_MOUSE, ["mouse"]);
  assert.deepEqual(pointer.FREE_POINTER_MOUSE_AND_PEN, ["mouse", "pen"]);

  for (const pointerTypes of [undefined, pointer.FREE_POINTER_MOUSE, pointer.FREE_POINTER_MOUSE_AND_PEN]) {
    const { chamadas, janela } = montar({ comeco: { pointerType: "touch" }, handlers: pointerTypes ? { pointerTypes } : {} });

    assert.equal(janela.ouvintes.length, 0, `toque com ${JSON.stringify(pointerTypes ?? "o padrao")}`);
    ponteiro(janela, "pointermove", 160, 100);
    ponteiro(janela, "pointerup", 160, 100);
    assert.deepEqual(chamadas, []);
  }

  // Pedido (o solto e as alcas do desenho): o dedo arrasta como o mouse, com o mesmo limiar, e solta uma vez.
  const dedo = montar({ comeco: { pointerType: "touch" }, handlers: { pointerTypes: pointer.FREE_POINTER_MOUSE_PEN_AND_TOUCH } });
  assert.deepEqual(dedo.janela.tipos(), DO_GESTO);
  ponteiro(dedo.janela, "pointermove", 103, 100);
  assert.deepEqual(dedo.chamadas, [], "antes do limiar, um toque e so um toque");
  // Um segundo dedo (outro pointerId) no meio nao mexe no gesto.
  ponteiro(dedo.janela, "pointermove", 300, 300, { pointerId: 2 });
  ponteiro(dedo.janela, "pointerup", 300, 300, { pointerId: 2 });
  ponteiro(dedo.janela, "pointermove", 100, 110);
  ponteiro(dedo.janela, "pointerup", 100, 112);
  assert.deepEqual(dedo.chamadas, [["start", [1]], ["move", { x: 100, y: 110 }], ["drop", { x: 100, y: 112 }]]);
  assert.deepEqual(dedo.janela.tipos(), DO_BLOQUEADOR, "o bloqueador do click vale para o toque tambem");

  // O mouse e a caneta continuam na mesma lista; o segundo dedo que pousa sozinho (isPrimary false) nao comeca nada.
  for (const pointerType of ["mouse", "pen"]) {
    const outro = montar({ comeco: { pointerType }, handlers: { pointerTypes: pointer.FREE_POINTER_MOUSE_PEN_AND_TOUCH } });

    ponteiro(outro.janela, "pointermove", 110, 100);
    assert.equal(outro.chamadas[0][0], "start", pointerType);
  }

  assert.equal(montar({ comeco: { isPrimary: false, pointerType: "touch" }, handlers: { pointerTypes: pointer.FREE_POINTER_MOUSE_PEN_AND_TOUCH } }).janela.ouvintes.length, 0);
  // So o toque: o mouse fica de fora.
  assert.equal(montar({ handlers: { pointerTypes: ["touch"] } }).janela.ouvintes.length, 0);
});

test("ponteiro: antes do limiar é clique; 3 px e o pointerup não chamam nada, nada é capturado e o click passa", () => {
  const { alvo, chamadas, janela } = montar();

  // Na janela, em captura (o blur sem captura: o de um campo nao sobe ate a janela).
  assert.deepEqual(janela.tipos(), DO_GESTO);
  ponteiro(janela, "pointermove", 103, 100);
  ponteiro(janela, "pointermove", 102, 102);
  // Antes do limiar as teclas seguem o caminho de sempre (o Esc tem teste proprio: ele desliga o gesto).
  assert.equal(tecla(janela, "Delete").defaultPrevented, false);
  assert.equal(tecla(janela, "z", { ctrlKey: true }).defaultPrevented, false);
  assert.equal(janela.ouvintes.length, DO_GESTO.length, "uma tecla antes do limiar nao desliga o gesto");
  ponteiro(janela, "pointerup", 103, 100);
  assert.deepEqual(chamadas, []);
  assert.deepEqual(alvo.capturas, [], "a captura nao vem antes do limiar (o click e o dblclick ficam no alvo de sempre)");
  assert.equal(janela.ouvintes.length, 0, "o pointerup desliga tudo");

  const click = disparar(janela, "click");
  assert.equal(click.defaultPrevented, false);
  assert.equal(click.cancelBubble, false);

  // buttons 0, pointercancel e blur antes do limiar tambem so desligam, sem chamar nada.
  for (const fim of [
    (janela) => ponteiro(janela, "pointermove", 101, 100, { buttons: 0 }),
    (janela) => ponteiro(janela, "pointercancel", 101, 100),
    (janela) => disparar(janela, "blur")
  ]) {
    const outro = montar();

    fim(outro.janela);
    ponteiro(outro.janela, "pointermove", 160, 100);
    assert.deepEqual(outro.chamadas, []);
    assert.equal(outro.janela.ouvintes.length, 0);
    assert.equal(disparar(outro.janela, "click").defaultPrevented, false);
  }
});

test("ponteiro: a partir do limiar o gesto começa (a captura é tentada e falha sem quebrar), outro pointerId é ignorado e o pointerup solta uma vez", () => {
  const { alvo, chamadas, janela } = montar();

  // 2 x 3 px = 3,6 px: ainda e clique. 4 px exatos: comeca.
  ponteiro(janela, "pointermove", 102, 103);
  assert.deepEqual(chamadas, []);
  ponteiro(janela, "pointermove", 104, 100);
  assert.deepEqual(chamadas, [["start", [1]], ["move", { x: 104, y: 100 }]], "setPointerCapture antes de onStart, depois onMove");
  assert.deepEqual(alvo.capturas, [1]);

  // Outro ponteiro nao mexe neste gesto.
  ponteiro(janela, "pointermove", 300, 300, { pointerId: 2 });
  ponteiro(janela, "pointerup", 300, 300, { pointerId: 2 });
  ponteiro(janela, "pointercancel", 300, 300, { pointerId: 2 });
  assert.equal(chamadas.length, 2);

  ponteiro(janela, "pointermove", 140, 130);
  ponteiro(janela, "pointerup", 150, 120);
  ponteiro(janela, "pointerup", 151, 121);
  assert.deepEqual(chamadas.slice(2), [["move", { x: 140, y: 130 }], ["drop", { x: 150, y: 120 }]]);
  assert.equal(alvo.capturas.length, 1, "a captura e tentada uma vez");
  assert.deepEqual(janela.tipos(), DO_BLOQUEADOR, "sobra so o bloqueador do click");

  // A diagonal conta pela distancia: 2,9 x 2,9 px = 4,1 px comeca com o limiar 4.
  const diagonal = montar();
  ponteiro(diagonal.janela, "pointermove", 102.9, 102.9);
  assert.equal(diagonal.chamadas[0][0], "start");
  // O limiar e o de cada chamada (6 px no desenho).
  const desenho = montar({ handlers: { threshold: 6 } });
  ponteiro(desenho.janela, "pointermove", 105, 100);
  assert.deepEqual(desenho.chamadas, []);
  ponteiro(desenho.janela, "pointermove", 106, 100);
  assert.equal(desenho.chamadas[0][0], "start");
});

test("ponteiro: depois do limiar, buttons 0, pointercancel e o blur da janela cancelam uma vez, sem soltar", () => {
  for (const [nome, fim] of [
    ["buttons 0 (botao solto fora da janela)", (janela) => ponteiro(janela, "pointermove", 120, 100, { buttons: 0 })],
    ["pointercancel", (janela) => ponteiro(janela, "pointercancel", 120, 100)],
    ["blur da janela", (janela) => disparar(janela, "blur")]
  ]) {
    const { chamadas, janela } = arrastando();

    fim(janela);
    ponteiro(janela, "pointermove", 130, 100);
    ponteiro(janela, "pointerup", 130, 100);
    disparar(janela, "blur");
    assert.deepEqual(chamadas.slice(2), [["cancel"]], nome);
    assert.equal(tecla(janela, "Delete").defaultPrevented, false, `${nome}: depois do fim, as teclas passam`);
  }
});

test("ponteiro: Esc cancela com defaultPrevented e a propagação parada; o click do botão solto depois é engolido", () => {
  const { chamadas, janela } = arrastando();
  const esc = tecla(janela, "Escape");

  assert.equal(esc.defaultPrevented, true);
  assert.equal(esc.cancelBubble, true, "o Esc nao chega ao editor (que selecionaria a caixa de fora)");
  assert.deepEqual(chamadas.slice(2), [["cancel"]]);

  // Cancelado, as teclas voltam a passar e o ponteiro nao chama mais nada.
  assert.equal(tecla(janela, "Delete").defaultPrevented, false);
  assert.equal(tecla(janela, "Escape").defaultPrevented, false);
  ponteiro(janela, "pointermove", 200, 100);

  // O botao continua apertado: o bloqueador espera o pointerup para contar os 350 ms.
  janela.avancar(2_000);
  assert.deepEqual(janela.tipos(), DO_BOTAO_APERTADO);
  ponteiro(janela, "pointerup", 200, 100, { pointerId: 2 });
  assert.equal(janela.relogios.size, 0, "o pointerup de outro ponteiro nao conta");
  ponteiro(janela, "pointerup", 200, 100);
  assert.deepEqual(chamadas.slice(2), [["cancel"]], "o pointerup depois do Esc nao solta");
  assert.deepEqual(janela.tipos(), DO_BLOQUEADOR);

  const click = disparar(janela, "click");
  assert.equal(click.defaultPrevented, true, "o click do botao solto depois do Esc e engolido (o painel nao acrescenta)");
  assert.equal(click.cancelBubble, true);
  assert.equal(disparar(janela, "click").defaultPrevented, false, "o seguinte passa");
  assert.equal(janela.ouvintes.length, 0);
  assert.equal(janela.relogios.size, 0);
});

test("ponteiro: cancelado com o botão apertado, o bloqueador sai mesmo sem o pointerup (botão solto fora da janela ou em outro app)", () => {
  assert.equal(pointer.FREE_POINTER_BLUR_GUARD_MS, 1_000);

  // Esc e o botao solto fora da janela no WebKit: o pointerup nunca vem, so um pointermove com buttons 0.
  const fora = arrastando();
  tecla(fora.janela, "Escape");
  ponteiro(fora.janela, "pointermove", 130, 100);
  ponteiro(fora.janela, "pointermove", 130, 100, { buttons: 0, pointerId: 2 });
  fora.janela.avancar(2_000);
  assert.deepEqual(fora.janela.tipos(), DO_BOTAO_APERTADO, "com o botao apertado (ou outro ponteiro), continua esperando");
  ponteiro(fora.janela, "pointermove", 130, 100, { buttons: 0 });
  assert.deepEqual(fora.janela.tipos(), DO_BLOQUEADOR, "o botao solto: os 350 ms contam daqui");
  fora.janela.avancar(349);
  assert.equal(disparar(fora.janela, "click").defaultPrevented, true, "o click logo depois ainda e engolido");
  const outro = arrastando();
  tecla(outro.janela, "Escape");
  ponteiro(outro.janela, "pointermove", 130, 100, { buttons: 0 });
  outro.janela.avancar(350);
  assert.equal(outro.janela.ouvintes.length, 0, "nenhum ouvinte sobra");
  assert.equal(outro.janela.relogios.size, 0);
  assert.equal(disparar(outro.janela, "click").defaultPrevented, false, "um Enter num botao do Elementos passa");
  assert.deepEqual(outro.chamadas.slice(2), [["cancel"]]);

  // O blur da janela e o botao solto em outro app: nada mais chega; o bloqueador sai em 1 s.
  const app = arrastando();
  disparar(app.janela, "blur");
  assert.deepEqual(app.chamadas.slice(2), [["cancel"]]);
  app.janela.avancar(999);
  assert.deepEqual(app.janela.tipos(), DO_BOTAO_APERTADO);
  app.janela.avancar(1);
  assert.equal(app.janela.ouvintes.length, 0, "nenhum ouvinte sobra");
  assert.equal(app.janela.relogios.size, 0);
  assert.equal(disparar(app.janela, "click").defaultPrevented, false);

  // Depois do blur, o botao solto de volta na janela: os 350 ms contam do pointerup (um relogio so).
  const volta = arrastando();
  disparar(volta.janela, "blur");
  volta.janela.avancar(900);
  ponteiro(volta.janela, "pointerup", 130, 100);
  assert.deepEqual(volta.janela.tipos(), DO_BLOQUEADOR);
  assert.equal(volta.janela.relogios.size, 1);
  volta.janela.avancar(349);
  assert.equal(disparar(volta.janela, "click").defaultPrevented, true, "o click do botao solto e engolido");
  assert.equal(volta.janela.ouvintes.length, 0);
  assert.equal(volta.janela.relogios.size, 0);
});

test("ponteiro: Esc antes do limiar desliga o gesto e segue para o editor; o arrastar não começa mais", () => {
  const { alvo, chamadas, janela } = montar();

  ponteiro(janela, "pointermove", 102, 100);
  const esc = tecla(janela, "Escape");

  assert.equal(esc.defaultPrevented, false, "o Esc continua indo ao editor");
  assert.equal(esc.cancelBubble, false);
  assert.equal(janela.ouvintes.length, 0, "nenhum ouvinte sobra");

  // A produtora apertou Esc: andar 20 px e soltar nao move nada.
  ponteiro(janela, "pointermove", 120, 100);
  ponteiro(janela, "pointermove", 140, 100);
  ponteiro(janela, "pointerup", 140, 100);
  assert.deepEqual(chamadas, []);
  assert.deepEqual(alvo.capturas, [], "nada e capturado");
  assert.equal(janela.relogios.size, 0);
  // Nao houve gesto: nenhum bloqueador, as teclas e o click seguem o caminho de sempre.
  assert.equal(tecla(janela, "Delete").defaultPrevented, false);
  assert.equal(disparar(janela, "click").defaultPrevented, false);
});

test("ponteiro: durante o gesto as teclas são engolidas (Ctrl + Z, Delete, colar), menos Shift, Alt, Control e Meta", () => {
  const { chamadas, janela } = arrastando();

  for (const [key, campos] of [["z", { ctrlKey: true }], ["Z", { ctrlKey: true, shiftKey: true }], ["Delete", {}], ["v", { metaKey: true }], ["Tab", {}], ["ArrowUp", { altKey: true }]]) {
    const event = tecla(janela, key, campos);

    assert.equal(event.defaultPrevented, true, key);
    assert.equal(event.cancelBubble, true, key);
  }

  for (const key of ["Shift", "Alt", "Control", "Meta"]) {
    const event = tecla(janela, key);

    assert.equal(event.defaultPrevented, false, key);
    assert.equal(event.cancelBubble, false, key);
  }

  assert.deepEqual(chamadas.slice(2), [], "engolir nao cancela");
  ponteiro(janela, "pointerup", 120, 110);
  assert.deepEqual(chamadas.slice(2), [["drop", { x: 120, y: 110 }]]);
  assert.equal(tecla(janela, "Delete").defaultPrevented, false, "depois de soltar, as teclas passam");
});

test("ponteiro: o lostpointercapture não chama nada e o gesto segue até o pointerup", () => {
  const { alvo, chamadas, janela } = arrastando();

  alvo.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: 1 }));
  disparar(janela, "lostpointercapture", { pointerId: 1 });
  assert.deepEqual(chamadas.slice(2), []);
  ponteiro(janela, "pointermove", 130, 100);
  ponteiro(janela, "pointerup", 135, 100);
  assert.deepEqual(chamadas.slice(2), [["move", { x: 130, y: 100 }], ["drop", { x: 135, y: 100 }]]);
});

test("ponteiro: depois de soltar, o primeiro click é engolido e o seguinte passa; um pointerdown também tira o bloqueador; sozinho ele sai em 350 ms", () => {
  assert.equal(pointer.FREE_POINTER_CLICK_GUARD_MS, 350);

  // O primeiro click.
  const primeiro = arrastando();
  ponteiro(primeiro.janela, "pointerup", 120, 100);
  const engolido = disparar(primeiro.janela, "click");
  assert.equal(engolido.defaultPrevented, true);
  assert.equal(engolido.cancelBubble, true);
  assert.equal(disparar(primeiro.janela, "click").defaultPrevented, false);
  assert.equal(primeiro.janela.ouvintes.length, 0);
  assert.equal(primeiro.janela.relogios.size, 0, "o relogio sai junto");

  // O proximo pointerdown (o comeco do proximo gesto ou clique) nao e engolido e tira o bloqueador.
  const proximo = arrastando();
  ponteiro(proximo.janela, "pointerup", 120, 100);
  const down = disparar(proximo.janela, "pointerdown", { button: 0, pointerId: 1 });
  assert.equal(down.defaultPrevented, false);
  assert.equal(down.cancelBubble, false);
  assert.equal(disparar(proximo.janela, "click").defaultPrevented, false);
  assert.equal(proximo.janela.ouvintes.length, 0);
  assert.equal(proximo.janela.relogios.size, 0);

  // Sem click (soltou fora de um botao), o bloqueador sai sozinho em 350 ms.
  const sozinho = arrastando();
  ponteiro(sozinho.janela, "pointerup", 120, 100);
  sozinho.janela.avancar(349);
  assert.deepEqual(sozinho.janela.tipos(), DO_BLOQUEADOR);
  sozinho.janela.avancar(1);
  assert.equal(sozinho.janela.ouvintes.length, 0);
  assert.equal(disparar(sozinho.janela, "click").defaultPrevented, false);

  // Cancelado com o botao ja solto (pointercancel, buttons 0): os 350 ms contam na hora.
  const cancelado = arrastando();
  ponteiro(cancelado.janela, "pointercancel", 120, 100);
  assert.deepEqual(cancelado.janela.tipos(), DO_BLOQUEADOR);
  cancelado.janela.avancar(350);
  assert.equal(cancelado.janela.ouvintes.length, 0);
});

test("ponteiro: o arrastar nativo do navegador (dragstart) não começa enquanto o gesto é seguido", () => {
  const { janela } = montar();

  assert.equal(disparar(janela, "dragstart").defaultPrevented, true, "antes do limiar");
  ponteiro(janela, "pointermove", 110, 100);
  assert.equal(disparar(janela, "dragstart").defaultPrevented, true, "depois do limiar");
  ponteiro(janela, "pointerup", 110, 100);
  assert.equal(disparar(janela, "dragstart").defaultPrevented, false, "depois de soltar");
});

test("ponteiro: a função devolvida desliga o gesto sem chamar handler; o bloqueador do click já ligado fica e sai sozinho", () => {
  // Antes do limiar.
  const antes = montar();
  antes.dispose();
  ponteiro(antes.janela, "pointermove", 160, 100);
  ponteiro(antes.janela, "pointerup", 160, 100);
  assert.deepEqual(antes.chamadas, []);
  assert.equal(antes.janela.ouvintes.length, 0);

  // No meio do gesto: nem onCancel, nem onDrop, e o click seguinte passa.
  const meio = arrastando();
  meio.dispose();
  tecla(meio.janela, "Escape");
  ponteiro(meio.janela, "pointerup", 160, 100);
  assert.deepEqual(meio.chamadas.slice(2), []);
  assert.equal(meio.janela.ouvintes.length, 0);
  assert.equal(disparar(meio.janela, "click").defaultPrevented, false);

  // Chamada dentro do onDrop (o soltar desmonta quem guardou a funcao, e o React roda as limpezas antes de o
  // navegador mandar o click): o click do botao solto continua engolido, e o painel nao acrescenta de novo.
  let noSoltar = null;
  const desmonta = montar({
    handlers: {
      onDrop: (ponto) => {
        desmonta.chamadas.push(["drop", ponto]);
        noSoltar();
      }
    }
  });
  noSoltar = desmonta.dispose;
  ponteiro(desmonta.janela, "pointermove", 110, 100);
  ponteiro(desmonta.janela, "pointerup", 110, 100);
  assert.deepEqual(desmonta.chamadas.at(-1), ["drop", { x: 110, y: 100 }]);
  const click = disparar(desmonta.janela, "click");
  assert.equal(click.defaultPrevented, true, "o click do botao solto e engolido mesmo com a funcao chamada");
  assert.equal(click.cancelBubble, true);
  assert.equal(disparar(desmonta.janela, "click").defaultPrevented, false, "o seguinte passa");
  assert.equal(desmonta.janela.ouvintes.length, 0);
  assert.equal(desmonta.janela.relogios.size, 0);

  // Com o bloqueador ligado (depois de soltar): ele fica e sai sozinho em 350 ms.
  const depois = arrastando();
  ponteiro(depois.janela, "pointerup", 120, 100);
  depois.dispose();
  assert.deepEqual(depois.janela.tipos(), DO_BLOQUEADOR);
  depois.janela.avancar(350);
  assert.equal(depois.janela.ouvintes.length, 0);
  assert.equal(depois.janela.relogios.size, 0);

  // Depois do Esc, com o botao apertado: a funcao (chamada duas vezes) nao mexe, e o botao solto conta os 350 ms.
  const esc = arrastando();
  tecla(esc.janela, "Escape");
  esc.dispose();
  esc.dispose();
  assert.deepEqual(esc.janela.tipos(), DO_BOTAO_APERTADO);
  ponteiro(esc.janela, "pointerup", 120, 100);
  assert.equal(disparar(esc.janela, "click").defaultPrevented, true, "o click do botao solto depois do Esc e engolido");
  assert.equal(esc.janela.ouvintes.length, 0);
  assert.equal(esc.janela.relogios.size, 0);
  assert.deepEqual(esc.chamadas.slice(2), [["cancel"]]);
});

test("ponteiro: o onMove recebe o Alt e o Shift de cada pointermove (sem guias e a proporção nas alças)", () => {
  const movimentos = [];
  const { chamadas, janela } = montar({ handlers: { onMove: (ponto, teclas) => movimentos.push([ponto, teclas]) } });

  // Antes do limiar nada e chamado, com tecla ou sem.
  ponteiro(janela, "pointermove", 102, 100, { altKey: true });
  assert.deepEqual(movimentos, []);

  ponteiro(janela, "pointermove", 110, 100, { altKey: true, shiftKey: false });
  ponteiro(janela, "pointermove", 120, 100, { altKey: false, shiftKey: true });
  ponteiro(janela, "pointermove", 130, 100, { altKey: true, shiftKey: true });
  // Sem os campos (um evento sem teclas): as duas falsas, sempre booleanas.
  ponteiro(janela, "pointermove", 140, 100);
  assert.deepEqual(movimentos, [
    [{ x: 110, y: 100 }, { altKey: true, shiftKey: false }],
    [{ x: 120, y: 100 }, { altKey: false, shiftKey: true }],
    [{ x: 130, y: 100 }, { altKey: true, shiftKey: true }],
    [{ x: 140, y: 100 }, SEM_TECLAS]
  ]);

  // O onDrop continua so com o ponto; o Shift e o Alt sozinhos passam (nao sao engolidos) durante o gesto.
  assert.equal(tecla(janela, "Shift", { shiftKey: true }).defaultPrevented, false);
  ponteiro(janela, "pointerup", 150, 100, { shiftKey: true });
  assert.deepEqual(chamadas, [["start", [1]], ["drop", { x: 150, y: 100 }]]);
});

test("freeAutoScrollStep: só com o ponto dentro da área e a até 32 px da borda, de 1 a 20 px por quadro; fora da área e no meio, nada", () => {
  assert.equal(pointer.FREE_AUTO_SCROLL_EDGE_PX, 32);
  assert.equal(pointer.FREE_AUTO_SCROLL_MAX_PX, 20);

  const area = { bottom: 300, left: 0, right: 400, top: 0 };
  const passo = (x, y, opcoes) => pointer.freeAutoScrollStep(area, { x, y }, opcoes);

  // No meio e no fim exato da faixa (32 px da borda): nada, sem -0.
  assert.deepEqual(passo(200, 150), { dx: 0, dy: 0 });
  assert.deepEqual(passo(32, 150), { dx: 0, dy: 0 });
  assert.deepEqual(passo(368, 268), { dx: 0, dy: 0 });

  // Colado em cada borda: o teto de 20, para fora (esquerda e cima negativos).
  assert.deepEqual(passo(0, 150), { dx: -20, dy: 0 });
  assert.deepEqual(passo(400, 150), { dx: 20, dy: 0 });
  assert.deepEqual(passo(200, 0), { dx: 0, dy: -20 });
  assert.deepEqual(passo(200, 300), { dx: 0, dy: 20 });
  // No canto, os dois eixos.
  assert.deepEqual(passo(0, 0), { dx: -20, dy: -20 });
  assert.deepEqual(passo(395, 296), { dx: 17, dy: 18 });

  // A velocidade cresce de 1 (no fim da faixa) a 20 (na borda), inteira e sem pular para tras.
  assert.deepEqual(passo(16, 150), { dx: -10, dy: 0 });
  assert.deepEqual(passo(31, 150), { dx: -1, dy: 0 });
  assert.deepEqual(passo(31.9, 150), { dx: -1, dy: 0 }, "dentro da faixa e sempre pelo menos 1");
  let antes = Infinity;

  for (let distancia = 0; distancia < 32; distancia += 0.5) {
    const velocidade = -passo(distancia, 150).dx;

    assert.ok(Number.isInteger(velocidade) && velocidade >= 1 && velocidade <= 20, `${distancia}: ${velocidade}`);
    assert.ok(velocidade <= antes, `${distancia}: nao cresce para dentro`);
    antes = velocidade;
  }

  // Fora da area: nada, mesmo na altura da faixa de outra borda.
  for (const [x, y] of [[-1, 150], [401, 150], [200, -1], [200, 301], [-5, -5], [-1, 5], [405, 295], [Number.NaN, 150], [200, Number.NaN]]) {
    assert.deepEqual(passo(x, y), { dx: 0, dy: 0 }, `${x},${y}`);
  }

  // As opcoes: outra faixa e outro teto; zero desliga.
  assert.deepEqual(passo(0, 150, { edge: 10, max: 5 }), { dx: -5, dy: 0 });
  assert.deepEqual(passo(5, 150, { edge: 10, max: 5 }), { dx: -3, dy: 0 });
  assert.deepEqual(passo(10, 150, { edge: 10, max: 5 }), { dx: 0, dy: 0 });
  assert.deepEqual(passo(0, 150, { max: 0 }), { dx: 0, dy: 0 });
  assert.deepEqual(passo(0, 150, { edge: 0 }), { dx: 0, dy: 0 });

  // Area mais estreita que duas faixas: os dois lados se descontam (no meio, nada; perto de um lado, para ele).
  const estreita = { bottom: 300, left: 0, right: 40, top: 0 };
  assert.deepEqual(pointer.freeAutoScrollStep(estreita, { x: 20, y: 150 }), { dx: 0, dy: 0 });
  assert.deepEqual(pointer.freeAutoScrollStep(estreita, { x: 10, y: 150 }), { dx: -13, dy: 0 });

  // Um DOMRect (com width, height, x e y a mais) serve.
  assert.deepEqual(pointer.freeAutoScrollStep({ ...area, height: 300, width: 400, x: 0, y: 0 }, { x: 0, y: 150 }), { dx: -20, dy: 0 });
});

test("ponteiro: a rolagem sozinha só liga depois do limiar; rola e refaz o onMove com o último ponto e as últimas teclas só quando a área rolou", () => {
  const { area, chamadas, janela, lida, movimentos } = rolando();

  // Antes do limiar: nenhum quadro pedido e a area nem e lida.
  ponteiro(janela, "pointermove", 102, 100);
  assert.equal(janela.quadros.size, 0);
  assert.equal(lida.pedidas, 0);

  // O limiar: um quadro pedido (um so laco).
  ponteiro(janela, "pointermove", 110, 100);
  assert.equal(janela.quadros.size, 1);
  assert.deepEqual(movimentos, [[{ x: 110, y: 100 }, SEM_TECLAS]]);
  ponteiro(janela, "pointermove", 112, 100);
  assert.equal(janela.quadros.size, 1, "um pointermove nao pede outro laco");

  // Dentro da area e fora da faixa: arma, sem rolar; o laco segue.
  janela.quadro();
  assert.equal(lida.pedidas, 1);
  assert.deepEqual(area.rolagens, []);
  assert.equal(janela.quadros.size, 1);

  // Na faixa da esquerda (10 px da borda), com Shift: cada quadro rola 14 px e refaz o onMove com o mesmo ponto.
  ponteiro(janela, "pointermove", 60, 100, { shiftKey: true });
  movimentos.length = 0;
  janela.quadro();
  janela.quadro();
  assert.deepEqual(area.rolagens, [[-14, 0], [-14, 0]], "scrollBy com numeros, sem suavizar");
  assert.equal(area.scrollLeft, 72);
  assert.deepEqual(movimentos, [
    [{ x: 60, y: 100 }, { altKey: false, shiftKey: true }],
    [{ x: 60, y: 100 }, { altKey: false, shiftKey: true }]
  ]);

  // Parado no meio: nada rola e nenhum onMove a cada quadro.
  ponteiro(janela, "pointermove", 250, 200);
  movimentos.length = 0;
  janela.quadro();
  janela.quadro();
  assert.equal(area.rolagens.length, 2);
  assert.deepEqual(movimentos, []);

  // Colado na borda com a area quase no comeco: rola o que falta (um onMove) e, no fim da rolagem, nada mais chama.
  area.scrollLeft = 5;
  ponteiro(janela, "pointermove", 50, 200);
  movimentos.length = 0;
  janela.quadro();
  assert.equal(area.scrollLeft, 0);
  assert.deepEqual(movimentos, [[{ x: 50, y: 200 }, SEM_TECLAS]]);
  janela.quadro();
  janela.quadro();
  assert.deepEqual(area.rolagens.slice(2), [[-20, 0], [-20, 0], [-20, 0]], "tenta rolar");
  assert.equal(movimentos.length, 1, "sem rolar de fato, nenhum onMove");

  // Na faixa de baixo (8 px da borda): para baixo, no outro eixo.
  ponteiro(janela, "pointermove", 250, 342);
  janela.quadro();
  assert.deepEqual(area.rolagens.at(-1), [0, 15]);
  assert.equal(area.scrollTop, 115);

  ponteiro(janela, "pointerup", 250, 342);
  assert.deepEqual(chamadas, [["start", [1]], ["drop", { x: 250, y: 342 }]]);
  assert.equal(janela.quadros.size, 0, "soltar para o laco");

  // Sem area (autoScroll devolve null): o laco segue sem rolar nem quebrar.
  const semArea = montar({ handlers: { autoScroll: () => null } });
  ponteiro(semArea.janela, "pointermove", 110, 100);
  semArea.janela.quadro();
  semArea.janela.quadro();
  assert.equal(semArea.janela.quadros.size, 1);
  assert.deepEqual(semArea.chamadas, [["start", [1]], ["move", { x: 110, y: 100 }]]);

  // Sem a opcao: nenhum quadro (as Camadas, o Fundo e o Elementos do L4a nao mudam).
  const semOpcao = arrastando();
  assert.equal(semOpcao.janela.quadros.size, 0);
});

test("ponteiro: a rolagem sozinha só se arma depois de o ponto estar dentro da área e fora da faixa uma vez no gesto (C10)", () => {
  // Pegar uma linha que ja esta na faixa (a primeira das Camadas, 10 px da borda de cima): nao rola.
  const linha = rolando({ comeco: { clientX: 200, clientY: 60 } });
  ponteiro(linha.janela, "pointermove", 200, 65);
  assert.equal(linha.janela.quadros.size, 1);
  linha.janela.quadro();
  linha.janela.quadro();
  ponteiro(linha.janela, "pointermove", 200, 52);
  linha.janela.quadro();
  assert.deepEqual(linha.area.rolagens, [], "comecar dentro da faixa nao rola");
  // Saiu da faixa para o meio e voltou: rola.
  ponteiro(linha.janela, "pointermove", 200, 150);
  linha.janela.quadro();
  assert.deepEqual(linha.area.rolagens, []);
  ponteiro(linha.janela, "pointermove", 200, 60);
  linha.janela.quadro();
  assert.deepEqual(linha.area.rolagens, [[0, -14]]);

  // Vindo de fora (o painel Elementos a esquerda da area de desenho), entrando pela faixa: nao rola.
  const painel = rolando({ comeco: { clientX: 20, clientY: 200 } });
  ponteiro(painel.janela, "pointermove", 30, 200);
  painel.janela.quadro();
  ponteiro(painel.janela, "pointermove", 55, 200);
  painel.janela.quadro();
  painel.janela.quadro();
  assert.deepEqual(painel.area.rolagens, [], "entrar pela faixa nao rola");
  assert.equal(painel.area.scrollLeft, 100);
  // Dentro e fora da faixa uma vez: armada; dai em diante vale ate o fim do gesto, mesmo saindo da area e voltando.
  ponteiro(painel.janela, "pointermove", 120, 200);
  painel.janela.quadro();
  ponteiro(painel.janela, "pointermove", 55, 200);
  painel.janela.quadro();
  assert.deepEqual(painel.area.rolagens, [[-17, 0]]);
  ponteiro(painel.janela, "pointermove", 20, 200);
  painel.janela.quadro();
  assert.equal(painel.area.rolagens.length, 1, "fora da area, nada");
  ponteiro(painel.janela, "pointermove", 55, 200);
  painel.janela.quadro();
  assert.deepEqual(painel.area.rolagens, [[-17, 0], [-17, 0]], "de volta a faixa, rola sem precisar passar pelo meio de novo");
  ponteiro(painel.janela, "pointerup", 55, 200);

  // Cada gesto comeca desarmado.
  const deNovo = rolando({ area: painel.area, comeco: { clientX: 55, clientY: 200 } });
  ponteiro(deNovo.janela, "pointermove", 55, 210);
  deNovo.janela.quadro();
  deNovo.janela.quadro();
  assert.equal(painel.area.rolagens.length, 2, "o gesto novo nao herda a arma do anterior");
});

test("ponteiro: o laço da rolagem para no pointerup, no pointercancel, no Esc, no blur, com o botão solto fora da janela e na função devolvida", () => {
  for (const [nome, fim] of [
    ["pointerup", (montado) => ponteiro(montado.janela, "pointerup", 60, 100)],
    ["pointercancel", (montado) => ponteiro(montado.janela, "pointercancel", 60, 100)],
    ["Esc", (montado) => tecla(montado.janela, "Escape")],
    ["blur da janela", (montado) => disparar(montado.janela, "blur")],
    ["buttons 0", (montado) => ponteiro(montado.janela, "pointermove", 60, 100, { buttons: 0 })],
    ["funcao devolvida", (montado) => montado.dispose()]
  ]) {
    const montado = rolando();

    ponteiro(montado.janela, "pointermove", 110, 100);
    montado.janela.quadro();
    // Na faixa: o proximo quadro rolaria.
    ponteiro(montado.janela, "pointermove", 60, 100);
    assert.equal(montado.janela.quadros.size, 1, nome);
    fim(montado);
    assert.equal(montado.janela.quadros.size, 0, `${nome}: o quadro pedido sai`);
    montado.janela.quadro();
    assert.deepEqual(montado.area.rolagens, [], `${nome}: nada rola depois`);
    assert.equal(montado.movimentos.length, 2, `${nome}: nenhum onMove depois`);
  }

  // O onMove da rolagem que desliga o gesto (quem chamou desmontou): nenhum quadro novo.
  let desligar = null;
  const desmonta = rolando({
    onMove: () => {
      if (desmonta.area.rolagens.length > 0) {
        desligar();
      }
    }
  });
  desligar = desmonta.dispose;
  ponteiro(desmonta.janela, "pointermove", 110, 100);
  desmonta.janela.quadro();
  ponteiro(desmonta.janela, "pointermove", 60, 100);
  desmonta.janela.quadro();
  assert.equal(desmonta.area.rolagens.length, 1);
  assert.equal(desmonta.janela.quadros.size, 0);
  assert.equal(desmonta.janela.ouvintes.length, 0);
});

test("free-pointer-drag.ts carrega no Node sem janela, não toca na janela ao carregar e não monta HTML nem CSS em texto", () => {
  // A regra de tests/popup-livre-editor-modelo.test.mjs (spec §6) vale para o ajudante.
  const source = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-pointer-drag.ts", import.meta.url), "utf8");

  assert.equal(typeof pointer.followFreePointer, "function");
  assert.equal(/dangerouslySetInnerHTML|\.innerHTML|cssText|<style[\s>]|style="/.test(source), false);
  // A janela vem do alvo (ownerDocument.defaultView); nada de window, document ou globalThis direto.
  assert.match(source, /ownerDocument\?\.defaultView/);
  assert.equal(/\b(?:window|document|globalThis|self)\s*[.?[]/.test(source), false);
  assert.equal(/^import\s/m.test(source), false, "sem imports: carrega sozinho no Node");
  // L4b: o quadro da rolagem sozinha vem da janela do gesto e e desligado nela; a rolagem nunca suaviza.
  assert.match(source, /win\.requestAnimationFrame\(/);
  assert.match(source, /win\.cancelAnimationFrame\(/);
  assert.equal(/behavior\s*:\s*["']smooth/.test(source), false);
});
