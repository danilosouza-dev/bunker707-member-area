"use client";

import { CornerDownRight, LoaderCircle, LockKeyhole, Send, X } from "lucide-react";
import { useEffect, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";

// Caixa de escrever comentario da aula (docs/12 "Comentarios da aula"): cartao proprio, diferente dos
// comentarios publicados, com a foto do aluno (ou as iniciais), campo que cresce, faixa "Respondendo a @usuario",
// contador perto do limite e Ctrl/⌘ + Enter para publicar. Aula bloqueada: campo desabilitado com o
// motivo. O envio continua em lesson-experience.tsx (handleCommentSubmit).

export const LESSON_COMMENT_MAX_LENGTH = 2000;
const COUNTER_THRESHOLD = 1800;
const MAX_TEXTAREA_HEIGHT = 240;

export type LessonCommentReplyTarget = {
  author: string;
  username: string;
};

export function LessonCommentComposer({
  authorAvatarUrl,
  authorName,
  disabledReason,
  inputRef,
  onCancelReply,
  onChange,
  onSubmit,
  replyTarget,
  submitting,
  value
}: {
  /** Foto do aluno (a mesma do menu do topo); sem ela, as iniciais. */
  authorAvatarUrl?: string | null;
  authorName: string;
  /** Aula ainda bloqueada: o campo fica desabilitado com este motivo. */
  disabledReason?: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onCancelReply: () => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  replyTarget: LessonCommentReplyTarget | null;
  submitting: boolean;
  value: string;
}) {
  const isDisabled = Boolean(disabledReason);
  const length = value.length;
  const canSubmit = value.trim().length > 0 && !submitting && !isDisabled;
  const showCounter = length >= COUNTER_THRESHOLD;
  const submitLabel = replyTarget ? "Responder" : "Publicar";

  useEffect(() => {
    const textarea = inputRef.current;

    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [inputRef, value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();

      if (canSubmit) {
        event.currentTarget.form?.requestSubmit();
      }
    }
  }

  return (
    <form
      aria-label={replyTarget ? `Responder a ${replyTarget.author}` : "Novo comentário"}
      className={`overflow-hidden rounded-[14px] border transition-[border-color,background-color] ${
        isDisabled
          ? "border-white/[0.06] bg-white/[0.02]"
          : "border-white/10 bg-[#1d1d1d] focus-within:border-white/25 focus-within:bg-[#202020]"
      }`}
      onSubmit={onSubmit}
    >
      {replyTarget ? (
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.03] px-3 py-2 sm:px-4">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-zinc-300">
            <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0 text-zinc-500" />
            <span className="truncate">
              Respondendo a <span className="font-bold text-white">@{replyTarget.username}</span>
            </span>
          </span>
          <button
            aria-label="Cancelar resposta"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold text-zinc-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={onCancelReply}
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
            <span className="max-sm:hidden">Cancelar</span>
          </button>
        </div>
      ) : null}

      <div className="flex gap-3 px-3 pb-2 pt-3 sm:px-4 sm:pt-4">
        <MemberAvatar className="max-sm:hidden" imageSrc={authorAvatarUrl} name={authorName} size="md" />
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="lesson-comment">
            {replyTarget ? "Escrever resposta" : "Escrever comentário"}
          </label>
          <textarea
            aria-describedby="lesson-comment-help"
            className="block min-h-12 w-full resize-none bg-transparent py-1.5 text-[15px] leading-6 text-white outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
            disabled={submitting || isDisabled}
            id="lesson-comment"
            maxLength={LESSON_COMMENT_MAX_LENGTH}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isDisabled
                ? disabledReason
                : replyTarget
                  ? `Escreva sua resposta para ${replyTarget.author}`
                  : "Compartilhe uma dúvida ou insight sobre a aula"
            }
            ref={inputRef}
            rows={2}
            style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
            value={value}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-3 pb-3 sm:pl-[4.25rem] sm:pr-4">
        <p className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-zinc-500" id="lesson-comment-help">
          {isDisabled ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-amber-200/90">
              <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">Aula ainda não liberada</span>
            </span>
          ) : (
            <span className="max-sm:hidden">Ctrl ou ⌘ + Enter para publicar</span>
          )}
          {showCounter ? (
            <span
              aria-live="polite"
              className={`shrink-0 font-semibold tabular-nums ${length >= LESSON_COMMENT_MAX_LENGTH ? "text-red-300" : "text-amber-200"}`}
            >
              {length.toLocaleString("pt-BR")}/{LESSON_COMMENT_MAX_LENGTH.toLocaleString("pt-BR")}
            </span>
          ) : null}
        </p>
        <button
          aria-label={replyTarget ? "Enviar resposta" : "Publicar comentário"}
          className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-extrabold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
            canSubmit
              ? "bg-white text-black shadow-lg shadow-black/30 hover:bg-zinc-200"
              : "cursor-not-allowed bg-white/[0.08] text-zinc-500"
          }`}
          disabled={!canSubmit}
          type="submit"
        >
          {submitting ? (
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          ) : (
            <Send aria-hidden="true" className="size-4" />
          )}
          {submitting ? "Enviando..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
