"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { settleAction } from "@/lib/action-result";
import { localRecordingEventOf, localRecordingMessage, meetOrigin, type LocalRecordingFrameState } from "@/lib/jitsi-room-config";
import { tusUpload } from "@/lib/tus-upload";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { finishLocalUpload, prepareLocalUpload } from "@/server/webinars/local-recording-actions";
import { LOCAL_RECORDING_WORKER, listLocalFiles, localFile, localFileName, localRecordingSupported, patchMeta, readMeta, removeLocalFile, type LocalRecordingFile } from "./local-recording-files";

// A gravacao no computador de quem apresenta, mandada pelo console (docs/30 D142). O iframe grava (camera, tela e vozes,
// antes da compressao da sala) e manda cada pedaco; aqui o pedaco vai para o disco por um Worker, e o arquivo e desta
// origem: encerrar a live (que tira o iframe) nao o perde. Com a sessao fora do ar, o envio para a Bunny comeca sozinho
// (nunca com a live no ar: disputaria a internet de quem apresenta), em pedacos, e continua de onde parou depois de uma
// queda ou de recarregar a pagina. Um arquivo por vez, e so numa aba (navigator.locks).

const copy = WEBINAR_COPY.consoleAoVivo.gravacaoLocal;
const HELLO_EVERY_MS = 3_000;
const META_EVERY_S = 5;
// A sala mede a camera e acorda o codificador antes de comecar (ate uns 10 s na primeira vez).
const OPEN_STALE_MS = 25_000;
const STOP_WAIT_MS = 6_000;

type Recording = { bytes: number; closing: boolean; fileName: string; frameName: string; openedAt: number; seconds: number; startedAtMs: number | null; worker: Worker };

export type LocalUploadState = { name: string; sent: number; size: number };

export type LocalRecordingState = {
  /** Da para gravar agora: o iframe na sala, de quem modera, num navegador que grava. */
  available: boolean;
  bytes: number;
  files: readonly LocalRecordingFile[];
  fps: number | null;
  lost: number;
  mic: string | null;
  /** O envio para a Bunny esta em curso (nesta aba). */
  upload: LocalUploadState | null;
  problem: string | null;
  recording: boolean;
  remove: (name: string) => Promise<void>;
  seconds: number;
  send: (name: string) => void;
  start: () => void;
  /** Para e espera o arquivo fechar (no maximo 6 s); sem gravacao, volta na hora. */
  stop: () => Promise<void>;
};

export function useLocalRecording(input: {
  canWrite: boolean;
  domain: string | null;
  frame: () => Window | null;
  joined: boolean;
  post: (message: unknown) => boolean;
  sessionId: string | null;
  /** A live esta na espera ou no ar (o envio sozinho espera ela acabar). */
  sessionOpen: boolean;
  /** Hora do servidor menos a do aparelho. */
  skewMs: number;
}): LocalRecordingState {
  const { canWrite, domain, frame, joined, post, sessionId, sessionOpen, skewMs } = input;
  const [state, setState] = useState<LocalRecordingFrameState | null>(null);
  const [current, setCurrent] = useState<{ bytes: number; started: boolean } | null>(null);
  const [files, setFiles] = useState<LocalRecordingFile[]>([]);
  const [upload, setUpload] = useState<LocalUploadState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const recording = useRef<Recording | null>(null);
  const uploading = useRef(false);
  const paused = useRef(new Set<string>());
  const closed = useRef<(() => void)[]>([]);
  const lastStateAt = useRef(0);

  const refresh = useCallback(async () => {
    if (!sessionId || !localRecordingSupported()) {
      return;
    }
    const list = await listLocalFiles(sessionId, recording.current?.fileName ?? null).catch(() => null);
    if (list) {
      setFiles(list);
    }
  }, [sessionId]);

  /** Fecha o arquivo: parou, o iframe saiu ou o disco falhou. */
  const close = useCallback((seconds?: number, report?: string) => {
    const active = recording.current;
    if (!active || active.closing) {
      return;
    }
    active.closing = true;
    const total = Math.max(1, Math.round(seconds ?? active.seconds));
    patchMeta(active.fileName, report === undefined ? { seconds: total } : { report, seconds: total });
    active.worker.postMessage({ papel: "fechar" });
  }, []);

  const settle = useCallback(() => {
    recording.current?.worker.terminate();
    recording.current = null;
    setCurrent(null);
    closed.current.splice(0).forEach((done) => done());
    void refresh();
  }, [refresh]);

  const open = useCallback(
    (frameName: string) => {
      if (!sessionId || recording.current || !localRecordingSupported()) {
        post(localRecordingMessage("sem-disco", frameName));
        return;
      }
      let worker: Worker;
      try {
        worker = new Worker(LOCAL_RECORDING_WORKER);
      } catch {
        post(localRecordingMessage("sem-disco", frameName));
        setProblem(copy.semDisco);
        return;
      }
      const active: Recording = { bytes: 0, closing: false, fileName: localFileName(sessionId, frameName), frameName, openedAt: Date.now(), seconds: 0, startedAtMs: null, worker };
      recording.current = active;
      setCurrent({ bytes: 0, started: false });
      const fail = () => {
        setProblem(copy.semDisco);
        post(localRecordingMessage("sem-disco", frameName));
        // Antes de comecar nao ha nada a guardar; no meio, fecha com o que ja esta no disco.
        if (active.startedAtMs === null || active.closing) {
          settle();
        } else {
          close();
        }
      };
      worker.onerror = fail;
      worker.onmessage = (event: MessageEvent<{ bytes?: number; tipo?: string }>) => {
        if (recording.current !== active) {
          return;
        }
        if (event.data.tipo === "aberto") {
          post(localRecordingMessage("guardado", frameName));
        } else if (event.data.tipo === "escrito") {
          active.bytes = event.data.bytes ?? active.bytes;
          setCurrent({ bytes: active.bytes, started: true });
        } else if (event.data.tipo === "fechado") {
          settle();
        } else if (event.data.tipo === "erro") {
          fail();
        }
      };
      worker.postMessage({ nome: active.fileName, papel: "abrir" });
    },
    [close, post, sessionId, settle]
  );

  // Os avisos do iframe: so do proprio iframe, pela origem do motor.
  useEffect(() => {
    if (!domain) {
      return;
    }
    const origin = meetOrigin(domain);
    const onMessage = (event: MessageEvent) => {
      const source = frame();
      if (event.origin !== origin || !source || event.source !== source) {
        return;
      }
      const heard = localRecordingEventOf(event.data);
      if (!heard) {
        return;
      }
      const active = recording.current;
      if (heard.kind === "state") {
        lastStateAt.current = Date.now();
        setState(heard.state);
        if (active && heard.state.recording && !active.closing) {
          const due = Math.floor(heard.state.seconds / META_EVERY_S) > Math.floor(active.seconds / META_EVERY_S);
          active.seconds = heard.state.seconds;
          if (due) {
            patchMeta(active.fileName, { seconds: active.seconds });
          }
        } else if (active && !active.closing && !heard.state.recording) {
          // O iframe recarregou por dentro e nao grava mais: fecha com o que chegou, ou solta o que nem comecou.
          if (active.startedAtMs !== null) {
            close();
          } else if (Date.now() - active.openedAt > OPEN_STALE_MS) {
            const name = active.fileName;
            settle();
            void removeLocalFile(name).catch(() => undefined);
          }
        }
        return;
      }
      if (heard.kind === "open") {
        setProblem(null);
        open(heard.name);
        return;
      }
      if (heard.kind === "failed") {
        setProblem(heard.reason ? copy.falhou(heard.reason) : copy.falhouSemMotivo);
        if (active && (heard.name === null || heard.name === active.frameName)) {
          const name = active.fileName;
          settle();
          void removeLocalFile(name).catch(() => undefined);
        }
        return;
      }
      if (!active || heard.name !== active.frameName || active.closing) {
        return;
      }
      if (heard.kind === "started") {
        active.startedAtMs = Date.now() + skewMs;
        patchMeta(active.fileName, { seconds: 1, startedAtMs: active.startedAtMs });
        setCurrent({ bytes: 0, started: true });
      } else if (heard.kind === "chunk") {
        active.worker.postMessage({ bytes: heard.bytes, papel: "pedaco" }, [heard.bytes]);
      } else {
        close(heard.seconds, heard.report);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [close, domain, frame, open, settle, skewMs]);

  // O "ola" ate o iframe responder (o arquivo da instancia pode carregar depois da entrada), e de novo se ele se calar.
  useEffect(() => {
    if (!joined) {
      return;
    }
    const hello = () => {
      if (Date.now() - lastStateAt.current > HELLO_EVERY_MS) {
        post(localRecordingMessage("ola"));
      }
    };
    lastStateAt.current = 0;
    hello();
    const timer = window.setInterval(hello, HELLO_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [joined, post]);

  // O iframe saiu da sala (a live acabou, a pagina trocou) ou calou com uma gravacao aberta: fecha com o que chegou.
  useEffect(() => {
    if (joined) {
      return;
    }
    const timer = window.setTimeout(() => close(), 1_500);
    return () => window.clearTimeout(timer);
  }, [close, joined]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Saindo do console, o arquivo fecha com o que ja chegou.
  useEffect(() => () => close(), [close]);

  /* O envio */

  const sendFile = useCallback(
    async (name: string) => {
      if (!sessionId || uploading.current) {
        return;
      }
      uploading.current = true;
      setProblem(null);
      const run = async () => {
        const file = await localFile(name);
        setUpload({ name, sent: 0, size: file.size });
        const meta = readMeta(name);
        const base = { durationSeconds: Math.max(1, Math.round(meta.seconds ?? 1)), fileName: name, sessionId, sizeBytes: file.size, startedAtMs: meta.startedAtMs ?? Date.now() + skewMs };
        let fresh = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const prepared = await settleAction(() => prepareLocalUpload({ ...base, fresh }));
          if (!prepared.ok) {
            throw new Error(Object.values(prepared.fieldErrors ?? {})[0]?.[0] ?? prepared.error);
          }
          if (prepared.data.done) {
            patchMeta(name, { sent: true });
            return;
          }
          const { ticket } = prepared.data;
          const known = readMeta(name);
          const result = await tusUpload({
            blob: file,
            endpoint: ticket.endpoint,
            headers: { AuthorizationExpire: String(ticket.expiresAtSeconds), AuthorizationSignature: ticket.signature, LibraryId: ticket.libraryId, VideoId: ticket.videoId },
            location: known.videoId === ticket.videoId ? (known.location ?? null) : null,
            metadata: { filetype: name.endsWith(".webm") ? "video/webm" : "video/mp4", title: name },
            onLocation: (location) => patchMeta(name, { location, videoId: ticket.videoId }),
            onProgress: (sent) => setUpload({ name, sent, size: file.size })
          });
          if (result === "done") {
            const finished = await settleAction(() => finishLocalUpload({ fileName: name, sessionId }));
            if (!finished.ok) {
              throw new Error(finished.error);
            }
            patchMeta(name, { sent: true });
            return;
          }
          fresh = true;
        }
        throw new Error(copy.envioFalhou);
      };
      try {
        await navigator.locks.request(`bunker707:envio:${name}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            paused.current.add(name);
            setProblem(copy.outraAba);
            return;
          }
          await run();
        });
      } catch (error) {
        paused.current.add(name);
        setProblem(error instanceof Error && error.message ? error.message : copy.envioFalhou);
      } finally {
        uploading.current = false;
        // Enviado ou parado, so volta sozinho pelo Enviar agora ou numa carga nova da pagina.
        paused.current.add(name);
        setUpload(null);
        void refresh();
      }
    },
    [refresh, sessionId, skewMs]
  );

  // Com a live fora do ar, o que ainda nao foi enviado segue sozinho; o que falhou espera o Tentar de novo.
  useEffect(() => {
    if (!canWrite || sessionOpen || current !== null || upload !== null) {
      return;
    }
    const next = files.find((file) => !file.meta.sent && !paused.current.has(file.name));
    if (!next) {
      return;
    }
    const timer = window.setTimeout(() => void sendFile(next.name), 0);
    return () => window.clearTimeout(timer);
  }, [canWrite, current, files, sendFile, sessionOpen, upload]);

  // Fechar a aba no meio da gravacao ou do envio pergunta antes.
  const busy = current !== null || upload !== null;
  useEffect(() => {
    if (!busy) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  const start = useCallback(() => {
    setProblem(null);
    if (!recording.current) {
      post(localRecordingMessage("comecar"));
    }
  }, [post]);

  const stop = useCallback(async () => {
    if (!recording.current) {
      return;
    }
    const done = new Promise<void>((resolve) => closed.current.push(resolve));
    post(localRecordingMessage("parar"));
    await Promise.race([done, new Promise<void>((resolve) => window.setTimeout(resolve, STOP_WAIT_MS))]);
  }, [post]);

  const remove = useCallback(
    async (name: string) => {
      await removeLocalFile(name).catch(() => setProblem(copy.apagarFalhou));
      await refresh();
    },
    [refresh]
  );

  const send = useCallback(
    (name: string) => {
      paused.current.delete(name);
      void sendFile(name);
    },
    [sendFile]
  );

  const value = joined ? state : null;

  return {
    available: value?.ready === true,
    bytes: current?.bytes ?? 0,
    files,
    fps: value?.fps ?? null,
    lost: value?.lost ?? 0,
    mic: value?.mic ?? null,
    problem,
    recording: current !== null,
    remove,
    seconds: current?.started ? (value?.seconds ?? 0) : 0,
    send,
    start,
    stop,
    upload
  };
}
