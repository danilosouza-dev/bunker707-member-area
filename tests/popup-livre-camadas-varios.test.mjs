import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import "./support/transpile-tsx.mjs";

// Editor Livre do pop-up, L4b (docs/27 §13.10, L36 e L37; docs/18 §1.1), pacote das Camadas com varios escolhidos:
// as linhas escolhidas marcadas, aria-current so no principal, a etiqueta "Na seleção" (12 px) nas outras e lida pelo
// aria-describedby mesmo quando e a unica etiqueta da linha (C1), o Tab no principal, o clique com Ctrl/⌘ e Shift, o
// arrastar que nao comeca com tecla, as teclas E, T, Delete e Ctrl + D na selecao (e o ⋯ so na linha, C17) e o
// painel de antes sem a lista de escolhidos (C6). O painel e desenhado com react-dom/server; as regras do clique, do
// arrastar e das teclas sao funcoes do proprio painel, chamadas direto.

const layers = await import("../src/components/admin/v2/communication/popup-free/free-layers-panel.tsx");
const editor = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
const selection = await import("../src/components/admin/v2/communication/popup-free/free-editor-selection.ts");
const model = await import("../src/server/communications/popup-free-model.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const { FreeLayersPanel, freeLayerClickHow, freeLayerDragAllowed, freeLayerKeyCommand } = layers;
const S = selection.FREE_SELECTION_COPY;
const E = editor.FREE_EDITOR_COPY;
const SOURCE = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-layers-panel.tsx", import.meta.url), "utf8");
// O codigo sem os comentarios (os comentarios citam as regras com as mesmas palavras).
const CODE = SOURCE.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete", "fluxo"];
const MARCADA = "bg-[var(--surface-3)] shadow-[inset_2px_0_0_var(--focus-ring)]";

// Título e Texto na sequencia (sem etiqueta nenhuma), duas Formas soltas e uma Caixa com um Selo dentro.
const DESIGN = model.canonicalPopupFreeDesign({
  children: [
    { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" },
    { id: "a", place: { h: 40, mode: "free", w: 40, x: 10, y: 10 }, type: "shape" },
    { id: "b", place: { h: 40, mode: "free", w: 40, x: 80, y: 10 }, type: "shape" },
    { id: "texto", lines: [[{ text: "Assista hoje." }]], type: "text" },
    { children: [{ id: "selo", label: "Novo", type: "badge" }], id: "caixa", type: "box" }
  ],
  mode: "free",
  version: 1
});

function draw(props = {}) {
  return renderToStaticMarkup(
    createElement(FreeLayersPanel, { cta: null, design: DESIGN, disabled: false, flagged: new Set(), onCommand() {}, onSelect() {}, selectedId: null, ...props })
  );
}

/** A div da linha (botoes inclusive), sem as linhas de dentro de uma caixa. */
function line(html, id) {
  const at = html.indexOf(`data-free-layer-line="${id}"`);

  assert.ok(at > 0, `a linha ${id} existe`);

  const next = html.indexOf('data-free-layer-line="', at + 1);

  return html.slice(html.lastIndexOf("<div", at), next === -1 ? html.length : html.lastIndexOf("<li", next));
}

/** A abertura do botao de selecionar da linha (o botao 0). */
function selectButton(html, id) {
  return line(html, id).match(/<button data-free-layer-button="0"[^>]*>/)?.[0] ?? "";
}

/** As etiquetas da linha, na ordem, com a classe de cada uma; null quando a linha nao tem o span das etiquetas. */
function tagsOf(html, id) {
  const at = html.indexOf(`id="free-layer-tags-${id}">`);

  if (at === -1) {
    return null;
  }

  const inner = html.slice(at, html.indexOf("</span></span>", at) + "</span>".length);

  return Array.from(inner.matchAll(/<span class="([^"]*)">([^<]*)<\/span>/g), ([, className, text]) => ({ className, text }));
}

function tagTexts(html, id) {
  return tagsOf(html, id)?.map((tag) => tag.text) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * As linhas escolhidas
 * ---------------------------------------------------------------------------------------------- */

test("com 3 escolhidos, aria-current só no principal, 'Na seleção' nas outras escolhidas e o Tab no principal", () => {
  const html = draw({ selectedId: "b", selectedIds: ["titulo", "a", "b"] });

  // aria-current so no principal (o ultimo escolhido).
  assert.equal(html.match(/aria-current="true"/g)?.length, 1);
  assert.match(selectButton(html, "b"), /aria-current="true"/);

  for (const id of ["titulo", "a", "texto", "caixa", "selo"]) {
    assert.doesNotMatch(selectButton(html, id), /aria-current/, id);
  }

  // As tres escolhidas com o mesmo fundo; as outras nao.
  for (const id of ["titulo", "a", "b"]) {
    assert.ok(line(html, id).includes(MARCADA), `${id} marcada`);
  }

  for (const id of ["texto", "caixa", "selo"]) {
    assert.equal(line(html, id).includes(MARCADA), false, `${id} sem marca`);
  }

  // "Na seleção" nas outras escolhidas (antes das outras etiquetas), nunca no principal nem fora da selecao.
  assert.deepEqual(tagTexts(html, "a"), [S.inSelection, E.layers.tags.free]);
  assert.deepEqual(tagTexts(html, "b"), [E.layers.tags.free]);
  assert.equal(tagTexts(html, "texto"), null);
  assert.equal(html.split(S.inSelection).length - 1, 2, "duas etiquetas Na seleção");

  // O Tab (o unico tabIndex 0 da lista) fica no principal.
  assert.equal(html.match(/tabindex="0"/g)?.length, 1);
  assert.match(selectButton(html, "b"), /tabindex="0"/);
});

test("'Na seleção' aparece e é lida numa linha da sequência sem nenhuma outra etiqueta (C1)", () => {
  const html = draw({ selectedId: "b", selectedIds: ["titulo", "a", "b"] });

  // O Título na sequencia nao e solto, escondido, travado nem tem valores do celular: so a etiqueta da selecao.
  assert.deepEqual(tagTexts(html, "titulo"), [S.inSelection]);
  assert.match(selectButton(html, "titulo"), /aria-describedby="free-layer-tags-titulo"/);

  // A etiqueta e a Tag2 das outras: 12 px.
  const [tag] = tagsOf(html, "titulo");
  assert.match(tag.className, /text-\[12px\]/);
  assert.equal(tag.className, tagsOf(html, "b")[0].className, "a mesma etiqueta da Solta");

  // Sem estar escolhido, o Título volta a nao ter etiqueta nem descricao.
  const alone = draw({ selectedId: "b", selectedIds: ["a", "b"] });

  assert.equal(tagsOf(alone, "titulo"), null);
  assert.doesNotMatch(selectButton(alone, "titulo"), /aria-describedby/);
});

test("o principal dentro de uma caixa leva o Tab, e o escolhido de outro nível ganha 'Na seleção'", () => {
  const html = draw({ selectedId: "selo", selectedIds: ["texto", "selo"] });

  assert.match(selectButton(html, "selo"), /aria-current="true"/);
  assert.match(selectButton(html, "selo"), /tabindex="0"/);
  assert.deepEqual(tagTexts(html, "texto"), [S.inSelection]);
  assert.equal(tagTexts(html, "selo"), null, "o principal nao ganha a etiqueta");
  assert.equal(line(html, "caixa").includes(MARCADA), false, "a caixa de fora nao fica marcada");
});

test("sem a lista de escolhidos (o editor de antes) e com um escolhido só, as Camadas ficam como antes", () => {
  const before = draw({ selectedId: "a" });

  // C6: a prop nova e opcional; sem ela, so o selectedId esta escolhido, e o desenho e o mesmo da lista com ele so.
  assert.equal(draw({ selectedId: "a", selectedIds: ["a"] }), before);
  assert.equal(before.includes(S.inSelection), false);
  assert.equal(before.match(/aria-current="true"/g)?.length, 1);
  assert.match(selectButton(before, "a"), /aria-current="true"/);
  assert.ok(line(before, "a").includes(MARCADA));
  assert.deepEqual(tagTexts(before, "a"), [E.layers.tags.free]);

  // Nada escolhido: nenhuma marca, nenhum aria-current, o Tab na primeira linha.
  const none = draw();

  assert.equal(none.includes(MARCADA), false);
  assert.doesNotMatch(none, /aria-current/);
  assert.match(selectButton(none, "titulo"), /tabindex="0"/);
});

/* ------------------------------------------------------------------------------------------------
 * Clique, arrastar e teclas
 * ---------------------------------------------------------------------------------------------- */

test("o clique na linha: Ctrl ou ⌘ põe ou tira, Shift pega o intervalo, sem tecla só ela", () => {
  const keys = (extra = {}) => ({ ctrlKey: false, metaKey: false, shiftKey: false, ...extra });

  assert.equal(freeLayerClickHow(keys()), "only");
  assert.equal(freeLayerClickHow(keys({ ctrlKey: true })), "toggle");
  assert.equal(freeLayerClickHow(keys({ metaKey: true })), "toggle", "o ⌘ do Mac (Ctrl + clique abre o menu de contexto)");
  assert.equal(freeLayerClickHow(keys({ shiftKey: true })), "range");
  assert.equal(freeLayerClickHow(keys({ ctrlKey: true, shiftKey: true })), "toggle", "Ctrl vale antes do Shift");
});

test("o arrastar da linha não começa com Shift, Ctrl, ⌘ ou Alt", () => {
  const keys = (extra = {}) => ({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });

  assert.equal(freeLayerDragAllowed(keys()), true);

  for (const key of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(freeLayerDragAllowed(keys({ [key]: true })), false, key);
  }
});

test("E, T, Delete e Ctrl + D numa linha da seleção de 2 ou mais agem na seleção; fora dela, com um só e Alt + ↑/↓, só na linha", () => {
  const chosen = ["titulo", "a", "b"];
  const position = { button: 0, buttons: 4, row: 1, rows: 6 };
  const press = (key, extra = {}) => editor.freeLayerKeyAction({ altKey: false, ctrlKey: false, key, metaKey: false, shiftKey: false, ...extra }, position);
  const ofKey = (action, id, ids) => freeLayerKeyCommand(action.kind, id, ids);

  // A tecla de verdade (freeLayerKeyAction) e o comando que o painel manda.
  for (const [action, kind] of [
    [press("e"), "toggleHidden"],
    [press("T"), "toggleLocked"],
    [press("Delete"), "remove"],
    [press("d", { ctrlKey: true }), "duplicate"],
    [press("d", { metaKey: true }), "duplicate"]
  ]) {
    assert.equal(action.kind, kind);
    assert.deepEqual(ofKey(action, "a", chosen), { id: "a", kind, selection: true }, `${kind} na selecao`);
    // A linha com o foco fora da selecao: so ela.
    assert.deepEqual(ofKey(action, "texto", chosen), { id: "texto", kind }, `${kind} fora da selecao`);
    // Um escolhido so: como antes do L4b.
    assert.deepEqual(ofKey(action, "a", ["a"]), { id: "a", kind }, `${kind} com um so`);
    assert.deepEqual(ofKey(action, "a", []), { id: "a", kind }, `${kind} sem nada escolhido`);
  }

  // Alt + ↑/↓ sobem e descem so a linha, mesmo dentro da selecao.
  assert.deepEqual(ofKey(press("ArrowUp", { altKey: true }), "a", chosen), { id: "a", kind: "moveUp" });
  assert.deepEqual(ofKey(press("ArrowDown", { altKey: true }), "a", chosen), { id: "a", kind: "moveDown" });
});

test("Shift + ↑/↓ estende e Ctrl/⌘ + Enter põe ou tira pelo teclado (as teclas que o painel liga)", () => {
  const position = { button: 0, buttons: 4, row: 2, rows: 6 };
  const press = (key, extra = {}) => editor.freeLayerKeyAction({ altKey: false, ctrlKey: false, key, metaKey: false, shiftKey: false, ...extra }, position);

  assert.deepEqual(press("ArrowDown", { shiftKey: true }), { index: 3, kind: "extend" });
  assert.deepEqual(press("ArrowUp", { shiftKey: true }), { index: 1, kind: "extend" });
  assert.deepEqual(press("Enter", { ctrlKey: true }), { kind: "toggleSelect" });
  assert.deepEqual(press("Enter", { metaKey: true }), { kind: "toggleSelect" });
  // Enter sem tecla continua escolhendo so a linha; Shift + T continua travando.
  assert.deepEqual(press("Enter"), { kind: "select" });
  assert.deepEqual(press("T", { shiftKey: true }), { kind: "toggleLocked" });
});

/* ------------------------------------------------------------------------------------------------
 * Guardas de fonte (como o painel liga as regras acima)
 * ---------------------------------------------------------------------------------------------- */

test("guarda: o arrastar da linha volta com tecla, rola o tabpanel e continua só com o mouse", () => {
  const begin = SOURCE.match(/function beginLayerDrag\([\s\S]*?\n {2}}\n/)?.[0] ?? "";

  assert.ok(begin, "beginLayerDrag existe");
  assert.match(begin, /if \(disabled \|\| gestureRef\.current \|\| !freeLayerDragAllowed\(event\)\) \{\s*return;\s*\}/);
  assert.ok(begin.indexOf("freeLayerDragAllowed(event)") < begin.indexOf("followFreePointer("), "a tecla e conferida antes de seguir o ponteiro");
  // A rolagem sozinha no painel que rola (o mesmo do ouvinte de rolagem), e so com o mouse (sem pointerTypes).
  assert.match(begin, /autoScroll: \(\) => gesture\?\.panel \?\? null,/);
  assert.match(begin, /const panel = listRef\.current\?\.closest<HTMLElement>\("\[role='tabpanel'\]"\) \?\? null;/);
  assert.doesNotMatch(begin, /pointerTypes/);
});

test("guarda: o clique, Shift + ↑/↓ e Ctrl + Enter chamam o onSelect com o jeito de escolher", () => {
  assert.match(SOURCE, /onClick=\{\(event\) => ctx\.onSelect\(row\.id, freeLayerClickHow\(event\)\)\}/);

  const keyDown = SOURCE.match(/function onRowKeyDown\([\s\S]*?\n {2}}\n/)?.[0] ?? "";

  assert.match(keyDown, /case "extend": \{[\s\S]*?focusRow\(next\);[\s\S]*?onSelect\(next, "range"\);[\s\S]*?break;\s*\}/);
  assert.match(keyDown, /case "toggleSelect":\s*onSelect\(row\.id, "toggle"\);\s*break;/);
  assert.match(keyDown, /case "select":\s*onSelect\(row\.id\);\s*break;/, "Enter continua so a linha");
  assert.match(keyDown, /run\(freeLayerKeyCommand\(action\.kind, row\.id, chosen\), action\.kind !== "remove"\);/);
});

test("guarda: só as teclas da linha levam a seleção; o olho, o cadeado e o ⋯ agem só na linha (C17)", () => {
  // freeLayerKeyCommand e o unico caminho para selection: true, e so o onRowKeyDown o chama.
  assert.equal(CODE.match(/freeLayerKeyCommand\(/g)?.length, 2, "a declaracao e a chamada do teclado");
  assert.equal(CODE.match(/selection: true/g)?.length, 1);

  const item = CODE.match(/function LayerItem\([\s\S]*?\n}\n/)?.[0] ?? "";

  assert.ok(item, "LayerItem existe");
  assert.doesNotMatch(item, /selection:|freeLayerKeyCommand/);
  assert.match(item, /onClick=\{\(\) => run\(\{ id: row\.id, kind: "toggleHidden" \}\)\}/, "o olho");
  assert.match(item, /onClick=\{\(\) => run\(\{ id: row\.id, kind: "toggleLocked" \}\)\}/, "o cadeado");
  assert.match(item, /label=\{copy\.duplicate\} onSelect=\{\(\) => run\(\{ id: row\.id, kind: "duplicate" \}\)\}/, "⋯ › Duplicar");
  assert.match(item, /label=\{copy\.remove\} onSelect=\{\(\) => run\(\{ id: row\.id, kind: "remove" \}, false\)\}/, "⋯ › Excluir");
});

test("guarda: 'Na seleção' fica no span das etiquetas, fora das etiquetas do elemento, e nada abaixo de 12 px", () => {
  // C1: a condicao do span e a do aria-describedby sao a mesma, com a selecao dentro.
  assert.match(SOURCE, /const tagged = inSelection \|\| row\.free \|\| row\.hidden \|\| row\.locked \|\| row\.mobile;/);
  assert.match(SOURCE, /aria-describedby=\{tagged \? `free-layer-tags-\$\{row\.id\}` : undefined\}/);
  assert.match(SOURCE, /\{tagged \? \(\s*<span className="flex min-w-0 flex-wrap gap-1" id=\{`free-layer-tags-\$\{row\.id\}`\}>\s*\{inSelection \? <Tag2>\{FREE_SELECTION_COPY\.inSelection\}<\/Tag2> : null\}/);

  // A frase mora com as de varios, e nao entre as etiquetas do elemento (o deepEqual delas continua).
  assert.equal(S.inSelection, "Na seleção");
  assert.equal(Object.values(E.layers.tags).includes(S.inSelection), false);

  const lower = S.inSelection.toLowerCase();

  for (const word of PROIBIDAS) {
    assert.equal(lower.includes(word), false, word);
  }

  // docs/17: nada abaixo de 12 px; o painel nao monta HTML nem CSS em texto.
  assert.equal(/text-\[(?:[1-9]|1[01])px\]|text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]/.test(SOURCE), false);
  assert.equal(/dangerouslySetInnerHTML|\.innerHTML|cssText|<style[\s>]|style="/.test(SOURCE), false);
});
