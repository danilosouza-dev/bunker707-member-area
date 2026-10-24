"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  LESSON_MEDIA_EVENT,
  lessonMediaSnapshot,
  readLessonMediaSignal,
  resetLessonMedia,
  waitLessonFullscreenEnd,
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
  subscribePopupMemory,
  updatePopupAfterOutcome,
  updatePopupInPlan,
  type PopupPlan
} from "./notifications-client";
import {
  blockAction,
  blockReason,
  clockOffsetOf,
  completionOpenings,
  createArmedClock,
  givenUp,
  hasBlockingLayer,
  needsFreeCard,
  newPlanAction,
  openingsForPageView,
  POPUP_HOST_RULES,
  rearmAfterNotStarted,
  reconcileClockOpenings,
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
// Nada roda em intervalo alem da conferencia de 1 s enquanto algo bloqueia e do despertador de ate 30 s de uma
// abertura armada (so o relogio do navegador; nenhum pedido em laco).
//
// Hora marcada (docs/29 §4.1): o pop-up com Comeca depois da abertura da pagina arma para a hora do servidor
// (+ 2 s de folga, + 0 a 4 s sorteados, + "Quanto tempo depois") e nao desiste por tempo (o Termina decide no
// servidor). Toda abertura armada segue a hora de parede: o despertador compara Date.now() a cada no maximo 30 s
// e a volta da aba, a volta do cache do navegador e o foco da janela conferem na hora o que ja venceu (o aparelho
// dormindo para o relogio dos temporizadores). Um plano mais novo que chega com a pagina aberta (o topo pediu ao
// voltar para a aba, ou outra pagina pediu) arma, desarma ou troca a hora marcada (e desarma tudo quando a
// resposta nova nao cobre mais a pagina); nenhum pedido novo. O 409 `not_started` (relogio adiantado, a equipe
// adiou) arma de novo uma vez para o `nextAt`, com o relogio acertado pelo `asOf` da propria recusa.
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
    /** Hora marcada ainda nao vencida: id -> chave (`${id}@${startsAt}`). */
    const clockKeys = new Map<string, string>();
    /** Ids de momento de pagina que ja entraram na fila nesta visualizacao (nunca duas vezes). */
    const queued = new Set<string>();
    /** O acerto do relogio do plano com que armou (acertado a cada plano novo). */
    let offsetMs = 0;
    /** Quantas vezes o curso virou nesta visualizacao (cada virada e outra chance de "Ao concluir um curso"). */
    let courseTurns = 0;
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
        lesson: media
          ? { activeLessonId: media.activeLessonId, bridge: media.bridge, playing: media.playing, readable: media.readable, touched: media.touched }
          : null,
        // O anterior ainda saindo (animacao) tambem conta: nunca dois na tela.
        popupOpen: openRef.current !== null || document.querySelector("[data-member-popup]") !== null
      };
    }

    /** Venceu (o despertador ou a conferencia de volta): entra na fila. */
    function due(armed: ArmedPopup) {
      if (cancelled) {
        return;
      }

      if (armed.clock && clockKeys.get(armed.id) === armed.key) {
        clockKeys.delete(armed.id);
      }

      if (armed.lessonId === null) {
        queued.add(armed.id);
      }

      queue.push(armed);
      pump();
    }

    /** Toda abertura armada segue a hora de parede (despertador de ate 30 s; nenhum pedido). */
    const clock = createArmedClock({ now: () => Date.now(), onDue: due, timers: window });

    /** Arma uma abertura (sem conferir chave: quem chama confere). A hora marcada tambem entra em clockKeys. */
    function armAt(armed: ArmedPopup) {
      if (armed.clock) {
        clockKeys.set(armed.id, armed.key);
      }

      clock.arm(armed);
    }

    /** Desarma a hora marcada de um id (a equipe mudou o Comeca, ou ele saiu do plano). */
    function cancelClock(id: string) {
      const armedKey = clockKeys.get(id);

      if (armedKey) {
        clockKeys.delete(id);
        clock.cancel(armedKey);
      }
    }

    /** A volta da aba, do cache do navegador ou o foco: o que ja venceu entra na fila na hora. */
    function checkDue() {
      clock.checkDue();
    }

    function arm(openings: ArmedPopup[]) {
      let armedAny = false;
      let armedFree = false;

      for (const armed of openings) {
        if (armed.clock ? queued.has(armed.id) || clockKeys.has(armed.id) : armedKeys.has(armed.key)) {
          continue;
        }

        if (!armed.clock) {
          armedKeys.add(armed.key);
        }

        armedAny = true;
        armedFree ||= needsFreeCard(armed);
        armAt(armed);
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
        // Os avisos do document (o iPhone e o webkitendfullscreen), a ponte do player de fora (o Vimeo so avisa
        // por mensagem) e a conferencia de 1 s.
        stopWaiting = waitLessonFullscreenEnd(resume);
        return;
      }

      if (action === "wait_paused") {
        stopWaiting = waitLessonMediaStop(resume);
        return;
      }

      // Outro pop-up saindo, algo aberto por cima, alguem digitando ou a ponte do player de fora ainda no aperto
      // de mao: confere de novo em 1 s.
      const timer = window.setTimeout(resume, POPUP_HOST_RULES.blockedRecheckMs);
      stopWaiting = () => window.clearTimeout(timer);
    }

    /** Antes do POST /show: desiste, descarta ou espera; senao, pede. */
    function attempt(armed: ArmedPopup) {
      if (cancelled) {
        return;
      }

      // 10 min depois da hora dele, desiste (nada registrado): a conferencia de 1 s nunca fica para sempre. A hora
      // marcada nao desiste por tempo (o Termina decide no servidor; a ponte pendente tem teto de 15 s).
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

        // Hora marcada que chegou antes do comeco (relogio adiantado, a equipe adiou): de novo, uma vez so, com o
        // relogio acertado pela hora que veio na recusa (o relogio do navegador pode ter mudado desde o plano).
        if (!cancelled && refused && error.reason === "not_started" && error.nextAt) {
          const offset = error.asOf ? clockOffsetOf(error.asOf, Date.now()) : offsetMs;
          const again = rearmAfterNotStarted(armed, error.nextAt, offset, Date.now());

          if (again) {
            armAt(again);
          }
        }

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
      if (!event.persisted) {
        return;
      }

      // Voltou do cache do navegador: a hora marcada que venceu enquanto isso entra na fila agora.
      checkDue();

      if (!openRef.current) {
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

      // O momento da conclusao: a hora, a aula na tela, se o player da aula tocava (Concluir no meio do video) e se
      // fechou o curso (cada virada conta uma vez a mais: desmarcar e concluir de novo e outra chance).
      const completedAt = Date.now();
      const { activeLessonId, playing } = lessonMediaSnapshot();
      const courseCompleted = signal.courseCompleted === true;

      if (courseCompleted) {
        courseTurns += 1;
      }

      const turn = courseTurns;

      // O plano pode ter mudado desde que a aula abriu: pede so se a memoria passou de 1 minuto.
      void ensurePopupPlan(key).then((plan) => {
        if (!cancelled && plan) {
          arm(
            completionOpenings({
              activeLessonId,
              contentId,
              courseCompleted,
              items: plan.items,
              lessonId: signal.lessonId,
              now: completedAt,
              offsetMs: plan.offsetMs,
              playing,
              turn
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
        offsetMs = plan.offsetMs;
        arm(openingsForPageView({ items: plan.items, now: Date.now(), offsetMs: plan.offsetMs, pageKey: key, pageViewStart }));
      }
    }

    /**
     * Plano mais novo guardado com a pagina aberta (o topo pediu ao voltar para a aba, ou outra pagina pediu): so a
     * hora marcada muda (arma, desarma ou troca de hora; a resposta que nao cobre mais a pagina desarma tudo). O
     * resto continua so para a proxima pagina.
     */
    function handleNewPlan() {
      const kept = popupPlanFromMemory(key);
      const action = newPlanAction(kept);

      if (cancelled || !kept || action === "skip") {
        return;
      }

      if (action === "disarm_all" || !kept.plan) {
        // O unico pop-up que cobria a pagina pausou, encerrou ou saiu do segmento: a hora armada nao vale mais.
        [...clockKeys.keys()].filter((id) => !queued.has(id)).forEach(cancelClock);
        return;
      }

      offsetMs = kept.offsetMs;

      const now = Date.now();
      const { arm: toArm, disarm } = reconcileClockOpenings({
        armed: clockKeys,
        items: kept.plan,
        now,
        offsetMs: kept.offsetMs,
        openings: openingsForPageView({ items: kept.plan, now, offsetMs: kept.offsetMs, onlyClock: true, pageKey: key, pageViewStart }),
        pageKey: key,
        queued
      });

      disarm.forEach(cancelClock);
      toArm.forEach(armAt);

      if (toArm.length > 0) {
        preloadPopupDialog(toArm.some(needsFreeCard));
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        checkDue();
      }
    }

    closedRef.current = () => next(POPUP_HOST_RULES.betweenPopupsMs);
    const stopMemory = subscribePopupMemory(handleNewPlan);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", checkDue);
    document.addEventListener("visibilitychange", handleVisibility);

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
      stopMemory();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      clock.stop();
      stopFocusWatch?.();
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", checkDue);
      document.removeEventListener("visibilitychange", handleVisibility);
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
