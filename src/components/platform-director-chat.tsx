"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  CircleAlert,
  Compass,
  Ellipsis,
  History,
  ListTree,
  LoaderCircle,
  Map as MapIcon,
  MessageCircle,
  PencilLine,
  Route,
  Search,
  SquarePen,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DirectorAvatar,
  DirectorConversationSkeleton,
  DirectorHeaderAction,
  DirectorIcon
} from "@/components/member/shell/director-parts";
import {
  DIRECTOR_MESSAGE_LIMIT,
  describeDirectorConversation,
  getDirectorCounterLabel,
  getDirectorGreeting,
  groupDirectorConversations
} from "@/components/member/shell/member-shell-model";

type GuideAvailability = {
  available: boolean;
  reason: string | null;
};

type GuideConversation = {
  createdAt: string;
  id: string;
  lastMessageAt: string;
  messageCount: number;
  preview: string;
  title: string;
};

type GuideReference = {
  breadcrumb: string;
  href: string;
  id: string;
  kind: string;
  label: string;
  title: string;
};

type GuideMessage = {
  body: string;
  createdAt: string;
  id: string;
  references: GuideReference[];
  role: "assistant" | "user";
  status: "completed" | "failed" | "pending";
};

type PlatformDirectorChatProps = {
  /** Abre o painel ao montar; usado pelo AppShell, que carrega o chat só depois do primeiro clique. */
  defaultOpen?: boolean;
  onNavigate: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** Primeiro nome do aluno para a saudação ("Olá, Ana"). */
  studentName?: string;
};

const mobileMediaQuery = "(max-width: 639px)";

const panelId = "platform-director-chat";

/** Altura máxima do campo (6 linhas de 20 px + respiro); depois disso ele rola. */
const composerMaxHeight = 136;

const suggestions = [
  {
    icon: Search,
    label: "Encontrar um assunto",
    prompt: "Onde encontro aulas sobre o assunto que quero aprender?"
  },
  {
    icon: Compass,
    label: "Escolher o próximo passo",
    prompt: "Com base no que tenho acesso, o que você recomenda que eu estude agora?"
  },
  {
    icon: Route,
    label: "Montar uma trilha",
    prompt: "Ajude-me a montar uma trilha de estudos para alcançar meu objetivo."
  }
];

function isAuthorizedMemberHref(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;

  const pathname = value.split(/[?#]/, 1)[0];

  return pathname === "/" ||
    pathname === "/favoritos" ||
    pathname === "/minhas-compras" ||
    pathname.startsWith("/conteudo/");
}

function MessageText({ body }: { body: string }) {
  return <div className="whitespace-pre-wrap break-words text-sm leading-6">{body}</div>;
}

const markdownComponents: Components = {
  a: ({ children }) => (
    <span className="font-medium text-zinc-100 underline decoration-white/25 underline-offset-2">
      {children}
    </span>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-red-400/40 pl-3 text-zinc-400">{children}</blockquote>
  ),
  code: ({ children, className }) => (
    <code className={`${className ?? ""} rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.88em] text-zinc-100`}>
      {children}
    </code>
  ),
  h1: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-white first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-5 text-[15px] font-semibold text-white first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold text-zinc-100 first:mt-0">{children}</h4>,
  hr: () => <hr className="my-4 border-white/10" />,
  li: ({ children }) => <li className="pl-1 marker:text-zinc-500">{children}</li>,
  ol: ({ children }) => <ol className="my-3 list-outside list-decimal space-y-1.5 pl-5">{children}</ol>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-[10px] border border-white/10 bg-black/35 p-3 text-xs leading-5 text-zinc-200">
      {children}
    </pre>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-[10px] border border-white/10">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  td: ({ children }) => <td className="border-t border-white/[0.08] px-3 py-2 align-top">{children}</td>,
  th: ({ children }) => <th className="bg-white/[0.045] px-3 py-2 font-semibold text-white">{children}</th>,
  ul: ({ children }) => <ul className="my-3 list-outside list-disc space-y-1.5 pl-5">{children}</ul>
};

function MarkdownMessage({ body }: { body: string }) {
  return (
    <div className="min-w-0 break-words text-sm leading-6">
      <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
        {body}
      </Markdown>
    </div>
  );
}

async function readResponse<T>(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error || fallback);
  }

  return payload.data;
}

export function PlatformDirectorChat({ defaultOpen = false, onNavigate, studentName }: PlatformDirectorChatProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  // Montado só no cliente (next/dynamic com ssr: false): lê a mídia já no primeiro
  // render para o painel aberto por defaultOpen não piscar no layout de desktop.
  const [mobile, setMobile] = React.useState(() => (
    typeof window !== "undefined" && window.matchMedia(mobileMediaQuery).matches
  ));
  const [availability, setAvailability] = React.useState<GuideAvailability>({ available: false, reason: null });
  const [conversations, setConversations] = React.useState<GuideConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState("");
  // Lido por loadGuide sem recriá-lo: trocar ou criar chat não recarrega a lista inteira (nem apaga
  // a mensagem otimista enquanto a resposta chega).
  const activeConversationIdRef = React.useRef("");
  const [messages, setMessages] = React.useState<GuideMessage[]>([]);
  const [question, setQuestion] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [loadedOnce, setLoadedOnce] = React.useState(false);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyNow, setHistoryNow] = React.useState(0);
  const [openConversationMenuId, setOpenConversationMenuId] = React.useState("");
  const [conversationPendingRename, setConversationPendingRename] = React.useState<GuideConversation | null>(null);
  const [renameTitle, setRenameTitle] = React.useState("");
  const [renamingConversationId, setRenamingConversationId] = React.useState("");
  const [renameError, setRenameError] = React.useState("");
  const [conversationPendingDelete, setConversationPendingDelete] = React.useState<GuideConversation | null>(null);
  const [deletingConversationId, setDeletingConversationId] = React.useState("");
  const [error, setError] = React.useState("");
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const closeChat = React.useCallback((restoreFocus = true) => {
    setOpen(false);
    setHistoryOpen(false);
    setOpenConversationMenuId("");
    setConversationPendingRename(null);
    setConversationPendingDelete(null);

    if (restoreFocus) {
      window.requestAnimationFrame(() => launcherRef.current?.focus());
    }
  }, []);

  const loadConversation = React.useCallback(async (conversationId: string, signal?: AbortSignal) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    setMessagesLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/guide/conversations/${encodeURIComponent(conversationId)}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal
      });
      const data = await readResponse<{ conversation: GuideConversation; messages: GuideMessage[] }>(
        response,
        "Não foi possível carregar a conversa."
      );
      setMessages(data.messages);
      setConversations((current) => current.map((conversation) => (
        conversation.id === conversationId ? data.conversation : conversation
      )));
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a conversa.");
      setMessages([]);
    } finally {
      if (!signal?.aborted) setMessagesLoading(false);
    }
  }, []);

  const loadGuide = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/guide/conversations", {
        cache: "no-store",
        credentials: "same-origin",
        signal
      });
      const data = await readResponse<{
        availability: GuideAvailability;
        conversations: GuideConversation[];
      }>(response, "Não foi possível carregar a IA Diretor.");
      setAvailability(data.availability);
      setConversations(data.conversations);
      const currentConversationId = activeConversationIdRef.current;
      const currentStillExists = data.conversations.some((conversation) => conversation.id === currentConversationId);
      const nextConversationId = currentStillExists ? currentConversationId : data.conversations[0]?.id ?? "";
      setActiveConversationId(nextConversationId);

      if (nextConversationId) await loadConversation(nextConversationId, signal);
      else setMessages([]);
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a IA Diretor.");
      setAvailability({ available: false, reason: null });
      setConversations([]);
      setMessages([]);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, [loadConversation]);

  React.useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  React.useEffect(() => {
    const media = window.matchMedia(mobileMediaQuery);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  React.useEffect(() => {
    if (!defaultOpen) return;
    // O botão estático que recebeu o clique já saiu da tela: o foco vai para o
    // campo ou, enquanto ele estiver desabilitado, para o próprio painel.
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (document.activeElement !== inputRef.current) panelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [defaultOpen]);

  // Aberto antes de a IA Diretor responder, o foco fica no painel; quando o campo libera, vai para ele.
  React.useEffect(() => {
    if (!open || loading || !availability.available) return;
    if (document.activeElement === panelRef.current) inputRef.current?.focus();
  }, [availability.available, loading, open]);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadGuide(controller.signal), 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadGuide, open]);

  React.useEffect(() => {
    if (!open || !mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobile, open]);

  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (conversationPendingDelete && !deletingConversationId) {
          setConversationPendingDelete(null);
          return;
        }

        if (conversationPendingRename && !renamingConversationId) {
          setConversationPendingRename(null);
          return;
        }

        if (openConversationMenuId) {
          setOpenConversationMenuId("");
          return;
        }

        if (historyOpen) {
          setHistoryOpen(false);
          return;
        }

        closeChat();
        return;
      }

      if (event.key !== "Tab" || !mobile || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));

      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    closeChat,
    conversationPendingDelete,
    conversationPendingRename,
    deletingConversationId,
    historyOpen,
    mobile,
    open,
    openConversationMenuId,
    renamingConversationId
  ]);

  React.useEffect(() => {
    if (!openConversationMenuId) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-guide-conversation-menu]")) return;
      setOpenConversationMenuId("");
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openConversationMenuId]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, sending]);

  // O campo cresce com o texto até ~6 linhas; depois rola por dentro.
  React.useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, composerMaxHeight)}px`;
  }, [historyOpen, open, question]);

  React.useEffect(() => {
    if (!conversationPendingRename) return;
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationPendingRename]);

  function toggleChat() {
    if (open) {
      closeChat();
      return;
    }

    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openHistory() {
    setHistoryNow(Date.now());
    setHistoryOpen(true);
  }

  async function createConversation() {
    if (!availability.available || creating) return null;
    setCreating(true);
    setError("");

    try {
      const response = await fetch("/api/guide/conversations", {
        credentials: "same-origin",
        method: "POST"
      });
      const conversation = await readResponse<GuideConversation>(response, "Não foi possível criar o chat.");
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setActiveConversationId(conversation.id);
      setMessages([]);
      setHistoryOpen(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return conversation.id;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Não foi possível criar o chat.");
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setHistoryOpen(false);
    setOpenConversationMenuId("");
    await loadConversation(conversationId);
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
      const response = await fetch(`/api/guide/conversations/${encodeURIComponent(conversation.id)}`, {
        body: JSON.stringify({ title }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      const updated = await readResponse<{ id: string; title: string }>(response, "Não foi possível renomear o chat.");
      setConversations((current) => current.map((item) => (
        item.id === updated.id ? { ...item, title: updated.title } : item
      )));
      setConversationPendingRename(null);
    } catch (renameRequestError) {
      setRenameError(renameRequestError instanceof Error ? renameRequestError.message : "Não foi possível renomear o chat.");
    } finally {
      setRenamingConversationId("");
    }
  }

  async function deleteConversation() {
    const conversation = conversationPendingDelete;

    if (!conversation || deletingConversationId || (sending && activeConversationId === conversation.id)) return;
    setDeletingConversationId(conversation.id);
    setError("");

    try {
      const response = await fetch(`/api/guide/conversations/${encodeURIComponent(conversation.id)}`, {
        credentials: "same-origin",
        method: "DELETE"
      });
      await readResponse<{ id: string }>(response, "Não foi possível excluir o chat.");
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      setConversationPendingDelete(null);
      setOpenConversationMenuId("");

      if (activeConversationId === conversation.id) {
        const nextConversationId = remaining[0]?.id ?? "";
        setActiveConversationId(nextConversationId);
        setMessages([]);
        if (nextConversationId) await loadConversation(nextConversationId);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o chat.");
    } finally {
      setDeletingConversationId("");
    }
  }

  async function sendQuestion(event?: React.FormEvent) {
    event?.preventDefault();
    const body = question.trim();

    if (!body || sending || !availability.available) return;
    let conversationId = activeConversationId;

    if (!conversationId) {
      conversationId = await createConversation() ?? "";
      if (!conversationId) return;
    }

    const optimisticUser: GuideMessage = {
      body,
      createdAt: new Date().toISOString(),
      id: `local-user-${Date.now()}`,
      references: [],
      role: "user",
      status: "completed"
    };
    const optimisticAssistant: GuideMessage = {
      body: "",
      createdAt: new Date().toISOString(),
      id: `local-assistant-${Date.now()}`,
      references: [],
      role: "assistant",
      status: "pending"
    };
    setQuestion("");
    setMessages((current) => [...current, optimisticUser, optimisticAssistant]);
    setSending(true);
    setError("");

    try {
      const response = await fetch(`/api/guide/conversations/${encodeURIComponent(conversationId)}/messages`, {
        body: JSON.stringify({ clientRequestId: crypto.randomUUID(), question: body }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = await readResponse<{ conversation: GuideConversation; messages: GuideMessage[] }>(
        response,
        "Não foi possível obter a resposta."
      );
      setMessages(data.messages);
      setConversations((current) => [
        data.conversation,
        ...current.filter((conversation) => conversation.id !== conversationId)
      ]);
    } catch (sendError) {
      setMessages((current) => current.filter((message) => !message.id.startsWith("local-")));
      setQuestion(body);
      setError(sendError instanceof Error ? sendError.message : "Não foi possível obter a resposta.");
      await loadConversation(conversationId);
    } finally {
      setSending(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function handleReferenceNavigation(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    const primaryNavigation = event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
    onNavigate(event, href);

    if (primaryNavigation && mobile) closeChat(false);
  }

  const selectedConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const inputDisabled = !availability.available || sending || creating;
  const showSkeleton = loading || messagesLoading;
  const historyGroups = historyOpen ? groupDirectorConversations(conversations, historyNow) : [];
  const counterLabel = getDirectorCounterLabel(question.length);
  const availabilityStatus = loadedOnce ? (availability.available ? "available" : "unavailable") : undefined;

  return (
    <div className="pointer-events-none fixed inset-0 z-[180]">
      {open ? (
        <section
          aria-labelledby="platform-director-title"
          aria-modal={mobile}
          className="pointer-events-auto fixed bottom-[92px] right-6 flex h-[min(44rem,calc(100dvh-8rem))] w-[min(420px,calc(100vw-3rem))] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--panel)] shadow-[0_32px_110px_rgba(0,0,0,0.82)] outline-none animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none max-sm:inset-0 max-sm:h-dvh max-sm:w-screen max-sm:rounded-none max-sm:border-0"
          id={panelId}
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
        >
          <header className="relative z-10 flex shrink-0 items-center gap-2.5 border-b border-white/[0.07] px-3 py-3 max-sm:pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pl-4 sm:pr-3">
            {historyOpen ? (
              <DirectorHeaderAction label="Voltar para a conversa" onClick={() => setHistoryOpen(false)} tooltip="Voltar" tooltipAlign="start">
                <ArrowLeft aria-hidden="true" className="size-[18px]" />
              </DirectorHeaderAction>
            ) : (
              <DirectorAvatar status={availabilityStatus} />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold leading-5 text-white" id="platform-director-title">
                {historyOpen ? "Histórico" : "IA Diretor"}
              </h2>
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-zinc-400">
                {historyOpen ? "Suas conversas com a IA Diretor" : "Orientação sobre seus cursos e trilhas"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {!historyOpen ? (
                <>
                  <DirectorHeaderAction label="Abrir histórico da IA Diretor" onClick={openHistory} tooltip="Histórico">
                    <History aria-hidden="true" className="size-[18px]" />
                  </DirectorHeaderAction>
                  <DirectorHeaderAction
                    disabled={!availability.available || creating}
                    label="Criar novo chat com a IA Diretor"
                    onClick={() => void createConversation()}
                    tooltip="Novo chat"
                  >
                    {creating ? (
                      <LoaderCircle aria-hidden="true" className="size-[18px] animate-spin" />
                    ) : (
                      <SquarePen aria-hidden="true" className="size-[18px]" />
                    )}
                  </DirectorHeaderAction>
                </>
              ) : null}
              <DirectorHeaderAction label="Fechar IA Diretor" onClick={() => closeChat()} tooltip="Fechar">
                <X aria-hidden="true" className="size-[18px]" />
              </DirectorHeaderAction>
            </div>
          </header>

          {historyOpen ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-3">
              <div className="px-1 pb-2">
                <button
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] text-sm font-semibold text-zinc-100 transition-colors hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!availability.available || creating}
                  onClick={() => void createConversation()}
                  type="button"
                >
                  {creating ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <SquarePen aria-hidden="true" className="size-4" />}
                  Novo chat
                </button>
              </div>
              {loading ? (
                <div aria-hidden="true" className="space-y-2 px-1 pt-3">
                  {[0, 1, 2].map((item) => (
                    <span className="block h-14 rounded-[12px] bg-white/[0.04] motion-safe:animate-pulse" key={item} />
                  ))}
                </div>
              ) : conversations.length === 0 ? (
                <div className="grid min-h-56 place-items-center px-6 text-center">
                  <div>
                    <span className="mx-auto grid size-12 place-items-center rounded-full bg-white/[0.05] text-zinc-500">
                      <History aria-hidden="true" className="size-5" />
                    </span>
                    <p className="mt-4 text-sm font-semibold text-zinc-200">Nenhum chat ainda</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Suas conversas com a IA Diretor aparecerão aqui.</p>
                  </div>
                </div>
              ) : historyGroups.map((group) => (
                <section className="mt-3" key={group.label}>
                  <h3 className="px-3 pb-1.5 text-xs font-semibold text-zinc-500">{group.label}</h3>
                  <ul className="space-y-0.5">
                    {group.items.map((conversation) => {
                      const active = activeConversationId === conversation.id;
                      const menuOpen = openConversationMenuId === conversation.id;

                      return (
                        <li className="group/conversation relative" data-guide-conversation-menu key={conversation.id}>
                          <button
                            aria-current={active ? "true" : undefined}
                            className={`flex w-full items-center gap-3 rounded-[12px] py-2.5 pl-2.5 pr-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${active ? "bg-white/[0.08]" : "hover:bg-white/[0.045]"}`}
                            onClick={() => void selectConversation(conversation.id)}
                            type="button"
                          >
                            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${active ? "bg-[var(--accent)]/15 text-red-200" : "bg-white/[0.05] text-zinc-500"}`}>
                              <MessageCircle aria-hidden="true" className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-zinc-100">{conversation.title}</span>
                              <span className="mt-0.5 block truncate text-xs text-zinc-500">
                                {describeDirectorConversation(conversation, historyNow)}
                              </span>
                            </span>
                          </button>
                          <button
                            aria-expanded={menuOpen}
                            aria-haspopup="menu"
                            aria-label={`Opções do chat ${conversation.title}`}
                            className={`absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${menuOpen ? "bg-white/10 text-white opacity-100" : "opacity-0 group-hover/conversation:opacity-100 focus:opacity-100 max-sm:opacity-100"}`}
                            onClick={() => setOpenConversationMenuId((current) => current === conversation.id ? "" : conversation.id)}
                            type="button"
                          >
                            <Ellipsis aria-hidden="true" className="size-4" />
                          </button>
                          {menuOpen ? (
                            <div className="absolute right-2 top-[calc(100%-2px)] z-20 w-44 rounded-[12px] border border-white/10 bg-[#232323] p-1 shadow-[0_16px_44px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-100 motion-reduce:animate-none" role="menu">
                              <button
                                className="flex min-h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[8px] px-2.5 text-left text-[13px] font-medium text-zinc-200 transition hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.08] focus-visible:outline-none disabled:opacity-40"
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
                                <PencilLine aria-hidden="true" className="size-4 text-zinc-400" /> Renomear chat
                              </button>
                              <button
                                className="flex min-h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[8px] px-2.5 text-left text-[13px] font-medium text-red-300 transition hover:bg-red-500/10 focus-visible:bg-red-500/10 focus-visible:outline-none disabled:opacity-40"
                                disabled={Boolean(deletingConversationId || renamingConversationId) || (sending && activeConversationId === conversation.id)}
                                onClick={() => {
                                  setConversationPendingDelete(conversation);
                                  setOpenConversationMenuId("");
                                }}
                                role="menuitem"
                                type="button"
                              >
                                <Trash2 aria-hidden="true" className="size-4" /> Excluir chat
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <>
              {selectedConversation && messages.length > 0 && !showSkeleton ? (
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.05] px-4 text-xs font-medium text-zinc-500">
                  <MessageCircle aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{selectedConversation.title}</span>
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5">
                {showSkeleton ? (
                  <DirectorConversationSkeleton />
                ) : messages.length === 0 ? (
                  <div className="mx-auto flex min-h-full w-full max-w-[22rem] flex-col justify-center py-2">
                    <DirectorAvatar size="lg" />
                    <h3 className="mt-5 text-[22px] font-bold leading-7 text-white">{getDirectorGreeting(studentName)}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-zinc-400">
                      Encontre aulas, descubra o que estudar e organize seu próximo passo.
                    </p>
                    {availability.available ? (
                      <>
                        <p className="mt-6 text-xs font-semibold text-zinc-500">Sugestões para começar</p>
                        <div className="mt-2 space-y-2">
                          {suggestions.map((suggestion) => {
                            const Icon = suggestion.icon;

                            return (
                              <button
                                className="group/suggestion flex w-full items-center gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.03] p-3 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={inputDisabled}
                                key={suggestion.label}
                                onClick={() => {
                                  setQuestion(suggestion.prompt);
                                  window.requestAnimationFrame(() => inputRef.current?.focus());
                                }}
                                type="button"
                              >
                                <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-white/[0.06] text-zinc-300 transition-colors group-hover/suggestion:text-white">
                                  <Icon aria-hidden="true" className="size-[18px]" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-zinc-100">{suggestion.label}</span>
                                  <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-zinc-500">{suggestion.prompt}</span>
                                </span>
                                <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-zinc-600 transition-colors group-hover/suggestion:text-zinc-200" />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="mt-6 flex items-start gap-2.5 rounded-[12px] border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2.5 text-xs font-medium leading-5 text-amber-100/85" role="status">
                        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-300" />
                        {availability.reason ?? "A IA Diretor não está disponível agora."}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {messages.map((message) => {
                      const authorizedReferences = (message.references ?? []).filter((reference) => isAuthorizedMemberHref(reference.href));

                      if (message.role === "user") {
                        return (
                          <div className="flex justify-end" key={message.id}>
                            <div className="max-w-[85%] rounded-[20px] rounded-br-[6px] bg-white/[0.1] px-4 py-2.5 text-zinc-50">
                              <MessageText body={message.body} />
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="flex min-w-0 max-w-full items-start gap-3" key={message.id}>
                          <DirectorAvatar size="sm" />
                          <div className={`min-w-0 flex-1 pt-1 ${message.status === "failed" ? "text-red-200" : "text-zinc-200"}`}>
                            {message.status === "pending" ? (
                              <span className="inline-flex items-center gap-2.5 py-0.5 text-sm text-zinc-400" role="status">
                                <span aria-hidden="true" className="flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-zinc-400 motion-safe:animate-pulse" />
                                  <span className="size-1.5 rounded-full bg-zinc-400 [animation-delay:160ms] motion-safe:animate-pulse" />
                                  <span className="size-1.5 rounded-full bg-zinc-400 [animation-delay:320ms] motion-safe:animate-pulse" />
                                </span>
                                Organizando sua orientação...
                              </span>
                            ) : (
                              <MarkdownMessage body={message.body} />
                            )}
                            {authorizedReferences.length > 0 ? (
                              <ul aria-label="Conteúdos recomendados" className="mt-3 space-y-2">
                                {authorizedReferences.map((reference) => {
                                  const kind = `${reference.kind} ${reference.label}`.toLowerCase();
                                  const ReferenceIcon = kind.includes("aula") || kind.includes("lesson") ? ListTree : MapIcon;

                                  return (
                                    <li key={reference.id}>
                                      <Link
                                        className="group/reference flex items-center gap-3 rounded-[12px] border border-white/[0.08] bg-white/[0.03] p-2.5 pr-3 outline-none transition-colors hover:border-white/[0.16] hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/60"
                                        href={reference.href}
                                        onClick={(event) => handleReferenceNavigation(event, reference.href)}
                                        prefetch={false}
                                      >
                                        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--accent)]/10 text-red-200 ring-1 ring-inset ring-[var(--accent)]/20">
                                          <ReferenceIcon aria-hidden="true" className="size-[18px]" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block text-[11px] font-semibold text-zinc-500">{reference.label || reference.kind}</span>
                                          <span className="mt-0.5 line-clamp-2 block text-[13px] font-semibold leading-5 text-zinc-100">{reference.title}</span>
                                          {reference.breadcrumb ? <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{reference.breadcrumb}</span> : null}
                                        </span>
                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-zinc-200 transition-colors group-hover/reference:bg-white group-hover/reference:text-black">
                                          Abrir
                                          <ArrowRight aria-hidden="true" className="size-3" />
                                        </span>
                                      </Link>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <form
                className="shrink-0 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-4"
                onSubmit={(event) => void sendQuestion(event)}
              >
                {error ? (
                  <p className="mb-2 rounded-[10px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-medium leading-5 text-red-200" role="alert">
                    {error}
                  </p>
                ) : null}
                {counterLabel ? (
                  <p aria-live="polite" className="mb-1.5 px-3 text-right text-[11px] font-medium tabular-nums text-amber-200/80">
                    {counterLabel}
                  </p>
                ) : null}
                <div className="flex items-end gap-2 rounded-[24px] border border-white/10 bg-[#1f1f1f] py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-white/25 focus-within:bg-[#222222]">
                  <textarea
                    aria-describedby="platform-director-composer-hint"
                    aria-label="Mensagem para a IA Diretor"
                    className="min-h-9 flex-1 resize-none bg-transparent py-2 text-sm leading-5 text-white outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
                    disabled={inputDisabled}
                    maxLength={DIRECTOR_MESSAGE_LIMIT}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void sendQuestion();
                      }
                    }}
                    placeholder={
                      !loadedOnce
                        ? "Carregando a IA Diretor..."
                        : availability.available
                          ? "Pergunte onde encontrar ou o que estudar..."
                          : "IA Diretor indisponível"
                    }
                    ref={inputRef}
                    rows={1}
                    style={{ maxHeight: composerMaxHeight }}
                    value={question}
                  />
                  <button
                    aria-label="Enviar mensagem à IA Diretor"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    disabled={inputDisabled || !question.trim()}
                    type="submit"
                  >
                    {sending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowUp aria-hidden="true" className="size-[18px]" strokeWidth={2.4} />}
                  </button>
                </div>
                <p className="mt-2 px-2 text-center text-[11px] font-medium text-zinc-500" id="platform-director-composer-hint">
                  Suas conversas com a IA Diretor ficam salvas no seu histórico.
                </p>
              </form>
            </>
          )}

          {conversationPendingRename ? (
            <div className="absolute inset-0 z-30 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
              <section aria-labelledby="rename-guide-chat-title" aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#1c1c1c] shadow-[0_24px_80px_rgba(0,0,0,0.75)] animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none" role="dialog">
                <div className="flex items-start justify-between gap-3 p-4 pb-0">
                  <div>
                    <h3 className="text-[15px] font-semibold text-white" id="rename-guide-chat-title">Editar nome do chat</h3>
                    <p className="mt-1 text-xs leading-5 text-zinc-400">Use um nome curto para encontrar esta conversa.</p>
                  </div>
                  <button aria-label="Fechar edição do nome" className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-white" disabled={Boolean(renamingConversationId)} onClick={() => setConversationPendingRename(null)} type="button"><X aria-hidden="true" className="size-4" /></button>
                </div>
                <form className="p-4" onSubmit={(event) => void renameConversation(event)}>
                  <label className="text-xs font-medium text-zinc-400" htmlFor="guide-chat-name">Nome do chat</label>
                  <input
                    aria-invalid={Boolean(renameError)}
                    className="mt-2 h-11 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition-colors focus:border-white/30"
                    id="guide-chat-name"
                    maxLength={160}
                    onChange={(event) => {
                      setRenameTitle(event.target.value);
                      if (renameError) setRenameError("");
                    }}
                    ref={renameInputRef}
                    value={renameTitle}
                  />
                  {renameError ? <p className="mt-2 text-xs font-medium text-red-300" role="alert">{renameError}</p> : null}
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="min-h-10 rounded-full border border-white/10 bg-white/[0.045] px-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] disabled:opacity-40" disabled={Boolean(renamingConversationId)} onClick={() => setConversationPendingRename(null)} type="button">Cancelar</button>
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:bg-white/10 disabled:text-zinc-600" disabled={Boolean(renamingConversationId) || !renameTitle.trim()} type="submit">
                      {renamingConversationId ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Check aria-hidden="true" className="size-4" />} Salvar
                    </button>
                  </div>
                </form>
              </section>
            </div>
          ) : null}

          {conversationPendingDelete ? (
            <div className="absolute inset-0 z-30 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
              <section aria-labelledby="delete-guide-chat-title" aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#1c1c1c] shadow-[0_24px_80px_rgba(0,0,0,0.75)] animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none" role="dialog">
                <div className="flex items-start justify-between gap-3 p-4 pb-0">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-300">
                      <Trash2 aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold text-white" id="delete-guide-chat-title">Excluir chat?</h3>
                      <p className="mt-1 truncate text-xs text-zinc-400">{conversationPendingDelete.title}</p>
                    </div>
                  </div>
                  <button aria-label="Cancelar exclusão" className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-white" disabled={Boolean(deletingConversationId)} onClick={() => setConversationPendingDelete(null)} type="button"><X aria-hidden="true" className="size-4" /></button>
                </div>
                <div className="p-4">
                  <p className="text-sm leading-6 text-zinc-400">Este chat será removido do seu histórico e não poderá mais ser consultado ou continuado.</p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="min-h-10 rounded-full border border-white/10 bg-white/[0.045] px-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] disabled:opacity-40" disabled={Boolean(deletingConversationId)} onClick={() => setConversationPendingDelete(null)} type="button">Cancelar</button>
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-full bg-red-500/15 px-4 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/25 disabled:opacity-40" disabled={Boolean(deletingConversationId) || (sending && activeConversationId === conversationPendingDelete.id)} onClick={() => void deleteConversation()} type="button">
                      {deletingConversationId ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" className="size-4" />} Excluir chat
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className={`pointer-events-auto fixed bottom-4 right-4 sm:bottom-6 sm:right-6 ${open && mobile ? "hidden" : ""}`}>
        <span className="group/director relative block">
          <button
            aria-controls={panelId}
            aria-expanded={open}
            aria-label={open ? "Fechar IA Diretor" : "Abrir IA Diretor"}
            className="grid size-14 place-items-center rounded-full border border-white/15 bg-white text-black shadow-[0_18px_55px_rgba(0,0,0,0.62)] transition duration-200 hover:scale-105 hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none motion-reduce:hover:scale-100"
            onClick={toggleChat}
            ref={launcherRef}
            type="button"
          >
            {open ? <X aria-hidden="true" className="size-5" /> : <DirectorIcon className="size-6" />}
          </button>
          {!open ? (
            <span className="pointer-events-none absolute bottom-[calc(100%+10px)] right-0 translate-y-1 whitespace-nowrap rounded-[6px] bg-[#eeeeee] px-3 py-2 text-[13px] font-medium text-[#202020] opacity-0 shadow-xl transition group-hover/director:translate-y-0 group-hover/director:opacity-100 group-focus-within/director:translate-y-0 group-focus-within/director:opacity-100 max-sm:hidden" role="tooltip">
              Conversar com a IA Diretor
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
