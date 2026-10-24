import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Aba Modelos da Comunicacao (docs/28; spec §5.1 a §5.4 e §7.1 A; docs/18 §1.1):
// - enderecos e filtros (?tipo=, ?busca=, ?pagina=; a busca e o tipo voltam a pagina 1; tipo invalido = "Todos");
// - o menu "…" do modelo legivel e do que nao abre, os estados vazios e o banner de erro da lista (409 com
//   "Recarregar"; o resto "Não foi possível concluir"; 422 com a frase do limite);
// - "Novo aviso" com modelos (link de sempre sem modelos; menu com "Começar em branco", 5 itens e "Ver todos");
// - o dialogo "Salvar como modelo" desenhado (chave das seguintes so na notificacao com seguintes, desabilitada com
//   noteBuilderOnly; a descricao de "Levar o conteúdo" nos quatro casos; notas so do editor);
// - a tabela desenhada ("Não abre", "Atualizado" no cartao do celular, "Alguém que saiu da equipe", o estado vazio);
// - miniaturas: o Personalizado nos dois tamanhos e o cartao do aluno com `still` (nunca <video>, com a capa);
// - o "Salvar como modelo" do menu do aviso logo depois de Duplicar, sem mudar noticeMenuEntries;
// - vocabulario dos textos e a pagina (permissao, migracao pendente, esqueleto).
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS). next/image, next/link e next/navigation viram
// stubs simples; o Dialog e o DropdownMenu viram versoes sem portal (o portal do Base UI nao desenha no servidor), e
// as Server Actions de modelo viram funcoes falsas. O resto e o codigo real.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const pass = `function pass(props) { const out = {}; for (const [key, value] of Object.entries(props)) { if (key.startsWith("data-") || key.startsWith("aria-") || key === "id" || key === "role") out[key] = value; } return out; }`;

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
  "@/components/ui/dialog": `import { createElement } from "react";
${pass}
export function Dialog({ children, open }) { return open ? createElement("div", { "data-stub-dialog": "" }, children) : null; }
export function DialogContent({ children, ...props }) { return createElement("div", { role: "dialog", ...pass(props) }, children); }
export function DialogHeader({ children }) { return createElement("div", null, children); }
export function DialogFooter({ children }) { return createElement("div", { "data-dialog-footer": "" }, children); }
export function DialogTitle({ children }) { return createElement("h2", null, children); }
export function DialogDescription({ children }) { return createElement("p", { "data-dialog-description": "" }, children); }
export function DialogTrigger({ children }) { return children; }
export function DialogClose({ children }) { return children; }`,
  "@/components/ui/dropdown-menu": `import { cloneElement, createElement } from "react";
${pass}
export function DropdownMenu({ children }) { return createElement("div", { "data-stub-menu": "" }, children); }
export function DropdownMenuTrigger({ children, className, onClick, ...props }) { return createElement("button", { "aria-haspopup": "menu", type: "button", ...pass(props) }, children); }
export function DropdownMenuContent({ children }) { return createElement("div", { role: "menu" }, children); }
export function DropdownMenuGroup({ children }) { return createElement("div", { role: "group" }, children); }
export function DropdownMenuLabel({ children }) { return createElement("div", { "data-menu-label": "" }, children); }
export function DropdownMenuSeparator() { return createElement("hr", { "data-menu-separator": "" }); }
export function DropdownMenuItem({ children, disabled, render }) {
  return render ? cloneElement(render, { "data-menu-item": "", role: "menuitem" }, children) : createElement("div", { "aria-disabled": disabled || undefined, "data-menu-item": "", role: "menuitem" }, children);
}`,
  "@/server/communications/template-actions": `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });
export const saveTemplate = fail;
export const saveTemplateFromNotice = fail;
export const renameTemplate = fail;
export const duplicateTemplate = fail;
export const deleteTemplate = fail;`
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
const vm = await import("../src/components/admin/v2/communication/templates/templates-view-model.ts");
const templateModel = await import("../src/server/communications/template-model.ts");
const noticesVm = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const designModel = await import("../src/server/communications/popup-design-model.ts");
const freeSchema = await import("../src/server/communications/popup-free-schema.ts");
const { NewNoticeButton } = await import("../src/components/admin/v2/communication/templates/new-notice-button.tsx");
const { SaveAsTemplateDialog } = await import("../src/components/admin/v2/communication/templates/save-as-template-dialog.tsx");
const { TemplateNameDialog } = await import("../src/components/admin/v2/communication/templates/template-name-dialog.tsx");
const { TemplatesTable } = await import("../src/components/admin/v2/communication/templates/templates-table.tsx");
const thumbs = await import("../src/components/admin/v2/communication/templates/template-thumbs.tsx");
const { MemberPopupCard } = await import("../src/components/member/notifications/member-popup.tsx");
const { PopupDesignCard } = await import("../src/components/member/notifications/popup-design/popup-design-card.tsx");
const { loadPopupFreeCard } = await import("../src/components/member/notifications/popup-free/popup-free-load.ts");

const html = (element) => renderToStaticMarkup(element);
const textOf = (markup) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const read = (path) => readFileSync(new URL(path, root), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FORBIDDEN = /template|público|audiência|layout|lembrete/i;

const ORIGIN = "https://projeto.supabase.co";
const ID_A = "0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const ID_B = "1c8f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const ID_C = "2d9f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const VIDEO_PATH = "videos/0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b.webm";
const VIDEO = { mimeType: "video/webm", path: VIDEO_PATH, url: `${ORIGIN}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` };
const POSTER = { alt: "Capa", url: `${ORIGIN}/storage/v1/object/public/content-assets/communications/images/capa.webp` };
const FREE_POSTER_PATH = "communications/free/0123456789abcdef01234567.webp";

/* ------------------------------------------------------------------------------------------------
 * Enderecos e filtros
 * ---------------------------------------------------------------------------------------------- */

test("enderecos: tipo, busca e pagina no endereco; a busca e o tipo voltam a pagina 1; tipo invalido = Todos", () => {
  assert.equal(templateModel.TEMPLATES_HREF, "/admin/comunicacao/modelos");
  assert.equal(vm.NEW_TEMPLATE_HREF, "/admin/comunicacao/modelos/novo");
  assert.equal(vm.noticeFromTemplateHref(ID_A), `/admin/comunicacao/avisos/novo?modelo=${ID_A}`);
  assert.equal(vm.noticeFromTemplateHref(ID_A).split("?")[0], noticesVm.NEW_NOTICE_HREF, "o mesmo editor do Novo aviso");
  assert.equal(vm.templateEditHref(ID_A), `/admin/comunicacao/modelos/${ID_A}`);

  // ?tipo= pelo parser unico de template-model.ts.
  assert.equal(vm.parseTemplateFilterParam("design-livre"), "design_free");
  assert.equal(vm.parseTemplateFilterParam("design-personalizado"), "design_custom");
  assert.equal(vm.parseTemplateFilterParam("notificacao"), "inbox");
  assert.equal(vm.parseTemplateFilterParam(["popup", "notificacao"]), "popup");
  for (const invalid of ["x", "", undefined, null, "design", "Design-Livre-2"]) {
    assert.equal(vm.parseTemplateFilterParam(invalid), "all", String(invalid));
  }

  assert.equal(vm.parseTemplateSearchParam("  Lançamento  "), "Lançamento");
  assert.equal(vm.parseTemplateSearchParam("a".repeat(120)).length, 80, "a busca para em 80");
  assert.equal(vm.parseTemplatesPage("3"), 3);
  for (const invalid of ["0", "1", "-2", "1.5", "abc", undefined, "99999"]) {
    assert.equal(vm.parseTemplatesPage(invalid), 1, String(invalid));
  }

  assert.equal(vm.templatesHref(), "/admin/comunicacao/modelos");
  assert.equal(vm.templatesHref({ filter: "all", page: 1, search: "  " }), "/admin/comunicacao/modelos");
  assert.equal(vm.templatesHref({ filter: "design_free", page: 2, search: "lanç" }), "/admin/comunicacao/modelos?busca=lan%C3%A7&tipo=design-livre&pagina=2");

  const current = { busca: "lanc", pagina: "3", periodo: "7d", tipo: "popup" };
  assert.deepEqual(vm.templatesStateOf(current), { filter: "popup", page: 3, search: "lanc" });
  assert.equal(vm.templatesFilterHref(current, "inbox"), "/admin/comunicacao/modelos?busca=lanc&tipo=notificacao", "trocar o tipo mantem a busca e volta a pagina 1");
  assert.equal(vm.templatesFilterHref(current, "all"), "/admin/comunicacao/modelos?busca=lanc");
  assert.equal(vm.templatesSearchHref(current, "novo nome"), "/admin/comunicacao/modelos?busca=novo+nome&tipo=popup", "mudar a busca mantem o tipo e volta a pagina 1");
  assert.equal(vm.templatesSearchHref({ tipo: "x" }, ""), "/admin/comunicacao/modelos", "tipo invalido vira Todos");

  assert.deepEqual(
    vm.TEMPLATE_FILTERS.map((option) => [option.label, option.filter]),
    [
      ["Todos", "all"],
      ["Notificação", "inbox"],
      ["Pop-up", "popup"],
      ["Design Personalizado", "design_custom"],
      ["Design Livre", "design_free"]
    ]
  );

  // ?pagina= depois da ultima: a ultima com modelos, com a busca e o tipo.
  assert.equal(vm.templatesPageFallbackHref({ itemCount: 0, page: 5, pageSize: 20, searchParams: current, total: 41 }), "/admin/comunicacao/modelos?busca=lanc&tipo=popup&pagina=3");
  assert.equal(vm.templatesPageFallbackHref({ itemCount: 0, page: 2, pageSize: 20, searchParams: {}, total: 0 }), "/admin/comunicacao/modelos");
  assert.equal(vm.templatesPageFallbackHref({ itemCount: 3, page: 2, pageSize: 20, searchParams: {}, total: 23 }), null);
});

test("contagem: '{n} de 200 modelos' so a partir de 150", () => {
  assert.equal(vm.templatesCountLine(149), null);
  assert.equal(vm.templatesCountLine(150), "150 de 200 modelos");
  assert.equal(vm.templatesCountLine(200), "200 de 200 modelos");
});

/* ------------------------------------------------------------------------------------------------
 * Menu, estados vazios e banner de erro
 * ---------------------------------------------------------------------------------------------- */

test("menu do modelo: Usar, Editar, Renomear, Duplicar e Excluir; o que nao abre so Renomear e Excluir", () => {
  assert.deepEqual(vm.TEMPLATE_MENU_ENTRIES(true), [
    { action: "use", destructive: false, label: "Usar", separated: false },
    { action: "edit", destructive: false, label: "Editar", separated: false },
    { action: "rename", destructive: false, label: "Renomear", separated: false },
    { action: "duplicate", destructive: false, label: "Duplicar", separated: false },
    { action: "delete", destructive: true, label: "Excluir", separated: true }
  ]);
  assert.deepEqual(
    vm.TEMPLATE_MENU_ENTRIES(false).map((entry) => entry.label),
    ["Renomear", "Excluir"]
  );
  assert.equal(vm.templateMenuLabel("Lançamento"), "Ações de Lançamento");
  assert.equal(vm.deleteTemplateDescription("Lançamento"), "“Lançamento” sai da lista de modelos. Os avisos criados com ele não mudam.");
});

test("estado vazio: sem nenhum modelo x busca ou filtro sem resultado", () => {
  assert.deepEqual(vm.emptyCopy("all", ""), {
    action: { href: "/admin/comunicacao/modelos/novo", label: "Novo modelo" },
    description:
      "Um modelo guarda a configuração de uma notificação, de um pop-up ou só de um design, para começar o próximo aviso pronto. Crie aqui ou use “Salvar como modelo” num aviso.",
    secondaryAction: { href: "/admin/comunicacao/avisos", label: "Ver avisos" },
    title: "Nenhum modelo ainda"
  });

  const filtered = {
    description: "Tente outro nome ou outro tipo.",
    secondaryAction: { href: "/admin/comunicacao/modelos", label: "Limpar filtros" },
    title: "Nenhum modelo encontrado"
  };
  assert.deepEqual(vm.emptyCopy("design_free", ""), filtered);
  assert.deepEqual(vm.emptyCopy("all", "lanc"), filtered);
  assert.deepEqual(vm.emptyCopy("inbox", "lanc"), filtered);
});

test("banner de erro da lista: 409 'Este modelo mudou em outra tela' com Recarregar; o resto 'Não foi possível concluir'", () => {
  assert.deepEqual(vm.templateFailureCopy({ message: "qualquer", status: 409 }), {
    message: "Este modelo mudou em outra tela há instantes. Recarregue a página para ver a versão atual.",
    reload: true,
    title: "Este modelo mudou em outra tela"
  });
  assert.deepEqual(vm.templateFailureCopy({ message: "Este modelo não existe mais.", status: 404 }), {
    message: "Este modelo não existe mais.",
    reload: false,
    title: "Não foi possível concluir"
  });
  assert.deepEqual(vm.templateFailureCopy({ message: "x", status: 422 }), {
    message: "Você chegou a 200 modelos. Exclua um que não usa mais para criar outro.",
    reload: false,
    title: "Não foi possível concluir"
  });

  // O hook das acoes usa estas frases e o botao "Recarregar" (router.refresh), como o menu dos avisos.
  const menu = stripComments(read("src/components/admin/v2/communication/templates/template-row-menu.tsx"));
  assert.match(menu, /templateFailureCopy\(failure\)/);
  assert.match(menu, /copy\.reload \?/);
  assert.match(menu, /TEMPLATE_COPY\.errors\.reload/);
  assert.match(menu, /router\.refresh\(\)/);
  assert.doesNotMatch(menu, /revalidatePath/, "a lista atualiza com router.refresh numa transicao (D28)");
  assert.match(menu, /startTransition\(\(\) => router\.refresh\(\)\)/);
});

test("foco depois de excluir: a linha seguinte, senao a anterior; lista vazia = o Novo modelo do estado vazio", () => {
  assert.equal(vm.focusAfterDelete([ID_A, ID_B, ID_C], ID_A), ID_B);
  assert.equal(vm.focusAfterDelete([ID_A, ID_B, ID_C], ID_B), ID_C);
  assert.equal(vm.focusAfterDelete([ID_A, ID_B, ID_C], ID_C), ID_B);
  assert.equal(vm.focusAfterDelete([ID_A], ID_A), null);
  assert.equal(vm.focusAfterDelete([ID_A, ID_B], "outro"), ID_A);
});

/* ------------------------------------------------------------------------------------------------
 * Tabela
 * ---------------------------------------------------------------------------------------------- */

function item(overrides = {}) {
  return {
    createdBy: { id: "u1", name: "Ana Souza" },
    designMode: null,
    id: ID_A,
    kind: "inbox",
    name: "Lançamento",
    readable: true,
    summary: "Leva conteúdo e segmento",
    thumb: { icon: null, kind: "inbox" },
    typeLabel: "Notificação",
    updatedAt: "2026-10-23T17:30:00.000Z",
    ...overrides
  };
}

test("tabela: miniatura, nome, resumo, 'Não abre', 'Atualizado' no cartao, quem criou e o menu de cada linha", () => {
  const custom = designModel.popupStarterDesign("media_top_fade", { video: VIDEO });
  const markup = html(
    createElement(TemplatesTable, {
      empty: vm.emptyCopy("all", ""),
      fonts: [],
      items: [
        item(),
        item({ createdBy: null, designMode: "custom", id: ID_B, kind: "design", name: "Design de verão", thumb: { design: custom, kind: "custom" }, typeLabel: "Design Personalizado" }),
        item({ id: ID_C, name: "Antigo", readable: false, summary: "Não abre", thumb: null, typeLabel: "Pop-up" })
      ]
    })
  );
  const text = textOf(markup);

  assert.match(markup, new RegExp(`href="/admin/comunicacao/modelos/${ID_A}"`), "a linha abre o modelo");
  assert.match(markup, /min-h-16/, "linhas de 64 px");
  assert.match(markup, /data-template-thumb="inbox"/);
  assert.match(markup, /data-template-thumb="custom"/);
  assert.match(markup, /data-template-thumb="none"/, "o modelo que nao abre fica com o retangulo vazio");
  assert.match(markup, /data-label="Atualizado"/, "a data aparece no cartao do celular, com o rotulo");
  assert.match(text, /23\/10\/2026 às 14:30/);
  assert.match(text, /Ana Souza/);
  assert.match(text, /Alguém que saiu da equipe/);
  assert.match(text, /Leva conteúdo e segmento/);
  assert.match(text, /Antigo Não abre/, "o chip ao lado do nome");
  assert.match(markup, /aria-label="Ações de Lançamento"/);

  // O menu de cada linha (o DropdownMenu do teste desenha os itens): o que nao abre so tem Renomear e Excluir.
  const rows = markup.split("<tr").slice(2);
  assert.equal(rows.length, 3);
  const menuOf = (row) => [...row.matchAll(/role="menuitem"[^>]*>(?:<span[^>]*>.*?<\/span>)?([^<]+)</g)].map((match) => match[1]);
  assert.deepEqual(menuOf(rows[0]), ["Usar", "Editar", "Renomear", "Duplicar", "Excluir"]);
  assert.deepEqual(menuOf(rows[2]), ["Renomear", "Excluir"]);
  assert.match(rows[0], new RegExp(`data-template-menu="${ID_A}"`), "o dialogo de nome devolve o foco ao … desta linha");

  // Sem nenhum modelo: o estado vazio no lugar da tabela.
  const empty = html(createElement(TemplatesTable, { empty: vm.emptyCopy("all", ""), fonts: [], items: [] }));
  assert.doesNotMatch(empty, /<table/);
  assert.match(textOf(empty), /Nenhum modelo ainda/);
  assert.match(empty, /href="\/admin\/comunicacao\/modelos\/novo"/);
  assert.match(empty, /href="\/admin\/comunicacao\/avisos"/);
});

/* ------------------------------------------------------------------------------------------------
 * "Novo aviso" com modelos
 * ---------------------------------------------------------------------------------------------- */

const recentItems = Array.from({ length: 7 }, (_, index) => ({
  id: `${index}b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b`,
  kind: index % 2 ? "popup" : "inbox",
  name: `Modelo ${index + 1}`,
  typeLabel: index % 2 ? "Pop-up" : "Notificação"
}));

test("Novo aviso: sem modelos, o link de sempre; com modelos, o menu com Começar em branco, 5 itens e Ver todos", () => {
  const link = html(createElement(NewNoticeButton, { recent: { items: [], total: 0 } }));
  assert.match(link, /^<a [^>]*href="\/admin\/comunicacao\/avisos\/novo"/, "o link de hoje (NEW_NOTICE_HREF)");
  assert.doesNotMatch(link, /aria-haspopup/);
  assert.equal(textOf(link), "Novo aviso");
  assert.equal(vm.newNoticeMenu({ items: [], total: 0 }), null);

  const menu = html(createElement(NewNoticeButton, { recent: { items: recentItems, total: 12 } }));
  assert.match(menu, /<button aria-haspopup="menu"/, "o gatilho do menu");
  const items = [...menu.matchAll(/<a data-navigation-feedback="false" href="([^"]+)" data-menu-item="" role="menuitem">(.*?)<\/a>/g)].map((match) => [match[1], textOf(match[2])]);

  assert.deepEqual(items, [
    ["/admin/comunicacao/avisos/novo", "Começar em branco"],
    ...recentItems.slice(0, 5).map((entry) => [`/admin/comunicacao/avisos/novo?modelo=${entry.id}`, `${entry.name} ${entry.typeLabel}`]),
    ["/admin/comunicacao/modelos", "Ver todos os modelos (12)"]
  ]);
  assert.match(textOf(menu), /^Novo aviso Começar em branco Meus modelos Modelo 1/, "o rotulo Meus modelos antes dos itens");
  assert.equal((menu.match(/data-menu-separator/g) ?? []).length, 2);

  // O botao do cabecalho da lista de avisos: so para quem cria avisos.
  const list = stripComments(read("src/components/admin/v2/communication/notices-list-view.tsx"));
  assert.match(list, /canWrite \? \(\s*<NewNoticeButton recent=\{recent\} \/>/);
  assert.match(list, /action=\{canWrite \? \{ href: newNoticeHref\(kind\), label: "Novo aviso" \} : undefined\}/, "o estado vazio dos avisos nao muda");
  const page = stripComments(read("src/app/admin/(v2)/comunicacao/avisos/page.tsx"));
  assert.match(page, /listRecentTemplates\(TEMPLATE_LIMITS\.recentForNewNotice\)/);
  assert.match(page, /return NO_RECENT_TEMPLATES;/, "migracao pendente ou falha: o botao continua o link");
});

/* ------------------------------------------------------------------------------------------------
 * "Salvar como modelo"
 * ---------------------------------------------------------------------------------------------- */

function draftOf(overrides = {}) {
  return {
    allowSnooze: true,
    audience: { kind: "everyone" },
    audio: null,
    body: "Texto",
    cta: null,
    icon: null,
    image: null,
    kind: "inbox",
    poll: null,
    repeat: "once",
    response: null,
    schedule: { mode: "now" },
    sender: null,
    title: "Turma nova",
    validity: { mode: "default" },
    window: { endsAt: null, startsAt: null },
    ...overrides
  };
}

const followUpContent = (validity = { mode: "default" }) => ({
  allowHide: true,
  audio: null,
  body: "Passou para ver?",
  cta: null,
  icon: null,
  image: null,
  poll: null,
  reactions: false,
  response: null,
  sender: null,
  title: "Seguinte",
  validity
});

const FOLLOW_UPS = {
  entryId: ID_A,
  goal: null,
  items: [
    { children: [{ children: [], content: followUpContent(), id: ID_C, when: { anchor: "sent", minutes: 1440 }, who: { kind: "everyone" } }], content: followUpContent(), id: ID_B, when: { anchor: "sent", minutes: 60 }, who: { kind: "everyone" } }
  ]
};

const editorSource = (overrides = {}) => ({
  draft: draftOf(),
  followUps: null,
  followUpsBuilderOnly: false,
  followUpsOtherGoal: false,
  kind: "editor",
  sourceNoticeId: null,
  sourceTemplateIds: [],
  ...overrides
});

const dialog = (source) => html(createElement(SaveAsTemplateDialog, { onOpenChange: () => {}, open: true, source }));
const switches = (markup) => [...markup.matchAll(/role="switch"[^>]*>.*?<span class="text-sm leading-6 font-medium[^"]*"[^>]*>([^<]+)<\/span>/g)].map((match) => textOf(match[1]));
const switchDescription = (markup, label) => {
  const index = markup.indexOf(`>${label}<`);
  const match = /id="[^"]+-description">([^<]+)</.exec(markup.slice(index));

  return match ? textOf(match[1]) : null;
};

test("Salvar como modelo: titulo, descricao por tipo, nome sugerido com contador e os botoes", () => {
  const inbox = dialog(editorSource());
  const text = textOf(inbox);

  assert.match(text, /^Salvar como modelo Um modelo de notificação guarda a configuração para começar outro aviso pronto\. Data e hora de envio não vão\./);
  assert.match(inbox, /id="modelo-nome"[^>]*value="Turma nova"|value="Turma nova"[^>]*id="modelo-nome"/, "o nome vem do titulo");
  assert.match(text, /10\/80/, "o contador");
  assert.match(text, /Cancelar Salvar modelo$/);

  const popup = dialog(editorSource({ draft: draftOf({ kind: "popup", title: "  " }) }));
  assert.match(textOf(popup), /Um modelo de pop-up guarda onde, quando, quantas vezes e o design\. Data de início e fim não vão\./);
  assert.match(popup, /value="Modelo de pop-up"/, "titulo vazio: o nome do tipo");
  assert.match(dialog(editorSource({ draft: draftOf({ title: "" }) })), /value="Modelo de notificação"/);
  assert.match(dialog({ followUpCount: 0, kind: "notice", noticeId: ID_A, noticeKind: "inbox", title: "x".repeat(120) }), new RegExp(`value="${"x".repeat(80)}"`), "cortado em 80");
});

test("Salvar como modelo: a chave das seguintes so na notificacao com seguintes; desabilitada quando so abrem no construtor", () => {
  assert.deepEqual(switches(dialog(editorSource())), ["Levar o conteúdo", "Levar o segmento"]);
  assert.deepEqual(switches(dialog(editorSource({ draft: draftOf({ kind: "popup" }), followUps: FOLLOW_UPS }))), ["Levar o conteúdo", "Levar o segmento"], "pop-up nunca tem seguintes");

  const withFollowUps = dialog(editorSource({ followUps: FOLLOW_UPS }));
  assert.deepEqual(switches(withFollowUps), ["Levar o conteúdo", "Levar o segmento", "Levar as notificações seguintes (2)"], "conta todos os niveis");
  assert.equal(switchDescription(withFollowUps, "Levar as notificações seguintes (2)"), "Com quando saem e para quem vai cada uma.");
  assert.equal((withFollowUps.match(/aria-checked="true"/g) ?? []).length, 3, "as tres chaves comecam ligadas");

  const builderOnly = dialog(editorSource({ followUps: FOLLOW_UPS, followUpsBuilderOnly: true }));
  const followSwitch = /<button aria-checked="(true|false)"[^>]*?(disabled="")?[^>]*role="switch"[^>]*>(?:(?!<button).)*?Levar as notificações seguintes/.exec(builderOnly);
  assert.ok(followSwitch, "a chave existe");
  assert.equal(followSwitch[1], "false", "desligada");
  assert.ok(followSwitch[0].includes('disabled=""'), "desabilitada");
  assert.equal(switchDescription(builderOnly, "Levar as notificações seguintes (2)"), templateModel.TEMPLATE_MESSAGES.noteBuilderOnly);

  // Do menu ⋯: so com seguintes na notificacao.
  assert.deepEqual(switches(dialog({ followUpCount: 3, kind: "notice", noticeId: ID_A, noticeKind: "inbox", title: "A" })).at(-1), "Levar as notificações seguintes (3)");
  assert.equal(switches(dialog({ followUpCount: 0, kind: "notice", noticeId: ID_A, noticeKind: "inbox", title: "A" })).length, 2);
});

test("Salvar como modelo: a descricao de 'Levar o conteúdo' nos quatro casos", () => {
  const custom = designModel.popupStarterDesign("media_top_fade", { video: VIDEO });
  const content = (source) => switchDescription(dialog(source), "Levar o conteúdo");

  assert.equal(content(editorSource()), "Título, texto, imagem, áudio, botão e interação.");
  assert.equal(content(editorSource({ draft: draftOf({ design: null, freeDesign: null, kind: "popup" }) })), "Título, texto, imagem, áudio e botão.");
  assert.equal(
    content(editorSource({ draft: draftOf({ design: custom, kind: "popup" }) })),
    "Título, texto, imagem, áudio e botão. Os textos que ficam dentro do design vão sempre com o design."
  );
  assert.equal(
    content({ followUpCount: 0, kind: "notice", noticeId: ID_A, noticeKind: "popup", title: "Pop-up" }),
    "Título, texto, imagem, áudio e botão. Se o pop-up tiver design, os textos de dentro dele vão sempre com o design."
  );
  assert.equal(content({ followUpCount: 0, kind: "notice", noticeId: ID_A, noticeKind: "inbox", title: "Notificação" }), "Título, texto, imagem, áudio, botão e interação.");
  assert.equal(switchDescription(dialog(editorSource()), "Levar o segmento"), "Quem recebe: o que está em “Para quem”.");
});

test("Salvar como modelo: as notas do que nao vai para o modelo so aparecem do editor", () => {
  const until = draftOf({
    poll: { closesAt: "2026-11-01T12:00:00.000Z", multiple: false, options: [{ id: "a1", label: "Sim" }, { id: "b2", label: "Não" }], question: "Vem?", showResults: true },
    validity: { endsAt: "2026-11-02T12:00:00.000Z", mode: "until" }
  });
  const followUps = { ...FOLLOW_UPS, items: [{ ...FOLLOW_UPS.items[0], content: followUpContent({ endsAt: "2026-11-03T12:00:00.000Z", mode: "until" }) }] };
  const fromEditor = dialog(editorSource({ draft: until, followUps, followUpsOtherGoal: true }));
  const notes = [...fromEditor.matchAll(/<li class="flex items-start gap-2[^"]*">.*?<span class="min-w-0">([^<]+)<\/span><\/li>/g)].map((match) => textOf(match[1]));

  assert.deepEqual(notes, [
    templateModel.TEMPLATE_MESSAGES.noteUntil,
    templateModel.TEMPLATE_MESSAGES.notePollEnd,
    templateModel.TEMPLATE_MESSAGES.noteFollowUpUntil,
    templateModel.TEMPLATE_MESSAGES.noteOtherGoal
  ]);
  assert.match(fromEditor, /data-save-as-notes=""/);

  assert.doesNotMatch(dialog(editorSource()), /data-save-as-notes/, "sem nada de fora, sem lista");
  assert.doesNotMatch(dialog({ followUpCount: 2, kind: "notice", noticeId: ID_A, noticeKind: "inbox", title: "A" }), /data-save-as-notes/, "do menu, as notas vem no toast");
  assert.equal(
    vm.savedTemplateToast([templateModel.TEMPLATE_MESSAGES.noteBuilderOnly]),
    `Modelo salvo em Comunicação › Modelos. ${templateModel.TEMPLATE_MESSAGES.noteBuilderOnly}`
  );
  assert.equal(vm.savedTemplateToast([]), "Modelo salvo em Comunicação › Modelos.");
});

test("Salvar como modelo: erro do nome no campo; os outros no banner com o rotulo do campo", () => {
  assert.deepEqual(vm.saveAsTemplateErrors({ name: "Dê um nome ao modelo." }), { banner: null, name: "Dê um nome ao modelo." });
  assert.deepEqual(vm.saveAsTemplateErrors({ title: "Use até 120 caracteres." }), {
    banner: "Corrija no aviso antes de salvar como modelo: Título: Use até 120 caracteres.",
    name: null
  });
  assert.equal(vm.saveAsTemplateErrors({ "followUps.0.content.title": "Escreva um título." }).banner, "Corrija no aviso antes de salvar como modelo: Notificações seguintes: Escreva um título.");
  assert.equal(vm.saveAsTemplateErrors({ "design.blocks.2.lines.0.text": "Texto longo." }).banner, "Corrija no aviso antes de salvar como modelo: Design: Texto longo.");
  assert.equal(vm.saveAsTemplateErrors({ "popup.pages": "Escolha pelo menos uma página." }).banner, "Corrija no aviso antes de salvar como modelo: Quando e onde aparece: Escolha pelo menos uma página.");
  assert.deepEqual(Object.keys(vm.TEMPLATE_FIELD_LABELS).sort(), ["audience", "audio", "body", "cta", "design", "followUps", "freeDesign", "image", "poll", "popup", "response", "sender", "title", "validity"]);

  // As chamadas do dialogo: do editor, saveTemplate com o rascunho da tela; do menu, saveTemplateFromNotice.
  const source = stripComments(read("src/components/admin/v2/communication/templates/save-as-template-dialog.tsx"));
  assert.match(source, /body: \{ draft: source\.draft, followUps: include\.followUps \? source\.followUps : null, include, source: "notice" \}/);
  assert.match(source, /origin: "notice_editor"/);
  assert.match(source, /saveTemplateFromNotice\(\{ include, name: checked\.data, noticeId: source\.noticeId \}\)/);
  assert.doesNotMatch(source, /router\.refresh|revalidatePath/, "nada na tela de onde o dialogo abriu e atualizado (D28)");
});

test("dialogo do nome: titulo, campo Nome do modelo com o contador, botoes", () => {
  const markup = html(
    createElement(TemplateNameDialog, {
      confirmLabel: "Salvar nome",
      defaultName: "Lançamento",
      onOpenChange: () => {},
      onSubmit: async () => ({ ok: true }),
      open: true,
      title: "Renomear modelo"
    })
  );

  assert.equal(textOf(markup), "Renomear modelo Nome do modelo 10/80 Cancelar Salvar nome");
  assert.match(markup, /value="Lançamento"/);
  assert.match(markup, /maxLength="80"/);
  assert.equal(html(createElement(TemplateNameDialog, { confirmLabel: "x", defaultName: "y", onOpenChange: () => {}, onSubmit: async () => ({ ok: true }), open: false, title: "t" })), "");
});

/* ------------------------------------------------------------------------------------------------
 * Miniaturas e o cartao com `still`
 * ---------------------------------------------------------------------------------------------- */

test("miniatura do Personalizado nos dois tamanhos (36×48 e 60×84), so barras e cores (nada baixado)", () => {
  const design = designModel.popupStarterDesign("media_top_fade", { video: VIDEO });
  const list = html(createElement(thumbs.CustomDesignThumb, { design, size: "list" }));
  const picker = html(createElement(thumbs.CustomDesignThumb, { design, size: "picker" }));

  assert.match(list, /aria-hidden="true"/);
  assert.match(list, /height:48px;width:36px/);
  assert.match(picker, /height:84px;width:60px/);
  for (const markup of [list, picker]) {
    assert.doesNotMatch(markup, /<video|<img|url\(/, "nada do arquivo do produtor e baixado");
  }

  const withImage = { ...design, card: { ...design.card, background: { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: POSTER.url } } };
  assert.doesNotMatch(html(createElement(thumbs.CustomDesignThumb, { design: withImage, size: "list" })), /url\(/, "fundo com imagem vira a cor de apoio");
});

function freeDesignWithVideo() {
  const design = freeSchema.parsePopupFreeDesign({
    artboard: { fill: [{ color: "#111216", kind: "solid" }], gap: 0, padding: [168, 24, 20, 24] },
    assets: [
      { height: 248, id: "capa", kind: "image", path: FREE_POSTER_PATH, width: 440 },
      { id: "vid", kind: "video", mimeType: "video/webm", path: VIDEO_PATH, poster: "capa" }
    ],
    children: [
      { asset: "vid", id: "midia", name: "Vídeo do topo", place: { h: 248, mode: "free", w: 440, x: 0, y: 0 }, type: "video" },
      { id: "titulo", lines: [[{ text: "Aula nova" }]], place: { mode: "flow" }, type: "heading" },
      { id: "links", place: { margin: [12, 0, 0, 0], mode: "flow" }, type: "links" }
    ],
    mode: "free",
    version: 1
  });

  assert.ok(design, "design Livre valido");

  return design;
}

test("cartao do aluno com `still` (so previa): nunca monta <video>, mostra a capa; sem `still`, o desenho de hoje", async () => {
  const free = freeDesignWithVideo();
  const freePopup = { audio: null, body: "", canSnooze: true, cta: null, fonts: [], freeDesign: free, id: "p", image: null, title: "Aula nova" };

  // O cartao Livre vem num pedaco proprio (React.lazy): o primeiro desenho pede o pedaco; depois dele, o cartao.
  assert.equal(html(createElement(MemberPopupCard, { playing: false, popup: freePopup, preview: true, still: true })), "");
  await loadPopupFreeCard();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const stillFree = html(createElement(MemberPopupCard, { playing: false, popup: freePopup, preview: true, still: true }));

  assert.match(stillFree, /data-popup-free=""/);
  assert.doesNotMatch(stillFree, /<video|<source/, "Livre parado: nada do video");
  assert.match(stillFree, new RegExp(`<img [^>]*src="${ORIGIN}/storage/v1/object/public/content-assets/${FREE_POSTER_PATH.replace(/[.]/g, "\\.")}"`), "o poster entra como imagem");

  const noStillFree = html(createElement(MemberPopupCard, { playing: false, popup: freePopup, preview: true }));
  assert.doesNotMatch(noStillFree, /content-assets\/communications\/free/, "sem `still`, no servidor nada e baixado (o de sempre)");
  assert.equal(
    html(createElement(MemberPopupCard, { playing: false, popup: freePopup, still: true })),
    html(createElement(MemberPopupCard, { playing: false, popup: freePopup })),
    "sem previa, `still` e ignorado (o aluno nunca passa)"
  );

  const custom = designModel.popupStarterDesign("media_top_fade", { video: VIDEO });
  const customPopup = { audio: null, body: "", canSnooze: true, cta: { href: "/minhas-compras", label: "Saiba mais", target: "same_tab" }, design: custom, fonts: [], id: "p", image: POSTER, title: "Aula nova" };
  const stillCustom = html(createElement(MemberPopupCard, { playing: false, popup: customPopup, preview: true, still: true }));

  assert.doesNotMatch(stillCustom, /<video|<source/, "Personalizado parado: nada do video");
  assert.match(stillCustom, new RegExp(`<img [^>]*src="${POSTER.url.replace(/[.]/g, "\\.")}"`), "a capa como imagem");

  const today = html(createElement(PopupDesignCard, { design: custom, fonts: [], playing: false, popup: customPopup, preview: true }));
  assert.equal(html(createElement(MemberPopupCard, { playing: false, popup: customPopup, preview: true })), today, "sem `still`, o mesmo cartao de hoje");
  assert.doesNotMatch(today, /<img/, "no servidor, sem `still`, a caixa do video fica vazia (o de sempre)");

  // O hook do movimento continua sendo chamado sempre (regra dos hooks); `still` so troca o resultado.
  for (const path of ["src/components/member/notifications/popup-free/popup-free-card.tsx", "src/components/member/notifications/popup-design/popup-design-card.tsx"]) {
    const code = stripComments(read(path));
    assert.match(code, /const preferredMotion = usePopupMotion\(\);\n\s*const motion = still \? "still" : preferredMotion;/, path);
  }
  assert.match(stripComments(read("src/components/member/notifications/member-popup.tsx")), /props\.preview === true && still === true/, "`still` so na previa");
});

test("miniatura do Livre: antes de aparecer na tela, so o retangulo; com `label`, role=img (card Design)", () => {
  const free = freeDesignWithVideo();
  const list = html(createElement(thumbs.FreeDesignThumb, { design: free, size: "list" }));
  const picker = html(createElement(thumbs.FreeDesignThumb, { design: free, label: "Modelo: Aula nova", size: "picker" }));

  assert.match(list, /aria-hidden="true"/);
  assert.match(list, /bg-\[var\(--surface-2\)\]/);
  assert.match(list, /height:48px;width:36px/);
  assert.doesNotMatch(list, /data-popup-free|<img|<video/, "nada montado antes do IntersectionObserver");
  assert.match(picker, /height:160px;width:120px/);
  assert.match(picker, /aria-label="Modelo: Aula nova"/);
  assert.match(picker, /role="img"/);

  const code = stripComments(read("src/components/admin/v2/communication/templates/template-thumbs.tsx"));
  assert.match(code, /<MemberPopupCard playing=\{false\} popup=\{popup\} preview still \/>/);
  assert.match(code, /new IntersectionObserver\(/);
});

test("miniaturas da notificacao e do pop-up Padrão: o icone, decorativas", () => {
  const inbox = html(createElement(thumbs.InboxTemplateThumb, { icon: null, size: "list" }));
  const popup = html(createElement(thumbs.DefaultPopupThumb, { size: "list" }));

  assert.match(inbox, /aria-hidden="true"/);
  assert.match(inbox, /<svg/);
  assert.match(popup, /aria-hidden="true"/);
  assert.match(popup, /<svg/);
});

/* ------------------------------------------------------------------------------------------------
 * Menu do aviso
 * ---------------------------------------------------------------------------------------------- */

test("menu do aviso: 'Salvar como modelo' entra logo depois de Duplicar e a lista do servidor nao muda", () => {
  const actions = ["view_report", "edit", "send_test", "duplicate", "cancel_schedule", "delete"];
  const before = noticesVm.noticeMenuEntries(actions);
  const merged = vm.noticeMenuWithExtra(before, [{ label: "Salvar como modelo" }]);

  assert.deepEqual(noticesVm.noticeMenuEntries(actions), before, "noticeMenuEntries continua igual");
  assert.deepEqual(
    merged.map((entry) => (entry.kind === "extra" ? entry.extra.label : entry.entry.label)),
    ["Ver relatório", "Editar", "Enviar teste para mim", "Duplicar", "Salvar como modelo", "Cancelar agendamento", "Excluir"]
  );
  assert.deepEqual(vm.noticeMenuWithExtra(before), before.map((entry) => ({ entry, kind: "notice" })), "sem extra, as mesmas entradas");

  // Sem Duplicar: antes da primeira com a linha separadora; sem nenhuma, no fim.
  const noDuplicate = vm.noticeMenuWithExtra(noticesVm.noticeMenuEntries(["view_report", "pause", "end", "delete"]), [{ label: "X" }]);
  assert.deepEqual(noDuplicate.map((entry) => (entry.kind === "extra" ? "X" : entry.entry.action)), ["view_report", "pause", "X", "end", "delete"]);
  const tail = vm.noticeMenuWithExtra(noticesVm.noticeMenuEntries(["view_report", "edit"]), [{ label: "X" }]);
  assert.deepEqual(tail.map((entry) => (entry.kind === "extra" ? "X" : entry.entry.action)), ["view_report", "edit", "X"]);

  const rowMenu = stripComments(read("src/components/admin/v2/communication/notice-row-menu.tsx"));
  assert.match(rowMenu, /noticeMenuWithExtra\(entries, extra\)/);
  for (const path of ["src/components/admin/v2/communication/notices-table.tsx", "src/components/admin/v2/communication/notice-report.tsx"]) {
    const code = stripComments(read(path));
    assert.match(code, /useNoticeSaveAsTemplate\(\)/, path);
    assert.match(code, /extra=\{saveAs\.extraFor\(/, path);
    assert.match(code, /data-notice-menu=\{/, path);
    assert.match(code, /\{saveAs\.dialog\}/, path);
  }
  const hook = stripComments(read("src/components/admin/v2/communication/templates/save-as-template-dialog.tsx"));
  assert.match(hook, /if \(!notice\.actions\.includes\("duplicate"\)\) \{\s*return \[\];/, "so quando o aviso pode ser duplicado (passo de fluxo nunca)");
  assert.match(hook, /kind: "notice", noticeId: notice\.id/);
});

/* ------------------------------------------------------------------------------------------------
 * Textos e pagina
 * ---------------------------------------------------------------------------------------------- */

function textsOf(value) {
  if (typeof value === "string") {
    return [value];
  }

  if (typeof value === "function") {
    return [String(value("{x}"))];
  }

  return value && typeof value === "object" ? Object.values(value).flatMap(textsOf) : [];
}

test("vocabulario: nenhum texto da aba, dos dialogos e do Novo aviso diz template, público, audiência, layout ou lembrete", () => {
  const texts = [
    ...textsOf(vm.TEMPLATE_COPY),
    ...textsOf(vm.TEMPLATE_FIELD_LABELS),
    ...vm.TEMPLATE_FILTERS.map((option) => option.label),
    vm.followUpsSwitchLabel(2),
    vm.seeAllTemplatesLabel(9),
    vm.nameCounter("abc"),
    vm.templatesCountLine(180),
    vm.deleteTemplateDescription("X"),
    ...vm.TEMPLATE_MENU_ENTRIES(true).map((entry) => entry.label)
  ];

  assert.ok(texts.length > 60, `textos conferidos: ${texts.length}`);
  for (const text of texts) {
    assert.doesNotMatch(text, FORBIDDEN, text);
  }
});

test("pagina: so quem cria avisos, migracao pendente com a 202610250001, sem numeros nem Periodo, esqueleto na forma final", () => {
  const page = stripComments(read("src/app/admin/(v2)/comunicacao/modelos/page.tsx"));
  const loading = stripComments(read("src/app/admin/(v2)/comunicacao/modelos/loading.tsx"));
  const view = stripComments(read("src/components/admin/v2/communication/templates/templates-list-view.tsx"));
  const skeleton = stripComments(read("src/components/admin/v2/communication/templates/templates-skeletons.tsx"));

  assert.match(page, /title: "Modelos · Comunicação"/);
  assert.match(page, /requirePageArea\("comunicacao"\)/);
  assert.match(page, /if \(!can\(access, "messaging\.write"\)\) \{\s*redirect\(COMMUNICATION_HOME_HREF\);/);
  assert.match(page, /loadUnlessPendingMigration\(/);
  assert.match(page, /<PendingMigrationNotice migration="202610250001" \/>/);
  assert.match(page, /templatesPageFallbackHref\(/);
  assert.doesNotMatch(page, /readAdminPeriod/, "sem Periodo (D22)");
  assert.match(loading, /<TemplatesListSkeleton \/>/);

  assert.doesNotMatch(view, /KpiTile|getCommunicationKpis/, "sem numeros no topo (D22)");
  assert.match(view, /<CommunicationTabs \/>/);
  assert.match(view, /COMMUNICATION_TAB_META\.modelos/);
  assert.match(view, /<AdminLinkButton href=\{NEW_TEMPLATE_HREF\}>/);
  assert.match(view, /<CommunityPagination\s+itemLabel=\{TEMPLATE_COPY\.list\.itemLabel\}/);

  assert.match(skeleton, /<PageHeaderSkeleton \/>/);
  assert.match(skeleton, /md:w-\[320px\]/, "o campo de 320 px");
  assert.equal((skeleton.match(/\{ id: "[a-z]+", width: "w-\d+" \}/g) ?? []).length, 5, "as 5 pilulas");
  assert.match(skeleton, /const ROW_KEYS = \["a", "b", "c", "d", "e", "f"\]/, "6 linhas");
  assert.match(skeleton, /h-16/, "de 64 px");
  assert.match(skeleton, /h-12 w-9/, "miniatura de 36×48");

  const filters = stripComments(read("src/components/admin/v2/communication/templates/template-filters.tsx"));
  assert.match(filters, /window\.setTimeout\(\(\) => \{[\s\S]*?\}, 300\)/, "espera de 300 ms");
  assert.match(filters, /aria-label=\{TEMPLATE_COPY\.list\.typeFilterLabel\}/);
  assert.equal(vm.TEMPLATE_COPY.list.typeFilterLabel, "Tipo do modelo");
  assert.equal(vm.TEMPLATE_COPY.list.searchLabel, "Buscar modelo pelo nome");
  assert.equal(vm.TEMPLATE_COPY.list.searchPlaceholder, "Buscar pelo nome");
});
