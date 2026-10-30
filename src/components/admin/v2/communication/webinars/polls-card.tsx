"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type Poll, type PollDraft, type PollKind } from "@/server/webinars/model";
import { savePolls } from "@/server/webinars/room-actions";
import { ErrorBanner } from "../../error-banner";
import { PillGroup, adminInputClass } from "../../form";
import { AdminSwitch } from "../../settings/kit";
import { adminToast } from "../../toast";

// Card "Enquetes" do editor (docs/30 §2.2 e §2.4; fase 2b): os modelos de enquete do webinario (pergunta, tipo,
// respostas anonimas, de 2 a 20 opcoes), prontos para a equipe abrir no console da sessao. O card guarda o proprio
// estado e grava a lista inteira de uma vez (savePolls); as copias ja lancadas numa sessao nao mudam.

const copy = WEBINAR_ADMIN_COPY.polls;
const MAX_POLLS = 20;

type OptionRow = { id: string | null; key: string; label: string };
type PollRow = { anonymous: boolean; id: string | null; key: string; kind: PollKind; options: OptionRow[]; question: string };

const KIND_OPTIONS: readonly { label: string; value: PollKind }[] = [
  { label: copy.kinds.single, value: "single" },
  { label: copy.kinds.multiple, value: "multiple" },
  { label: copy.kinds.survey, value: "survey" }
];

let counter = 0;

function nextKey() {
  counter += 1;
  return `poll-${counter}`;
}

function rowOf(poll: Poll): PollRow {
  return { anonymous: poll.anonymous, id: poll.id, key: poll.id, kind: poll.kind, options: poll.options.map((option) => ({ id: option.id, key: option.id, label: option.label })), question: poll.question };
}

function emptyPoll(): PollRow {
  return { anonymous: false, id: null, key: nextKey(), kind: "single", options: [{ id: null, key: nextKey(), label: "" }, { id: null, key: nextKey(), label: "" }], question: "" };
}

function draftOf(row: PollRow): PollDraft {
  return { anonymous: row.anonymous, id: row.id, kind: row.kind, options: row.options.map((option) => ({ id: option.id, label: option.label.trim() })), question: row.question.trim() };
}

function rowProblem(row: PollRow): string | null {
  if (!row.question.trim()) {
    return "Escreva a pergunta.";
  }
  const labels = row.options.map((option) => option.label.trim()).filter(Boolean);
  if (labels.length < CHAT_LIMITS.pollOptionsMin) {
    return "A enquete precisa de 2 opções escritas.";
  }
  if (labels.length !== row.options.length) {
    return "Há uma opção vazia.";
  }
  return null;
}

type PollsCardProps = { disabled: boolean; initial: readonly Poll[]; webinarId: string };

export function PollsCard({ disabled, initial, webinarId }: PollsCardProps) {
  const idBase = useId();
  const [rows, setRows] = useState<PollRow[]>(() => initial.map(rowOf));
  const [saved, setSaved] = useState<readonly Poll[]>(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; status: number } | null>(null);
  const dirty = useMemo(() => JSON.stringify(rows.map(draftOf)) !== JSON.stringify(saved.map(rowOf).map(draftOf)), [rows, saved]);
  const locked = disabled || busy;

  function updatePoll(key: string, patch: Partial<PollRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function updateOption(pollKey: string, optionKey: string, label: string) {
    setRows((current) => current.map((row) => (row.key === pollKey ? { ...row, options: row.options.map((option) => (option.key === optionKey ? { ...option, label } : option)) } : row)));
  }

  async function save() {
    const problem = rows.map((row, index) => ({ index, problem: rowProblem(row) })).find((entry) => entry.problem);
    if (problem) {
      setFailure({ message: `Enquete ${problem.index + 1}: ${problem.problem}`, status: 400 });
      return;
    }
    setBusy(true);
    setFailure(null);
    const result = await savePolls({ polls: rows.map(draftOf), webinarId });
    setBusy(false);
    if (!result.ok) {
      setFailure({ message: Object.values(result.fieldErrors ?? {})[0]?.[0] ?? result.error, status: result.status });
      return;
    }
    setSaved(result.data.polls);
    setRows(result.data.polls.map(rowOf));
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.pollsSaved);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-polls-card="">
      {failure ? (
        <ErrorBanner
          action={
            <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
              Fechar
            </Button>
          }
          title={WEBINAR_ADMIN_COPY.failures.generic}
        >
          {failure.message}
        </ErrorBanner>
      ) : null}
      {rows.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</p> : null}
      <ol className="flex min-w-0 flex-col gap-4">
        {rows.map((row, index) => {
          const questionId = `${idBase}-${row.key}-question`;

          return (
            <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3" data-poll-row={index} key={row.key}>
              <div className="flex min-w-0 items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={questionId}>
                  {copy.question} {index + 1}
                  <input className={adminInputClass} disabled={locked} id={questionId} maxLength={CHAT_LIMITS.pollQuestion} onChange={(event) => updatePoll(row.key, { question: event.target.value })} type="text" value={row.question} />
                </label>
                <Button aria-label={`${copy.remove} ${index + 1}`} className="px-2 text-[var(--text-secondary)]" disabled={locked} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} type="button" variant="ghost">
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.kind}</span>
                <PillGroup ariaLabel={`${copy.kind} da enquete ${index + 1}`} disabled={locked} name={`${idBase}-${row.key}-kind`} onChange={(kind: PollKind) => updatePoll(row.key, { kind })} options={KIND_OPTIONS} value={row.kind} />
              </div>
              <AdminSwitch checked={row.anonymous} disabled={locked} id={`${idBase}-${row.key}-anonymous`} label={copy.anonymous} onCheckedChange={(anonymous) => updatePoll(row.key, { anonymous })} />
              <div className="flex min-w-0 flex-col gap-2">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.options}</span>
                {row.options.map((option, position) => (
                  <div className="flex min-w-0 items-center gap-2" key={option.key}>
                    <input
                      aria-label={copy.optionPlaceholder(position + 1)}
                      className={cn(adminInputClass, "flex-1")}
                      disabled={locked}
                      maxLength={CHAT_LIMITS.pollOption}
                      onChange={(event) => updateOption(row.key, option.key, event.target.value)}
                      placeholder={copy.optionPlaceholder(position + 1)}
                      type="text"
                      value={option.label}
                    />
                    <Button
                      aria-label={`${copy.removeOption} ${position + 1}`}
                      className="px-2 text-[var(--text-secondary)]"
                      disabled={locked || row.options.length <= CHAT_LIMITS.pollOptionsMin}
                      onClick={() => updatePoll(row.key, { options: row.options.filter((item) => item.key !== option.key) })}
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    className="px-3"
                    disabled={locked || row.options.length >= CHAT_LIMITS.pollOptionsMax}
                    onClick={() => updatePoll(row.key, { options: [...row.options, { id: null, key: nextKey(), label: "" }] })}
                    type="button"
                    variant="ghost"
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    {copy.addOption}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button className="px-3" disabled={locked || rows.length >= MAX_POLLS} onClick={() => setRows((current) => [...current, emptyPoll()])} type="button" variant="secondary">
          <Plus aria-hidden="true" className="size-4" />
          {copy.add}
        </Button>
        <Button className="px-4" disabled={locked || !dirty} onClick={() => void save()} type="button">
          {busy ? copy.saving : copy.save}
        </Button>
        <span className="text-xs leading-5 text-[var(--text-secondary)]">
          {copy.limit(MAX_POLLS)}
          {dirty ? ` · ${copy.unsaved}` : ""}
        </span>
      </div>
    </div>
  );
}
