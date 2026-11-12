"use client";

import { BarChart3, CircleDot, Hand, Mic, MicOff, MonitorUp, Settings2, Video, VideoOff } from "lucide-react";
import { Fragment, useRef, useState, type KeyboardEvent } from "react";
import { LiveSettings } from "@/components/member/webinars/room/live-settings";
import { ROOM_SETTINGS_POPOVER, RoomBar, RoomBarButton, RoomPanelToggle } from "@/components/member/webinars/room/room-bar";
import type { ConsoleBarItem } from "@/components/member/webinars/room/room-layout-model";
import { RoomButton } from "@/components/member/webinars/room/room-ui";
import { RoomViewMenu } from "@/components/member/webinars/room/room-view-menu";
import { thumbsPending } from "@/components/member/webinars/room/live-room-model";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomThumbs } from "@/lib/webinar-room-prefs";
import { cn } from "@/lib/utils";
import { consoleBarItemsFor, consoleRecordButton, type ConsolePanelView } from "@/server/webinars/console-v2-model";
import { lobbyNotice, recorderCard, type LiveConsoleSnapshot } from "@/server/webinars/live-console-model";
import type { WebinarSession } from "@/server/webinars/model";
import { CONSOLE_PANEL_ID, CONSOLE_SETTINGS_ID } from "./console-layout-model";
import type { LiveRoomHandle } from "./live-room-panel";

// A barra de quem apresenta no console (docs/31 V2-14), embaixo do palco, na casca da barra da sala (RoomBar como
// <nav> "Controles de quem apresenta", 72 px a partir de lg) e com os circulos dela. A esquerda, a Sala de espera:
// "Sala de espera · 2" com Admitir todos (answerKnockingParticipant de cada um) quando alguem bate, ou a frase da sala
// numa pilula quieta. No centro, Microfone (toggleAudio), Câmera (toggleVideo), Compartilhar tela (toggleShareScreen,
// so onde o nosso circulo vale; no outro navegador, o botao de tela do proprio motor, V2-A39), Gravar (requestRecording
// e o startRecording do arquivo; com o gravador por preparar, o clique abre o ⋯ › Gravação do painel, onde fica o
// Preparar), Mãos (abre a aba Mãos do painel, com o numero de maos levantadas) e Lançar enquete (abre o ⋯ › Enquetes). A
// direita, o "Palco para todos ▾" do Apresentador (setTileView no proprio iframe; o seguir a visao leva a todos) ou a
// Visão do vídeo de antes para o co-apresentador e a Equipe, as Configurações (o LiveSettings da sala, por cima do
// palco, logo depois do botao no teclado) e o balao que abre e fecha o painel do console. Os nomes sao fixos (o de Mãos
// diz quantas) e o estado vai em aria-pressed (ou aria-expanded nos que abrem algo por cima; os que abrem o painel levam
// o aria-controls dele); os estados vem do motor (o LiveRoomHandle), nunca do clique. Fora da sala, todo circulo de
// midia fica desligado; Mãos, Lançar enquete e o balao so abrem o painel. O Esc e o Fechar das Configurações devolvem o
// foco ao botao. Nenhuma frase escrita aqui e nenhum texto cita o motor da sala.

const copy = WEBINAR_COPY.consoleV2;
const live = WEBINAR_COPY.consoleAoVivo;
const aoVivo = WEBINAR_COPY.aoVivo;

/**
 * A grade da barra do console: a partir de lg, a zona da esquerda (a Sala de espera) fica com o que sobra e nunca alarga
 * a barra (a pilula encolhe e o texto vira reticencias, com o texto inteiro no title); o centro e a direita, como na
 * sala. Com o painel aberto a 1024 px a coluna do palco tem 656 px, e os nove circulos com a pilula nao cabiam. Abaixo de
 * lg a pilula fica do tamanho do conteudo (LOBBY_PILL) e a barra rola de lado (V2-A42): encolhida, ela sumia e o Admitir
 * todos vazava por baixo do Microfone.
 */
const CONSOLE_BAR_GRID = "lg:grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)]";
/** A pilula da Sala de espera: inteira abaixo de lg (a barra rola), encolhida com reticencias a partir de lg. */
const LOBBY_PILL = "min-w-0 max-w-[220px] shrink max-lg:max-w-none max-lg:shrink-0 xl:max-w-[288px] 2xl:max-w-[460px]";

/**
 * As Configurações abertas: a partir de lg, como na sala (ROOM_SETTINGS_POPOVER, por cima do palco, alinhado a direita
 * da barra). Abaixo de lg o botao fica dentro da barra (o painel vem logo depois dele no teclado) e, no fluxo, o painel
 * entraria na fileira dos circulos: ele abre por cima, logo abaixo da barra, onde a pagina rola (acima dela, o palco
 * 16:9 do celular e mais baixo que o painel, que sairia pelo topo da tela).
 */
const CONSOLE_SETTINGS_POPOVER = cn(
  ROOM_SETTINGS_POPOVER,
  "max-lg:absolute max-lg:right-0 max-lg:top-full max-lg:z-40 max-lg:mx-0 max-lg:w-[min(380px,calc(100vw-2rem))] max-lg:shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
);

export type ConsoleBarProps = {
  busyKey: string | null;
  /** messaging.publish: o Gravar (o servidor confere de qualquer jeito). */
  canPublish: boolean;
  handle: LiveRoomHandle;
  /** As maos levantadas (o numero da aba Mãos, consoleTabCounts). */
  handsCount: number;
  live: Pick<LiveConsoleSnapshot, "recorder" | "roomLocked">;
  nowMs: number;
  /** Gravar: o mesmo pedido do cartao Gravação (requestRecording e o startRecording do arquivo). */
  onRecord: () => void;
  onStopRecording: () => void;
  /** Mãos, Lançar enquete e o Gravar por preparar: abre o painel na aba ou na entrada do ⋯ (o foco vai a ela). */
  onOpenPanel: (view: ConsolePanelView) => void;
  /** Escolher onde as miniaturas ficam (rodada v9, docs/30 D91); sem ele, o menu fica so com Palco e Grade. */
  onThumbs?: (thumbs: RoomThumbs) => void;
  /** O balao: abre e fecha o painel do console. */
  onTogglePanel: () => void;
  panelOpen: boolean;
  session: Pick<WebinarSession, "status">;
  /** A escolha guardada das miniaturas (Lateral por padrao). */
  thumbs?: RoomThumbs;
};

export function ConsoleBar({ busyKey, canPublish, handle, handsCount, live: snapshot, nowMs, onOpenPanel, onRecord, onStopRecording, onThumbs, onTogglePanel, panelOpen, session, thumbs = "side" }: ConsoleBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const { joined, room } = handle;
  const notice = lobbyNotice({ lobby: handle.lobby, roomLocked: snapshot.roomLocked, status: session.status });
  const items = consoleBarItemsFor({ controls: handle.controls, knocking: room.knocking.length, lobbyNotice: notice, meetConfigured: handle.meetConfigured, role: handle.role, screenShare: handle.screenShare });
  const open = session.status === "waiting" || session.status === "live";
  const card = recorderCard({ nowMs, recorder: snapshot.recorder, recordingOn: room.recording.on, status: session.status });
  const record = consoleRecordButton({ canPublish, card, joined, open });
  const recordBusy = busyKey !== null && busyKey.startsWith("live:rec");

  function focusSettingsButton() {
    rootRef.current?.querySelector<HTMLButtonElement>('[data-room-bar-item="settings"]')?.focus();
  }

  function closeSettings() {
    focusSettingsButton();
    handle.setSettingsOpen(false);
  }

  function toggleSettings() {
    if (handle.settingsOpen) {
      // O foco vai ao botao antes de as Configurações sumirem (o WebKit nao foca o botao no clique).
      closeSettings();
      return;
    }
    setViewMenuOpen(false);
    handle.setSettingsOpen(true);
  }

  function onSettingsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    }
  }

  function admitAll() {
    for (const person of room.knocking) {
      handle.command("answerKnockingParticipant", person.id, true);
    }
    // A pilula com o botao some (ou vira a frase): o foco vai antes ao primeiro circulo do centro (o Microfone de quem
    // apresenta, as Mãos da Equipe), senao cairia no comeco da pagina.
    rootRef.current?.querySelector<HTMLButtonElement>('[data-room-bar-item="mic"]:not(:disabled), [data-room-bar-item="hands"]')?.focus();
    handle.dispatch({ type: "admitAll" });
  }

  function lobby() {
    const state = items.lobby;
    if (!state) {
      return null;
    }
    if (state.kind === "knocking") {
      return (
        <div
          className={cn("flex h-9 items-center gap-2 rounded-full border border-room-border-strong pl-3 pr-1.5 text-xs font-semibold text-room-fg-strong", LOBBY_PILL)}
          data-console-lobby="knocking"
          key="lobby"
          title={copy.barra.salaDeEspera(state.count)}
        >
          <span className="min-w-0 truncate">{copy.barra.salaDeEspera(state.count)}</span>
          <RoomButton className="h-6 rounded-full px-2 text-[11px] font-bold" disabled={!joined} onClick={admitAll} size="xs" variant="primary">
            {live.admitirTodos}
          </RoomButton>
        </div>
      );
    }
    return (
      <span
        className={cn("truncate rounded-full border border-room-border px-3 py-1.5 text-xs text-room-fg-muted", LOBBY_PILL)}
        data-console-lobby="notice"
        key="lobby"
        title={state.text}
      >
        {state.text}
      </span>
    );
  }

  function control(item: ConsoleBarItem) {
    switch (item) {
      case "lobby":
        return lobby();
      case "mic":
        return <RoomBarButton active={handle.audioOn} disabled={!joined} icon={handle.audioOn ? Mic : MicOff} item={item} key={item} label={aoVivo.microfone} onClick={() => handle.command("toggleAudio")} />;
      case "camera":
        return (
          <RoomBarButton
            active={handle.videoOn}
            disabled={!joined}
            icon={handle.videoOn ? Video : VideoOff}
            item={item}
            key={item}
            label={aoVivo.camera}
            onClick={() => handle.command("toggleVideo")}
            title={handle.videoOn ? aoVivo.desligarCamera : aoVivo.ligarCamera}
          />
        );
      case "share":
        // O estado so pelo screenSharingStatusChanged: o seletor de tela cancelado nao avisa nada.
        return (
          <RoomBarButton
            active={handle.sharing}
            disabled={!joined}
            icon={MonitorUp}
            item={item}
            key={item}
            label={copy.barra.compartilharTela}
            onClick={() => handle.command("toggleShareScreen", { enable: !handle.sharing })}
          />
        );
      case "record":
        // Com o gravador por preparar o circulo so abre o ⋯ › Gravação: sem aria-pressed (como Mãos e Lançar enquete),
        // para o leitor de tela nao anunciar um liga e desliga que o clique nao faz.
        return (
          <RoomBarButton
            active={record.opensPanel ? undefined : record.active}
            busy={record.busy || recordBusy}
            className={record.active ? "border border-room-danger-border bg-room-danger-bg text-room-danger-fg hover:bg-room-danger-bg/80" : undefined}
            controls={record.opensPanel ? CONSOLE_PANEL_ID : undefined}
            disabled={!record.enabled || recordBusy}
            icon={CircleDot}
            item={item}
            key={item}
            label={live.gravar}
            onClick={record.opensPanel ? () => onOpenPanel({ more: "gravacao" }) : record.active ? onStopRecording : onRecord}
            title={record.title}
          />
        );
      case "hands": {
        const count = Number.isFinite(handsCount) ? Math.max(0, Math.floor(handsCount)) : 0;
        return (
          <RoomBarButton controls={CONSOLE_PANEL_ID} icon={Hand} item={item} key={item} label={copy.barra.maos(count)} onClick={() => onOpenPanel({ tab: "maos" })}>
            {count > 0 ? (
              <span
                aria-hidden="true"
                className="absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-room-accent px-[5px] text-[11px] font-bold leading-none tabular-nums text-white shadow-[0_0_0_2px_var(--room-surface)]"
                data-console-hands-count=""
              >
                {count}
              </span>
            ) : null}
          </RoomBarButton>
        );
      }
      case "poll":
        // Com o painel aberto, de 1024 a 1279 px a barra nao cabe com a Sala de espera: o Lançar enquete sai (o ⋯ ›
        // Enquetes do painel, logo ao lado, faz o mesmo) e volta a partir de 1280 px.
        return (
          <RoomBarButton
            className={panelOpen ? "lg:max-xl:hidden" : undefined}
            controls={CONSOLE_PANEL_ID}
            icon={BarChart3}
            item={item}
            key={item}
            label={copy.barra.lancarEnquete}
            onClick={() => onOpenPanel({ more: "enquetes" })}
          />
        );
      case "view":
        return (
          <RoomViewMenu
            disabled={!joined}
            forAll={handle.role === "host"}
            key={item}
            onChoose={(view) => handle.command("setTileView", view === "grid")}
            onOpenChange={(next) => {
              if (next) {
                handle.setSettingsOpen(false);
              }
              setViewMenuOpen(next);
            }}
            onThumbs={onThumbs}
            open={viewMenuOpen}
            shown={room.viewShown}
            thumbs={thumbs}
            // Para quem apresenta, o Esconder sai tambem da gravacao (o seguir a visao leva ao gravador).
            thumbsNote={handle.role === "host" && thumbs === "hidden" ? WEBINAR_COPY.salaV2.visao.miniaturas.escondidasNaGravacao : null}
            thumbsPending={thumbsPending({ row: handle.thumbsRow, thumbs })}
          />
        );
      case "settings":
        // As Configurações logo depois do botao no teclado (o Tab do botao entra nelas), por cima do palco na tela. Quem
        // apresenta nao tem a faixa de volume nem os atalhos da sala (R, M e E sao da barra do aluno).
        return (
          <Fragment key={item}>
            <RoomBarButton controls={CONSOLE_SETTINGS_ID} expanded={handle.settingsOpen} icon={Settings2} item={item} label={live.configuracoes} onClick={toggleSettings} />
            {handle.settingsOpen ? (
              <div className={CONSOLE_SETTINGS_POPOVER} data-live-settings="" id={CONSOLE_SETTINGS_ID} onKeyDown={onSettingsKeyDown}>
                <LiveSettings
                  cameraOn={handle.videoOn}
                  devices={handle.devices}
                  onChoose={handle.chooseDevice}
                  onClose={closeSettings}
                  presenterBar="ours"
                  sections={{ ...handle.deviceSettings, atalhos: false, volume: "oculta" }}
                  showMedia={false}
                />
              </div>
            ) : null}
          </Fragment>
        );
      case "panel":
        // A partir de lg o trilho abre e fecha o painel (docs/31 §10, como na sala): o balao fica so abaixo de lg.
        return <RoomPanelToggle className="lg:hidden" controls={CONSOLE_PANEL_ID} key={item} labels={copy.painel} onToggle={onTogglePanel} open={panelOpen} />;
      default:
        return null;
    }
  }

  return (
    <div className="relative min-w-0" data-console-bar="" ref={rootRef}>
      <RoomBar as="nav" center={items.center.map(control)} className={CONSOLE_BAR_GRID} label={copy.barra.rotulo} left={items.left.map(control)} right={items.right.map(control)} />
    </div>
  );
}
