import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Editor do pop-up, v3b-2 (docs/29 §6.1, §6.2 e §6.4; spec §7.3 R): o card "Quando e onde aparece" com quatro
// momentos ("No primeiro acesso" com "Conta como primeiro acesso" e os produtos; "Ao concluir um curso" com "De
// quais cursos"), o que muda ao trocar o momento, os erros que so o editor ve, a trava do primeiro acesso no
// pop-up que ja foi ao ar (as pilulas desabilitadas uma a uma e a linha ligada pelo aria-describedby), os textos
// por momento, a linha da hora marcada ao vivo no "Começa", as linhas do pop-up no ar com os produtos e os
// toasts de publicar e aprovar com o que o servidor devolve em PublishedNotice.popup. Os .tsx sao transpilados
// aqui pelo TypeScript (so JSX -> JS) e desenhados com renderToStaticMarkup, como em
// tests/comunicacao-modelos-tela.test.mjs.

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
const editor = await import("../src/components/admin/v2/communication/popup-editor-model.ts");
const model = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const display = await import("../src/server/communications/popup-display-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const { PillGroup } = await import("../src/components/admin/v2/form.tsx");
const { PopupPlacementFields } = await import("../src/components/admin/v2/communication/popup-placement-fields.tsx");
const { PopupWindowFields } = await import("../src/components/admin/v2/communication/notice-when-fields.tsx");

const NOW = Date.parse("2026-10-23T15:00:00.000Z"); // 12:00 em Sao Paulo
const config = (extra = {}) => ({ ...display.POPUP_SETTINGS_DEFAULT, exclude: [], pages: ["home"], ...extra });
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home"];
const PRODUTOS = [
  { accent: "cyan", coverUrl: null, detail: "Formação", id: "formacao-ia", title: "Formação IA" },
  { accent: "violet", coverUrl: null, detail: "Curso", id: "curso-x", title: "Curso X" }
];

function semPalavrasProibidas(texto) {
  for (const palavra of PROIBIDAS) {
    assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
  }
}

function folhas(value) {
  if (typeof value === "string") {
    return [value];
  }

  return Array.isArray(value) ? value.flatMap(folhas) : value && typeof value === "object" ? Object.values(value).flatMap(folhas) : [];
}

/** O <input type="radio"> de um valor no HTML desenhado. */
function radio(html, name, value) {
  const found = new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"[^>]*/?>`).exec(html)?.[0];
  assert.ok(found, `radio ${name}=${value} no HTML`);
  return found;
}

function renderPlacement({ draft: draftExtra = {}, popup = config(), ui: uiExtra = {}, ...props } = {}) {
  const draft = { ...schemas.emptyNoticeDraft("popup"), popup, ...draftExtra };
  const ui = { ...editor.placementUiOf(popup), ...uiExtra };

  return renderToStaticMarkup(
    createElement(PopupPlacementFields, {
      disabled: false,
      draft,
      errorFor: () => undefined,
      live: null,
      names: {},
      now: NOW,
      onChange: () => undefined,
      onUiChange: () => undefined,
      opensOnLesson: [],
      products: PRODUTOS,
      productsLoaded: true,
      ui,
      ...props
    })
  );
}

/* ------------------------------------------------------------------------------------------------
 * Quando aparece: quatro momentos
 * ---------------------------------------------------------------------------------------------- */

test("Quando aparece: quatro pílulas, na ordem da spec, com os valores do servidor", () => {
  assert.deepEqual(
    editor.POPUP_TRIGGER_OPTIONS.map((option) => [option.label, option.value]),
    [
      ["Ao abrir a página", "page_load"],
      ["Ao concluir uma aula", "lesson_completed"],
      ["No primeiro acesso", "first_login"],
      ["Ao concluir um curso", "course_completed"]
    ]
  );
  assert.deepEqual(
    editor.POPUP_TRIGGER_OPTIONS.map((option) => option.value),
    [...display.POPUP_TRIGGERS],
    "um momento para cada valor que o servidor aceita"
  );

  const html = renderPlacement();
  for (const value of display.POPUP_TRIGGERS) {
    assert.ok(!radio(html, "popup-momento", value).includes("disabled"), `${value} habilitado no rascunho`);
  }
  assert.match(html, /aria-label="Quando o pop-up aparece"[^>]*role="radiogroup"/);
});

test("trocar o momento entre os quatro: páginas e exceções certas, os produtos do primeiro acesso somem e começam vazios", () => {
  const qualquer = config({ delaySeconds: 30, exclude: ["profile", "lesson:curso-x"], pages: ["any"] });

  // Pagina -> primeiro acesso: as paginas e as excecoes ficam; os produtos comecam vazios (a primeira vez na area).
  const primeiro = editor.settingsForTrigger(qualquer, "first_login");
  assert.deepEqual(primeiro, { ...qualquer, accessProducts: [], trigger: "first_login" });
  assert.equal(primeiro.delaySeconds, 30, "Quanto tempo depois nunca muda sozinho");

  // Primeiro acesso -> pagina: a chave some (nao fica [] na forma canonica).
  const comProdutos = { ...primeiro, accessProducts: ["formacao-ia"] };
  const devolta = editor.settingsForTrigger(comProdutos, "page_load");
  assert.equal("accessProducts" in devolta, false);
  assert.deepEqual(devolta, qualquer);

  // Primeiro acesso -> curso: so as aulas (nenhuma -> qualquer aula) e as excecoes de aula; sem produtos.
  const curso = editor.settingsForTrigger(comProdutos, "course_completed");
  assert.deepEqual(curso, config({ delaySeconds: 30, exclude: ["lesson:curso-x"], pages: ["lesson:*"], trigger: "course_completed" }));
  assert.equal("accessProducts" in curso, false);
  assert.deepEqual(
    editor.settingsForTrigger(config({ pages: ["home", "lesson:curso-a", "content:curso-a"] }), "course_completed").pages,
    ["lesson:curso-a"],
    "as aulas escolhidas ficam"
  );

  // Aula <-> curso: as paginas ficam como estao.
  const aula = config({ exclude: ["lesson:curso-x"], pages: ["lesson:*"], trigger: "lesson_completed" });
  assert.deepEqual(editor.settingsForTrigger(aula, "course_completed"), { ...aula, trigger: "course_completed" });
  assert.deepEqual(editor.settingsForTrigger({ ...aula, trigger: "course_completed" }, "lesson_completed"), aula);
  const aulasDeUm = config({ pages: ["lesson:formacao-ia"], trigger: "lesson_completed" });
  assert.deepEqual(editor.settingsForTrigger(aulasDeUm, "course_completed").pages, ["lesson:formacao-ia"]);

  // Curso -> primeiro acesso: as aulas viram "Páginas de aula" e os produtos comecam vazios.
  const deCurso = editor.settingsForTrigger(config({ pages: ["lesson:curso-a"], trigger: "course_completed" }), "first_login");
  assert.deepEqual(deCurso, config({ accessProducts: [], pages: ["lesson:curso-a"], trigger: "first_login" }));
  assert.equal(editor.placementChoiceOf(deCurso), "pages");

  assert.equal(editor.settingsForTrigger(primeiro, "first_login"), primeiro, "o mesmo momento nao muda nada");
});

test("Nunca nestas páginas no curso: só com De qualquer curso", () => {
  assert.equal(editor.canExclude(config({ pages: ["lesson:*"], trigger: "course_completed" })), true);
  assert.equal(editor.canExclude(config({ pages: ["lesson:curso-a"], trigger: "course_completed" })), false);
  assert.equal(editor.canExclude(config({ pages: ["any"], trigger: "first_login" })), true, "primeiro acesso: como Ao abrir a página");
  assert.equal(editor.canExclude(config({ pages: ["home"], trigger: "first_login" })), false);
  assert.deepEqual(editor.tidyPopupPlacement(config({ exclude: ["lesson:curso-x"], pages: ["lesson:curso-a"], trigger: "course_completed" })).exclude, []);
});

test("Conta como primeiro acesso: estado da tela pela lista de produtos (vazia = a primeira vez na área)", () => {
  assert.equal(editor.placementUiOf(config({ accessProducts: ["formacao-ia"], trigger: "first_login" })).firstAccess, "products");
  assert.equal(editor.placementUiOf(config({ accessProducts: [], trigger: "first_login" })).firstAccess, "area");
  assert.equal(editor.placementUiOf(config()).firstAccess, "area", "sem a chave");
  assert.deepEqual(
    editor.POPUP_EDITOR_COPY.placement.firstAccessOptions.map((option) => [option.label, option.value]),
    [
      ["A primeira vez na área", "area"],
      ["A primeira vez com estes produtos", "products"]
    ]
  );
});

test("erros só do editor: estes produtos sem produto (popup.accessProducts) e curso de alguns produtos sem produto (popup.pages)", () => {
  const ui = (extra = {}) => ({ ...editor.placementUiOf(config()), ...extra });
  const primeiro = config({ accessProducts: [], trigger: "first_login" });

  assert.deepEqual(editor.popupPlacementProblems(primeiro, ui({ choice: "home", firstAccess: "products" })), { "popup.accessProducts": "Escolha pelo menos um produto." });
  assert.deepEqual(editor.popupPlacementProblems(primeiro, ui({ choice: "home", firstAccess: "area" })), {}, "a primeira vez na área: lista vazia vale");
  assert.deepEqual(editor.popupPlacementProblems({ ...primeiro, accessProducts: ["formacao-ia"] }, ui({ choice: "home", firstAccess: "products" })), {});
  assert.deepEqual(
    editor.popupPlacementProblems(config({ accessProducts: [], trigger: "page_load" }), ui({ choice: "home", firstAccess: "products" })),
    {},
    "fora do primeiro acesso a escolha nao conta"
  );

  // Ao concluir um curso · Só destes produtos sem produto: o mesmo erro de "Ao concluir uma aula" (critica 9).
  assert.deepEqual(
    editor.popupPlacementProblems(config({ pages: [], trigger: "course_completed" }), ui({ choice: "home", pending: { exclude: editor.NO_PENDING_LINES, pages: { content: false, lesson: true } } })),
    { "popup.pages": "Escolha pelo menos um produto." }
  );
  assert.deepEqual(
    editor.popupPlacementProblems(config({ pages: ["lesson:*"], trigger: "course_completed" }), ui({ choice: "home", exceptions: true, pending: { exclude: { content: false, lesson: true }, pages: editor.NO_PENDING_LINES } })),
    { "popup.exclude": "Escolha pelo menos um produto." },
    "Menos os cursos de alguns produtos sem produto"
  );
});

test("produto removido: o id escolhido que saiu da lista ganha o chip para tirar", () => {
  assert.deepEqual(editor.removedProductIds(["formacao-ia", "saiu"], PRODUTOS), ["saiu"]);
  assert.deepEqual(editor.removedProductIds([], PRODUTOS), []);

  const html = renderPlacement({ popup: config({ accessProducts: ["formacao-ia", "saiu"], trigger: "first_login" }) });
  assert.match(html, /Produto removido/);
  assert.match(html, /aria-label="Tirar o produto removido da lista"/);
  assert.equal((html.match(/Produto removido/g) ?? []).length, 1, "so o que saiu");
});

/* ------------------------------------------------------------------------------------------------
 * A trava do primeiro acesso (D8) e o PillGroup
 * ---------------------------------------------------------------------------------------------- */

test("trava do primeiro acesso: no pop-up que já foi ao ar, as pílulas certas nos dois sentidos; rascunho nunca publicado troca", () => {
  assert.deepEqual(editor.lockedTriggersOf({ savedTrigger: "first_login", sentAt: "2026-10-20T12:00:00.000Z" }), ["page_load", "lesson_completed", "course_completed"]);
  assert.deepEqual(editor.lockedTriggersOf({ savedTrigger: "page_load", sentAt: "2026-10-20T12:00:00.000Z" }), ["first_login"]);
  assert.deepEqual(editor.lockedTriggersOf({ savedTrigger: "course_completed", sentAt: "2026-10-20T12:00:00.000Z" }), ["first_login"]);
  assert.deepEqual(editor.lockedTriggersOf({ savedTrigger: "first_login", sentAt: null }), [], "rascunho nunca publicado troca a vontade");
  assert.deepEqual(editor.lockedTriggersOf({ savedTrigger: undefined, sentAt: "2026-10-20T12:00:00.000Z" }), []);
  assert.equal(
    editor.POPUP_EDITOR_COPY.placement.firstAccessLocked,
    "Num pop-up que já foi ao ar, “No primeiro acesso” não troca com os outros momentos. Para isso, duplique o pop-up."
  );

  // Desenhado: so os radios travados com disabled e a linha ligada pelo aria-describedby do grupo.
  const noAr = renderPlacement({ lockedTriggers: ["first_login"] });
  assert.match(radio(noAr, "popup-momento", "first_login"), /disabled=""/);
  for (const value of ["page_load", "lesson_completed", "course_completed"]) {
    assert.doesNotMatch(radio(noAr, "popup-momento", value), /disabled/);
  }
  assert.match(noAr, /aria-describedby="popup-momento-trava"[^>]*aria-label="Quando o pop-up aparece"[^>]*role="radiogroup"/);
  assert.match(noAr, /id="popup-momento-trava"[^>]*>.*Num pop-up que já foi ao ar/);

  const primeiroNoAr = renderPlacement({ lockedTriggers: ["page_load", "lesson_completed", "course_completed"], popup: config({ accessProducts: [], trigger: "first_login" }) });
  assert.doesNotMatch(radio(primeiroNoAr, "popup-momento", "first_login"), /disabled/);
  for (const value of ["page_load", "lesson_completed", "course_completed"]) {
    assert.match(radio(primeiroNoAr, "popup-momento", value), /disabled=""/);
  }

  const rascunho = renderPlacement();
  assert.doesNotMatch(rascunho, /popup-momento-trava/, "sem trava, sem linha nem aria-describedby");
});

test("PillGroup: disabledValues desabilita só os rádios escolhidos; describedBy vira aria-describedby do radiogroup", () => {
  const options = [
    { label: "Um", value: "a" },
    { label: "Dois", value: "b" },
    { label: "Três", value: "c" }
  ];
  const html = renderToStaticMarkup(createElement(PillGroup, { ariaLabel: "Grupo", describedBy: "grupo-linha", disabledValues: ["b"], name: "grupo", onChange: () => undefined, options, value: "a" }));

  assert.match(html, /<div aria-describedby="grupo-linha" aria-label="Grupo" class="[^"]*" role="radiogroup">/);
  assert.doesNotMatch(radio(html, "grupo", "a"), /disabled/);
  assert.match(radio(html, "grupo", "b"), /disabled=""/);
  assert.doesNotMatch(radio(html, "grupo", "c"), /disabled/);
  assert.equal((html.match(/cursor-not-allowed/g) ?? []).length, 1, "so a pilula desabilitada com o visual de desabilitada");

  // Sem as props novas: como antes (o grupo todo com disabled; sem aria-describedby).
  const antes = renderToStaticMarkup(createElement(PillGroup, { ariaLabel: "Grupo", disabled: true, name: "grupo", onChange: () => undefined, options, value: "a" }));
  assert.doesNotMatch(antes, /aria-describedby/);
  assert.equal((antes.match(/disabled=""/g) ?? []).length, 3);
});

/* ------------------------------------------------------------------------------------------------
 * Os campos de cada momento desenhados
 * ---------------------------------------------------------------------------------------------- */

test("No primeiro acesso desenhado: Conta como primeiro acesso, o seletor só em estes produtos, Onde aparece e a nota dos 15 minutos", () => {
  const area = renderPlacement({ popup: config({ accessProducts: [], trigger: "first_login" }) });
  const copy = editor.POPUP_EDITOR_COPY.placement;

  assert.match(area, /aria-label="Conta como primeiro acesso"[^>]*role="radiogroup"/);
  assert.match(radio(area, "popup-primeiro-acesso", "area"), /checked=""/);
  assert.ok(area.includes(copy.firstAccessHint.area));
  assert.doesNotMatch(area, /id="popup-primeiro-acesso-produtos"/, "a primeira vez na área: sem seletor");
  assert.match(area, /name="popup-onde"/, "Onde aparece igual a Ao abrir a página");
  assert.ok(area.includes(copy.firstAccessDelayNote));
  assert.ok(area.includes(copy.triggerHint.first_login));

  const produtos = renderPlacement({ popup: config({ accessProducts: ["formacao-ia"], trigger: "first_login" }) });
  assert.match(radio(produtos, "popup-primeiro-acesso", "products"), /checked=""/);
  assert.match(produtos, /id="popup-primeiro-acesso-produtos"/);
  assert.match(produtos, /id="popup-primeiro-acesso-produtos-hint"/, "a dica dos produtos descreve o seletor");
  assert.ok(produtos.includes(copy.firstAccessHint.products));

  // "estes produtos" escolhido na tela e lista ainda vazia: o seletor aparece; o erro so ao salvar (6.2).
  const vazia = renderPlacement({ popup: config({ accessProducts: [], trigger: "first_login" }), ui: { firstAccess: "products" } });
  assert.match(vazia, /id="popup-primeiro-acesso-produtos"/);
});

test("Ao concluir um curso desenhado: De quais cursos, a dica da formação e a chave das exceções de curso", () => {
  const qualquer = renderPlacement({ popup: config({ pages: ["lesson:*"], trigger: "course_completed" }) });
  const copy = editor.POPUP_EDITOR_COPY.placement;

  assert.match(qualquer, /aria-label="De quais cursos"[^>]*role="radiogroup"/);
  assert.match(radio(qualquer, "popup-cursos", "any"), /checked=""/);
  assert.ok(qualquer.includes("De qualquer curso") && qualquer.includes("Só destes produtos"));
  assert.ok(qualquer.includes(copy.courseFormationHint));
  assert.ok(qualquer.includes(copy.courseExceptionsLabel));
  assert.doesNotMatch(qualquer, /name="popup-onde"/, "so paginas de aula");
  assert.ok(qualquer.includes(copy.delayHint.course_completed));

  const alguns = renderPlacement({ popup: config({ pages: ["lesson:formacao-ia"], trigger: "course_completed" }) });
  assert.match(radio(alguns, "popup-cursos", "some"), /checked=""/);
  assert.match(alguns, /id="popup-paginas-aulas"/, "o seletor de produtos (o foco de popup.pages)");
});

test("Começa: a dica por momento e, no futuro num momento de página, a linha da hora marcada ao vivo", () => {
  const copy = editor.POPUP_EDITOR_COPY.placement;
  const futuro = { endsAt: null, startsAt: "2026-10-23T23:00:00.000Z" };
  const passado = { endsAt: null, startsAt: "2026-10-22T23:00:00.000Z" };
  const janela = (trigger, window) =>
    renderToStaticMarkup(createElement(PopupWindowFields, { disabled: false, errors: {}, now: NOW, onChange: () => undefined, trigger, window }));

  for (const trigger of display.POPUP_TRIGGERS) {
    assert.ok(janela(trigger, futuro).includes(copy.startsAtHint[trigger]), trigger);
  }

  assert.ok(janela("page_load", futuro).includes(copy.startsAtLiveNote));
  assert.ok(janela("first_login", futuro).includes(copy.startsAtLiveNote));
  assert.ok(!janela("lesson_completed", futuro).includes(copy.startsAtLiveNote), "momento de conclusao: nada abre sozinho na hora");
  assert.ok(!janela("course_completed", futuro).includes(copy.startsAtLiveNote));
  assert.ok(!janela("page_load", passado).includes(copy.startsAtLiveNote), "Começa no passado: sem a linha");
  assert.ok(!janela("page_load", { endsAt: null, startsAt: null }).includes(copy.startsAtLiveNote), "Ao publicar: sem a linha");

  assert.equal(editor.showsStartsAtLiveNote({ now: NOW, startsAt: futuro.startsAt, trigger: "page_load" }), true);
  assert.equal(editor.showsStartsAtLiveNote({ now: NOW, startsAt: "", trigger: "page_load" }), false, "data pela metade");

  // O card passa o momento: a dica do curso no card do curso.
  const card = renderPlacement({ draft: { window: futuro }, popup: config({ pages: ["lesson:*"], trigger: "course_completed" }) });
  assert.ok(card.includes(copy.startsAtHint.course_completed));
  assert.ok(!card.includes(copy.startsAtLiveNote));
});

/* ------------------------------------------------------------------------------------------------
 * Textos (tabela da §6.1)
 * ---------------------------------------------------------------------------------------------- */

test("textos da tabela 6.1, palavra por palavra", () => {
  const { frequency, placement } = editor.POPUP_EDITOR_COPY;

  assert.deepEqual(placement.triggerHint, {
    course_completed:
      "Aparece na página da aula logo depois que o aluno conclui a última aula que faltava do curso (todas as aulas publicadas). Com o vídeo ainda tocando, espera ele parar.",
    first_login: "Aparece só para aluno novo (ou para quem acabou de ganhar acesso aos produtos escolhidos), na primeira página escolhida que ele abrir.",
    lesson_completed:
      "Aparece na página da aula logo depois que a aula fica concluída: no fim do vídeo ou quando o aluno toca em Concluir. Com o vídeo ainda tocando, espera ele parar. Se o aluno já começou outra aula, o pop-up espera a próxima aula concluída. Em vídeo colado de outro site, só quando o aluno toca em Concluir.",
    page_load:
      "Abre pouco depois de o aluno abrir uma das páginas escolhidas. Com “Começa: Em uma data”, também abre na hora marcada para quem já estiver numa dessas páginas."
  });
  // Critica 5: a dica do momento e neutra; quem fica de fora em cada escolha e dito em firstAccessHint.
  assert.ok(!placement.triggerHint.first_login.includes("Quem já usava a área"));
  assert.deepEqual(placement.delayHint, {
    course_completed: "Conta a partir de quando o curso fica concluído.",
    first_login: "Conta a partir de quando a página abre.",
    lesson_completed: "Conta a partir de quando a aula fica concluída.",
    page_load: "Conta a partir de quando a página abre (na hora marcada, a partir dessa hora)."
  });
  assert.equal(placement.firstAccessLabel, "Conta como primeiro acesso");
  assert.equal(placement.firstAccessAria, "Conta como primeiro acesso");
  assert.deepEqual(placement.firstAccessHint, {
    area: "Vale para quem ganhou a conta depois que o pop-up começou e para quem ainda não tinha entrado nenhuma vez. Quem já usava a área não vê.",
    products:
      "Vale para quem ganhou acesso a um destes produtos depois que o pop-up começou, mesmo que já usasse a área, e para quem tem acesso a um deles mas ainda não tinha entrado. Quem perde o acesso deixa de ver. Para um curso de uma formação, escolha a formação (o acesso vem por ela)."
  });
  assert.equal(
    placement.firstAccessDelayNote,
    "Para quem acabou de comprar, pode levar até 15 minutos para valer: nesse caso, ele aparece na página seguinte que o aluno abrir."
  );
  assert.equal(placement.courseScopeLabel, "De quais cursos");
  assert.equal(placement.courseScopeAria, "De quais cursos");
  assert.deepEqual(placement.courseScopeOptions.map((option) => option.label), ["De qualquer curso", "Só destes produtos"]);
  assert.equal(placement.courseExceptionsLabel, "Menos os cursos de alguns produtos");
  assert.equal(placement.courseFormationHint, "Numa formação, o pop-up aparece ao concluir cada curso dela.");
  assert.equal(
    placement.lessonHint,
    "Na aula, se o vídeo estiver tocando, o pop-up espera ele parar. Se o aluno assistir mais de 10 minutos sem parar, ele não aparece nessa visita. Em vídeo colado de outro site, ele só abre antes do play (no celular, não abre nessas aulas). No iPhone, nas aulas com vídeo do Bunny, ele às vezes não abre: ali o vídeo só responde à página depois do play."
  );
  assert.equal(
    placement.note,
    "Um pop-up de cada vez: se dois tiverem que abrir juntos, o segundo espera o primeiro fechar. Na aula, nunca com o vídeo tocando: ele espera o vídeo parar. Quando a página não consegue saber se o vídeo toca (vídeo colado de outro site e, no iPhone, às vezes o do Bunny), ele só abre antes do play, e no celular não abre."
  );
  assert.equal(placement.whereHint.any, "Em todas as páginas da área do aluno, também nas aulas (com o vídeo parado). Nunca no login nem no Modo TV.");
  const aoVivo =
    "A partir dessa hora, quem abrir uma das páginas escolhidas vê o pop-up, e quem já estiver numa delas vê na hora (com alguns segundos de diferença entre os alunos).";
  assert.deepEqual(placement.startsAtHint, {
    course_completed: "A partir dessa hora, quem concluir um curso vê o pop-up. Nada abre sozinho na hora marcada.",
    first_login: aoVivo,
    lesson_completed: "A partir dessa hora, quem concluir uma aula vê o pop-up. Nada abre sozinho na hora marcada.",
    page_load: aoVivo
  });
  // Critica 8: o de conclusao nunca promete abrir "na hora".
  assert.ok(!placement.startsAtHint.lesson_completed.includes("na hora (") && !placement.startsAtHint.course_completed.includes("vê na hora"));
  assert.equal(
    placement.startsAtLiveNote,
    "Para um aviso de hora curta, marque também “Termina”: quem voltar para a aba depois disso não vê. Publique com antecedência: quem já estava com a área aberta antes de você publicar só vê ao abrir outra página ou voltar para a aba."
  );
  assert.equal(frequency.intervalDescription.course_completed, "Depois desse tempo, ele volta no próximo curso concluído.");
  assert.equal(frequency.intervalDescription.first_login, frequency.intervalDescription.page_load);

  // Um texto para cada momento (o `as const` obriga; aqui a lista do servidor confere).
  for (const key of ["triggerHint", "delayHint", "startsAtHint"]) {
    assert.deepEqual(Object.keys(placement[key]).sort(), [...display.POPUP_TRIGGERS].sort(), key);
  }
  assert.deepEqual(Object.keys(frequency.intervalDescription).sort(), [...display.POPUP_TRIGGERS].sort());
});

test("foco dos erros novos: popup.accessProducts vai para o seletor do primeiro acesso, na ordem da tela", () => {
  const tela = readFileSync(new URL("../src/components/admin/v2/communication/notice-editor.tsx", import.meta.url), "utf8");
  const bloco = tela.slice(tela.indexOf("const FIELD_FOCUS"), tela.indexOf("];", tela.indexOf("const FIELD_FOCUS")));
  const pares = [...bloco.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map((match) => [match[1], match[2]]);
  const ordem = pares.map(([prefix]) => prefix);

  assert.equal(pares.find(([prefix]) => prefix === "popup.accessProducts")?.[1], "#popup-primeiro-acesso-produtos, [name='popup-primeiro-acesso']");
  assert.ok(ordem.indexOf("popup.trigger") < ordem.indexOf("popup.accessProducts") && ordem.indexOf("popup.accessProducts") < ordem.indexOf("popup.pages"));
  assert.equal(pares.find(([prefix]) => prefix === "popup.trigger")?.[1], "[name='popup-momento']", "o foco do momento continua nas pilulas");
});

/* ------------------------------------------------------------------------------------------------
 * Pop-up no ar: as linhas com os produtos do primeiro acesso
 * ---------------------------------------------------------------------------------------------- */

test("linhas do pop-up no ar: mudar só os produtos do primeiro acesso traz a linha de quem já contava como aluno novo", () => {
  const janela = { endsAt: null, startsAt: null };
  const salvo = { popup: config({ accessProducts: ["formacao-ia"], trigger: "first_login" }), window: janela };
  const linhas = (popup, status = "active") => model.popupPlacementChangeNotes({ now: NOW, saved: salvo, shown: { popup, window: janela }, status });
  const quemJaViu =
    "Mudar onde ou quando ele aparece vale na hora. Quem já viu continua contando como visto, também nas páginas novas. Para todos verem de novo, ligue “Mostrar de novo para quem já viu”.";
  const alunoNovo = "Quem já contava como aluno novo continua contando enquanto tiver acesso a um dos produtos marcados. A mudança vale para quem chegar daqui para frente.";

  assert.deepEqual(linhas(salvo.popup), [], "nada mudou");
  assert.deepEqual(linhas({ ...salvo.popup, accessProducts: ["formacao-ia"] }), [], "a mesma lista");
  assert.deepEqual(linhas({ ...salvo.popup, accessProducts: ["curso-x", "formacao-ia"] }), [quemJaViu, alunoNovo]);
  assert.deepEqual(linhas({ ...salvo.popup, accessProducts: [] }), [quemJaViu, alunoNovo], "para a primeira vez na área");
  assert.deepEqual(linhas({ ...salvo.popup, pages: ["any"] }), [quemJaViu], "so as paginas: a linha de sempre");
  assert.deepEqual(linhas({ ...salvo.popup, accessProducts: ["curso-x"] }, "paused"), [quemJaViu, alunoNovo], "pausado tambem");
  assert.deepEqual(linhas({ ...salvo.popup, accessProducts: ["curso-x"] }, "draft"), [], "rascunho: nada");
});

/* ------------------------------------------------------------------------------------------------
 * Toasts de publicar e aprovar (§6.4)
 * ---------------------------------------------------------------------------------------------- */

test("toasts com PublishedNotice.popup: Começa no futuro num momento de página, primeiro acesso no ar e o de hoje sem a chave", () => {
  const ressalva =
    "Pop-up publicado. Na hora marcada, ele aparece para quem abrir uma das páginas e para quem já estiver nelas. Para quem está com a área aberta agora, vale a partir da próxima página ou de quando voltar para a aba.";
  const novos = "Pop-up publicado. Ele aparece para os alunos novos a partir de agora.";
  const hoje = "Pop-up publicado. Em até 1 minuto ele começa a aparecer para quem já está na área.";
  // O mesmo resultado sai de publicar (editor) e de aprovar (menu da lista): a mesma forma do servidor.
  const publicado = (situation, popup) => ({ audienceCount: 318, id: "x", ...(popup ? { popup } : {}), recipients: null, situation, updatedAt: "2026-10-23T15:00:00.000Z" });

  for (const origem of ["publicar", "aprovar"]) {
    assert.equal(model.publishedNoticeToast(publicado("scheduled", { startsInFuture: true, trigger: "page_load" }), "popup"), ressalva, origem);
    assert.equal(model.publishedNoticeToast(publicado("scheduled", { startsInFuture: true, trigger: "first_login" }), "popup"), ressalva, `${origem}: primeiro acesso agendado`);
    assert.equal(model.publishedNoticeToast(publicado("active", { startsInFuture: false, trigger: "first_login" }), "popup"), novos, origem);
    assert.equal(model.publishedNoticeToast(publicado("active", { startsInFuture: false, trigger: "page_load" }), "popup"), hoje, origem);
    assert.equal(model.publishedNoticeToast(publicado("scheduled", { startsInFuture: true, trigger: "lesson_completed" }), "popup"), "Pop-up publicado.", "conclusao agendada: o de hoje");
    assert.equal(model.publishedNoticeToast(publicado("scheduled", { startsInFuture: true, trigger: "course_completed" }), "popup"), "Pop-up publicado.");
  }

  // Sem a chave (servidor de antes) e notificacao: os textos de hoje.
  assert.equal(model.publishedNoticeToast(publicado("active"), "popup"), hoje);
  assert.equal(model.publishedNoticeToast(publicado("scheduled"), "popup"), "Pop-up publicado.");
  assert.equal(model.publishedNoticeToast(publicado("pending_approval", { startsInFuture: true, trigger: "page_load" }), "popup"), "Enviado para aprovação.");
  assert.equal(model.publishedNoticeToast({ ...publicado("sent"), recipients: 12 }, "inbox"), "Notificação enviada para 12 alunos.");
  [ressalva, novos].forEach(semPalavrasProibidas);
});

/* ------------------------------------------------------------------------------------------------
 * Vocabulario
 * ---------------------------------------------------------------------------------------------- */

test("vocabulário: os textos novos do card (inclusive home e trigger) e as opções", () => {
  const { frequency, placement } = editor.POPUP_EDITOR_COPY;
  const novos = [
    ...folhas(placement.triggerHint),
    ...folhas(placement.delayHint),
    ...folhas(placement.startsAtHint),
    ...folhas(placement.firstAccessHint),
    ...folhas(placement.firstAccessOptions).filter((text) => /\s|[^\x00-\x7f]|^[A-Z]/.test(text)),
    ...folhas(placement.courseScopeOptions).filter((text) => /\s|[^\x00-\x7f]|^[A-Z]/.test(text)),
    placement.firstAccessLabel,
    placement.firstAccessDelayNote,
    placement.firstAccessLocked,
    placement.courseScopeLabel,
    placement.courseExceptionsLabel,
    placement.courseFormationHint,
    placement.lessonHint,
    placement.note,
    placement.whereHint.any,
    placement.startsAtLiveNote,
    ...folhas(frequency.intervalDescription),
    ...editor.POPUP_TRIGGER_OPTIONS.map((option) => option.label)
  ];

  assert.ok(novos.length > 25, `achou os textos (${novos.length})`);
  novos.forEach(semPalavrasProibidas);

  // Os textos desenhados nos tres cartoes novos (nada de nome interno em rotulo).
  const telas = [
    renderPlacement({ lockedTriggers: ["page_load", "lesson_completed", "course_completed"], popup: config({ accessProducts: ["formacao-ia", "saiu"], trigger: "first_login" }) }),
    renderPlacement({ popup: config({ pages: ["lesson:*"], trigger: "course_completed" }) })
  ].map((html) => html.replace(/<[^>]+>/g, " "));
  for (const texto of telas) {
    semPalavrasProibidas(texto);
    assert.doesNotMatch(texto, /first_login|course_completed|message_impressed/);
  }
});
