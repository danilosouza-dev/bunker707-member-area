"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClosedCaption,
  Download,
  FileText,
  Flag,
  GalleryVerticalEnd,
  Gauge,
  GraduationCap,
  Heart,
  LockKeyhole,
  Maximize,
  MessageCircle,
  Minimize,
  MonitorPlay,
  MoreHorizontal,
  PanelRightClose,
  Pause,
  Play,
  Reply,
  RotateCcw,
  RotateCw,
  Send,
  Settings,
  SlidersHorizontal,
  SmilePlus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import { SavedItemButton } from "@/components/saved-item-button";
import { LessonAiTutor } from "@/components/lesson-ai-tutor";
import { useNavigationFeedback, useNavigationFeedbackRouter } from "@/components/navigation-feedback";
import { LessonTvControl } from "@/components/lesson-tv-control";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import {
  YouTubeManualStreamPlayer,
  type YouTubeManualPlayerController
} from "@/components/youtube-manual-stream-player";
import { withAccessPreviewParam } from "@/lib/access-preview";
import { shouldBlockLessonPageKeyboardShortcut } from "@/lib/lesson-page-deterrence";
import { findActiveCaptionCue } from "@/lib/media-captions";
import {
  consumePendingTutorSeek,
  queuePendingTutorSeek,
  type PendingTutorSeek
} from "@/lib/tutor-seek-intent";
import type { KeyboardEvent } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import type {
  ContentItem,
  CourseModule,
  LessonCommentReaction,
  LessonCommentRecord,
  LessonCommentStatus,
  LessonPreview,
  LessonReaction,
  LessonVideoConfig,
  LessonWatchState,
  LessonWatchStatus
} from "@/lib/platform-types";
import { getReleaseRuleNotice } from "@/lib/release-rules";

type LessonExperienceProps = {
  accessPreviewMode?: AccessPreviewMode;
  allModules: CourseModule[];
  initialLessonId?: string;
  initialLessonReactions?: Partial<Record<string, LessonReaction>>;
  initialLessonWatchStates?: Record<string, LessonWatchState>;
  item: ContentItem;
  currentUserId: string;
  currentUserName: string;
  returnContent?: Pick<ContentItem, "id" | "title">;
  selectedModule: CourseModule;
};

type LessonTab = "aiTutor" | "comments" | "materials";
type CommentReaction = LessonCommentReaction;
type YouTubeSettingsMenuView = "playbackRate" | "quality" | "root";

function TutorAiIcon({ className = "", strokeWidth = 1.9 }: { className?: string; strokeWidth?: number }) {
  return (
    <span aria-hidden="true" className={`relative inline-grid shrink-0 place-items-center ${className}`}>
      <GraduationCap className="h-full w-full" strokeWidth={strokeWidth} />
      <Sparkles
        className="absolute -right-1 -top-1 h-2.5 w-2.5 text-[var(--accent)]"
        strokeWidth={2.2}
      />
    </span>
  );
}

type CommentAvatarData = {
  backgroundClassName: string;
  imageSrc?: string;
  label: string;
  labelClassName?: string;
  online?: boolean;
};

type LessonCommentBase = {
  author: string;
  avatar: CommentAvatarData;
  body: string;
  id: string;
  isOwn: boolean;
  role?: string;
  reactions: Partial<Record<CommentReaction, number>>;
  status: LessonCommentStatus;
  time: string;
  username: string;
};

type LessonCommentReply = LessonCommentBase & {
  parentId: string;
};

type LessonComment = LessonCommentBase & {
  replies?: LessonCommentReply[];
};

type ReplyTarget = {
  author: string;
  parentCommentId: string;
  username: string;
};

type LessonTarget = {
  lesson: LessonPreview;
  module: CourseModule;
};

type LessonProgressPayload = {
  completedLessonIds?: string[];
  contentId: string;
  durationSeconds?: number;
  lessonId?: string;
  lessonReactions?: Partial<Record<string, LessonReaction>>;
  maxProgressPercent?: number;
  progressPercent?: number;
  progressSeconds?: number;
  status?: LessonWatchStatus;
};

type PlayerRenderConfig =
  | {
      kind: "iframe";
      src: string;
    }
  | {
      kind: "srcdoc";
      srcDoc: string;
    }
  | {
      kind: "video";
      src: string;
    };

type YouTubePlayer = {
  destroy?: () => void;
  getAvailablePlaybackRates?: () => number[];
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlaybackRate?: () => number;
  getPlayerState?: () => number;
  getVolume?: () => number;
  isMuted?: () => boolean;
  mute?: () => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate?: (playbackRate: number) => void;
  setVolume?: (volume: number) => void;
  unloadModule?: (moduleName: string) => void;
  unMute?: () => void;
};

type ReadyYouTubePlayer = {
  lessonId: string;
  player: YouTubePlayer;
};

type YouTubePlaybackState = "buffering" | "ended" | "error" | "paused" | "playing" | "unstarted";

type YouTubeControlState = {
  availablePlaybackRates: number[];
  automaticQuality: string | null;
  currentTime: number;
  duration: number;
  errorCode: number | null;
  isMuted: boolean;
  isReady: boolean;
  playbackRate: number;
  playbackState: YouTubePlaybackState;
  volume: number;
};

type YouTubePlayerEvent = {
  target: YouTubePlayer;
};

type YouTubePlayerStateChangeEvent = YouTubePlayerEvent & {
  data: number;
};

type YouTubePlayerErrorEvent = YouTubePlayerEvent & {
  data: number;
};

type YouTubePlayerQualityChangeEvent = YouTubePlayerEvent & {
  data: string;
};

type YouTubePlayerRateChangeEvent = YouTubePlayerEvent & {
  data: number;
};

type YouTubeCaptionCue = {
  durationSeconds: number;
  startSeconds: number;
  text: string;
};

type YouTubeCaptionsResponse = {
  cues?: YouTubeCaptionCue[];
  error?: string;
  tracks?: Array<{
    isAutoGenerated: boolean;
    languageCode: string;
    name: string;
  }>;
};

type YouTubeCaptionResult = {
  cues: YouTubeCaptionCue[];
  status: "ready" | "unavailable";
  videoId: string;
};

type YouTubeVideoStream = {
  bitrate: number;
  height: number;
  itag: number;
  label: string;
  mimeType: string;
  url: string;
  width: number;
};

type YouTubeAudioStream = {
  bitrate: number;
  itag: number;
  mimeType: string;
  url: string;
};

type YouTubeStreamsResponse = {
  audio?: YouTubeAudioStream;
  error?: string;
  expiresAt?: string;
  qualities?: YouTubeVideoStream[];
};

type YouTubeStreamsResult = {
  audio: YouTubeAudioStream | null;
  expiresAt: string;
  qualities: YouTubeVideoStream[];
  status: "error" | "loading" | "ready" | "unavailable";
  videoId: string;
};

type YouTubeNamespace = {
  Player: new (
    iframe: HTMLIFrameElement,
    options: {
      events: {
        onAutoplayBlocked?: () => void;
        onError?: (event: YouTubePlayerErrorEvent) => void;
        onPlaybackQualityChange?: (event: YouTubePlayerQualityChangeEvent) => void;
        onPlaybackRateChange?: (event: YouTubePlayerRateChangeEvent) => void;
        onReady?: (event: YouTubePlayerEvent) => void;
        onStateChange?: (event: YouTubePlayerStateChangeEvent) => void;
      };
    }
  ) => YouTubePlayer;
  PlayerState: {
    BUFFERING: number;
    ENDED: number;
    PAUSED: number;
    PLAYING: number;
  };
};

declare global {
  interface Window {
    __bunker707FlushLessonProgress?: () => Promise<void>;
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeIframeApiPromise: Promise<void> | null = null;
const manualYouTubePlaybackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const initialYouTubeControlState: YouTubeControlState = {
  availablePlaybackRates: [1],
  automaticQuality: null,
  currentTime: 0,
  duration: 0,
  errorCode: null,
  isMuted: false,
  isReady: false,
  playbackRate: 1,
  playbackState: "unstarted",
  volume: 100
};

const initialYouTubeStreamsResult: YouTubeStreamsResult = {
  audio: null,
  expiresAt: "",
  qualities: [],
  status: "unavailable",
  videoId: ""
};

const lessonMaterials = [
  {
    id: "prompt-pack",
    title: "Prompt base da aula",
    meta: "PDF"
  },
  {
    id: "visual-checklist",
    title: "Checklist de qualidade visual",
    meta: "Planilha"
  },
  {
    id: "workflow-map",
    title: "Mapa do workflow",
    meta: "Arquivo"
  },
  {
    id: "ai-brief",
    title: "Resumo estrategico da aula",
    meta: "Infografico IA",
    requiresRating: true
  }
];

const commentReactionOptions = [
  {
    emoji: "👍",
    id: "like",
    label: "Curtir"
  },
  {
    emoji: "🔥",
    id: "fire",
    label: "Boa ideia"
  },
  {
    emoji: "💡",
    id: "insight",
    label: "Insight"
  },
  {
    emoji: "❤️",
    id: "love",
    label: "Amei"
  },
  {
    emoji: "👏",
    id: "clap",
    label: "Aplausos"
  },
  {
    emoji: "😂",
    id: "laugh",
    label: "Engracado"
  },
  {
    emoji: "😮",
    id: "wow",
    label: "Uau"
  },
  {
    emoji: "🚀",
    id: "rocket",
    label: "Bora"
  },
  {
    emoji: "👀",
    id: "eyes",
    label: "De olho"
  },
  {
    emoji: "✅",
    id: "check",
    label: "Util"
  }
] satisfies Array<{
  emoji: string;
  id: CommentReaction;
  label: string;
}>;

const lessonIconButtonClassName =
  "group/action relative grid h-11 w-11 place-items-center rounded-full border border-white/40 bg-[#232323]/90 text-white shadow-xl shadow-black/30 backdrop-blur transition duration-150 hover:border-white/90 hover:bg-[#3a3a3a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95 sm:h-12 sm:w-12";

const lessonReactionOptions = [
  {
    icon: ThumbsDown,
    id: "not-for-me",
    label: "Nao gostei",
    selectedIconClassName: "text-red-500"
  },
  {
    icon: ThumbsUp,
    id: "liked",
    label: "Gostei",
    selectedIconClassName: "text-emerald-500"
  },
  {
    icon: Heart,
    id: "loved",
    label: "Amei",
    selectedIconClassName: "text-[var(--accent)]"
  }
] satisfies Array<{
  icon: ComponentType<{ className?: string }>;
  id: LessonReaction;
  label: string;
  selectedIconClassName: string;
}>;

function getInitialCompletedLessonIds(modules: CourseModule[]) {
  return modules.flatMap((courseModule) => (
    courseModule.lessons
      .filter((lesson) => lesson.completed)
      .map((lesson) => lesson.id)
  ));
}

function getFirstPlayableLessonId(courseModule: CourseModule, completedLessonIds: Set<string>) {
  return courseModule.lessons.find((lesson) => (
    !completedLessonIds.has(lesson.id) &&
    !getReleaseRuleNotice(lesson.releaseRule, "aula")?.isLocked &&
    !getReleaseRuleNotice(courseModule.releaseRule, "modulo")?.isLocked
  ))?.id ?? courseModule.lessons[0]?.id ?? "";
}

function getLessonTarget(modules: CourseModule[], lessonId: string): LessonTarget | null {
  for (const courseModule of modules) {
    const lesson = courseModule.lessons.find((moduleLesson) => moduleLesson.id === lessonId);

    if (lesson) {
      return { lesson, module: courseModule };
    }
  }

  return null;
}

function EmptyLessonState({
  accessPreviewMode,
  item,
  returnContent,
  selectedModule
}: Pick<LessonExperienceProps, "accessPreviewMode" | "item" | "returnContent" | "selectedModule">) {
  const returnHref = withAccessPreviewParam(`/conteudo/${returnContent?.id ?? item.id}`, accessPreviewMode);
  const returnLabel = returnContent?.title ?? item.title;

  return (
    <section className="relative mt-6">
      <nav aria-label="Breadcrumb" className="mb-4 flex min-h-10 flex-wrap items-center gap-2 text-xs font-semibold text-zinc-500 sm:text-sm">
        <Link className="transition hover:text-white" href={withAccessPreviewParam("/", accessPreviewMode)}>
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link className="transition hover:text-white" href={returnHref}>
          {returnLabel}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        {returnContent ? (
          <>
            <span className="text-zinc-300">{item.title}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </>
        ) : null}
        <span className="text-zinc-300">{selectedModule.title}</span>
      </nav>

      <div className="grid min-h-[62vh] place-items-center rounded-[8px] border border-white/10 bg-[#181818] p-6 text-center shadow-2xl shadow-black/35">
        <div className="max-w-xl">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/12 bg-black/35 text-zinc-200 shadow-xl shadow-black/30">
            <MonitorPlay className="h-7 w-7 stroke-[2.4]" />
          </span>
          <p className="mt-5 text-2xl font-black leading-tight text-white sm:text-3xl">
            Aulas em preparação
          </p>
          <p className="mt-3 text-sm font-semibold leading-6 text-zinc-400 sm:text-base sm:leading-7">
            Este modulo ainda nao tem aulas publicadas. Assim que a primeira aula for cadastrada, ela aparece aqui automaticamente.
          </p>
          <Link
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-white px-5 py-2.5 text-sm font-extrabold text-black shadow-xl shadow-black/25 transition hover:bg-zinc-200"
            href={returnHref}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para {returnLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

function extractYouTubeId(value?: string) {
  if (!value) {
    return "";
  }

  const trimmedValue = value.trim();

  if (/^[\w-]{11}$/.test(trimmedValue)) {
    return trimmedValue;
  }

  try {
    const url = new URL(trimmedValue);

    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace("/", "");
    }

    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v") ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
    }
  } catch {
    return trimmedValue;
  }

  return "";
}

function getYouTubeThumbnailUrl(video?: LessonVideoConfig) {
  if (video?.provider !== "youtube") {
    return "";
  }

  const videoId = video.assetId || extractYouTubeId(video.url);

  return videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : "";
}

function isYouTubeEmbedUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname.endsWith(".youtube-nocookie.com");
  } catch {
    return false;
  }
}

function extractVimeoId(value?: string) {
  if (!value) {
    return "";
  }

  const trimmedValue = value.trim();

  if (/^\d+$/.test(trimmedValue)) {
    return trimmedValue;
  }

  try {
    const url = new URL(trimmedValue);
    return url.pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return trimmedValue;
  }
}

function getPlayerRenderConfig(video?: LessonVideoConfig): PlayerRenderConfig | null {
  if (!video) {
    return null;
  }

  if (video.provider === "embed_code" && video.embedCode) {
    return {
      kind: "srcdoc",
      srcDoc: video.embedCode
    };
  }

  if (video.provider === "youtube") {
    const videoId = video.assetId || extractYouTubeId(video.url);

    return videoId
      ? {
          kind: "iframe",
          src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&rel=0`
        }
      : null;
  }

  if (video.provider === "vimeo") {
    const videoId = video.assetId || extractVimeoId(video.url);

    return videoId
      ? {
          kind: "iframe",
          src: `https://player.vimeo.com/video/${videoId}`
        }
      : null;
  }

  if (video.provider === "custom_url" && video.url) {
    return {
      kind: "video",
      src: video.url
    };
  }

  if (video.url) {
    return {
      kind: "iframe",
      src: video.url
    };
  }

  return null;
}

function getUrlWithPlaybackParams(
  src: string,
  {
    autoplay = false,
    startSeconds
  }: {
    autoplay?: boolean;
    startSeconds?: number;
  } = {}
) {
  try {
    const url = new URL(src);

    if (isYouTubeEmbedUrl(src)) {
      url.searchParams.set("enablejsapi", "1");
      url.searchParams.set("autoplay", autoplay ? "1" : "0");

      if (typeof window !== "undefined" && window.location.origin) {
        url.searchParams.set("origin", window.location.origin);
      }
    } else if (autoplay) {
      url.searchParams.set("autoplay", "1");
    }

    if (isYouTubeEmbedUrl(src)) {
      if (startSeconds && startSeconds > 0) {
        url.searchParams.set("start", String(Math.max(0, Math.floor(startSeconds))));
      } else {
        url.searchParams.delete("start");
      }
    }

    return url.toString();
  } catch {
    return autoplay
      ? src.includes("?") ? `${src}&autoplay=1` : `${src}?autoplay=1`
      : src;
  }
}

function loadYouTubeIframeApi() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (youTubeIframeApiPromise) {
    return youTubeIframeApiPromise;
  }

  youTubeIframeApiPromise = new Promise((resolve) => {
    const previousReadyHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();
      resolve();
    };

    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });

  return youTubeIframeApiPromise;
}

function readYouTubeMetric(readMetric: () => number) {
  try {
    const value = readMetric();
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function getCurrentTimestamp() {
  return Date.now();
}

function formatPlaybackTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatPlaybackRate(playbackRate: number) {
  return `${String(playbackRate).replace(".", ",")}x`;
}

function getPlaybackRateMenuLabel(playbackRate: number) {
  return playbackRate === 1 ? "Normal" : formatPlaybackRate(playbackRate);
}

function readYouTubePlaybackRates(player: YouTubePlayer) {
  try {
    const playbackRates = player.getAvailablePlaybackRates?.() ?? [1];
    const normalizedRates = [...new Set(playbackRates)]
      .filter((playbackRate) => Number.isFinite(playbackRate) && playbackRate > 0)
      .sort((firstRate, secondRate) => firstRate - secondRate);

    return normalizedRates.length > 0 ? normalizedRates : [1];
  } catch {
    return [1];
  }
}

function normalizeYouTubePlaybackQuality(quality: string) {
  const normalizedQuality = quality.trim().toLowerCase();
  const legacyQualityLabels: Record<string, string> = {
    hd1080: "1080p",
    hd1440: "1440p",
    hd2160: "2160p",
    hd2880: "2880p",
    hd4320: "4320p",
    hd720: "720p",
    large: "480p",
    medium: "360p",
    small: "240p",
    tiny: "144p"
  };

  if (legacyQualityLabels[normalizedQuality]) {
    return legacyQualityLabels[normalizedQuality];
  }

  if (normalizedQuality === "highres") {
    return "highres";
  }

  const exactHeight = normalizedQuality.match(/^(?:hd)?(\d{3,4})p?$/)?.[1];
  return exactHeight ? `${exactHeight}p` : null;
}

function getYouTubeQualityDisplayName(quality: string) {
  return quality === "highres" ? "alta resolucao" : quality;
}

function getYouTubeQualityBadge(quality: string) {
  if (quality === "auto") {
    return "AUTO";
  }

  if (quality === "highres") {
    return "HD+";
  }

  const height = Number.parseInt(quality, 10);

  if (height >= 4320) return "8K";
  if (height >= 2880) return "5K";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "2K";
  if (height >= 720) return "HD";

  return Number.isFinite(height) ? String(height) : quality.toUpperCase();
}

function getYouTubePlaybackState(playerState: number | undefined): YouTubePlaybackState | undefined {
  if (playerState === -1) return "unstarted";
  if (playerState === 0) return "ended";
  if (playerState === 1) return "playing";
  if (playerState === 2 || playerState === 5) return "paused";
  if (playerState === 3) return "buffering";

  return undefined;
}

function getYouTubePlayerErrorMessage(errorCode: number | null) {
  if (errorCode === 2) {
    return "O endereco deste video e invalido.";
  }

  if (errorCode === 5) {
    return "O navegador nao conseguiu reproduzir este video.";
  }

  if (errorCode === 100) {
    return "Este video foi removido ou esta privado.";
  }

  if (errorCode === 101 || errorCode === 150) {
    return "Este video nao permite reproducao incorporada.";
  }

  if (errorCode === 153) {
    return "A origem desta pagina nao foi aceita pelo provedor do video.";
  }

  return "Nao foi possivel reproduzir este video.";
}

function parseLessonDurationSeconds(duration: string) {
  const trimmedDuration = duration.trim().toLowerCase();
  const clockParts = trimmedDuration.split(":").map((part) => Number(part));

  if (clockParts.length > 1 && clockParts.every((part) => Number.isFinite(part))) {
    return clockParts.reduce((total, part) => (total * 60) + part, 0);
  }

  const hourMatch = trimmedDuration.match(/(\d+(?:[.,]\d+)?)\s*(h|hora|horas)/);
  const minuteMatch = trimmedDuration.match(/(\d+(?:[.,]\d+)?)\s*(m|min|minuto|minutos)/);
  const secondMatch = trimmedDuration.match(/(\d+(?:[.,]\d+)?)\s*(s|seg|segundo|segundos)/);
  const hours = hourMatch ? Number(hourMatch[1].replace(",", ".")) : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1].replace(",", ".")) : 0;
  const seconds = secondMatch ? Number(secondMatch[1].replace(",", ".")) : 0;
  const total = (hours * 3600) + (minutes * 60) + seconds;

  return Number.isFinite(total) && total > 0 ? Math.round(total) : undefined;
}

function clampProgressPercent(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function ActionTooltip({
  elevated = false,
  label
}: {
  elevated?: boolean;
  label: string;
}) {
  return (
    <span className={`pointer-events-none absolute left-1/2 z-[80] -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-[4px] bg-[#e6e6e6] px-4 py-2 text-[13px] font-medium text-[#1f1f1f] opacity-0 shadow-xl shadow-black/35 transition duration-150 group-hover/action:translate-y-0 group-hover/action:opacity-100 group-focus-visible/action:translate-y-0 group-focus-visible/action:opacity-100 max-sm:hidden ${
      elevated ? "bottom-[calc(100%+28px)]" : "bottom-[calc(100%+12px)]"
    }`}>
      {label}
      <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-l-[7px] border-r-[7px] border-t-[8px] border-l-transparent border-r-transparent border-t-[#e6e6e6]" />
    </span>
  );
}

function ReactionTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute bottom-[calc(100%+11px)] left-1/2 z-40 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-[4px] bg-[#e6e6e6] px-4 py-2 text-[13px] font-medium text-[#1f1f1f] opacity-0 shadow-xl shadow-black/35 transition duration-150 group-hover/reaction-option:translate-y-0 group-hover/reaction-option:opacity-100 group-focus-visible/reaction-option:translate-y-0 group-focus-visible/reaction-option:opacity-100 max-sm:hidden">
      {label}
      <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-l-[7px] border-r-[7px] border-t-[8px] border-l-transparent border-r-transparent border-t-[#e6e6e6]" />
    </span>
  );
}

function CommentAvatar({
  avatar,
  size = "md"
}: {
  avatar: CommentAvatarData;
  size?: "md" | "lg";
}) {
  const sizeClassName = size === "lg" ? "h-12 w-12" : "h-11 w-11";
  const statusSizeClassName = size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]";
  const statusInnerSizeClassName = size === "lg" ? "h-2 w-2" : "h-1.5 w-1.5";
  const labelClassName = avatar.labelClassName ?? (size === "lg" ? "text-base" : "text-sm");
  const isOnline = avatar.online === true;

  return (
    <span className={`relative shrink-0 ${sizeClassName}`}>
      <span className={`grid h-full w-full place-items-center overflow-hidden rounded-full ${avatar.backgroundClassName} font-black text-white shadow-lg shadow-black/25`}>
        {avatar.imageSrc ? (
          <span
            aria-hidden="true"
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${avatar.imageSrc})` }}
          />
        ) : (
          <span className={`leading-none ${labelClassName}`}>{avatar.label}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`absolute bottom-0 right-0 grid translate-x-[18%] translate-y-[18%] place-items-center rounded-full border-[3px] border-[var(--background)] ${
          isOnline
            ? "bg-emerald-400"
            : "bg-zinc-500"
        } ${statusSizeClassName}`}
      >
        {isOnline ? null : (
          <span className={`rounded-full bg-[var(--background)] ${statusInnerSizeClassName}`} />
        )}
      </span>
    </span>
  );
}

const commentAvatarBackgrounds = [
  "bg-red-500",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-fuchsia-600"
];

function getCommentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("") || "AL";
}

function getCommentAvatar(name: string, imageSrc?: string): CommentAvatarData {
  const colorIndex = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0) % commentAvatarBackgrounds.length;

  return {
    backgroundClassName: commentAvatarBackgrounds[colorIndex],
    imageSrc,
    label: getCommentInitials(name),
    labelClassName: "text-[15px]",
    online: false
  };
}

function formatCommentTime(value: string) {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) return "agora";

  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const relativeTime = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const absoluteDiff = Math.abs(diffSeconds);

  if (absoluteDiff < 60) return relativeTime.format(diffSeconds, "second");

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return relativeTime.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeTime.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return relativeTime.format(diffDays, "day");

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return relativeTime.format(diffMonths, "month");

  return relativeTime.format(Math.round(diffMonths / 12), "year");
}

function lessonCommentRecordToView(record: LessonCommentRecord): LessonComment {
  return {
    author: record.authorName,
    avatar: getCommentAvatar(record.authorName, record.authorAvatarUrl),
    body: record.body,
    id: record.id,
    isOwn: record.isOwn,
    reactions: record.reactions,
    replies: record.replies.map((reply) => ({
      ...lessonCommentRecordToView(reply),
      parentId: record.id
    })),
    role: record.authorRole === "student" ? undefined : "Professor",
    status: record.status,
    time: formatCommentTime(record.createdAt),
    username: record.authorUsername
  };
}

function flattenCommentRecords(records: LessonCommentRecord[]): LessonCommentRecord[] {
  return records.flatMap((record) => [record, ...flattenCommentRecords(record.replies)]);
}

function applyCommentReactionDelta(
  reactions: Partial<Record<CommentReaction, number>>,
  reactionId: CommentReaction,
  delta: 1 | -1
) {
  const next = { ...reactions };
  const nextCount = (next[reactionId] ?? 0) + delta;

  if (nextCount > 0) {
    next[reactionId] = nextCount;
  } else {
    delete next[reactionId];
  }

  return next;
}

function getTotalCommentCount(comments: LessonComment[]) {
  return comments.reduce((total, comment) => total + 1 + (comment.replies?.length ?? 0), 0);
}

function CommentBody({
  body,
  className
}: {
  body: string;
  className: string;
}) {
  const parts = body.split(/(@[a-z0-9._-]+)/gi);

  return (
    <p className={className}>
      {parts.map((part, index) => (
        part.startsWith("@") ? (
          <span className="font-bold text-zinc-100" key={`${part}-${index}`}>
            {part}
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      ))}
    </p>
  );
}

function LessonReactionControl({
  onToggle,
  value
}: {
  onToggle: (reaction: LessonReaction) => void;
  value: LessonReaction | null;
}) {
  const [isReactionMenuOpen, setIsReactionMenuOpen] = useState(false);
  const selectedReaction = lessonReactionOptions.find((option) => option.id === value);
  const TriggerIcon = selectedReaction?.icon ?? ThumbsUp;

  return (
    <div
      className="relative"
      onBlur={(event) => {
        const nextFocusedElement = event.relatedTarget;

        if (!(nextFocusedElement instanceof Node) || !event.currentTarget.contains(nextFocusedElement)) {
          setIsReactionMenuOpen(false);
        }
      }}
      onFocus={() => setIsReactionMenuOpen(true)}
      onMouseEnter={() => setIsReactionMenuOpen(true)}
      onMouseLeave={() => setIsReactionMenuOpen(false)}
    >
      <button
        aria-expanded={isReactionMenuOpen}
        aria-haspopup="true"
        aria-label={selectedReaction ? `Avaliacao: ${selectedReaction.label}` : "Avaliar aula"}
        className={`${lessonIconButtonClassName} ${
          selectedReaction ? "border-white/60 bg-[#303030]" : ""
        }`}
        onClick={() => setIsReactionMenuOpen(true)}
        type="button"
      >
        <TriggerIcon className={`h-5 w-5 stroke-[2.5] ${selectedReaction?.selectedIconClassName ?? ""}`} />
      </button>

      <div
        aria-label="Avaliar aula"
        className={`absolute bottom-[calc(100%+9px)] right-0 z-30 flex items-center gap-2 rounded-full bg-[#242424] p-2 shadow-2xl shadow-black/60 ring-1 ring-black/45 transition duration-150 ${
          isReactionMenuOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-1 opacity-0"
        }`}
        role="group"
      >
        <span className="absolute -bottom-3 left-0 h-3 w-full" />
        {lessonReactionOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = option.id === value;

          return (
            <button
              aria-label={isSelected ? `Remover avaliacao: ${option.label}` : option.label}
              aria-pressed={isSelected}
              className={`group/reaction-option relative grid h-10 w-10 place-items-center rounded-full text-white transition duration-150 hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                isSelected ? "bg-white/14" : ""
              }`}
              key={option.id}
              onClick={(event) => {
                onToggle(option.id);
                setIsReactionMenuOpen(false);
                event.currentTarget.blur();
              }}
              type="button"
            >
              <ReactionTooltip label={option.label} />
              <Icon className={`h-5 w-5 stroke-[2.6] ${isSelected ? option.selectedIconClassName : ""}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LessonExperience({
  accessPreviewMode,
  allModules,
  currentUserId,
  currentUserName,
  initialLessonId: requestedInitialLessonId,
  initialLessonReactions = {},
  initialLessonWatchStates = {},
  item,
  returnContent,
  selectedModule
}: LessonExperienceProps) {
  const router = useNavigationFeedbackRouter();
  const { startNavigation } = useNavigationFeedback();
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(
    () => new Set(getInitialCompletedLessonIds(allModules))
  );
  const allLessonIds = useMemo(() => (
    new Set(allModules.flatMap((courseModule) => (
      courseModule.lessons.map((lesson) => lesson.id)
    )))
  ), [allModules]);
  const requestedLessonId = useMemo(() => (
    requestedInitialLessonId && selectedModule.lessons.some((lesson) => lesson.id === requestedInitialLessonId)
      ? requestedInitialLessonId
      : ""
  ), [requestedInitialLessonId, selectedModule]);
  const fallbackInitialLessonId = useMemo(() => (
    getFirstPlayableLessonId(selectedModule, completedLessonIds)
  ), [completedLessonIds, selectedModule]);
  const initialActiveLessonId = requestedLessonId || fallbackInitialLessonId;
  const [activeLessonId, setActiveLessonId] = useState(initialActiveLessonId);
  const [activeEmbedResume, setActiveEmbedResume] = useState(() => ({
    lessonId: initialActiveLessonId,
    seconds: initialLessonWatchStates[initialActiveLessonId]?.progressSeconds ?? 0
  }));
  const [activeModuleId, setActiveModuleId] = useState<string | null>(selectedModule.id);
  const [activeTab, setActiveTab] = useState<LessonTab>("comments");
  const [mountedTutorLessonId, setMountedTutorLessonId] = useState("");
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState<LessonComment[]>([]);
  const [commentReactionSelections, setCommentReactionSelections] = useState<Partial<Record<string, CommentReaction>>>({});
  const [commentReactionMenuId, setCommentReactionMenuId] = useState<string | null>(null);
  const [commentMenuId, setCommentMenuId] = useState<string | null>(null);
  const [reportedCommentIds, setReportedCommentIds] = useState<Set<string>>(() => new Set());
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [commentsLessonId, setCommentsLessonId] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [lessonReactions, setLessonReactions] = useState<Partial<Record<string, LessonReaction>>>(initialLessonReactions);
  const [lessonWatchStates, setLessonWatchStates] = useState<Record<string, LessonWatchState>>(initialLessonWatchStates);
  const [startedLessonIds, setStartedLessonIds] = useState<Set<string>>(() => new Set());
  const [canRenderEmbeddedPlayer, setCanRenderEmbeddedPlayer] = useState(false);
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);
  const [youTubeControlState, setYouTubeControlState] = useState<YouTubeControlState>(initialYouTubeControlState);
  const [youTubeCaptionResult, setYouTubeCaptionResult] = useState<YouTubeCaptionResult>({
    cues: [],
    status: "unavailable",
    videoId: ""
  });
  const [youTubeCaptionsEnabled, setYouTubeCaptionsEnabled] = useState(true);
  const [youTubeSettingsMenuOpen, setYouTubeSettingsMenuOpen] = useState(false);
  const [youTubeSettingsMenuView, setYouTubeSettingsMenuView] = useState<YouTubeSettingsMenuView>("root");
  const [youTubeSelectedQuality, setYouTubeSelectedQuality] = useState("auto");
  const [youTubeStreamsResult, setYouTubeStreamsResult] = useState<YouTubeStreamsResult>(initialYouTubeStreamsResult);
  const [youTubeStreamsReloadToken, setYouTubeStreamsReloadToken] = useState(0);
  const [youTubeManualSwitch, setYouTubeManualSwitch] = useState({
    lessonId: "",
    seconds: 0,
    shouldPlay: false,
    token: 0
  });
  const [youTubeReloadToken, setYouTubeReloadToken] = useState(0);
  const [savedLessonOverrides, setSavedLessonOverrides] = useState<Record<string, boolean>>({});
  const [playlistOpen, setPlaylistOpen] = useState(true);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const lessonPlayerFrameRef = useRef<HTMLDivElement>(null);
  const lessonSupportPanelRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const youtubeIframeRef = useRef<HTMLIFrameElement>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const pendingTutorSeekRef = useRef<PendingTutorSeek | null>(null);
  const readyYouTubePlayerRef = useRef<ReadyYouTubePlayer | null>(null);
  const initialResumeSecondsRef = useRef<Record<string, number>>(
    Object.fromEntries(
      Object.entries(initialLessonWatchStates).map(([lessonId, watchState]) => [
        lessonId,
        watchState.progressSeconds
      ])
    )
  );
  const lastProgressSyncRef = useRef<Record<string, number>>({});
  const lastNonZeroYouTubeVolumeRef = useRef(100);
  const lessonWatchStatesRef = useRef(lessonWatchStates);
  const lessonSelectionRequestRef = useRef(0);
  const pendingYouTubePlayLessonIdRef = useRef<string | null>(null);
  const youTubePlaybackIntentLessonIdRef = useRef<string | null>(null);
  const youTubeAudioPreferenceRef = useRef({ isMuted: false, volume: 100 });
  const youTubePlaybackRatePreferenceRef = useRef(1);
  const youTubeSelectedQualityRef = useRef("auto");
  const lastLoadedYouTubeStreamsVideoIdRef = useRef("");
  const startedLessonIdsRef = useRef(startedLessonIds);
  const playlistScrollRef = useRef<HTMLDivElement>(null);
  const moduleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const handleTvReceiverConnected = useCallback(() => {
    pendingTutorSeekRef.current = null;
    readyYouTubePlayerRef.current = null;
    pendingYouTubePlayLessonIdRef.current = null;
    youTubePlaybackIntentLessonIdRef.current = null;
    youtubePlayerRef.current?.pauseVideo?.();
    videoRef.current?.pause();
  }, []);

  useEffect(() => {
    const blockContextMenu = (event: globalThis.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const blockInspectionShortcut = (event: globalThis.KeyboardEvent) => {
      if (!shouldBlockLessonPageKeyboardShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("contextmenu", blockContextMenu, true);
    window.addEventListener("keydown", blockInspectionShortcut, true);

    return () => {
      document.removeEventListener("contextmenu", blockContextMenu, true);
      window.removeEventListener("keydown", blockInspectionShortcut, true);
    };
  }, []);

  const totalCommentCount = useMemo(() => getTotalCommentCount(comments), [comments]);
  const currentUserCommentAvatar = useMemo(
    () => ({ ...getCommentAvatar(currentUserName), online: true }),
    [currentUserName]
  );

  const fallbackTarget =
    getLessonTarget(allModules, activeLessonId) ??
    (selectedModule.lessons[0]
      ? {
          lesson: selectedModule.lessons[0],
          module: selectedModule
        }
      : null);
  const activeLesson = fallbackTarget?.lesson ?? null;
  const activeModule = allModules.find((courseModule) => courseModule.id === activeModuleId) ?? fallbackTarget?.module ?? selectedModule;
  const activeLessonKey = activeLesson?.id ?? "";
  const commentsLoading = commentsLessonId !== activeLessonKey;

  function selectLessonTab(nextTab: LessonTab) {
    if (activeTab === "aiTutor" || nextTab === "aiTutor") {
      setMountedTutorLessonId(activeLessonKey);
    }

    setActiveTab(nextTab);
  }
  const loadLessonComments = useCallback(async (lessonId: string, signal?: AbortSignal) => {
    if (!lessonId) {
      return;
    }

    try {
      const searchParams = new URLSearchParams({ contentId: item.id });
      const response = await fetch(`/api/comments/lessons/${encodeURIComponent(lessonId)}?${searchParams}`, {
        credentials: "same-origin",
        signal
      });
      const payload = await response.json() as { data?: LessonCommentRecord[]; error?: string };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Nao foi possivel carregar os comentarios.");
      }

      const flatRecords = flattenCommentRecords(payload.data);
      setComments(payload.data.map(lessonCommentRecordToView));
      setCommentReactionSelections(Object.fromEntries(
        flatRecords.flatMap((record) => (
          record.selectedReaction ? [[record.id, record.selectedReaction] as const] : []
        ))
      ));
      setReportedCommentIds(new Set(
        flatRecords.filter((record) => record.reportedByCurrentUser).map((record) => record.id)
      ));
      setCommentError("");
    } catch (error) {
      if (signal?.aborted) return;

      setComments([]);
      setCommentError(error instanceof Error ? error.message : "Nao foi possivel carregar os comentarios.");
    } finally {
      if (!signal?.aborted) setCommentsLessonId(lessonId);
    }
  }, [item.id]);
  const activeLessonDurationLabel = activeLesson?.duration;
  const activeLessonVideoProvider = activeLesson?.video?.provider;
  const activeYouTubeVideoId = activeLessonVideoProvider === "youtube"
    ? activeLesson?.video?.assetId || extractYouTubeId(activeLesson?.video?.url)
    : "";
  const effectiveYouTubeSelectedQuality = youTubeStreamsResult.videoId === activeYouTubeVideoId
    ? youTubeSelectedQuality
    : "auto";
  const effectiveYouTubeAutomaticQuality = effectiveYouTubeSelectedQuality === "auto"
    ? youTubeControlState.automaticQuality
    : null;
  const effectiveYouTubeQualityBadgeSource = effectiveYouTubeAutomaticQuality ?? effectiveYouTubeSelectedQuality;
  const effectiveYouTubeQualityDescription = effectiveYouTubeSelectedQuality === "auto"
    ? effectiveYouTubeAutomaticQuality
      ? `Automático, atual ${getYouTubeQualityDisplayName(effectiveYouTubeAutomaticQuality)}`
      : "Automático"
    : effectiveYouTubeSelectedQuality;
  const activeReleaseNotice = activeLesson
    ? (
        item.isLocked
          ? {
              detail: "Esta aula fica disponivel quando o aluno tiver acesso ao conteudo.",
              isLocked: true,
              title: "Acesso pendente"
            }
          : (
              getReleaseRuleNotice(activeLesson.releaseRule, "aula") ??
              getReleaseRuleNotice(activeModule.releaseRule, "modulo")
            )
      )
    : null;
  const isActiveLessonLocked = Boolean(activeReleaseNotice?.isLocked);
  const playerRenderConfig = activeLesson ? getPlayerRenderConfig(activeLesson.video) : null;
  const activeLessonWatchState = activeLessonKey ? lessonWatchStates[activeLessonKey] : undefined;
  const activeLessonDurationSeconds = activeLesson
    ? activeLessonWatchState?.durationSeconds ?? parseLessonDurationSeconds(activeLesson.duration)
    : undefined;
  const activeLessonStarted = activeLessonKey ? startedLessonIds.has(activeLessonKey) : false;
  const activeLessonWatchedPercent = activeLessonWatchState?.progressPercent ?? 0;
  const activeLessonMaxWatchedPercent = Math.max(
    activeLessonWatchState?.maxProgressPercent ?? 0,
    activeLessonWatchedPercent
  );
  const activePlayerRenderConfig = playerRenderConfig?.kind === "iframe"
    ? {
        ...playerRenderConfig,
        src: getUrlWithPlaybackParams(playerRenderConfig.src, {
          startSeconds: activeEmbedResume.lessonId === activeLessonKey
            ? activeEmbedResume.seconds
            : activeLessonWatchState?.progressSeconds ?? 0
        })
      }
    : playerRenderConfig;
  const updateYouTubeControlMetrics = useCallback((
    player: YouTubePlayer,
    updates: Partial<Pick<YouTubeControlState, "errorCode" | "isReady" | "playbackState">> = {}
  ) => {
    const currentTime = readYouTubeMetric(() => player.getCurrentTime());
    const duration = readYouTubeMetric(() => player.getDuration());
    const playbackState = getYouTubePlaybackState(player.getPlayerState?.());
    let isMuted: boolean | undefined;
    let volume: number | undefined;

    try {
      isMuted = player.isMuted?.();
      volume = player.getVolume?.();
    } catch {
      // The API may be transitioning between lessons while the iframe is replaced.
    }

    if (volume !== undefined && Number.isFinite(volume) && volume > 0) {
      lastNonZeroYouTubeVolumeRef.current = volume;
    }

    setYouTubeControlState((current) => ({
      ...current,
      ...(currentTime !== undefined ? { currentTime } : {}),
      ...(duration !== undefined && duration > 0 ? { duration } : {}),
      ...(isMuted !== undefined ? { isMuted } : {}),
      ...(playbackState !== undefined ? { playbackState } : {}),
      ...(volume !== undefined && Number.isFinite(volume) ? { volume } : {}),
      ...updates
    }));
  }, []);
  const consumePendingTutorSeekForYouTube = useCallback((player: YouTubePlayer, lessonId: string) => {
    try {
      const seconds = consumePendingTutorSeek(
        pendingTutorSeekRef,
        lessonId,
        (targetSeconds) => player.seekTo(targetSeconds, true)
      );

      if (seconds === null) return false;
      setYouTubeControlState((current) => ({ ...current, currentTime: seconds }));
      return true;
    } catch {
      return false;
    }
  }, []);
  const consumePendingTutorSeekForNativeVideo = useCallback((video: HTMLVideoElement, lessonId: string) => {
    if (video.readyState < 1) return false;

    try {
      const seconds = consumePendingTutorSeek(
        pendingTutorSeekRef,
        lessonId,
        (targetSeconds) => {
          const maximumSeconds = Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : targetSeconds;
          video.currentTime = Math.min(targetSeconds, maximumSeconds);
        }
      );

      if (seconds === null) return false;
      void video.play().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }, []);
  const persistLessonProgress = useCallback(async (payload: LessonProgressPayload) => {
    try {
      const response = await fetch("/api/progress/lessons", {
        body: JSON.stringify(payload),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        method: "PUT"
      });

      if (response.ok) {
        return;
      }

      const detail = await response.text();
      console.error("Erro ao salvar progresso da aula.", {
        detail,
        status: response.status
      });
    } catch (error: unknown) {
      console.error("Erro de rede ao salvar progresso da aula.", error);
    }
  }, []);
  const syncLessonWatchProgress = useCallback(async ({
    durationSeconds,
    force = false,
    lessonId,
    progressPercent,
    progressSeconds,
    status
  }: {
    durationSeconds?: number;
    force?: boolean;
    lessonId: string;
    progressPercent: number;
    progressSeconds: number;
    status: LessonWatchStatus;
  }) => {
    if (!lessonId || isActiveLessonLocked) {
      return;
    }

    const now = getCurrentTimestamp();
    const lastSync = lastProgressSyncRef.current[lessonId] ?? 0;

    if (!force && now - lastSync < 3000) {
      return;
    }

    lastProgressSyncRef.current[lessonId] = now;

    const safeProgressSeconds = Math.max(0, Math.round(progressSeconds));
    const roundedProgressPercent = clampProgressPercent(progressPercent);
    const safeProgressPercent = status === "completed"
      ? 100
      : Math.min(safeProgressSeconds > 0 ? Math.max(roundedProgressPercent, 1) : roundedProgressPercent, 99);
    const existingWatchState = lessonWatchStatesRef.current[lessonId];
    const safeMaxProgressPercent = status === "completed"
      ? 100
      : Math.max(
          existingWatchState?.maxProgressPercent ?? existingWatchState?.progressPercent ?? 0,
          safeProgressPercent
        );
    const nextState: LessonWatchState = {
      ...(durationSeconds !== undefined ? { durationSeconds: Math.max(0, Math.round(durationSeconds)) } : {}),
      lastWatchedAt: new Date().toISOString(),
      maxProgressPercent: safeMaxProgressPercent,
      progressPercent: safeProgressPercent,
      progressSeconds: safeProgressSeconds,
      status
    };

    lessonWatchStatesRef.current = {
      ...lessonWatchStatesRef.current,
      [lessonId]: nextState
    };
    initialResumeSecondsRef.current[lessonId] = nextState.progressSeconds;
    setLessonWatchStates(lessonWatchStatesRef.current);

    if (status === "completed") {
      setCompletedLessonIds((current) => {
        const nextCompletedLessonIds = new Set(current);
        nextCompletedLessonIds.add(lessonId);
        return nextCompletedLessonIds;
      });
    }

    await persistLessonProgress({
      contentId: item.id,
      durationSeconds: nextState.durationSeconds,
      lessonId,
      maxProgressPercent: nextState.maxProgressPercent,
      progressPercent: nextState.progressPercent,
      progressSeconds: nextState.progressSeconds,
      status
    });
  }, [isActiveLessonLocked, item.id, persistLessonProgress]);

  function handlePlayerStart() {
    if (isActiveLessonLocked || !activeLessonKey) {
      return;
    }

    setStartedLessonIds((current) => {
      if (current.has(activeLessonKey)) {
        return current;
      }

      const next = new Set(current);
      next.add(activeLessonKey);
      return next;
    });

    const currentProgressSeconds = lessonWatchStates[activeLessonKey]?.progressSeconds ?? 0;
    const nextProgressSeconds = Math.max(currentProgressSeconds, 1);
    const nextProgressPercent = activeLessonDurationSeconds && activeLessonDurationSeconds > 0
      ? clampProgressPercent((nextProgressSeconds / activeLessonDurationSeconds) * 100)
      : Math.max(activeLessonWatchedPercent, 1);

    void syncLessonWatchProgress({
      durationSeconds: activeLessonDurationSeconds,
      force: true,
      lessonId: activeLessonKey,
      progressPercent: Math.min(nextProgressPercent, 99),
      progressSeconds: nextProgressSeconds,
      status: "in_progress"
    });

    if (activeLessonVideoProvider === "youtube") {
      pendingYouTubePlayLessonIdRef.current = activeLessonKey;
      youTubePlaybackIntentLessonIdRef.current = activeLessonKey;
    }
  }

  const syncYouTubePlayerProgress = useCallback(async (
    player: YouTubePlayer,
    {
      fallbackDurationSeconds,
      force = false,
      lessonId,
      minimumProgressSeconds = 0,
      status = "in_progress"
    }: {
      fallbackDurationSeconds?: number;
      force?: boolean;
      lessonId: string;
      minimumProgressSeconds?: number;
      status?: LessonWatchStatus;
    }
  ) => {
    const playerCurrentTime = readYouTubeMetric(() => player.getCurrentTime());
    const playerDuration = readYouTubeMetric(() => player.getDuration());
    const durationSeconds = playerDuration && playerDuration > 0
      ? playerDuration
      : fallbackDurationSeconds;

    if (playerCurrentTime === undefined && status !== "completed") {
      return;
    }

    const progressSeconds = status === "completed" && durationSeconds
      ? durationSeconds
      : Math.max(playerCurrentTime ?? 0, minimumProgressSeconds);
    const progressPercent = status === "completed"
      ? 100
      : durationSeconds && durationSeconds > 0
        ? clampProgressPercent((progressSeconds / durationSeconds) * 100)
        : progressSeconds > 0 ? 1 : 0;

    await syncLessonWatchProgress({
      durationSeconds,
      force,
      lessonId,
      progressPercent,
      progressSeconds,
      status
    });
  }, [syncLessonWatchProgress]);

  const flushActiveLessonProgress = useCallback(async () => {
    if (!activeLessonKey || isActiveLessonLocked) {
      return;
    }

    const status = activeLessonWatchState?.status === "completed" ? "completed" : "in_progress";
    const fallbackDurationSeconds = activeLessonDurationLabel
      ? parseLessonDurationSeconds(activeLessonDurationLabel)
      : activeLessonDurationSeconds;

    if (activeLessonVideoProvider === "youtube" && youtubePlayerRef.current) {
      await syncYouTubePlayerProgress(youtubePlayerRef.current, {
        fallbackDurationSeconds,
        force: true,
        lessonId: activeLessonKey,
        status
      });
      return;
    }

    if (activePlayerRenderConfig?.kind === "video" && videoRef.current) {
      const video = videoRef.current;
      const durationSeconds = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : activeLessonDurationSeconds;
      const progressSeconds = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const progressPercent = durationSeconds && durationSeconds > 0
        ? clampProgressPercent((progressSeconds / durationSeconds) * 100)
        : activeLessonWatchedPercent;

      await syncLessonWatchProgress({
        durationSeconds,
        force: true,
        lessonId: activeLessonKey,
        progressPercent,
        progressSeconds,
        status
      });
      return;
    }

    const currentState = lessonWatchStatesRef.current[activeLessonKey];

    if (!currentState) {
      return;
    }

    await syncLessonWatchProgress({
      durationSeconds: currentState.durationSeconds ?? activeLessonDurationSeconds,
      force: true,
      lessonId: activeLessonKey,
      progressPercent: currentState.progressPercent,
      progressSeconds: currentState.progressSeconds,
      status: currentState.status
    });
  }, [
    activeLessonDurationLabel,
    activeLessonDurationSeconds,
    activeLessonKey,
    activeLessonVideoProvider,
    activeLessonWatchState?.status,
    activeLessonWatchedPercent,
    activePlayerRenderConfig?.kind,
    isActiveLessonLocked,
    syncLessonWatchProgress,
    syncYouTubePlayerProgress
  ]);

  useEffect(() => {
    lessonWatchStatesRef.current = lessonWatchStates;
  }, [lessonWatchStates]);

  useEffect(() => {
    window.__bunker707FlushLessonProgress = flushActiveLessonProgress;

    return () => {
      if (window.__bunker707FlushLessonProgress === flushActiveLessonProgress) {
        delete window.__bunker707FlushLessonProgress;
      }
    };
  }, [flushActiveLessonProgress]);

  useEffect(() => {
    startedLessonIdsRef.current = startedLessonIds;
  }, [startedLessonIds]);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setCanRenderEmbeddedPlayer(true);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsPlayerFullscreen(document.fullscreenElement === lessonPlayerFrameRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!youTubeSettingsMenuOpen) {
      return;
    }

    function handleYouTubeSettingsPointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-youtube-settings-control]")
      ) {
        return;
      }

      setYouTubeSettingsMenuOpen(false);
      setYouTubeSettingsMenuView("root");
    }

    document.addEventListener("pointerdown", handleYouTubeSettingsPointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handleYouTubeSettingsPointerDown, true);
    };
  }, [youTubeSettingsMenuOpen]);

  useEffect(() => {
    if (!commentMenuId && !commentReactionMenuId) {
      return;
    }

    function handleCommentPopoverPointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("[data-comment-popover-root]")) {
        return;
      }

      setCommentMenuId(null);
      setCommentReactionMenuId(null);
    }

    document.addEventListener("pointerdown", handleCommentPopoverPointerDown);

    return () => {
      document.removeEventListener("pointerdown", handleCommentPopoverPointerDown);
    };
  }, [commentMenuId, commentReactionMenuId]);

  useEffect(() => {
    const controller = new AbortController();
    const loadTimeout = window.setTimeout(() => {
      void loadLessonComments(activeLessonKey, controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(loadTimeout);
      controller.abort();
    };
  }, [activeLessonKey, loadLessonComments]);

  useEffect(() => {
    if (!activeModuleId) {
      return;
    }

    const scroller = playlistScrollRef.current;
    const target = moduleRefs.current[activeModuleId];

    if (!scroller || !target) {
      return;
    }

    const alignModuleToTop = (behavior: ScrollBehavior) => {
      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const nextTop = scroller.scrollTop + targetRect.top - scrollerRect.top - 12;

      scroller.scrollTo({
        behavior,
        top: Math.max(0, nextTop)
      });
    };

    const animationFrame = window.requestAnimationFrame(() => {
      alignModuleToTop("smooth");
    });
    const postAccordionTimeout = window.setTimeout(() => {
      alignModuleToTop("smooth");
    }, 420);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(postAccordionTimeout);
    };
  }, [activeModuleId]);

  useEffect(() => {
    youTubeAudioPreferenceRef.current = {
      isMuted: youTubeControlState.isMuted,
      volume: youTubeControlState.volume
    };
  }, [youTubeControlState.isMuted, youTubeControlState.volume]);

  useEffect(() => {
    youTubeSelectedQualityRef.current = youTubeSelectedQuality;
  }, [youTubeSelectedQuality]);

  useEffect(() => {
    if (
      !activeLessonKey ||
      activeLessonVideoProvider !== "youtube" ||
      isActiveLessonLocked ||
      !/^[A-Za-z0-9_-]{11}$/.test(activeYouTubeVideoId)
    ) {
      return;
    }

    const controller = new AbortController();
    const searchParams = new URLSearchParams({
      contentId: item.id,
      lessonId: activeLessonKey
    });

    void fetch(`/api/video/youtube/streams?${searchParams}`, {
      credentials: "same-origin",
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = await response.json() as YouTubeStreamsResponse;

        if (!response.ok || !payload.audio || !payload.expiresAt || !Array.isArray(payload.qualities)) {
          throw new Error(payload.error ?? "Nao foi possivel carregar as resolucoes.");
        }

        const videoProbe = document.createElement("video");
        const audioProbe = document.createElement("audio");
        const qualities = payload.qualities.filter((quality) => (
          typeof quality.label === "string" &&
          /^\d{2,5}p(?:\d{1,3})?(?: HDR)?$/.test(quality.label) &&
          typeof quality.url === "string" &&
          quality.url.startsWith("https://") &&
          typeof quality.mimeType === "string" &&
          videoProbe.canPlayType(quality.mimeType) !== ""
        ));

        if (
          qualities.length === 0 ||
          typeof payload.audio.url !== "string" ||
          !payload.audio.url.startsWith("https://") ||
          audioProbe.canPlayType(payload.audio.mimeType) === ""
        ) {
          throw new Error("O navegador nao suporta as faixas disponiveis.");
        }

        return {
          audio: payload.audio,
          expiresAt: payload.expiresAt,
          qualities
        };
      })
      .then(({ audio, expiresAt, qualities }) => {
        if (controller.signal.aborted) {
          return;
        }

        if (lastLoadedYouTubeStreamsVideoIdRef.current !== activeYouTubeVideoId) {
          lastLoadedYouTubeStreamsVideoIdRef.current = activeYouTubeVideoId;
          youTubeSelectedQualityRef.current = "auto";
          setYouTubeSelectedQuality("auto");
          setYouTubeManualSwitch((current) => ({
            lessonId: activeLessonKey,
            seconds: 0,
            shouldPlay: false,
            token: current.token + 1
          }));
        }

        setYouTubeStreamsResult({
          audio,
          expiresAt,
          qualities,
          status: "ready",
          videoId: activeYouTubeVideoId
        });
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }

        setYouTubeStreamsResult({
          audio: null,
          expiresAt: "",
          qualities: [],
          status: "error",
          videoId: activeYouTubeVideoId
        });

        if (youTubeSelectedQualityRef.current !== "auto") {
          youTubeSelectedQualityRef.current = "auto";
          setYouTubeSelectedQuality("auto");
          setYouTubeReloadToken((current) => current + 1);
        }
      });

    return () => controller.abort();
  }, [
    activeLessonKey,
    activeLessonVideoProvider,
    activeYouTubeVideoId,
    isActiveLessonLocked,
    item.id,
    youTubeStreamsReloadToken
  ]);

  useEffect(() => {
    if (
      !activeLessonKey ||
      activeLessonVideoProvider !== "youtube" ||
      isActiveLessonLocked ||
      !/^[A-Za-z0-9_-]{11}$/.test(activeYouTubeVideoId)
    ) {
      return;
    }

    const controller = new AbortController();
    const searchParams = new URLSearchParams({
      contentId: item.id,
      language: "pt",
      lessonId: activeLessonKey
    });

    void fetch(`/api/video/youtube/captions?${searchParams}`, {
      credentials: "same-origin",
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = await response.json() as YouTubeCaptionsResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Nao foi possivel carregar as legendas.");
        }

        return (payload.cues ?? [])
          .filter((cue) => (
            Number.isFinite(cue.startSeconds) &&
            cue.startSeconds >= 0 &&
            Number.isFinite(cue.durationSeconds) &&
            cue.durationSeconds >= 0 &&
            typeof cue.text === "string" &&
            cue.text.trim().length > 0
          ))
          .map((cue) => ({
            durationSeconds: cue.durationSeconds,
            startSeconds: cue.startSeconds,
            text: cue.text.trim()
          }));
      })
      .then((cues) => {
        if (controller.signal.aborted) {
          return;
        }

        setYouTubeCaptionResult({
          cues,
          status: cues.length > 0 ? "ready" : "unavailable",
          videoId: activeYouTubeVideoId
        });
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }

        setYouTubeCaptionResult({
          cues: [],
          status: "unavailable",
          videoId: activeYouTubeVideoId
        });
      });

    return () => controller.abort();
  }, [activeLessonKey, activeLessonVideoProvider, activeYouTubeVideoId, isActiveLessonLocked, item.id]);

  useEffect(() => {
    if (
      !canRenderEmbeddedPlayer ||
      !activeLessonKey ||
      activeLessonVideoProvider !== "youtube" ||
      isActiveLessonLocked ||
      effectiveYouTubeSelectedQuality !== "auto" ||
      activePlayerRenderConfig?.kind !== "iframe"
    ) {
      readyYouTubePlayerRef.current = null;
      youtubePlayerRef.current = null;
      return;
    }

    const iframe = youtubeIframeRef.current;

    if (!iframe) {
      return;
    }

    let cancelled = false;
    let player: YouTubePlayer | null = null;
    const lessonId = activeLessonKey;
    const fallbackDurationSeconds = activeLessonDurationLabel
      ? parseLessonDurationSeconds(activeLessonDurationLabel)
      : undefined;

    void loadYouTubeIframeApi().then(() => {
      if (cancelled || !window.YT?.Player || youtubeIframeRef.current !== iframe) {
        return;
      }

      const playerStates = window.YT.PlayerState;

      player = new window.YT.Player(iframe, {
        events: {
          onAutoplayBlocked: () => {
            if (cancelled) {
              return;
            }

            pendingYouTubePlayLessonIdRef.current = null;
            youTubePlaybackIntentLessonIdRef.current = null;

            if (youtubePlayerRef.current) {
              updateYouTubeControlMetrics(youtubePlayerRef.current);
            }
          },
          onError: (event) => {
            if (cancelled) {
              return;
            }

            pendingYouTubePlayLessonIdRef.current = null;
            youTubePlaybackIntentLessonIdRef.current = null;
            if (readyYouTubePlayerRef.current?.player === event.target) {
              readyYouTubePlayerRef.current = null;
            }
            youtubePlayerRef.current = event.target;
            setYouTubeControlState((current) => ({
              ...current,
              errorCode: event.data,
              isReady: false,
              playbackState: "error"
            }));
          },
          onPlaybackQualityChange: (event) => {
            if (cancelled) {
              return;
            }

            const automaticQuality = normalizeYouTubePlaybackQuality(event.data);

            if (!automaticQuality) {
              return;
            }

            youtubePlayerRef.current = event.target;
            setYouTubeControlState((current) => ({
              ...current,
              automaticQuality
            }));
          },
          onPlaybackRateChange: (event) => {
            if (cancelled || !Number.isFinite(event.data) || event.data <= 0) {
              return;
            }

            youtubePlayerRef.current = event.target;
            youTubePlaybackRatePreferenceRef.current = event.data;
            setYouTubeControlState((current) => ({
              ...current,
              playbackRate: event.data
            }));
          },
          onReady: (event) => {
            if (cancelled || youTubeSelectedQualityRef.current !== "auto") {
              return;
            }

            youtubePlayerRef.current = event.target;
            readyYouTubePlayerRef.current = { lessonId, player: event.target };

            try {
              event.target.unloadModule?.("captions");
            } catch {
              // Native captions would be cropped with the oversized iframe; Bunker707 renders its own centered cues.
            }

            const audioPreference = youTubeAudioPreferenceRef.current;
            event.target.setVolume?.(audioPreference.volume);

            if (audioPreference.isMuted || audioPreference.volume === 0) {
              event.target.mute?.();
            } else {
              event.target.unMute?.();
            }

            const availablePlaybackRates = readYouTubePlaybackRates(event.target);
            const preferredPlaybackRate = youTubePlaybackRatePreferenceRef.current;

            if (availablePlaybackRates.includes(preferredPlaybackRate)) {
              event.target.setPlaybackRate?.(preferredPlaybackRate);
            } else {
              youTubePlaybackRatePreferenceRef.current = 1;
            }

            const reportedPlaybackRate = readYouTubeMetric(() => event.target.getPlaybackRate?.() ?? 1) ?? 1;

            setYouTubeControlState((current) => ({
              ...current,
              availablePlaybackRates,
              playbackRate: reportedPlaybackRate
            }));

            updateYouTubeControlMetrics(event.target, {
              errorCode: null,
              isReady: true,
              playbackState: "paused"
            });
            consumePendingTutorSeekForYouTube(event.target, lessonId);

            if (
              pendingYouTubePlayLessonIdRef.current === lessonId &&
              youTubePlaybackIntentLessonIdRef.current === lessonId
            ) {
              event.target.playVideo?.();
            } else {
              if (pendingYouTubePlayLessonIdRef.current === lessonId) {
                pendingYouTubePlayLessonIdRef.current = null;
              }
              event.target.pauseVideo?.();
            }
          },
          onStateChange: (event) => {
            if (cancelled) {
              return;
            }

            youtubePlayerRef.current = event.target;

            if (event.data === playerStates.PLAYING) {
              const playbackWasRequested = youTubePlaybackIntentLessonIdRef.current === lessonId;

              if (!playbackWasRequested) {
                if (pendingYouTubePlayLessonIdRef.current === lessonId) {
                  pendingYouTubePlayLessonIdRef.current = null;
                }
                event.target.pauseVideo?.();
                updateYouTubeControlMetrics(event.target, {
                  isReady: true,
                  playbackState: "paused"
                });
                return;
              }

              try {
                event.target.unloadModule?.("captions");
              } catch {
                // Keep the provider captions hidden so only the centered Bunker707 track is shown.
              }

              updateYouTubeControlMetrics(event.target, {
                errorCode: null,
                isReady: true,
                playbackState: "playing"
              });

              if (pendingYouTubePlayLessonIdRef.current === lessonId) {
                pendingYouTubePlayLessonIdRef.current = null;
              }

              setStartedLessonIds((current) => {
                if (current.has(lessonId)) {
                  return current;
                }

                const next = new Set(current);
                next.add(lessonId);
                return next;
              });
              void syncYouTubePlayerProgress(event.target, {
                fallbackDurationSeconds,
                force: true,
                lessonId,
                minimumProgressSeconds: 1,
                status: "in_progress"
              });
              return;
            }

            if (event.data === playerStates.PAUSED) {
              if (
                pendingYouTubePlayLessonIdRef.current !== lessonId &&
                youTubePlaybackIntentLessonIdRef.current === lessonId
              ) {
                youTubePlaybackIntentLessonIdRef.current = null;
              }
              updateYouTubeControlMetrics(event.target, {
                isReady: true,
                playbackState: "paused"
              });

              if (!startedLessonIdsRef.current.has(lessonId)) {
                return;
              }

              void syncYouTubePlayerProgress(event.target, {
                fallbackDurationSeconds,
                force: true,
                lessonId,
                status: "in_progress"
              });
              return;
            }

            if (event.data === playerStates.ENDED) {
              pendingYouTubePlayLessonIdRef.current = null;
              youTubePlaybackIntentLessonIdRef.current = null;
              updateYouTubeControlMetrics(event.target, {
                isReady: true,
                playbackState: "ended"
              });
              void syncYouTubePlayerProgress(event.target, {
                fallbackDurationSeconds,
                force: true,
                lessonId,
                status: "completed"
              });
              return;
            }

            if (event.data === playerStates.BUFFERING) {
              if (youTubePlaybackIntentLessonIdRef.current !== lessonId) {
                event.target.pauseVideo?.();
                updateYouTubeControlMetrics(event.target, {
                  isReady: true,
                  playbackState: "paused"
                });
                return;
              }

              updateYouTubeControlMetrics(event.target, {
                isReady: true,
                playbackState: "buffering"
              });
            }
          }
        }
      });
      youtubePlayerRef.current = player;
    });

    return () => {
      cancelled = true;

      if (
        player &&
        startedLessonIdsRef.current.has(lessonId) &&
        lessonWatchStatesRef.current[lessonId]?.status !== "completed"
      ) {
        void syncYouTubePlayerProgress(player, {
          fallbackDurationSeconds,
          force: true,
          lessonId,
          status: "in_progress"
        });

        try {
          player.destroy?.();
        } catch {
          // Some browser navigations detach the iframe before the YouTube player cleanup runs.
        }
      }

      if (youtubePlayerRef.current === player) {
        youtubePlayerRef.current = null;
      }

      if (readyYouTubePlayerRef.current?.player === player) {
        readyYouTubePlayerRef.current = null;
      }

      if (pendingYouTubePlayLessonIdRef.current === lessonId) {
        pendingYouTubePlayLessonIdRef.current = null;
      }

      if (youTubePlaybackIntentLessonIdRef.current === lessonId) {
        youTubePlaybackIntentLessonIdRef.current = null;
      }
    };
  }, [
    activeLessonDurationLabel,
    activeLessonKey,
    activeLessonVideoProvider,
    activePlayerRenderConfig?.kind,
    canRenderEmbeddedPlayer,
    consumePendingTutorSeekForYouTube,
    isActiveLessonLocked,
    syncYouTubePlayerProgress,
    updateYouTubeControlMetrics,
    effectiveYouTubeSelectedQuality,
    youTubeReloadToken
  ]);

  useEffect(() => {
    if (
      !activeLessonKey ||
      activeLessonVideoProvider !== "youtube" ||
      !activeLessonStarted ||
      isActiveLessonLocked
    ) {
      return;
    }

    const lessonId = activeLessonKey;
    const fallbackDurationSeconds = activeLessonDurationLabel
      ? parseLessonDurationSeconds(activeLessonDurationLabel)
      : undefined;
    const interval = window.setInterval(() => {
      const currentPlayer = youtubePlayerRef.current;

      if (!currentPlayer) {
        return;
      }

      const playerState = currentPlayer.getPlayerState?.();
      const playingState = window.YT?.PlayerState.PLAYING ?? 1;
      const bufferingState = window.YT?.PlayerState.BUFFERING ?? 3;

      if (playerState !== undefined && playerState !== playingState && playerState !== bufferingState) {
        return;
      }

      void syncYouTubePlayerProgress(currentPlayer, {
        fallbackDurationSeconds,
        force: true,
        lessonId,
        status: "in_progress"
      });
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    activeLessonDurationLabel,
    activeLessonKey,
    activeLessonVideoProvider,
    activeLessonStarted,
    isActiveLessonLocked,
    syncYouTubePlayerProgress
  ]);

  useEffect(() => {
    if (
      !activeLessonKey ||
      activeLessonVideoProvider !== "youtube" ||
      !activeLessonStarted ||
      isActiveLessonLocked
    ) {
      return;
    }

    const lessonId = activeLessonKey;
    const fallbackDurationSeconds = activeLessonDurationLabel
      ? parseLessonDurationSeconds(activeLessonDurationLabel)
      : undefined;
    const refreshControls = () => {
      const player = youtubePlayerRef.current;

      if (player) {
        updateYouTubeControlMetrics(player);

        if (
          player.getPlayerState?.() === (window.YT?.PlayerState.ENDED ?? 0) &&
          lessonWatchStatesRef.current[lessonId]?.status !== "completed"
        ) {
          void syncYouTubePlayerProgress(player, {
            fallbackDurationSeconds,
            force: true,
            lessonId,
            status: "completed"
          });
        }
      }
    };
    refreshControls();
    const interval = window.setInterval(refreshControls, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    activeLessonDurationLabel,
    activeLessonKey,
    activeLessonStarted,
    activeLessonVideoProvider,
    isActiveLessonLocked,
    syncYouTubePlayerProgress,
    updateYouTubeControlMetrics
  ]);

  useEffect(() => {
    if (
      !activeLesson ||
      !activeLessonStarted ||
      isActiveLessonLocked ||
      playerRenderConfig?.kind === "video" ||
      activeLesson.video?.provider === "youtube"
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      const currentState = lessonWatchStates[activeLesson.id];
      const nextSeconds = (currentState?.progressSeconds ?? 0) + 10;
      const nextPercent = activeLessonDurationSeconds && activeLessonDurationSeconds > 0
        ? clampProgressPercent((nextSeconds / activeLessonDurationSeconds) * 100)
        : Math.max(currentState?.progressPercent ?? 1, 1);

      void syncLessonWatchProgress({
        durationSeconds: activeLessonDurationSeconds,
        force: true,
        lessonId: activeLesson.id,
        progressPercent: Math.min(nextPercent, 99),
        progressSeconds: nextSeconds,
        status: "in_progress"
      });
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    activeLesson,
    activeLessonDurationSeconds,
    activeLessonStarted,
    isActiveLessonLocked,
    lessonWatchStates,
    activeLesson?.video?.provider,
    playerRenderConfig?.kind,
    syncLessonWatchProgress
  ]);

  if (!activeLesson) {
    return (
      <EmptyLessonState
        accessPreviewMode={accessPreviewMode}
        item={item}
        returnContent={returnContent}
        selectedModule={selectedModule}
      />
    );
  }

  const totalCourseLessonsCount = allModules.reduce((total, courseModule) => total + courseModule.lessons.length, 0);
  const completedCourseLessonsCount = allModules.reduce((total, courseModule) => (
    total + courseModule.lessons.filter((lesson) => completedLessonIds.has(lesson.id)).length
  ), 0);
  const courseProgressPercent = totalCourseLessonsCount > 0
    ? Math.round((completedCourseLessonsCount / totalCourseLessonsCount) * 100)
    : 0;
  const isActiveLessonCompleted = completedLessonIds.has(activeLessonKey);
  const posterImage = activeLesson.image ?? activeModule.image;
  const videoPosterImage = getYouTubeThumbnailUrl(activeLesson.video) || posterImage;
  const lessonReaction = lessonReactions[activeLessonKey] ?? null;
  const hasRatedLesson = Boolean(lessonReaction);
  const canRateLesson = activeLessonMaxWatchedPercent >= 30 || hasRatedLesson;
  const activeLessonSaved = savedLessonOverrides[activeLessonKey] ?? Boolean(activeLesson.isSaved);
  const usesCustomYouTubeControls =
    !isActiveLessonLocked &&
    activeLessonVideoProvider === "youtube" &&
    activePlayerRenderConfig?.kind === "iframe";
  const youTubeAvailableQualities = youTubeStreamsResult.videoId === activeYouTubeVideoId
    ? youTubeStreamsResult.qualities
    : [];
  const youTubeStreamsStatus = youTubeStreamsResult.videoId === activeYouTubeVideoId
    ? youTubeStreamsResult.status
    : /^[A-Za-z0-9_-]{11}$/.test(activeYouTubeVideoId) ? "loading" : "unavailable";
  const selectedYouTubeManualStream = effectiveYouTubeSelectedQuality === "auto"
    ? null
    : youTubeAvailableQualities.find((quality) => quality.label === effectiveYouTubeSelectedQuality) ?? null;
  const isYouTubePlaying =
    youTubeControlState.playbackState === "playing" ||
    youTubeControlState.playbackState === "buffering";
  const youTubePlaybackActionLabel = youTubeControlState.playbackState === "error"
    ? "Tentar novamente"
    : isYouTubePlaying ? "Pausar" : "Reproduzir";
  const isYouTubePlayerPreparing =
    usesCustomYouTubeControls &&
    !youTubeControlState.isReady &&
    youTubeControlState.playbackState !== "error";
  const youTubeDuration = youTubeControlState.duration || activeLessonDurationSeconds || 0;
  const youTubeCurrentTime = Math.min(youTubeControlState.currentTime, youTubeDuration || youTubeControlState.currentTime);
  const youTubeProgressPercent = youTubeDuration > 0
    ? Math.max(0, Math.min(100, (youTubeCurrentTime / youTubeDuration) * 100))
    : 0;
  const youTubeCaptionCues = youTubeCaptionResult.videoId === activeYouTubeVideoId
    ? youTubeCaptionResult.cues
    : [];
  const youTubeCaptionsStatus = !/^[A-Za-z0-9_-]{11}$/.test(activeYouTubeVideoId)
    ? "idle"
    : youTubeCaptionResult.videoId === activeYouTubeVideoId
      ? youTubeCaptionResult.status
      : "loading";
  const youTubeCaptionsAvailable = youTubeCaptionsStatus === "ready" && youTubeCaptionCues.length > 0;
  const activeYouTubeCaptionCue = youTubeCaptionsEnabled && youTubeCaptionsAvailable
    ? findActiveCaptionCue(youTubeCaptionCues, youTubeCurrentTime)
    : null;
  const youTubeCaptionsActionLabel = youTubeCaptionsStatus === "loading"
    ? "Carregando legendas"
    : !youTubeCaptionsAvailable
      ? "Legendas indisponiveis"
      : youTubeCaptionsEnabled ? "Desativar legendas" : "Ativar legendas";
  const showPlayerClickOverlay =
    !isActiveLessonLocked &&
    Boolean(activePlayerRenderConfig) &&
    activePlayerRenderConfig?.kind !== "video" &&
    !activeLessonStarted;
  const showPlayerPosterOverlay =
    showPlayerClickOverlay &&
    activeLessonVideoProvider === "youtube";

  function handlePrimaryLessonAction() {
    if (isActiveLessonLocked) {
      return;
    }

    handleLessonCompletionToggle(activeLessonKey);
  }

  function handleYouTubePlaybackToggle() {
    closeYouTubeSettingsMenu();
    const player = youtubePlayerRef.current;

    if (youTubeControlState.playbackState === "error") {
      if (selectedYouTubeManualStream && youTubeStreamsResult.audio) {
        const currentTime = player
          ? readYouTubeMetric(() => player.getCurrentTime()) ?? youTubeCurrentTime
          : youTubeCurrentTime;

        handlePlayerStart();
        pendingYouTubePlayLessonIdRef.current = activeLessonKey;
        youTubePlaybackIntentLessonIdRef.current = activeLessonKey;
        setActiveEmbedResume({
          lessonId: activeLessonKey,
          seconds: currentTime
        });
        setYouTubeManualSwitch((current) => ({
          lessonId: activeLessonKey,
          seconds: currentTime,
          shouldPlay: true,
          token: current.token + 1
        }));
        setYouTubeControlState((current) => ({
          ...current,
          errorCode: null,
          isReady: false,
          playbackState: "buffering"
        }));
        setYouTubeStreamsReloadToken((current) => current + 1);
        return;
      }

      handlePlayerStart();
      pendingYouTubePlayLessonIdRef.current = activeLessonKey;
      youTubePlaybackIntentLessonIdRef.current = activeLessonKey;
      setActiveEmbedResume({
        lessonId: activeLessonKey,
        seconds: initialResumeSecondsRef.current[activeLessonKey] ?? 0
      });
      setYouTubeControlState(initialYouTubeControlState);
      setYouTubeReloadToken((current) => current + 1);
      return;
    }

    if (!player || !youTubeControlState.isReady) {
      handlePlayerStart();
      return;
    }

    if (activeLessonStarted && isYouTubePlaying) {
      pendingYouTubePlayLessonIdRef.current = null;
      youTubePlaybackIntentLessonIdRef.current = null;
      player.pauseVideo?.();
      return;
    }

    if (youTubeControlState.playbackState === "ended") {
      player.seekTo(0, true);
      setYouTubeControlState((current) => ({
        ...current,
        currentTime: 0,
        playbackState: "buffering"
      }));
    }

    handlePlayerStart();
    player.playVideo?.();
  }

  function handleYouTubeSeek(event: FormEvent<HTMLInputElement>) {
    const player = youtubePlayerRef.current;
    const nextTime = Number(event.currentTarget.value);

    if (!player || !youTubeControlState.isReady || !Number.isFinite(nextTime)) {
      return;
    }

    player.seekTo(nextTime, true);
    setYouTubeControlState((current) => ({
      ...current,
      currentTime: nextTime
    }));
  }

  function handleYouTubeSkip(seconds: number) {
    const player = youtubePlayerRef.current;

    if (!player || !youTubeControlState.isReady) {
      return;
    }

    const currentTime = readYouTubeMetric(() => player.getCurrentTime()) ?? youTubeCurrentTime;
    const duration = readYouTubeMetric(() => player.getDuration()) ?? youTubeDuration;
    const nextTime = Math.max(0, Math.min(duration || Number.POSITIVE_INFINITY, currentTime + seconds));

    player.seekTo(nextTime, true);
    setYouTubeControlState((current) => ({
      ...current,
      currentTime: nextTime
    }));
  }

  function handleYouTubeMuteToggle() {
    const player = youtubePlayerRef.current;

    if (!player || !youTubeControlState.isReady) {
      return;
    }

    if (youTubeControlState.isMuted || youTubeControlState.volume === 0) {
      const restoredVolume = Math.max(1, lastNonZeroYouTubeVolumeRef.current || 100);

      player.setVolume?.(restoredVolume);
      player.unMute?.();
      setYouTubeControlState((current) => ({
        ...current,
        isMuted: false,
        volume: restoredVolume
      }));
    } else {
      if (youTubeControlState.volume > 0) {
        lastNonZeroYouTubeVolumeRef.current = youTubeControlState.volume;
      }

      player.mute?.();
      setYouTubeControlState((current) => ({
        ...current,
        isMuted: true
      }));
    }
  }

  function handleYouTubeVolumeChange(event: FormEvent<HTMLInputElement>) {
    const player = youtubePlayerRef.current;
    const nextVolume = Math.max(0, Math.min(100, Number(event.currentTarget.value)));

    if (!player || !youTubeControlState.isReady || !Number.isFinite(nextVolume)) {
      return;
    }

    player.setVolume?.(nextVolume);

    if (nextVolume > 0 && youTubeControlState.isMuted) {
      lastNonZeroYouTubeVolumeRef.current = nextVolume;
      player.unMute?.();
    } else if (nextVolume === 0) {
      player.mute?.();
    } else if (nextVolume > 0) {
      lastNonZeroYouTubeVolumeRef.current = nextVolume;
    }

    setYouTubeControlState((current) => ({
      ...current,
      isMuted: nextVolume === 0,
      volume: nextVolume
    }));
  }

  function handleYouTubeQualitySelect(selection: string) {
    if (
      selection !== "auto" &&
      !youTubeAvailableQualities.some((quality) => quality.label === selection)
    ) {
      return;
    }

    if (selection === effectiveYouTubeSelectedQuality) {
      closeYouTubeSettingsMenu();
      return;
    }

    const player = youtubePlayerRef.current;
    const currentTime = player
      ? readYouTubeMetric(() => player.getCurrentTime()) ?? youTubeCurrentTime
      : youTubeCurrentTime;
    const duration = player
      ? readYouTubeMetric(() => player.getDuration()) ?? youTubeDuration
      : youTubeDuration;
    const shouldPlay =
      youTubePlaybackIntentLessonIdRef.current === activeLessonKey ||
      isYouTubePlaying;

    if (shouldPlay) {
      pendingYouTubePlayLessonIdRef.current = activeLessonKey;
      youTubePlaybackIntentLessonIdRef.current = activeLessonKey;
    } else {
      pendingYouTubePlayLessonIdRef.current = null;
      youTubePlaybackIntentLessonIdRef.current = null;
    }

    youTubeSelectedQualityRef.current = selection;
    readyYouTubePlayerRef.current = null;
    player?.pauseVideo?.();
    setActiveEmbedResume({
      lessonId: activeLessonKey,
      seconds: currentTime
    });
    setYouTubeManualSwitch((current) => ({
      lessonId: activeLessonKey,
      seconds: currentTime,
      shouldPlay,
      token: current.token + 1
    }));
    setYouTubeControlState((current) => ({
      ...initialYouTubeControlState,
      currentTime,
      duration,
      availablePlaybackRates: selection === "auto"
        ? current.availablePlaybackRates
        : [...manualYouTubePlaybackRates],
      isMuted: current.isMuted,
      playbackRate: current.playbackRate,
      playbackState: shouldPlay ? "buffering" : "paused",
      volume: current.volume
    }));
    setYouTubeSelectedQuality(selection);
    closeYouTubeSettingsMenu();

    if (selection === "auto") {
      setYouTubeReloadToken((current) => current + 1);
    }
  }

  function handleManualYouTubeControllerReady(controller: YouTubeManualPlayerController) {
    if (youTubeSelectedQualityRef.current === "auto") return;
    youtubePlayerRef.current = controller;
    readyYouTubePlayerRef.current = { lessonId: activeLessonKey, player: controller };
    controller.setPlaybackRate(youTubePlaybackRatePreferenceRef.current);
    setYouTubeControlState((current) => ({
      ...current,
      availablePlaybackRates: controller.getAvailablePlaybackRates(),
      playbackRate: controller.getPlaybackRate()
    }));
    updateYouTubeControlMetrics(controller, {
      errorCode: null,
      isReady: true,
      playbackState: youTubeManualSwitch.shouldPlay ? "buffering" : "paused"
    });
    const resumedTutorSeek = consumePendingTutorSeekForYouTube(controller, activeLessonKey);

    if (
      resumedTutorSeek &&
      pendingYouTubePlayLessonIdRef.current === activeLessonKey &&
      youTubePlaybackIntentLessonIdRef.current === activeLessonKey
    ) {
      setYouTubeControlState((current) => ({ ...current, playbackState: "buffering" }));
      controller.playVideo();
    }
  }

  function handleManualYouTubePlaybackStateChange(
    controller: YouTubeManualPlayerController,
    playbackState: "buffering" | "paused" | "playing"
  ) {
    youtubePlayerRef.current = controller;

    if (
      playbackState === "playing" &&
      youTubePlaybackIntentLessonIdRef.current !== activeLessonKey
    ) {
      controller.pauseVideo();
      updateYouTubeControlMetrics(controller, {
        isReady: true,
        playbackState: "paused"
      });
      return;
    }

    if (playbackState === "playing" && pendingYouTubePlayLessonIdRef.current === activeLessonKey) {
      pendingYouTubePlayLessonIdRef.current = null;
    }

    updateYouTubeControlMetrics(controller, {
      errorCode: null,
      isReady: true,
      playbackState
    });
  }

  function handleManualYouTubeEnded(controller: YouTubeManualPlayerController) {
    pendingYouTubePlayLessonIdRef.current = null;
    youTubePlaybackIntentLessonIdRef.current = null;
    updateYouTubeControlMetrics(controller, {
      isReady: true,
      playbackState: "ended"
    });
    void syncYouTubePlayerProgress(controller, {
      fallbackDurationSeconds: activeLessonDurationSeconds,
      force: true,
      lessonId: activeLessonKey,
      status: "completed"
    });
  }

  function handleManualYouTubeError() {
    pendingYouTubePlayLessonIdRef.current = null;
    youTubePlaybackIntentLessonIdRef.current = null;
    readyYouTubePlayerRef.current = null;
    setYouTubeControlState((current) => ({
      ...current,
      errorCode: null,
      isReady: false,
      playbackState: "error"
    }));
  }

  function handleManualYouTubeAutoplayBlocked() {
    pendingYouTubePlayLessonIdRef.current = null;
    youTubePlaybackIntentLessonIdRef.current = null;
    setYouTubeControlState((current) => ({
      ...current,
      isReady: true,
      playbackState: "paused"
    }));
  }

  function handleYouTubePlaybackRateSelect(playbackRate: number) {
    const player = youtubePlayerRef.current;

    if (
      !player ||
      !youTubeControlState.isReady ||
      !youTubeControlState.availablePlaybackRates.includes(playbackRate)
    ) {
      return;
    }

    player.setPlaybackRate?.(playbackRate);

    if (effectiveYouTubeSelectedQuality !== "auto") {
      youTubePlaybackRatePreferenceRef.current = playbackRate;
      setYouTubeControlState((current) => ({
        ...current,
        playbackRate
      }));
    }

    closeYouTubeSettingsMenu();
  }

  function handleTvPlaybackRateConfirmed(playbackRate: number) {
    if (!manualYouTubePlaybackRates.includes(playbackRate)) return;

    youTubePlaybackRatePreferenceRef.current = playbackRate;
    youtubePlayerRef.current?.setPlaybackRate?.(playbackRate);
    setYouTubeControlState((current) => ({
      ...current,
      availablePlaybackRates: current.availablePlaybackRates.includes(playbackRate)
        ? current.availablePlaybackRates
        : [...current.availablePlaybackRates, playbackRate].sort((left, right) => left - right),
      playbackRate
    }));
  }

  function closeYouTubeSettingsMenu() {
    setYouTubeSettingsMenuOpen(false);
    setYouTubeSettingsMenuView("root");
  }

  function handleYouTubeSettingsMenuToggle() {
    if (youTubeSettingsMenuOpen) {
      closeYouTubeSettingsMenu();
      return;
    }

    setYouTubeSettingsMenuView("root");
    setYouTubeSettingsMenuOpen(true);
  }

  function handleMaterialsShortcut() {
    selectLessonTab("materials");

    window.requestAnimationFrame(() => {
      lessonSupportPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      document.getElementById("lesson-tab-materials")?.focus({ preventScroll: true });
    });
  }

  function handlePlayerFullscreen() {
    const playerFrame = lessonPlayerFrameRef.current;

    if (!playerFrame) {
      return;
    }

    if (document.fullscreenElement === playerFrame) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }

    void playerFrame.requestFullscreen().catch(() => undefined);
  }

  function handleTutorTimestampSeek(seconds: number) {
    if (isActiveLessonLocked || !activeLessonKey) return;
    const pendingSeek = queuePendingTutorSeek(pendingTutorSeekRef, activeLessonKey, seconds);

    if (!pendingSeek) return;
    handlePlayerStart();

    if (activeLesson?.video?.provider === "youtube") {
      const readyPlayer = readyYouTubePlayerRef.current;

      if (
        readyPlayer?.lessonId === activeLessonKey &&
        readyPlayer.player === youtubePlayerRef.current &&
        consumePendingTutorSeekForYouTube(readyPlayer.player, activeLessonKey)
      ) {
        setYouTubeControlState((current) => ({ ...current, playbackState: "buffering" }));
        readyPlayer.player.playVideo?.();
      }
    } else if (videoRef.current) {
      consumePendingTutorSeekForNativeVideo(videoRef.current, activeLessonKey);
    }

    lessonPlayerFrameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleLessonCompletionToggle(lessonId: string) {
    const nextCompletedLessonIds = new Set(completedLessonIds);
    const willCompleteLesson = !nextCompletedLessonIds.has(lessonId);

    if (!willCompleteLesson) {
      nextCompletedLessonIds.delete(lessonId);
    } else {
      nextCompletedLessonIds.add(lessonId);
    }

    const safeCompletedLessonIds = Array.from(nextCompletedLessonIds)
      .filter((completedLessonId) => allLessonIds.has(completedLessonId))
      .sort();

    void persistLessonProgress({
      completedLessonIds: safeCompletedLessonIds,
      contentId: item.id,
      durationSeconds: activeLessonDurationSeconds,
      lessonId,
      maxProgressPercent: willCompleteLesson
        ? 100
        : Math.max(
            lessonWatchStates[lessonId]?.maxProgressPercent ?? 0,
            lessonWatchStates[lessonId]?.progressPercent ?? activeLessonWatchedPercent
          ),
      progressPercent: willCompleteLesson ? 100 : activeLessonWatchedPercent,
      progressSeconds: willCompleteLesson
        ? activeLessonDurationSeconds ?? lessonWatchStates[lessonId]?.progressSeconds ?? 0
        : lessonWatchStates[lessonId]?.progressSeconds ?? 0,
      status: willCompleteLesson ? "completed" : "in_progress"
    });
    setCompletedLessonIds(nextCompletedLessonIds);
    setLessonWatchStates((current) => {
      const currentState = current[lessonId];
      const nextState = {
        ...(activeLessonDurationSeconds !== undefined ? { durationSeconds: activeLessonDurationSeconds } : {}),
        lastWatchedAt: new Date().toISOString(),
        maxProgressPercent: willCompleteLesson
          ? 100
          : Math.max(
              currentState?.maxProgressPercent ?? 0,
              currentState?.progressPercent ?? activeLessonWatchedPercent
            ),
        progressPercent: willCompleteLesson
          ? 100
          : Math.min(currentState?.progressPercent ?? activeLessonWatchedPercent, 99),
        progressSeconds: willCompleteLesson
          ? activeLessonDurationSeconds ?? currentState?.progressSeconds ?? 0
          : currentState?.progressSeconds ?? 0,
        status: willCompleteLesson ? "completed" : "in_progress"
      } satisfies LessonWatchState;
      const next = {
        ...current,
        [lessonId]: nextState
      };

      lessonWatchStatesRef.current = next;
      return next;
    });
  }

  function handleNativeVideoProgress(video: HTMLVideoElement, force = false, status: LessonWatchStatus = "in_progress") {
    if (!activeLessonKey) {
      return;
    }

    const durationSeconds = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : activeLessonDurationSeconds;
    const progressSeconds = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const progressPercent = durationSeconds && durationSeconds > 0
      ? clampProgressPercent((progressSeconds / durationSeconds) * 100)
      : activeLessonWatchedPercent;

    void syncLessonWatchProgress({
      durationSeconds,
      force,
      lessonId: activeLessonKey,
      progressPercent,
      progressSeconds,
      status
    });
  }

  function handleLessonReactionToggle(reaction: LessonReaction) {
    const nextLessonReactions = { ...lessonReactions };

    if (nextLessonReactions[activeLessonKey] === reaction) {
      delete nextLessonReactions[activeLessonKey];
    } else {
      nextLessonReactions[activeLessonKey] = reaction;
    }

    setLessonReactions(nextLessonReactions);

    void persistLessonProgress({
      contentId: item.id,
      durationSeconds: activeLessonWatchState?.durationSeconds ?? activeLessonDurationSeconds,
      lessonId: activeLessonKey,
      lessonReactions: nextLessonReactions,
      maxProgressPercent: activeLessonMaxWatchedPercent,
      progressPercent: activeLessonWatchedPercent,
      progressSeconds: activeLessonWatchState?.progressSeconds ?? 0,
      status: activeLessonWatchState?.status ?? "in_progress"
    });
  }

  function handleActiveLessonSavedChange(saved: boolean) {
    setSavedLessonOverrides((current) => ({
      ...current,
      [activeLessonKey]: saved
    }));
  }

  async function handleCommentReactionToggle(commentId: string, reactionId: CommentReaction) {
    const selectedReaction = commentReactionSelections[commentId] ?? null;
    const nextReaction = selectedReaction === reactionId ? null : reactionId;
    setCommentReactionMenuId(null);
    setCommentError("");

    setComments((current) => current.map((comment) => {
      const updateReactions = (reactions: Partial<Record<CommentReaction, number>>) => {
        if (selectedReaction === reactionId) {
          return applyCommentReactionDelta(reactions, reactionId, -1);
        }

        let nextReactions = { ...reactions };

        if (selectedReaction) {
          nextReactions = applyCommentReactionDelta(nextReactions, selectedReaction, -1);
        }

        return applyCommentReactionDelta(nextReactions, reactionId, 1);
      };

      if (comment.id === commentId) {
        return {
          ...comment,
          reactions: updateReactions(comment.reactions)
        };
      }

      if (!comment.replies?.length) {
        return comment;
      }

      let changedReply = false;
      const replies = comment.replies.map((reply) => {
        if (reply.id !== commentId) {
          return reply;
        }

        changedReply = true;

        return {
          ...reply,
          reactions: updateReactions(reply.reactions)
        };
      });

      return changedReply ? { ...comment, replies } : comment;
    }));

    setCommentReactionSelections((current) => {
      const next = { ...current };

      if (selectedReaction === reactionId) {
        delete next[commentId];
      } else {
        next[commentId] = reactionId;
      }

      return next;
    });

    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(commentId)}/reaction`, {
        body: JSON.stringify({ reaction: nextReaction }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = await response.json() as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel salvar a reacao.");
      }
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Nao foi possivel salvar a reacao.");
      void loadLessonComments(activeLessonKey);
    }
  }

  async function handleCommentReport(commentId: string) {
    setCommentError("");
    setReportedCommentIds((current) => {
      const next = new Set(current);
      next.add(commentId);
      return next;
    });
    setCommentMenuId(null);

    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(commentId)}/report`, {
        body: JSON.stringify({}),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json() as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel enviar a denuncia.");
      }
    } catch (error) {
      setReportedCommentIds((current) => {
        const next = new Set(current);
        next.delete(commentId);
        return next;
      });
      setCommentError(error instanceof Error ? error.message : "Nao foi possivel enviar a denuncia.");
    }
  }

  function handleReplyStart(parentCommentId: string, target: Pick<LessonCommentBase, "author" | "username">) {
    const mention = `@${target.username} `;

    setReplyTarget({
      author: target.author,
      parentCommentId,
      username: target.username
    });
    setCommentText((current) => {
      const trimmedBody = current.trimStart();

      if (trimmedBody.startsWith(mention)) {
        return current;
      }

      const nextBody = trimmedBody.replace(/^@[a-z0-9._-]+\s+/i, "");

      return `${mention}${nextBody}`;
    });
    selectLessonTab("comments");
    window.requestAnimationFrame(() => {
      commentInputRef.current?.focus();
    });
  }

  function handleReplyCancel() {
    setReplyTarget(null);
    setCommentText((current) => current.replace(/^@[a-z0-9._-]+\s+/i, ""));
  }

  function handleModuleOpen(courseModule: CourseModule) {
    if (activeModuleId === courseModule.id) {
      setActiveModuleId(null);
      return;
    }

    setActiveModuleId(courseModule.id);
  }

  function handleLessonSelect(courseModule: CourseModule, lesson: LessonPreview) {
    const releaseNotice =
      getReleaseRuleNotice(lesson.releaseRule, "aula") ??
      getReleaseRuleNotice(courseModule.releaseRule, "modulo");

    if (releaseNotice?.isLocked) {
      setActiveModuleId(courseModule.id);
      return;
    }

    if (lesson.id === activeLessonKey) {
      setActiveModuleId(courseModule.id);
      return;
    }

    const selectionRequest = lessonSelectionRequestRef.current + 1;
    lessonSelectionRequestRef.current = selectionRequest;

    void (async () => {
      await flushActiveLessonProgress();

      if (lessonSelectionRequestRef.current !== selectionRequest) {
        return;
      }

      setCommentText("");
      setReplyTarget(null);
      setCommentMenuId(null);
      setCommentReactionMenuId(null);
      pendingTutorSeekRef.current = null;
      readyYouTubePlayerRef.current = null;
      pendingYouTubePlayLessonIdRef.current = null;
      youTubePlaybackIntentLessonIdRef.current = null;
      setYouTubeControlState(initialYouTubeControlState);
      closeYouTubeSettingsMenu();
      setActiveModuleId(courseModule.id);
      setActiveEmbedResume({
        lessonId: lesson.id,
        seconds: lessonWatchStatesRef.current[lesson.id]?.progressSeconds ?? 0
      });
      setActiveLessonId(lesson.id);
    })();
  }

  function handleLessonRowKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    courseModule: CourseModule,
    lesson: LessonPreview
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleLessonSelect(courseModule, lesson);
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentText.trim();

    if (!body || commentSubmitting || !activeLessonKey) {
      return;
    }
    const submittedLessonId = activeLessonKey;
    const submittedReplyTarget = replyTarget;
    setCommentSubmitting(true);
    setCommentError("");

    try {
      const response = await fetch(`/api/comments/lessons/${encodeURIComponent(submittedLessonId)}`, {
        body: JSON.stringify({
          body,
          contentId: item.id,
          parentCommentId: submittedReplyTarget?.parentCommentId
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json() as { data?: LessonCommentRecord; error?: string };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Nao foi possivel enviar o comentario.");
      }

      setReplyTarget(null);
      setCommentText("");
      selectLessonTab("comments");
      await loadLessonComments(submittedLessonId);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Nao foi possivel enviar o comentario.");
    } finally {
      setCommentSubmitting(false);
    }
  }

  const primaryActionLabel = isActiveLessonLocked ? "Bloqueada" : isActiveLessonCompleted ? "Concluida" : "Concluir";
  const canSubmitComment = commentText.trim().length > 0 && !commentSubmitting && !isActiveLessonLocked;
  const returnHref = withAccessPreviewParam(`/conteudo/${returnContent?.id ?? item.id}`, accessPreviewMode);
  const returnLabel = returnContent?.title ?? item.title;

  function handleProgressAwareNavigation(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    startNavigation(href);

    void (async () => {
      await flushActiveLessonProgress();
      router.push(href);
    })();
  }

  function renderYouTubeCaptionsButton() {
    return (
      <button
        aria-label={youTubeCaptionsActionLabel}
        aria-pressed={youTubeCaptionsAvailable && youTubeCaptionsEnabled}
        className={`group/action relative grid h-10 w-10 shrink-0 place-items-center transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-45 sm:h-11 sm:w-11 ${
          youTubeCaptionsAvailable && youTubeCaptionsEnabled
            ? "text-[var(--accent)]"
            : "text-white"
        }`}
        disabled={!youTubeCaptionsAvailable}
        onClick={() => {
          setYouTubeCaptionsEnabled((current) => !current);
          closeYouTubeSettingsMenu();
        }}
        type="button"
      >
        <ActionTooltip label={youTubeCaptionsActionLabel} />
        <ClosedCaption className="h-5 w-5" strokeWidth={2} />
      </button>
    );
  }

  function renderYouTubeQualityControl(placement: "above" | "below") {
    const panelId = `youtube-settings-${placement}`;
    const playbackRateLabel = formatPlaybackRate(youTubeControlState.playbackRate);
    const playbackRateSummary = getPlaybackRateMenuLabel(youTubeControlState.playbackRate);
    const qualitySummary = effectiveYouTubeSelectedQuality === "auto"
      ? effectiveYouTubeAutomaticQuality
        ? `Automático (${getYouTubeQualityDisplayName(effectiveYouTubeAutomaticQuality)})`
        : "Automático"
      : effectiveYouTubeSelectedQuality;

    return (
      <div className="group/action relative" data-youtube-settings-control>
        <button
          aria-controls={panelId}
          aria-expanded={youTubeSettingsMenuOpen}
          aria-label={`Configuracoes do video: velocidade ${playbackRateLabel}, qualidade ${effectiveYouTubeQualityDescription}`}
          className={`relative grid h-10 w-10 shrink-0 place-items-center transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-11 sm:w-11 ${
            youTubeSettingsMenuOpen ? "text-[var(--accent)]" : "text-white"
          }`}
          onClick={handleYouTubeSettingsMenuToggle}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeYouTubeSettingsMenu();
            }
          }}
          type="button"
        >
          <Settings className="h-5 w-5" strokeWidth={2} />
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 rounded-[2px] bg-[var(--accent)] px-0.5 text-[7px] font-black leading-[10px] tracking-[-0.02em] text-white shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:right-0.5 sm:top-0.5"
            data-youtube-quality-badge
          >
            {getYouTubeQualityBadge(effectiveYouTubeQualityBadgeSource)}
          </span>
        </button>

        {youTubeSettingsMenuOpen ? (
          <div
            aria-label="Configuracoes do video"
            className={`absolute -right-10 w-[min(26rem,calc(100vw-1rem))] rounded-2xl border border-white/10 bg-black/85 p-1.5 text-left text-white shadow-2xl shadow-black/50 backdrop-blur-xl sm:right-0 ${
              placement === "above" ? "bottom-full mb-2" : "top-full mt-2"
            }`}
            data-youtube-settings-menu
            id={panelId}
            role="menu"
          >
            {youTubeSettingsMenuView === "root" ? (
              <div data-youtube-settings-root>
                <button
                  className="grid min-h-12 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-normal transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  onClick={() => setYouTubeSettingsMenuView("playbackRate")}
                  role="menuitem"
                  type="button"
                >
                  <Gauge className="h-5 w-5 text-zinc-100" strokeWidth={1.8} />
                  <span>Velocidade de reprodução</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-sm font-normal text-zinc-300">
                    {playbackRateSummary}
                    <ChevronRight className="h-4 w-4 text-zinc-400" strokeWidth={1.5} />
                  </span>
                </button>
                <button
                  className="grid min-h-12 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-normal transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  onClick={() => setYouTubeSettingsMenuView("quality")}
                  role="menuitem"
                  type="button"
                >
                  <SlidersHorizontal className="h-5 w-5 text-zinc-100" strokeWidth={1.8} />
                  <span>Qualidade</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-normal text-zinc-300">
                    <span className="max-w-40 truncate">{qualitySummary}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" strokeWidth={1.5} />
                  </span>
                </button>
              </div>
            ) : (
              <>
                <div className="flex h-11 items-center border-b border-white/10 px-1" data-youtube-settings-submenu-header>
                  <button
                    aria-label="Voltar para configuracoes"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                    onClick={() => setYouTubeSettingsMenuView("root")}
                    type="button"
                  >
                    <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
                  </button>
                  <p className="min-w-0 flex-1 pr-9 text-center text-sm font-medium">
                    {youTubeSettingsMenuView === "playbackRate" ? "Velocidade de reprodução" : "Qualidade"}
                  </p>
                </div>

                {youTubeSettingsMenuView === "playbackRate" ? (
                  <div className="py-1" data-youtube-playback-rate-menu>
                    {youTubeControlState.availablePlaybackRates.map((playbackRate) => (
                      <button
                        aria-checked={youTubeControlState.playbackRate === playbackRate}
                        className="flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-normal transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                        disabled={!youTubeControlState.isReady}
                        key={playbackRate}
                        onClick={() => handleYouTubePlaybackRateSelect(playbackRate)}
                        role="menuitemradio"
                        type="button"
                      >
                        <span>{getPlaybackRateMenuLabel(playbackRate)}</span>
                        {youTubeControlState.playbackRate === playbackRate ? (
                          <Check className="h-4 w-4 text-[var(--accent)]" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-1" data-youtube-quality-menu>
                    {youTubeAvailableQualities.map((quality) => (
                      <button
                        aria-checked={effectiveYouTubeSelectedQuality === quality.label}
                        className="flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-normal transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                        key={quality.itag}
                        onClick={() => handleYouTubeQualitySelect(quality.label)}
                        role="menuitemradio"
                        type="button"
                      >
                        <span>{quality.label}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-[11px] font-normal text-zinc-500">
                            {quality.width}x{quality.height}
                          </span>
                          {effectiveYouTubeSelectedQuality === quality.label ? (
                            <Check className="h-4 w-4 text-[var(--accent)]" />
                          ) : null}
                        </span>
                      </button>
                    ))}

                    {youTubeStreamsStatus === "loading" ? (
                      <p className="px-3 py-2 text-[11px] font-medium text-zinc-400" role="status">
                        Carregando resolucoes...
                      </p>
                    ) : null}

                    {youTubeStreamsStatus === "error" ? (
                      <button
                        className="mt-1 w-full rounded-md px-3 py-2 text-left text-[11px] font-bold text-zinc-300 transition hover:bg-white/10 hover:text-white"
                        onClick={() => setYouTubeStreamsReloadToken((current) => current + 1)}
                        type="button"
                      >
                        Tentar carregar resolucoes novamente
                      </button>
                    ) : null}

                    <button
                      aria-checked={effectiveYouTubeSelectedQuality === "auto"}
                      className="flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-normal transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                      onClick={() => handleYouTubeQualitySelect("auto")}
                      role="menuitemradio"
                      type="button"
                    >
                      Automático
                      {effectiveYouTubeSelectedQuality === "auto" ? <Check className="h-4 w-4 text-[var(--accent)]" /> : null}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  function renderPlayerFullscreenButton() {
    return (
      <button
        aria-label={isPlayerFullscreen ? "Sair da tela cheia" : "Tela cheia"}
        aria-pressed={isPlayerFullscreen}
        className="group/action relative grid h-10 w-10 shrink-0 place-items-center text-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-11 sm:w-11"
        onClick={handlePlayerFullscreen}
        type="button"
      >
        <ActionTooltip label={isPlayerFullscreen ? "Sair da tela cheia" : "Tela cheia"} />
        {isPlayerFullscreen ? (
          <Minimize className="h-5 w-5" strokeWidth={2} />
        ) : (
          <Maximize className="h-5 w-5" strokeWidth={2} />
        )}
      </button>
    );
  }

  return (
    <section className="relative mt-6">
      <nav aria-label="Breadcrumb" className="mb-4 flex min-h-10 flex-wrap items-center gap-2 text-xs font-semibold text-zinc-500 sm:text-sm">
        <Link
          className="transition hover:text-white"
          href={withAccessPreviewParam("/", accessPreviewMode)}
          onClick={(event) => handleProgressAwareNavigation(event, withAccessPreviewParam("/", accessPreviewMode))}
          prefetch={false}
        >
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          className="transition hover:text-white"
          href={returnHref}
          onClick={(event) => handleProgressAwareNavigation(event, returnHref)}
          prefetch={false}
        >
          {returnLabel}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        {returnContent ? (
          <>
            <span className="text-zinc-300">{item.title}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </>
        ) : null}
        <span>{activeModule.title}</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-zinc-300">{activeLesson.title}</span>
      </nav>

      <div className={`lesson-experience-grid relative grid gap-6 ${playlistOpen ? "" : "lesson-experience-grid-collapsed"}`}>
        <div className="lesson-main-content min-w-0">
          <div
            className="lesson-player-frame group/player relative z-0 aspect-video overflow-visible rounded-[8px] bg-black shadow-[0_32px_90px_rgba(0,0,0,0.58)]"
            ref={lessonPlayerFrameRef}
          >
            <div
              className={isPlayerFullscreen
                ? "absolute left-1/2 top-1/2 aspect-video w-full max-w-[177.7778vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-black"
                : "absolute inset-0 overflow-hidden rounded-[8px] bg-black"}
              data-lesson-player-stage
            >
              {!isActiveLessonLocked && activePlayerRenderConfig ? (
                activePlayerRenderConfig.kind === "video" ? (
                  <video
                    className="h-full w-full bg-black object-contain"
                    controls
                    onCanPlay={(event) => {
                      consumePendingTutorSeekForNativeVideo(event.currentTarget, activeLessonKey);
                    }}
                    onEnded={(event) => handleNativeVideoProgress(event.currentTarget, true, "completed")}
                    onLoadedMetadata={(event) => {
                      if (consumePendingTutorSeekForNativeVideo(event.currentTarget, activeLessonKey)) return;
                      const resumeSeconds = initialResumeSecondsRef.current[activeLessonKey] ?? 0;

                      if (
                        resumeSeconds > 0 &&
                        Number.isFinite(event.currentTarget.duration) &&
                        resumeSeconds < event.currentTarget.duration
                      ) {
                        event.currentTarget.currentTime = resumeSeconds;
                      }
                    }}
                    onPause={(event) => handleNativeVideoProgress(event.currentTarget, true)}
                    onPlay={(event) => {
                      handlePlayerStart();
                      handleNativeVideoProgress(event.currentTarget, true);
                    }}
                    onTimeUpdate={(event) => handleNativeVideoProgress(event.currentTarget)}
                    poster={videoPosterImage}
                    ref={videoRef}
                    src={activePlayerRenderConfig.src}
                  />
                ) : canRenderEmbeddedPlayer ? (
                  selectedYouTubeManualStream && youTubeStreamsResult.audio ? (
                    <YouTubeManualStreamPlayer
                      audioUrl={youTubeStreamsResult.audio.url}
                      initialMuted={youTubeControlState.isMuted}
                      initialPlaybackRate={youTubeControlState.playbackRate}
                      initialVolume={youTubeControlState.volume}
                      key={`${activeLessonKey}-manual-stream`}
                      onAutoplayBlocked={handleManualYouTubeAutoplayBlocked}
                      onControllerReady={handleManualYouTubeControllerReady}
                      onEnded={handleManualYouTubeEnded}
                      onError={handleManualYouTubeError}
                      onPlaybackStateChange={handleManualYouTubePlaybackStateChange}
                      posterUrl={videoPosterImage}
                      shouldPlay={
                        youTubeManualSwitch.lessonId === activeLessonKey &&
                        youTubeManualSwitch.shouldPlay
                      }
                      startSeconds={
                        youTubeManualSwitch.lessonId === activeLessonKey
                          ? youTubeManualSwitch.seconds
                          : youTubeCurrentTime
                      }
                      switchToken={youTubeManualSwitch.token}
                      videoUrl={selectedYouTubeManualStream.url}
                    />
                  ) : (
                    <iframe
                      allow={usesCustomYouTubeControls ? "autoplay; encrypted-media" : "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"}
                      allowFullScreen={!usesCustomYouTubeControls}
                      aria-hidden={usesCustomYouTubeControls ? "true" : undefined}
                      className={usesCustomYouTubeControls
                        ? "pointer-events-none absolute left-1/2 top-0 h-full w-[300%] max-w-none -translate-x-1/2 select-none border-0"
                        : "h-full w-full border-0"}
                      key={`${activeLessonKey}-${youTubeReloadToken}`}
                      onError={usesCustomYouTubeControls ? () => {
                        setYouTubeControlState((current) => ({
                          ...current,
                          errorCode: null,
                          isReady: false,
                          playbackState: "error"
                        }));
                      } : undefined}
                      ref={
                        activeLesson.video?.provider === "youtube" && activePlayerRenderConfig.kind === "iframe"
                          ? youtubeIframeRef
                          : undefined
                      }
                      referrerPolicy="strict-origin-when-cross-origin"
                      sandbox={usesCustomYouTubeControls
                        ? "allow-same-origin allow-scripts allow-presentation"
                        : "allow-same-origin allow-scripts allow-presentation allow-popups"}
                      src={activePlayerRenderConfig.kind === "iframe" ? activePlayerRenderConfig.src : undefined}
                      srcDoc={activePlayerRenderConfig.kind === "srcdoc" ? activePlayerRenderConfig.srcDoc : undefined}
                      tabIndex={usesCustomYouTubeControls ? -1 : undefined}
                      title={activeLesson.title}
                    />
                  )
                ) : (
                  <>
                    <div
                      className="absolute inset-0 bg-cover bg-center opacity-78"
                      style={{ backgroundImage: `url(${videoPosterImage})` }}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.72),rgba(0,0,0,0.18)_52%,rgba(0,0,0,0.58))]" />
                    <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/[0.72] to-transparent" />
                  </>
                )
              ) : (
                <>
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-78"
                    style={{ backgroundImage: `url(${posterImage})` }}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.72),rgba(0,0,0,0.18)_52%,rgba(0,0,0,0.58))]" />
                  <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/[0.72] to-transparent" />
                </>
              )}
            </div>

          {usesCustomYouTubeControls && canRenderEmbeddedPlayer ? (
            <>
              {/*
                UX containment only: the iframe remains a YouTube embed. Its video ID is still
                discoverable in page/network inspection, and YouTube UI changes can require
                adjustments to the oversized edge crop. This is not DRM or source protection.
              */}
              {activeLessonStarted && activeYouTubeCaptionCue ? (
                <div
                  aria-live="off"
                  className="pointer-events-none absolute inset-x-[6%] bottom-28 z-20 flex justify-center sm:inset-x-[10%] sm:bottom-20"
                  data-youtube-custom-caption
                >
                  <span className="max-w-full whitespace-pre-line text-center text-sm font-bold leading-snug text-white [text-shadow:0_2px_2px_rgba(0,0,0,1),0_0_6px_rgba(0,0,0,0.95)] sm:text-lg lg:text-xl">
                    {activeYouTubeCaptionCue.text}
                  </span>
                </div>
              ) : null}

              {activeLessonStarted ? (
                <button
                  aria-label={youTubeControlState.playbackState === "error"
                    ? "Tentar reproduzir o video novamente"
                    : `${youTubePlaybackActionLabel} aula`}
                  className="absolute inset-0 z-10 overflow-hidden rounded-[8px] bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  data-youtube-interaction-shield
                  onClick={handleYouTubePlaybackToggle}
                  type="button"
                >
                  {youTubeControlState.playbackState === "ended" || youTubeControlState.playbackState === "error" ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${videoPosterImage})` }}
                      />
                      <span aria-hidden="true" className="absolute inset-0 bg-black/60" />
                      {youTubeControlState.playbackState === "ended" ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-2xl shadow-black/60 sm:h-20 sm:w-20"
                        >
                          <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" />
                        </span>
                      ) : (
                        <span className="absolute left-1/2 top-1/2 w-[min(28rem,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 text-center text-white">
                          <span className="block text-sm font-bold sm:text-base">
                            {getYouTubePlayerErrorMessage(youTubeControlState.errorCode)}
                          </span>
                          <span className="mt-2 block text-xs font-semibold text-zinc-300 sm:text-sm">
                            Clique para tentar novamente.
                          </span>
                        </span>
                      )}
                    </>
                  ) : null}
                </button>
              ) : null}

              {activeLessonStarted ? (
                <div
                  aria-label="Controles do video"
                  className={`pointer-events-none absolute inset-x-2 bottom-1.5 z-30 flex flex-col gap-0.5 text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.95)] transition-opacity duration-200 sm:inset-x-4 sm:bottom-2 ${
                    isYouTubePlaying && !youTubeSettingsMenuOpen
                      ? "opacity-100 sm:opacity-0 sm:group-hover/player:opacity-100 sm:group-focus-within/player:opacity-100"
                      : "opacity-100"
                  }`}
                  data-youtube-custom-controls
                  role="group"
                >
                  <input
                    aria-label="Progresso do video"
                    aria-valuetext={`${formatPlaybackTime(youTubeCurrentTime)} de ${formatPlaybackTime(youTubeDuration)}`}
                    className="bunker-player-timeline pointer-events-auto w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!youTubeControlState.isReady || youTubeDuration <= 0}
                    max={Math.max(youTubeDuration, 1)}
                    min="0"
                    onInput={handleYouTubeSeek}
                    step="0.1"
                    style={{ "--player-progress": `${youTubeProgressPercent}%` } as CSSProperties}
                    type="range"
                    value={youTubeCurrentTime}
                  />

                  <div
                    aria-hidden="true"
                    className="flex items-center justify-between px-1 text-[10px] font-medium leading-none tabular-nums text-white sm:hidden"
                    data-youtube-mobile-time
                  >
                    <span>{formatPlaybackTime(youTubeCurrentTime)}</span>
                    <span>{formatPlaybackTime(youTubeDuration)}</span>
                  </div>

                  <div className="flex min-w-0 items-center justify-between gap-0 sm:gap-2">
                    <div
                      className="pointer-events-auto flex min-w-0 items-center"
                      data-youtube-primary-controls
                    >
                      <button
                        aria-label={youTubePlaybackActionLabel}
                        className="group/action relative grid h-10 w-10 shrink-0 place-items-center text-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-11 sm:w-11"
                        onClick={handleYouTubePlaybackToggle}
                        type="button"
                      >
                        <ActionTooltip label={youTubePlaybackActionLabel} />
                        {isYouTubePlaying ? (
                          <Pause className="h-5 w-5 fill-current" strokeWidth={2} />
                        ) : (
                          <Play className="ml-0.5 h-5 w-5 fill-current" strokeWidth={2} />
                        )}
                      </button>

                      <button
                        aria-label="Retroceder 10 segundos"
                        className="group/action relative grid h-10 w-10 shrink-0 place-items-center text-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-11 sm:w-11"
                        disabled={!youTubeControlState.isReady}
                        onClick={() => handleYouTubeSkip(-10)}
                        type="button"
                      >
                        <ActionTooltip label="Retroceder 10 segundos" />
                        <RotateCcw className="h-6 w-6" strokeWidth={2} />
                        <span aria-hidden="true" className="absolute text-[8px] font-extrabold leading-none">10</span>
                      </button>

                      <button
                        aria-label="Avancar 10 segundos"
                        className="group/action relative grid h-10 w-10 shrink-0 place-items-center text-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-11 sm:w-11"
                        disabled={!youTubeControlState.isReady}
                        onClick={() => handleYouTubeSkip(10)}
                        type="button"
                      >
                        <ActionTooltip label="Avancar 10 segundos" />
                        <RotateCw className="h-6 w-6" strokeWidth={2} />
                        <span aria-hidden="true" className="absolute text-[8px] font-extrabold leading-none">10</span>
                      </button>

                      <button
                        aria-label={youTubeControlState.isMuted ? "Ativar som" : "Silenciar"}
                        className="group/action relative grid h-10 w-10 shrink-0 place-items-center text-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-11 sm:w-11"
                        disabled={!youTubeControlState.isReady}
                        onClick={handleYouTubeMuteToggle}
                        type="button"
                      >
                        <ActionTooltip label={youTubeControlState.isMuted ? "Ativar som" : "Silenciar"} />
                        {youTubeControlState.isMuted || youTubeControlState.volume === 0 ? (
                          <VolumeX className="h-5 w-5" strokeWidth={2} />
                        ) : (
                          <Volume2 className="h-5 w-5" strokeWidth={2} />
                        )}
                      </button>

                      <input
                        aria-label="Volume"
                        aria-valuetext={`${youTubeControlState.isMuted ? 0 : Math.round(youTubeControlState.volume)} por cento`}
                        className="hidden h-11 w-14 cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-50 md:block lg:w-16"
                        disabled={!youTubeControlState.isReady}
                        max="100"
                        min="0"
                        onInput={handleYouTubeVolumeChange}
                        step="1"
                        type="range"
                        value={youTubeControlState.isMuted ? 0 : youTubeControlState.volume}
                      />

                      <span
                        aria-label={`${formatPlaybackTime(youTubeCurrentTime)} de ${formatPlaybackTime(youTubeDuration)}`}
                        className="ml-2 hidden shrink-0 text-xs font-medium tabular-nums text-white sm:inline"
                      >
                        {formatPlaybackTime(youTubeCurrentTime)} / {formatPlaybackTime(youTubeDuration)}
                      </span>
                    </div>

                    <div
                      className="pointer-events-auto flex shrink-0 items-center"
                      data-youtube-secondary-controls
                    >
                      {renderYouTubeCaptionsButton()}
                      {renderYouTubeQualityControl("above")}
                      {renderPlayerFullscreenButton()}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {showPlayerClickOverlay ? (
            <button
              aria-label={isYouTubePlayerPreparing
                ? "Preparando video"
                : youTubeControlState.playbackState === "error"
                  ? "Tentar carregar a aula novamente"
                  : "Reproduzir aula"}
              className={`absolute inset-0 z-30 overflow-hidden rounded-[8px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                showPlayerPosterOverlay ? "bg-black" : "bg-transparent"
              } disabled:cursor-wait`}
              disabled={isYouTubePlayerPreparing}
              onClick={usesCustomYouTubeControls ? handleYouTubePlaybackToggle : handlePlayerStart}
              type="button"
            >
              {showPlayerPosterOverlay ? (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 bg-cover bg-center opacity-95 transition duration-500 group-hover/player:scale-[1.015]"
                    style={{ backgroundImage: `url(${videoPosterImage})` }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.64),rgba(0,0,0,0.12)_52%,rgba(0,0,0,0.52))]"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/85 via-black/35 to-transparent"
                  />
                </>
              ) : null}
              {showPlayerPosterOverlay && activeLessonWatchedPercent > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-5 bottom-5 h-1 overflow-hidden rounded-full bg-white/24 sm:inset-x-6"
                >
                  <span
                    className="block h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${activeLessonWatchedPercent}%` }}
                  />
                </span>
              ) : null}
            </button>
          ) : null}

          <Link
            aria-label={`Voltar para ${returnLabel}`}
            className="group/action absolute left-3 top-3 z-30 grid h-11 w-11 place-items-center rounded-full text-white opacity-0 transition duration-200 hover:bg-black/35 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white group-hover/player:opacity-100 max-lg:opacity-100 sm:left-4 sm:top-4 sm:h-12 sm:w-12"
            href={returnHref}
            onClick={(event) => handleProgressAwareNavigation(event, returnHref)}
            prefetch={false}
          >
            <ActionTooltip elevated label="Voltar" />
            <ArrowLeft className="h-7 w-7 stroke-[2.4] sm:h-8 sm:w-8" />
          </Link>

          {!playlistOpen ? (
            <button
              aria-label="Mostrar listagem de aulas"
              className="group/action absolute right-4 top-4 z-30 grid h-11 w-11 place-items-center rounded-full text-white transition duration-200 hover:bg-black/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white max-xl:hidden sm:h-12 sm:w-12"
              onClick={() => setPlaylistOpen(true)}
              type="button"
            >
              <ActionTooltip elevated label="Mostrar aulas" />
              <GalleryVerticalEnd className="h-6 w-6 stroke-[2.35] sm:h-7 sm:w-7" />
            </button>
          ) : null}

          {isActiveLessonLocked ? (
            <div className="absolute left-1/2 top-1/2 z-40 w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[8px] border border-white/12 bg-black/76 p-5 text-center shadow-2xl shadow-black/60 backdrop-blur">
              <LockKeyhole className="mx-auto h-9 w-9 stroke-[2.6] text-white" />
              <p className="mt-3 text-lg font-black leading-tight text-white">
                {activeReleaseNotice?.title ?? "Esta aula sera liberada"}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">
                {activeReleaseNotice?.detail ?? "Disponivel de acordo com a regra de entrega."}
              </p>
            </div>
          ) : activePlayerRenderConfig && !activeLessonStarted ? (
            activePlayerRenderConfig.kind === "video" ? (
              <button
                aria-label="Reproduzir aula"
                className="absolute left-1/2 top-1/2 z-40 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-2xl shadow-black/55 transition hover:scale-105 hover:bg-zinc-200 sm:h-20 sm:w-20"
                onClick={() => {
                  handlePlayerStart();
                  void videoRef.current?.play();
                }}
                type="button"
              >
                <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" />
              </button>
            ) : (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 z-40 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-2xl shadow-black/55 sm:h-20 sm:w-20"
              >
                <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" />
              </span>
            )
          ) : activePlayerRenderConfig ? null : (
            <button
              aria-label="Reproduzir aula"
              className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-2xl shadow-black/55 transition hover:scale-105 hover:bg-zinc-200 sm:h-20 sm:w-20"
              onClick={handlePlayerStart}
              type="button"
            >
              <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" />
            </button>
          )}

          {!activePlayerRenderConfig ? (
            <div className="absolute inset-x-4 bottom-4 sm:inset-x-6 sm:bottom-5">
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${activeLessonWatchedPercent}%` }} />
              </div>
              <div className="flex items-center justify-between gap-4 text-xs font-semibold text-zinc-300">
                <span className="truncate">12:48 / {activeLesson.duration}</span>
                <div className="flex items-center gap-3">
                  <button
                    aria-label="Volume"
                    className="group/action relative grid h-8 w-8 place-items-center rounded-full text-zinc-300 transition hover:scale-105 hover:bg-white hover:text-black"
                    type="button"
                  >
                    <ActionTooltip label="Volume" />
                    <Volume2 className="h-4 w-4" />
                  </button>
                  <button
                    aria-label="Tela cheia"
                    className="group/action relative grid h-8 w-8 place-items-center rounded-full text-zinc-300 transition hover:scale-105 hover:bg-white hover:text-black"
                    type="button"
                  >
                    <ActionTooltip label="Tela cheia" />
                    <Maximize className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="lesson-details-header mt-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="max-w-5xl text-2xl font-black leading-tight text-[#ffffff] sm:text-3xl lg:text-4xl">
              {activeLesson.title}
            </h1>
            <p className="mt-4 max-w-4xl text-sm leading-6 text-zinc-300 sm:text-base sm:leading-7">
              {activeLesson.description}
            </p>
          </div>

          <div className="w-full space-y-3 lg:w-auto lg:min-w-[420px] lg:max-w-none">
            <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
              <button
                aria-label={isActiveLessonCompleted ? "Desmarcar aula atual como concluida" : "Concluir aula atual"}
                aria-pressed={isActiveLessonCompleted}
                className={`lesson-primary-complete-button group/complete relative inline-flex min-h-12 min-w-[9rem] items-center justify-center gap-2 overflow-hidden rounded-[8px] px-5 py-3 text-sm font-extrabold shadow-2xl shadow-black/30 transition duration-200 hover:scale-[1.02] hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:scale-100 sm:min-w-[10rem] ${
                  isActiveLessonCompleted ? "lesson-primary-complete-button-done" : ""
                }`}
                disabled={isActiveLessonLocked}
                onClick={handlePrimaryLessonAction}
                style={isActiveLessonCompleted ? { backgroundColor: "#059669", color: "#ffffff" } : undefined}
                type="button"
              >
                {isActiveLessonCompleted ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 transition group-hover/complete:brightness-110"
                    style={{ backgroundColor: "#059669" }}
                  />
                ) : null}
                <Check
                  className="relative z-10 h-[18px] w-[18px] shrink-0 stroke-[2.8]"
                  style={isActiveLessonCompleted ? { color: "#ffffff" } : undefined}
                />
                <span className="relative z-10" style={isActiveLessonCompleted ? { color: "#ffffff" } : undefined}>
                  {primaryActionLabel}
                </span>
              </button>
              <button
                aria-label="Abrir materiais"
                className={lessonIconButtonClassName}
                onClick={handleMaterialsShortcut}
                type="button"
              >
                <ActionTooltip label="Materiais" />
                <Download className="h-5 w-5 stroke-[2.35]" />
              </button>
              <LessonTvControl
                buttonClassName={lessonIconButtonClassName}
                captionsEnabled={youTubeCaptionsEnabled}
                contentId={item.id}
                currentTimeSeconds={activeLessonVideoProvider === "youtube"
                  ? youTubeCurrentTime
                  : activeLessonWatchState?.progressSeconds ?? 0}
                durationSeconds={activeLessonDurationSeconds ?? 0}
                isPlaying={isYouTubePlaying}
                key={activeLesson.id}
                lessonId={activeLesson.id}
                lessonTitle={activeLesson.title}
                muted={youTubeControlState.isMuted}
                onConnected={handleTvReceiverConnected}
                onPlaybackRateConfirmed={handleTvPlaybackRateConfirmed}
                playbackRate={youTubeControlState.playbackRate}
                quality={effectiveYouTubeSelectedQuality}
                volume={youTubeControlState.volume}
              />
              <span className="group/action relative inline-grid">
                <ActionTooltip label={activeLessonSaved ? "Remover da Minha lista" : "Adicionar a Minha lista"} />
                <SavedItemButton
                  className={lessonIconButtonClassName}
                  iconClassName="h-5 w-5 stroke-[2.35]"
                  initialSaved={activeLessonSaved}
                  key={activeLesson.id}
                  onSavedChange={handleActiveLessonSavedChange}
                  targetId={activeLesson.id}
                  targetTitle={activeLesson.title}
                  targetType="lesson"
                />
              </span>
              {canRateLesson ? (
                <LessonReactionControl
                  onToggle={handleLessonReactionToggle}
                  value={lessonReaction}
                />
              ) : null}
            </div>

            <button
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold text-zinc-200 transition hover:bg-white/[0.08] hover:text-white xl:hidden"
              onClick={() => setPlaylistOpen((current) => !current)}
              type="button"
            >
              {playlistOpen ? <PanelRightClose className="h-4 w-4" /> : <GalleryVerticalEnd className="h-4 w-4" />}
              {playlistOpen ? "Esconder aulas" : "Aulas"}
            </button>
          </div>
        </div>

        <div
          className="lesson-support-panel mt-8 scroll-mt-24 overflow-visible rounded-[8px] border border-white/10 bg-[#181818]"
          ref={lessonSupportPanelRef}
        >
          <div aria-label="Conteúdo da aula" className="flex overflow-x-auto border-b border-white/10" role="tablist">
            {[
              { id: "comments" as const, label: "Comentários", count: totalCommentCount, icon: MessageCircle },
              { id: "materials" as const, label: "Materiais", count: lessonMaterials.length, icon: FileText },
              { id: "aiTutor" as const, label: "Tutor IA", count: null, icon: TutorAiIcon }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  aria-controls={`lesson-panel-${tab.id}`}
                  aria-selected={isActive}
                  className={`relative inline-flex min-h-14 shrink-0 items-center gap-2 px-4 text-sm font-extrabold transition sm:px-6 ${
                    isActive ? "text-white" : "text-zinc-400 hover:text-white"
                  }`}
                  id={`lesson-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => selectLessonTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                  {tab.label}
                  {tab.count !== null ? (
                    <span className="grid min-w-6 place-items-center rounded-full bg-white/10 px-1.5 py-0.5 text-xs text-zinc-200">
                      {tab.count}
                    </span>
                  ) : null}
                  {isActive ? (
                    <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[var(--accent)] sm:inset-x-6" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {activeTab === "comments" ? (
            <div
              aria-labelledby="lesson-tab-comments"
              className="p-4 sm:p-6"
              id="lesson-panel-comments"
              role="tabpanel"
            >
              <div className="divide-y divide-white/[0.07]">
                {commentsLoading ? (
                  <div className="space-y-4 py-2" aria-label="Carregando comentarios">
                    {[0, 1].map((item) => (
                      <div className="flex animate-pulse gap-4 py-3" key={item}>
                        <span className="h-11 w-11 shrink-0 rounded-full bg-white/10" />
                        <span className="flex-1 space-y-2">
                          <span className="block h-4 w-40 rounded bg-white/10" />
                          <span className="block h-3 w-full max-w-2xl rounded bg-white/[0.06]" />
                          <span className="block h-3 w-3/5 rounded bg-white/[0.06]" />
                        </span>
                      </div>
                    ))}
                  </div>
                ) : comments.length === 0 ? (
                  <div className="py-8 text-center">
                    <MessageCircle className="mx-auto h-8 w-8 text-zinc-600" />
                    <p className="mt-3 text-sm font-bold text-zinc-200">Ainda nao ha comentarios nesta aula.</p>
                    <p className="mt-1 text-sm text-zinc-500">Compartilhe uma duvida ou insight para iniciar a conversa.</p>
                  </div>
                ) : comments.map((comment) => {
                  const selectedReaction = commentReactionSelections[comment.id] ?? null;
                  const isMenuOpen = commentMenuId === comment.id;
                  const isReported = reportedCommentIds.has(comment.id);

                  return (
                    <article className="group/comment relative flex gap-3 py-5 first:pt-0 last:pb-4 sm:gap-4" key={comment.id}>
                      <CommentAvatar avatar={comment.avatar} />

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <h3 className="text-sm font-extrabold text-white">{comment.author}</h3>
                              {comment.role === "Professor" ? (
                                <span className="rounded-[6px] border border-[var(--accent)]/40 bg-[var(--accent)]/12 px-1.5 py-0.5 text-[10px] font-black uppercase text-red-100">
                                  Professor
                                </span>
                              ) : null}
                              <span className="text-xs font-semibold text-zinc-500">{comment.time}</span>
                              {comment.status === "pending" ? (
                                <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                                  Aguardando moderacao
                                </span>
                              ) : null}
                            </div>
                            <CommentBody body={comment.body} className="mt-1 max-w-3xl text-sm leading-6 text-zinc-300" />
                          </div>

                          <div className="relative shrink-0" data-comment-popover-root>
                            <button
                              aria-expanded={isMenuOpen}
                              aria-haspopup="menu"
                              aria-label={`Mais opcoes para comentario de ${comment.author}`}
                              className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 opacity-100 transition hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:opacity-0 sm:group-hover/comment:opacity-100 sm:group-focus-within/comment:opacity-100"
                              disabled={comment.isOwn}
                              onClick={() => {
                                setCommentReactionMenuId(null);
                                setCommentMenuId((current) => (current === comment.id ? null : comment.id));
                              }}
                              type="button"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>

                            {isMenuOpen && !comment.isOwn ? (
                              <div className="absolute right-0 top-9 z-30 min-w-[14.25rem] overflow-hidden rounded-[8px] border border-white/10 bg-[#242424] p-1.5 shadow-2xl shadow-black/60">
                                <button
                                  className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-[6px] px-3 py-2.5 text-left text-[13px] font-semibold leading-none text-zinc-200 transition hover:bg-white/10 hover:text-white disabled:cursor-default disabled:text-zinc-500 disabled:hover:bg-transparent"
                                  disabled={isReported}
                                  onClick={() => handleCommentReport(comment.id)}
                                  role="menuitem"
                                  type="button"
                                >
                                  <Flag className="h-[18px] w-[18px] shrink-0" />
                                  {isReported ? "Denuncia enviada" : "Denunciar comentario"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {commentReactionOptions.map((reaction) => {
                            const count = comment.reactions[reaction.id] ?? 0;
                            const isSelected = selectedReaction === reaction.id;

                            if (count === 0 && !isSelected) {
                              return null;
                            }

                            return (
                              <button
                                aria-label={`${reaction.label} no comentario de ${comment.author}`}
                                aria-pressed={isSelected}
                                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition ${
                                  isSelected
                                    ? "border-[var(--accent)]/70 bg-[var(--accent)]/15 text-white"
                                    : "border-white/12 bg-white/[0.055] text-zinc-200 hover:border-white/25 hover:bg-white/[0.085]"
                                }`}
                                key={reaction.id}
                                onClick={() => handleCommentReactionToggle(comment.id, reaction.id)}
                                type="button"
                              >
                                <span className="text-sm leading-none">{reaction.emoji}</span>
                                <span>{count}</span>
                              </button>
                            );
                          })}
                          <div className="relative" data-comment-popover-root>
                            <button
                              aria-expanded={commentReactionMenuId === comment.id}
                              aria-haspopup="menu"
                              aria-label={`Reagir ao comentario de ${comment.author}`}
                              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/[0.08] bg-transparent px-2.5 text-xs font-bold text-zinc-500 transition hover:border-white/20 hover:bg-white/[0.055] hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                              onClick={() => {
                                setCommentMenuId(null);
                                setCommentReactionMenuId((current) => (current === comment.id ? null : comment.id));
                              }}
                              type="button"
                            >
                              <SmilePlus className="h-3.5 w-3.5" />
                              Reagir
                            </button>

                            {commentReactionMenuId === comment.id ? (
                              <div className="absolute left-0 top-9 z-30 grid w-[13.75rem] grid-cols-5 gap-1.5 rounded-[14px] border border-white/10 bg-[#242424] p-2.5 shadow-2xl shadow-black/60">
                                {commentReactionOptions.map((reaction) => {
                                  const isSelected = selectedReaction === reaction.id;

                                  return (
                                    <button
                                      aria-label={`${reaction.label} no comentario de ${comment.author}`}
                                      className={`grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                                        isSelected ? "bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/60" : ""
                                      }`}
                                      key={reaction.id}
                                      onClick={() => handleCommentReactionToggle(comment.id, reaction.id)}
                                      role="menuitem"
                                      type="button"
                                    >
                                      {reaction.emoji}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                          {isReported ? (
                            <span className="ml-1 text-xs font-semibold text-zinc-500">Comentario reportado</span>
                          ) : null}
                          <button
                            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-transparent px-2 text-xs font-bold text-zinc-500 transition hover:bg-white/[0.055] hover:text-zinc-200"
                            onClick={() => handleReplyStart(comment.id, comment)}
                            type="button"
                          >
                            <Reply className="h-3.5 w-3.5" />
                            Responder
                          </button>
                        </div>

                        {comment.replies?.length ? (
                          <div className="mt-5 space-y-5 border-l border-white/10 pl-4 sm:ml-2 sm:pl-5">
                            {comment.replies.map((reply) => {
                              const selectedReplyReaction = commentReactionSelections[reply.id] ?? null;
                              const isReplyMenuOpen = commentMenuId === reply.id;
                              const isReplyReported = reportedCommentIds.has(reply.id);

                              return (
                                <article className="group/comment relative flex gap-3" key={reply.id}>
                                  <CommentAvatar avatar={reply.avatar} />

                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-start gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                          <h4 className="text-sm font-extrabold text-white">{reply.author}</h4>
                                          {reply.role === "Professor" ? (
                                            <span className="rounded-[6px] border border-[var(--accent)]/40 bg-[var(--accent)]/12 px-1.5 py-0.5 text-[10px] font-black uppercase text-red-100">
                                              Professor
                                            </span>
                                          ) : null}
                                          <span className="text-xs font-semibold text-zinc-500">{reply.time}</span>
                                          {reply.status === "pending" ? (
                                            <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                                              Aguardando moderacao
                                            </span>
                                          ) : null}
                                        </div>
                                        <CommentBody body={reply.body} className="mt-1 max-w-3xl text-sm leading-6 text-zinc-300" />
                                      </div>

                                      <div className="relative shrink-0" data-comment-popover-root>
                                        <button
                                          aria-expanded={isReplyMenuOpen}
                                          aria-haspopup="menu"
                                          aria-label={`Mais opcoes para comentario de ${reply.author}`}
                                          className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 opacity-100 transition hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:opacity-0 sm:group-hover/comment:opacity-100 sm:group-focus-within/comment:opacity-100"
                                          disabled={reply.isOwn}
                                          onClick={() => {
                                            setCommentReactionMenuId(null);
                                            setCommentMenuId((current) => (current === reply.id ? null : reply.id));
                                          }}
                                          type="button"
                                        >
                                          <MoreHorizontal className="h-4 w-4" />
                                        </button>

                                        {isReplyMenuOpen && !reply.isOwn ? (
                                          <div className="absolute right-0 top-9 z-30 min-w-[14.25rem] overflow-hidden rounded-[8px] border border-white/10 bg-[#242424] p-1.5 shadow-2xl shadow-black/60">
                                            <button
                                              className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-[6px] px-3 py-2.5 text-left text-[13px] font-semibold leading-none text-zinc-200 transition hover:bg-white/10 hover:text-white disabled:cursor-default disabled:text-zinc-500 disabled:hover:bg-transparent"
                                              disabled={isReplyReported}
                                              onClick={() => handleCommentReport(reply.id)}
                                              role="menuitem"
                                              type="button"
                                            >
                                              <Flag className="h-[18px] w-[18px] shrink-0" />
                                              {isReplyReported ? "Denuncia enviada" : "Denunciar comentario"}
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                      {commentReactionOptions.map((reaction) => {
                                        const count = reply.reactions[reaction.id] ?? 0;
                                        const isSelected = selectedReplyReaction === reaction.id;

                                        if (count === 0 && !isSelected) {
                                          return null;
                                        }

                                        return (
                                          <button
                                            aria-label={`${reaction.label} no comentario de ${reply.author}`}
                                            aria-pressed={isSelected}
                                            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition ${
                                              isSelected
                                                ? "border-[var(--accent)]/70 bg-[var(--accent)]/15 text-white"
                                                : "border-white/12 bg-white/[0.055] text-zinc-200 hover:border-white/25 hover:bg-white/[0.085]"
                                            }`}
                                            key={reaction.id}
                                            onClick={() => handleCommentReactionToggle(reply.id, reaction.id)}
                                            type="button"
                                          >
                                            <span className="text-sm leading-none">{reaction.emoji}</span>
                                            <span>{count}</span>
                                          </button>
                                        );
                                      })}
                                      <div className="relative" data-comment-popover-root>
                                        <button
                                          aria-expanded={commentReactionMenuId === reply.id}
                                          aria-haspopup="menu"
                                          aria-label={`Reagir ao comentario de ${reply.author}`}
                                          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/[0.08] bg-transparent px-2.5 text-xs font-bold text-zinc-500 transition hover:border-white/20 hover:bg-white/[0.055] hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                                          onClick={() => {
                                            setCommentMenuId(null);
                                            setCommentReactionMenuId((current) => (current === reply.id ? null : reply.id));
                                          }}
                                          type="button"
                                        >
                                          <SmilePlus className="h-3.5 w-3.5" />
                                          Reagir
                                        </button>

                                        {commentReactionMenuId === reply.id ? (
                                          <div className="absolute left-0 top-9 z-30 grid w-[13.75rem] grid-cols-5 gap-1.5 rounded-[14px] border border-white/10 bg-[#242424] p-2.5 shadow-2xl shadow-black/60">
                                            {commentReactionOptions.map((reaction) => {
                                              const isSelected = selectedReplyReaction === reaction.id;

                                              return (
                                                <button
                                                  aria-label={`${reaction.label} no comentario de ${reply.author}`}
                                                  className={`grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                                                    isSelected ? "bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/60" : ""
                                                  }`}
                                                  key={reaction.id}
                                                  onClick={() => handleCommentReactionToggle(reply.id, reaction.id)}
                                                  role="menuitem"
                                                  type="button"
                                                >
                                                  {reaction.emoji}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        ) : null}
                                      </div>
                                      {isReplyReported ? (
                                        <span className="ml-1 text-xs font-semibold text-zinc-500">Comentario reportado</span>
                                      ) : null}
                                      <button
                                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-transparent px-2 text-xs font-bold text-zinc-500 transition hover:bg-white/[0.055] hover:text-zinc-200"
                                        onClick={() => handleReplyStart(comment.id, reply)}
                                        type="button"
                                      >
                                        <Reply className="h-3.5 w-3.5" />
                                        Responder
                                      </button>
                                    </div>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>

              {commentError && !commentsLoading ? (
                <div className="mt-4 rounded-[8px] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100" role="alert">
                  {commentError}
                </div>
              ) : null}

              <form className="mt-5 rounded-[8px] border border-white/10 bg-white/[0.045] p-3 shadow-inner shadow-black/20 sm:p-4" onSubmit={handleCommentSubmit}>
                <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <CommentAvatar
                    avatar={currentUserCommentAvatar}
                    size="lg"
                  />
                  <div className="min-w-0">
                    {replyTarget ? (
                      <div className="mb-3 flex items-center justify-between gap-3 rounded-[8px] border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-zinc-300">
                        <span className="min-w-0 truncate">
                          Respondendo <span className="font-extrabold text-white">@{replyTarget.username}</span>
                        </span>
                        <button
                          aria-label="Cancelar resposta"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-white/10 hover:text-white"
                          onClick={handleReplyCancel}
                          type="button"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                    <label className="sr-only" htmlFor="lesson-comment">
                      Escrever comentario
                    </label>
                    <textarea
                      className="block min-h-20 w-full resize-none rounded-[8px] border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-500 focus:border-[var(--accent)] focus:bg-black/35"
                      id="lesson-comment"
                      maxLength={2000}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder={replyTarget ? "Escreva sua resposta..." : "Escreva um comentario..."}
                      ref={commentInputRef}
                      rows={3}
                      disabled={commentSubmitting || isActiveLessonLocked}
                      value={commentText}
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        aria-label="Enviar comentario"
                        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] px-4 py-2 text-sm font-extrabold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                          canSubmitComment
                            ? "bg-white text-black shadow-xl shadow-black/25 hover:bg-zinc-200"
                            : "bg-white/10 text-zinc-500"
                        }`}
                        disabled={!canSubmitComment}
                        type="submit"
                      >
                        <Send className="h-4 w-4" />
                        {commentSubmitting ? "Enviando..." : "Enviar"}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          ) : null}

          {activeTab === "materials" ? (
            <div
              aria-labelledby="lesson-tab-materials"
              className="p-4 sm:p-5"
              id="lesson-panel-materials"
              role="tabpanel"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                {lessonMaterials.map((material) => {
                  const isMaterialLocked = Boolean(material.requiresRating && (!canRateLesson || !hasRatedLesson));
                  const lockedMessage = !canRateLesson
                    ? "Assista pelo menos 30% da aula para avaliar e desbloquear este material."
                    : "Avalie esta aula para desbloquear este material.";

                  return (
                    <button
                      aria-disabled={isMaterialLocked}
                      className={`group relative flex min-h-24 items-center gap-3 rounded-[8px] border border-white/10 bg-white/[0.03] p-4 text-left transition ${
                        isMaterialLocked
                          ? "cursor-not-allowed opacity-80 hover:border-amber-500/40 hover:bg-white/[0.045]"
                          : "hover:border-white/20 hover:bg-white/[0.06]"
                      }`}
                      key={material.id}
                      onClick={(event) => {
                        if (isMaterialLocked) {
                          event.preventDefault();
                        }
                      }}
                      type="button"
                    >
                      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[8px] bg-black/[0.35] ${
                        isMaterialLocked ? "text-zinc-500" : "text-[var(--accent)]"
                      }`}>
                        {isMaterialLocked ? <Download className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block line-clamp-2 text-sm font-bold text-white">{material.title}</span>
                        <span className="mt-1 block text-xs font-semibold text-zinc-500">
                          {isMaterialLocked ? "Bloqueado por avaliacao" : material.meta}
                        </span>
                      </span>
                      {isMaterialLocked ? (
                        <span className="pointer-events-none absolute inset-x-3 bottom-3 z-20 translate-y-1 rounded-[8px] border border-amber-500/35 bg-[#101010]/95 px-3 py-2 text-xs font-semibold leading-5 text-zinc-100 opacity-0 shadow-2xl shadow-black/50 backdrop-blur transition group-hover:translate-y-0 group-hover:opacity-100">
                          <span className="mb-1 block text-[10px] font-black uppercase tracking-normal text-amber-400">
                            Material bloqueado
                          </span>
                          <span>{lockedMessage}</span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {activeLessonKey && (activeTab === "aiTutor" || mountedTutorLessonId === activeLessonKey) ? (
            <div
              aria-labelledby="lesson-tab-aiTutor"
              hidden={activeTab !== "aiTutor"}
              id="lesson-panel-aiTutor"
              key={`${currentUserId}:${item.id}:${activeLessonKey}`}
              role="tabpanel"
            >
              <LessonAiTutor
                contentId={item.id}
                isLocked={isActiveLessonLocked}
                lessonId={activeLessonKey}
                onSeek={handleTutorTimestampSeek}
                userId={currentUserId}
              />
            </div>
          ) : null}
        </div>
      </div>

      <aside className={`lesson-playlist-shell self-start overflow-hidden rounded-[8px] border border-white/10 bg-[#181818] shadow-2xl shadow-black/40 xl:sticky xl:top-24 xl:-mr-8 xl:h-[calc(100vh-11rem)] xl:max-h-[calc(100vh-11rem)] 2xl:-mr-10 ${
        playlistOpen ? "lesson-playlist-shell-open" : "lesson-playlist-shell-closed max-xl:hidden"
      }`}>
        <div className="lesson-playlist-panel flex h-full min-h-0 flex-col" aria-hidden={!playlistOpen}>
          <div className="shrink-0 border-b border-white/10 p-5">
            <div className="flex items-start gap-4">
              <span className="relative h-36 w-24 shrink-0 overflow-hidden rounded-[6px] border border-white/10 bg-black shadow-xl shadow-black/35">
                <span
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url(${item.image})` }}
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-white/5" />
              </span>
              <div className="flex min-h-36 min-w-0 flex-1 flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-3 text-[15px] font-semibold leading-snug text-white">{item.title}</p>
                  <TooltipProvider delay={0}>
                    <Tooltip>
                      <TooltipTrigger
                        aria-label="Esconder listagem de aulas"
                        className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-200 transition duration-300 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                        onClick={() => setPlaylistOpen(false)}
                        type="button"
                      >
                        <PanelRightClose className="h-5 w-5 stroke-[2.35]" />
                      </TooltipTrigger>
                      <TooltipContent
                        className="rounded-[4px] px-4 py-2 text-[13px] font-medium shadow-xl shadow-black/35"
                        side="top"
                        sideOffset={12}
                      >
                        Esconder aulas
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-zinc-400">
                    <span>Progresso do curso</span>
                    <span className="text-zinc-300">{completedCourseLessonsCount}/{totalCourseLessonsCount} aulas</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                      style={{ width: `${courseProgressPercent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-right text-[11px] font-medium text-zinc-500">{courseProgressPercent}% concluido</p>
                </div>
              </div>
            </div>
          </div>

          <div className="lesson-playlist-scroll min-h-0 flex-1 overflow-y-auto pb-4" ref={playlistScrollRef}>
            {allModules.map((courseModule) => {
              const isOpen = courseModule.id === activeModuleId;
              const completed = courseModule.lessons.filter((lesson) => completedLessonIds.has(lesson.id)).length;

              return (
                <div
                  className="m-3 overflow-hidden rounded-[8px] border border-white/10 bg-[#141414] shadow-lg shadow-black/20"
                  key={courseModule.id}
                  ref={(node) => {
                    moduleRefs.current[courseModule.id] = node;
                  }}
                >
                  <button
                    aria-expanded={isOpen}
                    className={`flex w-full items-start gap-3 px-4 py-4 text-left transition duration-300 ${
                      isOpen ? "bg-[#242424]" : "bg-[#171717] hover:bg-[#202020]"
                    }`}
                    onClick={() => handleModuleOpen(courseModule)}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-2 text-base font-black leading-tight text-white">
                        {courseModule.title}
                      </span>
                      <span className="mt-2 block text-xs font-semibold text-zinc-400">
                        {completed}/{courseModule.lessons.length} concluidas
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <ChevronDown className={`mt-1 h-4 w-4 text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </span>
                  </button>

                  <div
                    aria-hidden={!isOpen}
                    className={`lesson-accordion-panel ${isOpen ? "lesson-accordion-panel-open" : ""}`}
                  >
                    <ol className="lesson-accordion-panel-inner bg-[#1f1f1f]">
                      {courseModule.lessons.map((lesson) => {
                        const isActive = lesson.id === activeLesson.id;
                        const isCompleted = completedLessonIds.has(lesson.id);
                        const releaseNotice =
                          item.isLocked
                            ? {
                                detail: "Acesso pendente",
                                isLocked: true,
                                title: "Acesso pendente"
                              }
                            : (
                                getReleaseRuleNotice(lesson.releaseRule, "aula") ??
                                getReleaseRuleNotice(courseModule.releaseRule, "modulo")
                              );
                        const isLessonLocked = Boolean(releaseNotice?.isLocked);

                        return (
                          <li className="border-t border-white/10 first:border-t-0" key={lesson.id}>
                            <div
                              className={`group relative grid w-full gap-3 px-4 py-4 text-left transition hover:bg-white/[0.045] sm:grid-cols-[9rem_minmax(0,1fr)_auto] ${
                                isActive ? "bg-white/[0.09]" : ""
                              } ${isLessonLocked ? "cursor-not-allowed" : "cursor-pointer"}`}
                              onClick={() => handleLessonSelect(courseModule, lesson)}
                              onKeyDown={(event) => handleLessonRowKeyDown(event, courseModule, lesson)}
                              role="button"
                              tabIndex={isOpen && playlistOpen ? 0 : -1}
                            >
                              {isActive ? (
                                <span className="absolute bottom-0 left-0 top-0 w-1 bg-[var(--accent)]" />
                              ) : null}
                              <span className="relative aspect-video overflow-hidden rounded-[6px] bg-black">
                                <span
                                  className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-105"
                                  style={{
                                    backgroundImage: `url(${getYouTubeThumbnailUrl(lesson.video) || lesson.image || courseModule.image})`
                                  }}
                                />
                                <span className={`absolute inset-0 transition-colors ${
                                  isLessonLocked ? "bg-black/68" : isActive ? "bg-black/70" : "bg-black/[0.2]"
                                }`} />
                                {isLessonLocked ? (
                                  <span className="absolute inset-0 z-10 grid place-items-center p-2 text-center">
                                    <span className="rounded-[6px] border border-white/10 bg-black/76 px-2 py-2 text-[10px] font-bold leading-4 text-white shadow-xl shadow-black/40">
                                      <LockKeyhole className="mx-auto mb-1 h-4 w-4" />
                                      {releaseNotice?.detail ?? "Aula bloqueada"}
                                    </span>
                                  </span>
                                ) : isActive && startedLessonIds.has(lesson.id) ? (
                                  <span className="absolute inset-0 grid place-items-center px-2">
                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                                      <span className="lesson-watching-dot h-1.5 w-1.5 rounded-full bg-amber-400" />
                                      Assistindo...
                                    </span>
                                  </span>
                                ) : (
                                  <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                                    <span className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-black shadow-xl shadow-black/35">
                                      <Play className="h-3.5 w-3.5 fill-current" />
                                    </span>
                                  </span>
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="line-clamp-2 text-sm font-extrabold leading-tight text-white">
                                  {lesson.title}
                                </span>
                                <span className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">
                                  {lesson.description}
                                </span>
                              </span>
                              <span className="flex items-center justify-between gap-3 sm:flex-col sm:justify-start sm:pt-1">
                                <span className="text-xs font-semibold text-zinc-500">{lesson.duration}</span>
                                <button
                                  aria-label={isCompleted ? "Desmarcar aula concluida" : "Marcar aula como concluida"}
                                  className={`grid h-7 w-7 place-items-center rounded-full shadow-xl shadow-black/30 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                                    isCompleted
                                      ? "bg-emerald-600 text-white hover:bg-emerald-500"
                                      : "bg-black/50 text-zinc-300 ring-1 ring-white/25 hover:bg-white hover:text-black"
                                  } disabled:cursor-not-allowed disabled:opacity-45`}
                                  disabled={isLessonLocked}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleLessonCompletionToggle(lesson.id);
                                  }}
                                  type="button"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
      </div>
    </section>
  );
}
