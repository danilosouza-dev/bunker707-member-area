"use client";

import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type PersonaRole, type ScriptItem, type ScriptItemDraft, type ScriptStatus, type ScriptTrigger, type WebinarSession, type WebinarTranscriptFormat } from "@/server/webinars/model";
import type { TranscriptSummary } from "@/server/webinars/queries";
import { exportScriptCsv, exportSessionChatCsv, importScriptCsv, resolveScriptPhrases, saveScriptItems, saveTranscript } from "@/server/webinars/script-actions";
import { SCRIPT_TRIGGER_LABELS, formatOffsetText, parseOffsetText, parseScriptCsv, scriptSummary, sortScriptItems, type ScriptCsvResult } from "@/server/webinars/script-model";
import { ErrorBanner } from "../../error-banner";
import { PillGroup, adminInputClass, adminTextareaClass } from "../../form";
import { ConfirmDialog } from "../../settings/kit";
import { StatusChip } from "../../status-chip";
import { adminToast } from "../../toast";

// Card "Roteiro de chat" do editor (docs/30 §2.2, §6.6 D6-b e D6-c; fase 2b): os itens em linhas editaveis (minuto,
// nome, papel, mensagem, Solta em, frase e atraso, situacao), Importar CSV (lido no navegador para a previa com os
// erros por linha, enviado ao servidor para gravar), Exportar CSV, o chat de uma sessao encerrada como CSV, a
// transcricao do video (colada ou enviada) e Resolver frases. O card guarda o proprio estado: o que vem das Server
// Actions e a verdade (os itens gravados, com a situacao decidida no servidor).

const copy = WEBINAR_ADMIN_COPY.script;

type Row = {
  body: string;
  id: string | null;
  key: string;
  kind: "message" | "question";
  offsetMs: number | null;
  offsetText: string;
  personaName: string;
  personaRole: PersonaRole;
  phrase: string;
  phraseDelaySeconds: number;
  resolvedOffsetMs: number | null;
  status: ScriptStatus;
  triggerKind: ScriptTrigger;
};

type Failure = { message: string; status: number };

type ScriptCardProps = {
  disabled: boolean;
  hasRecording: boolean;
  initialItems: readonly ScriptItem[];
  initialTranscript: TranscriptSummary | null;
  /** As sessoes gravadas (as encerradas oferecem o CSV do chat real). */
  sessions: readonly WebinarSession[];
  webinarId: string;
};

const TRIGGER_OPTIONS: readonly { label: string; value: ScriptTrigger }[] = [
  { label: SCRIPT_TRIGGER_LABELS.at_offset, value: "at_offset" },
  { label: SCRIPT_TRIGGER_LABELS.on_phrase, value: "on_phrase" },
  { label: SCRIPT_TRIGGER_LABELS.manual, value: "manual" }
];

const STATUS_TONE: Record<ScriptStatus, "muted" | "neutral" | "success" | "warning"> = { disabled: "muted", draft: "neutral", ready: "success", unresolved: "warning" };

let rowCounter = 0;

function rowKey() {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

function rowOf(item: ScriptItem): Row {
  return {
    body: item.body,
    id: item.id,
    key: item.id,
    kind: item.kind,
    offsetMs: item.offsetMs,
    offsetText: item.offsetMs == null ? "" : formatOffsetText(item.offsetMs),
    personaName: item.personaName,
    personaRole: item.personaRole,
    phrase: item.phrase ?? "",
    phraseDelaySeconds: Math.round(item.phraseDelayMs / 1000),
    resolvedOffsetMs: item.resolvedOffsetMs,
    status: item.status,
    triggerKind: item.triggerKind
  };
}

function emptyRow(): Row {
  return { body: "", id: null, key: rowKey(), kind: "message", offsetMs: 0, offsetText: "00:00", personaName: "", personaRole: "student", phrase: "", phraseDelaySeconds: 0, resolvedOffsetMs: null, status: "draft", triggerKind: "at_offset" };
}

/** O que a Server Action recebe (a situacao final e do servidor; "disabled" e a unica escolha da tela). */
function draftOf(row: Row): ScriptItemDraft {
  return {
    body: row.body.trim(),
    id: row.id,
    kind: row.kind,
    offsetMs: row.triggerKind === "at_offset" ? row.offsetMs : null,
    personaName: row.personaName.trim(),
    personaRole: row.personaRole,
    phrase: row.triggerKind === "on_phrase" ? row.phrase.trim() || null : null,
    phraseDelayMs: Math.round(row.phraseDelaySeconds * 1000),
    status: row.status === "disabled" ? "disabled" : "draft",
    triggerKind: row.triggerKind
  };
}

/** Problemas que a tela aponta antes de enviar (o schema do servidor confere de novo). */
function rowProblem(row: Row): string | null {
  if (!row.personaName.trim()) {
    return "Sem nome.";
  }
  if (!row.body.trim()) {
    return "Sem mensagem.";
  }
  if (row.triggerKind === "at_offset" && row.offsetMs == null) {
    return "Tempo inválido.";
  }
  if (row.triggerKind === "on_phrase" && row.phrase.trim().length < CHAT_LIMITS.phraseMin) {
    return "Escreva a frase do apresentador.";
  }
  return null;
}

function formatOf(fileName: string, text: string): WebinarTranscriptFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".srt")) {
    return "srt";
  }
  if (lower.endsWith(".vtt") || /^﻿?WEBVTT/.test(text)) {
    return "vtt";
  }
  if (/-->/.test(text)) {
    return /^\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2},\d{3}/m.test(text) ? "srt" : "vtt";
  }
  return "txt";
}

function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ScriptCard({ disabled, hasRecording, initialItems, initialTranscript, sessions, webinarId }: ScriptCardProps) {
  const idBase = useId();
  const [rows, setRows] = useState<Row[]>(() => sortScriptItems(initialItems).map(rowOf));
  const [saved, setSaved] = useState<readonly ScriptItem[]>(initialItems);
  const [transcript, setTranscript] = useState<TranscriptSummary | null>(initialTranscript);
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptFormat, setTranscriptFormat] = useState<WebinarTranscriptFormat>("vtt");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState<{ csv: string; fileName: string; preview: ScriptCsvResult; replace: boolean } | null>(null);
  const [chatSession, setChatSession] = useState<string>("");
  const csvInput = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => scriptSummary(saved), [saved]);
  const dirty = useMemo(() => JSON.stringify(rows.map(draftOf)) !== JSON.stringify(sortScriptItems(saved).map(rowOf).map(draftOf)), [rows, saved]);
  const ended = sessions.filter((session) => session.kind !== "replay" && session.status === "ended");
  const locked = disabled || busy !== null;

  function applySaved(items: ScriptItem[]) {
    setSaved(items);
    setRows(sortScriptItems(items).map(rowOf));
  }

  function fail(result: { error: string; fieldErrors?: Record<string, string[] | undefined>; status: number }) {
    setFailure({ message: result.error, status: result.status });
    const errors: Record<string, string> = {};
    for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
      if (messages?.[0]) {
        errors[key] = messages[0];
      }
    }
    setFieldErrors(errors);
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function save() {
    const problem = rows.map((row, index) => ({ index, problem: rowProblem(row) })).find((entry) => entry.problem);
    if (problem) {
      setFailure({ message: `Mensagem ${problem.index + 1}: ${problem.problem}`, status: 400 });
      return;
    }
    setBusy("save");
    setFailure(null);
    setFieldErrors({});
    const result = await saveScriptItems({ items: rows.map(draftOf), webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    applySaved(result.data.items);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.scriptSaved);
  }

  async function readCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const csv = await file.text();
    setImporting({ csv, fileName: file.name, preview: parseScriptCsv(csv), replace: false });
  }

  async function confirmImport() {
    if (!importing) {
      return;
    }
    setBusy("import");
    setFailure(null);
    const result = await importScriptCsv({ csv: importing.csv, replace: importing.replace, webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    setImporting(null);
    applySaved(result.data.items);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.scriptImported(result.data.imported));
  }

  async function exportScript() {
    setBusy("export");
    const result = await exportScriptCsv({ webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    downloadCsv(result.data.csv, result.data.fileName);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.scriptExported);
  }

  async function exportChat() {
    if (!chatSession) {
      return;
    }
    setBusy("export-chat");
    const result = await exportSessionChatCsv({ sessionId: chatSession });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    downloadCsv(result.data.csv, result.data.fileName);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.chatExported);
  }

  async function readTranscriptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const text = await file.text();
    setTranscriptText(text);
    setTranscriptFormat(formatOf(file.name, text));
  }

  async function submitTranscript() {
    if (!transcriptText.trim()) {
      return;
    }
    setBusy("transcript");
    setFailure(null);
    setFieldErrors({});
    const result = await saveTranscript({ format: transcriptFormat, text: transcriptText, webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    setTranscript(result.data.transcript);
    setTranscriptText("");
    applySaved(result.data.items);
    adminToast.success(`${WEBINAR_ADMIN_COPY.toasts.transcriptSaved} ${copy.resolved(result.data.ready, result.data.unresolved)}`);
  }

  async function resolve() {
    setBusy("resolve");
    setFailure(null);
    const result = await resolveScriptPhrases({ webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    applySaved(result.data.items);
    adminToast.success(`${WEBINAR_ADMIN_COPY.toasts.phrasesResolved} ${copy.resolved(result.data.ready, result.data.unresolved)}`);
  }

  const working = (label: string, key: string) => (busy === key ? copy.saving : label);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-script-card="">
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
          {Object.keys(fieldErrors).length > 0 ? ` ${Object.values(fieldErrors)[0]}` : ""}
        </ErrorBanner>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button className="px-3" disabled={locked} onClick={() => csvInput.current?.click()} type="button" variant="secondary">
          <Upload aria-hidden="true" className="size-4" />
          {copy.importCsv}
        </Button>
        <input accept=".csv,text/csv" className="sr-only" data-script-csv-input="" onChange={(event) => void readCsv(event)} ref={csvInput} tabIndex={-1} type="file" />
        <Button className="px-3" disabled={locked || saved.length === 0} onClick={() => void exportScript()} type="button" variant="secondary">
          <Download aria-hidden="true" className="size-4" />
          {copy.exportCsv}
        </Button>
        <span className="text-xs leading-5 text-[var(--text-secondary)]">{copy.csvHint}</span>
      </div>

      <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-secondary)]" data-script-summary="">
        {copy.summary(summary)}
        {dirty ? ` · ${copy.unsaved}` : ""}
      </p>

      {rows.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</p> : null}

      <ol className="flex min-w-0 flex-col gap-3">
        {rows.map((row, index) => {
          const base = `${idBase}-${row.key}`;
          const statusLabel = copy.statuses[row.status];
          const resolvedLabel = row.triggerKind === "on_phrase" && row.resolvedOffsetMs != null ? ` · ${formatOffsetText(row.resolvedOffsetMs)}` : "";

          return (
            <li className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3", row.status === "disabled" && "opacity-70")} data-script-row={index} key={row.key}>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">#{index + 1}</span>
                  <StatusChip tone={STATUS_TONE[row.status]}>
                    {statusLabel}
                    {resolvedLabel}
                  </StatusChip>
                </div>
                <div className="flex items-center gap-1">
                  <Button className="px-2 text-[var(--text-secondary)]" disabled={locked} onClick={() => updateRow(row.key, { status: row.status === "disabled" ? "draft" : "disabled" })} type="button" variant="ghost">
                    {row.status === "disabled" ? copy.toggleOn : copy.toggleOff}
                  </Button>
                  <Button aria-label={`${copy.remove} ${index + 1}`} className="px-2 text-[var(--text-secondary)]" disabled={locked} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} type="button" variant="ghost">
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                  {copy.columns.name}
                  <input className={adminInputClass} disabled={locked} maxLength={CHAT_LIMITS.personaName} onChange={(event) => updateRow(row.key, { personaName: event.target.value })} type="text" value={row.personaName} />
                </label>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.columns.role}</span>
                  <PillGroup
                    ariaLabel={`${copy.columns.role} da mensagem ${index + 1}`}
                    disabled={locked}
                    name={`${base}-role`}
                    onChange={(personaRole: PersonaRole) => updateRow(row.key, { personaRole })}
                    options={[
                      { label: copy.roles.student, value: "student" },
                      { label: copy.roles.team, value: "team" }
                    ]}
                    value={row.personaRole}
                  />
                </div>
              </div>

              <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                {copy.columns.body}
                <textarea className={cn(adminTextareaClass, "min-h-16")} disabled={locked} maxLength={CHAT_LIMITS.body} onChange={(event) => updateRow(row.key, { body: event.target.value })} rows={2} value={row.body} />
              </label>

              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.columns.trigger}</span>
                <PillGroup ariaLabel={`${copy.columns.trigger} da mensagem ${index + 1}`} disabled={locked} name={`${base}-trigger`} onChange={(triggerKind: ScriptTrigger) => updateRow(row.key, { triggerKind })} options={TRIGGER_OPTIONS} value={row.triggerKind} />
              </div>

              {row.triggerKind === "at_offset" ? (
                <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                  {copy.columns.time}
                  <input
                    aria-invalid={row.offsetMs == null ? true : undefined}
                    className={cn(adminInputClass, "w-36")}
                    disabled={locked}
                    inputMode="numeric"
                    onBlur={() => updateRow(row.key, { offsetText: row.offsetMs == null ? row.offsetText : formatOffsetText(row.offsetMs) })}
                    onChange={(event) => updateRow(row.key, { offsetMs: parseOffsetText(event.target.value), offsetText: event.target.value })}
                    placeholder={copy.timePlaceholder}
                    type="text"
                    value={row.offsetText}
                  />
                </label>
              ) : null}

              {row.triggerKind === "on_phrase" ? (
                <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,120px)]">
                  <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                    {copy.columns.phrase}
                    <input className={adminInputClass} disabled={locked} maxLength={CHAT_LIMITS.phraseMax} onChange={(event) => updateRow(row.key, { phrase: event.target.value })} type="text" value={row.phrase} />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                    {copy.columns.delay}
                    <input
                      className={adminInputClass}
                      disabled={locked}
                      inputMode="numeric"
                      max={CHAT_LIMITS.phraseDelayMaxMs / 1000}
                      min={CHAT_LIMITS.phraseDelayMinMs / 1000}
                      onChange={(event) => updateRow(row.key, { phraseDelaySeconds: Math.trunc(Number(event.target.value)) || 0 })}
                      type="number"
                      value={row.phraseDelaySeconds}
                    />
                  </label>
                  {!transcript ? <p className="text-xs leading-5 text-[var(--text-secondary)] sm:col-span-2">{copy.transcriptNone}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button className="px-3" disabled={locked || rows.length >= CHAT_LIMITS.scriptItemsMax} onClick={() => setRows((current) => [...current, emptyRow()])} type="button" variant="secondary">
          <Plus aria-hidden="true" className="size-4" />
          {copy.add}
        </Button>
        <Button className="px-4" disabled={locked || !dirty} onClick={() => void save()} type="button">
          {working(copy.save, "save")}
        </Button>
      </div>

      <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
        <span className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{copy.transcriptTitle}</span>
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-transcript-summary="">
          {transcript ? copy.transcriptSummary(transcript.cues, transcript.format, formatSaoPauloDateTime(transcript.updatedAt)) : copy.transcriptNone}
        </p>
        {!hasRecording ? <p className="text-[13px] leading-5 text-[var(--warning)]">{copy.noRecording}</p> : null}
        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
          {copy.transcriptPaste}
          <textarea
            aria-invalid={fieldErrors.text ? true : undefined}
            className={cn(adminTextareaClass, "min-h-24 font-mono text-xs")}
            disabled={locked || !hasRecording}
            onChange={(event) => {
              setTranscriptText(event.target.value);
              setTranscriptFormat(formatOf("", event.target.value));
            }}
            placeholder="WEBVTT…"
            rows={4}
            value={transcriptText}
          />
        </label>
        <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.transcriptHint}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button className="px-3" disabled={locked || !hasRecording} onClick={() => transcriptInput.current?.click()} type="button" variant="secondary">
            <Upload aria-hidden="true" className="size-4" />
            {copy.transcriptFile}
          </Button>
          <input accept=".vtt,.srt,.txt,text/vtt,text/plain" className="sr-only" data-transcript-input="" onChange={(event) => void readTranscriptFile(event)} ref={transcriptInput} tabIndex={-1} type="file" />
          <Button className="px-3" disabled={locked || !hasRecording || !transcriptText.trim()} onClick={() => void submitTranscript()} type="button">
            {working(copy.transcriptSave, "transcript")}
          </Button>
          <Button className="px-3" disabled={locked || !transcript} onClick={() => void resolve()} type="button" variant="secondary">
            {working(copy.resolve, "resolve")}
          </Button>
        </div>
      </div>

      {ended.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={`${idBase}-chat-session`}>
            {copy.exportChat}
            <select className={cn(adminInputClass, "max-w-sm")} disabled={locked} id={`${idBase}-chat-session`} onChange={(event) => setChatSession(event.target.value)} value={chatSession}>
              <option value="">—</option>
              {ended.map((session) => (
                <option key={session.id} value={session.id}>
                  {WEBINAR_ADMIN_COPY.fields.sessionSaved(formatSaoPauloDateTime(session.scheduledAt))}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.exportChatHint}</p>
          <div>
            <Button className="px-3" disabled={locked || !chatSession} onClick={() => void exportChat()} type="button" variant="secondary">
              <Download aria-hidden="true" className="size-4" />
              {copy.exportCsv}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        busy={busy === "import"}
        confirmLabel={copy.importConfirm}
        onConfirm={() => void confirmImport()}
        onOpenChange={(open) => {
          if (!open) {
            setImporting(null);
          }
        }}
        open={importing !== null}
        title={copy.importTitle}
      >
        {importing ? (
          <div className="flex min-w-0 flex-col gap-3 text-sm leading-5 text-[var(--text-primary)]" data-script-import-preview="">
            <p className="text-[var(--text-secondary)]">{importing.fileName}</p>
            <p>{importing.preview.items.length > 0 ? copy.importPreview(importing.preview.items.length) : copy.importNothing}</p>
            {importing.preview.truncated ? <p className="text-[var(--warning)]">{copy.importTruncated}</p> : null}
            {importing.preview.errors.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[var(--warning)]">{copy.importErrors(importing.preview.errors.length)}</p>
                <ul className="max-h-40 overflow-y-auto text-[13px] text-[var(--text-secondary)]">
                  {importing.preview.errors.slice(0, 50).map((error) => (
                    <li key={`${error.line}-${error.message}`}>{copy.importLine(error.line, error.message)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <PillGroup
              ariaLabel={copy.importTitle}
              name={`${idBase}-import-mode`}
              onChange={(mode: "append" | "replace") => setImporting((current) => (current ? { ...current, replace: mode === "replace" } : current))}
              options={[
                { label: copy.importAppend, value: "append" },
                { label: copy.importReplace, value: "replace" }
              ]}
              value={importing.replace ? "replace" : "append"}
            />
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
