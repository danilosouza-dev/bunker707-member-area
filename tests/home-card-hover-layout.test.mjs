import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rowSource = await readFile(new URL("../src/components/content-row.tsx", import.meta.url), "utf8");
const cardSource = await readFile(new URL("../src/components/content-card.tsx", import.meta.url), "utf8");
const modalSource = await readFile(new URL("../src/components/content-details-modal.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const favoritesPageSource = await readFile(new URL("../src/app/favoritos/page.tsx", import.meta.url), "utf8");
const favoritesExperienceSource = await readFile(new URL("../src/components/favorites-experience.tsx", import.meta.url), "utf8");
const platformStoreSource = await readFile(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");
const savedButtonSource = await readFile(new URL("../src/components/saved-item-button.tsx", import.meta.url), "utf8");
const adminDashboardSource = await readFile(new URL("../src/components/admin-dashboard.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("home vertical card rows use tighter spacing", () => {
  assert.match(rowSource, /const rowGap = variant === "vertical" \? "gap-\[0\.75rem\]" : "gap-\[1\.5rem\]";/);
  assert.match(rowSource, /\$\{rowGap\}/);
});

test("home hides sections that have no resolved items", () => {
  assert.match(platformStoreSource, /getHomeRows\(database, accessPreviewMode, user\)\.filter\(\(row\) => row\.items\.length > 0\)/);
  assert.match(rowSource, /if \(itemsWithSavedState\.length === 0\) \{\s*return null;/);
});

test("home carousel arrows appear only when the row overflows horizontally", () => {
  assert.match(rowSource, /const \[hasHorizontalOverflow, setHasHorizontalOverflow\] = useState\(false\);/);
  assert.match(rowSource, /setHasHorizontalOverflow\(maxScrollLeft > 4\);/);
  assert.match(rowSource, /\{hasHorizontalOverflow \? \(\s*<div className="flex shrink-0 items-center gap-2">/);
  assert.match(rowSource, /\) : null\}\s*<\/div>\s*<div\s*className=\{`scrollbar-hidden flex scroll-smooth/);
});

test("home can show an access card and intermediate modules for a selected course", () => {
  assert.match(adminDashboardSource, /homeModuleSectionEnabled/);
  assert.match(adminDashboardSource, /lockedActionMode/);
  assert.match(adminDashboardSource, /Modulos na home/);
  assert.match(adminDashboardSource, /Ao comprar/);
  assert.match(platformStoreSource, /function getHomeCourseModuleRows/);
  assert.match(platformStoreSource, /settings\?\.homeModuleSection\?\.enabled/);
  assert.match(platformStoreSource, /lockedActionMode: settings\.lockedActionMode \?\? "details_modal"/);
  assert.doesNotMatch(platformStoreSource, /if \(course\.isLocked\) \{\s*return \[\];\s*\}/);
  assert.match(rowSource, /export function CourseModulesHomeSection/);
  assert.match(rowSource, /Cursos Online/);
  assert.match(rowSource, /Acessar/);
  assert.match(rowSource, /Comprar/);
  assert.match(rowSource, /openCourseDetails/);
  assert.match(rowSource, /lockedActionMode === "external_link"/);
  assert.match(rowSource, /\/conteudo\/\$\{course\.id\}/);
  assert.match(rowSource, /course\.image/);
  assert.match(rowSource, /home-cover-card-overlay absolute inset-0 z-10/);
  assert.match(rowSource, /home-cover-card-content absolute inset-x-0 bottom-3 z-20/);
  assert.doesNotMatch(rowSource, /Ver aulas/);
  assert.doesNotMatch(rowSource, /\$\{cardActionClassName\} mt-3 max-w-fit flex-none/);
  assert.match(rowSource, /home-row-cover-card/);
  assert.match(rowSource, /w-\[10\.25rem\]/);
  assert.match(rowSource, /xl:w-\[17\.5rem\]/);
});

test("home vertical card hover expands the card without inner image zoom", () => {
  assert.match(cardSource, /home-row-cover-card group/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-surface \{\s*transform: translate3d\(0, -8px, 0\) scale\(1\.14\);/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-image \{\s*transform: scale\(1\);/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-image \{\s*transform: scale\(1\) !important;/);
});

test("home vertical cards grow inward only at carousel edges", () => {
  assert.match(rowSource, /function syncHomeRowHoverEdges/);
  assert.match(rowSource, /querySelectorAll<HTMLElement>\("\[data-home-row-card\]"\)/);
  assert.match(rowSource, /setAttribute\("data-hover-edge", "left"\)/);
  assert.match(rowSource, /setAttribute\("data-hover-edge", "right"\)/);
  assert.match(cardSource, /data-home-row-card/);
  assert.doesNotMatch(cardSource, /home-row-watch-card/);
  assert.doesNotMatch(cardSource, /home-row-card-surface/);
  assert.match(cssSource, /\[data-home-row-card\]\[data-hover-edge="left"\] \.home-cover-card-surface \{\s*transform-origin: left center;/);
  assert.match(cssSource, /\[data-home-row-card\]\[data-hover-edge="right"\] \.home-cover-card-surface \{\s*transform-origin: right center;/);
  assert.match(cssSource, /\.home-row-cover-card\[data-hover-edge="left"\]\.group:hover \.home-cover-card-logo \{\s*transform: translate3d\(0, -27px, 0\);/);
});

test("home cards prefetch content routes before click navigation", () => {
  assert.match(cardSource, /router\.prefetch\(contentHref\)/);
  assert.match(cardSource, /onMouseEnter=\{prefetchContentPage\}/);
  assert.match(cardSource, /onFocus=\{prefetchContentPage\}/);
  assert.match(cardSource, /onTouchStart=\{prefetchContentPage\}/);
});

test("content details modal uses persisted CMS structure instead of hardcoded demo content", () => {
  assert.match(platformStoreSource, /getHomeModalStructures/);
  assert.match(pageSource, /modalStructures/);
  assert.match(rowSource, /structure=\{selectedItemWithSavedState \? modalStructures\[selectedItemWithSavedState\.id\] : undefined\}/);
  assert.match(modalSource, /structure\?\.modules/);
  assert.match(modalSource, /structure\?\.formationCourses/);
  assert.doesNotMatch(modalSource, /Fundamentos de prompts/);
  assert.doesNotMatch(modalSource, /Base e direcao visual/);
  assert.doesNotMatch(modalSource, /Este bloco sera usado/);
});

test("content details modal opens module lessons as lesson page links", () => {
  assert.ok(modalSource.includes('import Link from "next/link";'));
  assert.ok(modalSource.includes("contentId: string;"));
  assert.ok(modalSource.includes("?lessonId=${encodeURIComponent(lesson.id)}"));
  assert.ok(modalSource.includes("href={lessonHref}"));
  assert.match(modalSource, /module-card-motion isolate cursor-pointer/);
  assert.match(modalSource, /className="grid cursor-pointer gap-4/);
});

test("content details modal calculates course progress from module progress", () => {
  assert.match(modalSource, /function getCourseProgressFromModules/);
  assert.match(modalSource, /modules\.reduce\(\(total, module\) => total \+ getModuleProgress\(module\), 0\)/);
  assert.match(modalSource, /moduleProgressTotal \/ modules\.length/);
  assert.match(modalSource, /const courseProgress = getCourseProgressFromModules\(itemModules, item\.progress\);/);
  assert.match(modalSource, /<ProgressBar className="mt-4 h-1\.5" value=\{courseProgress\} \/>/);
  assert.doesNotMatch(modalSource, /Math\.round\(item\.progress\)% concluido/);
});

test("content details modal formats module and lesson counts consistently", () => {
  assert.match(modalSource, /function formatCount/);
  assert.match(modalSource, /function formatCompletedRatio/);
  assert.match(modalSource, /formatCount\(module\.lessons\.length, "aula", "aulas"\)/);
  assert.match(modalSource, /formatCount\(itemModules\.length, "modulo", "modulos"\)/);
  assert.match(modalSource, /formatCompletedRatio\(completedCourseLessons, totalCourseLessons, "aula", "aulas", "concluida", "concluidas"\)/);
  assert.doesNotMatch(modalSource, /\$\{totalCourseLessons\} aulas/);
});

test("content details modal avoids back-office summary labels", () => {
  assert.doesNotMatch(modalSource, /label: "Conteudo"/);
  assert.doesNotMatch(modalSource, /label: item\.instructor \? "Professor" : "Nivel"/);
  assert.doesNotMatch(modalSource, /value: item\.instructor\?\.name \?\? item\.level \?\? "Livre"/);
  assert.doesNotMatch(modalSource, /Acesso:<\/span>/);
});

test("content details modal uses only lesson-owned thumbnails in lesson lists", () => {
  assert.match(modalSource, /function getLessonThumbnailUrl/);
  assert.match(modalSource, /getVideoThumbnailUrl\(lesson\.video\) \|\| lesson\.image \|\| ""/);
  assert.match(modalSource, /style=\{\{ backgroundImage: `url\(\$\{lessonThumbnailUrl\}\)` \}\}/);
  assert.match(modalSource, /Sem thumbnail/);
  assert.doesNotMatch(modalSource, /lesson\.image \?\? module\.image/);
  assert.doesNotMatch(platformStoreSource, /image: input\.image \|\| existingLesson\?\.image \|\| courseModule\.image/);
});

test("continue watching keeps the progress bar slim", () => {
  assert.match(cardSource, /absolute bottom-0 left-0 h-1 w-full bg-white\/20/);
  assert.doesNotMatch(cardSource, /absolute bottom-0 left-0 h-1\.5 w-full bg-white\/20/);
});

test("continue watching uses modal-style image-only hover", () => {
  assert.match(cardSource, /continue-watching-card-image absolute inset-0 bg-cover bg-center/);
  assert.match(cardSource, /continue-watching-card-overlay absolute inset-0/);
  assert.match(cardSource, /group-hover:opacity-100/);
  assert.doesNotMatch(cardSource, /group-hover:scale-\[1\.06\]/);
  assert.doesNotMatch(cardSource, /group-hover:scale-105/);
  assert.match(cssSource, /\.continue-watching-card-image \{\s*backface-visibility: hidden;\s*transform: scale\(1\);/);
  assert.match(cssSource, /\.group:hover \.continue-watching-card-image \{\s*transform: scale\(1\.012\);/);
  assert.match(cssSource, /\.modal-vertical-card:hover \.modal-vertical-card-image \{\s*transform: scale\(1\.012\);/);
});

test("continue watching prefers resume frame or video thumbnail over random lesson art", () => {
  assert.match(platformStoreSource, /function getLessonResumeImage/);
  assert.match(platformStoreSource, /watchState\.resumeFrameUrl \|\| getVideoThumbnailUrl\(lesson\.video\) \|\| lesson\.image \|\| courseModule\.image/);
  assert.match(platformStoreSource, /image: getLessonResumeImage\(watchState, lesson, courseModule\)/);
});

test("content cards and modal persist saved items", () => {
  assert.match(cardSource, /SavedItemButton/);
  assert.match(modalSource, /SavedItemButton/);
  assert.match(savedButtonSource, /\/api\/saved-items/);
  assert.match(savedButtonSource, /aria-pressed=\{saved\}/);
  assert.match(savedButtonSource, /import \{ Bookmark, Check \} from "lucide-react";/);
  assert.match(savedButtonSource, /bg-\[#2f2f2f\]\/95 text-white/);
  assert.match(savedButtonSource, /ring-emerald-400\/70/);
  assert.match(savedButtonSource, /<Check className="h-2\.5 w-2\.5 stroke-\[3\.5\]" \/>/);
  assert.match(savedButtonSource, /saved \? "scale-95 fill-current" : ""/);
  assert.match(savedButtonSource, /function dispatchSavedItemChanged/);
  assert.match(savedButtonSource, /const savedItemSyncQueue = new Map/);
  assert.match(savedButtonSource, /savedRef\.current/);
  assert.match(savedButtonSource, /dispatchSavedItemChanged\(\{\s*saved: nextSaved,/);
  assert.match(savedButtonSource, /requestSavedItemSync\(\{/);
  assert.doesNotMatch(savedButtonSource, /disabled=\{pending\}/);
  assert.doesNotMatch(savedButtonSource, /disabled:cursor-wait/);
  assert.match(platformStoreSource, /applySavedStateToItems/);
  assert.match(platformStoreSource, /applySavedStateToModules/);
});

test("favorites page lists persisted saved items", () => {
  assert.match(favoritesPageSource, /\/favoritos/);
  assert.match(favoritesPageSource, /getFavoritesPageData/);
  assert.match(favoritesExperienceSource, /Favoritos/);
  assert.match(favoritesExperienceSource, /Conteudos/);
  assert.match(favoritesExperienceSource, /Aulas/);
  assert.match(platformStoreSource, /getSavedContentItems/);
  assert.match(platformStoreSource, /getSavedLessonItems/);
});
