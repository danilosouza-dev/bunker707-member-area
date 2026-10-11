"use client";

import { AlertCircle, ChevronDown, MessageSquareText, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { replyToComment } from "@/server/community/actions";
import { renderQuickReply } from "@/server/community/model";
import { commentBodySchema } from "@/server/community/schemas";
import type { QueueItem, QuickReply } from "@/server/community/types";
import { adminTextareaClass } from "../form";
import { AuthorAvatar, ProfessorBadge } from "./author-avatar";
import { COMMUNITY_TAB_HREFS } from "./hrefs";
import { insertQuickReply } from "./queue-model";
import { menuContentClass, menuItemClass, rowButtonClass } from "./row-menu";

// Editor de resposta na propria linha da fila (docs/17 §1.9): selo Professor, respostas rapidas com
// {nome}/{aula}, Cmd/Ctrl+Enter publica, Esc fecha guardando o rascunho. Erro fica no proprio editor.

type ReplyComposerProps = {
  draft: string;
  item: QueueItem;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onPublished: () => void;
  quickReplies: readonly QuickReply[];
};

function isApplePlatform() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

export function ReplyComposer({ draft, item, onCancel, onDraftChange, onPublished, quickReplies }: ReplyComposerProps) {
  const router = useRouter();
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // O editor so monta depois de um clique ou de "R": nunca no HTML do servidor.
  const [modKey] = useState(() => (isApplePlatform() ? "⌘" : "Ctrl"));
  const firstName = item.author.name.split(/\s+/)[0] || "aluno";

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, []);

  function publish() {
    if (pending) {
      return;
    }

    const parsed = commentBodySchema.safeParse(draft);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Escreva a resposta.");
      textareaRef.current?.focus();
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await replyToComment({ body: parsed.data, commentId: item.id, resolve: true });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onPublished();
    });
  }

  function applyQuickReply(reply: QuickReply) {
    const text = renderQuickReply(reply.body, { lessonTitle: item.path.lessonTitle, studentName: item.author.name });
    onDraftChange(insertQuickReply(draft, text));
    setError(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] p-3 animate-in fade-in duration-150 motion-reduce:animate-none"
      data-composer={item.id}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <AuthorAvatar initials="P" professor size="sm" />
        <ProfessorBadge />
        <span className="min-w-0 text-xs leading-5 text-[var(--text-tertiary)]">A resposta aparece na aula com este selo.</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className={cn(rowButtonClass, "ml-auto gap-1 text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]")}
                type="button"
                variant="ghost"
              />
            }
          >
            <MessageSquareText aria-hidden="true" className="size-4" />
            Respostas rápidas
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(menuContentClass, "w-72")}>
            {quickReplies.length > 0 ? (
              <>
                <DropdownMenuLabel className="px-2 py-1.5 text-xs text-[var(--text-tertiary)]">
                  {"Preenche {nome} e {aula} sozinho"}
                </DropdownMenuLabel>
                {quickReplies.map((reply) => (
                  <DropdownMenuItem className={cn(menuItemClass, "h-auto min-h-9 py-2")} key={reply.id} onClick={() => applyQuickReply(reply)}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{reply.title}</span>
                      <span className="block truncate text-xs text-[var(--text-tertiary)]">{reply.body}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
              </>
            ) : (
              <DropdownMenuLabel className="px-2 py-2 text-[13px] leading-5 text-[var(--text-secondary)]">
                Nenhuma resposta rápida ainda.
              </DropdownMenuLabel>
            )}
            <DropdownMenuItem className={menuItemClass} onClick={() => router.push(COMMUNITY_TAB_HREFS.regras)}>
              <Plus aria-hidden="true" className="size-4" />
              Criar em Regras
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <label className="sr-only" htmlFor={textareaId}>
        Resposta para {item.author.name}
      </label>
      <textarea
        aria-describedby={error ? `${textareaId}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(adminTextareaClass, "min-h-28 bg-[var(--surface-1)]")}
        disabled={pending}
        id={textareaId}
        maxLength={2_000}
        onChange={(event) => {
          onDraftChange(event.target.value);

          if (error) {
            setError(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            publish();
          }

          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        placeholder={`Escreva sua resposta para ${firstName}`}
        ref={textareaRef}
        rows={4}
        value={draft}
      />
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${textareaId}-error`} role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] md:flex">
          <kbd className="grid h-5 min-w-5 place-items-center rounded border border-[var(--border-strong)] bg-[var(--surface-1)] px-1 font-sans text-xs text-[var(--text-secondary)]">
            {modKey}
          </kbd>
          <kbd className="grid h-5 place-items-center rounded border border-[var(--border-strong)] bg-[var(--surface-1)] px-1 font-sans text-xs text-[var(--text-secondary)]">
            Enter
          </kbd>
          publica
        </span>
        <span className="flex-1" />
        <Button
          className={cn(rowButtonClass, "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]")}
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          Cancelar
        </Button>
        <Button aria-keyshortcuts="Meta+Enter Control+Enter" className={rowButtonClass} disabled={pending} onClick={publish} type="button">
          {pending ? "Publicando…" : "Publicar resposta"}
        </Button>
      </div>
    </div>
  );
}
