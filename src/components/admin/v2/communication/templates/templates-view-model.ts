// Comunicacao > Modelos no admin (docs/28; spec §5.1 a §5.4): enderecos e filtros da lista (?tipo=, ?busca=,
// ?pagina=), o menu "…" de cada modelo, os textos da aba, dos dialogos "Salvar como modelo" e de nome e do
// "Novo aviso" com modelos, os estados vazios e o banner de erro. Modulo puro (sem React, imports relativos):
// tests/comunicacao-modelos-tela.test.mjs carrega direto pelo Node e as telas usam as mesmas regras.
//
// O ?tipo= e lido pelo parser unico de template-model.ts (parseTemplateTypeParam): valor desconhecido = "Todos".

import { formatSaoPauloDateTime, type CampaignKind } from "../../../../../server/communications/campaign-model";
import {
  TEMPLATE_LIMITS,
  TEMPLATE_MESSAGES,
  TEMPLATE_TYPE_PARAMS,
  TEMPLATES_HREF,
  parseTemplateTypeParam,
  type TemplateFollowUps
} from "../../../../../server/communications/template-model";
import type { RecentTemplate, TemplateFilter, TemplatePerson } from "../../../../../server/communications/template-queries";
import type { NoticeDraft } from "../../../../../server/communications/schemas";
import type { NoticeMenuEntry } from "../notices-view-model";
import { NEW_NOTICE_HREF, NOTICES_HREF } from "../notices-view-model";

/* ------------------------------------------------------------------------------------------------
 * Enderecos e filtros
 * ---------------------------------------------------------------------------------------------- */

export const NEW_TEMPLATE_HREF = `${TEMPLATES_HREF}/novo`;
export const TEMPLATE_TYPE_PARAM = "tipo";
export const TEMPLATE_SEARCH_PARAM = "busca";
export const TEMPLATE_PAGE_PARAM = "pagina";
/** O ?modelo= de /avisos/novo (o editor abre preenchido pelo modelo, D5). */
export const TEMPLATE_START_PARAM = "modelo";
/** O mesmo teto do campo de busca (o nome do modelo tem ate 80 caracteres). */
export const TEMPLATE_SEARCH_MAX = TEMPLATE_LIMITS.name;
/** A contagem "{n} de 200 modelos" aparece a partir daqui. */
export const TEMPLATES_COUNT_FROM = 150;

type ParamValue = string | string[] | undefined | null;

function firstParam(value: ParamValue) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** ?tipo= da lista: o parser de template-model.ts; desconhecido ou ausente = "Todos". */
export function parseTemplateFilterParam(value: ParamValue): TemplateFilter {
  return parseTemplateTypeParam(Array.isArray(value) ? value[0] : value) ?? "all";
}

/** ?busca= da lista: aparada e cortada em 80. */
export function parseTemplateSearchParam(value: ParamValue): string {
  return Array.from(firstParam(value)).slice(0, TEMPLATE_SEARCH_MAX).join("").trim();
}

/** ?pagina= da lista; invalido volta para 1. */
export function parseTemplatesPage(value: ParamValue): number {
  const page = Number(firstParam(value));

  return Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1;
}

/** Endereco da lista: ?busca= e ?tipo= (Todos e busca vazia somem) e ?pagina= so depois da primeira. */
export function templatesHref(input: { filter?: TemplateFilter; page?: number; search?: string } = {}): string {
  const params = new URLSearchParams();
  const search = input.search?.trim() ?? "";

  if (search) {
    params.set(TEMPLATE_SEARCH_PARAM, search);
  }

  if (input.filter && input.filter !== "all") {
    params.set(TEMPLATE_TYPE_PARAM, TEMPLATE_TYPE_PARAMS[input.filter]);
  }

  if (input.page && input.page > 1) {
    params.set(TEMPLATE_PAGE_PARAM, String(input.page));
  }

  const query = params.toString();

  return query ? `${TEMPLATES_HREF}?${query}` : TEMPLATES_HREF;
}

/** O que esta no endereco agora (os parametros desconhecidos ficam de fora). */
export function templatesStateOf(current: Record<string, ParamValue>) {
  return {
    filter: parseTemplateFilterParam(current[TEMPLATE_TYPE_PARAM]),
    page: parseTemplatesPage(current[TEMPLATE_PAGE_PARAM]),
    search: parseTemplateSearchParam(current[TEMPLATE_SEARCH_PARAM])
  };
}

/** Link de uma pilula: mantem a busca e volta para a pagina 1. */
export function templatesFilterHref(current: Record<string, ParamValue>, filter: TemplateFilter): string {
  return templatesHref({ filter, search: templatesStateOf(current).search });
}

/** Mudar a busca: mantem o tipo e volta para a pagina 1. */
export function templatesSearchHref(current: Record<string, ParamValue>, search: string): string {
  return templatesHref({ filter: templatesStateOf(current).filter, search });
}

/** ?pagina= depois da ultima pagina: a ultima com modelos (ou a primeira), com a busca e o tipo. */
export function templatesPageFallbackHref(input: { itemCount: number; page: number; pageSize: number; searchParams: Record<string, ParamValue>; total: number }) {
  if (input.page <= 1 || input.itemCount > 0) {
    return null;
  }

  const lastPage = Math.max(1, Math.ceil(Math.max(0, input.total) / Math.max(1, input.pageSize)));

  if (lastPage >= input.page) {
    return null;
  }

  const state = templatesStateOf(input.searchParams);

  return templatesHref({ filter: state.filter, page: lastPage, search: state.search });
}

/** "Usar" e os itens do "Novo aviso": o editor do aviso preenchido pelo modelo (nada e salvo ate o produtor salvar). */
export function noticeFromTemplateHref(id: string): string {
  return `${NEW_NOTICE_HREF}?${TEMPLATE_START_PARAM}=${encodeURIComponent(id)}`;
}

/** "Editar" e a linha da lista: o modelo no editor (modo modelo) ou a pagina do Design. */
export function templateEditHref(id: string): string {
  return `${TEMPLATES_HREF}/${encodeURIComponent(id)}`;
}

export const TEMPLATE_FILTERS: readonly { filter: TemplateFilter; label: string }[] = [
  { filter: "all", label: "Todos" },
  { filter: "inbox", label: "Notificação" },
  { filter: "popup", label: "Pop-up" },
  { filter: "design_custom", label: "Design Personalizado" },
  { filter: "design_free", label: "Design Livre" }
];

/* ------------------------------------------------------------------------------------------------
 * Textos (todos os da aba, dos dialogos e do "Novo aviso"; so aqui)
 * ---------------------------------------------------------------------------------------------- */

export const TEMPLATE_COPY = {
  list: {
    columns: { actions: "Ações", createdBy: "Criado por", template: "Modelo", type: "Tipo", updatedAt: "Atualizado em", updatedAtMobile: "Atualizado" },
    caption: "Modelos",
    creatorGone: "Alguém que saiu da equipe",
    itemLabel: "modelos",
    listHeading: "Modelos",
    newTemplate: "Novo modelo",
    searchLabel: "Buscar modelo pelo nome",
    searchPlaceholder: "Buscar pelo nome",
    typeFilterLabel: "Tipo do modelo",
    unreadable: "Não abre"
  },
  menu: {
    delete: "Excluir",
    duplicate: "Duplicar",
    edit: "Editar",
    rename: "Renomear",
    use: "Usar"
  },
  toasts: {
    deleted: "Modelo excluído.",
    duplicated: "Modelo duplicado.",
    renamed: "Nome salvo.",
    saved: "Modelo salvo em Comunicação › Modelos."
  },
  rename: {
    confirm: "Salvar nome",
    title: "Renomear modelo"
  },
  remove: {
    confirm: "Excluir modelo",
    title: "Excluir o modelo?"
  },
  nameDialog: {
    cancel: "Cancelar",
    label: "Nome do modelo",
    saving: "Salvando…"
  },
  errors: {
    changedTitle: TEMPLATE_MESSAGES.changedTitle,
    close: "Fechar",
    genericTitle: "Não foi possível concluir",
    reload: "Recarregar",
    saveTitle: "Não foi possível salvar o modelo"
  },
  empty: {
    none: {
      actionLabel: "Novo modelo",
      description:
        "Um modelo guarda a configuração de uma notificação, de um pop-up ou só de um design, para começar o próximo aviso pronto. Crie aqui ou use “Salvar como modelo” num aviso.",
      secondaryLabel: "Ver avisos",
      title: "Nenhum modelo ainda"
    },
    filtered: {
      description: "Tente outro nome ou outro tipo.",
      secondaryLabel: "Limpar filtros",
      title: "Nenhum modelo encontrado"
    }
  },
  saveAs: {
    audience: "Levar o segmento",
    audienceHint: "Quem recebe: o que está em “Para quem”.",
    cancel: "Cancelar",
    content: "Levar o conteúdo",
    contentHint: {
      inbox: "Título, texto, imagem, áudio, botão e interação.",
      popupDefault: "Título, texto, imagem, áudio e botão.",
      popupDesign: "Título, texto, imagem, áudio e botão. Os textos que ficam dentro do design vão sempre com o design.",
      popupMenu: "Título, texto, imagem, áudio e botão. Se o pop-up tiver design, os textos de dentro dele vão sempre com o design."
    },
    description: {
      inbox: "Um modelo de notificação guarda a configuração para começar outro aviso pronto. Data e hora de envio não vão.",
      popup: "Um modelo de pop-up guarda onde, quando, quantas vezes e o design. Data de início e fim não vão."
    },
    fieldErrorPrefix: "Corrija no aviso antes de salvar como modelo",
    followUpsHint: "Com quando saem e para quem vai cada uma.",
    save: "Salvar modelo",
    saving: "Salvando…",
    title: "Salvar como modelo",
    trigger: "Salvar como modelo"
  },
  newNotice: {
    blank: "Começar em branco",
    label: "Novo aviso",
    mine: "Meus modelos"
  }
} as const;

/**
 * O contador do nome ("12/80"): conta `.length`, como o maxLength do campo. O zod e o char_length do banco contam
 * caracteres (nunca mais que `.length`): tudo o que o campo aceita passa no servidor.
 */
export function nameCounter(name: string): string {
  return `${name.length}/${TEMPLATE_LIMITS.name}`;
}

export function templateMenuLabel(name: string): string {
  return `Ações de ${name}`;
}

export function deleteTemplateDescription(name: string): string {
  return `“${name}” sai da lista de modelos. Os avisos criados com ele não mudam.`;
}

export function followUpsSwitchLabel(count: number): string {
  return count > 0 ? `Levar as notificações seguintes (${count})` : "Levar as notificações seguintes";
}

export function seeAllTemplatesLabel(total: number): string {
  return `Ver todos os modelos (${total})`;
}

/** "{totalAll} de 200 modelos", so a partir de 150. */
export function templatesCountLine(totalAll: number): string | null {
  return totalAll >= TEMPLATES_COUNT_FROM ? `${totalAll} de ${TEMPLATE_LIMITS.maxTemplates} modelos` : null;
}

/** "23/10/2026 às 14:30". */
export function templateUpdatedLabel(updatedAt: string): string {
  return formatSaoPauloDateTime(updatedAt);
}

/** "Criado por": o nome, ou "Alguém que saiu da equipe" quando a pessoa nao esta mais. */
export function templateCreatorLabel(createdBy: TemplatePerson | null): string {
  return createdBy?.name.trim() || TEMPLATE_COPY.list.creatorGone;
}

/* ------------------------------------------------------------------------------------------------
 * Estados vazios
 * ---------------------------------------------------------------------------------------------- */

export type TemplatesEmptyCopy = {
  action?: { href: string; label: string };
  description: string;
  secondaryAction?: { href: string; label: string };
  title: string;
};

/** Sem nenhum modelo: "Nenhum modelo ainda"; com busca ou filtro e nada encontrado: "Nenhum modelo encontrado". */
export function emptyCopy(filter: TemplateFilter, search: string): TemplatesEmptyCopy {
  if (filter === "all" && !search.trim()) {
    const copy = TEMPLATE_COPY.empty.none;

    return {
      action: { href: NEW_TEMPLATE_HREF, label: copy.actionLabel },
      description: copy.description,
      secondaryAction: { href: NOTICES_HREF, label: copy.secondaryLabel },
      title: copy.title
    };
  }

  const copy = TEMPLATE_COPY.empty.filtered;

  return { description: copy.description, secondaryAction: { href: TEMPLATES_HREF, label: copy.secondaryLabel }, title: copy.title };
}

/* ------------------------------------------------------------------------------------------------
 * Menu "…" de um modelo
 * ---------------------------------------------------------------------------------------------- */

export type TemplateMenuAction = "delete" | "duplicate" | "edit" | "rename" | "use";
export type TemplateMenuEntry = { action: TemplateMenuAction; destructive: boolean; label: string; separated: boolean };

const READABLE_ACTIONS: readonly TemplateMenuAction[] = ["use", "edit", "rename", "duplicate", "delete"];
/** O modelo que nao abre: so Renomear e Excluir. */
const UNREADABLE_ACTIONS: readonly TemplateMenuAction[] = ["rename", "delete"];

/** As entradas do menu "…", na ordem da tela; Excluir por ultimo, destrutivo e com a linha antes. */
export function TEMPLATE_MENU_ENTRIES(readable: boolean): TemplateMenuEntry[] {
  return (readable ? READABLE_ACTIONS : UNREADABLE_ACTIONS).map((action) => ({
    action,
    destructive: action === "delete",
    label: TEMPLATE_COPY.menu[action],
    separated: action === "delete"
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Banner de erro da lista e foco depois de excluir
 * ---------------------------------------------------------------------------------------------- */

export type TemplateFailureCopy = { message: string; reload: boolean; title: string };

/** 409: "Este modelo mudou em outra tela" com "Recarregar"; 422: a frase do limite; o resto: "Não foi possível concluir". */
export function templateFailureCopy(failure: { message: string; status: number }): TemplateFailureCopy {
  if (failure.status === 409) {
    return { message: TEMPLATE_MESSAGES.changed, reload: true, title: TEMPLATE_COPY.errors.changedTitle };
  }

  return {
    message: failure.status === 422 ? TEMPLATE_MESSAGES.limit : failure.message,
    reload: false,
    title: TEMPLATE_COPY.errors.genericTitle
  };
}

/** Depois de excluir: o id da linha seguinte; sem ela, o da anterior; lista vazia: null (o "Novo modelo" do estado vazio). */
export function focusAfterDelete(ids: readonly string[], deletedId: string): string | null {
  const index = ids.indexOf(deletedId);
  const rest = ids.filter((id) => id !== deletedId);

  if (rest.length === 0) {
    return null;
  }

  if (index < 0) {
    return rest[0];
  }

  return ids[index + 1] ?? ids[index - 1] ?? rest[0];
}

/* ------------------------------------------------------------------------------------------------
 * Menu "…" do aviso: "Salvar como modelo" (extra) logo depois de Duplicar
 * ---------------------------------------------------------------------------------------------- */

export type NoticeMenuItem<Extra> = { entry: NoticeMenuEntry; kind: "notice" } | { extra: Extra; kind: "extra" };

/**
 * As entradas do aviso (noticeMenuEntries, que nao muda) com as extras logo depois de "Duplicar"; sem Duplicar,
 * antes da primeira entrada com a linha separadora (as que tiram do ar ou excluem); sem nenhuma, no fim.
 */
export function noticeMenuWithExtra<Extra>(entries: readonly NoticeMenuEntry[], extra: readonly Extra[] = []): NoticeMenuItem<Extra>[] {
  const items: NoticeMenuItem<Extra>[] = entries.map((entry) => ({ entry, kind: "notice" }));

  if (extra.length === 0) {
    return items;
  }

  const duplicate = entries.findIndex((entry) => entry.action === "duplicate");
  const separated = entries.findIndex((entry) => entry.separated);
  const at = duplicate >= 0 ? duplicate + 1 : separated >= 0 ? separated : entries.length;

  items.splice(at, 0, ...extra.map((value) => ({ extra: value, kind: "extra" as const })));

  return items;
}

/* ------------------------------------------------------------------------------------------------
 * Dialogo "Salvar como modelo" (spec §5.3)
 * ---------------------------------------------------------------------------------------------- */

/** O que o dialogo precisa saber do aviso (o editor manda o rascunho; o menu ⋯ manda so o resumo). */
export type SaveAsTemplateSourceShape =
  | {
      draft: Pick<NoticeDraft, "design" | "freeDesign" | "kind" | "poll" | "title" | "validity">;
      followUps: TemplateFollowUps | null;
      followUpsBuilderOnly: boolean;
      followUpsOtherGoal: boolean;
      kind: "editor";
    }
  | { followUpCount: number; kind: "notice"; noticeKind: CampaignKind; title: string };

export function saveAsTemplateKind(source: SaveAsTemplateSourceShape): CampaignKind {
  return source.kind === "editor" ? source.draft.kind : source.noticeKind;
}

export function saveAsTemplateDescription(kind: CampaignKind): string {
  return TEMPLATE_COPY.saveAs.description[kind];
}

/** A descricao de "Levar o conteúdo": notificacao, pop-up Padrão, pop-up com design (editor) ou pop-up pelo menu. */
export function saveAsTemplateContentHint(source: SaveAsTemplateSourceShape): string {
  const hints = TEMPLATE_COPY.saveAs.contentHint;

  if (saveAsTemplateKind(source) === "inbox") {
    return hints.inbox;
  }

  if (source.kind === "notice") {
    return hints.popupMenu;
  }

  return source.draft.design || source.draft.freeDesign ? hints.popupDesign : hints.popupDefault;
}

function countFollowUps(items: TemplateFollowUps["items"]): number {
  return items.reduce((total, item) => total + 1 + countFollowUps(item.children), 0);
}

/**
 * A chave das notificacoes seguintes: so na notificacao com seguintes. `count` conta todos os niveis (como o chip
 * da lista); `disabled` quando as seguintes so abrem no construtor (fica desligada, com a nota noteBuilderOnly).
 */
export function saveAsTemplateFollowUps(source: SaveAsTemplateSourceShape): { count: number; disabled: boolean } | null {
  if (saveAsTemplateKind(source) !== "inbox") {
    return null;
  }

  if (source.kind === "notice") {
    return source.followUpCount > 0 ? { count: source.followUpCount, disabled: false } : null;
  }

  const count = countFollowUps(source.followUps?.items ?? []);

  if (source.followUpsBuilderOnly) {
    return { count, disabled: true };
  }

  return count > 0 ? { count, disabled: false } : null;
}

/** As chaves comecam ligadas; a das seguintes so quando existe e nao esta desabilitada. */
export function initialSaveAsInclude(source: SaveAsTemplateSourceShape): { audience: boolean; content: boolean; followUps: boolean } {
  const followUps = saveAsTemplateFollowUps(source);

  return { audience: true, content: true, followUps: Boolean(followUps && !followUps.disabled) };
}

/** Rotulos dos campos para o banner "Corrija no aviso antes de salvar como modelo: {rótulo}: {mensagem}". */
export const TEMPLATE_FIELD_LABELS: Readonly<Record<string, string>> = {
  audience: "Para quem",
  audio: "Áudio",
  body: "Texto",
  cta: "Botão",
  design: "Design",
  followUps: "Notificações seguintes",
  freeDesign: "Design",
  image: "Imagem",
  poll: "Enquete",
  popup: "Quando e onde aparece",
  response: "Resposta",
  sender: "Quem envia",
  title: "Título",
  validity: "Tempo no sino"
};

/**
 * Os erros de campo do salvar (ja no formato do editor, por templateErrorsFromAction): o do nome fica embaixo do
 * campo; o primeiro dos outros vira a frase do banner.
 */
export function saveAsTemplateErrors(errors: Readonly<Record<string, string>>): { banner: string | null; name: string | null } {
  const name = errors.name ?? null;
  const other = Object.entries(errors).find(([key]) => key !== "name");

  if (!other) {
    return { banner: null, name };
  }

  const [key, message] = other;
  const label = TEMPLATE_FIELD_LABELS[key.split(".")[0] ?? ""];

  return { banner: label ? `${TEMPLATE_COPY.saveAs.fieldErrorPrefix}: ${label}: ${message}` : `${TEMPLATE_COPY.saveAs.fieldErrorPrefix}: ${message}`, name };
}

/** O toast do sucesso: a frase de sempre e, no fim, as notas que o servidor devolveu, numa frase so. */
export function savedTemplateToast(notes: readonly string[]): string {
  return [TEMPLATE_COPY.toasts.saved, ...notes].join(" ");
}

/* ------------------------------------------------------------------------------------------------
 * "Novo aviso" com modelos (spec §5.4)
 * ---------------------------------------------------------------------------------------------- */

export type NewNoticeMenuEntry =
  | { href: string; kind: "item"; label: string; meta?: string }
  | { kind: "label"; label: string }
  | { kind: "separator" };

/**
 * Sem modelos: null (o botao continua o link de hoje). Com modelos: "Começar em branco", "Meus modelos" com ate 5
 * (o mais recente primeiro, com o tipo a direita) e "Ver todos os modelos (n)".
 */
export function newNoticeMenu(recent: { items: readonly RecentTemplate[]; total: number }): NewNoticeMenuEntry[] | null {
  if (recent.total <= 0) {
    return null;
  }

  return [
    { href: NEW_NOTICE_HREF, kind: "item", label: TEMPLATE_COPY.newNotice.blank },
    { kind: "separator" },
    { kind: "label", label: TEMPLATE_COPY.newNotice.mine },
    ...recent.items.slice(0, TEMPLATE_LIMITS.recentForNewNotice).map((item): NewNoticeMenuEntry => ({
      href: noticeFromTemplateHref(item.id),
      kind: "item",
      label: item.name,
      meta: item.typeLabel
    })),
    { kind: "separator" },
    { href: TEMPLATES_HREF, kind: "item", label: seeAllTemplatesLabel(recent.total) }
  ];
}

