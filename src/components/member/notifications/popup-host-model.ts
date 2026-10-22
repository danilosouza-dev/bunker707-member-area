// Regras do navegador para abrir os pop-ups (docs/25 §4; member-popup-host.tsx usa): o que o plano do aluno
// arma nesta visualizacao de pagina, o que cada conclusao de aula arma, o que impede abrir agora (outro
// pop-up, aba escondida, tela cheia, o nosso player tocando, algo aberto por cima) e se isso descarta a
// abertura ou so espera. O plano vem do resumo (notifications-client.ts) e nao traz conteudo: o conteudo
// so vem no POST /show, que confere tudo de novo no servidor. Modulo puro: sem DOM, imports relativos;
// tests/pop-ups-v3b1-navegador.test.mjs carrega direto pelo Node.

import { popupAllowsPage } from "../../../server/communications/popup-display-model";
import type { PopupPlanItem, PopupsAnswer } from "../../../server/communications/notification-model";

export const POPUP_HOST_RULES = {
  /** Depois que um pop-up fecha, o proximo da fila espera 1 s (um de cada vez, nunca empilhados). */
  betweenPopupsMs: 1_000,
  /** Algo aberto por cima ou alguem digitando: confere de novo a cada segundo. */
  blockedRecheckMs: 1_000,
  /** 10 min depois da hora dele, desiste (nada e registrado). */
  giveUpMs: 10 * 60_000,
  /** No Inicio, o primeiro pedido sai 1,5 s depois de a pagina abrir (nao disputa com ela). */
  homeFetchDelayMs: 1_500,
  /** Folga na comparacao com o `notBefore` do servidor (o relogio do navegador e acertado pelo asOf). */
  notBeforeMarginMs: 1_000,
  /** O POST /show desiste depois de 10 s (partida a frio na Vercel). */
  showTimeoutMs: 10_000
} as const;

export type HostTrigger = "lesson_completed" | "page_load";

/** Uma abertura armada nesta visualizacao de pagina. at = relogio do navegador. */
export type ArmedPopup = {
  at: number;
  id: string;
  /** page_load: o id (uma vez por visualizacao); lesson_completed: `${id}:${lessonId}`. */
  key: string;
  lessonId: string | null;
  /** lesson_completed: o nosso player tocava quando a aula foi concluida (Concluir no meio do video). */
  playingAtCompletion: boolean;
  trigger: HostTrigger;
};

export type LessonEnv = { activeLessonId: string | null; playing: boolean; touched: boolean };
export type BlockEnv = { fullscreen: boolean; hidden: boolean; layer: boolean; lesson: LessonEnv | null; popupOpen: boolean };
export type BlockReason = "fullscreen" | "hidden" | "layer" | "left_lesson" | "open" | "playing" | "replayed" | "touched";
export type BlockAction = "drop" | "recheck" | "wait_close" | "wait_fullscreen" | "wait_paused" | "wait_visible";

/** O `notBefore` do servidor ja deixa na hora em que a abertura vai acontecer (com a folga de 1 s). */
function allowedAt(item: Pick<PopupPlanItem, "notBefore">, serverAt: number) {
  if (item.notBefore === null) {
    return true;
  }

  const notBefore = Date.parse(item.notBefore);

  return Number.isFinite(notBefore) && notBefore <= serverAt + POPUP_HOST_RULES.notBeforeMarginMs;
}

function delayMsOf(item: Pick<PopupPlanItem, "delaySeconds">) {
  return Number.isFinite(item.delaySeconds) && item.delaySeconds > 0 ? item.delaySeconds * 1000 : 0;
}

/** "Ao abrir a página": o que o plano arma nesta visualizacao (uma vez cada), na ordem do plano. */
export function openingsForPageView(input: {
  items: readonly PopupPlanItem[];
  offsetMs: number;
  pageKey: string;
  pageViewStart: number;
}): ArmedPopup[] {
  return input.items
    .filter(
      (item) =>
        item.trigger === "page_load" &&
        popupAllowsPage(item, input.pageKey) &&
        allowedAt(item, input.pageViewStart + input.offsetMs + delayMsOf(item))
    )
    .map((item) => ({
      at: input.pageViewStart + delayMsOf(item),
      id: item.id,
      key: item.id,
      lessonId: null,
      playingAtCompletion: false,
      trigger: "page_load"
    }));
}

/** "Ao concluir uma aula": o que uma conclusao gravada arma (uma vez por pop-up e aula nesta visualizacao). */
export function completionOpenings(input: {
  contentId: string;
  items: readonly PopupPlanItem[];
  lessonId: string;
  now: number;
  offsetMs: number;
  playing: boolean;
}): ArmedPopup[] {
  const pageKey = `lesson:${input.contentId}`;

  return input.items
    .filter(
      (item) =>
        item.trigger === "lesson_completed" &&
        popupAllowsPage(item, pageKey) &&
        allowedAt(item, input.now + input.offsetMs + delayMsOf(item))
    )
    .map((item) => ({
      at: input.now + delayMsOf(item),
      id: item.id,
      key: `${item.id}:${input.lessonId}`,
      lessonId: input.lessonId,
      playingAtCompletion: input.playing,
      trigger: "lesson_completed"
    }));
}

/**
 * O que impede abrir agora (o primeiro que vale), antes do POST /show ou depois dele (ja contado: nada que
 * era descartado antes descarta depois, so espera).
 */
export function blockReason(env: BlockEnv, armed: ArmedPopup, phase: "after_show" | "before_show"): BlockReason | null {
  if (env.popupOpen) {
    return "open";
  }

  if (env.hidden) {
    return "hidden";
  }

  if (env.fullscreen) {
    return "fullscreen";
  }

  const lesson = env.lesson;

  if (lesson && armed.trigger === "page_load") {
    // Tocando sem ter "mexido" (autoplay) tambem e mexer: nunca por cima do nosso player.
    if (phase === "before_show" && (lesson.touched || lesson.playing)) {
      return "touched";
    }

    if (phase === "after_show" && lesson.playing) {
      return "playing";
    }
  }

  if (lesson && armed.trigger === "lesson_completed") {
    if (phase === "before_show") {
      if (lesson.activeLessonId !== armed.lessonId) {
        return "left_lesson";
      }

      if (lesson.playing && !armed.playingAtCompletion) {
        return "replayed";
      }
    }

    if (lesson.playing) {
      return "playing";
    }
  }

  return env.layer ? "layer" : null;
}

export function blockAction(reason: BlockReason): BlockAction {
  switch (reason) {
    case "open":
      return "wait_close";
    case "hidden":
      return "wait_visible";
    case "fullscreen":
      return "wait_fullscreen";
    case "playing":
      return "wait_paused";
    case "layer":
      return "recheck";
    default:
      return "drop";
  }
}

/** 10 min depois da hora dela (nao do comeco da pagina), a abertura desiste. */
export function givenUp(armed: Pick<ArmedPopup, "at">, now: number) {
  return now - armed.at > POPUP_HOST_RULES.giveUpMs;
}

/** Como o aluno fechou, pelo motivo do Base UI (o X da janela chama direto com "x"). */
export function closeViaOf(reason: string | undefined): "esc" | "outside" | "x" {
  if (reason === "outside-press") {
    return "outside";
  }

  return reason === "escape-key" ? "esc" : "x";
}

/** Saiu da pagina (ou recarregou) com o pop-up aberto e sem resposta: conta como fechado (via "page"). */
export function shouldSendPageClose(input: { outcome: string | null; persisted: boolean }) {
  return input.outcome === null && !input.persisted;
}

const PLAN_TRIGGERS: readonly string[] = ["lesson_completed", "page_load"];
const PLAN_STOPS: readonly (string | null)[] = ["click", "never", null];

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? (value as string[]) : null;
}

function planItemOf(value: unknown): PopupPlanItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const pages = stringList(item.pages);
  const exclude = stringList(item.exclude);

  if (
    typeof item.id !== "string" ||
    !item.id ||
    !pages ||
    !exclude ||
    typeof item.trigger !== "string" ||
    !PLAN_TRIGGERS.includes(item.trigger) ||
    typeof item.delaySeconds !== "number" ||
    !Number.isFinite(item.delaySeconds) ||
    !(item.notBefore === null || typeof item.notBefore === "string") ||
    !PLAN_STOPS.includes((item.stopOn ?? null) as string | null)
  ) {
    return null;
  }

  return {
    delaySeconds: item.delaySeconds,
    exclude,
    id: item.id,
    notBefore: item.notBefore as string | null,
    pages,
    stopOn: (item.stopOn ?? null) as PopupPlanItem["stopOn"],
    trigger: item.trigger as PopupPlanItem["trigger"]
  };
}

/**
 * A parte `popups` do resumo, sem confiar no formato: o que nao se le vira null (nenhum pop-up nesta
 * janela de 1 minuto) e um item estranho do plano sai sozinho.
 */
export function readPopupsAnswer(value: unknown): PopupsAnswer | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const answer = value as Record<string, unknown>;
  const pages = stringList(answer.pages);

  if (typeof answer.asOf !== "string" || !pages) {
    return null;
  }

  const plan = Array.isArray(answer.plan)
    ? answer.plan.map(planItemOf).filter((item): item is PopupPlanItem => item !== null)
    : null;

  return { asOf: answer.asOf, pages, plan };
}

/** Diferenca entre a hora do servidor e a do navegador quando a resposta chegou (0 se nao der para ler). */
export function clockOffsetOf(asOf: string, arrivedAt: number) {
  const server = Date.parse(asOf);

  return Number.isFinite(server) ? server - arrivedAt : 0;
}
