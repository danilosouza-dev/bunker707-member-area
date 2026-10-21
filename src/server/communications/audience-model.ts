// Segmento dos avisos (Comunicacao > Avisos e pop-ups, docs/22 §3): "Para quem" vai cada notificacao ou
// pop-up. Regras combinaveis em grupos E/OU (um nivel de grupo dentro do principal), avaliadas no
// servidor sobre os fatos de cada aluno (src/server/communications/audience-facts.ts). Modulo puro:
// sem "server-only" e com imports relativos, para tests/comunicacao-segmentos.test.mjs carregar direto
// pelo Node; o editor do admin importa os mesmos tipos e frases.
//
// A equipe (admin_roles) nunca entra: quem monta os fatos ja tira a equipe antes de avaliar.
//
// v2 (docs/23): tres regras novas. "message" (o que o aluno fez com uma notificacao) vale no segmento,
// apontando para um aviso enviado, e nos fluxos, apontando para um passo acima; "page_visit" e
// "access_gained" valem so dentro de um fluxo (so ha visita gravada enquanto um fluxo no ar usa a pagina).

import { FIXED_PAGE_KEYS, FIXED_PAGE_LABELS, pageKeyOfTarget, type FixedPageKey } from "../member-area/page-visit-model";
import { STUDENT_PACE_LABELS, STUDENT_PACES, type StudentListParams, type StudentPace } from "../students/model";

export const AUDIENCE_RULE_TYPES = [
  "product",
  "progress",
  "comments",
  "access_age",
  "access_ending",
  "last_study",
  "sign_in",
  "pace",
  "cohort",
  "message",
  "page_visit",
  "access_gained"
] as const;
export type AudienceRuleType = (typeof AUDIENCE_RULE_TYPES)[number];

/** Janelas de "Comentarios"; null = desde sempre. */
export const AUDIENCE_WINDOWS = [7, 30, 90] as const;
export type AudienceWindow = 7 | 30 | 90 | null;

export type AudienceRule =
  | { op: "has" | "has_not"; productIds: string[]; type: "product" }
  | { op: "gte" | "lte"; percent: number; productId: string | null; type: "progress" }
  | { count: number; days: AudienceWindow; op: "gte" | "lte" | "none" | "top"; type: "comments" }
  | { days: number; op: "lt" | "gt"; productId: string | null; type: "access_age" }
  | { days: number; productId: string | null; type: "access_ending" }
  | { days: number; op: "within" | "not_within"; type: "last_study" }
  | { days: number; op: "never" | "within" | "not_within"; type: "sign_in" }
  | { paces: StudentPace[]; type: "pace" }
  | { cohortIds: string[]; type: "cohort" }
  /** v3a: `choice` = a reacao (reacted) ou a opcao da enquete (voted); ausente = qualquer uma. */
  | { action: MessageAction; choice?: string; negate: boolean; ref: MessageRef; type: "message" }
  /** So dentro de um fluxo. */
  | { negate: boolean; page: PageTarget; since: FlowSince; type: "page_visit" }
  /** So dentro de um fluxo. */
  | { negate: boolean; productIds: string[]; since: FlowSince; type: "access_gained" };

/** Notificacao de uma regra "message": um passo do fluxo (acima deste) ou um aviso enviado (segmento). */
export type MessageRef = { kind: "node"; nodeId: string } | { campaignId: string; kind: "campaign" };

/**
 * O que o aluno fez com a notificacao. "interacted" = abriu, comecou o audio, clicou ou respondeu.
 * Negada ("nao abriu"), a regra so vale para quem recebeu. v3a (docs/24 §6): reagiu, votou na enquete e
 * excluiu do sino, no fim (a ordem da v2 fica).
 */
export const MESSAGE_ACTIONS = [
  "received",
  "seen",
  "opened",
  "audio_started",
  "audio_completed",
  "clicked",
  "accepted",
  "declined",
  "responded",
  "interacted",
  "reacted",
  "voted",
  "hidden"
] as const;
export type MessageAction = (typeof MESSAGE_ACTIONS)[number];

/** Pagina de uma regra "page_visit"; "message_cta" = a pagina do botao de um passo acima. */
export type PageTarget =
  | { kind: "content"; productId: string }
  | { kind: "checkout"; productId: string }
  | { key: FixedPageKey; kind: "fixed" }
  | { kind: "message_cta"; nodeId: string };

/** Desde quando conta: a entrada do aluno no fluxo ou o recebimento de uma notificacao acima. */
export type FlowSince = { kind: "entered" } | { kind: "message"; nodeId: string };

export type AudienceGroup = { items: AudienceNode[]; match: "all" | "any" };
export type AudienceNode = AudienceGroup | AudienceRule;
export type AudienceDefinition = { kind: "everyone" } | { kind: "rules"; root: AudienceGroup };

export const AUDIENCE_LIMITS = {
  /** Grupo principal = 1; grupo dentro dele = 2; nada abaixo disso. */
  maxDepth: 2,
  maxRules: 20,
  maxIds: 50,
  maxDays: 3650,
  maxCount: 100_000
} as const;

export const EVERYONE: AudienceDefinition = { kind: "everyone" };

const DAY_MS = 86_400_000;
const PLATFORM_ACCESS_ID = "platform";

export function isAudienceGroup(node: AudienceNode): node is AudienceGroup {
  return "items" in node && Array.isArray((node as AudienceGroup).items);
}

/* ------------------------------------------------------------------------------------------------
 * Fatos de cada aluno (montados no servidor) e contexto da avaliacao
 * ---------------------------------------------------------------------------------------------- */

/**
 * Acesso aberto agora. O acesso a plataforma inteira usa productId "platform". `gainedAt` =
 * greatest(created_at, starts_at) (regra "access_gained"; importacao pode ter starts_at no passado).
 */
export type AudienceAccessFact = { endsAt: number | null; gainedAt?: number; productId: string; startsAt: number };

/** O que um aluno fez com uma notificacao (linha do sino), em ms. */
export type MessageFact = {
  audioCompletedAt: number | null;
  audioStartedAt: number | null;
  clickedAt: number | null;
  expiresAt: number;
  openedAt: number | null;
  response: "accepted" | "declined" | null;
  seenAt: number | null;
  /** Quando passou a aparecer no sino: greatest(created_at, sent_at do aviso). */
  visibleAt: number;
  /** v3a: o aluno excluiu do proprio sino (ausente = nao). */
  hiddenAt?: number | null;
  /** v3a: ids das opcoes votadas (ausente ou vazio = nao votou). */
  pollChoice?: readonly string[] | null;
  /** v3a: id da reacao (ausente = sem reacao). */
  reaction?: string | null;
};

export type AudienceCommentCounts = { d7: number; d30: number; d90: number; total: number };

export type AudienceStudentFacts = {
  accesses: AudienceAccessFact[];
  cohortIds: string[];
  comments: AudienceCommentCounts;
  /** Aulas publicadas concluidas por conteudo (lesson_progress). */
  completedByContent: Record<string, number>;
  /** Totais sobre o que o aluno pode estudar agora (mesma conta da lista de Alunos). */
  completedLessons: number;
  lastSignInAt: number | null;
  lastStudiedAt: number | null;
  pace: StudentPace;
  totalLessons: number;
  userId: string;
  /**
   * Notificacoes recebidas, pela chave da regra: "node:<passo>" (fluxo) ou "campaign:<aviso>" (segmento).
   * Chave carregada sem linha deste aluno = nao recebeu (AudienceContext.messageKeys).
   */
  messages?: Record<string, MessageFact>;
  /** So no motor dos fluxos: entrada no fluxo (passagem) e ultima visita por chave de pagina, em ms. */
  flow?: { enteredAt: number; pageVisits: Record<string, number> };
};

export type CommentRankWindow = "7" | "30" | "90" | "all";

export type AudienceContext = {
  /** Posicao (1 = quem mais comentou) entre os alunos com pelo menos 1 comentario na janela. */
  commentRanks: Record<CommentRankWindow, Map<string, number>>;
  /** Aulas publicadas por conteudo. */
  lessonTotals: Record<string, number>;
  now: number;
  /** So no motor dos fluxos: passo -> chave da pagina do botao (null = externo ou nao acompanhado). */
  flow?: { ctaPageKeys: Record<string, string | null> };
  /**
   * Chaves de mensagem ("campaign:<id>", "node:<id>") carregadas para todos os avaliados. Regra com chave
   * fora daqui nunca combina (negada ou nao): o aviso nao foi lido, entao nao da para saber.
   */
  messageKeys?: ReadonlySet<string>;
};

function windowKey(days: AudienceWindow): CommentRankWindow {
  return days === null ? "all" : (String(days) as CommentRankWindow);
}

function commentsIn(counts: AudienceCommentCounts, days: AudienceWindow) {
  switch (days) {
    case 7:
      return counts.d7;
    case 30:
      return counts.d30;
    case 90:
      return counts.d90;
    default:
      return counts.total;
  }
}

/** Ranking de comentadores por janela: mais comentarios primeiro, empate pelo id (deterministico). */
export function buildCommentRanks(entries: readonly { comments: AudienceCommentCounts; userId: string }[]) {
  const ranks = {} as Record<CommentRankWindow, Map<string, number>>;
  const windows: AudienceWindow[] = [7, 30, 90, null];

  for (const days of windows) {
    const ordered = entries
      .map((entry) => ({ count: commentsIn(entry.comments, days), userId: entry.userId }))
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.count - left.count || (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0));

    ranks[windowKey(days)] = new Map(ordered.map((entry, index) => [entry.userId, index + 1] as const));
  }

  return ranks;
}

/* ------------------------------------------------------------------------------------------------
 * Avaliacao
 * ---------------------------------------------------------------------------------------------- */

function hasPlatform(facts: AudienceStudentFacts) {
  return facts.accesses.some((access) => access.productId === PLATFORM_ACCESS_ID);
}

/** Acesso aberto ao produto; sem acesso direto, o acesso a plataforma inteira vale para ele. */
function accessFor(facts: AudienceStudentFacts, productId: string) {
  return (
    facts.accesses.find((access) => access.productId === productId) ??
    facts.accesses.find((access) => access.productId === PLATFORM_ACCESS_ID) ??
    null
  );
}

function accessesFor(facts: AudienceStudentFacts, productId: string | null) {
  if (!productId) {
    return facts.accesses;
  }

  const access = accessFor(facts, productId);

  return access ? [access] : [];
}

function percentOf(completed: number, total: number) {
  return Math.floor((Math.max(0, completed) * 100) / total);
}

function evaluateRule(rule: AudienceRule, facts: AudienceStudentFacts, context: AudienceContext): boolean {
  const { now } = context;

  switch (rule.type) {
    case "product": {
      const has = hasPlatform(facts) || facts.accesses.some((access) => rule.productIds.includes(access.productId));

      return rule.op === "has" ? has : !has;
    }

    case "progress": {
      let percent: number;

      if (rule.productId) {
        const total = context.lessonTotals[rule.productId] ?? 0;

        if (!accessFor(facts, rule.productId) || total <= 0) {
          return false;
        }

        percent = percentOf(facts.completedByContent[rule.productId] ?? 0, total);
      } else {
        if (facts.totalLessons <= 0) {
          return false;
        }

        percent = percentOf(facts.completedLessons, facts.totalLessons);
      }

      return rule.op === "gte" ? percent >= rule.percent : percent <= rule.percent;
    }

    case "comments": {
      const count = commentsIn(facts.comments, rule.days);

      switch (rule.op) {
        case "gte":
          return count >= rule.count;
        case "lte":
          return count <= rule.count;
        case "none":
          return count === 0;
        case "top": {
          const rank = context.commentRanks[windowKey(rule.days)]?.get(facts.userId);

          return rank !== undefined && rank <= rule.count;
        }
      }

      return false;
    }

    case "access_age": {
      const limit = rule.days * DAY_MS;

      return accessesFor(facts, rule.productId).some((access) =>
        rule.op === "lt" ? now - access.startsAt < limit : now - access.startsAt > limit
      );
    }

    case "access_ending": {
      const limit = rule.days * DAY_MS;

      return accessesFor(facts, rule.productId).some(
        (access) => access.endsAt !== null && access.endsAt - now >= 0 && access.endsAt - now <= limit
      );
    }

    case "last_study": {
      const studied = facts.lastStudiedAt !== null && now - facts.lastStudiedAt <= rule.days * DAY_MS;

      return rule.op === "within" ? studied : !studied;
    }

    case "sign_in": {
      if (rule.op === "never") {
        return facts.lastSignInAt === null;
      }

      const recent = facts.lastSignInAt !== null && now - facts.lastSignInAt <= rule.days * DAY_MS;

      return rule.op === "within" ? recent : !recent;
    }

    case "pace":
      return rule.paces.includes(facts.pace);

    case "cohort":
      return facts.cohortIds.some((id) => rule.cohortIds.includes(id));

    case "message":
      return evaluateMessageRule(rule, facts, context);

    case "page_visit": {
      const since = flowSinceAt(rule.since, facts);

      if (since === null) {
        return false;
      }

      const key = pageKeyOfRule(rule.page, context);
      const visitedAt = key === null ? undefined : facts.flow?.pageVisits[key];
      const visited = typeof visitedAt === "number" && visitedAt >= since;

      return rule.negate ? !visited : visited;
    }

    case "access_gained": {
      const since = flowSinceAt(rule.since, facts);

      if (since === null) {
        return false;
      }

      const gained = facts.accesses.some(
        (access) =>
          (access.productId === PLATFORM_ACCESS_ID || rule.productIds.includes(access.productId)) && (access.gainedAt ?? access.startsAt) >= since
      );

      return rule.negate ? !gained : gained;
    }
  }

  return false;
}

/** O aluno fez isto com a notificacao? (a linha existe: "received" ja vale) */
function messageDone(fact: MessageFact, action: MessageAction) {
  switch (action) {
    case "received":
      return true;
    case "seen":
      return fact.seenAt !== null;
    case "opened":
      return fact.openedAt !== null;
    case "audio_started":
      return fact.audioStartedAt !== null;
    case "audio_completed":
      return fact.audioCompletedAt !== null;
    case "clicked":
      return fact.clickedAt !== null;
    case "accepted":
      return fact.response === "accepted";
    case "declined":
      return fact.response === "declined";
    case "responded":
      return fact.response !== null;
    case "interacted":
      return fact.openedAt !== null || fact.audioStartedAt !== null || fact.clickedAt !== null || fact.response !== null;
  }

  return false;
}

/**
 * "O que fez com a notificacao": chave nao carregada -> nunca combina (negada ou nao); carregada sem
 * linha deste aluno = nao recebeu. Negada, so vale para quem recebeu ("nao abriu" nunca inclui quem nem
 * recebeu); "nao recebeu" e o unico caso sem a linha.
 */
function evaluateMessageRule(rule: Extract<AudienceRule, { type: "message" }>, facts: AudienceStudentFacts, context: AudienceContext) {
  const key = messageRefKey(rule.ref);

  if (!context.messageKeys?.has(key)) {
    return false;
  }

  const fact = facts.messages?.[key];

  if (rule.action === "received") {
    return rule.negate ? !fact : Boolean(fact);
  }

  if (!fact) {
    return false;
  }

  const done = messageDone(fact, rule.action);

  return rule.negate ? !done : done;
}

/**
 * Marco de "desde quando" das regras de fluxo, em ms: a entrada do aluno no fluxo ou quando a
 * notificacao acima apareceu no sino. Fora de um fluxo (sem facts.flow), ou notificacao que o aluno nao
 * recebeu -> null (a regra nao combina, negada ou nao).
 */
function flowSinceAt(since: FlowSince, facts: AudienceStudentFacts): number | null {
  if (!facts.flow) {
    return null;
  }

  if (since.kind === "entered") {
    return facts.flow.enteredAt;
  }

  return facts.messages?.[messageRefKey({ kind: "node", nodeId: since.nodeId })]?.visibleAt ?? null;
}

/** Chave da pagina da regra; "pagina do botao" pelo passo (null = externo ou nao acompanhado: nunca visitou). */
function pageKeyOfRule(page: PageTarget, context: AudienceContext): string | null {
  if (page.kind === "message_cta") {
    return context.flow?.ctaPageKeys[page.nodeId] ?? null;
  }

  return pageKeyOfTarget(page);
}

/**
 * O que os fatos precisam ter para estas regras (o motor dos fluxos so le progresso, turmas e
 * comentarios quando alguma regra pede): `students` = progresso, ultimo estudo, entrada, ritmo, turma
 * ou comentarios; `comments` = "ranked" quando ha regra "top N" (o ranking e entre todos os alunos).
 * Acessos e notificacoes vem sempre do lote.
 */
export function audienceFactNeeds(
  definitions: AudienceDefinition | null | undefined | readonly (AudienceDefinition | null | undefined)[]
): { comments: "counts" | "none" | "ranked"; students: boolean } {
  let comments: "counts" | "none" | "ranked" = "none";
  let students = false;
  const visit = (node: AudienceNode) => {
    if (isAudienceGroup(node)) {
      node.items.forEach(visit);
      return;
    }

    switch (node.type) {
      case "comments":
        students = true;
        comments = node.op === "top" ? "ranked" : comments === "ranked" ? "ranked" : "counts";
        return;
      case "progress":
      case "last_study":
      case "sign_in":
      case "pace":
      case "cohort":
        students = true;
        return;
    }
  };
  const list = Array.isArray(definitions) ? definitions : [definitions as AudienceDefinition | null | undefined];

  for (const definition of list) {
    if (definition && definition.kind === "rules" && definition.root) {
      visit(definition.root);
    }
  }

  return { comments, students };
}

function evaluateNode(node: AudienceNode, facts: AudienceStudentFacts, context: AudienceContext): boolean {
  if (!isAudienceGroup(node)) {
    return evaluateRule(node, facts, context);
  }

  return node.match === "all"
    ? node.items.every((item) => evaluateNode(item, facts, context))
    : node.items.some((item) => evaluateNode(item, facts, context));
}

/** O aluno esta no segmento agora? Grupo "todas" vazio = todos; grupo "qualquer" vazio = ninguem. */
export function evaluateAudience(definition: AudienceDefinition, facts: AudienceStudentFacts, context: AudienceContext) {
  return definition.kind === "everyone" ? true : evaluateNode(definition.root, facts, context);
}

/* ------------------------------------------------------------------------------------------------
 * Regras de mensagem: chave dos fatos e avisos que o carregador precisa ler
 * ---------------------------------------------------------------------------------------------- */

/** Chave dos fatos de uma notificacao: "node:<passo>" (fluxo) ou "campaign:<aviso>" (segmento). */
export function messageRefKey(ref: MessageRef) {
  return ref.kind === "node" ? `node:${ref.nodeId}` : `campaign:${ref.campaignId}`;
}

function collectCampaignIdsIn(node: AudienceNode, ids: Set<string>) {
  if (isAudienceGroup(node)) {
    node.items.forEach((item) => collectCampaignIdsIn(item, ids));
  } else if (node.type === "message" && node.ref.kind === "campaign" && node.ref.campaignId) {
    ids.add(node.ref.campaignId);
  }
}

/**
 * Avisos cujas linhas do sino o carregador de fatos precisa ler para avaliar estas regras (cada regra
 * "message" que aponta para um aviso), sem repeticao e em ordem. Sem regra de mensagem -> [].
 */
export function collectMessageCampaignIds(
  definitions: AudienceDefinition | null | undefined | readonly (AudienceDefinition | null | undefined)[]
): string[] {
  const ids = new Set<string>();
  const list = Array.isArray(definitions) ? definitions : [definitions as AudienceDefinition | null | undefined];

  for (const definition of list) {
    if (definition && definition.kind === "rules" && definition.root) {
      collectCampaignIdsIn(definition.root, ids);
    }
  }

  return Array.from(ids).sort();
}

/* ------------------------------------------------------------------------------------------------
 * Tamanho, profundidade e normalizacao
 * ---------------------------------------------------------------------------------------------- */

function countRulesIn(node: AudienceNode): number {
  return isAudienceGroup(node) ? node.items.reduce((total, item) => total + countRulesIn(item), 0) : 1;
}

function depthOf(node: AudienceNode): number {
  return isAudienceGroup(node) ? 1 + Math.max(0, ...node.items.map((item) => (isAudienceGroup(item) ? depthOf(item) : 0))) : 0;
}

export function countAudienceRules(definition: AudienceDefinition) {
  return definition.kind === "everyone" ? 0 : countRulesIn(definition.root);
}

/** Profundidade dos grupos: 0 = todos os alunos; 1 = so o grupo principal; 2 = grupo dentro dele. */
export function audienceDepth(definition: AudienceDefinition) {
  return definition.kind === "everyone" ? 0 : depthOf(definition.root);
}

function clampInteger(value: number, min: number, max: number) {
  const number = Number.isFinite(value) ? Math.round(value) : min;

  return Math.min(max, Math.max(min, number));
}

function uniqueSorted(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function normalizeMessageRef(ref: MessageRef): MessageRef | null {
  if (ref?.kind === "node" && typeof ref.nodeId === "string") {
    return { kind: "node", nodeId: ref.nodeId.trim() };
  }

  if (ref?.kind === "campaign" && typeof ref.campaignId === "string") {
    return { campaignId: ref.campaignId.trim(), kind: "campaign" };
  }

  return null;
}

function normalizeSince(since: FlowSince): FlowSince | null {
  if (since?.kind === "entered") {
    return { kind: "entered" };
  }

  if (since?.kind === "message" && typeof since.nodeId === "string") {
    return { kind: "message", nodeId: since.nodeId.trim() };
  }

  return null;
}

function normalizePage(page: PageTarget): PageTarget | null {
  switch (page?.kind) {
    case "content":
    case "checkout":
      return typeof page.productId === "string" ? { kind: page.kind, productId: page.productId.trim() } : null;
    case "fixed":
      return FIXED_PAGE_KEYS.includes(page.key) ? { key: page.key, kind: "fixed" } : null;
    case "message_cta":
      return typeof page.nodeId === "string" ? { kind: "message_cta", nodeId: page.nodeId.trim() } : null;
  }

  return null;
}

/** Regra das tres novas (v2) normalizada; acao, pagina ou marco desconhecido -> null (a regra sai). */
function normalizeV2Rule(rule: Extract<AudienceRule, { type: "access_gained" | "message" | "page_visit" }>): AudienceRule | null {
  const negate = rule.negate === true;

  switch (rule.type) {
    case "message": {
      const ref = normalizeMessageRef(rule.ref);

      return ref && MESSAGE_ACTIONS.includes(rule.action) ? { action: rule.action, negate, ref, type: "message" } : null;
    }
    case "page_visit": {
      const page = normalizePage(rule.page);
      const since = normalizeSince(rule.since);

      return page && since ? { negate, page, since, type: "page_visit" } : null;
    }
    case "access_gained": {
      const since = normalizeSince(rule.since);

      return since ? { negate, productIds: uniqueSorted(rule.productIds ?? []), since, type: "access_gained" } : null;
    }
  }

  return null;
}

function normalizeRule(rule: AudienceRule): AudienceRule | null {
  const days = (value: number) => clampInteger(value, 1, AUDIENCE_LIMITS.maxDays);

  switch (rule.type) {
    case "product":
      return { op: rule.op, productIds: uniqueSorted(rule.productIds), type: "product" };
    case "progress":
      return { op: rule.op, percent: clampInteger(rule.percent, 0, 100), productId: rule.productId?.trim() || null, type: "progress" };
    case "comments":
      return {
        count: rule.op === "none" ? 0 : clampInteger(rule.count, rule.op === "top" || rule.op === "gte" ? 1 : 0, AUDIENCE_LIMITS.maxCount),
        days: rule.days,
        op: rule.op,
        type: "comments"
      };
    case "access_age":
      return { days: days(rule.days), op: rule.op, productId: rule.productId?.trim() || null, type: "access_age" };
    case "access_ending":
      return { days: days(rule.days), productId: rule.productId?.trim() || null, type: "access_ending" };
    case "last_study":
      return { days: days(rule.days), op: rule.op, type: "last_study" };
    case "sign_in":
      return { days: days(rule.days), op: rule.op, type: "sign_in" };
    case "pace":
      return { paces: STUDENT_PACES.filter((pace) => rule.paces.includes(pace)), type: "pace" };
    case "cohort":
      return { cohortIds: uniqueSorted(rule.cohortIds), type: "cohort" };
    case "message":
    case "page_visit":
    case "access_gained":
      return normalizeV2Rule(rule);
  }

  return rule;
}

function normalizeGroup(group: AudienceGroup): AudienceGroup {
  const items: AudienceNode[] = [];

  for (const item of group.items) {
    if (isAudienceGroup(item)) {
      const nested = normalizeGroup(item);

      if (nested.items.length > 0) {
        items.push(nested);
      }
    } else {
      const rule = normalizeRule(item);

      if (rule) {
        items.push(rule);
      }
    }
  }

  return { items, match: group.match };
}

/**
 * Ids sem repeticao, numeros nos limites, grupos vazios fora, "negate" como booleano e regra com acao
 * (ou pagina, ou marco) desconhecida fora. Segmento sem regra vira "todos os alunos".
 */
export function normalizeAudience(definition: AudienceDefinition): AudienceDefinition {
  if (definition.kind === "everyone") {
    return EVERYONE;
  }

  const root = normalizeGroup(definition.root);

  return root.items.length === 0 ? EVERYONE : { kind: "rules", root };
}

/* ------------------------------------------------------------------------------------------------
 * Frase do segmento ("Alunos que ...")
 * ---------------------------------------------------------------------------------------------- */

export type AudienceNames = {
  cohorts: Record<string, string>;
  /** Chave da notificacao ("campaign:<id>" ou "node:<id>") -> titulo. */
  messages?: Record<string, string>;
  /** v3a: chave da notificacao -> id da opcao da enquete -> texto da opcao. */
  pollOptions?: Record<string, Record<string, string>>;
  products: Record<string, string>;
};

const MISSING_PRODUCT = "um produto removido";
const MISSING_COHORT = "uma turma removida";

function joinWithOr(values: readonly string[], extraLabel: (count: number) => string) {
  if (values.length <= 3) {
    if (values.length <= 1) {
      return values[0] ?? "";
    }

    return `${values.slice(0, -1).join(", ")} ou ${values[values.length - 1]}`;
  }

  return `${values.slice(0, 2).join(", ")} ou ${extraLabel(values.length - 2)}`;
}

function productName(names: AudienceNames, id: string) {
  return names.products[id] ?? MISSING_PRODUCT;
}

function daysLabel(days: number) {
  return days === 1 ? "1 dia" : `${days} dias`;
}

function windowLabel(days: AudienceWindow) {
  return days === null ? "" : ` nos últimos ${days} dias`;
}

function lowerFirst(value: string) {
  return value ? value.charAt(0).toLocaleLowerCase("pt-BR") + value.slice(1) : value;
}

export function describeAudienceRule(rule: AudienceRule, names: AudienceNames): string {
  switch (rule.type) {
    case "product": {
      const list = joinWithOr(
        rule.productIds.map((id) => productName(names, id)),
        (count) => `mais ${count} ${count === 1 ? "produto" : "produtos"}`
      );

      return `${rule.op === "has" ? "têm" : "não têm"} acesso a ${list || MISSING_PRODUCT}`;
    }
    case "progress": {
      const scope = rule.productId ? ` de ${productName(names, rule.productId)}` : "";

      return `concluíram ${rule.op === "gte" ? "pelo menos" : "no máximo"} ${rule.percent}% das aulas${scope}`;
    }
    case "comments": {
      const times = rule.count === 1 ? "vez" : "vezes";

      switch (rule.op) {
        case "gte":
          return `comentaram pelo menos ${rule.count} ${times}${windowLabel(rule.days)}`;
        case "lte":
          return `comentaram no máximo ${rule.count} ${times}${windowLabel(rule.days)}`;
        case "none":
          return `não comentaram${windowLabel(rule.days)}`;
        case "top":
          return `estão entre os ${rule.count} que mais comentaram${windowLabel(rule.days)}`;
      }

      return "";
    }
    case "access_age": {
      const scope = rule.productId ? ` a ${productName(names, rule.productId)}` : "";

      return `ganharam acesso${scope} há ${rule.op === "lt" ? "menos" : "mais"} de ${daysLabel(rule.days)}`;
    }
    case "access_ending": {
      const scope = rule.productId ? ` a ${productName(names, rule.productId)}` : "";

      return `têm acesso${scope} terminando em até ${daysLabel(rule.days)}`;
    }
    case "last_study":
      return rule.op === "within"
        ? `estudaram nos últimos ${daysLabel(rule.days)}`
        : `não estudam há ${daysLabel(rule.days)} ou nunca estudaram`;
    case "sign_in":
      if (rule.op === "never") {
        return "nunca entraram na plataforma";
      }

      return rule.op === "within" ? `entraram nos últimos ${daysLabel(rule.days)}` : `não entram há ${daysLabel(rule.days)}`;
    case "pace": {
      const labels = rule.paces.map((pace) => lowerFirst(STUDENT_PACE_LABELS[pace]));

      return `estão com ritmo ${joinWithOr(labels, (count) => `mais ${count}`)}`;
    }
    case "cohort": {
      const cohorts = rule.cohortIds.map((id) => names.cohorts[id] ?? MISSING_COHORT);

      return cohorts.length === 1
        ? `estão na turma ${cohorts[0]}`
        : `estão nas turmas ${joinWithOr(cohorts, (count) => `mais ${count} ${count === 1 ? "turma" : "turmas"}`)}`;
    }
    case "message":
      return `${rule.negate ? "não " : ""}${MESSAGE_ACTION_SENTENCES[rule.action]?.(noticePhrase(names, rule.ref)) ?? ""}`.trimEnd();
    case "page_visit": {
      const no = rule.negate ? "não " : "";
      const since = sincePhrase(names, rule.since);

      if (rule.page.kind === "checkout") {
        return `${no}clicaram em Comprar de ${productName(names, rule.page.productId)} ${since}`;
      }

      return `${no}visitaram ${pagePhrase(names, rule.page)} ${since}`;
    }
    case "access_gained": {
      const list = joinWithOr(
        rule.productIds.map((id) => productName(names, id)),
        (count) => `mais ${count} ${count === 1 ? "produto" : "produtos"}`
      );

      return `${rule.negate ? "não " : ""}ganharam acesso a ${list || MISSING_PRODUCT} ${sincePhrase(names, rule.since)}`;
    }
  }

  return "";
}

const MISSING_MESSAGE = "uma notificação removida";

/** "a notificação “X”" / "da notificação “X”" / "à notificação “X”" (titulo que nao veio: "uma notificação removida"). */
type NoticePhrase = { of: string; the: string; to: string; with: string };

function noticePhrase(names: AudienceNames, ref: MessageRef): NoticePhrase {
  const title = names.messages?.[messageRefKey(ref)]?.trim();

  return title
    ? { of: `da notificação “${title}”`, the: `a notificação “${title}”`, to: `à notificação “${title}”`, with: `com a notificação “${title}”` }
    : { of: `de ${MISSING_MESSAGE}`, the: MISSING_MESSAGE, to: `a ${MISSING_MESSAGE}`, with: `com ${MISSING_MESSAGE}` };
}

/** Frase de cada acao, no plural depois de "Alunos que" (a negacao poe "não " na frente). */
const MESSAGE_ACTION_SENTENCES: Record<MessageAction, (notice: NoticePhrase) => string> = {
  accepted: (notice) => `aceitaram ${notice.the}`,
  audio_completed: (notice) => `ouviram até o fim o áudio ${notice.of}`,
  audio_started: (notice) => `começaram a ouvir o áudio ${notice.of}`,
  clicked: (notice) => `clicaram no botão ${notice.of}`,
  declined: (notice) => `recusaram ${notice.the}`,
  interacted: (notice) => `interagiram ${notice.with}`,
  opened: (notice) => `abriram ${notice.the}`,
  received: (notice) => `receberam ${notice.the}`,
  responded: (notice) => `responderam ${notice.the}`,
  seen: (notice) => `viram ${notice.the} no sino`,
  // v3a (docs/24 §6): sem a reacao ou a opcao escolhida (as frases com `choice` sao do pacote de regras).
  hidden: (notice) => `excluíram do sino ${notice.the}`,
  reacted: (notice) => `reagiram ${notice.to}`,
  voted: (notice) => `votaram na enquete ${notice.of}`
};

/** Pagina fixa com o artigo da frase ("visitaram o Início", "visitaram Minhas compras"). */
const FIXED_PAGE_PHRASES: Record<FixedPageKey, string> = {
  continue: FIXED_PAGE_LABELS.continue,
  home: `o ${FIXED_PAGE_LABELS.home}`,
  journey: FIXED_PAGE_LABELS.journey,
  materials: FIXED_PAGE_LABELS.materials,
  profile: `o ${FIXED_PAGE_LABELS.profile}`,
  purchases: FIXED_PAGE_LABELS.purchases,
  saved: FIXED_PAGE_LABELS.saved,
  support: `o ${FIXED_PAGE_LABELS.support}`
};

function pagePhrase(names: AudienceNames, page: PageTarget) {
  switch (page.kind) {
    case "content":
    case "checkout":
      return `a página de ${productName(names, page.productId)}`;
    case "fixed":
      return FIXED_PAGE_PHRASES[page.key] ?? "uma página";
    case "message_cta":
      return `a página do botão ${noticePhrase(names, { kind: "node", nodeId: page.nodeId }).of}`;
  }

  return "uma página";
}

function sincePhrase(names: AudienceNames, since: FlowSince) {
  return since.kind === "entered"
    ? "desde que entraram no fluxo"
    : `depois de receber ${noticePhrase(names, { kind: "node", nodeId: since.nodeId }).the}`;
}

function describeNode(node: AudienceNode, names: AudienceNames, nested: boolean): string {
  if (!isAudienceGroup(node)) {
    return describeAudienceRule(node, names);
  }

  const parts = node.items.map((item) => describeNode(item, names, true)).filter(Boolean);
  const sentence = parts.join(node.match === "all" ? " e " : " ou ");

  return nested && parts.length > 1 ? `(${sentence})` : sentence;
}

/** "Todos os alunos" ou "Alunos que têm acesso a X e concluíram pelo menos 50% das aulas". */
export function describeAudience(definition: AudienceDefinition, names: AudienceNames) {
  if (definition.kind === "everyone") {
    return "Todos os alunos";
  }

  const sentence = describeNode(definition.root, names, false);

  return sentence ? `Alunos que ${sentence}` : "Todos os alunos";
}

/* ------------------------------------------------------------------------------------------------
 * Segmento salvo em Alunos -> regras
 * ---------------------------------------------------------------------------------------------- */

/**
 * Converte um segmento de Alunos (filtros da lista, StudentListParams) em regras de aviso. A busca por
 * nome e a semana do ciclo de vida nao viram regra: voltam em `unsupported` para o editor avisar.
 */
export function studentListParamsToAudience(params: StudentListParams): { definition: AudienceDefinition; unsupported: string[] } {
  const items: AudienceRule[] = [];
  const unsupported: string[] = [];
  const productId = params.productId ?? null;

  if (params.productId) {
    items.push({ op: "has", productIds: [params.productId], type: "product" });
  }

  if (params.pace) {
    items.push({ paces: [params.pace], type: "pace" });
  }

  if (params.cohortId) {
    items.push({ cohortIds: [params.cohortId], type: "cohort" });
  }

  if (params.expiring) {
    items.push({ days: 30, productId, type: "access_ending" });
  }

  if (params.account === "never") {
    items.push({ days: 1, op: "never", type: "sign_in" });
  }

  if (params.notStarted) {
    items.push(
      { days: 2, op: "gt", productId, type: "access_age" },
      { days: 7, op: "lt", productId, type: "access_age" },
      { days: AUDIENCE_LIMITS.maxDays, op: "not_within", type: "last_study" }
    );
  }

  if (params.commenters === "top") {
    items.push({ count: 100, days: 30, op: "top", type: "comments" });
  }

  if (params.q) {
    unsupported.push("busca por nome");
  }

  if (params.week || params.group) {
    unsupported.push("semana do ciclo de vida");
  }

  return {
    definition: items.length === 0 ? EVERYONE : { kind: "rules", root: { items, match: "all" } },
    unsupported
  };
}
