import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Editor Livre do pop-up, L4b (docs/27 §13.10; docs/18 §1.1), pacote de geometria pura: a caixa que se ve de um
// girado, a caixa de varios, alinhar numa moldura qualquer (com o alinhar no pop-up de hoje igual), os espacos iguais,
// o limite comum de um grupo que anda junto, o arrastar de varios (guias pela caixa do grupo, sem guias com Alt ou
// com girado, o deslocamento inteiro no fim), o zoom em passos, a roda com Ctrl, o ponto que fica sob o ponteiro, o
// ponteiro com a rolagem somada e o menor rolar que mostra o escolhido. Tudo carregado direto pelo Node.

const geometry = await import("../src/components/admin/v2/communication/popup-free/free-editor-geometry.ts");
const model = await import("../src/server/communications/popup-free-model.ts");

const L = model.FREE_DESIGN_LIMITS;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} esperado ${expected}, veio ${actual}`);
}

function nearRect(actual, expected, message) {
  for (const key of ["h", "w", "x", "y"]) {
    near(actual[key], expected[key], `${message ?? ""} ${key}:`);
  }
}

function center(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/* ------------------------------------------------------------------------------------------------
 * A caixa que se ve, a caixa de varios e alinhar
 * ---------------------------------------------------------------------------------------------- */

test("a caixa que se vê de um girado: sem giro é o próprio retângulo, 90° troca largura e altura no mesmo centro", () => {
  const selo = { h: 20, w: 100, x: 40, y: 60 };

  // Sem giro, volta inteira ou sem valor: o mesmo objeto (nada para medir de novo).
  assert.equal(geometry.freeVisualRect(selo), selo);
  assert.equal(geometry.freeVisualRect(selo, 0), selo);
  assert.equal(geometry.freeVisualRect(selo, 360), selo);
  assert.equal(geometry.freeVisualRect(selo, -720), selo);
  assert.equal(geometry.freeVisualRect(selo, Number.NaN), selo);

  // 90° e -90° (270°): troca w e h, sem sobra de conta, com o mesmo centro.
  const turned = geometry.freeVisualRect(selo, 90);
  assert.deepEqual(turned, { h: 100, w: 20, x: 80, y: 20 });
  assert.deepEqual(center(turned), center(selo));
  assert.deepEqual(geometry.freeVisualRect(selo, -90), turned);
  assert.deepEqual(geometry.freeVisualRect(selo, 270), turned);

  // 180°: a mesma caixa.
  assert.deepEqual(geometry.freeVisualRect(selo, 180), selo);

  // 45°: W = H = (w + h) · cos 45°, mesmo centro, sem arredondar.
  const diagonal = geometry.freeVisualRect(selo, 45);
  const side = (100 + 20) * Math.SQRT1_2;
  nearRect(diagonal, { h: side, w: side, x: 90 - side / 2, y: 70 - side / 2 }, "45°");
  assert.notEqual(Math.round(diagonal.w), diagonal.w, "nao arredonda");

  // 30°: W = w·cos + h·sin, H = w·sin + h·cos.
  const thirty = geometry.freeVisualRect({ h: 40, w: 200, x: 0, y: 0 }, -30);
  near(thirty.w, 200 * Math.cos(Math.PI / 6) + 40 * 0.5, "30° W:");
  near(thirty.h, 200 * 0.5 + 40 * Math.cos(Math.PI / 6), "30° H:");
  near(center(thirty).x, 100);
  near(center(thirty).y, 20);
});

test("a caixa de vários envolve todos; vazia dá null e um só dá ele mesmo", () => {
  assert.equal(geometry.freeBoundsOf([]), null);

  const one = { h: 10, w: 20, x: 5, y: 6 };
  assert.equal(geometry.freeBoundsOf([one]), one);

  assert.deepEqual(
    geometry.freeBoundsOf([
      { h: 10, w: 20, x: 5, y: 6 },
      { h: 50, w: 10, x: -30, y: 40 },
      { h: 5, w: 100, x: 60, y: 0 }
    ]),
    { h: 90, w: 190, x: -30, y: 0 }
  );
});

test("alinhar numa moldura: os 6 lados na prancheta e numa caixa qualquer, um eixo só", () => {
  const rect = { h: 40, w: 100, x: 33, y: 47 };
  const artboard = { h: 300, w: 440, x: 0, y: 0 };

  assert.deepEqual(geometry.freeAlignDelta(rect, "left", artboard), { dx: -33, dy: 0 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "center", artboard), { dx: 137, dy: 0 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "right", artboard), { dx: 307, dy: 0 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "top", artboard), { dx: 0, dy: -47 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "middle", artboard), { dx: 0, dy: 83 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "bottom", artboard), { dx: 0, dy: 213 });

  // Numa caixa qualquer (a caixa de varios no "Alinhar entre si"): pela borda e pelo centro dela.
  const frame = { h: 120, w: 200, x: 100, y: 50 };
  assert.deepEqual(geometry.freeAlignDelta(rect, "left", frame), { dx: 67, dy: 0 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "center", frame), { dx: 117, dy: 0 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "right", frame), { dx: 167, dy: 0 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "top", frame), { dx: 0, dy: 3 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "middle", frame), { dx: 0, dy: 43 });
  assert.deepEqual(geometry.freeAlignDelta(rect, "bottom", frame), { dx: 0, dy: 83 });

  // Ja alinhado: 0, nunca -0.
  assert.deepEqual(geometry.freeAlignDelta({ h: 40, w: 100, x: 0, y: 0 }, "left", artboard), { dx: 0, dy: 0 });
  assert.ok(Object.is(geometry.freeAlignDelta({ h: 40, w: 100, x: 0, y: 0 }, "top", artboard).dy, 0));
});

test("o alinhar no pop-up de um elemento continua dando o mesmo X ou Y de antes", () => {
  // As contas do alinhar de antes do L4b, escritas aqui para comparar numero por numero (inclusive com fracoes).
  const before = {
    bottom: (rect, board) => ({ y: board.h - rect.h }),
    center: (rect, board) => ({ x: (board.w - rect.w) / 2 }),
    left: () => ({ x: 0 }),
    middle: (rect, board) => ({ y: (board.h - rect.h) / 2 }),
    right: (rect, board) => ({ x: board.w - rect.w }),
    top: () => ({ y: 0 })
  };
  const cases = [
    [{ h: 10, w: 20, x: 5, y: 5 }, { h: 100, w: 200 }],
    [{ h: 33.3, w: 101.7, x: 12.1, y: -4.9 }, { h: 287.6, w: 440 }],
    [{ h: 600, w: 900, x: -20, y: 10 }, { h: 300, w: 440 }]
  ];

  for (const [rect, board] of cases) {
    for (const edge of Object.keys(before)) {
      assert.deepEqual(geometry.alignFreeRect(rect, edge, board), before[edge](rect, board), `${edge} ${JSON.stringify(rect)}`);
    }
  }

  assert.deepEqual(geometry.alignFreeRect({ h: 10, w: 20, x: 5, y: 5 }, "middle", { h: 100, w: 200 }), { y: 45 });
});

/* ------------------------------------------------------------------------------------------------
 * Espacos iguais e o limite do grupo
 * ---------------------------------------------------------------------------------------------- */

/** Os espacos entre vizinhos (na ordem do eixo) depois de aplicar os deslocamentos. */
function gapsAfter(rects, deltas, axis) {
  const start = axis === "x" ? "x" : "y";
  const size = axis === "x" ? "w" : "h";
  const moved = rects.map((rect, index) => ({ ...rect, [start]: rect[start] + deltas[index] }));
  const sorted = [...moved].sort((a, b) => a[start] + a[size] / 2 - (b[start] + b[size] / 2));

  return sorted.slice(1).map((rect, index) => rect[start] - (sorted[index][start] + sorted[index][size]));
}

test("espaços iguais na horizontal com 3 larguras diferentes: as pontas ficam paradas e o do meio vai ao lugar", () => {
  // Pontas em 0 (w 40) e 260 (w 40); o do meio (w 60) em 50: espaco = (300 - 0 - 140) / 2 = 80, alvo 120.
  const rects = [
    { h: 40, w: 40, x: 0, y: 10 },
    { h: 40, w: 60, x: 50, y: 10 },
    { h: 40, w: 40, x: 260, y: 10 }
  ];
  const deltas = geometry.freeDistributeDeltas(rects, "x");

  assert.deepEqual(deltas, [0, 70, 0]);
  assert.deepEqual(gapsAfter(rects, deltas, "x"), [80, 80]);
});

test("espaços iguais com 5 larguras diferentes: devolve na ordem recebida, espaços com até 1 px de diferença", () => {
  // Recebidos fora da ordem do eixo (a das Camadas): o resultado volta na ordem recebida.
  const rects = [
    { h: 10, w: 37, x: 300, y: 0 },
    { h: 10, w: 20, x: 0, y: 0 },
    { h: 10, w: 13, x: 410, y: 0 },
    { h: 10, w: 51, x: 90, y: 0 },
    { h: 10, w: 29, x: 120, y: 0 }
  ];
  const deltas = geometry.freeDistributeDeltas(rects, "x");

  assert.equal(deltas.length, 5);
  assert.equal(deltas[1], 0, "o primeiro do eixo fica parado");
  assert.equal(deltas[2], 0, "o ultimo do eixo fica parado");
  assert.ok(deltas.every((delta) => Number.isInteger(delta)), "deslocamentos inteiros");

  const gaps = gapsAfter(rects, deltas, "x");
  assert.equal(gaps.length, 4);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `espacos ${gaps.join(", ")}`);
  // Espaco exato = (423 - 0 - 150) / 4 = 68,25.
  assert.ok(gaps.every((gap) => Math.abs(gap - 68.25) <= 1));
});

test("espaços iguais na vertical: mesmo jeito pelo Y e pela altura", () => {
  const rects = [
    { h: 30, w: 10, x: 0, y: 0 },
    { h: 10, w: 10, x: 0, y: 200 },
    { h: 50, w: 10, x: 0, y: 35 }
  ];
  // Ordem pelo meio: 0 (meio 15), 2 (meio 60), 1 (meio 205). Espaco = (210 - 0 - 90) / 2 = 60; alvo do 2: 90.
  assert.deepEqual(geometry.freeDistributeDeltas(rects, "y"), [0, 0, 55]);
  assert.deepEqual(geometry.freeDistributeDeltas(rects, "x"), [0, 0, 0], "todos no mesmo X: nada anda");
});

test("espaços iguais: no empate pelo meio vale a ordem recebida; sobrepostos dão espaço negativo; menos de 3 dão zeros", () => {
  // Dois com o mesmo meio (50) e larguras diferentes: o recebido antes fica antes na conta.
  const narrow = { h: 10, w: 20, x: 40, y: 0 };
  const wide = { h: 10, w: 40, x: 30, y: 0 };
  const tie = [{ h: 10, w: 20, x: 0, y: 0 }, narrow, wide, { h: 10, w: 20, x: 200, y: 0 }];
  // Espaco = (220 - 0 - 100) / 3 = 40: o estreito vai a 60 e o largo a 120.
  assert.deepEqual(geometry.freeDistributeDeltas(tie, "x"), [0, 20, 90, 0]);
  // Recebidos ao contrario: o largo vai a 60 e o estreito a 140.
  const swapped = [tie[0], wide, narrow, tie[3]];
  assert.deepEqual(geometry.freeDistributeDeltas(swapped, "x"), [0, 30, 100, 0], "a ordem recebida decide o empate");
  assert.deepEqual(gapsAfter(swapped, [0, 30, 100, 0], "x"), [40, 40, 40]);

  // Sobrepostos: (100 - 0 - 180) / 2 = -40 (o do meio anda para ficar sobreposto igual aos dois vizinhos).
  const overlap = [
    { h: 10, w: 60, x: 0, y: 0 },
    { h: 10, w: 60, x: 10, y: 0 },
    { h: 10, w: 60, x: 40, y: 0 }
  ];
  const deltas = geometry.freeDistributeDeltas(overlap, "x");
  assert.deepEqual(deltas, [0, 10, 0]);
  assert.deepEqual(gapsAfter(overlap, deltas, "x"), [-40, -40]);

  assert.deepEqual(geometry.freeDistributeDeltas([], "x"), []);
  assert.deepEqual(geometry.freeDistributeDeltas([{ h: 1, w: 1, x: 9, y: 9 }], "y"), [0]);
  assert.deepEqual(geometry.freeDistributeDeltas([{ h: 1, w: 1, x: 9, y: 9 }, { h: 1, w: 1, x: 90, y: 9 }], "x"), [0, 0]);
});

test("mover vários juntos: o limite comum segura o grupo inteiro nas quatro bordas, sem deformar", () => {
  const places = [
    { x: 10, y: 100 },
    { x: 300, y: 50 },
    { x: 1400, y: 2390 }
  ];

  // Para a direita: quem esta em 1.400 so anda 40 (x max 1.440); os outros andam o mesmo.
  assert.deepEqual(geometry.freeGroupDelta(places, 500, 0), { dx: L.x.max - 1400, dy: 0 });
  // Para a esquerda: quem esta em 10 so anda ate -720.
  assert.deepEqual(geometry.freeGroupDelta(places, -5000, 0), { dx: L.x.min - 10, dy: 0 });
  // Para baixo: quem esta em 2.390 so anda 10 (y max 2.400).
  assert.deepEqual(geometry.freeGroupDelta(places, 0, 30), { dx: 0, dy: L.y.max - 2390 });
  // Para cima: quem esta em 50 so anda ate -400.
  assert.deepEqual(geometry.freeGroupDelta(places, 0, -1000), { dx: 0, dy: L.y.min - 50 });

  // Dentro do limite: o deslocamento inteiro, igual para todos (a distancia entre eles nao muda).
  assert.deepEqual(geometry.freeGroupDelta(places, 12.4, -7.6), { dx: 12, dy: -8 });
  // Lista vazia e deslocamento nulo: zeros (nunca -0).
  assert.deepEqual(geometry.freeGroupDelta([], 30, 30), { dx: 0, dy: 0 });
  const still = geometry.freeGroupDelta(places, -0.2, 0);
  assert.ok(Object.is(still.dx, 0), "sem -0");
  assert.deepEqual(geometry.freeGroupDelta(places, Number.NaN, 3), { dx: 0, dy: 3 });

  // Ja na borda: nao anda para fora, anda para dentro.
  const atEdge = [{ x: L.x.max, y: 0 }, { x: 0, y: 0 }];
  assert.deepEqual(geometry.freeGroupDelta(atEdge, 5, 0), { dx: 0, dy: 0 });
  assert.deepEqual(geometry.freeGroupDelta(atEdge, -5, 0), { dx: -5, dy: 0 });
});

/* ------------------------------------------------------------------------------------------------
 * Arrastar de varios e o de um elemento (que nao muda)
 * ---------------------------------------------------------------------------------------------- */

const ARTBOARD = { h: 400, w: 440 };

test("arrastar vários: a prévia leva os ids, as guias valem para a caixa do grupo e o fim é inteiro", () => {
  // Grupo de duas Formas: caixa de 30..170 em X e 100..160 em Y. Um outro solto em x 200 serve de guia.
  const targets = geometry.freeSnapTargets(ARTBOARD, [{ h: 40, w: 40, x: 200, y: 300 }]);
  const group = geometry.freeBoundsOf([
    { h: 40, w: 40, x: 30, y: 100 },
    { h: 60, w: 40, x: 130, y: 100 }
  ]);
  let drag = geometry.startFreeDrag({ hadHeight: true, id: "forma1", ids: ["forma1", "forma2"], mode: "se", origin: { x: 500, y: 300 }, rect: group, scale: 1, targets });

  assert.equal(drag.mode, "move", "com varios o modo e sempre mover");
  assert.deepEqual(drag.ids, ["forma1", "forma2"]);

  // Um clique (2 px): nada desenha, nada grava.
  drag = geometry.updateFreeDrag(drag, { x: 502, y: 300 });
  assert.equal(geometry.freeDragPreview(drag), null);
  assert.equal(geometry.finishFreeDragDelta(drag), null);

  // 27 px para a direita: a borda direita do grupo (170 + 27 = 197) gruda no 200 do outro solto.
  drag = geometry.updateFreeDrag(drag, { x: 527, y: 311 });
  assert.deepEqual(drag.last.guides, [{ at: 200, axis: "x" }]);
  assert.deepEqual(geometry.freeDragPreview(drag), { dx: 30, dy: 11, id: "forma1", ids: ["forma1", "forma2"] });
  assert.deepEqual(geometry.finishFreeDragDelta(drag), { dx: 30, dy: 11 });

  // Com Alt: sem guias, o deslocamento do ponteiro.
  const free = geometry.updateFreeDrag(drag, { x: 527, y: 311 }, { altKey: true });
  assert.deepEqual(free.last.guides, []);
  assert.deepEqual(geometry.finishFreeDragDelta(free), { dx: 27, dy: 11 });
});

test("arrastar vários com um membro girado (snap false): sem guias, como com o Alt", () => {
  const targets = geometry.freeSnapTargets(ARTBOARD, []);
  const rect = { h: 40, w: 100, x: 100, y: 100 };
  const turned = geometry.startFreeDrag({ hadHeight: true, id: "a", ids: ["a", "b"], mode: "move", origin: { x: 0, y: 0 }, rect, scale: 1, snap: false, targets });

  assert.equal(turned.snap, false);
  // A borda direita (200 + 18 = 218) ficaria a 2 px do centro da prancheta (220): sem guia, nao gruda.
  const moved = geometry.updateFreeDrag(turned, { x: 18, y: 0 });
  assert.deepEqual(moved.last.guides, []);
  assert.deepEqual(geometry.finishFreeDragDelta(moved), { dx: 18, dy: 0 });

  // Com as guias: gruda.
  const snapped = geometry.updateFreeDrag(geometry.startFreeDrag({ hadHeight: true, id: "a", ids: ["a", "b"], mode: "move", origin: { x: 0, y: 0 }, rect, scale: 1, targets }), { x: 18, y: 0 });
  assert.deepEqual(snapped.last.guides, [{ at: 220, axis: "x" }]);
  assert.deepEqual(geometry.finishFreeDragDelta(snapped), { dx: 20, dy: 0 });
});

test("o fim do arrastar de vários arredonda para inteiros (zoom e celular) e nunca dá -0", () => {
  const targets = geometry.freeSnapTargets(ARTBOARD, []);
  // Escala 1,5 (zoom de 150 %): 10 px de tela = 6,67 px da prancheta.
  const drag = geometry.startFreeDrag({ hadHeight: true, id: "a", ids: ["a", "b"], mode: "move", origin: { x: 0, y: 0 }, rect: { h: 10, w: 10, x: 50, y: 50 }, scale: 1.5, targets });
  const moved = geometry.updateFreeDrag(drag, { x: 10, y: -0.4 }, { altKey: true });

  assert.deepEqual(geometry.finishFreeDragDelta(moved), { dx: 7, dy: 0 });
  assert.ok(Object.is(geometry.finishFreeDragDelta(moved).dy, 0), "sem -0");
  assert.equal(geometry.finishFreeDragDelta(null), null);
});

test("um elemento só arrasta como antes: sem ids na sessão nem na prévia, mesmo com uma lista de um", () => {
  const targets = geometry.freeSnapTargets(ARTBOARD, []);
  const input = { hadHeight: true, id: "forma", mode: "move", origin: { x: 500, y: 300 }, rect: { h: 100, w: 100, x: 50, y: 50 }, scale: 1, targets };

  for (const extra of [{}, { ids: ["forma"] }, { ids: [] }, { snap: true }]) {
    const session = geometry.startFreeDrag({ ...input, ...extra });

    assert.deepEqual(Object.keys(session).sort(), ["hadHeight", "id", "last", "mode", "origin", "rect", "rotate", "scale", "targets"], JSON.stringify(extra));
    const moved = geometry.updateFreeDrag(session, { x: 541, y: 337 });
    assert.deepEqual(geometry.freeDragPreview(moved), { dx: 41, dy: 37, id: "forma" });
    assert.deepEqual(geometry.finishFreeDrag(moved), { x: 91, y: 87 });
  }

  // As alcas continuam com o modo pedido (o grupo nao tem alcas).
  const resize = geometry.startFreeDrag({ ...input, mode: "e", ids: ["forma"] });
  assert.equal(resize.mode, "e");
  assert.deepEqual(geometry.freeDragPreview(geometry.updateFreeDrag(resize, { x: 530, y: 300 }, { altKey: true })), { dh: 0, dw: 30, dx: 0, dy: 0, id: "forma" });
});

test("arrastar a 200 %: o limiar é de 3 px de tela e a guia gruda a 3 px da prancheta", () => {
  const targets = geometry.freeSnapTargets(ARTBOARD, []);
  const scale = geometry.freeZoomScale(200, 1);
  const start = geometry.startFreeDrag({ hadHeight: true, id: "forma", mode: "move", origin: { x: 0, y: 0 }, rect: { h: 40, w: 40, x: 100, y: 100 }, scale, targets });

  // 2,9 px de tela: ainda um clique.
  assert.equal(geometry.updateFreeDrag(start, { x: 2.9, y: 0 }), start);
  // 3 px de tela = 1,5 px da prancheta.
  assert.deepEqual(geometry.updateFreeDrag(start, { x: 3, y: 0 }).last.rect, { h: 40, w: 40, x: 101.5, y: 100 });

  // A borda esquerda a 3 px do 0 da prancheta (6 px de tela): gruda.
  const near0 = geometry.startFreeDrag({ hadHeight: true, id: "forma", mode: "move", origin: { x: 0, y: 0 }, rect: { h: 40, w: 40, x: 13, y: 100 }, scale, targets });
  const grabbed = geometry.updateFreeDrag(near0, { x: -20, y: 0 });
  assert.equal(grabbed.last.rect.x, 0);
  assert.deepEqual(grabbed.last.guides, [{ at: 0, axis: "x" }]);
  // A 3,5 px da prancheta (7 px de tela): nao gruda.
  const far = geometry.updateFreeDrag(near0, { x: -19, y: 0 });
  assert.equal(far.last.rect.x, 3.5);
  assert.deepEqual(far.last.guides, []);
});

/* ------------------------------------------------------------------------------------------------
 * Zoom em passos, roda, ancora, rolagem e mostrar o escolhido
 * ---------------------------------------------------------------------------------------------- */

test("zoom em passos: Ajustar à tela, 50, 75, 100, 150 e 200 %, e o passo seguinte a partir da escala mostrada", () => {
  assert.deepEqual([...geometry.FREE_ZOOM_STEPS], [50, 75, 100, 150, 200]);

  // A escala: o Ajustar devolve a do freeFitZoom; um passo, passo / 100; o '100' da barra de antes vale 100 %.
  assert.equal(geometry.freeZoomScale("fit", 0.62), 0.62);
  assert.equal(geometry.freeZoomScale("fit", 0), 1, "sem medida, 100 %");
  assert.equal(geometry.freeZoomScale(50, 0.62), 0.5);
  assert.equal(geometry.freeZoomScale(75, 0.62), 0.75);
  assert.equal(geometry.freeZoomScale(150, 0.62), 1.5);
  assert.equal(geometry.freeZoomScale(200, 0.62), 2);
  assert.equal(geometry.freeZoomScale("100", 0.62), 1);
  assert.equal(geometry.freeZoomScale(100, 0.62), 1);

  // Do Ajustar a 62 %: + da 75 e - da 50.
  assert.equal(geometry.freeZoomNext(0.62, 1), 75);
  assert.equal(geometry.freeZoomNext(0.62, -1), 50);
  // Num passo: o vizinho.
  assert.equal(geometry.freeZoomNext(1, 1), 150);
  assert.equal(geometry.freeZoomNext(1, -1), 75);
  assert.equal(geometry.freeZoomNext(0.75, -1), 50);
  // Folga de 0,5 %: 99,7 % conta como 100 %.
  assert.equal(geometry.freeZoomNext(0.997, 1), 150);
  assert.equal(geometry.freeZoomNext(0.997, -1), 75);
  // Pontas: null.
  assert.equal(geometry.freeZoomNext(0.3, -1), null);
  assert.equal(geometry.freeZoomNext(0.5, -1), null);
  assert.equal(geometry.freeZoomNext(2, 1), null);
  assert.equal(geometry.freeZoomNext(0.3, 1), 50);
  assert.equal(geometry.freeZoomNext(Number.NaN, 1), null);

  // O Ajustar a tela continua entre 25 % e 100 %: os dois botoes sempre levam a um passo.
  const fit = geometry.freeFitZoom({ h: 200, w: 300 }, { h: 4000, w: 752 });
  assert.equal(fit, 0.25);
  assert.equal(geometry.freeZoomNext(fit, 1), 50);
  assert.equal(geometry.freeZoomNext(fit, -1), null);
});

test("a roda com Ctrl: um passo a cada 50 px, em px, linhas e páginas, no máximo um por movimento", () => {
  // Trackpad: pequenos movimentos somam ate 50 px.
  let state = { acc: 0, direction: 0 };
  const directions = [];

  for (let index = 0; index < 12; index += 1) {
    state = geometry.freeZoomWheel(state.acc, { deltaMode: 0, deltaY: -10 }, 800);
    directions.push(state.direction);
  }

  assert.deepEqual(directions, [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], "para cima aproxima, a cada 50 px");
  assert.equal(state.acc, -20);

  // Para baixo afasta.
  assert.deepEqual(geometry.freeZoomWheel(0, { deltaMode: 0, deltaY: 60 }, 800), { acc: 10, direction: -1 });

  // Linhas valem 16 px: 4 linhas = 64 px.
  assert.deepEqual(geometry.freeZoomWheel(0, { deltaMode: 1, deltaY: -4 }, 800), { acc: -14, direction: 1 });
  assert.deepEqual(geometry.freeZoomWheel(0, { deltaMode: 1, deltaY: 3 }, 800), { acc: 48, direction: 0 });

  // Uma pagina inteira: um passo so, e o resto guardado ate um passo.
  const page = geometry.freeZoomWheel(0, { deltaMode: 2, deltaY: 1 }, 800);
  assert.deepEqual(page, { acc: 50, direction: -1 });
  // Mesmo uma roda de 500 px: um passo por movimento.
  assert.equal(geometry.freeZoomWheel(0, { deltaMode: 0, deltaY: -500 }, 800).direction, 1);
  assert.equal(geometry.freeZoomWheel(0, { deltaMode: 0, deltaY: -500 }, 800).acc, -50);
});

test("a roda com Ctrl: virar de sentido zera o somado; movimento nulo não muda nada", () => {
  // 40 px para cima somados; 30 px para baixo: comeca do zero (30), sem passo.
  assert.deepEqual(geometry.freeZoomWheel(-40, { deltaMode: 0, deltaY: 30 }, 800), { acc: 30, direction: 0 });
  // 40 px para cima somados; 60 para baixo: um passo para baixo, sem descontar os 40.
  assert.deepEqual(geometry.freeZoomWheel(-40, { deltaMode: 0, deltaY: 60 }, 800), { acc: 10, direction: -1 });
  // So o deltaX (rolar de lado com Ctrl): nada.
  assert.deepEqual(geometry.freeZoomWheel(-40, { deltaMode: 0, deltaY: 0 }, 800), { acc: -40, direction: 0 });
  assert.deepEqual(geometry.freeZoomWheel(Number.NaN, { deltaMode: 0, deltaY: Number.NaN }, 800), { acc: 0, direction: 0 });
});

test("ao mudar o zoom, o mesmo ponto do palco fica sob o ponteiro, ao aproximar e ao afastar", () => {
  // O palco comeca em (200, 120) da tela a 62 %; o ponteiro esta em (500, 400).
  const client = { x: 500, y: 400 };
  const before = { origin: { x: 200, y: 120 }, scale: 0.62 };
  const pointOf = (screen, stage) => ({ x: (screen.x - stage.origin.x) / stage.scale, y: (screen.y - stage.origin.y) / stage.scale });
  const wanted = pointOf(client, before);

  for (const after of [
    { origin: { x: 150, y: 120 }, scale: 1.5 },
    { origin: { x: 260, y: 120 }, scale: 0.5 },
    { origin: { x: 200, y: 120 }, scale: 2 }
  ]) {
    const scroll = geometry.freeZoomAnchorScroll(client, before, after);
    // Rolar a area por `scroll` desloca o palco na tela por -scroll: o ponto sob o ponteiro e o de antes.
    const stageAfterScroll = { origin: { x: after.origin.x - scroll.x, y: after.origin.y - scroll.y }, scale: after.scale };
    const seen = pointOf(client, stageAfterScroll);

    near(seen.x, wanted.x, `escala ${after.scale} x:`);
    near(seen.y, wanted.y, `escala ${after.scale} y:`);
  }

  // Sem mudar nada: 0, nunca -0.
  const same = geometry.freeZoomAnchorScroll(client, before, before);
  assert.ok(Object.is(same.x, 0) && Object.is(same.y, 0));
  // Escala sem medida vale 1.
  assert.deepEqual(geometry.freeZoomAnchorScroll({ x: 10, y: 10 }, { origin: { x: 0, y: 0 }, scale: 0 }, { origin: { x: 0, y: 0 }, scale: 2 }), { x: 10, y: 10 });
});

test("o ponteiro com a rolagem somada desde o começo do gesto", () => {
  assert.deepEqual(geometry.freeScrolledPointer({ x: 300, y: 200 }, { x: 0, y: 0 }, { x: 0, y: 0 }), { x: 300, y: 200 });
  // A area rolou 40 para baixo e 15 para a direita: o ponteiro parado vale 40 e 15 a mais no palco.
  assert.deepEqual(geometry.freeScrolledPointer({ x: 300, y: 200 }, { x: 10, y: 100 }, { x: 25, y: 140 }), { x: 315, y: 240 });
  // Rolou de volta.
  assert.deepEqual(geometry.freeScrolledPointer({ x: 300, y: 200 }, { x: 25, y: 140 }, { x: 10, y: 100 }), { x: 285, y: 160 });
});

test("mostrar o escolhido: o menor rolar com a folga; visível dá 0; maior que a vista alinha pelo começo", () => {
  const view = { bottom: 600, left: 100, right: 900, top: 100 };

  // Ja visivel com a folga: 0, nunca -0.
  const visible = geometry.freeRevealScroll(view, { bottom: 300, left: 200, right: 400, top: 200 });
  assert.ok(Object.is(visible.dx, 0) && Object.is(visible.dy, 0));

  // Os quatro lados: so o que falta, mais a folga de 24 px.
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 300, left: 50, right: 150, top: 200 }), { dx: -74, dy: 0 }, "esquerda");
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 300, left: 850, right: 950, top: 200 }), { dx: 74, dy: 0 }, "direita");
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 120, left: 200, right: 300, top: 90 }), { dx: 0, dy: -34 }, "em cima");
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 700, left: 200, right: 300, top: 650 }), { dx: 0, dy: 124 }, "embaixo");
  // Visivel mas colado na borda: anda so a folga.
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 600, left: 200, right: 300, top: 560 }), { dx: 0, dy: 24 });
  // Os dois eixos de uma vez.
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 50, left: 950, right: 1000, top: 10 }, 10), { dx: 110, dy: -100 });

  // Maior que a vista: alinha pelo comeco, com a folga (de cima ou de baixo).
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 1400, left: 200, right: 300, top: 400 }), { dx: 0, dy: 276 });
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 300, left: -500, right: 1200, top: 200 }), { dx: -624, dy: 0 });

  // Cabe, mas nao com a folga toda: inteiro na vista da 0; fora, entra com a folga que couber (centrado).
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 590, left: 200, right: 300, top: 120 }), { dx: 0, dy: 0 });
  assert.deepEqual(geometry.freeRevealScroll(view, { bottom: 640, left: 200, right: 300, top: 160 }), { dx: 0, dy: 50 });
});
