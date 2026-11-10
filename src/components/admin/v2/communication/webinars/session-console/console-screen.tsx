"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ConsoleMessage, ConsolePollView, ConsoleScreen as ConsoleScreenData } from "@/server/webinars/console-model";
import type { SavedScreenItem, UploadedScreenImage } from "@/server/webinars/screen-actions";
import { SCREEN_MIGRATION, screenDisplayLabel, screenItemShowState, screenItemSummary, type ScreenDisplay, type ScreenItem, type ScreenItemShowState, type ScreenKind } from "@/server/webinars/screen-model";
import { EMPTY_SCREEN_STATS } from "@/server/webinars/screen-rows";
import { PendingMigrationNotice } from "../../../pending-migration-notice";
import { ConfirmDialog, SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";
import { adminMenuItem, adminMenuPopup } from "../../../styles";
import { ConsoleScreenForm, ScreenPreview, screenItemPreview, type ScreenItemSaveInput, type ScreenPreviewDevice } from "./console-screen-form";
import { useConsolePortal } from "./console-shell";

// A entrada "Na tela" do console (docs/30 §2.4; especificacao de 10/11/2026, R3, R4 e §6.1), a primeira do trilho e do
// ⋯ na Live ao vivo e na gravada (nunca no Replay), com o contador de quantas coisas estao na frente da turma
// (consoleScreenCount: a mensagem fixada, a enquete fixada, o banner e o QR Code). Tres partes:
// - "Na tela agora": a mensagem fixada ("Mensagem fixada · {autor}: {texto}") e a enquete fixada com o Desafixar; o
//   banner e o QR Code com ha quanto tempo estao na tela, os numeros da exibicao ("312 viram · 41 clicaram · 9
//   fecharam", alunos distintos, do retrato de 5 s com uns 15 s de atraso) e o Tirar da tela. Vazio: "Nada na tela dos
//   alunos.";
// - "Prontos": os banners e QR Codes do webinario (servem para todas as sessoes), cada um com o nome, o selo do tipo, o
//   resumo ("Embaixo, à direita · Médio · o aluno pode fechar"), a Previa (abre o desenho abaixo da linha) e o botao
//   principal pelo screenItemShowState: Mostrar, Mostrar no lugar do atual, o selo Na tela com o Tirar da tela, ou
//   Mostrar de novo (editado depois de mostrado); no ⋯, Editar e Excluir (com confirmacao; o servidor recusa enquanto o
//   item esta na tela). Vazio: "Nenhum banner ou QR Code pronto.";
// - "Novo banner" e "Novo QR Code" (e o Editar) abrem o formulario no lugar da lista (console-screen-form.tsx), com o
//   Voltar.
// Sem a 202611100002 (snapshot.screen.pending), o aviso da migracao no lugar dos prontos e nada a gravar. Com a sessao
// que nao aceita a equipe (encerrada; o Replay nem tem a entrada), so leitura. As acoes vem do console
// (session-console.tsx: o banner do erro, o retrato de novo e os avisos); nenhuma frase escrita aqui.

const copy = WEBINAR_COPY.naTela;
const consoleCopy = copy.console;

/** Quantas coisas estao na frente da turma agora (o contador da entrada): a mensagem fixada e o que esta na tela. */
export function consoleScreenCount(input: { active: readonly Pick<ScreenDisplay, "hiddenAt">[]; pinnedMessageId: string | null }): number {
  return (input.pinnedMessageId ? 1 : 0) + input.active.filter((display) => display.hiddenAt === null).length;
}

/** Minutos inteiros desde `at` (nulo sem a hora). */
function minutesSince(at: string | null, nowMs: number): number | null {
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(time) && Number.isFinite(nowMs) ? Math.max(0, Math.floor((nowMs - time) / 60_000)) : null;
}

/** O nome de uma exibicao de banner ou QR Code: o da copia mostrada; sem ela, o do item, senao o do tipo. */
function displayName(display: ScreenDisplay, items: readonly ScreenItem[]): string {
  if (display.snapshot && "name" in display.snapshot) {
    return display.snapshot.name;
  }
  const item = items.find((entry) => entry.id === display.itemId);
  return item?.name ?? (display.kind === "poll" ? "" : copy.tipos[display.kind]);
}

/** O rotulo do botao principal de um item pronto. */
function showLabel(state: ScreenItemShowState): string {
  switch (state) {
    case "again":
      return consoleCopy.mostrarDeNovo;
    case "replace":
      return consoleCopy.mostrarNoLugar;
    case "on":
      return consoleCopy.tirarDaTela;
    default:
      return consoleCopy.mostrar;
  }
}

export type ConsoleScreenProps = {
  busyKey: string | null;
  /** A sessao aceita a equipe (canTeamActOn): sem isso, so leitura. */
  canAct: boolean;
  /** A Previa ao abrir o formulario (o teste de tela). */
  initialDevice?: ScreenPreviewDevice;
  /** O formulario aberto ao montar (o teste de tela; o console sempre comeca na lista). */
  initialForm?: { item: ScreenItem | null; kind: ScreenKind } | null;
  /** A hora do servidor agora (o relogio do console, a cada segundo). */
  nowMs: number;
  onArchive: (itemId: string) => Promise<boolean>;
  onHide: (displayId: string) => void;
  onSave: (input: ScreenItemSaveInput, show: boolean) => Promise<ActionResult<SavedScreenItem> | null>;
  onShow: (itemId: string) => void;
  onUnpinMessage: (messageId: string) => void;
  onUnpinPoll: (pollId: string) => void;
  onUpload: (image: string) => Promise<ActionResult<UploadedScreenImage>>;
  /** A mensagem fixada lida pela chave (snapshot.pinned). */
  pinned: ConsoleMessage | null;
  /** As enquetes desta sessao (a pergunta da fixada quando a copia nao traz). */
  polls: readonly ConsolePollView[];
  screen: ConsoleScreenData;
  webinarId: string;
  webinarSlug: string;
};

export function ConsoleScreen({
  busyKey,
  canAct,
  initialDevice,
  initialForm = null,
  nowMs,
  onArchive,
  onHide,
  onSave,
  onShow,
  onUnpinMessage,
  onUnpinPoll,
  onUpload,
  pinned,
  polls,
  screen,
  webinarId,
  webinarSlug
}: ConsoleScreenProps) {
  const portal = useConsolePortal();
  const [formOpen, setFormOpen] = useState<{ item: ScreenItem | null; kind: ScreenKind } | null>(initialForm);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<ScreenItem | null>(null);
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const active = screen.active.filter((display) => display.hiddenAt === null);
  const pinnedPoll = active.find((display) => display.kind === "poll") ?? null;
  const cards = active.filter((display) => display.kind !== "poll");
  const nothing = !pinned && active.length === 0;
  const busy = busyKey !== null;

  if (formOpen) {
    return (
      <ConsoleScreenForm
        busy={busy}
        canShow={canAct}
        initialDevice={initialDevice}
        item={formOpen.item}
        items={screen.items}
        key={formOpen.item?.id ?? `novo-${formOpen.kind}`}
        kind={formOpen.kind}
        onBack={() => setFormOpen(null)}
        onSave={onSave}
        onUpload={onUpload}
        webinarId={webinarId}
        webinarSlug={webinarSlug}
      />
    );
  }

  const pollQuestion = pinnedPoll ? (pinnedPoll.snapshot && "name" in pinnedPoll.snapshot ? pinnedPoll.snapshot.name : (polls.find((poll) => poll.id === pinnedPoll.pollId)?.question ?? "")) : "";

  return (
    <div className="flex min-w-0 flex-col gap-4" data-console-screen="">
      <SectionCard title={consoleCopy.agora} titleId="console-screen-now-title">
        {nothing ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{consoleCopy.agoraVazio}</p> : null}
        {!nothing ? (
          <ul className="flex min-w-0 flex-col gap-2" data-console-screen-now="">
            {pinned ? (
              <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-console-screen-now-item="message">
                <span className="line-clamp-2 text-sm leading-5 text-[var(--text-primary)] [overflow-wrap:anywhere]">{consoleCopy.mensagemFixada(pinned.displayName, pinned.body)}</span>
                {canAct ? (
                  <Button className="h-8! self-start px-2 text-[13px]" disabled={busy} onClick={() => onUnpinMessage(pinned.id)} type="button" variant="secondary">
                    {consoleCopy.desafixar}
                  </Button>
                ) : null}
              </li>
            ) : null}
            {pinnedPoll && pinnedPoll.pollId ? (
              <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-console-screen-now-item="poll">
                <span className="line-clamp-2 text-sm leading-5 text-[var(--text-primary)]">{consoleCopy.enqueteFixada(pollQuestion)}</span>
                {canAct ? (
                  <Button className="h-8! self-start px-2 text-[13px]" disabled={busy} onClick={() => onUnpinPoll(pinnedPoll.pollId as string)} type="button" variant="secondary">
                    {consoleCopy.desafixar}
                  </Button>
                ) : null}
              </li>
            ) : null}
            {cards.map((display) => {
              const minutes = minutesSince(display.shownAt, nowMs);
              const stats = screen.stats[display.id] ?? EMPTY_SCREEN_STATS;
              return (
                <li className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-console-screen-now-item={display.kind} data-display-id={display.id} key={display.id}>
                  <span className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{screenDisplayLabel(display.kind, displayName(display, screen.items))}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-5 text-[var(--text-tertiary)]">
                    {minutes !== null ? (
                      <time dateTime={display.shownAt} data-console-screen-age="">
                        {copy.haTempo(minutes)}
                      </time>
                    ) : null}
                    {minutes !== null ? <span aria-hidden="true">·</span> : null}
                    <span className="tabular-nums" data-console-screen-stats="">
                      {copy.numeros(stats.shown, stats.clickers, stats.closed)}
                    </span>
                  </span>
                  {canAct ? (
                    <Button className="mt-1 h-8! self-start px-2 text-[13px]" data-console-screen-hide={display.id} disabled={busy} onClick={() => onHide(display.id)} type="button" variant="secondary">
                      {consoleCopy.tirarDaTela}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </SectionCard>

      <SectionCard
        actions={
          canAct && !screen.pending ? (
            <>
              <Button className="h-8! px-2 text-[13px]" data-console-screen-new="banner" disabled={busy} onClick={() => setFormOpen({ item: null, kind: "banner" })} type="button" variant="secondary">
                <Plus aria-hidden="true" className="size-4" />
                {consoleCopy.novoBanner}
              </Button>
              <Button className="h-8! px-2 text-[13px]" data-console-screen-new="qr" disabled={busy} onClick={() => setFormOpen({ item: null, kind: "qr" })} type="button" variant="secondary">
                <Plus aria-hidden="true" className="size-4" />
                {consoleCopy.novoQr}
              </Button>
            </>
          ) : null
        }
        title={consoleCopy.prontos}
        titleId="console-screen-ready-title"
      >
        {screen.pending ? <PendingMigrationNotice migration={SCREEN_MIGRATION} size="compact" /> : null}
        {!screen.pending && screen.items.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{consoleCopy.prontosVazio}</p> : null}
        {screen.items.length > 0 ? (
          <ul className="flex min-w-0 flex-col gap-2" data-console-screen-ready="">
            {screen.items.map((item) => {
              const state = screenItemShowState(item, active);
              const current = active.find((display) => display.kind === item.kind) ?? null;
              const previewOpen = previewId === item.id;
              const previewRegion = `console-screen-preview-${item.id}`;
              const itemBusy = busyKey === `screen:${item.id}` || (current !== null && busyKey === `screen:${current.id}`);
              return (
                <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-console-screen-item={item.id} data-screen-kind={item.kind} data-screen-state={state} key={item.id}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{item.name}</span>
                    <StatusChip tone="neutral">{copy.tipos[item.kind]}</StatusChip>
                    {state === "on" ? <StatusChip tone="success">{consoleCopy.seloNaTela}</StatusChip> : null}
                  </div>
                  <span className="text-xs leading-5 text-[var(--text-tertiary)]">{screenItemSummary(item)}</span>
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <Button
                      aria-controls={previewRegion}
                      aria-expanded={previewOpen}
                      className="h-8! px-2 text-[13px]"
                      data-console-screen-preview={item.id}
                      onClick={() => setPreviewId(previewOpen ? null : item.id)}
                      type="button"
                      variant="ghost"
                    >
                      {consoleCopy.previa}
                    </Button>
                    {canAct ? (
                      <Button
                        className="h-8! px-2 text-[13px]"
                        data-console-screen-show={state}
                        disabled={busy || itemBusy}
                        onClick={() => (state === "on" && current ? onHide(current.id) : onShow(item.id))}
                        type="button"
                        variant={state === "on" ? "secondary" : "default"}
                      >
                        {showLabel(state)}
                      </Button>
                    ) : null}
                    {canAct ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={consoleCopy.maisAcoes(item.name)}
                          data-console-screen-menu={item.id}
                          render={<Button className="h-8! px-2 text-[var(--text-secondary)]" disabled={busy} type="button" variant="ghost" />}
                        >
                          <MoreHorizontal aria-hidden="true" className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className={cn(adminMenuPopup, "w-48 bg-room-menu text-room-fg")} container={portal}>
                          <DropdownMenuItem className={adminMenuItem} onClick={() => setFormOpen({ item, kind: item.kind })}>
                            {consoleCopy.editar}
                          </DropdownMenuItem>
                          <DropdownMenuItem className={cn(adminMenuItem, "text-[var(--error)]")} onClick={() => setArchiving(item)}>
                            {consoleCopy.excluir}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  <div hidden={!previewOpen} id={previewRegion}>
                    {previewOpen ? (
                      <div className="flex min-w-0 flex-col gap-2 pt-1" data-console-screen-preview-open={item.id}>
                        <ScreenPreview device="desktop" item={screenItemPreview(item, origin)} />
                        <ScreenPreview device="mobile" item={screenItemPreview(item, origin)} />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </SectionCard>

      <ConfirmDialog
        busy={archiving !== null && busyKey === `screen:${archiving.id}`}
        cancelLabel={copy.formulario.cancelar}
        confirmLabel={consoleCopy.excluir}
        container={portal}
        description={consoleCopy.excluirTexto}
        destructive
        onConfirm={() => {
          const target = archiving;
          if (target) {
            void onArchive(target.id).then((ok) => {
              if (ok) {
                setArchiving(null);
              }
            });
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setArchiving(null);
          }
        }}
        open={archiving !== null}
        title={archiving ? consoleCopy.excluirConfirmar(archiving.name) : consoleCopy.excluir}
      />
    </div>
  );
}
