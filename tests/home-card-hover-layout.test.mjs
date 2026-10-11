import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rowSource = await readFile(new URL("../src/components/content-row.tsx", import.meta.url), "utf8");
const cardSource = await readFile(new URL("../src/components/content-card.tsx", import.meta.url), "utf8");
const modalSource = await readFile(new URL("../src/components/content-details-modal.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const favoritesPageSource = await readFile(new URL("../src/app/favoritos/page.tsx", import.meta.url), "utf8");
const favoritesExperienceSource = await readFile(new URL("../src/components/favorites-experience.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const platformStoreSource = await readFile(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");
const savedButtonSource = await readFile(new URL("../src/components/saved-item-button.tsx", import.meta.url), "utf8");
const adminDashboardSource = await readFile(new URL("../src/components/admin-dashboard.tsx", import.meta.url), "utf8");
const carouselNavigationSource = await readFile(new URL("../src/components/carousel-navigation.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
const hoverLayoutSource = await readFile(new URL("../src/lib/home-row-hover-layout.ts", import.meta.url), "utf8");
const hoverLayoutJavaScript = ts.transpileModule(hoverLayoutSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const { getHomeRowHoverEdgeIndexes } = await import(
  `data:text/javascript;base64,${Buffer.from(hoverLayoutJavaScript).toString("base64")}`
);

test("home vertical card rows use tighter spacing", () => {
  assert.match(rowSource, /const rowGap = variant === "vertical" \? "gap-\[0\.75rem\]" : "gap-\[1\.5rem\]";/);
  assert.match(rowSource, /\$\{rowGap\}/);
});

test("home hides sections that have no resolved items", () => {
  assert.match(platformStoreSource, /getHomeRows\(database, accessPreviewMode, user\)\.filter\(\(row\) => row\.items\.length > 0\)/);
  assert.match(rowSource, /if \(itemsWithSavedState\.length === 0\) \{\s*return null;/);
});

test("home carousel uses Netflix-style edge arrows and page indicators only with overflow", () => {
  assert.match(rowSource, /const \[hasHorizontalOverflow, setHasHorizontalOverflow\] = useState\(false\);/);
  assert.match(rowSource, /setHasHorizontalOverflow\(metrics\.hasOverflow\);/);
  assert.match(rowSource, /<CarouselPaginationIndicator/);
  assert.match(rowSource, /<CarouselEdgeControls/);
  assert.match(rowSource, /<div className="home-row-viewport relative">\s*<div\s*className=\{`scrollbar-hidden flex scroll-smooth/);
  assert.doesNotMatch(rowSource, /import \{[^}]*ChevronLeft/);
  assert.match(carouselNavigationSource, /export function getCarouselMetrics/);
  assert.match(carouselNavigationSource, /pagePositions\.push\(maxScrollLeft\)/);
  assert.match(carouselNavigationSource, /export function CarouselPaginationIndicator/);
  assert.match(carouselNavigationSource, /pagina \$\{currentPage \+ 1\} de \$\{pageCount\}/);
  assert.match(carouselNavigationSource, /export function CarouselEdgeControls/);
  assert.match(carouselNavigationSource, /carousel-edge-fade-left/);
  assert.match(carouselNavigationSource, /carousel-edge-fade-right/);
  assert.match(carouselNavigationSource, /verticalInset: "compact" \| "home" \| "internal"/);
  assert.match(carouselNavigationSource, /verticalInset === "home"\s*\? "inset-y-4 sm:inset-y-14"/);
  assert.match(carouselNavigationSource, /verticalInset === "compact"\s*\? "inset-y-3 sm:inset-y-6"/);
  assert.match(rowSource, /verticalInset="home"/);
  assert.match(rowSource, /verticalInset=\{variant === "vertical" \? "home" : "compact"\}/);
  assert.doesNotMatch(carouselNavigationSource, /carousel-edge-button[^"\n]*hover:bg-black/);
  assert.match(cssSource, /\.carousel-edge-fade-left \{\s*background: linear-gradient\(90deg/);
  assert.match(cssSource, /\.carousel-edge-fade-right \{\s*background: linear-gradient\(270deg/);
  assert.match(cssSource, /\.carousel-edge-fade:has\(\+ \.carousel-edge-button:hover\)[\s\S]*?filter: brightness\(0\.72\);[\s\S]*?transform: scaleX\(1\.08\);/);
  assert.match(cssSource, /\.carousel-edge-button-left:hover svg[\s\S]*?translateX\(-3px\) scale\(1\.24\)/);
  assert.match(cssSource, /\.carousel-edge-button-right:hover svg[\s\S]*?translateX\(3px\) scale\(1\.24\)/);
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
  assert.match(rowSource, /w-\[8\.75rem\]/);
  assert.match(rowSource, /xl:w-\[14rem\]/);
});

test("home vertical card hover expands the card without inner image zoom", () => {
  assert.match(cardSource, /home-row-cover-card group/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-surface \{\s*transform: translate3d\(var\(--home-row-card-hover-shift-x, 0px\), -8px, 0\) scale\(1\.14\);/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-image \{\s*transform: scale\(1\);/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-image \{\s*transform: scale\(1\) !important;/);
});

test("home vertical cards grow inward only at carousel edges", () => {
  assert.match(rowSource, /function syncHomeRowHoverEdges/);
  assert.match(rowSource, /querySelectorAll<HTMLElement>\("\[data-home-row-card\]"\)/);
  assert.match(rowSource, /getHomeRowHoverEdgeIndexes/);
  assert.match(rowSource, /setAttribute\("data-hover-edge", "left"\)/);
  assert.match(rowSource, /setAttribute\("data-hover-edge", "right"\)/);
  assert.match(rowSource, /removeProperty\("--home-row-card-hover-shift-x"\)/);
  assert.match(rowSource, /removeProperty\("--home-row-card-hover-logo-shift-x"\)/);
  assert.match(rowSource, /homeRowCardHoverScale = 1\.14/);
  assert.match(rowSource, /hiddenOffset = Math\.max\(leftBoundary - leftEdgeRect\.left, 0\)/);
  assert.match(rowSource, /hiddenOffset = Math\.max\(rightEdgeRect\.right - rightBoundary, 0\)/);
  assert.match(rowSource, /leftSurfaceShiftX = roundPx\(hiddenOffset \+ neighborPeekOffset\)/);
  assert.match(rowSource, /rightSurfaceShiftX = roundPx\(-\(hiddenOffset \+ neighborPeekOffset\)\)/);
  assert.match(rowSource, /rightLogoShiftX = roundPx\(rightSurfaceShiftX - rightEdgeRect\.width \* \(homeRowCardHoverScale - 1\)\)/);
  assert.match(rowSource, /setProperty\("--home-row-card-hover-shift-x", `\$\{leftSurfaceShiftX\}px`\)/);
  assert.match(rowSource, /setProperty\("--home-row-card-hover-logo-shift-x", `\$\{leftSurfaceShiftX\}px`\)/);
  assert.match(rowSource, /setProperty\("--home-row-card-hover-shift-x", `\$\{rightSurfaceShiftX\}px`\)/);
  assert.match(rowSource, /setProperty\("--home-row-card-hover-logo-shift-x", `\$\{rightLogoShiftX\}px`\)/);
  assert.match(cardSource, /data-home-row-card/);
  assert.doesNotMatch(cardSource, /home-row-watch-card/);
  assert.doesNotMatch(cardSource, /home-row-card-surface/);
  assert.match(cssSource, /\[data-home-row-card\]\[data-hover-edge="left"\] \.home-cover-card-surface \{\s*transform-origin: left center;/);
  assert.match(cssSource, /\[data-home-row-card\]\[data-hover-edge="right"\] \.home-cover-card-surface \{\s*transform-origin: right center;/);
  assert.match(cssSource, /\.home-row-cover-card\[data-hover-edge="left"\]\.group:hover \.home-cover-card-logo \{\s*transform: translate3d\(var\(--home-row-card-hover-logo-shift-x, 0px\), -27px, 0\);/);
  assert.match(cssSource, /\.home-row-cover-card\[data-hover-edge="right"\]\.group:hover \.home-cover-card-logo \{\s*transform: translate3d\(var\(--home-row-card-hover-logo-shift-x, var\(--home-row-card-hover-shift-x, 0px\)\), -27px, 0\);/);
});

test("a short row with two cards keeps the second card centered on hover", () => {
  const edgeIndexes = getHomeRowHoverEdgeIndexes({
    cardBounds: [
      { left: 48, right: 328 },
      { left: 340, right: 620 }
    ],
    edgeTolerance: 2,
    leftBoundary: 48,
    rightBoundary: 1232
  });

  assert.equal(edgeIndexes.leftEdgeIndex, 0);
  assert.equal(edgeIndexes.rightEdgeIndex, undefined);
});

test("a card that reaches the visual right edge still grows inward", () => {
  const edgeIndexes = getHomeRowHoverEdgeIndexes({
    cardBounds: [
      { left: 48, right: 328 },
      { left: 964, right: 1244 }
    ],
    edgeTolerance: 2,
    leftBoundary: 48,
    rightBoundary: 1232
  });

  assert.equal(edgeIndexes.leftEdgeIndex, 0);
  assert.equal(edgeIndexes.rightEdgeIndex, 1);
});

test("home edge cards shift only enough to uncover the cut portion", () => {
  assert.doesNotMatch(rowSource, /previewShiftX/);
  assert.doesNotMatch(rowSource, /data-hover-reveals/);
  assert.doesNotMatch(rowSource, /--home-row-card-hover-preview-shift-x/);
  assert.doesNotMatch(rowSource, /HomeRowHoverBridge/);
  assert.doesNotMatch(cardSource, /HomeRowHoverBridge/);
  assert.doesNotMatch(cardSource, /data-home-row-hover-bridge/);
  assert.doesNotMatch(cssSource, /home-row-card-hover-bridge/);
  assert.doesNotMatch(cssSource, /data-hover-reveals/);
  assert.doesNotMatch(cssSource, /--home-row-card-hover-preview-shift-x/);
});

test("a hidden neighbor peeks out when the edge card comes forward", () => {
  assert.match(rowSource, /const homeRowNeighborPeekWidth = 56;/);
  assert.match(rowSource, /neighborPeekOffset = previousRect\s*\? Math\.max\(homeRowNeighborPeekWidth - \(paddingLeft - \(leftEdgeRect\.left - previousRect\.right\)\), 0\)\s*: 0;/);
  assert.match(rowSource, /neighborPeekOffset = nextRect\s*\? Math\.max\(homeRowNeighborPeekWidth - \(paddingRight - \(nextRect\.left - rightEdgeRect\.right\)\), 0\)\s*: 0;/);
  assert.match(rowSource, /setAttribute\("data-hover-peeks-previous", "true"\)/);
  assert.match(rowSource, /setAttribute\("data-hover-peeks-next", "true"\)/);
  assert.match(rowSource, /previousCard\.style\.setProperty\("--home-row-card-hover-neighbor-shift-x", `\$\{leftSurfaceShiftX\}px`\)/);
  assert.match(rowSource, /nextCard\.style\.setProperty\("--home-row-card-hover-neighbor-shift-x", `\$\{rightSurfaceShiftX\}px`\)/);
  assert.match(rowSource, /removeAttribute\("data-hover-peeks-next"\)/);
  assert.match(rowSource, /removeAttribute\("data-hover-peeks-previous"\)/);
  assert.match(rowSource, /removeProperty\("--home-row-card-hover-neighbor-shift-x"\)/);
  assert.equal((rowSource.match(/className="home-row-viewport relative"/g) ?? []).length, 2);
  assert.match(cssSource, /\.home-row-cover-card\[data-hover-edge="right"\]\[data-hover-peeks-next="true"\]\.group:hover \+ \.home-row-cover-card \.home-cover-card-surface,\s*\.home-row-cover-card:has\(\+ \.home-row-cover-card\[data-hover-edge="left"\]\[data-hover-peeks-previous="true"\]\.group:hover\) \.home-cover-card-surface \{\s*pointer-events: none;\s*transform: translate3d\(var\(--home-row-card-hover-neighbor-shift-x, 0px\), 0, 0\);/);
  assert.match(cssSource, /\.home-row-viewport:has\(\.home-row-cover-card\[data-hover-edge="right"\]\[data-hover-peeks-next="true"\]\.group:hover\) \.carousel-edge-fade-right,\s*\.home-row-viewport:has\(\.home-row-cover-card\[data-hover-edge="left"\]\[data-hover-peeks-previous="true"\]\.group:hover\) \.carousel-edge-fade-left \{\s*opacity: 0\.22;/);
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

test("content details modal lets lesson-list wheel gestures continue to the modal", () => {
  const lessonsScrollBlock = cssSource.match(/\.modal-lessons-scroll \{[\s\S]*?\}/)?.[0] ?? "";

  assert.match(lessonsScrollBlock, /overflow-y: auto;/);
  assert.match(lessonsScrollBlock, /overscroll-behavior: auto;/);
  assert.doesNotMatch(lessonsScrollBlock, /overscroll-behavior: contain;/);
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
  // O servidor manda a imagem da aula ja resolvida e nunca o video (aula bloqueada/produto nao comprado).
  assert.match(modalSource, /return lesson\.image \|\| "";/);
  assert.doesNotMatch(modalSource, /lesson\.video/);
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
  assert.match(savedButtonSource, /keepalive: true/);
  assert.match(savedButtonSource, /export async function flushPendingSavedItemChanges/);
  assert.match(savedButtonSource, /className=\{cn\("relative", className,/);
  assert.match(appShellSource, /await flushPendingSavedItemChanges\(\);\s*router\.push\(href\);/);
  assert.doesNotMatch(savedButtonSource, /disabled=\{pending\}/);
  assert.doesNotMatch(savedButtonSource, /disabled:cursor-wait/);
  assert.match(platformStoreSource, /applySavedStateToItems/);
  assert.match(platformStoreSource, /applySavedStateToModules/);
});

test("favorites page lists persisted saved items", () => {
  assert.match(favoritesPageSource, /\/favoritos/);
  assert.match(favoritesPageSource, /getFavoritesPageData/);
  assert.match(favoritesExperienceSource, /Favoritos/);
  assert.match(favoritesExperienceSource, /Conteúdos/);
  assert.match(favoritesExperienceSource, /Aulas/);
  assert.match(platformStoreSource, /getSavedContentItems/);
  assert.match(platformStoreSource, /getSavedLessonItems/);
});

test("favorite lesson cards prefer the video thumbnail and center the play action", async () => {
  const favoriteLessonCardSource = favoritesExperienceSource.match(
    /function FavoriteLessonCard[\s\S]*?\n\}/u
  )?.[0] ?? "";
  const lessonCardSource = await readFile(new URL("../src/components/member/ui/member-lesson-card.tsx", import.meta.url), "utf8");
  const favoritesViewSource = await readFile(new URL("../src/server/member-area/favorites-view.ts", import.meta.url), "utf8");

  const savedLessonItemsSource = platformStoreSource.match(/function getSavedLessonItems[\s\S]*?\n\}/u)?.[0] ?? "";

  // Thumbnail do video primeiro (quando a aula pode mostrar o video), depois a imagem da aula e a do modulo.
  assert.match(savedLessonItemsSource, /image: [^\n]*getVideoThumbnailUrl\(lesson\.video\)[^\n]*\|\| lesson\.image \|\| courseModule\.image/);
  // Aula liberada: thumbnail do video primeiro (a biblioteca ja a coloca em libraryLesson.image).
  assert.match(favoritesViewSource, /libraryLesson\.image \|\| lesson\.image \|\| libraryModule\.image/);
  assert.match(favoriteLessonCardSource, /<MemberLessonCard/);
  assert.match(lessonCardSource, /absolute left-1\/2 top-1\/2 grid size-12 -translate-x-1\/2 -translate-y-1\/2 place-items-center/);
  assert.doesNotMatch(lessonCardSource, /hover:-translate-y-1/);
  assert.doesNotMatch(favoriteLessonCardSource, /absolute left-4 top-4 grid h-11 w-11/);
});

test("favorite cards reuse the faster continue-watching image zoom without moving the card", () => {
  const favoriteCardsSource = favoritesExperienceSource.match(
    /function FavoritePosterCard[\s\S]*?export function FavoritesExperience/u
  )?.[0] ?? "";

  // Capas e aulas usam as pecas da base (zoom curto so na imagem). A capa nao sobe no hover: o botao de
  // remover fica fora do link e nao acompanharia o card.
  assert.match(favoriteCardsSource, /<MemberPosterCard/);
  assert.match(favoriteCardsSource, /<MemberLessonCard/);
  assert.match(favoritesExperienceSource, /const keepPosterInPlaceClassName = "\[&>a>div\]:translate-none!";/);
  assert.match(favoriteCardsSource, /className=\{cn\(keepPosterInPlaceClassName/);
  assert.doesNotMatch(favoriteCardsSource, /hover:-translate-y-1/);
  assert.doesNotMatch(favoriteCardsSource, /duration-700 group-hover:scale-\[1\.035\]/);
});
