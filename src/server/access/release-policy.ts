import type { ReleaseRuleConfig } from "@/lib/platform-types";
import type { MemberReleaseState } from "@/lib/release-state";
import { formatMemberTime } from "../../lib/member-format";

// Regra de liberacao (conteudo, modulo, aula) para um aluno. Fonte unica da conta:
// - lesson-access.ts e learning-catalog.ts perguntam "esta liberado?" (isReleaseRuleSatisfied);
// - platform-store.ts pergunta "quando libera?" (resolveReleaseState) para a pagina mostrar
//   "Liberação em 08/01/2026" com a mesma data que o servidor usa para abrir a aula.
// isReleaseRuleSatisfied e resolveReleaseState(...).status === "released" sao a mesma coisa (teste).

export type ReleasePolicyEntitlement = {
  /** Inicio do acesso (data da compra/liberacao manual). */
  starts_at: string | null;
  /**
   * Fim da garantia da compra (Hotmart: purchase.warranty_expire_date). Hoje ninguem grava: o pipeline
   * de compras ainda nao existe. So e usado quando a regra pede `anchor: "warranty_end"`.
   */
  warranty_ends_at?: string | null;
};

export type ReleasePolicyInput = {
  completedLessonIds: ReadonlySet<string>;
  matchingEntitlements: ReleasePolicyEntitlement[];
  now: number;
  previousLessonId?: string;
  releaseRule: ReleaseRuleConfig | null | undefined;
};

const releasedState: MemberReleaseState = { status: "released" };
const unknownState: MemberReleaseState = { status: "unknown" };

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getDelayMilliseconds(releaseRule: ReleaseRuleConfig) {
  const delay = Number(releaseRule.delayValue);

  if (!Number.isFinite(delay) || delay < 0) return null;
  if (delay === 0) return 0;
  if (releaseRule.delayUnit !== undefined && releaseRule.delayUnit !== "horas" && releaseRule.delayUnit !== "dias") {
    return null;
  }
  const hours = releaseRule.delayUnit === "horas" ? delay : delay * 24;
  return hours * 60 * 60 * 1_000;
}

function isAnchoredMode(releaseRule: ReleaseRuleConfig) {
  return releaseRule.mode === "after_enrollment" || releaseRule.mode === "after_purchase";
}

/**
 * Ponto de extensao da garantia: de onde conta o atraso para um acesso.
 * - Padrao: inicio do acesso (`starts_at`, a data da compra).
 * - `anchor: "warranty_end"`: fim da garantia gravado no acesso (`warranty_ends_at`). Sem a data
 *   gravada (provedor que nao manda, compra manual), volta para o inicio do acesso.
 */
export function getReleaseAnchorTimestamp(
  entitlement: ReleasePolicyEntitlement,
  releaseRule: Pick<ReleaseRuleConfig, "anchor">
) {
  if (releaseRule.anchor === "warranty_end") {
    const warrantyEndsAt = parseDate(entitlement.warranty_ends_at);

    if (warrantyEndsAt !== null) {
      return warrantyEndsAt;
    }
  }

  return parseDate(entitlement.starts_at);
}

/**
 * Instante (ms) em que a regra libera para este aluno, ou null quando nao ha como saber (sem acesso
 * real, regra invalida, regra que nao depende de data).
 * - after_enrollment/after_purchase: acesso mais antigo que casa com o conteudo + atraso.
 * - fixed_date: a data fixa.
 */
export function getReleaseAvailableAt({
  matchingEntitlements,
  releaseRule
}: Pick<ReleasePolicyInput, "matchingEntitlements" | "releaseRule">): number | null {
  if (!releaseRule) return null;

  if (releaseRule.mode === "fixed_date") {
    return parseDate(releaseRule.fixedDate);
  }

  if (!isAnchoredMode(releaseRule)) return null;

  const delayMilliseconds = getDelayMilliseconds(releaseRule);

  if (delayMilliseconds === null) return null;

  let earliestAnchor: number | null = null;

  for (const entitlement of matchingEntitlements) {
    const anchor = getReleaseAnchorTimestamp(entitlement, releaseRule);

    if (anchor !== null && (earliestAnchor === null || anchor < earliestAnchor)) {
      earliestAnchor = anchor;
    }
  }

  return earliestAnchor === null ? null : earliestAnchor + delayMilliseconds;
}

function scheduledState(availableAt: number, precision: "day" | "hour"): MemberReleaseState {
  return { availableAt: new Date(availableAt).toISOString(), precision, status: "scheduled" };
}

/** Estado completo da regra para este aluno, com a data quando ela existe. */
export function resolveReleaseState({
  completedLessonIds,
  matchingEntitlements,
  now,
  previousLessonId,
  releaseRule
}: ReleasePolicyInput): MemberReleaseState {
  if (!releaseRule || releaseRule.mode === "immediate") return releasedState;

  if (releaseRule.mode === "fixed_date") {
    const fixedDate = parseDate(releaseRule.fixedDate);

    if (fixedDate === null) return unknownState;
    if (fixedDate <= now) return releasedState;
    // Data fixa com horario (diferente de 00:00 em Sao Paulo) mostra a hora; meia-noite mostra so o dia.
    return scheduledState(fixedDate, formatMemberTime(fixedDate) === "00:00" ? "day" : "hour");
  }

  if (isAnchoredMode(releaseRule)) {
    const delayMilliseconds = getDelayMilliseconds(releaseRule);

    if (delayMilliseconds === null) return unknownState;
    // Atraso zero contado do inicio do acesso equivale a liberar na hora (mesmo sem acesso gravado).
    if (delayMilliseconds === 0 && releaseRule.anchor !== "warranty_end") return releasedState;

    const availableAt = getReleaseAvailableAt({ matchingEntitlements, releaseRule });

    if (availableAt === null) return unknownState;
    if (availableAt <= now) return releasedState;
    return scheduledState(availableAt, releaseRule.delayUnit === "horas" ? "hour" : "day");
  }

  if (releaseRule.mode === "after_previous_lesson") {
    if (previousLessonId && completedLessonIds.has(previousLessonId)) return releasedState;
    return previousLessonId
      ? { previousLessonId, status: "waiting_previous_lesson" }
      : { status: "waiting_previous_lesson" };
  }

  // activity_required e modos futuros ficam bloqueados ate existir um resolvedor que comprove a
  // atividade.
  return releaseRule.requirement?.trim()
    ? { requirement: releaseRule.requirement.trim(), status: "waiting_activity" }
    : { status: "waiting_activity" };
}

export function isReleaseRuleSatisfied(input: ReleasePolicyInput) {
  return resolveReleaseState(input).status === "released";
}
