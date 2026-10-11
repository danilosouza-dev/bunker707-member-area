import type { ReleaseRuleConfig } from "./platform-types";
import type { MemberReleaseState } from "./release-state";
import { formatMemberDate, formatMemberDateTime, formatMemberTime, getMemberDayDifference, toMemberTimestamp } from "./member-format";

// Texto de liberacao mostrado ao aluno (lista de aulas, aviso sobre o video, cards e biblioteca).
//
// Com o estado calculado no servidor (`releaseState`, src/server/access/release-policy.ts), o texto
// traz a data real: "Liberação em 08/01/2026", "Liberação em 08/01/2026 às 14:00" (regra em horas) ou
// "Liberação hoje às 14:00". Sem estado (ou estado "unknown": previa do produtor, visitante, gratuito
// sem compra) cai na frase generica da regra, com acento.
//
// Datas sempre no fuso de Sao Paulo (member-format): servidor e navegador escrevem o mesmo dia. So o
// "hoje" depende do relogio: quem mostra o texto marca o elemento com suppressHydrationWarning quando
// `isClockDependent` for true.

export type ReleaseRuleNoticeKind =
  /** Tem data (estado agendado ou data fixa). */
  | "scheduled"
  /** A data ja passou no relogio do navegador: falta so atualizar a pagina. */
  | "due"
  /** Depende de concluir a aula anterior. */
  | "previous_lesson"
  /** Depende de atividade obrigatoria. */
  | "activity"
  /** Sem data calculavel (frase generica da regra). */
  | "generic";

export type ReleaseRuleNotice = {
  /** ISO do momento da liberacao, quando conhecido. */
  availableAt?: string;
  detail: string;
  /** Linha discreta de contexto, ex.: "Conta a partir da data da sua compra." */
  hint?: string;
  /** O texto usa "hoje" (depende do relogio). */
  isClockDependent?: boolean;
  isLocked: boolean;
  kind: ReleaseRuleNoticeKind;
  /** Selo curto para miniatura: "Liberação em 08/01", "Hoje às 14:00", "Após a aula anterior". */
  shortLabel: string;
  title: string;
};

type EntityName = { feminine: boolean; name: string };

const entityNames: Record<string, EntityName> = {
  aula: { feminine: true, name: "aula" },
  bootcamp: { feminine: false, name: "bootcamp" },
  conteudo: { feminine: false, name: "conteúdo" },
  "conteúdo": { feminine: false, name: "conteúdo" },
  curso: { feminine: false, name: "curso" },
  formacao: { feminine: true, name: "formação" },
  "formação": { feminine: true, name: "formação" },
  material: { feminine: false, name: "material" },
  mentoria: { feminine: true, name: "mentoria" },
  modulo: { feminine: false, name: "módulo" },
  "módulo": { feminine: false, name: "módulo" },
  produto: { feminine: false, name: "produto" },
  webinario: { feminine: true, name: "gravação" },
  "webinário": { feminine: true, name: "gravação" }
};

function getEntityName(entityLabel: string): EntityName {
  return entityNames[entityLabel.trim().toLowerCase()] ?? { feminine: false, name: entityLabel.trim().toLowerCase() || "conteúdo" };
}

function getTitles(entityLabel: string) {
  const { feminine, name } = getEntityName(entityLabel);
  const article = feminine ? "Esta" : "Este";

  return {
    blocked: `${article} ${name} ainda está ${feminine ? "bloqueada" : "bloqueado"}`,
    due: `${article} ${name} já foi ${feminine ? "liberada" : "liberado"}`,
    scheduled: `${article} ${name} será ${feminine ? "liberada" : "liberado"}`
  };
}

function formatDelayAmount(releaseRule: ReleaseRuleConfig) {
  const value = releaseRule.delayValue?.trim();
  const amount = Number(value);

  if (!value || !Number.isFinite(amount)) {
    return "";
  }

  const isHours = releaseRule.delayUnit === "horas";
  const unit = isHours ? (amount === 1 ? "hora" : "horas") : (amount === 1 ? "dia" : "dias");

  return `${amount.toLocaleString("pt-BR")} ${unit}`;
}

function getAnchorPhrase(releaseRule: ReleaseRuleConfig) {
  return releaseRule.mode === "after_purchase" ? "após a compra" : "após a inscrição";
}

function getScheduledHint(releaseRule: ReleaseRuleConfig | undefined) {
  if (!releaseRule) {
    return undefined;
  }

  if (releaseRule.mode === "after_enrollment" || releaseRule.mode === "after_purchase") {
    return releaseRule.anchor === "warranty_end"
      ? "Conta a partir do fim da garantia da sua compra."
      : "Conta a partir da data da sua compra.";
  }

  return undefined;
}

/**
 * Texto da data: "Liberação em 08/01/2026", "Liberação em 08/01/2026 às 14:00" ou, no mesmo dia
 * (Sao Paulo), "Liberação hoje às 14:00".
 */
export function formatReleaseDate(availableAt: number, precision: "day" | "hour", now: number) {
  const dayDifference = getMemberDayDifference(now, availableAt);

  if (dayDifference === 0) {
    return {
      detail: `Liberação hoje às ${formatMemberTime(availableAt)}`,
      isClockDependent: true,
      shortLabel: `Hoje às ${formatMemberTime(availableAt)}`
    };
  }

  const shortDate = formatMemberDate(availableAt).slice(0, 5);

  return {
    detail: precision === "hour"
      ? `Liberação em ${formatMemberDateTime(availableAt)}`
      : `Liberação em ${formatMemberDate(availableAt)}`,
    isClockDependent: false,
    shortLabel: `Liberação em ${shortDate}`
  };
}

function getDatedNotice(
  availableAt: number,
  precision: "day" | "hour",
  entityLabel: string,
  releaseRule: ReleaseRuleConfig | undefined,
  now: number
): ReleaseRuleNotice {
  const titles = getTitles(entityLabel);

  if (availableAt <= now) {
    return {
      availableAt: new Date(availableAt).toISOString(),
      detail: "Atualize a página para acessar.",
      isClockDependent: true,
      isLocked: true,
      kind: "due",
      shortLabel: "Liberada",
      title: titles.due
    };
  }

  const formatted = formatReleaseDate(availableAt, precision, now);

  return {
    availableAt: new Date(availableAt).toISOString(),
    detail: formatted.detail,
    hint: getScheduledHint(releaseRule),
    isClockDependent: formatted.isClockDependent,
    isLocked: true,
    kind: "scheduled",
    shortLabel: formatted.shortLabel,
    title: titles.scheduled
  };
}

function getPreviousLessonNotice(entityLabel: string): ReleaseRuleNotice {
  return {
    detail: "Disponível depois que a aula anterior for concluída",
    isLocked: true,
    kind: "previous_lesson",
    shortLabel: "Após a aula anterior",
    title: getTitles(entityLabel).blocked
  };
}

function getActivityNotice(entityLabel: string, requirement?: string): ReleaseRuleNotice {
  return {
    detail: requirement?.trim() || "Disponível depois que a atividade obrigatória for concluída",
    isLocked: true,
    kind: "activity",
    shortLabel: "Bloqueada",
    title: getTitles(entityLabel).blocked
  };
}

/** Frase da regra sem dado do aluno (previa, visitante, sem compra). */
function getStaticReleaseRuleNotice(
  releaseRule: ReleaseRuleConfig,
  entityLabel: string,
  now: number
): ReleaseRuleNotice | null {
  if (releaseRule.mode === "immediate") {
    return null;
  }

  if (releaseRule.mode === "fixed_date") {
    const fixedDate = toMemberTimestamp(releaseRule.fixedDate);

    if (fixedDate === null) {
      return {
        detail: "Disponível na data agendada",
        isLocked: true,
        kind: "generic",
        shortLabel: "Em breve",
        title: getTitles(entityLabel).scheduled
      };
    }

    if (fixedDate <= now) {
      return null;
    }

    return getDatedNotice(fixedDate, formatMemberTime(fixedDate) === "00:00" ? "day" : "hour", entityLabel, releaseRule, now);
  }

  if (releaseRule.mode === "after_enrollment" || releaseRule.mode === "after_purchase") {
    const delayValue = Number(releaseRule.delayValue ?? 0);

    if (!Number.isNaN(delayValue) && delayValue <= 0 && releaseRule.anchor !== "warranty_end") {
      return null;
    }

    const amount = formatDelayAmount(releaseRule);
    const anchor = releaseRule.anchor === "warranty_end" ? "após o fim da garantia" : getAnchorPhrase(releaseRule);

    return {
      detail: amount ? `Disponível ${amount} ${anchor}` : `Disponível ${anchor}`,
      isLocked: true,
      kind: "generic",
      shortLabel: amount ? `${amount} ${anchor}` : `Disponível ${anchor}`,
      title: getTitles(entityLabel).scheduled
    };
  }

  if (releaseRule.mode === "after_previous_lesson") {
    return getPreviousLessonNotice(entityLabel);
  }

  return getActivityNotice(entityLabel, releaseRule.requirement);
}

/**
 * Aviso de liberacao de um conteudo/modulo/aula. null = liberado.
 *
 * - `releaseState` (do servidor) manda: "released" -> null; "scheduled" -> data real; "unknown" ou
 *   ausente -> frase generica da regra.
 * - `now` so decide "hoje" e se a data ja passou com a pagina aberta ("due").
 */
export function getReleaseRuleNotice(
  releaseRule?: ReleaseRuleConfig,
  entityLabel = "conteudo",
  releaseState?: MemberReleaseState,
  now: number = Date.now()
): ReleaseRuleNotice | null {
  if (releaseState?.status === "released") {
    return null;
  }

  if (releaseState?.status === "scheduled") {
    const availableAt = toMemberTimestamp(releaseState.availableAt);

    if (availableAt !== null) {
      return getDatedNotice(availableAt, releaseState.precision, entityLabel, releaseRule, now);
    }
  }

  if (releaseState?.status === "waiting_previous_lesson") {
    return getPreviousLessonNotice(entityLabel);
  }

  if (releaseState?.status === "waiting_activity") {
    return getActivityNotice(entityLabel, releaseState.requirement ?? releaseRule?.requirement);
  }

  if (!releaseRule) {
    return null;
  }

  return getStaticReleaseRuleNotice(releaseRule, entityLabel, now);
}

const noticePriority: Record<ReleaseRuleNoticeKind, number> = {
  activity: 4,
  due: 0,
  generic: 2,
  previous_lesson: 3,
  scheduled: 1
};

/**
 * Aviso que vale para a aula quando conteudo, modulo e aula tem regras: o mais restritivo. Sem data
 * (atividade, aula anterior, frase generica) vence a data; entre datas, vale a mais distante.
 */
export function pickReleaseNotice(notices: ReadonlyArray<ReleaseRuleNotice | null | undefined>): ReleaseRuleNotice | null {
  let picked: ReleaseRuleNotice | null = null;

  for (const notice of notices) {
    if (!notice?.isLocked) {
      continue;
    }

    if (!picked) {
      picked = notice;
      continue;
    }

    const pickedPriority = noticePriority[picked.kind];
    const noticePriorityValue = noticePriority[notice.kind];

    if (noticePriorityValue > pickedPriority) {
      picked = notice;
      continue;
    }

    if (
      noticePriorityValue === pickedPriority &&
      notice.availableAt &&
      picked.availableAt &&
      Date.parse(notice.availableAt) > Date.parse(picked.availableAt)
    ) {
      picked = notice;
    }
  }

  return picked;
}

/** Proximo instante (ms) em que algum aviso agendado vira "liberado", para a pagina se atualizar. */
export function getNextReleaseTimestamp(
  states: ReadonlyArray<MemberReleaseState | null | undefined>,
  now: number
): number | null {
  let next: number | null = null;

  for (const state of states) {
    if (state?.status !== "scheduled") {
      continue;
    }

    const availableAt = toMemberTimestamp(state.availableAt);

    if (availableAt !== null && availableAt > now && (next === null || availableAt < next)) {
      next = availableAt;
    }
  }

  return next;
}

/**
 * Novas tentativas de atualizar a pagina quando uma data de liberacao chega com a pagina aberta (ms).
 * Se o relogio do navegador estiver adiantado em relacao ao servidor, a primeira atualizacao ainda
 * volta "agendado"; estas esperas cobrem alguns segundos de diferenca sem martelar o servidor.
 */
export const RELEASE_REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

/**
 * Espera antes da tentativa `attempt` de atualizar a pagina (0 = a primeira, na hora). null = desiste;
 * o aviso sobre o video continua com o botao "Atualizar agora".
 */
export function getReleaseRefreshDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) {
    return null;
  }

  return attempt === 0 ? 0 : RELEASE_REFRESH_RETRY_DELAYS_MS[attempt - 1] ?? null;
}
