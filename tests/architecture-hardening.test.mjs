import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShellSource = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const lessonSource = await readFile(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");
const mediaAssetsSource = await readFile(new URL("../src/server/db/media-assets.ts", import.meta.url), "utf8");
const lessonAccessSource = await readFile(new URL("../src/server/access/lesson-access.ts", import.meta.url), "utf8");
const platformStoreSource = await readFile(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");
const productActionsSource = await readFile(new URL("../src/server/catalog/product-actions.ts", import.meta.url), "utf8");
const catalogImagesSource = await readFile(new URL("../src/server/catalog/images.ts", import.meta.url), "utf8");
const progressRouteSource = await readFile(new URL("../src/app/api/progress/lessons/route.ts", import.meta.url), "utf8");
const routeErrorsSource = await readFile(new URL("../src/server/http/route-errors.ts", import.meta.url), "utf8");
const hardeningMigrationSource = await readFile(
  new URL("../supabase/migrations/202607100002_harden_content_and_media_storage.sql", import.meta.url),
  "utf8"
);

test("student navigation does not trigger a duplicate router refresh", () => {
  const appNavigation = appShellSource.match(/function handleProgressAwareNavigation[\s\S]*?\n  \}/u)?.[0] ?? "";
  const lessonNavigation = lessonSource.match(/function handleProgressAwareNavigation[\s\S]*?\n  \}/u)?.[0] ?? "";

  assert.match(appNavigation, /router\.push\(href\)/);
  assert.match(lessonNavigation, /router\.push\(href\)/);
  assert.doesNotMatch(appNavigation, /router\.refresh/);
  assert.doesNotMatch(lessonNavigation, /router\.refresh/);
});

test("member reads are request-memoized and scoped to the authenticated user", () => {
  assert.match(platformStoreSource, /const readMemberDatabase = cache/);
  assert.match(platformStoreSource, /\.from\("lesson_progress"\)\.select\("\*"\)\.eq\("user_id", userId\)/);
  assert.match(platformStoreSource, /\.from\("saved_items"\)\.select\("\*"\)\.eq\("user_id", userId\)/);
  assert.match(platformStoreSource, /\.from\("entitlements"\)[\s\S]*?\.eq\("user_id", userId\)/);
  assert.match(platformStoreSource, /readDatabaseForUser\(user\)/);
});

test("progress and favorites use granular writes", () => {
  assert.match(platformStoreSource, /\.from\("lesson_progress"\)\s*\.update\(nextRow\)/);
  assert.match(platformStoreSource, /\.from\("lesson_progress"\)\.insert\(nextRow\)/);
  assert.match(platformStoreSource, /\.from\("saved_items"\)\s*\.upsert/);
  assert.match(platformStoreSource, /savedItemTargetExists/);
  assert.doesNotMatch(platformStoreSource, /writeSupabaseDatabase/);
  assert.match(progressRouteSource, /await requireLessonsAccess/);
  assert.match(progressRouteSource, /referencedLessonIds/);
  assert.match(lessonAccessSource, /\.in\("id", uniqueLessonIds\)/);
  assert.match(lessonAccessSource, /content\.publication_status !== "published"/);
  assert.match(lessonAccessSource, /isReleaseRuleSatisfied/);
  assert.doesNotMatch(lessonAccessSource, /getReleaseRuleNotice/);
});

test("inline images are persisted in a constrained Storage bucket", () => {
  assert.match(mediaAssetsSource, /const maxImageBytes = 8 \* 1024 \* 1024/);
  assert.match(mediaAssetsSource, /\["image\/jpeg", "jpg"\]/);
  assert.match(mediaAssetsSource, /\["image\/png", "png"\]/);
  assert.match(mediaAssetsSource, /\["image\/webp", "webp"\]/);
  assert.match(mediaAssetsSource, /cacheControl: "31536000"/);
  assert.match(catalogImagesSource, /persistImageAsset\(value, `content\/\$\{productId\}\/\$\{slot\}`\)/);
});

test("content publication is explicit and member reads exclude drafts", () => {
  assert.match(productActionsSource, /publication_status: "draft"/, "produto novo nasce em rascunho");
  assert.match(platformStoreSource, /\.eq\("publication_status", "published"\)/);
});

test("direct authenticated reads cannot expose content or video configuration", () => {
  assert.match(hardeningMigrationSource, /drop policy if exists "Students can read published content"/);
  assert.match(hardeningMigrationSource, /revoke all on public\.content_items from anon, authenticated/);
  assert.match(hardeningMigrationSource, /revoke all on public\.course_modules from anon, authenticated/);
  assert.match(hardeningMigrationSource, /revoke all on public\.lessons from anon, authenticated/);
  assert.match(hardeningMigrationSource, /insert into storage\.buckets/);
  assert.match(hardeningMigrationSource, /'content-assets'/);
});

test("unexpected server errors are logged and sanitized", () => {
  assert.match(routeErrorsSource, /const isPublicError = errorStatus >= 400 && errorStatus < 500/);
  assert.match(routeErrorsSource, /console\.error\(fallbackMessage, error\)/);
  assert.match(routeErrorsSource, /isPublicError && error instanceof Error \? error\.message : fallbackMessage/);
});
