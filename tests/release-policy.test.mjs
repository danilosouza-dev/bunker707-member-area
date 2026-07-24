import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { isReleaseRuleSatisfied } = await import("../src/server/access/release-policy.ts");
const lessonAccessSource = await readFile(
  new URL("../src/server/access/lesson-access.ts", import.meta.url),
  "utf8"
);
const learningCatalogSource = await readFile(
  new URL("../src/server/access/learning-catalog.ts", import.meta.url),
  "utf8"
);
const platformStoreSource = await readFile(
  new URL("../src/server/db/platform-store.ts", import.meta.url),
  "utf8"
);

const now = Date.parse("2026-07-17T12:00:00.000Z");
const completedLessonIds = new Set(["lesson-previous"]);

test("release policy evaluates enrollment and purchase delays from the matching entitlement", () => {
  const maturedEntitlement = [{ starts_at: "2026-07-15T11:00:00.000Z" }];
  const recentEntitlement = [{ starts_at: "2026-07-17T11:30:00.000Z" }];

  assert.equal(isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements: maturedEntitlement,
    now,
    releaseRule: { delayUnit: "dias", delayValue: "2", mode: "after_enrollment" }
  }), true);
  assert.equal(isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements: recentEntitlement,
    now,
    releaseRule: { delayUnit: "horas", delayValue: "1", mode: "after_purchase" }
  }), false);
  assert.equal(isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements: maturedEntitlement,
    now,
    releaseRule: { delayUnit: "dias", delayValue: "-1", mode: "after_enrollment" }
  }), false);
});

test("release policy evaluates dates and the actual previous lesson", () => {
  assert.equal(isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements: [],
    now,
    releaseRule: { fixedDate: "2026-07-17T11:59:59.000Z", mode: "fixed_date" }
  }), true);
  assert.equal(isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements: [],
    now,
    previousLessonId: "lesson-previous",
    releaseRule: { mode: "after_previous_lesson" }
  }), true);
  assert.equal(isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements: [],
    now,
    previousLessonId: "lesson-missing",
    releaseRule: { mode: "after_previous_lesson" }
  }), false);
});

test("lesson APIs and IA Diretor share the same release policy and validated formation parent", () => {
  assert.match(lessonAccessSource, /import \{ isReleaseRuleSatisfied \} from "@\/server\/access\/release-policy"/);
  assert.match(learningCatalogSource, /import \{ isReleaseRuleSatisfied \} from "@\/server\/access\/release-policy"/);
  assert.doesNotMatch(lessonAccessSource, /getReleaseRuleNotice/);
  assert.match(lessonAccessSource, /parentFormation\?\.kind === "Formacao"/);
  assert.match(learningCatalogSource, /publishedFormationIds\.has\(parentFormationId\)/);
  assert.match(platformStoreSource, /Selecione uma formacao principal valida para este curso interno/);
});
