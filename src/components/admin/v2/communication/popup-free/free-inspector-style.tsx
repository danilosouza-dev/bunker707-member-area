"use client";

import { FREE_DESIGN_LIMITS, type FreeNode, type FreeTextStyle } from "@/server/communications/popup-free-model";
import { freeTextStyleOf } from "@/server/communications/popup-free-render";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AdminSwitch } from "../../settings/kit";
import { ColorField, PillField } from "../popup-design/design-controls";
import { WeightPicker } from "../popup-design/font-picker";
import type { FreeSectionProps } from "./free-inspector-content";
import {
  FreeBorderField,
  FreeFillLayersField,
  FreeFontField,
  FreeGroup,
  FreeHints,
  FreeNumberField,
  FreeRadiusField,
  FreeSection,
  FreeShadowsField,
  FreeFieldError,
  FreeNote,
  FreeTextPaintField,
  freeSmallButton
} from "./free-fields";
import {
  FREE_DECORATION_OPTIONS,
  FREE_FADE_DEFAULT,
  FREE_FADE_SIDE_OPTIONS,
  FREE_INSPECTOR_COPY,
  FREE_TEXT_ALIGN_OPTIONS,
  freeErrorAt,
  freeFieldId,
  freeFillBaseColor,
  freeHintsOf,
  freeIsOutlineOnly,
  freeOutlineOnlyDisabledReason,
  freeOutlineOnlyPatch,
  freeStrokeDisabledReason,
  freeStrokeSwitchPatch,
  withFreeBox,
  withFreeFadeEnd,
  withFreeFadeStart,
  withFreeFillImage,
  withFreeTextStyle,
  type FreePatch
} from "./free-inspector-model";

// Editor Livre do pop-up (docs/27; spec §4.6 "Estilo"), pacote I: Texto (fonte, tamanho, peso, itálico, altura da
// linha, espaço entre letras, maiúsculas, linha no texto, alinhamento, cor do texto com degradê, o contorno com o
// "Só o contorno" do L6b e a sombra do texto, com a dica de contraste embaixo da cor), Fundo (camadas), Borda,
// Cantos, Sombras e Efeitos (opacidade, desfoque, desfoque do que esta atras, cortar e esmaecer).

const L = FREE_DESIGN_LIMITS;
const C = FREE_INSPECTOR_COPY;

const TEXT_TYPES = new Set<FreeNode["type"]>(["badge", "button", "heading", "links", "text"]);
/**
 * "Só o contorno" so no Título e no Texto (docs/27 §9.8): o ícone do Selo e do Botão usa a cor da letra e sumiria
 * com ela, e os Links o aluno precisa ler.
 */
const OUTLINE_ONLY_TYPES = new Set<FreeNode["type"]>(["heading", "text"]);

export function FreeInspectorStyle(props: FreeSectionProps) {
  const { node } = props;

  return (
    <div className="flex min-w-0 flex-col gap-5 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
      {TEXT_TYPES.has(node.type) ? <TextStyleSection {...props} /> : null}
      <BoxSections {...props} />
    </div>
  );
}

function TextStyleSection({ design, disabled, errors, fonts, hints, node, onChange, onFontsChange }: FreeSectionProps) {
  const id = (field: string) => freeFieldId(node.id, field);
  const style = freeTextStyleOf(node);
  const error = (field: string) => freeErrorAt(errors, `nodes.${node.id}.textStyle.${field}`);
  const set = (patch: FreePatch<FreeTextStyle>, field?: string) => onChange(withFreeTextStyle(design, node.id, patch), field ? `textStyle.${field}` : undefined);
  const shadow = style.shadow;
  const stroke = style.stroke;
  const outlineOnly = freeIsOutlineOnly(style);
  // Com a letra em degradê, o contorno cobre a cor: a chave só desliga e o "Só o contorno" fica parado, com o motivo.
  const strokeReason = freeStrokeDisabledReason(style);
  const outlineReason = freeOutlineOnlyDisabledReason(style);
  // O erro do contorno inteiro (com o degradê); o da espessura e o da cor ficam nos campos deles.
  const strokeError = error("stroke.width") || error("stroke.color") ? undefined : error("stroke");

  return (
    <FreeSection title={C.style.text}>
      <div className="flex min-w-0 flex-col gap-2" id={id("fonte")} tabIndex={-1}>
        <FreeFontField
          disabled={disabled}
          fonts={fonts}
          id={`${id("fonte")}-lista`}
          onChange={(font, weight) => set({ font, weight })}
          onFontsChange={onFontsChange}
          value={style.font}
          weight={style.weight}
        />
        <FreeHints hints={freeHintsOf(hints, node.id, ["font-device"])} />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <FreeNumberField bounds={L.fontSize} disabled={disabled} error={error("size")} id={id("tamanho-texto")} label={C.style.size} onChange={(size) => set({ size }, "size")} unit={C.units.px} value={style.size} />
        <FreeHints hints={freeHintsOf(hints, node.id, ["small-text"])} />
      </div>
      <WeightPicker disabled={disabled} font={style.font} id={id("peso")} label={C.style.weight} onChange={(weight) => set({ weight })} value={style.weight} />
      <AdminSwitch checked={style.italic === true} disabled={disabled} id={id("italico")} label={C.style.italic} onCheckedChange={(italic) => set({ italic: italic || undefined })} />
      <FreeNumberField
        bounds={L.lineHeight}
        disabled={disabled}
        error={error("lineHeight")}
        id={id("altura-linha")}
        integer={false}
        label={C.style.lineHeight}
        onChange={(lineHeight) => set({ lineHeight }, "lineHeight")}
        step={0.05}
        value={style.lineHeight}
      />
      <FreeNumberField
        bounds={L.letterSpacing}
        disabled={disabled}
        error={error("letterSpacing")}
        id={id("espaco-letras")}
        integer={false}
        label={C.style.letterSpacing}
        onChange={(letterSpacing) => set({ letterSpacing }, "letterSpacing")}
        step={0.01}
        unit="em"
        value={style.letterSpacing}
      />
      <AdminSwitch checked={style.uppercase === true} disabled={disabled} id={id("maiusculas")} label={C.style.uppercase} onCheckedChange={(uppercase) => set({ uppercase: uppercase || undefined })} />
      <PillField
        disabled={disabled}
        label={C.style.decoration}
        name={id("linha-texto")}
        onChange={(decoration) => set({ decoration: decoration === "none" ? undefined : decoration })}
        options={FREE_DECORATION_OPTIONS}
        value={style.decoration ?? "none"}
      />
      <PillField disabled={disabled} label={C.style.align} name={id("alinhamento")} onChange={(align) => set({ align })} options={FREE_TEXT_ALIGN_OPTIONS} value={style.align} />
      <div className="flex min-w-0 flex-col gap-2">
        <FreeTextPaintField disabled={disabled} error={error("paint")} id={id("cor-texto")} onChange={(paint) => set({ paint }, "paint")} value={style.paint} />
        <FreeHints hints={freeHintsOf(hints, node.id, ["contrast"])} />
      </div>
      <div className="flex min-w-0 flex-col gap-3" id={id("contorno")} tabIndex={-1}>
        <AdminSwitch
          checked={stroke !== undefined}
          description={strokeReason ?? undefined}
          disabled={disabled || strokeReason !== null}
          id={`${id("contorno")}-ligado`}
          label={C.style.stroke}
          // Desligar com a letra vazada devolve a cor dela no mesmo passo (sem o contorno ela sumiria).
          onCheckedChange={(on) => set(freeStrokeSwitchPatch(style, on))}
        />
        <FreeFieldError id={`${id("contorno")}-erro`} message={strokeError} />
        {stroke ? (
          <div className="flex min-w-0 flex-col gap-3 border-l-2 border-[var(--border-subtle)] pl-4">
            <FreeNumberField
              bounds={L.textStroke}
              disabled={disabled}
              error={error("stroke.width")}
              id={id("contorno-espessura")}
              label={C.style.strokeWidth}
              onChange={(width) => set({ stroke: { ...stroke, width } }, "stroke")}
              unit={C.units.px}
              value={stroke.width}
            />
            <ColorField disabled={disabled} error={error("stroke.color")} id={id("contorno-cor")} label={C.style.strokeColor} onChange={(color) => set({ stroke: { ...stroke, color } }, "stroke")} value={stroke.color} />
          </div>
        ) : null}
        {OUTLINE_ONLY_TYPES.has(node.type) ? (
          <div className="flex min-w-0 flex-col gap-2">
            <Button
              aria-describedby={outlineReason ? `${id("so-contorno")}-motivo` : undefined}
              aria-pressed={outlineOnly}
              className={cn(freeSmallButton, "self-start")}
              disabled={disabled || outlineReason !== null}
              id={id("so-contorno")}
              onClick={() => set(freeOutlineOnlyPatch(style, !outlineOnly))}
              type="button"
              variant="secondary"
            >
              {outlineOnly ? <Check aria-hidden="true" className="size-4" /> : null}
              {C.style.strokeOnly}
            </Button>
            {outlineReason ? <FreeNote id={`${id("so-contorno")}-motivo`}>{outlineReason}</FreeNote> : null}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3" id={id("sombra-texto")} tabIndex={-1}>
        <AdminSwitch
          checked={shadow !== undefined}
          disabled={disabled}
          id={`${id("sombra-texto")}-ligada`}
          label={C.style.shadow}
          onCheckedChange={(on) => set({ shadow: on ? { blur: 12, color: "#00000099", x: 0, y: 2 } : undefined })}
        />
        {shadow ? (
          <div className="flex min-w-0 flex-col gap-3 border-l-2 border-[var(--border-subtle)] pl-4">
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <FreeNumberField bounds={L.shadowOffset} disabled={disabled} id={`${id("sombra-texto")}-x`} label={C.style.shadowX} onChange={(x) => set({ shadow: { ...shadow, x } }, "shadow")} unit={C.units.px} value={shadow.x} />
              <FreeNumberField bounds={L.shadowOffset} disabled={disabled} id={`${id("sombra-texto")}-y`} label={C.style.shadowY} onChange={(y) => set({ shadow: { ...shadow, y } }, "shadow")} unit={C.units.px} value={shadow.y} />
            </div>
            <FreeNumberField bounds={L.shadowBlur} disabled={disabled} id={`${id("sombra-texto")}-desfoque`} label={C.style.shadowBlur} onChange={(blur) => set({ shadow: { ...shadow, blur } }, "shadow")} unit={C.units.px} value={shadow.blur} />
            <ColorField disabled={disabled} id={`${id("sombra-texto")}-cor`} label={C.style.shadowColor} onChange={(color) => set({ shadow: { ...shadow, color } }, "shadow")} value={shadow.color} />
          </div>
        ) : null}
      </div>
    </FreeSection>
  );
}

function BoxSections({ design, disabled, errors, latest, node, onBusyChange, onChange }: FreeSectionProps) {
  const id = (field: string) => freeFieldId(node.id, field);
  const box = node.box ?? {};
  const error = (field: string) => freeErrorAt(errors, `nodes.${node.id}.box.${field}`);
  const set = (patch: Parameters<typeof withFreeBox>[2], field?: string) => onChange(withFreeBox(design, node.id, patch), field ? `box.${field}` : undefined);
  const fade = box.fade;

  return (
    <>
      <FreeGroup>
        <FreeFillLayersField
          baseColor={freeFillBaseColor(box.fill) ?? null}
          design={design}
          disabled={disabled}
          error={error("fill")}
          id={id("fundo")}
          onBusyChange={onBusyChange}
          // Mudar a ordem, Tirar e "+ Camada" (step): um passo proprio, sem chave, montado pelo design mais novo (uma
          // mudanca em outro elemento durante o arrastar fica). A cor e os numeros juntam pela chave "id:box.fill".
          onChange={(fill, options) => (options?.step ? onChange(withFreeBox(latest(), node.id, { fill })) : set({ fill }, "fill"))}
          onImageLayer={(build, image) => onChange(withFreeFillImage(latest(), node.id, image, build))}
          value={box.fill}
        />
      </FreeGroup>
      <FreeGroup>
        <FreeBorderField disabled={disabled} error={error("border")} id={id("borda")} onChange={(border) => set({ border }, "border")} value={box.border} />
      </FreeGroup>
      <FreeGroup>
        <FreeRadiusField disabled={disabled} error={error("radius")} id={id("cantos")} onChange={(radius) => set({ radius: radius === 0 ? undefined : radius }, "radius")} value={box.radius} />
      </FreeGroup>
      <FreeGroup>
        <FreeShadowsField disabled={disabled} error={error("shadows")} fillColor={freeFillBaseColor(box.fill)} id={id("sombras")} onChange={(shadows) => set({ shadows }, "shadows")} value={box.shadows} />
      </FreeGroup>
      <FreeSection title={C.effects.title}>
        <FreeNumberField
          bounds={L.opacity}
          disabled={disabled}
          error={error("opacity")}
          id={id("opacidade")}
          label={C.effects.opacity}
          onChange={(opacity) => set({ opacity: opacity === 100 ? undefined : opacity }, "opacity")}
          unit={C.units.percent}
          value={box.opacity ?? 100}
        />
        <FreeNumberField bounds={L.blur} disabled={disabled} error={error("blur")} id={id("desfoque")} label={C.effects.blur} onChange={(blur) => set({ blur: blur === 0 ? undefined : blur }, "blur")} unit={C.units.px} value={box.blur ?? 0} />
        <FreeNumberField
          bounds={L.backdropBlur}
          disabled={disabled}
          error={error("backdropBlur")}
          id={id("desfoque-fundo")}
          label={C.effects.backdropBlur}
          onChange={(backdropBlur) => set({ backdropBlur: backdropBlur === 0 ? undefined : backdropBlur }, "backdropBlur")}
          unit={C.units.px}
          value={box.backdropBlur ?? 0}
        />
        <AdminSwitch checked={box.clip === true} disabled={disabled} id={id("cortar")} label={C.effects.clip} onCheckedChange={(clip) => set({ clip: clip || undefined })} />
        <div className="flex min-w-0 flex-col gap-3" id={id("esmaecer")} tabIndex={-1}>
          <AdminSwitch checked={fade !== undefined} disabled={disabled} id={`${id("esmaecer")}-ligado`} label={C.effects.fade} onCheckedChange={(on) => set({ fade: on ? { ...FREE_FADE_DEFAULT } : undefined })} />
          {fade ? (
            <div className="flex min-w-0 flex-col gap-3 border-l-2 border-[var(--border-subtle)] pl-4">
              <PillField disabled={disabled} label={C.effects.fadeSide} name={`${id("esmaecer")}-lado`} onChange={(side) => set({ fade: { ...fade, side } })} options={FREE_FADE_SIDE_OPTIONS} value={fade.side} />
              <FreeNumberField
                bounds={{ max: 95, min: 0 }}
                disabled={disabled}
                id={`${id("esmaecer")}-comeco`}
                label={C.effects.fadeStart}
                onChange={(start) => set({ fade: withFreeFadeStart(fade, start) }, "fade")}
                unit={C.units.percent}
                value={fade.start}
              />
              <FreeNumberField
                bounds={{ max: 100, min: 5 }}
                disabled={disabled}
                error={error("fade")}
                id={`${id("esmaecer")}-fim`}
                label={C.effects.fadeEnd}
                onChange={(end) => set({ fade: withFreeFadeEnd(fade, end) }, "fade")}
                unit={C.units.percent}
                value={fade.end}
              />
            </div>
          ) : null}
        </div>
      </FreeSection>
    </>
  );
}
