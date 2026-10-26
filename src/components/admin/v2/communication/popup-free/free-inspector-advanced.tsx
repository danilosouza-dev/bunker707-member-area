"use client";

import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, BringToFront, SendToBack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FREE_DESIGN_LIMITS, isTextBearing, type FreeAbsolutePlace, type FreeFlowPlace, type FreeId, type FreeNode, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import { HeroTextField } from "../../member-area/home-hero/fields";
import { AdminSwitch } from "../../settings/kit";
import { PillField, fieldLabelClass } from "../popup-design/design-controls";
import type { FreeSectionProps } from "./free-inspector-content";
import { FreeGroup, FreeNote, FreeNumberField, FreeSection, FreeSidesField, freeSmallButton } from "./free-fields";
import {
  FREE_ALIGN_EDGES,
  FREE_ALIGN_LABELS,
  FREE_FLOW_ALIGN_OPTIONS,
  FREE_FLOW_WIDTH_OPTIONS,
  FREE_INSPECTOR_COPY,
  FREE_POSITION_OPTIONS,
  freeErrorAt,
  freeFieldId,
  freeFlowHeightOptions,
  withFreeBox,
  withFreeNodeFields,
  type FreeAlignEdge
} from "./free-inspector-model";

// Editor Livre do pop-up (docs/27; spec §4.6 "Avançado"), pacote I: Posição (Na sequência / Solta: a troca vai
// para o editor, que mede o elemento e nao mexe no que se ve), X, Y, Largura, Altura (Automática nos elementos com
// texto), Girar e "Alinhar no pop-up" (o editor faz a conta com o retangulo medido); na sequência: Largura, Altura,
// Alinhar nesta caixa e Margem; Respiro interno; Camada (Trazer para frente / Enviar para trás); Esconder, Travar
// e o nome na lista de camadas.

const L = FREE_DESIGN_LIMITS;
const C = FREE_INSPECTOR_COPY;

export type FreeAdvancedCommand =
  | { id: FreeId; kind: "backward" | "forward" | "toFree" | "toSequence" }
  | { edge: FreeAlignEdge; id: FreeId; kind: "align" };

/** O icone de cada lado do alinhar: o mesmo aqui (um elemento) e no painel Varios (entre si e no pop-up). */
export const ALIGN_ICONS: Record<FreeAlignEdge, typeof AlignStartVertical> = {
  bottom: AlignEndHorizontal,
  center: AlignCenterVertical,
  left: AlignStartVertical,
  middle: AlignCenterHorizontal,
  right: AlignEndVertical,
  top: AlignStartHorizontal
};

function setPlace(design: PopupFreeDesign, node: FreeNode, place: FreeAbsolutePlace | FreeFlowPlace | undefined) {
  return withFreeNodeFields(design, node.id, { place });
}

function flowOf(node: FreeNode): FreeFlowPlace {
  return node.place?.mode === "flow" ? node.place : { mode: "flow" };
}

/** Tira as chaves indefinidas da posicao na sequencia; `{ mode: "flow" }` sozinho = o padrao (sai). */
function cleanFlow(place: FreeFlowPlace): FreeFlowPlace | undefined {
  const next = Object.fromEntries(Object.entries(place).filter(([, value]) => value !== undefined)) as FreeFlowPlace;

  return Object.keys(next).length === 1 ? undefined : next;
}

export function FreeInspectorAdvanced({ design, disabled, errors, node, onChange, onCommand, rects }: FreeSectionProps & { onCommand: (command: FreeAdvancedCommand) => void }) {
  const id = (field: string) => freeFieldId(node.id, field);
  const error = (path: string) => freeErrorAt(errors, `nodes.${node.id}.${path}`);
  const free = node.place?.mode === "free" ? node.place : null;
  const text = isTextBearing(node.type);
  const measured = rects[node.id];

  return (
    <div className="flex min-w-0 flex-col gap-5 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
      <FreeSection title={C.advanced.position}>
        <PillField
          disabled={disabled}
          error={error("place")}
          hint={C.advanced.freeHint}
          label={C.advanced.position}
          name={id("posicao")}
          onChange={(mode) => (mode === "free" ? onCommand({ id: node.id, kind: "toFree" }) : onCommand({ id: node.id, kind: "toSequence" }))}
          options={FREE_POSITION_OPTIONS}
          value={free ? "free" : "flow"}
        />

        {free ? (
          <>
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <FreeNumberField bounds={L.x} disabled={disabled} error={error("place.x")} id={id("x")} label={C.advanced.x} onChange={(x) => onChange(setPlace(design, node, { ...free, x }), "place.x")} unit={C.units.px} value={free.x} />
              <FreeNumberField bounds={L.y} disabled={disabled} error={error("place.y")} id={id("y")} label={C.advanced.y} onChange={(y) => onChange(setPlace(design, node, { ...free, y }), "place.y")} unit={C.units.px} value={free.y} />
              <FreeNumberField bounds={L.w} disabled={disabled} error={error("place.w")} id={id("largura")} label={C.advanced.width} onChange={(w) => onChange(setPlace(design, node, { ...free, w }), "place.w")} unit={C.units.px} value={free.w} />
              {free.h !== undefined || !text ? (
                <FreeNumberField
                  bounds={L.h}
                  disabled={disabled}
                  error={error("place.h")}
                  id={id("altura")}
                  label={C.advanced.height}
                  onChange={(h) => onChange(setPlace(design, node, { ...free, h }), "place.h")}
                  unit={C.units.px}
                  value={free.h ?? Math.max(L.h.min, Math.round(measured?.h ?? 40))}
                />
              ) : (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className={fieldLabelClass}>{C.advanced.height}</span>
                  <FreeNote id={id("altura")}>{measured ? C.advanced.measured(measured.h) : C.advanced.auto}</FreeNote>
                </div>
              )}
            </div>
            {text ? (
              <AdminSwitch
                checked={free.h === undefined}
                disabled={disabled}
                id={id("altura-auto")}
                label={C.advanced.auto}
                onCheckedChange={(auto) => {
                  if (auto) {
                    const { h: unused, ...rest } = free;

                    void unused;
                    onChange(setPlace(design, node, rest));
                  } else {
                    onChange(setPlace(design, node, { ...free, h: Math.max(L.h.min, Math.min(L.h.max, Math.round(measured?.h ?? 40))) }));
                  }
                }}
              />
            ) : null}
            <FreeNumberField
              bounds={L.rotate}
              disabled={disabled}
              error={error("place.rotate")}
              id={id("girar")}
              label={C.advanced.rotate}
              onChange={(rotate) => onChange(setPlace(design, node, rotate === 0 ? withoutRotate(free) : { ...free, rotate }), "place.rotate")}
              unit={C.units.degrees}
              value={free.rotate ?? 0}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={fieldLabelClass} id={id("alinhar-titulo")}>
                {C.advanced.align}
              </span>
              <div aria-labelledby={id("alinhar-titulo")} className="grid min-w-0 grid-cols-3 gap-2" role="group">
                {FREE_ALIGN_EDGES.map((edge) => {
                  const Icon = ALIGN_ICONS[edge];

                  return (
                    <Button
                      aria-label={FREE_ALIGN_LABELS[edge]}
                      className="h-10 pointer-coarse:h-11"
                      disabled={disabled}
                      key={edge}
                      onClick={() => onCommand({ edge, id: node.id, kind: "align" })}
                      title={FREE_ALIGN_LABELS[edge]}
                      type="button"
                      variant="secondary"
                    >
                      <Icon aria-hidden="true" className="size-4" />
                    </Button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <FlowFields design={design} disabled={disabled} error={error} id={id} measured={measured} node={node} onChange={onChange} text={text} />
        )}
      </FreeSection>

      <FreeGroup>
        <FreeSidesField
          bounds={L.padding}
          disabled={disabled}
          error={error("box.padding")}
          id={id("respiro")}
          label={C.advanced.padding}
          onChange={(padding) => onChange(withFreeBox(design, node.id, { padding: padding === 0 ? undefined : padding }), "box.padding")}
          value={node.box?.padding}
        />
      </FreeGroup>

      <FreeSection description={C.advanced.layerNote} title={C.advanced.layer}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button className={freeSmallButton} disabled={disabled || (node.place?.z ?? 0) >= L.z.max} onClick={() => onCommand({ id: node.id, kind: "forward" })} type="button" variant="secondary">
            <BringToFront aria-hidden="true" className="size-4" />
            {C.advanced.forward}
          </Button>
          <Button className={freeSmallButton} disabled={disabled || (node.place?.z ?? 0) <= L.z.min} onClick={() => onCommand({ id: node.id, kind: "backward" })} type="button" variant="secondary">
            <SendToBack aria-hidden="true" className="size-4" />
            {C.advanced.backward}
          </Button>
          <span aria-live="polite" className="text-sm leading-5 text-[var(--text-secondary)] tabular-nums outline-none" id={id("camada")} tabIndex={-1}>
            {`${C.advanced.layer}: ${node.place?.z ?? 0}`}
          </span>
        </div>
      </FreeSection>

      <FreeSection title={C.advanced.more}>
        <AdminSwitch checked={node.hidden === true} disabled={disabled} id={id("esconder")} label={C.advanced.hide} onCheckedChange={(hidden) => onChange(withFreeNodeFields(design, node.id, { hidden: hidden || undefined }))} />
        <AdminSwitch checked={node.locked === true} disabled={disabled} id={id("travar")} label={C.advanced.lock} onCheckedChange={(locked) => onChange(withFreeNodeFields(design, node.id, { locked: locked || undefined }))} />
        <HeroTextField
          disabled={disabled}
          error={error("name")}
          id={id("nome")}
          label={C.advanced.name}
          max={L.name}
          onBlur={() => undefined}
          onChange={(name) => onChange(withFreeNodeFields(design, node.id, { name: name === "" ? undefined : name }), "name")}
          value={node.name ?? ""}
        />
      </FreeSection>
    </div>
  );
}

function withoutRotate(place: FreeAbsolutePlace): FreeAbsolutePlace {
  const { rotate: unused, ...rest } = place;

  void unused;

  return rest;
}

function FlowFields({
  design,
  disabled,
  error,
  id,
  measured,
  node,
  onChange,
  text
}: {
  design: PopupFreeDesign;
  disabled: boolean;
  error: (path: string) => string | undefined;
  id: (field: string) => string;
  measured?: { h: number; w: number };
  node: FreeNode;
  onChange: FreeSectionProps["onChange"];
  text: boolean;
}) {
  const flow = flowOf(node);
  const widthChoice = typeof flow.width === "number" ? "fixed" : (flow.width ?? (["badge", "button", "icon"].includes(node.type) ? "hug" : "fill"));
  const set = (patch: Partial<FreeFlowPlace>, field?: string) => onChange(setPlace(design, node, cleanFlow({ ...flow, ...patch, mode: "flow" })), field);

  return (
    <>
      <PillField
        disabled={disabled}
        error={error("place.width")}
        label={C.advanced.width}
        name={id("largura-tipo")}
        onChange={(choice) => set({ width: choice === "fixed" ? Math.max(L.flowWidth.min, Math.min(L.flowWidth.max, Math.round(measured?.w ?? 200))) : choice })}
        options={FREE_FLOW_WIDTH_OPTIONS}
        value={widthChoice}
      />
      {typeof flow.width === "number" ? (
        <FreeNumberField bounds={L.flowWidth} disabled={disabled} id={id("largura")} label={C.advanced.width} onChange={(width) => set({ width }, "place.width")} unit={C.units.px} value={flow.width} />
      ) : null}
      <PillField
        disabled={disabled}
        error={error("place.height")}
        label={C.advanced.height}
        name={id("altura-tipo")}
        onChange={(choice) => set({ height: choice === "auto" ? undefined : Math.max(L.flowHeight.min, Math.min(L.flowHeight.max, Math.round(measured?.h ?? 80))) })}
        options={freeFlowHeightOptions(text)}
        value={flow.height === undefined ? "auto" : "fixed"}
      />
      {flow.height !== undefined ? (
        <FreeNumberField bounds={L.flowHeight} disabled={disabled} id={id("altura")} label={C.advanced.height} onChange={(height) => set({ height }, "place.height")} unit={C.units.px} value={flow.height} />
      ) : null}
      <PillField
        disabled={disabled}
        error={error("place.align")}
        label={C.advanced.flowAlign}
        name={id("alinhar-caixa")}
        onChange={(align) => set({ align: align === "box" ? undefined : align })}
        options={FREE_FLOW_ALIGN_OPTIONS}
        value={flow.align ?? "box"}
      />
      <FreeSidesField
        bounds={L.margin}
        disabled={disabled}
        error={error("place.margin")}
        hint={C.advanced.marginHint}
        id={id("margem")}
        label={C.advanced.margin}
        onChange={(margin) => set({ margin: margin === 0 ? undefined : margin }, "place.margin")}
        value={flow.margin}
      />
    </>
  );
}
