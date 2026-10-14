import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// "Disponível 7 dias após a inscrição" vira a data real da liberação, calculada no servidor com a
// mesma conta das APIs da aula, no fuso de São Paulo.

const { resolveReleaseState } = await import("../src/server/access/release-policy.ts");
const {
  getNextReleaseTimestamp,
  getReleaseRefreshDelay,
  getReleaseRuleNotice,
  pickReleaseNotice,
  RELEASE_REFRESH_RETRY_DELAYS_MS
} = await import("../src/lib/release-rules.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const purchaseAt = "2026-01-01T18:00:00.000Z"; // 01/01/2026 15:00 em São Paulo
const sevenDaysAfterPurchase = { delayUnit: "dias", delayValue: "7", mode: "after_purchase" };

function stateFor(releaseRule, entitlements, now) {
  return resolveReleaseState({
    completedLessonIds: new Set(),
    matchingEntitlements: entitlements,
    now,
    releaseRule
  });
}

test("compra em 01/01/2026 15:00 + 7 dias mostra 'Liberação em 08/01/2026' na lista e sobre o vídeo", () => {
  const now = Date.parse("2026-01-03T12:00:00.000Z");
  const state = stateFor(sevenDaysAfterPurchase, [{ starts_at: purchaseAt }], now);
  const notice = getReleaseRuleNotice(sevenDaysAfterPurchase, "aula", state, now);

  assert.equal(notice.detail, "Liberação em 08/01/2026");
  assert.equal(notice.title, "Esta aula será liberada");
  assert.equal(notice.shortLabel, "Liberação em 08/01");
  assert.equal(notice.hint, "Conta a partir da data da sua compra.");
  assert.equal(notice.kind, "scheduled");
  assert.equal(notice.isLocked, true);
  assert.equal(notice.isClockDependent, false);
  assert.equal(notice.availableAt, "2026-01-08T18:00:00.000Z");
});

test("regra em horas mostra o horário; no mesmo dia mostra 'hoje'", () => {
  const rule = { delayUnit: "horas", delayValue: "6", mode: "after_enrollment" };
  const state = stateFor(rule, [{ starts_at: purchaseAt }], Date.parse("2026-01-01T19:00:00.000Z"));

  assert.equal(
    getReleaseRuleNotice(rule, "modulo", state, Date.parse("2025-12-31T12:00:00.000Z")).detail,
    "Liberação em 01/01/2026 às 21:00"
  );

  const sameDay = getReleaseRuleNotice(rule, "modulo", state, Date.parse("2026-01-01T19:00:00.000Z"));
  assert.equal(sameDay.detail, "Liberação hoje às 21:00");
  assert.equal(sameDay.shortLabel, "Hoje às 21:00");
  assert.equal(sameDay.title, "Este módulo será liberado");
  assert.equal(sameDay.isClockDependent, true);

  // Regra em dias, no proprio dia da liberacao, tambem diz o horario.
  const dayState = stateFor(sevenDaysAfterPurchase, [{ starts_at: purchaseAt }], Date.parse("2026-01-08T12:00:00.000Z"));
  assert.equal(
    getReleaseRuleNotice(sevenDaysAfterPurchase, "aula", dayState, Date.parse("2026-01-08T12:00:00.000Z")).detail,
    "Liberação hoje às 15:00"
  );
});

test("acesso às 02:30 UTC cai no dia certo de São Paulo (23:30 do dia anterior)", () => {
  const lateNightPurchase = "2026-01-02T02:30:00.000Z"; // 01/01/2026 23:30 em São Paulo
  const now = Date.parse("2026-01-03T12:00:00.000Z");
  const state = stateFor(sevenDaysAfterPurchase, [{ starts_at: lateNightPurchase }], now);

  assert.equal(getReleaseRuleNotice(sevenDaysAfterPurchase, "aula", state, now).detail, "Liberação em 08/01/2026");
});

test("com dois acessos vale o mais antigo", () => {
  const now = Date.parse("2026-01-03T12:00:00.000Z");
  const state = stateFor(
    sevenDaysAfterPurchase,
    [{ starts_at: "2026-01-02T12:00:00.000Z" }, { starts_at: purchaseAt }],
    now
  );

  assert.equal(getReleaseRuleNotice(sevenDaysAfterPurchase, "aula", state, now).detail, "Liberação em 08/01/2026");
});

test("prévia, gratuito sem compra e visitante (unknown) caem na frase genérica com acento", () => {
  const unknown = { status: "unknown" };

  assert.equal(getReleaseRuleNotice(sevenDaysAfterPurchase, "aula", unknown).detail, "Disponível 7 dias após a compra");
  assert.equal(
    getReleaseRuleNotice({ delayUnit: "dias", delayValue: "7", mode: "after_enrollment" }, "aula", unknown).detail,
    "Disponível 7 dias após a inscrição"
  );
  assert.equal(
    getReleaseRuleNotice({ delayUnit: "horas", delayValue: "1", mode: "after_enrollment" }, "modulo").detail,
    "Disponível 1 hora após a inscrição"
  );
  assert.equal(getReleaseRuleNotice(sevenDaysAfterPurchase, "aula").title, "Esta aula será liberada");
  assert.equal(getReleaseRuleNotice({ mode: "after_previous_lesson" }, "aula").detail, "Disponível depois que a aula anterior for concluída");
  assert.equal(getReleaseRuleNotice({ mode: "after_previous_lesson" }, "modulo").title, "Este módulo ainda está bloqueado");
  assert.equal(getReleaseRuleNotice({ delayValue: "0", mode: "after_purchase" }, "aula", unknown), null);
  assert.equal(getReleaseRuleNotice({ mode: "immediate" }, "aula"), null);

  for (const notice of [
    getReleaseRuleNotice(sevenDaysAfterPurchase, "aula", unknown),
    getReleaseRuleNotice({ mode: "after_previous_lesson" }, "modulo")
  ]) {
    assert.doesNotMatch(`${notice.title} ${notice.detail}`, /\bapos\b|inscricao|\bsera\b|Disponivel|concluida|\besta\b|modulo/);
  }
});

test("estado do servidor manda: released some com o aviso; data passada vira 'Atualizar'", () => {
  assert.equal(getReleaseRuleNotice(sevenDaysAfterPurchase, "aula", { status: "released" }), null);

  const scheduled = { availableAt: "2026-01-08T18:00:00.000Z", precision: "day", status: "scheduled" };
  const due = getReleaseRuleNotice(sevenDaysAfterPurchase, "aula", scheduled, Date.parse("2026-01-08T18:00:05.000Z"));

  assert.equal(due.kind, "due");
  assert.equal(due.isLocked, true, "sem o video no payload, a aula so abre depois de atualizar");
  assert.equal(due.title, "Esta aula já foi liberada");
});

test("aviso da aula usa o mais restritivo entre aula, módulo e conteúdo", () => {
  const now = Date.parse("2026-01-03T12:00:00.000Z");
  const lessonNotice = getReleaseRuleNotice(
    sevenDaysAfterPurchase,
    "aula",
    { availableAt: "2026-01-08T18:00:00.000Z", precision: "day", status: "scheduled" },
    now
  );
  const moduleNotice = getReleaseRuleNotice(
    sevenDaysAfterPurchase,
    "modulo",
    { availableAt: "2026-01-10T18:00:00.000Z", precision: "day", status: "scheduled" },
    now
  );
  const previousNotice = getReleaseRuleNotice({ mode: "after_previous_lesson" }, "aula", { status: "waiting_previous_lesson" }, now);

  assert.equal(pickReleaseNotice([lessonNotice, moduleNotice, null]).detail, "Liberação em 10/01/2026");
  assert.equal(pickReleaseNotice([lessonNotice, previousNotice]).kind, "previous_lesson");
  assert.equal(pickReleaseNotice([null, undefined]), null);
  assert.equal(
    getNextReleaseTimestamp([
      { status: "released" },
      { availableAt: "2026-01-10T18:00:00.000Z", precision: "day", status: "scheduled" },
      { availableAt: "2026-01-08T18:00:00.000Z", precision: "day", status: "scheduled" },
      { availableAt: "2026-01-01T18:00:00.000Z", precision: "day", status: "scheduled" }
    ], now),
    Date.parse("2026-01-08T18:00:00.000Z")
  );
});

test("servidor: estado por aluno em todas as telas, prévia sem data e nenhum vídeo de aula bloqueada", () => {
  const store = read("src/server/db/platform-store.ts");
  const section = store.slice(
    store.indexOf("// --- Liberacao por aluno"),
    store.indexOf("function getSellableItems(database: PlatformDatabase)")
  );

  assert.ok(section.length > 0, "secao de liberacao existe");
  assert.match(section, /return resolveReleaseState\(\{/);
  assert.match(store, /import \{ resolveReleaseState, type ReleasePolicyEntitlement \} from "@\/server\/access\/release-policy"/);
  // Previa do produtor e visitante: sem compra real, sem data (frase generica).
  assert.match(section, /canResolveForUser: Boolean\(userId\) && !accessPreviewMode/);
  assert.match(section, /: unknownMemberState;/);
  // Aula nao liberada (ou sem acesso) sai sem video; thumbnail so de aula liberada.
  assert.match(section, /if \(videoMode === "keep_released" && isReleased\) \{\s*return lessonWithState;\s*\}/);
  assert.match(section, /const \{ video, \.\.\.lessonWithoutVideo \} = lessonWithState;/);
  assert.match(section, /const thumbnail = isReleased \? getVideoThumbnailUrl\(video\) : "";/);
  assert.match(section, /states\.content\.status === "released" &&/);

  const lessonPage = store.slice(store.indexOf("export async function getLessonPageData"), store.indexOf("export async function getAdminDashboardData"));
  assert.match(lessonPage, /applyMemberReleaseToModules\(\s*release,\s*item,/);
  assert.match(lessonPage, /videoMode: "keep_released"/);
  assert.match(lessonPage, /hasAccess: hasPurchaseAccess\(item, accessPreviewMode, userAccessKeys\)/);
  assert.match(lessonPage, /item: applyMemberReleaseToItem\(/);

  const modal = store.slice(store.indexOf("function getHomeModalStructures"), store.indexOf("function getAccess(item: ContentItem)"));
  assert.match(modal, /videoMode: "strip_all"/);
  const contentPage = store.slice(store.indexOf("export async function getContentPageData"), store.indexOf("export async function getLessonPageData"));
  assert.match(contentPage, /videoMode: "strip_all"/);
  assert.match(contentPage, /formationInternalCourses: applyMemberReleaseToItems\(release,/);
  assert.match(store, /\.map\(\(row\) => applyMemberReleaseToHomeRow\(release, row\)\)/);

  // Continue assistindo e biblioteca usam a mesma conta (nada de frase estatica decidindo bloqueio).
  const continueWatching = store.slice(store.indexOf("function getContinueWatchingFromProgress"), store.indexOf("function getHomeRows("));
  assert.match(continueWatching, /isMemberLessonReleased\(resolveContentReleaseStates\(release, parentItem\), courseModule\.id, lesson\.id\)/);
  assert.doesNotMatch(continueWatching, /getReleaseRuleNotice/);
  assert.match(store, /function resolveMemberLibraryRelease\(\s*releaseRule: ReleaseRuleConfig \| undefined,\s*entityLabel: "aula" \| "modulo" \| string,\s*releaseState: MemberReleaseState \| undefined,/);
  assert.match(store, /resolveContentReleaseStates\(release, item\)\.content/);

  // Favoritos: thumbnail do YouTube so de aula liberada com acesso.
  assert.match(store, /\(canShowVideoThumbnail \? getVideoThumbnailUrl\(lesson\.video\) : ""\) \|\| lesson\.image \|\| courseModule\.image/);
});

test("tipos: estado opcional em conteúdo, módulo e aula; regra aceita a âncora da garantia", () => {
  const types = read("src/lib/platform-types.ts");

  assert.match(types, /anchor\?: "access_start" \| "warranty_end";/);
  assert.equal(types.match(/releaseState\?: MemberReleaseState;/g)?.length, 3);
});

test("telas do aluno passam o estado do servidor para o texto de liberação", () => {
  const lesson = read("src/components/lesson-experience.tsx");
  const overlay = read("src/components/lesson/lesson-release-overlay.tsx");

  assert.match(lesson, /getReleaseRuleNotice\(lesson\.releaseRule, "aula", lesson\.releaseState, now\)/);
  assert.match(lesson, /getReleaseRuleNotice\(courseModule\.releaseRule, "modulo", courseModule\.releaseState, now\)/);
  assert.match(lesson, /getReleaseRuleNotice\(item\.releaseRule, item\.kind\.toLowerCase\(\), item\.releaseState, now\)/);
  assert.equal(lesson.match(/getLessonReleaseNotice\(item, /g)?.length, 4, "primeira aula, aviso, clique e playlist");
  assert.match(lesson, /<LessonReleaseOverlay notice=\{activeReleaseNotice\} onRefresh=\{\(\) => router\.refresh\(\)\} \/>/);
  // A data passa com a pagina aberta: atualiza sozinha (e tenta de novo se o servidor ainda disser
  // "agendado"); concluir a aula anterior tambem.
  assert.match(lesson, /const delay = getReleaseRefreshDelay\(attempts\.get\(dueReleaseKey\) \?\? 0\);/);
  assert.match(
    lesson,
    /attempts\.set\(dueReleaseKey, \(attempts\.get\(dueReleaseKey\) \?\? 0\) \+ 1\);\s*router\.refresh\(\);\s*scheduleReleaseRefresh\(\);/
  );
  assert.match(lesson, /scheduleReleaseRefresh\(\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[dueReleaseKey, router\]\);/);
  assert.doesNotMatch(lesson, /refreshedReleaseKeysRef/);
  assert.match(lesson, /if \(saved && status === "completed"\) \{\s*refreshAfterUnlockingLesson\(lessonId\);/);
  assert.match(lesson, /if \(saved && willCompleteLesson\) \{\s*refreshAfterUnlockingLesson\(lessonId\);/);
  assert.match(lesson, /\{releaseNotice\?\.shortLabel \?\? "Aula bloqueada"\}/);
  assert.match(lesson, /suppressHydrationWarning/);
  assert.match(overlay, /notice\.hint/);
  assert.match(overlay, /Atualizar agora/);
  assert.match(overlay, /suppressHydrationWarning/);

  for (const [file, pattern] of [
    ["src/components/content-card.tsx", /getReleaseRuleNotice\(item\.releaseRule, item\.kind\.toLowerCase\(\), item\.releaseState\)/],
    ["src/components/content-row.tsx", /getReleaseRuleNotice\(module\.releaseRule, "modulo", module\.releaseState\)/],
    ["src/components/content-row.tsx", /getReleaseRuleNotice\(course\.releaseRule, course\.kind\.toLowerCase\(\), course\.releaseState\)/],
    ["src/components/content-details-modal.tsx", /getReleaseRuleNotice\(item\.releaseRule, item\.kind\.toLowerCase\(\), item\.releaseState\)/],
    ["src/components/content-structure-section.tsx", /getReleaseRuleNotice\(course\.releaseRule, "curso", course\.releaseState\)/],
    ["src/components/content-structure-section.tsx", /getReleaseRuleNotice\(module\.releaseRule, "modulo", module\.releaseState\)/],
    ["src/components/featured-structure-home-section.tsx", /getReleaseRuleNotice\(module\.releaseRule, "modulo", module\.releaseState\)/]
  ]) {
    assert.match(read(file), pattern, file);
  }
});

test("data chegou com o relogio do navegador adiantado: novas tentativas com espera crescente e limite", () => {
  assert.deepEqual([...RELEASE_REFRESH_RETRY_DELAYS_MS], [5_000, 15_000, 30_000]);
  assert.equal(getReleaseRefreshDelay(0), 0, "primeira atualizacao na hora");
  assert.equal(getReleaseRefreshDelay(1), 5_000);
  assert.equal(getReleaseRefreshDelay(2), 15_000);
  assert.equal(getReleaseRefreshDelay(3), 30_000);
  assert.equal(getReleaseRefreshDelay(4), null, "depois desiste; fica o botao Atualizar agora");
  assert.equal(getReleaseRefreshDelay(-1), null);
  assert.equal(getReleaseRefreshDelay(1.5), null);
});

test("aula bloqueada ou agendada mostra so o aviso, sem barra falsa de player", () => {
  const lesson = read("src/components/lesson-experience.tsx");

  assert.doesNotMatch(lesson, /12:48/, "nada de tempo inventado");
  assert.match(lesson, /\{!activePlayerRenderConfig && !activeReleaseNotice \? \(/);
  const placeholderStart = lesson.indexOf("{!activePlayerRenderConfig && !activeReleaseNotice ? (");
  const placeholder = lesson.slice(placeholderStart, lesson.indexOf(") : null}", placeholderStart));
  // Aula sem video: so o progresso gravado, sem botoes que nao fazem nada.
  assert.match(placeholder, /formatPlaybackTime\(activeLessonWatchState\?\.progressSeconds \?\? 0\)/);
  assert.doesNotMatch(placeholder, /<button/);
  assert.match(placeholder, /pointer-events-none/);
});
