import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Editor Livre do pop-up, arrastar do L4a (docs/27 §13.9; docs/18 §1.1), pacote B: o nucleo puro. Uma regra so de
// mover (freeMoveProblem e moveFreeNodeTo, com o indice como vao na lista de hoje), o conserto do "Tirar da caixa"
// com a caixa de fora cheia, a frase de depois de soltar, o lugar de soltar nas Camadas (freeLayerDropAt e
// freeLayerDropTarget, com todo vao alcancavel), os lugares do desenho (freeFlowContainers) e o lugar de soltar no
// desenho (freeFlowDropAt, inclusive o mesmo vao que nao grava), o ponto da tela em px da prancheta, o Celular com a
// ordem uma so, o elemento novo que entra onde foi solto e as guardas de fonte do editor e do desenho. Tudo carregado
// direto pelo Node.

const editor = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
const geometry = await import("../src/components/admin/v2/communication/popup-free/free-editor-geometry.ts");
const history = await import("../src/components/admin/v2/communication/popup-free/free-editor-history.ts");
const model = await import("../src/server/communications/popup-free-model.ts");
const render = await import("../src/server/communications/popup-free-render.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");

const M = schema.POPUP_FREE_MESSAGES;
const C = editor.FREE_EDITOR_COPY;
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete", "fluxo", "asset"];

function design(children, extra = {}) {
  return model.canonicalPopupFreeDesign({ children, mode: "free", version: 1, ...extra });
}

const TITLE = { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" };
const TEXT = { id: "texto", lines: [[{ text: "Assista hoje." }]], type: "text" };
const BADGE = { id: "selo", label: "Novo", type: "badge" };
const CLOSE = { action: { kind: "close" }, id: "botao", label: "Agora não", type: "button" };
const LINKS = { id: "links", type: "links" };
const AUDIO = { id: "audio", type: "audio" };
const spacer = (id) => ({ id, type: "spacer" });

function ids(nodes) {
  return nodes.map((node) => node.id);
}

function find(value, id) {
  return model.findFreeNode(value, id);
}

function valid(value) {
  return schema.popupFreeDesignSchema.safeParse(value).success;
}

/** Os ids na ordem do DOM (a ordem de leitura). */
function order(value) {
  const out = [];

  model.walkFreeNodes(value.children, (node) => out.push(node.id));

  return out;
}

const rect = (x, y, w, h) => ({ h, w, x, y });

/* ------------------------------------------------------------------------------------------------
 * A regra de mover
 * ---------------------------------------------------------------------------------------------- */

function sample() {
  return design([TITLE, TEXT, { children: [BADGE, CLOSE], id: "caixa", type: "box" }, LINKS], {
    devices: { mobile: { nodes: { caixa: { layout: { dir: "row" } }, texto: { textStyle: { size: 14 } } } } }
  });
}

test("levar para (pai, índice): o vão é o da lista de hoje e devices não muda", () => {
  const base = sample();

  // O Titulo ao vao 2 (entre o Texto e a Caixa): fica na posicao 1.
  const title = editor.moveFreeNodeTo(base, "titulo", { index: 2, parentId: null });
  assert.deepEqual(ids(title.design.children), ["texto", "titulo", "caixa", "links"]);
  assert.equal(find(title.design, "titulo").index, 1);
  assert.equal(title.becameFlow, false);

  // O Texto no meio da Caixa (vao 1).
  const text = editor.moveFreeNodeTo(base, "texto", { index: 1, parentId: "caixa" });
  assert.deepEqual(ids(find(text.design, "caixa").node.children), ["selo", "texto", "botao"]);
  assert.deepEqual(ids(text.design.children), ["titulo", "caixa", "links"]);

  // O Selo sai para a prancheta, no vao 0.
  const badge = editor.moveFreeNodeTo(base, "selo", { index: 0, parentId: null });
  assert.deepEqual(ids(badge.design.children), ["selo", "titulo", "texto", "caixa", "links"]);
  assert.deepEqual(ids(find(badge.design, "caixa").node.children), ["botao"]);

  // Descendo na mesma lista: o vao conta o proprio elemento (o fim e o vao 4).
  assert.deepEqual(ids(editor.moveFreeNodeTo(base, "titulo", { index: 4, parentId: null }).design.children), ["texto", "caixa", "links", "titulo"]);

  for (const result of [title, text, badge]) {
    assert.ok(valid(result.design));
    assert.deepEqual(result.design.devices, base.devices, "os ids nao mudam: os valores do celular ficam");
  }
});

test("recusas: o mesmo lugar não é passo, a caixa não entra nela mesma, 20 por caixa e a profundidade", () => {
  const base = sample();

  // "" = invalido ou nada muda (sem frase).
  assert.equal(editor.freeMoveProblem(base, "nada", { index: 0, parentId: null }), "");
  assert.equal(editor.freeMoveProblem(base, "texto", { index: 0, parentId: "titulo" }), "", "o pai nao e uma caixa");
  assert.equal(editor.freeMoveProblem(base, "texto", { index: 0, parentId: "sumiu" }), "");
  assert.equal(editor.freeMoveProblem(base, "texto", { index: -1, parentId: null }), "");
  assert.equal(editor.freeMoveProblem(base, "texto", { index: 5, parentId: null }), "", "a prancheta tem 4: o ultimo vao e o 4");
  assert.equal(editor.freeMoveProblem(base, "texto", { index: 1.5, parentId: null }), "");
  assert.equal(editor.freeMoveProblem(base, "texto", { index: 1, parentId: null }), "", "o vao de antes dele");
  assert.equal(editor.freeMoveProblem(base, "texto", { index: 2, parentId: null }), "", "o vao de depois dele");
  assert.equal(editor.freeMoveProblem(base, "texto", { index: 4, parentId: null }), null);
  assert.equal(editor.freeMoveProblem(base, "selo", { index: 1, parentId: "caixa" }), "", "na caixa tambem");

  // A caixa nunca entra nela mesma nem numa caixa de dentro dela.
  const nested = design([{ children: [{ children: [spacer("e1")], id: "dentro", type: "box" }], id: "fora", type: "box" }, { children: [], id: "vazia", type: "box" }, LINKS]);
  assert.equal(editor.freeMoveProblem(base, "caixa", { index: 0, parentId: "caixa" }), C.drag.intoItself);
  assert.equal(editor.freeMoveProblem(nested, "fora", { index: 0, parentId: "dentro" }), C.drag.intoItself);
  assert.equal(C.drag.intoItself, "Uma caixa não entra dentro dela mesma.");

  // Uma caixa com caixa dentro nao entra em outra caixa (seriam 3 niveis).
  assert.equal(editor.freeMoveProblem(nested, "fora", { index: 0, parentId: "vazia" }), M.depth);
  assert.equal(editor.freeMoveProblem(nested, "vazia", { index: 0, parentId: "dentro" }), M.depth);
  assert.equal(editor.freeMoveProblem(nested, "vazia", { index: 1, parentId: "fora" }), null, "uma caixa simples entra na caixa de fora");

  // Caixa cheia (20): nao recebe de fora, mas reordenar dentro dela vale.
  const full = design([TEXT, { children: Array.from({ length: 20 }, (_, index) => spacer(`e${index}`)), id: "cheia", type: "box" }, LINKS]);
  assert.equal(editor.freeMoveProblem(full, "texto", { index: 0, parentId: "cheia" }), M.childrenPerBox);
  assert.equal(editor.freeMoveProblem(full, "e0", { index: 5, parentId: "cheia" }), null);
  assert.deepEqual(ids(find(editor.moveFreeNodeTo(full, "e0", { index: 5, parentId: "cheia" }).design, "cheia").node.children).slice(0, 5), ["e1", "e2", "e3", "e4", "e0"]);

  // Recusado = null em moveFreeNodeTo; o editor nao grava e o historico com a mesma referencia nao cria passo.
  const refused = [
    [base, "nada", { index: 0, parentId: null }],
    [base, "texto", { index: 0, parentId: "titulo" }],
    [base, "texto", { index: 9, parentId: null }],
    [base, "texto", { index: 1, parentId: null }],
    [base, "texto", { index: 2, parentId: null }],
    [base, "caixa", { index: 0, parentId: "caixa" }],
    [nested, "fora", { index: 0, parentId: "dentro" }],
    [nested, "fora", { index: 0, parentId: "vazia" }],
    [full, "texto", { index: 0, parentId: "cheia" }]
  ];

  for (const [value, id, target] of refused) {
    assert.equal(editor.moveFreeNodeTo(value, id, target), null, `${id} -> ${JSON.stringify(target)}`);
  }

  const start = history.createFreeHistory({ cta: null, design: base });
  assert.equal(history.pushFreeHistory(start, { cta: null, design: base }), start, "o mesmo design: nenhum passo vazio");
});

test("solto: entra numa caixa e vira sequência; reordenado na prancheta continua solto", () => {
  const loose = design([{ ...TITLE, place: { mode: "free", w: 200, x: 40, y: 30, z: 2 } }, { children: [spacer("e1")], id: "caixa", type: "box" }, LINKS], {
    devices: { mobile: { nodes: { titulo: { hidden: true, place: { mode: "free", x: 5 } } } } }
  });
  assert.deepEqual(loose.devices.mobile.nodes.titulo, { hidden: true, place: { mode: "free", x: 5 } }, "o celular foi semeado como pedido");

  const flowed = editor.moveFreeNodeTo(loose, "titulo", { index: 1, parentId: "caixa" });
  assert.equal(flowed.becameFlow, true);
  assert.deepEqual(find(flowed.design, "titulo").node.place, { mode: "flow", z: 2 }, "guarda a camada");
  assert.deepEqual(flowed.design.devices.mobile.nodes.titulo, { hidden: true }, "perde so a posicao do celular");
  assert.deepEqual(ids(find(flowed.design, "caixa").node.children), ["e1", "titulo"]);
  assert.ok(valid(flowed.design));

  const reordered = editor.moveFreeNodeTo(loose, "titulo", { index: 2, parentId: null });
  assert.equal(reordered.becameFlow, false);
  assert.deepEqual(ids(reordered.design.children), ["caixa", "titulo", "links"]);
  assert.deepEqual(find(reordered.design, "titulo").node.place, { mode: "free", w: 200, x: 40, y: 30, z: 2 });
  assert.deepEqual(reordered.design.devices, loose.devices);
  assert.ok(valid(reordered.design));
});

test("paridade com o Subir e o Colocar dentro: travado, escondido, Links e Áudio se movem", () => {
  const base = design([{ ...TITLE, locked: true }, { ...TEXT, hidden: true }, { children: [], id: "caixa", type: "box" }, LINKS, AUDIO]);

  const locked = editor.moveFreeNodeTo(base, "titulo", { index: 3, parentId: null });
  assert.deepEqual(ids(locked.design.children), ["texto", "caixa", "titulo", "links", "audio"]);

  const hidden = editor.moveFreeNodeTo(base, "texto", { index: 0, parentId: "caixa" });
  assert.deepEqual(ids(find(hidden.design, "caixa").node.children), ["texto"]);
  assert.equal(find(hidden.design, "texto").node.hidden, true);

  const links = editor.moveFreeNodeTo(base, "links", { index: 0, parentId: "caixa" });
  const audio = editor.moveFreeNodeTo(links.design, "audio", { index: 1, parentId: "caixa" });
  assert.deepEqual(ids(find(audio.design, "caixa").node.children), ["links", "audio"]);
  assert.deepEqual(ids(editor.moveFreeNodeTo(base, "links", { index: 0, parentId: null }).design.children), ["links", "titulo", "texto", "caixa", "audio"]);

  for (const result of [locked, hidden, links, audio]) {
    assert.ok(valid(result.design));
  }
});

test("Tirar da caixa nunca deixa 21: com a caixa de fora cheia, desliga com a frase", () => {
  const inner = { children: [{ ...TEXT, id: "dentro1" }], id: "interna", type: "box" };
  const outer = { children: [inner, ...Array.from({ length: 19 }, (_, index) => spacer(`e${index}`))], id: "fora", type: "box" };
  const base = design([outer, LINKS]);
  assert.equal(find(base, "fora").node.children.length, 20);

  // Antes do conserto, o "Tirar" punha o elemento logo depois da caixa interna: 21 filhos, que o zod recusa.
  const before = structuredClone(base);
  before.children[0].children.splice(1, 0, { ...TEXT, id: "dentro1" });
  before.children[0].children[0].children = [];
  const parsed = schema.popupFreeDesignSchema.safeParse(before);
  assert.equal(parsed.success, false);
  assert.ok(parsed.error.issues.some((issue) => issue.path.join(".") === "children.0.children" && issue.message === M.childrenPerBox));

  // Agora: nada muda e o motivo e a frase da caixa cheia.
  assert.deepEqual(editor.freeOutOfBoxTarget(base, "dentro1"), { index: 1, parentId: "fora" });
  assert.equal(editor.moveFreeNodeOutOfBox(base, "dentro1"), null);
  assert.equal(editor.freeOutOfBoxProblem(base, "dentro1"), M.childrenPerBox);

  // Fora de caixa: "" (sem frase); a caixa interna sai para a prancheta.
  assert.equal(editor.freeOutOfBoxTarget(base, "fora"), null);
  assert.equal(editor.freeOutOfBoxProblem(base, "fora"), "");
  assert.equal(editor.freeOutOfBoxProblem(base, "interna"), null);
  assert.deepEqual(ids(editor.moveFreeNodeOutOfBox(base, "interna").children), ["fora", "interna", "links"]);

  // Com lugar na caixa de fora, sai logo depois da caixa interna, como antes.
  const roomy = design([{ ...outer, children: [inner, spacer("e0")] }, LINKS]);
  assert.equal(editor.freeOutOfBoxProblem(roomy, "dentro1"), null);
  assert.deepEqual(ids(find(editor.moveFreeNodeOutOfBox(roomy, "dentro1"), "fora").node.children), ["interna", "dentro1", "e0"]);

  // Colocar dentro continua com a mesma guarda (as caixas que podem receber).
  assert.equal(editor.moveFreeNodeIntoBox(base, "e0", "interna").becameFlow, false);
  assert.equal(editor.moveFreeNodeIntoBox(base, "e0", "fora"), null, "ja esta nela");
});

/* ------------------------------------------------------------------------------------------------
 * Frases e textos
 * ---------------------------------------------------------------------------------------------- */

test("frases do mover: a posição entre os irmãos, onde e o final da sequência", () => {
  const base = sample();

  const inBox = editor.moveFreeNodeTo(base, "texto", { index: 2, parentId: "caixa" });
  assert.equal(editor.freeMoveAnnouncement(inBox.design, "texto", null, { becameFlow: false }), "Movido. Posição 3 de 3, dentro de Caixa em coluna.");

  const root = editor.moveFreeNodeTo(base, "texto", { index: 0, parentId: null });
  assert.equal(editor.freeMoveAnnouncement(root.design, "texto", null, { becameFlow: false }), "Movido. Posição 1 de 4, no pop-up.");

  // Escondidos e soltos contam, como nas Camadas.
  const counted = design([{ ...TITLE, hidden: true }, { id: "forma", place: { h: 40, mode: "free", w: 40, x: 0, y: 0 }, type: "shape" }, TEXT, LINKS]);
  assert.equal(editor.freeMoveAnnouncement(counted, "texto", null, { becameFlow: false }), "Movido. Posição 3 de 4, no pop-up.");

  // Um solto que entrou numa caixa: mais "Agora segue a sequência.".
  const loose = design([{ ...BADGE, place: { mode: "free", w: 80, x: 0, y: 0 } }, { children: [spacer("e1")], id: "linha", layout: { dir: "row" }, type: "box" }, LINKS]);
  const flowed = editor.moveFreeNodeTo(loose, "selo", { index: 1, parentId: "linha" });
  assert.equal(
    editor.freeMoveAnnouncement(flowed.design, "selo", null, { becameFlow: flowed.becameFlow }),
    "Movido. Posição 2 de 2, dentro de Caixa em linha. Agora segue a sequência."
  );

  // O nome dado a caixa vale.
  const named = editor.moveFreeNodeTo(design([TEXT, { children: [], id: "caixa", name: "Oferta do mês", type: "box" }, LINKS]), "texto", { index: 0, parentId: "caixa" });
  assert.equal(editor.freeMoveAnnouncement(named.design, "texto", null, { becameFlow: false }), "Movido. Posição 1 de 1, dentro de Oferta do mês.");
  assert.equal(editor.freeMoveAnnouncement(base, "nada", null, { becameFlow: false }), "");

  // O final do Celular (o editor acrescenta em toda mudanca de ordem com Ver como Celular).
  assert.equal(`${C.drag.moved(1, 5)} ${C.drag.alsoDesktop}`, "Movido. Posição 1 de 5, no pop-up. A ordem muda também no computador.");
});

test("textos do arrastar palavra por palavra, os Atalhos ainda com 12 linhas e o vocabulário", () => {
  assert.equal(C.drag.moved(3, 3, "dentro de Caixa em coluna"), "Movido. Posição 3 de 3, dentro de Caixa em coluna.");
  assert.equal(C.drag.moved(1, 2), "Movido. Posição 1 de 2, no pop-up.");
  assert.equal(C.drag.inArtboard, "no pop-up");
  assert.equal(C.drag.alsoDesktop, "A ordem muda também no computador.");
  assert.equal(C.drag.alsoDesktopTag, "Muda também no computador");
  assert.equal(C.drag.intoItself, "Uma caixa não entra dentro dela mesma.");
  assert.equal(C.toolbar.drag, "Arraste para mudar o lugar");
  assert.equal(C.elements.hint, "Clique para acrescentar ou arraste até o lugar no desenho.");
  assert.equal(C.shortcuts.length, 12);
  assert.equal(C.shortcuts[7], "Esc: selecionar a caixa de fora (ou nada); arrastando, cancela");
  assert.equal(C.shortcuts.filter((line) => line.startsWith("Esc:")).length, 1);

  const texts = [C.drag.moved(1, 2), C.drag.inArtboard, C.drag.alsoDesktop, C.drag.alsoDesktopTag, C.drag.intoItself, C.toolbar.drag, C.elements.hint, C.shortcuts[7]];
  const all = texts.join("\n").toLowerCase();

  for (const word of PROIBIDAS) {
    assert.equal(all.includes(word), false, `"${word}" apareceu nos textos do arrastar`);
  }

  assert.equal(/ [-–—] /.test(texts.join("\n")), false, "sem hifen como separador");
});

/* ------------------------------------------------------------------------------------------------
 * Camadas: onde cai
 * ---------------------------------------------------------------------------------------------- */

test("Camadas: onde cai pela altura da linha", () => {
  const lines = [
    { box: false, height: 36, id: "a", top: 0 },
    { box: true, height: 36, id: "o", top: 38 },
    { box: false, height: 36, id: "b", top: 76 }
  ];

  assert.deepEqual(geometry.freeLayerDropAt(lines, -5), { edge: "before", id: "a" }, "acima da primeira");
  assert.deepEqual(geometry.freeLayerDropAt(lines, 10), { edge: "before", id: "a" }, "metade de cima da folha");
  assert.deepEqual(geometry.freeLayerDropAt(lines, 20), { edge: "after", id: "a" }, "metade de baixo da folha");
  assert.deepEqual(geometry.freeLayerDropAt(lines, 37), { edge: "before", id: "o" }, "o vao entre linhas vale como antes da de baixo");
  assert.deepEqual(geometry.freeLayerDropAt(lines, 40), { edge: "before", id: "o" }, "quarto de cima da caixa");
  assert.deepEqual(geometry.freeLayerDropAt(lines, 56), { edge: "inside", id: "o" }, "o meio da caixa");
  assert.deepEqual(geometry.freeLayerDropAt(lines, 64.9), { edge: "inside", id: "o" });
  assert.deepEqual(geometry.freeLayerDropAt(lines, 65), { edge: "after", id: "o" }, "quarto de baixo da caixa");
  assert.deepEqual(geometry.freeLayerDropAt(lines, 111.9), { edge: "after", id: "b" });
  assert.deepEqual(geometry.freeLayerDropAt(lines, 112), { end: true }, "abaixo da ultima: o fim do pop-up");
  assert.equal(geometry.freeLayerDropAt([], 10), null);

  // [A, O[B, I[x, y]], E[], D]
  const tree = design([spacer("a"), { children: [spacer("b"), { children: [spacer("x"), spacer("y")], id: "i", type: "box" }], id: "o", type: "box" }, { children: [], id: "e", type: "box" }, spacer("d")]);

  assert.deepEqual(editor.freeLayerDropTarget(tree, { edge: "before", id: "b" }), { index: 0, parentId: "o" });
  assert.deepEqual(editor.freeLayerDropTarget(tree, { edge: "after", id: "a" }), { index: 1, parentId: null });
  assert.deepEqual(editor.freeLayerDropTarget(tree, { edge: "after", id: "o" }), { index: 0, parentId: "o" }, "depois de uma caixa com filhos: dentro, no comeco");
  assert.deepEqual(editor.freeLayerDropTarget(tree, { edge: "after", id: "e" }), { index: 3, parentId: null }, "a caixa vazia: depois dela");
  assert.deepEqual(editor.freeLayerDropTarget(tree, { edge: "inside", id: "i" }), { index: 2, parentId: "i" }, "dentro: no fim");
  assert.deepEqual(editor.freeLayerDropTarget(tree, { edge: "inside", id: "e" }), { index: 0, parentId: "e" });
  assert.deepEqual(editor.freeLayerDropTarget(tree, { edge: "inside", id: "b" }), { index: 1, parentId: "o" }, "numa folha, dentro vale como depois");
  assert.deepEqual(editor.freeLayerDropTarget(tree, { end: true }), { index: 4, parentId: null });
  assert.equal(editor.freeLayerDropTarget(tree, { edge: "before", id: "nada" }), null);
});

test("Camadas: todo lugar válido é alcançável pelas linhas (antes, depois, dentro e o fim)", () => {
  const tree = design([spacer("a"), { children: [spacer("b"), { children: [spacer("x"), spacer("y")], id: "i", type: "box" }], id: "o", type: "box" }, { children: [], id: "e", type: "box" }, spacer("d")]);
  const all = order(tree);
  const containers = [null, ...all.filter((id) => find(tree, id).node.type === "box")];
  const lengthOf = (parentId) => (parentId === null ? tree.children : find(tree, parentId).node.children).length;
  const overs = [{ end: true }, ...all.flatMap((id) => ["before", "after", "inside"].map((edge) => ({ edge, id })))];

  for (const moving of all) {
    const byGap = new Set();
    const byLine = new Set();

    for (const parentId of containers) {
      for (let index = 0; index <= lengthOf(parentId); index += 1) {
        const result = editor.moveFreeNodeTo(tree, moving, { index, parentId });

        if (result) {
          byGap.add(JSON.stringify(result.design.children));
        }
      }
    }

    for (const over of overs) {
      const target = editor.freeLayerDropTarget(tree, over);
      const result = target ? editor.moveFreeNodeTo(tree, moving, target) : null;

      if (result) {
        byLine.add(JSON.stringify(result.design.children));
      }
    }

    assert.ok(byGap.size > 0, moving);
    assert.deepEqual([...byLine].sort(), [...byGap].sort(), `os lugares de ${moving}`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Desenho: os lugares e o lugar de soltar
 * ---------------------------------------------------------------------------------------------- */

function stageSample() {
  const children = [
    TITLE,
    { ...spacer("oculto"), hidden: true },
    { id: "forma", place: { h: 120, mode: "free", w: 120, x: 100, y: 100 }, type: "shape" },
    { children: [BADGE, CLOSE], id: "caixa", layout: { dir: "row", wrap: true }, type: "box" },
    { children: [{ children: [spacer("e1")], id: "dentroGirada", type: "box" }], id: "girada", place: { mode: "free", rotate: 15, w: 160, x: 200, y: 300 }, type: "box" },
    { children: [], id: "travada", locked: true, type: "box" },
    LINKS
  ];
  const rects = {
    "@artboard": rect(0, 0, 440, 600),
    botao: rect(140, 96, 100, 40),
    caixa: rect(24, 80, 392, 72),
    dentroGirada: rect(210, 310, 140, 40),
    e1: rect(214, 314, 100, 20),
    forma: rect(100, 100, 120, 120),
    girada: rect(200, 300, 160, 60),
    links: rect(24, 400, 392, 20),
    selo: rect(32, 96, 80, 40),
    titulo: rect(24, 24, 392, 40),
    travada: rect(24, 180, 392, 0)
  };

  return { design: design(children), rects };
}

test("desenho: os lugares que recebem (a prancheta em coluna, as caixas desenhadas e o índice real)", () => {
  const { design: stage, rects } = stageSample();
  const containers = editor.freeFlowContainers(stage, rects, { height: 0 });
  const artboard = containers[0];

  assert.deepEqual(
    { accepts: artboard.accepts, depth: artboard.depth, dir: artboard.dir, flow: artboard.flow, id: artboard.id, index: artboard.index, length: artboard.length, wrap: artboard.wrap, z: artboard.z },
    { accepts: null, depth: 0, dir: "column", flow: false, id: null, index: -1, length: 7, wrap: false, z: -Infinity }
  );
  assert.deepEqual(artboard.rect, rects["@artboard"]);
  // Os itens: so os da sequencia, visiveis e com retangulo, com o indice real (o escondido e o solto ficam no lugar).
  assert.deepEqual(artboard.items.map((item) => [item.id, item.index]), [["titulo", 0], ["caixa", 3], ["travada", 5], ["links", 6]]);
  assert.deepEqual(containers.map((container) => container.id), [null, "caixa", "travada"], "a caixa solta girada e o que esta dentro dela ficam de fora");

  const box = containers[1];
  assert.deepEqual({ dir: box.dir, flow: box.flow, index: box.index, parentId: box.parentId, wrap: box.wrap, z: box.z }, { dir: "row", flow: true, index: 3, parentId: null, wrap: true, z: 0 });
  assert.deepEqual(box.items.map((item) => [item.id, item.index]), [["selo", 0], ["botao", 1]]);
  assert.equal(containers[2].accepts, null, "a caixa travada aceita");

  // Quem se move fica de fora (com o que tem dentro), como contêiner e como item; a casa dele e o vao de hoje.
  const moving = editor.freeFlowContainers(stage, rects, { id: "caixa" });
  assert.deepEqual(moving.map((container) => container.id), [null, "travada"]);
  assert.deepEqual(moving[0].items.map((item) => item.id), ["titulo", "travada", "links"]);
  assert.equal(moving[0].home, 3);
  assert.equal(moving[1].home, null);
  assert.equal(editor.freeFlowContainers(stage, rects, { id: "selo" })[1].home, 0);
  assert.equal(editor.freeFlowContainers(stage, {}, { height: 0 }).length, 0, "sem a prancheta medida, nada");

  // Sem retangulo ou escondida: a caixa nao entra.
  assert.deepEqual(editor.freeFlowContainers(stage, { ...rects, caixa: undefined }, { height: 0 }).map((container) => container.id), [null, "travada"]);
});

test("desenho: um solto girado tira a subárvore inteira, como contêiner e como item", () => {
  const { design: stage, rects } = stageSample();
  const subtree = ["girada", "dentroGirada", "e1"];

  for (const moving of [{ height: 0 }, { height: 1 }, { id: "titulo" }, { id: "selo" }]) {
    const containers = editor.freeFlowContainers(stage, rects, moving);

    assert.equal(containers.some((container) => subtree.includes(container.id)), false, JSON.stringify(moving));
    assert.equal(containers.some((container) => container.items.some((item) => subtree.includes(item.id))), false, JSON.stringify(moving));
    assert.equal(containers.some((container) => subtree.includes(container.parentId)), false);
  }

  // Sem giro, a caixa solta entra (fora da sequencia) e o que esta dentro tambem.
  const straight = design(stage.children.map((node) => (node.id === "girada" ? { ...node, place: { mode: "free", w: 160, x: 200, y: 300 } } : node)));
  const containers = editor.freeFlowContainers(straight, rects, { height: 0 });
  assert.deepEqual(containers.map((container) => [container.id, container.flow]), [[null, false], ["caixa", true], ["girada", false], ["dentroGirada", true], ["travada", true]]);
});

test("desenho: quem está dentro de um solto girado não muda de lugar pelo desenho (soltar no próprio lugar não tira da caixa)", () => {
  // [Titulo, Girada (solta, rotate 15)[t1, t2], Links]: o t1 e da sequencia, nao esta travado e tem retangulo.
  const value = design([
    TITLE,
    { children: [{ ...TEXT, id: "t1" }, { ...TEXT, id: "t2" }], id: "girada", place: { mode: "free", rotate: 15, w: 200, x: 120, y: 200 }, type: "box" },
    LINKS
  ]);
  const rects = { "@artboard": rect(0, 0, 440, 500), girada: rect(120, 200, 200, 100), links: rect(24, 440, 392, 20), t1: rect(130, 210, 180, 30), t2: rect(130, 250, 180, 30), titulo: rect(24, 24, 392, 40) };

  // A casa dele (a caixa girada) nao entra na lista: sem contêineres, o soltar nao muda nada.
  assert.deepEqual(editor.freeFlowContainers(value, rects, { id: "t1" }), []);
  assert.equal(geometry.freeFlowDropAt({ x: 220, y: 225 }, editor.freeFlowContainers(value, rects, { id: "t1" }), AT_1), null, "no centro do proprio t1");
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 10 }, editor.freeFlowContainers(value, rects, { id: "t2" }), AT_1), null, "nem acima do Titulo");

  // A caixa interna de um solto girado e o que esta dentro dela: o mesmo.
  const { design: stage, rects: stageRects } = stageSample();
  assert.deepEqual(editor.freeFlowContainers(stage, stageRects, { id: "e1" }), []);
  assert.deepEqual(editor.freeFlowContainers(stage, stageRects, { id: "dentroGirada" }), []);

  // A alca da barrinha so aparece quando o arrastar pode comecar: dentro do solto girado, nao.
  assert.equal(editor.freeFlowDraggable(value, rects, "t1"), false, "filho de solto girado: sem alca");
  assert.equal(editor.freeFlowDraggable(stage, stageRects, "e1"), false, "neto de solto girado: sem alca");
  assert.equal(editor.freeFlowDraggable(stage, stageRects, "dentroGirada"), false, "caixa dentro de solto girado: sem alca");

  // Sem giro, a casa entra e o mesmo vao e o lugar de hoje.
  const straight = design(value.children.map((node) => (node.id === "girada" ? { ...node, place: { mode: "free", w: 200, x: 120, y: 200 } } : node)));
  assert.equal(editor.freeFlowDraggable(straight, rects, "t1"), true, "sem giro, a alca volta");
  const home = geometry.freeFlowDropAt({ x: 220, y: 225 }, editor.freeFlowContainers(straight, rects, { id: "t1" }), AT_1);
  assert.deepEqual({ index: home.index, parentId: home.parentId }, { index: 0, parentId: "girada" });
  assert.equal(editor.freeMoveProblem(straight, "t1", home), "");
  // Os elementos de fora do solto girado continuam com os lugares de sempre.
  assert.deepEqual(editor.freeFlowContainers(value, rects, { id: "titulo" }).map((container) => container.id), [null]);
});

test("desenho: freeFlowDraggable diz quando o arrastar da sequência pode começar (a alça só aparece então)", () => {
  const { design: stage, rects } = stageSample();

  // Da sequencia, nao travado e medido: pode (na prancheta ou dentro de uma caixa em linha).
  assert.equal(editor.freeFlowDraggable(stage, rects, "titulo"), true);
  assert.equal(editor.freeFlowDraggable(stage, rects, "caixa"), true);
  assert.equal(editor.freeFlowDraggable(stage, rects, "selo"), true);
  // O solto muda X/Y, nao a ordem; o travado nao arrasta; sem retangulo, sem prancheta medida ou sem o elemento, nao.
  assert.equal(editor.freeFlowDraggable(stage, rects, "forma"), false, "solto");
  assert.equal(editor.freeFlowDraggable(stage, rects, "girada"), false, "o proprio solto girado");
  assert.equal(editor.freeFlowDraggable(stage, rects, "travada"), false, "travado");
  assert.equal(editor.freeFlowDraggable(stage, { ...rects, titulo: undefined }, "titulo"), false, "sem retangulo");
  assert.equal(editor.freeFlowDraggable(stage, { ...rects, "@artboard": undefined }, "titulo"), false, "sem a prancheta medida");
  assert.equal(editor.freeFlowDraggable(stage, rects, "nenhum"), false, "id que nao existe");

  // O mesmo que a lista do comeco do gesto nao vir vazia, para todo elemento da sequencia nao travado e medido.
  model.walkFreeNodes(stage.children, (node) => {
    if (node.place?.mode !== "free" && !node.locked && rects[node.id]) {
      assert.equal(editor.freeFlowDraggable(stage, rects, node.id), editor.freeFlowContainers(stage, rects, { id: node.id }).length > 0, node.id);
    }
  });
});

test("desenho: os motivos de recusa (caixa cheia de fora e profundidade) e o aparelho do palco", () => {
  const full = design([
    TEXT,
    { children: Array.from({ length: 20 }, (_, index) => spacer(`e${index}`)), id: "cheia", type: "box" },
    { children: [{ children: [], id: "interna", type: "box" }], id: "fora", type: "box" },
    LINKS
  ]);
  const rects = { "@artboard": rect(0, 0, 440, 600), cheia: rect(24, 80, 392, 100), fora: rect(24, 200, 392, 100), interna: rect(40, 210, 300, 40), texto: rect(24, 24, 392, 40) };
  const accepts = (moving) => Object.fromEntries(editor.freeFlowContainers(full, rects, moving).map((container) => [container.id, container.accepts]));

  assert.deepEqual(accepts({ id: "texto" }), { cheia: M.childrenPerBox, fora: null, interna: null, null: null });
  assert.deepEqual(accepts({ id: "e0" }), { cheia: null, fora: null, interna: null, null: null }, "reordenar dentro da caixa cheia vale");
  assert.deepEqual(accepts({ height: 1 }), { cheia: M.childrenPerBox, fora: null, interna: M.depth, null: null }, "uma caixa nova nao entra na caixa interna");
  assert.deepEqual(accepts({ height: 0 }), { cheia: M.childrenPerBox, fora: null, interna: null, null: null });
  assert.deepEqual(accepts({ id: "interna" }).fora, null, "a caixa interna volta para a caixa de fora");

  // O palco do celular: a direcao, a quebra e os escondidos do celular.
  const mobile = design([TITLE, { children: [BADGE, CLOSE], id: "caixa", type: "box" }, LINKS], {
    devices: { mobile: { nodes: { caixa: { layout: { dir: "row", wrap: true } }, titulo: { hidden: true } } } }
  });
  const stageRects = { "@artboard": rect(0, 0, 440, 600), botao: rect(140, 96, 100, 40), caixa: rect(24, 80, 392, 72), links: rect(24, 200, 392, 20), selo: rect(32, 96, 80, 40), titulo: rect(24, 24, 392, 40) };
  const onPhone = editor.freeFlowContainers(render.resolveFreeForDevice(mobile, "mobile"), stageRects, { height: 0 });
  assert.deepEqual({ dir: onPhone[1].dir, wrap: onPhone[1].wrap }, { dir: "row", wrap: true });
  assert.deepEqual(onPhone[0].items.map((item) => item.id), ["caixa", "links"], "o titulo esta escondido so no celular");
  const onDesktop = editor.freeFlowContainers(render.resolveFreeForDevice(mobile, "desktop"), stageRects, { height: 0 });
  assert.deepEqual({ dir: onDesktop[1].dir, wrap: onDesktop[1].wrap, items: onDesktop[0].items.length }, { dir: "column", items: 3, wrap: false });
});

/** Uma prancheta 440 x 600: Titulo, Caixa em coluna [Selo, Botao] e Links. */
function columnSample(extra = {}) {
  return [
    {
      accepts: null,
      depth: 0,
      dir: "column",
      flow: false,
      id: null,
      index: -1,
      items: [
        { id: "t", index: 0, rect: rect(24, 24, 392, 40) },
        { id: "c", index: 1, rect: rect(24, 80, 392, 200) },
        { id: "l", index: 2, rect: rect(24, 300, 392, 20) }
      ],
      length: 3,
      parentId: null,
      rect: rect(0, 0, 440, 600),
      wrap: false,
      z: -Infinity
    },
    {
      accepts: null,
      depth: 1,
      dir: "column",
      flow: true,
      id: "c",
      index: 1,
      items: [
        { id: "s", index: 0, rect: rect(40, 96, 100, 30) },
        { id: "b", index: 1, rect: rect(40, 140, 100, 40) }
      ],
      length: 2,
      parentId: null,
      rect: rect(24, 80, 392, 200),
      wrap: false,
      z: 0,
      ...extra
    }
  ];
}

const AT_1 = { edge: 8, empty: 24 };
const AT_HALF = { edge: 16, empty: 48 };

test("desenho: lugar de soltar na coluna, na linha e na linha com quebra", () => {
  const containers = columnSample();
  const drop = (x, y, options = AT_1) => geometry.freeFlowDropAt({ x, y }, containers, options);

  // Coluna: antes do primeiro, entre dois (a linha no meio do vao) e depois do ultimo.
  assert.deepEqual(drop(200, 10), { blocked: null, box: null, index: 0, line: rect(24, 24, 392, 0), parentId: null });
  assert.deepEqual(drop(200, 70), { blocked: null, box: null, index: 1, line: rect(24, 72, 392, 0), parentId: null });
  assert.deepEqual(drop(200, 330), { blocked: null, box: null, index: 3, line: rect(24, 320, 392, 0), parentId: null });

  // Dentro da caixa: box = o retangulo dela; a linha entre o Selo e o Botao.
  assert.deepEqual(drop(200, 130), { blocked: null, box: rect(24, 80, 392, 200), index: 1, line: rect(40, 133, 100, 0), parentId: "c" });
  assert.deepEqual(drop(200, 100), { blocked: null, box: rect(24, 80, 392, 200), index: 0, line: rect(40, 96, 100, 0), parentId: "c" });
  assert.deepEqual(drop(200, 250).index, 2, "depois do ultimo da caixa, longe da borda");

  // Caixa em linha: decide pelo x; a linha fica em pe.
  const row = [
    containers[0],
    { ...containers[1], dir: "row", items: [{ id: "i1", index: 0, rect: rect(40, 100, 40, 40) }, { id: "i2", index: 1, rect: rect(100, 100, 40, 40) }] }
  ];
  const rowDrop = geometry.freeFlowDropAt({ x: 90, y: 200 }, row, AT_1);
  assert.deepEqual({ index: rowDrop.index, line: rowDrop.line, parentId: rowDrop.parentId }, { index: 1, line: rect(90, 100, 0, 40), parentId: "c" });
  assert.equal(geometry.freeFlowDropAt({ x: 300, y: 200 }, row, AT_1).index, 2);
  assert.equal(geometry.freeFlowDropAt({ x: 30, y: 200 }, row, AT_1).index, 0);

  // Linha com quebra: o fim da primeira linha visual cai entre ela e a segunda.
  const wrap = [
    containers[0],
    {
      ...containers[1],
      dir: "row",
      items: [
        { id: "w0", index: 0, rect: rect(30, 90, 100, 20) },
        { id: "w1", index: 1, rect: rect(140, 90, 100, 20) },
        { id: "w2", index: 2, rect: rect(30, 120, 100, 20) }
      ],
      length: 3,
      wrap: true
    }
  ];
  const endOfFirst = geometry.freeFlowDropAt({ x: 300, y: 100 }, wrap, AT_1);
  assert.deepEqual({ index: endOfFirst.index, line: endOfFirst.line }, { index: 2, line: rect(240, 90, 0, 20) });
  const startOfSecond = geometry.freeFlowDropAt({ x: 40, y: 130 }, wrap, AT_1);
  assert.deepEqual({ index: startOfSecond.index, line: startOfSecond.line }, { index: 2, line: rect(30, 120, 0, 20) });
  assert.equal(geometry.freeFlowDropAt({ x: 300, y: 135 }, wrap, AT_1).index, 3);
  assert.equal(geometry.freeFlowDropAt({ x: 100, y: 100 }, wrap, AT_1).index, 1, "pelo x, dentro da linha do ponto");
});

test("desenho: a faixa da borda, a caixa vazia de 24 px, a caixa cheia, o empate e o ponto fora", () => {
  const containers = columnSample();

  // Faixa da borda (8 px de tela na escala 1): antes e depois da caixa, no pai.
  assert.deepEqual(geometry.freeFlowDropAt({ x: 200, y: 84 }, containers, AT_1), { blocked: null, box: null, index: 1, line: rect(24, 72, 392, 0), parentId: null });
  assert.deepEqual(geometry.freeFlowDropAt({ x: 200, y: 276 }, containers, AT_1), { blocked: null, box: null, index: 2, line: rect(24, 290, 392, 0), parentId: null });
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 94 }, containers, AT_1).parentId, "c", "a 14 px da borda, ja dentro");
  // Na escala 0,5 os 8 px de tela sao 16 px da prancheta.
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 94 }, containers, AT_HALF).parentId, null);
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 94 }, containers, AT_HALF).index, 1);
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 97 }, containers, AT_HALF).parentId, "c");

  // Numa caixa solta a faixa nao vale (ela nao esta na sequencia).
  const loose = columnSample({ flow: false, index: 3 });
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 84 }, loose, AT_1).parentId, "c");

  // A caixa vazia de 0 px recebe na zona de 24 px de tela (centrada); sem a zona, nao.
  const empty = [
    { ...containers[0], items: [containers[0].items[0], { id: "v", index: 1, rect: rect(24, 290, 392, 0) }, { id: "l", index: 2, rect: rect(24, 300, 392, 20) }] },
    { accepts: null, depth: 1, dir: "column", flow: true, id: "v", index: 1, items: [], length: 0, parentId: null, rect: rect(24, 290, 392, 0), wrap: false, z: 0 }
  ];
  assert.deepEqual(geometry.freeFlowDropAt({ x: 200, y: 290 }, empty, AT_1), { blocked: null, box: rect(24, 290, 392, 0), index: 0, line: rect(24, 290, 392, 0), parentId: "v" });
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 291 }, empty, AT_1).parentId, "v");
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 291 }, empty, { edge: 8, empty: 0 }).parentId, null);
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 280 }, empty, AT_1).parentId, null, "a faixa da borda da zona de 24 px (6 px)");
  assert.deepEqual(geometry.freeFlowEmptyRects(empty, 24), [rect(24, 278, 392, 24)], "o tracejado da caixa vazia, ja na zona de 24 px");
  assert.deepEqual(geometry.freeFlowEmptyRects(columnSample(), 24), []);

  // A caixa cheia recusa: o motivo vai em blocked e o lugar fica ao lado dela, no pai.
  const full = columnSample({ accepts: M.childrenPerBox });
  assert.deepEqual(geometry.freeFlowDropAt({ x: 200, y: 150 }, full, AT_1), { blocked: { id: "c", reason: M.childrenPerBox }, box: null, index: 1, line: rect(24, 72, 392, 0), parentId: null });
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 250 }, full, AT_1).index, 2);
  assert.deepEqual(geometry.freeFlowEmptyRects(full, 24), [], "a caixa que recusa nao ganha tracejado");

  // Empate na mesma profundidade: o z maior, depois o ultimo na lista (a ordem do DOM).
  const box = (id, z) => ({ accepts: null, depth: 1, dir: "column", flow: false, id, index: 0, items: [], length: 0, parentId: null, rect: rect(100, 100, 200, 200), wrap: false, z });
  const base = { ...containers[0], items: [] };
  assert.equal(geometry.freeFlowDropAt({ x: 150, y: 150 }, [base, box("p", 1), box("q", 0)], AT_1).parentId, "p");
  assert.equal(geometry.freeFlowDropAt({ x: 150, y: 150 }, [base, box("p", 0), box("q", 0)], AT_1).parentId, "q");

  // Fora da prancheta (ou sem a prancheta na lista): null.
  assert.equal(geometry.freeFlowDropAt({ x: -5, y: 10 }, containers, AT_1), null);
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 700 }, containers, AT_1), null);
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 100 }, containers.slice(1), AT_1), null);
});

test("desenho: o acerto pela ordem de pintura (z e a ordem do DOM entre os filhos da prancheta; dentro, o mais fundo)", () => {
  const T = (id) => ({ ...TEXT, id });
  const at = (value, rects, moving, x, y) => {
    const drop = geometry.freeFlowDropAt({ x, y }, editor.freeFlowContainers(value, rects, moving), AT_1);

    return drop && { index: drop.index, parentId: drop.parentId };
  };

  // [Caixa[Dentro[d1]], Solta (z 5, por cima)[s1], mover, Links]: o ponto esta sobre a Solta e sobre a Dentro.
  const over = (z) =>
    design([
      { children: [{ children: [T("d1")], id: "dentro", type: "box" }], id: "caixa", type: "box" },
      { children: [T("s1")], id: "solta", place: { mode: "free", w: 300, x: 60, y: 60, ...(z === undefined ? {} : { z }) }, type: "box" },
      T("mover"),
      LINKS
    ]);
  const overRects = {
    "@artboard": rect(0, 0, 440, 500),
    caixa: rect(24, 24, 392, 200),
    d1: rect(56, 56, 100, 24),
    dentro: rect(40, 40, 360, 160),
    links: rect(24, 440, 392, 20),
    mover: rect(24, 240, 392, 40),
    s1: rect(70, 70, 100, 24),
    solta: rect(60, 60, 300, 120)
  };
  assert.deepEqual(at(over(5), overRects, { id: "mover" }, 200, 150), { index: 1, parentId: "solta" }, "a Solta e desenhada por cima");
  assert.ok(valid(editor.moveFreeNodeTo(over(5), "mover", { index: 1, parentId: "solta" }).design));
  assert.deepEqual(at(over(undefined), overRects, { id: "mover" }, 200, 150), { index: 1, parentId: "solta" }, "com z igual, vale a ordem do DOM (a Solta vem depois)");
  assert.deepEqual(at(over(-1), overRects, { id: "mover" }, 200, 150), { index: 1, parentId: "dentro" }, "mandada para tras, a Solta perde e vale o mais fundo da Caixa");
  assert.deepEqual(at(over(5), overRects, { id: "mover" }, 380, 150), { index: 1, parentId: "dentro" }, "fora da Solta, o mais fundo da Caixa");
  assert.deepEqual(at(over(5), overRects, { height: 0 }, 200, 150), { index: 1, parentId: "solta" }, "o elemento novo do painel usa a mesma conta");

  // [Fundo (caixa solta z -1 cobrindo a prancheta, vazia), Titulo, Texto (arrastado), Links].
  const back = (z) =>
    design([{ children: [], id: "fundo", place: { h: 400, mode: "free", w: 440, x: 0, y: 0, ...(z === undefined ? {} : { z }) }, type: "box" }, TITLE, TEXT, LINKS]);
  const backRects = { "@artboard": rect(0, 0, 440, 400), fundo: rect(0, 0, 440, 400), links: rect(24, 360, 392, 20), texto: rect(24, 72, 392, 40), titulo: rect(24, 24, 392, 40) };
  // O Titulo (z 0) tapa o Fundo: o Texto entra antes do Titulo, na sequencia da prancheta.
  const top = at(back(-1), backRects, { id: "texto" }, 200, 30);
  assert.deepEqual(top, { index: 1, parentId: null });
  assert.deepEqual(ids(editor.moveFreeNodeTo(back(-1), "texto", top).design.children), ["fundo", "texto", "titulo", "links"]);
  assert.deepEqual(at(back(-1), backRects, { id: "texto" }, 200, 60), { index: 2, parentId: null }, "a metade de baixo do Titulo e o lugar de hoje");
  // Soltar em cima do proprio Texto (um tremor) e o lugar de hoje: ele tapa o Fundo e nada muda.
  const same = at(back(-1), backRects, { id: "texto" }, 200, 90);
  assert.deepEqual(same, { index: 2, parentId: null });
  assert.equal(editor.freeMoveProblem(back(-1), "texto", same), "");
  // Onde so o Fundo esta desenhado, ele recebe.
  assert.deepEqual(at(back(-1), backRects, { id: "texto" }, 200, 200), { index: 0, parentId: "fundo" });
  // O elemento novo do painel: o mesmo.
  assert.deepEqual(at(back(-1), backRects, { height: 0 }, 200, 30), { index: 1, parentId: null });
  // Com z 0 o Fundo vem antes no DOM e continua atras do Titulo; com z 1 ele fica por cima e recebe.
  assert.deepEqual(at(back(undefined), backRects, { id: "texto" }, 200, 30), { index: 1, parentId: null });
  assert.deepEqual(at(back(1), backRects, { id: "texto" }, 200, 30), { index: 0, parentId: "fundo" });

  // Um solto que nao e caixa, desenhado por cima, tapa a caixa (vale o que se ve); mandado para tras, nao.
  const shaped = (z) =>
    design([
      { children: [T("e1")], id: "caixa", type: "box" },
      { id: "forma", place: { h: 120, mode: "free", w: 120, x: 200, y: 40, ...(z === undefined ? {} : { z }) }, type: "shape" },
      T("mover"),
      LINKS
    ]);
  const shapedRects = { "@artboard": rect(0, 0, 440, 500), caixa: rect(24, 24, 392, 200), e1: rect(40, 40, 100, 24), forma: rect(200, 40, 120, 120), links: rect(24, 440, 392, 20), mover: rect(24, 240, 392, 40) };
  assert.deepEqual(at(shaped(undefined), shapedRects, { id: "mover" }, 250, 100), { index: 0, parentId: null });
  assert.deepEqual(at(shaped(-1), shapedRects, { id: "mover" }, 250, 100), { index: 1, parentId: "caixa" });

  // A foto do comeco guarda os filhos desenhados da prancheta, com a camada (quem se move tambem; o escondido, nao).
  const layered = editor.freeFlowContainers(design([...back(-1).children, { ...spacer("oculto"), hidden: true }]), { ...backRects, oculto: rect(0, 0, 10, 10) }, { id: "texto" });
  assert.deepEqual(
    layered[0].layers.map((layer) => [layer.id, layer.index, layer.z]),
    [["fundo", 0, -1], ["titulo", 1, 0], ["texto", 2, 0], ["links", 3, 0]]
  );
  assert.equal(layered.slice(1).some((container) => "layers" in container), false, "so na prancheta");
});

test("desenho: soltar no mesmo vão não muda nada (soltos, escondidos e a prancheta sem itens)", () => {
  // [Titulo, Texto (arrastado), Forma solta, Links]: entre o Titulo e os Links e o lugar de hoje do Texto.
  const value = design([TITLE, TEXT, { id: "forma", place: { h: 120, mode: "free", w: 120, x: 100, y: 100 }, type: "shape" }, LINKS]);
  const rects = { "@artboard": rect(0, 0, 440, 400), forma: rect(100, 100, 120, 120), links: rect(24, 140, 392, 20), texto: rect(24, 80, 392, 40), titulo: rect(24, 24, 392, 40) };
  const containers = editor.freeFlowContainers(value, rects, { id: "texto" });
  const same = geometry.freeFlowDropAt({ x: 200, y: 100 }, containers, AT_1);

  assert.equal(same.index, 1, "o vao entre o Titulo e os Links vale o lugar de hoje");
  assert.equal(editor.freeMoveProblem(value, "texto", same), "");
  assert.equal(editor.moveFreeNodeTo(value, "texto", same), null, "nenhum passo no historico");
  // Sem a casa (um elemento novo), o mesmo ponto daria depois da Forma.
  assert.equal(geometry.freeFlowDropAt({ x: 200, y: 100 }, editor.freeFlowContainers(value, rects, { height: 0 }).map((container) => ({ ...container, home: null })), AT_1).index, 3);
  // Acima do Titulo e mudanca de verdade.
  const above = geometry.freeFlowDropAt({ x: 200, y: 10 }, containers, AT_1);
  assert.equal(above.index, 0);
  assert.equal(editor.freeMoveProblem(value, "texto", above), null);

  // Um escondido no meio: o mesmo.
  const hidden = design([TITLE, { ...spacer("oculto"), hidden: true }, TEXT, LINKS]);
  const hiddenDrop = geometry.freeFlowDropAt({ x: 200, y: 100 }, editor.freeFlowContainers(hidden, rects, { id: "texto" }), AT_1);
  assert.equal(hiddenDrop.index, 2);
  assert.equal(editor.freeMoveProblem(hidden, "texto", hiddenDrop), "");

  // A prancheta so com soltos e o arrastado: sem itens, o lugar de hoje.
  const alone = design([TEXT, { id: "forma", place: { h: 120, mode: "free", w: 120, x: 100, y: 100 }, type: "shape" }]);
  const aloneDrop = geometry.freeFlowDropAt({ x: 200, y: 300 }, editor.freeFlowContainers(alone, rects, { id: "texto" }), AT_1);
  assert.equal(aloneDrop.index, 0);
  assert.equal(editor.freeMoveProblem(alone, "texto", aloneDrop), "");

  // Numa caixa: a faixa da borda da caixa vizinha tambem e o mesmo vao.
  const boxed = design([TEXT, { id: "forma", place: { h: 120, mode: "free", w: 120, x: 100, y: 100 }, type: "shape" }, { children: [spacer("e1")], id: "caixa", type: "box" }, LINKS]);
  const boxedRects = { "@artboard": rect(0, 0, 440, 400), caixa: rect(24, 80, 392, 100), e1: rect(40, 96, 100, 40), links: rect(24, 200, 392, 20), texto: rect(24, 24, 392, 40) };
  const edge = geometry.freeFlowDropAt({ x: 200, y: 82 }, editor.freeFlowContainers(boxed, boxedRects, { id: "texto" }), AT_1);
  assert.deepEqual({ index: edge.index, parentId: edge.parentId }, { index: 0, parentId: null });
  assert.equal(editor.freeMoveProblem(boxed, "texto", edge), "");
});

test("o ponto da tela em px da prancheta: a borda, o zoom e o Celular", () => {
  // Escala <= 0 (ou invalida) vale 1.
  assert.deepEqual(geometry.freeArtboardPoint({ x: 110, y: 60 }, { x: 10, y: 10 }, 0), { x: 100, y: 50 });
  assert.deepEqual(geometry.freeArtboardPoint({ x: 110, y: 60 }, { x: 10, y: 10 }, -2), { x: 100, y: 50 });
  assert.deepEqual(geometry.freeArtboardPoint({ x: 110, y: 60 }, { x: 10, y: 10 }, Number.NaN), { x: 100, y: 50 });

  // A origem e o canto de dentro da borda: box.left + clientLeft x perLayout (a conta de measure no desenho).
  const originOf = (box, clientLeft, clientTop, layoutWidth) => {
    const perLayout = box.width / layoutWidth;

    return { x: box.left + clientLeft * perLayout, y: box.top + clientTop * perLayout };
  };

  // Computador a 100 %: W 440, borda de 2 px.
  const full = { left: 300, top: 100, width: 440 };
  assert.deepEqual(geometry.freeArtboardPoint({ x: 402, y: 152 }, originOf(full, 2, 2, 440), 440 / 440), { x: 100, y: 50 });

  // Zoom 0,5: a prancheta mede 220 px de tela; a borda de 2 px vale 1 px de tela.
  const half = { left: 300, top: 100, width: 220 };
  assert.deepEqual(originOf(half, 2, 2, 440), { x: 301, y: 101 });
  assert.deepEqual(geometry.freeArtboardPoint({ x: 351, y: 126 }, originOf(half, 2, 2, 440), 220 / 440), { x: 100, y: 50 });

  // Celular: o cartao tem 343 px para W 440 (a escala e 343/440); o meio do cartao e o meio da prancheta.
  const phone = { left: 16, top: 40, width: 343 };
  const point = geometry.freeArtboardPoint({ x: 16 + 343 / 2, y: 40 + 343 / 4 }, originOf(phone, 0, 0, 343), 343 / 440);
  assert.ok(Math.abs(point.x - 220) < 1e-9 && Math.abs(point.y - 110) < 1e-9, JSON.stringify(point));
});

/* ------------------------------------------------------------------------------------------------
 * Celular: a ordem e uma so
 * ---------------------------------------------------------------------------------------------- */

test("Celular: o lugar sai do desenho do celular e a ordem muda nos dois aparelhos", () => {
  const real = design([TITLE, { children: [BADGE, CLOSE], id: "caixa", type: "box" }, LINKS], { devices: { mobile: { nodes: { caixa: { layout: { dir: "row" } } } } } });
  const stage = render.resolveFreeForDevice(real, "mobile");
  const rects = { "@artboard": rect(0, 0, 440, 400), botao: rect(120, 90, 100, 40), caixa: rect(24, 80, 392, 60), links: rect(24, 160, 392, 20), selo: rect(32, 90, 80, 40), titulo: rect(24, 24, 392, 40) };

  // A Caixa e coluna no computador e linha so no celular: com o Celular, a escolha e pelo x.
  const drop = geometry.freeFlowDropAt({ x: 300, y: 100 }, editor.freeFlowContainers(stage, rects, { id: "selo" }), AT_1);
  assert.deepEqual({ index: drop.index, parentId: drop.parentId }, { index: 2, parentId: "caixa" }, "a direita do Botao");
  assert.equal(
    geometry.freeFlowDropAt({ x: 300, y: 100 }, editor.freeFlowContainers(real, rects, { id: "selo" }), AT_1).index,
    0,
    "no computador (coluna) o mesmo ponto, acima do meio do Botao, e o lugar de hoje do Selo"
  );

  // O indice vale no design de verdade: muda children, devices fica.
  const moved = editor.moveFreeNodeTo(real, "selo", drop);
  assert.deepEqual(ids(find(moved.design, "caixa").node.children), ["botao", "selo"]);
  assert.deepEqual(moved.design.devices, real.devices);
  assert.deepEqual(order(render.resolveFreeForDevice(moved.design, "desktop")), order(render.resolveFreeForDevice(moved.design, "mobile")));
  assert.deepEqual(order(moved.design), ["titulo", "caixa", "botao", "selo", "links"]);

  // Um irmao escondido so no celular fica antes do proximo visivel.
  const withHidden = design([TITLE, TEXT, { children: [BADGE, { ...spacer("oculto") }, CLOSE], id: "caixa", type: "box" }, LINKS], {
    devices: { mobile: { nodes: { caixa: { layout: { dir: "row" } }, oculto: { hidden: true } } } }
  });
  const hiddenRects = { ...rects, texto: rect(24, 300, 392, 20) };
  const between = geometry.freeFlowDropAt({ x: 116, y: 110 }, editor.freeFlowContainers(render.resolveFreeForDevice(withHidden, "mobile"), hiddenRects, { id: "texto" }), AT_1);
  assert.deepEqual({ index: between.index, parentId: between.parentId }, { index: 2, parentId: "caixa" });
  const placed = editor.moveFreeNodeTo(withHidden, "texto", between);
  assert.deepEqual(ids(find(placed.design, "caixa").node.children), ["selo", "oculto", "texto", "botao"]);
  assert.deepEqual(placed.design.devices, withHidden.devices);
});

/* ------------------------------------------------------------------------------------------------
 * Elemento novo onde soltou
 * ---------------------------------------------------------------------------------------------- */

test("elemento novo onde soltou: o vão da sequência, a Forma e o Degradê pelo ponto e os mesmos limites", () => {
  const base = design([TITLE, { children: [BADGE, CLOSE], id: "caixa", type: "box" }, LINKS]);

  // O Texto entra na caixa no indice escolhido.
  const text = editor.addFreeElement(base, "text", { at: { index: 1, parentId: "caixa" } });
  assert.deepEqual(ids(find(text.design, "caixa").node.children), ["selo", text.id, "botao"]);
  assert.ok(valid(text.design));
  assert.deepEqual(ids(editor.addFreeElement(base, "divider", { at: { index: 3, parentId: null } }).design.children), ["titulo", "caixa", "links", "linha"], "o vao depois dos Links tambem vale");

  // Uma Caixa em linha numa caixa interna: a profundidade; numa caixa cheia: as 20.
  const nested = design([{ children: [{ children: [], id: "dentro", type: "box" }], id: "fora", type: "box" }, LINKS]);
  assert.deepEqual(editor.addFreeElement(nested, "row", { at: { index: 0, parentId: "dentro" } }), { reason: M.depth });
  assert.equal(editor.addFreeElement(nested, "text", { at: { index: 0, parentId: "dentro" } }).design.children[0].children[0].children.length, 1);
  const full = design([{ children: Array.from({ length: 20 }, (_, index) => spacer(`e${index}`)), id: "cheia", type: "box" }, LINKS]);
  assert.deepEqual(editor.addFreeElement(full, "text", { at: { index: 0, parentId: "cheia" } }), { reason: M.childrenPerBox });
  assert.deepEqual(editor.addFreeElement(base, "text", { at: { index: 0, parentId: "titulo" } }), { reason: M.design }, "o pai nao e uma caixa");
  assert.deepEqual(editor.addFreeElement(base, "text", { at: { index: 4, parentId: null } }), { reason: M.design }, "o indice fora da lista");

  // A Forma ignora at: entra pelo centro, na prancheta antes dos Links.
  const shape = editor.addFreeElement(base, "shape", { at: { index: 0, parentId: "caixa" }, center: { x: 220, y: 100 } });
  assert.deepEqual(ids(shape.design.children), ["titulo", "caixa", "forma", "links"]);
  assert.deepEqual(shape.node.place, { h: 120, mode: "free", w: 120, x: 160, y: 40 });

  // O Degradê com o meio na altura do ponto (nunca acima do topo); sem centro, no topo como hoje.
  assert.equal(editor.addFreeElement(base, "gradient", { center: { x: 0, y: 300 } }).node.place.y, 200);
  assert.equal(editor.addFreeElement(base, "gradient", { center: { x: 0, y: 10 } }).node.place.y, 0);
  assert.equal(editor.addFreeElement(base, "gradient").node.place.y, 0);
  assert.equal(editor.addFreeElement(base, "gradient", { center: { x: 50, y: 300 } }).node.place.x, 0, "o x continua 0 e a largura e a da prancheta");

  // Os limites do clique valem igual.
  const thirtyTwo = design(Array.from({ length: 32 }, (_, index) => spacer(`e${index}`)));
  assert.deepEqual(editor.addFreeElement(thirtyTwo, "heading", { at: { index: 0, parentId: null } }), { reason: M.nodes });
  const withCta = design([{ action: { kind: "cta" }, id: "principal", type: "button" }, LINKS]);
  assert.deepEqual(editor.addFreeElement(withCta, "cta", { at: { index: 0, parentId: null } }), { reason: C.elements.ctaExists });

  // O jeito de cada elemento no desenho.
  const shapeSpec = editor.freeNewNodeDropSpec(base, "shape");
  assert.equal(shapeSpec.free, true);
  assert.deepEqual(shapeSpec.rectAt({ x: 220, y: 100 }), rect(160, 40, 120, 120));
  const gradientSpec = editor.freeNewNodeDropSpec(base, "gradient");
  assert.equal(gradientSpec.free, true);
  assert.deepEqual(gradientSpec.rectAt({ x: 10, y: 300 }), rect(0, 200, 440, 200));
  assert.deepEqual(editor.freeNewNodeDropSpec(base, "column"), { free: false, height: 1 });
  assert.deepEqual(editor.freeNewNodeDropSpec(base, "row"), { free: false, height: 1 });
  assert.deepEqual(editor.freeNewNodeDropSpec(base, "text"), { free: false, height: 0 });
  assert.deepEqual(editor.freeNewNodeDropSpec(base, "cta"), { free: false, height: 0 });

  // Um passo: desfazer tira o elemento e devolve o cta de antes.
  const added = editor.addFreeElement(base, "cta", { at: { index: 1, parentId: null } });
  assert.deepEqual(ids(added.design.children), ["titulo", "principal", "caixa", "links"]);
  const start = history.createFreeHistory({ cta: null, design: base });
  const pushed = history.pushFreeHistory(start, { cta: editor.freeCtaForNewButton(null), design: added.design });
  assert.equal(pushed.past.length, 1);
  const undone = history.undoFreeHistory(pushed);
  assert.equal(undone.present.design, base);
  assert.equal(undone.present.cta, null);

  // Sem at, o mesmo de antes (no fim, antes dos Links).
  assert.deepEqual(ids(editor.addFreeElement(base, "heading").design.children), ["titulo", "caixa", "titulo2", "links"]);
});

test("elemento novo solto perto do fundo de uma prancheta alta: a Forma e o Degradê ficam no limite e o design vale", () => {
  // Espacos de 1600 e 1200 px: a prancheta passa de 2400 px, o limite de y de um solto.
  const tall = design([{ ...spacer("a"), place: { height: 1600, mode: "flow" } }, { ...spacer("b"), place: { height: 1200, mode: "flow" } }, LINKS]);
  const L = model.FREE_DESIGN_LIMITS;
  assert.ok(valid(tall));

  const gradient = editor.addFreeElement(tall, "gradient", { center: { x: 200, y: 2600 } });
  assert.equal(gradient.node.place.y, L.y.max);
  assert.ok(valid(gradient.design), "o Degrade com o meio em y 2600");
  const shape = editor.addFreeElement(tall, "shape", { center: { x: 200, y: 2470 } });
  assert.deepEqual({ x: shape.node.place.x, y: shape.node.place.y }, { x: 140, y: L.y.max });
  assert.ok(valid(shape.design), "a Forma com o centro em y 2470");

  // O indicador do desenho mostra o mesmo lugar que entra.
  assert.deepEqual(editor.freeNewNodeDropSpec(tall, "gradient").rectAt({ x: 200, y: 2600 }), rect(0, L.y.max, 440, 200));
  assert.deepEqual(editor.freeNewNodeDropSpec(tall, "shape").rectAt({ x: 200, y: 2470 }), rect(140, L.y.max, 120, 120));

  // O x e o y da Forma ficam nos limites de um solto, para qualquer centro.
  const far = editor.addFreeElement(tall, "shape", { center: { x: 5000, y: -5000 } });
  assert.deepEqual({ x: far.node.place.x, y: far.node.place.y }, { x: L.x.max, y: L.y.min });
  assert.ok(valid(far.design));
  const left = editor.addFreeElement(tall, "shape", { center: { x: -5000, y: 5000 } });
  assert.deepEqual({ x: left.node.place.x, y: left.node.place.y }, { x: L.x.min, y: L.y.max });
  assert.ok(valid(left.design));
});

/* ------------------------------------------------------------------------------------------------
 * Guardas de fonte: o editor e o desenho
 * ---------------------------------------------------------------------------------------------- */

test("o editor liga o mover: o ramo move, um passo sem juntar e a frase do Celular em toda mudança de ordem", () => {
  const source = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-editor.tsx", import.meta.url), "utf8");

  assert.match(source, /if \(command\.kind === "move"\) \{\s*moveTo\(command\.id, command\.target\);/, "o ramo move das Camadas");

  const moveTo = source.match(/function moveTo\([\s\S]*?\n {2}}\n/)?.[0] ?? "";
  assert.match(moveTo, /freeMoveProblem\(present\.design, id, target\)/);
  assert.match(moveTo, /commitDesign\(result\.design\);/);
  assert.equal(/coalesceKey/.test(moveTo), false, "um gesto e um passo proprio");
  assert.match(moveTo, /announce\(orderPhrase\(freeMoveAnnouncement\(result\.design, id, present\.cta, \{ becameFlow: result\.becameFlow \}\)\)\)/);

  assert.match(source, /function orderPhrase\(text: string\) \{\s*return deviceRef\.current === "mobile" \? `\$\{text\} \$\{copy\.drag\.alsoDesktop\}` : text;/);
  assert.match(source, /announce\(orderPhrase\(kind === "moveUp" \? copy\.announce\.upward : copy\.announce\.downward\)\)/);
  assert.match(source, /announce\(orderPhrase\(copy\.announce\.outOfBox\)\)/);
  assert.match(source, /announce\(orderPhrase\(result\.becameFlow \? copy\.announce\.toSequence : copy\.announce\.intoBox\)\)/);
  assert.match(source, /announce\(orderPhrase\(copy\.announce\.toFree\)\)/, "o Soltar tambem muda o lugar em children");
  assert.match(source, /announce\(orderPhrase\(copy\.announce\.toSequence\)\)/, "o Seguir a sequencia tambem");
  assert.match(source, /const problem = freeOutOfBoxProblem\(present\.design, id\);/, "o Tirar com a caixa de fora cheia fala a frase");

  // O painel Elementos: o mesmo caminho do clique, o lugar pelo previewDrop do desenho e a limpeza no fim.
  assert.match(source, /function add\(kind: FreeCatalogKind, drop: FreeCanvasDrop \| null = null\)/);
  assert.match(source, /const at = drop\?\.kind === "flow" \? \{ index: drop\.index, parentId: drop\.parentId \} : undefined;/);
  assert.match(source, /addFreeElement\(present\.design, kind, \{ at, center, selectedId: activeId \}\)/);
  assert.match(source, /api\?\.previewDrop\?\.\(null, null\);/);
  assert.match(source, /onDragEnd=\{onElementDragEnd\} onDragMove=\{onElementDragMove\}/);
  assert.match(source, /device=\{device\}\s+disabled=\{disabled\}\s+flagged=\{flagged\}/, "as Camadas sabem do Celular");
  assert.match(source, /onMoveInFlow=\{moveTo\}/);
});

test("o desenho mostra o lugar de soltar: previewDrop no apiRef e as etiquetas de 12 px", () => {
  const source = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-canvas.tsx", import.meta.url), "utf8");
  const api = source.match(/apiRef\.current = \{[\s\S]*?visibleCenter:/)?.[0] ?? "";

  assert.match(api, /previewDrop: \(client, spec\) =>/);
  assert.match(api, /freeFlowContainers\(designRef\.current, rectsRef\.current, \{ height: spec\.height \}\)/, "o desenho do aparelho que se ve");
  assert.match(api, /edge: FREE_DROP_EDGE_SCREEN_PX \/ at\.scale/);
  assert.equal(/both: true/.test(api), false, "um elemento novo nao e mudanca de ordem: sem a etiqueta do Celular");
  assert.match(source, /text-\[12px\][^"]*" data-free-drop-both="">\s*\{copy\.drag\.alsoDesktopTag\}/);
  assert.match(source, /text-\[12px\][^"]*" data-free-drop-hint="">/);
  assert.match(source, /data-free-drop-line=""/);
  assert.match(source, /data-free-drop-target=""/);
  assert.match(source, /data-free-drop-new=""/);
  assert.match(source, /data-free-drop-empty=""/);
  assert.match(source, /data-free-flow-origin=""/);
  assert.match(source, /rectsRef\.current = rects;/);
  assert.match(source, /!session && !dropView \?/, "com o indicador, o contorno de passar o mouse some");
});

test("o desenho só desenha a alça quando o arrastar pode começar (num filho de solto girado, não)", () => {
  const source = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-canvas.tsx", import.meta.url), "utf8");

  // Uma vez por selecao (e quando o design ou as medidas mudam), nao a cada desenho.
  assert.match(
    source,
    /const flowGrip = useMemo\(\s*\(\) => canMoveInFlow && !disabled && selectedId !== null && freeFlowDraggable\(design, rects, selectedId\),\s*\[canMoveInFlow, design, disabled, rects, selectedId\]\s*\);/
  );
  assert.equal(source.match(/data-free-flow-grip=""/g)?.length, 1, "uma alca so");
  const grip = source.match(/\{flowGrip \? \([\s\S]*?\) : null\}/)?.[0] ?? "";
  assert.match(grip, /data-free-flow-grip=""/, "a alca fica dentro do flowGrip");
  assert.match(grip, /beginFlowDrag\(event, selectedNode\.id\)/);
  // O gesto confere a mesma regra: a alca e o corpo comecam (ou nao) juntos.
  assert.match(source, /function beginFlowDrag\(event: ReactPointerEvent<HTMLElement>, id: FreeId\) \{\s*if \(disabled \|\| !onMoveInFlow \|\| !freeFlowDraggable\(design, rects, id\)\) \{\s*return;/);
});
