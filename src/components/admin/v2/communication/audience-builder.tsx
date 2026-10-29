"use client";

import { AlertCircle, Bookmark, ChevronDown, ListPlus, Plus, RotateCw, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  isAudienceGroup,
  messageRefKey,
  type AudienceDefinition,
  type AudienceGroup,
  type AudienceNode,
  type AudienceRule,
  type AudienceRuleType,
  type MessageAction
} from "@/server/communications/audience-model";
import type { NoticeSegmentOption } from "@/server/communications/queries";
import { STUDENT_PACE_LABELS, STUDENT_PACES } from "@/server/students/model";
import { PillGroup, adminInputClass, adminPillClasses } from "../form";
import { ProductPicker, type ProductPickerItem } from "../storefront/product-picker";
import { StudentAvatar } from "../students/student-avatar";
import { adminTransition } from "../styles";
import {
  ACCESS_RECENT_HINT,
  ACCESS_RECENT_PERIOD_CHOICES,
  ACCESS_RECENT_PICK_HINT,
  ACCESS_RECENT_SCOPE_CHOICES,
  AUDIENCE_RULE_LABELS,
  COMMENT_WINDOW_OPTIONS,
  FLOW_SINCE_CHOICES,
  MESSAGE_ACTION_LABELS,
  MESSAGE_RULE_SEGMENT_HINT,
  NO_FLOW_MESSAGES_MESSAGE,
  NO_SENT_NOTICES_MESSAGE,
  NO_WEBINARS_MESSAGE,
  PAGE_TARGET_CHOICES,
  WEBINAR_RULE_CHOICES,
  WEBINAR_RULE_HINT,
  accessRecentPeriodChoiceOf,
  accessRecentPeriodOfChoice,
  appendAudienceNode,
  audienceFocusAfterRemoval,
  audienceMessageOptions,
  audienceNodeKey,
  audienceRuleTypesFor,
  audienceWebinarOptions,
  canAddAudienceRule,
  commentWindowDays,
  commentWindowValue,
  defaultAudienceRule,
  describeSampleNames,
  formatStudentCount,
  messageActionsFor,
  messageChoiceOptions,
  messageChoiceProblem,
  messageRuleWithAction,
  messageRuleWithChoice,
  messageRuleWithOption,
  newAudienceGroup,
  pageButtonOptions,
  pageTargetChoiceOf,
  pageTargetOfChoice,
  removeAudienceNode,
  removeAudienceRuleLabel,
  replaceAudienceNode,
  starterAudience,
  webinarRuleChoiceOf,
  webinarRuleWithChoice,
  type AudienceBuilderMode,
  type AudienceFlowContext,
  type AudienceMessageOption,
  type AudienceNoticeChoice,
  type AudiencePath,
  type AudienceWebinarChoice
} from "./notices-view-model";

// "Para quem" do aviso (docs/22 §3; docs/17 §1.8.2): todos os alunos ou regras combinaveis. O grupo
// principal junta as regras com "Todas as regras" (E) ou "Qualquer regra" (OU) e aceita um nivel de
// grupo dentro dele, com a propria escolha de E/OU. No maximo 20 regras (o botao explica o limite em
// vez de sumir). "Usar um segmento salvo" traz os segmentos prontos e os salvos em Alunos ja
// convertidos em regras (o que nao vira regra, como a busca por nome, aparece numa nota). A contagem
// ao vivo fica em AudienceCount (o editor pede ao servidor com 500 ms de espera). Remover uma regra ou
// um grupo leva o foco para o item anterior (ou para "Adicionar regra"), nunca para o body.
//
// v2 (docs/23 §7): `mode`. No segmento ("segment") entra "O que fez com uma notificação", com o seletor
// das notificacoes enviadas nos ultimos 90 dias (`notices`); dentro de um fluxo ("flow") a regra cita um
// passo acima (`flowContext`), e entram "Visitou uma página" e "Ganhou acesso a um produto". As acoes
// oferecidas sao so as que a notificacao escolhida tem (audio, destino, resposta; v3a: reacoes e enquete,
// com o segundo seletor "com qualquer reação" / "em qualquer opção").
//
// Quem pode da live por regras (docs/22 §3, docs/30 §1.6): "Ganhou acesso recentemente" (hoje, 24 h, 48 h ou N
// horas, a qualquer produto ou a um dos escolhidos) e "Participação em lives" (participou ou garantiu vaga, numa
// live da lista `webinars` ou em qualquer uma), nos dois modos.

type AudienceBuilderProps = {
  cohorts: readonly { id: string; name: string }[];
  disabled: boolean;
  /** Erros por regra (chave "2" ou "1.0"); "" = o segmento inteiro. */
  errors: Record<string, string>;
  /** So no modo "flow": as notificacoes acima deste passo (ou o aviso de origem), de cima para baixo. */
  flowContext?: AudienceFlowContext | null;
  /** Prefixo dos ids e nomes ("aviso" no editor do aviso); unico quando ha mais de um construtor na tela. */
  idPrefix?: string;
  /** "segment" (padrao) ou "flow". */
  mode?: AudienceBuilderMode;
  /** So no modo "segment": avisos enviados nos ultimos 90 dias, mais recentes primeiro (loadAudienceNoticeOptions). */
  notices?: readonly AudienceNoticeChoice[] | null;
  onChange: (definition: AudienceDefinition) => void;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  segments: readonly NoticeSegmentOption[];
  value: AudienceDefinition;
  /**
   * Lives publicadas, as mais recentes primeiro (loadAudienceWebinarOptions): o seletor de "Participação em lives".
   * Sem a lista, so "qualquer live" (e a live ja escolhida).
   */
  webinars?: readonly AudienceWebinarChoice[] | null;
  /** Live que nao aparece no seletor (a propria live, no "Quem pode" do editor do webinário). */
  excludeWebinarId?: string | null;
};

const MODE_OPTIONS = [
  { label: "Todos os alunos", value: "everyone" },
  { label: "Escolher por regras", value: "rules" }
] as const;

const MATCH_OPTIONS = [
  { label: "Todas as regras", value: "all" },
  { label: "Qualquer regra", value: "any" }
] as const;

const LIMIT_NOTE = "Use no máximo 20 regras. Tire uma para acrescentar outra.";

const selectTriggerClass = cn(
  "h-10 min-w-0 rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-3 text-sm text-[var(--text-primary)] hover:border-[var(--text-tertiary)] data-[size=default]:h-10",
  adminTransition
);
const selectContentClass = "max-h-80 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0";
const textClass = "text-sm leading-5 text-[var(--text-secondary)]";

type Option<Value> = { label: string; value: Value };

function InlineSelect<Value extends string | null>({
  ariaLabel,
  className,
  disabled,
  id,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  onChange: (value: Value) => void;
  options: readonly Option<Value>[];
  value: Value;
}) {
  return (
    <Select disabled={disabled} items={options as Option<Value>[]} onValueChange={(next) => onChange(next as Value)} value={value}>
      <SelectTrigger aria-label={ariaLabel} className={cn(selectTriggerClass, className)} id={id}>
        {/* O valor e um flex: o "…" so aparece num span proprio (senao o texto longo e cortado no meio da letra). */}
        <SelectValue className="min-w-0">
          {(current: Value) => <span className="min-w-0 truncate">{options.find((option) => option.value === current)?.label ?? current ?? ""}</span>}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={selectContentClass}>
        {options.map((option) => (
          <SelectItem key={option.value ?? "todos"} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Numero inteiro com texto proprio (apagar para digitar outro nao vira 0 no meio). */
function NumberField({
  ariaLabel,
  disabled,
  max,
  min,
  onChange,
  value
}: {
  ariaLabel: string;
  disabled?: boolean;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  const [text, setText] = useState(String(value));
  const [synced, setSynced] = useState(value);

  if (value !== synced) {
    setSynced(value);
    setText(String(value));
  }

  return (
    <input
      aria-label={ariaLabel}
      className={cn(adminInputClass, "w-20 tabular-nums")}
      disabled={disabled}
      inputMode="numeric"
      max={max}
      min={min}
      onBlur={() => setText(String(value))}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const number = Number(raw);

        if (raw.trim() !== "" && Number.isFinite(number)) {
          const rounded = Math.round(number);
          setSynced(rounded);
          onChange(rounded);
        }
      }}
      step={1}
      type="number"
      value={text}
    />
  );
}

/** Pilulas de escolha multipla (ritmo, turma). */
function TogglePills({
  ariaLabel,
  disabled,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string[]) => void;
  options: readonly Option<string>[];
  value: readonly string[];
}) {
  return (
    <div aria-label={ariaLabel} className="flex min-w-0 flex-wrap gap-2" role="group">
      {options.map((option) => {
        const checked = value.includes(option.value);

        return (
          <button
            aria-pressed={checked}
            className={cn(adminPillClasses(checked), disabled && "cursor-not-allowed opacity-60")}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange(checked ? value.filter((item) => item !== option.value) : [...value, option.value])}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type RuleContext = {
  cohorts: readonly { id: string; name: string }[];
  disabled: boolean;
  excludeWebinarId: string | null;
  idPrefix: string;
  /** Notificacoes que as regras v2 podem citar (avisos enviados ou passos acima, conforme o modo). */
  messageOptions: readonly AudienceMessageOption[];
  mode: AudienceBuilderMode;
  productOptions: readonly Option<string | null>[];
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  webinars: readonly AudienceWebinarChoice[];
};

/**
 * Notificacao de uma regra nova: no fluxo, o passo mais perto (o ultimo acima); no segmento (ou sem
 * passo acima), o aviso enviado mais recente.
 */
function defaultMessageOption(context: Pick<RuleContext, "messageOptions" | "mode">) {
  const steps = context.messageOptions.filter((option) => option.ref.kind === "node");

  return (context.mode === "flow" ? steps[steps.length - 1] : undefined) ?? context.messageOptions.find((option) => option.ref.kind === "campaign") ?? null;
}

/** Tipos do seletor; uma regra que nao vale neste modo (colada de um fluxo) continua visivel. */
function ruleTypeOptions(mode: AudienceBuilderMode, current: AudienceRuleType): Option<AudienceRuleType>[] {
  const types = audienceRuleTypesFor(mode);

  return (types.includes(current) ? types : [...types, current]).map((type) => ({ label: AUDIENCE_RULE_LABELS[type], value: type }));
}

const DID_OPTIONS = [
  { label: "Fez", value: "did" },
  { label: "Não fez", value: "not" }
] as const;
const VISITED_OPTIONS = [
  { label: "Visitou", value: "did" },
  { label: "Não visitou", value: "not" }
] as const;
const GAINED_OPTIONS = [
  { label: "Ganhou", value: "did" },
  { label: "Não ganhou", value: "not" }
] as const;
const PICK_NOTIFICATION = "Escolha a notificação";

/**
 * Seletor de notificacao (chave "campaign:<id>"/"node:<id>"). Sem nenhuma, fica desativado com o aviso;
 * uma notificacao ja escolhida que nao esta mais na lista (mais antiga, ou removida) continua visivel.
 */
function MessagePicker({
  ariaLabel,
  context,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  context: RuleContext;
  onChange: (option: AudienceMessageOption) => void;
  options: readonly AudienceMessageOption[];
  value: string | null;
}) {
  const empty = context.mode === "flow" ? NO_FLOW_MESSAGES_MESSAGE : NO_SENT_NOTICES_MESSAGE;
  const known = value !== null && options.some((option) => option.key === value);
  const items: Option<string | null>[] =
    options.length === 0 && value === null
      ? [{ label: empty, value: null }]
      : [
          ...(value === null ? [{ label: PICK_NOTIFICATION, value: null }] : []),
          ...(value !== null && !known ? [{ label: "Notificação fora da lista", value }] : []),
          ...options.map((option) => ({ label: option.label, value: option.key }))
        ];

  return (
    <InlineSelect
      ariaLabel={ariaLabel}
      className="w-full sm:w-72"
      disabled={context.disabled || options.length === 0}
      onChange={(key) => {
        const option = options.find((item) => item.key === key);

        if (option) {
          onChange(option);
        }
      }}
      options={items}
      value={value}
    />
  );
}

/** Chave da notificacao citada, ou null enquanto nao foi escolhida (id vazio). */
function chosenKey(ref: { campaignId: string; kind: "campaign" } | { kind: "node"; nodeId: string }) {
  return (ref.kind === "node" ? ref.nodeId : ref.campaignId) ? messageRefKey(ref) : null;
}

/** "[desde que entrou no fluxo | depois de receber a notificação…] [notificação]" das regras de fluxo. */
function SinceFields({
  context,
  onChange,
  since
}: {
  context: RuleContext;
  onChange: (since: { kind: "entered" } | { kind: "message"; nodeId: string }) => void;
  since: { kind: "entered" } | { kind: "message"; nodeId: string };
}) {
  const nodeOptions = context.messageOptions.filter((option) => option.ref.kind === "node");

  return (
    <>
      <InlineSelect
        ariaLabel="Desde quando"
        className="w-full sm:w-64"
        disabled={context.disabled}
        onChange={(kind) => {
          if (kind === "entered") {
            onChange({ kind: "entered" });
          } else {
            const first = defaultMessageOption({ ...context, messageOptions: nodeOptions });
            onChange({ kind: "message", nodeId: first?.ref.kind === "node" ? first.ref.nodeId : "" });
          }
        }}
        options={FLOW_SINCE_CHOICES}
        value={since.kind}
      />
      {since.kind === "message" ? (
        <MessagePicker
          ariaLabel="Notificação recebida"
          context={context}
          onChange={(option) => option.ref.kind === "node" && onChange({ kind: "message", nodeId: option.ref.nodeId })}
          options={nodeOptions}
          value={since.nodeId ? messageRefKey({ kind: "node", nodeId: since.nodeId }) : null}
        />
      ) : null}
    </>
  );
}

function productOptionsWith(base: readonly Option<string | null>[], emptyLabel: string): Option<string | null>[] {
  return [{ label: emptyLabel, value: null }, ...base.slice(1)];
}

function ProductsUnavailable() {
  return <p className="text-[13px] leading-5 text-[var(--warning)]">Não foi possível carregar a lista de produtos agora. Recarregue a página para escolher.</p>;
}

const hintClass = "text-[13px] leading-5 text-[var(--text-secondary)]";

/**
 * "[Ganhou | Não ganhou] acesso a [qualquer produto | um destes produtos] [hoje | nas últimas 24 horas | ...]". A
 * escolha "um destes produtos" fica guardada aqui enquanto a lista ainda esta vazia (sem produto = qualquer um).
 */
function AccessRecentFields({
  context,
  onChange,
  rule,
  ruleKey
}: {
  context: RuleContext;
  onChange: (rule: AudienceRule) => void;
  rule: Extract<AudienceRule, { type: "access_recent" }>;
  ruleKey: string;
}) {
  const { disabled } = context;
  const [choosing, setChoosing] = useState(rule.productIds.length > 0);
  const scope = choosing || rule.productIds.length > 0 ? "chosen" : "any";
  // "nas últimas…" fica escolhido enquanto a equipe digita: 24 e 48 no campo nao trocam a opcao nem tiram o campo.
  const [otherHours, setOtherHours] = useState(() => accessRecentPeriodChoiceOf(rule.period) === "hours");
  const periodChoice = accessRecentPeriodChoiceOf(rule.period, otherHours);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <InlineSelect
          ariaLabel="Ganhou ou não"
          className="w-36"
          disabled={disabled}
          onChange={(value) => onChange({ ...rule, negate: value === "not" })}
          options={GAINED_OPTIONS}
          value={rule.negate ? "not" : "did"}
        />
        <span className={textClass}>acesso a</span>
        <InlineSelect
          ariaLabel="Produto do acesso"
          className="w-full sm:w-52"
          disabled={disabled}
          onChange={(value) => {
            setChoosing(value === "chosen");

            if (value === "any") {
              onChange({ ...rule, productIds: [] });
            }
          }}
          options={ACCESS_RECENT_SCOPE_CHOICES}
          value={scope}
        />
        <InlineSelect
          ariaLabel="Período"
          className="w-full sm:w-56"
          disabled={disabled}
          onChange={(choice) => {
            setOtherHours(choice === "hours");
            onChange({ ...rule, period: accessRecentPeriodOfChoice(choice, rule.period) });
          }}
          options={ACCESS_RECENT_PERIOD_CHOICES}
          value={periodChoice}
        />
        {periodChoice === "hours" && rule.period.kind === "hours" ? (
          <>
            <NumberField
              ariaLabel="Horas"
              disabled={disabled}
              max={720}
              min={1}
              onChange={(hours) => onChange({ ...rule, period: { hours, kind: "hours" } })}
              value={rule.period.hours}
            />
            <span className={textClass}>{rule.period.hours === 1 ? "hora" : "horas"}</span>
          </>
        ) : null}
      </div>
      {scope === "chosen" ? (
        context.productsLoaded ? (
          <>
            <ProductPicker
              disabled={disabled}
              emptyText="Nenhum produto ainda. Crie um em Produtos."
              id={`${context.idPrefix}-regra-${ruleKey}-produtos`}
              items={context.products}
              mode="multiple"
              onChange={(productIds) => onChange({ ...rule, productIds })}
              value={rule.productIds}
            />
            {rule.productIds.length === 0 ? <p className={hintClass}>{ACCESS_RECENT_PICK_HINT}</p> : null}
          </>
        ) : (
          <ProductsUnavailable />
        )
      ) : null}
      <p className={hintClass}>{ACCESS_RECENT_HINT}</p>
    </div>
  );
}

/** "[Participou | Não participou | Garantiu vaga | Não garantiu vaga] [qualquer live | live da lista]". */
function WebinarRuleFields({
  context,
  onChange,
  rule
}: {
  context: RuleContext;
  onChange: (rule: AudienceRule) => void;
  rule: Extract<AudienceRule, { type: "webinar" }>;
}) {
  const options = audienceWebinarOptions(context.webinars, rule.webinarId, context.excludeWebinarId);
  const empty = options.length === 1;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <InlineSelect
          ariaLabel="Participou ou garantiu vaga"
          className="w-full sm:w-48"
          disabled={context.disabled}
          onChange={(choice) => onChange(webinarRuleWithChoice(rule, choice))}
          options={WEBINAR_RULE_CHOICES}
          value={webinarRuleChoiceOf(rule)}
        />
        <InlineSelect
          ariaLabel="Live"
          className="w-full sm:w-72"
          disabled={context.disabled}
          onChange={(webinarId) => onChange({ ...rule, webinarId })}
          options={options}
          value={rule.webinarId}
        />
      </div>
      {empty ? <p className={hintClass}>{NO_WEBINARS_MESSAGE}</p> : null}
      <p className={hintClass}>{WEBINAR_RULE_HINT}</p>
    </div>
  );
}

/** Campos de cada tipo de regra, em frase ("Concluíram pelo menos 50 % das aulas de ..."). */
function RuleFields({ context, onChange, rule, ruleKey }: { context: RuleContext; onChange: (rule: AudienceRule) => void; rule: AudienceRule; ruleKey: string }) {
  const { disabled } = context;
  const daysLabel = (days: number) => (days === 1 ? "dia" : "dias");

  switch (rule.type) {
    case "product":
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <InlineSelect
            ariaLabel="Condição do produto"
            className="w-full sm:w-64"
            disabled={disabled}
            onChange={(op) => onChange({ ...rule, op })}
            options={[
              { label: "Têm acesso a", value: "has" },
              { label: "Não têm acesso a", value: "has_not" }
            ]}
            value={rule.op}
          />
          {context.productsLoaded ? (
            <ProductPicker
              disabled={disabled}
              emptyText="Nenhum produto ainda. Crie um em Produtos."
              id={`${context.idPrefix}-regra-${ruleKey}-produtos`}
              items={context.products}
              mode="multiple"
              onChange={(productIds) => onChange({ ...rule, productIds })}
              value={rule.productIds}
            />
          ) : (
            <ProductsUnavailable />
          )}
        </div>
      );
    case "progress":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={textClass}>Concluíram</span>
          <InlineSelect
            ariaLabel="Mínimo ou máximo"
            className="w-36"
            disabled={disabled}
            onChange={(op) => onChange({ ...rule, op })}
            options={[
              { label: "pelo menos", value: "gte" },
              { label: "no máximo", value: "lte" }
            ]}
            value={rule.op}
          />
          <NumberField ariaLabel="Porcentagem das aulas" disabled={disabled} max={100} min={0} onChange={(percent) => onChange({ ...rule, percent })} value={rule.percent} />
          <span className={textClass}>% das aulas de</span>
          <InlineSelect
            ariaLabel="Produto do progresso"
            className="w-full sm:w-56"
            disabled={disabled || !context.productsLoaded}
            onChange={(productId) => onChange({ ...rule, productId })}
            options={productOptionsWith(context.productOptions, "todos os produtos")}
            value={rule.productId}
          />
        </div>
      );
    case "comments":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <InlineSelect
            ariaLabel="Condição dos comentários"
            className="w-full sm:w-64"
            disabled={disabled}
            onChange={(op) => onChange({ ...rule, count: op === "top" ? Math.max(rule.count, 10) : op === "none" ? 0 : Math.max(rule.count, 1), op })}
            options={[
              { label: "Comentaram pelo menos", value: "gte" },
              { label: "Comentaram no máximo", value: "lte" },
              { label: "Não comentaram", value: "none" },
              { label: "Estão entre os que mais comentaram", value: "top" }
            ]}
            value={rule.op}
          />
          {rule.op === "none" ? null : (
            <>
              <NumberField
                ariaLabel={rule.op === "top" ? "Quantos alunos do topo" : "Quantos comentários"}
                disabled={disabled}
                max={100_000}
                min={rule.op === "lte" ? 0 : 1}
                onChange={(count) => onChange({ ...rule, count })}
                value={rule.count}
              />
              <span className={textClass}>{rule.op === "top" ? "primeiros" : rule.count === 1 ? "vez" : "vezes"}</span>
            </>
          )}
          <InlineSelect
            ariaLabel="Período dos comentários"
            className="w-48"
            disabled={disabled}
            onChange={(value) => onChange({ ...rule, days: commentWindowDays(value) })}
            options={COMMENT_WINDOW_OPTIONS}
            value={commentWindowValue(rule.days)}
          />
        </div>
      );
    case "access_age":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={textClass}>Ganharam acesso a</span>
          <InlineSelect
            ariaLabel="Produto do acesso"
            className="w-full sm:w-56"
            disabled={disabled || !context.productsLoaded}
            onChange={(productId) => onChange({ ...rule, productId })}
            options={productOptionsWith(context.productOptions, "qualquer produto")}
            value={rule.productId}
          />
          <InlineSelect
            ariaLabel="Há menos ou há mais"
            className="w-36"
            disabled={disabled}
            onChange={(op) => onChange({ ...rule, op })}
            options={[
              { label: "há menos de", value: "lt" },
              { label: "há mais de", value: "gt" }
            ]}
            value={rule.op}
          />
          <NumberField ariaLabel="Dias" disabled={disabled} max={3650} min={1} onChange={(days) => onChange({ ...rule, days })} value={rule.days} />
          <span className={textClass}>{daysLabel(rule.days)}</span>
        </div>
      );
    case "access_ending":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={textClass}>Acesso a</span>
          <InlineSelect
            ariaLabel="Produto do acesso"
            className="w-full sm:w-56"
            disabled={disabled || !context.productsLoaded}
            onChange={(productId) => onChange({ ...rule, productId })}
            options={productOptionsWith(context.productOptions, "qualquer produto")}
            value={rule.productId}
          />
          <span className={textClass}>terminando em até</span>
          <NumberField ariaLabel="Dias" disabled={disabled} max={3650} min={1} onChange={(days) => onChange({ ...rule, days })} value={rule.days} />
          <span className={textClass}>{daysLabel(rule.days)}</span>
        </div>
      );
    case "last_study":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <InlineSelect
            ariaLabel="Estudaram ou não"
            className="w-52"
            disabled={disabled}
            onChange={(op) => onChange({ ...rule, op })}
            options={[
              { label: "Estudaram nos últimos", value: "within" },
              { label: "Não estudam há", value: "not_within" }
            ]}
            value={rule.op}
          />
          <NumberField ariaLabel="Dias" disabled={disabled} max={3650} min={1} onChange={(days) => onChange({ ...rule, days })} value={rule.days} />
          <span className={textClass}>
            {daysLabel(rule.days)}
            {rule.op === "not_within" ? " (ou nunca estudaram)" : ""}
          </span>
        </div>
      );
    case "sign_in":
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <InlineSelect
            ariaLabel="Entrada na plataforma"
            className="w-52"
            disabled={disabled}
            onChange={(op) => onChange({ ...rule, op })}
            options={[
              { label: "Nunca entraram", value: "never" },
              { label: "Entraram nos últimos", value: "within" },
              { label: "Não entram há", value: "not_within" }
            ]}
            value={rule.op}
          />
          {rule.op === "never" ? null : (
            <>
              <NumberField ariaLabel="Dias" disabled={disabled} max={3650} min={1} onChange={(days) => onChange({ ...rule, days })} value={rule.days} />
              <span className={textClass}>{daysLabel(rule.days)}</span>
            </>
          )}
        </div>
      );
    case "pace":
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <span className={textClass}>Estão com ritmo</span>
          <TogglePills
            ariaLabel="Ritmos"
            disabled={disabled}
            onChange={(paces) => onChange({ ...rule, paces: STUDENT_PACES.filter((pace) => paces.includes(pace)) })}
            options={STUDENT_PACES.map((pace) => ({ label: STUDENT_PACE_LABELS[pace], value: pace }))}
            value={rule.paces}
          />
        </div>
      );
    case "cohort":
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <span className={textClass}>Estão na turma</span>
          {context.cohorts.length > 0 ? (
            <TogglePills
              ariaLabel="Turmas"
              disabled={disabled}
              onChange={(cohortIds) => onChange({ ...rule, cohortIds })}
              options={context.cohorts.map((cohort) => ({ label: cohort.name, value: cohort.id }))}
              value={rule.cohortIds}
            />
          ) : (
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Nenhuma turma criada ainda.</p>
          )}
        </div>
      );
    case "message": {
      const key = chosenKey(rule.ref);
      const chosen = context.messageOptions.find((option) => option.key === key) ?? null;
      // No segmento, so os avisos enviados; no fluxo, os passos acima (o aviso de origem tambem e um passo).
      const options = context.messageOptions.filter((option) => (context.mode === "flow" ? true : option.ref.kind === "campaign"));

      // v3a: "reagiu" e "votou na enquete" tem o segundo seletor (qualquer uma ou uma reacao / opcao).
      const choices = messageChoiceOptions(chosen, rule.action, rule.choice);
      const choiceProblem = messageChoiceProblem(chosen, rule);

      return (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <InlineSelect
              ariaLabel="Fez ou não fez"
              className="w-32"
              disabled={disabled}
              onChange={(value) => onChange({ ...rule, negate: value === "not" })}
              options={DID_OPTIONS}
              value={rule.negate ? "not" : "did"}
            />
            <InlineSelect
              ariaLabel="O que fez com a notificação"
              className="w-full sm:w-60"
              disabled={disabled}
              onChange={(action: MessageAction) => onChange(messageRuleWithAction(rule, action))}
              options={messageActionsFor(chosen, rule.action).map((action) => ({ label: MESSAGE_ACTION_LABELS[action], value: action }))}
              value={rule.action}
            />
            {choices ? (
              <InlineSelect
                ariaLabel={rule.action === "reacted" ? "Qual reação" : "Qual opção da enquete"}
                className="w-full sm:w-56"
                disabled={disabled}
                onChange={(choice: string | null) => onChange(messageRuleWithChoice(rule, choice))}
                options={choices}
                value={rule.choice ?? null}
              />
            ) : null}
            <MessagePicker
              ariaLabel="Notificação"
              context={context}
              onChange={(option) => onChange(messageRuleWithOption(rule, option))}
              options={options}
              value={key}
            />
          </div>
          {choiceProblem ? <p className="text-[13px] leading-5 text-[var(--error)]">{choiceProblem}</p> : null}
          {context.mode === "segment" ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{MESSAGE_RULE_SEGMENT_HINT}</p> : null}
        </div>
      );
    }
    case "page_visit": {
      const page = rule.page;
      const buttons = pageButtonOptions(context.messageOptions);

      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <InlineSelect
            ariaLabel="Visitou ou não"
            className="w-36"
            disabled={disabled}
            onChange={(value) => onChange({ ...rule, negate: value === "not" })}
            options={VISITED_OPTIONS}
            value={rule.negate ? "not" : "did"}
          />
          <InlineSelect
            ariaLabel="Página"
            className="w-full sm:w-72"
            disabled={disabled}
            onChange={(choice) => onChange({ ...rule, page: pageTargetOfChoice(choice, page, context.messageOptions) })}
            options={PAGE_TARGET_CHOICES}
            value={pageTargetChoiceOf(page)}
          />
          {page.kind === "content" || page.kind === "checkout" ? (
            <InlineSelect
              ariaLabel="Produto da página"
              className="w-full sm:w-56"
              disabled={disabled || !context.productsLoaded}
              onChange={(productId) => onChange({ ...rule, page: { kind: page.kind, productId: productId ?? "" } })}
              options={productOptionsWith(context.productOptions, "Escolha o produto")}
              value={page.productId || null}
            />
          ) : null}
          {page.kind === "message_cta" ? (
            <MessagePicker
              ariaLabel="Notificação que leva à página"
              context={context}
              onChange={(option) => option.ref.kind === "node" && onChange({ ...rule, page: { kind: "message_cta", nodeId: option.ref.nodeId } })}
              options={buttons}
              value={page.nodeId ? messageRefKey({ kind: "node", nodeId: page.nodeId }) : null}
            />
          ) : null}
          <SinceFields context={context} onChange={(since) => onChange({ ...rule, since })} since={rule.since} />
          {!context.productsLoaded && (page.kind === "content" || page.kind === "checkout") ? <ProductsUnavailable /> : null}
        </div>
      );
    }
    case "access_gained":
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <InlineSelect
              ariaLabel="Ganhou ou não"
              className="w-36"
              disabled={disabled}
              onChange={(value) => onChange({ ...rule, negate: value === "not" })}
              options={GAINED_OPTIONS}
              value={rule.negate ? "not" : "did"}
            />
            <span className={textClass}>acesso a</span>
          </div>
          {context.productsLoaded ? (
            <ProductPicker
              disabled={disabled}
              emptyText="Nenhum produto ainda. Crie um em Produtos."
              id={`${context.idPrefix}-regra-${ruleKey}-produtos`}
              items={context.products}
              mode="multiple"
              onChange={(productIds) => onChange({ ...rule, productIds })}
              value={rule.productIds}
            />
          ) : (
            <ProductsUnavailable />
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <SinceFields context={context} onChange={(since) => onChange({ ...rule, since })} since={rule.since} />
          </div>
        </div>
      );
    case "access_recent":
      return <AccessRecentFields context={context} onChange={onChange} rule={rule} ruleKey={ruleKey} />;
    case "webinar":
      return <WebinarRuleFields context={context} onChange={onChange} rule={rule} />;
  }
}

function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={id}>
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

function RuleRow({
  context,
  error,
  onChange,
  onRemove,
  path,
  rule
}: {
  context: RuleContext;
  error?: string;
  onChange: (rule: AudienceRule) => void;
  onRemove: () => void;
  path: AudiencePath;
  rule: AudienceRule;
}) {
  const key = audienceNodeKey(path).replace(/\./g, "-");

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-[var(--surface-1)] p-3", error ? "border-[var(--error-border)]" : "border-[var(--border-subtle)]")}
      id={`${context.idPrefix}-regra-${key}`}
      tabIndex={-1}
    >
      <div className="flex min-w-0 items-center gap-2">
        <InlineSelect
          ariaLabel="Tipo da regra"
          className="w-full max-w-60"
          disabled={context.disabled}
          onChange={(type: AudienceRuleType) => {
            if (type !== rule.type) {
              onChange(defaultAudienceRule(type, { messageRef: defaultMessageOption(context)?.ref ?? null, mode: context.mode }));
            }
          }}
          options={ruleTypeOptions(context.mode, rule.type)}
          value={rule.type}
        />
        <Button
          aria-label={removeAudienceRuleLabel(rule.type)}
          className="ml-auto size-10! px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          disabled={context.disabled}
          onClick={onRemove}
          type="button"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <RuleFields context={context} onChange={onChange} rule={rule} ruleKey={key} />
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

function Connector({ match }: { match: AudienceGroup["match"] }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-2 py-1 pl-4">
      <span className="h-3 w-px bg-[var(--border-strong)]" />
      <span className="text-[11px] leading-4 font-semibold tracking-[0.06em] text-[var(--text-tertiary)] uppercase">{match === "all" ? "e" : "ou"}</span>
    </div>
  );
}

export function AudienceBuilder({
  cohorts,
  disabled,
  errors,
  excludeWebinarId = null,
  flowContext = null,
  idPrefix = "aviso",
  mode = "segment",
  notices = null,
  onChange,
  products,
  productsLoaded,
  segments,
  value,
  webinars = null
}: AudienceBuilderProps) {
  const [note, setNote] = useState<{ text: string; tone: "info" | "warning" } | null>(null);
  // Regras guardadas ao voltar para "Todos os alunos" (voltam se escolher regras de novo).
  const rememberedRules = useRef<AudienceDefinition | null>(null);
  const productOptions: Option<string | null>[] = [
    { label: "", value: null },
    ...products.map((product) => ({ label: product.title, value: product.id }))
  ];
  const messageOptions = audienceMessageOptions(mode, { flowContext, notices });
  const context: RuleContext = {
    cohorts,
    disabled,
    excludeWebinarId,
    idPrefix,
    messageOptions,
    mode,
    productOptions,
    products,
    productsLoaded,
    webinars: webinars ?? []
  };
  const root = value.kind === "rules" ? value.root : null;
  const addRuleButton = useRef<HTMLButtonElement>(null);

  function changeRoot(next: AudienceGroup) {
    setNote(null);
    onChange({ kind: "rules", root: next });
  }

  function changeMode(mode: "everyone" | "rules") {
    setNote(null);

    if (mode === "everyone") {
      if (value.kind === "rules") {
        rememberedRules.current = value;
      }

      onChange({ kind: "everyone" });
      return;
    }

    onChange(rememberedRules.current ?? starterAudience());
  }

  function removeNode(path: AudiencePath) {
    if (!root) {
      return;
    }

    const focusKey = audienceFocusAfterRemoval(root, path);
    changeRoot(removeAudienceNode(root, path));

    // O botao de lixeira focado some com o item: o foco vai para o item anterior (o bloco tem tabIndex -1).
    window.requestAnimationFrame(() => {
      const target = focusKey === null ? addRuleButton.current : document.getElementById(`${idPrefix}-regra-${focusKey.replace(/\./g, "-")}`);
      target?.focus();
    });
  }

  function addRule(groupPath: AudiencePath) {
    if (!root) {
      return;
    }

    if (!canAddAudienceRule(value)) {
      setNote({ text: LIMIT_NOTE, tone: "warning" });
      return;
    }

    changeRoot(appendAudienceNode(root, groupPath, defaultAudienceRule("product")));
  }

  function addGroup() {
    if (!root) {
      return;
    }

    if (!canAddAudienceRule(value)) {
      setNote({ text: LIMIT_NOTE, tone: "warning" });
      return;
    }

    changeRoot(appendAudienceNode(root, [], newAudienceGroup()));
  }

  function applySegment(segment: NoticeSegmentOption) {
    onChange(structuredClone(segment.definition));
    setNote(
      segment.unsupported.length > 0
        ? {
            text: `Do segmento “${segment.label}”, ${segment.unsupported.join(" e ")} não vira regra aqui. O resto foi aplicado.`,
            tone: "warning"
          }
        : { text: `Regras do segmento “${segment.label}” aplicadas. Ajuste se quiser.`, tone: "info" }
    );
  }

  function renderNode(node: AudienceNode, path: AudiencePath) {
    if (!root) {
      return null;
    }

    if (!isAudienceGroup(node)) {
      return (
        <RuleRow
          context={context}
          error={errors[audienceNodeKey(path)]}
          onChange={(rule) => changeRoot(replaceAudienceNode(root, path, rule))}
          onRemove={() => removeNode(path)}
          path={path}
          rule={node}
        />
      );
    }

    const groupKey = audienceNodeKey(path).replace(/\./g, "-");
    const groupError = errors[audienceNodeKey(path)];

    return (
      <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-dashed border-[var(--border-stronger)] p-3" id={`${idPrefix}-regra-${groupKey}`} tabIndex={-1}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Grupo: atender a</span>
          <PillGroup
            ariaLabel="Como juntar as regras do grupo"
            disabled={disabled}
            name={`${idPrefix}-grupo-${groupKey}-juntar`}
            onChange={(match) => changeRoot(replaceAudienceNode(root, path, { ...node, match }))}
            options={MATCH_OPTIONS}
            value={node.match}
          />
          <Button
            aria-label="Remover grupo"
            className="ml-auto size-10! px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            disabled={disabled}
            onClick={() => removeNode(path)}
            title="Remover grupo"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </div>
        {node.items.map((item, index) => (
          <div className="min-w-0" key={audienceNodeKey([...path, index])}>
            {index > 0 ? <Connector match={node.match} /> : null}
            {renderNode(item, [...path, index])}
          </div>
        ))}
        {groupError ? <FieldError>{groupError}</FieldError> : null}
        <div>
          <Button className="px-3" disabled={disabled} onClick={() => addRule(path)} type="button" variant="secondary">
            <Plus aria-hidden="true" className="size-4" />
            Adicionar regra ao grupo
          </Button>
        </div>
      </div>
    );
  }

  const presets = segments.filter((segment) => segment.source === "preset");
  const saved = segments.filter((segment) => segment.source === "saved");
  const topError = errors[""];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <PillGroup ariaLabel="Para quem" disabled={disabled} name={`${idPrefix}-para-quem`} onChange={changeMode} options={MODE_OPTIONS} value={value.kind} />
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] disabled:opacity-60 data-popup-open:bg-[var(--surface-2)] data-popup-open:text-[var(--text-primary)]",
              adminTransition
            )}
            disabled={disabled}
          >
            <Bookmark aria-hidden="true" className="size-4" />
            Usar um segmento salvo
            <ChevronDown aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-96 w-72 overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0"
            sideOffset={6}
          >
            <DropdownMenuLabel className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-[var(--text-tertiary)]">Segmentos prontos</DropdownMenuLabel>
            {presets.map((segment) => (
              <DropdownMenuItem
                className="flex-col items-start gap-0 rounded-md px-2 py-1.5 text-sm text-[var(--text-primary)] focus:bg-[var(--surface-2)] focus:text-[var(--text-primary)]"
                key={segment.id}
                onClick={() => applySegment(segment)}
              >
                <span>{segment.label}</span>
                {segment.formula ? <span className="text-xs text-[var(--text-tertiary)]">{segment.formula}</span> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
            <DropdownMenuLabel className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-[var(--text-tertiary)]">Salvos em Alunos</DropdownMenuLabel>
            {saved.length > 0 ? (
              saved.map((segment) => (
                <DropdownMenuItem
                  className="rounded-md px-2 py-1.5 text-sm text-[var(--text-primary)] focus:bg-[var(--surface-2)] focus:text-[var(--text-primary)]"
                  key={segment.id}
                  onClick={() => applySegment(segment)}
                >
                  {segment.label}
                </DropdownMenuItem>
              ))
            ) : (
              <p className="px-2 py-1.5 text-[13px] leading-5 text-[var(--text-secondary)]">Nenhum segmento salvo em Alunos ainda.</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {root ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Os alunos precisam atender a</span>
            <PillGroup
              ariaLabel="Como juntar as regras"
              disabled={disabled}
              name={`${idPrefix}-regras-juntar`}
              onChange={(match) => changeRoot({ ...root, match })}
              options={MATCH_OPTIONS}
              value={root.match}
            />
          </div>

          {root.items.length > 0 ? (
            <div className="flex min-w-0 flex-col">
              {root.items.map((item, index) => (
                <div className="min-w-0" key={audienceNodeKey([index])}>
                  {index > 0 ? <Connector match={root.match} /> : null}
                  {renderNode(item, [index])}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button className="px-3" disabled={disabled} onClick={() => addRule([])} ref={addRuleButton} type="button" variant="secondary">
              <Plus aria-hidden="true" className="size-4" />
              Adicionar regra
            </Button>
            <Button className="px-3" disabled={disabled} onClick={addGroup} type="button" variant="secondary">
              <ListPlus aria-hidden="true" className="size-4" />
              Adicionar grupo
            </Button>
          </div>
        </div>
      ) : null}

      {note ? (
        <p className={cn("text-[13px] leading-5", note.tone === "warning" ? "text-[var(--warning)]" : "text-[var(--text-secondary)]")} role="status">
          {note.text}
        </p>
      ) : null}
      {topError ? <FieldError id={`${idPrefix}-para-quem-error`}>{topError}</FieldError> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Contagem ao vivo
 * ---------------------------------------------------------------------------------------------- */

export type AudienceSample = { avatarUrl: string | null; id: string; name: string };

export type AudienceCountState =
  | { status: "incomplete" }
  | { previous: { count: number; sample: AudienceSample[] } | null; status: "loading" }
  | { count: number; sample: AudienceSample[]; status: "ready" }
  | { message: string; status: "error" };

type AudienceCountProps = {
  description: string;
  /** Acima de 500 e sem permissao de publicar para muitos: avisa que vai para aprovacao. */
  needsApproval: boolean;
  onRetry: () => void;
  state: AudienceCountState;
};

export function AudienceCount({ description, needsApproval, onRetry, state }: AudienceCountProps) {
  const shown = state.status === "ready" ? state : state.status === "loading" ? state.previous : null;
  let headline: ReactNode;

  if (state.status === "incomplete") {
    headline = <span className="text-[var(--text-secondary)]">Complete as regras para ver quantos alunos.</span>;
  } else if (state.status === "error") {
    headline = <span className="text-[var(--error)]">{state.message}</span>;
  } else if (shown) {
    headline =
      shown.count === 0 ? (
        <span className="text-[var(--warning)]">Nenhum aluno está neste segmento agora.</span>
      ) : (
        <span>≈ {formatStudentCount(shown.count)} agora</span>
      );
  } else {
    headline = <span className="text-[var(--text-secondary)]">Contando alunos…</span>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <p aria-live="polite" className={cn("text-base leading-6 font-semibold text-[var(--text-primary)] tabular-nums", state.status === "loading" && shown && "opacity-60")}>
          {headline}
        </p>
        {shown && shown.sample.length > 0 ? (
          <span aria-hidden="true" className="flex -space-x-1">
            {shown.sample.map((person) => (
              <StudentAvatar avatarUrl={person.avatarUrl} className="ring-2 ring-[var(--surface-1)]" key={person.id} name={person.name} />
            ))}
          </span>
        ) : null}
        {state.status === "error" ? (
          <Button className="px-3" onClick={onRetry} type="button" variant="ghost">
            <RotateCw aria-hidden="true" className="size-4" />
            Tentar de novo
          </Button>
        ) : null}
      </div>
      {shown && shown.sample.length > 0 ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{describeSampleNames(shown.sample.map((person) => person.name), shown.count)}</p>
      ) : null}
      <p className="text-sm leading-5 text-[var(--text-primary)]">{description}</p>
      <p className="text-xs leading-5 text-[var(--text-tertiary)]">A equipe nunca entra na contagem nem recebe avisos.</p>
      {needsApproval ? (
        <p className="text-[13px] leading-5 text-[var(--warning)]">Acima de 500 alunos, um dono ou administrador precisa aprovar.</p>
      ) : null}
    </div>
  );
}
