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
  type AudienceDefinition,
  type AudienceGroup,
  type AudienceNode,
  type AudienceRule,
  type AudienceRuleType
} from "@/server/communications/audience-model";
import type { NoticeSegmentOption } from "@/server/communications/queries";
import { STUDENT_PACE_LABELS, STUDENT_PACES } from "@/server/students/model";
import { PillGroup, adminInputClass, adminPillClasses } from "../form";
import { ProductPicker, type ProductPickerItem } from "../storefront/product-picker";
import { StudentAvatar } from "../students/student-avatar";
import { adminTransition } from "../styles";
import {
  AUDIENCE_RULE_LABELS,
  AUDIENCE_RULE_ORDER,
  COMMENT_WINDOW_OPTIONS,
  appendAudienceNode,
  audienceFocusAfterRemoval,
  audienceNodeKey,
  canAddAudienceRule,
  commentWindowDays,
  commentWindowValue,
  defaultAudienceRule,
  describeSampleNames,
  formatStudentCount,
  newAudienceGroup,
  removeAudienceNode,
  removeAudienceRuleLabel,
  replaceAudienceNode,
  starterAudience,
  type AudiencePath
} from "./notices-view-model";

// "Para quem" do aviso (docs/22 §3; docs/17 §1.8.2): todos os alunos ou regras combinaveis. O grupo
// principal junta as regras com "Todas as regras" (E) ou "Qualquer regra" (OU) e aceita um nivel de
// grupo dentro dele, com a propria escolha de E/OU. No maximo 20 regras (o botao explica o limite em
// vez de sumir). "Usar um segmento salvo" traz os segmentos prontos e os salvos em Alunos ja
// convertidos em regras (o que nao vira regra, como a busca por nome, aparece numa nota). A contagem
// ao vivo fica em AudienceCount (o editor pede ao servidor com 500 ms de espera). Remover uma regra ou
// um grupo leva o foco para o item anterior (ou para "Adicionar regra"), nunca para o body.

type AudienceBuilderProps = {
  cohorts: readonly { id: string; name: string }[];
  disabled: boolean;
  /** Erros por regra (chave "2" ou "1.0"); "" = o segmento inteiro. */
  errors: Record<string, string>;
  onChange: (definition: AudienceDefinition) => void;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  segments: readonly NoticeSegmentOption[];
  value: AudienceDefinition;
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
        <SelectValue className="min-w-0 truncate" />
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
  productOptions: readonly Option<string | null>[];
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
};

function productOptionsWith(base: readonly Option<string | null>[], emptyLabel: string): Option<string | null>[] {
  return [{ label: emptyLabel, value: null }, ...base.slice(1)];
}

function ProductsUnavailable() {
  return <p className="text-[13px] leading-5 text-[var(--warning)]">Não foi possível carregar a lista de produtos agora. Recarregue a página para escolher.</p>;
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
              id={`aviso-regra-${ruleKey}-produtos`}
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
      id={`aviso-regra-${key}`}
      tabIndex={-1}
    >
      <div className="flex min-w-0 items-center gap-2">
        <InlineSelect
          ariaLabel="Tipo da regra"
          className="w-full max-w-60"
          disabled={context.disabled}
          onChange={(type: AudienceRuleType) => {
            if (type !== rule.type) {
              onChange(defaultAudienceRule(type));
            }
          }}
          options={AUDIENCE_RULE_ORDER.map((type) => ({ label: AUDIENCE_RULE_LABELS[type], value: type }))}
          value={rule.type as AudienceRuleType}
        />
        <Button
          aria-label={removeAudienceRuleLabel(rule.type as AudienceRuleType)}
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

export function AudienceBuilder({ cohorts, disabled, errors, onChange, products, productsLoaded, segments, value }: AudienceBuilderProps) {
  const [note, setNote] = useState<{ text: string; tone: "info" | "warning" } | null>(null);
  // Regras guardadas ao voltar para "Todos os alunos" (voltam se escolher regras de novo).
  const rememberedRules = useRef<AudienceDefinition | null>(null);
  const productOptions: Option<string | null>[] = [
    { label: "", value: null },
    ...products.map((product) => ({ label: product.title, value: product.id }))
  ];
  const context: RuleContext = { cohorts, disabled, productOptions, products, productsLoaded };
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
      const target = focusKey === null ? addRuleButton.current : document.getElementById(`aviso-regra-${focusKey.replace(/\./g, "-")}`);
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
      <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-dashed border-[var(--border-stronger)] p-3" id={`aviso-regra-${groupKey}`} tabIndex={-1}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Grupo: atender a</span>
          <PillGroup
            ariaLabel="Como juntar as regras do grupo"
            disabled={disabled}
            name={`aviso-grupo-${groupKey}-juntar`}
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
        <PillGroup ariaLabel="Para quem" disabled={disabled} name="aviso-para-quem" onChange={changeMode} options={MODE_OPTIONS} value={value.kind} />
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
              name="aviso-regras-juntar"
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
      {topError ? <FieldError id="aviso-para-quem-error">{topError}</FieldError> : null}
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
