"use client";

import { Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { LIVE_CONSOLE_COPY, type LiveConsoleRecording } from "@/server/webinars/live-console-model";
import { AdminField, adminInputClass } from "../../../form";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// Enviar gravacao / Ligar um video da Bunny (docs/30 §5.2 attachRecording, §6.7 e D3): a reserva quando nao houve
// gravador (gravacao no navegador ou OBS) e o socorro quando o envio do gravador falhou. A equipe envia o arquivo pela
// biblioteca da Bunny e cola aqui o endereco do player (ou a biblioteca e o video) e, se souber, a duracao: com ela a
// gravacao fica pronta na hora; sem ela, o job consulta a Bunny. Com a sessao encerrada, o replay nasce junto.

const copy = WEBINAR_COPY.consoleAoVivo;

export type AttachInput = { bunnyLibraryId?: string; bunnyVideoId?: string; durationSeconds?: number | null; embedUrl?: string };

type LiveAttachRecordingProps = {
  busyKey: string | null;
  canWrite: boolean;
  onAttach: (input: AttachInput) => Promise<boolean>;
  recording: LiveConsoleRecording | null;
};

export function LiveAttachRecording({ busyKey, canWrite, onAttach, recording }: LiveAttachRecordingProps) {
  const [open, setOpen] = useState(false);
  const [embedUrl, setEmbedUrl] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [videoId, setVideoId] = useState("");
  const [minutes, setMinutes] = useState("");
  const busy = busyKey === "live:attach";
  const ready = embedUrl.trim().length > 0 || (libraryId.trim().length > 0 && videoId.trim().length > 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!ready || busy) {
      return;
    }

    const durationMinutes = Number(minutes.replace(",", "."));
    const ok = await onAttach({
      bunnyLibraryId: embedUrl.trim() ? undefined : libraryId.trim(),
      bunnyVideoId: embedUrl.trim() ? undefined : videoId.trim(),
      durationSeconds: Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.round(durationMinutes * 60) : null,
      embedUrl: embedUrl.trim() || undefined
    });

    if (ok) {
      setOpen(false);
      setEmbedUrl("");
      setLibraryId("");
      setVideoId("");
      setMinutes("");
    }
  }

  return (
    <SectionCard
      actions={
        !open ? (
          <Button className="px-3" disabled={!canWrite} onClick={() => setOpen(true)} type="button" variant="secondary">
            <Upload aria-hidden="true" className="size-4" />
            {copy.enviarGravacao}
          </Button>
        ) : null
      }
      bodyClassName="flex min-w-0 flex-col gap-3"
      description={recording ? undefined : LIVE_CONSOLE_COPY.semGravacao}
      title={copy.enviarGravacao}
      titleId="console-live-attach-title"
    >
      {recording ? (
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]" data-live-recording={recording.status}>
          <StatusChip tone={recording.status === "ready" ? "success" : recording.status === "failed" ? "error" : "warning"}>{recording.status === "ready" ? copy.gravacaoPronta : copy.gravador[recording.status === "failed" ? "upload_failed" : "uploading"]}</StatusChip>
          {recording.errorMessage ? <span>{recording.errorMessage}</span> : null}
        </p>
      ) : null}
      {open ? (
        <form className="flex min-w-0 flex-col gap-3" data-live-attach-form="" onSubmit={(event) => void submit(event)}>
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.enviarGravacaoTexto}</p>
          <AdminField id="console-attach-embed" label={LIVE_CONSOLE_COPY.enderecoPlayer} optional>
            <input className={adminInputClass} id="console-attach-embed" inputMode="url" maxLength={2048} onChange={(event) => setEmbedUrl(event.target.value)} placeholder="https://iframe.mediadelivery.net/embed/…" type="url" value={embedUrl} />
          </AdminField>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <AdminField id="console-attach-library" label={LIVE_CONSOLE_COPY.biblioteca} optional>
              <input className={adminInputClass} disabled={embedUrl.trim().length > 0} id="console-attach-library" inputMode="numeric" maxLength={12} onChange={(event) => setLibraryId(event.target.value)} value={libraryId} />
            </AdminField>
            <AdminField id="console-attach-video" label={LIVE_CONSOLE_COPY.video} optional>
              <input className={adminInputClass} disabled={embedUrl.trim().length > 0} id="console-attach-video" maxLength={80} onChange={(event) => setVideoId(event.target.value)} value={videoId} />
            </AdminField>
          </div>
          <AdminField id="console-attach-minutes" label={LIVE_CONSOLE_COPY.duracaoMinutos} optional>
            <input className={adminInputClass} id="console-attach-minutes" inputMode="decimal" maxLength={6} onChange={(event) => setMinutes(event.target.value)} value={minutes} />
          </AdminField>
          <div className="flex flex-wrap justify-end gap-2">
            <Button className="px-3 text-[var(--text-secondary)]" disabled={busy} onClick={() => setOpen(false)} type="button" variant="ghost">
              {copy.cancelar}
            </Button>
            <Button className="px-4" disabled={!canWrite || busy || !ready} type="submit">
              {copy.ligarVideoBunny}
            </Button>
          </div>
        </form>
      ) : null}
    </SectionCard>
  );
}
