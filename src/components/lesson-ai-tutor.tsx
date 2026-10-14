"use client";

import {
  ArrowUp,
  Clock3,
  EllipsisVertical,
  FileText,
  GraduationCap,
  History,
  Info,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  PanelLeftClose,
  PencilLine,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import * as React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import useSWR, { SWRConfig, useSWRConfig, type SWRConfiguration } from "swr";
import { formatMemberRelativeTime } from "@/lib/member-format";

// Tutor IA da aula (aba "Tutor IA"): conversa com historico salvo por aula, respostas em Markdown com
// marcadores [MM:SS] validados que levam ao trecho do video.
// Layout: cabecalho com identidade e disponibilidade; historico como trilho recolhivel no computador
// (>= 1024 px) e folha sobre o painel no celular; mensagens do aluno em balao a direita; Tutor sem
// balao, com avatar; campo em pilula que cresce ate 6 linhas (Enter envia, Shift + Enter quebra).

type TutorCitation = {
  chunkId: string;
  endSeconds: number;
  label: string;
  quote: string;
  startSeconds: number;
  verified?: boolean;
};

type TutorMessage = {
  body: string;
  citations: TutorCitation[];
  createdAt: string;
  id: string;
  role: "assistant" | "user";
  status: "completed" | "failed" | "pending";
};

type TutorConversation = {
  createdAt: string;
  id: string;
  lastMessageAt: string;
  messageCount: number;
  preview: string;
  title: string;
};

type TutorAvailability = { available: boolean; reason: string | null };

type TutorOverview = {
  availability: TutorAvailability;
  conversations: TutorConversation[];
};

type TutorConversationDetail = {
  conversation: TutorConversation;
  messages: TutorMessage[];
};

const emptyTutorConversations: TutorConversation[] = [];
const emptyTutorMessages: TutorMessage[] = [];

type TutorOverviewCacheKey = readonly ["lesson-tutor", string, "overview", string, string];
type TutorConversationCacheKey = readonly ["lesson-tutor", string, "conversation", string, string, string];

const tutorCacheConfiguration = {
  dedupingInterval: 60_000,
  provider: () => new Map(),
  refreshInterval: 0,
  revalidateIfStale: false,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  shouldRetryOnError: false
} satisfies SWRConfiguration;

class TutorRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TutorRequestError";
    this.status = status;
  }
}

function getTutorOverviewCacheKey(
  userId: string,
  contentId: string,
  lessonId: string
): TutorOverviewCacheKey {
  return ["lesson-tutor", userId, "overview", contentId, lessonId];
}

function getTutorConversationCacheKey(
  userId: string,
  contentId: string,
  lessonId: string,
  conversationId: string
): TutorConversationCacheKey {
  return ["lesson-tutor", userId, "conversation", contentId, lessonId, conversationId];
}

function isTutorAuthorizationError(error: unknown): error is TutorRequestError {
  return error instanceof TutorRequestError && (error.status === 401 || error.status === 403);
}

async function readTutorResponse<T>(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };

  if (!response.ok || payload.data === undefined) {
    throw new TutorRequestError(payload.error ?? fallbackMessage, response.status);
  }

  return payload.data;
}

async function fetchTutorOverview([, , , contentId, lessonId]: TutorOverviewCacheKey) {
  const search = new URLSearchParams({ contentId });
  const response = await fetch(`/api/tutor/lessons/${encodeURIComponent(lessonId)}/conversations?${search}`, {
    cache: "no-store",
    credentials: "same-origin"
  });

  return readTutorResponse<TutorOverview>(response, "Não foi possível carregar o Tutor IA.");
}

async function fetchTutorConversation([, , , , , conversationId]: TutorConversationCacheKey) {
  const response = await fetch(`/api/tutor/conversations/${encodeURIComponent(conversationId)}`, {
    cache: "no-store",
    credentials: "same-origin"
  });

  return readTutorResponse<TutorConversationDetail>(response, "Não foi possível carregar a conversa.");
}

const suggestions = [
  { icon: FileText, label: "Resumir a aula", prompt: "Faça um resumo claro dos principais pontos desta aula." },
  { icon: Lightbulb, label: "Explicar um conceito", prompt: "Explique de forma simples o conceito mais importante apresentado nesta aula." },
  { icon: Search, label: "Encontrar um trecho", prompt: "Em quais momentos da aula aparecem os assuntos mais importantes?" },
  { icon: ListChecks, label: "Aplicar na prática", prompt: "Como posso aplicar o que foi ensinado nesta aula em um exemplo prático, passo a passo?" }
];

const TUTOR_QUESTION_MAX_LENGTH = 4000;
const TUTOR_QUESTION_COUNTER_THRESHOLD = 3600;
// 6 linhas de 24 px + respiro interno.
const TUTOR_TEXTAREA_MAX_HEIGHT = 160;
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function TutorIcon({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-grid place-items-center ${className}`}>
      <GraduationCap className="h-full w-full" strokeWidth={1.8} />
      <Sparkles className="absolute -right-1 -top-1 h-2.5 w-2.5 text-[var(--accent)]" strokeWidth={2.2} />
    </span>
  );
}

const validatedTimestampPattern = /(\[(?:(?:\d{1,2}):)?[0-5]?\d:[0-5]\d(?:\s*[-–]\s*(?:(?:\d{1,2}):)?[0-5]?\d:[0-5]\d)?\])/g;

function normalizeCitationLabel(value: string) {
  return value.replace(/^\[|\]$/g, "").replace(/\s*[-–]\s*/g, " - ").trim();
}

function renderValidatedCitationText(
  value: string,
  citations: TutorCitation[],
  onSeek: (seconds: number) => void
) {
  const validatedByLabel = new Map(citations
    .filter((citation) => citation.verified === true && citation.endSeconds > 0 && Number.isFinite(citation.startSeconds))
    .map((citation) => [normalizeCitationLabel(citation.label), citation]));
  const parts = value.split(validatedTimestampPattern);

  return parts.map((part, index) => {
    const citation = validatedByLabel.get(normalizeCitationLabel(part));

    if (!citation) return <React.Fragment key={`${index}-${part.slice(0, 12)}`}>{part}</React.Fragment>;

    return (
      <button
        aria-label={`Ir para ${citation.label} no vídeo`}
        className="mx-0.5 inline-flex items-center gap-1 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/12 px-2 py-px align-baseline text-[12px] font-semibold text-red-200 transition hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
        key={`${citation.chunkId}-${index}`}
        onClick={() => onSeek(citation.startSeconds)}
        title={citation.quote}
        type="button"
      >
        <Clock3 className="size-3" />
        {citation.label}
      </button>
    );
  });
}

function renderValidatedCitationChildren(
  children: React.ReactNode,
  citations: TutorCitation[],
  onSeek: (seconds: number) => void
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") return renderValidatedCitationText(child, citations, onSeek);
    if (!React.isValidElement(child)) return child;

    const element = child as React.ReactElement<{
      children?: React.ReactNode;
      node?: { tagName?: string };
    }>;
    const tagName = element.props.node?.tagName;

    if (
      element.props.children === undefined ||
      element.type === "button" ||
      tagName === "a" ||
      tagName === "code" ||
      tagName === "pre"
    ) {
      return child;
    }

    return React.cloneElement(
      element,
      undefined,
      renderValidatedCitationChildren(element.props.children, citations, onSeek)
    );
  });
}

function MessageText({ body }: { body: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-6">{body}</div>;
}

function MarkdownMessage({
  body,
  citations,
  onSeek
}: {
  body: string;
  citations: TutorCitation[];
  onSeek: (seconds: number) => void;
}) {
  const withCitations = (children: React.ReactNode) => renderValidatedCitationChildren(children, citations, onSeek);
  const components: Components = {
    a: ({ children, href }) => (
      <a
        className="font-medium text-red-300 underline decoration-red-300/35 underline-offset-2 transition hover:text-red-200"
        href={href}
        rel="noreferrer"
        target="_blank"
      >
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-red-400/40 pl-3 text-zinc-400">
        {withCitations(children)}
      </blockquote>
    ),
    code: ({ children, className }) => (
      <code className={`${className ?? ""} rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.88em] text-zinc-100`}>
        {children}
      </code>
    ),
    h1: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-white first:mt-0">{withCitations(children)}</h3>,
    h2: ({ children }) => <h3 className="mb-2 mt-5 text-[15px] font-semibold text-white first:mt-0">{withCitations(children)}</h3>,
    h3: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold text-zinc-100 first:mt-0">{withCitations(children)}</h4>,
    hr: () => <hr className="my-4 border-white/10" />,
    li: ({ children }) => <li className="pl-1 marker:text-zinc-500">{withCitations(children)}</li>,
    ol: ({ children }) => <ol className="my-3 list-outside list-decimal space-y-1.5 pl-5">{children}</ol>,
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{withCitations(children)}</p>,
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-[7px] border border-white/10 bg-black/35 p-3 text-xs leading-5 text-zinc-200">
        {children}
      </pre>
    ),
    strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-[7px] border border-white/10">
        <table className="w-full border-collapse text-left text-xs">{children}</table>
      </div>
    ),
    td: ({ children }) => <td className="border-t border-white/[0.08] px-3 py-2 align-top">{withCitations(children)}</td>,
    th: ({ children }) => <th className="bg-white/[0.045] px-3 py-2 font-semibold text-white">{withCitations(children)}</th>,
    ul: ({ children }) => <ul className="my-3 list-outside list-disc space-y-1.5 pl-5">{children}</ul>
  };

  return (
    <div className="min-w-0 break-words text-sm leading-6">
      <Markdown components={components} remarkPlugins={[remarkGfm]} skipHtml>
        {body}
      </Markdown>
    </div>
  );
}

type LessonAiTutorProps = {
  contentId: string;
  isLocked: boolean;
  lessonId: string;
  onSeek: (seconds: number) => void;
  userId: string;
};

export function LessonAiTutor(props: LessonAiTutorProps) {
  return (
    <SWRConfig value={tutorCacheConfiguration}>
      <LessonAiTutorContent {...props} />
    </SWRConfig>
  );
}

function LessonAiTutorContent({
  contentId,
  isLocked,
  lessonId,
  onSeek,
  userId
}: LessonAiTutorProps) {
  const { mutate: mutateTutorCache } = useSWRConfig();
  const [selectedConversationId, setSelectedConversationId] = React.useState("");
  const [question, setQuestion] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [sendingConversationId, setSendingConversationId] = React.useState("");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  // Computador: trilho do historico aberto por padrao (recolhivel). O Tutor so monta no navegador
  // (aba aberta pelo aluno), entao ler a largura aqui nao causa diferenca com o servidor.
  const [isDesktop, setIsDesktop] = React.useState(() => (
    typeof window !== "undefined" && window.matchMedia(DESKTOP_MEDIA_QUERY).matches
  ));
  const [railCollapsed, setRailCollapsed] = React.useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = React.useState("");
  const [conversationPendingRename, setConversationPendingRename] = React.useState<TutorConversation | null>(null);
  const [renameTitle, setRenameTitle] = React.useState("");
  const [renamingConversationId, setRenamingConversationId] = React.useState("");
  const [renameError, setRenameError] = React.useState("");
  const [conversationPendingDelete, setConversationPendingDelete] = React.useState<TutorConversation | null>(null);
  const [deletingConversationId, setDeletingConversationId] = React.useState("");
  const [error, setError] = React.useState("");
  const [accessDenied, setAccessDenied] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const messagesScrollRef = React.useRef<HTMLDivElement>(null);

  const clearTutorCacheAfterAccessFailure = React.useCallback((requestError: unknown) => {
    if (!isTutorAuthorizationError(requestError)) return false;

    setAccessDenied(true);
    setSelectedConversationId("");
    setQuestion("");
    setHistoryOpen(false);
    setOpenConversationMenuId("");
    setConversationPendingRename(null);
    setConversationPendingDelete(null);
    setRenameTitle("");
    setRenameError("");
    setRenamingConversationId("");
    setDeletingConversationId("");
    setSendingConversationId("");
    setError(requestError.message);
    void mutateTutorCache(() => true, undefined, { revalidate: false });
    return true;
  }, [mutateTutorCache]);

  const overviewCacheKey = React.useMemo(
    () => getTutorOverviewCacheKey(userId, contentId, lessonId),
    [contentId, lessonId, userId]
  );
  const overviewQuery = useSWR(
    accessDenied ? null : overviewCacheKey,
    fetchTutorOverview,
    { onError: clearTutorCacheAfterAccessFailure }
  );
  const availability = overviewQuery.data?.availability ?? { available: false, reason: null };
  const conversations = overviewQuery.data?.conversations ?? emptyTutorConversations;
  const activeConversationId = selectedConversationId && conversations.some(
    (conversation) => conversation.id === selectedConversationId
  )
    ? selectedConversationId
    : conversations[0]?.id ?? "";
  const conversationCacheKey = React.useMemo(
    () => activeConversationId
      ? getTutorConversationCacheKey(userId, contentId, lessonId, activeConversationId)
      : null,
    [activeConversationId, contentId, lessonId, userId]
  );
  const conversationQuery = useSWR(
    accessDenied ? null : conversationCacheKey,
    fetchTutorConversation,
    { onError: clearTutorCacheAfterAccessFailure }
  );
  const messages = conversationQuery.data?.messages ?? emptyTutorMessages;
  const sending = Boolean(sendingConversationId);
  const loading = !accessDenied && overviewQuery.isLoading && !overviewQuery.data;
  const messagesLoading = Boolean(
    activeConversationId && conversationQuery.isLoading && !conversationQuery.data
  );

  React.useEffect(() => {
    // Rola so a conversa (nao a pagina) ate a ultima mensagem.
    const container = messagesScrollRef.current;

    if (!container) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ behavior: prefersReducedMotion ? "auto" : "smooth", top: container.scrollHeight });
  }, [messages, sendingConversationId]);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);

    function handleChange(event: MediaQueryListEvent) {
      setIsDesktop(event.matches);
      setHistoryOpen(false);
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  React.useEffect(() => {
    // Campo cresce com o texto ate 6 linhas; depois rola por dentro.
    const textarea = inputRef.current;

    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, TUTOR_TEXTAREA_MAX_HEIGHT)}px`;
  }, [question]);

  React.useEffect(() => {
    if (!openConversationMenuId) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Element && target.closest("[data-tutor-conversation-menu]")) return;
      setOpenConversationMenuId("");
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openConversationMenuId]);

  React.useEffect(() => {
    if (!openConversationMenuId && !conversationPendingDelete && !conversationPendingRename) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      if (conversationPendingDelete && !deletingConversationId) setConversationPendingDelete(null);
      if (conversationPendingRename && !renamingConversationId) setConversationPendingRename(null);
      setOpenConversationMenuId("");
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [conversationPendingDelete, conversationPendingRename, deletingConversationId, openConversationMenuId, renamingConversationId]);

  React.useEffect(() => {
    if (!conversationPendingRename) return;
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationPendingRename]);

  async function createConversation() {
    if (!availability.available || isLocked) return null;
    setCreating(true);
    setError("");

    try {
      const response = await fetch(`/api/tutor/lessons/${encodeURIComponent(lessonId)}/conversations`, {
        body: JSON.stringify({ contentId }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const conversation = await readTutorResponse<TutorConversation>(response, "Não foi possível criar o chat.");
      await Promise.all([
        mutateTutorCache(
          overviewCacheKey,
          (current: TutorOverview | undefined) => ({
            availability: current?.availability ?? availability,
            conversations: [
              conversation,
              ...(current?.conversations ?? conversations).filter((item) => item.id !== conversation.id)
            ]
          }),
          { revalidate: false }
        ),
        mutateTutorCache(
          getTutorConversationCacheKey(userId, contentId, lessonId, conversation.id),
          { conversation, messages: [] } satisfies TutorConversationDetail,
          { revalidate: false }
        )
      ]);
      setSelectedConversationId(conversation.id);
      setHistoryOpen(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
      void mutateTutorCache(overviewCacheKey);
      return conversation;
    } catch (createError) {
      clearTutorCacheAfterAccessFailure(createError);
      setError(createError instanceof Error ? createError.message : "Não foi possível criar o chat.");
      return null;
    } finally {
      setCreating(false);
    }
  }

  function selectConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setHistoryOpen(false);
    setOpenConversationMenuId("");
    setError("");
  }

  async function deleteConversation() {
    const conversation = conversationPendingDelete;

    if (
      !conversation ||
      deletingConversationId ||
      sendingConversationId === conversation.id
    ) return;
    setDeletingConversationId(conversation.id);
    setError("");

    try {
      const response = await fetch(`/api/tutor/conversations/${encodeURIComponent(conversation.id)}`, {
        cache: "no-store",
        credentials: "same-origin",
        method: "DELETE"
      });
      await readTutorResponse<{ id: string }>(response, "Não foi possível excluir o chat.");
      const remainingConversations = conversations.filter((item) => item.id !== conversation.id);
      await Promise.all([
        mutateTutorCache(
          overviewCacheKey,
          (current: TutorOverview | undefined) => current ? {
            ...current,
            conversations: current.conversations.filter((item) => item.id !== conversation.id)
          } : current,
          { revalidate: false }
        ),
        mutateTutorCache(
          getTutorConversationCacheKey(userId, contentId, lessonId, conversation.id),
          undefined,
          { revalidate: false }
        )
      ]);
      setConversationPendingDelete(null);
      setOpenConversationMenuId("");

      if (activeConversationId === conversation.id) {
        const nextConversationId = remainingConversations[0]?.id ?? "";
        setSelectedConversationId(nextConversationId);
      }
      void mutateTutorCache(overviewCacheKey);
    } catch (deleteError) {
      clearTutorCacheAfterAccessFailure(deleteError);
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o chat.");
    } finally {
      setDeletingConversationId("");
    }
  }

  async function renameConversation(event?: React.FormEvent) {
    event?.preventDefault();
    const conversation = conversationPendingRename;
    const title = renameTitle.replace(/\s+/g, " ").trim();

    if (!conversation || !title || renamingConversationId) return;
    if (title === conversation.title) {
      setConversationPendingRename(null);
      return;
    }
    setRenamingConversationId(conversation.id);
    setRenameError("");

    try {
      const response = await fetch(`/api/tutor/conversations/${encodeURIComponent(conversation.id)}`, {
        body: JSON.stringify({ title }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      const renamedConversation = await readTutorResponse<{ id: string; title: string }>(
        response,
        "Não foi possível renomear o chat."
      );
      await Promise.all([
        mutateTutorCache(
          overviewCacheKey,
          (current: TutorOverview | undefined) => current ? {
            ...current,
            conversations: current.conversations.map((item) => (
              item.id === renamedConversation.id ? { ...item, title: renamedConversation.title } : item
            ))
          } : current,
          { revalidate: false }
        ),
        mutateTutorCache(
          getTutorConversationCacheKey(userId, contentId, lessonId, conversation.id),
          (current: TutorConversationDetail | undefined) => current ? {
            ...current,
            conversation: { ...current.conversation, title: renamedConversation.title }
          } : current,
          { revalidate: false }
        )
      ]);
      setConversationPendingRename(null);
      void mutateTutorCache(overviewCacheKey);
    } catch (renameRequestError) {
      clearTutorCacheAfterAccessFailure(renameRequestError);
      setRenameError(renameRequestError instanceof Error ? renameRequestError.message : "Não foi possível renomear o chat.");
    } finally {
      setRenamingConversationId("");
    }
  }

  async function sendQuestion(event?: React.FormEvent) {
    event?.preventDefault();
    const body = question.trim();

    if (!body || sending || !availability.available || isLocked) return;
    let conversationId = activeConversationId;
    let conversation = conversations.find((item) => item.id === conversationId) ?? null;

    if (!conversationId) {
      conversation = await createConversation();
      conversationId = conversation?.id ?? "";
      if (!conversationId || !conversation) return;
    }

    const optimisticUser: TutorMessage = {
      body,
      citations: [],
      createdAt: new Date().toISOString(),
      id: `local-user-${Date.now()}`,
      role: "user",
      status: "completed"
    };
    const optimisticAssistant: TutorMessage = {
      body: "",
      citations: [],
      createdAt: new Date().toISOString(),
      id: `local-assistant-${Date.now()}`,
      role: "assistant",
      status: "pending"
    };
    setQuestion("");
    const requestConversationCacheKey = getTutorConversationCacheKey(
      userId,
      contentId,
      lessonId,
      conversationId
    );
    const conversationForCache = conversation ?? conversationQuery.data?.conversation;

    if (!conversationForCache) {
      setQuestion(body);
      setError("Não foi possível identificar o chat ativo.");
      return;
    }

    await mutateTutorCache(
      requestConversationCacheKey,
      (current: TutorConversationDetail | undefined) => ({
        conversation: current?.conversation ?? conversationForCache,
        messages: [...(current?.messages ?? messages), optimisticUser, optimisticAssistant]
      }),
      { revalidate: false }
    );
    setSendingConversationId(conversationId);
    setError("");

    try {
      const response = await fetch(`/api/tutor/conversations/${encodeURIComponent(conversationId)}/messages`, {
        body: JSON.stringify({ clientRequestId: crypto.randomUUID(), question: body }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const result = await readTutorResponse<TutorConversationDetail>(response, "Não foi possível obter a resposta.");
      await Promise.all([
        mutateTutorCache(requestConversationCacheKey, result, { revalidate: false }),
        mutateTutorCache(
          overviewCacheKey,
          (current: TutorOverview | undefined) => current ? {
            ...current,
            conversations: [
              result.conversation,
              ...current.conversations.filter((item) => item.id !== conversationId)
            ]
          } : current,
          { revalidate: false }
        )
      ]);
      void mutateTutorCache(overviewCacheKey);
    } catch (sendError) {
      const accessWasRevoked = clearTutorCacheAfterAccessFailure(sendError);

      if (!accessWasRevoked) {
        setQuestion(body);
        await mutateTutorCache(requestConversationCacheKey);
      }
      setError(sendError instanceof Error ? sendError.message : "Não foi possível obter a resposta.");
    } finally {
      setSendingConversationId((current) => current === conversationId ? "" : current);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  const selectedConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const queryError = !overviewQuery.data
    ? overviewQuery.error
    : activeConversationId && !conversationQuery.data
      ? conversationQuery.error
      : null;
  const displayedError = error || (queryError instanceof Error ? queryError.message : "");
  const inputDisabled = isLocked || !availability.available || sending || creating;

  const statusText = isLocked
    ? "Abre junto com a aula"
    : availability.available
      ? "Responde com base nesta aula"
      : "Indisponível nesta aula";
  const isTutorReady = availability.available && !isLocked;
  const unavailableNotice = isLocked
    ? "O Tutor IA abre junto com a aula."
    : !availability.available
      ? availability.reason || "O Tutor IA ainda não está disponível nesta aula."
      : "";
  const historyVisible = isDesktop ? !railCollapsed && conversations.length > 0 : historyOpen;
  const questionLength = question.length;
  const showQuestionCounter = questionLength >= TUTOR_QUESTION_COUNTER_THRESHOLD;

  function toggleHistory() {
    if (isDesktop) {
      setRailCollapsed((current) => !current);
      return;
    }

    setHistoryOpen((current) => !current);
  }

  function closeHistory() {
    if (isDesktop) {
      setRailCollapsed(true);
      return;
    }

    setHistoryOpen(false);
  }

  if (loading) {
    return (
      <div className="grid h-[min(42rem,calc(100dvh-7rem))] min-h-[26rem] place-items-center p-6 text-sm font-medium text-zinc-500" role="status">
        <span className="inline-flex items-center gap-2"><LoaderCircle className="size-4 motion-safe:animate-spin" /> Carregando seu Tutor IA...</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-[min(42rem,calc(100dvh-7rem))] min-h-[26rem] flex-col">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-white/[0.08] px-3 py-2.5 sm:px-5">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]">
          <TutorIcon className="size-5" />
          <span
            aria-hidden="true"
            className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[#181818] ${isTutorReady ? "bg-emerald-400" : "bg-zinc-500"}`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-5 text-white">Tutor IA</p>
          <p className="truncate text-xs leading-5 text-zinc-400">
            <span className="sr-only">{isTutorReady ? "Disponível. " : "Indisponível. "}</span>
            {statusText}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            aria-controls="tutor-history"
            aria-expanded={historyVisible}
            aria-label={historyVisible ? "Esconder histórico de chats" : "Mostrar histórico de chats"}
            className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={conversations.length === 0}
            onClick={toggleHistory}
            type="button"
          >
            <History className="size-4" />
            <span className="max-sm:hidden">Histórico</span>
            {conversations.length > 0 ? (
              <span className="grid min-w-5 place-items-center rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold leading-none text-zinc-200">
                {conversations.length}
              </span>
            ) : null}
          </button>
          <button
            aria-label="Criar novo chat"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 text-xs font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.11] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!availability.available || creating || isLocked}
            onClick={() => void createConversation()}
            type="button"
          >
            {creating ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : <Plus className="size-4" />}
            <span className="max-sm:hidden">Novo chat</span>
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside
          aria-label="Seus chats"
          className={
            historyVisible
              ? isDesktop
                ? "flex w-64 shrink-0 flex-col border-r border-white/[0.08] bg-[#161616]"
                : "absolute inset-0 z-20 flex flex-col bg-[#161616]"
              : "hidden"
          }
          id="tutor-history"
        >
          <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-zinc-300"><History className="size-3.5" /> Seus chats</span>
            <button
              aria-label="Fechar histórico"
              className="grid size-8 place-items-center rounded-full text-zinc-400 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              onClick={closeHistory}
              type="button"
            >
              {isDesktop ? <PanelLeftClose className="size-4" /> : <X className="size-4" />}
            </button>
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {conversations.map((conversation) => {
              const isActiveConversation = activeConversationId === conversation.id;
              const relativeDate = formatMemberRelativeTime(conversation.lastMessageAt);

              return (
                <li className="group relative" data-tutor-conversation-menu key={conversation.id}>
                  <button
                    aria-current={isActiveConversation ? "true" : undefined}
                    className={`w-full rounded-[10px] py-2.5 pl-3 pr-10 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white ${isActiveConversation ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"}`}
                    onClick={() => void selectConversation(conversation.id)}
                    type="button"
                  >
                    <span className={`block truncate text-[13px] font-semibold ${isActiveConversation ? "text-white" : "text-zinc-200"}`}>
                      {conversation.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium text-zinc-500">
                      {[relativeDate, `${conversation.messageCount} ${conversation.messageCount === 1 ? "mensagem" : "mensagens"}`].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  <button
                    aria-expanded={openConversationMenuId === conversation.id}
                    aria-haspopup="menu"
                    aria-label={`Opções do chat ${conversation.title}`}
                    className={`absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${openConversationMenuId === conversation.id ? "bg-white/[0.08] text-zinc-100 opacity-100" : isDesktop ? "opacity-0 group-hover:opacity-100 focus:opacity-100" : "opacity-100"}`}
                    onClick={() => setOpenConversationMenuId((current) => current === conversation.id ? "" : conversation.id)}
                    type="button"
                  >
                    <EllipsisVertical className="size-4" />
                  </button>
                  {openConversationMenuId === conversation.id ? (
                    <div className="absolute right-1.5 top-[calc(100%-0.25rem)] z-30 w-40 rounded-[8px] border border-white/10 bg-[#232323]/95 p-1 shadow-[0_14px_38px_rgba(0,0,0,0.48)] backdrop-blur-md" role="menu">
                      <button
                        className="flex min-h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[6px] px-2.5 text-left text-xs font-medium text-zinc-300 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={Boolean(deletingConversationId || renamingConversationId)}
                        onClick={() => {
                          setConversationPendingRename(conversation);
                          setRenameTitle(conversation.title);
                          setRenameError("");
                          setOpenConversationMenuId("");
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <PencilLine className="size-3.5 shrink-0" />
                        Renomear chat
                      </button>
                      <div className="mx-2 border-t border-white/[0.07]" />
                      <button
                        className="flex min-h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[6px] px-2.5 text-left text-xs font-medium text-red-300 transition hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={Boolean(deletingConversationId || renamingConversationId) || sendingConversationId === conversation.id}
                        onClick={() => {
                          setConversationPendingDelete(conversation);
                          setOpenConversationMenuId("");
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <Trash2 className="size-3.5 shrink-0" />
                        Excluir chat
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" ref={messagesScrollRef}>
            {messagesLoading ? (
              <div className="grid min-h-56 place-items-center text-xs font-medium text-zinc-600" role="status">
                <LoaderCircle aria-label="Carregando conversa" className="size-5 motion-safe:animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex max-w-2xl flex-col items-center py-2 text-center sm:py-6">
                <span className="grid size-14 place-items-center rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[var(--accent)]">
                  <TutorIcon className="size-7" />
                </span>
                <p className="mt-4 text-xs font-semibold text-zinc-500">Olá! Pergunte o que quiser sobre esta aula.</p>
                <h2 className="mt-1 text-xl font-bold text-white">Tutor IA desta aula</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-400">
                  Tire dúvidas, peça explicações ou resumos e encontre rapidamente o trecho que você procura.
                </p>
                <div className="mt-6 grid w-full gap-2.5 sm:grid-cols-2">
                  {suggestions.map((suggestion) => {
                    const Icon = suggestion.icon;

                    return (
                      <button
                        className="group flex min-h-[4.5rem] items-start gap-3 rounded-[12px] border border-white/[0.08] bg-white/[0.03] p-3.5 text-left transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={inputDisabled}
                        key={suggestion.label}
                        onClick={() => {
                          setQuestion(suggestion.prompt);
                          window.requestAnimationFrame(() => inputRef.current?.focus());
                        }}
                        type="button"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.06] text-zinc-200 transition group-hover:bg-white/[0.1] group-hover:text-white">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-white">{suggestion.label}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-zinc-400">{suggestion.prompt}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                {selectedConversation ? (
                  <p className="mx-auto mb-5 max-w-3xl truncate text-center text-[11px] font-semibold text-zinc-500">
                    {selectedConversation.title}
                  </p>
                ) : null}
                <ol className="mx-auto max-w-3xl space-y-6">
                  {messages.map((message) => (
                    message.role === "user" ? (
                      <li className="flex justify-end" key={message.id}>
                        <div className="max-w-[85%] rounded-[18px] rounded-br-[6px] bg-white/[0.1] px-4 py-2.5 text-zinc-100 sm:max-w-[75%]">
                          <span className="sr-only">Você: </span>
                          <MessageText body={message.body} />
                        </div>
                      </li>
                    ) : (
                      <li className="flex items-start gap-3" key={message.id}>
                        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[var(--accent)]">
                          <TutorIcon className="size-4" />
                        </span>
                        <div className={`min-w-0 flex-1 pt-1 ${message.status === "failed" ? "text-red-200" : "text-zinc-200"}`}>
                          <p className="mb-1 text-xs font-semibold text-zinc-400">Tutor IA</p>
                          {message.status === "pending" ? (
                            <span className="inline-flex items-center gap-2.5 py-1 text-sm text-zinc-400" role="status">
                              <span aria-hidden="true" className="flex items-center gap-1">
                                <span className="size-1.5 rounded-full bg-zinc-400 motion-safe:animate-bounce" />
                                <span className="size-1.5 rounded-full bg-zinc-400 motion-safe:animate-bounce [animation-delay:150ms]" />
                                <span className="size-1.5 rounded-full bg-zinc-400 motion-safe:animate-bounce [animation-delay:300ms]" />
                              </span>
                              Pensando sobre a aula...
                            </span>
                          ) : (
                            <MarkdownMessage body={message.body} citations={message.citations} onSeek={onSeek} />
                          )}
                        </div>
                      </li>
                    )
                  ))}
                </ol>
              </>
            )}
          </div>

          <form className="shrink-0 border-t border-white/[0.08] px-3 pb-3 pt-3 sm:px-5" onSubmit={(event) => void sendQuestion(event)}>
            {displayedError ? (
              <p className="mx-auto mb-2 max-w-3xl rounded-[10px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200" role="alert">
                {displayedError}
              </p>
            ) : null}
            <div
              className={`mx-auto max-w-3xl rounded-[22px] border bg-[#1f1f1f] p-1.5 transition-[border-color,background-color] focus-within:border-white/25 ${
                unavailableNotice ? "border-white/[0.06]" : "border-white/12"
              }`}
            >
              {unavailableNotice ? (
                <p className="flex items-start gap-2 px-3 pb-1 pt-1.5 text-xs font-medium leading-5 text-amber-100/85">
                  <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  {unavailableNotice}
                </p>
              ) : null}
              <div className="flex items-end gap-2">
                <label className="sr-only" htmlFor={`tutor-question-${lessonId}`}>Pergunta para o Tutor IA</label>
                <textarea
                  className="block min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] leading-6 text-white outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
                  disabled={inputDisabled}
                  id={`tutor-question-${lessonId}`}
                  maxLength={TUTOR_QUESTION_MAX_LENGTH}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void sendQuestion();
                    }
                  }}
                  placeholder={availability.available ? "Pergunte sobre esta aula..." : "Tutor indisponível nesta aula"}
                  ref={inputRef}
                  rows={1}
                  style={{ maxHeight: TUTOR_TEXTAREA_MAX_HEIGHT }}
                  value={question}
                />
                <button
                  aria-label="Enviar pergunta"
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600"
                  disabled={inputDisabled || !question.trim()}
                  type="submit"
                >
                  {sending ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : <ArrowUp className="size-[18px]" strokeWidth={2.5} />}
                </button>
              </div>
            </div>
            <div className="mx-auto mt-2 flex max-w-3xl items-center justify-between gap-3 px-2 text-[11px] font-medium text-zinc-500">
              <p className="min-w-0 truncate">As conversas ficam salvas no seu histórico desta aula.</p>
              {showQuestionCounter ? (
                <p
                  aria-live="polite"
                  className={`shrink-0 font-semibold tabular-nums ${questionLength >= TUTOR_QUESTION_MAX_LENGTH ? "text-red-300" : "text-amber-200"}`}
                >
                  {questionLength.toLocaleString("pt-BR")}/{TUTOR_QUESTION_MAX_LENGTH.toLocaleString("pt-BR")}
                </p>
              ) : (
                <p className="shrink-0 max-sm:hidden">Enter envia · Shift + Enter quebra a linha</p>
              )}
            </div>
          </form>
        </div>
      </div>

      {conversationPendingRename ? (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/75 px-4 py-6 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !renamingConversationId) setConversationPendingRename(null);
          }}
        >
          <section
            aria-labelledby="rename-tutor-chat-title"
            aria-modal="true"
            className="w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#171717] shadow-[0_28px_100px_rgba(0,0,0,0.75)]"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.055] text-zinc-300">
                  <PencilLine className="size-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-white" id="rename-tutor-chat-title">Editar nome do chat</h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">Use um nome curto para encontrar esta conversa depois.</p>
                </div>
              </div>
              <button
                aria-label="Fechar edição do nome"
                className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
                disabled={Boolean(renamingConversationId)}
                onClick={() => setConversationPendingRename(null)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <form className="p-5" onSubmit={(event) => void renameConversation(event)}>
              <label className="block text-xs font-medium text-zinc-400" htmlFor="tutor-chat-name">Nome do chat</label>
              <input
                aria-invalid={Boolean(renameError)}
                className="mt-2 h-10 w-full rounded-[8px] border border-white/10 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/25 focus:ring-2 focus:ring-white/[0.04]"
                id="tutor-chat-name"
                maxLength={160}
                onChange={(event) => {
                  setRenameTitle(event.target.value);
                  if (renameError) setRenameError("");
                }}
                ref={renameInputRef}
                value={renameTitle}
              />
              {renameError ? <p className="mt-2 text-xs font-medium text-red-300">{renameError}</p> : null}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  className="min-h-10 rounded-[8px] border border-white/10 bg-white/[0.045] px-4 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-40"
                  disabled={Boolean(renamingConversationId)}
                  onClick={() => setConversationPendingRename(null)}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-white px-4 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600"
                  disabled={Boolean(renamingConversationId) || !renameTitle.trim()}
                  type="submit"
                >
                  {renamingConversationId ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : null}
                  Salvar nome
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {conversationPendingDelete ? (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/75 px-4 py-6 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingConversationId) setConversationPendingDelete(null);
          }}
        >
          <section
            aria-labelledby="delete-tutor-chat-title"
            aria-modal="true"
            className="w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#171717] shadow-[0_28px_100px_rgba(0,0,0,0.75)]"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-300">
                  <Trash2 className="size-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-white" id="delete-tutor-chat-title">Excluir chat?</h3>
                  <p className="mt-1 truncate text-xs text-zinc-500">{conversationPendingDelete.title}</p>
                </div>
              </div>
              <button
                aria-label="Cancelar exclusão"
                className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
                disabled={Boolean(deletingConversationId)}
                onClick={() => setConversationPendingDelete(null)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm leading-6 text-zinc-400">
                Este chat será removido do seu histórico. Você não poderá mais consultar nem continuar esta conversa.
              </p>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  className="min-h-10 rounded-[8px] border border-white/10 bg-white/[0.045] px-4 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-40"
                  disabled={Boolean(deletingConversationId)}
                  onClick={() => setConversationPendingDelete(null)}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-red-500/15 px-4 text-sm font-semibold text-red-200 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={Boolean(deletingConversationId) || sendingConversationId === conversationPendingDelete.id}
                  onClick={() => void deleteConversation()}
                  type="button"
                >
                  {deletingConversationId ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : <Trash2 className="size-4" />}
                  Excluir chat
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
