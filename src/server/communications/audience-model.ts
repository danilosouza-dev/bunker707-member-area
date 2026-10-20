// Segmento dos avisos (Comunicacao > Avisos e pop-ups, docs/22 §3): "Para quem" vai cada notificacao ou
// pop-up. Regras combinaveis em grupos E/OU (um nivel de grupo dentro do principal), avaliadas no
// servidor sobre os fatos de cada aluno (src/server/communications/audience-facts.ts). Modulo puro:
// sem "server-only" e com imports relativos, para tests/comunicacao-segmentos.test.mjs carregar direto
// pelo Node; o editor do admin importa os mesmos tipos e frases.
//
// A equipe (admin_roles) nunca entra: quem monta os fatos ja tira a equipe antes de avaliar.

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
  "cohort"
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
  | { cohortIds: string[]; type: "cohort" };

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

/** Acesso aberto agora. O acesso a plataforma inteira usa productId "platform". */
export type AudienceAccessFact = { endsAt: number | null; productId: string; startsAt: number };

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
};

export type CommentRankWindow = "7" | "30" | "90" | "all";

export type AudienceContext = {
  /** Posicao (1 = quem mais comentou) entre os alunos com pelo menos 1 comentario na janela. */
  commentRanks: Record<CommentRankWindow, Map<string, number>>;
  /** Aulas publicadas por conteudo. */
  lessonTotals: Record<string, number>;
  now: number;
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
  }

  return false;
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

function normalizeRule(rule: AudienceRule): AudienceRule {
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
      items.push(normalizeRule(item));
    }
  }

  return { items, match: group.match };
}

/** Ids sem repeticao, numeros nos limites, grupos vazios fora. Segmento sem regra vira "todos os alunos". */
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

export type AudienceNames = { cohorts: Record<string, string>; products: Record<string, string> };

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
  }

  return "";
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
