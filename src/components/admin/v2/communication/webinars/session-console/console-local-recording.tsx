"use client";

import { CircleStop, Download, MonitorDown, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { ConfirmDialog, SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";
import { downloadLocalFile, freeBytes, type LocalRecordingFile } from "./local-recording-files";
import type { LocalRecordingState } from "./use-local-recording";

// O cartao Gravação neste computador (docs/30 D142), no ⋯ › Gravação do console: gravar e parar, o que esta gravando, o
// envio para a Bunny e os arquivos que ficaram neste computador. A linha LocalRecordingStatus aparece no alto do console
// enquanto grava ou envia, com qualquer painel aberto.

const copy = WEBINAR_COPY.consoleAoVivo.gravacaoLocal;
/** 10 Mbps de video e 160 kbps de audio. */
const BYTES_PER_HOUR = 4_600_000_000;

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(whole / 3_600);
  return hours > 0 ? `${hours}:${pad(Math.floor((whole % 3_600) / 60))}:${pad(whole % 60)}` : `${Math.floor(whole / 60)}:${pad(whole % 60)}`;
}

const megabytes = (bytes: number) => Math.round(bytes / 1e6);
const percent = (sent: number, size: number) => (size > 0 ? Math.min(100, Math.floor((sent / size) * 100)) : 0);

export function LocalRecordingStatus({ local }: { local: LocalRecordingState }) {
  if (!local.recording && !local.upload && !local.problem) {
    return null;
  }
  return (
    <p className="text-[13px] leading-5 font-medium text-[var(--text-primary)] tabular-nums" data-local-recording-status="" role={local.problem ? "alert" : undefined}>
      {local.problem ?? (local.upload ? copy.enviando(percent(local.upload.sent, local.upload.size)) : copy.gravandoLinha(clock(local.seconds)))}
    </p>
  );
}

export function ConsoleLocalRecording({ canWrite, follow, local, onFollow }: { canWrite: boolean; follow: boolean; local: LocalRecordingState; onFollow: (on: boolean) => void }) {
  const [removing, setRemoving] = useState<LocalRecordingFile | null>(null);
  const [free, setFree] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void freeBytes().then((value) => {
      if (!cancelled) {
        setFree(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [local.recording, local.files]);

  return (
    <SectionCard
      actions={<StatusChip tone={local.recording ? "error" : local.upload ? "warning" : "neutral"}>{local.recording ? copy.gravando : local.upload ? copy.enviandoCurto : copy.parada}</StatusChip>}
      bodyClassName="flex min-w-0 flex-col gap-3"
      title={copy.titulo}
      titleId="console-local-recording-title"
    >
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.texto}</p>
      {local.recording ? (
        <p className="text-[13px] leading-5 text-[var(--text-primary)] tabular-nums" data-local-recording="">
          {copy.gravandoDetalhe(clock(local.seconds), megabytes(local.bytes), local.fps, local.lost)}
        </p>
      ) : null}
      {local.upload ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[13px] leading-5 text-[var(--text-primary)] tabular-nums">{copy.enviando(percent(local.upload.sent, local.upload.size))}</p>
          <progress aria-label={copy.enviandoCurto} className="h-2 w-full" max={100} value={percent(local.upload.sent, local.upload.size)} />
        </div>
      ) : null}
      {local.problem ? (
        <p className="text-[13px] leading-5 text-[var(--error)]" role="alert">
          {local.problem}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {local.recording ? (
          <Button className="px-3" onClick={() => void local.stop()} type="button" variant="secondary">
            <CircleStop aria-hidden="true" className="size-4" />
            {copy.parar}
          </Button>
        ) : (
          <Button className="px-3" disabled={!local.available || !canWrite} onClick={local.start} type="button" variant="secondary">
            <MonitorDown aria-hidden="true" className="size-4" />
            {copy.gravar}
          </Button>
        )}
      </div>
      <label className="flex min-w-0 items-start gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
        <input checked={follow} className="mt-0.5 size-4" onChange={(event) => onFollow(event.target.checked)} type="checkbox" />
        {copy.junto}
      </label>
      {!local.available && !local.recording ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{copy.indisponivel}</p> : null}
      {free !== null && !local.recording ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{copy.espaco(Math.floor((free / BYTES_PER_HOUR) * 10) / 10)}</p> : null}
      {local.mic ? <p className="text-xs leading-5 break-words text-[var(--text-tertiary)]">{copy.microfone(local.mic)}</p> : null}
      {local.files.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-2">
          {local.files.map((file) => (
            <li className="flex min-w-0 flex-col gap-1" data-local-file={file.meta.sent ? "sent" : "pending"} key={file.name}>
              <p className="text-[13px] leading-5 text-[var(--text-primary)] tabular-nums">
                {copy.arquivo(clock(file.meta.seconds ?? 0), megabytes(file.size))} <span className="text-[var(--text-tertiary)]">{file.meta.sent ? copy.enviado : copy.naoEnviado}</span>
              </p>
              <div className="flex min-w-0 flex-wrap gap-2">
                {!file.meta.sent && local.upload === null ? (
                  <Button className="px-3" disabled={!canWrite || local.recording} onClick={() => local.send(file.name)} type="button" variant="secondary">
                    <Upload aria-hidden="true" className="size-4" />
                    {copy.enviarAgora}
                  </Button>
                ) : null}
                <Button className="px-3" onClick={() => void downloadLocalFile(file.name)} type="button" variant="ghost">
                  <Download aria-hidden="true" className="size-4" />
                  {copy.baixar}
                </Button>
                <Button className="px-3" disabled={local.upload?.name === file.name} onClick={() => setRemoving(file)} type="button" variant="ghost">
                  <Trash2 aria-hidden="true" className="size-4" />
                  {copy.apagar}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        confirmLabel={copy.apagar}
        description={removing?.meta.sent ? copy.apagarEnviado : copy.apagarNaoEnviado}
        onConfirm={() => {
          const name = removing?.name;
          setRemoving(null);
          if (name) {
            void local.remove(name);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
          }
        }}
        open={removing !== null}
        title={copy.apagarTitulo}
      />
    </SectionCard>
  );
}
