// A Oferta na sala e no console, a parte pura (docs/30 §1.6, §2.4, §3.6, §5.1, §8.6 e M7): a janela da oferta no
// relogio do video de cada sessao (pelo minuto marcado na oferta ou pela linha gravada em webinar_offer_displays), o
// prazo real por sessao, o que o aluno recebe (StudentOfferView, nunca o link do checkout), a foto do que foi mostrado,
// quem ja tem o produto, a recusa do clique fora da janela e as contagens do console. Sem "server-only", imports
// relativos e sem node:crypto (a variante e o token ficam em offer-model.ts, so no servidor): a sala do aluno e o
// console tambem importam daqui, e os testes carregam direto pelo Node. Nada aqui le o banco nem o relogio de verdade.
//
// Regras da janela (docs/30 §2.2 e §8.6):
// - "Num minuto do video" (at_offset): aparece em showAtOffsetMs e some `visibleMinutes` depois (nulo = ate o fim). Na
//   sessao gravada a primeira leitura depois do minuto grava UMA linha em webinar_offer_displays com a foto das
//   variantes ligadas e o prazo real (hora marcada + minuto + deadline_minutes): e dela que o painel e o relatorio
//   tiram "Viram a oferta", e ela manda dali em diante (editar a oferta depois nao muda o que a sessao mostrou). No
//   Replay livre a linha nasce na primeira leitura e acompanha o minuto marcado enquanto a equipe nao mexer; o card
//   nunca mostra prazo no replay (cada aluno assiste numa hora: um prazo por aluno seria o prazo falso do §8.6). Nem na
//   sessao "Comeca quando voce entra" (jit): cada horario e uma sessao nova, e o prazo recomecaria a cada 15 ou 30 min
//   para a mesma pessoa, o "prazo que se repete em toda sessao sem ser verdade" do §8.6.
// - "Pelo botao da equipe" (manual): so com a linha do console (Mostrar agora) sem hidden_at; o prazo conta da hora em
//   que a equipe mostrou a primeira vez e nao recomeca ao mostrar de novo.
// - "Nunca": nada aparece.

import { OFFER_VARIANT_LABELS, toTime, type OfferClick, type OfferDisplay, type OfferDisplaySnapshot, type OfferVariant, type OfferVariantLabel, type StudentOfferView, type WebinarOffer, type WebinarSession } from "./model";
import { sessionOffsetMs } from "./room-model";

/** O card relido pela sala: a cada 60 s; na sessao gravada com o card na tela ou pelo botao da equipe, a cada 20 s. */
export const OFFER_POLL_MS = 60_000;
export const OFFER_MANUAL_POLL_MS = 20_000;

/** Os limites do offset gravado (o check de webinar_offer_displays e webinar_offer_clicks na 202610290005). */
export const OFFER_OFFSET_MIN_MS = -86_400_000;
export const OFFER_OFFSET_MAX_MS = 172_800_000;

const MINUTE = 60_000;

export type OfferSessionLike = Pick<WebinarSession, "id" | "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt" | "status">;

/** A janela da oferta numa sessao, no relogio do video (ms). */
export type OfferWindow = {
  /** O prazo real (instante ISO); nulo = sem prazo na tela. */
  deadlineAt: string | null;
  /** A equipe escondeu no console (hidden_at). */
  hidden: boolean;
  /** Onde some; nulo = ate o fim do video. */
  hideAtMs: number | null;
  showAtMs: number;
  /** "display": a linha gravada da sessao manda; "planned": o minuto marcado na oferta, ainda sem linha. */
  source: "display" | "planned";
};

export function clampOfferOffset(value: number): number {
  return Math.min(OFFER_OFFSET_MAX_MS, Math.max(OFFER_OFFSET_MIN_MS, Math.round(value)));
}

/** "Some em": minutos depois de aparecer; nulo = ate o fim. */
export function offerHideAtMs(showAtMs: number, visibleMinutes: number | null): number | null {
  return visibleMinutes && visibleMinutes > 0 ? clampOfferOffset(showAtMs + visibleMinutes * MINUTE) : null;
}

/** A sessao em que um prazo na tela seria falso: o replay, a live e cada horario do "Comeca quando voce entra". */
export function offerWithoutDeadline(session: Pick<WebinarSession, "kind"> & { jit?: boolean | null }): boolean {
  return session.kind !== "simulated" || session.jit === true;
}

/**
 * O prazo real do "Num minuto do video" (docs/30 §8.6): so na sessao gravada de hora marcada, a hora marcada (o zero
 * do video) + o minuto em que aparece + os minutos de prazo. No replay, na live e na sessao jit, nulo.
 */
export function offerDeadlineAt(input: { deadlineMinutes: number | null; session: Pick<WebinarSession, "kind" | "scheduledAt"> & { jit?: boolean | null }; showAtMs: number }): string | null {
  if (offerWithoutDeadline(input.session) || !input.deadlineMinutes || input.deadlineMinutes <= 0) {
    return null;
  }
  const zero = toTime(input.session.scheduledAt);
  return Number.isFinite(zero) ? new Date(zero + input.showAtMs + input.deadlineMinutes * MINUTE).toISOString() : null;
}

/** A janela pelo minuto marcado na oferta ("Num minuto do video"); nos outros gatilhos, nula. */
export function plannedOfferWindow(
  offer: Pick<WebinarOffer, "deadlineMinutes" | "showAtOffsetMs" | "triggerKind" | "visibleMinutes">,
  session: Pick<WebinarSession, "kind" | "scheduledAt"> & { jit?: boolean | null }
): OfferWindow | null {
  if (offer.triggerKind !== "at_offset" || offer.showAtOffsetMs === null || session.kind === "live") {
    return null;
  }
  const showAtMs = clampOfferOffset(offer.showAtOffsetMs);
  return {
    deadlineAt: offerDeadlineAt({ deadlineMinutes: offer.deadlineMinutes, session, showAtMs }),
    hidden: false,
    hideAtMs: offerHideAtMs(showAtMs, offer.visibleMinutes),
    showAtMs,
    source: "planned"
  };
}

/** A janela que a linha gravada da sessao guardou (o que a sessao mostrou de verdade). */
export function displayOfferWindow(display: Pick<OfferDisplay, "deadlineAt" | "hiddenAt" | "hideOffsetMs" | "showOffsetMs">): OfferWindow {
  return { deadlineAt: display.deadlineAt, hidden: display.hiddenAt !== null, hideAtMs: display.hideOffsetMs, showAtMs: display.showOffsetMs, source: "display" };
}

/**
 * A janela da oferta nesta sessao: a linha gravada quando existe; senao o minuto marcado. A live nunca tem. Na sessao
 * jit nunca ha prazo, nem numa linha gravada antes desta regra.
 */
export function offerWindowFor(input: {
  display: Pick<OfferDisplay, "deadlineAt" | "hiddenAt" | "hideOffsetMs" | "showOffsetMs"> | null;
  offer: Pick<WebinarOffer, "deadlineMinutes" | "showAtOffsetMs" | "triggerKind" | "visibleMinutes">;
  session: Pick<WebinarSession, "kind" | "scheduledAt"> & { jit?: boolean | null };
}): OfferWindow | null {
  if (input.session.kind === "live" || input.offer.triggerKind === "never") {
    return null;
  }
  if (input.display) {
    const window = displayOfferWindow(input.display);
    return input.session.jit === true ? { ...window, deadlineAt: null } : window;
  }
  return plannedOfferWindow(input.offer, input.session);
}

export function isInOfferWindow(window: Pick<OfferWindow, "hideAtMs" | "showAtMs"> | null, offsetMs: number): boolean {
  if (!window || !Number.isFinite(offsetMs)) {
    return false;
  }
  return offsetMs >= window.showAtMs && (window.hideAtMs === null || offsetMs < window.hideAtMs);
}

export function offerDeadlinePassed(deadlineAt: string | null, nowMs: number): boolean {
  if (!deadlineAt) {
    return false;
  }
  const deadline = toTime(deadlineAt);
  return Number.isFinite(deadline) && deadline <= nowMs;
}

/**
 * O offset do clique e do console: na sessao gravada, o relogio do servidor (agora - hora marcada; o do corpo e
 * ignorado); no Replay livre, a posicao do player que o corpo trouxe; na live, NaN (a oferta nunca aparece la).
 */
export function offerOffsetMs(session: Pick<WebinarSession, "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt">, nowMs: number, bodyOffsetMs?: number | null): number {
  if (session.kind === "simulated") {
    const offset = sessionOffsetMs(session, nowMs);
    return Number.isFinite(offset) ? Math.round(offset) : Number.NaN;
  }
  if (session.kind === "replay") {
    return typeof bodyOffsetMs === "number" && Number.isFinite(bodyOffsetMs) ? Math.round(bodyOffsetMs) : Number.NaN;
  }
  return Number.NaN;
}

/** O card esta na tela neste offset (dentro da janela e sem o Esconder da equipe valendo). */
export function offerOnScreen(window: OfferWindow | null, offsetMs: number): boolean {
  if (!window || !isInOfferWindow(window, offsetMs)) {
    return false;
  }
  // Escondida: o fim da janela ja e o minuto do Esconder; sem ele (linha antiga), escondida e fora.
  return !(window.hidden && window.hideAtMs === null);
}

/** 409 { reason: "offer_hidden" } (docs/30 §5.1): fora da janela, escondida ou com o prazo vencido. */
export function offerClickRefusal(input: { nowMs: number; offsetMs: number; window: OfferWindow | null }): "offer_hidden" | null {
  if (!offerOnScreen(input.window, input.offsetMs)) {
    return "offer_hidden";
  }
  return offerDeadlinePassed(input.window?.deadlineAt ?? null, input.nowMs) ? "offer_hidden" : null;
}

/**
 * Se a leitura do aluno grava agora a linha da sessao (uma vez): so o "Num minuto do video" sem linha; na gravada, a
 * partir do minuto, dentro da janela e antes do fim do video (o que a sessao mostrou de verdade); no replay, ja na
 * primeira leitura (o minuto e o mesmo para todos, no relogio do player).
 */
export function shouldRecordOfferDisplay(input: { durationMs: number; offsetMs: number; session: Pick<WebinarSession, "kind" | "status">; window: OfferWindow | null }): boolean {
  const { session, window } = input;
  if (!window || window.source !== "planned" || session.status === "cancelled") {
    return false;
  }
  if (session.kind === "replay") {
    return true;
  }
  if (session.kind !== "simulated" || session.status === "ended") {
    return false;
  }
  return isInOfferWindow(window, input.offsetMs) && input.offsetMs < input.durationMs;
}

/**
 * No replay, a linha acompanha o minuto marcado enquanto a equipe nao mexeu nela (shown_by nulo): a equipe mudou o
 * minuto ou o "Some em" no editor, a linha do replay muda junto (a gravada guarda o que mostrou e nunca muda assim).
 */
export function replayDisplayOutdated(display: Pick<OfferDisplay, "hiddenAt" | "hideOffsetMs" | "showOffsetMs" | "shownBy">, planned: OfferWindow | null): boolean {
  if (!planned || display.shownBy !== null || display.hiddenAt !== null) {
    return false;
  }
  return display.showOffsetMs !== planned.showAtMs || display.hideOffsetMs !== planned.hideAtMs;
}

/* ------------------------------------------------------------------------------------------------
 * A linha de webinar_offer_displays (docs/30 §8.6: "o relatorio guarda o que foi mostrado")
 * ---------------------------------------------------------------------------------------------- */

/** A foto das variantes ligadas no momento (titulo, selo, precos, cupom) e o prazo. */
export function offerDisplaySnapshot(offer: Pick<WebinarOffer, "variants">, input: { capturedAt: string; deadlineAt: string | null }): OfferDisplaySnapshot {
  return {
    capturedAt: input.capturedAt,
    deadlineAt: input.deadlineAt,
    variants: offer.variants
      .filter((variant) => variant.enabled)
      .map((variant) => ({
        badge: variant.badge,
        coupon: variant.coupon,
        headline: variant.headline,
        label: variant.label,
        priceFromLabel: variant.priceFromLabel,
        priceLabel: variant.priceLabel
      }))
  };
}

/** A linha que a sessao grava (a forma de OfferDisplayInsert de offer-store.ts). */
export type OfferDisplayDraft = {
  deadline_at: string | null;
  hide_offset_ms: number | null;
  offer_id: string;
  session_id: string;
  show_offset_ms: number;
  shown_by: string | null;
  snapshot: OfferDisplaySnapshot;
};

/** A linha do "Num minuto do video", gravada pela primeira leitura do aluno (shown_by nulo: foi o relogio). */
export function plannedOfferDisplayDraft(input: { nowMs: number; offer: Pick<WebinarOffer, "id" | "variants">; sessionId: string; window: OfferWindow }): OfferDisplayDraft {
  return {
    deadline_at: input.window.deadlineAt,
    hide_offset_ms: input.window.hideAtMs,
    offer_id: input.offer.id,
    session_id: input.sessionId,
    show_offset_ms: input.window.showAtMs,
    shown_by: null,
    snapshot: offerDisplaySnapshot(input.offer, { capturedAt: new Date(input.nowMs).toISOString(), deadlineAt: input.window.deadlineAt })
  };
}

/**
 * "Mostrar agora" (o console): aparece no offset de agora e some `visibleMinutes` depois (ou no fim). Mostrar de novo
 * guarda o comeco mais cedo da sessao (o relatorio conta quem esteve em algum ponto da janela) e o prazo da primeira
 * vez (o prazo real nao recomeca a cada clique, docs/30 §8.6).
 */
export function manualOfferDisplay(input: {
  existing: Pick<OfferDisplay, "deadlineAt" | "showOffsetMs"> | null;
  /** A sessao e um horario do "Comeca quando voce entra": sem prazo (docs/30 §8.6). */
  jit?: boolean;
  nowMs: number;
  offer: Pick<WebinarOffer, "deadlineMinutes" | "id" | "variants" | "visibleMinutes">;
  offsetMs: number;
  sessionId: string;
  userId: string;
}): OfferDisplayDraft & { hidden_at: null; hidden_by: null; shown_at: string } {
  const now = Math.round(input.offsetMs);
  const show = clampOfferOffset(input.existing ? Math.min(input.existing.showOffsetMs, now) : now);
  const hide = offerHideAtMs(now, input.offer.visibleMinutes);
  const deadlineAt = input.jit
    ? null
    : (input.existing?.deadlineAt ?? (input.offer.deadlineMinutes && input.offer.deadlineMinutes > 0 ? new Date(input.nowMs + input.offer.deadlineMinutes * MINUTE).toISOString() : null));
  const shownAt = new Date(input.nowMs).toISOString();
  return {
    deadline_at: deadlineAt,
    hidden_at: null,
    hidden_by: null,
    hide_offset_ms: hide === null ? null : Math.max(show, hide),
    offer_id: input.offer.id,
    session_id: input.sessionId,
    show_offset_ms: show,
    shown_at: shownAt,
    shown_by: input.userId,
    snapshot: offerDisplaySnapshot(input.offer, { capturedAt: shownAt, deadlineAt })
  };
}

/** "Esconder" (o console): a janela fecha no offset de agora. */
export function hideOfferDisplayPatch(input: { display: Pick<OfferDisplay, "hideOffsetMs" | "showOffsetMs">; nowMs: number; offsetMs: number; userId: string }) {
  const now = Math.round(input.offsetMs);
  const end = input.display.hideOffsetMs === null ? now : Math.min(input.display.hideOffsetMs, now);
  return { hidden_at: new Date(input.nowMs).toISOString(), hidden_by: input.userId, hide_offset_ms: clampOfferOffset(Math.max(input.display.showOffsetMs, end)) };
}

/* ------------------------------------------------------------------------------------------------
 * O que o aluno recebe
 * ---------------------------------------------------------------------------------------------- */

/** O card do aluno: a variante dele e a janela, sem o link do checkout nem os pesos. */
export function studentOfferView(input: {
  offer: Pick<WebinarOffer, "id">;
  variant: Pick<OfferVariant, "badge" | "coupon" | "headline" | "imageUrl" | "label" | "priceFromLabel" | "priceLabel">;
  visible: boolean;
  window: OfferWindow;
}): StudentOfferView {
  const { variant, window } = input;
  return {
    badge: variant.badge,
    coupon: variant.coupon,
    deadlineAt: window.deadlineAt,
    headline: variant.headline,
    hideAtMs: window.hideAtMs,
    imageUrl: variant.imageUrl,
    offerId: input.offer.id,
    priceFromLabel: variant.priceFromLabel,
    priceLabel: variant.priceLabel,
    showAtMs: window.showAtMs,
    variant: variant.label,
    visible: input.visible
  };
}

/**
 * Quanto a sala espera para reler o card: 60 s; quando a equipe pode mudar a tela agora (a oferta "Pelo botao da
 * equipe" esperando o Mostrar agora, ou o card na tela que o Esconder tira) numa sessao gravada que ainda nao
 * terminou, 20 s.
 */
export function studentOfferPollMs(input: { session: Pick<WebinarSession, "kind" | "status">; teamMayChange: boolean }): number {
  const open = input.session.kind === "simulated" && input.session.status !== "ended" && input.session.status !== "cancelled";
  return input.teamMayChange && open ? OFFER_MANUAL_POLL_MS : OFFER_POLL_MS;
}

/** Se o card aparece neste segundo do video (a sala confere a cada segundo pelo proprio relogio). */
export function shouldShowOffer(view: Pick<StudentOfferView, "hideAtMs" | "showAtMs"> | null, offsetMs: number): boolean {
  if (!view || view.showAtMs === null) {
    return false;
  }
  return isInOfferWindow({ hideAtMs: view.hideAtMs, showAtMs: view.showAtMs }, offsetMs);
}

/** A chave da janela: Fechar esconde ate a proxima janela (uma chave nova faz o card voltar). */
export function offerWindowKey(view: Pick<StudentOfferView, "hideAtMs" | "offerId" | "showAtMs" | "variant">): string {
  return `${view.offerId}:${view.variant}:${view.showAtMs ?? ""}:${view.hideAtMs ?? ""}`;
}

/** "Termina em 12:34" (mm:ss) ou "1:02:03" (h:mm:ss) quando passa de uma hora. */
export function offerCountdownText(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/* ------------------------------------------------------------------------------------------------
 * Quem ja tem o produto (o card some, docs/30 §1.6)
 * ---------------------------------------------------------------------------------------------- */

export type OfferEntitlementLike = { ends_at: string | null; product_id?: string | null; starts_at: string | null; status: string; target_id: string; target_type: string };

/**
 * O aluno ja tem o produto da oferta: um acesso ativo e na janela que aponta para o produto (target_id, ou o
 * product_id da venda) ou o coringa da plataforma. O provedor de venda nunca decide aqui: so os acessos internos.
 */
export function ownsOfferProduct(entitlements: readonly OfferEntitlementLike[], productId: string, nowMs: number): boolean {
  return entitlements.some((row) => {
    if (row.status !== "active") {
      return false;
    }
    const start = row.starts_at ? toTime(row.starts_at) : Number.NaN;
    const end = row.ends_at ? toTime(row.ends_at) : Number.NaN;
    if ((Number.isFinite(start) && start > nowMs) || (Number.isFinite(end) && end < nowMs)) {
      return false;
    }
    if (row.target_type === "platform") {
      return row.target_id === "platform" || row.target_id === "*";
    }
    return row.target_id === productId || (row.product_id ?? null) === productId;
  });
}

/* ------------------------------------------------------------------------------------------------
 * O console: os cliques por variante ao vivo
 * ---------------------------------------------------------------------------------------------- */

export type OfferVariantClicks = { clicks: number; label: OfferVariantLabel; students: number };
export type OfferClickCounts = { byVariant: OfferVariantClicks[]; clicks: number; students: number };

/** Cliques e alunos por variante (as letras da oferta, na ordem A..D, mais as que so aparecem nos cliques). */
export function offerClickCounts(clicks: readonly Pick<OfferClick, "userId" | "variantLabel">[], labels: readonly OfferVariantLabel[] = []): OfferClickCounts {
  const wanted = new Set<OfferVariantLabel>([...labels, ...clicks.map((click) => click.variantLabel)]);
  const byVariant = OFFER_VARIANT_LABELS.filter((label) => wanted.has(label)).map((label) => {
    const mine = clicks.filter((click) => click.variantLabel === label);
    return { clicks: mine.length, label, students: new Set(mine.map((click) => click.userId)).size };
  });
  return { byVariant, clicks: clicks.length, students: new Set(clicks.map((click) => click.userId)).size };
}

/** O minuto do video (para "Aparece aos 45 min"). */
export function offerMinute(offsetMs: number): number {
  return Math.max(0, Math.floor(offsetMs / MINUTE));
}
