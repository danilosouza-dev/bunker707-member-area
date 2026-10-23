"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  LESSON_MEDIA_EVENT,
  lessonMediaSnapshot,
  readLessonMediaSignal,
  resetLessonMedia,
  waitLessonMediaStop,
  watchLessonPlayerFocus
} from "@/lib/lesson-media-signal";
import type { PopupItem, PopupShowAnswer } from "@/server/communications/notification-model";
import type { PopupCloseVia } from "@/server/communications/popup-display-model";
import type { PopupOutcome } from "./member-popup-dialog";
import {
  ensurePopupPlan,
  holdSummaryForPopup,
  NotificationsRequestError,
  popupPlanFromMemory,
  postPopupEvent,
  postPopupShow,
  refreshNotificationsSummary,
  updatePopupAfterOutcome,
  updatePopupInPlan,
  type PopupPlan
} from "./notifications-client";
import {
  blockAction,
  blockReason,
  completionOpenings,
  givenUp,
  hasBlockingLayer,
  needsFreeCard,
  openingsForPageView,
  POPUP_HOST_RULES,
  shouldSendPageClose,
  type ArmedPopup,
  type BlockAction,
  type BlockEnv
} from "./popup-host-model";

// Quando abrir os pop-ups (docs/25 §4.9): fica em toda pagina do aluno que tem chave (AppShell; nunca no
// "ver como"), e cada montagem e uma visualizacao de pagina (a troca de aula pela playlist nao e). O plano
// do aluno vem do resumo (notifications-client.ts): fora da home, entra no pedido que o topo ja fez; na
// home, pede 1,5 s depois de abrir (esse pedido traz o numero do sino), a nao ser que a memoria de 1 minuto
// ja saiba. Sem pop-up no ar para a pagina, nenhum pedido. O que o plano arma (popup-host-model.ts) entra
// numa fila que abre um de cada vez: espera a aba visivel, a tela cheia acabar, o nosso player da aula
// parar e nada aberto por cima; baixa a janela e so entao pede o POST /show, que confere tudo no servidor,
// conta a abertura e devolve o conteudo. Registra o que o aluno fez (e como fechou) e acerta o plano.
// Nada roda em intervalo alem da conferencia de 1 s enquanto algo bloqueia; nenhum pedido em laco.
//
// Design Livre (docs/27): quando o plano marca o pop-up com `design: "free"`, o pedaco do cartao Livre
// (popup-free-load.ts, pela janela) e baixado junto com a janela, antes do POST /show (sem o codigo, nada abre
// e nada conta como visto). Se o show trouxer um Livre que o plano nao marcou (plano de ate 1 minuto antes da
// troca), o pedaco e esperado antes de abrir. Padrão e Personalizado nunca baixam esse pedaco.

const loadPopupDialog = () => import("./member-popup-dialog");
/** O cartao Livre vem pela janela (o pedaco dele so traz o que a janela ainda nao tem). */
const loadPopupFreeCard = () => loadPopupDialog().then((module) => module.loadPopupFreeCard());

const MemberPopupDialog = dynamic(() => loadPopupDialog().then((module) => module.MemberPopupDialog), { ssr: false });

/** Comeca a baixar a janela (e o cartao Livre, se armado) quando algo foi armado, sem disputar com a pagina. */
function preloadPopupDialog(free: boolean) {
  const run = () => {
    void loadPopupDialog().catch(() => undefined);

    if (free) {
      void loadPopupFreeCard().catch(() => undefined);
    }
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 2_000 });
  } else {
    window.setTimeout(run, 200);
  }
}

function isFullscreen() {
  return Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement);
}

type Showing = { armed: ArmedPopup; popup: PopupItem };

export function MemberPopupHost({
  onNavigate,
  pageKey
}: {
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** Chave da pagina (popupPageKeyOf); null = nenhum pop-up aqui (sem chave ou "ver como"): nada e pedido. */
  pageKey: string | null;
}) {
  const [showing, setShowing] = useState<Showing | null>(null);
  const [open, setOpen] = useState(false);
  /** O que o aluno fez no pop-up aberto (marcado antes de tudo: um segundo fechamento nao conta de novo). */
  const outcomeRef = useRef<PopupOutcome | null>(null);
  /** O pop-up aberto agora, fora do React (o fim da pagina e o pagehide leem na hora). */
  const openRef = useRef<Showing | null>(null);
  /** A fila desta visualizacao de pagina: o pop-up aberto fechou (o proximo em 1 s). */
  const closedRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!pageKey) {
      return;
    }

    const key = pageKey;
    const contentId = key.startsWith("lesson:") ? key.slice("lesson:".length) : null;
    const pageViewStart = Date.now();
    // Fim desta visualizacao de pagina: o POST /show em andamento e abortado.
    const pageView = new AbortController();
    const timers = new Set<number>();
    /** Cada abertura (o id em "ao abrir a página", o id e a aula em "ao concluir") so uma vez aqui. */
    const armedKeys = new Set<string>();
    const queue: ArmedPopup[] = [];
    let cancelled = false;
    /** Um item da fila esta sendo conferido, pedido ou aberto (um de cada vez). */
    let busy = false;
    let held = false;
    let stopWaiting: (() => void) | null = null;

    resetLessonMedia();
    const stopFocusWatch = contentId ? watchLessonPlayerFocus() : null;

    function later(callback: () => void, delay: number) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, Math.max(0, delay));
      timers.add(timer);
    }

    function env(): BlockEnv {
      const media = contentId ? lessonMediaSnapshot() : null;

      return {
        fullscreen: isFullscreen() || Boolean(media?.fullscreen),
        hidden: document.visibilityState !== "visible",
        layer: hasBlockingLayer(document),
        lesson: media ? { activeLessonId: media.activeLessonId, playing: media.playing, touched: media.touched } : null,
        // O anterior ainda saindo (animacao) tambem conta: nunca dois na tela.
        popupOpen: openRef.current !== null || document.querySelector("[data-member-popup]") !== null
      };
    }

    function arm(openings: ArmedPopup[]) {
      let armedAny = false;
      let armedFree = false;

      for (const armed of openings) {
        if (armedKeys.has(armed.key)) {
          continue;
        }

        armedKeys.add(armed.key);
        armedAny = true;
        armedFree ||= needsFreeCard(armed);
        later(() => {
          queue.push(armed);
          pump();
        }, armed.at - Date.now());
      }

      if (armedAny) {
        preloadPopupDialog(armedFree);
      }
    }

    function pump() {
      if (cancelled || busy) {
        return;
      }

      const armed = queue.shift();

      if (!armed) {
        return;
      }

      busy = true;
      attempt(armed);
    }

    /** Terminou com este item: o proximo da fila (depois de um pop-up que fechou, 1 s depois). */
    function next(delay = 0) {
      if (delay > 0) {
        later(() => {
          busy = false;
          pump();
        }, delay);
        return;
      }

      busy = false;
      pump();
    }

    function wait(action: Exclude<BlockAction, "drop">, retry: () => void) {
      const resume = () => {
        stopWaiting?.();
        stopWaiting = null;

        if (!cancelled) {
          retry();
        }
      };

      if (action === "wait_visible") {
        const handleVisibility = () => {
          if (document.visibilityState === "visible") {
            resume();
          }
        };

        document.addEventListener("visibilitychange", handleVisibility);
        stopWaiting = () => document.removeEventListener("visibilitychange", handleVisibility);
        return;
      }

      if (action === "wait_fullscreen") {
        // webkitendfullscreen: o video da aula saindo da tela cheia propria do iPhone (nao sobe: captura).
        const names = ["fullscreenchange", "webkitfullscreenchange", "webkitendfullscreen"];

        names.forEach((name) => document.addEventListener(name, resume, true));
        stopWaiting = () => names.forEach((name) => document.removeEventListener(name, resume, true));
        return;
      }

      if (action === "wait_paused") {
        stopWaiting = waitLessonMediaStop(resume);
        return;
      }

      // Outro pop-up saindo, algo aberto por cima ou alguem digitando: confere de novo em 1 s.
      const timer = window.setTimeout(resume, POPUP_HOST_RULES.blockedRecheckMs);
      stopWaiting = () => window.clearTimeout(timer);
    }

    /** Antes do POST /show: desiste, descarta ou espera; senao, pede. */
    function attempt(armed: ArmedPopup) {
      if (cancelled) {
        return;
      }

      // 10 min depois da hora dele, desiste (nada registrado): a conferencia de 1 s nunca fica para sempre.
      if (givenUp(armed, Date.now())) {
        next();
        return;
      }

      const reason = blockReason(env(), armed, "before_show");

      if (reason) {
        const action = blockAction(reason);

        if (action === "drop") {
          next();
        } else {
          wait(action, () => attempt(armed));
        }

        return;
      }

      void show(armed);
    }

    async function show(armed: ArmedPopup) {
      // O cartao Livre (se o plano marcou) baixa junto com a janela.
      const freeCard = needsFreeCard(armed) ? loadPopupFreeCard() : null;

      freeCard?.catch(() => undefined);

      try {
        // A janela (e o cartao Livre) antes do show: sem o codigo (rede caiu, deploy novo), nada abre e nada conta
        // como visto.
        await loadPopupDialog();
        await freeCard;
      } catch {
        next();
        return;
      }

      if (cancelled) {
        return;
      }

      // O download pode ter demorado: confere de novo antes de contar (agora a janela ja esta na memoria).
      if (blockReason(env(), armed, "before_show") !== null) {
        attempt(armed);
        return;
      }

      let answer: PopupShowAnswer;

      try {
        answer = await postPopupShow(armed.id, { page: key, trigger: armed.trigger }, pageView.signal);
      } catch (error) {
        // 409: o servidor disse quando ele pode voltar. 404, 429, rede ou tempo esgotado: sai do plano (o
        // proximo plano traz de volta se for a vez dele). Nada aparece.
        const refused = error instanceof NotificationsRequestError && error.status === 409;

        updatePopupInPlan(armed.id, refused && error.nextAt ? { notBefore: error.nextAt } : null);

        if (!cancelled) {
          next();
        }

        return;
      }

      updatePopupInPlan(armed.id, answer.next);

      // Livre que o plano nao marcou: espera o pedaco do cartao (ja contou; sem o codigo, nada aparece).
      if (answer.popup.freeDesign && !needsFreeCard(armed)) {
        try {
          await loadPopupFreeCard();
        } catch {
          if (!cancelled) {
            next();
          }

          return;
        }
      }

      // Saiu da pagina com o show no ar: contou e nao aparece (a unica perda aceita).
      if (!cancelled) {
        present(armed, answer.popup);
      }
    }

    /** Depois do POST /show (ja contado): nada descarta, so espera; a pagina acabar antes perde a abertura. */
    function present(armed: ArmedPopup, popup: PopupItem) {
      if (cancelled) {
        return;
      }

      const reason = blockReason(env(), armed, "after_show");

      if (reason) {
        const action = blockAction(reason);

        wait(action === "drop" ? "recheck" : action, () => present(armed, popup));
        return;
      }

      outcomeRef.current = null;
      openRef.current = { armed, popup };
      setShowing({ armed, popup });
      setOpen(true);
    }

    /** Saiu da pagina (ou recarregou) com o pop-up aberto e sem resposta: fechado pela pagina. */
    function sendPageClose(persisted: boolean) {
      const current = openRef.current;

      if (!current || !shouldSendPageClose({ outcome: outcomeRef.current, persisted })) {
        return;
      }

      outcomeRef.current = "closed";
      postPopupEvent(current.popup.id, "closed", { via: "page" });
    }

    function handlePageHide(event: PageTransitionEvent) {
      if (event.persisted) {
        return;
      }

      sendPageClose(false);
      // A pagina esta saindo: nada mais da fila sai daqui.
      cancelled = true;
      pageView.abort();
    }

    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted || !openRef.current) {
        return;
      }

      // Voltou do cache do navegador com o pop-up aberto: fecha sem registrar nada.
      outcomeRef.current = outcomeRef.current ?? "closed";
      openRef.current = null;
      setOpen(false);
      next(POPUP_HOST_RULES.betweenPopupsMs);
    }

    function handleLessonMedia(event: Event) {
      const signal = readLessonMediaSignal(event);

      if (cancelled || !contentId || signal?.kind !== "completed" || signal.contentId !== contentId) {
        return;
      }

      // O momento da conclusao: a hora e se o nosso player tocava (Concluir no meio do video).
      const completedAt = Date.now();
      const playing = lessonMediaSnapshot().playing;

      // O plano pode ter mudado desde que a aula abriu: pede so se a memoria passou de 1 minuto.
      void ensurePopupPlan(key).then((plan) => {
        if (!cancelled && plan) {
          arm(
            completionOpenings({
              contentId,
              items: plan.items,
              lessonId: signal.lessonId,
              now: completedAt,
              offsetMs: plan.offsetMs,
              playing
            })
          );
        }
      });
    }

    async function start() {
      let plan: PopupPlan | null;
      const kept = key === "home" ? popupPlanFromMemory("home") : null;

      if (key !== "home") {
        // Entra no pedido que o topo acabou de fazer (ou usa a memoria; pagina nao coberta = nenhum pedido).
        plan = await ensurePopupPlan(key);
      } else if (kept && (!kept.covered || kept.plan)) {
        // Home com a memoria de 1 minuto: arma na hora, sem pedido e sem segurar o topo.
        plan = kept.covered && kept.plan ? { items: kept.plan, offsetMs: kept.offsetMs } : null;
      } else {
        // Home: o pedido sai 1,5 s depois de abrir (nao disputa com a pagina) e traz o numero do sino.
        held = true;
        holdSummaryForPopup(true);
        await new Promise<void>((resolve) => later(resolve, POPUP_HOST_RULES.homeFetchDelayMs));

        if (cancelled) {
          return;
        }

        held = false;
        holdSummaryForPopup(false);
        void refreshNotificationsSummary({ page: "home" });
        plan = await ensurePopupPlan("home");
      }

      if (!cancelled && plan) {
        arm(openingsForPageView({ items: plan.items, offsetMs: plan.offsetMs, pageKey: key, pageViewStart }));
      }
    }

    closedRef.current = () => next(POPUP_HOST_RULES.betweenPopupsMs);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    if (contentId) {
      window.addEventListener(LESSON_MEDIA_EVENT, handleLessonMedia);
    }

    void start();

    return () => {
      cancelled = true;
      sendPageClose(false);

      if (openRef.current) {
        openRef.current = null;
        setOpen(false);
      }

      pageView.abort();

      if (held) {
        holdSummaryForPopup(false);
      }

      stopWaiting?.();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      stopFocusWatch?.();
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener(LESSON_MEDIA_EVENT, handleLessonMedia);
      closedRef.current = null;
    };
  }, [pageKey]);

  function finish(outcome: PopupOutcome, via?: PopupCloseVia) {
    const current = openRef.current;

    if (!current || outcomeRef.current) {
      return;
    }

    // Primeiro a marca (sincrona): o Esc e o fechamento do Base UI no mesmo toque nao contam duas vezes.
    outcomeRef.current = outcome;
    postPopupEvent(current.popup.id, outcome, outcome === "closed" && via ? { via } : {});
    updatePopupAfterOutcome(current.armed.id, outcome);
    openRef.current = null;
    setOpen(false);
    closedRef.current?.();
  }

  if (!showing) {
    return null;
  }

  return <MemberPopupDialog key={showing.armed.key} onFinish={finish} onNavigate={onNavigate} open={open} popup={showing.popup} />;
}
