"use client";

import { BarChart3, ChevronDown, ChevronUp, Pin } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomMessage } from "@/lib/webinar-room-client";
import type { StudentPoll } from "../room-api";
import { RoomChatComment, roomCommentTime, type RoomChatTiming } from "../room-chat";
import { pinnedClampHint, pinnedPillText } from "../room-layout-model";
import { RoomPill } from "../room-pill";
import { RoomPollCard, type PollAnswerHandler } from "../room-polls";
import { ROOM_FOCUS } from "../room-ui";

// As fixadas na sala do aluno (Na tela, R1 e R2; especificacao de 10/11/2026, §3.1 e §3.6), na Live ao vivo e na
// gravada, na espera e no ar (nunca no Replay, com a sessao encerrada nem para quem foi removido; pinnedShownIn):
// - a area das fixadas (RoomPinnedArea): sai da aba Chat e vira um espaco do proprio painel (o `pinned` do RoomPanel,
//   entre a linha das abas e o conteudo), em Chat, Perguntas, Participantes e Enquetes, e o topo da gaveta da sala
//   vertical. Primeiro a mensagem ("Fixada pela equipe", o comentario do chat com o avatar, o nome, o selo do papel e o
//   tempo; o texto cortado em 3 linhas com "Mostrar tudo" / "Mostrar menos", aria-expanded, e o link da equipe
//   clicavel), depois a enquete ("Enquete fixada pela equipe" e o RoomPollCard de sempre: responde ali mesmo;
//   respondida, recolhe numa linha "Resposta enviada" com Mostrar / Recolher; com o resultado compartilhado, abre com as
//   barras). Quem a envolve (o painel, a gaveta) limita a 40 % da altura e rola por dentro;
// - com o painel fechado, as pilulas do palco (RoomPinnedPills, no canto de cima a esquerda, abaixo dos selos, so com o
//   palco de 640 px ou mais: "Fixada · {texto em 1 linha}" abre o painel no Chat; "Enquete fixada · {pergunta}" traz a
//   enquete ao meio do palco se falta responder, senao abre o painel) e, no palco mais estreito, as mesmas duas como
//   linhas de 56 px logo abaixo do palco e acima da barra (RoomPinnedStrip). Sao botoes. A regra dos 640 px e so CSS:
//   cada um e o proprio recipiente `@container/tela` (a camada das pilulas cobre a caixa do palco; a faixa tem a largura
//   da coluna, a mesma do palco), sem medir em JavaScript e sem piscar. A faixa inteira da Na tela (banner e QR Code, a
//   capa que manda tudo para a faixa) e da fatia seguinte, que junta estas linhas a ela;
// - o pedido de foco na area (usePinnedFocus: a pilula e o Ver do aviso abrem o painel e levam o foco ao bloco, que tem
//   tabIndex -1 e fica fora da trava do Tab) e o corte medido (useClampToggle: o ResizeObserver diz se o corte escondeu
//   alguma coisa; antes da medida, a dica pura pinnedClampHint; a gaveta e a linha do vertical usam o mesmo).
// Nada aqui decide se aparece: a sala calcula (room-layout-model.ts) e passa. So tokens --room-*; nenhuma frase escrita
// aqui (WEBINAR_COPY.naTela.aluno).

/**
 * O corte do texto com "Mostrar tudo" / "Mostrar menos": `ref` e o elemento cortado (line-clamp). Fechado, o
 * ResizeObserver mede se o corte escondeu alguma coisa (o primeiro aviso chega logo depois de observar, e o painel
 * fechado que abre mede de novo); antes da medida (o HTML do servidor), vale a dica. Aberto, o botao fica para fechar.
 * O texto que muda (`resetKey`) volta fechado.
 */
export function useClampToggle(ref: RefObject<HTMLElement | null>, { hint, resetKey }: { hint: boolean; resetKey: string }): { clampable: boolean; expanded: boolean; toggle: () => void } {
  const [state, setState] = useState<{ expanded: boolean; key: string; measured: boolean | null }>({ expanded: false, key: resetKey, measured: null });
  if (state.key !== resetKey) {
    setState({ expanded: false, key: resetKey, measured: null });
  }
  const expanded = state.key === resetKey && state.expanded;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const measured = element.scrollHeight - element.clientHeight > 1;
      setState((previous) => (previous.measured === measured ? previous : { ...previous, measured }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, ref, resetKey]);

  const toggle = useCallback(() => setState((previous) => ({ ...previous, expanded: !previous.expanded })), []);
  const measured = state.key === resetKey ? state.measured : null;
  return { clampable: expanded || (measured ?? hint), expanded, toggle };
}

/** O bloco da area que recebe o foco pedido (a pilula, a linha da faixa, o Ver do aviso). */
export type PinnedFocusTarget = "message" | "poll";

/**
 * O pedido de foco na area das fixadas: quem abre o painel pela pilula, pela linha da faixa ou pelo Ver do aviso pede,
 * e o foco vai ao bloco (a mensagem ou a enquete) que esta na tela depois da pintura em que o painel abriu. A pilula e o
 * aviso saem da tela nesse momento: sem isso, o foco cairia no body.
 */
export function usePinnedFocus(rootRef: RefObject<HTMLElement | null>): (target: PinnedFocusTarget) => void {
  const [request, setRequest] = useState<{ n: number; target: PinnedFocusTarget } | null>(null);
  useLayoutEffect(() => {
    if (!request) {
      return;
    }
    const blocks = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(`[data-room-pinned-focus="${request.target}"]`) ?? []);
    blocks.find((block) => block.offsetParent !== null)?.focus();
  }, [request, rootRef]);
  return useCallback((target: PinnedFocusTarget) => setRequest((previous) => ({ n: (previous?.n ?? 0) + 1, target })), []);
}

/** O foco no bloco da area (programatico, tabIndex -1): o anel por dentro, que a rolagem da area nao corta. */
const BLOCK_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-room-focus";

/** A mensagem fixada: o comentario do chat com "Fixada pela equipe" em cima e o texto cortado em 3 linhas. */
function RoomPinnedMessage({ message, timing }: { message: RoomMessage; timing: RoomChatTiming }) {
  const copy = WEBINAR_COPY.naTela.aluno;
  const id = useId();
  const bodyRef = useRef<HTMLParagraphElement | null>(null);
  const clamp = useClampToggle(bodyRef, { hint: pinnedClampHint(message.body, 3), resetKey: `${message.id}:${message.body}` });

  return (
    <section aria-labelledby={`${id}-h`} className={cn("px-4 py-3", BLOCK_FOCUS)} data-room-pinned-focus="message" data-testid="room-pinned" tabIndex={-1}>
      <RoomChatComment
        actions={
          clamp.clampable ? (
            <RoomPill
              aria-controls={`${id}-b`}
              aria-expanded={clamp.expanded}
              data-room-pinned-more=""
              label={clamp.expanded ? copy.mostrarMenos : copy.mostrarTudo}
              onClick={clamp.toggle}
              size="s"
              tone="text"
              touch44
            />
          ) : null
        }
        as="div"
        bodyClassName={clamp.expanded ? undefined : "line-clamp-3"}
        bodyId={`${id}-b`}
        bodyRef={bodyRef}
        headline={
          <>
            <Pin aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
            {copy.fixadaPelaEquipe}
          </>
        }
        headlineId={`${id}-h`}
        message={message}
        time={roomCommentTime(message, timing)}
      />
    </section>
  );
}

/**
 * A enquete fixada: o RoomPollCard de sempre. Sem resposta, aberto para responder ali mesmo; respondida, recolhe na
 * linha "Resposta enviada" (dita uma vez pela regiao polida, que fica montada) com Mostrar / Recolher; com o resultado
 * compartilhado, abre de novo com as barras. Cada mudanca (respondida, resultado) volta ao padrao dela.
 */
function RoomPinnedPoll({ onAnswer, poll, readOnly }: { onAnswer: PollAnswerHandler; poll: StudentPoll; readOnly: boolean }) {
  const copy = WEBINAR_COPY.naTela.aluno;
  const id = useId();
  const answered = poll.myOptionIds !== null;
  const mode = `${answered ? "r" : "a"}:${poll.results ? "s" : "n"}`;
  const openByDefault = !answered || poll.results !== null;
  const [state, setState] = useState({ expanded: openByDefault, mode });
  if (state.mode !== mode) {
    setState({ expanded: openByDefault, mode });
  }
  const expanded = state.mode === mode ? state.expanded : openByDefault;

  return (
    <section aria-labelledby={`${id}-h`} className={cn("px-4 py-3", BLOCK_FOCUS)} data-room-pinned-focus="poll" data-room-pinned-poll={poll.id} data-testid="room-pinned-poll" tabIndex={-1}>
      <p className="flex items-center gap-1.5 text-xs leading-[18px] text-room-fg-subtle" id={`${id}-h`}>
        <BarChart3 aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
        {copy.enqueteFixadaPelaEquipe}
      </p>
      <div className={cn("flex items-center justify-between gap-2", answered ? "mt-1 min-h-8" : null)}>
        <p aria-live="polite" className="min-w-0 truncate text-sm font-semibold text-room-success-fg">
          {answered ? copy.respostaEnviada : ""}
        </p>
        {answered ? (
          <RoomPill
            aria-controls={`${id}-c`}
            aria-expanded={expanded}
            label={expanded ? copy.recolher : copy.mostrar}
            onClick={() => setState({ expanded: !expanded, mode })}
            size="s"
            tone="text"
            touch44
            trailing={expanded ? ChevronUp : ChevronDown}
          />
        ) : null}
      </div>
      <div className="mt-2" hidden={!expanded} id={`${id}-c`}>
        <RoomPollCard key={`${poll.id}:${answered ? "r" : "a"}:${poll.status}`} onAnswer={onAnswer} poll={poll} readOnly={readOnly} />
      </div>
    </section>
  );
}

export type RoomPinnedAreaProps = {
  /** A mensagem fixada (nula sem ela). */
  message: RoomMessage | null;
  onAnswer: PollAnswerHandler;
  /** A enquete fixada como o aluno a tem (pinnedPollFor; nula sem ela). */
  poll: StudentPoll | null;
  /** "Ver como", a sessao que acabou: a enquete so mostra. */
  readOnly: boolean;
  /** O tempo do comentario da fixada (o mesmo do chat). */
  timing: RoomChatTiming;
};

/** A area das fixadas do painel e da gaveta: a mensagem, depois a enquete. Sem nenhuma das duas, nada. */
export function RoomPinnedArea({ message, onAnswer, poll, readOnly, timing }: RoomPinnedAreaProps) {
  if (!message && !poll) {
    return null;
  }
  return (
    <div className="flex flex-col divide-y divide-room-panel-border" data-testid="room-pinned-area">
      {message ? <RoomPinnedMessage key={message.id} message={message} timing={timing} /> : null}
      {poll ? <RoomPinnedPoll key={poll.id} onAnswer={onAnswer} poll={poll} readOnly={readOnly} /> : null}
    </div>
  );
}

export type RoomPinnedShortcutsProps = {
  message: RoomMessage | null;
  /** A pilula ou a linha da mensagem: abre o painel no Chat. */
  onMessage: () => void;
  /** A pilula ou a linha da enquete: o palco (falta responder) ou o painel (pinnedPollPillStep). */
  onPoll: () => void;
  poll: StudentPoll | null;
};

/** A pilula sobre o video: as cores sobre o video da sala (o selo de quem apresenta), 32 px, o texto numa linha. */
const PILL = cn(
  "pointer-events-auto inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-room-on-video-bg px-3 text-xs font-semibold text-room-on-video-fg shadow-[0_1px_2px_rgba(0,0,0,0.3)] hover:opacity-90 [&_svg]:size-3.5 [&_svg]:shrink-0",
  ROOM_FOCUS
);

/**
 * As pilulas das fixadas no palco com o painel fechado: uma camada que cobre a caixa do palco sem receber o toque (o
 * video por baixo continua clicavel) e e o proprio recipiente `@container/tela`; as pilulas, no canto de cima a
 * esquerda, abaixo dos selos (42 px abaixo de lg, 56 px a partir de lg), so aparecem com 640 px ou mais de palco.
 */
export function RoomPinnedPills({ message, onMessage, onPoll, poll }: RoomPinnedShortcutsProps) {
  if (!message && !poll) {
    return null;
  }
  const copy = WEBINAR_COPY.naTela.aluno;
  return (
    <div className="@container/tela pointer-events-none absolute inset-0 z-20" data-room-pinned-pills="">
      <div className="absolute left-2 top-[42px] hidden max-w-[min(380px,calc(100%-1rem))] flex-col items-start gap-1.5 @min-[640px]/tela:flex lg:left-4 lg:top-14 lg:max-w-[min(380px,calc(100%-2rem))]">
        {message ? (
          <button className={PILL} data-room-pinned-pill="message" onClick={onMessage} type="button">
            <Pin aria-hidden="true" strokeWidth={2} />
            <span className="min-w-0 truncate">{copy.pilulaFixada(pinnedPillText(message.body))}</span>
          </button>
        ) : null}
        {poll ? (
          <button className={PILL} data-room-pinned-pill="poll" onClick={onPoll} type="button">
            <BarChart3 aria-hidden="true" strokeWidth={2} />
            <span className="min-w-0 truncate">{copy.pilulaEnquete(poll.question)}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A linha da faixa: 56 px, o icone num quadro de 40, o rotulo e o texto numa linha cada. */
const ROW = cn("flex min-h-14 w-full shrink-0 items-center gap-3 px-3 py-2 text-left hover:bg-room-control-hover focus-visible:-outline-offset-2", ROOM_FOCUS);
const ROW_ICON = "grid size-10 shrink-0 place-items-center rounded-[10px] bg-room-control text-room-fg [&_svg]:size-4";

/**
 * As linhas das fixadas no palco mais estreito (abaixo de 640 px de palco, o celular), com o painel fechado: logo
 * abaixo do palco e acima da barra, no fluxo da pagina (nada sobre o video), no maximo 120 px (o resto rola por
 * dentro). O recipiente `@container/tela` e a propria faixa, com a largura da coluna do palco; a partir de lg o palco
 * fechado sempre tem 640 px ou mais, e ela nem entra.
 */
export function RoomPinnedStrip({ message, onMessage, onPoll, poll }: RoomPinnedShortcutsProps) {
  if (!message && !poll) {
    return null;
  }
  const copy = WEBINAR_COPY.naTela.aluno;
  return (
    <div className="@container/tela shrink-0 lg:hidden" data-room-pinned-strip="">
      <div className="flex max-h-[120px] flex-col overflow-y-auto overscroll-contain border-b border-room-border bg-room-surface @min-[640px]/tela:hidden">
        {message ? (
          <button className={ROW} data-room-pinned-row="message" onClick={onMessage} type="button">
            <span aria-hidden="true" className={ROW_ICON}>
              <Pin strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs leading-[18px] text-room-fg-subtle">{copy.fixadaPelaEquipe}</span>
              <span className="truncate text-sm leading-5 text-room-fg">{pinnedPillText(message.body)}</span>
            </span>
          </button>
        ) : null}
        {poll ? (
          <button className={ROW} data-room-pinned-row="poll" onClick={onPoll} type="button">
            <span aria-hidden="true" className={ROW_ICON}>
              <BarChart3 strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs leading-[18px] text-room-fg-subtle">{copy.enqueteFixadaPelaEquipe}</span>
              <span className="truncate text-sm leading-5 text-room-fg">{poll.question}</span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
