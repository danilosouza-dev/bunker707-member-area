"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Flag,
  GalleryVerticalEnd,
  Heart,
  Maximize2,
  MessageCircle,
  MonitorPlay,
  MoreHorizontal,
  PanelRightClose,
  Play,
  Reply,
  Send,
  SmilePlus,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from "react";
import type { KeyboardEvent } from "react";
import type { ContentItem, CourseModule, LessonPreview } from "@/lib/mock-data";

type LessonExperienceProps = {
  allModules: CourseModule[];
  item: ContentItem;
  returnContent?: Pick<ContentItem, "id" | "title">;
  selectedModule: CourseModule;
};

type LessonTab = "comments" | "materials";
type CommentReaction = "like" | "fire" | "insight" | "love" | "clap" | "laugh" | "wow" | "rocket" | "eyes" | "check";

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
  role?: string;
  reactions: Partial<Record<CommentReaction, number>>;
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

type LessonReaction = "not-for-me" | "liked" | "loved";

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

const initialComments: LessonComment[] = [
  {
    id: "comment-1",
    author: "Ana Beatriz",
    avatar: {
      backgroundClassName: "bg-emerald-300",
      label: "👩‍💻",
      labelClassName: "text-[34px]",
      online: true
    },
    body: "Ficou bem mais claro quando voce separou referencia, prompt e criterio visual. Ja vou testar esse fluxo no meu projeto.",
    reactions: {
      fire: 4,
      insight: 2,
      like: 6
    },
    replies: [
      {
        id: "reply-1",
        parentId: "comment-1",
        author: "Bruno Bunker",
        avatar: {
          backgroundClassName: "bg-red-500",
          label: "BB",
          labelClassName: "text-[15px]",
          online: true
        },
        body: "@ana.beatriz exatamente. O segredo e criar uma esteira simples: primeiro direcao visual, depois variacoes controladas, depois refinamento por criterio.",
        reactions: {
          fire: 8,
          love: 3
        },
        role: "Professor",
        time: "1 hora atras",
        username: "bruno.bunker"
      }
    ],
    time: "12 minutos atras",
    username: "ana.beatriz"
  },
  {
    id: "comment-3",
    author: "Rafael Leme",
    avatar: {
      backgroundClassName: "bg-amber-300",
      label: "🧠",
      labelClassName: "text-[34px]"
    },
    body: "A parte de salvar os melhores prompts por etapa resolveu uma bagunca que eu estava criando aqui.",
    reactions: {
      insight: 1,
      like: 2
    },
    time: "3 dias atras",
    username: "rafael.leme"
  },
  {
    id: "comment-4",
    author: "Marina Costa",
    avatar: {
      backgroundClassName: "bg-fuchsia-500",
      label: "MC",
      labelClassName: "text-[15px]"
    },
    body: "Voltei nessa aula um mes depois e fez ainda mais sentido agora que comecei a montar o workflow completo.",
    reactions: {
      fire: 1,
      love: 1
    },
    time: "1 mes atras",
    username: "marina.costa"
  }
];

const currentUserCommentAvatar: CommentAvatarData = {
  backgroundClassName: "bg-red-500",
  label: "DS",
  labelClassName: "text-[15px]",
  online: true
};

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

function getLessonProgressStorageKey(contentId: string) {
  return `bunker707:lesson-progress:${contentId}`;
}

function saveCompletedLessonIds(storageKey: string, completedLessonIds: Set<string>, allLessonIds: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const safeCompletedLessonIds = Array.from(completedLessonIds)
      .filter((lessonId) => allLessonIds.has(lessonId))
      .sort();

    window.localStorage.setItem(storageKey, JSON.stringify(safeCompletedLessonIds));
  } catch {
    return;
  }
}

function getFirstPlayableLessonId(courseModule: CourseModule, completedLessonIds: Set<string>) {
  return courseModule.lessons.find((lesson) => !completedLessonIds.has(lesson.id))?.id ?? courseModule.lessons[0]?.id ?? "";
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
  onSelect,
  value
}: {
  onSelect: (reaction: LessonReaction) => void;
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
        role="radiogroup"
      >
        <span className="absolute -bottom-3 left-0 h-3 w-full" />
        {lessonReactionOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = option.id === value;

          return (
            <button
              aria-checked={isSelected}
              aria-label={option.label}
              className={`group/reaction-option relative grid h-10 w-10 place-items-center rounded-full text-white transition duration-150 hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                isSelected ? "bg-white/14" : ""
              }`}
              key={option.id}
              onClick={(event) => {
                onSelect(option.id);
                setIsReactionMenuOpen(false);
                event.currentTarget.blur();
              }}
              role="radio"
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
  allModules,
  item,
  returnContent,
  selectedModule
}: LessonExperienceProps) {
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(
    () => new Set(getInitialCompletedLessonIds(allModules))
  );
  const completedLessonStorageKey = useMemo(() => getLessonProgressStorageKey(item.id), [item.id]);
  const allLessonIds = useMemo(() => (
    new Set(allModules.flatMap((courseModule) => (
      courseModule.lessons.map((lesson) => lesson.id)
    )))
  ), [allModules]);
  const initialLessonId = useMemo(() => (
    getFirstPlayableLessonId(selectedModule, completedLessonIds)
  ), [completedLessonIds, selectedModule]);
  const [activeLessonId, setActiveLessonId] = useState(initialLessonId);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(selectedModule.id);
  const [activeTab, setActiveTab] = useState<LessonTab>("comments");
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState<LessonComment[]>(initialComments);
  const [commentReactionSelections, setCommentReactionSelections] = useState<Partial<Record<string, CommentReaction>>>({});
  const [commentReactionMenuId, setCommentReactionMenuId] = useState<string | null>(null);
  const [commentMenuId, setCommentMenuId] = useState<string | null>(null);
  const [reportedCommentIds, setReportedCommentIds] = useState<Set<string>>(() => new Set());
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [lessonReactions, setLessonReactions] = useState<Partial<Record<string, LessonReaction>>>({});
  const [playlistOpen, setPlaylistOpen] = useState(true);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const playlistScrollRef = useRef<HTMLDivElement>(null);
  const moduleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const completedLessonIdsHydratedRef = useRef(false);

  const fallbackTarget = getLessonTarget(allModules, activeLessonId) ?? {
    lesson: selectedModule.lessons[0],
    module: selectedModule
  };
  const activeLesson = fallbackTarget.lesson;
  const activeModule = allModules.find((courseModule) => courseModule.id === activeModuleId) ?? fallbackTarget.module;
  const totalCourseLessonsCount = allModules.reduce((total, courseModule) => total + courseModule.lessons.length, 0);
  const completedCourseLessonsCount = allModules.reduce((total, courseModule) => (
    total + courseModule.lessons.filter((lesson) => completedLessonIds.has(lesson.id)).length
  ), 0);
  const courseProgressPercent = totalCourseLessonsCount > 0
    ? Math.round((completedCourseLessonsCount / totalCourseLessonsCount) * 100)
    : 0;
  const isActiveLessonCompleted = completedLessonIds.has(activeLesson.id);
  const posterImage = activeLesson.image ?? activeModule.image;
  const activeLessonWatchedPercent = 36;
  const canRateLesson = activeLessonWatchedPercent >= 30;
  const lessonReaction = lessonReactions[activeLesson.id] ?? null;
  const hasRatedLesson = Boolean(lessonReaction);
  const totalCommentCount = useMemo(() => getTotalCommentCount(comments), [comments]);

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
    completedLessonIdsHydratedRef.current = false;

    const animationFrame = window.requestAnimationFrame(() => {
      try {
        const storedCompletedLessonIds = window.localStorage.getItem(completedLessonStorageKey);

        if (!storedCompletedLessonIds) {
          completedLessonIdsHydratedRef.current = true;
          return;
        }

        const parsedCompletedLessonIds: unknown = JSON.parse(storedCompletedLessonIds);

        if (!Array.isArray(parsedCompletedLessonIds)) {
          completedLessonIdsHydratedRef.current = true;
          return;
        }

        setCompletedLessonIds((current) => {
          const next = new Set(current);

          for (const lessonId of parsedCompletedLessonIds) {
            if (typeof lessonId === "string" && allLessonIds.has(lessonId)) {
              next.add(lessonId);
            }
          }

          return next;
        });
      } catch {
        completedLessonIdsHydratedRef.current = true;
        return;
      }

      completedLessonIdsHydratedRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [allLessonIds, completedLessonStorageKey]);

  useEffect(() => {
    if (!completedLessonIdsHydratedRef.current) {
      return;
    }

    saveCompletedLessonIds(completedLessonStorageKey, completedLessonIds, allLessonIds);
  }, [allLessonIds, completedLessonIds, completedLessonStorageKey]);

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

  function handlePrimaryLessonAction() {
    handleLessonCompletionToggle(activeLesson.id);
  }

  function handleLessonCompletionToggle(lessonId: string) {
    const nextCompletedLessonIds = new Set(completedLessonIds);

    if (nextCompletedLessonIds.has(lessonId)) {
      nextCompletedLessonIds.delete(lessonId);
    } else {
      nextCompletedLessonIds.add(lessonId);
    }

    saveCompletedLessonIds(completedLessonStorageKey, nextCompletedLessonIds, allLessonIds);
    setCompletedLessonIds(nextCompletedLessonIds);
  }

  function handleLessonReactionSelect(reaction: LessonReaction) {
    setLessonReactions((current) => {
      const next = { ...current };

      if (next[activeLesson.id] === reaction) {
        delete next[activeLesson.id];
        return next;
      }

      next[activeLesson.id] = reaction;
      return next;
    });
  }

  function handleCommentReactionToggle(commentId: string, reactionId: CommentReaction) {
    const selectedReaction = commentReactionSelections[commentId] ?? null;
    setCommentReactionMenuId(null);

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
  }

  function handleCommentReport(commentId: string) {
    setReportedCommentIds((current) => {
      const next = new Set(current);
      next.add(commentId);
      return next;
    });
    setCommentMenuId(null);
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
    setActiveTab("comments");
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
    setActiveModuleId(courseModule.id);
    setActiveLessonId(lesson.id);
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

  function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentText.trim();

    if (!body) {
      return;
    }

    const baseComment: LessonCommentBase = {
      author: "Danilo Souza",
      avatar: currentUserCommentAvatar,
      body,
      id: `comment-${Date.now()}`,
      reactions: {},
      time: "agora",
      username: "danilo.souza"
    };

    if (replyTarget) {
      setComments((current) => current.map((comment) => {
        if (comment.id !== replyTarget.parentCommentId) {
          return comment;
        }

        const reply: LessonCommentReply = {
          ...baseComment,
          id: `reply-${Date.now()}`,
          parentId: comment.id
        };

        return {
          ...comment,
          replies: [...(comment.replies ?? []), reply]
        };
      }));
    } else {
      setComments((current) => [
        ...current,
        {
          ...baseComment,
          id: `comment-${Date.now()}`
        }
      ]);
    }

    setReplyTarget(null);
    setCommentText("");
    setActiveTab("comments");
  }

  const primaryActionLabel = isActiveLessonCompleted ? "Concluida" : "Concluir";
  const canSubmitComment = commentText.trim().length > 0;
  const returnHref = `/conteudo/${returnContent?.id ?? item.id}`;
  const returnLabel = returnContent?.title ?? item.title;

  return (
    <section className="relative mt-6">
      <nav aria-label="Breadcrumb" className="mb-4 flex min-h-10 flex-wrap items-center gap-2 text-xs font-semibold text-zinc-500 sm:text-sm">
        <Link className="transition hover:text-white" href="/">
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
        <span>{activeModule.title}</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-zinc-300">{activeLesson.title}</span>
      </nav>

      <div className={`lesson-experience-grid relative grid gap-6 ${playlistOpen ? "" : "lesson-experience-grid-collapsed"}`}>
        <div className="min-w-0">
        <div className="group/player relative aspect-video overflow-visible rounded-[8px] bg-black shadow-[0_32px_90px_rgba(0,0,0,0.58)]">
          <div className="absolute inset-0 overflow-hidden rounded-[8px] bg-black">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-78"
              style={{ backgroundImage: `url(${posterImage})` }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.72),rgba(0,0,0,0.18)_52%,rgba(0,0,0,0.58))]" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/[0.72] to-transparent" />
          </div>

          <Link
            aria-label={`Voltar para ${returnLabel}`}
            className="group/action absolute left-3 top-3 z-50 grid h-11 w-11 place-items-center rounded-full text-white opacity-0 transition duration-200 hover:bg-black/35 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white group-hover/player:opacity-100 max-lg:opacity-100 sm:left-4 sm:top-4 sm:h-12 sm:w-12"
            href={returnHref}
          >
            <ActionTooltip elevated label="Voltar" />
            <ArrowLeft className="h-7 w-7 stroke-[2.4] sm:h-8 sm:w-8" />
          </Link>

          {!playlistOpen ? (
            <button
              aria-label="Mostrar listagem de aulas"
              className="group/action absolute right-4 top-4 z-50 grid h-11 w-11 place-items-center rounded-full text-white transition duration-200 hover:bg-black/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white max-xl:hidden sm:h-12 sm:w-12"
              onClick={() => setPlaylistOpen(true)}
              type="button"
            >
              <ActionTooltip elevated label="Mostrar aulas" />
              <GalleryVerticalEnd className="h-6 w-6 stroke-[2.35] sm:h-7 sm:w-7" />
            </button>
          ) : null}

          <button
            aria-label="Reproduzir aula"
            className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-2xl shadow-black/55 transition hover:scale-105 hover:bg-zinc-200 sm:h-20 sm:w-20"
            type="button"
          >
            <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" />
          </button>

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
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="max-w-5xl text-2xl font-black leading-tight text-white sm:text-3xl lg:text-4xl">
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
                className={`lesson-primary-complete-button group/complete relative inline-flex min-h-12 min-w-[9rem] items-center justify-center gap-2 overflow-hidden rounded-[8px] px-5 py-3 text-sm font-extrabold shadow-2xl shadow-black/30 transition duration-200 hover:scale-[1.02] hover:brightness-105 active:scale-[0.98] sm:min-w-[10rem] ${
                  isActiveLessonCompleted ? "lesson-primary-complete-button-done" : ""
                }`}
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
                onClick={() => setActiveTab("materials")}
                type="button"
              >
                <ActionTooltip label="Materiais" />
                <Download className="h-5 w-5 stroke-[2.35]" />
              </button>
              <button
                aria-label="Modo TV"
                className={lessonIconButtonClassName}
                type="button"
              >
                <ActionTooltip label="TV" />
                <MonitorPlay className="h-5 w-5 stroke-[2.35]" />
              </button>
              <button
                aria-label="Salvar aula"
                className={lessonIconButtonClassName}
                type="button"
              >
                <ActionTooltip label="Adicionar a Minha lista" />
                <Bookmark className="h-5 w-5 stroke-[2.35]" />
              </button>
              {canRateLesson ? (
                <LessonReactionControl
                  onSelect={handleLessonReactionSelect}
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

        <div className="mt-8 overflow-visible rounded-[8px] border border-white/10 bg-[#181818]">
          <div className="flex border-b border-white/10">
            {[
              { id: "comments" as const, label: "Comentarios", count: totalCommentCount, icon: MessageCircle },
              { id: "materials" as const, label: "Materiais", count: lessonMaterials.length, icon: FileText }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  className={`relative inline-flex min-h-14 items-center gap-2 px-4 text-sm font-extrabold transition sm:px-6 ${
                    isActive ? "text-white" : "text-zinc-400 hover:text-white"
                  }`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  <span className="grid min-w-6 place-items-center rounded-full bg-white/10 px-1.5 py-0.5 text-xs text-zinc-200">
                    {tab.count}
                  </span>
                  {isActive ? (
                    <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[var(--accent)] sm:inset-x-6" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {activeTab === "comments" ? (
            <div className="p-4 sm:p-6">
              <div className="divide-y divide-white/[0.07]">
                {comments.map((comment) => {
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
                            </div>
                            <CommentBody body={comment.body} className="mt-1 max-w-3xl text-sm leading-6 text-zinc-300" />
                          </div>

                          <div className="relative shrink-0" data-comment-popover-root>
                            <button
                              aria-expanded={isMenuOpen}
                              aria-haspopup="menu"
                              aria-label={`Mais opcoes para comentario de ${comment.author}`}
                              className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 opacity-100 transition hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:opacity-0 sm:group-hover/comment:opacity-100 sm:group-focus-within/comment:opacity-100"
                              onClick={() => {
                                setCommentReactionMenuId(null);
                                setCommentMenuId((current) => (current === comment.id ? null : comment.id));
                              }}
                              type="button"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>

                            {isMenuOpen ? (
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
                                        </div>
                                        <CommentBody body={reply.body} className="mt-1 max-w-3xl text-sm leading-6 text-zinc-300" />
                                      </div>

                                      <div className="relative shrink-0" data-comment-popover-root>
                                        <button
                                          aria-expanded={isReplyMenuOpen}
                                          aria-haspopup="menu"
                                          aria-label={`Mais opcoes para comentario de ${reply.author}`}
                                          className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 opacity-100 transition hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:opacity-0 sm:group-hover/comment:opacity-100 sm:group-focus-within/comment:opacity-100"
                                          onClick={() => {
                                            setCommentReactionMenuId(null);
                                            setCommentMenuId((current) => (current === reply.id ? null : reply.id));
                                          }}
                                          type="button"
                                        >
                                          <MoreHorizontal className="h-4 w-4" />
                                        </button>

                                        {isReplyMenuOpen ? (
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

              <form className="mt-5 rounded-[8px] border border-white/10 bg-white/[0.045] p-3 shadow-inner shadow-black/20 sm:p-4" onSubmit={handleCommentSubmit}>
                <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <CommentAvatar
                    avatar={{
                      backgroundClassName: "bg-red-500",
                      label: "DS",
                      labelClassName: "text-[15px]",
                      online: true
                    }}
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
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder={replyTarget ? "Escreva sua resposta..." : "Escreva um comentario..."}
                      ref={commentInputRef}
                      rows={3}
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
                        Enviar
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          ) : (
            <div className="p-4 sm:p-5">
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
          )}
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
                  <button
                    aria-label="Esconder listagem de aulas"
                    className="group/action relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-200 transition duration-300 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    onClick={() => setPlaylistOpen(false)}
                    type="button"
                  >
                    <ActionTooltip label="Esconder aulas" />
                    <PanelRightClose className="h-5 w-5 stroke-[2.35]" />
                  </button>
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
                      <span className="inline-flex rounded-[6px] border border-white/10 bg-black/25 px-2 py-1 text-[11px] font-black uppercase tracking-normal text-zinc-400">
                        {courseModule.eyebrow}
                      </span>
                      <span className="mt-2 block line-clamp-2 text-base font-black leading-tight text-white">
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

                        return (
                          <li className="border-t border-white/10 first:border-t-0" key={lesson.id}>
                            <div
                              className={`group relative grid w-full gap-3 px-4 py-4 text-left transition hover:bg-white/[0.045] sm:grid-cols-[9rem_minmax(0,1fr)_auto] ${
                                isActive ? "bg-white/[0.09]" : ""
                              }`}
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
                                  style={{ backgroundImage: `url(${lesson.image ?? courseModule.image})` }}
                                />
                                <span className={`absolute inset-0 transition-colors ${
                                  isActive ? "bg-black/70" : "bg-black/[0.2]"
                                }`} />
                                {isActive ? (
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
                                  }`}
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
