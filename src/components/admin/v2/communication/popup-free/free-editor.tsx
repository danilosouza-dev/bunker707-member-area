"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import { ArrowLeft, Keyboard, Monitor, Redo2, Save, Smartphone, TriangleAlert, Undo2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PopupFontOption } from "@/server/communications/popup-design-model";
import { findFreeNode, freePreviewPopupItem, resolveFreeForDevice, type FreeId, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import { freeDesignSizePercent, popupFreeHints, type FreeHint, type FreeMeasuredRects } from "@/server/communications/popup-free-checks";
import { freeDesignClipboardText, parseFreeDesignPaste } from "@/server/communications/popup-free-paste";
import type { NoticeDraft } from "@/server/communications/schemas";
import { saveTemplate } from "@/server/communications/template-actions";
import { defaultTemplateName, templateDesignSupportOf, templateErrorsFromAction } from "@/server/communications/template-model";
import { ConfirmDialog } from "../../settings/kit";
import type { ProductPickerItem } from "../../storefront/product-picker";
import { adminTransition } from "../../styles";
import { adminToast } from "../../toast";
import { FreeCanvas, type FreeCanvasApi, type FreeCanvasToolbarCommand } from "./free-canvas";
import { FreeCopyPaste } from "./free-copy-paste";
import { FreeElementsPanel } from "./free-elements-panel";
import type { FreeRect } from "./free-editor-geometry";
import {
  canRedoFreeHistory,
  canUndoFreeHistory,
  createFreeHistory,
  pushFreeHistory,
  redoFreeHistory,
  undoFreeHistory,
  type FreeHistory,
  type FreeHistoryEntry
} from "./free-editor-history";
import {
  FREE_EDITOR_COPY,
  addFreeElement,
  alignFreeNode,
  applyFreeTemplateDesign,
  applyFreeFontAtKey,
  duplicateFreeNode,
  freeAddedAnnouncement,
  freeCtaForNewButton,
  freeDuplicateProblem,
  freeEditorErrorKeys,
  freeEditorErrors,
  freeFlaggedNodeIds,
  freeFocusAfterAdd,
  freeKnownAssets,
  freeNodeIdForKey,
  freeNodeOf,
  freeNodeToFree,
  freeNodeToSequence,
  freeOnlyLinks,
  freeOutsideFieldNames,
  freeParentId,
  freeRemoveProblem,
  freeReviewItems,
  freeSavedMessage,
  freeSaveLabel,
  freeSelectionDescription,
  freeStageDesign,
  freeToFreeProblem,
  isFreeDesignErrorKey,
  moveFreeNodeInList,
  moveFreeNodeIntoBox,
  moveFreeNodeOutOfBox,
  nudgeFreeNode,
  raiseFreeArtboardTo,
  removeFreeNode,
  renameFreeNode,
  setFreeNodeFlag,
  setFreeNodeRect,
  shiftFreeNodeLayer,
  type FreeCatalogKind,
  type FreeReviewItem
} from "./free-editor-model";
import {
  FREE_RECOVERY_DELAY_MS,
  browserFreeRecoveryStorage,
  clearFreeRecovery,
  allowSnoozeToRestore,
  freeDirtySinceSave,
  freeEntrySignature,
  freeRecoveryDiffers,
  freeRecoveryKey,
  freeRecoveryTime,
  readFreeRecovery,
  writeFreeRecovery,
  type FreeRecovery
} from "./free-editor-recovery";
import { FreeInspector, type FreeEditorCommand, type FreeFocusRequest } from "./free-inspector";
import { FreeLayersPanel, type FreeLayerCommand } from "./free-layers-panel";
import { FreeReviewPanel } from "./free-review-panel";
import { FreeTemplatesPanel, useDesignTemplatesLoad, type FreeTemplateItem } from "./free-templates-panel";

// Editor Livre do pop-up (docs/27; spec §4.2): a casca de tela cheia por cima do editor do aviso (Dialog do
// Base UI, `fixed inset-0`), carregada pelo card Design com next/dynamic. Trabalha numa COPIA do design (estado
// local, com desfazer/refazer de { design, cta } juntos) e manda para o rascunho do aviso com atraso: no fim de um
// arrastar, ao parar de digitar (300 ms) e ao fechar. Barra de cima (Concluir, Ver como, zoom, Desfazer, Refazer,
// Revisar, Atalhos, Salvar rascunho), Elementos e Camadas a esquerda, a area de desenho no meio e o painel do
// elemento (pacote I) ou o Revisar a direita. O Esc nao fecha (serve para "selecionar a caixa de fora"): fecha so em
// Concluir. Mudanca nao salva no servidor liga o beforeunload e uma copia de recuperacao no navegador (1 s depois
// da ultima mudanca, apagada ao salvar). Avisos falados numa regiao aria-live.

const copy = FREE_EDITOR_COPY;
/** Espera depois da ultima tecla antes de mandar o design ao rascunho do aviso. */
const FREE_SEND_TYPING_MS = 300;
/** Espera da validacao (zod no navegador) e das dicas depois da ultima mudanca. */
const FREE_CHECK_DELAY_MS = 150;
/** Espera do aviso falado da posicao depois de mover pelas setas. */
const FREE_POSITION_ANNOUNCE_MS = 500;

/* ------------------------------------------------------------------------------------------------
 * Contrato com o pacote Z (spec §9.6)
 * ---------------------------------------------------------------------------------------------- */

export type FreeEditorContent = {
  allowSnooze: boolean;
  /**
   * Links › Conteúdo mostra a chave "Permitir “Lembrar depois”" (padrao). false na pagina do modelo de Design (docs/28
   * §1.7): o modelo nao guarda a regra, entao no lugar da chave fica a nota de que ela se define no aviso.
   */
  allowSnoozeEditable?: boolean;
  audio: NoticeDraft["audio"];
  cta: NoticeDraft["cta"];
  /**
   * Editando um modelo (modo modelo de Pop-up ou pagina do design guardado): o Revisar confere o botao pela regra do
   * modelo (docs/28 D8: texto e destino podem ficar vazios), como o card e o "Salvar modelo".
   */
  ctaOptional?: boolean;
  /** Pagina do modelo de Design (docs/28 §5.7): o destino do Botão principal some (e escolhido em cada aviso). */
  hideCtaDestination?: boolean;
  /**
   * Links › Conteúdo (docs/27 §13.7): a chave "Permitir “Lembrar depois”" e a mesma regra do card "Quantas vezes e
   * como fecha" (campaigns.allow_snooze). Nao entra no historico do Livre (e uma regra do pop-up, como o Áudio).
   */
  onAllowSnoozeChange: (allowSnooze: boolean) => void;
  onCtaChange: (cta: NoticeDraft["cta"]) => void;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  /** O "Volta em" do card (minutos), so para a frase da chave em Links › Conteúdo. */
  snoozeMinutes: number;
  title: string;
};

export type FreeDesignEditorProps = {
  content: FreeEditorContent;
  disabled: boolean;
  fonts: readonly PopupFontOption[];
  initialDesign: PopupFreeDesign;
  /** Abrir já no Revisar ou num elemento (vindo do card Design ou de um erro). */
  initialFocus?: { kind: "review" } | { key: string; kind: "error" } | null;
  /** Id do aviso (null = aviso novo): chave da cópia de recuperação. */
  noticeId: string | null;
  onBusyChange: (reason: string | null) => void;
  onChange: (design: PopupFreeDesign) => void;
  /** `dirtySinceSave`: houve mudança depois do último salvar com sucesso (o Z decide se troca de endereço, §4.13). */
  onClose: (result: { dirtySinceSave: boolean }) => void;
  onFontsChange: (fonts: PopupFontOption[]) => void;
  /**
   * O Z não chama openSavedNotice enquanto o editor Livre está aberto (§4.13). `message` no sucesso: a frase do editor
   * do aviso (pop-up no ar); sem ela, "Rascunho salvo.".
   */
  onSaveDraft: () => Promise<{ message?: string; ok: true } | { errors: Record<string, string>; message: string; ok: false }>;
  open: boolean;
  /** Rotulo do botao de salvar (padrao freeSaveLabel(savesInPlace)); no modo modelo e na pagina do Design, "Salvar modelo". */
  saveLabel?: string;
  /**
   * Pergunta antes de salvar (docs/28 D29: modelo com uma parte que nao abriu). O dialogo abre dentro do editor (por
   * cima dele, como o colar); null = salva direto.
   */
  saveConfirm?: { cancelLabel: string; confirmLabel: string; description: string; title: string } | null;
  /** Pop-up no ar ou pausado: o botão diz "Salvar alterações", como no editor do aviso (docs/27 L16). */
  savesInPlace?: boolean;
  /** Linha de baixo do titulo (padrao content.title); no modo modelo e na pagina do Design, "Modelo: {nome}". */
  subtitle?: string;
  /** Chave da copia de recuperacao (padrao freeRecoveryKey(noticeId)). */
  recoveryKey?: string;
  /**
   * Aba "Modelos" (docs/28 §5.9; null = sem a aba: a pagina do modelo de Design nao tem, o aviso e o modo modelo de
   * Pop-up tem): "Salvar este design como modelo" e "Meus modelos".
   */
  templates?: {
    onApplied: (templateId: string) => void;
    sourceNoticeId: string | null;
    sourceTemplateIds: readonly string[];
  } | null;
  /** Erros do último salvar, já com freeErrorKeys (só as chaves freeDesign.* e as de fora, para a frase). */
  serverErrors: Readonly<Record<string, string>>;
  /** "Trocar de modelo" no card Design (Z): o design de antes vira um passo para trás (Ctrl + Z volta a ele). */
  undoTo?: FreeHistoryEntry | null;
};

/* ------------------------------------------------------------------------------------------------
 * Casca: o Dialog de tela cheia. A sessao (copia de trabalho, historico, selecao) so existe aberta: cada abertura
 * comeca do design que o card Design entrega.
 * ---------------------------------------------------------------------------------------------- */

export function FreeDesignEditor(props: FreeDesignEditorProps) {
  // Quem tinha o foco quando o editor abriu (o botao "Abrir editor Livre"): o foco volta para ele ao fechar,
  // mesmo que o card Design desmonte o editor logo depois.
  const [returnTo] = useState<HTMLElement | null>(() =>
    props.open && typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );

  return (
    <DialogPrimitive.Root
      disablePointerDismissal
      modal
      onOpenChange={(next) => {
        // Esc, clique fora e foco fora nunca fecham: so o Concluir (que chama onClose).
        void next;
      }}
      open={props.open}
    >
      <DialogPrimitive.Portal>
        {props.open ? <FreeEditorSession {...props} returnTo={returnTo} /> : null}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default FreeDesignEditor;

/* ------------------------------------------------------------------------------------------------
 * Sessao
 * ---------------------------------------------------------------------------------------------- */

type CommandKind = "backward" | "duplicate" | "forward" | "moveDown" | "moveUp" | "outOfBox" | "remove" | "toFree" | "toggleHidden" | "toggleLocked" | "toSequence";
type ServerErrorState = { cta: NoticeDraft["cta"]; design: PopupFreeDesign; errors: Record<string, string> } | null;
type Banner = { kind: "error" | "outside" | "wait"; text: string } | null;
type Announcement = { id: number; text: string };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "color", "file", "radio", "range", "reset", "submit"].includes(target.type);
  }

  return target.getAttribute("role") === "spinbutton" || target.getAttribute("role") === "textbox";
}

/** Uma parte do design fora dos elementos (prancheta, X, arquivos, fontes) que uma chave de erro aponta. */
function isDesignPart(field: string, design: PopupFreeDesign): boolean {
  return field !== "children" && field !== "mode" && field !== "version" && Object.hasOwn(design, field);
}

/** Os erros do ultimo salvar que ainda valem: o elemento (ou a parte do design) nao mudou desde aquele salvar. */
function liveServerErrors(state: ServerErrorState, design: PopupFreeDesign, cta: NoticeDraft["cta"]): Record<string, string> {
  if (!state) {
    return {};
  }

  const out: Record<string, string> = {};

  for (const [key, message] of Object.entries(state.errors)) {
    let alive: boolean;

    if (key === "cta" || key.startsWith("cta.")) {
      alive = cta === state.cta;
    } else if (key === "audio") {
      alive = true;
    } else if (key.startsWith("nodes.")) {
      const id = freeNodeIdForKey(state.design, key);
      const before = id ? findFreeNode(state.design, id)?.node : undefined;
      const now = id ? findFreeNode(design, id)?.node : undefined;

      alive = Boolean(before && now === before);
    } else if (isDesignPart(key.split(".")[0], state.design)) {
      // A prancheta, o X, os arquivos ou as fontes: vale enquanto aquela parte do design for a mesma.
      const field = key.split(".")[0] as keyof PopupFreeDesign;

      alive = design[field] === state.design[field];
    } else {
      alive = design === state.design;
    }

    if (alive) {
      out[key] = message;
    }
  }

  return out;
}

/** Erros do salvar (com ou sem "draft.") separados: os do design (chaves do editor) e os de fora do editor. */
function splitSaveErrors(design: PopupFreeDesign, errors: Readonly<Record<string, string>>): { design: Record<string, string>; outside: Record<string, string> } {
  const inside: Record<string, string> = {};
  const outside: Record<string, string> = {};

  for (const [rawKey, message] of Object.entries(errors)) {
    const key = rawKey.startsWith("draft.") ? rawKey.slice("draft.".length) : rawKey;

    if (isFreeDesignErrorKey(key)) {
      inside[key] = message;
    } else {
      outside[key] = message;
    }
  }

  return { design: freeEditorErrorKeys(design, inside), outside };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function FreeEditorSession({
  content,
  disabled,
  fonts,
  initialDesign,
  initialFocus = null,
  noticeId,
  onBusyChange,
  onChange,
  onClose,
  onFontsChange,
  onSaveDraft,
  recoveryKey: recoveryKeyProp,
  returnTo,
  saveConfirm = null,
  saveLabel,
  savesInPlace = false,
  serverErrors,
  subtitle,
  templates = null,
  undoTo = null
}: FreeDesignEditorProps & { returnTo: HTMLElement | null }) {
  const [initialEntry] = useState<FreeHistoryEntry>(() => ({ cta: content.cta, design: initialDesign }));
  const [history, setHistoryState] = useState<FreeHistory>(() =>
    undoTo ? pushFreeHistory(createFreeHistory(undoTo), initialEntry, { coalesceKey: null }) : createFreeHistory(initialEntry)
  );
  const historyRef = useRef<FreeHistory>(history);
  const { cta, design } = history.present;
  const initialNodeId = initialFocus?.kind === "error" ? freeNodeIdForKey(initialDesign, initialFocus.key.replace(/^freeDesign\./, "")) : null;
  const [selectedId, setSelectedId] = useState<FreeId | null>(initialNodeId);
  const [leftTab, setLeftTab] = useState<"elements" | "layers" | "templates">("layers");
  // D29: a pergunta antes do primeiro salvar de um modelo com uma parte que nao abriu.
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [rightPanel, setRightPanel] = useState<"inspector" | "review">(initialFocus?.kind === "review" ? "review" : "inspector");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [zoom, setZoom] = useState<"100" | "fit">("fit");
  const [rects, setRects] = useState<FreeMeasuredRects>({});
  const [focusRequest, setFocusRequest] = useState<FreeFocusRequest | null>(() =>
    initialFocus?.kind === "error" ? { key: initialFocus.key.replace(/^freeDesign\./, "") } : null
  );
  const [busyReason, setBusyReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement>({ id: 0, text: "" });
  const [checks, setChecks] = useState<{ errors: Record<string, string>; hints: FreeHint[] }>(() => ({
    errors: freeEditorErrors(initialDesign, { allowSnooze: content.allowSnooze, audio: content.audio, cta: content.cta, ctaOptional: content.ctaOptional }),
    hints: popupFreeHints(initialDesign, { content: { allowSnooze: content.allowSnooze, ctaLabel: content.cta?.label } })
  }));
  const [serverState, setServerState] = useState<ServerErrorState>(() => {
    const split = splitSaveErrors(initialDesign, serverErrors);

    return Object.keys(split.design).length > 0 ? { cta: content.cta, design: initialDesign, errors: split.design } : null;
  });
  const recoveryKey = recoveryKeyProp ?? freeRecoveryKey(noticeId);
  const [storage] = useState(() => browserFreeRecoveryStorage());
  const [recovery, setRecovery] = useState<FreeRecovery | null>(() => {
    const saved = readFreeRecovery(storage, recoveryKey);

    return saved && freeRecoveryDiffers(saved, initialEntry) ? saved : null;
  });
  const [savedSignature, setSavedSignature] = useState(() => freeEntrySignature(initialEntry));
  // A regra do "Lembrar depois" fica fora do historico, mas conta como mudanca (o Z nao troca de endereco com ela pendente).
  const [savedAllowSnooze, setSavedAllowSnooze] = useState(content.allowSnooze);
  const signature = useMemo(() => freeEntrySignature(history.present), [history.present]);
  const dirtySinceSave = freeDirtySinceSave({ allowSnooze: content.allowSnooze, savedAllowSnooze, savedSignature, signature });

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasApi = useRef<FreeCanvasApi | null>(null);
  const sentRef = useRef<FreeHistoryEntry>(initialEntry);
  const sendDelayRef = useRef(0);
  const positionTimer = useRef<number | null>(null);
  const pendingLayerFocus = useRef<FreeId | "stage" | null>(null);
  const pendingReviewFocus = useRef(initialFocus?.kind === "review");
  const propsRef = useRef({ onChange, onCtaChange: content.onCtaChange, onSaveDraft });

  useLayoutEffect(() => {
    propsRef.current = { onChange, onCtaChange: content.onCtaChange, onSaveDraft };
  });

  /* --------------------------------------------------------------------------------------------
   * Historico, envio ao rascunho do aviso, avisos falados
   * ------------------------------------------------------------------------------------------ */

  const announce = useCallback((text: string) => {
    setAnnouncement((current) => ({ id: current.id + 1, text }));
  }, []);

  const setHistory = useCallback((next: FreeHistory) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  /** Um passo novo no historico (ou junta com o anterior, com a mesma chave em menos de 700 ms). */
  const commit = useCallback(
    (next: FreeHistoryEntry, options: { coalesceKey?: string } = {}) => {
      if (disabled) {
        return;
      }

      sendDelayRef.current = options.coalesceKey ? FREE_SEND_TYPING_MS : 0;
      setHistory(pushFreeHistory(historyRef.current, next, { coalesceKey: options.coalesceKey ?? null }));
    },
    [disabled, setHistory]
  );

  const commitDesign = useCallback(
    (next: PopupFreeDesign, options: { coalesceKey?: string } = {}) => commit({ cta: historyRef.current.present.cta, design: next }, options),
    [commit]
  );

  /** Manda ao rascunho do aviso o que ainda nao foi (design e o botao principal). */
  const flush = useCallback(() => {
    const present = historyRef.current.present;
    const sent = sentRef.current;

    if (present.design !== sent.design) {
      propsRef.current.onChange(present.design);
    }

    if (present.cta !== sent.cta) {
      propsRef.current.onCtaChange(present.cta);
    }

    sentRef.current = present;
  }, []);

  useEffect(() => {
    if (history.present === sentRef.current) {
      return;
    }

    const timer = window.setTimeout(flush, sendDelayRef.current);

    return () => window.clearTimeout(timer);
  }, [flush, history.present]);

  // Fechar (ou desmontar por outro caminho) manda o que faltou.
  useEffect(() => () => flush(), [flush]);

  function undo() {
    const current = historyRef.current;

    if (!canUndoFreeHistory(current)) {
      return;
    }

    sendDelayRef.current = 0;
    setHistory(undoFreeHistory(current));
    announce(copy.announce.undone);
  }

  function redo() {
    const current = historyRef.current;

    if (!canRedoFreeHistory(current)) {
      return;
    }

    sendDelayRef.current = 0;
    setHistory(redoFreeHistory(current));
    announce(copy.announce.redone);
  }

  /* --------------------------------------------------------------------------------------------
   * Validacao e dicas (150 ms depois da ultima mudanca), erros do ultimo salvar
   * ------------------------------------------------------------------------------------------ */

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setChecks({
        errors: freeEditorErrors(design, { allowSnooze: content.allowSnooze, audio: content.audio, cta, ctaOptional: content.ctaOptional }),
        hints: popupFreeHints(design, { content: { allowSnooze: content.allowSnooze, ctaLabel: cta?.label }, rects })
      });
    }, FREE_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [content.allowSnooze, content.audio, content.ctaOptional, cta, design, rects]);

  const errors = useMemo(() => ({ ...liveServerErrors(serverState, design, cta), ...checks.errors }), [checks.errors, cta, design, serverState]);
  const review = useMemo(() => freeReviewItems(design, errors, checks.hints), [checks.hints, design, errors]);
  const flagged = useMemo(() => freeFlaggedNodeIds(design, errors, checks.hints), [checks.hints, design, errors]);
  const problemCount = review.errors.length + review.hints.length;
  const sizePercent = useMemo(() => freeDesignSizePercent(design), [design]);

  /* --------------------------------------------------------------------------------------------
   * Trabalho perdido: beforeunload e copia de recuperacao
   * ------------------------------------------------------------------------------------------ */

  useEffect(() => {
    if (!dirtySinceSave) {
      return;
    }

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtySinceSave]);

  useEffect(() => {
    if (!dirtySinceSave || !storage) {
      return;
    }

    // A regra do "Lembrar depois" vai junto (nao esta no historico, mas o Livre tambem a edita).
    const entry = { ...history.present, allowSnooze: content.allowSnooze };
    const timer = window.setTimeout(() => writeFreeRecovery(storage, recoveryKey, entry), FREE_RECOVERY_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [content.allowSnooze, dirtySinceSave, history.present, recoveryKey, storage]);

  function recover() {
    if (!recovery) {
      return;
    }

    commit({ cta: recovery.cta, design: recovery.design });

    const allowSnooze = allowSnoozeToRestore(recovery, content.allowSnooze);

    if (allowSnooze !== null) {
      content.onAllowSnoozeChange(allowSnooze);
    }

    setRecovery(null);
    announce(copy.announce.recovered);
  }

  function discardRecovery() {
    clearFreeRecovery(storage, recoveryKey);
    setRecovery(null);
  }

  /* --------------------------------------------------------------------------------------------
   * Copiar e colar o design (docs/27 L1.1): colar e um passo so no historico (design e botao principal juntos)
   * ------------------------------------------------------------------------------------------ */

  function pasteDesign(text: string): readonly string[] | null {
    if (busyReason) {
      return [copy.save.waitUpload];
    }

    const current = historyRef.current;
    const result = parseFreeDesignPaste(text, {
      content: { audio: content.audio, cta: current.present.cta },
      fontIds: fonts.map((font) => font.id),
      knownAssets: freeKnownAssets([current.present, ...current.past, ...current.future, initialEntry])
    });

    if (!result.ok) {
      return result.errors;
    }

    commit({ cta: result.cta, design: result.design });
    setSelectedId(null);
    setRightPanel("inspector");

    const message = [copy.transfer.pasted, ...result.notes].join(" ");

    adminToast.success(message);
    announce(message);

    return null;
  }

  /* --------------------------------------------------------------------------------------------
   * Aba Modelos (docs/28 §5.9): "Meus modelos" lido uma vez por sessao, "Usar este modelo" como um colar (um passo so
   * no historico) e "Salvar este design como modelo" (o design do historico atual, sem salvar o aviso)
   * ------------------------------------------------------------------------------------------ */

  const mine = useDesignTemplatesLoad("free");

  function applyTemplate(item: FreeTemplateItem) {
    if (busyReason) {
      setBanner({ kind: "wait", text: copy.save.waitUpload });
      announce(copy.save.waitUpload);

      return;
    }

    const current = historyRef.current;
    const result = applyFreeTemplateDesign(item, {
      content: { audio: content.audio, cta: current.present.cta },
      fontIds: fonts.map((font) => font.id),
      knownAssets: freeKnownAssets([current.present, ...current.past, ...current.future, initialEntry])
    });

    if (!result.ok) {
      const text = result.errors.join(" ");

      setBanner({ kind: "error", text });
      announce(text);

      return;
    }

    commit({ cta: result.cta, design: result.design });
    setSelectedId(null);
    setRightPanel("inspector");

    const message = [copy.templates.applied, ...result.notes].join(" ");

    adminToast.success(message);
    announce(message);
    templates?.onApplied(item.id);
  }

  async function saveDesignAsTemplate(name: string): Promise<{ ok: true } | { fieldError?: string; message: string; ok: false; status: number }> {
    const present = historyRef.current.present;
    const result = await saveTemplate({
      body: {
        design: null,
        freeDesign: present.design,
        source: "design",
        support: templateDesignSupportOf({ cta: present.cta, design: null, freeDesign: present.design, image: null })
      },
      name,
      origin: "free_editor",
      sourceNoticeId: templates?.sourceNoticeId ?? null,
      sourceTemplateIds: [...(templates?.sourceTemplateIds ?? [])]
    }).catch(() => null);

    if (!result) {
      return { message: copy.save.failed, ok: false, status: 500 };
    }

    if (!result.ok) {
      const { name: nameError, ...others } = templateErrorsFromAction(result.fieldErrors);

      return { fieldError: nameError, message: Object.values(others)[0] ?? result.error, ok: false, status: result.status };
    }

    adminToast.success(copy.templates.saved);
    announce(copy.templates.saved);
    // A lista da aba volta a ser lida (o modelo novo aparece nela).
    mine.reset();
    mine.open();

    return { ok: true };
  }

  /* --------------------------------------------------------------------------------------------
   * Selecao, foco no painel, foco depois de excluir
   * ------------------------------------------------------------------------------------------ */

  const selectedNode = freeNodeOf(design, selectedId);
  const activeId = selectedNode ? selectedId : null;

  const select = useCallback((id: FreeId | null) => {
    setSelectedId(id);
    setRightPanel("inspector");
  }, []);

  useLayoutEffect(() => {
    const pending = pendingLayerFocus.current;

    if (!pending) {
      return;
    }

    pendingLayerFocus.current = null;

    if (pending === "stage") {
      stageRef.current?.focus();

      return;
    }

    const target = rootRef.current?.querySelector<HTMLElement>(`[data-free-layer-row="${pending}"] [data-free-layer-button="0"]`);

    (target ?? stageRef.current)?.focus();
  });

  /** Depois de excluir, o foco fica perto: na linha que ocupa o lugar (Camadas) ou no palco. */
  function focusAfterRemove(id: FreeId) {
    const active = document.activeElement;
    const inLayers = Boolean(active instanceof HTMLElement && active.closest("[data-free-layer-row]"));

    if (!inLayers) {
      pendingLayerFocus.current = "stage";

      return;
    }

    const rows = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-free-layer-row]") ?? []).map((row) => row.dataset.freeLayerRow ?? "");
    const at = rows.indexOf(id);
    const remaining = rows.filter((row, index) => row && row !== id && !(index > at && rows[at] && isInside(row, id)));

    pendingLayerFocus.current = remaining[Math.min(at, remaining.length - 1)] ?? "stage";
  }

  function isInside(rowId: FreeId, boxId: FreeId) {
    let parent = freeParentId(design, rowId);

    while (parent) {
      if (parent === boxId) {
        return true;
      }

      parent = freeParentId(design, parent);
    }

    return false;
  }

  /* --------------------------------------------------------------------------------------------
   * Comandos (Camadas, barrinha do desenho, painel da direita, teclado)
   * ------------------------------------------------------------------------------------------ */

  function runCommand(kind: CommandKind, id: FreeId) {
    const present = historyRef.current.present;
    const node = freeNodeOf(present.design, id);

    if (!node || disabled) {
      return;
    }

    switch (kind) {
      case "duplicate": {
        const result = duplicateFreeNode(present.design, id, present.cta);

        if ("reason" in result) {
          announce(result.reason);

          return;
        }

        commitDesign(result.design);
        setSelectedId(result.id);
        announce(copy.announce.duplicated);

        return;
      }
      case "remove": {
        const result = removeFreeNode(present.design, id);

        if ("reason" in result) {
          announce(result.reason);

          return;
        }

        focusAfterRemove(id);
        commit({ cta: result.ctaRemoved ? null : present.cta, design: result.design });
        setSelectedId(null);
        announce(copy.announce.removed);

        return;
      }
      case "moveUp":
      case "moveDown": {
        const next = moveFreeNodeInList(present.design, id, kind === "moveUp" ? -1 : 1);

        if (next) {
          commitDesign(next);
          announce(kind === "moveUp" ? copy.announce.upward : copy.announce.downward);
        }

        return;
      }
      case "outOfBox": {
        const next = moveFreeNodeOutOfBox(present.design, id);

        if (next) {
          commitDesign(next);
          announce(copy.announce.outOfBox);
        }

        return;
      }
      case "toggleHidden": {
        commitDesign(setFreeNodeFlag(present.design, id, "hidden", !node.hidden));
        announce(node.hidden ? copy.announce.shown : copy.announce.hidden);

        return;
      }
      case "toggleLocked": {
        commitDesign(setFreeNodeFlag(present.design, id, "locked", !node.locked));
        announce(node.locked ? copy.announce.unlocked : copy.announce.locked);

        return;
      }
      case "toFree": {
        const problem = freeToFreeProblem(present.design, id);

        if (problem !== null) {
          if (problem) {
            announce(problem);
          }

          return;
        }

        const next = freeNodeToFree(present.design, id, rects);

        if (next) {
          commitDesign(next);
          announce(copy.announce.toFree);
        }

        return;
      }
      case "toSequence": {
        const next = freeNodeToSequence(present.design, id, rects);

        if (next) {
          commitDesign(next);
          announce(copy.announce.toSequence);
        }

        return;
      }
      case "forward":
      case "backward": {
        const next = shiftFreeNodeLayer(present.design, id, kind === "forward" ? 1 : -1);

        if (next !== present.design) {
          commitDesign(next, { coalesceKey: `${id}:place.z` });
          announce(kind === "forward" ? copy.announce.layerForward : copy.announce.layerBackward);
        }

        return;
      }
    }
  }

  function onLayerCommand(command: FreeLayerCommand) {
    const present = historyRef.current.present;

    if (command.kind === "intoBox") {
      const result = moveFreeNodeIntoBox(present.design, command.id, command.boxId);

      if (result) {
        commitDesign(result.design);
        announce(result.becameFlow ? copy.announce.toSequence : copy.announce.intoBox);
      }

      return;
    }

    if (command.kind === "rename") {
      const next = renameFreeNode(present.design, command.id, command.name);

      if (next !== present.design) {
        commitDesign(next);
        announce(copy.announce.renamed);
      }

      return;
    }

    runCommand(command.kind, command.id);
  }

  function onInspectorCommand(command: FreeEditorCommand) {
    if (command.kind === "select") {
      select(command.id);

      return;
    }

    if (command.kind === "align") {
      const next = alignFreeNode(historyRef.current.present.design, command.id, command.edge, rects);

      if (next !== historyRef.current.present.design) {
        commitDesign(next);
        announce(copy.announce.aligned);
      }

      return;
    }

    runCommand(command.kind, command.id);
  }

  function onToolbar(command: FreeCanvasToolbarCommand, id: FreeId) {
    runCommand(command, id);
  }

  function add(kind: FreeCatalogKind) {
    const present = historyRef.current.present;
    const center = kind === "shape" ? (canvasApi.current?.visibleCenter() ?? undefined) : undefined;
    const result = addFreeElement(present.design, kind, { center, selectedId: activeId });

    if ("reason" in result) {
      announce(result.reason);

      return;
    }

    commit({ cta: kind === "cta" ? freeCtaForNewButton(present.cta) : present.cta, design: result.design });
    setSelectedId(result.id);
    setRightPanel("inspector");
    setFocusRequest(freeFocusAfterAdd(result.node));
    announce(freeAddedAnnouncement(kind));
  }

  function onCommitRect(id: FreeId, rect: Partial<FreeRect>) {
    commitDesign(setFreeNodeRect(historyRef.current.present.design, id, rect));
  }

  function onEditText(id: FreeId) {
    const node = freeNodeOf(historyRef.current.present.design, id);

    if (!node) {
      return;
    }

    const key = node.type === "heading" || node.type === "text" ? `nodes.${id}.lines` : node.type === "button" && node.action.kind === "cta" ? "cta.label" : `nodes.${id}.label`;

    select(id);
    setFocusRequest({ key });
  }

  /* --------------------------------------------------------------------------------------------
   * Revisar
   * ------------------------------------------------------------------------------------------ */

  function goToItem(item: FreeReviewItem) {
    setSelectedId(item.nodeId);
    setRightPanel("inspector");
    setFocusRequest({ key: item.key });
  }

  function raise(item: FreeReviewItem) {
    if (!item.nodeId) {
      return;
    }

    const next = raiseFreeArtboardTo(historyRef.current.present.design, item.nodeId, rects);

    if (next !== historyRef.current.present.design) {
      commitDesign(next);
    }
  }

  function fontUploaded(font: PopupFontOption, item: FreeReviewItem) {
    onFontsChange([...fonts.filter((option) => option.id !== font.id), font]);
    commitDesign(applyFreeFontAtKey(historyRef.current.present.design, item.key, { id: font.id, kind: "uploaded" }));
  }

  /* --------------------------------------------------------------------------------------------
   * Salvar e concluir
   * ------------------------------------------------------------------------------------------ */

  function updateBusy(reason: string | null) {
    setBusyReason(reason);
    onBusyChange(reason);

    if (!reason) {
      setBanner((current) => (current?.kind === "wait" ? null : current));
    }
  }

  async function save(confirmed = false) {
    if (busyReason) {
      setBanner({ kind: "wait", text: copy.save.waitUpload });
      announce(copy.save.waitUpload);

      return;
    }

    if (saving || disabled) {
      return;
    }

    // Modelo com uma parte que nao abriu (docs/28 D29): pergunta antes do primeiro salvar.
    if (saveConfirm && !confirmed) {
      setConfirmingSave(true);

      return;
    }

    const snapshot = historyRef.current.present;
    const allowSnoozeSnapshot = content.allowSnooze;

    flush();
    setSaving(true);
    setBanner(null);
    await nextTick();

    let result: Awaited<ReturnType<FreeDesignEditorProps["onSaveDraft"]>>;

    try {
      result = await propsRef.current.onSaveDraft();
    } catch {
      result = { errors: {}, message: copy.save.failed, ok: false };
    }

    setSaving(false);

    if (result.ok) {
      const message = freeSavedMessage(result.message);

      setSavedSignature(freeEntrySignature(snapshot));
      setSavedAllowSnooze(allowSnoozeSnapshot);
      setServerState(null);
      clearFreeRecovery(storage, recoveryKey);
      adminToast.success(message);
      announce(message);

      return;
    }

    const split = splitSaveErrors(snapshot.design, result.errors);
    const outsideNames = freeOutsideFieldNames(split.outside);

    setServerState(Object.keys(split.design).length > 0 ? { cta: snapshot.cta, design: snapshot.design, errors: split.design } : null);

    if (outsideNames.length > 0) {
      setBanner({ kind: "outside", text: copy.save.outside(outsideNames.join(", ")) });
    } else if (Object.keys(split.design).length === 0) {
      setBanner({ kind: "error", text: result.message });
    }

    if (Object.keys(split.design).length > 0) {
      setRightPanel("review");
      pendingReviewFocus.current = true;
    }

    announce(outsideNames.length > 0 ? copy.save.outside(outsideNames.join(", ")) : result.message);
  }

  useEffect(() => {
    if (rightPanel === "review" && pendingReviewFocus.current) {
      pendingReviewFocus.current = false;
      rootRef.current?.querySelector<HTMLElement>("[data-free-review-title]")?.focus();
    }
  });

  function close() {
    if (busyReason) {
      setBanner({ kind: "wait", text: copy.save.waitUpload });
      announce(copy.save.waitUpload);

      return;
    }

    if (saving) {
      return;
    }

    flush();
    onClose({ dirtySinceSave });

    // O Dialog devolve o foco ao botao que abriu; se o card Design desmontar o editor junto, devolve aqui.
    window.requestAnimationFrame(() => {
      if (returnTo?.isConnected && (document.activeElement === null || document.activeElement === document.body)) {
        returnTo.focus();
      }
    });
  }

  /* --------------------------------------------------------------------------------------------
   * Teclado (spec §4.4, §4.8, §4.9): nunca dentro de um campo de texto (o campo tem o proprio desfazer)
   * ------------------------------------------------------------------------------------------ */

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;

    // Menus e popovers ficam em portal: o evento chega pela arvore do React, mas nao e do editor.
    if (event.defaultPrevented || !rootRef.current?.contains(target)) {
      return;
    }

    const typing = isTypingTarget(target);
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;

    if (mod && !event.altKey && lower === "z") {
      if (typing) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }

      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && lower === "y") {
      if (!typing) {
        event.preventDefault();
        redo();
      }

      return;
    }

    if (typing) {
      return;
    }

    if (key === "?" && !mod) {
      event.preventDefault();
      setShortcutsOpen(true);

      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      select(freeParentId(design, activeId));

      return;
    }

    if (!activeId || !selectedNode) {
      return;
    }

    const onCanvas = Boolean(target.closest("[data-free-zone=\"canvas\"]")) || target === rootRef.current;

    if (mod && !event.altKey && lower === "d") {
      event.preventDefault();
      runCommand("duplicate", activeId);

      return;
    }

    if ((key === "Delete" || key === "Backspace") && onCanvas && !mod) {
      event.preventDefault();
      runCommand("remove", activeId);

      return;
    }

    if ((key === "[" || key === "]") && !mod) {
      event.preventDefault();
      runCommand(key === "]" ? "forward" : "backward", activeId);

      return;
    }

    if (event.altKey && !mod && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      runCommand(key === "ArrowUp" ? "moveUp" : "moveDown", activeId);

      return;
    }

    if (onCanvas && !mod && !event.altKey && key.startsWith("Arrow")) {
      if (selectedNode.place?.mode !== "free" || selectedNode.locked) {
        return;
      }

      event.preventDefault();

      const step = event.shiftKey ? 10 : 1;
      const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      const next = nudgeFreeNode(historyRef.current.present.design, activeId, dx, dy);

      if (next === historyRef.current.present.design) {
        return;
      }

      commitDesign(next, { coalesceKey: `${activeId}:place` });

      if (positionTimer.current !== null) {
        window.clearTimeout(positionTimer.current);
      }

      const id = activeId;

      positionTimer.current = window.setTimeout(() => {
        positionTimer.current = null;

        const place = freeNodeOf(historyRef.current.present.design, id)?.place;

        if (place?.mode === "free") {
          announce(copy.announce.position(place.x, place.y));
        }
      }, FREE_POSITION_ANNOUNCE_MS);
    }
  }

  useEffect(
    () => () => {
      if (positionTimer.current !== null) {
        window.clearTimeout(positionTimer.current);
      }
    },
    []
  );

  /* --------------------------------------------------------------------------------------------
   * Desenho
   * ------------------------------------------------------------------------------------------ */

  const stageDesign = useMemo(() => resolveFreeForDevice(freeStageDesign(design), device), [design, device]);
  const popup = useMemo(
    () => freePreviewPopupItem({ allowSnooze: content.allowSnooze, audio: content.audio, cta, design: stageDesign, fonts, title: content.title }),
    [content.allowSnooze, content.audio, content.title, cta, fonts, stageDesign]
  );
  const toolbarDisabled = useMemo(() => {
    if (!selectedNode || !activeId) {
      return {};
    }

    const found = findFreeNode(design, activeId);
    const siblings = found?.parent ? found.parent.children.length : design.children.length;

    return {
      duplicate: freeDuplicateProblem(design, activeId),
      moveDown: found && found.index >= siblings - 1 ? "" : null,
      moveUp: found && found.index === 0 ? "" : null,
      remove: freeRemoveProblem(design, activeId),
      toFree: freeToFreeProblem(design, activeId)
    } satisfies Partial<Record<FreeCanvasToolbarCommand, string | null>>;
  }, [activeId, design, selectedNode]);
  const wrappedContent = useMemo<FreeEditorContent>(
    () => ({
      ...content,
      cta,
      onCtaChange: (next) => commit({ cta: next, design: historyRef.current.present.design })
    }),
    [commit, content, cta]
  );

  /** O foco ao abrir: a linha do primeiro elemento nas Camadas (ou o palco, num design so com Links). */
  const initialFocusTarget = useCallback(() => {
    if (initialFocus?.kind === "error") {
      // O painel da direita poe o foco no campo do erro (focusRequest).
      return false;
    }

    if (initialFocus?.kind === "review") {
      return rootRef.current?.querySelector<HTMLElement>("[data-free-review-title]") ?? true;
    }

    if (freeOnlyLinks(initialDesign)) {
      return stageRef.current ?? true;
    }

    return rootRef.current?.querySelector<HTMLElement>("[data-free-layer-select]") ?? stageRef.current ?? true;
  }, [initialDesign, initialFocus]);

  const finalFocusTarget = useCallback(() => (returnTo?.isConnected ? returnTo : true), [returnTo]);

  const subtitleText = (subtitle ?? content.title).trim();
  const leftTabs = templates ? (["elements", "layers", "templates"] as const) : (["elements", "layers"] as const);

  return (
    <DialogPrimitive.Popup
      aria-describedby={undefined}
      className="fixed inset-0 z-50 flex min-w-0 flex-col bg-[var(--surface-0)] text-[var(--text-primary)] outline-none"
      data-free-editor=""
      finalFocus={finalFocusTarget}
      initialFocus={initialFocusTarget}
      onKeyDown={onKeyDown}
      ref={rootRef}
    >
      {/* Barra de cima (56 px) */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-1)] px-3">
        <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
          <Button
            aria-label={copy.bar.doneLabel}
            className="gap-1.5 px-2.5"
            aria-disabled={saving || undefined}
            data-free-done=""
            onClick={close}
            type="button"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {copy.bar.done}
          </Button>
          <div className="min-w-0 border-l border-[var(--border-subtle)] pl-3">
            <DialogPrimitive.Title className="truncate text-sm leading-5 font-semibold text-[var(--text-primary)]">{copy.bar.title}</DialogPrimitive.Title>
            {subtitleText ? <p className="truncate text-xs leading-4 text-[var(--text-secondary)]">{subtitleText}</p> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Segmented
            label={copy.bar.viewAs}
            onChange={(value) => setDevice(value)}
            options={[
              { icon: <Monitor aria-hidden="true" className="size-4" />, label: copy.devices.desktop, value: "desktop" },
              { icon: <Smartphone aria-hidden="true" className="size-4" />, label: copy.devices.mobile, value: "mobile" }
            ]}
            value={device}
          />
          <Segmented
            label={copy.bar.zoom}
            onChange={(value) => setZoom(value)}
            options={[
              { label: copy.bar.zoomFit, value: "fit" },
              { label: copy.bar.zoom100, value: "100" }
            ]}
            value={zoom}
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 xl:flex-1 xl:basis-0">
          <Button
            aria-label={copy.bar.undo}
            className="p-0"
            data-free-undo=""
            disabled={!canUndoFreeHistory(history) || disabled}
            onClick={undo}
            size="icon"
            title={`${copy.bar.undo} (Ctrl + Z)`}
            type="button"
            variant="ghost"
          >
            <Undo2 aria-hidden="true" className="size-4" />
          </Button>
          <Button
            aria-label={copy.bar.redo}
            className="p-0"
            data-free-redo=""
            disabled={!canRedoFreeHistory(history) || disabled}
            onClick={redo}
            size="icon"
            title={`${copy.bar.redo} (Ctrl + Shift + Z)`}
            type="button"
            variant="ghost"
          >
            <Redo2 aria-hidden="true" className="size-4" />
          </Button>
          <Button
            aria-label={problemCount > 0 ? copy.bar.reviewCount(problemCount) : copy.bar.review}
            aria-pressed={rightPanel === "review"}
            className={cn("gap-1.5 px-2.5", rightPanel === "review" && "bg-[var(--surface-3)]")}
            data-free-review-toggle=""
            onClick={() => {
              if (rightPanel === "review") {
                setRightPanel("inspector");
              } else {
                pendingReviewFocus.current = true;
                setRightPanel("review");
              }
            }}
            type="button"
            variant="ghost"
          >
            <TriangleAlert aria-hidden="true" className={cn("size-4", review.errors.length > 0 ? "text-[var(--error)]" : problemCount > 0 ? "text-[var(--warning)]" : "text-[var(--text-secondary)]")} />
            {copy.bar.review}
            {problemCount > 0 ? (
              <span aria-hidden="true" className="min-w-5 rounded-full bg-[var(--surface-3)] px-1.5 text-center text-xs leading-5 tabular-nums">
                {problemCount}
              </span>
            ) : null}
          </Button>
          <FreeCopyPaste
            designText={() => freeDesignClipboardText(historyRef.current.present.design)}
            disabled={disabled}
            loadInstructions={() => import("./free-ai-instructions").then((module) => module.FREE_AI_INSTRUCTIONS)}
            onCopied={(message) => {
              adminToast.success(message);
              announce(message);
            }}
            onPaste={pasteDesign}
          />
          <ShortcutsPopover onOpenChange={setShortcutsOpen} open={shortcutsOpen} />
          <Button
            aria-disabled={saving || disabled || undefined}
            className={cn("gap-1.5 px-3", (saving || disabled) && "opacity-60")}
            data-free-save=""
            onClick={() => void save()}
            type="button"
            variant="secondary"
          >
            <Save aria-hidden="true" className="size-4" />
            {saving ? copy.bar.saving : (saveLabel ?? freeSaveLabel(savesInPlace))}
          </Button>
        </div>
      </header>

      {recovery ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-2" data-free-recovery="" role="status">
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-[var(--text-primary)]">{copy.recovery.message(freeRecoveryTime(recovery.savedAt))}</p>
          <Button disabled={disabled} onClick={recover} size="sm" type="button" variant="secondary">
            {copy.recovery.recover}
          </Button>
          <Button onClick={discardRecovery} size="sm" type="button" variant="ghost">
            {copy.recovery.discard}
          </Button>
        </div>
      ) : null}

      {banner ? (
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2",
            banner.kind === "wait" ? "border-[var(--border-subtle)] bg-[var(--surface-2)]" : "border-[var(--error-border)] bg-[var(--error-bg)]"
          )}
          data-free-banner={banner.kind}
          role={banner.kind === "wait" ? "status" : "alert"}
        >
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-[var(--text-primary)]">{banner.text}</p>
          {banner.kind === "outside" ? (
            <Button onClick={close} size="sm" type="button" variant="secondary">
              {copy.save.closeAndReview}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)_300px] xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        {/* Esquerda: Elementos e Camadas */}
        <Tabs.Root
          className="flex min-h-0 min-w-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-1)]"
          data-free-zone="left"
          onValueChange={(value) => setLeftTab(value as "elements" | "layers" | "templates")}
          value={leftTab}
        >
          <Tabs.List className="flex h-11 shrink-0 items-stretch gap-1 border-b border-[var(--border-subtle)] px-2">
            {leftTabs.map((tab) => (
              <Tabs.Tab
                className={cn(
                  "relative -mb-px flex items-center border-b-2 border-transparent px-2.5 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] data-active:border-[var(--focus-ring)] data-active:text-[var(--text-primary)]",
                  adminTransition
                )}
                data-free-tab={tab}
                key={tab}
                value={tab}
              >
                {copy.tabs[tab]}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel className="min-h-0 flex-1 overflow-y-auto outline-none" tabIndex={-1} value="elements">
            <FreeElementsPanel design={design} disabled={disabled} onAdd={add} />
          </Tabs.Panel>
          <Tabs.Panel className="min-h-0 flex-1 overflow-y-auto outline-none" tabIndex={-1} value="layers">
            <FreeLayersPanel cta={cta} design={design} disabled={disabled} flagged={flagged} onCommand={onLayerCommand} onSelect={(id) => select(id)} selectedId={activeId} />
          </Tabs.Panel>
          {templates ? (
            <Tabs.Panel className="min-h-0 flex-1 overflow-y-auto outline-none" tabIndex={-1} value="templates">
              <FreeTemplatesPanel
                busy={busyReason}
                defaultName={defaultTemplateName({ forDesign: true, kind: "design", mode: "free", title: content.title })}
                disabled={disabled}
                fonts={mine.fonts}
                load={mine.load}
                onOpen={mine.open}
                onRetry={mine.retry}
                onSave={saveDesignAsTemplate}
                onUse={applyTemplate}
              />
            </Tabs.Panel>
          ) : null}
        </Tabs.Root>

        {/* Meio: area de desenho */}
        <div className="flex min-h-0 min-w-0 flex-col" data-free-zone="middle">
          <FreeCanvas
            apiRef={canvasApi}
            description={freeSelectionDescription(design, activeId, rects)}
            design={stageDesign}
            device={device}
            disabled={disabled}
            fonts={fonts}
            onCommitRect={onCommitRect}
            onEditText={onEditText}
            onRectsChange={setRects}
            onSelect={(id) => select(id)}
            onToolbar={onToolbar}
            popup={popup}
            rects={rects}
            selectedId={activeId}
            stageRef={stageRef}
            toolbarDisabled={toolbarDisabled}
            zoom={zoom}
          />
        </div>

        {/* Direita: o painel do elemento (pacote I) ou o Revisar */}
        <aside className="flex min-h-0 min-w-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--surface-1)]" data-free-zone="right">
          {rightPanel === "review" ? (
            <FreeReviewPanel
              disabled={disabled}
              errors={review.errors}
              hints={review.hints}
              onBack={() => setRightPanel("inspector")}
              onFontUploaded={fontUploaded}
              onGoTo={goToItem}
              onRaise={raise}
              sizePercent={sizePercent}
            />
          ) : (
            <FreeInspector
              content={wrappedContent}
              design={design}
              device={device}
              disabled={disabled}
              errors={errors}
              focusRequest={focusRequest}
              fonts={fonts}
              hints={checks.hints}
              onBusyChange={updateBusy}
              onChange={(next, options) => commitDesign(next, options)}
              onCommand={onInspectorCommand}
              onCtaChange={(next, options) => commit({ cta: next, design: historyRef.current.present.design }, options)}
              onFocusHandled={() => setFocusRequest(null)}
              onFontsChange={onFontsChange}
              rects={rects}
              selectedId={activeId}
            />
          )}
        </aside>
      </div>

      <div aria-live="polite" className="sr-only" data-free-live="">
        {announcement.text ? <p key={announcement.id}>{announcement.text}</p> : null}
      </div>

      {saveConfirm ? (
        <ConfirmDialog
          cancelLabel={saveConfirm.cancelLabel}
          confirmLabel={saveConfirm.confirmLabel}
          description={saveConfirm.description}
          onConfirm={() => {
            setConfirmingSave(false);
            void save(true);
          }}
          onOpenChange={setConfirmingSave}
          open={confirmingSave}
          title={saveConfirm.title}
        />
      ) : null}
    </DialogPrimitive.Popup>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Pecas pequenas
 * ---------------------------------------------------------------------------------------------- */

type SegmentedOption<Value extends string> = { icon?: ReactNode; label: string; value: Value };

/** Escolha unica da barra (Ver como, zoom): botoes com aria-pressed, setas andam entre eles. */
function Segmented<Value extends string>({ label, onChange, options, value }: { label: string; onChange: (value: Value) => void; options: readonly SegmentedOption<Value>[]; value: Value }) {
  return (
    <div aria-label={label} className="flex items-center gap-2" role="group">
      <span aria-hidden="true" className="hidden text-xs leading-4 text-[var(--text-tertiary)] xl:inline">
        {label}
      </span>
      <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-0.5">
        {options.map((option, index) => {
          const active = option.value === value;

          return (
            <button
              aria-pressed={active}
              className={cn(
                option.icon && "max-xl:px-2",
                "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] leading-5 font-medium",
                active ? "bg-[var(--surface-3)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                adminTransition
              )}
              data-free-segment={option.value}
              key={option.value}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                  return;
                }

                event.preventDefault();

                const next = options[(index + (event.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
                const group = event.currentTarget.parentElement;

                onChange(next.value);
                group?.querySelector<HTMLElement>(`[data-free-segment="${next.value}"]`)?.focus();
              }}
              type="button"
            >
              {option.icon}
              {option.icon ? <span className="sr-only xl:not-sr-only">{option.label}</span> : option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShortcutsPopover({ onOpenChange, open }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  return (
    <Popover.Root onOpenChange={onOpenChange} open={open}>
      <Popover.Trigger
        aria-keyshortcuts="Shift+?"
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--hover-overlay)] data-popup-open:bg-[var(--surface-3)]",
          adminTransition
        )}
        data-free-shortcuts=""
      >
        <Keyboard aria-hidden="true" className="size-4" />
        <span className="sr-only xl:not-sr-only">{copy.bar.shortcuts}</span>
        <kbd aria-hidden="true" className="rounded border border-[var(--border-subtle)] px-1 text-[11px] leading-4 text-[var(--text-tertiary)]">
          ?
        </kbd>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-[60] outline-none" collisionPadding={8} sideOffset={6}>
          <Popover.Popup className="w-80 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-3 text-[var(--text-primary)] shadow-[0_14px_36px_rgba(0,0,0,0.55)] outline-none">
            <Popover.Title className="mb-2 text-sm leading-5 font-semibold">{copy.bar.shortcuts}</Popover.Title>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {copy.shortcuts.map((line) => {
                const [keys, ...rest] = line.split(": ");

                return (
                  <li className="flex items-baseline justify-between gap-3 text-[13px] leading-5" key={line}>
                    <span className="font-medium text-[var(--text-primary)]">{keys}</span>
                    <span className="text-right text-[var(--text-secondary)]">{rest.join(": ")}</span>
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
