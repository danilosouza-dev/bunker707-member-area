"use client";

import { CheckCircle2, LoaderCircle, Upload, Video } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NoticeDraft } from "@/server/communications/schemas";
import type { FreeHint, FreeMeasuredRects } from "@/server/communications/popup-free-checks";
import { FREE_DESIGN_LIMITS, type FreeButtonNode, type FreeNode, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import { freeTextStyleOf } from "@/server/communications/popup-free-render";
import type { PopupFontOption } from "@/server/communications/popup-design-model";
import { HOME_PAGE_LINKS, defaultCtaTarget, describeCtaDestination, homePageLabel, productHref, productIdFromHref, type HeroCtaDestinationMode } from "@/server/member-area/home-hero-links";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../form";
import { HeroTextField } from "../../member-area/home-hero/fields";
import { AdminSwitch } from "../../settings/kit";
import { ProductPicker } from "../../storefront/product-picker";
import { NoticeCtaField, type NoticeCta } from "../notice-cta-field";
import { CtaLabelOnlyField } from "../popup-design/block-editors";
import { ColorField, PillField, fieldLabelClass } from "../popup-design/design-controls";
import { uploadFreeImageFile, uploadFreeVideoFile } from "./free-assets";
import type { FreeEditorContent } from "./free-editor";
import { FocusFields, FreeChoiceField, FreeFieldError, FreeHints, FreeIconGrid, FreeImagePicker, FreeNote, FreeNumberField, FreeTextArea, freeSmallButton, useLatest } from "./free-fields";
import {
  FREE_BOX_ALIGN_OPTIONS,
  FREE_BOX_DIR_OPTIONS,
  FREE_BOX_JUSTIFY_OPTIONS,
  FREE_BUTTON_ACTION_OPTIONS,
  FREE_ICON_SIDE_OPTIONS,
  FREE_IMAGE_FIT_OPTIONS,
  FREE_INSPECTOR_COPY,
  FREE_LINE_STYLE_OPTIONS,
  FREE_LINK_MODE_OPTIONS,
  FREE_LINK_TARGET_OPTIONS,
  FREE_SHAPE_OPTIONS,
  freeButtonActionOf,
  freeErrorAt,
  freeFieldId,
  freeHintsOf,
  freeLetterCount,
  freeLinkActionDisabledReason,
  freeVideoAssetOf,
  withFreeNodeFields,
  withFreeNodeImage,
  withFreeNodeVideo,
  withFreeVideoPoster
} from "./free-inspector-model";

// Editor Livre do pop-up (docs/27; spec §4.6), pacote I: a aba Conteudo de cada tipo. Título e Texto: a area de
// texto com "Outro estilo na seleção"; Selo: texto e icone; Botão principal: o campo do botao do aviso (o mesmo do
// Personalizado, sem a chave); Botão: o que faz, texto, destino e onde abre, icone; Imagem: enviar/trocar/usar uma
// do pop-up, descricao, como preenche e ponto de foco; Vídeo: enviar, capa, como preenche e ponto de foco; Ícone,
// Linha, Espaço, Forma, Caixa, Links e Áudio.

const L = FREE_DESIGN_LIMITS;
const C = FREE_INSPECTOR_COPY;

/** O que cada aba do painel recebe (o painel monta uma vez para o elemento escolhido). */
export type FreeSectionProps = {
  content: FreeEditorContent;
  design: PopupFreeDesign;
  disabled: boolean;
  errors: Readonly<Record<string, string>>;
  fonts: readonly PopupFontOption[];
  hints: readonly FreeHint[];
  /** O design mais novo (um envio termina depois e nao pode desfazer o que mudou no meio). */
  latest: () => PopupFreeDesign;
  node: FreeNode;
  onBusyChange: (reason: string | null) => void;
  /** `field` vira a chave de juntar passos do historico (`<id>:<field>`). */
  onChange: (next: PopupFreeDesign, field?: string) => void;
  onCtaChange: (cta: NoticeDraft["cta"], options?: { coalesceKey?: string }) => void;
  onFontsChange: (fonts: PopupFontOption[]) => void;
  rects: FreeMeasuredRects;
};

export function FreeInspectorContent(props: FreeSectionProps) {
  const { node } = props;

  switch (node.type) {
    case "heading":
    case "text":
      return <TextContent {...props} node={node} />;
    case "badge":
      return <BadgeContent {...props} node={node} />;
    case "button":
      return node.action.kind === "cta" ? <CtaContent {...props} node={node} /> : <ButtonContent {...props} node={node} />;
    case "image":
      return <ImageContent {...props} node={node} />;
    case "video":
      return <VideoContent {...props} node={node} />;
    case "icon":
      return <IconContent {...props} node={node} />;
    case "divider":
      return <DividerContent {...props} node={node} />;
    case "spacer":
      return (
        <FreeNumberField
          bounds={L.spacer}
          disabled={props.disabled}
          error={freeErrorAt(props.errors, `nodes.${node.id}.size`)}
          id={freeFieldId(node.id, "tamanho")}
          label={C.spacer.size}
          onChange={(size) => props.onChange(withFreeNodeFields(props.design, node.id, { size: size === 16 ? undefined : size }), "size")}
          unit={C.units.px}
          value={node.size ?? 16}
        />
      );
    case "shape":
      return (
        <PillField
          disabled={props.disabled}
          label={C.shape.shape}
          name={freeFieldId(node.id, "formato")}
          onChange={(shape) => props.onChange(withFreeNodeFields(props.design, node.id, { shape: shape === "rect" ? undefined : shape }))}
          options={FREE_SHAPE_OPTIONS}
          value={node.shape ?? "rect"}
        />
      );
    case "box":
      return <BoxContent {...props} node={node} />;
    case "links":
      return <LinksContent {...props} node={node} />;
    case "audio":
      return (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)] outline-none" id={freeFieldId(node.id, "audio")} tabIndex={-1}>
          {C.audio.note}
        </p>
      );
  }
}

type Of<T extends FreeNode["type"]> = Omit<FreeSectionProps, "node"> & { node: Extract<FreeNode, { type: T }> };

/* ------------------------------------------------------------------------------------------------
 * Título e Texto
 * ---------------------------------------------------------------------------------------------- */

function TextContent({ design, disabled, errors, fonts, node, onChange, onFontsChange }: Of<"heading" | "text">) {
  return (
    <FreeTextArea
      base={freeTextStyleOf(node)}
      disabled={disabled}
      error={freeErrorAt(errors, `nodes.${node.id}.lines`)}
      fonts={fonts}
      id={freeFieldId(node.id, "texto")}
      letters={freeLetterCount(design)}
      lines={node.lines}
      onChange={(lines, kind) => onChange(withFreeNodeFields(design, node.id, { lines }), kind === "text" ? "lines" : "spans")}
      onFontsChange={onFontsChange}
      type={node.type}
    />
  );
}

/* ------------------------------------------------------------------------------------------------
 * Selo
 * ---------------------------------------------------------------------------------------------- */

function BadgeContent({ design, disabled, errors, node, onChange }: Of<"badge">) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <HeroTextField
        disabled={disabled}
        error={freeErrorAt(errors, `nodes.${node.id}.label`)}
        id={freeFieldId(node.id, "selo-texto")}
        label={C.badge.label}
        max={L.label}
        onBlur={() => undefined}
        onChange={(label) => onChange(withFreeNodeFields(design, node.id, { label }), "label")}
        value={node.label}
      />
      <FreeIconGrid
        allowNone
        disabled={disabled}
        id={freeFieldId(node.id, "icone")}
        label={C.badge.icon}
        onChange={(icon) => onChange(withFreeNodeFields(design, node.id, { icon: icon ?? undefined }))}
        value={node.icon ?? null}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Botões
 * ---------------------------------------------------------------------------------------------- */

function ButtonIconFields({ design, disabled, node, onChange }: Pick<FreeSectionProps, "design" | "disabled" | "onChange"> & { node: FreeButtonNode }) {
  return (
    <>
      <FreeIconGrid
        allowNone
        disabled={disabled}
        id={freeFieldId(node.id, "icone")}
        label={C.button.icon}
        onChange={(icon) => onChange(withFreeNodeFields(design, node.id, { icon: icon ? { ...(node.icon?.side ? { side: node.icon.side } : {}), name: icon } : undefined }))}
        value={node.icon?.name ?? null}
      />
      {node.icon ? (
        <PillField
          disabled={disabled}
          label={C.button.iconSide}
          name={freeFieldId(node.id, "icone-lado")}
          onChange={(side) => onChange(withFreeNodeFields(design, node.id, { icon: side === "end" ? { name: node.icon!.name } : { name: node.icon!.name, side } }))}
          options={FREE_ICON_SIDE_OPTIONS}
          value={node.icon.side ?? "end"}
        />
      ) : null}
    </>
  );
}

const EMPTY_CTA: NoticeCta = { display: "button", href: "", label: "", target: "same_tab" };

/** Botão principal: o texto e o destino moram no botao do aviso (o mesmo campo do Personalizado). */
function CtaContent(props: Of<"button">) {
  const { content, disabled, errors, node, onCtaChange } = props;
  const cta = content.cta ?? EMPTY_CTA;
  const idPrefix = freeFieldId(node.id, "").replace(/-$/, "");

  // Pagina do modelo de Design (docs/28 §5.7): so o texto; o destino e escolhido em cada aviso.
  if (content.hideCtaDestination) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <CtaLabelOnlyField
          cta={cta}
          disabled={disabled}
          error={errors["cta.label"]}
          idPrefix={idPrefix}
          onChange={(next) => onCtaChange(next, { coalesceKey: `${node.id}:cta.label` })}
        />
        <ButtonIconFields design={props.design} disabled={disabled} node={node} onChange={props.onChange} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <NoticeCtaField
        disabled={disabled}
        errors={{ href: errors["cta.href"], label: errors["cta.label"] }}
        idPrefix={idPrefix}
        kind="popup"
        onBlurField={() => undefined}
        onChange={(next) => {
          const value = next ?? cta;
          const field = value.label !== cta.label ? "cta.label" : "cta.href";

          onCtaChange(value, { coalesceKey: `${node.id}:${field}` });
        }}
        products={content.products}
        productsLoaded={content.productsLoaded}
        showSwitch={false}
        value={cta}
      />
      <ButtonIconFields design={props.design} disabled={disabled} node={node} onChange={props.onChange} />
    </div>
  );
}

const MODE_DEFAULT_TARGET: Record<HeroCtaDestinationMode, "new_tab" | "same_tab"> = { external: "new_tab", page: "same_tab", product: "same_tab" };

/** "Para onde leva" do botao "Abrir um link": um produto, uma pagina da area ou um link externo. */
function LinkDestination({
  content,
  disabled,
  error,
  href,
  id,
  onChange
}: {
  content: FreeEditorContent;
  disabled: boolean;
  error?: string;
  href: string;
  id: (field: string) => string;
  onChange: (next: { href: string; target?: "new_tab" | "same_tab" }) => void;
}) {
  const [mode, setMode] = useState<HeroCtaDestinationMode>(() => describeCtaDestination(href).mode);
  const [syncedHref, setSyncedHref] = useState(href);
  const [ownHref, setOwnHref] = useState<string | null>(null);
  const remembered = useRef<Partial<Record<HeroCtaDestinationMode, string>>>({ [mode]: href });

  // Desfazer/refazer pode trazer um destino de outro tipo: as pilulas acompanham (o que foi escrito aqui, nao).
  if (href !== syncedHref) {
    setSyncedHref(href);

    if (href && href !== ownHref && describeCtaDestination(href).mode !== mode) {
      setMode(describeCtaDestination(href).mode);
    }
  }
  const productId = productIdFromHref(href);
  const known = HOME_PAGE_LINKS.some((page) => page.href === href);
  const pages = [...HOME_PAGE_LINKS.map((page) => ({ label: page.label, value: page.href as string })), ...(mode === "page" && href && !known ? [{ label: homePageLabel(href), value: href }] : [])];

  function setHref(next: string) {
    remembered.current[mode] = next;
    setOwnHref(next);
    onChange({ href: next });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" id={id("destino")} tabIndex={-1}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={fieldLabelClass}>{C.button.destination}</span>
        <PillGroup
          ariaLabel={C.button.destination}
          disabled={disabled}
          name={id("destino-modo")}
          onChange={(next: HeroCtaDestinationMode) => {
            if (next === mode) {
              return;
            }

            remembered.current[mode] = href;
            setMode(next);
            const restored = remembered.current[next] ?? "";

            setOwnHref(restored);
            onChange({ href: restored, target: restored ? defaultCtaTarget(restored) : MODE_DEFAULT_TARGET[next] });
          }}
          options={FREE_LINK_MODE_OPTIONS}
          value={mode}
        />
      </div>
      {mode === "product" ? (
        content.productsLoaded ? (
          <AdminField error={error} id={id("produto")} label={C.button.product}>
            <ProductPicker
              disabled={disabled}
              emptyText={C.button.productEmpty}
              error={error}
              id={id("produto")}
              items={content.products}
              mode="single"
              onChange={(ids) => setHref(ids[0] ? productHref(ids[0]) : "")}
              value={productId ? [productId] : []}
            />
          </AdminField>
        ) : (
          <>
            <FreeNote tone="warning">{C.button.productsFailed}</FreeNote>
            <FreeFieldError message={error} />
          </>
        )
      ) : null}
      {mode === "page" ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={fieldLabelClass}>{C.button.page}</span>
          <PillGroup ariaLabel={C.button.page} disabled={disabled} name={id("pagina")} onChange={setHref} options={pages} value={href} />
          <FreeFieldError message={error} />
        </div>
      ) : null}
      {mode === "external" ? (
        <AdminField error={error} hint={C.button.externalHint} id={id("link")} label={C.button.link}>
          <Input
            aria-describedby={fieldDescribedBy(id("link"), { error, hint: error ? undefined : C.button.externalHint })}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={disabled}
            id={id("link")}
            inputMode="url"
            onChange={(event) => setHref(event.target.value)}
            placeholder="https://"
            spellCheck={false}
            type="url"
            value={href}
          />
        </AdminField>
      ) : null}
    </div>
  );
}

function ButtonContent(props: Of<"button">) {
  const { content, design, disabled, errors, node, onChange } = props;
  const id = (field: string) => freeFieldId(node.id, field);
  const linkReason = freeLinkActionDisabledReason(design, node.id);
  const action = node.action.kind === "cta" ? "close" : node.action.kind;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <FreeChoiceField
        disabled={disabled}
        disabledReason={linkReason && action !== "link" ? linkReason : null}
        error={freeErrorAt(errors, `nodes.${node.id}.action.kind`) ?? (node.action.kind === "snooze" ? freeErrorAt(errors, `nodes.${node.id}.action`) : undefined)}
        label={C.button.action}
        name={id("acao")}
        onChange={(kind) => onChange(withFreeNodeFields(design, node.id, freeButtonActionOf(kind, node) as unknown as Record<string, unknown>))}
        options={FREE_BUTTON_ACTION_OPTIONS.map((option) => ({ ...option, disabled: option.value === "link" && linkReason !== null }))}
        value={action}
      />
      <HeroTextField
        disabled={disabled}
        error={freeErrorAt(errors, `nodes.${node.id}.label`)}
        id={id("botao-texto")}
        label={C.button.label}
        max={L.label}
        onBlur={() => undefined}
        onChange={(label) => onChange(withFreeNodeFields(design, node.id, { label }), "label")}
        value={node.label ?? ""}
      />
      {node.action.kind === "link" ? (
        <>
          <LinkDestination
            content={content}
            disabled={disabled}
            error={freeErrorAt(errors, `nodes.${node.id}.action.href`)}
            href={node.action.href}
            id={id}
            onChange={(next) => {
              const current = node.action.kind === "link" ? node.action : { href: "", kind: "link" as const, target: "same_tab" as const };

              onChange(withFreeNodeFields(design, node.id, { action: { ...current, href: next.href, target: next.target ?? current.target } }), "action.href");
            }}
          />
          <PillField
            disabled={disabled}
            label={C.button.target}
            name={id("aba")}
            onChange={(target) => onChange(withFreeNodeFields(design, node.id, { action: { ...(node.action as Extract<FreeButtonNode["action"], { kind: "link" }>), target } }))}
            options={FREE_LINK_TARGET_OPTIONS}
            value={node.action.target}
          />
          <FreeNote>{C.button.clickNote}</FreeNote>
        </>
      ) : null}
      <ButtonIconFields design={design} disabled={disabled} node={node} onChange={onChange} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Imagem
 * ---------------------------------------------------------------------------------------------- */

function ImageContent({ design, disabled, errors, latest, node, onBusyChange, onChange }: Of<"image">) {
  const id = (field: string) => freeFieldId(node.id, field);
  const [describing, setDescribing] = useState(() => Boolean(node.alt?.trim()));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={fieldLabelClass}>{C.image.label}</span>
        <FreeImagePicker
          design={design}
          disabled={disabled}
          id={id("enviar")}
          onBusyChange={onBusyChange}
          onPick={(image) => onChange(withFreeNodeImage(latest(), node.id, image))}
          selected={node.asset}
        />
        <FreeFieldError message={freeErrorAt(errors, `nodes.${node.id}.asset`)} />
      </div>
      <AdminSwitch
        checked={!describing}
        disabled={disabled}
        id={id("enfeite")}
        label={C.image.decorative}
        onCheckedChange={(decorative) => {
          setDescribing(!decorative);

          if (decorative) {
            onChange(withFreeNodeFields(design, node.id, { alt: undefined }));
          }
        }}
      />
      {describing ? (
        <HeroTextField
          disabled={disabled}
          error={freeErrorAt(errors, `nodes.${node.id}.alt`)}
          hint={C.image.altHint}
          id={id("descricao")}
          label={C.image.alt}
          max={L.alt}
          onBlur={() => undefined}
          onChange={(alt) => onChange(withFreeNodeFields(design, node.id, { alt: alt === "" ? undefined : alt }), "alt")}
          value={node.alt ?? ""}
        />
      ) : null}
      <PillField
        disabled={disabled}
        label={C.image.fit}
        name={id("preenche")}
        onChange={(fit) => onChange(withFreeNodeFields(design, node.id, { fit: fit === "cover" ? undefined : fit }))}
        options={FREE_IMAGE_FIT_OPTIONS}
        value={node.fit ?? "cover"}
      />
      <FocusFields disabled={disabled} focus={node.focus} id={id("foco")} onChange={(focus) => onChange(withFreeNodeFields(design, node.id, { focus }), "focus")} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Vídeo
 * ---------------------------------------------------------------------------------------------- */

type VideoPhase = { kind: "idle" } | { kind: "uploading"; percent: number };

function VideoContent({ design, disabled, errors, hints, latest, node, onBusyChange, onChange }: Of<"video">) {
  const id = (field: string) => freeFieldId(node.id, field);
  const input = useRef<HTMLInputElement>(null);
  const posterInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<VideoPhase>({ kind: "idle" });
  const [posterSending, setPosterSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const busyRef = useLatest(onBusyChange);
  const { poster, video } = freeVideoAssetOf(design, node.id);
  const sending = phase.kind !== "idle" || posterSending;
  const noPoster = freeHintsOf(hints, node.id, ["no-poster"]);

  async function sendVideo(file: File | undefined) {
    if (!file || sending) {
      return;
    }

    setProblem(null);
    setHint(null);
    setPhase({ kind: "uploading", percent: 0 });
    busyRef.current(C.busy);

    try {
      const uploaded = await uploadFreeVideoFile(file, (percent) => setPhase({ kind: "uploading", percent }));

      setHint(uploaded.hint);
      onChange(withFreeNodeVideo(latest(), node.id, uploaded.video, uploaded.poster));
    } catch (caught) {
      setProblem(caught instanceof Error && caught.message ? caught.message : C.video.none);
    } finally {
      setPhase({ kind: "idle" });
      busyRef.current(null);
    }
  }

  async function sendPoster(file: File | undefined) {
    if (!file || sending) {
      return;
    }

    setProblem(null);
    setPosterSending(true);
    busyRef.current(C.busy);

    try {
      const image = await uploadFreeImageFile(file);

      onChange(withFreeVideoPoster(latest(), node.id, image));
    } catch (caught) {
      setProblem(caught instanceof Error && caught.message ? caught.message : C.imageFailed);
    } finally {
      setPosterSending(false);
      busyRef.current(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-2">
        <span className={fieldLabelClass}>{C.video.label}</span>
        {phase.kind === "uploading" ? (
          <p aria-live="polite" className="flex items-center gap-2 text-sm leading-5 text-[var(--text-primary)]" role="status">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            {C.video.sending(phase.percent)}
          </p>
        ) : video ? (
          <p className="flex items-center gap-1.5 text-sm leading-5 text-[var(--text-primary)]">
            <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--success)]" />
            {C.video.done}
          </p>
        ) : (
          <FreeNote>{C.video.none}</FreeNote>
        )}
        <div>
          <Button className={freeSmallButton + " h-10"} disabled={disabled || sending} id={id("enviar")} onClick={() => input.current?.click()} type="button" variant="secondary">
            {video ? <Video aria-hidden="true" className="size-4" /> : <Upload aria-hidden="true" className="size-4" />}
            {video ? C.video.replace : C.video.send}
          </Button>
          <input
            accept="video/mp4,video/webm"
            aria-label={C.video.send}
            className="sr-only"
            disabled={disabled || sending}
            onChange={(event) => {
              const file = event.target.files?.[0];

              event.target.value = "";
              void sendVideo(file);
            }}
            ref={input}
            tabIndex={-1}
            type="file"
          />
        </div>
        {problem ? <FreeFieldError message={problem} /> : <FreeNote>{hint ?? C.video.hint}</FreeNote>}
        <FreeFieldError message={freeErrorAt(errors, `nodes.${node.id}.asset`)} />
      </div>

      {video ? (
        <div className="flex min-w-0 flex-col gap-2 outline-none" id={id("capa")} tabIndex={-1}>
          <span className={fieldLabelClass}>{C.video.poster}</span>
          {poster ? (
            <FreeNote>{C.image.thumb(poster.width, poster.height)}</FreeNote>
          ) : (
            <FreeNote>{C.video.posterNone}</FreeNote>
          )}
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button className={freeSmallButton} disabled={disabled || sending} onClick={() => posterInput.current?.click()} type="button" variant="secondary">
              {posterSending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Upload aria-hidden="true" className="size-4" />}
              {posterSending ? C.image.sending : C.video.posterSend}
            </Button>
            {poster ? (
              <Button className={freeSmallButton} disabled={disabled || sending} onClick={() => onChange(withFreeVideoPoster(design, node.id, null))} type="button" variant="ghost">
                {C.video.posterRemove}
              </Button>
            ) : null}
            <input
              accept="image/jpeg,image/png,image/webp"
              aria-label={C.video.posterSend}
              className="sr-only"
              disabled={disabled || sending}
              onChange={(event) => {
                const file = event.target.files?.[0];

                event.target.value = "";
                void sendPoster(file);
              }}
              ref={posterInput}
              tabIndex={-1}
              type="file"
            />
          </div>
          <FreeNote>{C.video.posterHint}</FreeNote>
          <FreeHints hints={noPoster} />
        </div>
      ) : null}

      <PillField
        disabled={disabled}
        label={C.image.fit}
        name={id("preenche")}
        onChange={(fit) => onChange(withFreeNodeFields(design, node.id, { fit: fit === "cover" ? undefined : fit }))}
        options={FREE_IMAGE_FIT_OPTIONS}
        value={node.fit ?? "cover"}
      />
      <FocusFields disabled={disabled} focus={node.focus} id={id("foco")} onChange={(focus) => onChange(withFreeNodeFields(design, node.id, { focus }), "focus")} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Ícone, Linha, Caixa, Links
 * ---------------------------------------------------------------------------------------------- */

function IconContent({ design, disabled, errors, node, onChange }: Of<"icon">) {
  const id = (field: string) => freeFieldId(node.id, field);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <FreeIconGrid disabled={disabled} id={id("icone")} label={C.icon.grid} onChange={(icon) => (icon ? onChange(withFreeNodeFields(design, node.id, { icon })) : undefined)} value={node.icon} />
      <FreeNumberField
        bounds={L.iconSize}
        disabled={disabled}
        error={freeErrorAt(errors, `nodes.${node.id}.size`)}
        id={id("tamanho")}
        label={C.icon.size}
        onChange={(size) => onChange(withFreeNodeFields(design, node.id, { size: size === 24 ? undefined : size }), "size")}
        unit={C.units.px}
        value={node.size ?? 24}
      />
      <ColorField disabled={disabled} error={freeErrorAt(errors, `nodes.${node.id}.color`)} id={id("cor")} label={C.icon.color} onChange={(color) => onChange(withFreeNodeFields(design, node.id, { color }), "color")} value={node.color ?? "#ffffff"} />
      <FreeNumberField
        bounds={L.iconStroke}
        disabled={disabled}
        error={freeErrorAt(errors, `nodes.${node.id}.stroke`)}
        id={id("traco")}
        integer={false}
        label={C.icon.stroke}
        onChange={(stroke) => onChange(withFreeNodeFields(design, node.id, { stroke: stroke === 2 ? undefined : stroke }), "stroke")}
        step={0.25}
        value={node.stroke ?? 2}
      />
    </div>
  );
}

function DividerContent({ design, disabled, errors, node, onChange }: Of<"divider">) {
  const id = (field: string) => freeFieldId(node.id, field);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <FreeNumberField
        bounds={L.dividerThickness}
        disabled={disabled}
        error={freeErrorAt(errors, `nodes.${node.id}.thickness`)}
        id={id("espessura")}
        label={C.divider.thickness}
        onChange={(thickness) => onChange(withFreeNodeFields(design, node.id, { thickness: thickness === 1 ? undefined : thickness }), "thickness")}
        unit={C.units.px}
        value={node.thickness ?? 1}
      />
      <ColorField disabled={disabled} id={id("cor")} label={C.divider.color} onChange={(color) => onChange(withFreeNodeFields(design, node.id, { color }), "color")} value={node.color ?? "#ffffff1f"} />
      <PillField
        disabled={disabled}
        label={C.divider.style}
        name={id("tipo")}
        onChange={(style) => onChange(withFreeNodeFields(design, node.id, { style: style === "solid" ? undefined : style }))}
        options={FREE_LINE_STYLE_OPTIONS}
        value={node.style ?? "solid"}
      />
    </div>
  );
}

function BoxContent({ design, disabled, errors, node, onChange }: Of<"box">) {
  const id = (field: string) => freeFieldId(node.id, field);
  const layout = node.layout ?? {};
  const dir = layout.dir ?? "column";

  function setLayout(patch: Partial<NonNullable<typeof node.layout>>, field?: string) {
    const next: Record<string, unknown> = { ...layout, ...patch };

    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) {
        delete next[key];
      }
    }

    onChange(withFreeNodeFields(design, node.id, { layout: Object.keys(next).length > 0 ? next : undefined }), field);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PillField disabled={disabled} label={C.box.dir} name={id("direcao")} onChange={(next) => setLayout({ dir: next === "column" ? undefined : next, wrap: next === "column" ? undefined : layout.wrap })} options={FREE_BOX_DIR_OPTIONS} value={dir} />
      <FreeNumberField
        bounds={L.gap}
        disabled={disabled}
        error={freeErrorAt(errors, `nodes.${node.id}.layout.gap`)}
        id={id("espaco")}
        label={C.box.gap}
        onChange={(gap) => setLayout({ gap: gap === 0 ? undefined : gap }, "layout.gap")}
        unit={C.units.px}
        value={layout.gap ?? 0}
      />
      <PillField disabled={disabled} label={C.box.align} name={id("alinhar")} onChange={(align) => setLayout({ align: align === "stretch" ? undefined : align })} options={FREE_BOX_ALIGN_OPTIONS} value={layout.align ?? "stretch"} />
      <PillField disabled={disabled} label={C.box.justify} name={id("distribuir")} onChange={(justify) => setLayout({ justify: justify === "start" ? undefined : justify })} options={FREE_BOX_JUSTIFY_OPTIONS} value={layout.justify ?? "start"} />
      {dir === "row" ? <AdminSwitch checked={layout.wrap === true} disabled={disabled} id={id("quebrar")} label={C.box.wrap} onCheckedChange={(wrap) => setLayout({ wrap: wrap || undefined })} /> : null}
    </div>
  );
}

function LinksContent({ design, disabled, errors, node, onChange }: Of<"links">) {
  const id = (field: string) => freeFieldId(node.id, field);
  const dismiss = node.dismiss !== false;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <AdminSwitch
          checked={dismiss}
          description={dismiss ? undefined : C.links.closedNote}
          disabled={disabled}
          id={id("nao-mostrar")}
          label={C.links.dismiss}
          onCheckedChange={(checked) => onChange(withFreeNodeFields(design, node.id, { dismiss: checked ? undefined : false }))}
        />
        <FreeNote>{C.links.snoozeNote}</FreeNote>
      </div>
      <FreeNumberField
        bounds={L.gap}
        disabled={disabled}
        error={freeErrorAt(errors, `nodes.${node.id}.gap`)}
        id={id("espaco")}
        label={C.links.gap}
        onChange={(gap) => onChange(withFreeNodeFields(design, node.id, { gap: gap === 8 ? undefined : gap }), "gap")}
        unit={C.units.px}
        value={node.gap ?? 8}
      />
    </div>
  );
}
