"use client";

import { ShieldBan, Trash2 } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { AdminBlockedWordRule } from "@/lib/platform-types";
import { cn } from "@/lib/utils";
import { createBlockedWord, deleteBlockedWord, toggleBlockedWord } from "@/server/community/rules";
import { blockedWordSchema } from "@/server/community/schemas";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { adminCard, adminTransition } from "../styles";
import { adminToast } from "../toast";
import { describeBlockedWordCount, isDuplicateBlockedTerm } from "./rules-model";
import { rowIconButtonClass } from "./row-menu";

// Regras › Palavras bloqueadas: comentario com um termo ativo nao e publicado e o aluno ve a mensagem
// para reescrever (mesma regra do envio do aluno). Adicionar, ligar/desligar sem apagar e excluir com
// "Desfazer" (recria o mesmo termo).

type BlockedWordsSectionProps = {
  canEdit: boolean;
  items: readonly AdminBlockedWordRule[];
};

type FormErrors = Partial<Record<"message" | "word", string>>;

const WORD_HINT = "Uma palavra ou expressão. Acentos e maiúsculas não importam.";
const MESSAGE_HINT = "O que o aluno lê ao tentar publicar. Sem mensagem, usamos a padrão.";

export function BlockedWordsSection({ canEdit, items }: BlockedWordsSectionProps) {
  const baseId = useId();
  const wordRef = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<{ items: AdminBlockedWordRule[]; source: readonly AdminBlockedWordRule[] }>({ items: [...items], source: items });
  const [word, setWord] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (list.source !== items) {
    setList({ items: [...items], source: items });
  }

  const words = list.items;
  const wordId = `${baseId}-word`;
  const messageId = `${baseId}-message`;

  function replace(rule: AdminBlockedWordRule) {
    setList((current) => ({ ...current, items: current.items.map((item) => (item.id === rule.id ? rule : item)) }));
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (adding) {
      return;
    }

    const parsed = blockedWordSchema.safeParse({ message: message.trim() || undefined, word });

    if (!parsed.success) {
      const next: FormErrors = {};

      for (const issue of parsed.error.issues) {
        const field = issue.path[0];

        if ((field === "word" || field === "message") && !next[field]) {
          next[field] = issue.message;
        }
      }

      setErrors(next);
      wordRef.current?.focus();
      return;
    }

    if (isDuplicateBlockedTerm(parsed.data.word, words)) {
      setErrors({ word: "Esta palavra ou termo já está na lista." });
      wordRef.current?.focus();
      return;
    }

    setAdding(true);
    setError(null);

    const result = await createBlockedWord(parsed.data);
    setAdding(false);

    if (!result.ok) {
      if (result.status === 409 || result.fieldErrors?.word) {
        setErrors({ message: result.fieldErrors?.message?.[0], word: result.fieldErrors?.word?.[0] ?? result.error });
      } else {
        setError(result.error);
      }

      return;
    }

    setList((current) => ({ ...current, items: [result.data, ...current.items] }));
    setWord("");
    setMessage("");
    setErrors({});
    wordRef.current?.focus();
    adminToast.success(`“${result.data.word}” bloqueado`);
  }

  async function toggle(rule: AdminBlockedWordRule) {
    setError(null);
    setBusy(rule.id);
    replace({ ...rule, active: !rule.active });

    const result = await toggleBlockedWord({ active: !rule.active, id: rule.id });
    setBusy(null);

    if (!result.ok) {
      replace(rule);
      setError(result.error);
      return;
    }

    replace(result.data);
  }

  async function remove(rule: AdminBlockedWordRule) {
    setError(null);
    setList((current) => ({ ...current, items: current.items.filter((item) => item.id !== rule.id) }));

    const result = await deleteBlockedWord({ id: rule.id });

    if (!result.ok) {
      setList((current) => ({ ...current, items: [rule, ...current.items] }));
      setError(result.error);
      return;
    }

    adminToast.success(`“${rule.word}” excluído`, {
      onUndo: async () => {
        const undo = await createBlockedWord({ message: rule.message, word: rule.word });

        if (!undo.ok) {
          setError(undo.error);
          return;
        }

        let restored = undo.data;

        if (!rule.active) {
          const off = await toggleBlockedWord({ active: false, id: undo.data.id });
          restored = off.ok ? off.data : restored;
        }

        setList((current) => ({ ...current, items: [restored, ...current.items] }));
      }
    });
  }

  return (
    <section aria-labelledby={`${baseId}-title`} className={cn(adminCard, "@container flex min-w-0 flex-col")}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id={`${baseId}-title`}>
            Palavras bloqueadas
          </h2>
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            Comentário com um destes termos não é publicado: o aluno vê a mensagem e pode reescrever.
          </p>
        </div>
        <span className="shrink-0 pt-1 text-xs leading-5 font-medium text-[var(--text-tertiary)]">{describeBlockedWordCount(words)}</span>
      </header>

      {error ? <ErrorBanner className="mx-4 mt-3">{error}</ErrorBanner> : null}

      {canEdit ? (
        <form
          className="grid min-w-0 gap-3 border-b border-[var(--border-subtle)] px-4 py-4 @min-[720px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] @min-[720px]:items-start"
          noValidate
          onSubmit={(event) => void add(event)}
        >
          <AdminField error={errors.word} hint={WORD_HINT} id={wordId} label="Palavra ou termo">
            <input
              aria-describedby={fieldDescribedBy(wordId, { error: errors.word, hint: errors.word ? undefined : WORD_HINT })}
              aria-invalid={errors.word ? true : undefined}
              autoComplete="off"
              className={adminInputClass}
              id={wordId}
              maxLength={120}
              onChange={(event) => {
                setWord(event.target.value);

                if (errors.word) {
                  setErrors((current) => ({ ...current, word: undefined }));
                }
              }}
              placeholder="ex.: link na bio"
              ref={wordRef}
              value={word}
            />
          </AdminField>
          <AdminField error={errors.message} hint={MESSAGE_HINT} id={messageId} label="Mensagem para o aluno" optional>
            <input
              aria-describedby={fieldDescribedBy(messageId, { error: errors.message, hint: errors.message ? undefined : MESSAGE_HINT })}
              aria-invalid={errors.message ? true : undefined}
              className={adminInputClass}
              id={messageId}
              maxLength={500}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="ex.: Propaganda não é permitida nos comentários."
              value={message}
            />
          </AdminField>
          <Button className="h-11! px-4 @min-[720px]:mt-[26px] @min-[720px]:h-10!" disabled={adding} type="submit">
            {adding ? "Adicionando…" : "Adicionar"}
          </Button>
        </form>
      ) : null}

      {words.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
          <ShieldBan aria-hidden="true" className="mb-2 size-5 text-[var(--text-tertiary)]" />
          <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">Nenhuma palavra bloqueada</h3>
          <p className="max-w-sm text-[13px] leading-5 text-[var(--text-secondary)]">
            Bloqueie termos de propaganda ou ofensas para eles nunca aparecerem nas aulas.
          </p>
        </div>
      ) : (
        <ul aria-label="Palavras bloqueadas" className="flex min-w-0 flex-col">
          {words.map((rule) => (
            <li
              className={cn(
                "flex min-h-14 min-w-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2 last:border-b-0",
                busy === rule.id && "opacity-60"
              )}
              key={rule.id}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "truncate text-sm leading-5 font-medium",
                    rule.active ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)] line-through"
                  )}
                  title={rule.word}
                >
                  {rule.word}
                </span>
                <span className="truncate text-xs leading-5 text-[var(--text-secondary)]" title={rule.message}>
                  {rule.message}
                </span>
              </div>
              <WordSwitch
                checked={rule.active}
                disabled={!canEdit || busy === rule.id}
                label={`Bloqueio de “${rule.word}”`}
                onChange={() => void toggle(rule)}
              />
              {canEdit ? (
                <Button
                  aria-label={`Excluir “${rule.word}”`}
                  className={rowIconButtonClass}
                  onClick={() => void remove(rule)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Chave com o efeito escrito ("Ativa" / "Desligada"). Botao nativo com role="switch". */
function WordSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: () => void }) {
  return (
    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 md:min-h-8">
      <span aria-hidden="true" className="hidden w-16 text-right text-xs leading-5 font-medium text-[var(--text-secondary)] sm:block">
        {checked ? "Ativa" : "Desligada"}
      </span>
      <button
        aria-checked={checked}
        aria-label={label}
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border disabled:cursor-not-allowed disabled:opacity-60",
          checked ? "border-[var(--text-primary)] bg-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[var(--surface-2)]",
          adminTransition
        )}
        disabled={disabled}
        onClick={onChange}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute size-[18px] rounded-full transition-transform duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none",
            checked ? "translate-x-[18px] bg-[var(--surface-0)]" : "translate-x-[2px] bg-[var(--text-secondary)]"
          )}
        />
      </button>
    </span>
  );
}
