"use client";

import { DoorOpen, LogIn, PictureInPicture2, RefreshCw, Users } from "lucide-react";
import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { columnWanted, stageColumnShown, stageRowShown } from "@/components/member/webinars/room/live-room-model";
import { stageVideoBottomPx, stageVideoRightPx } from "@/components/member/webinars/room/room-layout-model";
import { RoomStageBadges, RoomStagePill } from "@/components/member/webinars/room/room-stage-badges";
import { ROOM_FOCUS, RoomButton } from "@/components/member/webinars/room/room-ui";
import { useStageGeometry } from "@/components/member/webinars/room/use-stage-geometry";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { RoomThumbs } from "@/lib/webinar-room-prefs";
import { consoleStageBadgeFor, consoleThumbsWanted, type ConsoleStageTopLeft } from "@/server/webinars/console-v2-model";
import type { LiveConsoleSnapshot } from "@/server/webinars/live-console-model";
import type { WebinarSession } from "@/server/webinars/model";
import { consoleThumbsReload, type LiveRoomHandle } from "./live-room-panel";

// O palco da live no console de quem apresenta (docs/31 V2-4, V2-13 e V2-A5): o pai do iframe ([data-live-stage], o
// mesmo ref do useLiveRoom, que nunca muda de pai), os selos por cima do video e as capas. Em cima a esquerda, "Ao vivo ·
// 00:42:10" com a sala no ar ou a frase do momento fora dele (consoleStageTopLeft) e "Gravando" enquanto o gravador
// grava; em cima a direita, "12 presentes · pico 14" (consolePresenceBadge, a partir de sm; abaixo, no topo); embaixo
// a esquerda, quem esta no video grande com o papel ("Você · Apresentador", ou o selo que o aluno ve com outro
// moderador ali, consoleStageBadgeFor). Sem o selo do Assistente (o retrato do console nao traz o estado, V2-A41). As
// capas (Testar sala, Tentar de novo, Entrar na sala) sao RoomButton nos tokens do tema, sobre o veu escuro da sala e
// com o anel de foco branco: o iframe cobre o palco e, no tema claro, o fundo dele e claro ate o video grande aparecer
// (a folha da instancia), entao o veu garante o fundo da frase branca e do anel nos dois temas; o anel do tema claro
// (quase preto) sumiria sobre o veu. O anel do admin vem da regra global de foco (globals.css, var(--focus-ring), fora
// de @layer), entao a camada das capas troca a variavel, nao a classe do botao.
// A coluna de miniaturas (V2-A5): a largura do palco pelo useStageGeometry; os selos de cima a direita descontam a
// coluna quando ela esta na tela (--room-video-right, stageColumnShown). Pela regra do papel (consoleColumnPolicy), o
// Apresentador nunca manda toggleFilmStrip pela propria largura (o seguir a visao levaria a escolha a todos e ao
// gravador) e o co-apresentador e a Equipe tiram ou poem a coluna pela largura, como o aluno (columnWanted).
// As miniaturas onde a pessoa escolheu (rodada v9, docs/30 D91; `thumbs`, guardado no navegador do console): o
// co-apresentador e a Equipe somam a escolha a conta da largura (Esconder tira com qualquer largura; a fileira embaixo
// nao depende dela), e o Apresentador so manda o comando pela escolha dele, no Palco (consoleThumbsWanted). Com a
// fileira embaixo na tela, os selos de baixo sobem (--room-video-bottom).
// Nenhum texto cita o motor da sala. A Na tela (docs/30 §2.4; especificacao de 10/11/2026, §6.1): os cartoes do banner
// e do QR Code nao sao desenhados neste palco (o menu das miniaturas do motor precisa continuar livre); com algum deles
// na tela, a pilula neutra "Na tela: Banner · QR Code" em cima a direita, depois dos presentes. Os presentes ("12
// presentes · pico 14 · +300 simulados") sao o botao que abre os participantes simulados (docs/30 D79; `onPresent`).

const copy = WEBINAR_COPY.consoleAoVivo;
/**
 * A camada das capas: o veu escuro da sala (bg-black/70, como as capas da sala do aluno) por cima do iframe, cujo fundo e
 * o do tema (claro no tema claro, ate o video grande aparecer), e o anel de foco branco sobre ele, nos dois temas (a
 * regra global le --focus-ring).
 */
const COVER = "bg-black/70 [--focus-ring:white]";

type ConsoleStageProps = {
  busy: boolean;
  /** As classes do palco (consoleSkeleton): 16:9 abaixo de lg, a altura que sobra da coluna a partir de lg. */
  className: string;
  handle: LiveRoomHandle;
  live: LiveConsoleSnapshot;
  /** O toque nos presentes (docs/30 D79): abre os participantes simulados. Sem ele, a pilula fica so como texto. */
  onPresent?: () => void;
  /** "12 presentes · pico 14" (consolePresenceBadge); nulo, o canto de cima a direita fica vazio. */
  presentLabel: string | null;
  /** O nome do apresentador da pagina (o selo de outro moderador no video grande, V2-A25); nulo, esse selo nao aparece. */
  presenterName: string | null;
  /** "Na tela: Banner · QR Code" (a Na tela, com o banner ou o QR Code na frente da turma); nulo, a pilula nao aparece. */
  screenLabel?: string | null;
  session: WebinarSession;
  /** O mesmo ref passado ao useLiveRoom: o iframe entra aqui. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** Onde quem esta no console quer as miniaturas (Lateral por padrao). */
  thumbs?: RoomThumbs;
  /** O selo do momento (consoleStageTopLeft). */
  topLeft: ConsoleStageTopLeft | null;
};

/**
 * A frase por cima do palco quando a sala nao esta no iframe (abrindo, agendada, encerrada, sem a sala no ambiente). A
 * falha so diz "Não conseguimos voltar." depois de o console ter entrado nesta pagina (a queda e as tentativas de
 * voltar); a que acontece antes de entrar (o servidor de video fora do ar, o script que nao carrega) diz que nao foi
 * possivel abrir a sala, como a falha do token.
 */
function frameMessage(handle: LiveRoomHandle, status: WebinarSession["status"], everJoined: boolean): string | null {
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
      return everJoined ? WEBINAR_COPY.aoVivo.naoConseguimosVoltar : WEBINAR_COPY.aoVivo.erroAbrir;
    case "left":
      return null;
    default:
      return WEBINAR_COPY.aoVivo.abrindo;
  }
}

export function ConsoleStage({ busy, className, handle, live, onPresent, presentLabel, presenterName, screenLabel = null, session, stageRef, thumbs = "side", topLeft }: ConsoleStageProps) {
  const geometry = useStageGeometry(stageRef);
  const { joined, room } = handle;
  const frameWidth = geometry.frameWidth;
  const row = handle.thumbsRow === true;
  // O que o console quer das miniaturas agora (nulo: nao mexe): a largura e a escolha no co-apresentador e na Equipe;
  // so a escolha, e so no Palco, no Apresentador.
  const wantColumn = consoleThumbsWanted({ byWidth: columnWanted({ frameWidth, row, thumbs, view: room.viewShown }), role: handle.role, thumbs, view: room.viewShown });
  const filmstripVisible = room.filmstripVisible;
  const syncFilmstrip = handle.syncFilmstrip;

  // As miniaturas do iframe, na entrada, a cada largura nova (o painel que abre ou fecha, a janela) e a cada escolha.
  useEffect(() => {
    if (wantColumn !== null && joined && frameWidth > 0) {
      syncFilmstrip({ visible: filmstripVisible, wanted: wantColumn });
    }
  }, [filmstripVisible, frameWidth, joined, syncFilmstrip, wantColumn]);

  // A troca entre Lateral e Embaixo (docs/30 D96): com nada de quem esta no console no ar, o video recarrega sozinho,
  // uma vez (o iframe novo ja monta do jeito escolhido); com o microfone, a camera ou a tela ligados, fica com o menu.
  const thumbsReload = consoleThumbsReload(handle, thumbs);
  const reloadVideo = handle.retry;
  useEffect(() => {
    if (thumbsReload !== "auto") {
      return;
    }
    const id = window.setTimeout(reloadVideo, 0);
    return () => window.clearTimeout(id);
  }, [reloadVideo, thumbsReload]);

  // O console ja entrou na sala nesta pagina (a falha depois disso e uma queda; antes, a sala que nao abriu).
  const [everJoined, setEverJoined] = useState(joined);
  if (joined && !everJoined) {
    setEverJoined(true);
  }
  const message = frameMessage(handle, session.status, everJoined);
  const recording = room.recording.on || live.recorder.status === "recording";
  const canTest = handle.meetConfigured && session.status === "scheduled" && !handle.testing;
  const showRetry = handle.frameStatus === "failed" || (handle.tokenError === "failed" && handle.frameStatus === "idle");
  const badge = consoleStageBadgeFor({ joined, presenterName, role: handle.role, room });
  const videoRightPx = stageVideoRightPx({ columnShown: stageColumnShown(room, joined, row), touch: geometry.touch });
  const videoBottomPx = stageVideoBottomPx({ rowShown: stageRowShown(room, joined, row) });

  return (
    <div className={className} data-console-slot="stage" data-live-frame-status={handle.frameStatus} style={{ "--room-video-bottom": `${videoBottomPx}px`, "--room-video-right": `${videoRightPx}px` } as CSSProperties}>
      <div aria-label={WEBINAR_COPY.aoVivo.palco} className="absolute inset-0 [&_iframe]:size-full [&_iframe]:border-0" data-live-stage="" ref={stageRef} role="region" />
      <RoomStageBadges
        assistantOn={false}
        presenterName={badge?.name ?? null}
        presenterRole={badge?.role}
        recording={recording}
        topLeft={topLeft}
        topRight={
          presentLabel || screenLabel ? (
            <>
              {presentLabel && onPresent ? (
                // A pilula e o botao dos participantes simulados (D79): a camada dos selos nao recebe o toque, o botao sim.
                <button
                  aria-label={WEBINAR_COPY.simulacao.plateia.abrirControle(presentLabel)}
                  className={cn("pointer-events-auto rounded-full", ROOM_FOCUS)}
                  data-console-audience-open="stage"
                  onClick={onPresent}
                  type="button"
                >
                  <RoomStagePill className="tabular-nums underline decoration-dotted underline-offset-4" data-room-badge="present">
                    <Users aria-hidden="true" />
                    {presentLabel}
                  </RoomStagePill>
                </button>
              ) : presentLabel ? (
                <RoomStagePill className="tabular-nums" data-room-badge="present">
                  <Users aria-hidden="true" />
                  {presentLabel}
                </RoomStagePill>
              ) : null}
              {screenLabel ? (
                <RoomStagePill data-room-badge="screen">
                  <PictureInPicture2 aria-hidden="true" />
                  {screenLabel}
                </RoomStagePill>
              ) : null}
            </>
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
