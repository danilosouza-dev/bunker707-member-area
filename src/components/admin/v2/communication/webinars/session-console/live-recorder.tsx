"use client";

import { Circle, MonitorDown, Power, Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import {
  LIVE_CONSOLE_COPY,
  anchorLabel,
  driftLabel,
  machineAge,
  recorderCard,
  type LiveConsoleRecorder,
  type LiveControls
} from "@/server/webinars/live-console-model";
import type { SessionStatus } from "@/server/webinars/model";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// O cartao Gravacao do console (docs/30 §1.4, §2.4, §6.4 passos 3, 7 e 11, §6.5 e §6.7): a situacao do gravador por
// hora (os nomes do card Gravacao), Preparar gravacao (o pedido da maquina; sem o pedido automatico neste ambiente, a
// frase da reserva), Gravar (startRecording de arquivo com a maquina pronta; preparando, o clique fica na fila e a
// gravacao comeca sozinha no ready; sem maquina, desligado com "Gravacao nao preparada para esta live"), Parar gravacao,
// Gravar no navegador (a reserva de D3: a gravacao local do proprio navegador), Desligar o gravador depois do envio, ha
// quanto tempo a maquina esta ligada, e a ancora com a diferenca para o inicio do arquivo. So o Apresentador grava.

const copy = WEBINAR_COPY.consoleAoVivo;

type LiveRecorderProps = {
  busyKey: string | null;
  canPublish: boolean;
  controls: LiveControls;
  joined: boolean;
  nowMs: number;
  onBrowserRecord: () => void;
  onPrepare: () => void;
  onRecord: () => void;
  onRelease: () => void;
  onStop: () => void;
  recorder: LiveConsoleRecorder;
  recording: { mode: string | null; on: boolean };
  status: SessionStatus;
  /** O ultimo "Gravar" respondeu que nao ha gravador (a corrida com o webhook). */
  unavailable: boolean;
};

export function LiveRecorder({ busyKey, canPublish, controls, joined, nowMs, onBrowserRecord, onPrepare, onRecord, onRelease, onStop, recorder, recording, status, unavailable }: LiveRecorderProps) {
  const card = recorderCard({ nowMs, recorder, recordingOn: recording.on, status });
  const local = recording.on && recording.mode === "local";
  const open = status === "waiting" || status === "live";
  const age = machineAge({ nowMs, requestedAt: recorder.requestedAt, status: recorder.status });
  const anchor = anchorLabel(recorder.anchorAt);
  const drift = driftLabel(recorder.driftMs);
  const busy = busyKey !== null && busyKey.startsWith("live:rec");
  const notes = [card.note, unavailable && card.action !== "recording" ? `${copy.gravacaoNaoPreparada}. ${copy.semGravadorHoje}` : null].filter((note): note is string => Boolean(note));

  return (
    <SectionCard
      actions={<StatusChip tone={card.action === "recording" ? "error" : recorder.status === "ready" ? "success" : recorder.status === "upload_failed" ? "warning" : "neutral"}>{local ? LIVE_CONSOLE_COPY.gravacaoNoNavegador : card.label}</StatusChip>}
      bodyClassName="flex min-w-0 flex-col gap-3"
      title={LIVE_CONSOLE_COPY.gravacao}
      titleId="console-live-recorder-title"
    >
      <div className="flex min-w-0 flex-col gap-1" data-live-recorder={recorder.status}>
        {notes.map((note) => (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-live-recorder-note="" key={note}>
            {note}
          </p>
        ))}
        {age ? (
          <p className="flex items-center gap-1.5 text-xs leading-5 text-[var(--text-tertiary)]">
            <Timer aria-hidden="true" className="size-3.5" />
            {age}
          </p>
        ) : null}
        {anchor ? (
          <p className="text-[13px] leading-5 text-[var(--text-primary)] tabular-nums" data-live-anchor="">
            {anchor}
          </p>
        ) : null}
        {drift ? <p className="text-xs leading-5 text-[var(--text-tertiary)] tabular-nums">{drift}</p> : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {card.action === "prepare" && controls.session ? (
          <Button className="px-3" disabled={!controls.sessionEnabled || busy} onClick={onPrepare} title={controls.sessionEnabled ? undefined : LIVE_CONSOLE_COPY.soQuemPublica} type="button" variant="secondary">
            <Power aria-hidden="true" className="size-4" />
            {copy.prepararGravacao}
          </Button>
        ) : null}
        {controls.record && open && card.action !== "recording" ? (
          <Button className="px-3" disabled={busy || !joined || !canPublish || card.action !== "record"} onClick={onRecord} type="button">
            <Circle aria-hidden="true" className="size-4 fill-current text-[var(--error)]" />
            {copy.gravar}
          </Button>
        ) : null}
        {controls.record && card.action === "recording" ? (
          <Button className="px-3" disabled={!joined} onClick={onStop} type="button" variant="secondary">
            <Square aria-hidden="true" className="size-4" />
            {copy.pararGravacao}
          </Button>
        ) : null}
        {controls.record && open && card.fallback && !recording.on ? (
          <Button className="px-3" disabled={!joined} onClick={onBrowserRecord} type="button" variant="secondary">
            <MonitorDown aria-hidden="true" className="size-4" />
            {copy.gravarNoNavegador}
          </Button>
        ) : null}
        {card.action === "release" && controls.session ? (
          <Button className="px-3" disabled={!controls.sessionEnabled || busy || recorder.releaseRequestedAt !== null} onClick={onRelease} title={controls.sessionEnabled ? undefined : LIVE_CONSOLE_COPY.soQuemPublica} type="button" variant="secondary">
            <Power aria-hidden="true" className="size-4" />
            {LIVE_CONSOLE_COPY.desligarGravador}
          </Button>
        ) : null}
      </div>
      {!controls.record && open ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{LIVE_CONSOLE_COPY.soOApresentador}</p> : null}
      {controls.record && !canPublish ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{LIVE_CONSOLE_COPY.soQuemPublica}</p> : null}
    </SectionCard>
  );
}
