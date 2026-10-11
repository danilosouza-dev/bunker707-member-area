"use client";

import { MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteQuickReply, saveQuickReply } from "@/server/community/actions";
import { QUICK_REPLY_LIMIT, QUICK_REPLY_PREVIEW_CONTEXT, renderQuickReply } from "@/server/community/model";
import { quickReplySchema } from "@/server/community/schemas";
import type { QuickReply } from "@/server/community/types";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { AdminSheet, AdminSheetSection } from "../sheet";
import { adminCard } from "../styles";
import { adminToast } from "../toast";
import { insertAtCursor } from "./rules-model";
import { rowButtonClass, rowIconButtonClass } from "./row-menu";

// Regras › Respostas rapidas: modelos com {nome} e {aula} usados no editor da fila. Criar e editar em
// painel lateral (cabecalho, corpo rolavel, rodape fixo); excluir com "Desfazer" (recria o texto).

type QuickRepliesSectionProps = {
  canEdit: boolean;
  items: readonly QuickReply[];
};

type Draft = { body: string; id?: string; title: string };
type DraftErrors = Partial<Record<"body" | "title", string>>;

const EMPTY_DRAFT: Draft = { body: "", title: "" };
const TITLE_HINT = "Nome curto para achar no menu, ex.: “Erro de instalação”.";
const BODY_HINT = "Até 2.000 caracteres.";

export function QuickRepliesSection({ canEdit, items }: QuickRepliesSectionProps) {
  const [list, setList] = useState<{ source: readonly QuickReply[]; items: QuickReply[] }>({ items: [...items], source: items });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (list.source !== items) {
    setList({ items: [...items], source: items });
  }

  const replies = list.items;
  const atLimit = replies.length >= QUICK_REPLY_LIMIT;

  async function remove(reply: QuickReply) {
    setError(null);
    setList((current) => ({ ...current, items: current.items.filter((item) => item.id !== reply.id) }));

    const result = await deleteQuickReply({ id: reply.id });

    if (!result.ok) {
      setList((current) => ({ ...current, items: [...current.items, reply] }));
      setError(result.error);
      return;
    }

    adminToast.success("Resposta rápida excluída", {
      onUndo: async () => {
        const undo = await saveQuickReply({ body: reply.body, title: reply.title });

        if (undo.ok) {
          setList((current) => ({ ...current, items: [...current.items, undo.data] }));
        } else {
          setError(undo.error);
        }
      }
    });
  }

  function saved(reply: QuickReply, created: boolean) {
    setList((current) => ({
      ...current,
      items: created ? [...current.items, reply] : current.items.map((item) => (item.id === reply.id ? reply : item))
    }));
    setEditing(null);
    adminToast.success(created ? "Resposta rápida criada" : "Resposta rápida salva");
  }

  return (
    <section aria-labelledby="quick-replies-title" className={cn(adminCard, "flex min-w-0 flex-col")}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="quick-replies-title">
            Respostas rápidas
          </h2>
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            {"Modelos para responder na fila. {nome} vira o primeiro nome do aluno e {aula}, o nome da aula."}
          </p>
        </div>
        {canEdit ? (
          <Button
            className={cn(rowButtonClass, "gap-1.5 border-[var(--border-strong)]")}
            disabled={atLimit}
            onClick={() => {
              setError(null);
              setEditing(EMPTY_DRAFT);
            }}
            title={atLimit ? `Limite de ${QUICK_REPLY_LIMIT} respostas rápidas. Exclua uma para criar outra.` : undefined}
            type="button"
            variant="secondary"
          >
            <Plus aria-hidden="true" className="size-4" />
            Nova resposta
          </Button>
        ) : null}
      </header>

      {error ? <ErrorBanner className="mx-4 mt-3">{error}</ErrorBanner> : null}

      {replies.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
          <MessageSquareText aria-hidden="true" className="mb-2 size-5 text-[var(--text-tertiary)]" />
          <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">Nenhuma resposta rápida ainda</h3>
          <p className="max-w-sm text-[13px] leading-5 text-[var(--text-secondary)]">
            Crie modelos para as dúvidas que se repetem e responda a fila em poucos cliques.
          </p>
        </div>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2 p-4">
          {replies.map((reply) => (
            <li
              className="flex min-w-0 items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5"
              key={reply.id}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] leading-5 font-semibold text-[var(--text-primary)]">{reply.title}</span>
                <span className="line-clamp-2 text-[13px] leading-5 whitespace-pre-line text-[var(--text-secondary)] [overflow-wrap:anywhere]">
                  {reply.body}
                </span>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    aria-label={`Editar ${reply.title}`}
                    className={rowIconButtonClass}
                    onClick={() => {
                      setError(null);
                      setEditing({ body: reply.body, id: reply.id, title: reply.title });
                    }}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    aria-label={`Excluir ${reply.title}`}
                    className={rowIconButtonClass}
                    onClick={() => void remove(reply)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing ? <QuickReplySheet draft={editing} onClose={() => setEditing(null)} onSaved={saved} /> : null}
    </section>
  );
}

type QuickReplySheetProps = {
  draft: Draft;
  onClose: () => void;
  onSaved: (reply: QuickReply, created: boolean) => void;
};

function QuickReplySheet({ draft: initial, onClose, onSaved }: QuickReplySheetProps) {
  const baseId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = draft.title !== initial.title || draft.body !== initial.body;
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const creating = !initial.id;

  function validate(field: keyof DraftErrors, value: string) {
    const result = quickReplySchema.shape[field].safeParse(value);
    setErrors((current) => ({ ...current, [field]: result.success ? undefined : result.error.issues[0]?.message }));
  }

  async function save() {
    if (saving) {
      return;
    }

    const parsed = quickReplySchema.safeParse(draft);

    if (!parsed.success) {
      const next: DraftErrors = {};

      for (const issue of parsed.error.issues) {
        const field = issue.path[0];

        if ((field === "title" || field === "body") && !next[field]) {
          next[field] = issue.message;
        }
      }

      setErrors(next);
      (next.title ? titleRef : bodyRef).current?.focus();
      return;
    }

    setSaving(true);
    setError(null);

    const result = await saveQuickReply(parsed.data);
    setSaving(false);

    if (!result.ok) {
      setErrors({ body: result.fieldErrors?.body?.[0], title: result.fieldErrors?.title?.[0] });
      setError(result.fieldErrors ? null : result.error);
      return;
    }

    onSaved(result.data, creating);
  }

  function insertToken(token: string) {
    const textarea = bodyRef.current;
    const { cursor, value } = insertAtCursor(draft.body, token, textarea?.selectionStart ?? draft.body.length, textarea?.selectionEnd ?? draft.body.length);

    setDraft((current) => ({ ...current, body: value }));
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  const preview = draft.body.trim() ? renderQuickReply(draft.body, QUICK_REPLY_PREVIEW_CONTEXT) : "";

  return (
    <AdminSheet
      footer={
        confirmDiscard ? (
          <>
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Descartar as alterações desta resposta?</p>
            <div className="flex items-center gap-2">
              <Button className="px-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setConfirmDiscard(false)} type="button" variant="ghost">
                Continuar editando
              </Button>
              <Button className="px-4" onClick={onClose} type="button" variant="destructive">
                Descartar
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="hidden text-xs leading-5 text-[var(--text-tertiary)] md:block">Ctrl ou ⌘ + Enter salva</span>
            <div className="ml-auto flex items-center gap-2">
              <Button className="px-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => (dirty ? setConfirmDiscard(true) : onClose())} type="button" variant="ghost">
                Cancelar
              </Button>
              <Button className="px-4" disabled={saving} onClick={() => void save()} type="button">
                {saving ? "Salvando…" : creating ? "Criar resposta" : "Salvar"}
              </Button>
            </div>
          </>
        )
      }
      initialFocus={titleRef}
      onBeforeClose={() => {
        if (dirty && !confirmDiscard) {
          setConfirmDiscard(true);
          return false;
        }

        return true;
      }}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      title={creating ? "Nova resposta rápida" : "Editar resposta rápida"}
      description="Aparece no menu Respostas rápidas do editor da fila."
    >
      <div
        className="flex flex-col"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      >
        {error ? <ErrorBanner className="mt-3">{error}</ErrorBanner> : null}
        <AdminSheetSection title="Conteúdo">
          <AdminField error={errors.title} hint={TITLE_HINT} id={titleId} label="Nome">
            <input
              aria-describedby={fieldDescribedBy(titleId, { error: errors.title, hint: errors.title ? undefined : TITLE_HINT })}
              aria-invalid={errors.title ? true : undefined}
              className={adminInputClass}
              id={titleId}
              maxLength={60}
              onBlur={(event) => validate("title", event.target.value)}
              onChange={(event) => {
                setConfirmDiscard(false);
                setDraft((current) => ({ ...current, title: event.target.value }));
              }}
              ref={titleRef}
              value={draft.title}
            />
          </AdminField>
          <AdminField error={errors.body} hint={BODY_HINT} id={bodyId} label="Texto">
            <textarea
              aria-describedby={fieldDescribedBy(bodyId, { error: errors.body, hint: errors.body ? undefined : BODY_HINT })}
              aria-invalid={errors.body ? true : undefined}
              className={cn(adminTextareaClass, "min-h-36")}
              id={bodyId}
              maxLength={2_000}
              onBlur={(event) => validate("body", event.target.value)}
              onChange={(event) => {
                setConfirmDiscard(false);
                setDraft((current) => ({ ...current, body: event.target.value }));
              }}
              placeholder={"Oi, {nome}! Na aula {aula}, ..."}
              ref={bodyRef}
              rows={6}
              value={draft.body}
            />
          </AdminField>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs leading-5 text-[var(--text-secondary)]">Inserir:</span>
            {["{nome}", "{aula}"].map((token) => (
              <Button
                className="h-11! border-[var(--border-strong)] px-3 font-mono text-xs md:h-8!"
                key={token}
                onClick={() => insertToken(token)}
                type="button"
                variant="secondary"
              >
                {token}
              </Button>
            ))}
          </div>
        </AdminSheetSection>
        <AdminSheetSection aside={`${QUICK_REPLY_PREVIEW_CONTEXT.studentName} · ${QUICK_REPLY_PREVIEW_CONTEXT.lessonTitle}`} title="Prévia">
          {preview ? (
            <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-sm leading-6 whitespace-pre-line text-[var(--text-primary)] [overflow-wrap:anywhere]">
              {preview}
            </p>
          ) : (
            <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">Escreva o texto para ver como o aluno vai ler.</p>
          )}
        </AdminSheetSection>
      </div>
    </AdminSheet>
  );
}
