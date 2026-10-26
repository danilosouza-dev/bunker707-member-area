import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import "./support/transpile-tsx.mjs";

// Desenho do editor Livre no L4b (docs/27 §13.10; docs/18 §1.1), pacote P8 (free-canvas.tsx):
// - o pointerdown do cartao, puro (freeCanvasPress e freeCanvasClickSelect): Shift, Ctrl ou ⌘ poe ou tira e nunca
//   arrasta; o solto de um grupo arrasta o grupo e o clique sem arrastar deixa so ele; o Alt (C2) arrasta o de CIMA
//   sem guias e so o clique sem arrastar anda na pilha, a partir do principal de ANTES do pointerdown (revisao da
//   base: com o de depois o ciclo nao anda); Alt + Shift poe o de baixo na selecao;
// - o desenho de verdade (react-dom/server): com varios, um contorno por item, a caixa tracejada do grupo e a
//   etiqueta "3 elementos" de 12 px, sem alcas nem barrinha; com um, tudo como antes; o zoom em passos e o "100" de
//   antes; a moldura que nao corta;
// - guardas de fonte: o solto e as alcas pelo followFreePointer (mouse, caneta e toque, decisao 5; a sequencia so
//   mouse e caneta), autoScroll, o cartao sem os ouvintes que gravavam, um ponteiro por vez, a roda nao passiva, o
//   zoom barrado no arrastar, a ancora so nos pedidos de zoom (C12), dragDispose (C13), o stopPropagation das alcas
//   antes de qualquer tecla (C14), elementsFromPoint so no ramo do Alt, 12 px e nada de HTML em texto;
// - desde o L65, o clique fora da prancheta: a area de desenho le o pointerdown na captura e o click desmarca pela
//   regra pura da selecao (freeOutsidePress e freeOutsideClickClears, testadas em popup-livre-selecao-modelo).

const canvasUrl = new URL("../src/components/admin/v2/communication/popup-free/free-canvas.tsx", import.meta.url);
const source = readFileSync(canvasUrl, "utf8");
const canvas = await import("../src/components/admin/v2/communication/popup-free/free-canvas.tsx");
const geometry = await import("../src/components/admin/v2/communication/popup-free/free-editor-geometry.ts");
const selection = await import("../src/components/admin/v2/communication/popup-free/free-editor-selection.ts");
const model = await import("../src/server/communications/popup-free-model.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const { freeCanvasClickSelect, freeCanvasPress, FreeCanvas } = canvas;

const forma = (id, x, y, w = 100, h = 40, extra = {}) => ({ id, type: "shape", ...extra, place: { h, mode: "free", w, x, y, ...extra.place } });
const TITLE = { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" };

function design(children) {
  const value = model.canonicalPopupFreeDesign({ children, mode: "free", version: 1 });

  assert.equal(schema.popupFreeDesignSchema.safeParse(value).success, true, "design valido");

  return value;
}

// Dois soltos que andam (a, b), um travado (trava), um girado (giro), um Título na sequencia e os Links.
const DESIGN = design([
  forma("a", 10, 20),
  forma("b", 200, 120, 80, 60),
  forma("trava", 40, 300, 60, 60, { locked: true }),
  forma("giro", 300, 300, 100, 20, { place: { rotate: 90 } }),
  TITLE,
  { id: "links", type: "links" }
]);
const NO_KEYS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
const press = (input) => freeCanvasPress({ ...NO_KEYS, design: DESIGN, principal: null, selection: [], ...input });

/* ------------------------------------------------------------------------------------------------
 * O pointerdown e o clique (puros)
 * ---------------------------------------------------------------------------------------------- */

test("Shift, Ctrl ou ⌘ + pointerdown põe ou tira e nunca arrasta; no vazio, nada muda", () => {
  for (const keys of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    assert.deepEqual(press({ ...keys, id: "a", principal: "b", selection: ["b"] }), { click: null, drag: null, select: { id: "a", mode: "toggle" } });
    assert.deepEqual(press({ ...keys, id: null, principal: "b", selection: ["b"] }), { click: null, drag: null, select: null }, "no vazio a seleção fica");
  }

  // Sem tecla: só ele e o arrastar dele; no vazio, nada escolhido (como antes do L4b).
  assert.deepEqual(press({ id: "a" }), { click: null, drag: { id: "a" }, select: { id: "a", mode: "only" } });
  assert.deepEqual(press({ id: "titulo", principal: "a", selection: ["a"] }), { click: null, drag: { id: "titulo" }, select: { id: "titulo", mode: "only" } });
  assert.deepEqual(press({ id: null, principal: "a", selection: ["a"] }), { click: null, drag: null, select: { id: null, mode: "only" } });
});

test("sem tecla, num solto de um grupo, a seleção fica e o grupo arrasta junto; o clique sem arrastar deixa só ele", () => {
  const grupo = press({ id: "b", principal: "b", selection: ["a", "b"] });

  assert.deepEqual(grupo, { click: { id: "b", kind: "only" }, drag: { id: "b", ids: ["a", "b"] }, select: null });
  assert.deepEqual(freeCanvasClickSelect(grupo.click, []), { id: "b" }, "o clique sem arrastar deixa só ele (sem how: só ele)");

  // Os que andam são os de selection.freeMovableIds: o travado e o da sequência ficam de fora do grupo.
  assert.deepEqual(press({ id: "a", principal: "titulo", selection: ["a", "b", "trava", "titulo"] }).drag, { id: "a", ids: ["a", "b"] });

  // Com um só que anda (o outro travado ou na sequência), é o arrastar de um: só ele.
  for (const outro of ["trava", "titulo"]) {
    assert.deepEqual(press({ id: "a", principal: outro, selection: ["a", outro] }), { click: null, drag: { id: "a" }, select: { id: "a", mode: "only" } }, outro);
  }

  // Um elemento fora da seleção (ou o da sequência dentro dela) fica só ele, como sempre.
  assert.deepEqual(press({ id: "titulo", principal: "b", selection: ["a", "b", "titulo"] }), { click: null, drag: { id: "titulo" }, select: { id: "titulo", mode: "only" } });
  assert.deepEqual(press({ id: "giro", principal: "b", selection: ["a", "b"] }), { click: null, drag: { id: "giro" }, select: { id: "giro", mode: "only" } });
});

test("Alt + pointerdown (C2): leva o de cima e arrasta sem guias; só o clique sem arrastar anda na pilha", () => {
  // O de cima no ponto e "b"; o principal de antes e o Título.
  const alt = press({ altKey: true, id: "b", principal: "titulo", selection: ["titulo"] });

  assert.deepEqual(alt, { click: { before: "titulo", kind: "stack", toggle: false }, drag: { id: "b" }, select: { id: "b", mode: "only" } });

  // O arrastar e o de "b", o de cima: perto da borda esquerda da prancheta a guia gruda sem o Alt e some com ele.
  const session = geometry.startFreeDrag({
    hadHeight: true,
    id: "b",
    mode: "move",
    origin: { x: 0, y: 0 },
    rect: { h: 60, w: 80, x: 200, y: 120 },
    scale: 1,
    targets: geometry.freeSnapTargets({ h: 400, w: 440 }, [])
  });
  const semAlt = geometry.updateFreeDrag(session, { x: -198, y: 7 }, { altKey: false });
  const comAlt = geometry.updateFreeDrag(session, { x: -198, y: 7 }, { altKey: true });

  assert.ok(semAlt.last.guides.length > 0, "sem o Alt, a guia");
  assert.equal(semAlt.last.rect.x, 0, "e a borda gruda");
  assert.deepEqual(comAlt.last.guides, [], "com o Alt, sem guias");
  assert.equal(comAlt.last.rect.x, 2, "e o elemento fica onde o ponteiro deixou");

  // Sem arrastar, o clique escolhe o de baixo do de cima, com a posição para a frase.
  assert.deepEqual(freeCanvasClickSelect(alt.click, ["b", "a"]), { how: { mode: "only", stack: { index: 2, total: 2 } }, id: "a" });
  assert.equal(selection.FREE_SELECTION_COPY.stack("Forma", 2, 2), "Selecionado: Forma (2 de 2 neste ponto).");

  // Alt num solto de um grupo: o grupo arrasta (sem guias pelo Alt) e o clique sem arrastar anda na pilha.
  assert.deepEqual(press({ altKey: true, id: "b", principal: "b", selection: ["a", "b"] }), {
    click: { before: "b", kind: "stack", toggle: false },
    drag: { id: "b", ids: ["a", "b"] },
    select: null
  });
});

test("o ciclo do Alt + clique anda a partir do principal de ANTES do pointerdown (revisão da base)", () => {
  // Duas Formas empilhadas no mesmo ponto: "b" por cima de "a". Cada Alt + clique e um pointerdown (que escolhe o de
  // cima) e um clique (que anda na pilha a partir do principal de antes do pointerdown).
  const pilha = ["b", "a"];
  let principal = null;
  const vistos = [];

  for (let vez = 0; vez < 4; vez += 1) {
    const plano = press({ altKey: true, id: "b", principal, selection: principal ? [principal] : [] });

    assert.deepEqual(plano.select, { id: "b", mode: "only" }, "o pointerdown escolhe o de cima");
    principal = "b";

    const escolhido = freeCanvasClickSelect(plano.click, pilha);

    vistos.push(`${escolhido.id} ${escolhido.how.stack.index} de ${escolhido.how.stack.total}`);
    principal = escolhido.id;
  }

  assert.deepEqual(vistos, ["a 2 de 2", "b 1 de 2", "a 2 de 2", "b 1 de 2"], "o primeiro pega o de baixo e o segundo volta ao de cima");

  // Com o principal de DEPOIS do pointerdown (sempre o de cima), o ciclo nunca sairia do segundo.
  assert.equal(selection.freeNextInStack(["c", "b", "a"], "c").id, "b");
  assert.equal(selection.freeNextInStack(["c", "b", "a"], "c").id, "b");

  // Com tres na pilha, a partir do de antes: b, depois a, depois volta ao c.
  let antes = "c";
  const tres = [];

  for (let vez = 0; vez < 3; vez += 1) {
    const escolhido = freeCanvasClickSelect({ before: antes, kind: "stack", toggle: false }, ["c", "b", "a"]);

    tres.push(escolhido.id);
    antes = escolhido.id;
  }

  assert.deepEqual(tres, ["b", "a", "c"]);
});

test("Alt + Shift (ou Ctrl, ou ⌘) + clique põe o de baixo na seleção, sem nada no pointerdown", () => {
  for (const keys of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    const plano = press({ ...keys, altKey: true, id: "b", principal: "titulo", selection: ["titulo"] });

    assert.deepEqual(plano, { click: { before: "titulo", kind: "stack", toggle: true }, drag: null, select: null });
    assert.deepEqual(freeCanvasClickSelect(plano.click, ["b", "a"]), { how: { mode: "toggle", stack: { index: 2, total: 2 } }, id: "a" });
  }

  // Pilha vazia (o ponto so tinha o fundo ou o X): nada.
  assert.equal(freeCanvasClickSelect({ before: null, kind: "stack", toggle: false }, []), null);
  // Fora da pilha, o de baixo do de cima; com um so, ele.
  assert.deepEqual(freeCanvasClickSelect({ before: "titulo", kind: "stack", toggle: false }, ["a"]), { how: { mode: "only", stack: { index: 1, total: 1 } }, id: "a" });
});

/* ------------------------------------------------------------------------------------------------
 * O desenho de verdade (react-dom/server)
 * ---------------------------------------------------------------------------------------------- */

const RECTS = {
  "@artboard": { h: 400, w: 440, x: 0, y: 0 },
  a: { h: 40, w: 100, x: 10, y: 20 },
  b: { h: 60, w: 80, x: 200, y: 120 },
  giro: { h: 20, w: 100, x: 300, y: 300 },
  titulo: { h: 30, w: 392, x: 24, y: 200 },
  trava: { h: 60, w: 60, x: 40, y: 300 }
};

function popupOf(freeDesign) {
  return { audio: null, body: "", canSnooze: true, cta: null, fonts: [], freeDesign, id: "p1", image: null, title: "Pop-up" };
}

function draw(props = {}) {
  return renderToStaticMarkup(
    createElement(FreeCanvas, {
      description: "Selecionado",
      design: DESIGN,
      device: "desktop",
      disabled: false,
      fonts: [],
      onCommitRect: () => {},
      onEditText: () => {},
      onRectsChange: () => {},
      onSelect: () => {},
      onToolbar: () => {},
      popup: popupOf(DESIGN),
      rects: RECTS,
      selectedId: null,
      stageRef: { current: null },
      toolbarDisabled: {},
      zoom: "100",
      ...props
    })
  );
}

/** O style do primeiro elemento com o atributo (ou o atributo = valor). */
function styleOf(markup, attribute) {
  const tag = new RegExp(`<[a-z]+[^>]*${attribute}[^>]*>`).exec(markup)?.[0] ?? "";

  assert.ok(tag, `${attribute} desenhado`);

  return /style="([^"]*)"/.exec(tag)?.[1] ?? "";
}

test("com vários, um contorno por item, a caixa tracejada do grupo e a etiqueta '3 elementos' de 12 px, sem alças nem barrinha", () => {
  const html = draw({ selectedId: "titulo", selectedIds: ["a", "giro", "titulo"] });

  assert.equal(html.match(/data-free-selection-item="/g)?.length, 3, "um contorno por escolhido");
  assert.match(styleOf(html, 'data-free-selection-item="a"'), /height:40px;left:10px;top:20px;width:100px;outline:2px solid var\(--focus-ring\)/, "o solto pelo design");
  assert.match(styleOf(html, 'data-free-selection-item="giro"'), /transform:rotate\(90deg\)/, "o girado com o giro");
  assert.match(styleOf(html, 'data-free-selection-item="titulo"'), /height:30px;left:24px;top:200px;width:392px/, "o da sequência pela medida");

  // A caixa do grupo envolve o que se ve: o girado de 100 x 20 em 90 graus ocupa 20 x 100 em volta do mesmo centro.
  assert.match(styleOf(html, "data-free-selection-group="), /height:340px;left:10px;top:20px;width:406px;outline:1px dashed var\(--focus-ring\);outline-offset:4px/);
  assert.match(html, /text-\[12px\][^"]*" data-free-selection-group-tag="">3 elementos</, "a etiqueta de 12 px com quantos");
  assert.equal(/data-free-selection="/.test(html), false, "sem o contorno de um elemento só");
  assert.equal(/data-free-handle=/.test(html), false, "sem alças");
  assert.equal(/role="toolbar"/.test(html), false, "sem a barrinha");

  // Um escolhido sem medida (escondido neste aparelho) fica sem contorno, mas conta na etiqueta.
  const escondido = draw({ rects: { ...RECTS, giro: undefined }, selectedId: "a", selectedIds: ["giro", "titulo", "a"] });

  assert.equal(escondido.match(/data-free-selection-item="/g)?.length, 2);
  assert.match(escondido, />3 elementos</);

  // Ids que nao existem mais saem da conta: sobrando um, e o desenho de um elemento so.
  const sobrou = draw({ selectedId: "a", selectedIds: ["sumiu", "a"] });

  assert.match(sobrou, /data-free-selection="a"/);
  assert.equal(/data-free-selection-item=/.test(sobrou), false);
});

test("com um elemento o desenho fica como antes: data-free-selection, as 8 alças do solto, o nome e a barrinha da sequência", () => {
  for (const props of [{ selectedId: "a" }, { selectedId: "a", selectedIds: ["a"] }]) {
    const html = draw(props);

    assert.match(html, /data-free-selection="a"/);
    assert.equal(html.match(/data-free-handle="/g)?.length, 8, "as alças");
    assert.match(html, /text-\[12px\] leading-\[18px\] font-medium text-\[#0f0f10\]">Forma</, "o nome");
    assert.equal(/data-free-selection-item=|data-free-selection-group=/.test(html), false);
  }

  const sequencia = draw({ onMoveInFlow: () => {}, selectedId: "titulo" });

  assert.match(sequencia, /data-free-selection="titulo"/);
  assert.match(sequencia, /role="toolbar"/, "a barrinha da sequência");
  assert.equal(/data-free-handle=/.test(sequencia), false);

  // Travado: o contorno sem alças.
  assert.equal(/data-free-handle=/.test(draw({ selectedId: "trava" })), false);
});

test("o zoom em passos aceita o '100' de antes, os passos e o Ajustar à tela; a moldura não corta a esquerda do palco", () => {
  const scaleOf = (html) => Number(/data-free-stage=""[^>]*transform:scale\(([\d.]+)\)/.exec(html)?.[1]);

  assert.equal(scaleOf(draw({ zoom: "100" })), 1, "o '100' da barra de antes vale 100 %");
  assert.equal(scaleOf(draw({ zoom: 100 })), 1);
  assert.equal(scaleOf(draw({ zoom: 150 })), 1.5);
  assert.equal(scaleOf(draw({ zoom: 50 })), 0.5);
  // Sem medir a area (no servidor ela tem 0 px), o Ajustar a tela fica no piso de 25 %.
  assert.equal(scaleOf(draw({ zoom: "fit" })), 0.25);

  // O palco escalado ocupa a largura do palco vezes a escala (Computador: 600 px para a prancheta de 440 px).
  assert.match(draw({ zoom: 200 }), /class="relative shrink-0" style="height:1200px;width:1200px"/);
  assert.match(draw({ zoom: 150 }), /<div class="flex min-h-full w-max min-w-full items-start justify-center p-6">/);
});

/* ------------------------------------------------------------------------------------------------
 * Guardas de fonte
 * ---------------------------------------------------------------------------------------------- */

/** O corpo de uma funcao do componente (da assinatura, com o recuo dela, ate a chave que fecha no mesmo recuo). */
function bodyOf(signature) {
  const start = source.indexOf(signature);

  assert.ok(start >= 0, signature);

  const indent = /^ */.exec(signature)[0];
  const end = source.indexOf(`\n${indent}}`, start);

  return source.slice(start, end + indent.length + 2);
}

test("o solto e as alças pelo followFreePointer: mouse, caneta e toque, 3 px e autoScroll; a sequência só mouse e caneta", () => {
  const begin = bodyOf("  function beginDrag(");

  assert.match(begin, /followFreePointer\(event, \{/);
  assert.match(begin, /pointerTypes: FREE_POINTER_MOUSE_PEN_AND_TOUCH,/, "decisao 5: o dedo continua arrastando o solto e as alcas");
  assert.match(begin, /threshold: FREE_DRAG_START_PX/);
  assert.match(begin, /autoScroll: \(\) => viewportRef\.current,/);
  assert.match(begin, /onStart: \(\) => startDrag\(/, "a sessao nasce no onStart");
  assert.match(begin, /onCancel: \(\) => endDrag\(false\)/, "Esc, pointercancel e blur nao gravam");
  assert.match(begin, /onMove: moveDrag,/, "o onMove leva o Alt e o Shift");
  assert.equal(/setSession|setPointerCapture/.test(begin), false, "nada de sessao nem captura no pointerdown");
  assert.match(begin, /if \(sessionRef\.current \|\| flowRef\.current \|\| !event\.isPrimary\) \{\s*return;/, "um ponteiro por vez");

  const flow = bodyOf("  function beginFlowDrag(");

  assert.match(flow, /pointerTypes: FREE_POINTER_MOUSE_AND_PEN,/);
  assert.match(flow, /autoScroll: \(\) => viewportRef\.current,/);
  assert.equal(/FREE_POINTER_MOUSE_PEN_AND_TOUCH/.test(flow), false, "a sequencia continua sem o toque");

  // O arrastar soma a rolagem da area e o ouvinte de scroll vale para o solto e para a sequencia.
  assert.match(bodyOf("  const moveDrag = useCallback("), /freeScrolledPointer\(client, scrollStart, \{ x: view\.scrollLeft, y: view\.scrollTop \}\)/);
  assert.match(source, /if \(\(!flowDragging && !soloDragging\) \|\| !view\) \{/);

  // O cartao nao tem mais os ouvintes que gravavam (o lostpointercapture gravava um lugar que ninguem escolheu).
  const card = /<div\s+className=\{cn\("relative mx-auto w-fit touch-none select-none"[\s\S]*?ref=\{wrapRef\}/.exec(source)?.[0] ?? "";

  assert.ok(card, "o cartao");
  assert.equal(/onLostPointerCapture|onPointerUp|onPointerCancel/.test(source), false);
  assert.match(card, /onClick=\{onClick\}/);
  assert.match(card, /onContextMenu=\{\(event\) => \{[\s\S]*?if \(event\.ctrlKey\) \{\s*event\.preventDefault\(\);/, "no Mac, o menu do Ctrl + clique nao abre");
});

test("o pointerdown: a 1ª linha igual, um ponteiro por vez na seguinte e o principal de ANTES para o Alt", () => {
  const down = bodyOf("  function onPointerDown(");

  assert.match(
    down,
    /^ {2}function onPointerDown\(event: ReactPointerEvent<HTMLDivElement>\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(event\.button !== 0 \|\| flowRef\.current\) \{\s*return;\s*\}\s*(?:\/\/[^\n]*\n\s*)*if \(sessionRef\.current\) \{\s*return;\s*\}\s*(?:\/\/[^\n]*\n\s*)*if \(!event\.isPrimary\) \{\s*return;\s*\}/
  );
  // freeCanvasPress recebe o principal de antes (selectedId da renderizacao do pointerdown) antes de qualquer onSelect.
  assert.ok(down.indexOf("principal: selectedId,") < down.indexOf("onSelect("), "o principal e lido antes de escolher");
  assert.match(down, /clickRef\.current = press\.click \? \{ origin: \{ x: event\.clientX, y: event\.clientY \}, plan: press\.click \} : null;/);
  assert.equal(/elementsFromPoint|freeStackAt|freeNextInStack/.test(down), false, "o pointerdown nunca le a pilha (C2)");

  // O clique so le a pilha no ramo do Alt, e so sem ter passado do limiar.
  const click = bodyOf("  function onClick(");

  assert.match(click, /if \(Math\.hypot\(event\.clientX - pending\.origin\.x, event\.clientY - pending\.origin\.y\) >= FREE_DRAG_START_PX\) \{\s*return;/);
  assert.match(click, /const stack = pending\.plan\.kind === "stack" \? freeStackAt\(wrap, \{ x: event\.clientX, y: event\.clientY \}\) : \[\];/);
  assert.equal(source.match(/\.elementsFromPoint\(/g)?.length, 1, "elementsFromPoint chamado num lugar so");
  assert.match(bodyOf("function freeStackAt("), /wrap\.ownerDocument\.elementsFromPoint\(client\.x, client\.y\)/);
  assert.equal(source.match(/freeStackAt\(/g)?.length, 2, "a definicao e a chamada do clique");

  // Passou do limiar: o clique que vier nao escolhe nada (o solto e a sequencia).
  assert.match(bodyOf("  function startDrag("), /clickRef\.current = null;/);
  assert.match(bodyOf("  const startFlow = useCallback("), /clickRef\.current = null;/);

  // O duplo clique com Alt, Shift, Ctrl ou ⌘ nao abre o texto.
  assert.match(bodyOf("  function onDoubleClick("), /if \(event\.altKey \|\| event\.shiftKey \|\| event\.ctrlKey \|\| event\.metaKey\) \{\s*return;/);
});

test("o clique fora da prancheta (L65): a área lê o pointerdown na captura e o click desmarca pela regra pura da seleção", () => {
  // A area de desenho (a da rolagem) tem os dois ouvintes; o cartao continua com os dele (o vazio da prancheta).
  const view = /<div\s+className="relative min-h-0 min-w-0 flex-1 overflow-auto[^"]*"[\s\S]*?ref=\{viewportRef\}\s*>/.exec(source)?.[0] ?? "";

  assert.ok(view, "a area de desenho");
  assert.match(view, /data-free-zone="canvas"/);
  assert.match(view, /onClick=\{onViewportClick\}/);
  assert.match(view, /onPointerDownCapture=\{onViewportPointerDown\}/, "na captura: as alcas e a barrinha param o pointerdown no cartao");
  assert.equal(source.match(/onPointerDownCapture=/g)?.length, 1);

  // O pointerdown: fora do cartao, sem gesto em andamento e fora da barra de rolagem (as contas na regra pura).
  const down = bodyOf("  function onViewportPointerDown(");

  assert.match(down, /outsideRef\.current = freeOutsidePress\(\{/);
  assert.match(down, /busy: Boolean\(sessionRef\.current \|\| flowRef\.current\),/, "no meio de um arrastar, nada");
  assert.match(down, /inCard: !view\.contains\(target\) \|\| Boolean\(target\.closest\("\[data-free-canvas-card\]"\)\),/, "o cartao tem as regras dele");
  assert.match(down, /onScrollbar: event\.clientX - box\.left - view\.clientLeft >= view\.clientWidth \|\| event\.clientY - box\.top - view\.clientTop >= view\.clientHeight,/);
  assert.match(down, /button: event\.button,[\s\S]*isPrimary: event\.isPrimary,/);
  assert.equal(/onSelect\(|preventDefault|stopPropagation/.test(down), false, "o pointerdown nao escolhe nem barra nada");
  // O Alt nao conta (L65): so Shift, Ctrl e ⌘ vao para a regra; o clique fora com Alt desmarca como sem tecla.
  assert.equal(/altKey/.test(down), false, "o Alt fica fora do pointerdown guardado");
  assert.match(down, /ctrlKey: event\.ctrlKey,[\s\S]*metaKey: event\.metaKey,[\s\S]*shiftKey: event\.shiftKey,/);

  // O click: le e limpa o pointerdown guardado, e so desmarca pela regra (algo escolhido, limiar e teclas), com a acao
  // do vazio. Sem nada escolhido, o onSelect(null) nao vem (ele trocaria o Revisar aberto pelo painel Pop-up).
  const click = bodyOf("  function onViewportClick(");

  assert.match(click, /const press = outsideRef\.current;\s*outsideRef\.current = null;/);
  assert.match(click, /if \(freeOutsideClickClears\(press, \{ x: event\.clientX, y: event\.clientY \}, liveIds\.length\)\) \{\s*onSelect\(null\);\s*\}/);
  assert.equal(click.match(/onSelect\(/g)?.length, 1, "um onSelect so, dentro da regra");
  assert.equal(source.match(/outsideRef\.current = /g)?.length, 2, "so o pointerdown guarda e so o click limpa");

  // O vazio da prancheta continua desmarcando pelo pointerdown do cartao (a mesma acao).
  assert.deepEqual(press({ id: null }).select, { id: null, mode: "only" });
});

test("as alças param o pointerdown antes de qualquer regra de tecla (C14) e o gesto é desligado ao recomeçar e ao desmontar (C13)", () => {
  const handle = /data-free-handle=\{handle\}[\s\S]*?onPointerDown=\{\(event\) => \{([\s\S]*?)\n {16}\}\}/.exec(source)?.[1] ?? "";

  assert.ok(handle, "o pointerdown da alca");
  assert.ok(handle.indexOf("event.stopPropagation();") >= 0 && handle.indexOf("event.stopPropagation();") < handle.indexOf("beginDrag("));
  assert.equal(/shiftKey|ctrlKey|metaKey|altKey/.test(handle), false, "nenhuma tecla na alca: o Shift e a proporcao, no onMove");

  const begin = bodyOf("  function beginDrag(");

  assert.ok(begin.indexOf("dragDispose.current?.();") >= 0 && begin.indexOf("dragDispose.current?.();") < begin.indexOf("followFreePointer("), "o gesto de antes sai antes do novo");
  assert.match(begin, /dragDispose\.current = followFreePointer\(event, \{/);
  assert.match(source, /useEffect\(\s*\(\) => \(\) => \{\s*flowDispose\.current\?\.\(\);\s*dragDispose\.current\?\.\(\);/, "ao desmontar, os dois gestos");
});

test("o zoom: a roda não passiva só com Ctrl ou ⌘, nada no meio de um arrastar e a âncora só nos pedidos de zoom (C12)", () => {
  assert.match(source, /const ZOOM_WHEEL: AddEventListenerOptions = \{ passive: false \};/);
  assert.match(source, /view\.addEventListener\("wheel", onWheel, ZOOM_WHEEL\);/);
  assert.match(source, /return \(\) => view\.removeEventListener\("wheel", onWheel, ZOOM_WHEEL\);/);

  const wheel = /const onWheel = \(event: WheelEvent\) => \{[\s\S]*?\n {4}\};/.exec(source)?.[0] ?? "";

  assert.match(wheel, /if \(!event\.ctrlKey && !event\.metaKey\) \{\s*return;\s*\}\s*event\.preventDefault\(\);/, "so com Ctrl ou ⌘, e nunca o zoom da pagina");
  assert.match(wheel, /if \(sessionRef\.current \|\| flowRef\.current\) \{/, "no meio de um arrastar, nada");
  assert.match(wheel, /const wheel = \{ deltaMode: event\.deltaMode, deltaY: event\.deltaY \};/, "deltaMode lido antes de deltaY");
  assert.match(wheel, /zoomBy\(step\.direction, \{ x: event\.clientX, y: event\.clientY \}\)/, "no ponto do ponteiro");

  for (const name of ["zoomBy", "zoomTo"]) {
    assert.match(bodyOf(`  const ${name} = useCallback(`), /^[^\n]*\n[^\n]*=> \{\s*(?:\/\/[^\n]*\n\s*)*if \(sessionRef\.current \|\| flowRef\.current \|\| !onZoomChangeRef\.current\) \{\s*return false;/, name);
  }

  // A ancora so e guardada no changeZoom, que so zoomBy e zoomTo chamam; o efeito da escala aplica e limpa.
  assert.equal(source.match(/zoomAnchor\.current = \{/g)?.length, 1);
  assert.match(bodyOf("  const changeZoom = useCallback("), /zoomAnchor\.current = \{/);
  assert.equal(source.match(/changeZoom\(/g)?.length, 2, "so zoomBy e zoomTo chamam");
  assert.match(bodyOf("  const zoomBy = useCallback("), /changeZoom\(next, anchor \?\? null\);/);
  assert.match(bodyOf("  const zoomTo = useCallback("), /changeZoom\(next, null\);/);
  assert.match(source, /const anchor = zoomAnchor\.current;[\s\S]{0,200}zoomAnchor\.current = null;\s*if \(!anchor \|\| !view \|\| !stage \|\| Math\.abs\(anchor\.to - scale\) > 1e-6\) \{\s*return;[\s\S]*?\}, \[scale, stageRef\]\);/);

  // A escala do palco pelos passos (o "100" de antes vale 100 %) e a mostrada para a barra.
  assert.match(source, /const scale = freeZoomScale\(zoom, fitScale\);/);
  assert.match(source, /useEffect\(\(\) => \{\s*onScaleChangeRef\.current\?\.\(scale\);\s*\}, \[scale\]\);/);
});

test("a api ganha zoomBy, zoomTo, reveal e viewport depois de visibleCenter", () => {
  const api = /apiRef\.current = \{[\s\S]*?\n {4}\};/.exec(source)?.[0] ?? "";
  const after = api.slice(api.indexOf("visibleCenter:"));

  assert.match(after, /\n {6}zoomBy,\n {6}zoomTo,\n {6}reveal,\n {6}viewport: \(\) => viewportRef\.current\n/);
  assert.match(source, /export type FreeCanvasApi = \{[\s\S]*?visibleCenter: [^\n]*\n[\s\S]*?zoomBy: \(direction: 1 \| -1, anchor\?: FreePoint\) => FreeZoomStep \| false;[\s\S]*?zoomTo: \(zoom: FreeZoom\) => boolean;[\s\S]*?reveal: \(ids: readonly FreeId\[\]\) => void;[\s\S]*?viewport: \(\) => HTMLElement \| null;/);
  assert.match(bodyOf("  const reveal = useCallback("), /freeRevealScroll\(/);
  assert.equal(/scrollIntoView/.test(source), false, "a conta e da propria area, sem rolar quem esta fora");

  // C6: as props novas sao opcionais (com padrao: sem a lista, so o principal). O "100" da barra de antes saiu do tipo
  // do zoom quando a casca passou a mandar os passos (P12); freeZoomScale ainda o aceita.
  for (const prop of ["onCommitMoves", "onScaleChange", "onZoomChange", "selectedIds"]) {
    assert.match(source, new RegExp(`\\n  ${prop}\\?: `), prop);
  }

  assert.match(source, /\n {2}zoom: FreeZoom;/);
  assert.match(source, /\n {2}onSelect: \(id: FreeId \| null, how\?: FreeCanvasSelectHow\) => void;/);
});

test("o desenho com vários tem a etiqueta de 12 px e nada abaixo disso; nada de HTML ou CSS em texto", () => {
  assert.match(source, /data-free-selection-item=\{item\.id\}/);
  assert.match(source, /data-free-selection-group=""/);
  assert.match(source, /text-\[12px\] leading-\[18px\] font-medium text-\[#0f0f10\]" data-free-selection-group-tag="">\s*\{FREE_SELECTION_COPY\.groupTag\(liveIds\.length\)\}/);
  assert.match(source, /transform: `scale\(\$\{layoutPerScreen\}\)`, transformOrigin: "bottom left" \}\}\s*>\s*<span className="rounded-sm bg-\[var\(--focus-ring\)\] px-1\.5 text-\[12px\][^"]*" data-free-selection-group-tag/, "a etiqueta em scale(1/zoom): 12 px de tela em qualquer zoom");
  assert.match(source, /<div className="flex min-h-full w-max min-w-full items-start justify-center p-6">/);
  assert.equal(/text-\[(?:[1-9]|1[01])px\]|text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]|text-\[(?:[1-9]|1[01])(?:\.\d+)?px\]/.test(source), false, "nenhum texto abaixo de 12 px");
  assert.equal(/dangerouslySetInnerHTML|\.innerHTML|cssText|<style[\s>]|style="/.test(source), false);
});
