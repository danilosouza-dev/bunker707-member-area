import type { ReleaseRuleConfig } from "@/lib/platform-types";

export type ReleasePolicyEntitlement = {
  starts_at: string | null;
};

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

export function isReleaseRuleSatisfied({
  completedLessonIds,
  matchingEntitlements,
  now,
  previousLessonId,
  releaseRule
}: {
  completedLessonIds: ReadonlySet<string>;
  matchingEntitlements: ReleasePolicyEntitlement[];
  now: number;
  previousLessonId?: string;
  releaseRule: ReleaseRuleConfig | null | undefined;
}) {
  if (!releaseRule || releaseRule.mode === "immediate") return true;

  if (releaseRule.mode === "fixed_date") {
    const fixedDate = parseDate(releaseRule.fixedDate);
    return fixedDate !== null && fixedDate <= now;
  }

  if (releaseRule.mode === "after_enrollment" || releaseRule.mode === "after_purchase") {
    const delayMilliseconds = getDelayMilliseconds(releaseRule);

    if (delayMilliseconds === null) return false;
    if (delayMilliseconds === 0) return true;
    return matchingEntitlements.some((entitlement) => {
      const startsAt = parseDate(entitlement.starts_at);
      return startsAt !== null && startsAt + delayMilliseconds <= now;
    });
  }

  if (releaseRule.mode === "after_previous_lesson") {
    return Boolean(previousLessonId && completedLessonIds.has(previousLessonId));
  }

  // activity_required and future modes stay unavailable until their
  // prerequisite can be proven by a dedicated access resolver.
  return false;
}
