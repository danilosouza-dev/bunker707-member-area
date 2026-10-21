// "Depois desta notificação" no editor de avisos (Comunicacao v2, docs/23 §2.2): as notificacoes seguintes
// de um aviso, cada uma com "Quando sai", "Para quem" (escolhas rapidas conforme o que a notificacao de cima
// tem, ou regras) e o conteudo editado numa folha. Aqui ficam as regras puras do cartao: as escolhas rapidas
// e as regras de cada uma (e o caminho de volta, quickChoiceOfRules), a linha "Parar ... para quem tiver
// acesso a" <-> objetivo do fluxo, o padrao "Até a notificação principal sumir", os rotulos por nivel, as
// frases de "Quando sai", o resumo do cartao, a contagem ao vivo e os textos das confirmacoes.
//
// Modulo puro (sem React, imports relativos, sem enums): tests/comunicacao-seguintes-tela.test.mjs carrega
// direto pelo Node, e o cartao, a folha, o editor e o relatorio usam as mesmas regras. O fluxo do aviso e
// gravado por saveNoticeFollowUps (actions.ts) com treeFromFollowUps (flow-model.ts).

import {
  describeAudience,
  EVERYONE,
  normalizeAudience,
  type AudienceDefinition,
  type AudienceNames,
  type AudienceNode,
  type AudienceRule,
  type MessageAction,
  type MessageRef
} from "../../../../server/communications/audience-model";
import {
  FLOW_LIMITS,
  treeFromFollowUps,
  validateFlowTree,
  type FlowEndedReason,
  type FlowMessageMeta,
  type FlowStatus,
  type FollowUp
} from "../../../../server/communications/flow-model";
import type { FlowNoticeContent, FollowUpDraft } from "../../../../server/communications/flow-schemas";
import type { PollOption } from "../../../../server/communications/interactions-model";
import { describeValidity, validityDurationLabel, validityToColumns, VALIDITY_LIMITS, type FlowValidity } from "../../../../server/communications/message-meta";
import { pageKeyOfHref } from "../../../../server/member-area/page-visit-model";
import { shouldClampNotificationBody } from "../../../member/notifications/notifications-model";
import { REMOVED_REASON_LABEL } from "./flows/flows-view-model";
import { formatInteger } from "./notices-view-model";

/* ------------------------------------------------------------------------------------------------
 * Textos fixos do cartao
 * ---------------------------------------------------------------------------------------------- */

export const FOLLOW_UPS_COPY = {
  add: "Adicionar notificação seguinte",
  addChild: "Adicionar notificação seguinte a esta",
  apply: "Aplicar alterações",
  builderOnly: "Esta notificação tem passos que só aparecem no fluxo.",
  description: "Envie outra notificação só para quem fez, ou não fez, algo com esta.",
  discard: "Descartar",
  done: "Concluir",
  duplicate: "Duplicar",
  editContent: "Editar notificação",
  editInFlow: "Editar no fluxo",
  finished: "Esta notificação já saiu do sino de todos: não dá para adicionar notificações seguintes.",
  limits:
    "Para não cansar o aluno: no máximo 3 notificações de fluxos e notificações seguintes por dia para cada aluno, com pelo menos 1 hora entre elas. Se passar do limite do dia, sai às 8h do dia seguinte; se o prazo dela acabar antes, não sai. Até 5 notificações seguintes por notificação, em até 3 níveis. Cada aluno recebe cada notificação uma vez só.",
  liveBanner:
    "Esta notificação já saiu. As mudanças valem a partir de agora: uma notificação seguinte nova conta o tempo de quando cada aluno recebeu esta, e ninguém recebe a mesma notificação duas vezes.",
  /** Sem messaging.publish: as seguintes de uma notificacao que ja saiu ficam so para ler. */
  needsPublish: "Só quem pode publicar muda as notificações seguintes depois do envio.",
  /** Acima de 500 alunos sem messaging.publish_large (a mesma frase do 403 do servidor, docs/23 §2.7). */
  needsPublishLarge: "Para mudar um fluxo ativo para este segmento, peça a um dono ou administrador.",
  partialSaveText: "Salve de novo. O que você escreveu continua aqui.",
  partialSaveTitle: "O rascunho foi salvo, mas as notificações seguintes não",
  pending: "Alterações não aplicadas",
  remove: "Remover",
  sendTest: "Enviar teste para mim",
  /** A escolha rapida ja feita que a notificacao de cima nao oferece mais (audio, destino, enquete, reacoes ou texto saiu). */
  staleChoice: "Esta escolha não vale mais para a notificação de cima. Escolha outra.",
  /** Rodape da folha da seguinte: no editor (rascunho) e no relatorio da notificacao enviada. */
  sheetDraftNote: "As mudanças ficam no rascunho até você salvar.",
  sheetLiveNote: "As mudanças valem quando você aplicar.",
  stopLabel: "Parar as notificações seguintes para quem tiver acesso a",
  test: "O teste chega só no seu sino e não conta nos números.",
  title: "Depois desta notificação",
  viewAsFlow: "Ver como fluxo",
  withdrawSentence: "As notificações seguintes deixam de sair."
} as const;

export const FOLLOW_UPS_SECTION_TITLE = "Notificações seguintes";

export const FOLLOW_UP_LIMIT_MESSAGES = {
  depth: "As notificações seguintes vão até 3 níveis, contando a notificação principal.",
  perLevel: `Use no máximo ${FLOW_LIMITS.followUpsPerNotice} notificações seguintes por notificação.`,
  total: `Use no máximo ${FLOW_LIMITS.maxNodes} notificações seguintes.`
} as const;

/** Endereco do fluxo do aviso: "Ver como fluxo" e, no ar, "Editar no fluxo" (o editor em etapas, ?editar=1). */
export function noticeFlowHref(flowId: string, options: { edit?: boolean } = {}) {
  const base = `/admin/comunicacao/fluxos/${encodeURIComponent(flowId)}`;

  return options.edit ? `${base}?editar=1` : base;
}

/* ------------------------------------------------------------------------------------------------
 * A notificacao de cima (a principal ou a seguinte anterior)
 * ---------------------------------------------------------------------------------------------- */

/** "principal" = o proprio aviso; "anterior" = a seguinte de cima (seguinte de uma seguinte). */
export type FollowUpLevel = "main" | "previous";

/** O que a notificacao de cima tem: decide as escolhas rapidas e o tempo no sino de "antes de vencer". */
export type FollowUpParent = {
  /** v3a: aceita reacoes ("não reagiu"). */
  allowsReactions: boolean;
  body: string;
  ctaHref: string | null;
  hasAudio: boolean;
  /** v3a: tem enquete ("não votou na enquete"; e ha o que abrir). */
  hasPoll: boolean;
  hasResponse: boolean;
  level: FollowUpLevel;
  /** Passo da notificacao de cima: a entrada do fluxo do aviso (a principal) ou a seguinte. */
  nodeId: string;
  /** v3a: as opcoes da enquete (as regras "votou em “X”" das seguintes de baixo). */
  pollOptions: readonly PollOption[];
  title: string;
  /**
   * Quanto tempo ela fica no sino, em minutos, contado de quando chega; null = depende de quando chega
   * ("até uma data" sem hora de envio conhecida, ou "até a principal sumir").
   */
  validityMinutes: number | null;
};

type ParentContent = Pick<FlowNoticeContent, "audio" | "body" | "cta" | "poll" | "reactions" | "response" | "title" | "validity">;

/** Minutos no sino de um conteudo; "até uma data" so com a hora de envio. */
export function validityMinutesOf(validity: FlowValidity, sendAt?: number | null): number | null {
  switch (validity.mode) {
    case "default":
      return VALIDITY_LIMITS.defaultMinutes;
    case "duration":
      return Number.isFinite(validity.minutes) ? Math.min(validity.minutes, VALIDITY_LIMITS.maxMinutes) : null;
    case "until": {
      const end = Date.parse(validity.endsAt);

      return typeof sendAt === "number" && Number.isFinite(end) && Number.isFinite(sendAt) ? Math.min(Math.max(0, Math.floor((end - sendAt) / 60_000)), VALIDITY_LIMITS.maxMinutes) : null;
    }
    default:
      return null;
  }
}

export function followUpParentOf(nodeId: string, level: FollowUpLevel, content: ParentContent, sendAt?: number | null): FollowUpParent {
  return {
    allowsReactions: content.reactions === true,
    body: content.body,
    ctaHref: content.cta?.href?.trim() || null,
    hasAudio: Boolean(content.audio),
    hasPoll: Boolean(content.poll),
    hasResponse: Boolean(content.response),
    level,
    nodeId,
    pollOptions: content.poll?.options ?? [],
    title: content.title,
    validityMinutes: validityMinutesOf(content.validity, sendAt)
  };
}

/**
 * Ha o que abrir ("Ver mais", audio, destino, resposta ou enquete)? O sino mostra um aviso curto so de texto
 * inteiro, entao nele "abriu" nunca acontece e nao e oferecido (docs/23 V7). Votar conta como abrir; reagir
 * tambem, mas reacao sozinha nao faz haver o que abrir (docs/24 T15).
 */
export function hasSomethingToOpen(parent: Pick<FollowUpParent, "body" | "ctaHref" | "hasAudio" | "hasResponse"> & { hasPoll?: boolean }) {
  return parent.hasAudio || Boolean(parent.ctaHref) || parent.hasResponse || parent.hasPoll === true || shouldClampNotificationBody(parent.body);
}

/** Produto que o destino abre (/conteudo/<id>, tambem uma aula dele); senao null. */
export function ctaProductId(href: string | null | undefined): string | null {
  const key = pageKeyOfHref(href);

  return key?.startsWith("content:") ? key.slice("content:".length) : null;
}

/** "a notificação principal" / "a notificação anterior". */
function parentPhrase(level: FollowUpLevel) {
  return level === "main" ? "a notificação principal" : "a notificação anterior";
}

/** "Quem recebeu a notificação principal e…" (cabecalho de "Para quem"). */
export function followUpAudienceHeading(level: FollowUpLevel) {
  return `Quem recebeu ${parentPhrase(level)} e…`;
}

/* ------------------------------------------------------------------------------------------------
 * "Para quem": escolhas rapidas <-> regras
 * ---------------------------------------------------------------------------------------------- */

export const QUICK_CHOICE_IDS = [
  "seen_not_opened",
  "not_seen",
  "not_opened",
  "seen",
  "opened_not_clicked",
  "not_clicked",
  "clicked_no_access",
  "visited_no_access",
  "not_visited",
  "audio_not_started",
  "audio_not_completed",
  "audio_completed",
  "not_responded",
  "accepted",
  "declined",
  "not_voted",
  "not_reacted",
  "everyone",
  "rules"
] as const;
export type QuickChoiceId = (typeof QUICK_CHOICE_IDS)[number];

export const NOTHING_TO_OPEN_NOTE =
  "Esta notificação não tem áudio, destino, resposta, enquete nem texto longo: o aluno lê tudo no sino, então só dá para saber se ele viu.";

/** v3a: a linha embaixo das escolhas "não …" sobre a notificacao de cima (QUICK_CHOICES_SKIPPING_HIDDEN). */
export const HIDDEN_SKIP_NOTE = "Quem excluiu a notificação de cima do sino não recebe esta.";

/** Rotulo de cada escolha (depois de "Quem recebeu ... e…") e a dica, quando ha. */
export const QUICK_CHOICE_COPY: Record<QuickChoiceId, { hint?: string; label: string }> = {
  accepted: { label: "aceitou" },
  audio_completed: { label: "ouviu o áudio até o fim" },
  audio_not_completed: { label: "não ouviu o áudio até o fim" },
  audio_not_started: { label: "não começou a ouvir o áudio" },
  clicked_no_access: { label: "foi para o destino, mas ainda não tem acesso a" },
  declined: { label: "recusou" },
  everyone: { label: "todos que receberam" },
  not_clicked: { label: "não foi para o destino" },
  not_opened: { hint: "Inclui quem ainda nem abriu o sino: essa pessoa vai ver as duas juntas.", label: "não abriu" },
  not_reacted: { label: "não reagiu" },
  not_responded: { label: "não respondeu" },
  not_seen: { hint: "Quem ainda não abriu o sino vai ver as duas juntas quando abrir.", label: "nem viu no sino" },
  not_visited: { label: "não visitou a página para onde a notificação leva" },
  not_voted: { label: "não votou na enquete" },
  opened_not_clicked: { label: "abriu, mas não foi para o destino" },
  rules: { label: "escolher por regras" },
  seen: { hint: NOTHING_TO_OPEN_NOTE, label: "viu no sino" },
  seen_not_opened: {
    hint: "Abrir é tocar na notificação, em “Ver mais”, no áudio ou no botão, reagir, votar ou responder. “Marcar todas como lidas” não conta.",
    label: "viu no sino, mas não abriu"
  },
  visited_no_access: { label: "visitou a página para onde a notificação leva, mas ainda não tem acesso a" }
};

/**
 * v3a (docs/24 §2.7): as escolhas sobre NAO fazer algo com a notificacao de cima pulam quem a excluiu do
 * sino (regra "não excluiu do sino"). Fora: "nem viu no sino" (excluida ja foi vista), "todos", as
 * positivas e as de pagina e produto (sao sobre o produto, nao sobre a notificacao).
 */
export const QUICK_CHOICES_SKIPPING_HIDDEN: readonly QuickChoiceId[] = [
  "not_opened",
  "seen_not_opened",
  "not_clicked",
  "opened_not_clicked",
  "not_responded",
  "not_voted",
  "not_reacted",
  "audio_not_started",
  "audio_not_completed"
];

/** As linhas embaixo da escolha marcada: a dica dela e, nas "não …", HIDDEN_SKIP_NOTE. */
export function quickChoiceHints(choice: QuickChoiceId): string[] {
  const hint = QUICK_CHOICE_COPY[choice].hint;

  return [...(hint ? [hint] : []), ...(QUICK_CHOICES_SKIPPING_HIDDEN.includes(choice) ? [HIDDEN_SKIP_NOTE] : [])];
}

/** As escolhas que pedem um produto ("... mas ainda não tem acesso a [produto]"). */
export function quickChoiceNeedsProduct(choice: QuickChoiceId) {
  return choice === "clicked_no_access" || choice === "visited_no_access";
}

/**
 * So as escolhas que fazem sentido para o que a notificacao de cima tem, na ordem da tela. Com o que abrir,
 * "viu no sino, mas não abriu" vem primeiro (e e o padrao da seguinte nova); sem nada para abrir, so
 * "nem viu no sino" / "viu no sino" (nunca "não abriu").
 */
export function quickChoicesFor(parent: FollowUpParent): QuickChoiceId[] {
  const open = hasSomethingToOpen(parent);
  const choices: QuickChoiceId[] = [];

  if (open) {
    choices.push("seen_not_opened", "not_seen", "not_opened");
  } else {
    choices.push("not_seen", "seen");
  }

  if (parent.ctaHref) {
    choices.push("opened_not_clicked", "not_clicked", "clicked_no_access");

    // Pagina da area acompanhada (docs/23 §5.2); destino externo ou pagina desconhecida: so "foi para o destino".
    if (pageKeyOfHref(parent.ctaHref)) {
      choices.push("visited_no_access", "not_visited");
    }
  }

  if (parent.hasAudio) {
    choices.push("audio_not_started", "audio_not_completed", "audio_completed");
  }

  if (parent.hasResponse) {
    choices.push("not_responded", "accepted", "declined");
  }

  // v3a: depois das de resposta (enquete e resposta nao convivem na mesma notificacao).
  if (parent.hasPoll) {
    choices.push("not_voted");
  }

  if (parent.allowsReactions) {
    choices.push("not_reacted");
  }

  choices.push("everyone", "rules");

  return choices;
}

export function defaultQuickChoice(parent: FollowUpParent): QuickChoiceId {
  return quickChoicesFor(parent)[0];
}

const rulesOf = (...items: AudienceNode[]): AudienceDefinition => ({ kind: "rules", root: { items, match: "all" } });

/**
 * As regras de uma escolha rapida, sempre sobre a notificacao de cima (passo do fluxo). Negada, a regra
 * implica "recebeu" (docs/23 §7). "... mas ainda não tem acesso a Y" junta `product has_not [Y]`: quem ja
 * tem Y nunca recebe. "todos que receberam" = sem filtro. "escolher por regras" nao tem regra propria: null.
 * v3a: as "não …" de QUICK_CHOICES_SKIPPING_HIDDEN terminam com "não excluiu do sino"; `v2` devolve a forma
 * gravada pela v2 (sem essa regra), so para reconhecer uma seguinte antiga (quickChoiceOfRules).
 */
export function quickChoiceRules(
  choice: QuickChoiceId,
  parent: Pick<FollowUpParent, "nodeId">,
  productId: string | null = null,
  options: { v2?: boolean } = {}
): AudienceDefinition | null {
  const ref: MessageRef = { kind: "node", nodeId: parent.nodeId };
  const did = (action: MessageAction, negate = false): AudienceRule => ({ action, negate, ref, type: "message" });
  const skip = QUICK_CHOICES_SKIPPING_HIDDEN.includes(choice) && options.v2 !== true ? [did("hidden", true)] : [];
  const visited = (negate: boolean): AudienceRule => ({
    negate,
    page: { kind: "message_cta", nodeId: parent.nodeId },
    since: { kind: "message", nodeId: parent.nodeId },
    type: "page_visit"
  });
  const noAccess: AudienceRule = { op: "has_not", productIds: productId ? [productId] : [], type: "product" };

  switch (choice) {
    case "not_seen":
      return rulesOf(did("seen", true));
    case "seen_not_opened":
      return rulesOf(did("seen"), did("opened", true), ...skip);
    case "not_opened":
      return rulesOf(did("opened", true), ...skip);
    case "seen":
      return rulesOf(did("seen"));
    case "opened_not_clicked":
      return rulesOf(did("opened"), did("clicked", true), ...skip);
    case "not_clicked":
      return rulesOf(did("clicked", true), ...skip);
    case "clicked_no_access":
      return rulesOf(did("clicked"), noAccess);
    case "visited_no_access":
      return rulesOf(visited(false), noAccess);
    case "not_visited":
      return rulesOf(visited(true));
    case "audio_not_started":
      return rulesOf(did("audio_started", true), ...skip);
    case "audio_not_completed":
      return rulesOf(did("audio_completed", true), ...skip);
    case "audio_completed":
      return rulesOf(did("audio_completed"));
    case "not_responded":
      return rulesOf(did("responded", true), ...skip);
    case "accepted":
      return rulesOf(did("accepted"));
    case "declined":
      return rulesOf(did("declined"));
    case "not_voted":
      return rulesOf(did("voted", true), ...skip);
    case "not_reacted":
      return rulesOf(did("reacted", true), ...skip);
    case "everyone":
      return EVERYONE;
    default:
      return null;
  }
}

/** As escolhas que ja existiam na v2 (as unicas que podem estar gravadas na forma sem "não excluiu do sino"). */
const V2_SHAPED_CHOICES: readonly QuickChoiceId[] = ["not_opened", "seen_not_opened", "not_clicked", "opened_not_clicked", "not_responded", "audio_not_started", "audio_not_completed"];

/** JSON com chaves em ordem (comparar regras gravadas, que voltam do jsonb em outra ordem). */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value ?? null);
}

function sameAudience(left: AudienceDefinition, right: AudienceDefinition) {
  return stableJson(normalizeAudience(left)) === stableJson(normalizeAudience(right));
}

/** Produto de um `product has_not [Y]` (o das escolhas "... mas ainda não tem acesso a Y"). */
function noAccessProductOf(who: AudienceDefinition): string | null {
  if (who.kind !== "rules") {
    return null;
  }

  for (const item of who.root.items) {
    if ("type" in item && item.type === "product" && item.op === "has_not" && item.productIds.length === 1) {
      return item.productIds[0];
    }
  }

  return null;
}

/**
 * De volta: as regras gravadas sao exatamente uma escolha rapida (depois de normalizeAudience)? Entao o
 * cartao reabre nela; senao, "escolher por regras" com o construtor. v3a: uma "não …" gravada pela v2 (sem
 * "não excluiu do sino") tambem reabre na escolha; a proxima gravacao escreve a forma nova.
 */
export function quickChoiceOfRules(who: AudienceDefinition, parent: FollowUpParent): { choice: QuickChoiceId; productId: string | null } {
  const productId = noAccessProductOf(who);

  for (const choice of quickChoicesFor(parent)) {
    const chosenProduct = quickChoiceNeedsProduct(choice) ? productId : null;
    const rules = quickChoiceRules(choice, parent, chosenProduct);
    const v2Rules = V2_SHAPED_CHOICES.includes(choice) ? quickChoiceRules(choice, parent, chosenProduct, { v2: true }) : null;

    if ((rules && sameAudience(rules, who)) || (v2Rules && sameAudience(v2Rules, who))) {
      return { choice, productId: chosenProduct };
    }
  }

  return { choice: "rules", productId: null };
}

/* ------------------------------------------------------------------------------------------------
 * Uma notificacao seguinte como o cartao edita
 * ---------------------------------------------------------------------------------------------- */

export type FollowUpAnchor = "expires" | "sent";

export type FollowUpFormItem = {
  /** Versao atual do conteudo ("" = seguinte nova). */
  campaignId: string;
  children: FollowUpFormItem[];
  choice: QuickChoiceId;
  content: FlowNoticeContent;
  /** Id do passo (uuid gerado no navegador). */
  id: string;
  /** Produto das escolhas "... mas ainda não tem acesso a"; null = ainda nao escolhido. */
  productId: string | null;
  /** O construtor de "escolher por regras" (guardado mesmo quando outra escolha esta marcada). */
  rules: AudienceDefinition;
  when: { anchor: FollowUpAnchor; minutes: number };
};

/** Conteudo de uma seguinte nova: so o titulo por escrever, quem envia a escola, 90 dias no sino. */
export function emptyFollowUpContent(): FlowNoticeContent {
  // v3a: a seguinte nova ja permite reacoes (como a notificacao nova).
  return { audio: null, body: "", cta: null, icon: null, image: null, reactions: true, response: null, sender: null, title: "", validity: { mode: "default" } };
}

/** Seguinte nova: 1 dia depois do envio, para a primeira escolha rapida da notificacao de cima. */
export function newFollowUpItem(id: string, parent: FollowUpParent): FollowUpFormItem {
  const choice = defaultQuickChoice(parent);

  return {
    campaignId: "",
    children: [],
    choice,
    content: emptyFollowUpContent(),
    id,
    productId: quickChoiceNeedsProduct(choice) ? ctaProductId(parent.ctaHref) : null,
    rules: { kind: "rules", root: { items: [], match: "all" } },
    when: { anchor: "sent", minutes: 1_440 }
  };
}

/**
 * v3a: as opcoes das enquetes da principal e das seguintes nos nomes da frase ("node:<passo>"), para "votaram
 * em “Sábado” na enquete …" das regras das seguintes.
 */
export function followUpAudienceNames(names: AudienceNames, main: Pick<FollowUpParent, "nodeId" | "pollOptions">, items: readonly Pick<FollowUpFormItem, "children" | "content" | "id">[]): AudienceNames {
  const pollOptions: Record<string, Record<string, string>> = {};
  const add = (nodeId: string, options: readonly PollOption[] | undefined) => {
    if (nodeId && options && options.length > 0) {
      pollOptions[`node:${nodeId}`] = Object.fromEntries(options.map((option) => [option.id, option.label]));
    }
  };
  const walk = (list: readonly Pick<FollowUpFormItem, "children" | "content" | "id">[]) =>
    list.forEach((item) => {
      add(item.id, item.content.poll?.options);
      walk(item.children);
    });

  add(main.nodeId, main.pollOptions);
  walk(items);

  return Object.keys(pollOptions).length === 0 ? names : { ...names, pollOptions: { ...names.pollOptions, ...pollOptions } };
}

/** "Para quem" de verdade: as regras da escolha rapida, ou as do construtor. */
export function whoOfItem(item: Pick<FollowUpFormItem, "choice" | "productId" | "rules">, parent: Pick<FollowUpParent, "nodeId">): AudienceDefinition {
  return quickChoiceRules(item.choice, parent, item.productId) ?? normalizeAudience(item.rules);
}

/**
 * Trocar a escolha. Ir para "escolher por regras" abre o construtor com as regras da escolha marcada ate
 * agora ("não abriu E tem acesso a X" comeca de "não abriu"); uma escolha com produto comeca no produto do
 * destino.
 */
export function changeQuickChoice(item: FollowUpFormItem, choice: QuickChoiceId, parent: FollowUpParent): FollowUpFormItem {
  if (choice === item.choice) {
    return item;
  }

  if (choice === "rules") {
    const current = quickChoiceRules(item.choice, parent, item.productId);

    return { ...item, choice, rules: current && current.kind === "rules" ? current : { kind: "rules", root: { items: [], match: "all" } } };
  }

  const productId = quickChoiceNeedsProduct(choice) ? (item.productId ?? ctaProductId(parent.ctaHref)) : item.productId;

  return { ...item, choice, productId };
}

/**
 * Trocar "Quando sai". Para "antes de vencer", enquanto o tempo no sino ainda e o padrao de 90 dias, a
 * seguinte passa a sumir junto com a de cima ("Até a notificação principal sumir"): "Faltam 3 horas" mostra
 * "Termina em 3 h" e some com a oferta.
 */
export function changeFollowUpAnchor(item: FollowUpFormItem, anchor: FollowUpAnchor): FollowUpFormItem {
  if (anchor === item.when.anchor) {
    return item;
  }

  const validity: FlowValidity = anchor === "expires" && item.content.validity.mode === "default" ? { mode: "with_anchor" } : item.content.validity;

  return { ...item, content: { ...item.content, validity }, when: { ...item.when, anchor } };
}

/* ------------------------------------------------------------------------------------------------
 * "Quando sai": numero, unidade e a frase
 * ---------------------------------------------------------------------------------------------- */

export type WhenUnit = "days" | "hours" | "minutes";

export const WHEN_UNIT_OPTIONS: readonly { label: string; value: WhenUnit }[] = [
  { label: "minutos", value: "minutes" },
  { label: "horas", value: "hours" },
  { label: "dias", value: "days" }
];

const UNIT_MINUTES: Record<WhenUnit, number> = { days: 1_440, hours: 60, minutes: 1 };

/** As duas bases de "Quando sai"; na seguinte de uma seguinte, contam da anterior. */
export function whenAnchorOptions(level: FollowUpLevel): readonly { label: string; value: FollowUpAnchor }[] {
  return level === "main"
    ? [
        { label: "depois do envio", value: "sent" },
        { label: "antes de vencer", value: "expires" }
      ]
    : [
        { label: "depois do envio da anterior", value: "sent" },
        { label: "antes de a anterior vencer", value: "expires" }
      ];
}

/** Minutos -> [numero] [unidade] (a maior unidade que fecha certo). */
export function whenParts(minutes: number): { amount: number; unit: WhenUnit } {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { amount: Number.isFinite(minutes) ? minutes : Number.NaN, unit: "minutes" };
  }

  if (minutes % 1_440 === 0) {
    return { amount: minutes / 1_440, unit: "days" };
  }

  if (minutes % 60 === 0) {
    return { amount: minutes / 60, unit: "hours" };
  }

  return { amount: minutes, unit: "minutes" };
}

/** [numero] [unidade] -> minutos (numero invalido fica invalido: o zod diz "Escolha de 5 minutos a 60 dias."). */
export function whenMinutes(amount: number, unit: WhenUnit) {
  return Number.isFinite(amount) ? Math.round(amount * UNIT_MINUTES[unit]) : Number.NaN;
}

export type WhenSentence = { text: string; tone: "error" | "neutral" };

/**
 * A frase sob "Quando sai", calculada do tempo no sino da notificacao de cima:
 * - depois do envio: "Sai 1 dia depois que a notificação principal chega ao aluno." (ou, quando a de cima
 *   ja sumiu nessa hora, "Sai depois que a notificação principal já sumiu do sino.", so uma nota);
 * - antes de vencer: "Sai 3 horas antes de a notificação principal sumir do sino (21 horas depois do envio).";
 *   antes do proprio envio e erro (a mesma frase da conferencia da arvore).
 */
export function whenSentence(when: { anchor: FollowUpAnchor; minutes: number }, parent: Pick<FollowUpParent, "level" | "title" | "validityMinutes">): WhenSentence | null {
  if (!Number.isFinite(when.minutes) || when.minutes <= 0) {
    return null;
  }

  const phrase = parentPhrase(parent.level);
  const duration = validityDurationLabel(when.minutes);
  const parentMinutes = parent.validityMinutes;

  if (when.anchor === "sent") {
    if (parentMinutes !== null && when.minutes >= parentMinutes) {
      return { text: `Sai depois que ${phrase} já sumiu do sino.`, tone: "neutral" };
    }

    return { text: `Sai ${duration} depois que ${phrase} chega ao aluno.`, tone: "neutral" };
  }

  if (parentMinutes === null) {
    return { text: `Sai ${duration} antes de ${phrase} sumir do sino.`, tone: "neutral" };
  }

  if (when.minutes >= parentMinutes) {
    const label = validityDurationLabel(parentMinutes);

    return { text: `A notificação “${parent.title.trim() || "Sem título"}” fica só ${label} no sino. Escolha menos de ${label} antes de vencer.`, tone: "error" };
  }

  return { text: `Sai ${duration} antes de ${phrase} sumir do sino (${validityDurationLabel(parentMinutes - when.minutes)} depois do envio).`, tone: "neutral" };
}

/* ------------------------------------------------------------------------------------------------
 * Rotulos por nivel, resumo do cartao e a linha do conteudo
 * ---------------------------------------------------------------------------------------------- */

/** Qualquer arvore de seguintes (cartao ou rascunho da acao): so o id e as de baixo. */
export type FollowUpTreeNode = { children: readonly FollowUpTreeNode[]; id: string };

/** Numero de cada seguinte pela posicao: "1", "2", "1.1" (seguinte da primeira). */
export function followUpNumbers(items: readonly FollowUpTreeNode[]): Map<string, string> {
  const numbers = new Map<string, string>();
  const walk = (list: readonly FollowUpTreeNode[], prefix: string) => {
    list.forEach((item, index) => {
      const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      numbers.set(item.id, number);
      walk(item.children, number);
    });
  };

  walk(items, "");

  return numbers;
}

/** "Notificação seguinte 1" / "Notificação seguinte 1.1" (cartao e titulo da folha). */
export function followUpTitle(number: string) {
  return `Notificação seguinte ${number}`;
}

export type FollowUpPreviewChoice = "main" | (string & {});

/** Pilulas sobre a previa: "Esta notificação" · "Seguinte 1" · "Seguinte 1.1" · "Seguinte 2" (pai antes do filho). */
export function followUpPreviewOptions(items: readonly FollowUpTreeNode[]): { id: FollowUpPreviewChoice; label: string }[] {
  const numbers = followUpNumbers(items);
  const options: { id: FollowUpPreviewChoice; label: string }[] = [{ id: "main", label: "Esta notificação" }];
  const walk = (list: readonly FollowUpTreeNode[]) => {
    for (const item of list) {
      options.push({ id: item.id, label: `Seguinte ${numbers.get(item.id) ?? ""}` });
      walk(item.children);
    }
  };

  walk(items);

  return options;
}

function lowerFirst(text: string) {
  return text ? text.charAt(0).toLocaleLowerCase("pt-BR") + text.slice(1) : text;
}

function upperFirst(text: string) {
  return text ? text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) : text;
}

/** "1 dia depois do envio" / "3 horas antes de vencer" / "... da anterior". */
export function followUpWhenLabel(when: { anchor: FollowUpAnchor; minutes: number }, level: FollowUpLevel) {
  const anchor = whenAnchorOptions(level).find((option) => option.value === when.anchor)?.label ?? "";
  const amount = Number.isFinite(when.minutes) && when.minutes > 0 ? validityDurationLabel(when.minutes) : "—";

  return `${amount} ${anchor}`;
}

/** "para quem viu no sino, mas não abriu" / "para todos que receberam" / "para alunos que ..." (regras). */
export function followUpAudienceLabel(item: Pick<FollowUpFormItem, "choice" | "productId" | "rules">, parent: Pick<FollowUpParent, "nodeId">, names: AudienceNames) {
  if (item.choice === "everyone") {
    return "para todos que receberam";
  }

  if (item.choice === "rules") {
    return `para ${lowerFirst(describeAudience(normalizeAudience(whoOfItem(item, parent)), names))}`;
  }

  const label = QUICK_CHOICE_COPY[item.choice].label;

  if (quickChoiceNeedsProduct(item.choice)) {
    const product = item.productId ? (names.products[item.productId] ?? "um produto removido") : "um produto";

    return `para quem ${label} ${product}`;
  }

  return `para quem ${label}`;
}

/** Resumo do cabecalho: "1 dia depois do envio · para quem viu no sino, mas não abriu". */
export function followUpSummary(item: FollowUpFormItem, parent: FollowUpParent, names: AudienceNames) {
  return `${followUpWhenLabel(item.when, parent.level)} · ${followUpAudienceLabel(item, parent, names)}`;
}

/** "Até a notificação principal sumir" / "Até a notificação anterior sumir" (opcao de "Fica no sino por"). */
export function followUpValidityAnchorLabel(level: FollowUpLevel) {
  return level === "main" ? "Até a notificação principal sumir" : "Até a notificação anterior sumir";
}

/** "Fica 3 dias no sino" / "Fica no sino até a principal sumir" (linha compacta do conteudo). */
export function followUpValidityLine(validity: FlowValidity, level: FollowUpLevel) {
  return upperFirst(describeValidity(validity, { anchorLabel: level === "main" ? "a principal" : "a anterior" }));
}

/**
 * Fim da notificacao de cima na previa da seguinte (que chega "agora"): "antes de vencer" = a de cima some
 * daqui a X; "depois do envio" = chegou ha X e fica o tempo dela no sino (sem tempo conhecido: null).
 */
export function followUpPreviewAnchorExpiry(when: { anchor: FollowUpAnchor; minutes: number }, parent: Pick<FollowUpParent, "validityMinutes">, now: number): number | null {
  if (!Number.isFinite(when.minutes) || when.minutes <= 0) {
    return null;
  }

  if (when.anchor === "expires") {
    return now + when.minutes * 60_000;
  }

  return parent.validityMinutes === null ? null : now + (parent.validityMinutes - when.minutes) * 60_000;
}

/* ------------------------------------------------------------------------------------------------
 * "Parar ... para quem tiver acesso a [produto]" <-> objetivo do fluxo do aviso
 * ---------------------------------------------------------------------------------------------- */

/**
 * A linha do topo do cartao. `other`: o objetivo foi mudado no construtor para algo que nao e uma regra
 * "têm acesso a" so (o cartao mostra "Param para quem: ..." com "Editar no fluxo").
 */
export type FollowUpStopLine = { enabled: boolean; kind: "product"; productId: string | null } | { goal: AudienceDefinition; kind: "other" };

/** O objetivo gravado: `{ kind: "rules", root: { match: "all", items: [product has [Y]] } }`. */
export function stopGoalDefinition(productId: string): AudienceDefinition {
  return { kind: "rules", root: { items: [{ op: "has", productIds: [productId], type: "product" }], match: "all" } };
}

export function stopLineOfGoal(goal: AudienceDefinition | null): FollowUpStopLine {
  if (!goal) {
    return { enabled: false, kind: "product", productId: null };
  }

  const normalized = normalizeAudience(goal);

  if (normalized.kind === "rules" && normalized.root.items.length === 1) {
    const [rule] = normalized.root.items;

    if ("type" in rule && rule.type === "product" && rule.op === "has" && rule.productIds.length === 1) {
      return { enabled: true, kind: "product", productId: rule.productIds[0] };
    }
  }

  return { goal, kind: "other" };
}

/**
 * O `goal` de saveNoticeFollowUps. Marcada sem produto manda `productId: ""`, para o zod dizer "Escolha o
 * produto."; "other" manda null (o servidor guarda o objetivo do construtor).
 */
export function goalOfStopLine(stop: FollowUpStopLine): { productId: string } | null {
  if (stop.kind !== "product" || !stop.enabled) {
    return null;
  }

  return { productId: stop.productId ?? "" };
}

/**
 * A linha quando a primeira seguinte e adicionada: o botao do aviso abre um produto -> marcada com ele;
 * senao, desmarcada.
 */
export function initialStopLine(noticeCtaHref: string | null | undefined): FollowUpStopLine {
  const productId = ctaProductId(noticeCtaHref);

  return { enabled: productId !== null, kind: "product", productId };
}

/** "Quem já tem ou ganhar acesso a Formação IA não recebe as notificações seguintes." */
export function stopLineHint(productName: string | null) {
  return productName ? `Quem já tem ou ganhar acesso a ${productName} não recebe as notificações seguintes.` : "Escolha o produto.";
}

/** Nome do produto da linha (frase de revisao: ", que param para quem tiver acesso a X"). */
export function stopProductName(stop: FollowUpStopLine, names: AudienceNames): string | null {
  return stop.kind === "product" && stop.enabled && stop.productId ? (names.products[stop.productId] ?? null) : null;
}

/* ------------------------------------------------------------------------------------------------
 * Contagem ao vivo
 * ---------------------------------------------------------------------------------------------- */

export type FollowUpCountState =
  | { status: "error" }
  | { status: "loading" }
  | { qualified: number | null; recipients: number; status: "ready" }
  | { status: "waiting" };

export const FOLLOW_UP_COUNT_ERROR = "Não foi possível contar agora.";
export const FOLLOW_UP_COUNT_WAITING = "A contagem aparece depois do envio.";

/** "Agora, 120 dos 318 que receberam se encaixam." / antes do envio / erro (com "Tentar de novo"). */
export function followUpCountCopy(state: FollowUpCountState): string | null {
  switch (state.status) {
    case "waiting":
      return FOLLOW_UP_COUNT_WAITING;
    case "error":
      return FOLLOW_UP_COUNT_ERROR;
    case "ready":
      return state.qualified === null ? FOLLOW_UP_COUNT_WAITING : `Agora, ${formatInteger(state.qualified)} dos ${formatInteger(state.recipients)} que receberam se encaixam.`;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Lista: achar, mudar, remover, duplicar e os limites
 * ---------------------------------------------------------------------------------------------- */

export type FollowUpLocation = {
  depth: number;
  item: FollowUpFormItem;
  /** null = a notificacao principal. */
  parentItem: FollowUpFormItem | null;
  siblings: readonly FollowUpFormItem[];
};

export function findFollowUp(items: readonly FollowUpFormItem[], id: string): FollowUpLocation | null {
  const walk = (list: readonly FollowUpFormItem[], parentItem: FollowUpFormItem | null, depth: number): FollowUpLocation | null => {
    for (const item of list) {
      if (item.id === id) {
        return { depth, item, parentItem, siblings: list };
      }

      const found = walk(item.children, item, depth + 1);

      if (found) {
        return found;
      }
    }

    return null;
  };

  return walk(items, null, 1);
}

export function countFollowUps(items: readonly Pick<FollowUpFormItem, "children">[]): number {
  return items.reduce((total, item) => total + 1 + countFollowUps(item.children), 0);
}

export function updateFollowUp(items: readonly FollowUpFormItem[], id: string, update: (item: FollowUpFormItem) => FollowUpFormItem): FollowUpFormItem[] {
  return items.map((item) => (item.id === id ? update(item) : { ...item, children: updateFollowUp(item.children, id, update) }));
}

/** Tira a seguinte e as que dependem dela. */
export function removeFollowUp(items: readonly FollowUpFormItem[], id: string): FollowUpFormItem[] {
  return items.filter((item) => item.id !== id).map((item) => ({ ...item, children: removeFollowUp(item.children, id) }));
}

/** Acrescenta no fim da lista da principal (`parentId` null) ou de uma seguinte. */
export function appendFollowUp(items: readonly FollowUpFormItem[], parentId: string | null, child: FollowUpFormItem): FollowUpFormItem[] {
  if (parentId === null) {
    return [...items, child];
  }

  return items.map((item) => (item.id === parentId ? { ...item, children: [...item.children, child] } : { ...item, children: appendFollowUp(item.children, parentId, child) }));
}

/** Troca os ids de passo dentro das regras (copia com ids novos: "Duplicar" e "duplicar aviso"). */
export function remapNodeRefs(definition: AudienceDefinition, ids: ReadonlyMap<string, string>): AudienceDefinition {
  if (definition.kind !== "rules") {
    return definition;
  }

  const id = (value: string) => ids.get(value) ?? value;
  const node = (item: AudienceNode): AudienceNode => {
    if ("items" in item) {
      return { ...item, items: item.items.map(node) };
    }

    switch (item.type) {
      case "message":
        return item.ref.kind === "node" ? { ...item, ref: { kind: "node", nodeId: id(item.ref.nodeId) } } : item;
      case "page_visit":
        return {
          ...item,
          page: item.page.kind === "message_cta" ? { kind: "message_cta", nodeId: id(item.page.nodeId) } : item.page,
          since: item.since.kind === "message" ? { kind: "message", nodeId: id(item.since.nodeId) } : item.since
        };
      case "access_gained":
        return item.since.kind === "message" ? { ...item, since: { kind: "message", nodeId: id(item.since.nodeId) } } : item;
      default:
        return item;
    }
  };

  return { kind: "rules", root: { ...definition.root, items: definition.root.items.map(node) } };
}

/**
 * "Duplicar": a mesma seguinte (e as dela) logo depois, com ids novos e o conteudo como nova versao. As
 * regras que citavam a seguinte copiada passam a citar a copia.
 */
export function duplicateFollowUp(items: readonly FollowUpFormItem[], id: string, newId: () => string): { copyId: string | null; items: FollowUpFormItem[] } {
  const ids = new Map<string, string>();
  const collect = (item: FollowUpFormItem) => {
    ids.set(item.id, newId());
    item.children.forEach(collect);
  };
  const copy = (item: FollowUpFormItem): FollowUpFormItem => ({
    ...item,
    campaignId: "",
    children: item.children.map(copy),
    content: structuredClone(item.content),
    id: ids.get(item.id) ?? item.id,
    rules: remapNodeRefs(item.rules, ids)
  });
  let copyId: string | null = null;

  const insert = (list: readonly FollowUpFormItem[]): FollowUpFormItem[] =>
    list.flatMap((item) => {
      if (item.id === id) {
        collect(item);
        const duplicated = copy(item);
        copyId = duplicated.id;

        return [item, duplicated];
      }

      return [{ ...item, children: insert(item.children) }];
    });

  const next = insert(items);

  return { copyId, items: next };
}

/** Motivo para nao acrescentar outra seguinte aqui (null = pode): 5 por notificacao, 3 niveis, 20 no total. */
export function addFollowUpProblem(items: readonly FollowUpFormItem[], parentId: string | null): string | null {
  if (countFollowUps(items) >= FLOW_LIMITS.maxNodes) {
    return FOLLOW_UP_LIMIT_MESSAGES.total;
  }

  if (parentId === null) {
    return items.length >= FLOW_LIMITS.followUpsPerNotice ? FOLLOW_UP_LIMIT_MESSAGES.perLevel : null;
  }

  const location = findFollowUp(items, parentId);

  if (!location) {
    return null;
  }

  if (!canNestFollowUp(location.depth)) {
    return FOLLOW_UP_LIMIT_MESSAGES.depth;
  }

  return location.item.children.length >= FLOW_LIMITS.followUpsPerNotice ? FOLLOW_UP_LIMIT_MESSAGES.perLevel : null;
}

/**
 * "Adicionar notificação seguinte a esta" so enquanto a profundidade fica abaixo de 3 niveis contando a
 * principal: nivel 1 = a principal, `depth` 1 = seguinte dela (nivel 2), `depth` 2 = seguinte da seguinte
 * (nivel 3, o ultimo).
 */
export function canNestFollowUp(depth: number) {
  return depth < FLOW_LIMITS.followUpDepth - 1;
}

/* ------------------------------------------------------------------------------------------------
 * Cartao <-> o que a Server Action recebe e o que o servidor devolve
 * ---------------------------------------------------------------------------------------------- */

/** A notificacao de cima de cada seguinte (a principal ou a seguinte de cima). */
export function parentOfItem(location: Pick<FollowUpLocation, "parentItem">, main: FollowUpParent): FollowUpParent {
  return location.parentItem ? followUpParentOf(location.parentItem.id, "previous", location.parentItem.content) : main;
}

/**
 * Escolha rapida que a notificacao de cima nao oferece mais (o audio, o destino, a enquete, as reacoes ou o texto longo sairam
 * depois): erro no "Para quem" em vez de gravar uma regra que ninguem satisfaz (ou que vale para todos).
 */
export function followUpChoiceErrors(items: readonly FollowUpFormItem[], main: FollowUpParent): Record<string, string> {
  const errors: Record<string, string> = {};
  const walk = (list: readonly FollowUpFormItem[], parent: FollowUpParent, prefix: string) => {
    list.forEach((item, index) => {
      const path = `${prefix}.${index}`;

      if (!quickChoicesFor(parent).includes(item.choice)) {
        errors[`${path}.who`] = FOLLOW_UPS_COPY.staleChoice;
      }

      walk(item.children, followUpParentOf(item.id, "previous", item.content), `${path}.children`);
    });
  };

  walk(items, main, "followUps");

  return errors;
}

/** As seguintes como saveNoticeFollowUps recebe (o "Para quem" ja em regras). */
export function followUpDraftsOf(items: readonly FollowUpFormItem[], main: FollowUpParent): FollowUpDraft[] {
  const toDraft = (item: FollowUpFormItem, parent: FollowUpParent): FollowUpDraft => ({
    children: item.children.map((child) => toDraft(child, followUpParentOf(item.id, "previous", item.content))),
    content: item.content,
    id: item.id,
    when: { anchor: item.when.anchor, minutes: item.when.minutes },
    who: normalizeAudience(whoOfItem(item, parent))
  });

  return items.map((item) => toDraft(item, main));
}

/**
 * O que o editor grava depois do aviso: as seguintes da notificacao; trocar o Tipo para pop-up grava
 * `followUps: []` (o fluxo do aviso, ainda rascunho, sai). Voltar para notificacao antes de salvar traz as
 * seguintes de volta, porque continuam no estado do formulario.
 */
export function followUpsToSave(kind: "inbox" | "popup", items: readonly FollowUpFormItem[], main: FollowUpParent): FollowUpDraft[] {
  return kind === "popup" ? [] : followUpDraftsOf(items, main);
}

/** Uma seguinte gravada (getNoticeDetail.followUps): o conteudo ja traz "with_anchor" quando some com a de cima. */
export type SavedFollowUp = {
  campaignId: string;
  children: SavedFollowUp[];
  content: FlowNoticeContent;
  id: string;
  when: { anchor: FollowUpAnchor; minutes: number };
  who: AudienceDefinition;
};

/** Gravado -> cartao: cada "Para quem" reabre na escolha rapida igual, ou em "escolher por regras". */
export function followUpFormItemsOf(saved: readonly SavedFollowUp[], main: FollowUpParent): FollowUpFormItem[] {
  const toItem = (followUp: SavedFollowUp, parent: FollowUpParent): FollowUpFormItem => {
    const { choice, productId } = quickChoiceOfRules(followUp.who, parent);

    return {
      campaignId: followUp.campaignId,
      children: followUp.children.map((child) => toItem(child, followUpParentOf(followUp.id, "previous", followUp.content))),
      choice,
      content: followUp.content,
      id: followUp.id,
      productId,
      rules: followUp.who.kind === "rules" ? followUp.who : { kind: "rules", root: { items: [], match: "all" } },
      when: followUp.when
    };
  };

  return saved.map((followUp) => toItem(followUp, main));
}

/** Chave estavel do que o cartao manda (dirty: mudou algo desde a ultima gravacao?). */
export function followUpsStateKey(items: readonly FollowUpFormItem[], stop: FollowUpStopLine, main: FollowUpParent) {
  return stableJson({ followUps: followUpDraftsOf(items, main), goal: stop.kind === "product" ? goalOfStopLine(stop) : "other" });
}

/** Seguintes -> FollowUp de flow-model (treeFromFollowUps). */
export function followUpsOfDrafts(drafts: readonly FollowUpDraft[]): FollowUp[] {
  return drafts.map((draft) => ({
    campaignId: "",
    children: followUpsOfDrafts(draft.children),
    expireWithAnchor: draft.content.validity.mode === "with_anchor",
    id: draft.id,
    when: draft.when,
    who: draft.who
  }));
}

/** Conteudo -> o que validateFlowTree confere de cada notificacao (v3a: reacoes e enquete tambem). */
export function flowMetaOfContent(content: Pick<FlowNoticeContent, "audio" | "cta" | "poll" | "reactions" | "response" | "title" | "validity">): FlowMessageMeta {
  const columns = validityToColumns(content.validity);

  return {
    allowsReactions: content.reactions === true,
    campaignId: "",
    ctaHref: content.cta?.href ?? null,
    hasAudio: Boolean(content.audio),
    hasCta: Boolean(content.cta),
    hasPoll: Boolean(content.poll),
    hasResponse: Boolean(content.response),
    pollOptionIds: content.poll?.options.map((option) => option.id) ?? [],
    title: content.title,
    validUntil: columns.valid_until,
    validityMinutes: columns.validity_minutes
  };
}

/** Caminho do cartao de cada seguinte ("followUps.0.children.1"), o mesmo dos erros do zod. */
export function followUpPaths(items: readonly FollowUpTreeNode[]): Map<string, string> {
  const paths = new Map<string, string>();
  const walk = (list: readonly FollowUpTreeNode[], prefix: string) => {
    list.forEach((item, index) => {
      const path = `${prefix}.${index}`;
      paths.set(item.id, path);
      walk(item.children, `${path}.children`);
    });
  };

  walk(items, "followUps");

  return paths;
}

/**
 * Erro de um campo do cartao pelo caminho ("followUps.0.when.minutes"), ou o primeiro de dentro dele
 * ("followUps.0.who" acha "followUps.0.who.root.items.1.productIds").
 */
export function followUpErrorAt(errors: Readonly<Record<string, string>>, path: string): string | undefined {
  if (errors[path]) {
    return errors[path];
  }

  const key = Object.keys(errors).find((candidate) => candidate.startsWith(`${path}.`));

  return key ? errors[key] : undefined;
}

/** Campo do passo (validateFlowTree) -> campo do cartao. */
const ISSUE_FIELDS: Record<string, string> = { anchorNodeId: "when.anchor", filter: "who", offsetMinutes: "when.minutes" };

/**
 * A mesma conferencia do servidor (validateFlowTree) sobre o cartao, com os erros no caminho de cada campo
 * ("followUps.0.when.minutes": "Escolha de 5 minutos a 60 dias."). So os que impedem gravar.
 */
export function followUpTreeErrors(input: {
  drafts: readonly FollowUpDraft[];
  entryId: string;
  notice: Pick<FlowNoticeContent, "audio" | "cta" | "poll" | "reactions" | "response" | "title" | "validity">;
}): Record<string, string> {
  const nodes = treeFromFollowUps(input.entryId, followUpsOfDrafts(input.drafts));
  const messages: Record<string, FlowMessageMeta> = { [input.entryId]: flowMetaOfContent(input.notice) };
  const walk = (list: readonly FollowUpDraft[]) => {
    for (const draft of list) {
      messages[draft.id] = flowMetaOfContent(draft.content);
      walk(draft.children);
    }
  };

  walk(input.drafts);

  const paths = followUpPaths(input.drafts);
  const errors: Record<string, string> = {};

  for (const issue of validateFlowTree({ nodes, origin: "notice" }, messages)) {
    if (issue.level !== "save") {
      continue;
    }

    const base = issue.nodeId ? paths.get(issue.nodeId) : undefined;
    const key = base ? `${base}${issue.field && ISSUE_FIELDS[issue.field] ? `.${ISSUE_FIELDS[issue.field]}` : ""}` : "followUps";
    errors[key] ??= issue.message;
  }

  return errors;
}

/**
 * Passos citados pelas regras das seguintes que nao sao seguintes: a notificacao principal (a entrada), com o
 * id que o navegador usou enquanto o fluxo ainda nao existia.
 */
export function foreignNodeRefs(drafts: readonly FollowUpDraft[]): string[] {
  const followUpIds = new Set<string>();
  const foreign = new Set<string>();
  const collect = (list: readonly FollowUpDraft[]) => {
    for (const draft of list) {
      followUpIds.add(draft.id);
      collect(draft.children);
    }
  };
  const scan = (node: AudienceNode) => {
    if ("items" in node) {
      node.items.forEach(scan);
      return;
    }

    nodeRefsOfRule(node).forEach((ref) => foreign.add(ref));
  };
  const scanAll = (list: readonly FollowUpDraft[]) => {
    for (const draft of list) {
      if (draft.who.kind === "rules") {
        draft.who.root.items.forEach(scan);
      }

      scanAll(draft.children);
    }
  };

  collect(drafts);
  scanAll(drafts);

  return Array.from(foreign).filter((ref) => !followUpIds.has(ref));
}

/**
 * Remapeia para a entrada gravada toda referencia a um passo que nao e seguinte (o navegador ainda nao
 * conhecia o id da entrada de um fluxo que nao existia).
 */
export function remapEntryRefs(drafts: readonly FollowUpDraft[], entryId: string): FollowUpDraft[] {
  const foreign = new Map(foreignNodeRefs(drafts).filter((ref) => ref !== entryId).map((ref) => [ref, entryId] as const));
  const apply = (list: readonly FollowUpDraft[]): FollowUpDraft[] =>
    list.map((draft) => ({ ...draft, children: apply(draft.children), who: remapNodeRefs(draft.who, foreign) }));

  return foreign.size === 0 ? [...drafts] : apply(drafts);
}

/** Passos citados por uma regra (notificacao, pagina do destino e "desde"). */
function nodeRefsOfRule(rule: AudienceRule): string[] {
  switch (rule.type) {
    case "message":
      return rule.ref.kind === "node" ? [rule.ref.nodeId] : [];
    case "page_visit":
      return [...(rule.page.kind === "message_cta" ? [rule.page.nodeId] : []), ...(rule.since.kind === "message" ? [rule.since.nodeId] : [])];
    case "access_gained":
      return rule.since.kind === "message" ? [rule.since.nodeId] : [];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------------------------------------
 * Situacao da secao (editor, relatorio no ar, so leitura)
 * ---------------------------------------------------------------------------------------------- */

export type FollowUpsMode =
  | { kind: "edit" }
  | { kind: "live" }
  | { kind: "readonly"; note: string | null; reason: "builder" | "finished" | "large" | "permission" | "withdrawn" };

/**
 * Rascunho, agendado ou aguardando aprovacao: o editor. Depois do envio, no relatorio: no ar para quem pode
 * publicar (e publicar para muitos acima de 500); so leitura quando a notificacao foi retirada, quando o
 * fluxo terminou (todas as linhas sairam do sino) ou quando o construtor mudou o fluxo para algo que o
 * cartao nao desenha.
 */
export function followUpsModeOf(input: {
  canPublish: boolean;
  canPublishLarge: boolean;
  drawable: boolean;
  flowEndedReason: FlowEndedReason | null;
  flowStatus: FlowStatus | null;
  noticeStatus: string;
  recipients: number | null;
}): FollowUpsMode {
  if (!input.drawable) {
    return { kind: "readonly", note: FOLLOW_UPS_COPY.builderOnly, reason: "builder" };
  }

  if (input.noticeStatus === "draft" || input.noticeStatus === "pending_approval" || input.noticeStatus === "scheduled") {
    return { kind: "edit" };
  }

  if (input.noticeStatus === "canceled" || (input.flowStatus === "ended" && input.flowEndedReason !== "finished")) {
    return { kind: "readonly", note: null, reason: "withdrawn" };
  }

  if (input.flowStatus === "ended") {
    return { kind: "readonly", note: FOLLOW_UPS_COPY.finished, reason: "finished" };
  }

  if (!input.canPublish) {
    return { kind: "readonly", note: FOLLOW_UPS_COPY.needsPublish, reason: "permission" };
  }

  if ((input.recipients ?? 0) > 500 && !input.canPublishLarge) {
    return { kind: "readonly", note: FOLLOW_UPS_COPY.needsPublishLarge, reason: "large" };
  }

  return { kind: "live" };
}

/* ------------------------------------------------------------------------------------------------
 * Confirmacoes
 * ---------------------------------------------------------------------------------------------- */

export type FollowUpConfirmCopy = { confirmLabel: string; description: string; title: string };

/**
 * Remover uma seguinte. No rascunho: "Remover esta notificação seguinte?"; no ar, com gente esperando por
 * ela: "Remover “Faltam 3 horas”?" com quantos param.
 */
export function removeFollowUpConfirm(input: { live: boolean; title: string; waiting: number }): FollowUpConfirmCopy {
  if (input.live && input.waiting > 0) {
    const students = input.waiting === 1 ? "1 aluno está esperando" : `${formatInteger(input.waiting)} alunos estão esperando`;

    return {
      confirmLabel: "Remover",
      description: `${students} por ela e não recebem mais. Quem já recebeu continua com ela no sino.`,
      title: `Remover “${input.title.trim() || "Sem título"}”?`
    };
  }

  return { confirmLabel: "Remover", description: "As notificações seguintes que dependem dela saem junto.", title: "Remover esta notificação seguinte?" };
}

/** Trocar o Tipo para pop-up com seguintes. */
export function popupSwitchConfirm(count: number): FollowUpConfirmCopy {
  return {
    confirmLabel: "Mudar",
    description: count === 1 ? "Mudar para pop-up remove a notificação seguinte." : `Mudar para pop-up remove as ${formatInteger(count)} notificações seguintes.`,
    title: "Mudar para pop-up?"
  };
}

/** Chip da lista ao lado do tipo: "+2 seguintes" / "+1 seguinte". */
export function followUpsChip(count: number) {
  return count === 1 ? "+1 seguinte" : `+${formatInteger(count)} seguintes`;
}

/** Caixa do "Retirar do sino" de um aviso com seguintes: "Retirar também as notificações seguintes que já saíram (120)". */
export function withdrawFollowUpsLabel(sent: number) {
  return `Retirar também as notificações seguintes que já saíram (${formatInteger(sent)})`;
}

/* ------------------------------------------------------------------------------------------------
 * Numeros de cada seguinte no relatorio
 * ---------------------------------------------------------------------------------------------- */

export type FollowUpStats = {
  audio_completed: number;
  audio_started: number;
  accepted: number;
  cap: number;
  clicked: number;
  declined: number;
  expired: number;
  failed: number;
  filtered: number;
  goal: number;
  opened: number;
  reached: number;
  /** v3a: reagiram e votaram (communication_message_interactions do passo; ausente = 0). */
  reacted?: number;
  received: number;
  removed: number;
  seen: number;
  voted?: number;
  waiting: number;
};

/**
 * "Chegaram · Esperando · Receberam · Viram no sino · Abriram ..." (o que a notificacao tem: audio, destino,
 * resposta, enquete e reacoes), e "Não receberam".
 */
export function followUpNumberRows(stats: FollowUpStats | null | undefined, content: Pick<FlowNoticeContent, "audio" | "cta" | "poll" | "reactions" | "response">) {
  const value = (key: keyof FollowUpStats) => (stats ? formatInteger(stats[key] ?? 0) : "—");
  const rows: { label: string; value: string }[] = [
    { label: "Chegaram", value: value("reached") },
    { label: "Esperando", value: value("waiting") },
    { label: "Receberam", value: value("received") },
    { label: "Viram no sino", value: value("seen") },
    { label: "Abriram", value: value("opened") }
  ];

  if (content.audio) {
    rows.push({ label: "Começaram o áudio", value: value("audio_started") }, { label: "Ouviram até o fim", value: value("audio_completed") });
  }

  if (content.cta) {
    rows.push({ label: "Foram para o destino", value: value("clicked") });
  }

  if (content.response) {
    rows.push({ label: "Aceitaram", value: value("accepted") }, { label: "Recusaram", value: value("declined") });
  }

  if (content.poll) {
    rows.push({ label: "Votaram", value: value("voted") });
  }

  if (content.reactions) {
    rows.push({ label: "Reagiram", value: value("reacted") });
  }

  // Chegaram = Esperando + Receberam + Não receberam: as que falharam tambem contam aqui.
  const failed = stats?.failed ?? 0;
  const missed = stats ? stats.filtered + stats.goal + stats.expired + stats.cap + stats.removed + failed : 0;

  if (stats && missed > 0) {
    const parts = [
      stats.filtered > 0 ? `fora do filtro ${formatInteger(stats.filtered)}` : null,
      stats.goal > 0 ? `atingiram o objetivo antes ${formatInteger(stats.goal)}` : null,
      stats.expired > 0 ? `venceu o prazo ${formatInteger(stats.expired)}` : null,
      stats.cap > 0 ? `limite do dia ${formatInteger(stats.cap)}` : null,
      stats.removed > 0 ? `${REMOVED_REASON_LABEL} ${formatInteger(stats.removed)}` : null,
      failed > 0 ? `falharam ${formatInteger(failed)}` : null
    ].filter(Boolean);

    rows.push({ label: "Não receberam", value: `${formatInteger(missed)} (${parts.join(" · ")})` });
  }

  return rows;
}
