"use client";

import { ArrowLeft, ChevronDown, CircleStop, DoorOpen, Lock, LockOpen, Moon, Play, RefreshCw, Sun } from "lucide-react";
import Link from "next/link";
import { ROOM_FOCUS, RoomBadge, RoomButton, RoomIconButton, roomButtonClassName } from "@/components/member/webinars/room/room-ui";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomTheme } from "@/lib/webinar-room-prefs";
import { cn } from "@/lib/utils";
import { consoleSessionOptionLabel, type ConsoleTopAction, type ConsoleTopActionId } from "@/server/webinars/console-v2-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import type { WebinarSession } from "@/server/webinars/model";

// O topo do console V2 (docs/31 V2-13), da esquerda para a direita: a seta de voltar ao editor (36 px, so o icone), o
// titulo em duas linhas ("Console da sessão" e o nome do webinario, o h1 inteiro), o seletor de sessoes (o <select>
// nativo, com o ponto verde fora dele so com a sessao escolhida no ar), o Atualizar (a leitura do retrato, com a regiao
// viva so para o leitor de tela), os selos do momento e dos presentes, um traco, o Tema (36 px, o nome diz para qual
// vai) e os botoes de situacao da sessao (consoleTopActionsFor: Abrir a sala, Começar para todos, Trancar, Encerrar
// live, Abrir e Encerrar sessão da gravada, Ver relatório). Abaixo de lg o topo quebra em duas linhas: a seta e o
// titulo; depois o seletor e os botoes, que rolam de lado sem barra. As cores pelos tokens do tema do console.

const copy = WEBINAR_ADMIN_COPY.console;
const liveCopy = WEBINAR_COPY.consoleAoVivo;
const v2 = WEBINAR_COPY.consoleV2;
const tema = WEBINAR_COPY.salaV2.tema;

export type ConsolePolling = "idle" | "offline" | "updating";

type ConsoleTopBarProps = {
  actions: readonly ConsoleTopAction[];
  busyKey: string | null;
  canWrite: boolean;
  /** O selo do momento ("No ar há 12:30", "Começa em", "Durou"); vazio, nenhum. */
  clockLabel: string;
  className: string;
  /** O motivo dos botoes da sessao desligados (sem messaging.publish). */
  disabledTitle?: string;
  editorHref: string;
  onAction: (id: Exclude<ConsoleTopActionId, "lock" | "report">) => void;
  onChangeSession: (sessionId: string) => void;
  onLock: (locked: boolean) => void;
  onRefresh: () => void;
  onToggleTheme: () => void;
  polling: ConsolePolling;
  /** "7 presentes agora"; nulo sem sessao. */
  presentLabel: string | null;
  reportHref: string;
  roomLocked: boolean;
  sessionId: string | null;
  sessions: readonly Pick<WebinarSession, "id" | "kind" | "scheduledAt" | "status">[];
  theme: RoomTheme;
  /** O nome do webinario (a segunda linha do h1). */
  title: string;
};

const ARROW = cn(
  "grid size-9 shrink-0 place-items-center rounded-[var(--member-button-radius)] text-room-icon transition-colors hover:bg-room-control hover:text-room-fg-strong motion-reduce:transition-none [&_svg]:size-[18px]",
  ROOM_FOCUS
);

export function ConsoleTopBar(props: ConsoleTopBarProps) {
  const { actions, busyKey } = props;
  const selected = props.sessions.find((item) => item.id === props.sessionId) ?? null;
  const onAir = selected?.status === "live";
  const light = props.theme === "light";

  function actionButton(action: ConsoleTopAction) {
    const blocked = busyKey !== null || !action.enabled;
    const title = action.enabled ? undefined : props.disabledTitle;
    switch (action.id) {
      case "open_room":
        return (
          <RoomButton disabled={blocked} key={action.id} onClick={() => props.onAction("open_room")} size="sm" title={title} variant="secondary">
            <DoorOpen aria-hidden="true" />
            {liveCopy.abrirSala}
          </RoomButton>
        );
      case "start":
        return (
          <RoomButton disabled={blocked} key={action.id} onClick={() => props.onAction("start")} size="sm" title={title} variant="primary">
            <Play aria-hidden="true" />
            {liveCopy.comecarParaTodos}
          </RoomButton>
        );
      case "lock":
        return (
          <RoomButton
            aria-pressed={props.roomLocked}
            disabled={!props.canWrite || busyKey === "live:lock"}
            key={action.id}
            onClick={() => props.onLock(!props.roomLocked)}
            size="sm"
            variant="secondary"
          >
            {props.roomLocked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
            {props.roomLocked ? liveCopy.destrancar : liveCopy.trancar}
          </RoomButton>
        );
      case "end_live":
        return (
          <RoomButton disabled={blocked} key={action.id} onClick={() => props.onAction("end_live")} size="sm" title={title} variant="stop">
            <CircleStop aria-hidden="true" />
            {liveCopy.encerrarLive}
          </RoomButton>
        );
      case "open_session":
        return (
          <RoomButton disabled={blocked} key={action.id} onClick={() => props.onAction("open_session")} size="sm" variant="primary">
            <Play aria-hidden="true" />
            {copy.open}
          </RoomButton>
        );
      case "end_session":
        return (
          <RoomButton disabled={blocked} key={action.id} onClick={() => props.onAction("end_session")} size="sm" variant="stop">
            <CircleStop aria-hidden="true" />
            {copy.end}
          </RoomButton>
        );
      case "report":
        return (
          <Link className={roomButtonClassName({ size: "sm", variant: "secondary" })} href={props.reportHref} key={action.id}>
            {copy.report}
          </Link>
        );
      default:
        return null;
    }
  }

  return (
    <header className={props.className} data-console-slot="top">
      <div className="flex min-w-0 items-center gap-3 lg:min-w-40 lg:flex-1">
        <Link aria-label={copy.backToEditor} className={ARROW} href={props.editorHref} title={copy.backToEditor}>
          <ArrowLeft aria-hidden="true" strokeWidth={2} />
        </Link>
        <h1 className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-[11px] leading-4 font-medium text-room-fg-muted">{copy.title}</span>{" "}
          <span className="truncate text-[15px] leading-5 font-bold text-room-fg-strong">{props.title}</span>
        </h1>
      </div>

      <div className="-mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] lg:flex-initial [&::-webkit-scrollbar]:hidden">
        <div className="relative shrink-0">
          <label className="sr-only" htmlFor="console-session">
            {v2.rotuloSessao}
          </label>
          {onAir ? <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-[7px] -translate-y-1/2 rounded-full bg-room-speaking" data-console-on-air="" /> : null}
          <select
            className={cn(
              "h-9 max-w-80 appearance-none truncate rounded-[var(--member-button-radius)] border border-room-border-strong bg-room-surface pr-8 text-[13px] font-medium text-room-fg-strong disabled:opacity-45",
              onAir ? "pl-7" : "pl-3",
              ROOM_FOCUS
            )}
            disabled={props.sessions.length === 0}
            id="console-session"
            onChange={(event) => props.onChangeSession(event.target.value)}
            value={props.sessionId ?? ""}
          >
            {props.sessions.length === 0 ? <option value="">—</option> : null}
            {props.sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {consoleSessionOptionLabel(item)}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-room-icon" />
        </div>
        <RoomIconButton disabled={!props.sessionId || props.polling === "updating"} label={v2.atualizar} onClick={props.onRefresh} size={36} square>
          <RefreshCw aria-hidden="true" className={cn(props.polling === "updating" && "animate-spin motion-reduce:animate-none")} />
        </RoomIconButton>
        <span aria-live="polite" className="sr-only" data-console-polling={props.polling}>
          {props.polling === "updating" ? v2.atualizando : props.polling === "offline" ? v2.semResposta : ""}
        </span>
        {props.clockLabel || props.presentLabel ? (
          <span className="flex shrink-0 items-center gap-2" data-console-status="">
            {props.clockLabel ? (
              <RoomBadge size="md">
                <span className="tabular-nums" data-console-clock="">
                  {props.clockLabel}
                </span>
              </RoomBadge>
            ) : null}
            {props.presentLabel ? (
              <RoomBadge size="md">
                <span className="tabular-nums" data-console-present="">
                  {props.presentLabel}
                </span>
              </RoomBadge>
            ) : null}
          </span>
        ) : null}
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-room-border-strong" />
        <RoomIconButton label={light ? tema.escuro : tema.claro} onClick={props.onToggleTheme} size={36} square>
          {light ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        </RoomIconButton>
        {actions.map(actionButton)}
      </div>
    </header>
  );
}
