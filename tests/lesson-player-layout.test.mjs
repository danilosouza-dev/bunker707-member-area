import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lessonSource = await readFile(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");
const lessonPageSource = await readFile(new URL("../src/app/conteudo/[id]/aulas/[moduleId]/page.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const platformTypesSource = await readFile(new URL("../src/lib/platform-types.ts", import.meta.url), "utf8");
const savedButtonSource = await readFile(new URL("../src/components/saved-item-button.tsx", import.meta.url), "utf8");
const contentStructureSource = await readFile(new URL("../src/components/content-structure-section.tsx", import.meta.url), "utf8");
const platformStoreSource = await readFile(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");
const progressRouteSource = await readFile(new URL("../src/app/api/progress/lessons/route.ts", import.meta.url), "utf8");
const lessonReactionsMigrationSource = await readFile(
  new URL("../supabase/migrations/202606150007_lesson_reactions.sql", import.meta.url),
  "utf8"
);
const lessonWatchStatesMigrationSource = await readFile(
  new URL("../supabase/migrations/202606150008_lesson_watch_states.sql", import.meta.url),
  "utf8"
);
const cssSource = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("lesson player stays within viewport height when playlist is collapsed", () => {
  assert.match(lessonSource, /lesson-main-content min-w-0/);
  assert.match(lessonSource, /lesson-player-frame/);
  assert.match(lessonSource, /lesson-details-header/);
  assert.match(lessonSource, /lesson-support-panel/);
  assert.match(cssSource, /\.lesson-main-content \{\s*margin-inline: 0;\s*max-width: 100%;\s*width: 100%;/);
  assert.match(cssSource, /\.lesson-player-frame \{\s*margin-inline: 0;\s*max-width: 100%;\s*width: 100%;/);
  assert.match(cssSource, /\.lesson-experience-grid-collapsed \.lesson-main-content \{\s*margin-inline: auto;\s*width: min\(100%, calc\(\(100vh - 12rem\) \* 16 \/ 9\)\);/);
  assert.match(cssSource, /\.lesson-experience-grid \{\s*column-gap: 1rem;/);
});

test("lesson player overlays stay below the global header", () => {
  assert.match(appShellSource, /<header className="fixed left-0 right-0 top-0 z-40 overflow-hidden">/);
  assert.match(lessonSource, /lesson-player-frame group\/player relative z-0 aspect-video/);
  assert.match(lessonSource, /aria-label=\{`Voltar para \$\{returnLabel\}`\}\s*className="group\/action absolute left-3 top-3 z-30/);
  assert.match(lessonSource, /aria-label="Mostrar listagem de aulas"\s*className="group\/action absolute right-4 top-4 z-30/);
  assert.doesNotMatch(lessonSource, /getVideoProviderLabel/);
  assert.doesNotMatch(lessonSource, /videoProviderLabel/);
});

test("lesson page can open a requested lesson from the modal link", () => {
  assert.match(lessonPageSource, /lessonId\?: string \| string\[\];/);
  assert.match(lessonPageSource, /const requestedLessonId = Array\.isArray\(resolvedSearchParams\?\.lessonId\)/);
  assert.match(lessonPageSource, /initialLessonId=\{requestedLessonId\}/);
  assert.match(lessonPageSource, /key=\{`\$\{selectedModule\.id\}:\$\{requestedLessonId \?\? "auto"\}`\}/);
  assert.match(lessonSource, /initialLessonId\?: string;/);
  assert.match(lessonSource, /const initialActiveLessonId = requestedLessonId \|\| fallbackInitialLessonId;/);
});

test("lesson page persists the active lesson in saved items", () => {
  assert.match(lessonSource, /SavedItemButton/);
  assert.match(lessonSource, /targetType="lesson"/);
  assert.match(lessonSource, /activeLessonSaved/);
  assert.match(lessonSource, /onSavedChange=\{handleActiveLessonSavedChange\}/);
  assert.match(savedButtonSource, /const nextSaved = !saved;/);
  assert.match(savedButtonSource, /function dispatchSavedItemChanged/);
  assert.match(savedButtonSource, /dispatchSavedItemChanged\(\{\s*saved: nextSaved,/);
  assert.match(savedButtonSource, /requestSavedItemSync\(\{/);
  assert.match(savedButtonSource, /savedRef\.current/);
  assert.doesNotMatch(savedButtonSource, /disabled=\{pending\}/);
  assert.match(savedButtonSource, /onSavedChange\?\.\(detail\.saved\)/);
});

test("lesson reactions can be selected and removed", () => {
  assert.match(lessonSource, /function handleLessonReactionToggle/);
  assert.match(lessonSource, /initialLessonReactions\?: Partial<Record<string, LessonReaction>>;/);
  assert.match(lessonPageSource, /initialLessonReactions=\{initialLessonReactions\}/);
  assert.match(platformStoreSource, /initialLessonReactions: getLessonReactions/);
  assert.match(progressRouteSource, /lessonReactions\?: Partial<Record<string, LessonReaction>>;/);
  assert.match(lessonReactionsMigrationSource, /add column if not exists lesson_reactions jsonb not null default '\{\}'::jsonb/);
  assert.match(lessonSource, /if \(nextLessonReactions\[activeLessonKey\] === reaction\) \{\s*delete nextLessonReactions\[activeLessonKey\];/);
  assert.match(lessonSource, /lessonReactions: nextLessonReactions/);
  assert.match(lessonSource, /aria-pressed=\{isSelected\}/);
  assert.match(lessonSource, /Remover avaliacao: \$\{option\.label\}/);
  assert.match(lessonSource, /onToggle=\{handleLessonReactionToggle\}/);
  assert.doesNotMatch(lessonSource, /role="radio"/);
});

test("lesson page handles modules without published lessons", () => {
  assert.match(lessonSource, /function EmptyLessonState/);
  assert.match(lessonSource, /const activeLesson = fallbackTarget\?\.lesson \?\? null;/);
  assert.match(lessonSource, /if \(!activeLesson\) \{/);
  assert.match(lessonSource, /Aulas em preparação/);
  assert.doesNotMatch(lessonSource, /lesson: selectedModule\.lessons\[0\],\s*module: selectedModule\s*\};\s*const activeLesson = fallbackTarget\.lesson;/);
  assert.match(contentStructureSource, /const hasLessons = module\.lessons\.length > 0;/);
  assert.match(contentStructureSource, /!hasLessons\s*\?\s*"Este modulo ainda nao tem aulas publicadas\."/);
});

test("lesson player records watch progress before completion", () => {
  assert.match(lessonSource, /initialLessonWatchStates\?: Record<string, LessonWatchState>;/);
  assert.match(lessonPageSource, /initialLessonWatchStates=\{initialLessonWatchStates\}/);
  assert.match(platformStoreSource, /initialLessonWatchStates: getLessonWatchStates/);
  assert.match(platformStoreSource, /getContinueWatchingFromProgress/);
  assert.match(platformStoreSource, /lesson_watch_states: record\.lessonWatchStates/);
  assert.match(platformStoreSource, /lessonProgressExtras/);
  assert.match(platformStoreSource, /getLessonProgressColumnSupport/);
  assert.match(platformStoreSource, /lessonProgressColumnSupport\.lessonWatchStates \? \{ lesson_watch_states: record\.lessonWatchStates \} : \{\}/);
  assert.match(platformStoreSource, /normalizeLessonProgressExtras\(settingsMap\.get\("lessonProgressExtras"\)\)/);
  assert.match(progressRouteSource, /lessonId\?: string;/);
  assert.match(progressRouteSource, /progressSeconds\?: number;/);
  assert.match(progressRouteSource, /maxProgressPercent\?: number;/);
  assert.match(progressRouteSource, /resumeFrameUrl\?: string;/);
  assert.match(progressRouteSource, /typeof payload\.maxProgressPercent === "number"/);
  assert.match(progressRouteSource, /typeof payload\.resumeFrameUrl === "string"/);
  assert.match(platformTypesSource, /maxProgressPercent\?: number;/);
  assert.match(platformTypesSource, /resumeFrameUrl\?: string;/);
  assert.match(progressRouteSource, /hasWatchProgress/);
  assert.match(lessonWatchStatesMigrationSource, /add column if not exists lesson_watch_states jsonb not null default '\{\}'::jsonb/);
  assert.match(lessonSource, /const handlePlayerStart = useCallback/);
  assert.match(lessonSource, /onTimeUpdate=\{\(event\) => handleNativeVideoProgress\(event\.currentTarget\)\}/);
  assert.match(lessonSource, /startedLessonIds\.has\(lesson\.id\)/);
  assert.match(lessonSource, /const persistLessonProgress = useCallback/);
  assert.match(lessonSource, /credentials: "same-origin"/);
  assert.match(lessonSource, /Erro ao salvar progresso da aula/);
  assert.doesNotMatch(lessonSource, /keepalive: true/);
  assert.match(lessonSource, /onLoadedMetadata=\{\(event\) =>/);
  assert.match(lessonSource, /function loadYouTubeIframeApi/);
  assert.match(lessonSource, /new window\.YT\.Player\(iframe/);
  assert.match(lessonSource, /event\.target\.seekTo\(resumeSeconds, true\)/);
  assert.match(lessonSource, /readYouTubeMetric\(\(\) => player\.getCurrentTime\(\)\)/);
  assert.match(lessonSource, /readYouTubeMetric\(\(\) => player\.getDuration\(\)\)/);
  assert.match(lessonSource, /activeLessonVideoProvider !== "youtube"/);
  assert.match(lessonSource, /activeLesson\.video\?\.provider === "youtube"/);
  assert.match(lessonSource, /activeLesson\.video\?\.provider === "youtube" && activePlayerRenderConfig\.kind === "iframe"/);
  assert.match(lessonSource, /pendingYouTubePlayLessonIdRef/);
  assert.match(lessonSource, /url\.searchParams\.set\("autoplay", autoplay \? "1" : "0"\)/);
  assert.doesNotMatch(lessonSource, /window\.location\.origin/);
  assert.doesNotMatch(lessonSource, /allow="[^"]*autoplay/);
  assert.match(lessonSource, /const \[canRenderEmbeddedPlayer, setCanRenderEmbeddedPlayer\] = useState\(false\);/);
  assert.match(lessonSource, /window\.requestAnimationFrame\(\(\) => \{\s*setCanRenderEmbeddedPlayer\(true\);/);
  assert.match(lessonSource, /window\.cancelAnimationFrame\(animationFrame\);/);
  assert.match(lessonSource, /!canRenderEmbeddedPlayer \|\|\s*!activeLessonKey/);
  assert.match(lessonSource, /\) : canRenderEmbeddedPlayer \? \(\s*<iframe/);
  assert.match(lessonSource, /function getYouTubeThumbnailUrl/);
  assert.match(lessonSource, /https:\/\/i\.ytimg\.com\/vi\/\$\{encodeURIComponent\(videoId\)\}\/hqdefault\.jpg/);
  assert.match(lessonSource, /const showPlayerClickOverlay =/);
  assert.match(lessonSource, /const showPlayerPosterOverlay =/);
  assert.doesNotMatch(lessonSource, /youtubeFrameReadyLessonIds/);
  assert.match(lessonSource, /activePlayerRenderConfig\?\.kind !== "video"/);
  assert.match(lessonSource, /const videoPosterImage = getYouTubeThumbnailUrl\(activeLesson\.video\) \|\| posterImage;/);
  assert.match(lessonSource, /style=\{\{ backgroundImage: `url\(\$\{videoPosterImage\}\)` \}\}/);
  assert.match(lessonSource, /activeLessonWatchedPercent > 0 \?/);
  assert.match(lessonSource, /if \(pendingYouTubePlayLessonIdRef\.current === lessonId\) \{\s*pendingYouTubePlayLessonIdRef\.current = null;\s*event\.target\.playVideo\?\.\(\);/);
  assert.match(lessonSource, /else if \(!startedLessonIdsRef\.current\.has\(lessonId\)\) \{\s*event\.target\.pauseVideo\?\.\(\);\s*return;/);
  assert.doesNotMatch(lessonSource, /const player = youtubePlayerRef\.current;\s*if \(player\) \{\s*player\.playVideo\?\.\(\);/);
  assert.match(lessonSource, /maxProgressPercent: nextState\.maxProgressPercent/);
  assert.match(platformStoreSource, /const incomingProgressSeconds = Math\.round/);
  assert.match(platformStoreSource, /const safeProgressSeconds = progressSeconds === undefined\s*\?\s*existingWatchState\?\.progressSeconds \?\? 0\s*:\s*incomingProgressSeconds;/);
  assert.match(platformStoreSource, /normalizeProgressNumber\(record\.maxProgressPercent, progressPercent\)/);
  assert.match(platformStoreSource, /let lessonProgressWriteQueue = Promise\.resolve\(\);/);
  assert.match(platformStoreSource, /lessonProgressWriteQueue\.then\(\(\) => replaceCompletedLessonsUnsafe\(input\)\)/);
  assert.match(platformStoreSource, /const safeMaxProgressPercent = nextStatus === "completed"/);
  assert.match(platformStoreSource, /const safeResumeFrameUrl = normalizeImageUrl\(resumeFrameUrl\) \?\? existingWatchState\?\.resumeFrameUrl;/);
  assert.match(platformStoreSource, /\.\.\.\(safeResumeFrameUrl \? \{ resumeFrameUrl: safeResumeFrameUrl \} : \{\}\)/);
  assert.match(platformStoreSource, /code === "PGRST204"/);
  assert.doesNotMatch(platformStoreSource, /const safeProgressSeconds = Math\.max\(\s*existingWatchState\?\.progressSeconds/);
});

test("lesson rating stays available after progress or prior reaction", () => {
  assert.match(lessonSource, /const hasRatedLesson = Boolean\(lessonReaction\);/);
  assert.match(lessonSource, /const activeLessonMaxWatchedPercent = Math\.max\(/);
  assert.match(lessonSource, /activeLessonWatchState\?\.maxProgressPercent \?\? 0,\s*activeLessonWatchedPercent/);
  assert.match(lessonSource, /const canRateLesson = activeLessonMaxWatchedPercent >= 30 \|\| hasRatedLesson;/);
  assert.match(lessonSource, /lessonReactions: nextLessonReactions/);
  assert.match(lessonSource, /maxProgressPercent: activeLessonMaxWatchedPercent/);
});

test("module progress includes partial watch progress", () => {
  assert.match(platformStoreSource, /const progressRecord = userId\s*\?\s*database\.lessonProgress\.find/);
  assert.match(platformStoreSource, /const lessonWatchStates = normalizeLessonWatchStates\(progressRecord\?\.lessonWatchStates\);/);
  assert.match(platformStoreSource, /const hasWatchProgress = Object\.keys\(lessonWatchStates\)\.length > 0;/);
  assert.match(platformStoreSource, /lessons\.reduce\(\(total, lesson\) =>/);
  assert.match(platformStoreSource, /return total \+ clampNumber\(lessonWatchStates\[lesson\.id\]\?\.progressPercent \?\? 0, 0, 100\);/);
});

test("lesson progress flushes before navigating away", () => {
  assert.match(lessonSource, /__bunker707FlushLessonProgress\?: \(\) => Promise<void>;/);
  assert.match(lessonSource, /const flushActiveLessonProgress = useCallback\(async \(\) =>/);
  assert.match(lessonSource, /await syncYouTubePlayerProgress\(youtubePlayerRef\.current/);
  assert.match(lessonSource, /window\.__bunker707FlushLessonProgress = flushActiveLessonProgress;/);
  assert.match(lessonSource, /function handleProgressAwareNavigation/);
  assert.match(lessonSource, /await flushActiveLessonProgress\(\);\s*router\.push\(href\);/);
  assert.match(lessonSource, /prefetch=\{false\}/);
  assert.match(appShellSource, /await window\.__bunker707FlushLessonProgress\?\.\(\);/);
  assert.match(appShellSource, /router\.push\(href\);/);
  assert.match(appShellSource, /prefetch=\{false\}/);
});

test("lesson playlist module headers avoid duplicate module labels", () => {
  assert.match(lessonSource, /courseModule\.title/);
  assert.doesNotMatch(lessonSource, /courseModule\.eyebrow/);
});
