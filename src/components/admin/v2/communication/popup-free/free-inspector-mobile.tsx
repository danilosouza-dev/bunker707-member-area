"use client";

import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FREE_DESIGN_LIMITS, type FreeId, type FreeSides } from "@/server/communications/popup-free-model";
import { AdminSwitch } from "../../settings/kit";
import { adminTransition } from "../../styles";
import { PillField } from "../popup-design/design-controls";
import type { FreeSectionProps } from "./free-inspector-content";
import { FreeFieldError, FreeHints, FreeNote, FreeNumberField, FreeRadiusField, FreeSection, FreeSidesField, freeSmallButton } from "./free-fields";
import {
  FREE_BOX_ALIGN_OPTIONS,
  FREE_BOX_DIR_OPTIONS,
  FREE_BOX_JUSTIFY_OPTIONS,
  FREE_FLOW_ALIGN_OPTIONS,
  FREE_FLOW_WIDTH_OPTIONS,
  FREE_INSPECTOR_COPY,
  FREE_TEXT_ALIGN_OPTIONS,
  clampFree,
  freeErrorAt,
  freeHasMobileValues,
  freeHintsOf,
  freeMobileDesktopValue,
  freeMobileFieldId,
  freeMobileFieldValue,
  freeMobileFieldsOf,
  withFreeMobileField,
  type FreeMobileField,
  type FreeMobileFieldKey,
  type FreeMobileGroup
} from "./free-inspector-model";

// Editor Livre do pop-up (docs/27 §9.10 e §13.8, PR L3): a aba Celular do painel do elemento. So os campos que tem
// versao do celular para o tipo (esconder, posicao no mesmo modo, texto, conteudo e respiro/cantos), cada um com a
// chave "Igual ao computador" (ligada = o celular encolhe o valor do computador; desligada = o valor proprio, que
// comeca do computador) e "Voltar tudo ao do computador". Entrar na aba liga o "Ver como: Celular" (o editor faz).

const L = FREE_DESIGN_LIMITS;
const C = FREE_INSPECTOR_COPY;
const M = C.mobile;
const GROUPS: readonly FreeMobileGroup[] = ["show", "place", "text", "content", "box"];
/** Alinhar nesta caixa no celular: "Como a caixa" nao vale (sem valor = o do computador). */
const MOBILE_FLOW_ALIGN_OPTIONS = FREE_FLOW_ALIGN_OPTIONS.filter((option) => option.value !== "box") as readonly { label: string; value: "center" | "end" | "start" | "stretch" }[];

/**
 * A chave "Igual ao computador" de um campo do celular: o nome falado diz o campo ("Tamanho: igual ao computador"),
 * o texto na tela e curto. Ligada = sem valor proprio.
 */
export function FreeMobileSameSwitch({ checked, disabled, id, label, onCheckedChange }: { checked: boolean; disabled?: boolean; id: string; label: string; onCheckedChange: (same: boolean) => void }) {
  return (
    <div className="flex min-h-9 items-center gap-2.5">
      <button
        aria-checked={checked}
        aria-label={M.sameLabel(label)}
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          adminTransition,
          checked ? "border-transparent bg-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[var(--surface-2)]",
          disabled && "cursor-not-allowed opacity-60"
        )}
        data-free-mobile-same=""
        disabled={disabled}
        id={id}
        onClick={() => onCheckedChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "block size-[18px] rounded-full transition-transform duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none",
            checked ? "translate-x-[19px] bg-[var(--surface-0)]" : "translate-x-[2px] bg-[var(--text-secondary)]"
          )}
        />
      </button>
      <span aria-hidden="true" className="text-[13px] leading-5 text-[var(--text-secondary)]">
        {M.same}
      </span>
    </div>
  );
}

/** Um campo do celular: a chave em cima e o campo embaixo (desligado e com o valor do computador enquanto igual). */
export function FreeMobileFieldShell({ children, disabled, fieldId, label, onSameChange, own }: { children: ReactNode; disabled?: boolean; fieldId: string; label: string; onSameChange: (same: boolean) => void; own: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] p-3" data-free-mobile-field={own ? "own" : "same"} id={fieldId}>
      <FreeMobileSameSwitch checked={!own} disabled={disabled} id={`${fieldId}-igual`} label={label} onCheckedChange={onSameChange} />
      {children}
    </div>
  );
}

export function FreeInspectorMobile({ design, disabled, errors, hints, node, onChange, onReset, rects }: FreeSectionProps & { onReset: (id: FreeId) => void }) {
  const fields = freeMobileFieldsOf(node);
  const hasOwn = freeHasMobileValues(design, node.id);
  // Os erros do celular deste elemento que nao sao de um campo da tela (o modo da posicao, um campo de outro tipo): no topo.
  const entry = `devices.mobile.nodes.${node.id}`;
  const entryErrors = Object.entries(errors).filter(
    ([key]) => (key === entry || key.startsWith(`${entry}.`)) && !fields.some((field) => key === fieldKey(node.id, field.key) || key.startsWith(`${fieldKey(node.id, field.key)}.`))
  );

  /** Um valor proprio (os numeros juntam passos no historico pela chave `<id>:mobile.<campo>`); `undefined` = igual ao computador. */
  function set(key: FreeMobileFieldKey, value: unknown, coalesce = true) {
    onChange(withFreeMobileField(design, node.id, key, value), coalesce ? `mobile.${key}` : undefined);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0" data-free-mobile-panel={node.id}>
      <div className="flex min-w-0 flex-col gap-3">
        <FreeNote>{M.note}</FreeNote>
        <Button
          className={cn(freeSmallButton, "self-start")}
          data-free-mobile-reset=""
          disabled={disabled || !hasOwn}
          onClick={() => onReset(node.id)}
          type="button"
          variant="secondary"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {M.reset}
        </Button>
        {entryErrors.map(([key, message]) => (
          <FreeFieldError key={key} message={message} />
        ))}
      </div>

      {GROUPS.map((group) => {
        const items = fields.filter((field) => field.group === group);

        if (items.length === 0) {
          return null;
        }

        return (
          <FreeSection key={group} title={M.groups[group]}>
            {items.map((field) => (
              <MobileField design={design} disabled={disabled} error={freeErrorAt(errors, fieldKey(node.id, field.key))} field={field} key={field.key} node={node} onSet={set} rects={rects} />
            ))}
            {group === "text" ? <FreeHints hints={freeHintsOf(hints, node.id, ["phone-text"])} /> : null}
          </FreeSection>
        );
      })}
    </div>
  );
}

function fieldKey(id: FreeId, key: FreeMobileFieldKey) {
  return `devices.mobile.nodes.${id}.${key}`;
}

function MobileField({
  design,
  disabled,
  error,
  field,
  node,
  onSet,
  rects
}: Pick<FreeSectionProps, "design" | "disabled" | "node" | "rects"> & {
  error?: string;
  field: FreeMobileField;
  onSet: (key: FreeMobileFieldKey, value: unknown, coalesce?: boolean) => void;
}) {
  const { key, label } = field;
  const fieldId = freeMobileFieldId(node.id, key);
  const valueId = `${fieldId}-valor`;
  const { own, value } = freeMobileFieldValue(design, node, key, rects);
  const off = disabled || !own;
  const number = (bounds: { max: number; min: number }, options: { integer?: boolean; step?: number; unit?: string } = {}) => (
    <FreeNumberField
      bounds={bounds}
      disabled={off}
      error={error}
      id={valueId}
      integer={options.integer ?? true}
      label={label}
      onChange={(next) => onSet(key, next)}
      step={options.step}
      unit={options.unit === undefined ? C.units.px : options.unit || undefined}
      value={Number(value)}
    />
  );

  const pills = <Value extends string>(options: readonly { label: string; value: Value }[]) => (
    <PillField disabled={off} error={error} label={label} name={valueId} onChange={(next: Value) => onSet(key, next, false)} options={options} value={value as Value} />
  );
  const toggle = () => <AdminSwitch checked={value === true} disabled={off} id={valueId} label={label} onCheckedChange={(next) => onSet(key, next, false)} />;
  const sides = (bounds: { max: number; min: number }) => (
    <FreeSidesField bounds={bounds} disabled={off} error={error} id={valueId} label={label} onChange={(next: FreeSides) => onSet(key, next)} value={value as FreeSides} />
  );
  // Cada campo pelo tipo do valor (os blocos com chaves deixam o texto da tela separado do codigo, para a guarda do vocabulario).
  const controls: Record<FreeMobileFieldKey, () => ReactNode> = {
    "box.padding": () => sides(L.padding),
    "box.radius": () => <FreeRadiusField disabled={off} error={error} id={valueId} onChange={(next) => onSet(key, next)} value={value as number | [number, number, number, number]} />,
    gap: () => number(L.gap),
    hidden: toggle,
    "layout.align": () => pills(FREE_BOX_ALIGN_OPTIONS),
    "layout.dir": () => pills(FREE_BOX_DIR_OPTIONS),
    "layout.gap": () => number(L.gap),
    "layout.justify": () => pills(FREE_BOX_JUSTIFY_OPTIONS),
    "layout.wrap": toggle,
    "place.align": () => pills(MOBILE_FLOW_ALIGN_OPTIONS),
    "place.h": () => number(L.h),
    "place.height": () => number(L.flowHeight),
    "place.margin": () => sides(L.margin),
    "place.w": () => number(L.w),
    "place.width": () => {
      const choice = typeof value === "number" ? "fixed" : (value as "fill" | "hug");

      return (
        <>
          <PillField
            disabled={off}
            error={typeof value === "number" ? undefined : error}
            label={label}
            name={valueId}
            onChange={(next) => onSet(key, next === "fixed" ? clampFree(rects[node.id]?.w ?? 200, L.flowWidth) : next, false)}
            options={FREE_FLOW_WIDTH_OPTIONS}
            value={choice}
          />
          {typeof value === "number" ? number(L.flowWidth) : null}
        </>
      );
    },
    "place.x": () => number(L.x),
    "place.y": () => number(L.y),
    size: () => number(node.type === "icon" ? L.iconSize : L.spacer),
    "textStyle.align": () => pills(FREE_TEXT_ALIGN_OPTIONS),
    "textStyle.letterSpacing": () => number(L.letterSpacing, { integer: false, step: 0.01, unit: "em" }),
    "textStyle.lineHeight": () => number(L.lineHeight, { integer: false, step: 0.05, unit: "" }),
    "textStyle.size": () => number(L.fontSize)
  };
  const control = controls[key]();

  return (
    <FreeMobileFieldShell
      disabled={disabled}
      fieldId={fieldId}
      label={label}
      onSameChange={(same) => onSet(key, same ? undefined : freeMobileDesktopValue(design, node, key, rects), false)}
      own={own}
    >
      {control}
    </FreeMobileFieldShell>
  );
}
