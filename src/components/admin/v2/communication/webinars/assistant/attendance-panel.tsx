"use client";

import { Headset, Pause, Send, UserCheck, UserMinus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { AttendanceQueueItem } from "@/server/webinars/assistant-model";
import type { AttendanceSnapshot } from "@/server/webinars/assistant-queries";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS } from "@/server/webinars/model";
import { ErrorBanner } from "../../../error-banner";
import { adminInputClass, adminTextareaClass } from "../../../form";
import { AdminSwitch, SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// O painel Atendimento desenhado (docs/30 §2.4, fase 4; §1.6 e D24): Atender / Pausar de quem esta no console, o
// Assistente (desligado no ambiente, sem conexao de IA, desligado no webinario, ou o "Responder tudo" da sessao), quem
// esta atendendo com as perguntas abertas de cada um ("Ninguem atendendo" diz o que o aluno ve), e a fila de perguntas
// novas (aba Perguntas e chat), cada uma com a origem, "Pediu a equipe", com quem esta, o que o Assistente fez,
// Assumir, Devolver para a fila, Passar para e Responder (vai como resposta da equipe). Sem leitura nem acoes: o
// container (session-console/console-attendance.tsx) chama as Server Actions.

const COPY = WEBINAR_COPY.assistente.console;

export type AttendancePanelProps = {
  busyKey: string | null;
  canAct: boolean;
  currentUserId: string;
  error: string | null;
  onAnswer: (item: AttendanceQueueItem, text: string) => Promise<boolean>;
  onAssign: (item: AttendanceQueueItem, userId: string | null) => void;
  onReplyAll: (on: boolean) => void;
  onToggleAttending: (online: boolean) => void;
  snapshot: AttendanceSnapshot;
};

function AssistantLine({ busy, canAct, onReplyAll, snapshot }: { busy: boolean; canAct: boolean; onReplyAll: (on: boolean) => void; snapshot: AttendanceSnapshot }) {
  const { assistant } = snapshot;
  const off = !assistant.envEnabled ? WEBINAR_COPY.assistente.card.desligadoNoAmbiente : !assistant.aiAvailable ? WEBINAR_COPY.assistente.card.semIa : !assistant.settingsEnabled ? COPY.assistenteDesligado : null;
  if (off) {
    return (
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-attendance-assistant="off">
        {off}
      </p>
    );
  }
  return (
    <div data-attendance-assistant={assistant.replyAll ? "reply-all" : "called"}>
      <AdminSwitch
        checked={assistant.replyAll}
        description={assistant.replyAll ? COPY.responderTudoLigado : COPY.responderTudoDesligado}
        disabled={!canAct || !snapshot.open}
        id={`attendance-reply-all-${snapshot.sessionId}`}
        label={COPY.responderTudo}
        onCheckedChange={onReplyAll}
        pending={busy}
      />
    </div>
  );
}

function QueueItem({
  busyKey,
  canAct,
  currentUserId,
  item,
  onAnswer,
  onAssign,
  snapshot
}: Pick<AttendancePanelProps, "busyKey" | "canAct" | "currentUserId" | "onAnswer" | "onAssign" | "snapshot"> & { item: AttendanceQueueItem }) {
  const [answer, setAnswer] = useState("");
  const busy = busyKey === `attendance:${item.target}:${item.id}`;
  const online = snapshot.attendants.filter((attendant) => attendant.online && attendant.userId !== item.assignedTo);
  const assignedName = item.assignedTo ? (item.assignedTo === currentUserId ? COPY.comVoce : COPY.assumida(snapshot.names[item.assignedTo] ?? WEBINAR_COPY.sala.selos.equipe)) : null;
  const author = item.anonymous ? WEBINAR_ADMIN_COPY.console.questions.anonymous : item.displayName;
  const answerId = `attendance-answer-${item.target}-${item.id}`;
  const passId = `attendance-pass-${item.target}-${item.id}`;

  async function send() {
    const text = answer.trim();
    if (text && (await onAnswer(item, text))) {
      setAnswer("");
    }
  }

  return (
    <li className={cn("flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2", item.handoffRequested && "border-[var(--border-strong)]")} data-attendance-item={item.id} data-attendance-target={item.target}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs leading-5 text-[var(--text-tertiary)]">
        <span className="font-medium text-[var(--text-primary)]">{author}</span>
        <StatusChip tone="muted">{item.target === "chat" ? COPY.doChat : COPY.daAbaPerguntas}</StatusChip>
        {item.handoffRequested ? <StatusChip tone="warning">{COPY.pediuEquipe}</StatusChip> : null}
        {assignedName ? <StatusChip tone="success">{assignedName}</StatusChip> : null}
        {item.aiStatus === "pending" ? <StatusChip tone="neutral">{COPY.assistenteRespondendo}</StatusChip> : null}
        {item.answerSource === "ai" ? <StatusChip tone="neutral">{COPY.respondidaPeloAssistente}</StatusChip> : null}
        {(item.aiStatus === "failed" || item.aiStatus === "skipped") && item.answerSource !== "ai" && !item.handoffRequested ? <StatusChip tone="muted">{COPY.assistenteNaoRespondeu}</StatusChip> : null}
      </div>
      <p className="text-sm leading-5 break-words whitespace-pre-wrap text-[var(--text-primary)]">{item.body}</p>
      {canAct ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {item.assignedTo !== currentUserId ? (
              <Button className="h-8! px-2 text-[13px]" disabled={busy} onClick={() => onAssign(item, currentUserId)} type="button" variant="secondary">
                <UserCheck aria-hidden="true" className="size-4" />
                {COPY.assumir}
              </Button>
            ) : null}
            {item.assignedTo ? (
              <Button className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={busy} onClick={() => onAssign(item, null)} type="button" variant="ghost">
                <UserMinus aria-hidden="true" className="size-4" />
                {COPY.devolver}
              </Button>
            ) : null}
            {online.length > 0 ? (
              <label className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 text-[var(--text-secondary)]" htmlFor={passId}>
                {COPY.passarPara}
                <select
                  className={cn(adminInputClass, "h-8 w-auto max-w-44 py-0 text-[13px]")}
                  disabled={busy}
                  id={passId}
                  onChange={(event) => {
                    if (event.target.value) {
                      onAssign(item, event.target.value);
                    }
                  }}
                  value=""
                >
                  <option value="">{COPY.escolherAtendente}</option>
                  {online.map((attendant) => (
                    <option key={attendant.userId} value={attendant.userId}>
                      {attendant.userId === currentUserId ? COPY.comVoce : attendant.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <label className="sr-only" htmlFor={answerId}>
            {COPY.respostaPlaceholder}
          </label>
          <textarea className={cn(adminTextareaClass, "min-h-14")} disabled={busy} id={answerId} maxLength={CHAT_LIMITS.answer} onChange={(event) => setAnswer(event.target.value)} placeholder={COPY.respostaPlaceholder} rows={2} value={answer} />
          <div className="flex justify-end">
            <Button className="h-8! px-3 text-[13px]" disabled={busy || !answer.trim()} onClick={() => void send()} type="button" variant="secondary">
              <Send aria-hidden="true" className="size-4" />
              {COPY.responder}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function AttendancePanel(props: AttendancePanelProps) {
  const { busyKey, canAct, error, onReplyAll, onToggleAttending, snapshot } = props;
  const attending = snapshot.me.online;
  const online = snapshot.attendants.filter((attendant) => attendant.online);

  return (
    <SectionCard
      actions={
        canAct && snapshot.open ? (
          <Button className="px-3" disabled={busyKey === "attendance:ping"} onClick={() => onToggleAttending(!attending)} type="button" variant={attending ? "secondary" : "default"}>
            {attending ? <Pause aria-hidden="true" className="size-4" /> : <Headset aria-hidden="true" className="size-4" />}
            {attending ? COPY.ficarAusente : COPY.ficarOnline}
          </Button>
        ) : null
      }
      bodyClassName="flex min-w-0 flex-col gap-4"
      meta={attending ? COPY.online : snapshot.me.status ? COPY.ausente : undefined}
      title={COPY.titulo}
      titleId="console-attendance-title"
    >
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <AssistantLine busy={busyKey === "attendance:reply-all"} canAct={canAct} onReplyAll={onReplyAll} snapshot={snapshot} />

      <div className="flex min-w-0 flex-col gap-1.5" data-attendance-attendants="">
        <h3 className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{COPY.atendentes}</h3>
        {online.length === 0 ? (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.ninguemAtendendo}</p>
        ) : (
          <ul className="flex min-w-0 flex-wrap gap-2">
            {online.map((attendant) => (
              <li className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-xs leading-5 text-[var(--text-primary)]" data-attendant={attendant.userId} key={attendant.userId}>
                <span aria-hidden="true" className="size-2 rounded-full bg-[var(--success)]" />
                <span className="font-medium">{attendant.name}</span>
                <span className="text-[var(--text-tertiary)] tabular-nums">· {COPY.abertas(attendant.openCount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{COPY.fila}</h3>
        {snapshot.queue.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.semPerguntas}</p> : null}
        <ol className="flex max-h-[60vh] min-w-0 flex-col gap-3 overflow-y-auto" data-attendance-queue="">
          {snapshot.queue.map((item) => (
            <QueueItem {...props} item={item} key={`${item.target}:${item.id}`} />
          ))}
        </ol>
      </div>
    </SectionCard>
  );
}
