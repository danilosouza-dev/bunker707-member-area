// Regras do navegador para abrir os pop-ups (docs/25 §4, docs/29 §5; member-popup-host.tsx usa): o que o plano
// do aluno arma nesta visualizacao de pagina (tambem na hora marcada do Comeca, para a pagina aberta antes dela),
// o que cada conclusao de aula (e de curso) arma, o que impede abrir agora (outro pop-up, aba escondida, tela
// cheia, o player da aula tocando, a ponte com o player de fora ainda no aperto de mao, algo aberto por cima) e
// se isso descarta a abertura ou so espera. O plano vem do resumo (notifications-client.ts) e nao traz conteudo:
// o conteudo so vem no POST /show, que confere tudo de novo no servidor. Modulo puro: o document so chega por
// parametro (hasBlockingLayer), o relogio e o sorteio tambem; imports relativos;
// tests/pop-ups-v3b1-navegador.test.mjs e tests/pop-ups-v3b2-navegador.test.mjs carregam direto pelo Node.

import {
  isLessonTrigger,
  isPageTrigger,
  popupAllowsPage,
  POPUP_TRIGGERS,
  POPUP_V3B2_RULES
} from "../../../server/communications/popup-display-model";
import type { PopupPlanItem, PopupsAnswer } from "../../../server/communications/notification-model";

export const POPUP_HOST_RULES = {
  /** Abertura armada: o despertador confere a hora de parede pelo menos a cada 30 s (so o relogio, nenhum pedido). */
  armWakeMs: 30_000,
  /** Depois que um pop-up fecha, o proximo da fila espera 1 s (um de cada vez, nunca empilhados). */
  betweenPopupsMs: 1_000,
  /** Algo aberto por cima ou alguem digitando: confere de novo a cada segundo. */
  blockedRecheckMs: 1_000,
  /** 10 min depois da hora dele, desiste (nada e registrado). */
  giveUpMs: 10 * 60_000,
  /** No Inicio, o primeiro pedido sai 1,5 s depois de a pagina abrir (nao disputa com ela). */
  homeFetchDelayMs: 1_500,
  /** O plano so arma ate 24 h a frente (o mesmo horizonte do servidor). */
  liveHorizonMs: POPUP_V3B2_RULES.liveHorizonMs,
  /** Hora marcada: espera ate 2 s depois da hora do servidor (o relogio acertado pelo asOf erra pouco). */
  liveStartMarginMs: 2_000,
  /** Hora marcada: cada aba abre num momento sorteado de 0 a 4 s depois da folga (todas ao mesmo tempo pesam). */
  liveSpreadMs: 4_000,
  /** Folga na comparacao com o `notBefore` do servidor (o relogio do navegador e acertado pelo asOf). */
  notBeforeMarginMs: 1_000,
  /** O POST /show desiste depois de 10 s (partida a frio na Vercel). */
  showTimeoutMs: 10_000
} as const;

export type HostTrigger = "course_completed" | "first_login" | "lesson_completed" | "page_load";

/** Um item do plano (o contrato do resumo, notification-model.ts). */
export type PlanItem = PopupPlanItem;
export type PlanAnswer = PopupsAnswer;

/** Uma abertura armada nesta visualizacao de pagina. at = relogio do navegador. */
export type ArmedPopup = {
  at: number;
  /** Armada para a hora marcada (a pagina abriu antes do Comeca do pop-up). */
  clock: boolean;
  /** "Quanto tempo depois" do item do plano, em ms (a segunda tentativa da hora marcada usa de novo). */
  delayMs: number;
  /** Design Livre (o plano marcou): o host baixa tambem o pedaco do cartao Livre antes do POST /show. */
  design?: "free";
  /** Relogio do navegador depois do qual desiste; null = nao desiste por tempo (hora marcada, D5). */
  giveUpAt: number | null;
  id: string;
  /**
   * page_load/first_login: o id; hora marcada: `${id}@${startsAt}` (a hora mudou = outra chave; o Comeca que saiu
   * ou voltou para antes da abertura da pagina: `${id}@now`); segunda tentativa da hora marcada: `${id}@${nextAt}`;
   * lesson_completed: `${id}:${lessonId}`; course_completed: `${id}:course:${turn}` (cada virada do curso nesta
   * visualizacao e uma chave: desmarcar e concluir de novo e outra chance).
   */
  key: string;
  /** Conclusao: a aula concluida (lesson_completed) ou a aula na tela quando o curso virou (course_completed). */
  lessonId: string | null;
  /** Conclusao: o player da aula tocava quando a aula foi concluida (Concluir no meio do video). */
  playingAtCompletion: boolean;
  /** A hora marcada ja foi armada de novo uma vez (409 not_started). */
  rearmed: boolean;
  /** So na hora marcada: o startsAt do plano (ou o nextAt da segunda tentativa) com que armou. */
  startsAt?: string;
  trigger: HostTrigger;
};

export type LessonEnv = {
  activeLessonId: string | null;
  bridge: "confirmed" | "none" | "pending";
  playing: boolean;
  readable: boolean;
  touched: boolean;
};
export type BlockEnv = { fullscreen: boolean; hidden: boolean; layer: boolean; lesson: LessonEnv | null; popupOpen: boolean };
export type BlockReason = "bridge_pending" | "fullscreen" | "hidden" | "layer" | "left_lesson" | "open" | "playing" | "replayed" | "touched";
export type BlockAction = "drop" | "recheck" | "wait_close" | "wait_fullscreen" | "wait_paused" | "wait_visible";

/** O `notBefore` do servidor ja deixa na hora em que a abertura vai acontecer (com a folga de 1 s). */
function allowedAt(item: Pick<PlanItem, "notBefore">, serverAt: number) {
  if (item.notBefore === null) {
    return true;
  }

  const notBefore = Date.parse(item.notBefore);

  return Number.isFinite(notBefore) && notBefore <= serverAt + POPUP_HOST_RULES.notBeforeMarginMs;
}

/** So o Livre leva a marca (Padrão e Personalizado: a abertura fica igual a da v3b-1). */
function designOf(item: Pick<PlanItem, "design">): Pick<ArmedPopup, "design"> {
  return item.design === "free" ? { design: "free" } : {};
}

/** O plano marcou o pop-up como Livre: o pedaco do cartao Livre vem antes do POST /show. */
export function needsFreeCard(armed: Pick<ArmedPopup, "design">): boolean {
  return armed.design === "free";
}

function delayMsOf(item: Pick<PlanItem, "delaySeconds">) {
  return Number.isFinite(item.delaySeconds) && item.delaySeconds > 0 ? item.delaySeconds * 1000 : 0;
}

/** O sorteio do espalhamento da hora marcada (0 a liveSpreadMs - 1). */
function spreadOf(random: () => number) {
  const value = random();

  return Number.isFinite(value) && value > 0 ? Math.floor(Math.min(value, 0.999_999) * POPUP_HOST_RULES.liveSpreadMs) : 0;
}

/**
 * "Ao abrir a página" e "No primeiro acesso": o que o plano arma nesta visualizacao (uma vez cada), na ordem do
 * plano. Item com `startsAt` cuja hora (com a folga) cai depois da abertura da pagina arma para a hora marcada
 * (D2, D5): a hora do servidor + folga + sorteio + "Quanto tempo depois", sem desistir por tempo, com a chave da
 * hora (`${id}@${startsAt}`); pode ja estar no passado (o plano chegou depois da hora: abre na hora). Os outros,
 * como sempre: o comeco da pagina + "Quanto tempo depois", desistindo 10 min depois. `onlyClock`: so os da hora
 * marcada (o plano mais novo que chegou com a pagina aberta).
 */
export function openingsForPageView(input: {
  items: readonly PlanItem[];
  now: number;
  offsetMs: number;
  /** So as da hora marcada (o plano mais novo que chegou com a pagina aberta). */
  onlyClock?: boolean;
  pageKey: string;
  pageViewStart: number;
  /** Sorteio do espalhamento (o teste passa um fixo). Padrao Math.random. */
  random?: () => number;
}): ArmedPopup[] {
  const random = input.random ?? Math.random;
  const openings: ArmedPopup[] = [];

  for (const item of input.items) {
    if (!isPageTrigger(item.trigger) || !popupAllowsPage(item, input.pageKey)) {
      continue;
    }

    const delayMs = delayMsOf(item);
    const startsLocal = item.startsAt ? Date.parse(item.startsAt) - input.offsetMs : Number.NaN;
    const base = { ...designOf(item), delayMs, id: item.id, lessonId: null, playingAtCompletion: false, rearmed: false, trigger: item.trigger };

    if (Number.isFinite(startsLocal) && startsLocal + POPUP_HOST_RULES.liveStartMarginMs > input.pageViewStart) {
      const at = startsLocal + POPUP_HOST_RULES.liveStartMarginMs + spreadOf(random) + delayMs;

      if (at - input.now <= POPUP_HOST_RULES.liveHorizonMs && allowedAt(item, at + input.offsetMs)) {
        openings.push({ ...base, at, clock: true, giveUpAt: null, key: `${item.id}@${item.startsAt}`, startsAt: item.startsAt });
      }

      continue;
    }

    const at = input.pageViewStart + delayMs;

    if (!input.onlyClock && allowedAt(item, at + input.offsetMs)) {
      openings.push({ ...base, at, clock: false, giveUpAt: at + POPUP_HOST_RULES.giveUpMs, key: item.id });
    }
  }

  return openings;
}

/**
 * O Comeca de um id armado foi para antes da abertura da pagina, ou saiu: a hora velha nao vale mais e o pop-up
 * abre agora (sorteio + "Quanto tempo depois"), como se a pagina tivesse aberto depois do Comeca. Chave
 * `${id}@${startsAt}` ou `${id}@now` (o mesmo plano de novo nao arma outra vez). null quando a frequencia nao deixa.
 */
function lateClockOpening(item: PlanItem, now: number, offsetMs: number, random: () => number): ArmedPopup | null {
  const delayMs = delayMsOf(item);
  const at = now + spreadOf(random) + delayMs;

  if (!allowedAt(item, at + offsetMs)) {
    return null;
  }

  return {
    ...designOf(item),
    at,
    clock: true,
    delayMs,
    giveUpAt: null,
    id: item.id,
    key: lateClockKey(item),
    lessonId: null,
    playingAtCompletion: false,
    rearmed: false,
    ...(item.startsAt ? { startsAt: item.startsAt } : {}),
    trigger: item.trigger
  };
}

function lateClockKey(item: Pick<PlanItem, "id" | "startsAt">) {
  return `${item.id}@${item.startsAt ?? "now"}`;
}

/**
 * Plano mais novo com a pagina aberta (onlyClock): o que armar e o que desarmar na hora marcada. `armed` = id ->
 * chave da abertura da hora marcada ainda nao vencida; `queued` = ids que ja entraram na fila nesta visualizacao;
 * `openings` = openingsForPageView({ onlyClock: true }) do plano novo; `now`, `offsetMs` e `random` armam a
 * abertura atrasada. Pura.
 * - id ja na fila: nada (nunca duas vezes na mesma visualizacao);
 * - mesma chave: nada; chave diferente (a equipe adiantou ou adiou o Comeca): desarma a velha e arma a nova;
 * - id armado sem item do momento de pagina para esta pagina no plano novo (saiu do segmento, pausou, outras
 *   paginas): desarma;
 * - id armado cujo item continua mas nao arma mais pela hora (o Comeca foi para antes da abertura da pagina ou
 *   saiu): desarma a hora velha e arma para agora (sorteio + "Quanto tempo depois", chave `${id}@${startsAt}` ou
 *   `${id}@now`; so se a frequencia deixar), a nao ser que ja esteja armado com essa chave.
 */
export function reconcileClockOpenings(input: {
  armed: ReadonlyMap<string, string>;
  items: readonly PlanItem[];
  now: number;
  offsetMs: number;
  openings: readonly ArmedPopup[];
  pageKey: string;
  queued: ReadonlySet<string>;
  /** Sorteio do espalhamento (o teste passa um fixo). Padrao Math.random. */
  random?: () => number;
}): { arm: ArmedPopup[]; disarm: string[] } {
  const random = input.random ?? Math.random;
  const arm: ArmedPopup[] = [];
  const disarm: string[] = [];
  const openingOf = new Map(input.openings.map((opening) => [opening.id, opening]));

  for (const [id, key] of input.armed) {
    if (input.queued.has(id)) {
      continue;
    }

    const planned = input.items.find((item) => item.id === id && isPageTrigger(item.trigger) && popupAllowsPage(item, input.pageKey));
    const opening = openingOf.get(id);

    if (!planned) {
      disarm.push(id);
    } else if (opening) {
      if (opening.key !== key) {
        disarm.push(id);
        arm.push(opening);
      }
    } else if (lateClockKey(planned) !== key) {
      disarm.push(id);

      const late = lateClockOpening(planned, input.now, input.offsetMs, random);

      if (late) {
        arm.push(late);
      }
    }
  }

  for (const opening of input.openings) {
    if (!input.queued.has(opening.id) && !input.armed.has(opening.id)) {
      arm.push(opening);
    }
  }

  return { arm, disarm };
}

/**
 * O que o host faz com um plano mais novo guardado com a pagina aberta (popupPlanFromMemory): null = a memoria
 * passou do prazo ("skip"); resposta guardada que nao cobre mais a pagina ou veio sem plano (pausou, encerrou,
 * saiu do segmento o unico pop-up que cobria): "disarm_all" (a hora marcada armada nao vale mais); a resposta
 * que falhou (`answered` false) parece igual, mas nao diz nada: "skip"; com plano para a pagina: "reconcile".
 */
export function newPlanAction(kept: { answered: boolean; covered: boolean; plan: readonly PlanItem[] | null } | null): "disarm_all" | "reconcile" | "skip" {
  if (!kept) {
    return "skip";
  }

  if (!kept.covered || !kept.plan) {
    return kept.answered ? "disarm_all" : "skip";
  }

  return "reconcile";
}

/** Quanto esperar ate a proxima conferencia da abertura: no maximo armWakeMs, 0 quando ja venceu. */
export function nextWakeDelay(at: number, now: number): number {
  return Math.max(0, Math.min(POPUP_HOST_RULES.armWakeMs, at - now));
}

/**
 * As aberturas armadas de uma visualizacao de pagina seguindo a hora de parede (D5): cada uma encadeia
 * despertadores de nextWakeDelay (no maximo 30 s), cada um comparando o relogio com a hora dela; `checkDue` (a
 * volta da aba, do cache do navegador, o foco) poe na hora o que ja venceu e cancela o despertador velho. Um
 * `setTimeout` de horas nao segue a hora de parede: com o aparelho dormindo ele volta com o tempo que faltava.
 * So o relogio do navegador: nenhum pedido. O host chama; o teste usa relogio e temporizadores de mentira.
 */
export function createArmedClock(input: {
  now: () => number;
  /** A abertura venceu (uma vez): entra na fila. */
  onDue: (armed: ArmedPopup) => void;
  timers: { clearTimeout: (id: number) => void; setTimeout: (callback: () => void, ms: number) => number };
}): { arm(armed: ArmedPopup): void; cancel(key: string): void; checkDue(): void; stop(): void } {
  const waiting = new Map<string, { armed: ArmedPopup; timer: number | null }>();

  function clear(entry: { timer: number | null }) {
    if (entry.timer !== null) {
      input.timers.clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  function due(key: string) {
    const entry = waiting.get(key);

    if (!entry) {
      return;
    }

    clear(entry);
    waiting.delete(key);
    input.onDue(entry.armed);
  }

  function wake(key: string) {
    const entry = waiting.get(key);

    if (!entry) {
      return;
    }

    const delay = nextWakeDelay(entry.armed.at, input.now());

    if (delay <= 0) {
      due(key);
      return;
    }

    entry.timer = input.timers.setTimeout(() => {
      entry.timer = null;
      wake(key);
    }, delay);
  }

  return {
    arm(armed) {
      const previous = waiting.get(armed.key);

      if (previous) {
        clear(previous);
      }

      waiting.set(armed.key, { armed, timer: null });
      wake(armed.key);
    },
    cancel(key) {
      const entry = waiting.get(key);

      if (entry) {
        clear(entry);
        waiting.delete(key);
      }
    },
    checkDue() {
      const now = input.now();

      for (const [key, entry] of [...waiting]) {
        if (entry.armed.at <= now) {
          due(key);
        }
      }
    },
    stop() {
      waiting.forEach(clear);
      waiting.clear();
    }
  };
}

/**
 * A segunda (e ultima) tentativa da hora marcada: nextAt (hora do servidor) + folga + espalhamento + armed.delayMs.
 * null quando nextAt nao le, armed.rearmed, !armed.clock ou o novo at passa de liveHorizonMs a frente de now
 * (o proximo plano traz o pop-up).
 */
export function rearmAfterNotStarted(armed: ArmedPopup, nextAt: string, offsetMs: number, now: number, random: () => number = Math.random): ArmedPopup | null {
  const server = Date.parse(nextAt);

  if (!armed.clock || armed.rearmed || !Number.isFinite(server)) {
    return null;
  }

  const at = server - offsetMs + POPUP_HOST_RULES.liveStartMarginMs + spreadOf(random) + armed.delayMs;

  return at - now > POPUP_HOST_RULES.liveHorizonMs ? null : { ...armed, at, key: `${armed.id}@${nextAt}`, rearmed: true, startsAt: nextAt };
}

/**
 * "Ao concluir uma aula" (e, com `courseCompleted`, "Ao concluir um curso"): o que uma conclusao gravada arma, na
 * ordem do plano. A aula: uma vez por pop-up e aula nesta visualizacao (chave `${id}:${lessonId}`). O curso: uma
 * vez por pop-up e virada (`turn`, a conta de viradas desta visualizacao; chave `${id}:course:${turn}`), com a
 * aula na tela na hora da virada (`activeLessonId`; o check de outra aula da playlist nao e "outra aula na tela"),
 * senao a concluida.
 */
export function completionOpenings(input: {
  /** A aula na tela na hora da conclusao (lessonMediaSnapshot().activeLessonId); null = sem palco. */
  activeLessonId: string | null;
  contentId: string;
  /** O servidor disse que esta conclusao fechou o curso. */
  courseCompleted: boolean;
  items: readonly PlanItem[];
  lessonId: string;
  now: number;
  offsetMs: number;
  playing: boolean;
  /** Quantas vezes o curso virou nesta visualizacao de pagina (esta e a `turn`-esima). */
  turn: number;
}): ArmedPopup[] {
  const pageKey = `lesson:${input.contentId}`;
  const openings: ArmedPopup[] = [];

  for (const item of input.items) {
    const course = item.trigger === "course_completed";
    const moment = item.trigger === "lesson_completed" || (input.courseCompleted && course);
    const delayMs = delayMsOf(item);
    const at = input.now + delayMs;

    if (!moment || !popupAllowsPage(item, pageKey) || !allowedAt(item, at + input.offsetMs)) {
      continue;
    }

    openings.push({
      at,
      clock: false,
      delayMs,
      ...designOf(item),
      giveUpAt: at + POPUP_HOST_RULES.giveUpMs,
      id: item.id,
      key: course ? `${item.id}:course:${input.turn}` : `${item.id}:${input.lessonId}`,
      lessonId: course ? (input.activeLessonId ?? input.lessonId) : input.lessonId,
      playingAtCompletion: input.playing,
      rearmed: false,
      trigger: item.trigger
    });
  }

  return openings;
}

/**
 * O que impede abrir agora (o primeiro que vale), antes do POST /show ou depois dele (ja contado: nada que
 * era descartado antes descarta depois, so espera). Na aula (docs/29 §5.4), os momentos de pagina esperam o
 * video parar em todo player que a pagina le; com a ponte do player de fora ainda no aperto de mao, conferem de
 * novo a cada 1 s; so no player que a pagina nao le, mexer nele descarta (antes do show).
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

  if (lesson && isPageTrigger(armed.trigger)) {
    // Nunca por cima do video tocando: espera parar (antes e depois do show).
    if (lesson.playing) {
      return "playing";
    }

    // Player da lista ainda no aperto de mao (no maximo 15 s): confere de novo (numa tela de toque o iframe
    // conta como "mexido" desde o comeco, e a confirmacao leva alguns segundos).
    if (lesson.bridge === "pending") {
      return "bridge_pending";
    }

    // Player que a pagina nao le (ou ponte sem resposta) e o aluno mexeu: descarta.
    if (phase === "before_show" && !lesson.readable && lesson.touched) {
      return "touched";
    }
  }

  if (lesson && isLessonTrigger(armed.trigger)) {
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

/** Campo de texto com foco (o aluno esta digitando): o pop-up nao rouba o foco nem fecha o teclado. */
const TYPING_TARGETS =
  'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

/** O que hasBlockingLayer le do document (o teste passa um de mentira). */
export type LayerDocument = Pick<Document, "activeElement" | "body" | "documentElement" | "querySelectorAll">;

/** Na tela de verdade: fora de [hidden]/[inert] e com caixa (display: none nao tem). */
function isShown(element: Element) {
  return !element.closest("[inert], [hidden]") && element.getClientRects().length > 0;
}

/**
 * Outro dialogo, gaveta, painel ou modal aberto (ou a rolagem travada por um deles)? Tambem conta um
 * controle do topo do AppShell aberto (menu da conta, busca, sino; eles marcam aria-expanded) e alguem
 * digitando. So o topo (data-member-topbar) e so o que esta na tela: um painel escondido que ficou montado
 * (o Tutor IA da aula tem um <header> com aria-expanded) nao segura o pop-up ate a desistencia.
 */
export function hasBlockingLayer(doc: LayerDocument) {
  if (doc.body.style.overflow === "hidden" || doc.documentElement.style.overflow === "hidden") {
    return true;
  }

  if (Array.from(doc.querySelectorAll('[data-member-topbar] [aria-expanded="true"]')).some(isShown)) {
    return true;
  }

  if (doc.activeElement?.matches(TYPING_TARGETS)) {
    return true;
  }

  return Array.from(doc.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')).some(
    (element) => !element.closest("[data-member-popup]") && isShown(element)
  );
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
    case "bridge_pending":
      return "recheck";
    default:
      return "drop";
  }
}

/** Passou da hora de desistir (10 min depois da hora dela, nao do comeco da pagina); null nunca desiste. */
export function givenUp(armed: Pick<ArmedPopup, "giveUpAt">, now: number) {
  return armed.giveUpAt !== null && now > armed.giveUpAt;
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

const PLAN_TRIGGERS: readonly string[] = POPUP_TRIGGERS;
const PLAN_STOPS: readonly (string | null)[] = ["click", "never", null];

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? (value as string[]) : null;
}

function planItemOf(value: unknown): PlanItem | null {
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
    // Livre: o host baixa o pedaco do cartao Livre antes do POST /show; outro valor some (Padrão/Personalizado).
    ...(item.design === "free" ? { design: "free" as const } : {}),
    exclude,
    id: item.id,
    notBefore: item.notBefore as string | null,
    pages,
    // v3b-2: o Comeca (hora do servidor) so quando le como data; senao a chave some.
    ...(typeof item.startsAt === "string" && Number.isFinite(Date.parse(item.startsAt)) ? { startsAt: item.startsAt } : {}),
    stopOn: (item.stopOn ?? null) as PlanItem["stopOn"],
    trigger: item.trigger as HostTrigger
  };
}

/**
 * A parte `popups` do resumo, sem confiar no formato: o que nao se le vira null (nenhum pop-up nesta
 * janela de 1 minuto) e um item estranho do plano sai sozinho.
 */
export function readPopupsAnswer(value: unknown): PlanAnswer | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const answer = value as Record<string, unknown>;
  const pages = stringList(answer.pages);

  if (typeof answer.asOf !== "string" || !pages) {
    return null;
  }

  const plan = Array.isArray(answer.plan)
    ? answer.plan.map(planItemOf).filter((item): item is PlanItem => item !== null)
    : null;

  return { asOf: answer.asOf, pages, plan };
}

/** Diferenca entre a hora do servidor e a do navegador quando a resposta chegou (0 se nao der para ler). */
export function clockOffsetOf(asOf: string, arrivedAt: number) {
  const server = Date.parse(asOf);

  return Number.isFinite(server) ? server - arrivedAt : 0;
}
