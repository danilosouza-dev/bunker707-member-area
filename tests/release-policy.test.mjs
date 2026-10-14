import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

const {
  getReleaseAnchorTimestamp,
  getReleaseAvailableAt,
  isReleaseRuleSatisfied,
  resolveReleaseState
} = await import("../src/server/access/release-policy.ts");
const lessonAccessSource = await readFile(
  new URL("../src/server/access/lesson-access.ts", import.meta.url),
  "utf8"
);
const learningCatalogSource = await readFile(
  new URL("../src/server/access/learning-catalog.ts", import.meta.url),
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
});

// --- Data de liberacao (fonte unica para a tela e para as APIs da aula) -----------------------------

const purchaseAt = "2026-01-01T18:00:00.000Z"; // 01/01/2026 15:00 em Sao Paulo

test("resolveReleaseState devolve a data real: compra + atraso, no acesso mais antigo", () => {
  const sevenDays = { delayUnit: "dias", delayValue: "7", mode: "after_purchase" };
  const beforeRelease = Date.parse("2026-01-05T12:00:00.000Z");

  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [{ starts_at: purchaseAt }],
    now: beforeRelease,
    releaseRule: sevenDays
  }), { availableAt: "2026-01-08T18:00:00.000Z", precision: "day", status: "scheduled" });

  // Dois acessos (ex.: compra e liberacao manual depois): vale o mais antigo.
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [{ starts_at: "2026-01-04T10:00:00.000Z" }, { starts_at: purchaseAt }],
    now: beforeRelease,
    releaseRule: sevenDays
  }), { availableAt: "2026-01-08T18:00:00.000Z", precision: "day", status: "scheduled" });

  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [{ starts_at: purchaseAt }],
    now: Date.parse("2026-01-08T18:00:00.000Z"),
    releaseRule: sevenDays
  }), { status: "released" });

  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [{ starts_at: purchaseAt }],
    now: Date.parse("2026-01-01T19:00:00.000Z"),
    releaseRule: { delayUnit: "horas", delayValue: "6", mode: "after_enrollment" }
  }), { availableAt: "2026-01-02T00:00:00.000Z", precision: "hour", status: "scheduled" });
});

test("sem acesso real nao ha data: estado unknown (frase generica na tela)", () => {
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [],
    now,
    releaseRule: { delayUnit: "dias", delayValue: "7", mode: "after_purchase" }
  }), { status: "unknown" });
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [{ starts_at: purchaseAt }],
    now,
    releaseRule: { delayUnit: "semanas", delayValue: "1", mode: "after_purchase" }
  }), { status: "unknown" });
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [],
    now,
    releaseRule: { fixedDate: "data invalida", mode: "fixed_date" }
  }), { status: "unknown" });
});

test("data fixa, aula anterior e atividade viram estados proprios", () => {
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [],
    now,
    releaseRule: { fixedDate: "2026-08-01T03:00:00.000Z", mode: "fixed_date" }
  }), { availableAt: "2026-08-01T03:00:00.000Z", precision: "day", status: "scheduled" });
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [],
    now,
    releaseRule: { fixedDate: "2026-08-01T17:30:00.000Z", mode: "fixed_date" }
  }), { availableAt: "2026-08-01T17:30:00.000Z", precision: "hour", status: "scheduled" });
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [],
    now,
    previousLessonId: "lesson-previous",
    releaseRule: { mode: "after_previous_lesson" }
  }), { previousLessonId: "lesson-previous", status: "waiting_previous_lesson" });
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [],
    now,
    releaseRule: { mode: "activity_required", requirement: "Envie o projeto" }
  }), { requirement: "Envie o projeto", status: "waiting_activity" });
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [],
    now,
    releaseRule: null
  }), { status: "released" });
});

test("garantia: warranty_ends_at so conta com anchor warranty_end; sem a data volta para a compra", () => {
  const entitlement = { starts_at: purchaseAt, warranty_ends_at: "2026-01-08T18:00:00.000Z" };
  const rule = { delayUnit: "dias", delayValue: "1", mode: "after_purchase" };

  assert.equal(getReleaseAnchorTimestamp(entitlement, rule), Date.parse(purchaseAt));
  assert.equal(getReleaseAvailableAt({ matchingEntitlements: [entitlement], releaseRule: rule }), Date.parse("2026-01-02T18:00:00.000Z"));

  const warrantyRule = { ...rule, anchor: "warranty_end" };
  assert.equal(getReleaseAnchorTimestamp(entitlement, warrantyRule), Date.parse("2026-01-08T18:00:00.000Z"));
  assert.equal(
    getReleaseAvailableAt({ matchingEntitlements: [entitlement], releaseRule: warrantyRule }),
    Date.parse("2026-01-09T18:00:00.000Z")
  );
  assert.equal(getReleaseAnchorTimestamp({ starts_at: purchaseAt }, warrantyRule), Date.parse(purchaseAt));

  // Atraso zero contado do fim da garantia ainda espera a garantia acabar.
  assert.deepEqual(resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: [entitlement],
    now: Date.parse("2026-01-05T12:00:00.000Z"),
    releaseRule: { anchor: "warranty_end", delayValue: "0", mode: "after_purchase" }
  }), { availableAt: "2026-01-08T18:00:00.000Z", precision: "day", status: "scheduled" });
});

test("propriedade: isReleaseRuleSatisfied e exatamente o estado released", () => {
  const rules = [
    undefined,
    null,
    { mode: "immediate" },
    { delayUnit: "dias", delayValue: "7", mode: "after_purchase" },
    { delayUnit: "horas", delayValue: "6", mode: "after_enrollment" },
    { delayValue: "0", mode: "after_enrollment" },
    { delayValue: "-1", mode: "after_enrollment" },
    { delayValue: "abc", mode: "after_purchase" },
    { anchor: "warranty_end", delayValue: "0", mode: "after_purchase" },
    { anchor: "warranty_end", delayUnit: "dias", delayValue: "2", mode: "after_purchase" },
    { fixedDate: "2026-01-03T00:00:00.000Z", mode: "fixed_date" },
    { fixedDate: "2026-02-01T15:00:00.000Z", mode: "fixed_date" },
    { fixedDate: "", mode: "fixed_date" },
    { mode: "after_previous_lesson" },
    { mode: "activity_required" }
  ];
  const entitlementSets = [
    [],
    [{ starts_at: purchaseAt }],
    [{ starts_at: null }],
    [{ starts_at: purchaseAt, warranty_ends_at: "2026-01-08T18:00:00.000Z" }, { starts_at: "2026-01-20T00:00:00.000Z" }]
  ];
  const instants = ["2026-01-01T18:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-08T17:59:59.000Z", "2026-03-01T00:00:00.000Z"]
    .map((value) => Date.parse(value));
  const previousOptions = [undefined, "lesson-previous", "lesson-missing"];
  let combinations = 0;

  for (const releaseRule of rules) {
    for (const matchingEntitlements of entitlementSets) {
      for (const instant of instants) {
        for (const previousLessonId of previousOptions) {
          const input = { completedLessonIds, matchingEntitlements, now: instant, previousLessonId, releaseRule };
          assert.equal(
            isReleaseRuleSatisfied(input),
            resolveReleaseState(input).status === "released",
            JSON.stringify({ instant, matchingEntitlements, previousLessonId, releaseRule })
          );
          combinations += 1;
        }
      }
    }
  }

  assert.ok(combinations > 500);
});
