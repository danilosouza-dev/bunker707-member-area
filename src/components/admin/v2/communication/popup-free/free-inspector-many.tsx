"use client";

import { AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, BringToFront, Copy, Eye, EyeOff, Lock, LockOpen, SendToBack, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FreeMeasuredRects } from "@/server/communications/popup-free-checks";
import type { FreeId, PopupFreeDesign } from "@/server/communications/popup-free-model";
import type { FreeDevice } from "./free-editor-model";
import { FREE_SELECTION_COPY, freeManyFlagNext, freeManyReasons, freeNormalizeSelection, freeSelectionName, type FreeAlignScope } from "./free-editor-selection";
import { FreeNote, FreeSection, freeSmallButton } from "./free-fields";
import { ALIGN_ICONS } from "./free-inspector-advanced";
import { FREE_ALIGN_EDGES, FREE_INSPECTOR_COPY, type FreeAlignEdge } from "./free-inspector-model";

// Editor Livre do pop-up, L4b (docs/27 §13.10): o painel da direita com 2 ou mais elementos escolhidos (o editor
// mostra este no lugar do painel de um elemento; free-inspector.tsx nao muda). Mostra quantos estao escolhidos e a
// dica de escolher um so para mudar textos, cores e tamanhos; Duplicar e Excluir; Alinhar entre si (pela caixa que
// envolve os soltos), Alinhar no pop-up (cada um vai a borda ou ao centro da prancheta, decisao 1 do produtor) e
// Distribuir os espacos (3 ou mais); a Camada (com a mesma frase do Avançado: quem esta mais acima nas Camadas fica
// por cima, docs/27 L64); Esconder ou Mostrar e Travar ou Destravar (se algum ainda nao tem a marca, todos ganham;
// senao, todos perdem); e a lista "Na seleção" com "Escolher só {nome}" (na ordem da escolha; o intervalo das Camadas
// entra na ordem da lista, de cima para baixo).
//
// Um botao que nao da fica desligado com aria-disabled (continua focavel, entao o foco nunca cai no vazio quando ele
// desliga depois de um clique) e o motivo escrito embaixo do grupo em 12 px, ligado por aria-describedby; os motivos
// sao os de freeManyReasons. Com "Ver como: Celular", a nota de que alinhar e distribuir mudam so o celular fica no
// topo e os botoes de alinhar e distribuir apontam para ela.
//
// So desenha: cada botao manda um FreeManyCommand ao editor, que grava um passo so (um commitDesign) e diz a frase. O
// titulo e um h2 com tabIndex -1 e id FREE_INSPECTOR_MANY_TITLE_ID, para o editor levar o foco a ele quando o painel
// da direita troca de um elemento para varios com o foco dentro dele (crítica C11). Sem hooks: o teste de tela
// (tests/popup-livre-varios-tela.test.mjs) desenha pelo react-dom/server e confere os comandos pela arvore.

const P = FREE_SELECTION_COPY.panel;
const A = FREE_INSPECTOR_COPY.advanced;

/** O id do titulo do painel Varios (o editor poe o foco nele). */
export const FREE_INSPECTOR_MANY_TITLE_ID = "livre-varios-titulo";

/** O que cada botao do painel Varios pede ao editor (um passo so por comando). */
export type FreeManyCommand =
  | { kind: "backward" | "duplicate" | "forward" | "remove" | "toggleHidden" | "toggleLocked" }
  | { edge: FreeAlignEdge; kind: "align"; scope: FreeAlignScope }
  | { axis: "x" | "y"; kind: "distribute" }
  | { id: FreeId; kind: "selectOnly" };

export type FreeInspectorManyProps = {
  /** O design do editor (com devices.mobile): alinhar e distribuir contam com a posição do aparelho. */
  design: PopupFreeDesign;
  /** O "Ver como": com Celular, a nota e as contas do celular. */
  device: FreeDevice;
  /** O editor inteiro desligado (salvando, sem permissão): os comandos desligam; "Escolher só" continua. */
  disabled: boolean;
  onCommand: (command: FreeManyCommand) => void;
  /** Retângulos medidos no aparelho do "Ver como" (px da prancheta, com "@artboard"). */
  rects: FreeMeasuredRects;
  /** A seleção na ordem da escolha (o último é o principal). */
  selectedIds: readonly FreeId[];
};

const ID = "livre-varios";
const NOTE_ID = `${ID}-celular`;
const REASON_IDS = {
  alignArtboard: `${ID}-motivo-alinhar-no-pop-up`,
  alignSelection: `${ID}-motivo-alinhar-entre-si`,
  distribute: `${ID}-motivo-distribuir`,
  duplicate: `${ID}-motivo-duplicar`,
  remove: `${ID}-motivo-excluir`
} as const;

/** Os ids de aria-describedby (o motivo e a nota do Celular), ou nada. */
function describedBy(...ids: (string | null | undefined)[]): string | undefined {
  const list = ids.filter((id): id is string => Boolean(id));

  return list.length > 0 ? list.join(" ") : undefined;
}

export function FreeInspectorMany({ design, device, disabled, onCommand, rects, selectedIds }: FreeInspectorManyProps) {
  const ids = freeNormalizeSelection(design, selectedIds);
  const reasons = freeManyReasons(design, ids, rects);
  const hide = freeManyFlagNext(design, ids, "hidden");
  const lock = freeManyFlagNext(design, ids, "locked");
  const note = device === "mobile" ? NOTE_ID : null;
  const run = (command: FreeManyCommand) => () => onCommand(command);
  const sameHeaderReason = reasons.duplicate !== null && reasons.duplicate === reasons.remove;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-free-inspector="many">
      <header className="flex min-w-0 flex-col gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h2
            className="m-0 text-sm leading-6 font-semibold text-[var(--text-primary)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            id={FREE_INSPECTOR_MANY_TITLE_ID}
            tabIndex={-1}
          >
            {P.title(ids.length)}
          </h2>
          <p className="m-0 text-xs leading-5 text-[var(--text-secondary)]">{P.hint}</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <ManyButton className={freeSmallButton} describedBy={reasons.duplicate ? REASON_IDS.duplicate : undefined} disabled={disabled} off={reasons.duplicate !== null} onClick={run({ kind: "duplicate" })}>
            <Copy aria-hidden="true" className="size-4" />
            {P.duplicate}
          </ManyButton>
          <ManyButton
            className={freeSmallButton}
            describedBy={reasons.remove ? (sameHeaderReason ? REASON_IDS.duplicate : REASON_IDS.remove) : undefined}
            disabled={disabled}
            off={reasons.remove !== null}
            onClick={run({ kind: "remove" })}
          >
            <Trash2 aria-hidden="true" className="size-4" />
            {P.remove}
          </ManyButton>
        </div>
        {reasons.duplicate ? <FreeNote id={REASON_IDS.duplicate}>{reasons.duplicate}</FreeNote> : null}
        {reasons.remove && !sameHeaderReason ? <FreeNote id={REASON_IDS.remove}>{reasons.remove}</FreeNote> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8">
        <div className="flex min-w-0 flex-col gap-5 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
          {note ? <FreeNote id={note}>{P.mobileNote}</FreeNote> : null}

          <AlignGroup disabled={disabled} note={note} onCommand={onCommand} reason={reasons.alignSelection} scope="selection" />
          <AlignGroup disabled={disabled} note={note} onCommand={onCommand} reason={reasons.alignArtboard} scope="artboard" />

          <FreeSection title={P.distribute}>
            <div className="grid min-w-0 grid-cols-1 gap-2">
              {(["x", "y"] as const).map((axis) => (
                <ManyButton
                  className={cn(freeSmallButton, "w-full justify-start")}
                  describedBy={describedBy(reasons.distribute ? REASON_IDS.distribute : null, note)}
                  disabled={disabled}
                  key={axis}
                  off={reasons.distribute !== null}
                  onClick={run({ axis, kind: "distribute" })}
                >
                  {axis === "x" ? <AlignHorizontalSpaceBetween aria-hidden="true" className="size-4" /> : <AlignVerticalSpaceBetween aria-hidden="true" className="size-4" />}
                  {axis === "x" ? P.distributeX : P.distributeY}
                </ManyButton>
              ))}
            </div>
            {reasons.distribute ? <FreeNote id={REASON_IDS.distribute}>{reasons.distribute}</FreeNote> : null}
          </FreeSection>

          <FreeSection description={A.layerNote} title={A.layer}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ManyButton className={freeSmallButton} disabled={disabled} onClick={run({ kind: "forward" })}>
                <BringToFront aria-hidden="true" className="size-4" />
                {P.forward}
              </ManyButton>
              <ManyButton className={freeSmallButton} disabled={disabled} onClick={run({ kind: "backward" })}>
                <SendToBack aria-hidden="true" className="size-4" />
                {P.backward}
              </ManyButton>
            </div>
          </FreeSection>

          <FreeSection title={A.more}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ManyButton className={freeSmallButton} disabled={disabled} onClick={run({ kind: "toggleHidden" })}>
                {hide ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                {hide ? P.hide : P.show}
              </ManyButton>
              <ManyButton className={freeSmallButton} disabled={disabled} onClick={run({ kind: "toggleLocked" })}>
                {lock ? <Lock aria-hidden="true" className="size-4" /> : <LockOpen aria-hidden="true" className="size-4" />}
                {lock ? P.lock : P.unlock}
              </ManyButton>
            </div>
          </FreeSection>

          <FreeSection title={P.listLabel}>
            <ul className="m-0 flex min-w-0 list-none flex-col gap-1 p-0">
              {ids.map((id) => {
                const label = P.selectOnly(freeSelectionName(design, id));

                return (
                  <li className="min-w-0" key={id}>
                    <Button
                      className="h-9 w-full min-w-0 justify-start px-2.5 text-[13px] pointer-coarse:h-11"
                      data-free-many-only={id}
                      onClick={run({ id, kind: "selectOnly" })}
                      title={label}
                      type="button"
                      variant="ghost"
                    >
                      <span className="min-w-0 truncate">{label}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </FreeSection>
        </div>
      </div>
    </div>
  );
}

/** Os 6 lados de um alinhar de varios, com o nome que diz onde mede ("entre si" ou "no pop-up") e o motivo embaixo. */
function AlignGroup({
  disabled,
  note,
  onCommand,
  reason,
  scope
}: {
  disabled: boolean;
  note: string | null;
  onCommand: (command: FreeManyCommand) => void;
  reason: string | null;
  scope: FreeAlignScope;
}) {
  const reasonId = scope === "artboard" ? REASON_IDS.alignArtboard : REASON_IDS.alignSelection;

  return (
    <FreeSection title={scope === "artboard" ? P.alignArtboard : P.alignSelection}>
      <div className="grid min-w-0 grid-cols-3 gap-2">
        {FREE_ALIGN_EDGES.map((edge) => {
          const Icon = ALIGN_ICONS[edge];
          const label = FREE_SELECTION_COPY.alignLabel(edge, scope);

          return (
            <ManyButton
              className="h-10 pointer-coarse:h-11"
              describedBy={describedBy(reason ? reasonId : null, note)}
              disabled={disabled}
              key={edge}
              label={label}
              off={reason !== null}
              onClick={() => onCommand({ edge, kind: "align", scope })}
            >
              <Icon aria-hidden="true" className="size-4" />
            </ManyButton>
          );
        })}
      </div>
      {reason ? <FreeNote id={reasonId}>{reason}</FreeNote> : null}
    </FreeSection>
  );
}

/**
 * Um botao do painel Varios. `off` = o comando nao da agora: aria-disabled (continua focavel), o clique nao faz nada
 * e `describedBy` aponta para o motivo. `disabled` = o editor inteiro desligado (botao desligado de verdade). `label`
 * so nos botoes de icone: vira o nome acessivel e a dica do mouse.
 */
function ManyButton({
  children,
  className,
  describedBy: description,
  disabled,
  label,
  off = false,
  onClick
}: {
  children: ReactNode;
  className?: string;
  describedBy?: string;
  disabled: boolean;
  label?: string;
  off?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      aria-describedby={description}
      aria-disabled={off || undefined}
      aria-label={label}
      className={cn(className, off && "cursor-not-allowed! opacity-50")}
      disabled={disabled}
      onClick={() => {
        if (!off) {
          onClick();
        }
      }}
      title={label}
      type="button"
      variant="secondary"
    >
      {children}
    </Button>
  );
}
