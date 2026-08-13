import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const migrationSource = await source("../supabase/migrations/202607150003_lesson_tv_mode.sql");
const playbackRateMigrationSource = await source("../supabase/migrations/202607170003_tv_playback_rate.sql");
const captionTimingSource = await source("../src/lib/media-captions.ts");
const tvContractSource = await source("../src/lib/tv-session-contract.ts");
const tvSessionSource = await source("../src/server/video/tv-sessions.ts");
const createSessionRouteSource = await source("../src/app/api/tv/sessions/route.ts");
const ownerSessionRouteSource = await source("../src/app/api/tv/sessions/[sessionId]/route.ts");
const commandRouteSource = await source("../src/app/api/tv/sessions/[sessionId]/commands/route.ts");
const connectRouteSource = await source("../src/app/api/tv/connect/route.ts");
const receiverRouteSource = await source("../src/app/api/tv/receiver/[sessionId]/route.ts");
const receiverCaptionsRouteSource = await source("../src/app/api/tv/receiver/[sessionId]/captions/route.ts");
const receiverStreamsRouteSource = await source("../src/app/api/tv/receiver/[sessionId]/streams/route.ts");
const lessonTvControlSource = await source("../src/components/lesson-tv-control.tsx");
const lessonExperienceSource = await source("../src/components/lesson-experience.tsx");
const receiverExperienceSource = await source("../src/components/tv-receiver-experience.tsx");
const manualPlayerSource = await source("../src/components/youtube-manual-stream-player.tsx");
const tvPageSource = await source("../src/app/tv/page.tsx");
const { findActiveCaptionCue } = await import("../src/lib/media-captions.ts");

test("Modo TV schema keeps pairing and receiver credentials server-only", () => {
  assert.match(migrationSource, /create table if not exists public\.tv_sessions/);
  assert.match(migrationSource, /pairing_code text not null unique/);
  assert.match(migrationSource, /pairing_expires_at timestamptz not null/);
  assert.match(migrationSource, /receiver_token_hash text check/);
  assert.match(migrationSource, /receiver_token_hash is null or receiver_token_hash ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(migrationSource, /alter table public\.tv_sessions enable row level security/);
  assert.match(migrationSource, /revoke all on public\.tv_sessions from anon, authenticated/);
  assert.doesNotMatch(migrationSource, /create policy[^;]+tv_sessions/i);
});

test("pairing is temporary, atomic and can be consumed only once", () => {
  assert.match(migrationSource, /create or replace function public\.connect_tv_session/);
  assert.match(migrationSource, /status = 'pending'/);
  assert.match(migrationSource, /receiver_token_hash is null/);
  assert.match(migrationSource, /pairing_expires_at > now\(\)/);
  assert.match(migrationSource, /for update skip locked/);
  assert.match(migrationSource, /status = 'connected'/);
  assert.match(migrationSource, /grant execute on function public\.connect_tv_session\(text, text\) to service_role/);
  assert.match(tvSessionSource, /PAIRING_WINDOW_MS = 10 \* 60 \* 1000/);
  assert.match(tvSessionSource, /SESSION_WINDOW_MS = 4 \* 60 \* 60 \* 1000/);
});

test("receiver token is random and persisted only as a SHA-256 hash", () => {
  assert.match(tvSessionSource, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(tvSessionSource, /createHash\("sha256"\)\.update\(token\)\.digest\("hex"\)/);
  assert.match(tvSessionSource, /p_receiver_token_hash: hashReceiverToken\(receiverToken\)/);
  assert.doesNotMatch(migrationSource, /^\s*receiver_token\s+text/m);
  assert.match(receiverRouteSource, /Authorization/);
  assert.match(receiverRouteSource, /getBearerToken\(request\)/);
});

test("student session APIs require authentication, ownership and lesson access", () => {
  assert.match(createSessionRouteSource, /requireApiUser/);
  assert.match(tvSessionSource, /requireLessonAccess\(\{ contentId, lessonId, userId \}\)/);
  assert.match(ownerSessionRouteSource, /requireApiUser/);
  assert.match(ownerSessionRouteSource, /getOwnerTvSession\(sessionId, auth\.user\.id\)/);
  assert.match(commandRouteSource, /requireApiUser/);
  assert.match(commandRouteSource, /sendTvCommand\(sessionId, auth\.user\.id, command\)/);
  assert.match(tvSessionSource, /\.eq\("user_id", userId\)/);
  assert.match(tvSessionSource, /p_user_id: userId/);
});

test("all TV APIs disable caching and the public receiver still requires its bearer token", () => {
  for (const routeSource of [
    createSessionRouteSource,
    ownerSessionRouteSource,
    commandRouteSource,
    connectRouteSource,
    receiverRouteSource,
    receiverCaptionsRouteSource,
    receiverStreamsRouteSource
  ]) {
    assert.match(routeSource, /Cache-Control", "private, no-store, max-age=0"/);
  }

  assert.doesNotMatch(connectRouteSource, /requireApiUser/);
  assert.doesNotMatch(receiverRouteSource, /requireApiUser/);
  assert.match(receiverRouteSource, /Bearer\\s\+\(\.\+\)/);
  assert.match(tvSessionSource, /\.eq\("receiver_token_hash", hashReceiverToken\(receiverToken\)\)/);
});

test("TV commands are persisted with monotonic revisions and explicit validation", () => {
  assert.match(migrationSource, /command_revision = command_revision \+ 1/);
  assert.match(migrationSource, /receiver_command_revision bigint not null default 0/);
  assert.match(commandRouteSource, /type === "play" \|\| type === "pause"/);
  assert.match(commandRouteSource, /type === "set_playback_rate"/);
  assert.match(commandRouteSource, /isTvPlaybackRate\(payload\.playbackRate\)/);
  assert.match(tvContractSource, /TV_PLAYBACK_RATES = \[0\.25, 0\.5, 0\.75, 1, 1\.25, 1\.5, 1\.75, 2\]/);
  assert.match(commandRouteSource, /payload\.seconds === -10 \|\| payload\.seconds === 10/);
  assert.match(commandRouteSource, /type === "sync_player"/);
  assert.match(commandRouteSource, /payload\.quality === "auto"/);
  assert.match(commandRouteSource, /payload\.volume >= 0/);
  assert.match(receiverExperienceSource, /session\.commandRevision <= appliedCommandRevisionRef\.current/);
  assert.match(receiverExperienceSource, /player\.playVideo\(\)/);
  assert.match(receiverExperienceSource, /player\.pauseVideo\(\)/);
  assert.match(receiverExperienceSource, /player\.seekTo/);
});

test("TV persists the effective playback rate reported by the receiver", () => {
  assert.match(playbackRateMigrationSource, /add column if not exists playback_rate numeric\(4,2\) not null default 1/);
  assert.match(playbackRateMigrationSource, /add column if not exists available_playback_rates numeric\(4,2\)\[\]/);
  assert.match(playbackRateMigrationSource, /tv_sessions_playback_rate_check/);
  assert.match(tvSessionSource, /availablePlaybackRates: number\[\]/);
  assert.match(tvSessionSource, /playbackRate: number/);
  assert.match(tvSessionSource, /available_playback_rates: safeAvailablePlaybackRates/);
  assert.match(tvSessionSource, /playback_rate: safePlaybackRate/);
  assert.match(receiverRouteSource, /payload\.availablePlaybackRates\.every\(isTvPlaybackRate\)/);
  assert.match(receiverRouteSource, /playbackRate: payload\.playbackRate/);
});

test("remote commands use a fast non-overlapping receiver poll and optimistic modal feedback", () => {
  assert.match(receiverExperienceSource, /receiverCommandPollDelayMs = 250/);
  assert.match(receiverExperienceSource, /nextPollTimeout = window\.setTimeout\(\(\) => void poll\(\), receiverCommandPollDelayMs\)/);
  assert.doesNotMatch(receiverExperienceSource, /setInterval\(\(\) => void poll\(\), 1000\)/);
  assert.match(lessonTvControlSource, /optimisticPlaybackState/);
  assert.match(lessonTvControlSource, /setSession\(\{ \.\.\.targetSession, playbackState: optimisticPlaybackState \}\)/);
});

test("TV remote changes speed with confirmed receiver feedback", () => {
  assert.match(lessonTvControlSource, /Velocidade de reprodução na TV/);
  assert.match(lessonTvControlSource, /type: "set_playback_rate"/);
  assert.match(lessonTvControlSource, /pendingPlaybackRate/);
  assert.match(lessonTvControlSource, /nextSession\.receiverCommandRevision >= pendingRate\.commandRevision/);
  assert.match(lessonTvControlSource, /nextSession\.playbackRate/);
  assert.match(lessonExperienceSource, /onPlaybackRateConfirmed=\{handleTvPlaybackRateConfirmed\}/);
  assert.match(receiverExperienceSource, /onPlaybackRateChange/);
  assert.match(receiverExperienceSource, /getAvailablePlaybackRates/);
  assert.match(receiverExperienceSource, /getPlaybackRate/);
  assert.match(receiverExperienceSource, /capturePlayerPlaybackRate/);
  assert.match(receiverExperienceSource, /availablePlaybackRates: playbackMetrics\.availablePlaybackRates/);
});

test("opening or reconnecting the TV synchronizes the complete lesson player state", () => {
  assert.match(lessonTvControlSource, /type: "sync_player"/);
  assert.match(lessonTvControlSource, /captionsEnabled/);
  assert.match(lessonTvControlSource, /currentTimeSeconds/);
  assert.match(lessonTvControlSource, /playbackRate/);
  assert.match(lessonTvControlSource, /quality/);
  assert.match(lessonTvControlSource, /volume/);
  assert.match(lessonTvControlSource, /if \(session\.status === "connected"\)/);
  assert.match(lessonTvControlSource, /onConnected\?\.\(\);\s*void sendCommand\(\{ \.\.\.syncState, type: "sync_player" \}/);
  assert.match(lessonExperienceSource, /quality=\{effectiveYouTubeSelectedQuality\}/);
  assert.match(lessonExperienceSource, /volume=\{youTubeControlState\.volume\}/);
});

test("receiver heartbeat persists real TV progress in lesson_progress", () => {
  assert.match(receiverRouteSource, /updateTvReceiverState/);
  assert.match(tvSessionSource, /receiver_last_seen_at: now/);
  assert.match(tvSessionSource, /await replaceCompletedLessons\(\{/);
  assert.match(tvSessionSource, /contentId: row\.content_id/);
  assert.match(tvSessionSource, /lessonId: row\.lesson_id/);
  assert.match(tvSessionSource, /userId: row\.user_id/);
  assert.match(tvSessionSource, /playbackState === "ended"/);
});

test("lesson action opens an elegant pairing and remote-control flow", () => {
  assert.match(lessonExperienceSource, /<LessonTvControl/);
  assert.match(lessonTvControlSource, /aria-label="Assistir na TV"/);
  assert.match(lessonTvControlSource, /Assistir na TV/);
  assert.match(lessonTvControlSource, /<QRCodeSVG/);
  assert.match(lessonTvControlSource, /value=\{tvUrl\}/);
  assert.match(lessonTvControlSource, /Codigo de conexao/);
  assert.match(lessonTvControlSource, /Retroceder 10 segundos/);
  assert.match(lessonTvControlSource, /Avancar 10 segundos/);
  assert.match(lessonTvControlSource, /Encerrar na TV/);
  assert.doesNotMatch(lessonTvControlSource, /youtu\.be|youtube\.com|youtube-nocookie/);
});

test("public TV page has explicit connection, playback, recovery and ended states", () => {
  assert.match(tvPageSource, /robots: \{ follow: false, index: false \}/);
  assert.match(receiverExperienceSource, /Digite o codigo de seis caracteres/);
  assert.match(receiverExperienceSource, /Conectar esta TV/);
  assert.match(receiverExperienceSource, /Conectado ao controle remoto/);
  assert.match(receiverExperienceSource, /Reconectando ao controle/);
  assert.match(receiverExperienceSource, /Sessao encerrada/);
  assert.match(receiverExperienceSource, /window\.sessionStorage\.setItem/);
  assert.match(receiverExperienceSource, /includeLesson=1/);
  assert.match(receiverExperienceSource, /https:\/\/www\.youtube-nocookie\.com\/embed/);
  assert.doesNotMatch(receiverExperienceSource, /mock|fixture|fake/i);
});

test("student-facing TV messages never reveal the video provider", () => {
  assert.match(receiverExperienceSource, /Não foi possível reproduzir esta aula na TV\./);
  assert.match(receiverExperienceSource, /Não foi possível carregar o player desta aula\./);
  assert.match(tvSessionSource, /O Modo TV não está disponível para esta aula\./);
  assert.doesNotMatch(receiverExperienceSource, /(?:setError|new Error)\("[^"]*YouTube/);
  assert.doesNotMatch(tvSessionSource, /new TvSessionError\("[^"]*YouTube/);
});

test("TV receiver keeps the lesson poster over YouTube until playback really starts", () => {
  assert.match(receiverExperienceSource, /const \[hasPlaybackStarted, setHasPlaybackStarted\] = useState\(false\)/);
  assert.match(receiverExperienceSource, /if \(nextState === "playing"\) \{[\s\S]*?setHasPlaybackStarted\(true\)/);
  assert.match(receiverExperienceSource, /!playerReady \|\| !hasPlaybackStarted/);
  assert.match(receiverExperienceSource, /backgroundImage: `linear-gradient\([^`]+url\(\$\{posterUrl\}\)`/);
});

test("TV receiver crops and disables the native YouTube chrome", () => {
  assert.match(receiverExperienceSource, /data-tv-youtube-receiver/);
  assert.match(receiverExperienceSource, /pointer-events-none absolute left-1\/2 top-0 h-full w-\[300%\]/);
  assert.match(receiverExperienceSource, /sandbox="allow-same-origin allow-scripts allow-presentation"/);
  assert.match(receiverExperienceSource, /tabIndex=\{-1\}/);
  assert.doesNotMatch(receiverExperienceSource, /allow="autoplay; encrypted-media; picture-in-picture"/);
});

test("TV receiver offers local fullscreen without relying on a remote browser command", () => {
  assert.match(receiverExperienceSource, /data-tv-player-controls/);
  assert.match(receiverExperienceSource, /absolute inset-x-0 bottom-0/);
  assert.match(receiverExperienceSource, /receiverControlsHideDelayMs = 2_400/);
  assert.match(receiverExperienceSource, /controlsVisible \? "opacity-100" : "opacity-0"/);
  assert.match(receiverExperienceSource, /onPointerMove=\{revealControlsTemporarily\}/);
  assert.match(receiverExperienceSource, /onPointerLeave=\{hideControls\}/);
  assert.match(receiverExperienceSource, /data-tv-fullscreen-control/);
  assert.match(receiverExperienceSource, /<Maximize className="h-5 w-5"/);
  assert.doesNotMatch(receiverExperienceSource, /<span>\{isFullscreen \? "Sair da tela cheia" : "Tela cheia"\}<\/span>/);
  assert.match(receiverExperienceSource, /playerFrame\.requestFullscreen\(\)/);
  assert.match(receiverExperienceSource, /document\.exitFullscreen\(\)/);
  assert.match(receiverExperienceSource, /Sair da tela cheia/);
  assert.match(receiverExperienceSource, /Tela cheia/);
  assert.doesNotMatch(commandRouteSource, /type === "fullscreen"/);
});

test("TV receiver disables native captions and renders the platform caption track", () => {
  assert.match(receiverExperienceSource, /cc_load_policy: "0"/);
  assert.match(receiverExperienceSource, /unloadModule\?\.\("captions"\)/);
  assert.match(receiverExperienceSource, /\/captions\?language=pt/);
  assert.match(receiverExperienceSource, /data-tv-custom-caption/);
  assert.match(receiverCaptionsRouteSource, /getTvReceiverSession\(sessionId, getBearerToken\(request\), true\)/);
  assert.match(receiverCaptionsRouteSource, /fetchYouTubeCaptions/);
});

test("TV captions choose the newest overlapping cue and follow audible manual audio", () => {
  const cues = [
    { durationSeconds: 4, startSeconds: 10, text: "frase antiga" },
    { durationSeconds: 3, startSeconds: 12, text: "frase atual" },
    { durationSeconds: 1, startSeconds: 20, text: "depois da lacuna" }
  ];

  assert.equal(findActiveCaptionCue(cues, 9.8), null);
  assert.equal(findActiveCaptionCue(cues, 10)?.text, "frase antiga");
  assert.equal(findActiveCaptionCue(cues, 12.5)?.text, "frase atual");
  assert.equal(findActiveCaptionCue(cues, 16), null);
  assert.equal(findActiveCaptionCue(cues, 20)?.text, "depois da lacuna");
  assert.match(captionTimingSource, /activeCueIndex = middle/);
  assert.match(lessonExperienceSource, /findActiveCaptionCue\(youTubeCaptionCues, youTubeCurrentTime\)/);
  assert.match(receiverExperienceSource, /findActiveCaptionCue\(captionCues, captionTime\)/);
  assert.match(receiverExperienceSource, /captionRefreshIntervalMs = 50/);
  assert.match(receiverExperienceSource, /player\.getCaptionTime\?\.\(\) \?\? player\.getCurrentTime\(\)/);
  assert.match(manualPlayerSource, /getCaptionTime: \(\) => audioRef\.current\?\.currentTime \?\? videoRef\.current\?\.currentTime \?\? 0/);
});

test("manual quality selected in the lesson is reproduced through protected TV streams", () => {
  assert.match(receiverExperienceSource, /\/streams/);
  assert.match(receiverExperienceSource, /<YouTubeManualStreamPlayer/);
  assert.match(receiverExperienceSource, /selectedQuality === "auto"/);
  assert.match(receiverStreamsRouteSource, /getTvReceiverSession\(sessionId, getBearerToken\(request\), true\)/);
  assert.match(receiverStreamsRouteSource, /fetchYouTubeStreams/);
  assert.match(tvSessionSource, /await requireLessonAccess\(\{/);
});

test("TV session lifecycle emits auditable student events", () => {
  for (const eventType of [
    "lesson_tv_session_created",
    "lesson_tv_connected",
    "lesson_tv_command_sent",
    "lesson_tv_session_ended"
  ]) {
    assert.match(migrationSource, new RegExp(eventType));
  }
  assert.match(migrationSource, /insert into public\.student_events/);
});
