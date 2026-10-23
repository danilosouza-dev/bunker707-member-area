"use client";

import { X } from "lucide-react";
import type { MouseEvent, RefCallback } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";
import type { PopupItem } from "@/server/communications/notification-model";
import type { PopupFontFace } from "@/server/communications/popup-design-model";
import type { FreeId, PopupFreeDesign } from "@/server/communications/popup-free-model";
import { freeStorageOrigin } from "@/server/communications/popup-free-render";

// O nome e a descricao do dialogo do Livre (popup-free-render.ts): a janela le daqui, do pedaco ja baixado.
export { popupFreeDialogAria } from "@/server/communications/popup-free-render";
import type { NotificationLink } from "../notifications-model";
import { usePopupMotion } from "../popup-design/popup-design-media";
import { usePopupFontFaces } from "../popup-design/popup-font-loader";
import { FreeNodes, freeRenderContextOf } from "./popup-free-nodes";
import { FREE_FOCUS_CLASS, FREE_TOUCH_CLASS, freeArtboardCss, freeCloseCss, freeOuterCss } from "./popup-free-styles";

// Pop-up Livre do aluno (docs/27; spec §3): a prancheta montada do zero pela equipe (elementos na sequencia e
// soltos, um por cima do outro), com texto de verdade, estilos so por objetos de estilo do React montados de
// valores validados (popup-free-styles.ts), midia e fontes so dos nossos buckets e o X sempre por cima (fora da
// prancheta, zIndex 60, 44 px de toque). O mesmo cartao no dialogo do aluno (pelo MemberPopupCard, num pedaco
// proprio: popup-free-load.ts) e na previa do editor (`preview`, `editorNodeRef`, `dragPreview`).
//
// No celular o cartao inteiro encolhe na mesma proporcao (cqw do elemento de fora), com texto nunca abaixo de
// 12 px. O aluno nao mede nada na v1 (spec §2.10): `device` so existe no editor, que ja passa o design por
// resolveFreeForDevice.

export type PopupFreeCardProps = {
  accessPreviewMode?: AccessPreviewMode;
  bodyId?: string;
  design: PopupFreeDesign;
  /** Só o editor: aparelho da prévia (o editor passa o design por resolveFreeForDevice). Sem = "desktop"; o aluno nunca passa (§2.10). */
  device?: "desktop" | "mobile";
  /** Só o editor, durante um arrastar: deslocamento provisório (px da prancheta) de um elemento solto, desenhado com `translate` sem mudar o design (§4.4). */
  dragPreview?: { dx: number; dy: number; dh?: number; dw?: number; id: FreeId } | null;
  /** Só o editor: recebe o elemento do DOM de cada elemento do design (medir, selecionar). Nunca no diálogo do aluno. */
  editorNodeRef?: (id: FreeId, element: HTMLElement | null) => void;
  fonts?: readonly PopupFontFace[];
  nudgeClose?: boolean;
  onClose?: () => void;
  onCta?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink) => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  playing?: boolean;
  popup: PopupItem;
  /** Prévia do admin: mesmo visual, sem links, áudio parado, botões sem ação; Imagem/Vídeo sem arquivo viram um quadriculado com "Escolha a imagem". */
  preview?: boolean;
  /** Só testes: a origem do Storage (o cartão usa STORAGE_ORIGIN). */
  storageOrigin?: string | null;
  titleId?: string;
};

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
  nudgeClose = false,
  onClose,
  onCta,
  onDismiss,
  onSnooze,
  playing = true,
  popup,
  preview = false,
  storageOrigin,
  titleId
}: PopupFreeCardProps) {
  const faces = fonts ?? popup.fonts ?? NO_FACES;
  const fontsReady = usePopupFontFaces(faces);
  const motion = usePopupMotion();
  const origin = storageOrigin === undefined ? STORAGE_ORIGIN : storageOrigin;
  const ctx = freeRenderContextOf({
    accessPreviewMode,
    bodyId,
    design,
    dragPreview,
    faces,
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
  const close = freeCloseCss(design);
  const closeClassName = cn(CLOSE_CLASS, nudgeClose && "motion-safe:scale-[1.12]");

  return (
    <div data-fonts-ready={fontsReady ? "" : undefined} data-free-device={device} data-popup-free="" style={freeOuterCss(design)}>
      <div data-free-artboard="" style={freeArtboardCss(design, ctx.style)}>
        <FreeNodes ctx={ctx} nodes={design.children} parentDir="column" />
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
