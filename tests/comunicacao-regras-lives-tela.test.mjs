import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Construtor de segmento com as regras de "Quem pode da live por regras" (docs/22 §3, docs/30 §1.6): "Ganhou acesso
// recentemente" (Ganhou / Não ganhou, qualquer produto ou um destes produtos, hoje / 24 h / 48 h / N horas) e
// "Participação em lives" (Participou / Não participou / Garantiu vaga / Não garantiu vaga, qualquer live ou uma da
// lista), desenhados com renderToStaticMarkup (os .tsx transpilados aqui, como em tests/pop-ups-v3b2-editor.test.mjs),
// nos dois modos do construtor, com as dicas e sem as palavras proibidas da Comunicacao e do Webinario.

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
const model = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const { PROIBIDAS_WEBINARIO } = await import("../src/lib/webinar-copy.ts");
const { AudienceBuilder } = await import("../src/components/admin/v2/communication/audience-builder.tsx");

const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template"];
const PRODUTOS = [
  { accent: "cyan", coverUrl: null, detail: "Formação", id: "formacao-ia", title: "Formação IA" },
  { accent: "violet", coverUrl: null, detail: "Curso", id: "curso-x", title: "Curso X" }
];
const LIVE_Y = "55555555-5555-4555-8555-555555555555";
const LIVE_Z = "66666666-6666-4666-8666-666666666666";
const LIVES = [
  { id: LIVE_Y, startsAt: "2026-10-21T22:00:00.000Z", title: "Aula ao vivo de IA" },
  { id: LIVE_Z, startsAt: null, title: "Live gravada de boas-vindas" }
];

const todas = (...items) => ({ kind: "rules", root: { items, match: "all" } });

function desenhar(value, props = {}) {
  return renderToStaticMarkup(
    createElement(AudienceBuilder, {
      cohorts: [],
      disabled: false,
      errors: {},
      onChange: () => undefined,
      products: PRODUTOS,
      productsLoaded: true,
      segments: [],
      value,
      webinars: LIVES,
      ...props
    })
  );
}

/** O texto visivel (sem as tags, os atributos e a seta dos seletores). */
const textoDe = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|▼/g, " ").replace(/\s+/g, " ").trim();

function semPalavrasProibidas(texto) {
  for (const palavra of [...PROIBIDAS, ...PROIBIDAS_WEBINARIO]) {
    assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `usa "${palavra}": ${texto}`);
  }
}

test("Ganhou acesso recentemente: hoje, qualquer produto, sem a lista de produtos; as dicas aparecem", () => {
  for (const mode of ["segment", "flow"]) {
    const html = desenhar(todas({ negate: false, period: { kind: "today" }, productIds: [], type: "access_recent" }), { mode });
    const texto = textoDe(html);

    assert.match(texto, /Ganhou acesso recentemente/, mode);
    assert.match(texto, /Ganhou acesso a qualquer produto hoje/, mode);
    assert.ok(texto.includes(model.ACCESS_RECENT_HINT), mode);
    assert.doesNotMatch(html, /Buscar pelo nome/, "sem a lista de produtos");
    assert.doesNotMatch(html, /aria-label="Horas"/, "sem o campo de horas");
    semPalavrasProibidas(texto);
  }
});

test("Ganhou acesso recentemente: 'Não ganhou', um destes produtos e N horas mostram a lista e o campo de horas", () => {
  const html = desenhar(todas({ negate: true, period: { hours: 6, kind: "hours" }, productIds: ["curso-x"], type: "access_recent" }));
  const texto = textoDe(html);

  assert.match(texto, /Não ganhou acesso a um destes produtos nas últimas… horas/, "a opcao 'nas últimas…', o campo e a palavra depois");
  assert.match(html, /<input[^>]*aria-label="Horas"[^>]*value="6"/);
  assert.doesNotMatch(texto, /horas horas/, "a palavra 'horas' nao se repete");
  assert.match(textoDe(desenhar(todas({ negate: false, period: { hours: 1, kind: "hours" }, productIds: [], type: "access_recent" }))), /nas últimas… hora /);
  assert.match(html, /Buscar pelo nome/, "a lista de produtos");
  assert.match(texto, /Formação IA/);
  assert.doesNotMatch(texto, new RegExp(model.ACCESS_RECENT_PICK_HINT), "com produto escolhido, sem a dica de lista vazia");

  const vinteQuatro = textoDe(desenhar(todas({ negate: false, period: { hours: 24, kind: "hours" }, productIds: [], type: "access_recent" })));
  assert.match(vinteQuatro, /nas últimas 24 horas/);
  semPalavrasProibidas(texto);
});

test("Ganhou acesso recentemente: digitar 240 no campo passa por 2 e 24 sem trocar a opcao nem tirar o campo", () => {
  // O campo manda cada tecla (NumberField): 2, 24, 240. Com "nas últimas…" escolhido, 24 e 48 continuam no campo.
  for (const hours of [2, 24, 240, 48, 480]) {
    assert.equal(model.accessRecentPeriodChoiceOf({ hours, kind: "hours" }, true), "hours", `${hours} digitado`);
  }
  const ultima = [2, 24, 240].reduce((period, hours) => ({ ...period, hours }), model.accessRecentPeriodOfChoice("hours", { kind: "today" }));
  assert.deepEqual(ultima, { hours: 240, kind: "hours" });

  // Ao abrir (sem a escolha nesta tela), 24 e 48 voltam para as opcoes proprias; hoje e sempre hoje.
  assert.equal(model.accessRecentPeriodChoiceOf({ hours: 24, kind: "hours" }), "24");
  assert.equal(model.accessRecentPeriodChoiceOf({ hours: 48, kind: "hours" }), "48");
  assert.equal(model.accessRecentPeriodChoiceOf({ hours: 240, kind: "hours" }), "hours");
  assert.equal(model.accessRecentPeriodChoiceOf({ kind: "today" }, true), "today");
  assert.deepEqual(
    model.ACCESS_RECENT_PERIOD_CHOICES.map((choice) => choice.label),
    ["hoje", "nas últimas 24 horas", "nas últimas 48 horas", "nas últimas…"]
  );

  // A tela usa a escolha guardada: o componente nao deriva a opcao so do valor.
  const fonte = readFileSync(fileURLToPath(new URL("src/components/admin/v2/communication/audience-builder.tsx", root)), "utf8");
  assert.match(fonte, /accessRecentPeriodChoiceOf\(rule\.period, otherHours\)/);
  assert.match(fonte, /setOtherHours\(choice === "hours"\)/);
});

test("Participação em lives: a escolha e a live aparecem; sem lives, 'qualquer live' e o aviso; a dica do replay", () => {
  const html = desenhar(todas({ action: "registered", negate: true, type: "webinar", webinarId: LIVE_Y }), { mode: "flow" });
  const texto = textoDe(html);

  assert.match(texto, /Participação em lives/);
  assert.match(texto, /Não garantiu vaga/);
  assert.match(texto, /Aula ao vivo de IA · 21\/10/);
  assert.ok(texto.includes(model.WEBINAR_RULE_HINT));
  assert.doesNotMatch(texto, new RegExp(model.NO_WEBINARS_MESSAGE));
  semPalavrasProibidas(texto);

  const vazio = textoDe(desenhar(todas({ action: "attended", negate: false, type: "webinar", webinarId: null }), { webinars: undefined }));
  assert.match(vazio, /Participou qualquer live/);
  assert.ok(vazio.includes(model.NO_WEBINARS_MESSAGE));

  const fora = textoDe(desenhar(todas({ action: "attended", negate: false, type: "webinar", webinarId: LIVE_Y }), { excludeWebinarId: LIVE_Y }));
  assert.match(fora, /Live fora da lista/, "a propria live, ja escolhida, continua visivel");
});
