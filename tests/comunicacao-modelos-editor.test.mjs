import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Modelos da Comunicacao, frente E (docs/28; spec §5.5 a §5.10 e §7.1 E; docs/18 §1.1):
// - o que some no modo modelo do editor do aviso (envio, janela, "Até uma data", fim da enquete, teste e aprovacao) e
//   o que fica; o modo do editor pelas props;
// - a copia de recuperacao do editor Livre num modelo nunca se confunde com a de um aviso;
// - os textos do modo modelo, de "Meus modelos" no card Design e da aba Modelos do editor Livre, palavra por palavra e
//   com o vocabulario da equipe; o editor Livre diz "Modelo salvo." depois de "Salvar modelo";
// - "Usar este modelo" no editor Livre: o botao principal que nasce ganha o texto guardado e a nota do colar vira a do
//   modelo;
// - as seguintes de um modelo no formato do cartao (campaignId "" em todos os niveis) e os modelos aplicados (5 mais
//   recentes, o de inicio sempre);
// - o estado da lista "Meus modelos" (carregando, erro com "Tentar de novo", itens, nota dos 50, vazia);
// - desenhados: "Fica no sino por" sem "Até uma data" (campo e folha da seguinte) e "Quando e onde aparece" sem
//   "Começa" e "Termina".
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS, sem checar tipos). next/image, next/link e
// next/navigation viram stubs simples e as Server Actions viram funcoes falsas; o resto e o codigo real.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const fail = `async () => ({ error: "Falhou.", ok: false, status: 500 })`;
const STUBS = {
  "next/image": `import { createElement } from "react";
export default function Image({ fill, priority, sizes, unoptimized, style, ...props }) {
  return createElement("img", { ...props, "data-next-image": "", style: fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style });
}`,
  "next/link": `import { createElement } from "react";
export default function Link({ prefetch, scroll, ...props }) { return createElement("a", props); }`,
  "next/navigation": `export function useRouter() { return { back() {}, push() {}, refresh() {}, replace() {} }; }
export function usePathname() { return "/admin/comunicacao/modelos"; }
export function redirect(href) { throw new Error("redirect " + href); }`,
  "@/server/communications/actions": `export const uploadNoticeImage = ${fail};
export const listNoticeSenders = ${fail};`
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
const editorModel = await import("../src/components/admin/v2/communication/template-editor-model.ts");
const designModel = await import("../src/components/admin/v2/communication/popup-design/popup-design-editor-model.ts");
const freeModel = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
const recovery = await import("../src/components/admin/v2/communication/popup-free/free-editor-recovery.ts");
const followUpsModel = await import("../src/components/admin/v2/communication/follow-ups-view-model.ts");
const templateModel = await import("../src/server/communications/template-model.ts");
const starters = await import("../src/server/communications/popup-free-starters.ts");
const paste = await import("../src/server/communications/popup-free-paste.ts");
const freeSchema = await import("../src/server/communications/popup-free-schema.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const popupEditorModel = await import("../src/components/admin/v2/communication/popup-editor-model.ts");
const { NoticeValidityField } = await import("../src/components/admin/v2/communication/notice-validity-field.tsx");
const { NoticeContentFields } = await import("../src/components/admin/v2/communication/notice-content-fields.tsx");
const { PopupPlacementFields } = await import("../src/components/admin/v2/communication/popup-placement-fields.tsx");
const { PreviewDeviceChoice } = await import("../src/components/admin/v2/communication/notice-preview.tsx");
const noticesVm = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const listVm = await import("../src/components/admin/v2/communication/templates/templates-view-model.ts");
const customDesign = await import("../src/server/communications/popup-design-model.ts");
const saveShortcut = await import("../src/components/admin/v2/communication/save-shortcut.ts");

const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete", "fluxo"];
const NOW = Date.parse("2026-10-23T15:00:00.000Z");

/** Todos os textos de um objeto (funcoes chamadas com valores de exemplo). */
function collectStrings(value, into = []) {
  if (typeof value === "string") {
    into.push(value);
  } else if (typeof value === "function") {
    into.push(String(value("Lançamento", 2)));
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, into));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, into));
  }

  return into;
}

function assertVocabulary(texts) {
  assert.ok(texts.length > 0);

  for (const text of texts) {
    for (const word of PROIBIDAS) {
      assert.equal(new RegExp(`(^|[^\\p{L}])${word}`, "iu").test(text), false, `“${text}” usa “${word}”`);
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Modo do editor e o que some
 * ---------------------------------------------------------------------------------------------- */

test("templateEditorHidden: no modo modelo somem envio, janela, Até uma data, fim da enquete, teste e aprovação; o resto fica", () => {
  const hidden = editorModel.templateEditorHidden("template");

  for (const part of ["schedule", "window", "validityUntil", "pollEndDate", "sendTest", "approval", "publish", "saveDraft", "rowMenu", "saveAsTemplate", "viewAsFlow", "kindPills", "statusNotes"]) {
    assert.equal(hidden[part], true, `${part} some no modo modelo`);
  }

  for (const part of ["content", "audience", "design", "placement", "frequency", "validity", "followUps", "preview"]) {
    assert.equal(hidden[part], false, `${part} fica no modo modelo`);
  }

  for (const mode of ["new", "notice", "start"]) {
    assert.deepEqual(Object.values(editorModel.templateEditorHidden(mode)).filter(Boolean), [], `${mode}: nada some`);
  }

  assert.deepEqual(Object.keys(hidden).sort(), [...editorModel.TEMPLATE_EDITOR_PARTS].sort());
});

test("noticeEditorModeOf: aviso gravado, modo modelo, aviso de um modelo e aviso em branco", () => {
  assert.equal(editorModel.noticeEditorModeOf({ initial: { id: "x" }, start: { draft: {} }, template: { id: "t" } }), "notice", "o aviso gravado vence");
  assert.equal(editorModel.noticeEditorModeOf({ initial: null, template: { id: "t" } }), "template");
  assert.equal(editorModel.noticeEditorModeOf({ initial: null, start: { draft: {} } }), "start");
  assert.equal(editorModel.noticeEditorModeOf({ initial: null, start: null, template: null }), "new");
});

test("a escolha do tipo: quatro cartões na ordem da tela, cada um com o ?tipo= que o parser da frente S lê", () => {
  const choices = editorModel.TEMPLATE_KIND_CHOICES;

  assert.deepEqual(
    choices.map((choice) => choice.title),
    ["Notificação", "Pop-up", "Design Personalizado", "Design Livre"]
  );
  assert.deepEqual(
    choices.map((choice) => choice.href),
    [
      "/admin/comunicacao/modelos/novo?tipo=notificacao",
      "/admin/comunicacao/modelos/novo?tipo=popup",
      "/admin/comunicacao/modelos/novo?tipo=design-personalizado",
      "/admin/comunicacao/modelos/novo?tipo=design-livre"
    ]
  );

  for (const choice of choices) {
    assert.equal(templateModel.parseTemplateTypeParam(new URL(choice.href, "https://x").searchParams.get("tipo")), choice.type);
  }

  assert.equal(templateModel.parseTemplateTypeParam("x"), null, "valor desconhecido mostra a escolha");
  assert.equal(choices[0].description, "Quem envia, ícone, tempo no sino, para quem e, se quiser, o conteúdo e as notificações seguintes.");
  assert.equal(choices[3].description, "Só o visual montado do zero no editor Livre. Aparece em “Meus modelos” no card Design e no editor Livre.");
});

/* ------------------------------------------------------------------------------------------------
 * Copia de recuperacao e textos
 * ---------------------------------------------------------------------------------------------- */

test("freeTemplateRecoveryKey: a chave do modelo nunca se confunde com a de um aviso", () => {
  assert.equal(recovery.freeTemplateRecoveryKey(null), "bunker707:livre:modelo:novo");
  assert.notEqual(recovery.freeTemplateRecoveryKey(null), recovery.freeRecoveryKey(null));
  assert.equal(recovery.freeTemplateRecoveryKey("8d1b3c4e-0f4a-4b44-9a7b-3c6a0b6b2f10"), "bunker707:livre:modelo:8d1b3c4e-0f4a-4b44-9a7b-3c6a0b6b2f10");
  assert.notEqual(recovery.freeTemplateRecoveryKey("abc"), recovery.freeRecoveryKey("abc"));
});

test("textos do modo modelo, de Meus modelos e da aba Modelos do Livre: palavra por palavra e com o vocabulário da equipe", () => {
  const copy = editorModel.TEMPLATE_EDITOR_COPY;
  const mine = designModel.POPUP_DESIGN_COPY.mine;
  const tab = freeModel.FREE_EDITOR_COPY.templates;

  assertVocabulary([...collectStrings(copy), ...collectStrings(mine), ...collectStrings(tab), freeModel.FREE_EDITOR_COPY.tabs.templates]);

  // §5.6
  assert.equal(copy.card.phrase, "Ao usar, você começa um aviso novo com tudo o que está aqui. Nada é enviado daqui.");
  assert.equal(copy.review.sentence, "Ao usar este modelo, você começa um aviso novo com esta configuração. Os alunos nunca veem um modelo.");
  assert.equal(copy.review.hint, "Ctrl+Enter (⌘+Enter no Mac) salva o modelo.");
  assert.equal(copy.preview, "Prévia do modelo: os alunos nunca veem um modelo.");
  assert.equal(copy.kind.hint, "O tipo do modelo não muda. Para o outro tipo, crie outro modelo.");
  assert.equal(copy.off.content, "O conteúdo não vai neste modelo. Ligue “Levar o conteúdo” no card Modelo para guardar o que está aqui.");
  assert.equal(copy.off.audience, "O segmento não vai neste modelo: o aviso feito com ele começa em “Todos os alunos”.");
  assert.equal(copy.off.followUps, "As notificações seguintes não vão neste modelo.");
  assert.equal(copy.validity.title, "Tempo no sino");
  assert.equal(copy.validity.description, "Quanto tempo a notificação fica no sino de cada aluno.");
  assert.equal(copy.header.useDirty, "Salve o modelo antes de usar.");
  assert.equal(copy.confirmRead.title, "Salvar o modelo assim?");
  assert.equal(copy.confirmRead.description, "Uma parte deste modelo não pôde ser lida e voltou ao padrão. Ao salvar, o padrão fica no lugar dela.");
  assert.equal(copy.unreadable.description, templateModel.TEMPLATE_MESSAGES.unreadable);
  assert.equal(copy.include.audience.description, "Quem recebe: o que está em “Para quem”.");
  assert.equal(editorModel.templateContentDescription("inbox", false), "Título, texto, imagem, áudio, botão e interação.");
  assert.equal(editorModel.templateContentDescription("popup", false), "Título, texto, imagem, áudio e botão.");
  assert.equal(
    editorModel.templateContentDescription("popup", true),
    "Título, texto, imagem, áudio e botão. Os textos que ficam dentro do design vão sempre com o design."
  );
  assert.equal(editorModel.templateNameCounter("Lançamento"), "10/80");
  assert.equal(editorModel.templateEditorTitle({ id: "x", kind: "inbox", savedName: "Boas-vindas" }), "Modelo: Boas-vindas");
  assert.equal(editorModel.templateEditorTitle({ id: null, kind: "popup", savedName: "" }), "Novo modelo de pop-up");
  assert.equal(editorModel.templateEditorTitle({ id: null, kind: "design", mode: "free", savedName: "" }), "Novo modelo de design Livre");
  assert.equal(copy.pageTitles.new, "Novo modelo · Comunicação");
  assert.equal(copy.pageTitles.edit, "Modelo · Comunicação");
  assert.equal(copy.design.use, "Usar num pop-up novo");

  // §5.8 (so em POPUP_DESIGN_COPY.mine)
  assert.equal(mine.title, "Meus modelos");
  assert.equal(mine.readyTitle, "Modelos prontos");
  assert.equal(mine.save, "Salvar design como modelo");
  assert.equal(mine.applied, "Design aplicado.");
  assert.equal(mine.saved, "Design salvo em Meus modelos.");
  assert.equal(mine.capped, "Mostrando os 50 mais recentes.");
  assert.equal(mine.loading, "Carregando seus modelos…");
  assert.equal(mine.error, "Não foi possível carregar seus modelos agora.");
  assert.equal(mine.retry, "Tentar de novo");
  assert.equal(mine.use, "Usar este modelo");
  assert.equal(mine.useLabel("Aula nova"), "Usar este modelo: Aula nova");
  assert.equal(mine.ctaDestination, "O destino do botão é escolhido em cada aviso.");
  assert.equal(
    mine.saveDescription("custom"),
    "Fica em “Meus modelos” do design Personalizado e em Comunicação › Modelos. Os textos do design vão junto; o destino do botão fica em cada aviso."
  );
  assert.match(mine.saveDescription("free"), /^Fica em “Meus modelos” do design Livre/);

  // §5.9 (so em free-editor-model.ts)
  assert.equal(freeModel.FREE_EDITOR_COPY.tabs.templates, "Modelos");
  assert.equal(tab.save, "Salvar este design como modelo");
  assert.equal(tab.empty, "Seus designs Livres salvos aparecem aqui. Use “Salvar este design como modelo”.");
  assert.equal(tab.error, "Não foi possível carregar seus modelos agora.");
  assert.equal(tab.applied, "Modelo aplicado. Ctrl + Z desfaz.");
  assert.equal(tab.dialogDescription, mine.saveDescription("free"), "o mesmo texto do card Design");

  // "Salvar modelo" de dentro do Livre: a frase do modo modelo, nunca "Rascunho salvo.".
  assert.equal(freeModel.freeSavedMessage("Modelo salvo."), "Modelo salvo.");
  assert.equal(freeModel.freeSavedMessage(copy.saved), "Modelo salvo.");
  assert.equal(freeModel.freeSavedMessage(undefined), "Rascunho salvo.");
});

/* ------------------------------------------------------------------------------------------------
 * "Usar este modelo" no editor Livre: a nota do colar trocada
 * ---------------------------------------------------------------------------------------------- */

function starterWithCta() {
  for (const { id } of starters.FREE_DESIGN_STARTERS) {
    const design = starters.freeStarterDesign(id);
    let hasCta = false;
    const walk = (nodes) =>
      nodes.forEach((node) => {
        hasCta ||= node.type === "button" && node.action.kind === "cta";
        if (node.type === "box") walk(node.children);
      });

    walk(design.children);

    if (hasCta) {
      return design;
    }
  }

  throw new Error("nenhum modelo pronto com botão principal");
}

test("aplicar um modelo Livre com botão num aviso sem botão: o botão ganha o texto guardado e a nota é a do modelo", () => {
  const design = starterWithCta();
  const context = { content: { audio: null, cta: null }, fontIds: [], knownAssets: [] };
  const applied = freeModel.applyFreeTemplateDesign({ design, support: { ctaLabel: "Quero minha vaga" } }, context);

  assert.equal(applied.ok, true);
  assert.equal(applied.cta.label, "Quero minha vaga");
  assert.equal(applied.cta.href, "", "o destino fica para o aviso");
  assert.ok(applied.notes.includes(templateModel.TEMPLATE_MESSAGES.applyCta("Quero minha vaga")));
  assert.ok(!applied.notes.includes(paste.POPUP_FREE_PASTE_MESSAGES.cta), "a nota do colar (“Saiba mais”) sai");
  assert.deepEqual(freeSchema.popupFreeDesignSchema.safeParse(applied.design).success, true);

  // Sem texto guardado: o colar de sempre ("Saiba mais" e a nota dele).
  const plain = freeModel.applyFreeTemplateDesign({ design, support: { ctaLabel: null } }, context);

  assert.equal(plain.ok, true);
  assert.equal(plain.cta.label, "Saiba mais");
  assert.ok(plain.notes.includes(paste.POPUP_FREE_PASTE_MESSAGES.cta));

  // O aviso ja tem botao: o botao dele fica (texto e destino), sem nota.
  const cta = { display: "button", href: "/minhas-compras", label: "Ver agora", target: "same_tab" };
  const kept = freeModel.applyFreeTemplateDesign({ design, support: { ctaLabel: "Quero minha vaga" } }, { ...context, content: { audio: null, cta } });

  assert.equal(kept.ok, true);
  assert.deepEqual(kept.cta, cta);
  assert.ok(!kept.notes.some((note) => note.includes("ganhou o texto")));
});

/* ------------------------------------------------------------------------------------------------
 * Seguintes de um modelo e modelos aplicados
 * ---------------------------------------------------------------------------------------------- */

const ENTRY = "6a1f0c3e-1b2d-4c5e-8f90-0a1b2c3d4e5f";
const FIRST = "0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10";
const CHILD = "1c8d8f4f-3e2b-4d66-8b5f-6a2a8c3d0e21";

function followUpContent(title) {
  return { ...schemas.emptyNoticeDraft("inbox"), body: "Texto", title, validity: { mode: "default" } };
}

test("savedFollowUpsOfDrafts: campaignId vazio em todos os níveis, e o cartão lê os filhos com campaignId vazio", () => {
  const tree = [
    {
      children: [{ children: [], content: followUpContent("Filha"), id: CHILD, when: { anchor: "sent", minutes: 60 }, who: { kind: "everyone" } }],
      content: followUpContent("Primeira"),
      id: FIRST,
      when: { anchor: "sent", minutes: 1440 },
      who: { kind: "everyone" }
    }
  ];
  const saved = editorModel.savedFollowUpsOfDrafts(tree);

  assert.equal(saved[0].campaignId, "");
  assert.equal(saved[0].children[0].campaignId, "");
  assert.equal(saved[0].children[0].id, CHILD);
  assert.deepEqual(saved[0].when, { anchor: "sent", minutes: 1440 });

  const main = followUpsModel.followUpParentOf(ENTRY, "main", schemas.emptyNoticeDraft("inbox"));
  const items = followUpsModel.followUpFormItemsOf(saved, main);

  assert.equal(items[0].campaignId, "");
  assert.equal(items[0].children[0].campaignId, "", "o filho tambem (o cartao le campaignId dos filhos)");
  assert.equal(items[0].children[0].content.title, "Filha");
});

test("recentTemplateIds: no máximo 5, sem repetidos, o de início sempre e os mais recentes no fim", () => {
  const start = "start";
  let list = [start];

  for (const id of ["a", "b", "c", "a", "d", "e"]) {
    list = editorModel.recentTemplateIds(list, id, start);
  }

  assert.equal(list.length, 5);
  assert.equal(new Set(list).size, list.length, "sem repetidos");
  assert.equal(list[0], start, "o de inicio fica");
  assert.deepEqual(list, ["start", "c", "a", "d", "e"], "o repetido vai para o fim e o mais antigo sai");

  // Sem modelo de inicio: os 5 mais recentes.
  let plain = [];

  for (const id of ["1", "2", "3", "4", "5", "6"]) {
    plain = editorModel.recentTemplateIds(plain, id, null);
  }

  assert.deepEqual(plain, ["2", "3", "4", "5", "6"]);
  assert.deepEqual(editorModel.recentTemplateIds(["start", "x"], "start", "start"), ["start", "x"], "aplicar o de inicio de novo nao repete");
});

test("Desfazer do Usar este modelo: o modelo sai dos aplicados (o salvar não manda em fromTemplates nem grava template_used); o de início fica", () => {
  const { recentTemplateIds: aplicar, undoTemplateUse: desfazer } = editorModel;
  assert.equal(typeof desfazer, "function", "undoTemplateUse existe");
  const start = "start";

  // Aviso novo de um modelo (?modelo=): aplicar "x" e desfazer volta so ao de inicio.
  const antes = [start];
  const depois = aplicar(antes, "x", start);
  assert.deepEqual(depois, ["start", "x"]);
  assert.deepEqual(desfazer(depois, { before: antes, id: "x" }, start), ["start"], "o de início fica, o desfeito sai");

  // Sem modelo de inicio: a lista fica vazia, e o salvar nao manda fromTemplates (o servidor nao grava template_used).
  const sozinho = aplicar([], "x", null);
  assert.deepEqual(desfazer(sozinho, { before: [], id: "x" }, null), []);

  // O mesmo modelo aplicado duas vezes: desfazer a segunda deixa o primeiro uso (o design dele continua no rascunho).
  const primeiro = aplicar([start], "x", start);
  const segundo = aplicar(primeiro, "x", start);
  assert.deepEqual(desfazer(segundo, { before: primeiro, id: "x" }, start), ["start", "x"]);

  // Outro modelo aplicado depois fica; o desfeito sai.
  const comY = aplicar(depois, "y", start);
  assert.deepEqual(desfazer(comY, { before: antes, id: "x" }, start), ["start", "y"]);

  // Salvar no meio zera a lista (os caminhos foram para a linha gravada): o Desfazer depois nao traz nada de volta.
  assert.deepEqual(desfazer([], { before: antes, id: "x" }, start), []);

  // O de inicio nunca sai, mesmo se for ele o desfeito.
  assert.deepEqual(desfazer(aplicar([], start, start), { before: [], id: start }, start), ["start"]);
});

/* ------------------------------------------------------------------------------------------------
 * "Meus modelos": o estado da lista
 * ---------------------------------------------------------------------------------------------- */

test("designTemplatesPickerState: carregando, erro com Tentar de novo, itens com e sem a nota dos 50, e lista vazia", () => {
  const view = designModel.designTemplatesPickerState;
  const next = designModel.nextDesignTemplatesLoad;
  const item = (name, updatedAt = "2026-10-23T14:30:00.000Z") => ({ id: name, name, updatedAt });

  // Abrir pede uma vez; abrir de novo com a lista lida nao pede.
  const idle = { status: "idle" };
  const loading = next(idle, { kind: "open" });

  assert.deepEqual(loading, { status: "loading" });
  assert.deepEqual(view(loading).loading, { label: "Carregando seus modelos…" });
  assert.equal(view(loading).section, null);

  const failed = next(loading, { kind: "failed" });

  assert.deepEqual(view(failed).error, { message: "Não foi possível carregar seus modelos agora.", retry: "Tentar de novo" });
  assert.deepEqual(next(failed, { kind: "retry" }), { status: "loading" }, "Tentar de novo volta a carregando");
  assert.equal(next(failed, { kind: "open" }), failed, "abrir de novo depois do erro nao pede sozinho");

  const ready = next(loading, { items: [item("Lançamento")], kind: "loaded", total: 1 });
  const shown = view(ready);

  assert.equal(next(ready, { kind: "open" }), ready, "a lista lida fica");
  assert.equal(shown.section.title, "Meus modelos");
  assert.equal(shown.readyTitle, "Modelos prontos");
  assert.equal(shown.section.note, null);
  assert.deepEqual(
    shown.section.items.map(({ name, updated, useLabel }) => ({ name, updated, useLabel })),
    [{ name: "Lançamento", updated: "Atualizado em 23/10/2026", useLabel: "Usar este modelo: Lançamento" }]
  );

  const capped = view(next(loading, { items: Array.from({ length: 50 }, (_, index) => item(`M${index}`)), kind: "loaded", total: 51 }));

  assert.equal(capped.section.items.length, 50);
  assert.equal(capped.section.note, "Mostrando os 50 mais recentes.");

  const empty = view(next(loading, { items: [], kind: "loaded", total: 0 }));

  assert.equal(empty.section, null, "sem itens, sem a secao Meus modelos");
  assert.equal(empty.error, null);
  assert.equal(empty.loading, null);

  // Salvar um design como modelo descarta o que foi lido (le de novo na proxima abertura).
  assert.deepEqual(next(ready, { kind: "reset" }), { status: "idle" });

  // A aba Modelos do Livre usa os textos dela, sem o titulo dos modelos prontos.
  const tab = view(ready, { copy: freeModel.FREE_EDITOR_COPY.templates });

  assert.equal(tab.readyTitle, null);
  assert.equal(tab.section.items[0].updated, "Atualizado em 23/10/2026");
});

/* ------------------------------------------------------------------------------------------------
 * Desenhados: sem "Até uma data" e sem a janela
 * ---------------------------------------------------------------------------------------------- */

const OTHER = { minutes: 45, mode: "duration" };

function renderValidity(props) {
  return renderToStaticMarkup(
    createElement(NoticeValidityField, { disabled: false, errors: {}, idPrefix: "aviso-validade", onChange: () => undefined, sendAt: NOW, value: OTHER, ...props })
  );
}

test("NoticeValidityField com allowUntil={false}: o Outro mostra só o tempo, sem “Até uma data”", () => {
  const withUntil = renderValidity({});
  const withoutUntil = renderValidity({ allowUntil: false });

  assert.match(withUntil, /Até uma data/, "o editor do aviso continua com a opcao");
  assert.doesNotMatch(withoutUntil, /Até uma data/);
  assert.match(withoutUntil, /id="aviso-validade-numero"/, "o numero do Outro continua");
  assert.match(withoutUntil, /Por um tempo|Quanto tempo/);
});

function renderContent(props) {
  return renderToStaticMarkup(
    createElement(NoticeContentFields, {
      canEditBrand: false,
      disabled: false,
      errorFor: () => undefined,
      idPrefix: "seguinte-1",
      kind: "inbox",
      layout: "plain",
      onBlurField: () => undefined,
      onChange: () => undefined,
      pollCanEndAtDate: false,
      products: [],
      productsLoaded: true,
      schoolIconUrl: "/icon.png",
      schoolName: "Escola",
      sendAt: NOW,
      senders: [],
      showValidity: true,
      validityAnchor: { label: "Até a notificação principal sumir" },
      value: { ...schemas.emptyNoticeDraft("inbox"), title: "Seguinte", validity: OTHER },
      ...props
    })
  );
}

test("NoticeContentFields (a folha da seguinte) com validityAllowUntil={false}: sem “Até uma data”", () => {
  assert.match(renderContent({}), /Até uma data/, "a folha de sempre continua com a opcao");

  const html = renderContent({ validityAllowUntil: false });

  assert.doesNotMatch(html, /Até uma data/);
  assert.match(html, /Até a notificação principal sumir/, "a opcao da ancora continua");
  assert.match(html, /id="seguinte-1-validade-numero"/);
});

function renderPlacement(props) {
  const draft = { ...schemas.emptyNoticeDraft("popup") };
  const ui = popupEditorModel.placementUiOf(popupEditorModel.popupSettingsOfDraft(draft));

  return renderToStaticMarkup(
    createElement(PopupPlacementFields, {
      disabled: false,
      draft,
      errorFor: () => undefined,
      live: null,
      names: { contents: {}, lessons: {}, products: {} },
      now: NOW,
      onChange: () => undefined,
      onUiChange: () => undefined,
      opensOnLesson: [],
      products: [],
      productsLoaded: true,
      ui,
      ...props
    })
  );
}

test("PopupPlacementFields com showWindow={false}: sem os campos de início e fim", () => {
  const withWindow = renderPlacement({});
  const withoutWindow = renderPlacement({ showWindow: false });

  assert.match(withWindow, /Começa/, "o editor do aviso continua com a janela");
  assert.doesNotMatch(withoutWindow, /Começa/);
  assert.doesNotMatch(withoutWindow, /Termina/);
  assert.doesNotMatch(withoutWindow, /aviso-inicio/);
  assert.doesNotMatch(withoutWindow, /aviso-fim/);
  assert.match(withoutWindow, /name="popup-momento"/, "o momento e onde aparece continuam");
});

/* ------------------------------------------------------------------------------------------------
 * Correcoes da revisao: o banner do "Salvar modelo", o destino escondido sem o conteudo, as notas do aviso novo de um
 * modelo depois do salvar, a escolha do aparelho na previa e os dois contadores do nome
 * ---------------------------------------------------------------------------------------------- */

test("templateSaveFailureTitle: o banner do Salvar modelo nunca diz aviso; o 409 tem o título dele", () => {
  for (const status of [0, 400, 404, 422, 500]) {
    assert.equal(editorModel.templateSaveFailureTitle(status), "Não foi possível salvar o modelo", String(status));
    assert.doesNotMatch(editorModel.templateSaveFailureTitle(status), /aviso/i);
  }

  assert.equal(editorModel.templateSaveFailureTitle(409), "Este modelo mudou em outra tela");
  assert.equal(editorModel.TEMPLATE_EDITOR_COPY.saveFailedTitle, "Não foi possível salvar o modelo");
});

test("templateHidesCtaDestination e templateDraftForSave: sem o conteúdo, o destino do botão do design some e vai vazio; o resto fica", () => {
  const cta = { display: "button", href: "javascript:alert(1)", label: "Quero ver", target: "same_tab" };
  const personalizado = { ...schemas.emptyNoticeDraft("popup"), cta, design: customDesign.popupStarterDesign("text_only"), freeDesign: null };
  const livre = { ...personalizado, design: null, freeDesign: starters.freeStarterDesign("blank") };
  const padrao = { ...personalizado, design: null, freeDesign: null };
  const semConteudo = { audience: true, content: false, followUps: false };
  const comConteudo = { audience: true, content: true, followUps: false };

  assert.equal(editorModel.templateHidesCtaDestination({ content: false, draft: personalizado }), true);
  assert.equal(editorModel.templateHidesCtaDestination({ content: false, draft: livre }), true);
  assert.equal(editorModel.templateHidesCtaDestination({ content: true, draft: personalizado }), false, "com o conteudo, o destino vai e aparece");
  assert.equal(editorModel.templateHidesCtaDestination({ content: false, draft: padrao }), false, "no Padrao o botao fica no card Conteudo");
  assert.equal(editorModel.templateHidesCtaDestination({ content: false, draft: { ...schemas.emptyNoticeDraft("inbox"), cta } }), false);

  const enviado = editorModel.templateDraftForSave(personalizado, semConteudo);
  assert.deepEqual(enviado.cta, { ...cta, href: "" }, "o destino de antes nunca segura o salvar");
  assert.equal(templateModel.templateDraftInputSchema.safeParse(enviado).success, true);
  assert.equal(templateModel.templateDraftInputSchema.safeParse(personalizado).success, false, "o destino invalido seria um erro escondido");
  assert.equal(enviado.design, personalizado.design);
  assert.equal(personalizado.cta.href, cta.href, "o rascunho da tela nao muda");
  assert.equal(editorModel.templateDraftForSave(personalizado, comConteudo), personalizado);
  assert.equal(editorModel.templateDraftForSave(padrao, semConteudo), padrao);
  const semBotao = { ...personalizado, cta: null };
  assert.equal(editorModel.templateDraftForSave(semBotao, semConteudo), semBotao);
});

test("noticeStartNotes: as notas do aviso novo de um modelo somem depois do primeiro salvar, mesmo sem trocar de endereço", () => {
  const M = templateModel.TEMPLATE_MESSAGES;
  const base = { notes: [M.applyCta("Quero")], problem: null, templateName: "Lançamento" };

  assert.deepEqual(editorModel.noticeStartNotes({ ...base, mode: "start", saved: false }), [M.startFrom("Lançamento"), M.applyCta("Quero")]);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, mode: "start", saved: true }), []);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, mode: "new", problem: "missing", saved: false }), [M.startMissing]);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, mode: "new", problem: "unreadable", saved: false }), [M.startUnreadable]);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, mode: "new", problem: "missing", saved: true }), []);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, mode: "new", problem: null, saved: false }), []);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, mode: "template", saved: false }), []);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, mode: "notice", saved: true }), []);
});

test("previa: Computador | Celular na notificação e no pop-up Padrão; com design (editor do aviso e página do modelo), celular e computador juntos, sem a escolha", () => {
  const popup = schemas.emptyNoticeDraft("popup");
  assert.equal(noticesVm.previewHasDeviceChoice(schemas.emptyNoticeDraft("inbox")), true);
  assert.equal(noticesVm.previewHasDeviceChoice(popup), true, "modelo novo de Design antes de escolher: o Padrao, com a escolha");
  assert.equal(noticesVm.previewHasDeviceChoice({ ...popup, design: { blocks: [] } }), false);
  assert.equal(noticesVm.previewHasDeviceChoice({ ...popup, freeDesign: { children: [] } }), false);

  const render = (draft) => renderToStaticMarkup(createElement(PreviewDeviceChoice, { draft, name: "modelo-previa-aparelho", onChange: () => undefined, value: "desktop" }));
  const comEscolha = render(popup);
  assert.match(comEscolha, /Aparelho da prévia/);
  assert.match(comEscolha, />Computador</);
  assert.match(comEscolha, />Celular</);
  assert.match(comEscolha, /name="modelo-previa-aparelho"/);
  assert.equal(render({ ...popup, design: { blocks: [] } }), "");
});

test("contadores do nome: o do diálogo e o do card Modelo contam igual, como o maxLength do campo", () => {
  for (const name of ["Lançamento", "Aula 😀 ao vivo", "👩‍💻", "a".repeat(80)]) {
    assert.equal(listVm.nameCounter(name), editorModel.templateNameCounter(name), name);
    assert.equal(listVm.nameCounter(name), `${name.length}/80`, name);
  }

  // O campo (maxLength = 80 unidades) para de aceitar quando o contador chega a "80/80"; o zod e o banco contam por
  // caractere (mais folgados), entao tudo o que o campo aceita passa no servidor.
  const emojis = "😀".repeat(40);
  assert.equal(listVm.nameCounter(emojis), "80/80");
  assert.equal(templateModel.templateNameSchema.safeParse(emojis).success, true);
});

test("Ctrl+Enter do editor: salva no formulário, nunca com o foco num diálogo, num painel, na lista de uma escolha ou num menu", () => {
  /** Um alvo falso: os papeis (role) do elemento ate a raiz, com o `closest` que o navegador faria. */
  const alvo = (...roles) => ({
    closest(selector) {
      const wanted = [...selector.matchAll(/\[role="([a-z]+)"\]/g)].map((match) => match[1]);
      return roles.some((role) => wanted.includes(role)) ? {} : null;
    }
  });
  const tecla = (extra = {}) => ({ altKey: false, ctrlKey: true, defaultPrevented: false, key: "Enter", metaKey: false, target: alvo(), ...extra });
  const { isEditorSaveShortcut } = saveShortcut;

  assert.equal(isEditorSaveShortcut(tecla()), true, "Ctrl+Enter num campo do editor");
  assert.equal(isEditorSaveShortcut(tecla({ ctrlKey: false, metaKey: true })), true, "⌘+Enter no Mac");
  assert.equal(isEditorSaveShortcut(tecla({ target: alvo("region", "main") })), true, "dentro de um card do editor");
  assert.equal(isEditorSaveShortcut(tecla({ target: null })), true, "sem foco (o alvo e a janela)");
  assert.equal(isEditorSaveShortcut(tecla({ target: {} })), true, "alvo sem closest (o documento)");

  assert.equal(isEditorSaveShortcut(tecla({ altKey: true })), false, "com Alt");
  assert.equal(isEditorSaveShortcut(tecla({ ctrlKey: false })), false, "Enter sozinho envia o formulario de um dialogo");
  assert.equal(isEditorSaveShortcut(tecla({ key: "s" })), false);
  assert.equal(isEditorSaveShortcut(tecla({ defaultPrevented: true })), false, "outro ouvinte ja tratou a tecla");

  // "Salvar como modelo", "Salvar design como modelo", "Enviar fonte" e a folha da seguinte (dialog); as confirmacoes
  // (alertdialog); a lista de uma escolha e o menu, que abrem num portal proprio, fora do dialogo.
  for (const role of ["dialog", "alertdialog", "listbox", "menu"]) {
    assert.equal(isEditorSaveShortcut(tecla({ target: alvo("textbox", role) })), false, role);
    assert.equal(isEditorSaveShortcut(tecla({ ctrlKey: false, metaKey: true, target: alvo(role) })), false, `⌘+Enter em ${role}`);
  }

  // Os dois editores que ouvem no window usam a mesma regra (nada de conferir a tecla na mao).
  for (const file of ["notice-editor.tsx", "design-template-editor.tsx"]) {
    const source = readFileSync(new URL(`../src/components/admin/v2/communication/${file}`, import.meta.url), "utf8");
    assert.ok(/if \(isEditorSaveShortcut\(event\)\) \{/.test(source), `${file} confere a tecla com isEditorSaveShortcut`);
    assert.ok(!/event\.key === "Enter" && \(event\.metaKey \|\| event\.ctrlKey\)/.test(source), `${file} ainda confere a tecla na mão`);
  }
});
