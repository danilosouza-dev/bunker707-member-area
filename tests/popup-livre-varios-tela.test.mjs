import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import "./support/transpile-tsx.mjs";

// Editor Livre do pop-up, L4b (docs/27 §13.10; docs/18 §1.1), painel Varios: o painel da direita com 2 ou mais
// escolhidos, desenhado pelo react-dom/server. O titulo (h2 com tabIndex -1 e o id que o editor foca, C11), a dica e
// a lista "Na seleção" com "Escolher só {nome}"; os 12 nomes acessiveis distintos de alinhar ("entre si" e "no
// pop-up", nunca o "Alinhar ao centro" solto de um elemento so) com os icones do Avançado; o comando que cada botao
// manda (Alinhar no pop-up com varios: cada um na prancheta, decisao 1 do produtor); cada grupo desligado com
// aria-disabled, o clique sem efeito e o motivo escrito embaixo em 12 px ligado por aria-describedby; Esconder ou
// Mostrar e Travar ou Destravar pela regra; a nota do Celular; o editor desligado; nada abaixo de 12 px, nada de HTML
// em texto e o vocabulario da equipe.
//
// Os comandos sao conferidos pela arvore do React: FreeInspectorMany e as pecas dele (AlignGroup e ManyButton) nao
// usam hooks, entao a funcao devolve os elementos e o onClick de cada botao pode ser chamado direto.

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { FREE_INSPECTOR_MANY_TITLE_ID, FreeInspectorMany } = await import("../src/components/admin/v2/communication/popup-free/free-inspector-many.tsx");
const { ALIGN_ICONS } = await import("../src/components/admin/v2/communication/popup-free/free-inspector-advanced.tsx");
const selection = await import("../src/components/admin/v2/communication/popup-free/free-editor-selection.ts");
const editor = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
const inspector = await import("../src/components/admin/v2/communication/popup-free/free-inspector-model.ts");
const model = await import("../src/server/communications/popup-free-model.ts");

const S = selection.FREE_SELECTION_COPY;
const EDGES = inspector.FREE_ALIGN_EDGES;
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete", "fluxo"];
const SOURCE = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-inspector-many.tsx", import.meta.url), "utf8");

function design(children, extra = {}) {
  return model.canonicalPopupFreeDesign({ children, mode: "free", version: 1, ...extra });
}

const TITLE = { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" };
const TEXT = { id: "texto", lines: [[{ text: "Assista hoje." }]], type: "text" };
const LINKS = { id: "links", type: "links" };
const AUDIO = { id: "audio", type: "audio" };
const forma = (id, x, y, extra = {}) => ({ id, type: "shape", ...extra, place: { h: 40, mode: "free", w: 40, x, y, ...extra.place } });
const rect = (x, y, w, h) => ({ h, w, x, y });

/** Os retangulos medidos como o desenho mede: a prancheta e cada solto pela posicao dele no aparelho. */
function measured(value, device = "desktop") {
  const out = { "@artboard": rect(0, 0, 440, 400) };

  model.walkFreeNodes(value.children, (node) => {
    const place = device === "mobile" ? (editor.freeMobileFreePlace(value, node.id) ?? node.place) : node.place;

    out[node.id] = place?.mode === "free" ? rect(place.x, place.y, place.w, place.h ?? 30) : rect(0, 0, 440, 30);
  });

  return out;
}

const BASE = design([TITLE, forma("a", 10, 10, { name: "Fundo" }), forma("b", 80, 60), forma("c", 150, 120), TEXT, LINKS, AUDIO]);

function propsOf(value, selectedIds, extra = {}) {
  return { design: value, device: "desktop", disabled: false, onCommand() {}, rects: measured(value, extra.device), selectedIds, ...extra };
}

function html(props) {
  return renderToStaticMarkup(createElement(FreeInspectorMany, props));
}

/** Os botoes do HTML: atributos, o texto (sem tags) e o HTML de dentro. */
function buttonsOf(markup) {
  return [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, raw, inner]) => ({
    attrs: Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])),
    inner,
    text: inner.replace(/<[^>]*>/g, "").trim()
  }));
}

function nameOfButton(button) {
  return button.attrs["aria-label"] ?? button.text;
}

function buttonNamed(markup, name) {
  const found = buttonsOf(markup).filter((button) => nameOfButton(button) === name);

  assert.equal(found.length, 1, `um botão só com o nome "${name}"`);

  return found[0];
}

/** O texto do elemento com esse id (os motivos e a nota sao um <p> so de texto). */
function textOfId(markup, id) {
  return new RegExp(`<p class="([^"]*)" id="${id}">([^<]*)</p>`).exec(markup);
}

/* A arvore do React: o FreeInspectorMany e as pecas dele sem hooks viram elementos; os botoes tem o onClick. */

const EXPAND = new Set(["AlignGroup", "ManyButton"]);

function clickables(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => clickables(child, out));

    return out;
  }

  if (!node || typeof node !== "object" || !("props" in node)) {
    return out;
  }

  if (typeof node.type === "function" && EXPAND.has(node.type.name)) {
    return clickables(node.type(node.props), out);
  }

  if (typeof node.props.onClick === "function") {
    out.push(node);
  }

  clickables(node.props.children, out);

  return out;
}

function textOfNode(node) {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(textOfNode).join("");
  }

  return node && typeof node === "object" && "props" in node ? textOfNode(node.props.children) : "";
}

/** Aperta o botao com esse nome e devolve os comandos que o painel mandou. */
function press(props, name) {
  const commands = [];
  const tree = FreeInspectorMany({ ...props, onCommand: (command) => commands.push(command) });
  const found = clickables(tree).filter((element) => (element.props["aria-label"] ?? textOfNode(element.props.children).trim()) === name);

  assert.equal(found.length, 1, `um botão só com o nome "${name}"`);
  found[0].props.onClick();

  return commands;
}

/* ------------------------------------------------------------------------------------------------
 * Titulo, dica e lista
 * ---------------------------------------------------------------------------------------------- */

test("título (h2 com tabIndex -1 e o id que o editor foca), a dica e a lista 'Na seleção' com 'Escolher só {nome}'", () => {
  const markup = html(propsOf(BASE, ["a", "nada", "b", "titulo", "a"]));

  assert.match(markup, /^<div class="[^"]*" data-free-inspector="many">/);
  assert.equal(FREE_INSPECTOR_MANY_TITLE_ID, "livre-varios-titulo");
  // So os vivos, sem repetidos: 3 elementos.
  assert.match(markup, /<h2 class="[^"]*" id="livre-varios-titulo" tabindex="-1">3 elementos selecionados<\/h2>/);
  assert.ok(markup.includes(`<p class="m-0 text-xs leading-5 text-[var(--text-secondary)]">${S.panel.hint}</p>`), "a dica em 12 px");
  assert.equal(S.panel.hint, "Para mudar textos, cores e tamanhos, escolha um elemento só.");

  // A lista na ordem da escolha, com o nome dado ou o tipo.
  const list = /<section aria-label="Na seleção"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";
  assert.deepEqual(
    buttonsOf(list).map((button) => button.text),
    ["Escolher só Fundo", "Escolher só Forma", "Escolher só Título"]
  );
  assert.deepEqual(
    buttonsOf(list).map((button) => button.attrs["data-free-many-only"]),
    ["a", "b", "titulo"]
  );

  // Uma caixa e algo dentro dela nunca ficam juntos: fica o escolhido por ultimo.
  const box = { children: [{ id: "selo", label: "Novo", type: "badge" }], id: "caixa", type: "box" };
  const withBox = design([forma("a", 10, 10), box, LINKS]);
  const boxed = html(propsOf(withBox, ["caixa", "a", "selo"]));
  assert.match(boxed, /tabindex="-1">2 elementos selecionados<\/h2>/);
  assert.ok(boxed.includes("Escolher só Selo"));
  assert.equal(boxed.includes("Escolher só Caixa"), false);

  // Escolher so manda o id da linha.
  assert.deepEqual(press(propsOf(BASE, ["a", "b", "titulo"]), "Escolher só Título"), [{ id: "titulo", kind: "selectOnly" }]);
  assert.deepEqual(press(propsOf(BASE, ["a", "b", "titulo"]), "Escolher só Fundo"), [{ id: "a", kind: "selectOnly" }]);
});

/* ------------------------------------------------------------------------------------------------
 * Alinhar e distribuir
 * ---------------------------------------------------------------------------------------------- */

test("alinhar: 12 nomes acessíveis distintos ('entre si' e 'no pop-up'), sem o 'Alinhar ao centro' de um elemento só, com os ícones do Avançado", () => {
  const markup = html(propsOf(BASE, ["a", "b", "c"]));
  const names = buttonsOf(markup)
    .map(nameOfButton)
    .filter((name) => name.startsWith("Alinhar"));
  const expected = ["selection", "artboard"].flatMap((scope) => EDGES.map((edge) => S.alignLabel(edge, scope)));

  assert.deepEqual(names, expected);
  assert.equal(new Set(names).size, 12);
  assert.deepEqual(names.slice(0, 6), ["Alinhar à esquerda entre si", "Alinhar ao centro entre si", "Alinhar à direita entre si", "Alinhar em cima entre si", "Alinhar no meio entre si", "Alinhar embaixo entre si"]);
  assert.deepEqual(names.slice(6), ["Alinhar à esquerda no pop-up", "Alinhar ao centro no pop-up", "Alinhar à direita no pop-up", "Alinhar em cima no pop-up", "Alinhar no meio no pop-up", "Alinhar embaixo no pop-up"]);

  // Nenhum nome de um elemento so ("Alinhar ao centro"): o ponta a ponta de um elemento acha um botao so com ele.
  for (const single of Object.values(inspector.FREE_ALIGN_LABELS)) {
    assert.equal(names.includes(single), false, single);
    assert.equal(markup.includes(`aria-label="${single}"`), false, single);
  }

  // Os grupos com o titulo e os icones do Avançado (o mesmo lado, o mesmo icone).
  assert.match(markup, /<section aria-label="Alinhar entre si"[^>]*>[\s\S]*?<h3[^>]*>Alinhar entre si<\/h3>/);
  assert.match(markup, /<section aria-label="Alinhar no pop-up"[^>]*>[\s\S]*?<h3[^>]*>Alinhar no pop-up<\/h3>/);
  assert.deepEqual(Object.keys(ALIGN_ICONS).sort(), [...EDGES].sort());

  for (const edge of EDGES) {
    const icon = renderToStaticMarkup(createElement(ALIGN_ICONS[edge], { "aria-hidden": "true", className: "size-4" }));

    for (const scope of ["selection", "artboard"]) {
      const button = buttonNamed(markup, S.alignLabel(edge, scope));

      assert.equal(button.inner, icon, `${edge} ${scope}`);
      assert.equal(button.attrs.title, S.alignLabel(edge, scope), "a dica do mouse diz o mesmo nome");
    }
  }

  // Distribuir: dois botoes com o texto, e os icones de espacos iguais.
  assert.match(markup, /<section aria-label="Distribuir os espaços"[^>]*>/);
  assert.match(buttonNamed(markup, "Espaços iguais na horizontal").inner, /lucide-align-horizontal-space-between/);
  assert.match(buttonNamed(markup, "Espaços iguais na vertical").inner, /lucide-align-vertical-space-between/);
});

test("a Camada do painel Vários tem a frase do Avançado: quem está mais acima nas Camadas fica por cima (L64)", () => {
  const markup = html(propsOf(BASE, ["a", "b"]));
  const section = markup.match(/<section aria-label="Camada"[\s\S]*?<\/section>/)?.[0] ?? "";
  const note = inspector.FREE_INSPECTOR_COPY.advanced.layerNote;

  assert.ok(section, "a secao Camada");
  assert.equal(note, "Quem está mais acima nas Camadas fica por cima; aqui você muda isso.");
  assert.ok(section.includes(`<p class="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">${note}</p>`), "a frase embaixo do titulo, com 13 px");
  // Os dois botoes continuam na secao, na ordem do Avançado.
  assert.ok(section.indexOf("Trazer para frente") < section.indexOf("Enviar para trás"));
});

test("comandos: cada botão manda o seu; 'Alinhar no pop-up' com vários leva cada um à borda da prancheta (decisão 1)", () => {
  const ids = ["a", "b", "c"];
  const props = propsOf(BASE, ids);
  const rects = props.rects;

  assert.deepEqual(press(props, "Duplicar"), [{ kind: "duplicate" }]);
  assert.deepEqual(press(props, "Excluir"), [{ kind: "remove" }]);
  assert.deepEqual(press(props, "Trazer para frente"), [{ kind: "forward" }]);
  assert.deepEqual(press(props, "Enviar para trás"), [{ kind: "backward" }]);
  assert.deepEqual(press(props, "Esconder"), [{ kind: "toggleHidden" }]);
  assert.deepEqual(press(props, "Travar"), [{ kind: "toggleLocked" }]);
  assert.deepEqual(press(props, "Espaços iguais na horizontal"), [{ axis: "x", kind: "distribute" }]);
  assert.deepEqual(press(props, "Espaços iguais na vertical"), [{ axis: "y", kind: "distribute" }]);

  for (const edge of EDGES) {
    assert.deepEqual(press(props, S.alignLabel(edge, "selection")), [{ edge, kind: "align", scope: "selection" }]);
    assert.deepEqual(press(props, S.alignLabel(edge, "artboard")), [{ edge, kind: "align", scope: "artboard" }]);
  }

  // Decisao 1: "Alinhar à esquerda no pop-up" leva cada um a x 0 (nao o conjunto como um bloco)...
  const [artboard] = press(props, "Alinhar à esquerda no pop-up");
  const each = selection.alignFreeNodes(BASE, ids, artboard.edge, artboard.scope, rects, "desktop");
  assert.deepEqual(ids.map((id) => model.findFreeNode(each.design, id).node.place.x), [0, 0, 0]);
  assert.deepEqual(ids.map((id) => model.findFreeNode(each.design, id).node.place.y), [10, 60, 120], "o outro eixo fica");

  // ... e "Alinhar ao centro no pop-up" centra cada um: (440 - 40) / 2.
  const [center] = press(props, "Alinhar ao centro no pop-up");
  const centered = selection.alignFreeNodes(BASE, ids, center.edge, center.scope, rects, "desktop");
  assert.deepEqual(ids.map((id) => model.findFreeNode(centered.design, id).node.place.x), [200, 200, 200]);

  // "Alinhar à esquerda entre si" leva todos a borda do mais a esquerda.
  const [between] = press(props, "Alinhar à esquerda entre si");
  const together = selection.alignFreeNodes(BASE, ids, between.edge, between.scope, rects, "desktop");
  assert.deepEqual(ids.map((id) => model.findFreeNode(together.design, id).node.place.x), [10, 10, 10]);
});

test("desligados: aria-disabled, o clique não faz nada e o motivo de 12 px embaixo do grupo, ligado por aria-describedby", () => {
  /** Confere um grupo: todos os botoes desligados, apontando para o motivo, e o motivo escrito com 12 px. */
  function assertOff(markup, props, names, reasonId, reason) {
    const found = textOfId(markup, reasonId);

    assert.ok(found, `o motivo ${reasonId} está escrito`);
    assert.equal(found[2], reason);
    assert.match(found[1], /(^| )text-xs( |$)/, "o motivo tem 12 px");

    for (const name of names) {
      const button = buttonNamed(markup, name);

      assert.equal(button.attrs["aria-disabled"], "true", name);
      assert.equal(button.attrs.disabled, undefined, `${name}: continua focável`);
      assert.ok(button.attrs["aria-describedby"]?.split(" ").includes(reasonId), name);
      assert.match(button.attrs.class, /cursor-not-allowed!/, `${name}: o cursor de proibido (o button do globals.css so cede com o !)`);
      assert.deepEqual(press(props, name), [], `${name}: o clique não manda nada`);
    }
  }

  function assertOn(markup, names) {
    for (const name of names) {
      const button = buttonNamed(markup, name);

      assert.equal(button.attrs["aria-disabled"], undefined, name);
      assert.equal(button.attrs["aria-describedby"], undefined, name);
    }
  }

  const ALIGN_SELECTION = EDGES.map((edge) => S.alignLabel(edge, "selection"));
  const ALIGN_ARTBOARD = EDGES.map((edge) => S.alignLabel(edge, "artboard"));
  const DISTRIBUTE = ["Espaços iguais na horizontal", "Espaços iguais na vertical"];

  // Tres soltos: tudo ligado, nenhum motivo.
  const all = html(propsOf(BASE, ["a", "b", "c"]));
  assertOn(all, [...ALIGN_SELECTION, ...ALIGN_ARTBOARD, ...DISTRIBUTE, "Duplicar", "Excluir"]);
  assert.equal(all.includes("aria-disabled"), false);
  assert.equal(all.includes("livre-varios-motivo"), false);

  // Dois soltos: alinhar liga; distribuir pede 3.
  const twoProps = propsOf(BASE, ["a", "b"]);
  const two = html(twoProps);
  assertOn(two, [...ALIGN_SELECTION, ...ALIGN_ARTBOARD]);
  assertOff(two, twoProps, DISTRIBUTE, "livre-varios-motivo-distribuir", "Para distribuir os espaços, escolha 3 ou mais elementos soltos.");

  // So da sequencia: quem alinha e distribui e a caixa (cada grupo com o motivo embaixo dele).
  const flowProps = propsOf(BASE, ["titulo", "texto"]);
  const flow = html(flowProps);
  const sequence = "Na sequência, quem alinha e distribui é a caixa.";
  assertOff(flow, flowProps, ALIGN_SELECTION, "livre-varios-motivo-alinhar-entre-si", sequence);
  assertOff(flow, flowProps, ALIGN_ARTBOARD, "livre-varios-motivo-alinhar-no-pop-up", sequence);
  assertOff(flow, flowProps, DISTRIBUTE, "livre-varios-motivo-distribuir", sequence);
  assertOn(flow, ["Duplicar", "Excluir"]);
  // O motivo fica dentro do proprio grupo, depois dos botoes.
  assert.match(flow, /<section aria-label="Alinhar entre si"[\s\S]*?<\/button><\/div><p class="[^"]*" id="livre-varios-motivo-alinhar-entre-si">/);
  assert.match(flow, /<section aria-label="Alinhar no pop-up"[\s\S]*?<\/button><\/div><p class="[^"]*" id="livre-varios-motivo-alinhar-no-pop-up">/);

  // Um travado entre tres: os soltos que se veem bastariam, mas travado nao muda de lugar.
  const locked = design([forma("a", 10, 10), forma("b", 80, 60, { locked: true }), forma("c", 150, 120), LINKS]);
  const lockedProps = propsOf(locked, ["a", "b", "c"]);
  const lockedHtml = html(lockedProps);
  assertOn(lockedHtml, ALIGN_SELECTION);
  assertOff(lockedHtml, lockedProps, DISTRIBUTE, "livre-varios-motivo-distribuir", "Elementos travados não mudam de lugar.");

  // Sem a prancheta medida: alinhar no pop-up espera.
  const noArtboard = { ...propsOf(BASE, ["a", "b"]) };
  delete noArtboard.rects["@artboard"];
  assertOff(html(noArtboard), noArtboard, ALIGN_ARTBOARD, "livre-varios-motivo-alinhar-no-pop-up", "Para alinhar no pop-up, escolha um elemento solto.");

  // Links e Áudio: duplicar e excluir desligam, cada um com o seu motivo embaixo (o do modelo).
  const fixedProps = propsOf(BASE, ["links", "audio"]);
  const fixed = html(fixedProps);
  const reasons = selection.freeManyReasons(BASE, ["links", "audio"], fixedProps.rects);
  assert.ok(reasons.duplicate && reasons.remove && reasons.duplicate !== reasons.remove);
  assertOff(fixed, fixedProps, ["Duplicar"], "livre-varios-motivo-duplicar", reasons.duplicate);
  assertOff(fixed, fixedProps, ["Excluir"], "livre-varios-motivo-excluir", reasons.remove);

  // O painel mostra o mesmo que o modelo diz, em cada caso.
  for (const props of [twoProps, flowProps, lockedProps, fixedProps]) {
    const markup = html(props);
    const expected = selection.freeManyReasons(props.design, props.selectedIds, props.rects);
    const ids = {
      alignArtboard: "livre-varios-motivo-alinhar-no-pop-up",
      alignSelection: "livre-varios-motivo-alinhar-entre-si",
      distribute: "livre-varios-motivo-distribuir",
      duplicate: "livre-varios-motivo-duplicar",
      remove: "livre-varios-motivo-excluir"
    };

    for (const [key, id] of Object.entries(ids)) {
      assert.equal(textOfId(markup, id)?.[2] ?? null, expected[key], `${key}: ${props.selectedIds.join(", ")}`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * Esconder, travar, Celular, desligado
 * ---------------------------------------------------------------------------------------------- */

test("Esconder ou Mostrar e Travar ou Destravar pela regra (algum sem a marca: todos ganham; senão, todos perdem)", () => {
  const value = design([forma("a", 10, 10), forma("b", 80, 60, { hidden: true, locked: true }), forma("c", 150, 120, { hidden: true, locked: true }), LINKS]);
  const labels = (ids) => {
    const markup = html(propsOf(value, ids));
    const names = buttonsOf(markup).map(nameOfButton);

    return [names.filter((name) => name === "Esconder" || name === "Mostrar"), names.filter((name) => name === "Travar" || name === "Destravar")];
  };

  assert.deepEqual(labels(["a", "b"]), [["Esconder"], ["Travar"]], "um sem a marca: Esconder e Travar");
  assert.deepEqual(labels(["b", "c"]), [["Mostrar"], ["Destravar"]], "todos com a marca: Mostrar e Destravar");
  assert.deepEqual(labels(["a", "b", "c"]), [["Esconder"], ["Travar"]]);
  assert.equal(selection.freeManyFlagNext(value, ["b", "c"], "hidden"), false);

  // O comando e o mesmo; quem decide o valor e o editor pela mesma regra.
  assert.deepEqual(press(propsOf(value, ["b", "c"]), "Mostrar"), [{ kind: "toggleHidden" }]);
  assert.deepEqual(press(propsOf(value, ["b", "c"]), "Destravar"), [{ kind: "toggleLocked" }]);
  assert.match(buttonNamed(html(propsOf(value, ["b", "c"])), "Mostrar").inner, /lucide-eye /);
  assert.match(buttonNamed(html(propsOf(value, ["a", "b"])), "Esconder").inner, /lucide-eye-off/);
  assert.match(buttonNamed(html(propsOf(value, ["b", "c"])), "Destravar").inner, /lucide-lock-open/);
});

test("Ver como Celular: a nota no topo, e os botões de alinhar e distribuir apontam para ela; no computador, sem nota", () => {
  const ids = ["a", "b", "c"];
  const mobileProps = propsOf(BASE, ids, { device: "mobile" });
  const mobile = html(mobileProps);
  const note = textOfId(mobile, "livre-varios-celular");

  assert.ok(note);
  assert.equal(note[2], "Com Ver como: Celular, alinhar e distribuir mudam só o celular.");
  assert.match(note[1], /(^| )text-xs( |$)/, "a nota tem 12 px");

  const moving = [...EDGES.flatMap((edge) => [S.alignLabel(edge, "selection"), S.alignLabel(edge, "artboard")]), "Espaços iguais na horizontal", "Espaços iguais na vertical"];

  for (const name of moving) {
    assert.ok(buttonNamed(mobile, name).attrs["aria-describedby"]?.split(" ").includes("livre-varios-celular"), name);
  }

  for (const name of ["Duplicar", "Excluir", "Esconder", "Travar", "Trazer para frente", "Enviar para trás"]) {
    assert.equal(buttonNamed(mobile, name).attrs["aria-describedby"], undefined, `${name}: vale nos dois aparelhos`);
  }

  // Com o motivo, os dois: o motivo e a nota.
  const twoMobile = html(propsOf(BASE, ["a", "b"], { device: "mobile" }));
  assert.equal(buttonNamed(twoMobile, "Espaços iguais na horizontal").attrs["aria-describedby"], "livre-varios-motivo-distribuir livre-varios-celular");

  // O que a nota diz: o comando do painel, com o Celular, muda so devices.mobile.
  const [command] = press(mobileProps, "Alinhar à esquerda no pop-up");
  const result = selection.alignFreeNodes(BASE, ids, command.edge, command.scope, mobileProps.rects, "mobile");
  assert.deepEqual(ids.map((id) => model.findFreeNode(result.design, id).node.place.x), [10, 80, 150], "o computador fica");
  assert.deepEqual(ids.map((id) => result.design.devices.mobile.nodes[id].place.x), [0, 0, 0], "o celular anda");

  // No computador, sem nota.
  const desktop = html(propsOf(BASE, ids));
  assert.equal(desktop.includes("livre-varios-celular"), false);
  assert.equal(desktop.includes(S.panel.mobileNote), false);
});

test("editor desligado: os comandos desligam de verdade; 'Escolher só' continua (escolher não muda o design)", () => {
  const markup = html(propsOf(BASE, ["a", "b", "c"], { disabled: true }));

  for (const button of buttonsOf(markup)) {
    if (button.text.startsWith("Escolher só")) {
      assert.equal(button.attrs.disabled, undefined, button.text);
    } else {
      assert.equal(button.attrs.disabled, "", nameOfButton(button));
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * 12 px, HTML em texto e vocabulario
 * ---------------------------------------------------------------------------------------------- */

test("nada abaixo de 12 px e nada de HTML ou CSS em texto (fonte e desenho)", () => {
  const small = /text-\[(?:[1-9]|1[01])px\]|text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]|text-2xs/;

  assert.equal(small.test(SOURCE), false, "free-inspector-many.tsx: nenhum texto abaixo de 12 px");
  assert.equal(/dangerouslySetInnerHTML|\.innerHTML|cssText|<style[\s>]|style="/.test(SOURCE), false);
  // Sem hooks: o painel so desenha a partir das props (o teste confere os comandos pela arvore).
  assert.equal(/\buse[A-Z]\w*\(/.test(SOURCE), false);

  for (const props of [propsOf(BASE, ["a", "b", "c"], { device: "mobile" }), propsOf(BASE, ["titulo", "texto"]), propsOf(BASE, ["links", "audio"])]) {
    const markup = html(props);

    assert.equal(small.test(markup), false);
    assert.equal(/ style="/.test(markup), false, "nenhum estilo em texto no desenho");
  }

  // O Avançado so passou a exportar os icones: com um elemento, "Alinhar ao centro" continua o nome do botao.
  const advanced = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-inspector-advanced.tsx", import.meta.url), "utf8");
  assert.match(advanced, /export const ALIGN_ICONS: Record<FreeAlignEdge, typeof AlignStartVertical> = \{/);
  assert.match(advanced, /aria-label=\{FREE_ALIGN_LABELS\[edge\]\}/);
});

test("vocabulário: os textos do painel Vários sem palavra proibida nem hífen como separador", () => {
  const texts = [];

  for (const props of [propsOf(BASE, ["a", "b", "c"], { device: "mobile" }), propsOf(BASE, ["titulo", "texto"]), propsOf(BASE, ["links", "audio"]), propsOf(BASE, ["a", "b"])]) {
    const markup = html(props);

    texts.push(...markup.replace(/<svg[\s\S]*?<\/svg>/g, " ").split(/<[^>]*>/).map((text) => text.trim()).filter(Boolean));
    texts.push(...[...markup.matchAll(/(?:aria-label|title)="([^"]*)"/g)].map((match) => match[1]));
  }

  assert.ok(texts.length > 30);

  for (const text of texts) {
    for (const word of PROIBIDAS) {
      assert.equal(new RegExp(`(^|[^\\p{L}])${word}`, "iu").test(text), false, `“${text}” usa “${word}”`);
    }

    assert.equal(/ [-–—] /.test(text), false, `“${text}”: sem hífen como separador`);
  }
});
