import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8").catch(() => "");
}

function functionSource(source, name) {
  const declarationPattern = new RegExp(`(?:export\\s+)?async\\s+function\\s+${name}\\b|function\\s+${name}\\b`);
  const match = declarationPattern.exec(source);

  if (!match) {
    return "";
  }

  const remainder = source.slice(match.index + match[0].length);
  const nextDeclaration = /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\b/.exec(remainder);
  return source.slice(match.index, nextDeclaration ? match.index + match[0].length + nextDeclaration.index : source.length);
}

const dashboardSource = await readSource("../src/components/admin-dashboard.tsx");
const contentRouteSource = await readSource("../src/app/api/admin/content/route.ts");
const moduleRouteSource = await readSource("../src/app/api/admin/modules/route.ts");
const lessonRouteSource = await readSource("../src/app/api/admin/lessons/route.ts");
const storeSource = await readSource("../src/server/db/platform-store.ts");

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationFileNames = await readdir(migrationsDirectory).catch(() => []);
const migrationSources = await Promise.all(
  migrationFileNames
    .filter((fileName) => fileName.endsWith(".sql") && !fileName.startsWith("._"))
    .map((fileName) => readFile(new URL(fileName, migrationsDirectory), "utf8"))
);
const allMigrationsSource = migrationSources.join("\n");

test("admin learning structure exposes create, read and update contracts before deletion", () => {
  assert.match(moduleRouteSource, /export async function POST/);
  assert.match(moduleRouteSource, /upsertCourseModule/);
  assert.match(lessonRouteSource, /export async function POST/);
  assert.match(lessonRouteSource, /upsertLesson/);
  assert.match(storeSource, /export async function upsertCourseModule/);
  assert.match(storeSource, /export async function upsertLesson/);

  assert.match(dashboardSource, /const wizardModules = useMemo/);
  assert.match(dashboardSource, /wizardModules\.map\(\(module\)/);
  assert.match(dashboardSource, /module\.lessons\.map\(\(lesson\)/);
  assert.match(dashboardSource, /function editWizardModule/);
  assert.match(dashboardSource, /function editWizardLesson/);
  assert.match(dashboardSource, /id: editingModuleId/);
  assert.match(dashboardSource, /id: lessonBuilderForm\.id/);
});

test("module and lesson routes expose authenticated, validated DELETE mutations", () => {
  for (const [source, entity, storeFunction] of [
    [moduleRouteSource, "Modulo", "deleteCourseModule"],
    [lessonRouteSource, "Aula", "deleteLesson"]
  ]) {
    const deleteSource = functionSource(source, "DELETE");

    assert.match(deleteSource, /requireApiAdmin\(\)/, `${entity}: DELETE must require an admin`);
    assert.match(deleteSource, /request\.json\(\)/, `${entity}: DELETE must parse its payload`);
    assert.match(deleteSource, /payload\.id/, `${entity}: DELETE must validate an id`);
    assert.match(deleteSource, /status:\s*400/, `${entity}: missing ids must be rejected`);
    assert.match(deleteSource, new RegExp(`await ${storeFunction}\\(payload\\.id\\)`), `${entity}: DELETE must call its store mutation`);
    assert.match(deleteSource, /NextResponse\.json\(\{ data \}\)/, `${entity}: DELETE must return refreshed dashboard data`);
    assert.match(deleteSource, /jsonRouteError/, `${entity}: DELETE must use the shared safe error response`);
  }
});

test("store deletion is granular and returns a refreshed Supabase-backed dashboard", () => {
  const deleteModuleSource = functionSource(storeSource, "deleteCourseModule");
  const deleteLessonSource = functionSource(storeSource, "deleteLesson");
  const cleanupSource = functionSource(storeSource, "persistDeletedLearningReferences");

  assert.match(deleteModuleSource, /readAdminDatabase\(\)/);
  assert.match(deleteModuleSource, /courseModules/);
  assert.match(deleteModuleSource, /\.from\("course_modules"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("id",\s*moduleId\)/);
  assert.match(deleteModuleSource, /throwIfSupabaseError/);
  assert.match(deleteModuleSource, /persistDeletedLearningReferences/);
  assert.match(deleteModuleSource, /toHydratedAdminDashboardData\(database\)/);

  assert.match(deleteLessonSource, /readAdminDatabase\(\)/);
  assert.match(deleteLessonSource, /courseModules/);
  assert.match(deleteLessonSource, /\.from\("lessons"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("id",\s*lessonId\)/);
  assert.match(deleteLessonSource, /throwIfSupabaseError/);
  assert.match(deleteLessonSource, /persistDeletedLearningReferences/);
  assert.match(deleteLessonSource, /toHydratedAdminDashboardData\(database\)/);

  assert.match(cleanupSource, /\.from\("saved_items"\)[\s\S]*?\.delete\(\)[\s\S]*?\.in\("id"/);
  assert.match(cleanupSource, /upsertRows\([\s\S]*?"lesson_progress"/);
  assert.match(cleanupSource, /completed_lesson_ids/);
  assert.match(cleanupSource, /lesson_reactions/);
  assert.match(cleanupSource, /lesson_watch_states/);
});

test("database deletion triggers remove saved and progress references without local fallback", () => {
  assert.match(allMigrationsSource, /after\s+delete\s+on\s+public\.lessons/i);
  assert.match(allMigrationsSource, /after\s+delete\s+on\s+public\.course_modules/i);
  assert.match(allMigrationsSource, /delete\s+from\s+public\.saved_items/i);
  assert.match(allMigrationsSource, /target_id\s*=\s*old\.id/i);
  assert.match(allMigrationsSource, /update\s+public\.lesson_progress/i);
  assert.match(allMigrationsSource, /array_remove\s*\(\s*completed_lesson_ids\s*,\s*old\.id\s*\)/i);
  assert.match(allMigrationsSource, /lesson_reactions[\s\S]*?-\s*old\.id/i);
  assert.match(allMigrationsSource, /lesson_watch_states[\s\S]*?-\s*old\.id/i);
  assert.match(
    allMigrationsSource,
    /revoke\s+all\s+on\s+function\s+public\.cleanup_deleted_lesson_references\(\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i
  );
  assert.match(
    allMigrationsSource,
    /revoke\s+all\s+on\s+function\s+public\.cleanup_deleted_module_references\(\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i
  );
  assert.doesNotMatch(storeSource, /bunker707-platform\.json/);
});

test("catalog UI confirms deletion, invokes DELETE endpoints and exposes accessible actions", () => {
  const deleteMutationSource = functionSource(dashboardSource, "deleteDashboardMutation");
  const deleteModuleSource = functionSource(dashboardSource, "deleteWizardModule");
  const deleteLessonSource = functionSource(dashboardSource, "deleteWizardLesson");

  assert.match(deleteMutationSource, /fetch\(endpoint/);
  assert.match(deleteMutationSource, /method:\s*"DELETE"/);
  assert.match(deleteMutationSource, /onDashboardDataChange\(result\.data\)/);

  assert.match(deleteModuleSource, /window\.confirm/);
  assert.match(deleteModuleSource, /\/api\/admin\/modules/);
  assert.match(deleteModuleSource, /deleteDashboardMutation/);
  assert.match(deleteModuleSource, /setModuleBuilderForm\(emptyModuleBuilderFormState\)/);

  assert.match(deleteLessonSource, /window\.confirm/);
  assert.match(deleteLessonSource, /\/api\/admin\/lessons/);
  assert.match(deleteLessonSource, /deleteDashboardMutation/);
  assert.match(deleteLessonSource, /setLessonBuilderForm/);

  assert.match(dashboardSource, /aria-label=\{`Excluir modulo \$\{module\.title\}`\}/);
  assert.match(dashboardSource, /onClick=\{\(\) => (?:void )?deleteWizardModule\(module\)\}/);
  assert.match(dashboardSource, /aria-label=\{`Excluir aula \$\{lesson\.title\}`\}/);
  assert.match(dashboardSource, /onClick=\{\(\) => (?:void )?deleteWizardLesson\((?:module\.id,\s*)?lesson\)\}/);
});

test("admin catalog, modules and lessons expose ordering mutations", () => {
  for (const [source, entity, storeFunction] of [
    [contentRouteSource, "Conteudo", "reorderContentItems"],
    [moduleRouteSource, "Modulo", "reorderCourseModules"],
    [lessonRouteSource, "Aula", "reorderLessons"]
  ]) {
    const patchSource = functionSource(source, "PATCH");

    assert.match(patchSource, /requireApiAdmin\(\)/, `${entity}: PATCH must require an admin`);
    assert.match(patchSource, /request\.json\(\)/, `${entity}: PATCH must parse its payload`);
    assert.match(patchSource, /orderedIds/, `${entity}: PATCH must validate ordered ids`);
    assert.match(patchSource, /status:\s*400/, `${entity}: invalid order must be rejected`);
    assert.match(patchSource, new RegExp(`await ${storeFunction}\\(`), `${entity}: PATCH must call its store reorder mutation`);
    assert.match(patchSource, /NextResponse\.json\(\{ data \}\)/, `${entity}: PATCH must return refreshed dashboard data`);
    assert.match(patchSource, /jsonRouteError/, `${entity}: PATCH must use the shared safe error response`);
  }
});

test("store reorders learning structure with explicit sort_order persistence", () => {
  const reorderContentSource = functionSource(storeSource, "reorderContentItems");
  const reorderModulesSource = functionSource(storeSource, "reorderCourseModules");
  const reorderLessonsSource = functionSource(storeSource, "reorderLessons");
  const upsertModuleSource = functionSource(storeSource, "upsertCourseModule");
  const upsertLessonSource = functionSource(storeSource, "upsertLesson");

  assert.match(storeSource, /function reorderItemsByIds/);
  assert.match(storeSource, /function normalizeOrderedIds/);

  assert.match(reorderContentSource, /contentItemToRow\(content,\s*bucket,\s*index\)/);
  assert.match(reorderContentSource, /\.from\("content_items"\)|"content_items"/);
  assert.match(reorderContentSource, /toHydratedAdminDashboardData\(database\)/);

  assert.match(reorderModulesSource, /ownerId/);
  assert.match(reorderModulesSource, /moduleToRow/);
  assert.match(reorderModulesSource, /"course_modules"/);
  assert.match(reorderModulesSource, /toHydratedAdminDashboardData\(database\)/);

  assert.match(reorderLessonsSource, /moduleId/);
  assert.match(reorderLessonsSource, /lessonToRow\(lesson,\s*module\.id,\s*index\)/);
  assert.match(reorderLessonsSource, /"lessons"/);
  assert.match(reorderLessonsSource, /toHydratedAdminDashboardData\(database\)/);

  assert.match(upsertModuleSource, /\[\.\.\.database\.courseModules,\s*nextModule\]/);
  assert.match(upsertLessonSource, /moduleLessons\.slice\(0,\s*insertAt\)/);
});

test("catalog UI exposes accessible move controls for content, modules and lessons", () => {
  assert.match(dashboardSource, /method:\s*"PATCH"/);
  assert.match(dashboardSource, /function moveContentRecord/);
  assert.match(dashboardSource, /function moveWizardModule/);
  assert.match(dashboardSource, /function moveWizardLesson/);
  assert.match(dashboardSource, /function moveStructureModule/);
  assert.match(dashboardSource, /function moveStructureLesson/);

  assert.match(dashboardSource, /aria-label=\{`Mover \$\{record\.content\.title\} para cima`\}/);
  assert.match(dashboardSource, /aria-label=\{`Mover modulo \$\{module\.title\} para cima`\}/);
  assert.match(dashboardSource, /aria-label=\{`Mover aula \$\{lesson\.title\} para cima`\}/);
  assert.match(dashboardSource, /onClick=\{\(\) => (?:void )?moveWizardModule\(module\.id,\s*"up"\)\}/);
  assert.match(dashboardSource, /onClick=\{\(\) => (?:void )?moveWizardLesson\(module\.id,\s*lesson\.id,\s*"down"\)\}/);
});
