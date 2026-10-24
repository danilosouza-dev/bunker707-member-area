"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Info, Send } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EVERYONE, type AudienceDefinition, type AudienceNames } from "@/server/communications/audience-model";
import type { FlowEntryMode } from "@/server/communications/flow-model";
import type { FlowDraft, FlowNodeDraft, FlowNoticeContent } from "@/server/communications/flow-schemas";
import type { NoticeEditorOptions } from "@/server/communications/queries";
import { PillGroup, adminInputClass } from "../../form";
import { HeroTextField } from "../../member-area/home-hero/fields";
import { AdminSwitch } from "../../settings/kit";
import type { ProductPickerItem } from "../../storefront/product-picker";
import { adminTransition } from "../../styles";
import { AudienceBuilder, AudienceCount, type AudienceCountState } from "../audience-builder";
import { NoticeContentFields } from "../notice-content-fields";
import { NoticePreview } from "../notice-preview";
import type { NoticeSenderChoice } from "../notices-view-model";
import { FlowTimingField, type FlowTiming } from "./flow-timing-field";
import {
  conditionReportLines,
  DAILY_LIMIT_TEXT,
  describeNotReceived,
  ENTRY_MODE_LOCKED_MESSAGE,
  ENTRY_MODE_OPTIONS,
  FILTER_HINT,
  flowContextAbove,
  flowContextAll,
  FLOW_NAME_HINT,
  formatReportValue,
  GOAL_HINT,
  GOAL_INTRO,
  liveContentNote,
  livePollLockedFields,
  messageStepLines,
  notReceivedLines,
  ONCE_PER_FLOW_TEXT,
  PAGE_VISIT_LIVE_NOTE,
  ruleErrorsAt,
  timingAnchorsAbove,
  validityAfterTiming,
  WAIT_UNIT_OPTIONS,
  WAIT_UNTIL_HINT,
  waitMinutes,
  waitParts,
  type FlowSourceNotice,
  type FlowStepInteractionCounts,
  type FlowStepStats,
  type ReportLine,
  type WaitUnit
} from "./flows-view-model";

// Painel do construtor de fluxos (docs/23 §2.5): sem passo escolhido, a configuracao do fluxo (Nome do fluxo,
// Quem entra, Objetivo e a frase de revisao); numa Notificação, o mesmo formulario do aviso
// (NoticeContentFields com o tempo no sino), "Quando", "Só para quem…" e "Enviar teste para mim"; numa
// Condição, as regras, "Esperar até ser Sim" e "Quando". No relatorio, o painel mostra os numeros do passo.
// Cada seletor de regras fica num <form> proprio: os radios do AudienceBuilder tem o mesmo `name` e, sem o
// form, dois seletores na tela virariam um grupo so.

type MessageNode = Extract<FlowNodeDraft, { kind: "message" }>;
type ConditionNode = Extract<FlowNodeDraft, { kind: "condition" }>;

/** O que o painel precisa de toda a tela. */
export type InspectorContext = {
  disabled: boolean;
  /** Fluxo no ar (ou pausado): as notas de "vale para quem ja esta esperando". */
  live: boolean;
  names: AudienceNames;
  now: number;
  onAudioBusyChange: (reason: string | null) => void;
  onImageUploadChange: (preview: string | null) => void;
  onSendersChange: (senders: NoticeSenderChoice[]) => void;
  onTouch: (key: string) => void;
  options: NoticeEditorOptions;
  pickerItems: readonly ProductPickerItem[];
  resetKey: number;
  senders: readonly NoticeSenderChoice[];
  source: FlowSourceNotice | null;
  /** Numeros por passo (fluxo ja ativado). */
  stats: Record<string, FlowStepStats> | null;
};

function Section({ children, description, title }: { children: ReactNode; description?: ReactNode; title?: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 border-t border-[var(--border-subtle)] pt-5 first:border-t-0 first:pt-0">
      {title ? (
        <div className="min-w-0">
          <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{title}</h3>
          {description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] leading-5",
        tone === "warning" ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--text-primary)]" : "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)]"
      )}
    >
      <Info aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone === "warning" && "text-[var(--warning)]")} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Seletor de regras isolado num form (os radios do AudienceBuilder repetem o `name`). */
function RulesForm({ children, label }: { children: ReactNode; label: string }) {
  return (
    <form aria-label={label} className="flex min-w-0 flex-col gap-4" noValidate onSubmit={(event) => event.preventDefault()}>
      {children}
    </form>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Configuracao do fluxo
 * ---------------------------------------------------------------------------------------------- */

type FlowSettingsPanelProps = {
  context: InspectorContext;
  count: AudienceCountState;
  draft: FlowDraft;
  entryDescription: string;
  /** Quem entra: o jeito de entrar e as regras travados (fluxo ativado, ou fluxo de aviso). */
  entryLock: { modeLocked: boolean; note: string | null; rulesLocked: boolean };
  errors: Record<string, string>;
  goalFix: { message: string; onApply: (() => void) | null } | null;
  needsApproval: boolean;
  onChange: (patch: Partial<Pick<FlowDraft, "entry" | "goal" | "name">>) => void;
  onRetryCount: () => void;
  review: string;
  /** Fluxo de aviso: "Recebeu a notificação “X”" e o link para ela. */
  sourceHref: string | null;
  sourceTitle: string | null;
};

export function FlowSettingsPanel({
  context,
  count,
  draft,
  entryDescription,
  entryLock,
  errors,
  goalFix,
  needsApproval,
  onChange,
  onRetryCount,
  review,
  sourceHref,
  sourceTitle
}: FlowSettingsPanelProps) {
  const { disabled, options } = context;
  const notice = draft.origin === "notice";

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p aria-live="polite" className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-sm leading-6 text-[var(--text-primary)]">
        {review}
      </p>

      {/* Sem titulo de secao: o rotulo do campo ja diz "Nome do fluxo" (o titulo repetia a mesma frase logo acima). */}
      <Section>
        <HeroTextField
          disabled={disabled}
          error={errors.name}
          hint={FLOW_NAME_HINT}
          id="fluxo-nome"
          label="Nome do fluxo"
          max={80}
          onBlur={() => context.onTouch("name")}
          onChange={(name) => onChange({ name })}
          value={draft.name}
        />
      </Section>

      <Section title="Quem entra">
        {notice ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm leading-5 text-[var(--text-primary)]">{`Recebeu a notificação “${sourceTitle ?? "Sem título"}”`}</p>
            {sourceHref ? (
              <Link className="w-fit text-[13px] font-medium text-[var(--text-primary)] underline underline-offset-2" href={sourceHref}>
                Abrir a notificação
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <RulesForm label="Regras de quem entra">
              <AudienceBuilder
                cohorts={options.cohorts}
                disabled={disabled || entryLock.rulesLocked}
                errors={ruleErrorsAt(errors, "entry.audience")}
                idPrefix="fluxo-quem-entra"
                notices={options.notices}
                onChange={(audience) => onChange({ entry: { ...draft.entry, audience } })}
                products={context.pickerItems}
                productsLoaded={options.productsLoaded}
                segments={options.segments}
                value={draft.entry.audience}
              />
            </RulesForm>
            <AudienceCount description={entryDescription} needsApproval={needsApproval} onRetry={onRetryCount} state={count} />
            {entryLock.note ? <Note>{entryLock.note}</Note> : null}
            <EntryModeField disabled={disabled || entryLock.modeLocked} locked={entryLock.modeLocked} onChange={(mode) => onChange({ entry: { ...draft.entry, mode } })} value={draft.entry.mode} />
          </>
        )}
        <p className="text-xs leading-5 text-[var(--text-secondary)]">{ONCE_PER_FLOW_TEXT}</p>
        <p className="text-xs leading-5 text-[var(--text-tertiary)]">{DAILY_LIMIT_TEXT}</p>
      </Section>

      <Section description={GOAL_INTRO} title="Objetivo (opcional)">
        <RulesForm label="Regras do objetivo">
          <AudienceBuilder
            cohorts={options.cohorts}
            disabled={disabled}
            errors={ruleErrorsAt(errors, "goal")}
            flowContext={flowContextAll(draft, context.source)}
            idPrefix="fluxo-objetivo"
            mode="flow"
            onChange={(goal) => onChange({ goal: goal.kind === "everyone" ? null : goal })}
            products={context.pickerItems}
            productsLoaded={options.productsLoaded}
            segments={options.segments}
            value={draft.goal ?? EVERYONE}
          />
        </RulesForm>
        <p className="text-xs leading-5 text-[var(--text-secondary)]">{GOAL_HINT}</p>
        {goalFix ? (
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2.5">
            <p className="text-[13px] leading-5 text-[var(--text-primary)]">{goalFix.message}</p>
            {goalFix.onApply ? (
              <Button className="w-fit px-3" disabled={disabled} onClick={goalFix.onApply} type="button" variant="secondary">
                Adicionar
              </Button>
            ) : null}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/** O jeito de entrar: tres opcoes com a ajuda de cada uma (Base UI RadioGroup, setas do teclado). */
function EntryModeField({ disabled, locked, onChange, value }: { disabled: boolean; locked: boolean; onChange: (mode: FlowEntryMode) => void; value: FlowEntryMode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id="fluxo-modo-label">
        Quem entra no fluxo
      </span>
      <RadioGroup
        aria-labelledby="fluxo-modo-label"
        className="flex min-w-0 flex-col gap-2"
        disabled={disabled}
        onValueChange={(next: string) => {
          const option = ENTRY_MODE_OPTIONS.find((item) => item.value === next);

          if (option) {
            onChange(option.value);
          }
        }}
        value={value}
      >
        {ENTRY_MODE_OPTIONS.map((option) => {
          const checked = option.value === value;

          return (
            <Radio.Root
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left outline-none",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60",
                checked ? "border-[var(--text-primary)] bg-[var(--surface-3)]" : "border-[var(--border-strong)] hover:bg-[var(--hover-overlay)]",
                adminTransition
              )}
              key={option.value}
              value={option.value}
            >
              <span
                aria-hidden="true"
                className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", checked ? "border-[var(--text-primary)]" : "border-[var(--border-stronger)]")}
              >
                {checked ? <span className="size-2 rounded-full bg-[var(--text-primary)]" /> : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm leading-5 font-medium text-[var(--text-primary)]">{option.label}</span>
                <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{option.help}</span>
              </span>
            </Radio.Root>
          );
        })}
      </RadioGroup>
      {locked ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{ENTRY_MODE_LOCKED_MESSAGE}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Notificacao
 * ---------------------------------------------------------------------------------------------- */

type MessageInspectorProps = {
  content: FlowNoticeContent;
  context: InspectorContext;
  draft: FlowDraft;
  errors: { content: Record<string, string>; node: Record<string, string> };
  /** Recorte da imagem subindo (a previa mostra antes do envio terminar). */
  imagePreview: string | null;
  /** Alunos esperando este passo (fluxo no ar): a referencia de tempo nao muda. */
  locked: boolean;
  node: MessageNode;
  onChange: (input: { content?: FlowNoticeContent; node?: MessageNode }) => void;
  onTest: (() => void) | null;
  testBusy: boolean;
  titleOf: (nodeId: string) => string;
  /** A regra "visitou" cita uma pagina que nenhum fluxo no ar acompanha ainda. */
  watchesNewPage: boolean;
};

export function MessageInspector({ content, context, draft, errors, imagePreview, locked, node, onChange, onTest, testBusy, titleOf, watchesNewPage }: MessageInspectorProps) {
  const { disabled, options } = context;
  const idPrefix = `passo-${node.id.slice(0, 8)}`;
  const above = timingAnchorsAbove(draft, node.id, context.source);
  const received = context.stats?.[node.id]?.received ?? 0;
  const liveNote = context.live ? liveContentNote(received) : null;

  function changeTiming(timing: FlowTiming) {
    onChange({ content: { ...content, validity: validityAfterTiming(content.validity, timing.anchor) }, node: { ...node, ...timing } });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {liveNote ? <Note>{liveNote}</Note> : null}
      <NoticeContentFields
        canEditBrand={options.canEditBrand}
        disabled={disabled}
        errorFor={(key) => errors.content[key]}
        idPrefix={idPrefix}
        kind="inbox"
        layout="plain"
        // Ajustes da v3a: no ar, a enquete de um passo que ja chegou a alguem nao muda (o servidor recusa igual).
        lockedFields={livePollLockedFields({ live: context.live, received })}
        onAudioBusyChange={context.onAudioBusyChange}
        onBlurField={(key) => context.onTouch(`messages.${node.id}.${key}`)}
        onChange={(patch) => onChange({ content: { ...content, ...patch } as FlowNoticeContent })}
        onImageUploadChange={context.onImageUploadChange}
        onSendersChange={context.onSendersChange}
        // v3a: a enquete de um passo so encerra quando a notificacao sai do sino (docs/24 T13).
        pollCanEndAtDate={false}
        products={context.pickerItems}
        productsLoaded={options.productsLoaded}
        resetKey={context.resetKey}
        savedSender={null}
        schoolIconUrl={options.branding.iconUrl}
        schoolName={options.branding.name}
        sendAt={context.now}
        senders={context.senders}
        showValidity
        validityAnchor={node.anchor !== "previous" && node.anchorNodeId ? { label: `Até “${titleOf(node.anchorNodeId)}” sumir` } : undefined}
        value={content}
      />

      <Section title="Quando">
        <FlowTimingField
          above={above}
          disabled={disabled}
          errors={{ anchorNodeId: errors.node.anchorNodeId, offsetMinutes: errors.node.offsetMinutes }}
          idPrefix={`${idPrefix}-quando`}
          live={context.live}
          locked={locked}
          onChange={changeTiming}
          showLabel={false}
          value={{ anchor: node.anchor, anchorNodeId: node.anchorNodeId, offsetMinutes: node.offsetMinutes }}
        />
      </Section>

      <Section description={FILTER_HINT} title="Só para quem… (opcional)">
        <RulesForm label="Só para quem">
          <AudienceBuilder
            cohorts={options.cohorts}
            disabled={disabled}
            errors={ruleErrorsAt(errors.node, "filter")}
            flowContext={flowContextAbove(draft, node.id, context.source)}
            idPrefix={`${idPrefix}-filtro`}
            mode="flow"
            onChange={(filter) => onChange({ node: { ...node, filter: filter.kind === "everyone" ? null : filter } })}
            products={context.pickerItems}
            productsLoaded={options.productsLoaded}
            segments={options.segments}
            value={node.filter ?? EVERYONE}
          />
        </RulesForm>
        {watchesNewPage && context.live ? <Note>{PAGE_VISIT_LIVE_NOTE}</Note> : null}
      </Section>

      <Section title="Prévia">
        <NoticePreview anchorExpiresAt={null} branding={options.branding} device="mobile" draft={{ ...content, kind: "inbox" }} imageUrl={imagePreview} now={context.now} senders={context.senders} />
        {onTest ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <Button className="w-fit px-4" disabled={disabled || testBusy} onClick={onTest} type="button" variant="secondary">
              <Send aria-hidden="true" className="size-4" />
              {testBusy ? "Enviando teste…" : "Enviar teste para mim"}
            </Button>
            <p className="text-xs leading-5 text-[var(--text-tertiary)]">
              {context.live ? "O teste usa a versão no ar e chega só no seu sino." : "O teste chega só no seu sino e não conta nos números."}
            </p>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Condicao
 * ---------------------------------------------------------------------------------------------- */

type ConditionInspectorProps = {
  context: InspectorContext;
  draft: FlowDraft;
  errors: Record<string, string>;
  locked: boolean;
  node: ConditionNode;
  onChange: (node: ConditionNode) => void;
  watchesNewPage: boolean;
};

const DEFAULT_MAX_WAIT = 2 * 1_440;

export function ConditionInspector({ context, draft, errors, locked, node, onChange, watchesNewPage }: ConditionInspectorProps) {
  const { disabled, options } = context;
  const idPrefix = `passo-${node.id.slice(0, 8)}`;
  const wait = waitParts(node.maxWaitMinutes ?? DEFAULT_MAX_WAIT);
  const [unit, setUnit] = useState<WaitUnit>(wait.unit);
  const [amountText, setAmountText] = useState(String(wait.amount));

  function changeWait(text: string, nextUnit: WaitUnit) {
    setAmountText(text);
    setUnit(nextUnit);
    onChange({ ...node, maxWaitMinutes: waitMinutes(text.trim() === "" ? Number.NaN : Number(text), nextUnit) });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Section title="Regras">
        <RulesForm label="Regras da condição">
          <AudienceBuilder
            cohorts={options.cohorts}
            disabled={disabled}
            errors={ruleErrorsAt(errors, "condition")}
            flowContext={flowContextAbove(draft, node.id, context.source)}
            idPrefix={`${idPrefix}-condicao`}
            mode="flow"
            onChange={(condition: AudienceDefinition) => onChange({ ...node, condition })}
            products={context.pickerItems}
            productsLoaded={options.productsLoaded}
            segments={options.segments}
            value={node.condition}
          />
        </RulesForm>
        {errors.condition ? <p className="text-[13px] leading-5 text-[var(--error)]">{errors.condition}</p> : null}
        {watchesNewPage && context.live ? <Note>{PAGE_VISIT_LIVE_NOTE}</Note> : null}
      </Section>

      <Section>
        <AdminSwitch
          checked={node.waitUntilTrue}
          description={node.waitUntilTrue ? WAIT_UNTIL_HINT : "Sem esperar, a condição confere uma vez e segue pelo Sim ou pelo Não."}
          disabled={disabled}
          id={`${idPrefix}-esperar`}
          label="Esperar até ser Sim"
          onCheckedChange={(checked) => onChange({ ...node, maxWaitMinutes: checked ? (node.maxWaitMinutes ?? waitMinutes(Number(amountText), unit)) : null, waitUntilTrue: checked })}
        />
        {node.waitUntilTrue ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${idPrefix}-espera-label`}>
              por no máximo
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <input
                aria-invalid={errors.maxWaitMinutes ? true : undefined}
                aria-labelledby={`${idPrefix}-espera-label`}
                className={cn(adminInputClass, "w-24 tabular-nums pointer-coarse:h-11")}
                disabled={disabled}
                id={`${idPrefix}-espera-numero`}
                inputMode="numeric"
                min={1}
                onChange={(event) => changeWait(event.target.value, unit)}
                type="number"
                value={amountText}
              />
              <PillGroup ariaLabel="Unidade da espera" disabled={disabled} name={`${idPrefix}-espera-unidade`} onChange={(next) => changeWait(amountText, next)} options={WAIT_UNIT_OPTIONS} value={unit} />
            </div>
            {errors.maxWaitMinutes ? <p className="text-[13px] leading-5 text-[var(--error)]">{errors.maxWaitMinutes}</p> : null}
          </div>
        ) : null}
      </Section>

      <Section title="Quando">
        <FlowTimingField
          above={timingAnchorsAbove(draft, node.id, context.source)}
          disabled={disabled}
          errors={{ anchorNodeId: errors.anchorNodeId, offsetMinutes: errors.offsetMinutes }}
          idPrefix={`${idPrefix}-quando`}
          live={context.live}
          locked={locked}
          onChange={(timing) => onChange({ ...node, ...timing })}
          showLabel={false}
          value={{ anchor: node.anchor, anchorNodeId: node.anchorNodeId, offsetMinutes: node.offsetMinutes }}
        />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Relatorio: os numeros do passo escolhido
 * ---------------------------------------------------------------------------------------------- */

function Lines({ lines }: { lines: readonly ReportLine[] }) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3">
      {lines.map((line) => (
        <div className="flex min-w-0 flex-col gap-0.5" key={line.id}>
          <dt className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{line.label}</dt>
          <dd className="text-base leading-6 font-semibold text-[var(--text-primary)] tabular-nums">
            {formatReportValue(line.value)}
            {line.share ? <span className="ml-1.5 text-xs font-medium text-[var(--text-secondary)]">{line.share}</span> : null}
          </dd>
          {line.help ? <dd className="text-xs leading-4 text-[var(--text-secondary)]">{line.help}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

type StepNumbersProps = {
  content: FlowNoticeContent | null;
  context: Pick<InspectorContext, "now" | "options" | "senders">;
  /** v3a: reacoes e votos do passo (Reagiram, Votaram e as opcoes da enquete). */
  interactions?: FlowStepInteractionCounts | null;
  kind: "condition" | "message";
  stats: FlowStepStats | null;
  withdraw: (() => void) | null;
};

/** O passo no relatorio: os numeros (com a parte do anterior), por que alguns nao receberam e a previa. */
export function StepNumbers({ content, context, interactions = null, kind, stats, withdraw }: StepNumbersProps) {
  if (kind === "condition") {
    return <Lines lines={conditionReportLines(stats)} />;
  }

  const notReceived = notReceivedLines(stats);
  const reasons = describeNotReceived(notReceived.parts);
  const capHelp = notReceived.parts.find((part) => part.id === "cap" && part.value > 0)?.help ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Lines lines={messageStepLines(stats, content, interactions)} />
      <div className="flex min-w-0 flex-col gap-1 border-t border-[var(--border-subtle)] pt-4 text-[13px] leading-5">
        <p className="font-medium text-[var(--text-primary)] tabular-nums">Não receberam {formatReportValue(notReceived.total)}</p>
        {reasons ? <p className="text-[var(--text-secondary)] tabular-nums">{reasons}</p> : null}
        {capHelp ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{capHelp}</p> : null}
        {notReceived.deferred ? <p className="text-[var(--text-secondary)] tabular-nums">Adiadas agora pelo limite do dia {formatReportValue(notReceived.deferred)}</p> : null}
      </div>
      {content ? (
        <NoticePreview branding={context.options.branding} device="mobile" draft={{ ...content, kind: "inbox" }} now={context.now} senders={context.senders} />
      ) : null}
      {withdraw ? (
        <Button className="w-fit px-4" onClick={withdraw} type="button" variant="secondary">
          Retirar do sino
        </Button>
      ) : null}
    </div>
  );
}
