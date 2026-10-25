"use client";

import { BookmarkPlus, Check, PencilRuler, Shapes } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
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
  type PopupFontFace,
  type PopupFontOption
} from "@/server/communications/popup-design-model";
import { freePreviewPopupItem, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import { resolveFreeArtboard } from "@/server/communications/popup-free-render";
import { freeFromCustomDesign, freeStarterDesign, type FreeStarterId } from "@/server/communications/popup-free-starters";
import { GENERIC_ACTION_ERROR } from "@/lib/action-result";
import type { NoticeDraft } from "@/server/communications/schemas";
import { saveTemplate, type DesignTemplateOption } from "@/server/communications/template-actions";
import { applyDesignTemplatePatch, defaultTemplateName, templateDesignSupportOf, templateErrorsFromAction } from "@/server/communications/template-model";
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
import { useDesignTemplatesLoad } from "../popup-free/free-templates-panel";
import { TemplateNameDialog } from "../templates/template-name-dialog";
import { CustomDesignThumb, FreeDesignThumb } from "../templates/template-thumbs";
import {
  DESIGN_MODE_OPTIONS,
  DESIGN_STARTER_OPTIONS,
  FREE_STARTER_OPTIONS,
  NO_REMEMBERED_DESIGNS,
  POPUP_DESIGN_COPY,
  applyFreeFromCustomPatch,
  applyFreeStarterPatch,
  applyStarter,
  designTemplatesPickerState,
  freeCustomSourceOf,
  freeDesignSummary,
  freeProblemsLabel,
  freeStarterVideoOf,
  popupDesignModeOf,
  sortedFontLibrary,
  switchDesignMode,
  type DesignTemplatesPickerView,
  type PopupDesignMode,
  type RememberedDesigns
} from "./popup-design-editor-model";
import { popupSettingsOfDraft } from "../popup-editor-model";
import type { FreeDesignEditorProps } from "../popup-free/free-editor";

// Cartao "Design" do editor do pop-up (docs/26; spec §7): Padrão | Personalizado | Livre, modelos para comecar e,
// no Personalizado, as secoes Mídia, Texto e posição, Blocos, Cartão, Fontes e Fechar e links, com as dicas de
// contraste. Quem chama (notice-editor) guarda o rascunho e os erros (chaves do zod: "design.blocks.2.lines.0.text",
// "cta.label", "image"...). O Personalizado vive em `draft.design` e o Livre em `draft.freeDesign` (os dois nulos =
// Padrão; nunca os dois); trocar de modo guarda o design do modo que saiu em memoria e voltar devolve, sem perguntar.
// A notificacao do sino nunca tem design (o editor nem mostra).
//
// Livre (docs/27; spec §4.1): modelos com miniatura (o proprio PopupFreeCard em previa, no computador), o resumo do design montado
// e o botao "Abrir editor Livre", que baixa o editor de tela cheia (next/dynamic, so ao abrir) e so abre em telas a
// partir de 1.024 px. O editor trabalha numa copia e manda o design ao rascunho; "Salvar rascunho" dentro dele chama
// `onSaveDraft` (o editor do aviso nao troca de endereco enquanto ele esta aberto, spec §4.13).
//
// Modelos (docs/28 §5.8): com a ligacao dos modelos, a lista do modo abre com "Meus modelos" (os designs que a equipe guardou,
// lidos sob demanda na primeira abertura, no maximo 50) antes dos "Modelos prontos", e o card ganha "Salvar design
// como modelo". Usar um design guardado: no Personalizado aplica na hora com Desfazer no aviso; no Livre, pergunta se
// ja ha Livre, aplica e abre o editor (o de antes fica um passo atras). `freeEditor` muda o editor Livre fora do aviso
// comum (rotulo do salvar, linha de baixo do titulo, copia de recuperacao, aba Modelos) e `templateMode` fixa o modo
// na pagina do design guardado (sem a escolha Padrão/Personalizado/Livre e sem o destino do botao principal);
// `hideCtaDestination` tira so o destino (modo modelo de Pop-up com "Levar o conteúdo" desligado).

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
  onChange: (patch: Partial<Pick<NoticeDraft, "allowSnooze" | "cta" | "design" | "freeDesign" | "image">>) => void;
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
  /** "Meus modelos" e "Salvar design como modelo" (null = escondidos; docs/28 §5.8). */
  templates?: {
    /**
     * Avisa o editor que um design guardado foi aplicado (o editor guarda a lista dos aplicados) e devolve o que o
     * Desfazer do toast chama para tirar o modelo da lista (o salvar nao manda o id nem registra o uso na auditoria).
     */
    onApplied: (templateId: string) => () => void;
    /** O aviso salvo (null = novo) e os modelos ja aplicados: arquivos conhecidos no salvar do modelo. */
    sourceNoticeId: string | null;
    sourceTemplateIds: readonly string[];
  } | null;
  /**
   * O editor Livre fora do aviso comum (modo modelo de Pop-up e pagina do design guardado). Nao esconde a escolha de
   * modo. null = o editor Livre do aviso (copia de recuperacao do aviso, "Salvar rascunho", titulo do aviso, aba
   * Modelos quando os modelos estao ligados). `saveConfirm`: a pergunta de D29 antes do primeiro salvar.
   */
  freeEditor?: {
    /** false na pagina do modelo de Design: a chave "Permitir “Lembrar depois”" de Links › Conteúdo vira uma nota. */
    allowSnoozeEditable?: boolean;
    recoveryKey: string;
    saveConfirm?: FreeDesignEditorProps["saveConfirm"];
    saveLabel: string;
    showTemplatesTab: boolean;
    subtitle: string;
  } | null;
  /** So a pagina do design guardado (docs/28 §5.7): fixa o modo e esconde a escolha Padrão/Personalizado/Livre. */
  templateMode?: { mode: "custom" | "free" } | null;
  /**
   * O botao principal so com o texto, no Personalizado e no Livre ("O destino do botão é escolhido em cada aviso."): no
   * modo modelo de Pop-up com "Levar o conteúdo" desligado, o destino nunca vai para o modelo (docs/28 §1.6). A pagina
   * do design guardado (`templateMode`) esconde sempre.
   */
  hideCtaDestination?: boolean;
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
          <MemberPopupCard device="desktop" playing={false} popup={popup} preview />
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

type MineView = DesignTemplatesPickerView<DesignTemplateOption>;

/**
 * "Meus modelos" na lista do modo (docs/28 §5.8): carregando (duas linhas e o texto para leitor de tela), erro com
 * "Tentar de novo" ou os designs guardados com a miniatura, o nome, a data e "Usar este modelo". Sem itens, nada.
 */
function MineSection({
  disabled,
  fonts,
  mode,
  onRetry,
  onUse,
  view
}: {
  disabled: boolean;
  fonts: readonly PopupFontFace[];
  mode: "custom" | "free";
  onRetry: () => void;
  onUse: (item: DesignTemplateOption) => void;
  view: MineView;
}) {
  const copy = POPUP_DESIGN_COPY.mine;
  const headingId = `popup-design-meus-${mode}`;

  if (view.loading) {
    return (
      <div aria-busy="true" className="flex min-w-0 flex-col gap-2" data-design-mine="loading" role="status">
        <span className="sr-only">{view.loading.label}</span>
        {[0, 1].map((row) => (
          <span aria-hidden="true" className="block h-[108px] w-full animate-pulse rounded-lg bg-[var(--surface-2)]" key={row} />
        ))}
      </div>
    );
  }

  if (view.error) {
    return (
      <div className="flex min-w-0 flex-col items-start gap-2" data-design-mine="error" role="alert">
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{view.error.message}</p>
        <Button className="h-9 px-3 pointer-coarse:h-11" onClick={onRetry} type="button" variant="secondary">
          {view.error.retry}
        </Button>
      </div>
    );
  }

  const entries = (view.section?.items ?? []).filter((entry) => ("mode" in entry.item.design && entry.item.design.mode === "free") === (mode === "free"));

  if (!view.section || entries.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2" data-design-mine="ready">
      <h4 className="text-[13px] leading-5 font-semibold text-[var(--text-primary)]" id={headingId}>
        {view.section.title}
      </h4>
      <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
        {entries.map((entry) => (
          <li className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3" key={entry.item.id}>
            {"mode" in entry.item.design && entry.item.design.mode === "free" ? (
              <FreeDesignThumb design={entry.item.design} fonts={fonts} size="picker" />
            ) : (
              <CustomDesignThumb design={entry.item.design as PopupDesign} size="picker" />
            )}
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <div className="min-w-0 max-w-full">
                <p className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{entry.name}</p>
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{entry.updated}</p>
              </div>
              <Button aria-label={entry.useLabel} className="h-9 px-3 pointer-coarse:h-11" disabled={disabled} onClick={() => onUse(entry.item)} type="button" variant="secondary">
                {copy.use}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {view.section.note ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{view.section.note}</p> : null}
    </section>
  );
}

/** O titulo dos modelos prontos quando a lista tem "Meus modelos" (ou na pagina do design guardado). */
function ReadyTitle({ title }: { title: string | null }) {
  return title ? <h4 className="text-[13px] leading-5 font-semibold text-[var(--text-primary)]">{title}</h4> : null;
}

function StarterPicker({
  disabled,
  mine = null,
  onClose,
  onUse,
  readyTitle = null,
  showClose
}: {
  disabled: boolean;
  mine?: ReactNode;
  onClose: () => void;
  onUse: (id: PopupDesignStarterId) => void;
  readyTitle?: string | null;
  showClose: boolean;
}) {
  const copy = POPUP_DESIGN_COPY.starters;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0">
        <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{copy.title}</h3>
        <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{copy.hint}</p>
      </div>
      {mine}
      <ReadyTitle title={readyTitle} />
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
  fromCustom,
  mine = null,
  onClose,
  onUse,
  onUseCustom,
  readyTitle = null,
  showClose
}: {
  busy: boolean;
  disabled: boolean;
  /** "Usar o design Personalizado": a miniatura do Livre que sai dele (null = o aviso nao tem Personalizado). */
  fromCustom: PopupFreeDesign | null;
  mine?: ReactNode;
  onClose: () => void;
  onUse: (id: FreeStarterId) => void;
  onUseCustom: () => void;
  readyTitle?: string | null;
  showClose: boolean;
}) {
  const copy = POPUP_DESIGN_COPY.free.starters;
  const customCopy = POPUP_DESIGN_COPY.free.fromCustom;
  const designs = useMemo(() => Object.fromEntries(FREE_STARTER_OPTIONS.map((starter) => [starter.id, freeStarterDesign(starter.id)])) as Record<FreeStarterId, PopupFreeDesign>, []);

  return (
    <div className="flex min-w-0 flex-col gap-3" id="popup-livre-modelos">
      <div className="min-w-0">
        <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{copy.title}</h3>
        <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{copy.hint}</p>
      </div>
      {mine}
      <ReadyTitle title={readyTitle} />
      <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
        {fromCustom ? (
          <li className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3" data-free-from-custom="">
            <FreeThumb design={fromCustom} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <div className="min-w-0">
                <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">{customCopy.label}</p>
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{customCopy.description}</p>
              </div>
              <Button className="h-9 px-3 pointer-coarse:h-11" disabled={disabled || busy} onClick={onUseCustom} type="button" variant="secondary">
                {busy ? POPUP_DESIGN_COPY.free.preparing : customCopy.use}
              </Button>
            </div>
          </li>
        ) : null}
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
  freeEditor: freeEditorSetup = null,
  freeProblems = NO_ERRORS,
  freeServerErrors = NO_ERRORS,
  hideCtaDestination: hideCtaDestinationProp = false,
  noticeId = null,
  onBusyChange,
  onChange,
  onFontsChange,
  onFreeEditorOpenChange,
  onImageUploadChange,
  onSaveDraft,
  products,
  productsLoaded,
  savesInPlace = false,
  templateMode: fixedMode = null,
  templates: mine = null
}: PopupDesignFieldProps) {
  const design = draft.design ?? null;
  const freeDesign = draft.freeDesign ?? null;
  // O ultimo design de cada modo que saiu (volta sem perguntar ao escolher o modo de novo).
  const remembered = useRef<RememberedDesigns>(NO_REMEMBERED_DESIGNS);
  const latest = useRef(draft);
  // Personalizado ou Livre escolhido sem design ainda, ou "Trocar de modelo" aberto: a lista de modelos daquele modo.
  const [choosing, setChoosing] = useState<Exclude<PopupDesignMode, "default"> | null>(null);
  const [confirmStarter, setConfirmStarter] = useState<PopupDesignStarterId | null>(null);
  const [confirmFreeStarter, setConfirmFreeStarter] = useState<FreeStarterId | "custom" | null>(null);
  // O Personalizado guardado na memoria (espelho do ref para a tela): "Usar o design Personalizado" no Livre.
  const [rememberedCustom, setRememberedCustom] = useState<PopupDesign | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [upload, setUpload] = useState<{ apply?: (font: PopupFontOption) => void } | null>(null);
  const [freeEditor, setFreeEditor] = useState<FreeEditorState | null>(null);
  // "Meus modelos" (docs/28 §5.8): um por modo, lido na primeira abertura da lista; o Livre guardado pergunta antes de
  // trocar o Livre que o aviso ja tem; "Salvar design como modelo" abre o dialogo do nome.
  const mineCustom = useDesignTemplatesLoad("custom");
  const mineFree = useDesignTemplatesLoad("free");
  const [confirmMine, setConfirmMine] = useState<DesignTemplateOption | null>(null);
  const [savingMine, setSavingMine] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [busyNow, setBusyNow] = useState<string | null>(null);
  const wide = useWideScreen();
  const draftMode = popupDesignModeOf(draft);
  // Pagina do design guardado: o modo e fixo (sem a escolha Padrão/Personalizado/Livre).
  const mode: PopupDesignMode = fixedMode ? fixedMode.mode : draftMode !== "default" ? draftMode : (choosing ?? "default");
  // O destino do botao principal fica de fora: na pagina do design guardado e no modelo de Pop-up sem o conteudo.
  const hideCtaDestination = fixedMode !== null || hideCtaDestinationProp;
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
    setRememberedCustom(result.remembered.custom);
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

  /**
   * "Usar o design Personalizado" (L1.1): o Livre parecido com o Personalizado de agora (ou o guardado), com a imagem
   * do aviso (midia ou capa) e a do fundo do cartao medidas aqui; abre o editor, com o Livre de antes um passo atras.
   */
  async function applyFreeFromCustomNow() {
    const custom = freeCustomSourceOf(latest.current, remembered.current);

    setConfirmFreeStarter(null);

    if (!custom) {
      return;
    }

    const previous = freeDesign ? { cta: draft.cta, design: freeDesign } : null;
    const imageUrl = draft.image?.url ?? null;
    const imagePath = imageUrl ? popupCardImagePathOf(imageUrl) : null;
    const cardUrl = custom.card.background.kind === "image" ? custom.card.background.url : null;
    const cardPath = cardUrl ? popupCardImagePathOf(cardUrl) : null;
    const usesImage = custom.media.kind !== "none";

    setPreparing(true);
    const [imageSize, cardSize] = await Promise.all([
      imageUrl && imagePath && usesImage ? measureImage(imageUrl) : Promise.resolve(null),
      cardUrl && cardPath ? measureImage(cardUrl) : Promise.resolve(null)
    ]);
    setPreparing(false);

    const patch = applyFreeFromCustomPatch(latest.current, custom, {
      cardImage: cardSize && cardPath ? { ...cardSize, path: cardPath } : null,
      hasImage: Boolean(imageUrl),
      image: imageSize && imagePath ? { ...imageSize, path: imagePath } : null
    });

    onChange(patch);
    setChoosing(null);
    openFreeEditor({ initialDesign: patch.freeDesign, initialFocus: null, undoTo: previous });
  }

  // A miniatura de "Usar o design Personalizado": as imagens com medidas de exemplo (as de verdade sao lidas ao usar).
  const customSource = design ?? rememberedCustom;
  const noticeImageUrl = draft.image?.url ?? null;
  const fromCustomThumb = useMemo(() => {
    if (!customSource) {
      return null;
    }

    const imagePath = noticeImageUrl ? popupCardImagePathOf(noticeImageUrl) : null;
    const cardUrl = customSource.card.background.kind === "image" ? customSource.card.background.url : null;
    const cardPath = cardUrl ? popupCardImagePathOf(cardUrl) : null;
    const sample = { height: 720, width: 1280 };

    return freeFromCustomDesign(customSource, {
      audio: draft.audio,
      cardImage: cardPath ? { ...sample, path: cardPath } : null,
      cta: draft.cta,
      hasImage: Boolean(noticeImageUrl),
      image: imagePath ? { ...sample, path: imagePath } : null
    }).design;
  }, [customSource, draft.audio, draft.cta, noticeImageUrl]);

  function updateDesign(next: PopupDesign) {
    onChange({ design: next });
  }

  const latestDesign = () => latest.current.design ?? design;
  // O video (Mídia), a imagem do fundo (Cartão) e os envios do editor Livre sobem separados: o salvar espera todos.
  const busyReasons = useRef<{ background: string | null; free: string | null; media: string | null }>({ background: null, free: null, media: null });
  const reportBusy = (part: "background" | "free" | "media", reason: string | null) => {
    busyReasons.current = { ...busyReasons.current, [part]: reason };
    const nextReason = busyReasons.current.media ?? busyReasons.current.background ?? busyReasons.current.free;
    setBusyNow(nextReason);
    onBusyChange?.(nextReason);
  };
  const reportImageUpload = (preview: string | null) => {
    setImageUploading(preview !== null);
    onImageUploadChange?.(preview);
  };
  // "Salvar design como modelo" espera os envios (o caminho do arquivo ainda nao existe).
  const uploading = busyNow !== null || imageUploading;
  const hasMine = mine !== null;
  const customListOpen = mode === "custom" && (choosing === "custom" || !design);
  const freeListOpen = mode === "free" && (choosing === "free" || !freeDesign);
  const openMineCustom = mineCustom.open;
  const openMineFree = mineFree.open;

  // A lista do modo abriu: "Meus modelos" e lido uma vez por card montado.
  useEffect(() => {
    if (hasMine && customListOpen) {
      openMineCustom();
    }
  }, [customListOpen, hasMine, openMineCustom]);

  useEffect(() => {
    if (hasMine && freeListOpen) {
      openMineFree();
    }
  }, [freeListOpen, hasMine, openMineFree]);

  /** O que um "Desfazer" devolve (o rascunho do design de antes de aplicar). */
  function snapshot(): Partial<Pick<NoticeDraft, "allowSnooze" | "cta" | "design" | "freeDesign" | "image">> {
    const current = latest.current;

    return { allowSnooze: current.allowSnooze, cta: current.cta, design: current.design ?? null, freeDesign: current.freeDesign ?? null, image: current.image };
  }

  /** Personalizado guardado: aplica na hora (sem pergunta) e o toast oferece Desfazer. */
  function applyMineCustom(item: DesignTemplateOption) {
    const before = snapshot();
    const { notes, patch } = applyDesignTemplatePatch(latest.current, { design: item.design, support: item.support });

    onChange(patch);
    setChoosing(null);
    const undoUse = mine?.onApplied(item.id);
    adminToast.success([POPUP_DESIGN_COPY.mine.applied, ...notes].join(" "), {
      onUndo: () => {
        onChange(before);
        undoUse?.();
      }
    });
  }

  /** Livre guardado: aplica e abre o editor (o Livre de antes fica um passo atras); em tela estreita, toast com Desfazer. */
  function applyMineFreeNow(item: DesignTemplateOption) {
    const before = snapshot();
    const current = latest.current;
    const previous = current.freeDesign ? { cta: current.cta, design: current.freeDesign } : null;
    const { notes, patch } = applyDesignTemplatePatch(current, { design: item.design, support: item.support });

    setConfirmMine(null);
    onChange(patch);
    setChoosing(null);
    // No editor Livre, o Ctrl+Z que volta ao Livre de antes nao tira o modelo da lista (docs/28 §1.6); o toast sim.
    const undoUse = mine?.onApplied(item.id);

    if (wide && !disabled && patch.freeDesign) {
      if (notes.length > 0) {
        adminToast.success([POPUP_DESIGN_COPY.mine.applied, ...notes].join(" "));
      }

      openFreeEditor({ initialDesign: patch.freeDesign, initialFocus: null, undoTo: previous });

      return;
    }

    adminToast.success([POPUP_DESIGN_COPY.mine.applied, ...notes].join(" "), {
      onUndo: () => {
        onChange(before);
        undoUse?.();
      }
    });
  }

  async function saveMine(name: string): Promise<{ ok: true } | { fieldError?: string; message: string; ok: false; status: number }> {
    const current = latest.current;
    const result = await saveTemplate({
      body: { design: current.design ?? null, freeDesign: current.freeDesign ?? null, source: "design", support: templateDesignSupportOf(current) },
      name,
      origin: "design_card",
      sourceNoticeId: mine?.sourceNoticeId ?? null,
      sourceTemplateIds: [...(mine?.sourceTemplateIds ?? [])]
    }).catch(() => null);

    if (!result) {
      return { message: GENERIC_ACTION_ERROR, ok: false, status: 500 };
    }

    if (!result.ok) {
      const { name: nameError, ...others } = templateErrorsFromAction(result.fieldErrors);

      return { fieldError: nameError, message: Object.values(others)[0] ?? result.error, ok: false, status: result.status };
    }

    adminToast.success(POPUP_DESIGN_COPY.mine.saved);
    // A lista daquele modo volta a ser lida na proxima abertura (o design novo aparece nela).
    (current.freeDesign ? mineFree : mineCustom).reset();

    return { ok: true };
  }

  const mineCopy = POPUP_DESIGN_COPY.mine;
  const readyTitle = mine || fixedMode ? mineCopy.readyTitle : null;
  const saveMineButton = mine ? (
    <Button
      className="h-9 gap-1.5 px-3 pointer-coarse:h-11"
      disabled={disabled || uploading}
      onClick={() => setSavingMine(true)}
      title={uploading ? mineCopy.waitUpload : undefined}
      type="button"
      variant="secondary"
    >
      <BookmarkPlus aria-hidden="true" className="size-4" />
      {mineCopy.save}
    </Button>
  ) : null;
  const context: BlockEditorContext = {
    cta: draft.cta,
    disabled,
    errorFor,
    hideCtaDestination,
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
        {fixedMode ? (
          <DesignFieldError message={errorFor("design") ?? errorFor("design.version")} />
        ) : (
          <ModeChoice disabled={disabled} error={errorFor("design") ?? errorFor("design.version")} onChange={changeMode} value={mode} />
        )}

        {customListOpen ? (
          <StarterPicker
            disabled={disabled}
            mine={
              mine ? (
                <MineSection disabled={disabled} fonts={mineCustom.fonts} mode="custom" onRetry={mineCustom.retry} onUse={applyMineCustom} view={designTemplatesPickerState(mineCustom.load)} />
              ) : null
            }
            onClose={() => setChoosing(null)}
            onUse={(id) => (design ? setConfirmStarter(id) : applyStarterNow(id))}
            readyTitle={readyTitle}
            showClose={Boolean(design)}
          />
        ) : null}

        {design && choosing !== "custom" && mode === "custom" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button className="h-9 gap-1.5 px-3 pointer-coarse:h-11" disabled={disabled} onClick={() => setChoosing("custom")} type="button" variant="secondary">
                <Shapes aria-hidden="true" className="size-4" />
                {POPUP_DESIGN_COPY.starters.change}
              </Button>
              {saveMineButton}
            </div>
            <MediaSection
              design={design}
              disabled={disabled}
              draft={draft}
              errorFor={errorFor}
              latest={() => latest.current}
              onBusyChange={(reason) => reportBusy("media", reason)}
              onChange={onChange}
              onImageUploadChange={reportImageUpload}
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

        {freeListOpen ? (
          <FreeStarterPicker
            busy={preparing}
            disabled={disabled}
            fromCustom={fromCustomThumb}
            mine={
              mine ? (
                <MineSection
                  disabled={disabled || preparing}
                  fonts={mineFree.fonts}
                  mode="free"
                  onRetry={mineFree.retry}
                  onUse={(item) => (latest.current.freeDesign ? setConfirmMine(item) : applyMineFreeNow(item))}
                  view={designTemplatesPickerState(mineFree.load)}
                />
              ) : null
            }
            onClose={() => setChoosing(null)}
            onUse={(id) => (freeDesign ? setConfirmFreeStarter(id) : void applyFreeStarterNow(id))}
            onUseCustom={() => (freeDesign ? setConfirmFreeStarter("custom") : void applyFreeFromCustomNow())}
            readyTitle={readyTitle}
            showClose={Boolean(freeDesign)}
          />
        ) : null}

        {freeDesign && choosing !== "free" && mode === "free" ? (
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
              <div className="flex flex-wrap gap-2">
                <Button className="h-9 gap-1.5 px-3 pointer-coarse:h-11" disabled={disabled} onClick={() => setChoosing("free")} type="button" variant="secondary">
                  <Shapes aria-hidden="true" className="size-4" />
                  {freeCopy.change}
                </Button>
                {saveMineButton}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {freeEditor ? (
        <FreeDesignEditor
          content={{
            allowSnooze: draft.allowSnooze,
            allowSnoozeEditable: freeEditorSetup?.allowSnoozeEditable ?? true,
            audio: draft.audio,
            cta: draft.cta,
            ctaOptional: freeEditorSetup !== null,
            hideCtaDestination,
            // A mesma regra do card "Quantas vezes e como fecha" (campaigns.allow_snooze), pelo mesmo caminho do cta.
            onAllowSnoozeChange: (allowSnooze) => onChange({ allowSnooze }),
            onCtaChange: (cta) => onChange({ cta }),
            products,
            productsLoaded,
            snoozeMinutes: popupSettingsOfDraft(draft).snoozeMinutes,
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
          recoveryKey={freeEditorSetup?.recoveryKey}
          saveConfirm={freeEditorSetup?.saveConfirm ?? null}
          saveLabel={freeEditorSetup?.saveLabel}
          savesInPlace={savesInPlace}
          serverErrors={freeServerErrors}
          subtitle={freeEditorSetup?.subtitle}
          templates={mine && freeEditorSetup?.showTemplatesTab !== false ? mine : null}
          undoTo={freeEditor.undoTo}
        />
      ) : null}

      {/* Livre guardado num aviso que ja tem Livre: a mesma pergunta do "Trocar de modelo". */}
      <ConfirmDialog
        cancelLabel={freeCopy.confirm.cancel}
        confirmLabel={freeCopy.confirm.confirm}
        description={freeCopy.confirm.description}
        onConfirm={() => (confirmMine ? applyMineFreeNow(confirmMine) : undefined)}
        onOpenChange={(open) => (!open ? setConfirmMine(null) : undefined)}
        open={confirmMine !== null}
        title={freeCopy.confirm.title}
      />

      {mine ? (
        <TemplateNameDialog
          confirmLabel={mineCopy.saveConfirm}
          defaultName={defaultTemplateName({ forDesign: true, kind: "design", mode: freeDesign ? "free" : "custom", title: draft.title })}
          description={mineCopy.saveDescription(freeDesign ? "free" : "custom")}
          onOpenChange={setSavingMine}
          onSubmit={saveMine}
          open={savingMine}
          title={mineCopy.save}
        />
      ) : null}

      <ConfirmDialog
        cancelLabel={freeCopy.confirm.cancel}
        confirmLabel={freeCopy.confirm.confirm}
        description={freeCopy.confirm.description}
        onConfirm={() =>
          confirmFreeStarter === "custom" ? void applyFreeFromCustomNow() : confirmFreeStarter ? void applyFreeStarterNow(confirmFreeStarter) : undefined
        }
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
