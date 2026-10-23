"use client";

import { Check, Shapes } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cardBackgroundCss,
  paintToCss,
  popupDesignContrastHints,
  popupStarterDesign,
  type PopupDesign,
  type PopupDesignStarterId,
  type PopupFontOption
} from "@/server/communications/popup-design-model";
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
import { DESIGN_MODE_OPTIONS, DESIGN_STARTER_OPTIONS, POPUP_DESIGN_COPY, applyStarter, sortedFontLibrary, switchDesignMode, type PopupDesignMode } from "./popup-design-editor-model";

// Cartao "Design" do editor do pop-up (docs/26; spec §7): Padrão | Personalizado, modelos para comecar e as secoes
// Mídia, Texto e posição, Blocos, Cartão, Fontes e Fechar e links, com as dicas de contraste. Quem chama
// (notice-editor) guarda o rascunho e os erros (chaves do zod: "design.blocks.2.lines.0.text", "cta.label",
// "image"...). O design vive em `draft.design` (null = Padrão); voltar ao Padrão guarda o design em memoria e
// voltar ao Personalizado devolve, sem perguntar. A notificacao do sino nunca tem design (o editor nem mostra).

export type PopupDesignFieldProps = {
  disabled: boolean;
  /** O rascunho inteiro do pop-up (cta, image, audio, allowSnooze e design). */
  draft: NoticeDraft;
  errorFor: (key: string) => string | undefined;
  /** A biblioteca de fontes (NoticeEditorOptions.popupFonts, depois atualizada por onFontsChange). */
  fonts: readonly PopupFontOption[];
  /** Motivo para nao salvar agora (video subindo); null = livre. */
  onBusyChange?: (reason: string | null) => void;
  onChange: (patch: Partial<Pick<NoticeDraft, "cta" | "design" | "image">>) => void;
  /** Biblioteca depois de enviar, renomear ou excluir uma fonte. */
  onFontsChange: (fonts: PopupFontOption[]) => void;
  /** Recorte da imagem subindo (data URL, para a previa) ou null quando terminou. */
  onImageUploadChange?: (preview: string | null) => void;
  /** Produtos do destino do botao principal e do segundo botao (o mesmo seletor do "Para onde leva"). */
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
};

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
      <div aria-label={POPUP_DESIGN_COPY.modes.groupLabel} className="grid min-w-0 gap-2 sm:grid-cols-2" role="radiogroup">
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

export function PopupDesignField({
  disabled,
  draft,
  errorFor,
  fonts,
  onBusyChange,
  onChange,
  onFontsChange,
  onImageUploadChange,
  products,
  productsLoaded
}: PopupDesignFieldProps) {
  const design = draft.design ?? null;
  // Ultimo design antes de voltar ao Padrão (volta sem perguntar ao escolher Personalizado de novo).
  const remembered = useRef<PopupDesign | null>(null);
  const latest = useRef(draft);
  // Personalizado escolhido sem design ainda, ou "Trocar de modelo" aberto: a lista de modelos.
  const [choosing, setChoosing] = useState(false);
  const [confirmStarter, setConfirmStarter] = useState<PopupDesignStarterId | null>(null);
  const [upload, setUpload] = useState<{ apply?: (font: PopupFontOption) => void } | null>(null);
  const mode: PopupDesignMode = design || choosing ? "custom" : "default";
  const hints = useMemo(() => (design ? popupDesignContrastHints(design) : []), [design]);

  useEffect(() => {
    latest.current = draft;
  });

  function changeMode(next: PopupDesignMode) {
    if (next === mode) {
      return;
    }

    const result = switchDesignMode(draft, next, remembered.current);
    remembered.current = result.remembered;
    setChoosing(next === "custom" && !result.patch);

    if (result.patch) {
      onChange(result.patch);
    }
  }

  function applyStarterNow(id: PopupDesignStarterId) {
    onChange(applyStarter(draft, id, design ?? remembered.current));
    setChoosing(false);
    setConfirmStarter(null);
  }

  function updateDesign(next: PopupDesign) {
    onChange({ design: next });
  }

  const latestDesign = () => latest.current.design ?? design;
  // O video (Mídia) e a imagem do fundo (Cartão) sobem separados: o salvar espera os dois.
  const busyReasons = useRef<{ background: string | null; media: string | null }>({ background: null, media: null });
  const reportBusy = (part: "background" | "media", reason: string | null) => {
    busyReasons.current = { ...busyReasons.current, [part]: reason };
    onBusyChange?.(busyReasons.current.media ?? busyReasons.current.background);
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

  return (
    <SectionCard description={POPUP_DESIGN_COPY.card.description} title={POPUP_DESIGN_COPY.card.title}>
      <div className="flex min-w-0 flex-col gap-5">
        <ModeChoice disabled={disabled} error={errorFor("design") ?? errorFor("design.version")} onChange={changeMode} value={mode} />

        {mode === "custom" && (choosing || !design) ? (
          <StarterPicker
            disabled={disabled}
            onClose={() => setChoosing(false)}
            onUse={(id) => (design ? setConfirmStarter(id) : applyStarterNow(id))}
            showClose={Boolean(design)}
          />
        ) : null}

        {design && !choosing ? (
          <>
            <div>
              <Button className="h-9 gap-1.5 px-3 pointer-coarse:h-11" disabled={disabled} onClick={() => setChoosing(true)} type="button" variant="secondary">
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
      </div>

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
