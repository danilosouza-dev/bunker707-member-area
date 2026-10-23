"use client";

import { Check, PencilRuler, Shapes } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { MemberPopupCard } from "@/components/member/notifications/member-popup";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cardBackgroundCss,
  paintToCss,
  popupCardImagePathOf,
  popupDesignContrastHints,
  popupStarterDesign,
  type PopupDesign,
  type PopupDesignStarterId,
  type PopupFontOption
} from "@/server/communications/popup-design-model";
import { freePreviewPopupItem, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import { resolveFreeArtboard } from "@/server/communications/popup-free-render";
import { freeStarterDesign, type FreeStarterId } from "@/server/communications/popup-free-starters";
import type { NoticeDraft } from "@/server/communications/schemas";
import { ConfirmDialog, SectionCard } from "../../settings/kit";
import type { ProductPickerItem } from "../../storefront/product-picker";
import { adminToast } from "../../toast";
import type { BlockEditorContext } from "./block-editors";
import { BlocksSection } from "./blocks-section";
import { CardSection, CloseSection, TextZoneSection } from "./card-section";
import { DesignFieldError } from "./design-controls";
import { FontUploadDialog } from "./font-upload-dialog";
import { FontsSection } from "./fonts-section";
import { MediaSection } from "./media-section";
import {
  DESIGN_MODE_OPTIONS,
  DESIGN_STARTER_OPTIONS,
  FREE_STARTER_OPTIONS,
  NO_REMEMBERED_DESIGNS,
  POPUP_DESIGN_COPY,
  applyFreeStarterPatch,
  applyStarter,
  freeDesignSummary,
  freeProblemsLabel,
  freeStarterVideoOf,
  popupDesignModeOf,
  sortedFontLibrary,
  switchDesignMode,
  type PopupDesignMode,
  type RememberedDesigns
} from "./popup-design-editor-model";
import type { FreeDesignEditorProps } from "../popup-free/free-editor";

// Cartao "Design" do editor do pop-up (docs/26; spec §7): Padrão | Personalizado | Livre, modelos para comecar e,
// no Personalizado, as secoes Mídia, Texto e posição, Blocos, Cartão, Fontes e Fechar e links, com as dicas de
// contraste. Quem chama (notice-editor) guarda o rascunho e os erros (chaves do zod: "design.blocks.2.lines.0.text",
// "cta.label", "image"...). O Personalizado vive em `draft.design` e o Livre em `draft.freeDesign` (os dois nulos =
// Padrão; nunca os dois); trocar de modo guarda o design do modo que saiu em memoria e voltar devolve, sem perguntar.
// A notificacao do sino nunca tem design (o editor nem mostra).
//
// Livre (docs/27; spec §4.1): modelos com miniatura (o proprio PopupFreeCard em previa), o resumo do design montado
// e o botao "Abrir editor Livre", que baixa o editor de tela cheia (next/dynamic, so ao abrir) e so abre em telas a
// partir de 1.024 px. O editor trabalha numa copia e manda o design ao rascunho; "Salvar rascunho" dentro dele chama
// `onSaveDraft` (o editor do aviso nao troca de endereco enquanto ele esta aberto, spec §4.13).

const FreeDesignEditor = dynamic<FreeDesignEditorProps>(() => import("../popup-free/free-editor").then((module) => module.FreeDesignEditor), {
  loading: () => null,
  ssr: false
});

/** Baixa o editor antes do clique (passar o mouse ou focar o botao). */
function prefetchFreeEditor() {
  void import("../popup-free/free-editor").catch(() => undefined);
}

const WIDE_QUERY = "(min-width: 1024px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

/** O editor Livre so abre a partir de 1.024 px (spec §4.1); no servidor, conta como tela larga. */
function useWideScreen() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true
  );
}

/**
 * Ao fechar o editor Livre, o foco volta para "Abrir editor Livre" (spec §4.2) quando quem abriu nao existe mais
 * (o botao "Usar este modelo" some junto com a lista de modelos).
 */
function returnFocusToFreeCard() {
  const attempt = () => {
    const card = document.getElementById("popup-livre");
    const button = document.getElementById("popup-livre-abrir");

    if (button && !document.querySelector("[data-free-editor]") && !card?.contains(document.activeElement)) {
      button.focus();
    }
  };

  window.requestAnimationFrame(() => window.requestAnimationFrame(attempt));
  window.setTimeout(attempt, 150);
}

/** Medidas da imagem do aviso (capa do Vídeo do modelo); o servidor confere de novo ao salvar. */
function measureImage(url: string): Promise<{ height: number; width: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(null), 4_000);

    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? { height: image.naturalHeight, width: image.naturalWidth } : null);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = url;
  });
}

export type PopupDesignFieldProps = {
  disabled: boolean;
  /** O rascunho inteiro do pop-up (cta, image, audio, allowSnooze e design). */
  draft: NoticeDraft;
  errorFor: (key: string) => string | undefined;
  /** A biblioteca de fontes (NoticeEditorOptions.popupFonts, depois atualizada por onFontsChange). */
  fonts: readonly PopupFontOption[];
  /** Motivo para nao salvar agora (video subindo); null = livre. */
  onBusyChange?: (reason: string | null) => void;
  onChange: (patch: Partial<Pick<NoticeDraft, "cta" | "design" | "freeDesign" | "image">>) => void;
  /** Biblioteca depois de enviar, renomear ou excluir uma fonte. */
  onFontsChange: (fonts: PopupFontOption[]) => void;
  /**
   * Livre: o editor de tela cheia abriu (`true`) ou fechou (`false`, com `dirtySinceSave`). Enquanto aberto, o editor
   * do aviso nao troca de endereco nem tira o foco dele (spec §4.13).
   */
  onFreeEditorOpenChange?: (open: boolean, result?: { dirtySinceSave: boolean }) => void;
  /** Livre: "Salvar rascunho" de dentro do editor (grava o aviso sem fechar o editor). */
  onSaveDraft?: FreeDesignEditorProps["onSaveDraft"];
  /** Recorte da imagem subindo (data URL, para a previa) ou null quando terminou. */
  onImageUploadChange?: (preview: string | null) => void;
  /** Produtos do destino do botao principal e do segundo botao (o mesmo seletor do "Para onde leva"). */
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  /** Livre: os erros do design (e do Botão principal) para o resumo "{n} problemas para revisar". */
  freeProblems?: Readonly<Record<string, string>>;
  /** Livre: erros do ultimo salvar (chaves com freeErrorKeys), entregues ao editor. */
  freeServerErrors?: Readonly<Record<string, string>>;
  /** Id do aviso gravado (null = aviso novo): a chave da copia de recuperacao do editor Livre. */
  noticeId?: string | null;
  /** Livre: pop-up no ar ou pausado (o salvar vale para os alunos): o editor Livre fala como o editor do aviso. */
  savesInPlace?: boolean;
};

/**
 * Miniatura do Livre: o proprio cartao do aluno em previa (o video parado, fora do teclado), reduzido para caber em
 * 120 x 160.
 */
function FreeThumb({ design, fonts, label }: { design: PopupFreeDesign; fonts?: readonly PopupFontOption[]; label?: string }) {
  const width = resolveFreeArtboard(design).width;
  const stage = width + 32;
  const scale = 120 / stage;
  const popup = useMemo(
    () => freePreviewPopupItem({ allowSnooze: true, audio: null, cta: STARTER_PREVIEW_CTA, design, fonts: fonts ?? [], title: "" }),
    [design, fonts]
  );

  return (
    <span
      aria-label={label}
      className="relative block h-[160px] w-[120px] shrink-0 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-black/70"
      role={label ? "img" : undefined}
    >
      {/* Centrado na miniatura: o translate de -50 % e do tamanho de verdade; o scale encolhe em volta do centro. */}
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 block origin-center"
        inert
        style={{ containerType: "inline-size", transform: `translate(-50%, -50%) scale(${scale})`, width: stage }}
      >
        <span className="flex justify-center py-4">
          {/* O mesmo cartao da previa (o pedaco do cartao Livre e baixado so quando aparece). */}
          <MemberPopupCard playing={false} popup={popup} preview />
        </span>
      </span>
    </span>
  );
}

const NO_ERRORS: Readonly<Record<string, string>> = {};

/** O texto do botao principal nas miniaturas dos modelos (o destino fica para o editor). */
const STARTER_PREVIEW_CTA = { href: "", label: "Saiba mais", target: "same_tab" } as const;

/** Miniatura do modelo (so cores e numeros dos modelos prontos; nada do produtor). */
function StarterThumb({ id }: { id: PopupDesignStarterId }) {
  const design = useMemo(() => popupStarterDesign(id), [id]);
  const hasMedia = design.media.kind !== "none";
  const over = hasMedia && design.text.placement !== "below";
  const bars = design.blocks.map((block) => {
    const style: CSSProperties = {};

    if (block.type === "badge") {
      Object.assign(style, { background: paintToCss(block.background), borderRadius: 999, height: 5, width: 18 });
    } else if (block.type === "heading") {
      return block.lines.map((line, index) => (
        <span className="block h-[5px] rounded-full" key={`${block.id}-${index}`} style={{ background: paintToCss(line.paint ?? block.style.paint), width: index === 0 ? 34 : 28 }} />
      ));
    } else if (block.type === "text") {
      Object.assign(style, { background: paintToCss(block.style.paint), borderRadius: 999, height: 3, opacity: 0.7, width: 40 });
    } else if (block.type === "button") {
      Object.assign(style, { background: paintToCss(block.style.background), borderRadius: 999, height: 7, width: block.style.width === "full" ? 44 : 24 });
    } else {
      return null;
    }

    return <span className="block" key={block.id} style={style} />;
  });

  return (
    <span
      aria-hidden="true"
      className="relative grid h-[84px] w-[60px] shrink-0 overflow-hidden rounded-md border border-white/10"
      style={{ background: cardBackgroundCss(design.card.background) }}
    >
      {hasMedia ? (
        <span
          className="col-start-1 row-start-1 block w-full"
          style={{ aspectRatio: design.media.aspect.replace(":", " / "), background: "linear-gradient(135deg, #52525b, #27272a)" }}
        />
      ) : null}
      <span
        className={cn("col-start-1 flex flex-col gap-[3px] p-1.5", over ? "row-start-1 self-end" : hasMedia ? "row-start-2 -mt-2" : "row-start-1 self-center")}
        style={{ alignItems: design.text.align === "center" ? "center" : design.text.align === "right" ? "flex-end" : "flex-start" }}
      >
        {bars}
      </span>
    </span>
  );
}

function StarterPicker({ disabled, onClose, onUse, showClose }: { disabled: boolean; onClose: () => void; onUse: (id: PopupDesignStarterId) => void; showClose: boolean }) {
  const copy = POPUP_DESIGN_COPY.starters;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0">
        <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{copy.title}</h3>
        <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{copy.hint}</p>
      </div>
      <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
        {DESIGN_STARTER_OPTIONS.map((starter) => (
          <li className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3" key={starter.id}>
            <StarterThumb id={starter.id} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <div className="min-w-0">
                <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">{starter.label}</p>
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{starter.description}</p>
              </div>
              <Button
                aria-label={`${copy.use}: ${starter.label}`}
                className="h-9 px-3 pointer-coarse:h-11"
                disabled={disabled}
                onClick={() => onUse(starter.id)}
                type="button"
                variant="secondary"
              >
                {copy.use}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {showClose ? (
        <div>
          <Button className="h-9 px-3 text-[var(--text-secondary)] pointer-coarse:h-11" disabled={disabled} onClick={onClose} type="button" variant="ghost">
            {copy.close}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ModeChoice({ disabled, error, onChange, value }: { disabled: boolean; error?: string; onChange: (mode: PopupDesignMode) => void; value: PopupDesignMode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div aria-label={POPUP_DESIGN_COPY.modes.groupLabel} className="grid min-w-0 gap-2" role="radiogroup">
        {DESIGN_MODE_OPTIONS.map((option) => {
          const checked = option.value === value;

          return (
            <label
              className={cn(
                "flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3",
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
                checked ? "border-[var(--text-primary)] bg-[var(--surface-3)]" : "border-[var(--border-strong)] hover:bg-[var(--hover-overlay)]",
                disabled && "cursor-not-allowed opacity-60"
              )}
              key={option.value}
            >
              <input
                checked={checked}
                className="sr-only"
                disabled={disabled}
                name="popup-design"
                onChange={() => onChange(option.value)}
                type="radio"
                value={option.value}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                  checked ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-0)]" : "border-[var(--border-strong)]"
                )}
              >
                {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm leading-6 font-medium text-[var(--text-primary)]">{option.label}</span>
                <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <DesignFieldError message={error} />
    </div>
  );
}

function FreeStarterPicker({
  busy,
  disabled,
  onClose,
  onUse,
  showClose
}: {
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onUse: (id: FreeStarterId) => void;
  showClose: boolean;
}) {
  const copy = POPUP_DESIGN_COPY.free.starters;
  const designs = useMemo(() => Object.fromEntries(FREE_STARTER_OPTIONS.map((starter) => [starter.id, freeStarterDesign(starter.id)])) as Record<FreeStarterId, PopupFreeDesign>, []);

  return (
    <div className="flex min-w-0 flex-col gap-3" id="popup-livre-modelos">
      <div className="min-w-0">
        <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{copy.title}</h3>
        <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{copy.hint}</p>
      </div>
      <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
        {FREE_STARTER_OPTIONS.map((starter) => (
          <li className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3" key={starter.id}>
            <FreeThumb design={designs[starter.id]} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <div className="min-w-0">
                <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">{starter.label}</p>
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{starter.description}</p>
              </div>
              <Button
                aria-label={`${copy.use}: ${starter.label}`}
                className="h-9 px-3 pointer-coarse:h-11"
                disabled={disabled || busy}
                onClick={() => onUse(starter.id)}
                type="button"
                variant="secondary"
              >
                {busy ? POPUP_DESIGN_COPY.free.preparing : copy.use}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {showClose ? (
        <div>
          <Button className="h-9 px-3 text-[var(--text-secondary)] pointer-coarse:h-11" disabled={disabled} onClick={onClose} type="button" variant="ghost">
            {copy.close}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type FreeEditorState = {
  initialDesign: PopupFreeDesign;
  initialFocus: FreeDesignEditorProps["initialFocus"];
  undoTo: FreeDesignEditorProps["undoTo"];
};

export function PopupDesignField({
  disabled,
  draft,
  errorFor,
  fonts,
  freeProblems = NO_ERRORS,
  freeServerErrors = NO_ERRORS,
  noticeId = null,
  onBusyChange,
  onChange,
  onFontsChange,
  onFreeEditorOpenChange,
  onImageUploadChange,
  onSaveDraft,
  products,
  productsLoaded,
  savesInPlace = false
}: PopupDesignFieldProps) {
  const design = draft.design ?? null;
  const freeDesign = draft.freeDesign ?? null;
  // O ultimo design de cada modo que saiu (volta sem perguntar ao escolher o modo de novo).
  const remembered = useRef<RememberedDesigns>(NO_REMEMBERED_DESIGNS);
  const latest = useRef(draft);
  // Personalizado ou Livre escolhido sem design ainda, ou "Trocar de modelo" aberto: a lista de modelos daquele modo.
  const [choosing, setChoosing] = useState<Exclude<PopupDesignMode, "default"> | null>(null);
  const [confirmStarter, setConfirmStarter] = useState<PopupDesignStarterId | null>(null);
  const [confirmFreeStarter, setConfirmFreeStarter] = useState<FreeStarterId | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [upload, setUpload] = useState<{ apply?: (font: PopupFontOption) => void } | null>(null);
  const [freeEditor, setFreeEditor] = useState<FreeEditorState | null>(null);
  const wide = useWideScreen();
  const draftMode = popupDesignModeOf(draft);
  const mode: PopupDesignMode = draftMode !== "default" ? draftMode : (choosing ?? "default");
  const hints = useMemo(() => (design ? popupDesignContrastHints(design) : []), [design]);
  const freeProblemCount = Object.keys(freeProblems).length;

  useEffect(() => {
    latest.current = draft;
  });

  function changeMode(next: PopupDesignMode) {
    if (next === mode) {
      return;
    }

    const result = switchDesignMode(draft, next, remembered.current);
    const restored = next === "custom" ? result.patch?.design : next === "free" ? result.patch?.freeDesign : null;
    remembered.current = result.remembered;
    setChoosing(next !== "default" && !restored ? next : null);

    if (result.patch) {
      onChange(result.patch);
    }
  }

  function applyStarterNow(id: PopupDesignStarterId) {
    onChange(applyStarter(draft, id, design ?? remembered.current.custom));
    setChoosing(null);
    setConfirmStarter(null);
  }

  function openFreeEditor(state: FreeEditorState) {
    if (!wide || disabled) {
      return;
    }

    onFreeEditorOpenChange?.(true);
    setFreeEditor(state);
  }

  /** Escolher um modelo do Livre: aplica e abre o editor (numa tela larga); trocar guarda o de antes para desfazer. */
  async function applyFreeStarterNow(id: FreeStarterId) {
    const previous = freeDesign ? { cta: draft.cta, design: freeDesign } : null;
    const video = freeStarterVideoOf(draft, remembered.current);
    let poster: { height: number; path: string; width: number } | null = null;

    setConfirmFreeStarter(null);

    // A imagem do aviso (do nosso bucket) vira a capa do Vídeo do modelo, com as medidas lidas aqui.
    const imageUrl = draft.image?.url ?? null;
    const imagePath = imageUrl ? popupCardImagePathOf(imageUrl) : null;

    if (video && imageUrl && imagePath && freeStarterDesign(id).children.some((node) => node.type === "video")) {
      setPreparing(true);
      const size = await measureImage(imageUrl);
      setPreparing(false);
      poster = size ? { ...size, path: imagePath } : null;
    }

    const patch = applyFreeStarterPatch(latest.current, id, { poster, video });
    onChange(patch);
    setChoosing(null);
    openFreeEditor({ initialDesign: patch.freeDesign, initialFocus: null, undoTo: previous });
  }

  function updateDesign(next: PopupDesign) {
    onChange({ design: next });
  }

  const latestDesign = () => latest.current.design ?? design;
  // O video (Mídia), a imagem do fundo (Cartão) e os envios do editor Livre sobem separados: o salvar espera todos.
  const busyReasons = useRef<{ background: string | null; free: string | null; media: string | null }>({ background: null, free: null, media: null });
  const reportBusy = (part: "background" | "free" | "media", reason: string | null) => {
    busyReasons.current = { ...busyReasons.current, [part]: reason };
    onBusyChange?.(busyReasons.current.media ?? busyReasons.current.background ?? busyReasons.current.free);
  };
  const context: BlockEditorContext = {
    cta: draft.cta,
    disabled,
    errorFor,
    hints,
    library: fonts,
    onCtaChange: (cta) => onChange({ cta }),
    onRequestUpload: (apply) => setUpload({ apply }),
    products,
    productsLoaded
  };
  const freeCopy = POPUP_DESIGN_COPY.free;

  return (
    <SectionCard description={POPUP_DESIGN_COPY.card.description} title={POPUP_DESIGN_COPY.card.title}>
      <div className="flex min-w-0 flex-col gap-5">
        <ModeChoice disabled={disabled} error={errorFor("design") ?? errorFor("design.version")} onChange={changeMode} value={mode} />

        {mode === "custom" && (choosing === "custom" || !design) ? (
          <StarterPicker
            disabled={disabled}
            onClose={() => setChoosing(null)}
            onUse={(id) => (design ? setConfirmStarter(id) : applyStarterNow(id))}
            showClose={Boolean(design)}
          />
        ) : null}

        {design && choosing !== "custom" ? (
          <>
            <div>
              <Button className="h-9 gap-1.5 px-3 pointer-coarse:h-11" disabled={disabled} onClick={() => setChoosing("custom")} type="button" variant="secondary">
                <Shapes aria-hidden="true" className="size-4" />
                {POPUP_DESIGN_COPY.starters.change}
              </Button>
            </div>
            <MediaSection
              design={design}
              disabled={disabled}
              draft={draft}
              errorFor={errorFor}
              latest={() => latest.current}
              onBusyChange={(reason) => reportBusy("media", reason)}
              onChange={onChange}
              onImageUploadChange={onImageUploadChange}
            />
            <TextZoneSection design={design} disabled={disabled} errorFor={errorFor} onChange={updateDesign} />
            <BlocksSection
              context={context}
              design={design}
              hints={hints}
              latestDesign={latestDesign}
              onChange={onChange}
            />
            <CardSection
              design={design}
              disabled={disabled}
              errorFor={errorFor}
              hints={hints}
              latestDesign={() => latest.current.design ?? null}
              onBusyChange={(reason) => reportBusy("background", reason)}
              onChange={updateDesign}
            />
            <FontsSection disabled={disabled} errorFor={errorFor} fonts={fonts} onFontsChange={onFontsChange} onRequestUpload={() => setUpload({})} />
            <CloseSection design={design} disabled={disabled} errorFor={errorFor} hints={hints} onChange={updateDesign} />
          </>
        ) : null}

        {mode === "free" && (choosing === "free" || !freeDesign) ? (
          <FreeStarterPicker
            busy={preparing}
            disabled={disabled}
            onClose={() => setChoosing(null)}
            onUse={(id) => (freeDesign ? setConfirmFreeStarter(id) : void applyFreeStarterNow(id))}
            showClose={Boolean(freeDesign)}
          />
        ) : null}

        {freeDesign && choosing !== "free" ? (
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start" id="popup-livre">
            <FreeThumb design={freeDesign} fonts={fonts} label={freeCopy.thumbLabel} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <Button
                aria-describedby={wide ? undefined : "popup-livre-tela"}
                className="h-9 gap-1.5 px-3 pointer-coarse:h-11"
                disabled={disabled || !wide}
                id="popup-livre-abrir"
                onClick={() => openFreeEditor({ initialDesign: freeDesign, initialFocus: null, undoTo: null })}
                onFocus={prefetchFreeEditor}
                onPointerEnter={prefetchFreeEditor}
                type="button"
              >
                <PencilRuler aria-hidden="true" className="size-4" />
                {freeCopy.open}
              </Button>
              <p className="text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">{freeDesignSummary(freeDesign)}</p>
              {freeProblemCount > 0 ? (
                wide ? (
                  <button
                    className="text-left text-[13px] leading-5 font-medium text-[var(--warning)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-60"
                    disabled={disabled}
                    id="popup-livre-revisar"
                    onClick={() => openFreeEditor({ initialDesign: freeDesign, initialFocus: { kind: "review" }, undoTo: null })}
                    type="button"
                  >
                    {freeProblemsLabel(freeProblemCount)}
                  </button>
                ) : (
                  <p className="text-[13px] leading-5 font-medium text-[var(--warning)]" id="popup-livre-revisar" tabIndex={-1}>
                    {freeProblemsLabel(freeProblemCount)}
                  </p>
                )
              ) : null}
              {wide ? null : (
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]" id="popup-livre-tela">
                  {freeCopy.smallScreen}
                </p>
              )}
              <Button className="h-9 gap-1.5 px-3 pointer-coarse:h-11" disabled={disabled} onClick={() => setChoosing("free")} type="button" variant="secondary">
                <Shapes aria-hidden="true" className="size-4" />
                {freeCopy.change}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {freeEditor ? (
        <FreeDesignEditor
          content={{
            allowSnooze: draft.allowSnooze,
            audio: draft.audio,
            cta: draft.cta,
            onCtaChange: (cta) => onChange({ cta }),
            products,
            productsLoaded,
            title: draft.title
          }}
          disabled={disabled}
          fonts={fonts}
          initialDesign={freeEditor.initialDesign}
          initialFocus={freeEditor.initialFocus}
          noticeId={noticeId}
          onBusyChange={(reason) => reportBusy("free", reason)}
          onChange={(next) => onChange({ freeDesign: next })}
          onClose={(result) => {
            setFreeEditor(null);
            reportBusy("free", null);
            onFreeEditorOpenChange?.(false, result);
            returnFocusToFreeCard();
          }}
          onFontsChange={onFontsChange}
          onSaveDraft={onSaveDraft ?? (async () => ({ errors: {}, message: "", ok: false as const }))}
          open
          savesInPlace={savesInPlace}
          serverErrors={freeServerErrors}
          undoTo={freeEditor.undoTo}
        />
      ) : null}

      <ConfirmDialog
        cancelLabel={freeCopy.confirm.cancel}
        confirmLabel={freeCopy.confirm.confirm}
        description={freeCopy.confirm.description}
        onConfirm={() => (confirmFreeStarter ? void applyFreeStarterNow(confirmFreeStarter) : undefined)}
        onOpenChange={(open) => (!open ? setConfirmFreeStarter(null) : undefined)}
        open={confirmFreeStarter !== null}
        title={freeCopy.confirm.title}
      />

      <ConfirmDialog
        cancelLabel={POPUP_DESIGN_COPY.starters.confirm.cancel}
        confirmLabel={POPUP_DESIGN_COPY.starters.confirm.confirm}
        description={POPUP_DESIGN_COPY.starters.confirm.description}
        onConfirm={() => (confirmStarter ? applyStarterNow(confirmStarter) : undefined)}
        onOpenChange={(open) => (!open ? setConfirmStarter(null) : undefined)}
        open={confirmStarter !== null}
        title={POPUP_DESIGN_COPY.starters.confirm.title}
      />

      <FontUploadDialog
        onOpenChange={(open) => (!open ? setUpload(null) : undefined)}
        onUploaded={(font) => {
          onFontsChange(sortedFontLibrary([...fonts, font]));
          upload?.apply?.(font);
          adminToast.success(POPUP_DESIGN_COPY.fonts.uploaded);
        }}
        open={upload !== null}
      />
    </SectionCard>
  );
}
