"use client";

import { AlertCircle, Plus, X } from "lucide-react";
import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { adminInputClass } from "../form";
import { adminTransition } from "../styles";
import { VideoProviderIcon } from "./content-ui";
import {
  describeCreationResult,
  describeLessonInput,
  describeNothingCreated,
  isMultiLinePaste,
  isSingleVideoPaste,
  leftoverLines,
  planLessonInput,
  type LeftoverLine
} from "./lesson-paste";
import { useContentTreeActions } from "./tree-context";

// "+ Adicionar aula" e "+ Adicionar módulo" no lugar (docs/17 §1.6.3): Enter cria e deixa o campo
// pronto para a proxima; Esc fecha; colar varias linhas cria varias aulas; colar um link de video
// no campo vazio ja cria a aula com o video reconhecido. Linhas de uma colagem que nao viraram aula
// (link nao reconhecido, alem do limite) ficam listadas embaixo do campo, cada uma com "Corrigir".

const LESSON_HINT = "Enter cria e abre outra · Esc fecha · colar várias linhas cria várias aulas";

export const addRowButtonClass = cn(
  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-[var(--text-secondary)] md:min-h-9",
  "hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
  adminTransition
);

export function AddLessonButton({ onClick }: { onClick: () => void }) {
  return (
    <button className={addRowButtonClass} onClick={onClick} type="button">
      <Plus aria-hidden="true" className="size-4 shrink-0" />
      Adicionar aula
      <span className="hidden truncate text-[13px] font-normal text-[var(--text-tertiary)] sm:inline">cole um ou vários links aqui</span>
    </button>
  );
}

type AddLessonInputProps = {
  moduleId: string;
  moduleTitle: string;
};

export function AddLessonInput({ moduleId, moduleTitle }: AddLessonInputProps) {
  const actions = useContentTreeActions();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [leftovers, setLeftovers] = useState<LeftoverLine[]>([]);
  const feedback = describeLessonInput(value);

  function create(text: string) {
    const plan = planLessonInput(text);
    const multiLine = isMultiLinePaste(text);

    // Colagem de varias linhas: o que nao virou aula fica listado para corrigir ali mesmo. Uma linha
    // so (digitada) continua no campo, com o erro embaixo.
    if (multiLine) {
      setLeftovers(leftoverLines(plan));
    }

    if (plan.items.length === 0) {
      setNotice(multiLine ? describeNothingCreated(plan) : (plan.rejected[0]?.message ?? null));

      return false;
    }

    actions.createLessons(moduleId, plan);
    setNotice(
      plan.rejected.length > 0 || plan.truncated > 0
        ? describeCreationResult({ created: plan.items.length, rejected: plan.rejected.length, skipped: 0, truncated: plan.truncated })
        : null
    );

    return true;
  }

  function fixLeftover(index: number) {
    const item = leftovers[index];

    if (!item) {
      return;
    }

    setValue(item.line);
    setLeftovers((current) => current.filter((_, position) => position !== index));
    setNotice(null);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      actions.setAddingLessonIn(null);

      return;
    }

    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if (!value.trim()) {
      if (leftovers.length === 0) {
        actions.setAddingLessonIn(null);
      }

      return;
    }

    if (create(value)) {
      setValue("");
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");

    if (isMultiLinePaste(text)) {
      event.preventDefault();
      create(text);

      return;
    }

    const input = event.currentTarget;
    const replacesEverything = input.selectionStart === 0 && input.selectionEnd === input.value.length;

    if ((replacesEverything || !value) && isSingleVideoPaste(text) && planLessonInput(text).items.length > 0) {
      event.preventDefault();
      create(text);
      setValue("");
    }
  }

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-1.5 py-1">
      <label className="sr-only" htmlFor={inputId}>
        Nova aula no módulo {moduleTitle}
      </label>
      <input
        aria-describedby={`${inputId}-feedback`}
        aria-invalid={feedback.kind === "error" ? true : undefined}
        autoComplete="off"
        autoFocus
        className={adminInputClass}
        id={inputId}
        onBlur={() => {
          // Com linhas para corrigir, o campo fica aberto (o clique em "Corrigir" tira o foco daqui).
          if (!value.trim() && leftovers.length === 0) {
            actions.setAddingLessonIn(null);
          }
        }}
        onChange={(event) => {
          setValue(event.target.value);
          setNotice(null);
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Nome da aula ou link do vídeo"
        ref={inputRef}
        spellCheck={false}
        value={value}
      />
      <div aria-live="polite" className="flex min-h-5 flex-col gap-1 text-[13px] leading-5" id={`${inputId}-feedback`}>
        {feedback.kind === "video" ? (
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-secondary)]">
            <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 text-xs font-medium text-[var(--text-primary)]">
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", feedback.tone === "warning" ? "bg-[var(--warning)]" : "bg-[var(--success)]")}
              />
              <VideoProviderIcon className="size-3.5" provider={feedback.provider} />
              {feedback.label}
            </span>
            <span className="min-w-0">{feedback.notice}</span>
          </p>
        ) : feedback.kind === "error" ? (
          <p className="flex items-start gap-1.5 text-[var(--error)]">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {feedback.message}
          </p>
        ) : (
          <p className="text-[var(--text-tertiary)]">{LESSON_HINT}</p>
        )}
        {notice ? <p className="text-[var(--text-secondary)]">{notice}</p> : null}
      </div>
      {leftovers.length > 0 ? (
        <LeftoverList
          items={leftovers}
          onDismiss={() => {
            setLeftovers([]);
            inputRef.current?.focus();
          }}
          onFix={fixLeftover}
        />
      ) : null}
    </div>
  );
}

type LeftoverListProps = {
  items: LeftoverLine[];
  onDismiss: () => void;
  onFix: (index: number) => void;
};

/** Linhas da colagem que nao viraram aula, com o motivo de cada uma e "Corrigir" (volta para o campo). */
function LeftoverList({ items, onDismiss, onFix }: LeftoverListProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--warning-border)] py-1.5 pr-1.5 pl-3">
        <h4 className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={headingId}>
          {items.length === 1 ? "1 linha não virou aula" : `${items.length} linhas não viraram aula`}
        </h4>
        <button
          aria-label="Dispensar a lista"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
            adminTransition
          )}
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>
      <ul className="flex max-h-60 min-w-0 flex-col overflow-y-auto">
        {items.map((item, index) => (
          <li
            className="flex min-w-0 items-start gap-3 border-b border-[var(--warning-border)] px-3 py-2 last:border-b-0"
            key={`${index}-${item.line}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] leading-5 text-[var(--text-primary)]" title={item.line}>
                {item.line}
              </p>
              <p className="text-xs leading-5 text-[var(--text-secondary)]">{item.message}</p>
            </div>
            <button
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center rounded-md px-2.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--hover-overlay)]",
                adminTransition
              )}
              onClick={() => onFix(index)}
              type="button"
            >
              Corrigir
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AddModuleInput({ onClose }: { onClose: () => void }) {
  const actions = useContentTreeActions();
  const inputId = useId();
  const [value, setValue] = useState("");

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();

      return;
    }

    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    const title = value.trim().slice(0, 120);

    if (!title) {
      onClose();

      return;
    }

    actions.createModule(title);
    setValue("");
  }

  return (
    <div className="flex w-full max-w-[480px] flex-col gap-1.5">
      <label className="sr-only" htmlFor={inputId}>
        Nome do novo módulo
      </label>
      <input
        aria-describedby={`${inputId}-hint`}
        autoComplete="off"
        autoFocus
        className={adminInputClass}
        id={inputId}
        maxLength={120}
        onBlur={() => {
          if (!value.trim()) {
            onClose();
          }
        }}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Nome do módulo, ex.: Fundamentos"
        value={value}
      />
      <p className="text-[13px] leading-5 text-[var(--text-tertiary)]" id={`${inputId}-hint`}>
        Enter cria o módulo e abre a primeira aula · Esc fecha
      </p>
    </div>
  );
}
