"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { LIVE_CONSOLE_COPY, MUTE_CHOICES, banLabels, barredPeople, muteLabel, roomRows, type LiveConsolePerson, type LiveControls } from "@/server/webinars/live-console-model";
import type { MuteMinutes } from "@/server/webinars/live-model";
import type { BanKind } from "@/server/webinars/live-schemas";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";
import { adminMenuItem, adminMenuPopup, adminMenuSeparator } from "../../../styles";
import type { LiveRoomHandle } from "./live-room-panel";

// O painel Participantes (docs/30 §1.4 e §2.4): quem esta na sala agora (pelos sinais do iframe do console), com o
// aluno do retrato quando o id do participante bate (o ultimo webinar_room_joined), e o ⋯ de cada um: Destacar / Tirar
// destaque, Convidar ao palco / Tirar do palco, Fechar camera (Apresentador e co-apresentador), Silenciar no chat
// 5/15/60/ate o fim, Remover da sala (com o kickParticipant depois da acao) e Banir (so quem publica; confirmacao). A
// equipe nunca recebe os itens de remover, silenciar ou banir. Embaixo, quem foi removido, silenciado ou banido nesta
// sessao, com Desfazer. LivePersonMenu tambem serve o ⋯ das mensagens do chat.

const copy = WEBINAR_COPY.consoleAoVivo;

export type PersonAction =
  | { minutes: MuteMinutes | null; type: "mute" }
  | { type: "ban" | "closeCamera" | "kick" | "unban" }
  | { kind: BanKind; type: "undo" }
  | { on: boolean; type: "spotlight" | "stage" };

type LivePersonMenuProps = {
  busy: boolean;
  canPublish: boolean;
  controls: LiveControls;
  joined: boolean;
  name: string;
  onAction: (action: PersonAction) => void;
  onStage?: boolean;
  /** O participante na sala (nulo: nao esta no iframe; so as acoes do servidor valem). */
  participantId: string | null;
  person: LiveConsolePerson | null;
  spotlight?: boolean;
};

/** O ⋯ de uma pessoa (na sala ou no chat); nada quando nao ha acao para este papel. */
export function LivePersonMenu({ busy, canPublish, controls, joined, name, onAction, onStage = false, participantId, person, spotlight = false }: LivePersonMenuProps) {
  const inRoom = participantId !== null;
  const student = person !== null && !person.staff;
  const roomItems = inRoom && controls.stage;
  const cameraItem = inRoom && controls.cameras;
  const chatItems = student && controls.chatMute;
  const kickItem = student && controls.kick;
  const banItem = student && controls.ban;

  if (!roomItems && !cameraItem && !chatItems && !kickItem && !banItem) {
    return null;
  }

  const ban = person?.ban;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={LIVE_CONSOLE_COPY.acoes(name)}
        disabled={busy}
        render={<Button className="h-8! px-2 text-[var(--text-secondary)]" type="button" variant="ghost" />}
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(adminMenuPopup, "w-60")}>
        {roomItems ? (
          <>
            <DropdownMenuItem className={adminMenuItem} disabled={!joined} onClick={() => onAction({ on: !spotlight, type: "spotlight" })}>
              {spotlight ? copy.tirarDestaque : copy.destacar}
            </DropdownMenuItem>
            <DropdownMenuItem className={adminMenuItem} disabled={!joined} onClick={() => onAction({ on: !onStage, type: "stage" })}>
              {onStage ? copy.tirarPalco : copy.convidarPalco}
            </DropdownMenuItem>
          </>
        ) : null}
        {cameraItem ? (
          <DropdownMenuItem className={adminMenuItem} disabled={!joined} onClick={() => onAction({ type: "closeCamera" })}>
            {copy.fecharCamera}
          </DropdownMenuItem>
        ) : null}
        {(roomItems || cameraItem) && (chatItems || kickItem || banItem) ? <DropdownMenuSeparator className={adminMenuSeparator} /> : null}
        {chatItems
          ? ban?.muted
            ? (
                <DropdownMenuItem className={adminMenuItem} onClick={() => onAction({ kind: "muted", type: "undo" })}>
                  {`${LIVE_CONSOLE_COPY.desfazer}: ${muteLabel(ban)}`}
                </DropdownMenuItem>
              )
            : MUTE_CHOICES.map((choice) => (
                <DropdownMenuItem className={adminMenuItem} key={choice.label} onClick={() => onAction({ minutes: choice.minutes, type: "mute" })}>
                  {choice.label}
                </DropdownMenuItem>
              ))
          : null}
        {kickItem ? (
          ban?.kicked ? (
            <DropdownMenuItem className={adminMenuItem} onClick={() => onAction({ kind: "kicked", type: "undo" })}>
              {`${LIVE_CONSOLE_COPY.desfazer}: ${copy.removido}`}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className={adminMenuItem} onClick={() => onAction({ type: "kick" })}>
              {copy.removerDaSala}
            </DropdownMenuItem>
          )
        ) : null}
        {banItem ? (
          ban?.banned ? (
            <DropdownMenuItem className={adminMenuItem} disabled={!canPublish} onClick={() => onAction({ type: "unban" })}>
              {copy.desfazerBanimento}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className={cn(adminMenuItem, "text-[var(--error)]")} disabled={!canPublish} onClick={() => onAction({ type: "ban" })}>
              {copy.banir}
            </DropdownMenuItem>
          )
        ) : null}
        {banItem && !canPublish ? <p className="px-2.5 py-1 text-xs leading-4 text-[var(--text-tertiary)]">{LIVE_CONSOLE_COPY.soQuemPublica}</p> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type LiveParticipantsProps = {
  busyKey: string | null;
  canPublish: boolean;
  handle: LiveRoomHandle;
  onAction: (person: LiveConsolePerson | null, participantId: string | null, action: PersonAction) => void;
  people: readonly LiveConsolePerson[];
};

export function LiveParticipants({ busyKey, canPublish, handle, onAction, people }: LiveParticipantsProps) {
  const rows = roomRows(handle.room, people);
  const barred = barredPeople(people);

  return (
    <SectionCard meta={rows.length > 0 ? String(rows.length) : undefined} title={copy.participantes} titleId="console-live-participants-title">
      <div className="flex min-w-0 flex-col gap-4" data-live-participants="">
        {rows.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.semParticipantes}</p> : null}
        {rows.length > 0 ? (
          <ul className="flex max-h-[50vh] min-w-0 flex-col gap-1 overflow-y-auto">
            {rows.map((row) => (
              <li className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5" data-live-participant={row.id} data-live-user={row.person?.userId ?? undefined} key={row.id}>
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm leading-5 text-[var(--text-primary)]">{row.name}</span>
                  {row.staff ? <StatusChip tone="neutral">{LIVE_CONSOLE_COPY.equipe}</StatusChip> : null}
                  {row.onStage ? <StatusChip tone="success">{LIVE_CONSOLE_COPY.noPalco}</StatusChip> : null}
                  {row.spotlight ? <StatusChip tone="success">{copy.destacar}</StatusChip> : null}
                  {row.person
                    ? banLabels(row.person.ban).map((label) => (
                        <StatusChip key={label} tone="warning">
                          {label}
                        </StatusChip>
                      ))
                    : null}
                </span>
                <LivePersonMenu
                  busy={busyKey !== null && busyKey === `person:${row.person?.userId ?? row.id}`}
                  canPublish={canPublish}
                  controls={handle.controls}
                  joined={handle.joined}
                  name={row.name}
                  onAction={(action) => onAction(row.staff ? null : row.person, row.id, action)}
                  onStage={row.onStage}
                  participantId={row.id}
                  person={row.staff ? null : row.person}
                  spotlight={row.spotlight}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {barred.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-2" data-live-barred="">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{LIVE_CONSOLE_COPY.removidosESilenciados}</span>
            <ul className="flex min-w-0 flex-col gap-2">
              {barred.map((person) => (
                <li className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-live-barred-user={person.userId} key={person.userId}>
                  <span className="truncate text-sm leading-5 text-[var(--text-primary)]">{person.displayName}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    {person.ban.muted ? (
                      <Button
                        aria-label={`${LIVE_CONSOLE_COPY.desfazer}: ${muteLabel(person.ban)} (${person.displayName})`}
                        className="h-8! px-2 text-[13px]"
                        disabled={busyKey !== null}
                        onClick={() => onAction(person, person.participantId, { kind: "muted", type: "undo" })}
                        type="button"
                        variant="secondary"
                      >
                        {`${LIVE_CONSOLE_COPY.desfazer}: ${muteLabel(person.ban)}`}
                      </Button>
                    ) : null}
                    {person.ban.kicked ? (
                      <Button
                        aria-label={`${LIVE_CONSOLE_COPY.desfazer}: ${copy.removido} (${person.displayName})`}
                        className="h-8! px-2 text-[13px]"
                        disabled={busyKey !== null}
                        onClick={() => onAction(person, person.participantId, { kind: "kicked", type: "undo" })}
                        type="button"
                        variant="secondary"
                      >
                        {`${LIVE_CONSOLE_COPY.desfazer}: ${copy.removido}`}
                      </Button>
                    ) : null}
                    {person.ban.banned ? (
                      <Button
                        aria-label={`${copy.desfazerBanimento} (${person.displayName})`}
                        className="h-8! px-2 text-[13px]"
                        disabled={busyKey !== null || !canPublish}
                        onClick={() => onAction(person, person.participantId, { type: "unban" })}
                        title={canPublish ? undefined : LIVE_CONSOLE_COPY.soQuemPublica}
                        type="button"
                        variant="secondary"
                      >
                        {copy.desfazerBanimento}
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
