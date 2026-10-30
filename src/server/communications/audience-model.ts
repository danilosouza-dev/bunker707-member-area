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
//
// Quem pode da live por regras (docs/22 §3, docs/30 §1.6): duas regras novas, no segmento e nos fluxos.
// "access_recent" (ganhou acesso hoje, no dia de Sao Paulo, ou nas ultimas N horas, pela data de inicio do
// acesso) e "webinar" (Participação em lives). Tipos novos, e nao um op novo numa regra antiga: o app de antes avalia
// um tipo que nao conhece como false (seguro), e um op desconhecido de "access_age" cairia no "ha mais de".
//
// "Participação em lives" e uma regra so (docs/30 §1.6 e D52; a regra "Webinário" da fase 4 virou acoes dela na
// integracao de 30/10/2026): o que o aluno fez numa live. "attended" (entrou na sala) e "registered" (garantiu vaga)
// valem numa live ou em qualquer uma (webinarId null), no segmento e dentro dos fluxos, e vem da RPC
// communication_webinar_facts (context.webinarFactsLoaded). As acoes do follow-up ("watched_replay", "offer_seen",
// "left_before_offer", "clicked_no_purchase", "purchased") exigem uma live e vem de webinar_follow_up_facts, lida so
// para as lives citadas por elas (context.webinarFollowUpsLoaded); valem no "Para quem" de avisos e pop-ups e no
// "Quem entra" de um fluxo, nunca dentro de um fluxo nem no Quem pode da live (schemas.ts). Sem a leitura, a regra
// nunca combina, nem negada (como "message"); lida, a negacao de "participou" e "garantiu vaga" e o NOT da acao ("não
// participou" inclui quem nem garantiu vaga; quem tinha vaga e nao veio = "garantiu vaga" E "não participou"), e a de
// uma acao do follow-up so vale para quem garantiu vaga ou passou pela live (a regra da 4b; "não comprou pelo card"
// nunca alcanca a escola inteira; o construtor diz isso embaixo da regra). Rollback: a imagem de antes da uniao
// (o Quem pode por regras) le uma acao do follow-up como "attended"; docs/22 §3 diz o que tirar do ar antes de voltar.

import { FIXED_PAGE_KEYS, FIXED_PAGE_LABELS, pageKeyOfTarget, type FixedPageKey } from "../member-area/page-visit-model";
import { STUDENT_PACE_LABELS, STUDENT_PACES, type StudentListParams, type StudentPace } from "../students/model";
import { isReactionId, POLL_OPTION_ID, REACTION_EMOJI } from "./interactions-model";
import { saoPauloDayBounds } from "./sao-paulo-day";

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
  "access_gained",
  // Quem pode da live por regras (docs/30 §1.6): valem no segmento e nos fluxos (as acoes do follow-up de "webinar",
  // so no segmento comum).
  "access_recent",
  "webinar"
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
  | { negate: boolean; productIds: string[]; since: FlowSince; type: "access_gained" }
  /**
   * Ganhou acesso recentemente: hoje (dia de Sao Paulo) ou nas ultimas N horas, pela data de inicio do acesso
   * (entitlements.starts_at). `productIds` vazio = qualquer produto (inclui o acesso a plataforma).
   */
  | { negate: boolean; period: AccessRecentPeriod; productIds: string[]; type: "access_recent" }
  /**
   * Participacao em lives: o que o aluno fez numa live. "attended" = entrou na sala (ao vivo ou na Live gravada, por
   * qualquer tempo; o replay nao conta), "registered" = garantiu vaga; `webinarId` null = qualquer live. As acoes do
   * follow-up (WEBINAR_FOLLOW_UP_ACTIONS) exigem uma live (null nunca combina; o zod recusa) e, negadas, so valem para
   * quem garantiu vaga ou passou por ela (evaluateWebinarRule).
   */
  | { action: WebinarRuleAction; negate: boolean; type: "webinar"; webinarId: string | null };

/** Periodo da regra "Ganhou acesso recentemente": o dia de Sao Paulo ou as ultimas N horas (1 a 720). */
export type AccessRecentPeriod = { kind: "today" } | { hours: number; kind: "hours" };

/**
 * O que a regra "Participação em lives" pergunta, na ordem do seletor: as duas de presenca (communication_webinar_facts)
 * e as do follow-up (webinar_follow_up_facts; nunca a Simulacao).
 */
export const WEBINAR_RULE_ACTIONS = ["attended", "registered", "watched_replay", "offer_seen", "left_before_offer", "clicked_no_purchase", "purchased"] as const;
export type WebinarRuleAction = (typeof WEBINAR_RULE_ACTIONS)[number];

/** Presenca: valem numa live ou em qualquer uma, no segmento e dentro dos fluxos. */
export const WEBINAR_PRESENCE_ACTIONS = ["attended", "registered"] as const satisfies readonly WebinarRuleAction[];

/** Follow-up: exigem uma live e valem so no "Para quem" de avisos e pop-ups e no "Quem entra" de um fluxo. */
export const WEBINAR_FOLLOW_UP_ACTIONS = ["watched_replay", "offer_seen", "left_before_offer", "clicked_no_purchase", "purchased"] as const satisfies readonly WebinarRuleAction[];
export type WebinarFollowUpAction = (typeof WEBINAR_FOLLOW_UP_ACTIONS)[number];

export function isWebinarFollowUpAction(action: unknown): action is WebinarFollowUpAction {
  return (WEBINAR_FOLLOW_UP_ACTIONS as readonly unknown[]).includes(action);
}

/** Notificacao de uma regra "message": um passo do fluxo (acima deste) ou um aviso enviado (segmento). */
export type MessageRef = { kind: "node"; nodeId: string } | { campaignId: string; kind: "campaign" };

/**
 * O que o aluno fez com a notificacao. "interacted" = abriu, comecou o audio, foi para o destino,
 * respondeu, reagiu ou votou. Negada ("nao abriu"), a regra so vale para quem recebeu. v3a (docs/24 §6):
 * reagiu, votou na enquete e excluiu do sino, no fim (a ordem da v2 fica).
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

/** Pagina de uma regra "page_visit"; "message_cta" = a pagina para onde leva um passo acima. */
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
  maxCount: 100_000,
  /** "Ganhou acesso recentemente": ate 30 dias em horas. */
  maxRecentHours: 720
} as const;

export const EVERYONE: AudienceDefinition = { kind: "everyone" };

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
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
  /**
   * v3b-2: quando a conta foi criada (profiles.created_at, em ms; o "No primeiro acesso" do pop-up). Opcional:
   * os fatos montados fora de buildStudentFacts (o lote do motor dos fluxos, os testes) podem nao trazer.
   */
  createdAt?: number | null;
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
  /** As lives do aluno (regra "Participação em lives"). Ausente com a leitura feita = nenhuma. */
  webinars?: AudienceWebinarFacts;
};

/**
 * As lives de um aluno: `attended` (entrou na sala) e `registered` (garantiu vaga), pelos ids dos webinarios (RPC
 * communication_webinar_facts; vazias quando so o follow-up foi lido), e `followUps`, o que fez em cada live citada
 * por uma acao do follow-up (webinar_follow_up_facts), pelo id da live. Live lida (context.webinarFollowUpsLoaded) sem
 * a chave deste aluno = nao fez nada nela.
 */
export type AudienceWebinarFacts = {
  attended: readonly string[];
  followUps?: Readonly<Record<string, WebinarFollowUpFact>>;
  registered: readonly string[];
};

/** O que o aluno fez numa live, alem da vaga e da presenca (uma linha de webinar_follow_up_facts). */
export type WebinarFollowUpFact = { clicked: boolean; leftBeforeOffer: boolean; offerSeen: boolean; purchased: boolean; watchedReplay: boolean };

export type CommentRankWindow = "7" | "30" | "90" | "all";

export type AudienceContext = {
  /** Posicao (1 = quem mais comentou) entre os alunos com pelo menos 1 comentario na janela. */
  commentRanks: Record<CommentRankWindow, Map<string, number>>;
  /** Aulas publicadas por conteudo. */
  lessonTotals: Record<string, number>;
  now: number;
  /** So no motor dos fluxos: passo -> chave da pagina para onde ele leva (null = externo ou nao acompanhado). */
  flow?: { ctaPageKeys: Record<string, string | null> };
  /**
   * Chaves de mensagem ("campaign:<id>", "node:<id>") carregadas para todos os avaliados. Regra com chave
   * fora daqui nunca combina (negada ou nao): o aviso nao foi lido, entao nao da para saber.
   */
  messageKeys?: ReadonlySet<string>;
  /**
   * As vagas e presencas de cada aluno foram lidas para todos os avaliados (communication_webinar_facts). Sem a leitura
   * (banco sem a migracao 202610300001, ou quem montou os fatos nao pediu), "participou" e "garantiu vaga" nunca
   * combinam, nem negadas: "nunca participou de nenhuma live" nao vira "todos os alunos".
   */
  webinarFactsLoaded?: boolean;
  /**
   * As lives cujo follow-up foi lido para todos os avaliados (webinar_follow_up_facts). Acao do follow-up numa live
   * fora daqui (apagada, nao pedida, banco sem a migracao) nunca combina, nem negada.
   */
  webinarFollowUpsLoaded?: ReadonlySet<string>;
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

    case "access_recent": {
      const gained = gainedAccessSince(facts, rule.productIds, accessRecentSince(rule.period, now));

      return rule.negate ? !gained : gained;
    }

    case "webinar":
      return evaluateWebinarRule(rule, facts, context);
  }

  return false;
}

/** Inicio do periodo de "Ganhou acesso recentemente", em ms: 00:00 de hoje em Sao Paulo ou agora menos N horas. */
export function accessRecentSince(period: AccessRecentPeriod, now: number) {
  return period.kind === "today" ? saoPauloDayBounds(now).start : now - period.hours * HOUR_MS;
}

/** O acesso aberto vale para o produto: o proprio produto ou a plataforma inteira. */
function coversProduct(access: AudienceAccessFact, productId: string) {
  return access.productId === productId || access.productId === PLATFORM_ACCESS_ID;
}

/**
 * Ganhou acesso desde `since` (so acessos abertos, pela data de inicio). Com produtos: o acesso a algum deles (ou a
 * plataforma) comecou no periodo e nenhum outro acesso aberto ja cobria o produto antes (quem ja tinha o produto,
 * ou a plataforma, nao "ganhou" de novo). Sem produto: algum acesso aberto comecou no periodo e nao estava coberto
 * antes (o da plataforma conta; um produto novo de quem ja tinha a plataforma, nao).
 */
function gainedAccessSince(facts: AudienceStudentFacts, productIds: readonly string[], since: number) {
  const coveredBefore = (productId: string) => facts.accesses.some((access) => access.startsAt < since && coversProduct(access, productId));

  if (productIds.length === 0) {
    return facts.accesses.some((access) => access.startsAt >= since && !coveredBefore(access.productId));
  }

  return productIds.some(
    (productId) => !coveredBefore(productId) && facts.accesses.some((access) => access.startsAt >= since && coversProduct(access, productId))
  );
}

/* ------------------------------------------------------------------------------------------------
 * Participacao em lives (docs/30 §1.6, D52)
 * ---------------------------------------------------------------------------------------------- */

/** O que o aluno fez numa live, pelo fato do follow-up. "clicou e não comprou" = clicou no card e nenhuma compra ligada ao clique. */
function followUpDone(fact: WebinarFollowUpFact, action: WebinarFollowUpAction) {
  switch (action) {
    case "watched_replay":
      return fact.watchedReplay;
    case "offer_seen":
      return fact.offerSeen;
    case "left_before_offer":
      return fact.leftBeforeOffer;
    case "clicked_no_purchase":
      return fact.clicked && !fact.purchased;
    case "purchased":
      return fact.purchased;
  }

  return false;
}

/**
 * O aluno fez a acao da regra? null = nao da para saber (a leitura que ela pede nao foi feita: vagas e presencas para
 * "participou" e "garantiu vaga"; o follow-up da live citada para as outras; acao do follow-up sem live): a regra nao
 * combina, nem negada.
 */
function webinarActionDone(rule: Extract<AudienceRule, { type: "webinar" }>, facts: AudienceStudentFacts, context: AudienceContext): boolean | null {
  if (isWebinarFollowUpAction(rule.action)) {
    if (rule.webinarId === null || !context.webinarFollowUpsLoaded?.has(rule.webinarId)) {
      return null;
    }

    const fact = facts.webinars?.followUps?.[rule.webinarId];

    return fact ? followUpDone(fact, rule.action) : false;
  }

  if (!context.webinarFactsLoaded) {
    return null;
  }

  const list = (rule.action === "registered" ? facts.webinars?.registered : facts.webinars?.attended) ?? [];

  return rule.webinarId === null ? list.length > 0 : list.includes(rule.webinarId);
}

/**
 * A regra "Participação em lives" para este aluno. Sem a leitura que ela pede, nunca combina (nem negada). Negada:
 * participou e garantiu vaga sao o NOT da acao ("não participou" inclui quem nem garantiu vaga); uma acao do follow-up
 * negada so vale para quem tem linha naquela live em webinar_follow_up_facts (garantiu vaga ou passou por ela: entrou,
 * viu o replay ou clicou no card), a regra da 4b (D52): "não comprou pelo card" nunca alcanca a escola inteira.
 */
function evaluateWebinarRule(rule: Extract<AudienceRule, { type: "webinar" }>, facts: AudienceStudentFacts, context: AudienceContext) {
  const done = webinarActionDone(rule, facts, context);

  if (done === null) {
    return false;
  }

  if (!rule.negate) {
    return done;
  }

  if (isWebinarFollowUpAction(rule.action)) {
    return rule.webinarId !== null && facts.webinars?.followUps?.[rule.webinarId] !== undefined && !done;
  }

  return !done;
}

/**
 * O aluno fez isto com a notificacao? (a linha existe: "received" ja vale). `choice` (v3a) = a reacao ou a
 * opcao da enquete pedida; ausente = qualquer uma.
 */
function messageDone(fact: MessageFact, action: MessageAction, choice: string | undefined) {
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
      return (
        fact.openedAt !== null ||
        fact.audioStartedAt !== null ||
        fact.clickedAt !== null ||
        fact.response !== null ||
        (fact.reaction ?? null) !== null ||
        (fact.pollChoice?.length ?? 0) > 0
      );
    case "reacted":
      return choice ? fact.reaction === choice : (fact.reaction ?? null) !== null;
    case "voted":
      return choice ? fact.pollChoice?.includes(choice) === true : (fact.pollChoice?.length ?? 0) > 0;
    case "hidden":
      return (fact.hiddenAt ?? null) !== null;
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

  const done = messageDone(fact, rule.action, rule.choice);

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

/** Chave da pagina da regra; "pagina para onde leva" pelo passo (null = externo ou nao acompanhado: nunca visitou). */
function pageKeyOfRule(page: PageTarget, context: AudienceContext): string | null {
  if (page.kind === "message_cta") {
    return context.flow?.ctaPageKeys[page.nodeId] ?? null;
  }

  return pageKeyOfTarget(page);
}

/**
 * O que os fatos precisam ter para estas regras (o motor dos fluxos so le progresso, turmas e
 * comentarios quando alguma regra pede): `students` = progresso, ultimo estudo, entrada, ritmo, turma
 * ou comentarios; `lessons` = o indice de aulas publicadas, so para progresso, ritmo e turma (a turma
 * de quem tem a plataforma inteira sai dos conteudos com aula; entrada, ultimo estudo e comentarios nao
 * usam o indice); `comments` = "ranked" quando ha regra "top N" (o ranking e entre todos os alunos);
 * `webinars` = alguma regra "Participação em lives" com "participou" ou "garantiu vaga" (as vagas e presencas de cada
 * aluno, pela RPC communication_webinar_facts; as acoes do follow-up pedem as lives delas: collectWebinarFollowUpIds).
 * Acessos e notificacoes vem sempre do lote ("Ganhou acesso recentemente" so usa os acessos).
 */
export function audienceFactNeeds(
  definitions: AudienceDefinition | null | undefined | readonly (AudienceDefinition | null | undefined)[]
): { comments: "counts" | "none" | "ranked"; lessons: boolean; students: boolean; webinars: boolean } {
  let comments: "counts" | "none" | "ranked" = "none";
  let lessons = false;
  let students = false;
  let webinars = false;
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
      case "pace":
      case "cohort":
        students = true;
        lessons = true;
        return;
      case "last_study":
      case "sign_in":
        students = true;
        return;
      case "webinar":
        webinars ||= !isWebinarFollowUpAction(node.action);
        return;
    }
  };
  const list = Array.isArray(definitions) ? definitions : [definitions as AudienceDefinition | null | undefined];

  for (const definition of list) {
    if (definition && definition.kind === "rules" && definition.root) {
      visit(definition.root);
    }
  }

  return { comments, lessons, students, webinars };
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

/** O que a ancora le do aluno: os acessos abertos agora e as turmas de agora (a turma nunca e relaxada). */
export type AnchoredAudienceFacts = { accesses: readonly AudienceAccessFact[]; cohortIds: readonly string[] };

/**
 * A ancora do "Quem pode" da live (docs/30 §1.1, D41): quem garantiu vaga ou ja entrou na sala continua no segmento
 * mesmo se sair dele pelo que vence com o tempo ou muda com o que o aluno faz, mas o produto pago e a turma sao sempre
 * conferidos de novo. Sobre os acessos abertos e as turmas de agora:
 * - cada regra que exige ter um produto (Produto "tem", "Ganhou acesso recentemente" nao negada, Tempo de acesso,
 *   Acesso terminando e Progresso) vira "tem um acesso aberto a um destes produtos, ou a plataforma inteira"
 *   ("qualquer produto", e o Progresso geral, = algum acesso aberto);
 * - a Turma vale como agora (quem foi tirado da turma sai);
 * - o resto vale como verdadeiro: o que vence com o tempo ou com a atividade (entrada, ultimo estudo, ritmo,
 *   comentarios, lives, o que fez com uma notificacao, "Ganhou acesso recentemente" negada) e "nao tem o produto"
 *   (comprar o produto durante a live nao tira ninguem da sala).
 * Os grupos "todas" e "qualquer" continuam valendo. Nunca da menos que evaluateAudience sobre os mesmos acessos e
 * turmas: quem esta no segmento agora tambem passa aqui (e quem perdeu o produto ou a turma que o segmento pede, nao).
 */
export function evaluateAnchoredAudience(definition: AudienceDefinition, facts: AnchoredAudienceFacts): boolean {
  if (definition.kind !== "rules") {
    return true;
  }

  const { accesses, cohortIds } = facts;
  const anyAccess = accesses.length > 0;
  const hasOneOf = (productIds: readonly string[]) =>
    accesses.some((access) => access.productId === PLATFORM_ACCESS_ID || productIds.includes(access.productId));
  const visit = (node: AudienceNode): boolean => {
    if (isAudienceGroup(node)) {
      return node.match === "all" ? node.items.every(visit) : node.items.some(visit);
    }

    switch (node.type) {
      case "product":
        return node.op === "has" ? hasOneOf(node.productIds) : true;
      case "access_recent":
        return node.negate ? true : node.productIds.length === 0 ? anyAccess : hasOneOf(node.productIds);
      case "access_age":
      case "access_ending":
      case "progress":
        return node.productId ? hasOneOf([node.productId]) : anyAccess;
      case "cohort":
        return cohortIds.some((id) => node.cohortIds.includes(id));
      default:
        return true;
    }
  };

  return visit(definition.root);
}

/** O segmento tem regra de Turma (a ancora le as turmas de agora: evaluateAnchoredAudience). */
export function audienceHasCohortRule(definition: AudienceDefinition | null | undefined): boolean {
  const visit = (node: AudienceNode): boolean => (isAudienceGroup(node) ? node.items.some(visit) : node.type === "cohort");

  return definition?.kind === "rules" ? visit(definition.root) : false;
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

/**
 * As lives citadas por acoes do follow-up da regra "Participação em lives" (o carregador le webinar_follow_up_facts so
 * delas), sem repeticao e em ordem. Sem live (rascunho) fica de fora: a regra nao combina.
 */
export function collectWebinarFollowUpIds(
  definitions: AudienceDefinition | null | undefined | readonly (AudienceDefinition | null | undefined)[]
): string[] {
  const ids = new Set<string>();
  const visit = (node: AudienceNode) => {
    if (isAudienceGroup(node)) {
      node.items.forEach(visit);
    } else if (node.type === "webinar" && node.webinarId && isWebinarFollowUpAction(node.action)) {
      ids.add(node.webinarId);
    }
  };
  const list = Array.isArray(definitions) ? definitions : [definitions as AudienceDefinition | null | undefined];

  for (const definition of list) {
    if (definition && definition.kind === "rules" && definition.root) {
      visit(definition.root);
    }
  }

  return Array.from(ids).sort();
}

/** O que pedir ao carregador de fatos (AudienceFactsOptions em audience-facts.ts, FactsLoader.load). */
export type AudienceFactsRequest = {
  /** Avisos citados por "o que fez com a notificacao X". */
  messageCampaignIds: string[];
  /** Lives citadas pelas acoes do follow-up (webinar_follow_up_facts so delas). */
  webinarFollowUpIds: string[];
  /** As vagas e presencas de cada aluno ("participou" e "garantiu vaga"). */
  webinars: boolean;
};

/**
 * O que pedir ao carregador de fatos (loadAudienceFacts, FactsLoader.load) para avaliar estas regras: os avisos
 * citados por "o que fez com a notificacao X" e, com a regra "Participação em lives", as vagas e presencas de cada
 * aluno e o follow-up das lives citadas pelas acoes dele.
 */
export function audienceFactsRequest(
  definitions: AudienceDefinition | null | undefined | readonly (AudienceDefinition | null | undefined)[]
): AudienceFactsRequest {
  return {
    messageCampaignIds: collectMessageCampaignIds(definitions),
    webinarFollowUpIds: collectWebinarFollowUpIds(definitions),
    webinars: audienceFactNeeds(definitions).webinars
  };
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

/**
 * `choice` da regra "message" (v3a): so a reacao do catalogo (reacted) ou um id de opcao no formato
 * (voted); qualquer outra coisa sai (= qualquer uma), para o JSON estavel comparar igual.
 */
function normalizeMessageChoice(action: MessageAction, choice: unknown): string | undefined {
  if (typeof choice !== "string") {
    return undefined;
  }

  if (action === "reacted") {
    return isReactionId(choice) ? choice : undefined;
  }

  return action === "voted" && POLL_OPTION_ID.test(choice) ? choice : undefined;
}

/** Regra das tres novas (v2) normalizada; acao, pagina ou marco desconhecido -> null (a regra sai). */
function normalizeV2Rule(rule: Extract<AudienceRule, { type: "access_gained" | "message" | "page_visit" }>): AudienceRule | null {
  const negate = rule.negate === true;

  switch (rule.type) {
    case "message": {
      const ref = normalizeMessageRef(rule.ref);

      if (!ref || !MESSAGE_ACTIONS.includes(rule.action)) {
        return null;
      }

      const choice = normalizeMessageChoice(rule.action, rule.choice);

      return choice === undefined ? { action: rule.action, negate, ref, type: "message" } : { action: rule.action, choice, negate, ref, type: "message" };
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

/** Periodo de "Ganhou acesso recentemente": hoje ou horas inteiras de 1 a 720; outro formato -> null (a regra sai). */
function normalizeAccessRecentPeriod(period: AccessRecentPeriod): AccessRecentPeriod | null {
  if (period?.kind === "today") {
    return { kind: "today" };
  }

  if (period?.kind === "hours" && typeof period.hours === "number") {
    return { hours: clampInteger(period.hours, 1, AUDIENCE_LIMITS.maxRecentHours), kind: "hours" };
  }

  return null;
}

/**
 * As duas regras de "Quem pode da live por regras"; periodo ou acao desconhecida -> null (a regra sai). Na
 * "Participação em lives", live vazia vira null ("qualquer live"; numa acao do follow-up, a live ainda por escolher:
 * a regra fica e nunca combina, para o rascunho nunca virar "todos os alunos").
 */
function normalizeLiveAudienceRule(rule: Extract<AudienceRule, { type: "access_recent" | "webinar" }>): AudienceRule | null {
  const negate = rule.negate === true;

  if (rule.type === "access_recent") {
    const period = normalizeAccessRecentPeriod(rule.period);

    return period ? { negate, period, productIds: uniqueSorted(Array.isArray(rule.productIds) ? rule.productIds : []), type: "access_recent" } : null;
  }

  if (!WEBINAR_RULE_ACTIONS.includes(rule.action)) {
    return null;
  }

  return { action: rule.action, negate, type: "webinar", webinarId: typeof rule.webinarId === "string" && rule.webinarId.trim() ? rule.webinarId.trim() : null };
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
    case "access_recent":
    case "webinar":
      return normalizeLiveAudienceRule(rule);
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

/**
 * Troca os ids de passo dentro das regras (copia com ids novos: "Duplicar", "duplicar aviso" e o "Usar" de um
 * modelo com notificacoes seguintes, docs/28 D7): a notificacao citada, a pagina do botao dela e o "desde".
 * Mora aqui (puro, sem tela); follow-ups-view-model.ts reexporta.
 */
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
  /** Id da live -> titulo (regra "Participação em lives"; sem titulo: "uma live removida"). */
  webinars?: Record<string, string>;
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
      return `${rule.negate ? "não " : ""}${MESSAGE_ACTION_SENTENCES[rule.action]?.(noticePhrase(names, rule.ref), choicePhrase(names, rule)) ?? ""}`.trimEnd();
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
    case "access_recent": {
      const list = joinWithOr(
        rule.productIds.map((id) => productName(names, id)),
        (count) => `mais ${count} ${count === 1 ? "produto" : "produtos"}`
      );

      return `${rule.negate ? "não " : ""}ganharam acesso a ${list || "qualquer produto"} ${accessRecentPeriodPhrase(rule.period)}`;
    }
    case "webinar":
      return webinarRulePhrase(rule, names);
  }

  return "";
}

/** "hoje", "na última hora" ou "nas últimas 24 horas". */
export function accessRecentPeriodPhrase(period: AccessRecentPeriod) {
  if (period.kind === "today") {
    return "hoje";
  }

  return period.hours === 1 ? "na última hora" : `nas últimas ${period.hours} horas`;
}

const MISSING_WEBINAR = "uma live removida";
const UNCHOSEN_WEBINAR = "uma live ainda não escolhida";

/**
 * Cada acao no plural, depois de "Alunos que" (did) e com "não" (didNot), e a preposicao da live ("da live" ou "na
 * live"). A negada de "clicaram para comprar e não compraram" diz o que conta, sem a dupla negacao.
 */
const WEBINAR_RULE_PHRASES: Record<WebinarRuleAction, { did: string; didNot: string; of: "de" | "em" }> = {
  attended: { did: "participaram", didNot: "não participaram", of: "de" },
  clicked_no_purchase: { did: "clicaram para comprar e não compraram", didNot: "compraram ou não clicaram para comprar", of: "em" },
  left_before_offer: { did: "saíram antes do card de compra", didNot: "não saíram antes do card de compra", of: "em" },
  offer_seen: { did: "viram o card de compra", didNot: "não viram o card de compra", of: "em" },
  purchased: { did: "compraram pelo card", didNot: "não compraram pelo card", of: "em" },
  registered: { did: "garantiram vaga", didNot: "não garantiram vaga", of: "em" },
  watched_replay: { did: "viram o replay", didNot: "não viram o replay", of: "de" }
};

/**
 * "participaram de alguma live" / "nunca participaram de nenhuma live" / "participaram da live “Y”" /
 * "garantiram vaga na live “Y”" / "viram o replay da live “Y”" / "compraram pelo card na live “Y”" (negada: "não
 * ..."). Live sem titulo nos nomes: "uma live removida"; acao do follow-up ainda sem live: "uma live ainda não
 * escolhida".
 */
function webinarRulePhrase(rule: Extract<AudienceRule, { type: "webinar" }>, names: AudienceNames) {
  const phrase = WEBINAR_RULE_PHRASES[rule.action];

  if (!phrase) {
    return "";
  }

  const verb = rule.negate ? phrase.didNot : phrase.did;

  if (rule.webinarId === null) {
    if (isWebinarFollowUpAction(rule.action)) {
      return `${verb} ${phrase.of} ${UNCHOSEN_WEBINAR}`;
    }

    const did = rule.action === "attended" ? "participaram de" : "garantiram vaga em";

    return rule.negate ? `nunca ${did} nenhuma live` : `${did} alguma live`;
  }

  const title = names.webinars?.[rule.webinarId]?.trim();

  if (!title) {
    return `${verb} ${phrase.of} ${MISSING_WEBINAR}`;
  }

  return `${verb} ${phrase.of === "de" ? "da" : "na"} live “${title}”`;
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

const MISSING_POLL_OPTION = "uma opção removida";

/**
 * v3a: a reacao ("com ❤️") ou a opcao ("em “Sábado”") da regra; null = qualquer uma. Opcao que nao veio
 * em names.pollOptions = "uma opção removida"; reacao fora do catalogo conta como qualquer uma (a
 * normalizacao ja a tira).
 */
function choicePhrase(names: AudienceNames, rule: Extract<AudienceRule, { type: "message" }>): string | null {
  if (!rule.choice) {
    return null;
  }

  if (rule.action === "reacted") {
    return isReactionId(rule.choice) ? `com ${REACTION_EMOJI[rule.choice]}` : null;
  }

  if (rule.action === "voted") {
    const label = names.pollOptions?.[messageRefKey(rule.ref)]?.[rule.choice]?.trim();

    return label ? `em “${label}”` : `em ${MISSING_POLL_OPTION}`;
  }

  return null;
}

/** Frase de cada acao, no plural depois de "Alunos que" (a negacao poe "não " na frente). */
const MESSAGE_ACTION_SENTENCES: Record<MessageAction, (notice: NoticePhrase, choice: string | null) => string> = {
  accepted: (notice) => `aceitaram ${notice.the}`,
  audio_completed: (notice) => `ouviram até o fim o áudio ${notice.of}`,
  audio_started: (notice) => `começaram a ouvir o áudio ${notice.of}`,
  clicked: (notice) => `foram para o destino ${notice.of}`,
  declined: (notice) => `recusaram ${notice.the}`,
  interacted: (notice) => `interagiram ${notice.with}`,
  opened: (notice) => `abriram ${notice.the}`,
  received: (notice) => `receberam ${notice.the}`,
  responded: (notice) => `responderam ${notice.the}`,
  seen: (notice) => `viram ${notice.the} no sino`,
  // v3a (docs/24 §6)
  hidden: (notice) => `excluíram do sino ${notice.the}`,
  reacted: (notice, choice) => (choice ? `reagiram ${choice} ${notice.to}` : `reagiram ${notice.to}`),
  voted: (notice, choice) => (choice ? `votaram ${choice} na enquete ${notice.of}` : `votaram na enquete ${notice.of}`)
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
      return `a página para onde leva ${noticePhrase(names, { kind: "node", nodeId: page.nodeId }).the}`;
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
