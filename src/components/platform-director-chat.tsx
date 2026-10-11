"use client";

import {
  ArrowLeft,
  Check,
  Compass,
  EllipsisVertical,
  History,
  ListTree,
  LoaderCircle,
  Map,
  PencilLine,
  Plus,
  Route,
  Search,
  Send,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

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
};

const mobileMediaQuery = "(max-width: 639px)";

const panelId = "platform-director-chat";

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

function DirectorIcon({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-grid place-items-center ${className}`}>
      <Compass className="h-full w-full" strokeWidth={1.9} />
      <Sparkles className="absolute -right-1 -top-1 h-2.5 w-2.5 text-[var(--accent)]" strokeWidth={2.2} />
    </span>
  );
}

function formatConversationDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function isAuthorizedMemberHref(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;

  const pathname = value.split(/[?#]/, 1)[0];

  return pathname === "/" ||
    pathname === "/favoritos" ||
    pathname === "/minhas-compras" ||
    pathname.startsWith("/conteudo/");
}

function MessageText({ body }: { body: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-6">{body}</div>;
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

export function PlatformDirectorChat({ defaultOpen = false, onNavigate }: PlatformDirectorChatProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  // Montado só no cliente (next/dynamic com ssr: false): lê a mídia já no primeiro
  // render para o painel aberto por defaultOpen não piscar no layout de desktop.
  const [mobile, setMobile] = React.useState(() => (
    typeof window !== "undefined" && window.matchMedia(mobileMediaQuery).matches
  ));
  const [availability, setAvailability] = React.useState<GuideAvailability>({ available: false, reason: null });
  const [conversations, setConversations] = React.useState<GuideConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState("");
  const [messages, setMessages] = React.useState<GuideMessage[]>([]);
  const [question, setQuestion] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
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
      const currentStillExists = data.conversations.some((conversation) => conversation.id === activeConversationId);
      const nextConversationId = currentStillExists ? activeConversationId : data.conversations[0]?.id ?? "";
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
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeConversationId, loadConversation]);

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

  return (
    <div className="pointer-events-none fixed inset-0 z-[180]">
      {open ? (
        <section
          aria-labelledby="platform-director-title"
          aria-modal={mobile}
          className="pointer-events-auto fixed bottom-24 right-4 flex h-[min(42rem,calc(100dvh-7.5rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#171717] shadow-[0_28px_100px_rgba(0,0,0,0.78)] outline-none animate-in fade-in zoom-in-95 duration-200 max-sm:inset-0 max-sm:h-dvh max-sm:w-screen max-sm:rounded-none max-sm:border-0"
          id={panelId}
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
        >
          <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#1b1b1b] px-4">
            {historyOpen ? (
              <button
                aria-label="Voltar para a conversa"
                className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => setHistoryOpen(false)}
                type="button"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : (
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/10 text-white">
                <DirectorIcon className="size-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-white" id="platform-director-title">
                {historyOpen ? "Histórico da IA Diretor" : "IA Diretor"}
              </h2>
              <p className="mt-0.5 truncate text-[11px] font-medium text-zinc-500">
                {historyOpen ? "Suas conversas salvas" : "Orientação sobre seus cursos e trilhas"}
              </p>
            </div>
            {!historyOpen ? (
              <button
                aria-label="Abrir histórico da IA Diretor"
                className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => setHistoryOpen(true)}
                type="button"
              >
                <History className="size-4" />
              </button>
            ) : null}
            <button
              aria-label="Criar novo chat com a IA Diretor"
              className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              disabled={!availability.available || creating}
              onClick={() => void createConversation()}
              type="button"
            >
              {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
            </button>
            <button
              aria-label="Fechar IA Diretor"
              className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              onClick={() => closeChat()}
              type="button"
            >
              <X className="size-4" />
            </button>
          </header>

          {historyOpen ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="grid min-h-48 place-items-center text-zinc-600"><LoaderCircle className="size-4 animate-spin" /></div>
              ) : conversations.length === 0 ? (
                <div className="grid min-h-56 place-items-center px-6 text-center">
                  <div>
                    <History className="mx-auto size-6 text-zinc-700" />
                    <p className="mt-3 text-sm font-semibold text-zinc-300">Nenhum chat ainda</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-600">Suas conversas com a IA Diretor aparecerão aqui.</p>
                  </div>
                </div>
              ) : conversations.map((conversation) => (
                <div className="group relative" data-guide-conversation-menu key={conversation.id}>
                  <button
                    className={`mb-1 w-full rounded-[8px] py-3 pl-3 pr-10 text-left transition ${activeConversationId === conversation.id ? "bg-white/[0.09]" : "hover:bg-white/[0.045]"}`}
                    onClick={() => void selectConversation(conversation.id)}
                    type="button"
                  >
                    <span className="block truncate text-xs font-semibold text-zinc-200">{conversation.title}</span>
                    <span className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-medium text-zinc-600">
                      <span>{conversation.messageCount} mensagens</span>
                      <span>{formatConversationDate(conversation.lastMessageAt)}</span>
                    </span>
                  </button>
                  <button
                    aria-expanded={openConversationMenuId === conversation.id}
                    aria-haspopup="menu"
                    aria-label={`Opções do chat ${conversation.title}`}
                    className={`absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-[6px] text-zinc-500 transition hover:bg-black/30 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${openConversationMenuId === conversation.id ? "bg-black/30 text-zinc-200 opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100"}`}
                    onClick={() => setOpenConversationMenuId((current) => current === conversation.id ? "" : conversation.id)}
                    type="button"
                  >
                    <EllipsisVertical className="size-4" />
                  </button>
                  {openConversationMenuId === conversation.id ? (
                    <div className="absolute right-1.5 top-10 z-20 w-40 rounded-[8px] border border-white/10 bg-[#232323]/98 p-1 shadow-[0_14px_38px_rgba(0,0,0,0.55)] backdrop-blur-md" role="menu">
                      <button
                        className="flex min-h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[6px] px-2.5 text-left text-xs font-medium text-zinc-300 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
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
                        <PencilLine className="size-3.5" /> Renomear chat
                      </button>
                      <div className="mx-2 border-t border-white/[0.07]" />
                      <button
                        className="flex min-h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[6px] px-2.5 text-left text-xs font-medium text-red-300 transition hover:bg-red-400/10 disabled:opacity-40"
                        disabled={Boolean(deletingConversationId || renamingConversationId) || (sending && activeConversationId === conversation.id)}
                        onClick={() => {
                          setConversationPendingDelete(conversation);
                          setOpenConversationMenuId("");
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <Trash2 className="size-3.5" /> Excluir chat
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="flex min-h-11 shrink-0 items-center border-b border-white/[0.07] px-4">
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-500">
                  {selectedConversation?.title ?? "Nova conversa"}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5">
                {loading || messagesLoading ? (
                  <div className="grid min-h-full place-items-center text-xs font-medium text-zinc-600">
                    <span className="inline-flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" /> Carregando sua IA Diretor...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center py-4 text-center">
                    <span className="mx-auto grid size-12 place-items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 text-white">
                      <DirectorIcon className="size-6" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-white">Como posso orientar você?</h3>
                    <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-zinc-400">
                      Encontre aulas, descubra o que estudar e organize seu próximo passo.
                    </p>
                    <div className="mt-5 grid gap-2">
                      {suggestions.map((suggestion) => {
                        const Icon = suggestion.icon;

                        return (
                          <button
                            className="flex min-h-11 items-center gap-3 rounded-[8px] border border-white/[0.08] bg-white/[0.025] px-3 text-left text-xs font-medium text-zinc-300 transition hover:bg-white/[0.055] hover:text-white disabled:opacity-40"
                            disabled={inputDisabled}
                            key={suggestion.label}
                            onClick={() => {
                              setQuestion(suggestion.prompt);
                              window.requestAnimationFrame(() => inputRef.current?.focus());
                            }}
                            type="button"
                          >
                            <Icon className="size-4 shrink-0 text-zinc-500" />
                            {suggestion.label}
                          </button>
                        );
                      })}
                    </div>
                    {!availability.available ? (
                      <p className="mt-5 rounded-[8px] border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2 text-xs font-medium leading-5 text-amber-100/80">
                        {availability.reason ?? "A IA Diretor não está disponível agora."}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-5">
                    {messages.map((message) => {
                      const authorizedReferences = (message.references ?? []).filter((reference) => isAuthorizedMemberHref(reference.href));

                      return (
                        <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`} key={message.id}>
                          {message.role === "user" ? (
                            <div className="max-w-[86%] rounded-2xl rounded-br-[5px] bg-white/[0.1] px-4 py-3 text-zinc-100">
                              <MessageText body={message.body} />
                            </div>
                          ) : (
                            <div className="flex min-w-0 max-w-full items-start gap-3">
                              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent)]/10 text-white">
                                <DirectorIcon className="size-4" />
                              </span>
                              <div className={`min-w-0 flex-1 ${message.status === "failed" ? "text-red-200" : "text-zinc-200"}`}>
                                {message.status === "pending" ? (
                                  <span className="inline-flex items-center gap-2 py-2 text-sm text-zinc-500"><LoaderCircle className="size-4 animate-spin" /> Organizando sua orientação...</span>
                                ) : (
                                  <MarkdownMessage body={message.body} />
                                )}
                                {authorizedReferences.length > 0 ? (
                                  <div aria-label="Conteúdos recomendados" className="mt-3 grid gap-2">
                                    {authorizedReferences.map((reference) => (
                                      <Link
                                        className="group/reference flex items-center gap-3 rounded-[8px] border border-white/[0.09] bg-white/[0.03] p-3 outline-none transition hover:border-white/[0.16] hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/60"
                                        href={reference.href}
                                        key={reference.id}
                                        onClick={(event) => handleReferenceNavigation(event, reference.href)}
                                        prefetch={false}
                                      >
                                        <span className="grid size-9 shrink-0 place-items-center rounded-[7px] bg-black/30 text-zinc-400 group-hover/reference:text-white">
                                          {reference.kind.toLowerCase().includes("aula") || reference.kind.toLowerCase().includes("lesson") ? <ListTree className="size-4" /> : <Map className="size-4" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block text-[10px] font-semibold uppercase text-zinc-500">{reference.label || reference.kind}</span>
                                          <span className="mt-0.5 block line-clamp-2 text-xs font-semibold leading-5 text-zinc-200">{reference.title}</span>
                                          {reference.breadcrumb ? <span className="mt-0.5 block truncate text-[10px] text-zinc-600">{reference.breadcrumb}</span> : null}
                                        </span>
                                        <span className="text-[10px] font-semibold text-zinc-500 transition group-hover/reference:text-white">Abrir</span>
                                      </Link>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <form
                className="shrink-0 border-t border-white/[0.08] bg-[#171717] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:p-3"
                onSubmit={(event) => void sendQuestion(event)}
              >
                {error ? <p className="mb-2 rounded-[7px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200">{error}</p> : null}
                <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-black/25 p-2 focus-within:border-white/20">
                  <textarea
                    aria-label="Mensagem para a IA Diretor"
                    className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-white outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed"
                    disabled={inputDisabled}
                    maxLength={4000}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendQuestion();
                      }
                    }}
                    placeholder={availability.available ? "Pergunte onde encontrar ou o que estudar..." : "IA Diretor indisponível"}
                    ref={inputRef}
                    rows={1}
                    value={question}
                  />
                  <button
                    aria-label="Enviar mensagem à IA Diretor"
                    className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-white text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    disabled={inputDisabled || !question.trim()}
                    type="submit"
                  >
                    {sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </button>
                </div>
                <p className="mt-2 text-center text-[10px] font-medium text-zinc-600">Suas conversas com a IA Diretor ficam salvas no seu histórico.</p>
              </form>
            </>
          )}

          {conversationPendingRename ? (
            <div className="absolute inset-0 z-30 grid place-items-center bg-black/78 p-4 backdrop-blur-sm">
              <section aria-labelledby="rename-guide-chat-title" aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-xl border border-white/10 bg-[#191919] shadow-[0_24px_80px_rgba(0,0,0,0.75)]" role="dialog">
                <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white" id="rename-guide-chat-title">Editar nome do chat</h3>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Use um nome curto para encontrar esta conversa.</p>
                  </div>
                  <button aria-label="Fechar edição do nome" className="grid size-8 place-items-center rounded-full text-zinc-500 hover:bg-white/[0.07] hover:text-white" disabled={Boolean(renamingConversationId)} onClick={() => setConversationPendingRename(null)} type="button"><X className="size-4" /></button>
                </div>
                <form className="p-4" onSubmit={(event) => void renameConversation(event)}>
                  <label className="text-xs font-medium text-zinc-400" htmlFor="guide-chat-name">Nome do chat</label>
                  <input
                    aria-invalid={Boolean(renameError)}
                    className="mt-2 h-10 w-full rounded-[8px] border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus:border-white/25"
                    id="guide-chat-name"
                    maxLength={160}
                    onChange={(event) => {
                      setRenameTitle(event.target.value);
                      if (renameError) setRenameError("");
                    }}
                    ref={renameInputRef}
                    value={renameTitle}
                  />
                  {renameError ? <p className="mt-2 text-xs font-medium text-red-300">{renameError}</p> : null}
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="min-h-10 rounded-[8px] border border-white/10 bg-white/[0.045] px-4 text-sm font-medium text-zinc-200 hover:bg-white/[0.08] disabled:opacity-40" disabled={Boolean(renamingConversationId)} onClick={() => setConversationPendingRename(null)} type="button">Cancelar</button>
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-white px-4 text-sm font-semibold text-black hover:bg-zinc-200 disabled:bg-white/10 disabled:text-zinc-600" disabled={Boolean(renamingConversationId) || !renameTitle.trim()} type="submit">
                      {renamingConversationId ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Salvar
                    </button>
                  </div>
                </form>
              </section>
            </div>
          ) : null}

          {conversationPendingDelete ? (
            <div className="absolute inset-0 z-30 grid place-items-center bg-black/78 p-4 backdrop-blur-sm">
              <section aria-labelledby="delete-guide-chat-title" aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-xl border border-white/10 bg-[#191919] shadow-[0_24px_80px_rgba(0,0,0,0.75)]" role="dialog">
                <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] p-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white" id="delete-guide-chat-title">Excluir chat?</h3>
                    <p className="mt-1 truncate text-xs text-zinc-500">{conversationPendingDelete.title}</p>
                  </div>
                  <button aria-label="Cancelar exclusão" className="grid size-8 place-items-center rounded-full text-zinc-500 hover:bg-white/[0.07] hover:text-white" disabled={Boolean(deletingConversationId)} onClick={() => setConversationPendingDelete(null)} type="button"><X className="size-4" /></button>
                </div>
                <div className="p-4">
                  <p className="text-sm leading-6 text-zinc-400">Este chat será removido do seu histórico e não poderá mais ser consultado ou continuado.</p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="min-h-10 rounded-[8px] border border-white/10 bg-white/[0.045] px-4 text-sm font-medium text-zinc-200 hover:bg-white/[0.08] disabled:opacity-40" disabled={Boolean(deletingConversationId)} onClick={() => setConversationPendingDelete(null)} type="button">Cancelar</button>
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-red-500/15 px-4 text-sm font-semibold text-red-200 hover:bg-red-500/25 disabled:opacity-40" disabled={Boolean(deletingConversationId) || (sending && activeConversationId === conversationPendingDelete.id)} onClick={() => void deleteConversation()} type="button">
                      {deletingConversationId ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Excluir chat
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
            className="grid size-14 place-items-center rounded-full border border-white/15 bg-white text-black shadow-[0_18px_55px_rgba(0,0,0,0.62)] transition duration-200 hover:scale-105 hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            onClick={toggleChat}
            ref={launcherRef}
            type="button"
          >
            {open ? <X className="size-5" /> : <DirectorIcon className="size-6" />}
          </button>
          {!open ? (
            <span className="pointer-events-none absolute bottom-[calc(100%+10px)] right-0 translate-y-1 whitespace-nowrap rounded-[5px] bg-[#eeeeee] px-3 py-2 text-xs font-medium text-[#202020] opacity-0 shadow-xl transition group-hover/director:translate-y-0 group-hover/director:opacity-100 group-focus-within/director:translate-y-0 group-focus-within/director:opacity-100 max-sm:hidden" role="tooltip">
              Conversar com a IA Diretor
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
