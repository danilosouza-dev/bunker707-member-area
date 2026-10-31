// O que a sala do webinario guarda no navegador de cada pessoa (docs/31 V2-7, V2-10, V2-12 e V2-16): o tema, o painel
// aberto ou fechado, a visao do video e as enquetes que ficaram para depois. Modulo puro (o Node le nos testes): so as
// chaves e as leituras do valor guardado. Quem le e escreve no localStorage e src/components/member/webinars/room/
// use-room-prefs.ts; um valor que falta, vem estragado ou de outra versao vira o padrao.

/** O tema da sala (o mesmo do iframe, LiveRoomTheme): escuro por padrao. */
export type RoomTheme = "dark" | "light";
/** A visao do video que o aluno escolheu: Palco (o padrao) ou Grade (por comando, docs/31 V2-16). */
export type RoomView = "grid" | "stage";
/** As enquetes da sessao que o aluno deixou para depois (`later`) e os resultados que ele ja viu no palco (`seen`). */
export type DeferredPolls = { later: string[]; seen: string[] };

export const ROOM_THEME_KEY = "bunker707:webinar-sala-tema";
export const ROOM_PANEL_KEY = "bunker707:webinar-sala-painel";
export const ROOM_VIEW_KEY = "bunker707:webinar-sala-visao";
export const ROOM_POLLS_KEY = "bunker707:webinar-sala-enquetes";

export const NO_DEFERRED_POLLS: DeferredPolls = Object.freeze({ later: [], seen: [] }) as DeferredPolls;

/** O tema guardado: so "light" vale como claro; o resto (nada, estragado) e o escuro. */
export function storedRoomTheme(value: string | null | undefined): RoomTheme {
  return value === "light" ? "light" : "dark";
}

/** O painel guardado: aberto por padrao, fechado so com "0". */
export function storedPanelOpen(value: string | null | undefined): boolean {
  return value !== "0";
}

/** A visao guardada: Grade so com "grid"; o resto e o Palco. */
export function storedRoomView(value: string | null | undefined): RoomView {
  return value === "grid" ? "grid" : "stage";
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** As enquetes guardadas, so as da sessao aberta: de outra sessao (ou um valor estragado) volta vazio. */
export function storedDeferredPolls(value: string | null | undefined, sessionId: string): DeferredPolls {
  if (!value) {
    return NO_DEFERRED_POLLS;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || (parsed as { sessionId?: unknown }).sessionId !== sessionId) {
      return NO_DEFERRED_POLLS;
    }
    const record = parsed as { later?: unknown; seen?: unknown };
    return { later: idsOf(record.later), seen: idsOf(record.seen) };
  } catch {
    return NO_DEFERRED_POLLS;
  }
}

/** O valor que vai para o ROOM_POLLS_KEY: uma sessao por vez (a nova substitui a de antes). */
export function deferredPollsValue(sessionId: string, polls: DeferredPolls): string {
  return JSON.stringify({ later: polls.later, seen: polls.seen, sessionId });
}
