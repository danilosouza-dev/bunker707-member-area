"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { POPUP_RULES } from "@/server/communications/campaign-model";
import type { PopupItem } from "@/server/communications/notification-model";
import type { PopupOutcome } from "./member-popup-dialog";
import { holdSummaryForPopup, postPopupEvent, refreshNotificationsSummary } from "./notifications-client";
import { SUMMARY_TTL_MS } from "./notifications-model";

// Quando mostrar o pop-up da home (docs/22 §1.3): fica em toda pagina do aluno (AppShell), mas so age na
// home. Pede o resumo com o pop-up 1,5 s depois de a home aparecer; esse pedido tambem traz o numero do
// sino (o topo nao pede o seu na home, docs/22 §4.3). Mostra 3 s depois de abrir, com a aba visivel e
// nada aberto por cima, e registra o que o aluno fez. A janela (MemberPopupDialog, com o Dialog, o
// cartao e o player) so e baixada quando o servidor manda um pop-up.

const loadPopupDialog = () => import("./member-popup-dialog");

const MemberPopupDialog = dynamic(() => loadPopupDialog().then((module) => module.MemberPopupDialog), { ssr: false });

/** O resumo com pop-up e buscado depois que a home assenta (nao disputa com a pagina). */
const POPUP_FETCH_DELAY_MS = 1_500;
/** Enquanto algo esta aberto por cima (ou a aba escondida), confere de novo a cada segundo. */
const POPUP_RETRY_MS = 1_000;

// Sem limite entre pop-ups (decisao do produtor, docs/24 §10): um por visita a home, um de cada vez, e na
// proxima visita o servidor escolhe de novo pela regra de cada pop-up. Memoria da pagina (sobrevive a troca
// de pagina, nao ao recarregar): sem pop-up na ultima conferencia, a volta para a home dentro de 1 minuto nao
// pergunta de novo.
let lastEmptyCheckAt: number | null = null;

/** Ainda vale perguntar pelo pop-up nesta visita a home? */
function shouldAskForPopup(now: number) {
  return !(lastEmptyCheckAt !== null && now - lastEmptyCheckAt < SUMMARY_TTL_MS);
}

/** Campo de texto com foco (o aluno esta digitando): o pop-up nao rouba o foco nem fecha o teclado. */
const TYPING_TARGETS =
  'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Outro dialogo, gaveta, painel ou modal aberto (ou a rolagem travada por um deles)? Tambem conta um
 * controle do topo aberto (menu da conta, busca; eles marcam aria-expanded) e alguem digitando.
 */
function hasBlockingLayer() {
  if (document.body.style.overflow === "hidden" || document.documentElement.style.overflow === "hidden") {
    return true;
  }

  if (document.querySelector('header [aria-expanded="true"]')) {
    return true;
  }

  const active = document.activeElement;

  if (active instanceof HTMLElement && active.matches(TYPING_TARGETS)) {
    return true;
  }

  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')).some(
    (element) => !element.closest("[inert], [hidden], [data-member-popup]") && element.getClientRects().length > 0
  );
}

export function MemberPopupHost({
  enabled,
  onNavigate
}: {
  /** So na home e fora do modo "ver como" do produtor (AppShell decide; o topo nao busca o numero do sino nesse caso). */
  enabled: boolean;
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const [popup, setPopup] = useState<PopupItem | null>(null);
  const [open, setOpen] = useState(false);
  const outcomeRef = useRef<PopupOutcome | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!shouldAskForPopup(Date.now())) {
      // Sem pop-up para pedir: o numero do sino segue a regra de sempre (o topo deixou para ca).
      void refreshNotificationsSummary();
      return;
    }

    let cancelled = false;
    const mountedAt = Date.now();
    const timers = new Set<number>();

    function later(callback: () => void, delay: number) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    }

    function tryShow(item: PopupItem) {
      if (cancelled) {
        return;
      }

      if (document.visibilityState !== "visible" || hasBlockingLayer()) {
        later(() => tryShow(item), POPUP_RETRY_MS);
        return;
      }

      outcomeRef.current = null;
      setPopup(item);
      setOpen(true);
      postPopupEvent(item.id, "impressed");
    }

    holdSummaryForPopup(true);
    later(() => {
      holdSummaryForPopup(false);
      void refreshNotificationsSummary({ popup: true }).then((summary) => {
        if (cancelled || !summary) {
          return;
        }

        if (!summary.popup) {
          lastEmptyCheckAt = Date.now();
          return;
        }

        const item = summary.popup;

        // Baixa a janela agora (bem antes dos 3 s); sem ela (rede caiu, deploy novo), nada aparece e
        // nada e registrado como visto.
        loadPopupDialog().then(
          () => {
            if (!cancelled) {
              later(() => tryShow(item), Math.max(0, mountedAt + POPUP_RULES.delayMs - Date.now()));
            }
          },
          () => undefined
        );
      });
    }, POPUP_FETCH_DELAY_MS);

    return () => {
      cancelled = true;
      holdSummaryForPopup(false);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, [enabled]);

  function finish(outcome: PopupOutcome) {
    if (!popup || outcomeRef.current) {
      return;
    }

    outcomeRef.current = outcome;
    postPopupEvent(popup.id, outcome);
    setOpen(false);
  }

  if (!popup) {
    return null;
  }

  return <MemberPopupDialog onFinish={finish} onNavigate={onNavigate} open={open} popup={popup} />;
}
