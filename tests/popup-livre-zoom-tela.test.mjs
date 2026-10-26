import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import "./support/transpile-tsx.mjs";

// Editor Livre do pop-up (docs/27 L43, L4b; docs/18 §1.1), pacote P11: o controle de zoom da barra de cima,
// [Diminuir o zoom] [menu "62 %"] [Aumentar o zoom], desenhado com react-dom/server:
// - os nomes ("Diminuir o zoom", "Aumentar o zoom" e "Zoom: Ajustar à tela (62 %)" ou "Zoom: 150 %"), o texto que se
//   ve no gatilho, os aria-keyshortcuts e o title de cada botao;
// - nas pontas: aria-disabled (continua no Tab), o motivo no title e num texto so do leitor de tela, ligado pelo
//   aria-describedby, e o clique que nao faz nada;
// - o menu de radio: so Ajustar a tela, 50, 75, 100, 150 e 200 % (decisao do produtor), o valor de agora marcado,
//   fechar ao escolher, escolher chama onFit ou onZoom e o foco volta ao gatilho;
// - nada abaixo de 12 px, sem HTML em texto e as frases no vocabulario.
//
// O menu e o DropdownMenu de src/components/ui/dropdown-menu.tsx (Base UI). O portal do Base UI nao desenha no
// servidor: por isso o import do menu feito pelo controle passa por um duble que, com globalThis.__zoomMenu ligado,
// desenha tudo sem portal e guarda o que recebeu (o valor do radio, o onValueChange, o finalFocus e o ref do gatilho);
// desligado, usa o menu de verdade (o gatilho de verdade, com aria-haspopup).

const CONTROL = "/popup-free/free-zoom-control.tsx";
const realMenu = new URL("../src/components/ui/dropdown-menu.tsx", import.meta.url).href;
const MENU_STUB = `import { createContext, createElement, useContext } from "react";
import * as real from ${JSON.stringify(realMenu)};
const seen = () => globalThis.__zoomMenu;
const RadioValue = createContext(undefined);
function pick(name, stub) {
  return function Part(props) { return seen() ? stub(props) : createElement(real[name], props); };
}
export const DropdownMenu = pick("DropdownMenu", ({ children }) => createElement("div", { "data-stub-menu": "" }, children));
export const DropdownMenuTrigger = pick("DropdownMenuTrigger", ({ children, ref, ...props }) => {
  seen().trigger = { ...props, ref };
  return createElement("button", { "aria-haspopup": "menu", type: "button", ...props }, children);
});
export const DropdownMenuContent = pick("DropdownMenuContent", ({ align, children, finalFocus, sideOffset, ...props }) => {
  seen().content = { align, finalFocus, sideOffset };
  return createElement("div", { role: "menu", ...props }, children);
});
export const DropdownMenuRadioGroup = pick("DropdownMenuRadioGroup", ({ children, onValueChange, value, ...props }) => {
  seen().radio = { onValueChange, value };
  return createElement(RadioValue.Provider, { value }, createElement("div", { role: "group", ...props }, children));
});
export const DropdownMenuRadioItem = pick("DropdownMenuRadioItem", ({ children, closeOnClick, label, value, ...props }) => {
  const current = useContext(RadioValue);
  seen().items.push({ closeOnClick, label, value });
  return createElement("div", { "aria-checked": String(Object.is(current, value)), role: "menuitemradio", ...props }, children);
});`;

// Registrado depois do transpile-tsx: roda antes dele. So o import do menu feito pelo controle vira o duble.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/components/ui/dropdown-menu" && (context.parentURL ?? "").endsWith(CONTROL)) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(MENU_STUB)}` };
    }

    return nextResolve(specifier, context);
  }
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { FreeZoomControl } = await import("../src/components/admin/v2/communication/popup-free/free-zoom-control.tsx");
const geometry = await import("../src/components/admin/v2/communication/popup-free/free-editor-geometry.ts");
const { FREE_EDITOR_COPY } = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");

const C = FREE_EDITOR_COPY.bar;
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete", "fluxo"];
const SOURCE = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-zoom-control.tsx", import.meta.url), "utf8");

function props(extra = {}) {
  return { disabledIn: false, disabledOut: false, onFit: () => {}, onStep: () => {}, onZoom: () => {}, shownPercent: 62, zoom: "fit", ...extra };
}

/** O controle com o menu de verdade (so o gatilho aparece: o portal do Base UI nao desenha no servidor). */
function draw(extra) {
  return renderToStaticMarkup(createElement(FreeZoomControl, props(extra)));
}

/** O controle com o menu aberto pelo duble: a marcacao e o que cada parte do menu recebeu. */
function drawWithMenu(extra) {
  globalThis.__zoomMenu = { items: [] };

  try {
    const markup = renderToStaticMarkup(createElement(FreeZoomControl, props(extra)));

    return { markup, seen: globalThis.__zoomMenu };
  } finally {
    globalThis.__zoomMenu = undefined;
  }
}

/** A abertura de um elemento pelo atributo (o primeiro que tiver). */
function tagWith(markup, element, attribute) {
  return markup.match(new RegExp(`<${element}[^>]*\\s${attribute}[^>]*>`))?.[0] ?? null;
}

function attr(tag, name) {
  return tag?.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
}

/** O texto que se le de um pedaco da marcacao, sem as tags. */
function textOf(markup) {
  return markup.replace(/<[^>]+>/g, "");
}

test("os três controles: nomes, atalhos, o title de cada botão e o gatilho com a escala que se vê", () => {
  const markup = draw();
  const group = tagWith(markup, "div", 'data-free-zoom-control=""');
  const out = tagWith(markup, "button", 'data-free-zoom="out"');
  const menu = tagWith(markup, "button", 'data-free-zoom="menu"');
  const into = tagWith(markup, "button", 'data-free-zoom="in"');

  assert.equal(attr(group, "role"), "group");
  assert.equal(attr(group, "aria-label"), "Zoom");

  // Na ordem da barra: [−] [62 %] [+].
  assert.ok(markup.indexOf(out) < markup.indexOf(menu) && markup.indexOf(menu) < markup.indexOf(into));

  assert.equal(attr(out, "aria-label"), "Diminuir o zoom");
  assert.equal(attr(out, "title"), "Diminuir o zoom (Ctrl + −)");
  assert.equal(attr(out, "aria-keyshortcuts"), "Control+- Meta+-", "Ctrl ou ⌘ com a tecla do menos");
  assert.equal(attr(into, "aria-label"), "Aumentar o zoom");
  assert.equal(attr(into, "title"), "Aumentar o zoom (Ctrl + =)");
  assert.equal(attr(into, "aria-keyshortcuts"), "Control+= Meta+=", "Ctrl ou ⌘ com a tecla do igual");

  // Longe das pontas: ligados, sem motivo.
  for (const button of [out, into]) {
    assert.equal(attr(button, "aria-disabled"), null);
    assert.equal(attr(button, "aria-describedby"), null);
    assert.equal(attr(button, "type"), "button");
  }

  assert.equal(markup.includes('class="sr-only"'), false, "sem motivo escrito quando nenhum botao esta na ponta");

  // O gatilho do menu de verdade: abre um menu, com o nome inteiro e o "62 %" a vista.
  assert.equal(attr(menu, "aria-haspopup"), "menu");
  assert.equal(attr(menu, "aria-label"), "Zoom: Ajustar à tela (62 %)");
  const trigger = markup.slice(markup.indexOf(menu), markup.indexOf("</button>", markup.indexOf(menu)));
  assert.equal(textOf(trigger), "62 %", "o que se ve no gatilho");
  assert.ok(attr(menu, "aria-label").includes(textOf(trigger)), "o nome contem o texto que se ve");
});

test("o gatilho: a escala do Ajustar à tela arredondada e, num passo, o próprio passo", () => {
  const triggerOf = (extra) => {
    const markup = draw(extra);
    const menu = tagWith(markup, "button", 'data-free-zoom="menu"');

    return { name: attr(menu, "aria-label"), text: textOf(markup.slice(markup.indexOf(menu), markup.indexOf("</button>", markup.indexOf(menu)))) };
  };

  // A conta da escala (0,62 * 100) da 62,00000000000001: vira 62.
  assert.deepEqual(triggerOf({ shownPercent: 0.62 * 100 }), { name: "Zoom: Ajustar à tela (62 %)", text: "62 %" });
  assert.deepEqual(triggerOf({ shownPercent: 100 }), { name: "Zoom: Ajustar à tela (100 %)", text: "100 %" });

  // Num passo, o passo escolhido, mesmo antes de a escala medida chegar (o shownPercent ainda de antes).
  assert.deepEqual(triggerOf({ shownPercent: 62, zoom: 150 }), { name: "Zoom: 150 %", text: "150 %" });
  assert.deepEqual(triggerOf({ shownPercent: 150, zoom: 150 }), { name: "Zoom: 150 %", text: "150 %" });
  assert.deepEqual(triggerOf({ shownPercent: 50, zoom: 50 }), { name: "Zoom: 50 %", text: "50 %" });
  assert.deepEqual(triggerOf({ shownPercent: 200, zoom: 200 }), { name: "Zoom: 200 %", text: "200 %" });

  // Uma escala que nao e numero nao escreve "NaN %".
  assert.deepEqual(triggerOf({ shownPercent: Number.NaN }), { name: "Zoom: Ajustar à tela (100 %)", text: "100 %" });
});

test("nas pontas: aria-disabled sem sair do Tab, o motivo no title e no texto do leitor de tela", () => {
  const smallest = draw({ disabledOut: true, shownPercent: 50, zoom: 50 });
  const out = tagWith(smallest, "button", 'data-free-zoom="out"');
  const outReason = attr(out, "aria-describedby");

  assert.equal(attr(out, "aria-disabled"), "true");
  assert.equal(attr(out, "title"), "O zoom já está no menor.");
  assert.equal(/\sdisabled=""/.test(out), false, "continua focavel (aria-disabled, nao disabled)");
  assert.ok(outReason, "o motivo ligado pelo aria-describedby");
  assert.ok(smallest.includes(`<span class="sr-only" id="${outReason}">O zoom já está no menor.</span>`));
  // O outro botao continua ligado.
  assert.equal(attr(tagWith(smallest, "button", 'data-free-zoom="in"'), "aria-disabled"), null);

  const largest = draw({ disabledIn: true, shownPercent: 200, zoom: 200 });
  const into = tagWith(largest, "button", 'data-free-zoom="in"');
  const inReason = attr(into, "aria-describedby");

  assert.equal(attr(into, "aria-disabled"), "true");
  assert.equal(attr(into, "title"), "O zoom já está no maior.");
  assert.equal(/\sdisabled=""/.test(into), false);
  assert.ok(largest.includes(`<span class="sr-only" id="${inReason}">O zoom já está no maior.</span>`));
  assert.equal(attr(tagWith(largest, "button", 'data-free-zoom="out"'), "aria-disabled"), null);

  // As duas pontas juntas nao acontecem no editor, mas os dois motivos nao dividem o id.
  const both = draw({ disabledIn: true, disabledOut: true });
  const ids = [attr(tagWith(both, "button", 'data-free-zoom="out"'), "aria-describedby"), attr(tagWith(both, "button", 'data-free-zoom="in"'), "aria-describedby")];
  assert.equal(new Set(ids).size, 2);
  assert.equal((both.match(/class="sr-only"/g) ?? []).length, 2);

  // O gatilho do menu nunca desliga: da para escolher qualquer passo de qualquer ponta.
  for (const markup of [smallest, largest, both]) {
    const menu = tagWith(markup, "button", 'data-free-zoom="menu"');
    assert.equal(attr(menu, "aria-disabled"), null);
    assert.equal(/\sdisabled=""/.test(menu), false);
  }

  // Na ponta o clique nao faz nada (o editor nao recebe o passo).
  assert.match(SOURCE, /onClick=\{\(\) => \{\s*if \(!disabled\) \{\s*onStep\(direction\);\s*\}\s*\}\}/);
});

test("o menu de rádio: só Ajustar à tela, 50, 75, 100, 150 e 200 %, com o valor de agora marcado", () => {
  // Decisao do produtor: so esses passos (25, 300 e 400 % ficam para o L4c).
  assert.deepEqual(geometry.FREE_ZOOM_STEPS, [50, 75, 100, 150, 200]);

  const { markup, seen } = drawWithMenu();

  assert.deepEqual(
    seen.items.map((item) => item.label),
    ["Ajustar à tela", "50 %", "75 %", "100 %", "150 %", "200 %"]
  );
  assert.deepEqual(
    seen.items.map((item) => item.value),
    ["fit", 50, 75, 100, 150, 200]
  );
  assert.ok(seen.items.every((item) => item.closeOnClick === true), "escolher fecha o menu");

  const radios = markup.match(/<div[^>]*role="menuitemradio"[^>]*>[^<]*<\/div>/g) ?? [];
  assert.deepEqual(radios.map(textOf), ["Ajustar à tela", "50 %", "75 %", "100 %", "150 %", "200 %"]);
  assert.deepEqual(radios.map((radio) => attr(radio, "aria-checked")), ["true", "false", "false", "false", "false", "false"]);
  assert.deepEqual(radios.map((radio) => attr(radio, "data-free-zoom-step")), ["fit", "50", "75", "100", "150", "200"]);
  assert.equal(seen.radio.value, "fit");
  assert.ok(markup.includes('<div role="group" aria-label="Zoom">'), "o grupo de radio tem nome");

  // Num passo, so ele marcado.
  for (const zoom of geometry.FREE_ZOOM_STEPS) {
    const step = drawWithMenu({ shownPercent: zoom, zoom });
    const checked = (step.markup.match(/<div[^>]*role="menuitemradio"[^>]*>/g) ?? []).filter((radio) => attr(radio, "aria-checked") === "true");

    assert.equal(step.seen.radio.value, zoom);
    assert.deepEqual(checked.map((radio) => attr(radio, "data-free-zoom-step")), [String(zoom)]);
  }

  // O menu fica embaixo do gatilho, centrado nele.
  assert.equal(seen.content.align, "center");
});

test("escolher no menu chama onFit ou onZoom (e nunca onStep); ao fechar, o foco volta ao gatilho", () => {
  const calls = [];
  const { seen } = drawWithMenu({
    onFit: () => calls.push("fit"),
    onStep: (direction) => calls.push(`step ${direction}`),
    onZoom: (step) => calls.push(step),
    shownPercent: 150,
    zoom: 150
  });

  seen.radio.onValueChange("fit");
  seen.radio.onValueChange(50);
  seen.radio.onValueChange(200);
  assert.deepEqual(calls, ["fit", 50, 200]);

  // Um valor que nao e uma das escolhas nao faz nada (nem 25, nem 300, nem o passo em texto).
  for (const value of [25, 300, "150", null, undefined, Number.NaN]) {
    seen.radio.onValueChange(value);
  }

  assert.deepEqual(calls, ["fit", 50, 200]);

  // O finalFocus do menu e o mesmo ref do gatilho: escolhendo, com Esc ou clicando fora, o foco volta a ele.
  assert.ok(seen.trigger.ref && typeof seen.trigger.ref === "object" && "current" in seen.trigger.ref);
  assert.equal(seen.content.finalFocus, seen.trigger.ref);
  assert.equal(seen.trigger["aria-label"], "Zoom: 150 %");
});

test("nada abaixo de 12 px, sem HTML em texto e as frases do controle no vocabulário", () => {
  // docs/17: nada abaixo de 12 px no admin (text-xs e 12 px; abaixo disso so por valor fixo).
  assert.equal(/text-\[(?:[1-9]|1[01])px\]|text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]/.test(SOURCE), false, "nenhum texto abaixo de 12 px");
  assert.equal(/dangerouslySetInnerHTML|\.innerHTML|cssText|<style[\s>]|style="/.test(SOURCE), false);
  // O menu e o de src/components/ui/dropdown-menu.tsx, com o radio dele (nao um menu feito a mao).
  assert.match(SOURCE, /from "@\/components\/ui\/dropdown-menu"/);
  assert.match(SOURCE, /<DropdownMenuRadioGroup/);
  assert.match(SOURCE, /<DropdownMenuRadioItem/);

  // Os textos de tamanho fixo da marcacao: o gatilho com 13 px e o menu com text-sm (14 px).
  const { markup } = drawWithMenu({ disabledIn: true, disabledOut: true });
  const classes = [...markup.matchAll(/\sclass="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/));
  const sizes = classes.filter((name) => /^text-(?:xs|sm|base|lg|\[[\d.]+(?:px|rem)\])$/.test(name));
  assert.ok(sizes.includes("text-[13px]") && sizes.includes("text-sm") && sizes.includes("text-xs"));
  assert.ok(sizes.every((size) => ["text-xs", "text-sm", "text-base", "text-[13px]"].includes(size)), sizes.join(", "));

  // As frases que a equipe ve ou ouve: texto, nomes, titles e motivos, nos dois extremos e no meio.
  const texts = [];

  for (const extra of [{}, { disabledIn: true, disabledOut: true }, { shownPercent: 150, zoom: 150 }]) {
    const drawn = drawWithMenu(extra).markup;

    texts.push(textOf(drawn));
    texts.push(...[...drawn.matchAll(/\s(?:aria-label|title)="([^"]*)"/g)].map((match) => match[1]));
  }

  const all = texts.join("\n").toLowerCase();

  for (const word of PROIBIDAS) {
    assert.equal(all.includes(word), false, `"${word}" apareceu no controle de zoom`);
  }

  assert.equal(/ [-–—] /.test(texts.join("\n")), false, "sem hifen como separador");
  // As frases vem de FREE_EDITOR_COPY.bar (nenhuma escrita no componente).
  assert.ok(texts.join("\n").includes(C.zoomMin) && texts.join("\n").includes(C.zoomMax));
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/"(?:Diminuir|Aumentar) o zoom|"O zoom já|"Ajustar à tela|"Zoom/.test(code), false, "nenhuma frase escrita no componente");
});
