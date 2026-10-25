import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Editor Livre do pop-up, L4b (docs/27 §13.10; docs/18 §1.1), pacote de selecao de varios, puro: quem esta escolhido
// (vivo, sem caixa junto com algo dentro), por ou tirar, o intervalo das Camadas, o Ctrl + A, o Esc ao pai comum, a
// pilha do Alt + clique, mover junto com o limite do grupo (e o Celular so em devices.mobile), a chave de juntar
// passos, alinhar entre si e no pop-up (cada um, pela caixa que se ve), os espacos iguais, duplicar (Links, Áudio e
// Vídeo de fora, atomico nos limites), excluir (Links e Áudio ficam), esconder, travar, a camada, a descricao do
// palco, os motivos do painel Varios e as frases palavra por palavra. Tudo carregado direto pelo Node.

const selection = await import("../src/components/admin/v2/communication/popup-free/free-editor-selection.ts");
const editor = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
const inspector = await import("../src/components/admin/v2/communication/popup-free/free-inspector-model.ts");
const model = await import("../src/server/communications/popup-free-model.ts");
const render = await import("../src/server/communications/popup-free-render.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");

const M = schema.POPUP_FREE_MESSAGES;
const S = selection.FREE_SELECTION_COPY;
const E = editor.FREE_EDITOR_COPY;
const CTA = { href: "/minhas-compras", label: "Quero ver", target: "new_tab" };
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete", "fluxo"];

function design(children, extra = {}) {
  return model.canonicalPopupFreeDesign({ children, mode: "free", version: 1, ...extra });
}

const TITLE = { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" };
const TEXT = { id: "texto", lines: [[{ text: "Assista hoje." }]], type: "text" };
const LINKS = { id: "links", type: "links" };
const AUDIO = { id: "audio", type: "audio" };
const CTA_NODE = { action: { kind: "cta" }, id: "principal", type: "button" };
const spacer = (id) => ({ id, type: "spacer" });
const forma = (id, x, y, w = 40, h = 40, extra = {}) => ({ id, type: "shape", ...extra, place: { h, mode: "free", w, x, y, ...extra.place } });
const rect = (x, y, w, h) => ({ h, w, x, y });

function find(value, id) {
  return model.findFreeNode(value, id);
}

function placeOf(value, id) {
  return find(value, id).node.place;
}

function mobilePlaceOf(value, id) {
  return value.devices?.mobile?.nodes?.[id]?.place;
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

/** Os retangulos medidos de um design: a prancheta e cada solto pela posicao dele (como o desenho mede). */
function measured(value, artboard = { h: 400, w: 440 }, device = "desktop") {
  const out = { "@artboard": rect(0, 0, artboard.w, artboard.h) };

  model.walkFreeNodes(value.children, (node) => {
    const place = device === "mobile" ? (editor.freeMobileFreePlace(value, node.id) ?? node.place) : node.place;

    out[node.id] = place?.mode === "free" ? rect(place.x, place.y, place.w, place.h ?? 30) : rect(0, 0, artboard.w, 30);
  });

  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Quem esta escolhido
 * ---------------------------------------------------------------------------------------------- */

test("seleção viva, normalizada (caixa e filho: fica o último) e pôr ou tirar com added", () => {
  const inner = { children: [{ id: "folha", label: "Novo", type: "badge" }], id: "dentro", type: "box" };
  const box = { children: [{ id: "selo", label: "Novo", type: "badge" }, inner], id: "caixa", type: "box" };
  const base = design([TITLE, forma("a", 10, 10), forma("b", 80, 10), box, LINKS]);

  // Viva: so ids com elemento, sem repetidos, na ordem recebida.
  assert.deepEqual(selection.freeSelectionLive(base, ["a", "nada", "b", "a"]), ["a", "b"]);
  assert.deepEqual(selection.freeSelectionLive(base, []), []);

  // Caixa e algo dentro dela (em qualquer nivel) nunca ficam juntos: fica o escolhido por ultimo.
  assert.deepEqual(selection.freeNormalizeSelection(base, ["caixa", "selo"]), ["selo"]);
  assert.deepEqual(selection.freeNormalizeSelection(base, ["selo", "caixa"]), ["caixa"]);
  assert.deepEqual(selection.freeNormalizeSelection(base, ["caixa", "folha"]), ["folha"]);
  assert.deepEqual(selection.freeNormalizeSelection(base, ["folha", "caixa"]), ["caixa"]);
  assert.deepEqual(selection.freeNormalizeSelection(base, ["a", "caixa", "b", "selo", "nada", "a"]), ["a", "b", "selo"]);
  assert.deepEqual(selection.freeNormalizeSelection(base, ["selo", "folha"]), ["selo", "folha"], "irmaos e primos ficam juntos");

  // Por: vai para o fim (vira o principal).
  assert.deepEqual(selection.freeToggleInSelection(base, ["a"], "b"), { added: true, ids: ["a", "b"] });
  // Tirar: os outros ficam na ordem.
  assert.deepEqual(selection.freeToggleInSelection(base, ["a", "b", "titulo"], "a"), { added: false, ids: ["b", "titulo"] });
  assert.deepEqual(selection.freeToggleInSelection(base, ["a"], "a"), { added: false, ids: [] });
  // Por um filho de uma caixa escolhida: a caixa sai, fica o filho.
  assert.deepEqual(selection.freeToggleInSelection(base, ["a", "caixa"], "selo"), { added: true, ids: ["a", "selo"] });
  // Um id que nao existe nao entra.
  assert.deepEqual(selection.freeToggleInSelection(base, ["a"], "nada"), { added: false, ids: ["a"] });
});

test("intervalo das Camadas entre irmãos, terminando no principal; null sem âncora ou com pais diferentes", () => {
  const box = { children: [spacer("s1"), spacer("s2"), spacer("s3")], id: "caixa", type: "box" };
  const base = design([forma("a", 0, 0), forma("b", 0, 0), TITLE, TEXT, box, LINKS]);

  assert.deepEqual(selection.freeSelectionRange(base, "b", "texto"), ["b", "titulo", "texto"]);
  // De baixo para cima: na ordem de children, mas o id clicado por ultimo (o principal).
  assert.deepEqual(selection.freeSelectionRange(base, "texto", "b"), ["titulo", "texto", "b"]);
  assert.deepEqual(selection.freeSelectionRange(base, "a", "a"), ["a"]);
  assert.deepEqual(selection.freeSelectionRange(base, "s1", "s3"), ["s1", "s2", "s3"]);
  assert.deepEqual(selection.freeSelectionRange(base, "s3", "s2"), ["s3", "s2"]);

  assert.equal(selection.freeSelectionRange(base, null, "a"), null, "sem ancora");
  assert.equal(selection.freeSelectionRange(base, "nada", "a"), null, "ancora que nao existe mais");
  assert.equal(selection.freeSelectionRange(base, "s1", "a"), null, "pais diferentes");
  assert.equal(selection.freeSelectionRange(base, "a", "s2"), null, "pais diferentes");
  assert.equal(selection.freeSelectionRange(base, "a", "nada"), null);
});

test("Ctrl + A: irmãos do principal (ou o primeiro nível), sem travados nem escondidos no aparelho do Ver como", () => {
  const box = { children: [{ id: "selo", label: "Novo", type: "badge" }, { ...TEXT, id: "texto2" }, { ...spacer("s9"), locked: true }], id: "caixa", type: "box" };
  const base = design(
    [TITLE, forma("a", 0, 0), forma("travada", 0, 0, 40, 40, { locked: true }), forma("c", 0, 0), forma("sumida", 0, 0, 40, 40, { hidden: true }), box, LINKS],
    { devices: { mobile: { nodes: { c: { hidden: true } } } } }
  );
  const desktop = render.resolveFreeForDevice(base, "desktop");
  const mobile = render.resolveFreeForDevice(base, "mobile");

  assert.deepEqual(selection.freeSelectAllIds(desktop, null), ["titulo", "a", "c", "caixa", "links"]);
  // No Celular, o escondido so no celular fica de fora.
  assert.deepEqual(selection.freeSelectAllIds(mobile, null), ["titulo", "a", "caixa", "links"]);
  // O principal vai para o fim.
  assert.deepEqual(selection.freeSelectAllIds(desktop, "a"), ["titulo", "c", "caixa", "links", "a"]);
  // Dentro de uma caixa: os irmaos dele, sem o travado.
  assert.deepEqual(selection.freeSelectAllIds(desktop, "selo"), ["texto2", "selo"]);
  // O principal fica mesmo travado (foi escolhido).
  assert.deepEqual(selection.freeSelectAllIds(desktop, "travada"), ["titulo", "a", "c", "caixa", "links", "travada"]);
  // Principal que nao existe: o primeiro nivel.
  assert.deepEqual(selection.freeSelectAllIds(desktop, "nada"), ["titulo", "a", "c", "caixa", "links"]);
});

test("Esc: um vai à caixa de fora; vários ao pai comum quando é uma caixa; mistos e na prancheta dão nada", () => {
  const inner = { children: [spacer("f1"), spacer("f2")], id: "dentro", type: "box" };
  const box = { children: [{ id: "selo", label: "Novo", type: "badge" }, { ...TEXT, id: "texto2" }, inner], id: "caixa", type: "box" };
  const base = design([forma("a", 0, 0), TITLE, box, LINKS]);

  assert.equal(selection.freeSelectionEscape(base, ["selo"]), "caixa");
  assert.equal(selection.freeSelectionEscape(base, ["a"]), null);
  assert.equal(selection.freeSelectionEscape(base, ["selo", "texto2"]), "caixa");
  assert.equal(selection.freeSelectionEscape(base, ["f1", "f2"]), "dentro");
  assert.equal(selection.freeSelectionEscape(base, ["selo", "a"]), null, "pais diferentes");
  assert.equal(selection.freeSelectionEscape(base, ["selo", "f1"]), null, "niveis diferentes");
  assert.equal(selection.freeSelectionEscape(base, ["a", "titulo"]), null, "na prancheta");
  assert.equal(selection.freeSelectionEscape(base, []), null);
  assert.equal(selection.freeSelectionEscape(base, ["nada", "selo"]), "caixa", "so os vivos contam");
});

/* ------------------------------------------------------------------------------------------------
 * Alt + clique: a pilha do ponto
 * ---------------------------------------------------------------------------------------------- */

/** Um elemento falso do DOM: atributos, pai e o closest de verdade (sobe pelos pais). */
function el(attrs = {}, parent = null) {
  const node = {
    attrs,
    closest(selector) {
      for (let current = node; current; current = current.parent) {
        if (matches(current, selector)) {
          return current;
        }
      }

      return null;
    },
    dataset: attrs.id ? { freeId: attrs.id } : {},
    parent
  };

  return node;
}

function matches(node, selector) {
  switch (selector) {
    case "[data-free-id]":
      return Boolean(node.attrs.id);
    case "[data-free-overlay-control]":
      return Boolean(node.attrs.overlay);
    case "[data-free-close]":
      return Boolean(node.attrs.close);
    default:
      return false;
  }
}

test("a pilha do ponto: de cima para baixo, filhos antes da caixa, sem controles, sem o X, sem o de fora e sem repetidos", () => {
  const page = el();
  const card = el({}, page);
  const artboard = el({}, card);
  const caixa = el({ id: "caixa" }, artboard);
  const selo = el({ id: "selo" }, caixa);
  const seloTexto = el({}, selo);
  const seloIcone = el({}, selo);
  const formaDeCima = el({ id: "forma" }, artboard);
  const degrade = el({ id: "fundo" }, artboard);
  const overlay = el({ overlay: true }, card);
  const alca = el({}, overlay);
  const fechar = el({ close: true }, card);
  const xIcone = el({}, fechar);
  const outroCartao = el({ id: "outro" }, page);
  const inside = (element) => {
    for (let current = element; current; current = current.parent) {
      if (current === card) {
        return true;
      }
    }

    return false;
  };

  assert.deepEqual(
    selection.freeStackFromPoint([alca, overlay, xIcone, fechar, formaDeCima, seloTexto, seloIcone, selo, caixa, degrade, artboard, card, outroCartao, page], inside),
    ["forma", "selo", "caixa", "fundo"]
  );
  assert.deepEqual(selection.freeStackFromPoint([artboard, card, page], inside), [], "so a prancheta: pilha vazia");
  assert.deepEqual(selection.freeStackFromPoint([], inside), []);
});

test("o próximo da pilha: o de baixo do escolhido, volta ao de cima no fim; fora da pilha, o segundo", () => {
  const stack = ["forma", "selo", "caixa"];

  // O primeiro Alt + clique (o escolhido nao esta no ponto) ja pega o de baixo do de cima.
  assert.deepEqual(selection.freeNextInStack(stack, null), { id: "selo", index: 2, total: 3 });
  assert.deepEqual(selection.freeNextInStack(stack, "outro"), { id: "selo", index: 2, total: 3 });
  // Em ciclo.
  assert.deepEqual(selection.freeNextInStack(stack, "forma"), { id: "selo", index: 2, total: 3 });
  assert.deepEqual(selection.freeNextInStack(stack, "selo"), { id: "caixa", index: 3, total: 3 });
  assert.deepEqual(selection.freeNextInStack(stack, "caixa"), { id: "forma", index: 1, total: 3 });
  // Pilha de um: ele mesmo.
  assert.deepEqual(selection.freeNextInStack(["forma"], null), { id: "forma", index: 1, total: 1 });
  assert.deepEqual(selection.freeNextInStack(["forma"], "forma"), { id: "forma", index: 1, total: 1 });
  // Vazia.
  assert.equal(selection.freeNextInStack([], "forma"), null);

  assert.equal(S.stack("Forma", 2, 3), "Selecionado: Forma (2 de 3 neste ponto).");
});

/* ------------------------------------------------------------------------------------------------
 * Mover junto
 * ---------------------------------------------------------------------------------------------- */

test("mover junto: todos andam o mesmo, travado, da sequência e Links parados; o grupo não se deforma na borda", () => {
  const base = design([TITLE, forma("a", 10, 20), forma("b", 100, 50), forma("travada", 0, 0, 40, 40, { locked: true }), LINKS]);
  const moved = selection.moveFreeNodesBy(base, ["a", "b", "travada", "titulo", "links"], 5, -3, "desktop");

  assert.deepEqual(placeOf(moved, "a"), { h: 40, mode: "free", w: 40, x: 15, y: 17 });
  assert.deepEqual(placeOf(moved, "b"), { h: 40, mode: "free", w: 40, x: 105, y: 47 });
  assert.deepEqual(placeOf(moved, "travada"), placeOf(base, "travada"));
  assert.deepEqual(find(moved, "titulo").node, find(base, "titulo").node);
  assert.ok(valid(moved));

  // Deslocamento inteiro.
  assert.equal(placeOf(selection.moveFreeNodesBy(base, ["a", "b"], 2.4, 0, "desktop"), "a").x, 12);

  // Nada que ande, ou deslocamento zero: o mesmo design.
  assert.equal(selection.moveFreeNodesBy(base, ["travada", "titulo", "links"], 5, 5, "desktop"), base);
  assert.equal(selection.moveFreeNodesBy(base, ["a", "b"], 0, 0, "desktop"), base);
  assert.equal(selection.moveFreeNodesBy(base, [], 5, 5, "desktop"), base);

  // Limite comum: quem chega antes na borda segura o grupo (x de -720 a 1.440; y de -400 a 2.400).
  const wide = design([forma("a", -700, 0), forma("b", 1400, 2390), LINKS]);
  const left = selection.moveFreeNodesBy(wide, ["a", "b"], -50, 0, "desktop");
  assert.equal(placeOf(left, "a").x, -720);
  assert.equal(placeOf(left, "b").x, 1380);
  const right = selection.moveFreeNodesBy(wide, ["a", "b"], 100, 0, "desktop");
  assert.equal(placeOf(right, "a").x, -660);
  assert.equal(placeOf(right, "b").x, 1440);
  const down = selection.moveFreeNodesBy(wide, ["a", "b"], 0, 30, "desktop");
  assert.equal(placeOf(down, "a").y, 10);
  assert.equal(placeOf(down, "b").y, 2400);
  const up = selection.moveFreeNodesBy(wide, ["a", "b"], 0, -500, "desktop");
  assert.equal(placeOf(up, "a").y, -400);
  assert.equal(placeOf(up, "b").y, 1990);
  for (const value of [left, right, down, up]) {
    assert.equal(placeOf(value, "b").x - placeOf(value, "a").x, 2100, "a distancia entre os dois fica");
  }
  // Ja na borda: nada muda.
  assert.equal(selection.moveFreeNodesBy(right, ["a", "b"], 10, 0, "desktop"), right);

  // A chave de juntar passos das setas: um id e a de hoje; varios, sem depender da ordem, por aparelho e por camada.
  assert.equal(selection.freeGroupCoalesceKey(["a"], "desktop"), editor.freeArrowCoalesceKey("a", "desktop"));
  assert.equal(selection.freeGroupCoalesceKey(["a"], "mobile"), editor.freeArrowCoalesceKey("a", "mobile"));
  assert.equal(selection.freeGroupCoalesceKey(["b", "a"], "desktop"), "a,b:place");
  assert.equal(selection.freeGroupCoalesceKey(["a", "b", "a"], "desktop"), selection.freeGroupCoalesceKey(["b", "a"], "desktop"));
  assert.equal(selection.freeGroupCoalesceKey(["b", "a"], "mobile"), "a,b:mobile.place");
  assert.equal(selection.freeGroupCoalesceKey(["b", "a"], "desktop", "z"), "a,b:place.z");
  assert.equal(selection.freeGroupCoalesceKey(["b", "a"], "mobile", "z"), "a,b:place.z", "a camada e uma so nos dois aparelhos");
  assert.equal(selection.freeGroupCoalesceKey(["a"], "desktop", "z"), "a:place.z", "a mesma chave da camada de um elemento");
});

test("mover junto no Celular: só devices.mobile muda, e a entrada sai ao voltar ao valor do computador", () => {
  const base = design([forma("a", 10, 20), forma("b", 100, 50), forma("travada", 0, 0, 40, 40, { locked: true }), LINKS], {
    devices: { mobile: { nodes: { a: { place: { mode: "free", x: 30 } } } } }
  });
  const moved = selection.moveFreeNodesBy(base, ["a", "b", "travada"], 10, 0, "mobile");

  // O computador fica como estava.
  assert.deepEqual(placeOf(moved, "a"), placeOf(base, "a"));
  assert.deepEqual(placeOf(moved, "b"), placeOf(base, "b"));
  // O celular: a parte da posicao do celular; b ganha a entrada; o travado nao.
  assert.deepEqual(mobilePlaceOf(moved, "a"), { mode: "free", x: 40 });
  assert.deepEqual(mobilePlaceOf(moved, "b"), { mode: "free", x: 110 });
  assert.equal(mobilePlaceOf(moved, "travada"), undefined);
  assert.ok(valid(moved));

  // Voltar ao valor do computador tira a entrada.
  const back = selection.moveFreeNodesBy(moved, ["a", "b"], -10, 0, "mobile");
  assert.deepEqual(mobilePlaceOf(back, "a"), { mode: "free", x: 30 });
  assert.equal(back.devices?.mobile?.nodes?.b, undefined);

  // O limite do grupo no celular parte da posicao do celular.
  const edge = design([forma("a", 0, 0), forma("b", 100, 0), LINKS], { devices: { mobile: { nodes: { a: { place: { mode: "free", x: -715 } } } } } });
  const limited = selection.moveFreeNodesBy(edge, ["a", "b"], -50, 0, "mobile");
  assert.equal(mobilePlaceOf(limited, "a").x, -720);
  assert.equal(mobilePlaceOf(limited, "b").x, 95);

  // Onde o grupo esta: o menor X e o menor Y dos que andam, no aparelho.
  assert.deepEqual(selection.freeManyPosition(base, ["a", "b", "travada"], "desktop"), { x: 10, y: 20 });
  assert.deepEqual(selection.freeManyPosition(base, ["a", "b"], "mobile"), { x: 30, y: 20 });
  assert.equal(selection.freeManyPosition(base, ["travada", "links"], "desktop"), null);
  assert.equal(S.position(24, 120), "Seleção em X 24, Y 120.");
});

/* ------------------------------------------------------------------------------------------------
 * Alinhar e distribuir
 * ---------------------------------------------------------------------------------------------- */

test("alinhar entre si pela caixa dos que andam e no pop-up cada um; travado, da sequência e escondido ficam parados", () => {
  const base = design([
    TITLE,
    forma("a", 10, 20, 40, 40),
    forma("b", 100, 60, 80, 20),
    forma("c", 200, 5, 20, 100),
    forma("travada", 300, 300, 10, 10, { locked: true }),
    forma("escondida", 50, 50, 10, 10),
    LINKS
  ]);
  const rects = measured(base);
  delete rects.escondida;
  const all = ["a", "b", "c", "travada", "escondida", "titulo"];

  const left = selection.alignFreeNodes(base, all, "left", "selection", rects, "desktop");
  assert.deepEqual([placeOf(left.design, "a").x, placeOf(left.design, "b").x, placeOf(left.design, "c").x], [10, 10, 10]);
  assert.equal(left.moved, 2, "a ja estava na borda");
  assert.equal(left.skipped, 3, "travada, escondida e titulo");
  assert.deepEqual(placeOf(left.design, "travada"), placeOf(base, "travada"));
  assert.deepEqual(placeOf(left.design, "escondida"), placeOf(base, "escondida"));
  assert.deepEqual(placeOf(left.design, "b").y, 60, "so o eixo que muda");

  const top = selection.alignFreeNodes(base, all, "top", "selection", rects, "desktop");
  assert.deepEqual([placeOf(top.design, "a").y, placeOf(top.design, "b").y, placeOf(top.design, "c").y], [5, 5, 5]);
  assert.equal(placeOf(top.design, "a").x, 10);

  const right = selection.alignFreeNodes(base, all, "right", "selection", rects, "desktop");
  assert.deepEqual([placeOf(right.design, "a").x, placeOf(right.design, "b").x, placeOf(right.design, "c").x], [180, 140, 200]);

  // A caixa dos tres vai de x 10 a 220: o centro e 115.
  const center = selection.alignFreeNodes(base, all, "center", "selection", rects, "desktop");
  assert.deepEqual([placeOf(center.design, "a").x, placeOf(center.design, "b").x, placeOf(center.design, "c").x], [95, 75, 105]);

  // No pop-up: cada um na prancheta (440 x 400), todos centrados.
  const artboardCenter = selection.alignFreeNodes(base, all, "center", "artboard", rects, "desktop");
  assert.deepEqual([placeOf(artboardCenter.design, "a").x, placeOf(artboardCenter.design, "b").x, placeOf(artboardCenter.design, "c").x], [200, 180, 210]);
  assert.equal(artboardCenter.moved, 3);
  const bottom = selection.alignFreeNodes(base, ["a", "b", "c"], "bottom", "artboard", rects, "desktop");
  assert.deepEqual([placeOf(bottom.design, "a").y, placeOf(bottom.design, "b").y, placeOf(bottom.design, "c").y], [360, 380, 300]);
  assert.equal(bottom.skipped, 0);
  // Um elemento so tambem alinha no pop-up.
  assert.equal(placeOf(selection.alignFreeNodes(base, ["b"], "middle", "artboard", rects, "desktop").design, "b").y, 190);

  // Nada mudado: o mesmo design e moved 0.
  const remeasured = measured(left.design);
  delete remeasured.escondida;
  const again = selection.alignFreeNodes(left.design, all, "left", "selection", remeasured, "desktop");
  assert.equal(again.design, left.design);
  assert.equal(again.moved, 0);
  assert.ok(valid(center.design));
});

test("alinhar pela caixa que se vê: um Selo girado 90° encosta a borda visível; no Celular grava só o celular", () => {
  const selo = { id: "selo", label: "Novo", place: { h: 20, mode: "free", rotate: 90, w: 100, x: 40, y: 60 }, type: "badge" };
  const base = design([selo, forma("a", 10, 30, 40, 40), LINKS]);
  const rects = measured(base);

  // A caixa que se ve vai de x 80 a 100: alinhar a esquerda no pop-up leva a borda visivel a 0.
  const one = selection.alignFreeNodes(base, ["selo"], "left", "artboard", rects, "desktop");
  assert.equal(placeOf(one.design, "selo").x, -40);
  assert.equal(placeOf(one.design, "selo").rotate, 90, "o giro fica");
  // Entre si: a borda visivel do Selo encosta na do a (x 10).
  const both = selection.alignFreeNodes(base, ["selo", "a"], "left", "selection", rects, "desktop");
  assert.equal(placeOf(both.design, "selo").x, -30);
  assert.equal(placeOf(both.design, "a").x, 10);
  // Em cima entre si: a borda visivel do Selo esta em y 20.
  const top = selection.alignFreeNodes(base, ["selo", "a"], "top", "selection", rects, "desktop");
  assert.equal(placeOf(top.design, "a").y, 20);
  assert.equal(placeOf(top.design, "selo").y, 60);

  // Celular: parte da posicao do celular e grava so em devices.mobile.
  const phone = design([forma("a", 10, 30, 40, 40), forma("b", 100, 30, 40, 40), LINKS], {
    devices: { mobile: { nodes: { a: { place: { mode: "free", x: 30 } } } } }
  });
  const mobile = selection.alignFreeNodes(phone, ["a", "b"], "right", "artboard", measured(phone, { h: 400, w: 440 }, "mobile"), "mobile");
  assert.deepEqual(placeOf(mobile.design, "a"), placeOf(phone, "a"));
  assert.deepEqual(placeOf(mobile.design, "b"), placeOf(phone, "b"));
  assert.deepEqual(mobilePlaceOf(mobile.design, "a"), { mode: "free", x: 400 });
  assert.deepEqual(mobilePlaceOf(mobile.design, "b"), { mode: "free", x: 400 });
  // Entre si no celular: pela caixa do celular (de x 30 a 140).
  const between = selection.alignFreeNodes(phone, ["a", "b"], "left", "selection", measured(phone, { h: 400, w: 440 }, "mobile"), "mobile");
  assert.deepEqual(mobilePlaceOf(between.design, "a"), { mode: "free", x: 30 });
  assert.deepEqual(mobilePlaceOf(between.design, "b"), { mode: "free", x: 30 });
  assert.ok(valid(between.design));
});

test("alinhar e distribuir com poucos devolvem o motivo do painel", () => {
  const base = design([
    TITLE,
    TEXT,
    forma("a", 10, 20),
    forma("b", 100, 20),
    forma("travada", 300, 300, 10, 10, { locked: true }),
    forma("escondida", 50, 50, 10, 10),
    LINKS
  ]);
  const rects = measured(base);
  delete rects.escondida;

  assert.deepEqual(selection.alignFreeNodes(base, ["a"], "left", "selection", rects, "desktop"), { reason: S.reasons.alignSelection });
  assert.deepEqual(selection.alignFreeNodes(base, ["a", "escondida"], "left", "selection", rects, "desktop"), { reason: S.reasons.alignSelection });
  assert.deepEqual(selection.alignFreeNodes(base, ["a", "travada"], "left", "selection", rects, "desktop"), { reason: S.reasons.locked });
  assert.deepEqual(selection.alignFreeNodes(base, ["titulo", "texto"], "left", "selection", rects, "desktop"), { reason: S.reasons.sequence });
  assert.deepEqual(selection.alignFreeNodes(base, ["titulo", "a"], "left", "selection", rects, "desktop"), { reason: S.reasons.alignSelection });
  assert.deepEqual(selection.alignFreeNodes(base, ["titulo", "texto", "links"], "left", "artboard", rects, "desktop"), { reason: S.reasons.sequence });
  assert.deepEqual(selection.alignFreeNodes(base, ["travada"], "left", "artboard", rects, "desktop"), { reason: S.reasons.locked });
  assert.deepEqual(selection.alignFreeNodes(base, ["escondida"], "left", "artboard", rects, "desktop"), { reason: S.reasons.alignArtboard });
  assert.deepEqual(selection.alignFreeNodes(base, [], "left", "artboard", rects, "desktop"), { reason: S.reasons.alignArtboard });
  const { "@artboard": unusedArtboard, ...withoutArtboard } = rects;
  void unusedArtboard;
  assert.deepEqual(selection.alignFreeNodes(base, ["a"], "left", "artboard", withoutArtboard, "desktop"), { reason: S.reasons.alignArtboard });

  assert.deepEqual(selection.distributeFreeNodes(base, ["a", "b"], "x", rects, "desktop"), { reason: S.reasons.distribute });
  assert.deepEqual(selection.distributeFreeNodes(base, ["a", "b", "travada"], "x", rects, "desktop"), { reason: S.reasons.locked });
  assert.deepEqual(selection.distributeFreeNodes(base, ["titulo", "texto", "links"], "y", rects, "desktop"), { reason: S.reasons.sequence });
});

test("espaços iguais com 3 e 4: as pontas paradas e os espaços com até 1 px de diferença; no Celular, só o celular", () => {
  const three = design([forma("a", 0, 0, 40, 10), forma("b", 50, 0, 20, 10), forma("c", 200, 0, 60, 10), forma("travada", 0, 0, 5, 5, { locked: true }), LINKS]);
  const spaced = selection.distributeFreeNodes(three, ["c", "a", "b", "travada"], "x", measured(three), "desktop");
  assert.deepEqual([placeOf(spaced.design, "a").x, placeOf(spaced.design, "b").x, placeOf(spaced.design, "c").x], [0, 110, 200]);
  assert.equal(spaced.moved, 1);
  assert.equal(spaced.skipped, 1);

  // Quatro de larguras diferentes, fora de ordem: espaco de 70 entre todos.
  const four = design([forma("d", 300, 0, 40, 10), forma("a", 0, 0, 30, 10), forma("c", 100, 0, 10, 10), forma("b", 40, 0, 50, 10), LINKS]);
  const even = selection.distributeFreeNodes(four, ["a", "b", "c", "d"], "x", measured(four), "desktop");
  assert.deepEqual(["a", "b", "c", "d"].map((id) => placeOf(even.design, id).x), [0, 100, 220, 300]);

  // Espaco quebrado (70 / 3): cada alvo e exato e acumulado, arredondado so no fim.
  const odd = design([forma("a", 0, 0, 10, 10), forma("b", 20, 0, 10, 10), forma("c", 25, 0, 10, 10), forma("d", 100, 0, 10, 10), LINKS]);
  const result = selection.distributeFreeNodes(odd, ["a", "b", "c", "d"], "x", measured(odd), "desktop");
  const xs = ["a", "b", "c", "d"].map((id) => placeOf(result.design, id).x);
  const gaps = [xs[1] - (xs[0] + 10), xs[2] - (xs[1] + 10), xs[3] - (xs[2] + 10)];
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, JSON.stringify(gaps));
  assert.deepEqual([xs[0], xs[3]], [0, 100], "as pontas ficam");

  // Na vertical, so o Y muda.
  const column = design([forma("a", 5, 0, 10, 20), forma("b", 6, 30, 10, 20), forma("c", 7, 100, 10, 20), LINKS]);
  const vertical = selection.distributeFreeNodes(column, ["a", "b", "c"], "y", measured(column), "desktop");
  assert.deepEqual(["a", "b", "c"].map((id) => placeOf(vertical.design, id).y), [0, 50, 100]);
  assert.deepEqual(["a", "b", "c"].map((id) => placeOf(vertical.design, id).x), [5, 6, 7]);

  // Ja iguais: o mesmo design.
  const same = selection.distributeFreeNodes(vertical.design, ["a", "b", "c"], "y", measured(vertical.design), "desktop");
  assert.equal(same.design, vertical.design);
  assert.equal(same.moved, 0);

  // Celular: so devices.mobile.
  const phone = design([forma("a", 0, 0, 40, 10), forma("b", 50, 0, 20, 10), forma("c", 200, 0, 60, 10), LINKS], {
    devices: { mobile: { nodes: { c: { place: { mode: "free", x: 300 } } } } }
  });
  const mobile = selection.distributeFreeNodes(phone, ["a", "b", "c"], "x", measured(phone, { h: 400, w: 440 }, "mobile"), "mobile");
  assert.deepEqual(placeOf(mobile.design, "b"), placeOf(phone, "b"));
  assert.deepEqual(mobilePlaceOf(mobile.design, "b"), { mode: "free", x: 160 });
  assert.ok(valid(mobile.design));
});

/* ------------------------------------------------------------------------------------------------
 * Duplicar e excluir
 * ---------------------------------------------------------------------------------------------- */

test("duplicar vários: um passo, Links, Áudio e Vídeo de fora, cópias na ordem da seleção, +16 no solto e no celular", () => {
  const box = { children: [{ id: "selo", label: "Novo", type: "badge" }], id: "caixa", type: "box" };
  const base = design([TITLE, forma("a", 10, 20), box, CTA_NODE, { asset: null, id: "video", type: "video" }, LINKS, AUDIO], {
    devices: { mobile: { nodes: { a: { place: { mode: "free", x: 50 } } } } }
  });
  const result = selection.duplicateFreeNodes(base, ["a", "links", "titulo", "video", "caixa", "audio"], CTA);

  assert.equal(result.skipped, 3, "Links, Vídeo e Áudio");
  // As copias na ordem da selecao (a copia do principal, a caixa, por ultimo).
  assert.equal(result.ids.length, 3);
  const [copyA, copyTitle, copyBox] = result.ids;
  assert.equal(find(result.design, copyA).node.type, "shape");
  assert.equal(find(result.design, copyTitle).node.type, "heading");
  assert.equal(find(result.design, copyBox).node.type, "box");
  // Cada copia logo depois do original.
  assert.deepEqual(
    result.design.children.map((node) => node.id),
    ["titulo", copyTitle, "a", copyA, "caixa", copyBox, "principal", "video", "links", "audio"]
  );
  // O solto anda 16 px, no computador e no celular.
  assert.deepEqual(placeOf(result.design, copyA), { h: 40, mode: "free", w: 40, x: 26, y: 36 });
  assert.deepEqual(mobilePlaceOf(result.design, copyA), { mode: "free", x: 66 });
  // Ids novos em tudo, inclusive dentro da caixa.
  const all = order(result.design);
  assert.equal(new Set(all).size, all.length);
  assert.ok(valid(result.design));

  // O Botão principal duplicado vira "Abrir um link" com o texto e o destino do aviso.
  const withCta = selection.duplicateFreeNodes(design([forma("a", 0, 0), CTA_NODE, LINKS]), ["principal", "a"], CTA);
  const copyCta = find(withCta.design, withCta.ids[0]).node;
  assert.deepEqual(copyCta.action, { href: CTA.href, kind: "link", target: CTA.target });
  assert.equal(copyCta.label, CTA.label);

  // So Links, Áudio ou Vídeo: a frase de hoje do primeiro.
  assert.deepEqual(selection.duplicateFreeNodes(base, ["links", "audio"], CTA), { reason: M.linksDuplicate });
  assert.deepEqual(selection.duplicateFreeNodes(base, ["audio", "links"], CTA), { reason: M.audioDuplicate });
  assert.deepEqual(selection.duplicateFreeNodes(base, ["video"], CTA), { reason: M.videoDuplicate });
  // Uma caixa com Vídeo dentro tambem fica de fora.
  const boxed = design([forma("a", 0, 0), { children: [{ asset: null, id: "video", type: "video" }], id: "caixa", type: "box" }, LINKS]);
  const skippedBox = selection.duplicateFreeNodes(boxed, ["caixa", "a"], CTA);
  assert.equal(skippedBox.skipped, 1);
  assert.equal(skippedBox.ids.length, 1);
  // Nada escolhido: nada muda.
  assert.deepEqual(selection.duplicateFreeNodes(base, [], CTA), { design: base, ids: [], skipped: 0 });
});

test("duplicar vários é atômico: 32 elementos, 24 soltos, 20 por caixa e 3 botões contam o conjunto", () => {
  const check = (value, ids, reason) => {
    const before = JSON.stringify(value);

    assert.deepEqual(selection.duplicateFreeNodes(value, ids, CTA), { reason });
    assert.equal(JSON.stringify(value), before, "o design de entrada nao muda");
  };

  // 31 elementos: o primeiro cabe (32), o segundo nao.
  const nodes = design([...Array.from({ length: 28 }, (_, index) => spacer(`e${index}`)), forma("a", 0, 0), forma("b", 0, 0), LINKS]);
  check(nodes, ["a", "b"], M.nodes);
  assert.equal(selection.duplicateFreeNodes(nodes, ["a"], CTA).ids.length, 1);

  // 23 soltos: o 24o cabe, o 25o nao.
  const loose = design([...Array.from({ length: 23 }, (_, index) => forma(`f${index}`, index, 0)), LINKS]);
  check(loose, ["f0", "f1"], M.freeNodes);

  // Caixa com 19: o 20o cabe, o 21o nao.
  const full = design([{ children: Array.from({ length: 19 }, (_, index) => spacer(`s${index}`)), id: "caixa", type: "box" }, LINKS]);
  check(full, ["s0", "s1"], M.childrenPerBox);

  // Dois botoes "Fechar": o 3o cabe, o 4o nao.
  const close = (id) => ({ action: { kind: "close" }, id, label: "Agora não", type: "button" });
  check(design([close("b1"), close("b2"), LINKS]), ["b1", "b2"], M.buttons);
});

test("excluir vários: Links e Áudio ficam, o principal tira o botão do aviso e o celular dos excluídos sai junto", () => {
  const box = { children: [{ id: "selo", label: "Novo", type: "badge" }, CTA_NODE], id: "caixa", type: "box" };
  const base = design([TITLE, forma("a", 10, 20), box, LINKS, AUDIO], {
    devices: { mobile: { nodes: { a: { place: { mode: "free", x: 50 } }, selo: { hidden: true }, titulo: { hidden: true } } } }
  });
  const result = selection.removeFreeNodes(base, ["a", "links", "caixa", "audio"]);

  assert.deepEqual(result.removed, ["a", "caixa"]);
  assert.deepEqual(result.kept, ["links", "audio"]);
  assert.equal(result.ctaRemoved, true);
  assert.deepEqual(order(result.design), ["titulo", "links", "audio"]);
  assert.deepEqual(Object.keys(result.design.devices.mobile.nodes), ["titulo"]);

  // Sem o principal: ctaRemoved false.
  const plain = selection.removeFreeNodes(base, ["titulo", "a"]);
  assert.equal(plain.ctaRemoved, false);
  assert.deepEqual(plain.kept, []);
  assert.deepEqual(order(plain.design), ["caixa", "selo", "principal", "links", "audio"]);

  // Caixa e filho escolhidos: fica o ultimo (a caixa sai inteira uma vez so).
  assert.deepEqual(selection.removeFreeNodes(base, ["selo", "caixa"]).removed, ["caixa"]);

  // Nada pode sair: o motivo do primeiro.
  assert.deepEqual(selection.removeFreeNodes(base, ["links", "audio"]), { reason: E.canNotRemove.links });
  assert.deepEqual(selection.removeFreeNodes(base, ["audio", "links"]), { reason: E.canNotRemove.audio });
});

/* ------------------------------------------------------------------------------------------------
 * Esconder, travar, camada
 * ---------------------------------------------------------------------------------------------- */

test("esconder e travar com vários: se algum não tem, todos ganham; senão, todos perdem; a camada para no limite", () => {
  const base = design([forma("a", 0, 0, 40, 40, { hidden: true }), forma("b", 0, 0), TITLE, LINKS]);

  assert.equal(selection.freeManyFlagNext(base, ["a", "b"], "hidden"), true);
  const hidden = selection.setFreeNodesFlag(base, ["a", "b"], "hidden");
  assert.equal(hidden.value, true);
  assert.deepEqual([find(hidden.design, "a").node.hidden, find(hidden.design, "b").node.hidden], [true, true]);
  const shown = selection.setFreeNodesFlag(hidden.design, ["a", "b"], "hidden");
  assert.equal(shown.value, false);
  assert.deepEqual([find(shown.design, "a").node.hidden, find(shown.design, "b").node.hidden], [undefined, undefined]);

  const locked = selection.setFreeNodesFlag(base, ["b", "titulo"], "locked");
  assert.equal(locked.value, true);
  assert.deepEqual([find(locked.design, "b").node.locked, find(locked.design, "titulo").node.locked], [true, true]);
  assert.equal(selection.freeManyFlagNext(locked.design, ["b", "titulo"], "locked"), false);
  assert.ok(valid(locked.design));

  // Camada: cada um +1 ou -1, de -10 a 10.
  const layered = design([forma("a", 0, 0, 40, 40, { place: { z: 10 } }), forma("b", 0, 0), TITLE, LINKS]);
  const forward = selection.shiftFreeNodesLayer(layered, ["a", "b", "titulo"], 1);
  assert.equal(placeOf(forward, "a").z, 10, "no limite fica");
  assert.equal(placeOf(forward, "b").z, 1);
  assert.deepEqual(placeOf(forward, "titulo"), { mode: "flow", z: 1 });
  const top = design([forma("a", 0, 0, 40, 40, { place: { z: 10 } }), LINKS]);
  assert.equal(selection.shiftFreeNodesLayer(top, ["a"], 1), top, "nada mudado: o mesmo design");
  const backward = selection.shiftFreeNodesLayer(forward, ["a", "b"], -1);
  assert.equal(placeOf(backward, "a").z, 9);
  assert.equal(placeOf(backward, "b").z, undefined);
});

/* ------------------------------------------------------------------------------------------------
 * Palco e painel Varios
 * ---------------------------------------------------------------------------------------------- */

test("descrição do palco com vários, motivos do painel e o nome nas frases", () => {
  const base = design([TITLE, forma("a", 10, 20), TEXT, forma("fundo", 0, 0, 440, 400, { name: "Fundo" }), CTA_NODE, LINKS, AUDIO]);
  const rects = measured(base);

  // Um: a frase de hoje; nenhum: "Nada selecionado.".
  assert.equal(selection.freeManyDescription(base, ["a"], rects), editor.freeSelectionDescription(base, "a", rects));
  assert.equal(selection.freeManyDescription(base, [], rects), "Nada selecionado.");
  // Varios: o nome dado ou o tipo.
  assert.equal(selection.freeManyDescription(base, ["titulo", "a", "texto"], rects), "Selecionados: 3 elementos (Título, Forma, Texto).");
  assert.equal(selection.freeManyDescription(base, ["fundo", "principal"], rects), "Selecionados: 2 elementos (Fundo, Botão principal).");
  assert.equal(
    selection.freeManyDescription(base, ["titulo", "a", "texto", "fundo", "principal", "links", "audio"], rects),
    "Selecionados: 7 elementos (Título, Forma, Texto, Fundo, Botão principal e mais 2)."
  );
  assert.equal(selection.freeSelectionName(base, "fundo"), "Fundo");
  assert.equal(selection.freeSelectionName(base, "a"), "Forma");
  assert.equal(selection.freeSelectionName(base, "nada"), "");

  // Dois soltos: alinhar ligado, distribuir pede 3.
  assert.deepEqual(selection.freeManyReasons(base, ["a", "fundo"], rects), {
    alignArtboard: null,
    alignSelection: null,
    distribute: S.reasons.distribute,
    duplicate: null,
    remove: null
  });
  // Links e Áudio: tudo desligado, cada um com o seu motivo.
  assert.deepEqual(selection.freeManyReasons(base, ["links", "audio"], rects), {
    alignArtboard: S.reasons.sequence,
    alignSelection: S.reasons.sequence,
    distribute: S.reasons.sequence,
    duplicate: M.linksDuplicate,
    remove: E.canNotRemove.links
  });
  // Titulo e Texto: da sequencia, mas duplicam e saem.
  const flow = selection.freeManyReasons(base, ["titulo", "texto"], rects);
  assert.equal(flow.alignSelection, S.reasons.sequence);
  assert.equal(flow.duplicate, null);
  assert.equal(flow.remove, null);
  // Limite do conjunto: o motivo do primeiro que nao cabe.
  const loose = design([...Array.from({ length: 23 }, (_, index) => forma(`f${index}`, index, 0)), LINKS]);
  assert.equal(selection.freeManyReasons(loose, ["f0", "f1"], measured(loose)).duplicate, M.freeNodes);
});

/* ------------------------------------------------------------------------------------------------
 * Frases, vocabulario e fonte
 * ---------------------------------------------------------------------------------------------- */

test("frases de vários palavra por palavra, sem palavra proibida e sem hífen como separador", () => {
  assert.equal(S.toggledIn("Forma", 3), "Forma entrou na seleção. 3 elementos.");
  assert.equal(S.toggledOut("Forma", 2), "Forma saiu da seleção. 2 elementos.");
  assert.equal(S.toggledOut("Forma", 1), "Forma saiu da seleção. 1 elemento.");
  assert.equal(S.toggledOut("Forma", 0), "Forma saiu da seleção. Nada selecionado.");
  assert.equal(S.chosen(5), "5 elementos escolhidos.");
  assert.equal(S.description(["Título", "Forma", "Texto"]), "Selecionados: 3 elementos (Título, Forma, Texto).");
  assert.equal(S.groupTag(3), "3 elementos");
  assert.equal(S.inSelection, "Na seleção");
  assert.equal(S.duplicated(3, 0), "3 elementos duplicados.");
  assert.equal(S.duplicated(2, 1), "2 elementos duplicados. Os links, o áudio e o vídeo não se duplicam.");
  assert.equal(S.removed(3, 0), "3 elementos excluídos. Ctrl + Z desfaz.");
  assert.equal(S.removed(2, 2), "2 elementos excluídos. Os links e o áudio ficam. Ctrl + Z desfaz.");
  assert.equal(S.hidden(3), "3 elementos escondidos.");
  assert.equal(S.shown(3), "3 elementos mostrados.");
  assert.equal(S.locked(3), "3 elementos travados.");
  assert.equal(S.unlocked(3), "3 elementos destravados.");
  assert.equal(S.hidden(1), "1 elemento escondido.");
  assert.equal(S.layerForward, "Trazidos para frente.");
  assert.equal(S.layerBackward, "Enviados para trás.");
  assert.equal(S.onlyOne, "Escolha um elemento só.");
  assert.equal(S.alignedSelection, "Alinhados entre si.");
  assert.equal(S.alignedArtboard, "Alinhados no pop-up.");
  assert.equal(S.spacedX, "Espaços iguais na horizontal.");
  assert.equal(S.spacedY, "Espaços iguais na vertical.");
  assert.equal(S.stayed(1), "1 ficou no lugar (travado, na sequência ou escondido).");
  assert.equal(S.stayed(2), "2 ficaram no lugar (travados, na sequência ou escondidos).");
  assert.equal(S.afterMove(S.alignedSelection, 0), "Alinhados entre si.");
  assert.equal(S.afterMove(S.spacedY, 1), "Espaços iguais na vertical. 1 ficou no lugar (travado, na sequência ou escondido).");
  assert.deepEqual(S.scopes, { artboard: "no pop-up", selection: "entre si" });
  assert.equal(S.panel.title(3), "3 elementos selecionados");
  assert.equal(S.panel.title(1), "1 elemento selecionado");
  assert.equal(S.panel.hint, "Para mudar textos, cores e tamanhos, escolha um elemento só.");
  assert.equal(S.panel.listLabel, "Na seleção");
  assert.equal(S.panel.selectOnly("Título"), "Escolher só Título");
  assert.deepEqual(
    [S.panel.duplicate, S.panel.remove, S.panel.hide, S.panel.show, S.panel.lock, S.panel.unlock, S.panel.forward, S.panel.backward],
    ["Duplicar", "Excluir", "Esconder", "Mostrar", "Travar", "Destravar", "Trazer para frente", "Enviar para trás"]
  );
  assert.deepEqual(
    [S.panel.alignSelection, S.panel.alignArtboard, S.panel.distribute, S.panel.distributeX, S.panel.distributeY],
    ["Alinhar entre si", "Alinhar no pop-up", "Distribuir os espaços", "Espaços iguais na horizontal", "Espaços iguais na vertical"]
  );
  assert.equal(S.panel.mobileNote, "Com Ver como: Celular, alinhar e distribuir mudam só o celular.");
  assert.deepEqual(S.reasons, {
    alignSelection: "Para alinhar entre si, escolha 2 ou mais elementos soltos.",
    alignArtboard: "Para alinhar no pop-up, escolha um elemento solto.",
    distribute: "Para distribuir os espaços, escolha 3 ou mais elementos soltos.",
    sequence: "Na sequência, quem alinha e distribui é a caixa.",
    locked: "Elementos travados não mudam de lugar."
  });

  // Os nomes acessiveis dos 12 botoes de alinhar: distintos, com a base do "Alinhar no pop-up" de um elemento so.
  const labels = [];

  for (const scope of ["selection", "artboard"]) {
    for (const edge of inspector.FREE_ALIGN_EDGES) {
      const label = S.alignLabel(edge, scope);

      assert.equal(label, `${inspector.FREE_ALIGN_LABELS[edge]} ${S.scopes[scope]}`);
      labels.push(label);
    }
  }

  assert.equal(new Set(labels).size, 12);
  assert.equal(S.alignLabel("left", "selection"), "Alinhar à esquerda entre si");
  assert.equal(S.alignLabel("center", "artboard"), "Alinhar ao centro no pop-up");
  assert.equal(S.alignLabel("bottom", "selection"), "Alinhar embaixo entre si");
  assert.equal(labels.includes(inspector.FREE_ALIGN_LABELS.center), false, "o Alinhar ao centro de um elemento so continua unico");

  // 'Na seleção' fica fora das etiquetas das Camadas (C1).
  assert.equal(Object.values(E.layers.tags).includes(S.inSelection), false);

  // Vocabulario e hifen em todas as frases.
  const texts = [];
  const collect = (value) => {
    if (typeof value === "string") {
      texts.push(value);
    } else if (value === S.description) {
      texts.push(value(["Título", "Forma"]), value(["A", "B", "C", "D", "E", "F", "G"]));
    } else if (value === S.alignLabel || value === S.afterMove) {
      // Os rotulos de alinhar entram pela lista `labels`; o afterMove, pelas frases acima.
    } else if (typeof value === "function") {
      texts.push(String(value(1, 2, 3)), String(value(4, 1)), String(value("Forma", 2, 3)), String(value("Forma", 0)));
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(collect);
    }
  };

  collect(S);
  texts.push(...labels, S.afterMove(S.alignedArtboard, 2));

  const all = texts.join("\n").toLowerCase();

  for (const word of PROIBIDAS) {
    assert.equal(all.includes(word), false, `"${word}" apareceu nas frases de vários`);
  }

  assert.equal(/ [-–—] /.test(texts.join("\n")), false, "sem hifen como separador");
});

test("o módulo de seleção é puro: sem JSX, sem janela, sem HTML em texto, e nenhum dos dois de base o importa", () => {
  const dir = new URL("../src/components/admin/v2/communication/popup-free/", import.meta.url);
  const source = readFileSync(new URL("free-editor-selection.ts", dir), "utf8");
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  assert.equal(/dangerouslySetInnerHTML|\.innerHTML|cssText|<style[\s>]|style="/.test(source), false);
  assert.equal(/\bwindow\b|\bdocument\.|\bnavigator\b|from "react"/.test(code), false, "sem janela nem React");
  assert.equal(/<[A-Za-z][^>]*>/.test(code.replace(/Map<[^>]*>|Set<[^>]*>|Record<[^>]*>|Pick<[^>]*>|Readonly<[^>]*>|Array<[^>]*>|ReturnType<[^>]*>/g, "")), false, "sem JSX");
  assert.match(source, /from "\.\/free-editor-model";/);
  assert.match(source, /from "\.\/free-editor-geometry";/);

  for (const file of ["free-editor-model.ts", "free-editor-geometry.ts"]) {
    assert.equal(readFileSync(new URL(file, dir), "utf8").includes("free-editor-selection"), false, `${file} nao importa a selecao`);
  }
});
