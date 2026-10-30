"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ConsoleMessage } from "@/server/webinars/console-model";
import { ALIGN_STEPS, LIVE_CONSOLE_COPY, alignPreviewSeconds, clampAlignSeconds, previewAt, type LiveConsoleRecording } from "@/server/webinars/live-console-model";
import { offsetLabel } from "@/server/webinars/room-model";
import { adminInputClass } from "../../../form";
import { SectionCard } from "../../../settings/kit";

// "Alinhar chat" (docs/30 §2.4 e §6.5): o Jibri entra alguns segundos depois do clique, entao a equipe ajusta o chat da
// gravacao em +/- segundos com previa: escolhe uma mensagem e ve o video da gravacao naquele ponto (o player da Bunny
// assinado pelo servidor, so com a gravacao pronta). Salvar grava webinar_recordings.anchor_offset_ms (posicao no
// video = offset_ms - anchor_offset_ms); nenhum offset de mensagem muda.

const copy = WEBINAR_COPY.consoleAoVivo;

type LiveAlignChatProps = {
  busyKey: string | null;
  canWrite: boolean;
  messages: readonly ConsoleMessage[];
  onSave: (anchorOffsetMs: number) => void;
  recording: LiveConsoleRecording;
};

export function LiveAlignChat({ busyKey, canWrite, messages, onSave, recording }: LiveAlignChatProps) {
  const candidates = messages.filter((message) => message.approved && message.offsetMs >= 0);
  const [seconds, setSeconds] = useState(() => clampAlignSeconds(recording.anchorOffsetMs / 1000));
  const [messageId, setMessageId] = useState(() => candidates[0]?.id ?? "");
  const message = candidates.find((item) => item.id === messageId) ?? candidates[0] ?? null;
  const position = message ? alignPreviewSeconds(message.offsetMs, seconds * 1000) : 0;
  const changed = seconds * 1000 !== recording.anchorOffsetMs;
  const busy = busyKey === "live:align";

  return (
    <SectionCard bodyClassName="flex min-w-0 flex-col gap-3" description={copy.alinharPrevia} title={copy.alinharChat} titleId="console-live-align-title">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor="console-align-message">
          {LIVE_CONSOLE_COPY.mensagemDoChat}
        </label>
        <select className={cn(adminInputClass, "w-full")} disabled={candidates.length === 0} id="console-align-message" onChange={(event) => setMessageId(event.target.value)} value={message?.id ?? ""}>
          {candidates.length === 0 ? <option value="">—</option> : null}
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {`${offsetLabel(item.offsetMs)} · ${item.displayName}: ${item.body.slice(0, 60)}`}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id="console-align-offset">
          {LIVE_CONSOLE_COPY.ajuste}
        </span>
        <div aria-labelledby="console-align-offset" className="flex min-w-0 flex-wrap items-center gap-2" role="group">
          {ALIGN_STEPS.map((step) => (
            <Button className="h-8! px-2 text-[13px] tabular-nums" disabled={!canWrite || busy} key={step} onClick={() => setSeconds((current) => clampAlignSeconds(current + step))} type="button" variant="secondary">
              {copy.alinharSegundos(step)}
            </Button>
          ))}
          <output aria-live="polite" className="min-w-16 text-sm leading-5 font-medium text-[var(--text-primary)] tabular-nums" data-live-align-seconds={seconds}>
            {copy.alinharSegundos(seconds)}
          </output>
        </div>
        {message ? <p className="text-xs leading-5 text-[var(--text-tertiary)] tabular-nums">{LIVE_CONSOLE_COPY.noVideo(offsetLabel(position * 1000))}</p> : null}
      </div>

      {recording.previewUrl && message ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
          <iframe allow="autoplay; fullscreen" className="size-full border-0" key={`${message.id}:${position}`} loading="lazy" src={previewAt(recording.previewUrl, position)} title={copy.alinharChat} />
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button className="px-4" disabled={!canWrite || busy || !changed} onClick={() => onSave(seconds * 1000)} type="button">
          {WEBINAR_COPY.admin.salvar}
        </Button>
      </div>
    </SectionCard>
  );
}
