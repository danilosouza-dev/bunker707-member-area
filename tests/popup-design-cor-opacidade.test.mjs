import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Opacidade ao lado da cor (docs/26 §2.2; docs/27 §2.2; docs/18 §1.1): o numero 0 a 100 % no ColorField do card
// "Design" e do editor Livre. As duas pecas puras (alphaPercentOf e withAlphaPercent: 100 % grava os 6 digitos,
// nunca "ff"; cor invalida volta como veio), o campo desenhado com react-dom/server (nome acessivel
// "{rotulo}: opacidade", valor 70 para #000000b3 e 100 para 6 digitos, o texto de 8 digitos continua), um campo
// de cor so (todo uso ganha a opacidade de graca, inclusive a Cor do X) e a regra 11 do Livre (X com alfa baixo =
// erro) com a cor que o campo grava. Os .tsx sao transpilados aqui pelo TypeScript (so JSX -> JS), como em
// tests/pop-ups-v3b2-editor.test.mjs.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const STUBS = {
  "next/image": `import { createElement } from "react";
export default function Image({ fill, priority, sizes, unoptimized, style, ...props }) {
  return createElement("img", { ...props, "data-next-image": "", style });
}`,
  "next/link": `import { createElement } from "react";
export default function Link({ prefetch, scroll, ...props }) { return createElement("a", props); }`,
  "next/navigation": `export function useRouter() { return { back() {}, push() {}, refresh() {}, replace() {} }; }
export function usePathname() { return "/admin/comunicacao/avisos"; }`
};

function withExtension(base) {
  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (existsSync(fileURLToPath(candidate))) {
      return candidate;
    }
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }

    const parent = context.parentURL ?? "";

    if (specifier.startsWith("@/")) {
      const found = withExtension(new URL(specifier.slice(2), srcUrl).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith(srcUrl) && /^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const found = withExtension(new URL(specifier, parent).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith("data:")) {
      return nextResolve(specifier, { ...context, parentURL: new URL("package.json", root).href });
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(srcUrl) && url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName
      });

      return { format: "module", shortCircuit: true, source: outputText };
    }

    return nextLoad(url, context);
  }
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const model = await import("../src/server/communications/popup-design-model.ts");
const freeModel = await import("../src/server/communications/popup-free-model.ts");
const starters = await import("../src/server/communications/popup-free-starters.ts");
const { resolveFreeClose } = await import("../src/server/communications/popup-free-render.ts");
const editorModel = await import("../src/components/admin/v2/communication/popup-design/popup-design-editor-model.ts");
const { ColorField } = await import("../src/components/admin/v2/communication/popup-design/design-controls.tsx");

const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home", "fluxo"];

/** Um <input> do HTML desenhado, achado por um atributo exato. */
function input(html, attribute) {
  const found = new RegExp(`<input[^>]*${attribute}[^>]*/?>`).exec(html)?.[0];
  assert.ok(found, `input com ${attribute} no HTML`);
  return found;
}

function renderColor(props = {}) {
  return renderToStaticMarkup(createElement(ColorField, { id: "popup-design-x-cor", label: "Cor do X", onChange: () => undefined, value: "#000000b3", ...props }));
}

test("alphaPercentOf: a opacidade em % da cor (6 digitos ou cor invalida = 100)", () => {
  assert.equal(model.alphaPercentOf("#000000"), 100);
  assert.equal(model.alphaPercentOf("#000000ff"), 100);
  assert.equal(model.alphaPercentOf("#000000FF"), 100, "maiusculas valem");
  assert.equal(model.alphaPercentOf("#000000b3"), 70);
  assert.equal(model.alphaPercentOf("#00000080"), 50);
  assert.equal(model.alphaPercentOf("#000000fc"), 99);
  assert.equal(model.alphaPercentOf("#00000003"), 1);
  assert.equal(model.alphaPercentOf("#00000000"), 0);
  assert.equal(model.alphaPercentOf("zzz"), 100, "cor invalida: 100 (o campo mostra o que vale)");
  assert.equal(model.alphaPercentOf("#abc"), 100);
});

test("withAlphaPercent: dois digitos no fim; 100 % devolve os 6 digitos (nunca ff); invalida volta como veio", () => {
  assert.equal(model.withAlphaPercent("#000000", 0), "#00000000");
  assert.equal(model.withAlphaPercent("#000000", 1), "#00000003");
  assert.equal(model.withAlphaPercent("#000000", 50), "#00000080");
  assert.equal(model.withAlphaPercent("#000000", 70), "#000000b3");
  assert.equal(model.withAlphaPercent("#000000", 99), "#000000fc");
  assert.equal(model.withAlphaPercent("#000000", 100), "#000000");

  // 8 digitos entrando: o alfa que estava sai; 100 % volta aos 6 digitos (o design salvo antes fica igual byte a byte).
  assert.equal(model.withAlphaPercent("#000000b3", 50), "#00000080");
  assert.equal(model.withAlphaPercent("#000000b3", 100), "#000000");
  assert.equal(model.withAlphaPercent("#000000ff", 100), "#000000");

  // Maiusculas viram a forma canonica (minuscula).
  assert.equal(model.withAlphaPercent("#ABCDEF", 50), "#abcdef80");
  assert.equal(model.withAlphaPercent("#ABCDEFB3", 100), "#abcdef");

  // Fora de 0 a 100 encosta no limite; sem numero nao mexe; cor invalida nunca vira hex invalido nem valido.
  assert.equal(model.withAlphaPercent("#000000", 150), "#000000");
  assert.equal(model.withAlphaPercent("#000000", -5), "#00000000");
  assert.equal(model.withAlphaPercent("#000000", 49.6), "#00000080", "arredonda o percentual");
  assert.equal(model.withAlphaPercent("#000000b3", Number.NaN), "#000000b3");
  assert.equal(model.withAlphaPercent("zzz", 50), "zzz");
  assert.equal(model.withAlphaPercent("#abc", 50), "#abc");
  assert.equal(model.withAlphaPercent("", 50), "");

  // Ida e volta: todo percentual inteiro sobrevive ao arredondamento dos 255 passos do alfa.
  for (let percent = 0; percent <= 100; percent += 1) {
    const hex = model.withAlphaPercent("#123456", percent);
    assert.match(hex, model.HEX_COLOR_PATTERN, `${percent} %: hex valido`);
    assert.equal(model.alphaPercentOf(hex), percent, `${percent} %: volta igual`);
  }
});

test("ColorField: o numero da opacidade ao lado da cor, com o nome acessivel '{rotulo}: opacidade'", () => {
  const html = renderColor();
  const opacidade = input(html, 'aria-label="Cor do X: opacidade"');

  assert.match(opacidade, /type="number"/);
  assert.match(opacidade, /id="popup-design-x-cor-opacidade"/);
  assert.match(opacidade, /min="0"/);
  assert.match(opacidade, /max="100"/);
  assert.match(opacidade, /step="1"/);
  assert.match(opacidade, /inputMode="numeric"/i);
  assert.match(opacidade, /value="70"/, "#000000b3 = 70 %");
  assert.match(input(html, 'id="popup-design-x-cor"'), /value="#000000b3"/, "o texto de 8 digitos continua");
  assert.match(input(html, 'type="color"'), /value="#000000"/, "o seletor so com os 6 digitos");
  assert.match(html, /aria-hidden="true"[^>]*>%</, "o sufixo % so visual (o nome acessivel ja diz opacidade)");
  assert.match(html, /flex-wrap/, "a linha quebra em tela estreita (nunca rola para o lado)");
  assert.doesNotMatch(html, />Opacidade</, "sem rotulo visivel (nao se confunde com a Opacidade do Livre)");
  assert.doesNotMatch(html, /<label[^>]*for="popup-design-x-cor-opacidade"/, "sem <label> extra");
});

test("ColorField: 6 digitos = 100 %, desabilitado desabilita a opacidade, rotulo escondido continua no nome acessivel", () => {
  assert.match(input(renderColor({ value: "#38bdf8" }), 'aria-label="Cor do X: opacidade"'), /value="100"/);
  assert.match(input(renderColor({ value: "#38bdf880" }), 'aria-label="Cor do X: opacidade"'), /value="50"/);
  assert.match(input(renderColor({ disabled: true }), 'aria-label="Cor do X: opacidade"'), /disabled=""/);

  const escondido = renderColor({ id: "popup-design-cartao-fundo-cor", label: "Fundo", labelHidden: true });
  assert.match(escondido, /<label class="sr-only" for="popup-design-cartao-fundo-cor">Fundo<\/label>/);
  assert.match(input(escondido, 'aria-label="Fundo: opacidade"'), /id="popup-design-cartao-fundo-cor-opacidade"/);
});

test("todo campo de cor do Design e do Livre e o mesmo ColorField (a opacidade vale em todos, inclusive na Cor do X)", async () => {
  const pastas = ["../src/components/admin/v2/communication/popup-design/", "../src/components/admin/v2/communication/popup-free/"];
  const comSeletorProprio = [];
  let usos = 0;

  for (const pasta of pastas) {
    const url = new URL(pasta, import.meta.url);

    for (const arquivo of (await readdir(url)).filter((file) => file.endsWith(".tsx"))) {
      const fonte = await readFile(new URL(arquivo, url), "utf8");
      usos += (fonte.match(/<ColorField\b/g) ?? []).length;

      if (arquivo !== "design-controls.tsx" && /type="color"/.test(fonte)) {
        comSeletorProprio.push(arquivo);
      }
    }
  }

  assert.deepEqual(comSeletorProprio, [], "nenhuma tela tem um seletor de cor proprio");
  assert.ok(usos >= 20, `o ColorField e usado nas telas (${usos} usos)`);

  const fechar = await readFile(new URL("../src/components/admin/v2/communication/popup-design/card-section.tsx", import.meta.url), "utf8");
  assert.match(fechar, /<ColorField[^>]*id="popup-design-x-cor"/, "a Cor do X do Personalizado e um ColorField");
  const prancheta = await readFile(new URL("../src/components/admin/v2/communication/popup-free/free-artboard-settings.tsx", import.meta.url), "utf8");
  assert.match(prancheta, /<ColorField[^>]*id=\{id\("x-cor"\)\}/, "a Cor do X do Livre e um ColorField");
});

test("Livre, regra 11: a Cor do X com opacidade baixa gravada pelo campo e erro de X que nao aparece; com 100 % passa", () => {
  const { design } = starters.applyFreeStarter(starters.FREE_DESIGN_STARTERS[0].id, { audio: null, cta: { ...starters.FREE_STARTER_CTA, href: "/minhas-compras" } });
  // O `close` do design e parcial (o modelo so escolhe o fundo): a cor do X que o campo mostra e a resolvida.
  const corDoX = resolveFreeClose(design).color;
  const comOpacidade = (percent) => ({ ...design, close: { ...design.close, color: model.withAlphaPercent(corDoX, percent) } });

  assert.match(corDoX, model.HEX_COLOR_PATTERN);
  assert.equal(freeModel.freeCloseVisibilityProblem(design), null, "o modelo comeca com o X visivel");
  assert.equal(freeModel.freeCloseVisibilityProblem(comOpacidade(50)), "alpha");
  assert.equal(freeModel.freeCloseVisibilityProblem(comOpacidade(79)), "alpha", "c9 < cc");
  assert.equal(freeModel.freeCloseVisibilityProblem(comOpacidade(80)), null, "cc passa");
  assert.equal(freeModel.freeCloseVisibilityProblem(comOpacidade(100)), null);
});

test("vocabulario: os textos do campo de cor sem as palavras proibidas", () => {
  assert.equal(editorModel.POPUP_DESIGN_COPY.color.opacity, "opacidade");

  for (const texto of Object.values(editorModel.POPUP_DESIGN_COPY.color)) {
    for (const palavra of PROIBIDAS) {
      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
});
