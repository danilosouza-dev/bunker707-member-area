"use client";

import { DoorOpen, LogIn, RefreshCw, Users } from "lucide-react";
import { useEffect, type CSSProperties, type RefObject } from "react";
import { columnWanted, stageColumnShown } from "@/components/member/webinars/room/live-room-model";
import { stageVideoRightPx } from "@/components/member/webinars/room/room-layout-model";
import { RoomStageBadges, RoomStagePill } from "@/components/member/webinars/room/room-stage-badges";
import { RoomButton } from "@/components/member/webinars/room/room-ui";
import { useStageGeometry } from "@/components/member/webinars/room/use-stage-geometry";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { consoleColumnPolicy, consoleStageBadgeFor, type ConsoleStageTopLeft } from "@/server/webinars/console-v2-model";
import type { LiveConsoleSnapshot } from "@/server/webinars/live-console-model";
import type { WebinarSession } from "@/server/webinars/model";
import type { LiveRoomHandle } from "./live-room-panel";

// O palco da live no console de quem apresenta (docs/31 V2-4, V2-13 e V2-A5): o pai do iframe ([data-live-stage], o
// mesmo ref do useLiveRoom, que nunca muda de pai), os selos por cima do video e as capas. Em cima a esquerda, "Ao vivo ·
// 00:42:10" com a sala no ar ou a frase do momento fora dele (consoleStageTopLeft) e "Gravando" enquanto o gravador
// grava; em cima a direita, "12 presentes · pico 14" (consolePresenceBadge); embaixo a esquerda, quem esta no video
// grande com o papel ("Você · Apresentador", consoleStageBadgeFor). Sem o selo do Assistente (o retrato do console nao
// traz o estado, V2-A41). As capas (Testar sala, Tentar de novo, Entrar na sala) sao RoomButton nos tokens do tema, com
// o anel de foco branco: o palco e preto nos dois temas, e o anel do tema claro (quase preto) sumiria sobre ele. O anel
// do admin vem da regra global de foco (globals.css, var(--focus-ring), fora de @layer), entao a camada das capas troca
// a variavel, nao a classe do botao.
// A coluna de miniaturas (V2-A5): a largura do palco pelo useStageGeometry; os selos de cima a direita descontam a
// coluna quando ela esta na tela (--room-video-right, stageColumnShown). Pela regra do papel (consoleColumnPolicy), o
// Apresentador nunca manda toggleFilmStrip pela propria largura (o seguir a visao levaria a escolha a todos e ao
// gravador) e o co-apresentador e a Equipe tiram ou poem a coluna pela largura, como o aluno (columnWanted).
// Nenhum texto cita o motor da sala.

const copy = WEBINAR_COPY.consoleAoVivo;
/** A camada das capas: o anel de foco branco sobre o palco preto, nos dois temas (a regra global le --focus-ring). */
const COVER = "[--focus-ring:white]";

type ConsoleStageProps = {
  busy: boolean;
  /** As classes do palco (consoleSkeleton): 16:9 abaixo de lg, a altura que sobra da coluna a partir de lg. */
  className: string;
  handle: LiveRoomHandle;
  live: LiveConsoleSnapshot;
  /** "12 presentes · pico 14" (consolePresenceBadge); nulo, o canto de cima a direita fica vazio. */
  presentLabel: string | null;
  /** O nome do apresentador da pagina (o selo de outro moderador no video grande); nulo, o nome com que ele esta na sala. */
  presenterName: string | null;
  session: WebinarSession;
  /** O mesmo ref passado ao useLiveRoom: o iframe entra aqui. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** O selo do momento (consoleStageTopLeft). */
  topLeft: ConsoleStageTopLeft | null;
};

/** A frase por cima do palco quando a sala nao esta no iframe (abrindo, agendada, encerrada, sem a sala no ambiente). */
function frameMessage(handle: LiveRoomHandle, status: WebinarSession["status"]): string | null {
  if (!handle.meetConfigured) {
    return copy.salaEmBreve;
  }
  if (status === "ended" || status === "cancelled") {
    return WEBINAR_COPY.sala.encerrada;
  }
  if (status === "scheduled" && !handle.testing) {
    return copy.abrirSalaTexto;
  }
  if (handle.tokenError === "failed" && handle.frameStatus === "idle") {
    return WEBINAR_COPY.aoVivo.erroAbrir;
  }
  switch (handle.frameStatus) {
    case "joined":
      return null;
    case "failed":
      return WEBINAR_COPY.aoVivo.naoConseguimosVoltar;
    case "left":
      return null;
    default:
      return WEBINAR_COPY.aoVivo.abrindo;
  }
}

export function ConsoleStage({ busy, className, handle, live, presentLabel, presenterName, session, stageRef, topLeft }: ConsoleStageProps) {
  const geometry = useStageGeometry(stageRef);
  const { joined, room } = handle;
  const frameWidth = geometry.frameWidth;
  const byWidth = consoleColumnPolicy(handle.role) === "width";
  const wantColumn = columnWanted({ frameWidth, view: room.viewShown });
  const filmstripVisible = room.filmstripVisible;
  const syncFilmstrip = handle.syncFilmstrip;

  // A coluna de miniaturas pela largura do iframe, so no co-apresentador e na Equipe: na entrada e a cada largura nova
  // (o painel que abre ou fecha, a janela). O Apresentador deixa a coluna com o motor.
  useEffect(() => {
    if (byWidth && joined && frameWidth > 0) {
      syncFilmstrip({ visible: filmstripVisible, wanted: wantColumn });
    }
  }, [byWidth, filmstripVisible, frameWidth, joined, syncFilmstrip, wantColumn]);

  const message = frameMessage(handle, session.status);
  const recording = room.recording.on || live.recorder.status === "recording";
  const canTest = handle.meetConfigured && session.status === "scheduled" && !handle.testing;
  const showRetry = handle.frameStatus === "failed" || (handle.tokenError === "failed" && handle.frameStatus === "idle");
  const badge = consoleStageBadgeFor({ joined, presenterName, role: handle.role, room });
  const videoRightPx = stageVideoRightPx({ columnShown: stageColumnShown(room, joined), touch: geometry.touch });

  return (
    <div className={className} data-console-slot="stage" data-live-frame-status={handle.frameStatus} style={{ "--room-video-right": `${videoRightPx}px` } as CSSProperties}>
      <div aria-label={WEBINAR_COPY.aoVivo.palco} className="absolute inset-0 [&_iframe]:size-full [&_iframe]:border-0" data-live-stage="" ref={stageRef} role="region" />
      <RoomStageBadges
        assistantOn={false}
        presenterName={badge?.name ?? null}
        presenterRole={badge?.role}
        recording={recording}
        topLeft={topLeft}
        topRight={
          presentLabel ? (
            <RoomStagePill className="tabular-nums" data-room-badge="present">
              <Users aria-hidden="true" />
              {presentLabel}
            </RoomStagePill>
          ) : null
        }
      />
      {message ? (
        <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center", COVER)} data-live-stage-message="">
          <p className="max-w-md text-sm leading-5 text-white/85">{message}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {canTest ? (
              <RoomButton disabled={busy} onClick={handle.startTesting} size="sm">
                <DoorOpen aria-hidden="true" />
                {copy.testarSala}
              </RoomButton>
            ) : null}
            {showRetry ? (
              <RoomButton onClick={handle.retry} size="sm">
                <RefreshCw aria-hidden="true" />
                {WEBINAR_COPY.sala.tentarDeNovo}
              </RoomButton>
            ) : null}
          </div>
        </div>
      ) : null}
      {handle.frameStatus === "left" ? (
        <div className={cn("absolute inset-0 flex items-center justify-center p-4", COVER)} data-live-stage-left="">
          <RoomButton onClick={handle.retry} size="sm">
            <LogIn aria-hidden="true" />
            {WEBINAR_COPY.aoVivo.entrarNaSala}
          </RoomButton>
        </div>
      ) : null}
    </div>
  );
}
