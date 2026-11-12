"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type ReactNode
} from "react";
import { cn } from "@/lib/utils";
import { LIVE_ROOM_RULES } from "./live-room-model";
import { RoomPill } from "./room-pill";
import {
  nextSnackbar,
  SNACKBAR_HOLD_FREE,
  snackbarHoldStep,
  snackbarPlacement,
  snackbarRemainingMs,
  type RoomSnack,
  type SnackbarHold,
  type SnackbarPlacement
} from "./room-snackbar-model";

// O aviso da sala no estilo do YouTube (docs/31, a sala no estilo do YouTube; o snackbar do YouTube): a caixa
// invertida (clara no tema escuro, escura no claro) de raio 8, de 288 a 448 px a partir de lg (abaixo, a largura que o
// lugar da), com 48 px de altura minima; o texto 14/20 em ate 2 linhas (o leitor de tela le a frase inteira) e, quando
// ha, a acao em pilula M de texto na cor da acao do aviso, com o nome exato da frase. Nada de icone, barra lateral ou X.
// O anel de 1 px e a sombra (--room-snackbar-shadow) separam a caixa do video, que pode ter qualquer cor. Entra subindo
// do pe com a opacidade (0,5 s, sem movimento com prefers-reduced-motion); o mesmo tipo de aviso fica no lugar.
// A regiao (role="status", polida, atomica) fica sempre montada, vazia sem aviso, para o leitor de tela ouvir o que
// chega. O tempo, um de cada vez e o lugar sao do modelo (room-snackbar-model.ts) e de quem mostra: a classe do lugar
// vem de fora (className), e a peca so desenha. O ponteiro em cima ou o foco dentro pausam o tempo, e ele so volta a
// contar quando os dois saem (snackbarHoldStep; WCAG 2.2.1): a peca guarda cada um no seu e avisa (onPauseChange) so
// quando o pausado muda. O aviso nao toma o foco. So tokens --room-*; nenhuma frase escrita aqui.

export type RoomSnackbarProps = {
  /** A classe do lugar (no palco, preso ao pe da tela, acima do campo ou no pe do painel), de quem mostra o aviso. */
  className?: string;
  /** A acao do aviso (a `key` dela). */
  onAction?: (key: string) => void;
  /**
   * O tempo para (true: o ponteiro em cima ou o foco dentro) e volta a contar (false: os dois sairam). Chega so quando
   * muda; quem mostra guarda o ultimo valor, que vale tambem para o aviso seguinte (o ponteiro pode continuar em cima).
   */
  onPauseChange?: (paused: boolean) => void;
  placement: SnackbarPlacement;
  snack: RoomSnack | null;
};

export function RoomSnackbar({ className, onAction, onPauseChange, placement, snack }: RoomSnackbarProps) {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const holdRef = useRef<SnackbarHold>(SNACKBAR_HOLD_FREE);
  const snackKey = snack?.key ?? null;

  /** Um passo da pausa: so a mudanca do pausado chega a quem mostra. */
  function hold(change: Partial<SnackbarHold>) {
    const step = snackbarHoldStep(holdRef.current, change);
    holdRef.current = step.hold;
    if (step.paused !== null) {
      onPauseChange?.(step.paused);
    }
  }

  // A caixa que troca (outro aviso) ou sai leva junto o botao focado, e o navegador nao avisa a saida do foco: depois
  // de cada troca, o foco e conferido na tela (o ponteiro continua sendo ouvido, porque a regiao fica).
  useEffect(() => {
    const region = regionRef.current;
    if (!region) {
      return;
    }
    const step = snackbarHoldStep(holdRef.current, { focus: region.contains(document.activeElement) });
    holdRef.current = step.hold;
    if (step.paused !== null) {
      onPauseChange?.(step.paused);
    }
  }, [onPauseChange, snackKey]);

  /** O foco que sai para fora do aviso (o que vai do texto para a acao dele continua dentro). */
  function onBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      hold({ focus: false });
    }
  }

  const action = snack?.action;
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className={className}
      data-room-snackbar={placement}
      onBlur={onBlur}
      onFocus={() => hold({ focus: true })}
      onPointerEnter={() => hold({ pointer: true })}
      onPointerLeave={() => hold({ pointer: false })}
      ref={regionRef}
      role="status"
    >
      {snack ? (
        <div
          className="flex min-h-12 w-full max-w-[448px] items-center rounded-[8px] bg-room-snackbar-bg text-room-snackbar-fg shadow-[var(--room-snackbar-shadow)] motion-safe:animate-[room-snack-in_0.5s_ease] lg:min-w-[288px]"
          key={snack.key}
        >
          {/* A margem (e nao o recuo) em volta do texto, como no YouTube: o corte das 2 linhas vale na borda do recuo, e
              com recuo a terceira linha apareceria embaixo. */}
          <p className="mx-3 my-2 line-clamp-2 min-w-0 flex-1 text-sm font-normal leading-5" data-testid="live-notice">
            {snack.text}
          </p>
          {action ? (
            <RoomPill
              // A pilula de texto no aviso invertido: a cor da acao, o hover dela, o pressionado e o anel do foco do
              // lado invertido (o anel e o pressionado da sala sumiriam na caixa clara do tema escuro).
              className="mr-3 text-room-snackbar-action hover:bg-room-snackbar-action-hover active:shadow-[inset_0_0_0_999px_var(--room-press-inverse)] focus-visible:outline-room-snackbar-fg"
              label={action.label}
              onClick={() => onAction?.(action.key)}
              tone="text"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Quem mostra o aviso: o estado (um de cada vez, os 6 s com a pausa), o contexto e o lugar na tela
 * ---------------------------------------------------------------------------------------------- */

/** O que as pecas de dentro da sala usam: mostrar e tirar um aviso, e dizer a altura do campo (abaixo de lg). */
export type RoomSnackbarApi = {
  /** Tira o aviso desse tipo, se e ele que esta na tela. */
  clear: (key: string) => void;
  /** A altura da faixa do campo de cada lugar (o chat, as Perguntas); 0 quando ela sai. O aviso fica acima da maior. */
  composer: (source: string, px: number) => void;
  /** Mostra o aviso: o novo troca o atual na hora, e o mesmo tipo so reinicia o tempo (nextSnackbar). */
  show: (snack: RoomSnack) => void;
};

/** O estado do aviso da sala, de quem desenha a sala (o palco e a raiz do dialogo leem as medidas daqui). */
export type RoomSnackbarController = {
  api: RoomSnackbarApi;
  /** A maior faixa de campo na tela (o --room-composer-h da raiz do dialogo). */
  composerPx: number;
  /** O respiro da lista do chat (a altura do aviso e os vaos), so com o aviso acima do campo da folha aberta. */
  listInsetPx: number;
  /** A caixa do aviso mudou (a altura, 0 sem aviso, e o lugar): quem mostra mede. */
  onBox: (box: { height: number; placement: SnackbarPlacement }) => void;
  onPauseChange: (paused: boolean) => void;
  snack: RoomSnack | null;
  /** Quanto as pilulas do palco sobem (o --room-snackbar-offset do palco), so com o aviso no palco. */
  stageOffsetPx: number;
};

/** O vao entre o aviso e o que fica acima dele (as pilulas do palco, a ultima mensagem do chat). */
const SNACKBAR_GAP_PX = 8;

/**
 * O estado do aviso da sala: um de cada vez (nextSnackbar), os 6 s de LIVE_ROOM_RULES.noticeMs contados so fora da pausa
 * (o ponteiro em cima ou o foco dentro, snackbarRemainingMs) e o aviso "enquanto durar" (persistent) sem tempo.
 * `onGone` ouve cada aviso que sai da tela (o tempo acabou, outro tomou o lugar, a acao ou o clear): a sala ao vivo
 * solta o aviso da barra para ele poder voltar.
 */
export function useRoomSnackbarController(input: { durationMs?: number; onGone?: (key: string) => void } = {}): RoomSnackbarController {
  const durationMs = input.durationMs ?? LIVE_ROOM_RULES.noticeMs;
  const [shown, setShown] = useState<{ snack: RoomSnack | null; tick: number }>({ snack: null, tick: 0 });
  const [paused, setPaused] = useState(false);
  const [box, setBox] = useState<{ height: number; placement: SnackbarPlacement }>({ height: 0, placement: "stage" });
  const [composerPx, setComposerPx] = useState(0);
  const snackRef = useRef<RoomSnack | null>(null);
  const tickRef = useRef(0);
  // O tempo ja contado do aviso de agora (o `tick` de quando ele entrou ou recomecou), fora das pausas.
  const elapsedRef = useRef({ ms: 0, tick: 0 });
  const composersRef = useRef<Record<string, number>>({});
  const onGoneRef = useRef(input.onGone);
  useEffect(() => {
    onGoneRef.current = input.onGone;
  });

  const api = useMemo<RoomSnackbarApi>(() => {
    function put(snack: RoomSnack | null) {
      tickRef.current += 1;
      elapsedRef.current = { ms: 0, tick: tickRef.current };
      snackRef.current = snack;
      setShown({ snack, tick: tickRef.current });
    }
    return {
      clear(key) {
        if (snackRef.current?.key !== key) {
          return;
        }
        put(null);
        onGoneRef.current?.(key);
      },
      composer(source, px) {
        const height = Math.max(0, Math.round(px));
        if (composersRef.current[source] === height) {
          return;
        }
        composersRef.current = { ...composersRef.current, [source]: height };
        setComposerPx(Math.max(0, ...Object.values(composersRef.current)));
      },
      show(incoming) {
        const current = snackRef.current;
        const step = nextSnackbar(current, incoming);
        put(step.snack);
        if (current && !step.restart) {
          onGoneRef.current?.(current.key);
        }
      }
    };
  }, []);

  const { snack, tick } = shown;
  useEffect(() => {
    if (!snack || snack.persistent) {
      return;
    }
    const counted = elapsedRef.current.tick === tick ? elapsedRef.current.ms : 0;
    const remaining = snackbarRemainingMs({ durationMs, elapsedMs: counted, paused });
    if (remaining === null) {
      return;
    }
    const startedAt = Date.now();
    const id = window.setTimeout(() => api.clear(snack.key), remaining);
    return () => {
      window.clearTimeout(id);
      // A pausa (ou o mesmo aviso que sai) guarda o que ja contou; o aviso que entrou ou recomecou ja zerou o tempo.
      if (elapsedRef.current.tick === tick) {
        elapsedRef.current = { ms: elapsedRef.current.ms + (Date.now() - startedAt), tick };
      }
    };
  }, [api, durationMs, paused, snack, tick]);

  const onBox = useCallback((next: { height: number; placement: SnackbarPlacement }) => {
    setBox((previous) => (previous.height === next.height && previous.placement === next.placement ? previous : next));
  }, []);

  const visible = snack !== null && box.height > 0;
  const stageOffsetPx = visible && box.placement === "stage" ? box.height + SNACKBAR_GAP_PX : 0;
  // A lista termina no campo, e o aviso fica 8 px acima dele: a ultima mensagem fica 8 px acima do aviso.
  const listInsetPx = visible && box.placement === "sheet" ? box.height + SNACKBAR_GAP_PX * 2 : 0;
  return useMemo(
    () => ({ api, composerPx, listInsetPx, onBox, onPauseChange: setPaused, snack, stageOffsetPx }),
    [api, composerPx, listInsetPx, onBox, snack, stageOffsetPx]
  );
}

const RoomSnackbarApiContext = createContext<RoomSnackbarApi | null>(null);
const RoomSnackbarStateContext = createContext<RoomSnackbarController | null>(null);

/** O aviso da sala para as pecas de dentro (o chat, as Perguntas, quem mostra). `value` vem de useRoomSnackbarController. */
export function RoomSnackbarProvider({ children, value }: { children: ReactNode; value: RoomSnackbarController }) {
  return (
    <RoomSnackbarApiContext.Provider value={value.api}>
      <RoomSnackbarStateContext.Provider value={value}>{children}</RoomSnackbarStateContext.Provider>
    </RoomSnackbarApiContext.Provider>
  );
}

/** Mostrar e tirar o aviso da sala; nulo fora dela (a gaveta do vertical e o console seguem com a frase no lugar). */
export function useRoomSnackbar(): RoomSnackbarApi | null {
  return useContext(RoomSnackbarApiContext);
}

/** O respiro da lista do chat com o aviso acima do campo da folha aberta (abaixo de lg); 0 nos outros lugares. */
export function useRoomSnackbarListInset(): number {
  return useContext(RoomSnackbarStateContext)?.listInsetPx ?? 0;
}

const DESKTOP_QUERY = "(min-width: 1024px)";
const LANDSCAPE_QUERY = "(orientation: landscape)";

function subscribeQuery(query: string, callback: () => void): () => void {
  try {
    const media = window.matchMedia(query);
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  } catch {
    return () => undefined;
  }
}

function readQuery(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

const subscribeDesktop = (callback: () => void) => subscribeQuery(DESKTOP_QUERY, callback);
const subscribeLandscape = (callback: () => void) => subscribeQuery(LANDSCAPE_QUERY, callback);
const readDesktop = () => readQuery(DESKTOP_QUERY);
const readLandscape = () => readQuery(LANDSCAPE_QUERY);
const serverFalse = () => false;

/**
 * A classe de cada lugar (snackbarPlacement): no palco, no canto de baixo a esquerda, 8 px acima do selo de quem
 * apresenta (a partir de lg; no celular deitado com o painel fechado, mais perto da borda); abaixo de lg, em pe, preso ao
 * pe da tela, acima do campo da folha aberta (--room-composer-h, da raiz do dialogo) ou na folga do safe-area; deitado,
 * no pe da coluna do painel ao lado. No palco a largura acompanha a frase, ate 448 px.
 */
const SNACKBAR_PLACE: Record<SnackbarPlacement, string> = {
  screen: "fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+8px)] z-[61]",
  sheet: "fixed inset-x-2 bottom-[calc(var(--room-composer-h,0px)+8px)] z-[61]",
  side: "fixed right-2 w-[272px] bottom-[calc(var(--room-composer-h,0px)+8px)] z-[61]",
  stage: "absolute bottom-[calc(42px+var(--room-video-bottom,0px))] left-2 z-30 max-w-[calc(100%-1rem)] lg:bottom-[calc(3.5rem+var(--room-video-bottom,0px))] lg:left-4 lg:max-w-[calc(100%-2rem)]"
};

/**
 * Quem mostra o aviso da sala, dentro do palco: le o estado do RoomSnackbarProvider, escolhe o lugar pela largura, pela
 * orientacao e pelo painel (snackbarPlacement) e mede a caixa (a altura vai as pilulas do palco e ao respiro do chat).
 * Fora da caixa nada recebe o toque: o video por baixo continua clicavel. A acao chega a quem desenha a sala (`onAction`)
 * e o aviso sai.
 */
export function RoomSnackbarHost({ onAction, panelShown }: { onAction?: (key: string) => void; panelShown: boolean }) {
  const controller = useContext(RoomSnackbarStateContext);
  const desktop = useSyncExternalStore(subscribeDesktop, readDesktop, serverFalse);
  const landscape = useSyncExternalStore(subscribeLandscape, readLandscape, serverFalse);
  const placement = snackbarPlacement({ desktop, landscape, panelShown });
  const boxRef = useRef<HTMLDivElement | null>(null);
  const onBox = controller?.onBox;

  useEffect(() => {
    const element = boxRef.current;
    if (!element || !onBox) {
      return;
    }
    const report = () => onBox({ height: element.offsetHeight, placement });
    report();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onBox, placement]);

  if (!controller) {
    return null;
  }
  const { api, onPauseChange, snack } = controller;
  return (
    <div className={cn("pointer-events-none", SNACKBAR_PLACE[placement])} data-room-snackbar-host="" ref={boxRef}>
      <RoomSnackbar
        className="[&>*]:pointer-events-auto"
        onAction={(key) => {
          onAction?.(key);
          if (snack) {
            api.clear(snack.key);
          }
        }}
        onPauseChange={onPauseChange}
        placement={placement}
        snack={snack}
      />
    </div>
  );
}
