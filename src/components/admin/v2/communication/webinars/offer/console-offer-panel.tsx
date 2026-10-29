"use client";

import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { saoPauloTime } from "@/lib/webinar-time";
import { offerMinute } from "@/server/webinars/offer-room-model";
import type { ConsoleOfferView } from "@/server/webinars/offer-queries";
import { ErrorBanner } from "../../../error-banner";
import { PendingMigrationNotice } from "../../../pending-migration-notice";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// O desenho do painel Oferta do console (docs/30 §2.4), sem dados vivos (console-offer.tsx le e age): na tela agora
// ou fora, a janela desta sessao em minutos do video (aparece, some, escondida), o prazo real, Mostrar agora /
// Esconder so na sessao gravada que nao terminou e os cliques por variante (cliques e alunos) com o total.

const COPY = WEBINAR_COPY.oferta.console;

export type ConsoleOfferPanelProps = {
  actionError: string | null;
  busy: "hide" | "show" | null;
  canAct: boolean;
  loadError: string | null;
  /** Banco sem a 202610290005: o numero da migracao (o aviso no lugar do painel). */
  migration: string | null;
  onHide: () => void;
  onRetry: () => void;
  onShow: () => void;
  view: ConsoleOfferView | null;
};

/** As frases da janela desta sessao (o que aparece embaixo do selo). */
export function consoleOfferLines(view: ConsoleOfferView): string[] {
  const offer = view.offer;
  if (!offer) {
    return [];
  }
  const lines: string[] = [];
  if (offer.status !== "active") {
    lines.push(COPY.rascunho);
  } else if (offer.triggerKind === "never") {
    lines.push(COPY.nunca);
  }
  const window = view.window;
  if (window) {
    if (window.source === "display" && window.hidden && window.hideAtMs !== null) {
      lines.push(COPY.mostradaNoMinuto(offerMinute(window.showAtMs)), COPY.escondidaNoMinuto(offerMinute(window.hideAtMs)));
    } else {
      lines.push(window.source === "display" ? COPY.mostradaNoMinuto(offerMinute(window.showAtMs)) : COPY.apareceNoMinuto(offerMinute(window.showAtMs)));
      if (window.hideAtMs !== null) {
        lines.push(COPY.someNoMinuto(offerMinute(window.hideAtMs)));
      }
    }
    if (window.deadlineAt) {
      lines.push(COPY.prazoAte(saoPauloTime(window.deadlineAt)));
    }
  } else if (offer.triggerKind === "manual") {
    lines.push(COPY.apareceNoBotao);
  }
  if (view.sessionKind === "replay") {
    lines.push(COPY.replay);
  } else if (!view.canShow && offer.status === "active" && offer.triggerKind !== "never") {
    lines.push(COPY.soNaGravada);
  }
  return lines;
}

export function ConsoleOfferPanel({ actionError, busy, canAct, loadError, migration, onHide, onRetry, onShow, view }: ConsoleOfferPanelProps) {
  const offer = view?.offer ?? null;
  const chip =
    view && offer && view.sessionKind !== "replay" ? <StatusChip tone={view.onScreen ? "success" : "muted"}>{view.onScreen ? COPY.naTela : COPY.foraDaTela}</StatusChip> : null;

  return (
    <SectionCard actions={chip} title={COPY.titulo} titleId="console-offer-title">
      <div className="flex min-w-0 flex-col gap-3" data-console-offer="">
        {migration ? <PendingMigrationNotice migration={migration} size="compact" /> : null}
        {!migration && loadError && !view ? (
          <ErrorBanner
            action={
              <Button className="px-3" onClick={onRetry} type="button" variant="secondary">
                {WEBINAR_COPY.oferta.card.tentarDeNovo}
              </Button>
            }
          >
            {loadError}
          </ErrorBanner>
        ) : null}
        {!migration && !loadError && !view ? (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
            {WEBINAR_COPY.oferta.card.carregando}
          </p>
        ) : null}
        {view && !offer ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.semOferta}</p> : null}

        {view && offer ? (
          <>
            <ul className="flex min-w-0 flex-col gap-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">
              {consoleOfferLines(view).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {canAct && view.canShow ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button className="h-9 px-3" data-console-offer-show="" disabled={busy !== null || view.onScreen} onClick={onShow} type="button">
                  {COPY.mostrarAgora}
                </Button>
                <Button className="h-9 px-3" data-console-offer-hide="" disabled={busy !== null || !view.onScreen} onClick={onHide} type="button" variant="secondary">
                  {COPY.esconder}
                </Button>
              </div>
            ) : null}
            {actionError ? <ErrorBanner>{actionError}</ErrorBanner> : null}

            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{COPY.cliquesPorVariante}</span>
              <ul className="flex min-w-0 flex-col gap-1" data-console-offer-clicks="">
                {view.clicks.byVariant.map((row) => {
                  const variant = offer.variants.find((item) => item.label === row.label);
                  return (
                    <li className="flex min-w-0 items-center justify-between gap-2 text-[13px] leading-5" data-offer-clicks={row.label} key={row.label}>
                      <span className="min-w-0 truncate text-[var(--text-primary)]">
                        <span className="font-semibold">{row.label}</span>
                        {variant ? <span className="text-[var(--text-secondary)]"> · {variant.headline}</span> : null}
                      </span>
                      <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">
                        {COPY.cliques(row.clicks)} · {COPY.alunos(row.students)}
                      </span>
                    </li>
                  );
                })}
                <li className="flex min-w-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-1 text-[13px] leading-5" data-offer-clicks="total">
                  <span className="font-semibold text-[var(--text-primary)]">{COPY.total}</span>
                  <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">
                    {COPY.cliques(view.clicks.clicks)} · {COPY.alunos(view.clicks.students)}
                  </span>
                </li>
              </ul>
            </div>
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}
