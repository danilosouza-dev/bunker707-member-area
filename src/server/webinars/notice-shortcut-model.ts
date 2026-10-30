// Avisar › Aviso no sino e Pop-up (docs/30 §2.2; docs/28 D5): os atalhos do card Avisar do editor do webinario abrem
// o editor da Comunicacao com um aviso NOVO ja preenchido, pelo mesmo caminho do "Usar" de um modelo (o `start` do
// NoticeEditor, lido so na montagem): /admin/comunicacao/avisos/novo?webinario=<id>&tipo=notificacao|popup. A pagina
// le o webinario salvo no servidor e monta o rascunho com webinarNoticeStart; nada e gravado ate "Salvar rascunho"
// ou "Publicar".
//
// O mesmo endereco serve o "Avisar quem não veio" do relatorio (docs/30 §3.4): com &seguimento=<acoes>
// (registered,nao-attended), o aviso comeca em branco com as regras "Participação em lives" da live no "Para quem"
// (todas valendo), sem ler o webinario. Um endereco (webinarNoticeHref) e um parse (webinarNoticeRequestOf) para os
// dois botoes.
//
// Aqui ficam as pecas puras: o endereco, o parse, o "Quem pode" do webinario traduzido para o segmento da
// Comunicacao (dentro de AUDIENCE_LIMITS: um grupo dentro do principal e ate 20 regras), os motivos para o atalho
// ficar desligado e o rascunho do aviso. Modulo puro (sem React, sem "server-only", imports relativos):
// tests/webinarios-avisar.test.mjs carrega direto pelo Node. Nunca importa editor-model.ts (que importa daqui).

import { SEGUIMENTO_COPY } from "../../lib/webinar-copy-v4/seguimento";
import { formatWebinarWhen } from "../../lib/webinar-time";
import {
  AUDIENCE_LIMITS,
  EVERYONE,
  audienceDepth,
  countAudienceRules,
  isAudienceGroup,
  normalizeAudience,
  WEBINAR_RULE_ACTIONS,
  type AudienceDefinition,
  type AudienceGroup,
  type AudienceNode,
  type AudienceRule,
  type WebinarRuleAction
} from "../communications/audience-model";
import { NOTICE_LIMITS, type CampaignKind } from "../communications/campaign-model";
import { defaultPopupSettings } from "../communications/popup-display-model";
import { emptyNoticeDraft, type NoticeDraft } from "../communications/schemas";
import { emptyTemplateStart, type NoticeStart } from "../communications/template-model";
import { nextSession, sessionEndsAt, toTime, webinarHref, type AccessMode, type WebinarSession, type WebinarSituation, type WebinarStatus } from "./model";

/* ------------------------------------------------------------------------------------------------
 * Frases (passam por PROIBIDAS_WEBINARIO e pelas listas da Comunicacao: sem "sessão", "lembrete" e "público")
 * ---------------------------------------------------------------------------------------------- */

export const WEBINAR_NOTICE_COPY = {
  /** Por que os atalhos estao desligados (uma frase so, embaixo dos dois). */
  blocked: {
    audience: `As regras de Quem pode não cabem num aviso (até ${AUDIENCE_LIMITS.maxRules} regras e um grupo dentro do principal). Crie o aviso direto na Comunicação.`,
    cancelled: "A live foi cancelada.",
    dirty: "Salve as mudanças antes de avisar: o aviso usa o webinário salvo.",
    draft: "Publique o webinário para avisar.",
    ended: "A live já terminou.",
    product: "Escolha o produto em Quem pode.",
    write: "Só quem cria avisos na Comunicação usa estes atalhos."
  },
  /** O botao do aviso no sino (a live mais adiante) e o do pop-up na hora da live. */
  ctaEnter: "Entrar na live",
  ctaSee: "Ver a live",
  inbox: {
    bodyLive: "Estamos ao vivo agora. Entre pela página da live.",
    bodyNoDate: "Veja os detalhes na página da live.",
    bodyOpen: (when: string) => `${when}. Na hora, é só entrar pela página da live.`,
    bodySeat: (when: string) => `${when}. Garanta sua vaga na página da live.`,
    title: (title: string) => `Live: ${title}`
  },
  popup: {
    body: "A live começou. Clique para entrar.",
    title: (title: string) => `Ao vivo agora: ${title}`
  },
  /** As notas do topo do editor do aviso (somem no primeiro salvar, como as do "Usar" de um modelo). */
  notes: {
    popupWindow: "Começa e Termina seguem a hora da live. Mude se quiser avisar antes.",
    startFrom: (title: string) => `Você começou pelo webinário “${title}”. Nada foi salvo ainda.`
  }
} as const;

/* ------------------------------------------------------------------------------------------------
 * Endereco: o card Avisar e o "Avisar quem não veio" (um endereco, um parse)
 * ---------------------------------------------------------------------------------------------- */

/** O "Novo aviso" da Comunicacao (o mesmo NEW_NOTICE_HREF de notices-view-model.ts; o teste confere os dois). */
export const WEBINAR_NOTICE_NEW_HREF = "/admin/comunicacao/avisos/novo";
/** ?webinario=<id> do "Novo aviso": o aviso comeca da live (o ?modelo= vence quando os dois vem). */
export const WEBINAR_NOTICE_PARAM = "webinario";
/** ?seguimento=<acoes> (com o ?webinario=): o aviso em branco com estas regras da live no "Para quem". */
export const WEBINAR_FOLLOW_UP_PARAM = "seguimento";
/** Os valores do ?tipo= que parseNoticeKindParam le. */
const KIND_PARAM: Record<CampaignKind, string> = { inbox: "notificacao", popup: "popup" };
/** O ?origem= do botao (a vaga guarda em webinar_registrations.source; o relatorio mostra em "Link de origem"). */
export const WEBINAR_NOTICE_ORIGINS: Record<CampaignKind, string> = { inbox: "sino", popup: "pop-up" };

/** O prefixo da acao negada no ?seguimento= ("nao-attended" = não participou). */
const NEGATED_PREFIX = "nao-";
/** Regras no maximo por endereco (o "Para quem" continua editavel). */
const MAX_FOLLOW_UP_STEPS = 4;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Uma regra "Participação em lives" que o endereco pede, na live do ?webinario=. */
export type WebinarNoticeStep = { action: WebinarRuleAction; negate: boolean };

/** "Avisar quem não veio" (o bloco Vagas do relatorio): garantiu vaga E não participou. */
export const WEBINAR_ABSENTEES: readonly WebinarNoticeStep[] = [
  { action: "registered", negate: false },
  { action: "attended", negate: true }
];

/**
 * O "Novo aviso" que comeca da live: sem `steps`, o card Avisar (?webinario=<id>&tipo=notificacao|popup, o aviso
 * preenchido pelo webinario salvo); com `steps`, o "Avisar quem não veio" (o mesmo endereco com &seguimento=, o aviso em
 * branco com as regras no "Para quem").
 */
export function webinarNoticeHref(webinarId: string, kind: CampaignKind, steps: readonly WebinarNoticeStep[] = []) {
  const query = new URLSearchParams({ [WEBINAR_NOTICE_PARAM]: webinarId, tipo: KIND_PARAM[kind] });

  if (steps.length > 0) {
    query.set(WEBINAR_FOLLOW_UP_PARAM, steps.map((step) => `${step.negate ? NEGATED_PREFIX : ""}${step.action}`).join(","));
  }

  return `${WEBINAR_NOTICE_NEW_HREF}?${query.toString()}`;
}

type ParamValue = string | string[] | undefined;

/** O que o ?webinario= do "Novo aviso" pede (o ?tipo= a pagina le com parseNoticeKindParam). */
export type WebinarNoticeRequest =
  /** O card Avisar: o aviso preenchido pelo webinario salvo (prepareWebinarNoticeStart). */
  | { mode: "webinar"; webinarId: string }
  /** "Avisar quem não veio": o aviso em branco com estas regras no "Para quem", sem ler o webinario. */
  | { audience: AudienceDefinition; mode: "rules"; webinarId: string }
  /** ?seguimento= que nao vale (id que nao e uuid, acao fora da lista, repetida, vazia ou mais de 4): o aviso em branco. */
  | { mode: "blank" };

/**
 * O parse do ?webinario= para os dois botoes. Sem ?webinario= (vazio ou repetido): null (o "Novo aviso" de sempre). Sem
 * ?seguimento=: o card Avisar. Com ele: as regras pedidas, cada uma na live do endereco, no grupo principal "todas".
 */
export function webinarNoticeRequestOf(params: Record<string, ParamValue>): WebinarNoticeRequest | null {
  const raw = params[WEBINAR_NOTICE_PARAM];
  const webinarId = typeof raw === "string" ? raw.trim() : "";

  if (!webinarId) {
    return null;
  }

  const follow = params[WEBINAR_FOLLOW_UP_PARAM];

  if (follow === undefined) {
    return { mode: "webinar", webinarId };
  }

  const id = webinarId.toLowerCase();
  const parts = typeof follow === "string" ? follow.split(",").map((part) => part.trim()) : [];

  if (!UUID_PATTERN.test(id) || parts.length === 0 || parts.length > MAX_FOLLOW_UP_STEPS) {
    return { mode: "blank" };
  }

  const steps: WebinarNoticeStep[] = [];

  for (const part of parts) {
    const negate = part.startsWith(NEGATED_PREFIX);
    const action = negate ? part.slice(NEGATED_PREFIX.length) : part;

    if (!(WEBINAR_RULE_ACTIONS as readonly string[]).includes(action) || steps.some((step) => step.action === action)) {
      return { mode: "blank" };
    }

    steps.push({ action: action as WebinarRuleAction, negate });
  }

  return {
    audience: { kind: "rules", root: { items: steps.map((step) => ({ action: step.action, negate: step.negate, type: "webinar" as const, webinarId: id })), match: "all" } },
    mode: "rules",
    webinarId: id
  };
}

/** O aviso em branco com o "Para quem" do "Avisar quem não veio" e a nota do topo (o editor no modo "start", sem modelo). */
export function webinarRulesNoticeStart(kind: CampaignKind, audience: AudienceDefinition): NoticeStart {
  const base = emptyTemplateStart(kind);

  return { ...base, draft: { ...base.draft, audience }, notes: [SEGUIMENTO_COPY.inicioDoAviso] };
}

/** O destino do botao do aviso: a pagina do webinario com o link de origem do atalho. */
export function webinarNoticeCtaHref(slug: string, kind: CampaignKind) {
  return `${webinarHref(slug)}?origem=${WEBINAR_NOTICE_ORIGINS[kind]}`;
}

/* ------------------------------------------------------------------------------------------------
 * Quem pode -> segmento da Comunicacao
 * ---------------------------------------------------------------------------------------------- */

export type WebinarNoticeAccess = {
  accessMode: AccessMode;
  audience: AudienceDefinition;
  /** O webinario salvo: a regra "nunca ... em nenhuma live" do segmento dele nao conta a propria live (withOwnWebinar). */
  id?: string | null;
  productId: string | null;
};

export type WebinarNoticeAudienceResult = { audience: AudienceDefinition; ok: true } | { ok: false; reason: string };

function productRule(productId: string): AudienceRule {
  return { op: "has", productIds: [productId], type: "product" };
}

function group(match: AudienceGroup["match"], items: AudienceNode[]): AudienceNode {
  return items.length === 1 ? items[0] : { items, match };
}

/**
 * Produto E segmento (o modo "both" e a contagem ao vivo do editor, webinarCountAudience): num grupo "todas" as regras
 * entram soltas ao lado do produto; um grupo "qualquer" sem grupos dentro entra inteiro; "qualquer" com grupos dentro
 * vira um caminho por item, cada um com o produto, para nao passar de um grupo dentro do principal:
 * P e (A ou B ou (C e D)) = (P e A) ou (P e B) ou (P e C e D).
 */
export function audienceWithProduct(productId: string, audience: AudienceDefinition): AudienceDefinition {
  const product = productRule(productId);

  if (audience.kind !== "rules") {
    return { kind: "rules", root: { items: [product], match: "all" } };
  }

  const root = audience.root;

  if (root.match === "all") {
    return { kind: "rules", root: { items: [product, ...root.items], match: "all" } };
  }

  if (!root.items.some(isAudienceGroup)) {
    return { kind: "rules", root: { items: [product, root], match: "all" } };
  }

  const paths: AudienceNode[] = root.items.flatMap((item): AudienceNode[] => {
    if (!isAudienceGroup(item)) {
      return [{ items: [product, item], match: "all" }];
    }

    return item.match === "all" ? [{ items: [product, ...item.items], match: "all" }] : item.items.map((inner) => ({ items: [product, inner], match: "all" as const }));
  });

  return { kind: "rules", root: { items: paths, match: "any" } };
}

/**
 * Produto OU segmento (o modo "either"): com o segmento num grupo "qualquer", o produto entra solto ao lado; num grupo
 * "todas" sem grupos dentro, o segmento vira o grupo de dentro; "todas" com grupos "qualquer" dentro vira os caminhos
 * (forma normal disjuntiva), cada um num grupo "todas": P ou (A e (B ou C)) = P ou (A e B) ou (A e C). Null quando os
 * caminhos passariam do limite de regras (a conta vem antes de montar).
 */
export function audienceOrProduct(productId: string, audience: AudienceDefinition): AudienceDefinition | null {
  const product = productRule(productId);

  if (audience.kind !== "rules") {
    return EVERYONE;
  }

  const root = audience.root;

  if (root.match === "any") {
    return { kind: "rules", root: { items: [product, ...root.items], match: "any" } };
  }

  if (!root.items.some(isAudienceGroup)) {
    return { kind: "rules", root: { items: [product, group("all", root.items)], match: "any" } };
  }

  const base: AudienceNode[] = [];
  const choices: AudienceNode[][] = [];

  for (const item of root.items) {
    if (!isAudienceGroup(item)) {
      base.push(item);
    } else if (item.match === "all") {
      base.push(...item.items);
    } else {
      choices.push(item.items);
    }
  }

  const pathCount = choices.reduce((total, items) => total * items.length, 1);

  if (pathCount === 0 || 1 + pathCount * (base.length + choices.length) > AUDIENCE_LIMITS.maxRules) {
    return null;
  }

  let paths: AudienceNode[][] = [base];

  for (const items of choices) {
    paths = paths.flatMap((path) => items.map((item) => [...path, item]));
  }

  return { kind: "rules", root: { items: [product, ...paths.map((path) => group("all", path))], match: "any" } };
}

/** "Nunca garantiram vaga" / "nunca participaram" em qualquer live: a regra que a propria live tiraria do segmento. */
function isAnyLiveNegated(node: AudienceNode): node is Extract<AudienceRule, { type: "webinar" }> {
  return !isAudienceGroup(node) && node.type === "webinar" && node.webinarId === null && node.negate;
}

/**
 * O segmento do webinario como o Comunicacao avalia, com a propria live fora da regra "nunca ... em nenhuma live"
 * (docs/30 §1.1: no Quem pode, "em nenhuma live" quer dizer "em nenhuma outra"; o segmento do aviso conta todas). Cada
 * regra dessas vira "ela, ou garantiram vaga nesta live, ou participaram desta live", o mesmo publico que o Quem pode
 * deixa ver (quem esta so nesta live continua no segmento; quem esta nesta e em outra e segurado pela ancora no
 * Segmento e no "both"; no "Produto ou segmento", sem ancora, esse fica a mais no aviso, porque a regra do aviso nao
 * tem como dizer "em nenhuma outra"): num grupo
 * "qualquer" as duas entram soltas; no principal "todas", num grupo "qualquer" no lugar da regra (um grupo "todas"
 * dentro do principal "todas" e aberto antes); num grupo "todas" dentro do principal "qualquer", um caminho por troca.
 * A regra positiva ("garantiram vaga em alguma live") fica como esta: quem so tem esta live entra pela vaga nela (que
 * conta como "alguma live" no aviso; no Quem pode, a ancora a segura no Segmento e no "both"). Pode passar dos limites
 * (quem chama confere).
 */
export function withOwnWebinar(audience: AudienceDefinition, webinarId: string | null | undefined): AudienceDefinition {
  if (audience.kind !== "rules" || !webinarId) {
    return audience;
  }

  const ownLive: AudienceNode[] = [
    { action: "registered", negate: false, type: "webinar", webinarId },
    { action: "attended", negate: false, type: "webinar", webinarId }
  ];
  const choicesOf = (item: AudienceNode): AudienceNode[] => (isAnyLiveNegated(item) ? [item, ...ownLive] : [item]);
  const loose = (items: readonly AudienceNode[]): AudienceNode[] => items.flatMap(choicesOf);
  const paths = (items: readonly AudienceNode[]): AudienceNode[][] =>
    items.reduce<AudienceNode[][]>((acc, item) => acc.flatMap((path) => choicesOf(item).map((choice) => [...path, choice])), [[]]);
  const root = audience.root;
  const mentions = (node: AudienceNode): boolean => (isAudienceGroup(node) ? node.items.some(mentions) : isAnyLiveNegated(node));

  if (!mentions(root)) {
    return audience;
  }

  if (root.match === "any") {
    const items = root.items.flatMap((item): AudienceNode[] => {
      if (!isAudienceGroup(item)) {
        return loose([item]);
      }

      return item.match === "any" ? [{ ...item, items: loose(item.items) }] : paths(item.items).map((path) => group("all", path));
    });

    return { kind: "rules", root: { items, match: "any" } };
  }

  const flat = root.items.flatMap((item) => (isAudienceGroup(item) && item.match === "all" ? item.items : [item]));
  const items = flat.map((item): AudienceNode => {
    if (isAudienceGroup(item)) {
      return { ...item, items: loose(item.items) };
    }

    return isAnyLiveNegated(item) ? { items: [item, ...ownLive], match: "any" } : item;
  });

  return { kind: "rules", root: { items, match: "all" } };
}

function withinLimits(audience: AudienceDefinition) {
  return countAudienceRules(audience) <= AUDIENCE_LIMITS.maxRules && audienceDepth(audience) <= AUDIENCE_LIMITS.maxDepth;
}

/**
 * O "Quem pode" do webinario como o "Para quem" do aviso: Todos -> todos os alunos; Quem tem o produto -> a regra
 * "tem o produto X"; Segmento -> o segmento; Produto ou segmento -> grupo "qualquer" (produto, segmento); Quem tem o
 * produto e está no segmento -> grupo "todas" (produto, segmento). Passou de AUDIENCE_LIMITS: o motivo, e o atalho
 * nao abre. A ancora do webinario (quem garantiu vaga continua vendo) nao entra: o aviso vai para quem esta no
 * segmento agora; so a regra "nunca ... em nenhuma live" ganha a propria live como saida (withOwnWebinar), porque no
 * Quem pode a propria live nao conta.
 */
export function webinarNoticeAudience(access: WebinarNoticeAccess): WebinarNoticeAudienceResult {
  const segment = withOwnWebinar(normalizeAudience(access.audience), access.id);
  const productId = access.productId?.trim() || null;
  let audience: AudienceDefinition | null;

  switch (access.accessMode) {
    case "everyone":
      return { audience: EVERYONE, ok: true };
    case "audience":
      audience = segment;
      break;
    case "product":
    case "either":
    case "both":
      if (!productId) {
        return { ok: false, reason: WEBINAR_NOTICE_COPY.blocked.product };
      }

      audience =
        access.accessMode === "product"
          ? { kind: "rules", root: { items: [productRule(productId)], match: "all" } }
          : access.accessMode === "both"
            ? audienceWithProduct(productId, segment)
            : audienceOrProduct(productId, segment);
      break;
    default:
      // Um modo que este app nao conhece: nunca abre para todos.
      return { ok: false, reason: WEBINAR_NOTICE_COPY.blocked.audience };
  }

  return audience && withinLimits(audience) ? { audience, ok: true } : { ok: false, reason: WEBINAR_NOTICE_COPY.blocked.audience };
}

/* ------------------------------------------------------------------------------------------------
 * Quando o atalho fica desligado
 * ---------------------------------------------------------------------------------------------- */

/**
 * O motivo pela situacao do webinario salvo: rascunho (ou nunca salvo), cancelado ou encerrado (arquivado conta como
 * encerrado). Null = publicado, agendado ou em andamento.
 */
export function webinarNoticeStatusBlock(saved: { situation: WebinarSituation; status: WebinarStatus } | null): string | null {
  if (!saved || saved.status === "draft" || saved.situation === "draft") {
    return WEBINAR_NOTICE_COPY.blocked.draft;
  }

  if (saved.situation === "cancelled") {
    return WEBINAR_NOTICE_COPY.blocked.cancelled;
  }

  if (saved.status === "archived" || saved.situation === "ended") {
    return WEBINAR_NOTICE_COPY.blocked.ended;
  }

  return null;
}

/* ------------------------------------------------------------------------------------------------
 * O rascunho do aviso
 * ---------------------------------------------------------------------------------------------- */

export type WebinarNoticeSource = WebinarNoticeAccess & {
  durationMinutes: number;
  id: string;
  registrationRequired: boolean;
  sessions: readonly Pick<WebinarSession, "endedAt" | "kind" | "scheduledAt" | "status">[];
  situation: WebinarSituation;
  slug: string;
  status: WebinarStatus;
  title: string;
};

export type WebinarNoticeStartResult = { ok: true; start: NoticeStart } | { ok: false; reason: string };

const MINUTE_MS = 60_000;
/** Pop-up de uma live que ja passou da duracao prevista e segue no ar: Termina pelo menos 1 h depois de agora. */
const POPUP_EXTRA_MS = 60 * MINUTE_MS;
/** Menos que isto ate o fim previsto = o fim previsto nao serve (o pop-up mal apareceria). */
const POPUP_MIN_TAIL_MS = 15 * MINUTE_MS;

/** Corta no limite do campo com "…" (o zod do aviso confere o tamanho depois de aparar). */
export function fitNoticeText(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();

  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function isoOfMinute(time: number) {
  return new Date(Math.ceil(time / MINUTE_MS) * MINUTE_MS).toISOString();
}

/**
 * O aviso novo que o atalho abre (docs/30 §2.2), com o "Para quem" de webinarNoticeAudience e o botao para a pagina
 * do webinario (?origem=sino ou ?origem=pop-up), sem gravar nada:
 * - Aviso no sino: envio "agora" (a equipe escolhe a hora no editor), titulo "Live: {nome}", o dia e a hora da proxima
 *   live no texto (ao vivo: "Estamos ao vivo agora."), icone Ao vivo e o botao "Ver a live".
 * - Pop-up: para a hora da live, pelo "Começa" e "Termina" que o editor ja tem (docs/29 §2.1, a hora marcada ao vivo):
 *   Começa na hora marcada (ja comecou: ao publicar) e Termina no fim previsto (a live passou da duracao: 1 h depois de
 *   agora), em qualquer página, uma vez, com o botao "Entrar na live". Sem live por acontecer, sem janela e "Ver a live".
 * Webinario rascunho, cancelado, encerrado ou com o Quem pode fora dos limites: o motivo, sem rascunho.
 */
export function webinarNoticeStart(source: WebinarNoticeSource, kind: CampaignKind, now: number): WebinarNoticeStartResult {
  const statusBlock = webinarNoticeStatusBlock(source);

  if (statusBlock) {
    return { ok: false, reason: statusBlock };
  }

  const translated = webinarNoticeAudience(source);

  if (!translated.ok) {
    return translated;
  }

  const next = nextSession(source.sessions, source.durationMinutes, now);
  const startsAt = next ? toTime(next.scheduledAt) : null;
  const live = source.situation === "in_progress" || (startsAt !== null && startsAt <= now);
  const href = webinarNoticeCtaHref(source.slug, kind);
  const notes: string[] = [WEBINAR_NOTICE_COPY.notes.startFrom(source.title)];
  let draft: NoticeDraft;

  if (kind === "inbox") {
    const when = next ? formatWebinarWhen(next.scheduledAt) : "";
    const body = live
      ? WEBINAR_NOTICE_COPY.inbox.bodyLive
      : !when
        ? WEBINAR_NOTICE_COPY.inbox.bodyNoDate
        : source.registrationRequired
          ? WEBINAR_NOTICE_COPY.inbox.bodySeat(when)
          : WEBINAR_NOTICE_COPY.inbox.bodyOpen(when);

    draft = {
      ...emptyNoticeDraft("inbox"),
      audience: translated.audience,
      body: fitNoticeText(body, NOTICE_LIMITS.inbox.body),
      cta: { display: "button", href, label: WEBINAR_NOTICE_COPY.ctaSee, target: "same_tab" },
      icon: { color: "red", id: "live" },
      title: fitNoticeText(WEBINAR_NOTICE_COPY.inbox.title(source.title), NOTICE_LIMITS.inbox.title)
    };
  } else {
    let window: NoticeDraft["window"] = { endsAt: null, startsAt: null };

    if (next && startsAt !== null) {
      const plannedEnd = sessionEndsAt(next, source.durationMinutes);
      const endsAt = plannedEnd - now < POPUP_MIN_TAIL_MS ? now + POPUP_EXTRA_MS : plannedEnd;
      window = { endsAt: isoOfMinute(endsAt), startsAt: live ? null : new Date(startsAt).toISOString() };
      notes.push(WEBINAR_NOTICE_COPY.notes.popupWindow);
    }

    const atTheHour = window.endsAt !== null;

    draft = {
      ...emptyNoticeDraft("popup"),
      audience: translated.audience,
      body: atTheHour ? WEBINAR_NOTICE_COPY.popup.body : WEBINAR_NOTICE_COPY.inbox.bodyNoDate,
      cta: { display: "button", href, label: atTheHour ? WEBINAR_NOTICE_COPY.ctaEnter : WEBINAR_NOTICE_COPY.ctaSee, target: "same_tab" },
      design: null,
      freeDesign: null,
      icon: { color: "red", id: "live" },
      popup: { ...defaultPopupSettings(), pages: ["any"] },
      title: fitNoticeText((atTheHour ? WEBINAR_NOTICE_COPY.popup.title : WEBINAR_NOTICE_COPY.inbox.title)(source.title), NOTICE_LIMITS.popup.title),
      window
    };
  }

  return { ok: true, start: { draft, followUps: null, notes, templateId: null, templateName: null } };
}
