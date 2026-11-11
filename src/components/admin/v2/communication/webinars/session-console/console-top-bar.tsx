"use client";

import { ArrowLeft, CircleStop, DoorOpen, Lock, LockOpen, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { RoomThemeButton } from "@/components/member/webinars/room/room-header";
import { RoomPill, roomPillClassName } from "@/components/member/webinars/room/room-pill";
import { RoomSelectPill } from "@/components/member/webinars/room/room-select-pill";
import { RoomTooltip } from "@/components/member/webinars/room/room-tooltip";
import { ROOM_FOCUS, RoomIconButton } from "@/components/member/webinars/room/room-ui";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomTheme } from "@/lib/webinar-room-prefs";
import { cn } from "@/lib/utils";
import { consoleSessionOptionLabel, type ConsolePoll, type ConsolePollNotice, type ConsoleTopAction, type ConsoleTopActionId } from "@/server/webinars/console-v2-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import type { WebinarSession } from "@/server/webinars/model";

// O topo do console V2 (docs/31 V2-13; o estilo do YouTube, docs/31 §10), sem fundo e sem borda (o fundo da pagina
// aparece por tras), como o topo da sala: 64 px a partir de lg. Da esquerda para a direita: a seta de voltar ao editor
// (o circulo de 40 sem fundo, com a dica presa a borda esquerda), o h1 com o nome do webinario (20/28 peso 700, com
// reticencias; para o leitor de tela, "Console da sessão: {nome}") e, embaixo, a linha "Console da sessão" em 14/20
// peso 500 (o "Console da sessão" dela so para quem ve, o h1 ja o diz), que na gravada e no Replay (sem palco) leva
// o momento e os presentes ("Console da sessão · No ar há 12:30 · 7 presentes · pico 9") e na live so os presentes
// abaixo de sm (a partir dai eles ficam no palco, em cima a direita); a direita, o seletor de sessoes numa pilula tonal
// (RoomSelectPill no tamanho M: o seletor nativo por baixo, sem contorno proprio, com o anel de foco na pilula inteira
// so pelo teclado e o ponto verde dentro so com a sessao escolhida no ar), o Atualizar (o circulo sem fundo: o
// icone gira enquanto le, o botao nunca fica desligado por isso, e a regiao viva so para o leitor de tela fala o
// clique, a falta de resposta e a volta, consolePollStep; o sem resposta tambem fica na tela, na faixa abaixo do topo,
// docs/31 V2-A50), os botoes de situacao da sessao em pilulas M do YouTube (consoleTopActionsFor: Abrir a sala e
// Trancar no tonal, Começar para todos e Abrir sessão no branco, Encerrar live e Encerrar sessão no vermelho, Ver
// relatório no tonal) e, sempre por ultimo, o Tema (o botao da sala, centrado sobre o trilho). O Trancar diz a acao no
// nome (Trancar a sala ou Destrancar a sala), sem aria-pressed (docs/31 V2-7). Sem messaging.publish, os botoes da
// sessao ficam desligados com o motivo (aria-disabled, focaveis, o motivo lido junto e mostrado no aviso ao clicar).
// Abaixo de lg o topo quebra em duas linhas: a seta e o titulo; depois o seletor e os botoes, que rolam de lado sem
// barra. A partir de lg e uma faixa so: o titulo encolhe com reticencias e os botoes ficam inteiros (sem rolagem, que
// cortaria as dicas). As cores pelos tokens do tema do console.

const copy = WEBINAR_ADMIN_COPY.console;
const liveCopy = WEBINAR_COPY.consoleAoVivo;
const v2 = WEBINAR_COPY.consoleV2;

/** O que a regiao viva do Atualizar diz (consolePollStep). */
const POLL_NOTICE: Record<ConsolePollNotice, string> = { "": "", atualizando: v2.atualizando, conectado: v2.conectadoDeNovo, semResposta: v2.semResposta };

type ConsoleTopBarProps = {
  actions: readonly ConsoleTopAction[];
  busyKey: string | null;
  canWrite: boolean;
  /** O selo do momento ("No ar há 12:30", "Começa em", "Durou"); vazio, nenhum. */
  clockLabel: string;
  className: string;
  /** O motivo dos botoes da sessao desligados (sem messaging.publish). */
  disabledTitle?: string;
  /** O clique num botao desligado com motivo: o console mostra o motivo no aviso. */
  onBlocked?: (reason: string) => void;
  editorHref: string;
  onAction: (id: Exclude<ConsoleTopActionId, "lock" | "report">) => void;
  onChangeSession: (sessionId: string) => void;
  onLock: (locked: boolean) => void;
  onRefresh: () => void;
  onToggleTheme: () => void;
  /** A leitura do retrato: a regiao viva e o sem resposta (consolePollStep). */
  poll: ConsolePoll;
  /** "7 presentes · pico 9" (consolePresenceBadge); nulo sem sessao. */
  presentLabel: string | null;
  /** Os presentes so abaixo de sm (a live: a partir dai eles ficam no palco, em cima a direita). */
  presentNarrowOnly?: boolean;
  /** Uma leitura do retrato a caminho: o icone do Atualizar gira. */
  reading: boolean;
  reportHref: string;
  roomLocked: boolean;
  sessionId: string | null;
  sessions: readonly Pick<WebinarSession, "id" | "kind" | "scheduledAt" | "status">[];
  theme: RoomTheme;
  /** O nome do webinario (a segunda linha do h1). */
  title: string;
};

/** A seta de voltar: o circulo de 40 sem fundo, como os botoes de icone do topo da sala. */
const BACK = cn(
  "grid size-10 shrink-0 place-items-center rounded-full text-room-icon transition-colors hover:bg-room-control-hover active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)] motion-reduce:transition-none [&_svg]:size-6",
  ROOM_FOCUS
);

export function ConsoleTopBar(props: ConsoleTopBarProps) {
  const { actions, busyKey } = props;
  const selected = props.sessions.find((item) => item.id === props.sessionId) ?? null;
  const onAir = selected?.status === "live";

  function actionButton(action: ConsoleTopAction) {
    const busy = busyKey !== null;
    // Sem messaging.publish: desligado com o motivo (focavel, lido junto e mostrado no aviso ao clicar).
    const reason = action.enabled ? undefined : props.disabledTitle;
    const common = { disabled: busy && action.enabled, disabledReason: reason, onBlocked: reason ? () => props.onBlocked?.(reason) : undefined };
    switch (action.id) {
      case "open_room":
        return <RoomPill {...common} icon={DoorOpen} key={action.id} label={liveCopy.abrirSala} onClick={() => props.onAction("open_room")} tone="tonal" />;
      case "start":
        return <RoomPill {...common} icon={Play} key={action.id} label={liveCopy.comecarParaTodos} onClick={() => props.onAction("start")} tone="white" />;
      case "lock":
        return (
          <RoomPill
            disabled={!props.canWrite || busyKey === "live:lock"}
            icon={props.roomLocked ? LockOpen : Lock}
            key={action.id}
            label={props.roomLocked ? liveCopy.destrancar : liveCopy.trancar}
            onClick={() => props.onLock(!props.roomLocked)}
            tone="tonal"
          />
        );
      case "end_live":
        return <RoomPill {...common} icon={CircleStop} key={action.id} label={liveCopy.encerrarLive} onClick={() => props.onAction("end_live")} tone="red" />;
      case "open_session":
        return <RoomPill {...common} icon={Play} key={action.id} label={copy.open} onClick={() => props.onAction("open_session")} tone="white" />;
      case "end_session":
        return <RoomPill {...common} icon={CircleStop} key={action.id} label={copy.end} onClick={() => props.onAction("end_session")} tone="red" />;
      case "report":
        return (
          <Link className={roomPillClassName({ tone: "tonal" })} href={props.reportHref} key={action.id}>
            {copy.report}
          </Link>
        );
      default:
        return null;
    }
  }

  return (
    <header className={props.className} data-console-slot="top">
      <div className="flex min-w-0 items-center gap-2 lg:flex-1 lg:gap-4">
        <RoomTooltip align="start" label={copy.backToEditor} side="below">
          <Link aria-label={copy.backToEditor} className={BACK} href={props.editorHref}>
            <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
          </Link>
        </RoomTooltip>
        <div className="flex min-w-0 flex-col">
          {/* O h1 diz o console e o webinario ("Console da sessão: Aula de IA"); na tela, o nome grande e o console na linha de baixo. */}
          <h1 className="min-w-0 truncate text-[15px] leading-5 font-bold text-room-fg-strong lg:text-xl lg:leading-7">
            <span className="sr-only">{`${copy.title}: `}</span>
            {props.title}
          </h1>
          <p className="min-w-0 truncate text-xs leading-4 font-medium text-room-fg-subtle lg:text-sm lg:leading-5" data-console-line="">
            <span aria-hidden="true">{copy.title}</span>
            {props.clockLabel ? (
              <span data-console-status="">
                {" · "}
                <span className="tabular-nums" data-console-clock="">
                  {props.clockLabel}
                </span>
              </span>
            ) : null}
            {props.presentLabel ? (
              <span className={cn(props.presentNarrowOnly && "sm:hidden")} data-console-status="">
                {" · "}
                <span className="tabular-nums" data-console-present="">
                  {props.presentLabel}
                </span>
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 max-lg:-mx-1 max-lg:overflow-x-auto max-lg:px-1 max-lg:py-1 max-lg:[scrollbar-width:none] lg:shrink-0 max-lg:[&::-webkit-scrollbar]:hidden">
        <RoomSelectPill<string>
          className="max-w-72 shrink-0 xl:max-w-80"
          disabled={props.sessions.length === 0}
          id="console-session"
          label={v2.rotuloSessao}
          labelHidden
          leading={onAir ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-room-speaking" data-console-on-air="" /> : null}
          onChange={props.onChangeSession}
          options={props.sessions.length === 0 ? [{ label: "—", value: "" }] : props.sessions.map((item) => ({ label: consoleSessionOptionLabel(item), value: item.id }))}
          size="m"
          value={props.sessionId ?? ""}
        />
        <RoomTooltip label={v2.atualizar} side="below">
          <RoomIconButton className="[&_svg]:size-6" disabled={!props.sessionId} label={v2.atualizar} onClick={props.onRefresh} size={40} tone="ghost" withTitle={false}>
            <RefreshCw aria-hidden="true" className={cn(props.reading && "animate-spin motion-reduce:animate-none")} strokeWidth={1.75} />
          </RoomIconButton>
        </RoomTooltip>
        <span aria-live="polite" className="sr-only" data-console-polling={props.poll.offline ? "offline" : props.reading ? "updating" : "idle"}>
          {POLL_NOTICE[props.poll.notice]}
        </span>
        {actions.map(actionButton)}
        <RoomThemeButton className="shrink-0" onToggle={props.onToggleTheme} theme={props.theme} />
      </div>
    </header>
  );
}
