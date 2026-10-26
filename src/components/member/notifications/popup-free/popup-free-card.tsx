"use client";

import { X } from "lucide-react";
import { useMemo, useSyncExternalStore, type MouseEvent, type RefCallback } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";
import type { PopupItem } from "@/server/communications/notification-model";
import type { PopupFontFace } from "@/server/communications/popup-design-model";
import type { FreeId, PopupFreeDesign } from "@/server/communications/popup-free-model";
import { freeStorageOrigin, popupFreeDialogAria as dialogAriaOfDesign, resolveFreeForDevice } from "@/server/communications/popup-free-render";
import type { NotificationLink } from "../notifications-model";
import { usePopupMotion } from "../popup-design/popup-design-media";
import { usePopupFontFaces } from "../popup-design/popup-font-loader";
import { FreeNodes, freeRenderContextOf } from "./popup-free-nodes";
import { freeDeviceOfWindow, freeDeviceSnapshot, freeServerDevice, subscribeFreeDevice, type FreeDevice } from "./popup-free-device";
import { FREE_FOCUS_CLASS, FREE_TOUCH_CLASS, freeArtboardCss, freeCloseCss, freeOuterCss, type FreeDragPreview } from "./popup-free-styles";

// Pop-up Livre do aluno (docs/27; spec §3): a prancheta montada do zero pela equipe (elementos na sequencia e
// soltos, um por cima do outro), com texto de verdade, estilos so por objetos de estilo do React montados de
// valores validados (popup-free-styles.ts), midia e fontes so dos nossos buckets e o X sempre por cima (fora da
// prancheta, zIndex 60, 44 px de toque). O mesmo cartao no dialogo do aluno (pelo MemberPopupCard, num pedaco
// proprio: popup-free-load.ts) e na previa do editor (`preview`, `editorNodeRef`, `dragPreview`).
//
// No celular o cartao inteiro encolhe na mesma proporcao (cqw do elemento de fora), com texto nunca abaixo de
// 12 px. Valores do celular (docs/27 §1 e §9.10): o cartao desenha resolveFreeForDevice(design, aparelho). As
// previas do admin passam `device` (a de 375 px = "mobile"); o aluno nao passa e o aparelho sai da largura da tela
// (FREE_MOBILE_QUERY de popup-free-device.ts, ate 767 px), lida antes de desenhar (useSyncExternalStore, como o
// usePopupMotion: o cartao do aluno so desenha no navegador, depois do /show, entao ja vem certo no primeiro
// desenho; no servidor, computador). Mudou a largura com o pop-up aberto (girar o celular): troca na hora (a janela
// ouve o mesmo aparelho para o nome do dialogo). Sem valores do celular, o computador e o mesmo objeto do design e o
// HTML e o de antes.

export type PopupFreeCardProps = {
  accessPreviewMode?: AccessPreviewMode;
  bodyId?: string;
  design: PopupFreeDesign;
  /** Só as prévias do admin: o aparelho desenhado (a de 375 px = "mobile"). O aluno nunca passa: sem, vale a largura da tela (FREE_MOBILE_QUERY). */
  device?: "desktop" | "mobile";
  /**
   * Só o editor, durante um arrastar: deslocamento provisório (px da prancheta) de um elemento solto, ou de vários
   * juntos (`ids`), desenhado com `translate` sem mudar o design (§4.4).
   */
  dragPreview?: FreeDragPreview | null;
  /** Só o editor: recebe o elemento do DOM de cada elemento do design (medir, selecionar). Nunca no diálogo do aluno. */
  editorNodeRef?: (id: FreeId, element: HTMLElement | null) => void;
  fonts?: readonly PopupFontFace[];
  /**
   * Só o editor ("Ver com o mouse em cima", L6c): o Botão ou os Links que mostram as cores ao passar o mouse sem o
   * mouse (`data-free-hover-on`). Vale só com `preview`; o aluno nunca passa.
   */
  hoverPreviewId?: FreeId | null;
  nudgeClose?: boolean;
  onClose?: () => void;
  /** O 3º argumento diz qual botão foi: "cta" (o Botão principal) ou `link:<id>` (um "Abrir um link"). */
  onCta?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink, button?: string) => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  playing?: boolean;
  popup: PopupItem;
  /** Prévia do admin: mesmo visual, sem links, áudio parado, botões sem ação; Imagem/Vídeo sem arquivo viram um quadriculado com "Escolha a imagem". */
  preview?: boolean;
  /** Só prévia (miniaturas dos modelos, docs/28): o vídeo fica no modo "still" (o poster como imagem; nada do vídeo é baixado). O aluno nunca passa. */
  still?: boolean;
  /** Só testes: a origem do Storage (o cartão usa STORAGE_ORIGIN). */
  storageOrigin?: string | null;
  titleId?: string;
};

export { FREE_MOBILE_QUERY, freeDeviceOfWindow, freeServerDevice, subscribeFreeDevice } from "./popup-free-device";

/**
 * O nome e a descricao do dialogo do Livre (popup-free-render.ts) pelo design do aparelho: um titulo ou um texto
 * escondido so no celular nao da nome nem descricao ali. A janela le daqui, do pedaco ja baixado, e passa o
 * aparelho que ela mesma ouve (popup-free-device.ts: troca junto com o cartao ao cruzar os 767 px); sem `device`,
 * a tela de agora (no servidor, o computador).
 */
export function popupFreeDialogAria(
  popup: Pick<PopupItem, "body" | "freeDesign" | "title">,
  ids: { bodyId: string; titleId: string },
  device: FreeDevice = typeof window === "undefined" ? freeServerDevice() : freeDeviceOfWindow(window)
) {
  return dialogAriaOfDesign(popup.freeDesign ? { ...popup, freeDesign: resolveFreeForDevice(popup.freeDesign, device) } : popup, ids);
}

/** A origem do nosso Supabase, conferida uma vez (a mesma variavel do Supabase no navegador). */
const STORAGE_ORIGIN = freeStorageOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const NO_FACES: readonly PopupFontFace[] = [];

type EditorNodeRef = (id: FreeId, element: HTMLElement | null) => void;

/**
 * Um ref estavel por elemento e por funcao do editor (o editor mede pelo elemento do DOM; uma funcao nova a cada
 * desenho o faria medir de novo). Memoria fraca: some junto com a funcao do editor.
 */
const NODE_REFS = new WeakMap<EditorNodeRef, Map<FreeId, RefCallback<HTMLElement>>>();

function stableNodeRef(editorNodeRef: EditorNodeRef | undefined, id: FreeId): RefCallback<HTMLElement> | undefined {
  if (!editorNodeRef) {
    return undefined;
  }

  let refs = NODE_REFS.get(editorNodeRef);

  if (!refs) {
    refs = new Map();
    NODE_REFS.set(editorNodeRef, refs);
  }

  let ref = refs.get(id);

  if (!ref) {
    ref = (element) => editorNodeRef(id, element);
    refs.set(id, ref);
  }

  return ref;
}

// O X: 44 px de toque pelo ::before (o circulo visivel fica com o tamanho escolhido), pulso do "Só no X".
const CLOSE_CLASS = cn(FREE_TOUCH_CLASS, "before:rounded-full transition-[filter,scale] duration-150 hover:brightness-125 motion-reduce:transition-none", FREE_FOCUS_CLASS);

export function PopupFreeCard({
  accessPreviewMode,
  bodyId,
  design,
  device,
  dragPreview = null,
  editorNodeRef,
  fonts,
  hoverPreviewId,
  nudgeClose = false,
  onClose,
  onCta,
  onDismiss,
  onSnooze,
  playing = true,
  popup,
  preview = false,
  still = false,
  storageOrigin,
  titleId
}: PopupFreeCardProps) {
  // O hook continua sendo chamado sempre (regra dos hooks); a previa do admin decide pelo `device` que passa.
  const screenDevice = useSyncExternalStore(subscribeFreeDevice, freeDeviceSnapshot, freeServerDevice);
  const drawn = useMemo(() => resolveFreeForDevice(design, device ?? screenDevice), [design, device, screenDevice]);
  const faces = fonts ?? popup.fonts ?? NO_FACES;
  const fontsReady = usePopupFontFaces(faces);
  // O hook continua sendo chamado sempre (regra dos hooks); `still` so troca o resultado na previa.
  const preferredMotion = usePopupMotion();
  const motion = still ? "still" : preferredMotion;
  const origin = storageOrigin === undefined ? STORAGE_ORIGIN : storageOrigin;
  const ctx = freeRenderContextOf({
    accessPreviewMode,
    bodyId,
    design: drawn,
    dragPreview,
    faces,
    hoverPreviewId,
    motion,
    onClose,
    onCta,
    onDismiss,
    onSnooze,
    origin,
    playing,
    popup,
    preview,
    refFor: (id) => stableNodeRef(editorNodeRef, id),
    titleId
  });
  const close = freeCloseCss(drawn);
  const closeClassName = cn(CLOSE_CLASS, nudgeClose && "motion-safe:scale-[1.12]");

  return (
    <div data-fonts-ready={fontsReady ? "" : undefined} data-free-device={device} data-popup-free="" style={freeOuterCss(drawn)}>
      <div data-free-artboard="" style={freeArtboardCss(drawn, ctx.style)}>
        <FreeNodes ctx={ctx} nodes={drawn.children} parentDir="column" />
      </div>
      {preview ? (
        <span aria-hidden="true" className={closeClassName} data-free-close="" style={close.button}>
          <X style={close.icon} strokeWidth={2.4} />
        </span>
      ) : (
        <button aria-label="Fechar" className={closeClassName} data-free-close="" onClick={onClose} style={close.button} type="button">
          <X aria-hidden="true" style={close.icon} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

/** O pedaco do cartao Livre exporta o cartao como padrao (o React.lazy do MemberPopupCard recebe a porta direto). */
export default PopupFreeCard;
