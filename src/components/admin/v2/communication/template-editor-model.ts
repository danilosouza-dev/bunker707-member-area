// Modelos da Comunicacao (docs/28; spec §5.5 a §5.7): as pecas puras do editor em modo modelo. Os textos da escolha
// do tipo (/modelos/novo), do editor do aviso em modo modelo (/modelos/[id] de notificacao e de pop-up) e da pagina
// do modelo de Design; o modo do editor pelas props; o que some da tela no modo modelo; as seguintes de um modelo no
// formato do cartao (campaignId "" em todos os niveis) e os modelos aplicados neste editor (os 5 mais recentes, com
// o de inicio sempre, e o Desfazer do toast que tira o modelo), que vao em fromTemplates do aviso e em
// sourceTemplateIds do modelo (D16 b).
//
// Modulo puro (sem React, imports relativos): tests/comunicacao-modelos-editor.test.mjs carrega direto pelo Node. O
// ?tipo= de /modelos/novo e lido pelo parseTemplateTypeParam da frente S (template-model.ts); nao ha segundo parser.

import type { FollowUpDraft } from "../../../../server/communications/flow-schemas";
import type { NoticeDraft } from "../../../../server/communications/schemas";
import {
  TEMPLATE_LIMITS,
  TEMPLATE_MESSAGES,
  TEMPLATE_TYPE_PARAMS,
  type TemplateDesignMode,
  type TemplateInclude,
  type TemplateType
} from "../../../../server/communications/template-model";
import type { SavedFollowUp } from "./follow-ups-view-model";
import { NEW_TEMPLATE_HREF } from "./templates/templates-view-model";

/** Os enderecos moram na lista (templates-view-model.ts, frente A): um lugar so para /modelos/novo, /modelos/<id> e ?modelo=. */
export { NEW_TEMPLATE_HREF, noticeFromTemplateHref, templateEditHref } from "./templates/templates-view-model";

/* ------------------------------------------------------------------------------------------------
 * Textos (spec §5.5 a §5.7, palavra por palavra)
 * ---------------------------------------------------------------------------------------------- */

export const TEMPLATE_EDITOR_COPY = {
  breadcrumb: { edit: "Editar modelo", list: "Modelos", new: "Novo modelo" },
  /** §5.5: a escolha do tipo. */
  choice: {
    cards: {
      design_custom: { description: "Só o visual montado por seções. Aparece em “Meus modelos” no card Design.", title: "Design Personalizado" },
      design_free: {
        description: "Só o visual montado do zero no editor Livre. Aparece em “Meus modelos” no card Design e no editor Livre.",
        title: "Design Livre"
      },
      inbox: { description: "Quem envia, ícone, tempo no sino, para quem e, se quiser, o conteúdo e as notificações seguintes.", title: "Notificação" },
      popup: { description: "Onde e quando aparece, quantas vezes, como fecha, o design e, se quiser, o conteúdo.", title: "Pop-up" }
    },
    description: "Que tipo de modelo você quer criar?",
    listLabel: "Tipos de modelo",
    title: "Novo modelo"
  },
  /** O card "Modelo" no topo do formulario. */
  card: {
    nameLabel: "Nome do modelo",
    phrase: "Ao usar, você começa um aviso novo com tudo o que está aqui. Nada é enviado daqui.",
    title: "Modelo"
  },
  /** D29: parte que nao abriu. */
  confirmRead: {
    cancel: "Cancelar",
    confirm: "Salvar modelo",
    description: "Uma parte deste modelo não pôde ser lida e voltou ao padrão. Ao salvar, o padrão fica no lugar dela.",
    title: "Salvar o modelo assim?"
  },
  /** §5.7: a pagina do modelo de Design. */
  design: {
    descriptions: { custom: "Design Personalizado", free: "Design Livre" },
    newTitles: { custom: "Novo modelo de design Personalizado", free: "Novo modelo de design Livre" },
    use: "Usar num pop-up novo"
  },
  /** O cabecalho do modo modelo. */
  header: {
    descriptions: { inbox: "Modelo de notificação", popup: "Modelo de pop-up" },
    newTitles: { inbox: "Novo modelo de notificação", popup: "Novo modelo de pop-up" },
    updatedAt: (date: string) => ` · Atualizado em ${date}`,
    use: "Usar modelo",
    useDirty: "Salve o modelo antes de usar."
  },
  /** As chaves do card Modelo (as descricoes do dialogo "Salvar como modelo", spec §5.3). */
  include: {
    audience: { description: "Quem recebe: o que está em “Para quem”.", label: "Levar o segmento" },
    content: {
      descriptions: {
        inbox: "Título, texto, imagem, áudio, botão e interação.",
        popup: "Título, texto, imagem, áudio e botão.",
        popupDesign: "Título, texto, imagem, áudio e botão. Os textos que ficam dentro do design vão sempre com o design."
      },
      label: "Levar o conteúdo"
    },
    followUps: { description: "Com quando saem e para quem vai cada uma.", label: "Levar as notificações seguintes" }
  },
  /** O "Tipo" do card Conteudo no modo modelo (sem as pilulas). */
  kind: { hint: "O tipo do modelo não muda. Para o outro tipo, crie outro modelo.", label: "Tipo" },
  /** As notas de chave desligada (os campos continuam na tela). */
  off: {
    audience: "O segmento não vai neste modelo: o aviso feito com ele começa em “Todos os alunos”.",
    content: "O conteúdo não vai neste modelo. Ligue “Levar o conteúdo” no card Modelo para guardar o que está aqui.",
    followUps: "As notificações seguintes não vão neste modelo."
  },
  notFound: { description: "Ele pode ter sido excluído.", title: "Modelo não encontrado" },
  pageTitles: { edit: "Modelo · Comunicação", new: "Novo modelo · Comunicação" },
  preview: "Prévia do modelo: os alunos nunca veem um modelo.",
  review: {
    discard: "Descartar mudanças",
    hint: "Ctrl+Enter (⌘+Enter no Mac) salva o modelo.",
    save: "Salvar modelo",
    saving: "Salvando…",
    sentence: "Ao usar este modelo, você começa um aviso novo com esta configuração. Os alunos nunca veem um modelo.",
    title: "Revisão"
  },
  /** "Salvar como modelo" no editor do aviso (fora do modo modelo). */
  saveAs: { label: "Salvar como modelo", waitUpload: "Espere o envio terminar." },
  saved: "Modelo salvo.",
  /** Titulo do banner de erro do "Salvar modelo" (o 409 tem o dele, changedTitle). */
  saveFailedTitle: "Não foi possível salvar o modelo",
  /** Linha de baixo do titulo do editor Livre e titulo da barra de cima ("Modelo: {nome}"). */
  title: (name: string) => `Modelo: ${name}`,
  unreadable: { action: "Ver modelos", description: TEMPLATE_MESSAGES.unreadable, title: "Este modelo não pode ser aberto" },
  /** "Quando" da notificacao no modo modelo. */
  validity: { description: "Quanto tempo a notificação fica no sino de cada aluno.", title: "Tempo no sino" },
  viewTemplates: "Ver modelos"
} as const;

/** Os quatro cartoes da escolha do tipo, na ordem da tela, com o endereco de cada um. */
export const TEMPLATE_KIND_CHOICES: readonly { description: string; href: string; title: string; type: TemplateType }[] = (
  ["inbox", "popup", "design_custom", "design_free"] as const
).map((type) => ({ ...TEMPLATE_EDITOR_COPY.choice.cards[type], href: `${NEW_TEMPLATE_HREF}?tipo=${TEMPLATE_TYPE_PARAMS[type]}`, type }));

/** "Levar o conteúdo": a descricao pelo tipo e pelo design do pop-up (Padrao ou Personalizado/Livre). */
export function templateContentDescription(kind: "inbox" | "popup", hasDesign: boolean): string {
  const copy = TEMPLATE_EDITOR_COPY.include.content.descriptions;

  return kind === "inbox" ? copy.inbox : hasDesign ? copy.popupDesign : copy.popup;
}

/** O contador do nome ("12/80"). */
export function templateNameCounter(name: string): string {
  return `${name.length}/${TEMPLATE_LIMITS.name}`;
}

/** O titulo do cabecalho do modo modelo e da pagina do Design. */
export function templateEditorTitle(input: { id: string | null; kind: "design" | "inbox" | "popup"; mode?: TemplateDesignMode | null; savedName: string }): string {
  if (input.id) {
    return TEMPLATE_EDITOR_COPY.title(input.savedName);
  }

  if (input.kind === "design") {
    return TEMPLATE_EDITOR_COPY.design.newTitles[input.mode ?? "custom"];
  }

  return TEMPLATE_EDITOR_COPY.header.newTitles[input.kind];
}

/** O titulo do banner de erro do "Salvar modelo" (modo modelo e pagina do Design): nunca fala de "aviso". */
export function templateSaveFailureTitle(status: number): string {
  return status === 409 ? TEMPLATE_MESSAGES.changedTitle : TEMPLATE_EDITOR_COPY.saveFailedTitle;
}

/* ------------------------------------------------------------------------------------------------
 * Modo do editor e o que some no modo modelo
 * ---------------------------------------------------------------------------------------------- */

/**
 * notice = aviso gravado; new = aviso novo em branco (tambem o ?modelo= que nao abriu, com a nota); start = aviso novo
 * comecando de um modelo; template = modo modelo (/modelos/novo e /modelos/[id] de notificacao e de pop-up).
 */
export type NoticeEditorMode = "new" | "notice" | "start" | "template";

export function noticeEditorModeOf(props: { initial: unknown; start?: unknown; template?: unknown }): NoticeEditorMode {
  if (props.initial) {
    return "notice";
  }

  if (props.template) {
    return "template";
  }

  return props.start ? "start" : "new";
}

/** As partes do editor do aviso: as primeiras somem no modo modelo; as outras ficam. */
export const TEMPLATE_EDITOR_PARTS = [
  "approval",
  "kindPills",
  "pollEndDate",
  "publish",
  "rowMenu",
  "saveAsTemplate",
  "saveDraft",
  "schedule",
  "sendTest",
  "statusNotes",
  "validityUntil",
  "viewAsFlow",
  "window",
  "audience",
  "content",
  "design",
  "followUps",
  "frequency",
  "placement",
  "preview",
  "validity"
] as const;
export type TemplateEditorPart = (typeof TEMPLATE_EDITOR_PARTS)[number];

const HIDDEN_IN_TEMPLATE: ReadonlySet<TemplateEditorPart> = new Set([
  "approval",
  "kindPills",
  "pollEndDate",
  "publish",
  "rowMenu",
  "saveAsTemplate",
  "saveDraft",
  "schedule",
  "sendTest",
  "statusNotes",
  "validityUntil",
  "viewAsFlow",
  "window"
]);

/**
 * O que some no modo modelo (spec §5.6): o envio (data e hora), a janela do pop-up, "Até uma data", o fim marcado da
 * enquete, o teste, a aprovacao, Publicar e Salvar rascunho, o menu ⋯, "Salvar como modelo", "Ver como fluxo" e as
 * notas de situacao. Fica o resto (conteudo, para quem, design, onde e quantas vezes, tempo no sino, seguintes,
 * previa). Fora do modo modelo, nada some.
 */
export function templateEditorHidden(mode: NoticeEditorMode): Readonly<Record<TemplateEditorPart, boolean>> {
  return Object.fromEntries(TEMPLATE_EDITOR_PARTS.map((part) => [part, mode === "template" && HIDDEN_IN_TEMPLATE.has(part)])) as Record<TemplateEditorPart, boolean>;
}

/**
 * Modo modelo de Pop-up com design (Personalizado ou Livre) e "Levar o conteúdo" desligado: o destino do botao
 * principal nunca vai para o modelo (so o texto, no apoio do design, D3), entao o card Design esconde o campo e mostra
 * "O destino do botão é escolhido em cada aviso.", como na pagina do modelo de Design. No Padrao, o botao fica no card
 * Conteudo, que ja diz que o conteudo nao vai.
 */
export function templateHidesCtaDestination(input: { content: boolean; draft: Pick<NoticeDraft, "design" | "freeDesign" | "kind"> }): boolean {
  return input.draft.kind === "popup" && !input.content && Boolean(input.draft.design || input.draft.freeDesign);
}

/**
 * O rascunho que o "Salvar modelo" confere e manda: com o destino escondido (templateHidesCtaDestination), o destino
 * vai vazio, para um destino de antes (que nunca seria guardado) nao segurar o salvar com um erro que nao aparece.
 * O resto fica igual (o botao continua existindo: o design e "Quantas vezes" dependem dele).
 */
export function templateDraftForSave<T extends Pick<NoticeDraft, "cta" | "design" | "freeDesign" | "kind">>(draft: T, include: TemplateInclude): T {
  if (!draft.cta || !templateHidesCtaDestination({ content: include.content, draft })) {
    return draft;
  }

  return { ...draft, cta: { ...draft.cta, href: "" } };
}

/**
 * As notas do topo do aviso novo que comecou de um modelo (`start`): "Você começou do modelo…" e as notas do Usar; do
 * ?modelo= que nao abriu, startMissing ou startUnreadable. Um `start` sem modelo (templateName null: o atalho Avisar do
 * webinario, docs/30 §2.2) traz a propria nota de inicio nas `notes`. Depois do primeiro salvar (o aviso ja existe,
 * mesmo sem trocar de endereco com o editor Livre aberto), nao ha mais nota: e o que o editor mostra quando reabre o
 * aviso.
 */
export function noticeStartNotes(input: {
  mode: NoticeEditorMode;
  notes: readonly string[];
  problem: "missing" | "unreadable" | null;
  saved: boolean;
  templateName: string | null;
}): string[] {
  if (input.saved) {
    return [];
  }

  if (input.mode === "start") {
    // Sem nome de modelo: o atalho Avisar do webinario (docs/30 §2.2) ou o aviso que veio do relatorio do webinario
    // (docs/30 §3.4, "Avisar quem não veio"): so as notas de quem preparou.
    return input.templateName ? [TEMPLATE_MESSAGES.startFrom(input.templateName), ...input.notes] : [...input.notes];
  }

  if (input.mode === "new" && input.problem) {
    return [input.problem === "missing" ? TEMPLATE_MESSAGES.startMissing : TEMPLATE_MESSAGES.startUnreadable];
  }

  return [];
}

/** As chaves do card Modelo sao iguais? (mudar uma chave tambem e mudanca a salvar). */
export function sameTemplateInclude(a: TemplateInclude, b: TemplateInclude): boolean {
  return a.audience === b.audience && a.content === b.content && a.followUps === b.followUps;
}

/* ------------------------------------------------------------------------------------------------
 * Seguintes e modelos aplicados
 * ---------------------------------------------------------------------------------------------- */

/**
 * As seguintes de um modelo (FollowUpDraft) no formato gravado que o cartao le (followUpFormItemsOf): `campaignId: ""`
 * em todos os niveis (o cartao le o campaignId dos filhos tambem; uma seguinte de modelo nunca tem aviso).
 */
export function savedFollowUpsOfDrafts(items: readonly FollowUpDraft[]): SavedFollowUp[] {
  return items.map((item) => ({
    campaignId: "",
    children: savedFollowUpsOfDrafts(item.children),
    content: item.content,
    id: item.id,
    when: { anchor: item.when.anchor, minutes: item.when.minutes },
    who: item.who
  }));
}

/**
 * Os modelos aplicados neste editor depois de mais um (spec §5.6): sem repetidos, o novo no fim, o de inicio (o
 * ?modelo= do aviso novo) sempre presente e no maximo TEMPLATE_LIMITS.sourcesPerSave (5), cortando os mais antigos.
 */
export function recentTemplateIds(list: readonly string[], id: string, startId: string | null): string[] {
  const max = TEMPLATE_LIMITS.sourcesPerSave;
  const rest = [...list.filter((item) => item !== id && item !== startId), ...(id !== startId ? [id] : [])];
  const room = startId ? max - 1 : max;
  const kept = rest.slice(Math.max(0, rest.length - room));

  return startId ? [startId, ...kept] : kept;
}

/**
 * O Desfazer do toast de "Usar este modelo" ("Meus modelos" no card Design): o design volta ao de antes e o modelo sai
 * da lista dos aplicados, para o salvar nao manda-lo em fromTemplates (nem gravar "template_used" com ele). `before` e
 * a lista de quando ele foi aplicado. Fica o de inicio (o ?modelo=) e o modelo que ja estava na lista antes (o uso
 * anterior continua no rascunho); a lista zerada por um salvar no meio continua como esta.
 */
export function undoTemplateUse(list: readonly string[], use: { before: readonly string[]; id: string }, startId: string | null): string[] {
  if (use.id === startId || use.before.includes(use.id)) {
    return [...list];
  }

  return list.filter((item) => item !== use.id);
}
