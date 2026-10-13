import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lessonSource = await readFile(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");
const lessonTutorSource = await readFile(new URL("../src/components/lesson-ai-tutor.tsx", import.meta.url), "utf8");
const manualYouTubePlayerSource = await readFile(
  new URL("../src/components/youtube-manual-stream-player.tsx", import.meta.url),
  "utf8"
);
const lessonPageSource = await readFile(new URL("../src/app/conteudo/[id]/aulas/[moduleId]/page.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const platformTypesSource = await readFile(new URL("../src/lib/platform-types.ts", import.meta.url), "utf8");
const savedButtonSource = await readFile(new URL("../src/components/saved-item-button.tsx", import.meta.url), "utf8");
const tooltipSource = await readFile(new URL("../src/components/ui/tooltip.tsx", import.meta.url), "utf8");
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
  assert.match(appShellSource, /<header className="fixed left-0 right-0 top-0 z-40 overflow-hidden md:left-\[72px\]">/);
  assert.match(lessonSource, /lesson-player-frame group\/player relative z-0 aspect-video/);
  assert.match(lessonSource, /aria-label=\{`Voltar para \$\{returnLabel\}`\}\s*className="group\/action absolute left-3 top-3 z-30/);
  assert.match(lessonSource, /aria-label="Mostrar listagem de aulas"\s*className="group\/action absolute right-4 top-4 z-30/);
  assert.doesNotMatch(lessonSource, /getVideoProviderLabel/);
  assert.doesNotMatch(lessonSource, /videoProviderLabel/);
});

test("lesson playlist collapse tooltip escapes the clipped playlist shell", () => {
  const playlistStart = lessonSource.indexOf("<aside className={`lesson-playlist-shell");
  const playlistSource = lessonSource.slice(playlistStart);

  assert.notEqual(playlistStart, -1, "the lesson playlist should exist");
  assert.match(playlistSource, /aria-label="Esconder listagem de aulas"/);
  assert.match(playlistSource, /<TooltipTrigger/);
  assert.match(playlistSource, /<TooltipContent[\s\S]*?side="top"[\s\S]*?sideOffset=\{12\}/);
  assert.doesNotMatch(playlistSource, /<ActionTooltip label="Esconder aulas"/);
  assert.match(tooltipSource, /<TooltipPrimitive\.Portal>/);
});

test("lesson support panel exposes the Tutor IA tab with correct Portuguese labels", () => {
  assert.match(lessonSource, /type LessonTab = "aiTutor" \| "comments" \| "materials";/);
  assert.match(lessonSource, /label: "Comentários"/);
  assert.doesNotMatch(lessonSource, /label: "Comentarios"/);
  assert.match(lessonSource, /id: "aiTutor" as const, label: "Tutor IA", count: null, icon: TutorAiIcon/);
  assert.match(lessonSource, /function TutorAiIcon/);
  assert.match(lessonSource, /<GraduationCap className="h-full w-full"/);
  assert.match(lessonSource, /<Sparkles/);
  assert.match(lessonSource, /aria-label="Conteúdo da aula"[^>]*role="tablist"/);
  assert.match(lessonSource, /aria-selected=\{isActive\}/);
  assert.match(lessonSource, /activeTab === "aiTutor"/);
  assert.match(lessonSource, /<LessonAiTutor/);
  assert.match(lessonTutorSource, /Tutor IA desta aula/);
  assert.match(lessonTutorSource, /Tire dúvidas, peça explicações ou resumos e encontre rapidamente o trecho que você procura\./);
  assert.match(lessonTutorSource, /As conversas ficam salvas no seu histórico desta aula\./);
  assert.doesNotMatch(lessonTutorSource, /Este recurso estará disponível em breve\./);
  assert.doesNotMatch(lessonTutorSource, /usando somente a transcrição/);
});

test("lesson materials shortcut selects the tab and scrolls to the support panel", () => {
  assert.match(lessonSource, /const lessonSupportPanelRef = useRef<HTMLDivElement>\(null\);/);
  assert.match(lessonSource, /function handleMaterialsShortcut\(\) \{[\s\S]*?selectLessonTab\("materials"\)/);
  assert.match(lessonSource, /lessonSupportPanelRef\.current\?\.scrollIntoView\(\{\s*behavior: "smooth",\s*block: "start"\s*\}\)/);
  assert.match(lessonSource, /getElementById\("lesson-tab-materials"\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(lessonSource, /aria-label="Abrir materiais"[\s\S]*?onClick=\{handleMaterialsShortcut\}/);
  assert.match(lessonSource, /lesson-support-panel mt-8 scroll-mt-24[\s\S]*?ref=\{lessonSupportPanelRef\}/);
});

test("lesson title is pure white and youtube settings close anywhere outside the control", () => {
  assert.match(lessonSource, /<h1 className="max-w-5xl text-2xl font-black leading-tight text-\[#ffffff\]/);
  assert.match(lessonSource, /data-youtube-settings-control/);
  assert.match(lessonSource, /function handleYouTubeSettingsPointerDown\(event: PointerEvent\)/);
  assert.match(lessonSource, /target\.closest\("\[data-youtube-settings-control\]"\)/);
  assert.match(lessonSource, /document\.addEventListener\("pointerdown", handleYouTubeSettingsPointerDown, true\)/);
  assert.match(lessonSource, /document\.removeEventListener\("pointerdown", handleYouTubeSettingsPointerDown, true\)/);
  assert.match(lessonSource, /setYouTubeSettingsMenuOpen\(false\);\s*setYouTubeSettingsMenuView\("root"\);/);
});

test("youtube lessons use only the non-clickable Bunker707 player controls", () => {
  assert.match(lessonSource, /https:\/\/www\.youtube-nocookie\.com\/embed\/\$\{encodeURIComponent\(videoId\)\}/);
  assert.match(lessonSource, /controls=0&disablekb=1&fs=0&iv_load_policy=3/);
  assert.match(lessonSource, /url\.searchParams\.set\("origin", window\.location\.origin\)/);
  assert.match(lessonSource, /aria-hidden=\{usesCustomYouTubeControls \? "true" : undefined\}/);
  assert.match(lessonSource, /pointer-events-none absolute left-1\/2 top-0 h-full w-\[300%\]/);
  assert.match(lessonSource, /allow=\{usesCustomYouTubeControls \? "autoplay; encrypted-media"/);
  assert.match(lessonSource, /tabIndex=\{usesCustomYouTubeControls \? -1 : undefined\}/);
  assert.match(lessonSource, /key=\{`\$\{activeLessonKey\}-\$\{youTubeReloadToken\}`\}/);
  assert.match(lessonSource, /data-youtube-interaction-shield/);
  assert.match(lessonSource, /data-youtube-custom-controls/);
  assert.match(lessonSource, /onAutoplayBlocked:/);
  assert.match(lessonSource, /errorCode: event\.data/);
  assert.match(lessonSource, /aria-label="Progresso do video"/);
  assert.match(lessonSource, /onInput=\{handleYouTubeSeek\}/);
  assert.match(lessonSource, /onInput=\{handleYouTubeVolumeChange\}/);
  assert.match(lessonSource, /onClick=\{handlePlayerFullscreen\}/);
  assert.match(lessonSource, /youTubeControlState\.playbackState === "ended"/);
  assert.match(lessonSource, /Its video ID is still\s+discoverable in page\/network inspection/);
  assert.match(lessonSource, /YouTube UI changes can require\s+adjustments to the oversized edge crop/);
  assert.doesNotMatch(lessonSource, /modestbranding=1|showinfo=0/);
  assert.doesNotMatch(lessonSource, /href=\{?[^\n]*youtube/i);
});

test("youtube controls expose seeking, time, volume and centered custom captions without a dark strip", () => {
  assert.match(lessonSource, /function handleYouTubeSkip\(seconds: number\)/);
  assert.match(lessonSource, /onClick=\{\(\) => handleYouTubeSkip\(-10\)\}/);
  assert.match(lessonSource, /onClick=\{\(\) => handleYouTubeSkip\(10\)\}/);
  assert.match(lessonSource, /aria-label="Retroceder 10 segundos"/);
  assert.match(lessonSource, /aria-label="Avancar 10 segundos"/);
  assert.match(lessonSource, /\{formatPlaybackTime\(youTubeCurrentTime\)\} \/ \{formatPlaybackTime\(youTubeDuration\)\}/);
  assert.match(lessonSource, /aria-label="Volume"/);
  assert.match(lessonSource, /\/api\/video\/youtube\/captions\?\$\{searchParams\}/);
  assert.match(lessonSource, /event\.target\.unloadModule\?\.\("captions"\)/);
  assert.match(lessonSource, /data-youtube-custom-caption/);
  assert.match(lessonSource, /inset-x-\[6%\].*justify-center/);
  assert.match(lessonSource, /aria-pressed=\{youTubeCaptionsAvailable && youTubeCaptionsEnabled\}/);
  assert.match(lessonSource, /<ClosedCaption className="h-5 w-5" strokeWidth=\{2\}/);
  assert.match(lessonSource, /data-youtube-quality-menu/);
  assert.match(lessonSource, /data-youtube-quality-badge/);
  assert.doesNotMatch(lessonSource, /bg-black\/82/);
  assert.doesNotMatch(lessonSource, /shadow-xl shadow-black\/40 backdrop-blur-sm/);
});

test("youtube control bar keeps the compact player layout requested for students", () => {
  const controlsStart = lessonSource.indexOf('aria-label="Controles do video"');
  const controlsEnd = lessonSource.indexOf("{showPlayerClickOverlay ?", controlsStart);

  assert.notEqual(controlsStart, -1, "the custom YouTube control bar should exist");
  assert.notEqual(controlsEnd, -1, "the custom YouTube control bar should have a stable boundary");

  const controlsSource = lessonSource.slice(controlsStart, controlsEnd);
  const timelineIndex = controlsSource.indexOf('aria-label="Progresso do video"');
  const buttonRowIndex = controlsSource.indexOf('className="flex min-w-0 items-center justify-between');

  assert.ok(timelineIndex >= 0 && timelineIndex < buttonRowIndex, "the thin timeline should stay above the buttons");
  assert.match(cssSource, /\.bunker-player-timeline::\-webkit-slider-runnable-track \{[\s\S]*?height: 3px;/);
  assert.match(cssSource, /\.bunker-player-timeline::\-moz-range-track \{[\s\S]*?height: 3px;/);

  const leftControlsStart = controlsSource.indexOf("data-youtube-primary-controls");
  const rightControlsStart = controlsSource.indexOf("data-youtube-secondary-controls");

  assert.ok(leftControlsStart >= 0, "the primary controls should remain grouped on the left");
  assert.ok(rightControlsStart > leftControlsStart, "the secondary controls should remain grouped on the right");

  const leftControlsSource = controlsSource.slice(leftControlsStart, rightControlsStart);
  const leftControlLabels = [
    "handleYouTubePlaybackToggle",
    'aria-label="Retroceder 10 segundos"',
    'aria-label="Avancar 10 segundos"',
    "handleYouTubeMuteToggle",
    'aria-label="Volume"',
    "formatPlaybackTime(youTubeCurrentTime)",
    "formatPlaybackTime(youTubeDuration)"
  ];
  let previousLeftControlIndex = -1;

  for (const label of leftControlLabels) {
    const controlIndex = leftControlsSource.indexOf(label);

    assert.ok(controlIndex > previousLeftControlIndex, `${label} should keep its position in the left control group`);
    previousLeftControlIndex = controlIndex;
  }

  assert.equal((leftControlsSource.match(/<button\b/g) ?? []).length, 4, "the left side should contain only play, back 10, forward 10 and mute buttons");
  assert.match(controlsSource, /<RotateCcw className="h-6 w-6" strokeWidth=\{2\} \/>/);
  assert.match(controlsSource, /<RotateCw className="h-6 w-6" strokeWidth=\{2\} \/>/);
  assert.match(controlsSource, /<VolumeX className="h-5 w-5" strokeWidth=\{2\} \/>[\s\S]*?<Volume2 className="h-5 w-5" strokeWidth=\{2\} \/>/);

  assert.match(
    controlsSource,
    /data-youtube-secondary-controls[\s\S]*?>\s*\{renderYouTubeCaptionsButton\(\)\}\s*\{renderYouTubeQualityControl\("above"\)\}\s*\{renderPlayerFullscreenButton\(\)\}\s*<\/div>/
  );
  assert.equal((controlsSource.match(/renderYouTubeCaptionsButton\(\)/g) ?? []).length, 1);
  assert.equal((controlsSource.match(/renderYouTubeQualityControl\("above"\)/g) ?? []).length, 1);
  assert.equal((controlsSource.match(/renderPlayerFullscreenButton\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(lessonSource, /data-youtube-mobile-secondary-controls/);
  assert.match(lessonSource, /<ClosedCaption className="h-5 w-5" strokeWidth=\{2\} \/>/);
  assert.match(lessonSource, /<Settings className="h-5 w-5" strokeWidth=\{2\} \/>/);
  assert.match(lessonSource, /<Minimize className="h-5 w-5" strokeWidth=\{2\} \/>[\s\S]*?<Maximize className="h-5 w-5" strokeWidth=\{2\} \/>/);
  assert.match(cssSource, /\.bunker-player-timeline::\-webkit-slider-thumb \{[\s\S]*?background: var\(--accent\);[\s\S]*?height: 12px;/);
  assert.match(cssSource, /\.bunker-player-timeline:hover::\-webkit-slider-thumb,[\s\S]*?height: 14px;/);
});

test("youtube quality gear shows the selected or detected automatic resolution badge", () => {
  assert.match(lessonSource, /automaticQuality: string \| null;/);
  assert.match(lessonSource, /automaticQuality: null,/);
  assert.match(lessonSource, /onPlaybackQualityChange\?: \(event: YouTubePlayerQualityChangeEvent\) => void;/);
  assert.match(lessonSource, /onPlaybackQualityChange: \(event\) => \{[\s\S]*?normalizeYouTubePlaybackQuality\(event\.data\)[\s\S]*?automaticQuality/);
  assert.match(lessonSource, /small: "240p"/);
  assert.match(lessonSource, /medium: "360p"/);
  assert.match(lessonSource, /large: "480p"/);
  assert.match(lessonSource, /hd720: "720p"/);
  assert.match(lessonSource, /hd1080: "1080p"/);
  assert.match(lessonSource, /hd1440: "1440p"/);
  assert.match(lessonSource, /hd2160: "2160p"/);
  assert.match(lessonSource, /normalizedQuality === "highres"[\s\S]*?return "highres";/);
  assert.match(lessonSource, /function getYouTubeQualityBadge\(quality: string\)/);
  assert.match(lessonSource, /if \(quality === "highres"\) \{\s*return "HD\+";/);
  assert.match(lessonSource, /if \(height >= 2160\) return "4K";/);
  assert.match(lessonSource, /if \(height >= 1440\) return "2K";/);
  assert.match(lessonSource, /if \(height >= 720\) return "HD";/);
  assert.match(lessonSource, /return "AUTO";/);
  assert.match(lessonSource, /const effectiveYouTubeQualityBadgeSource = effectiveYouTubeAutomaticQuality \?\? effectiveYouTubeSelectedQuality;/);
  assert.match(lessonSource, /Automático, atual \$\{getYouTubeQualityDisplayName\(effectiveYouTubeAutomaticQuality\)\}/);
  assert.match(lessonSource, /\{getYouTubeQualityBadge\(effectiveYouTubeQualityBadgeSource\)\}/);
  assert.match(lessonSource, /data-youtube-quality-badge/);
  assert.doesNotMatch(lessonSource, /getPlaybackQuality/);
});

test("youtube settings menu changes playback speed in automatic and manual quality modes", () => {
  assert.match(lessonSource, /getAvailablePlaybackRates\?: \(\) => number\[\];/);
  assert.match(lessonSource, /getPlaybackRate\?: \(\) => number;/);
  assert.match(lessonSource, /setPlaybackRate\?: \(playbackRate: number\) => void;/);
  assert.match(lessonSource, /onPlaybackRateChange\?: \(event: YouTubePlayerRateChangeEvent\) => void;/);
  assert.match(lessonSource, /onPlaybackRateChange: \(event\) => \{[\s\S]*?playbackRate: event\.data/);
  assert.match(lessonSource, /readYouTubePlaybackRates\(event\.target\)/);
  assert.match(lessonSource, /event\.target\.setPlaybackRate\?\.\(preferredPlaybackRate\)/);
  assert.match(lessonSource, /function handleYouTubePlaybackRateSelect\(playbackRate: number\)/);
  assert.match(lessonSource, /player\.setPlaybackRate\?\.\(playbackRate\)/);
  assert.match(lessonSource, /type YouTubeSettingsMenuView = "playbackRate" \| "quality" \| "root";/);
  assert.match(lessonSource, /useState<YouTubeSettingsMenuView>\("root"\)/);
  assert.match(lessonSource, /data-youtube-settings-menu/);
  assert.doesNotMatch(lessonSource, /ActionTooltip label=\{`Configuracoes:/);
  assert.match(lessonSource, /youTubeSettingsMenuView === "root"/);
  assert.match(lessonSource, /data-youtube-settings-root/);
  assert.match(lessonSource, /rounded-2xl border border-white\/10 bg-black\/85/);
  assert.match(lessonSource, /backdrop-blur-xl/);
  assert.match(lessonSource, /onClick=\{\(\) => setYouTubeSettingsMenuView\("playbackRate"\)\}/);
  assert.match(lessonSource, /onClick=\{\(\) => setYouTubeSettingsMenuView\("quality"\)\}/);
  assert.match(lessonSource, /<Gauge className="h-5 w-5 text-zinc-100" strokeWidth=\{1\.8\} \/>/);
  assert.match(lessonSource, /<SlidersHorizontal className="h-5 w-5 text-zinc-100" strokeWidth=\{1\.8\} \/>/);
  assert.match(lessonSource, /grid-cols-\[2rem_minmax\(0,1fr\)_auto\][^\n]*text-sm font-normal/);
  assert.match(lessonSource, />Velocidade de reprodução</);
  assert.match(lessonSource, />Qualidade</);
  assert.match(lessonSource, /const playbackRateSummary = getPlaybackRateMenuLabel\(youTubeControlState\.playbackRate\);/);
  assert.match(lessonSource, /return playbackRate === 1 \? "Normal" : formatPlaybackRate\(playbackRate\);/);
  assert.match(lessonSource, /<ChevronRight className="h-4 w-4/);
  assert.match(lessonSource, /aria-label="Voltar para configuracoes"/);
  assert.match(lessonSource, /onClick=\{\(\) => setYouTubeSettingsMenuView\("root"\)\}/);
  assert.match(lessonSource, /<ChevronLeft className="h-5 w-5"/);
  assert.match(lessonSource, /youTubeSettingsMenuView === "playbackRate" \? \(/);
  assert.match(lessonSource, /data-youtube-playback-rate-menu/);
  assert.match(lessonSource, /youTubeControlState\.availablePlaybackRates\.map\(\(playbackRate\) =>/);
  assert.match(lessonSource, /initialPlaybackRate=\{youTubeControlState\.playbackRate\}/);
  assert.match(manualYouTubePlayerSource, /getAvailablePlaybackRates: \(\) => \[\.\.\.supportedPlaybackRates\]/);
  assert.match(manualYouTubePlayerSource, /getPlaybackRate: \(\) => videoRef\.current\?\.playbackRate \?\? 1/);
  assert.match(manualYouTubePlayerSource, /audioRef\.current\.playbackRate = nextPlaybackRate/);
  assert.match(manualYouTubePlayerSource, /videoRef\.current\.playbackRate = nextPlaybackRate/);
});

test("youtube quality menu uses real streams and keeps the automatic iframe fallback", () => {
  const qualityControlStart = lessonSource.indexOf("function renderYouTubeQualityControl");
  const qualityControlEnd = lessonSource.indexOf("function renderPlayerFullscreenButton", qualityControlStart);
  const qualityControlSource = lessonSource.slice(qualityControlStart, qualityControlEnd);

  assert.match(lessonSource, /\/api\/video\/youtube\/streams\?\$\{searchParams\}/);
  assert.match(lessonSource, /youTubeAvailableQualities\.map\(\(quality\) =>/);
  assert.match(lessonSource, /role="menuitemradio"/);
  assert.match(lessonSource, /onClick=\{\(\) => handleYouTubeQualitySelect\("auto"\)\}/);
  assert.match(lessonSource, /onClick=\{\(\) => handleYouTubeQualitySelect\(quality\.label\)\}/);
  assert.match(lessonSource, /\{quality\.width\}x\{quality\.height\}/);
  assert.match(lessonSource, /const selectedYouTubeManualStream = effectiveYouTubeSelectedQuality === "auto"\s*\?\s*null/);
  assert.match(lessonSource, /<YouTubeManualStreamPlayer/);
  assert.match(lessonSource, /audioUrl=\{youTubeStreamsResult\.audio\.url\}/);
  assert.match(lessonSource, /key=\{`\$\{activeLessonKey\}-manual-stream`\}/);
  assert.match(lessonSource, /videoUrl=\{selectedYouTubeManualStream\.url\}\s*\/>\s*\) : \(\s*<iframe/);
  assert.doesNotMatch(lessonSource, /key=\{`\$\{activeLessonKey\}-\$\{selectedYouTubeManualStream\.itag\}/);
  assert.match(manualYouTubePlayerSource, /audio\.load\(\);\s*\}, \[audioUrl\]\);/);
  assert.match(manualYouTubePlayerSource, /video\.load\(\);\s*\}, \[shouldPlay, switchToken, videoUrl\]\);/);
  assert.match(manualYouTubePlayerSource, /aria-hidden="true"\s*muted\s*playsInline/);
  assert.doesNotMatch(lessonSource, /Automatica se adapta a velocidade da internet/);
  assert.doesNotMatch(lessonSource, /As demais opcoes fixam a resolucao escolhida/);
  assert.match(qualityControlSource, />\s*Automático\s*\{/);
  assert.ok(
    qualityControlSource.indexOf("youTubeAvailableQualities.map") < qualityControlSource.indexOf('handleYouTubeQualitySelect("auto")'),
    "the automatic option should be the final quality option"
  );
  assert.match(qualityControlSource, /className="py-1" data-youtube-quality-menu/);
  assert.doesNotMatch(qualityControlSource, /grid-cols-3|grid-cols-4/);
  assert.doesNotMatch(qualityControlSource, /max-h-|overflow-y-auto/);
});

test("manual youtube quality switches prepare audio and video without a black frame", () => {
  assert.match(lessonSource, /posterUrl=\{videoPosterImage\}/);
  assert.match(manualYouTubePlayerSource, /const futureDataReadyState = 3;/);
  assert.match(
    manualYouTubePlayerSource,
    /audio\.readyState < futureDataReadyState \|\|\s*video\.readyState < futureDataReadyState/
  );
  assert.match(manualYouTubePlayerSource, /await Promise\.all\(\[video\.play\(\), audio\.play\(\)\]\)/);
  assert.match(manualYouTubePlayerSource, /alignAudio\(0\.06\);\s*playbackStateRef\.current = playerStatePlaying;/);
  assert.match(manualYouTubePlayerSource, /playbackGenerationRef\.current \+= 1;/);
  assert.match(manualYouTubePlayerSource, /const hardSyncThresholdSeconds = 0\.75;/);
  assert.match(manualYouTubePlayerSource, /const softSyncThresholdSeconds = 0\.08;/);
  assert.match(manualYouTubePlayerSource, /const settledSyncThresholdSeconds = 0\.025;/);
  assert.match(manualYouTubePlayerSource, /const syncPlaybackRateCorrection = 0\.05;/);
  assert.match(manualYouTubePlayerSource, /const periodicSyncIntervalMilliseconds = 500;/);
  assert.match(manualYouTubePlayerSource, /const correctAudioDrift = useCallback/);
  assert.match(manualYouTubePlayerSource, /audio\.playbackRate = basePlaybackRate \* correction;/);
  assert.match(manualYouTubePlayerSource, /if \(absoluteDrift > hardSyncThresholdSeconds\) \{\s*alignAudio\(0\);/);
  assert.match(manualYouTubePlayerSource, /correctAudioDrift\(\);/);
  assert.match(manualYouTubePlayerSource, /if \(audio\.paused \|\| video\.paused\) \{\s*void playBoth\(\);/);
  assert.doesNotMatch(manualYouTubePlayerSource, /\}, 100\);/);
  assert.equal((manualYouTubePlayerSource.match(/preload="auto"/g) ?? []).length, 2);
  assert.match(manualYouTubePlayerSource, /poster=\{posterUrl\}/);
  assert.match(manualYouTubePlayerSource, /onLoadStart=\{\(\) => setIsPreparingFrame\(true\)\}/);
  assert.match(manualYouTubePlayerSource, /onLoadedData=\{revealPreparedFrame\}/);
  assert.match(manualYouTubePlayerSource, /style=\{\{ backgroundImage: `url\(\$\{posterUrl\}\)` \}\}/);
});

test("youtube automatic quality remains the default adaptive provider mode", () => {
  assert.match(lessonSource, /useState\("auto"\)/);
  assert.match(lessonSource, /const selectedYouTubeManualStream = effectiveYouTubeSelectedQuality === "auto"\s*\?\s*null/);
  assert.match(lessonSource, /if \(selection === "auto"\) \{\s*setYouTubeReloadToken/);
  assert.match(lessonSource, /onPlaybackQualityChange: \(event\) =>/);
  assert.doesNotMatch(lessonSource, /setPlaybackQuality|getAvailableQualityLevels|suggestedQuality|[?&]vq=/);
});

test("lesson page can open a requested lesson from the modal link", () => {
  assert.match(lessonPageSource, /lessonId\?: string \| string\[\];/);
  assert.match(lessonPageSource, /const requestedLessonId = Array\.isArray\(resolvedSearchParams\?\.lessonId\)/);
  assert.match(lessonPageSource, /initialLessonId=\{requestedLessonId\}/);
  assert.match(lessonPageSource, /key=\{`\$\{selectedModule\.id\}:\$\{requestedLessonId \?\? "auto"\}`\}/);
  assert.match(lessonSource, /initialLessonId\?: string;/);
  assert.match(lessonSource, /const initialActiveLessonId = requestedLessonId \|\| fallbackInitialLessonId;/);
});

test("lesson playlist prefers each lesson video thumbnail before the module image", () => {
  assert.match(
    lessonSource,
    /backgroundImage: `url\(\$\{getYouTubeThumbnailUrl\(lesson\.video\) \|\| lesson\.image \|\| courseModule\.image\}\)`/
  );
  assert.doesNotMatch(lessonSource, /backgroundImage: `url\(\$\{lesson\.image \?\? courseModule\.image\}\)`/);
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
  assert.match(platformStoreSource, /lessonProgressExtras/);
  assert.match(platformStoreSource, /normalizeLessonProgressExtras\(settingsMap\.get\("lessonProgressExtras"\)\)/);
  assert.match(platformStoreSource, /\.from\("lesson_progress"\)\s*\.select\("completed_lesson_ids,content_id,lesson_reactions,lesson_watch_states,updated_at,user_id"\)/);
  assert.match(platformStoreSource, /lesson_watch_states: nextRecord\.lessonWatchStates/);
  assert.doesNotMatch(platformStoreSource, /await writeDatabase\(database\)/);
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
  assert.match(lessonSource, /function handlePlayerStart\(\)/);
  assert.match(lessonSource, /onTimeUpdate=\{\(event\) => handleNativeVideoProgress\(event\.currentTarget\)\}/);
  assert.match(lessonSource, /startedLessonIds\.has\(lesson\.id\)/);
  assert.match(lessonSource, /const persistLessonProgress = useCallback/);
  assert.match(lessonSource, /credentials: "same-origin"/);
  assert.match(lessonSource, /Erro ao salvar progresso da aula/);
  const persistLessonProgressSource =
    lessonSource.match(/const persistLessonProgress = useCallback[\s\S]*?\n  \}, \[\]\);/u)?.[0] ?? "";
  assert.match(persistLessonProgressSource, /fetch\(LESSON_PROGRESS_ENDPOINT/);
  assert.doesNotMatch(persistLessonProgressSource, /keepalive: true/);
  assert.match(lessonSource, /const LESSON_PROGRESS_HEARTBEAT_MS = 15_000;/);
  assert.match(lessonSource, /if \(!force && now - lastSync < LESSON_PROGRESS_HEARTBEAT_MS\)/);
  assert.match(lessonSource, /\}, LESSON_PROGRESS_HEARTBEAT_MS\);/);
  assert.match(lessonSource, /const LESSON_PROGRESS_HEARTBEAT_SECONDS = LESSON_PROGRESS_HEARTBEAT_MS \/ 1000;/);
  assert.match(lessonSource, /progressSeconds \?\? 0\) \+ LESSON_PROGRESS_HEARTBEAT_SECONDS;/);
  assert.doesNotMatch(lessonSource, /now - lastSync < 3000|\}, 3000\);|\}, 10000\);|progressSeconds \?\? 0\) \+ 10;/);
  assert.match(lessonSource, /onLoadedMetadata=\{\(event\) =>/);
  assert.match(lessonSource, /function loadYouTubeIframeApi/);
  assert.match(lessonSource, /new window\.YT\.Player\(iframe/);
  assert.match(lessonSource, /url\.searchParams\.set\("start", String\(Math\.max\(0, Math\.floor\(startSeconds\)\)\)\)/);
  assert.match(lessonSource, /readYouTubeMetric\(\(\) => player\.getCurrentTime\(\)\)/);
  assert.match(lessonSource, /readYouTubeMetric\(\(\) => player\.getDuration\(\)\)/);
  assert.match(lessonSource, /activeLessonVideoProvider !== "youtube"/);
  assert.match(lessonSource, /activeLesson\.video\?\.provider === "youtube"/);
  assert.match(lessonSource, /activeLesson\.video\?\.provider === "youtube" && activePlayerRenderConfig\.kind === "iframe"/);
  assert.match(lessonSource, /pendingYouTubePlayLessonIdRef/);
  assert.match(lessonSource, /url\.searchParams\.set\("autoplay", autoplay \? "1" : "0"\)/);
  assert.match(lessonSource, /url\.searchParams\.set\("origin", window\.location\.origin\)/);
  assert.doesNotMatch(lessonSource, /allow="[^"]*autoplay/);
  assert.match(lessonSource, /const \[canRenderEmbeddedPlayer, setCanRenderEmbeddedPlayer\] = useState\(false\);/);
  assert.match(lessonSource, /window\.requestAnimationFrame\(\(\) => \{\s*setCanRenderEmbeddedPlayer\(true\);/);
  assert.match(lessonSource, /window\.cancelAnimationFrame\(animationFrame\);/);
  assert.match(lessonSource, /!canRenderEmbeddedPlayer \|\|\s*!activeLessonKey/);
  assert.match(lessonSource, /\) : canRenderEmbeddedPlayer \? \(\s*selectedYouTubeManualStream && youTubeStreamsResult\.audio \? \(\s*<YouTubeManualStreamPlayer/);
  assert.match(lessonSource, /videoUrl=\{selectedYouTubeManualStream\.url\}\s*\/>\s*\) : \(\s*<iframe/);
  assert.match(lessonSource, /function getYouTubeThumbnailUrl/);
  assert.match(lessonSource, /https:\/\/i\.ytimg\.com\/vi\/\$\{encodeURIComponent\(videoId\)\}\/hqdefault\.jpg/);
  assert.match(lessonSource, /const showPlayerClickOverlay =/);
  assert.match(lessonSource, /const showPlayerPosterOverlay =/);
  assert.doesNotMatch(lessonSource, /youtubeFrameReadyLessonIds/);
  assert.match(lessonSource, /activePlayerRenderConfig\?\.kind !== "video"/);
  assert.match(lessonSource, /const videoPosterImage = getYouTubeThumbnailUrl\(activeLesson\.video\) \|\| posterImage;/);
  assert.match(lessonSource, /style=\{\{ backgroundImage: `url\(\$\{videoPosterImage\}\)` \}\}/);
  assert.match(lessonSource, /activeLessonWatchedPercent > 0 \?/);
  assert.match(lessonSource, /pendingYouTubePlayLessonIdRef\.current === lessonId &&\s*youTubePlaybackIntentLessonIdRef\.current === lessonId[\s\S]{0,120}event\.target\.playVideo\?\.\(\);/);
  assert.match(lessonSource, /else \{[\s\S]{0,220}event\.target\.pauseVideo\?\.\(\);\s*\}/);
  assert.match(lessonSource, /const playbackWasRequested = youTubePlaybackIntentLessonIdRef\.current === lessonId;/);
  assert.match(lessonSource, /if \(!playbackWasRequested\) \{[\s\S]{0,220}event\.target\.pauseVideo\?\.\(\);/);
  assert.match(lessonSource, /if \(pendingYouTubePlayLessonIdRef\.current === lessonId\) \{\s*pendingYouTubePlayLessonIdRef\.current = null;\s*\}/);
  assert.match(lessonSource, /autoplay = false/);
  assert.match(lessonSource, /pendingYouTubePlayLessonIdRef\.current = null;\s*youTubePlaybackIntentLessonIdRef\.current = null;\s*player\.pauseVideo\?\.\(\);/);
  assert.doesNotMatch(lessonSource, /const resumeSeconds[\s\S]{0,600}event\.target\.seekTo\(resumeSeconds, true\)/);
  assert.doesNotMatch(lessonSource, /const player = youtubePlayerRef\.current;\s*if \(player\) \{\s*player\.playVideo\?\.\(\);/);
  assert.match(lessonSource, /maxProgressPercent: nextState\.maxProgressPercent/);
  assert.match(platformStoreSource, /const incomingProgressSeconds = Math\.round/);
  assert.match(platformStoreSource, /const safeProgressSeconds = progressSeconds === undefined\s*\?\s*existingWatchState\?\.progressSeconds \?\? 0\s*:\s*incomingProgressSeconds;/);
  assert.match(platformStoreSource, /normalizeProgressNumber\(record\.maxProgressPercent, progressPercent\)/);
  assert.match(platformStoreSource, /let lessonProgressWriteQueue = Promise\.resolve\(\);/);
  assert.match(platformStoreSource, /return await replaceCompletedLessonsUnsafe\(input\);/);
  assert.match(platformStoreSource, /LESSON_PROGRESS_CONFLICT_CODE/);
  assert.match(platformStoreSource, /\.eq\("updated_at", currentRow\.updated_at\)/);
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
  assert.match(lessonSource, /const flushActiveLessonProgress = useCallback\(async \(transport: LessonProgressTransport = "fetch"\) =>/);
  assert.match(lessonSource, /navigator\.sendBeacon\(LESSON_PROGRESS_ENDPOINT, new Blob\(\[body\], \{ type: "application\/json" \}\)\)/);
  // sendBeacon só envia POST: sem o alias, o flush de saída recebe 405 e o progresso se perde.
  assert.match(progressRouteSource, /export \{ PUT as POST \};/);
  assert.match(lessonSource, /keepalive: true,\s*method: "PUT"/);
  assert.match(lessonSource, /window\.addEventListener\("pagehide", flushOnPageExit\);/);
  assert.match(lessonSource, /document\.visibilityState === "hidden"/);
  assert.match(lessonSource, /void flushActiveLessonProgress\("beacon"\);/);
  assert.match(lessonSource, /await syncYouTubePlayerProgress\(youtubePlayerRef\.current/);
  assert.match(lessonSource, /window\.__bunker707FlushLessonProgress = flushActiveLessonProgress;/);
  assert.match(lessonSource, /function handleProgressAwareNavigation/);
  assert.match(lessonSource, /await flushActiveLessonProgress\(\);\s*router\.push\(href\);/);
  assert.match(lessonSource, /prefetch=\{false\}/);
  assert.match(appShellSource, /await window\.__bunker707FlushLessonProgress\?\.\(\);/);
  assert.match(appShellSource, /router\.push\(href\);/);
  assert.doesNotMatch(appShellSource, /prefetch=\{false\}/);
});

test("lesson playlist module headers avoid duplicate module labels", () => {
  assert.match(lessonSource, /courseModule\.title/);
  assert.doesNotMatch(lessonSource, /courseModule\.eyebrow/);
});
