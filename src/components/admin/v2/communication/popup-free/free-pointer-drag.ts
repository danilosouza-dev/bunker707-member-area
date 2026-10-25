// Ajudante de ponteiro do editor Livre (docs/27 §13.9, L4a): segue um gesto de arrastar com eventos de ponteiro, o
// mesmo para as Camadas, as camadas de fundo, a sequencia no desenho e o painel Elementos (o HTML5 DnD nao entra).
// - Comeca so com o botao 0, isPrimary e um pointerType aceito NESTA chamada (padrao: so o mouse; o desenho e a
//   ficha do Fundo, que tem touch-action: none, passam mouse e caneta). O toque segue so tocando.
// - Do pointerdown em diante ouve pointermove, pointerup e pointercancel na janela, em captura e filtrando pelo
//   pointerId: o pointerup chega mesmo se a captura falhar ou o alvo desmontar.
// - A captura (setPointerCapture, em try/catch) so vem depois do limiar: capturar ja no pointerdown mudaria o alvo
//   do click e do dblclick (o duplo clique de editar texto, o clique de selecionar nas Camadas e o de acrescentar
//   no Elementos). Antes do limiar, soltar e so um clique e nada e chamado.
// - Depois do limiar: o pointerup solta (onDrop, uma vez); Esc, pointercancel, o blur da janela e um pointermove com
//   buttons 0 (o botao solto fora da janela, no WebKit) cancelam (onCancel). O lostpointercapture e ignorado: gravar
//   ali poria o elemento num lugar que ninguem escolheu.
// - Com o gesto comecado, toda tecla e engolida (preventDefault + stopPropagation), menos as proprias Shift, Alt,
//   Control e Meta: o Esc do editor nao sobe para a caixa de fora, e Ctrl + Z, Delete ou colar no meio nao deixam
//   velhos os indices calculados. O arrastar nativo do navegador (dragstart) nao comeca enquanto o gesto e seguido.
// - Quando um gesto comecado termina, um bloqueador na janela, em captura, engole um click: ele sai no primeiro
//   click, no proximo pointerdown ou 350 ms depois do botao solto (cancelado com o botao ainda apertado, por Esc ou
//   blur, os 350 ms contam do pointerup que ainda vem).
// Nada aqui toca na janela ao carregar: a janela vem de start.currentTarget.ownerDocument.defaultView, e o arquivo
// e carregado pelos testes do Node (free-fields.tsx entra em varios deles). Sem JSX, sem HTML e sem CSS em texto.

/** Um ponto em px de tela (clientX, clientY); o mesmo formato de FreePoint (free-editor-geometry). */
type FreePoint = { x: number; y: number };

/** Quem pode arrastar. O toque fica de fora no L4a (rolar e tocar continuam como sao). */
export type FreePointerKind = "mouse" | "pen";

/** Padrao: so o mouse. Sem touch-action: none no alvo, a caneta rola o painel e o navegador manda pointercancel. */
export const FREE_POINTER_MOUSE: readonly FreePointerKind[] = ["mouse"];

/** Mouse e caneta: so onde o alvo tem touch-action: none (o cartao do desenho e a ficha do Fundo). */
export const FREE_POINTER_MOUSE_AND_PEN: readonly FreePointerKind[] = ["mouse", "pen"];

/** Quanto tempo o click que vem depois de um gesto comecado fica engolido, a contar do botao solto. */
export const FREE_POINTER_CLICK_GUARD_MS = 350;

/** O pointerdown que comeca o gesto (o evento do React serve: o currentTarget e lido na hora da chamada). */
export type FreePointerStart = {
  button: number;
  clientX: number;
  clientY: number;
  currentTarget: Element;
  isPrimary: boolean;
  pointerId: number;
  pointerType: string;
};

export type FreePointerHandlers = {
  /** O gesto comecado acabou sem soltar (Esc, pointercancel, blur da janela ou o botao solto fora da janela). */
  onCancel: () => void;
  /** O botao foi solto depois do limiar, neste ponto (px de tela). Chamado uma vez. */
  onDrop: (client: FreePoint) => void;
  /** O ponteiro andou depois do limiar (o primeiro vem logo depois de onStart). */
  onMove: (client: FreePoint) => void;
  /** O ponteiro passou do limiar: e a hora de tirar a foto do design (antes disso, o gesto pode ser so um clique). */
  onStart?: () => void;
  /** Os pointerType aceitos nesta chamada. Padrao: FREE_POINTER_MOUSE. */
  pointerTypes?: readonly FreePointerKind[];
  /** Distancia em px de tela (a partir do pointerdown) que transforma o clique em arrastar. */
  threshold: number;
};

/** As teclas que passam com o gesto comecado (Shift, Alt, Control e Meta sozinhas). */
const FREE_POINTER_MODIFIER_KEYS: ReadonlySet<string> = new Set(["Alt", "Control", "Meta", "Shift"]);

/**
 * Ouvintes em captura sempre com o objeto (nunca o `true` solto): o EventTarget do Node so tira um ouvinte de
 * captura quando o remove recebe { capture: true }, e o navegador aceita os dois.
 */
const CAPTURE: AddEventListenerOptions = { capture: true };

/**
 * Segue o gesto que comeca neste pointerdown. Devolve a funcao que desliga tudo (ouvintes, bloqueador do click e o
 * relogio) sem chamar nenhum handler: quem chama a usa ao desmontar. Nao chame no fim do gesto, que ja se desliga
 * sozinho e precisa deixar o bloqueador do click no lugar.
 */
export function followFreePointer(start: FreePointerStart, handlers: FreePointerHandlers): () => void {
  const element = start.currentTarget;
  const view = element.ownerDocument?.defaultView ?? null;
  const accepted = handlers.pointerTypes ?? FREE_POINTER_MOUSE;

  if (!view || start.button !== 0 || !start.isPrimary || !accepted.some((kind) => kind === start.pointerType)) {
    return () => {};
  }

  const win = view;
  const pointerId = start.pointerId;
  const origin: FreePoint = { x: start.clientX, y: start.clientY };
  // pending: antes do limiar; dragging: o gesto comecou; held: cancelado com o botao ainda apertado (espera o
  // pointerup para contar os 350 ms); guard: so o bloqueador do click; off: tudo desligado.
  let state: "dragging" | "guard" | "held" | "off" | "pending" = "pending";
  let timer: number | null = null;

  const ours = (event: PointerEvent) => event.pointerId === pointerId;
  const pointOf = (event: PointerEvent): FreePoint => ({ x: event.clientX, y: event.clientY });

  function onPointerMove(event: PointerEvent) {
    if (!ours(event)) {
      return;
    }

    // Botao solto sem pointerup (fora da janela, no WebKit): antes do limiar era so um clique.
    if (event.buttons === 0) {
      if (state === "dragging") {
        endGesture("guard");
        handlers.onCancel();
      } else {
        stop();
      }

      return;
    }

    if (state === "pending") {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < handlers.threshold) {
        return;
      }

      state = "dragging";

      try {
        element.setPointerCapture(pointerId);
      } catch {
        // Sem captura (alvo desmontado ou ponteiro ja solto): os ouvintes da janela seguem o gesto do mesmo jeito.
      }

      handlers.onStart?.();
    }

    handlers.onMove(pointOf(event));
  }

  function onPointerUp(event: PointerEvent) {
    if (!ours(event)) {
      return;
    }

    if (state === "dragging") {
      endGesture("guard");
      handlers.onDrop(pointOf(event));
    } else {
      // Antes do limiar: e um clique, que segue o caminho de sempre.
      stop();
    }
  }

  function onPointerCancel(event: PointerEvent) {
    if (!ours(event)) {
      return;
    }

    if (state === "dragging") {
      endGesture("guard");
      handlers.onCancel();
    } else {
      stop();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (state !== "dragging" || FREE_POINTER_MODIFIER_KEYS.has(event.key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      endGesture("held");
      handlers.onCancel();
    }
  }

  // Ouvido sem captura: o blur de um campo nao sobe ate a janela, entao so o blur da propria janela chega aqui.
  function onBlur() {
    if (state === "dragging") {
      endGesture("held");
      handlers.onCancel();
    } else {
      stop();
    }
  }

  function onDragStart(event: Event) {
    event.preventDefault();
  }

  function onHeldUp(event: PointerEvent) {
    if (!ours(event)) {
      return;
    }

    win.removeEventListener("pointerup", onHeldUp, CAPTURE);
    win.removeEventListener("pointercancel", onHeldUp, CAPTURE);
    armTimer();
  }

  function onGuardClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    stop();
  }

  function onGuardPointerDown() {
    stop();
  }

  function removeGesture() {
    win.removeEventListener("pointermove", onPointerMove, CAPTURE);
    win.removeEventListener("pointerup", onPointerUp, CAPTURE);
    win.removeEventListener("pointercancel", onPointerCancel, CAPTURE);
    win.removeEventListener("keydown", onKeyDown, CAPTURE);
    win.removeEventListener("dragstart", onDragStart, CAPTURE);
    win.removeEventListener("blur", onBlur);
  }

  function armTimer() {
    state = "guard";
    timer = win.setTimeout(stop, FREE_POINTER_CLICK_GUARD_MS);
  }

  /** Fim de um gesto comecado: tira os ouvintes do gesto e liga o bloqueador do click. */
  function endGesture(next: "guard" | "held") {
    removeGesture();
    win.addEventListener("click", onGuardClick, CAPTURE);
    win.addEventListener("pointerdown", onGuardPointerDown, CAPTURE);

    if (next === "held") {
      state = "held";
      win.addEventListener("pointerup", onHeldUp, CAPTURE);
      win.addEventListener("pointercancel", onHeldUp, CAPTURE);
    } else {
      armTimer();
    }
  }

  /** Desliga tudo sem chamar handler (tambem e a funcao devolvida). */
  function stop() {
    state = "off";
    removeGesture();
    win.removeEventListener("pointerup", onHeldUp, CAPTURE);
    win.removeEventListener("pointercancel", onHeldUp, CAPTURE);
    win.removeEventListener("click", onGuardClick, CAPTURE);
    win.removeEventListener("pointerdown", onGuardPointerDown, CAPTURE);

    if (timer !== null) {
      win.clearTimeout(timer);
      timer = null;
    }
  }

  win.addEventListener("pointermove", onPointerMove, CAPTURE);
  win.addEventListener("pointerup", onPointerUp, CAPTURE);
  win.addEventListener("pointercancel", onPointerCancel, CAPTURE);
  win.addEventListener("keydown", onKeyDown, CAPTURE);
  win.addEventListener("dragstart", onDragStart, CAPTURE);
  win.addEventListener("blur", onBlur);

  return stop;
}
