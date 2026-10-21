"use client";

import { Bell, Plus, Split } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AudienceNames } from "@/server/communications/audience-model";
import { describeAudience } from "@/server/communications/audience-model";
import type { FlowBranch } from "@/server/communications/flow-model";
import type { FlowDraft, FlowNodeDraft } from "@/server/communications/flow-schemas";
import type { RowMenuAction } from "../../settings/kit";
import { adminTransition } from "../../styles";
import { ConditionCard, EntryCard, MessageCard } from "./flow-node-card";
import {
  ADD_STEP_LABEL,
  BLANK_CANVAS_HINT,
  BRANCH_END_TEXT,
  childrenOfNode,
  conditionLevel,
  conditionWaitLine,
  entryNodeOf,
  formatReportValue,
  messageCardLines,
  sidePillLabel,
  timingChipLabel,
  usesSidePills,
  type FlowStepStats,
  type NewStepKind
} from "./flows-view-model";

// O desenho do fluxo (docs/23 §2.5): uma coluna de cartoes de 320 px ligados por conectores. Cada conector
// leva a etiqueta do tempo do passo de baixo ("Logo depois", "Esperar 1 dia", "3 h antes de “X” vencer") e,
// no construtor, o "+" redondo de 44 px ("Adicionar passo aqui": Notificação ou Condição). Os caminhos Sim e
// Não ficam lado a lado (Sim a esquerda), cada um com o seu "+"; lado vazio termina com "Fim: nada mais para
// quem chega aqui.". Do 3o nivel de condicao para baixo, e sempre abaixo de 1024 px, os lados viram as
// pilulas "Sim (120) | Não (160)" e so o escolhido e desenhado. O canvas rola de lado sozinho quando os
// caminhos sao largos; a pagina nunca.

export type CanvasNumbers = {
  entry: string | null;
  steps: Record<string, FlowStepStats> | null;
};

type FlowCanvasProps = {
  draft: FlowDraft;
  /** Inserir e remover passos (construtor); sem isto, so leitura (relatorio). */
  editing: {
    onInsert: (input: { branch: FlowBranch | null; kind: NewStepKind; parentId: string }) => void;
    stepMenu: (node: FlowNodeDraft) => RowMenuAction[];
  } | null;
  entry: { countLine: string | null; modeLabel: string | null; sentence: string };
  names: AudienceNames;
  narrow: boolean;
  numbers: CanvasNumbers | null;
  onSelect: (nodeId: string) => void;
  onSideChange: (conditionId: string, side: FlowBranch) => void;
  problems: ReadonlyMap<string, { text: string; tone: "error" | "warning" }>;
  /** Menu do passo no relatorio ("Retirar do sino"). */
  reportMenu?: ((node: FlowNodeDraft) => RowMenuAction[]) | null;
  schoolIconUrl: string;
  selectedId: string | null;
  senderOf: (userId: string | null) => { avatarUrl: string | null; name: string } | null;
  sides: Readonly<Record<string, FlowBranch>>;
  titleOf: (nodeId: string) => string;
};

function Line({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block w-px bg-[var(--border-stronger)]", className)} />;
}

/**
 * Pedaco da barra que liga caminhos lado a lado (gap-6 entre as colunas): o primeiro vai do meio ate a
 * borda direita, o ultimo da borda esquerda ate o meio, os do meio de ponta a ponta. A coluna e `relative`.
 */
function SideBar({ index, total }: { index: number; total: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn("absolute top-0 h-px bg-[var(--border-stronger)]", index === 0 ? "left-1/2" : "-left-3", index === total - 1 ? "right-1/2" : "-right-3")}
    />
  );
}

function AddStepButton({ onAdd }: { onAdd: (kind: NewStepKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ADD_STEP_LABEL}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-primary)] hover:bg-[var(--surface-3)] data-popup-open:bg-[var(--surface-3)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          adminTransition
        )}
      >
        <Plus aria-hidden="true" className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-60 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0" sideOffset={6}>
        <DropdownMenuItem className="h-11 gap-2 rounded-md px-2 text-sm text-[var(--text-primary)] focus:bg-[var(--surface-2)] focus:text-[var(--text-primary)]" onClick={() => onAdd("message")}>
          <Bell aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
          Notificação
        </DropdownMenuItem>
        <DropdownMenuItem className="h-11 gap-2 rounded-md px-2 text-sm text-[var(--text-primary)] focus:bg-[var(--surface-2)] focus:text-[var(--text-primary)]" onClick={() => onAdd("condition")}>
          <Split aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
          Condição (Sim ou Não)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Conector acima de um passo: a etiqueta do tempo dele e, no construtor, o "+" para inserir antes. */
function Connector({ chip, onAdd }: { chip: string | null; onAdd: ((kind: NewStepKind) => void) | null }) {
  return (
    <div className="flex flex-col items-center">
      <Line className="h-4" />
      {onAdd ? (
        <>
          <AddStepButton onAdd={onAdd} />
          <Line className="h-3" />
        </>
      ) : null}
      {chip ? (
        <span className="max-w-[300px] rounded-full border border-[var(--border-strong)] bg-[var(--surface-1)] px-2.5 py-1 text-center text-xs leading-4 font-medium text-[var(--text-secondary)]">
          {chip}
        </span>
      ) : null}
      <Line className="h-4" />
    </div>
  );
}

/** Fim de um caminho: o "+" (construtor) e, no lado de uma condicao, "Fim: nada mais…". */
function PathEnd({ hint, onAdd, sideEnd }: { hint: string | null; onAdd: ((kind: NewStepKind) => void) | null; sideEnd: boolean }) {
  if (!onAdd && !sideEnd) {
    return null;
  }

  return (
    <div className="flex flex-col items-center">
      <Line className="h-4" />
      {onAdd ? <AddStepButton onAdd={onAdd} /> : null}
      {hint ? <p className="mt-2 max-w-[300px] text-center text-[13px] leading-5 text-[var(--text-secondary)]">{hint}</p> : null}
      {sideEnd ? <p className="mt-2 max-w-[220px] text-center text-xs leading-5 text-[var(--text-tertiary)]">{BRANCH_END_TEXT}</p> : null}
    </div>
  );
}

function SidePills({ conditionId, counts, onChange, value }: { conditionId: string; counts: { no: number | null; yes: number | null }; onChange: (side: FlowBranch) => void; value: FlowBranch }) {
  return (
    <div aria-label="Caminho da condição" className="flex items-center gap-2" id={`lados-${conditionId}`} role="group">
      {(["yes", "no"] as const).map((side) => {
        const active = side === value;

        return (
          <button
            aria-pressed={active}
            className={cn(
              "inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-[13px] font-medium tabular-nums",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              active ? "border-[var(--text-primary)] bg-[var(--surface-3)] text-[var(--text-primary)]" : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]",
              adminTransition
            )}
            key={side}
            onClick={() => onChange(side)}
            type="button"
          >
            {sidePillLabel(side, side === "yes" ? counts.yes : counts.no)}
          </button>
        );
      })}
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  const { draft, editing, names, narrow, numbers, onSelect, problems, selectedId, titleOf } = props;
  const entry = entryNodeOf(draft.nodes);
  const stepsCount = draft.nodes.length - 1;
  const insertAt = (parentId: string, branch: FlowBranch | null) => (editing ? (kind: NewStepKind) => editing.onInsert({ branch, kind, parentId }) : null);
  const statsOf = (nodeId: string) => numbers?.steps?.[nodeId] ?? null;
  const chipOf = (node: FlowNodeDraft) => (node.kind === "entry" ? null : timingChipLabel(node, titleOf));

  function numbersLine(node: FlowNodeDraft): ReactNode {
    const stats = statsOf(node.id);

    if (!numbers || !stats) {
      return null;
    }

    return node.kind === "condition"
      ? `Sim ${formatReportValue(stats.yes_count)} · Não ${formatReportValue(stats.no_count)} · Esperando ${formatReportValue(stats.waiting)}`
      : `Receberam ${formatReportValue(stats.received)} · Abriram ${formatReportValue(stats.opened)} · Esperando ${formatReportValue(stats.waiting)}`;
  }

  function menuOf(node: FlowNodeDraft) {
    return [...(editing ? editing.stepMenu(node) : []), ...(props.reportMenu ? props.reportMenu(node) : [])];
  }

  function card(node: FlowNodeDraft) {
    const shared = {
      menu: menuOf(node),
      numbers: numbersLine(node),
      onSelect: () => onSelect(node.id),
      problem: problems.get(node.id) ?? null,
      selected: selectedId === node.id,
      stepId: node.id
    };

    if (node.kind === "message") {
      const content = draft.messages[node.id];
      const lines = messageCardLines({ content, names, node, titleOf });

      return (
        <MessageCard
          {...shared}
          filterLine={lines.filter}
          icon={content?.icon ?? null}
          schoolIconUrl={props.schoolIconUrl}
          sender={props.senderOf(content?.sender?.userId ?? null)}
          title={lines.title}
          validityLine={lines.validity}
        />
      );
    }

    if (node.kind === "condition") {
      return <ConditionCard {...shared} sentence={describeAudience(node.condition, names)} waitLine={conditionWaitLine(node)} />;
    }

    return null;
  }

  function sides(node: Extract<FlowNodeDraft, { kind: "condition" }>) {
    const level = conditionLevel(draft.nodes, node.id);
    const stats = statsOf(node.id);

    if (usesSidePills({ level, narrow })) {
      const picked = props.sides[node.id] ?? "yes";

      return (
        <div className="flex w-full flex-col items-center">
          <Line className="h-4" />
          <SidePills conditionId={node.id} counts={{ no: stats?.no_count ?? null, yes: stats?.yes_count ?? null }} onChange={(side) => props.onSideChange(node.id, side)} value={picked} />
          {branch(node.id, picked, true)}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center">
        <Line className="h-4" />
        <div className="flex items-start justify-center gap-6">
          {(["yes", "no"] as const).map((side, index) => (
            <div className="relative flex min-w-[320px] flex-col items-center" key={side}>
              <SideBar index={index} total={2} />
              <Line className="h-4" />
              <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-0.5 text-xs leading-4 font-semibold text-[var(--text-primary)] tabular-nums">
                {sidePillLabel(side, side === "yes" ? (stats?.yes_count ?? null) : (stats?.no_count ?? null))}
              </span>
              {branch(node.id, side, true)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function step(node: FlowNodeDraft): ReactNode {
    return (
      <div className={cn("flex flex-col items-center", narrow && "w-full")} key={node.id}>
        {card(node)}
        {node.kind === "condition" ? sides(node) : branch(node.id, null, false)}
      </div>
    );
  }

  /** Os passos abaixo de `parentId` (de um lado, na condicao): um so em coluna; varios, lado a lado. */
  function branch(parentId: string, side: FlowBranch | null, sideEnd: boolean): ReactNode {
    const kids = childrenOfNode(draft.nodes, parentId, side);
    const add = insertAt(parentId, side);

    if (kids.length === 0) {
      const hint = editing && entry?.id === parentId && stepsCount === 0 ? BLANK_CANVAS_HINT : null;

      return <PathEnd hint={hint} onAdd={add} sideEnd={sideEnd} />;
    }

    if (kids.length === 1) {
      return (
        <div className={cn("flex flex-col items-center", narrow && "w-full")}>
          <Connector chip={chipOf(kids[0])} onAdd={add} />
          {step(kids[0])}
        </div>
      );
    }

    return (
      <div className={cn("flex flex-col items-center", narrow && "w-full")}>
        <Connector chip={null} onAdd={add} />
        <div className={cn("flex items-start justify-center gap-6", narrow && "w-full flex-col items-center gap-0")}>
          {kids.map((kid, index) => (
            <div className={cn("relative flex flex-col items-center", narrow && "w-full")} key={kid.id}>
              {narrow ? null : <SideBar index={index} total={kids.length} />}
              <Connector chip={chipOf(kid)} onAdd={null} />
              {step(kid)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!entry) {
    return null;
  }

  return (
    <div className="min-w-0 overflow-x-auto overscroll-x-contain pb-4 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]">
      <div className={cn("flex flex-col items-center", narrow ? "w-full" : "mx-auto w-max min-w-full px-2")}>
        <EntryCard
          countLine={props.entry.countLine}
          menu={[]}
          modeLabel={props.entry.modeLabel}
          numbers={numbers?.entry ?? null}
          onSelect={() => onSelect(entry.id)}
          problem={problems.get(entry.id) ?? null}
          selected={selectedId === entry.id}
          sentence={props.entry.sentence}
          stepId={entry.id}
        />
        {branch(entry.id, null, false)}
      </div>
    </div>
  );
}
