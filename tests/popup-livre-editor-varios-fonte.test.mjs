import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import "./support/transpile-tsx.mjs";

// Casca do editor Livre no L4b (docs/27 §13.10; docs/18 §1.1), pacote P12 (free-editor.tsx e free-elements-panel.tsx):
// - as regras puras da casca: o pedido de escolher do desenho e das Camadas (Alt + Shift ou Ctrl + clique so
//   acrescenta: quem ja esta so vira o principal), por e tirar, o intervalo desde a ancora (sem ela ou com pais
//   diferentes, so acrescenta), o Ctrl + A pelo design do palco e para onde vai o foco na troca do painel da direita
//   (C11);
// - guardas de fonte: a MESMA lista viva e normalizada no desenho, nas Camadas e no painel Varios (com o principal
//   igual ao ultimo dela), um commit por ramo de runMany e de onManyCommand, as teclas da linha com selection, o painel
//   de um elemento montado e escondido enquanto ha varios (a aba fica), o caminho do Elementos e o ramo move iguais, e
//   nada de HTML em texto nos arquivos novos do L4b.

const editorUrl = new URL("../src/components/admin/v2/communication/popup-free/free-editor.tsx", import.meta.url);
const source = readFileSync(editorUrl, "utf8");
const shell = await import("../src/components/admin/v2/communication/popup-free/free-editor.tsx");
const selection = await import("../src/components/admin/v2/communication/popup-free/free-editor-selection.ts");
const model = await import("../src/server/communications/popup-free-model.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");

const S = selection.FREE_SELECTION_COPY;
const { freeAddToSelection, freeEditorSelect, freePanelFocusAfter, freeSelectRequestOfCanvas, freeSelectRequestOfLayers } = shell;

const forma = (id, x, y, extra = {}) => ({ id, type: "shape", ...extra, place: { h: 40, mode: "free", w: 40, x, y, ...extra.place } });

function design(children, extra = {}) {
  const value = model.canonicalPopupFreeDesign({ children, mode: "free", version: 1, ...extra });

  assert.equal(schema.popupFreeDesignSchema.safeParse(value).success, true, "design valido");

  return value;
}

// Na prancheta: o Título, tres Formas soltas (a, b, c), uma travada, a Caixa com o Selo e o Texto, e os Links.
const DESIGN = design([
  { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" },
  forma("a", 10, 20),
  forma("b", 120, 20),
  forma("c", 240, 20),
  forma("trava", 40, 200, { locked: true }),
  {
    children: [
      { id: "selo", label: "Novo", type: "badge" },
      { id: "texto", lines: [[{ text: "Assista hoje." }]], type: "text" }
    ],
    id: "caixa",
    type: "box"
  },
  { id: "links", type: "links" }
]);

/* ------------------------------------------------------------------------------------------------
 * Os pedidos de escolher (puros)
 * ---------------------------------------------------------------------------------------------- */

test("o desenho e as Camadas viram pedidos: só ele, pôr ou tirar, só acrescentar com a pilha do Alt e o intervalo", () => {
  assert.deepEqual(freeSelectRequestOfCanvas("a"), { id: "a", kind: "only" });
  assert.deepEqual(freeSelectRequestOfCanvas(null), { id: null, kind: "only" }, "o vazio limpa");
  assert.deepEqual(freeSelectRequestOfCanvas("a", { mode: "only" }), { id: "a", kind: "only" });
  assert.deepEqual(freeSelectRequestOfCanvas("b", { mode: "only", stack: { index: 2, total: 3 } }), { id: "b", kind: "only", stack: { index: 2, total: 3 } }, "Alt + clique");
  assert.deepEqual(freeSelectRequestOfCanvas("a", { mode: "toggle" }), { id: "a", kind: "toggle" }, "Shift, Ctrl ou ⌘ + clique");
  assert.deepEqual(freeSelectRequestOfCanvas("b", { mode: "toggle", stack: { index: 2, total: 3 } }), { id: "b", kind: "add", stack: { index: 2, total: 3 } }, "Alt + Shift: so acrescenta");

  assert.deepEqual(freeSelectRequestOfLayers("a"), { id: "a", kind: "only" });
  assert.deepEqual(freeSelectRequestOfLayers("a", "only"), { id: "a", kind: "only" });
  assert.deepEqual(freeSelectRequestOfLayers("a", "toggle"), { id: "a", kind: "toggle" });
  assert.deepEqual(freeSelectRequestOfLayers("a", "range"), { id: "a", kind: "range" });
});

test("Alt + Shift (ou Ctrl) + clique só acrescenta: quem já está na seleção só vira o principal, nunca sai", () => {
  // A seleção [b, c] (c é o principal) e a pilha do ponto [c, b, a]: o Alt + Shift + clique pega o de baixo, b.
  const request = freeSelectRequestOfCanvas("b", { mode: "toggle", stack: { index: 2, total: 3 } });
  const kept = freeEditorSelect(DESIGN, { anchor: "c", ids: ["b", "c"] }, request);

  assert.deepEqual(kept.ids, ["c", "b"], "b continua e vira o principal (com o toggle, b sairia)");
  assert.equal(kept.anchor, "b");
  assert.equal(kept.phrase, S.stack("Forma", 2, 3));

  const added = freeEditorSelect(DESIGN, { anchor: "c", ids: ["c"] }, { id: "a", kind: "add", stack: { index: 3, total: 3 } });

  assert.deepEqual(added.ids, ["c", "a"]);
  assert.equal(added.phrase, S.toggledIn("Forma", 2));

  // O ajudante sozinho: um id que nao existe nao muda nada; uma caixa que entra tira os filhos (normaliza).
  assert.deepEqual(freeAddToSelection(DESIGN, ["a", "b"], "sumiu"), { added: false, ids: ["a", "b"] });
  assert.deepEqual(freeAddToSelection(DESIGN, ["a", "b"], "a"), { added: false, ids: ["b", "a"] });
  assert.deepEqual(freeAddToSelection(DESIGN, ["selo", "a"], "caixa"), { added: true, ids: ["a", "caixa"] });
  assert.deepEqual(freeEditorSelect(DESIGN, { anchor: "a", ids: ["a"] }, { id: "sumiu", kind: "add" }), { anchor: "a", ids: ["a"], phrase: null });
});

test("Shift ou Ctrl + clique põe ou tira, com a frase de quantos; só ele limpa os outros", () => {
  const first = freeEditorSelect(DESIGN, { anchor: null, ids: ["a"] }, { id: "b", kind: "toggle" });

  assert.deepEqual(first, { anchor: "b", ids: ["a", "b"], phrase: "Forma entrou na seleção. 2 elementos." });

  const out = freeEditorSelect(DESIGN, first, { id: "a", kind: "toggle" });

  assert.deepEqual(out.ids, ["b"]);
  assert.equal(out.phrase, "Forma saiu da seleção. 1 elemento.");
  assert.equal(freeEditorSelect(DESIGN, { anchor: "b", ids: ["b"] }, { id: "b", kind: "toggle" }).phrase, "Forma saiu da seleção. Nada selecionado.");

  // Ids mortos (excluidos, desfeitos) saem antes; um id que nao existe nao muda nada.
  assert.deepEqual(freeEditorSelect(DESIGN, { anchor: null, ids: ["sumiu", "a"] }, { id: "c", kind: "toggle" }).ids, ["a", "c"]);
  assert.deepEqual(freeEditorSelect(DESIGN, { anchor: "a", ids: ["a"] }, { id: "sumiu", kind: "toggle" }), { anchor: "a", ids: ["a"], phrase: null });

  assert.deepEqual(freeEditorSelect(DESIGN, first, { id: "titulo", kind: "only" }), { anchor: "titulo", ids: ["titulo"], phrase: null });
  assert.deepEqual(freeEditorSelect(DESIGN, first, { id: null, kind: "only" }), { anchor: "b", ids: [], phrase: null }, "o vazio limpa e a ancora fica");

  const alt = freeEditorSelect(DESIGN, first, { id: "a", kind: "only", stack: { index: 2, total: 2 } });

  assert.deepEqual(alt.ids, ["a"]);
  assert.equal(alt.phrase, "Selecionado: Forma (2 de 2 neste ponto).");
});

test("o intervalo das Camadas vai da âncora até a linha entre irmãos; sem âncora ou com pais diferentes, só acrescenta", () => {
  const range = freeEditorSelect(DESIGN, { anchor: "a", ids: ["a"] }, { id: "c", kind: "range" });

  assert.deepEqual(range, { anchor: "a", ids: ["a", "b", "c"], phrase: S.chosen(3) }, "a ancora fica para o proximo Shift");

  // Shift + ↑ depois: o intervalo troca a selecao, a partir da mesma ancora.
  assert.deepEqual(freeEditorSelect(DESIGN, range, { id: "titulo", kind: "range" }).ids, ["a", "titulo"], "termina na linha (o principal)");

  // Pais diferentes (o Selo esta na Caixa): so acrescenta, e a ancora passa a ser ele.
  const other = freeEditorSelect(DESIGN, { anchor: "a", ids: ["a"] }, { id: "selo", kind: "range" });

  assert.deepEqual(other, { anchor: "selo", ids: ["a", "selo"], phrase: S.toggledIn("Selo", 2) });

  // Sem ancora: so acrescenta; quem ja esta so vira o principal.
  assert.deepEqual(freeEditorSelect(DESIGN, { anchor: null, ids: ["b", "a"] }, { id: "b", kind: "range" }).ids, ["a", "b"]);
});

test("Ctrl + A escolhe os irmãos do principal pelo design do palco, sem travados nem escondidos no aparelho", () => {
  const all = freeEditorSelect(DESIGN, { anchor: null, ids: ["b"] }, { kind: "all", stageDesign: DESIGN });

  assert.deepEqual(all.ids, ["titulo", "a", "c", "caixa", "links", "b"], "sem a travada; o principal vai para o fim");
  assert.equal(all.anchor, "b");
  assert.equal(all.phrase, S.chosen(6));

  // Na Caixa: os irmaos dentro dela.
  assert.deepEqual(freeEditorSelect(DESIGN, { anchor: null, ids: ["selo"] }, { kind: "all", stageDesign: DESIGN }).ids, ["texto", "selo"]);

  // Com o Celular, o palco ja vem resolvido: o escondido no celular fica de fora.
  const mobile = design(DESIGN.children, { devices: { mobile: { nodes: { c: { hidden: true } } } } });
  const stage = model.resolveFreeForDevice(mobile, "mobile");

  assert.deepEqual(freeEditorSelect(mobile, { anchor: null, ids: [] }, { kind: "all", stageDesign: stage }).ids, ["titulo", "a", "b", "caixa", "links"]);

  // Nada a escolher: a selecao fica e nada e dito.
  const locked = design([forma("x", 0, 0, { locked: true }), { hidden: true, id: "links", type: "links" }]);

  assert.deepEqual(freeEditorSelect(locked, { anchor: null, ids: [] }, { kind: "all", stageDesign: locked }), { anchor: null, ids: [], phrase: null });
});

test("C11: o foco no painel da direita vai ao título do Vários (de um para vários) ou ao palco (de vários para um ou nada)", () => {
  assert.equal(freePanelFocusAfter(1, 2, true), "many");
  assert.equal(freePanelFocusAfter(0, 3, true), "many");
  assert.equal(freePanelFocusAfter(3, 1, true), "stage", "Escolher só Título");
  assert.equal(freePanelFocusAfter(2, 0, true), "stage", "Esc a nada, Excluir");
  assert.equal(freePanelFocusAfter(2, 3, true), null, "continua o Vários");
  assert.equal(freePanelFocusAfter(1, 1, true), null);
  assert.equal(freePanelFocusAfter(1, 2, false), null, "com o foco fora do painel, nada muda");
  assert.equal(freePanelFocusAfter(3, 1, false), null);
});

/* ------------------------------------------------------------------------------------------------
 * Guardas de fonte
 * ---------------------------------------------------------------------------------------------- */

/** O corpo de uma funcao da sessao (da assinatura, com o recuo de 2, ate a chave que fecha no mesmo recuo). */
function bodyOf(signature) {
  const start = source.indexOf(signature);

  assert.ok(start >= 0, signature);

  const end = source.indexOf("\n  }\n", start);

  return source.slice(start, end + 4);
}

/** As chamadas que gravam um passo no historico. */
function commits(text) {
  return text.match(/\bcommit(?:Design)?\(/g)?.length ?? 0;
}

test("o desenho, as Camadas e o painel Vários recebem a mesma lista viva e normalizada, com o principal igual ao último", () => {
  assert.match(source, /const liveIds = useMemo\(\(\) => freeNormalizeSelection\(design, selection\), \[design, selection\]\);/);
  assert.match(source, /const selectedId = liveIds\.at\(-1\) \?\? null;/);
  assert.equal(source.match(/selectedIds=\{liveIds\}/g)?.length, 3, "desenho, Camadas e Varios");
  assert.equal(/selectedIds=\{selection\}/.test(source), false, "nunca o estado cru (ids mortos depois do Ctrl + Z e do Excluir)");

  const layers = source.match(/<FreeLayersPanel\n[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(layers, /selectedId=\{activeId\}\s+selectedIds=\{liveIds\}/);
  assert.match(layers, /onSelect=\{selectFromLayers\}/);

  const canvas = source.match(/<FreeCanvas\n[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(canvas, /selectedId=\{activeId\}\s+selectedIds=\{liveIds\}/);
  assert.match(canvas, /onSelect=\{selectFromCanvas\}/);
  assert.match(canvas, /onCommitMoves=\{onCommitMoves\}/);
  assert.match(canvas, /description=\{freeManyDescription\(stageDesign, liveIds, rects\)\}/);

  assert.match(source, /<FreeInspectorMany design=\{design\} device=\{device\} disabled=\{disabled\} onCommand=\{onManyCommand\} rects=\{rects\} selectedIds=\{liveIds\} \/>/);
  assert.match(bodyOf("function applySelect("), /freeEditorSelect\(historyRef\.current\.present\.design, \{ anchor: anchorRef\.current, ids: liveIds \}, request\)/);
});

test("cada ramo de runMany e de onManyCommand grava um passo só; as teclas da linha com selection vão para runMany", () => {
  const runMany = bodyOf("function runMany(");
  const cases = runMany.split(/\n {6}case "/).slice(1);

  assert.equal(cases.length, 6, "duplicate, remove, toggleHidden, toggleLocked, forward e backward");

  for (const block of cases) {
    assert.ok(commits(block) <= 1, `um commit so: ${block.slice(0, 30)}`);
  }

  assert.match(runMany, /duplicateFreeNodes\(present\.design, ids, present\.cta\)/);
  assert.match(runMany, /focusAfterRemove\(result\.removed\);\s+commit\(\{ cta: result\.ctaRemoved \? null : present\.cta, design: result\.design \}\);/);
  assert.match(runMany, /commitDesign\(next, \{ coalesceKey: freeGroupCoalesceKey\(ids, deviceRef\.current, "z"\) \}\);/, "a camada junta passos pela chave do grupo");

  const many = bodyOf("function onManyCommand(");
  assert.equal(commits(many), 1, "alinhar e distribuir: um commit");
  assert.match(many, /alignFreeNodes\(present\.design, liveIds, command\.edge, command\.scope, rects, deviceRef\.current\)/);
  assert.match(many, /distributeFreeNodes\(present\.design, liveIds, command\.axis, rects, deviceRef\.current\)/);
  assert.match(many, /runMany\(command\.kind\);/);

  const moves = bodyOf("function onCommitMoves(");
  assert.equal(commits(moves), 1);
  assert.match(moves, /moveFreeNodesBy\(present, ids, delta\.dx, delta\.dy, deviceRef\.current\)/);

  const layer = bodyOf("function onLayerCommand(");
  assert.match(layer, /if \(command\.selection && many && liveIds\.includes\(command\.id\) && isManyKind\(command\.kind\)\) \{\s+runMany\(command\.kind\);/);
  assert.match(layer, /runCommand\(command\.kind, command\.id\);/, "sem selection (o olho, o cadeado e o ⋯), so a linha");
});

test("o teclado com vários: Ctrl + D, Delete, [ ] e as setas do grupo num passo; Alt + ↑/↓ pede um elemento só", () => {
  const keys = bodyOf("function manyKeyDown(");

  assert.match(keys, /runMany\("duplicate"\)/);
  assert.match(keys, /runMany\("remove"\)/);
  assert.match(keys, /runMany\(key === "\]" \? "forward" : "backward"\)/);
  assert.match(keys, /announce\(S\.onlyOne\)/);
  assert.match(keys, /commitDesign\(next, \{ coalesceKey: freeGroupCoalesceKey\(ids, device\) \}\);/);
  assert.match(keys, /canvasApi\.current\?\.reveal\(ids\);/);
  assert.match(keys, /S\.position\(position\.x, position\.y\)/);
  assert.equal(commits(keys), 1);

  const onKeyDown = bodyOf("function onKeyDown(");
  assert.match(onKeyDown, /select\(freeSelectionEscape\(design, liveIds\)\);/, "Esc ao pai comum");
  assert.match(onKeyDown, /applySelect\(\{ kind: "all", stageDesign \}\);/, "Ctrl + A");
  assert.ok(onKeyDown.indexOf("if (typing) {") < onKeyDown.indexOf('lower === "a"'), "Ctrl + A so fora de campo de texto");
  assert.match(onKeyDown, /if \(many\) \{\s+manyKeyDown\(event, onCanvas\);\s+return;/);
});

test("C11 e a aba: o foco vai ao título do Vários ou ao palco; o painel de um elemento fica montado e escondido", () => {
  const change = source.match(/const changeSelection = useCallback\([\s\S]*?\n {2}\}, \[\]\);/)?.[0] ?? "";

  assert.match(change, /freePanelFocusAfter\(liveIdsRef\.current\.length, new Set\(next\)\.size, inRight\)/);
  assert.match(change, /closest\("\[data-free-zone=\\"right\\"\]"\)/);
  assert.match(change, /pendingManyFocus\.current = true;/);
  assert.match(change, /pendingLayerFocus\.current = "stage";/);
  assert.match(source, /document\.getElementById\(FREE_INSPECTOR_MANY_TITLE_ID\)\?\.focus\(\);/);

  assert.match(source, /<div className=\{cn\("min-h-0 min-w-0 flex-1 flex-col", many \? "hidden" : "flex"\)\}>\s+<FreeInspector\b/);
  assert.match(source, /selectedId=\{inspectorId\}/);
  assert.match(source, /if \(!many && heldInspectorId !== activeId\) \{\s+setHeldInspectorId\(activeId\);/);
  assert.match(source, /const inspectorId = many \? heldInspectorId : activeId;/);
});

test("o Elementos acrescenta pelo principal e o ramo move das Camadas continua igual", () => {
  assert.match(source, /addFreeElement\(present\.design, kind, \{ at, center, selectedId: activeId \}\)/);
  assert.match(source, /if \(command\.kind === "move"\) \{\s*moveTo\(command\.id, command\.target\);/);
});

test("os arquivos novos do L4b não montam HTML nem CSS em texto", () => {
  const dir = new URL("../src/components/admin/v2/communication/popup-free/", import.meta.url);

  for (const file of ["free-editor-selection.ts", "free-inspector-many.tsx", "free-zoom-control.tsx", "free-editor.tsx"]) {
    const text = readFileSync(new URL(file, dir), "utf8");

    assert.equal(/dangerouslySetInnerHTML|\.innerHTML|cssText|<style[\s>]|style="/.test(text), false, file);
  }
});
