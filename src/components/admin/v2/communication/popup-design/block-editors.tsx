"use client";

import { Minus, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NOTICE_LIMITS } from "@/server/communications/campaign-model";
import type { NoticeDraft } from "@/server/communications/schemas";
import {
  HOME_PAGE_LINKS,
  defaultCtaTarget,
  describeCtaDestination,
  homePageLabel,
  productHref,
  productIdFromHref,
  type HeroCtaDestinationMode
} from "@/server/member-area/home-hero-links";
import {
  POPUP_DESIGN_LIMITS,
  type PopupBadgeBlock,
  type PopupBlock,
  type PopupButton2Action,
  type PopupButton2Block,
  type PopupButtonBlock,
  type PopupContrastHint,
  type PopupFontOption,
  type PopupHeadingBlock,
  type PopupHeadingLine,
  type PopupPaint,
  type PopupSpacerBlock,
  type PopupTextBlock
} from "@/server/communications/popup-design-model";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../form";
import { HeroTextField } from "../../member-area/home-hero/fields";
import type { ProductPickerItem } from "../../storefront/product-picker";
import { ProductPicker } from "../../storefront/product-picker";
import { NoticeCtaField } from "../notice-cta-field";
import { ctaTextFieldCopy } from "../notices-view-model";
import { BorderField, ColorField, ContrastHint, DesignFieldError, NumberField, PaintField, PillField, RadiusField, fieldLabelClass } from "./design-controls";
import {
  BUTTON2_ACTION_OPTIONS,
  LINE_PAINT_OPTIONS,
  LINE_SIZE_OPTIONS,
  LINK_TARGET_OPTIONS,
  POPUP_DESIGN_COPY,
  type LinePaintChoice
} from "./popup-design-editor-model";
import { ButtonStyleFields, TextStyleFields, type RequestFontUpload } from "./style-fields";

// Edicao de cada bloco do design (docs/26 §7.2): Selo, Título (1 a 4 linhas, cada uma com a cor e o tamanho
// proprios ou "Igual ao título"), Texto, Botão principal (o texto e o destino sao o botao do aviso: o mesmo
// NoticeCtaField, com os mesmos ids), Segundo botão (Fechar, Lembrar depois ou Abrir um link), Espaço e Áudio.
// Ids pela posicao do bloco (popup-design-bloco-{N}-...): o foco dos erros do servidor cai no campo certo.

const LIMITS = POPUP_DESIGN_LIMITS;

export type BlockEditorContext = {
  cta: NoticeDraft["cta"];
  disabled: boolean;
  errorFor: (key: string) => string | undefined;
  /**
   * Pagina do modelo de Design (docs/28 §5.7): o destino do Botão principal some (e escolhido em cada aviso); fica so
   * o texto do botao.
   */
  hideCtaDestination?: boolean;
  hints: readonly PopupContrastHint[];
  library: readonly PopupFontOption[];
  onCtaChange: (cta: NonNullable<NoticeDraft["cta"]>) => void;
  onRequestUpload: RequestFontUpload;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
};

type EditorProps<Block extends PopupBlock> = {
  block: Block;
  context: BlockEditorContext;
  index: number;
  onChange: (block: Block) => void;
};

/** Id base do bloco na posicao `index` (o mesmo do contêiner da lista). */
export function blockDomId(index: number) {
  return `popup-design-bloco-${index}`;
}

function BadgeEditor({ block, context, index, onChange }: EditorProps<PopupBadgeBlock>) {
  const base = blockDomId(index);
  const copy = POPUP_DESIGN_COPY.badge;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HeroTextField
        disabled={context.disabled}
        error={context.errorFor(`design.blocks.${index}.text`)}
        id={`${base}-texto`}
        label={copy.text}
        max={LIMITS.badgeText}
        onBlur={() => undefined}
        onChange={(text) => onChange({ ...block, text })}
        value={block.text}
      />
      <PaintField disabled={context.disabled} id={`${base}-fundo`} label={copy.background} onChange={(background) => onChange({ ...block, background })} value={block.background} />
      <BorderField disabled={context.disabled} id={`${base}-borda`} label={copy.border} onChange={(border) => onChange({ ...block, border })} value={block.border} />
      <RadiusField disabled={context.disabled} id={`${base}-cantos`} label={copy.radius} onChange={(radius) => onChange({ ...block, radius })} pillLabel={copy.pill} value={block.radius} />
      <TextStyleFields
        disabled={context.disabled}
        idBase={`${base}-estilo`}
        library={context.library}
        onChange={(style) => onChange({ ...block, style })}
        onRequestUpload={context.onRequestUpload}
        value={block.style}
      />
    </div>
  );
}

function linePaintChoice(paint: PopupPaint | null): LinePaintChoice {
  return paint === null ? "inherit" : paint.kind;
}

function HeadingLineEditor({
  canRemove,
  context,
  headingSize,
  headingPaint,
  index,
  line,
  lineIndex,
  onChange,
  onRemove
}: {
  canRemove: boolean;
  context: BlockEditorContext;
  headingPaint: PopupPaint;
  headingSize: number;
  index: number;
  line: PopupHeadingLine;
  lineIndex: number;
  onChange: (line: PopupHeadingLine) => void;
  onRemove: () => void;
}) {
  const id = `${blockDomId(index)}-linha-${lineIndex}`;
  const copy = POPUP_DESIGN_COPY.heading;
  const hints = context.hints.filter((hint) => hint.key === `blocks.${index}.lines.${lineIndex}`);
  const base = headingPaint.kind === "solid" ? headingPaint.color : headingPaint.from;

  function changePaint(choice: LinePaintChoice) {
    if (choice === linePaintChoice(line.paint)) {
      return;
    }

    if (choice === "inherit") {
      onChange({ ...line, paint: null });
    } else if (choice === "solid") {
      onChange({ ...line, paint: { color: line.paint?.kind === "gradient" ? line.paint.from : base, kind: "solid" } });
    } else {
      onChange({ ...line, paint: { angle: 90, from: line.paint?.kind === "solid" ? line.paint.color : base, kind: "gradient", to: "#a78bfa" } });
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-3">
      <HeroTextField
        disabled={context.disabled}
        error={context.errorFor(`design.blocks.${index}.lines.${lineIndex}.text`) ?? context.errorFor(`design.blocks.${index}.lines.${lineIndex}`)}
        id={id}
        label={`Linha ${lineIndex + 1}`}
        max={LIMITS.headingLine}
        onBlur={() => undefined}
        onChange={(text) => onChange({ ...line, text })}
        value={line.text}
      />
      <PillField disabled={context.disabled} label={copy.linePaint} name={`${id}-cor-tipo`} onChange={changePaint} options={LINE_PAINT_OPTIONS} value={linePaintChoice(line.paint)} />
      {line.paint?.kind === "solid" ? (
        <ColorField
          disabled={context.disabled}
          id={`${id}-cor`}
          label={`${copy.linePaint} ${lineIndex + 1}`}
          labelHidden
          onChange={(color) => onChange({ ...line, paint: { color, kind: "solid" } })}
          value={line.paint.color}
        />
      ) : null}
      {line.paint?.kind === "gradient" ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <ColorField disabled={context.disabled} id={`${id}-de`} label={POPUP_DESIGN_COPY.color.from} onChange={(from) => line.paint?.kind === "gradient" && onChange({ ...line, paint: { ...line.paint, from } })} value={line.paint.from} />
          <ColorField disabled={context.disabled} id={`${id}-para`} label={POPUP_DESIGN_COPY.color.to} onChange={(to) => line.paint?.kind === "gradient" && onChange({ ...line, paint: { ...line.paint, to } })} value={line.paint.to} />
          <NumberField
            disabled={context.disabled}
            id={`${id}-angulo`}
            label={POPUP_DESIGN_COPY.color.angle}
            max={LIMITS.angle.max}
            min={LIMITS.angle.min}
            onChange={(angle) => line.paint?.kind === "gradient" && onChange({ ...line, paint: { ...line.paint, angle } })}
            suffix="°"
            value={line.paint.angle}
          />
        </div>
      ) : null}
      <PillField
        disabled={context.disabled}
        label={copy.lineSize}
        name={`${id}-tamanho-tipo`}
        onChange={(choice) => onChange({ ...line, size: choice === "inherit" ? null : (line.size ?? headingSize) })}
        options={LINE_SIZE_OPTIONS}
        value={line.size === null ? "inherit" : "other"}
      />
      {line.size !== null ? (
        <NumberField
          disabled={context.disabled}
          id={`${id}-tamanho`}
          label={`${copy.lineSize} ${lineIndex + 1}`}
          max={LIMITS.fontSize.max}
          min={LIMITS.fontSize.min}
          onChange={(size) => onChange({ ...line, size })}
          suffix="px"
          value={line.size}
        />
      ) : null}
      {hints.map((hint) => (
        <ContrastHint key={hint.key} message={hint.message} />
      ))}
      {canRemove ? (
        <div>
          <Button className="h-9 gap-1.5 px-3 text-[var(--text-secondary)] pointer-coarse:h-11" disabled={context.disabled} onClick={onRemove} type="button" variant="ghost">
            <Minus aria-hidden="true" className="size-4" />
            {copy.removeLine}
            <span className="sr-only"> {lineIndex + 1}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function HeadingEditor({ block, context, index, onChange }: EditorProps<PopupHeadingBlock>) {
  const base = blockDomId(index);
  const copy = POPUP_DESIGN_COPY.heading;
  const linesError = context.errorFor(`design.blocks.${index}.lines`);

  function changeLine(lineIndex: number, line: PopupHeadingLine) {
    onChange({ ...block, lines: block.lines.map((item, position) => (position === lineIndex ? line : item)) });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {block.lines.map((line, lineIndex) => (
        <HeadingLineEditor
          canRemove={block.lines.length > 1}
          context={context}
          headingPaint={block.style.paint}
          headingSize={block.style.size}
          index={index}
          key={lineIndex}
          line={line}
          lineIndex={lineIndex}
          onChange={(next) => changeLine(lineIndex, next)}
          onRemove={() => onChange({ ...block, lines: block.lines.filter((_, position) => position !== lineIndex) })}
        />
      ))}
      <DesignFieldError message={linesError} />
      {block.lines.length < LIMITS.headingLines ? (
        <div>
          <Button
            className="h-9 gap-1.5 px-3 pointer-coarse:h-11"
            disabled={context.disabled}
            onClick={() => onChange({ ...block, lines: [...block.lines, { paint: null, size: null, text: "Nova linha" }] })}
            type="button"
            variant="secondary"
          >
            <Plus aria-hidden="true" className="size-4" />
            {copy.addLine}
          </Button>
        </div>
      ) : null}
      <TextStyleFields
        disabled={context.disabled}
        idBase={`${base}-estilo`}
        library={context.library}
        onChange={(style) => onChange({ ...block, style })}
        onRequestUpload={context.onRequestUpload}
        value={block.style}
      />
    </div>
  );
}

function TextEditor({ block, context, index, onChange }: EditorProps<PopupTextBlock>) {
  const base = blockDomId(index);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HeroTextField
        disabled={context.disabled}
        error={context.errorFor(`design.blocks.${index}.text`)}
        id={`${base}-texto`}
        label={POPUP_DESIGN_COPY.textBlock.text}
        max={LIMITS.text}
        multiline
        onBlur={() => undefined}
        onChange={(text) => onChange({ ...block, text })}
        value={block.text}
      />
      <TextStyleFields
        disabled={context.disabled}
        idBase={`${base}-estilo`}
        library={context.library}
        onChange={(style) => onChange({ ...block, style })}
        onRequestUpload={context.onRequestUpload}
        value={block.style}
      />
    </div>
  );
}

/**
 * O texto do Botão principal sem o destino (pagina do modelo de Design, docs/28 §5.7; tambem no editor Livre): o
 * mesmo campo do botao do aviso e a frase de que o destino e escolhido em cada aviso.
 */
export function CtaLabelOnlyField({
  cta,
  disabled,
  error,
  idPrefix,
  onChange
}: {
  cta: NonNullable<NoticeDraft["cta"]>;
  disabled: boolean;
  error?: string;
  idPrefix: string;
  onChange: (cta: NonNullable<NoticeDraft["cta"]>) => void;
}) {
  const text = ctaTextFieldCopy("button");

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <HeroTextField
        disabled={disabled}
        error={error}
        id={`${idPrefix}-botao-texto`}
        label={text.label}
        max={NOTICE_LIMITS.ctaLabel}
        onBlur={() => undefined}
        onChange={(label) => onChange({ ...cta, label })}
        placeholder={text.placeholder}
        value={cta.label}
      />
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{POPUP_DESIGN_COPY.mine.ctaDestination}</p>
    </div>
  );
}

function ButtonEditor({ block, context, index, onChange }: EditorProps<PopupButtonBlock>) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {context.cta && context.hideCtaDestination ? (
        <CtaLabelOnlyField cta={context.cta} disabled={context.disabled} error={context.errorFor("cta.label")} idPrefix="aviso" onChange={context.onCtaChange} />
      ) : context.cta ? (
        <NoticeCtaField
          disabled={context.disabled}
          errors={{ href: context.errorFor("cta.href"), label: context.errorFor("cta.label") }}
          idPrefix="aviso"
          kind="popup"
          onBlurField={() => undefined}
          onChange={(cta) => (cta ? context.onCtaChange(cta) : undefined)}
          products={context.products}
          productsLoaded={context.productsLoaded}
          showSwitch={false}
          value={context.cta}
        />
      ) : (
        <DesignFieldError message={context.errorFor("cta.label")} />
      )}
      <ButtonStyleFields
        disabled={context.disabled}
        idBase={`${blockDomId(index)}-estilo`}
        library={context.library}
        onChange={(style) => onChange({ ...block, style })}
        onRequestUpload={context.onRequestUpload}
        value={block.style}
      />
    </div>
  );
}

const MODE_OPTIONS = [
  { label: "Um produto", value: "product" },
  { label: "Página da área", value: "page" },
  { label: "Link externo", value: "external" }
] as const satisfies readonly { label: string; value: HeroCtaDestinationMode }[];

/** Destino do segundo botao: um produto, uma pagina da area ou um link (as mesmas regras do botao principal). */
function LinkDestinationField({
  context,
  error,
  href,
  id,
  onChange
}: {
  context: BlockEditorContext;
  error?: string;
  href: string;
  id: string;
  onChange: (href: string) => void;
}) {
  const [mode, setMode] = useState<HeroCtaDestinationMode>(() => describeCtaDestination(href).mode);
  const remembered = useRef<Partial<Record<HeroCtaDestinationMode, string>>>({ [mode]: href });
  const productId = productIdFromHref(href);
  const knownPage = HOME_PAGE_LINKS.some((page) => page.href === href);
  const pageOptions = [
    ...HOME_PAGE_LINKS.map((page) => ({ label: page.label, value: page.href as string })),
    ...(mode === "page" && href && !knownPage ? [{ label: homePageLabel(href), value: href }] : [])
  ];
  const copy = POPUP_DESIGN_COPY.button2;

  function setHref(next: string) {
    remembered.current[mode] = next;
    onChange(next);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={fieldLabelClass}>{POPUP_DESIGN_COPY.button.destination}</span>
        <PillGroup
          ariaLabel="Para onde o segundo botão leva"
          disabled={context.disabled}
          name={`${id}-destino`}
          onChange={(next) => {
            if (next === mode) {
              return;
            }

            remembered.current[mode] = href;
            setMode(next);
            onChange(remembered.current[next] ?? "");
          }}
          options={MODE_OPTIONS}
          value={mode}
        />
      </div>

      {mode === "product" ? (
        context.productsLoaded ? (
          <AdminField error={error} id={id} label={copy.product}>
            <ProductPicker
              disabled={context.disabled}
              emptyText="Nenhum produto ainda. Crie um em Produtos."
              error={error}
              id={id}
              items={context.products}
              mode="single"
              onChange={(ids) => setHref(ids[0] ? productHref(ids[0]) : "")}
              value={productId ? [productId] : []}
            />
          </AdminField>
        ) : (
          <div className="flex min-w-0 flex-col gap-1.5" id={id} tabIndex={-1}>
            <p className="text-[13px] leading-5 text-[var(--warning)]">Não foi possível carregar a lista de produtos agora. Recarregue a página para escolher um produto.</p>
            <DesignFieldError message={error} />
          </div>
        )
      ) : null}

      {mode === "page" ? (
        <div className="flex min-w-0 flex-col gap-1.5 outline-none" id={id} tabIndex={-1}>
          <span className={fieldLabelClass}>{copy.page}</span>
          <PillGroup ariaLabel="Página da área do aluno" disabled={context.disabled} name={`${id}-pagina`} onChange={setHref} options={pageOptions} value={href} />
          <DesignFieldError message={error} />
        </div>
      ) : null}

      {mode === "external" ? (
        <AdminField error={error} id={id} label={copy.link}>
          <Input
            aria-describedby={fieldDescribedBy(id, { error })}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={context.disabled}
            id={id}
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

function Button2Editor({ block, context, index, onChange }: EditorProps<PopupButton2Block>) {
  const base = blockDomId(index);
  const copy = POPUP_DESIGN_COPY.button2;
  const lastLink = useRef<Extract<PopupButton2Action, { kind: "link" }>>(block.action.kind === "link" ? block.action : { href: "", kind: "link", target: "same_tab" });
  const actionError = context.errorFor(`design.blocks.${index}.action`);

  function changeAction(kind: PopupButton2Action["kind"]) {
    if (kind === block.action.kind) {
      return;
    }

    if (block.action.kind === "link") {
      lastLink.current = block.action;
    }

    onChange({ ...block, action: kind === "link" ? lastLink.current : { kind } });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <HeroTextField
        disabled={context.disabled}
        error={context.errorFor(`design.blocks.${index}.label`)}
        id={`${base}-rotulo`}
        label={copy.label}
        max={LIMITS.button2Label}
        onBlur={() => undefined}
        onChange={(label) => onChange({ ...block, label })}
        value={block.label}
      />
      <PillField disabled={context.disabled} error={actionError} label={copy.action} name={`${base}-acao`} onChange={changeAction} options={BUTTON2_ACTION_OPTIONS} value={block.action.kind} />
      {block.action.kind === "link" ? (
        <>
          <LinkDestinationField
            context={context}
            error={context.errorFor(`design.blocks.${index}.action.href`)}
            href={block.action.href}
            id={`${base}-link`}
            onChange={(href) =>
              block.action.kind === "link" &&
              onChange({ ...block, action: { ...block.action, href, target: block.action.href ? block.action.target : defaultCtaTarget(href) } })
            }
          />
          <PillField
            disabled={context.disabled}
            label={copy.target}
            name={`${base}-aba`}
            onChange={(target) => block.action.kind === "link" && onChange({ ...block, action: { ...block.action, target } })}
            options={LINK_TARGET_OPTIONS}
            value={block.action.target}
          />
        </>
      ) : null}
      <ButtonStyleFields
        disabled={context.disabled}
        idBase={`${base}-estilo`}
        library={context.library}
        onChange={(style) => onChange({ ...block, style })}
        onRequestUpload={context.onRequestUpload}
        value={block.style}
      />
    </div>
  );
}

function SpacerEditor({ block, context, index, onChange }: EditorProps<PopupSpacerBlock>) {
  return (
    <NumberField
      disabled={context.disabled}
      error={context.errorFor(`design.blocks.${index}.height`)}
      id={`${blockDomId(index)}-altura`}
      label={POPUP_DESIGN_COPY.spacer.height}
      max={LIMITS.spacer.max}
      min={LIMITS.spacer.min}
      onChange={(height) => onChange({ ...block, height })}
      suffix="px"
      value={block.height}
    />
  );
}

/** A edicao do bloco na posicao `index`, pelo tipo. */
export function BlockEditor({ block, context, index, onChange }: EditorProps<PopupBlock>) {
  switch (block.type) {
    case "badge":
      return <BadgeEditor block={block} context={context} index={index} onChange={onChange} />;
    case "heading":
      return <HeadingEditor block={block} context={context} index={index} onChange={onChange} />;
    case "text":
      return <TextEditor block={block} context={context} index={index} onChange={onChange} />;
    case "button":
      return <ButtonEditor block={block} context={context} index={index} onChange={onChange} />;
    case "button2":
      return <Button2Editor block={block} context={context} index={index} onChange={onChange} />;
    case "spacer":
      return <SpacerEditor block={block} context={context} index={index} onChange={onChange} />;
    case "audio":
      return <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{POPUP_DESIGN_COPY.audio.note}</p>;
  }
}
