"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { AlertCircle, Copy, CornerDownRight, Pencil, RotateCw, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NoticeTitleIcon } from "@/components/member/notifications/notice-icons";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { previewFollowUpAudience } from "@/server/communications/actions";
import type { AudienceDefinition, AudienceNames } from "@/server/communications/audience-model";
import { isDefaultSchoolIcon } from "@/server/communications/message-meta";
import type { NoticeSegmentOption } from "@/server/communications/queries";
import { adminInputClass } from "../form";
import { RowMenu } from "../settings/kit";
import type { ProductPickerItem } from "../storefront/product-picker";
import { adminTransition } from "../styles";
import { AudienceBuilder } from "./audience-builder";
import {
  FOLLOW_UPS_COPY,
  QUICK_CHOICE_COPY,
  WHEN_UNIT_OPTIONS,
  changeFollowUpAnchor,
  changeQuickChoice,
  followUpAudienceHeading,
  followUpCountCopy,
  followUpNumberRows,
  followUpSummary,
  followUpTitle,
  followUpValidityLine,
  quickChoiceNeedsProduct,
  quickChoicesFor,
  stableJson,
  whenAnchorOptions,
  whenMinutes,
  whenParts,
  whenSentence,
  whoOfItem,
  type FollowUpAnchor,
  type FollowUpCountState,
  type FollowUpFormItem,
  type FollowUpParent,
  type FollowUpStats,
  type QuickChoiceId,
  type WhenUnit
} from "./follow-ups-view-model";
import { previewSender, type AudienceFlowContext, type AudienceNoticeChoice, type NoticeSenderChoice } from "./notices-view-model";

// Uma notificacao seguinte no cartao "Depois desta notificação" (docs/23 §2.2): cabecalho com o numero e o
// resumo ("1 dia depois do envio · para quem viu no sino, mas não abriu"), a linha do conteudo (quem envia,
// icone, titulo, tempo no sino), "Quando sai" ([numero] [unidade] [depois do envio | antes de vencer], numa
// linha a partir de 640 px e em duas abaixo, cada controle com 44 px) com a frase calculada do tempo no
// sino da de cima, "Para quem" (escolhas rapidas conforme o que a de cima tem, ou o construtor de regras
// no modo fluxo) com a contagem ao vivo depois do envio, e "Editar notificação" (a folha). No relatorio,
// os numeros de cada seguinte. As seguintes desta ficam embaixo, recuadas.

/** O que o cartao usa das opcoes do editor (produtos, turmas, segmentos, avisos enviados, equipe, marca). */
export type FollowUpEditorOptions = {
  branding: { iconUrl: string; logoUrl: string | null; name: string };
  canEditBrand: boolean;
  cohorts: readonly { id: string; name: string }[];
  notices: readonly AudienceNoticeChoice[];
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  segments: readonly NoticeSegmentOption[];
  senders: readonly NoticeSenderChoice[];
};

type FollowUpCardProps = {
  /** Problema para acrescentar uma seguinte a esta (limite); null = pode. */
  addChildProblem: string | null;
  children?: ReactNode;
  /** Primeiro erro do conteudo (a folha): o botao "Editar notificação" fica marcado. */
  contentError: string | undefined;
  /** A contagem ao vivo vale aqui (relatorio, depois do envio). */
  countEnabled: boolean;
  disabled: boolean;
  /** Erros do cartao por campo ("when.minutes", "who", "content.title"...). */
  errorFor: (field: string) => string | undefined;
  /** As notificacoes de cima (a principal e, na seguinte da seguinte, a anterior), de cima para baixo. */
  flowContext: AudienceFlowContext;
  item: FollowUpFormItem;
  names: AudienceNames;
  noticeId: string | null;
  /** "1", "1.1". */
  number: string;
  onAddChild: (() => void) | null;
  onChange: (update: (item: FollowUpFormItem) => FollowUpFormItem) => void;
  onDuplicate: () => void;
  onEditContent: () => void;
  onRemove: () => void;
  onSendTest: (() => void) | null;
  options: FollowUpEditorOptions;
  parent: FollowUpParent;
  /** A notificacao de cima ja saiu para alguem (a contagem pode contar). */
  parentSent: boolean;
  /** Relatorio sem permissao, retirada ou concluida: so leitura. */
  readOnly: boolean;
  stats: FollowUpStats | null;
  testBusy: boolean;
};

const selectTriggerClass = cn(
  "h-11 w-full min-w-0 rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-3 text-sm text-[var(--text-primary)] hover:border-[var(--text-tertiary)] data-[size=default]:h-11",
  adminTransition
);
const selectContentClass = "max-h-80 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0";
const labelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";
const COUNT_DEBOUNCE_MS = 500;

type Option<Value extends string> = { label: string; value: Value };

/** Seletor do cartao (Base UI Select, 44 px). */
export function CardSelect<Value extends string>({
  ariaLabel,
  className,
  disabled,
  id,
  invalid,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  className?: string;
  disabled: boolean;
  id?: string;
  invalid?: boolean;
  onChange: (value: Value) => void;
  options: readonly Option<Value>[];
  value: Value | null;
}) {
  return (
    <Select disabled={disabled} items={options as Option<Value>[]} onValueChange={(next) => onChange(next as Value)} value={value}>
      <SelectTrigger aria-invalid={invalid || undefined} aria-label={ariaLabel} className={cn(selectTriggerClass, className)} id={id}>
        <SelectValue className="min-w-0 truncate" placeholder="Escolha" />
      </SelectTrigger>
      <SelectContent className={selectContentClass}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** O circulo de quem envia: o icone da escola (o simbolo padrao centralizado) ou a pessoa. */
function SenderCircle({ iconUrl, sender }: { iconUrl: string; sender: { avatarUrl: string | null; name: string } | null }) {
  if (sender) {
    return <MemberAvatar imageSrc={sender.avatarUrl} name={sender.name} size="xs" />;
  }

  return (
    <span aria-hidden="true" className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-[#262626] ring-1 ring-white/10">
      {/* eslint-disable-next-line @next/next/no-img-element -- icone de Marca (qualquer host), 28 px */}
      <img alt="" className={cn("size-full", isDefaultSchoolIcon(iconUrl) ? "object-contain p-1" : "object-cover")} src={iconUrl} />
    </span>
  );
}

function FieldError({ children, id }: { children: ReactNode; id: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={id}>
      <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** "Quando sai": o numero com texto proprio (apagar para digitar outro nao vira 0 no meio). */
function WhenAmount({ disabled, id, invalid, onChange, value }: { disabled: boolean; id: string; invalid: boolean; onChange: (amount: number) => void; value: number }) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  const [synced, setSynced] = useState(value);

  if (value !== synced && !(Number.isNaN(value) && Number.isNaN(synced))) {
    setSynced(value);
    setText(Number.isFinite(value) ? String(value) : "");
  }

  return (
    <input
      aria-invalid={invalid || undefined}
      aria-label="Quanto tempo"
      className={cn(adminInputClass, "h-11 tabular-nums")}
      disabled={disabled}
      id={id}
      inputMode="numeric"
      min={1}
      onChange={(event) => {
        const raw = event.target.value;
        const amount = raw.trim() === "" ? Number.NaN : Number(raw);
        setText(raw);
        setSynced(amount);
        onChange(amount);
      }}
      step={1}
      type="number"
      value={text}
    />
  );
}

/**
 * Contagem ao vivo (500 ms depois da ultima mudanca; resposta velha ignorada): quem recebeu a de cima e se
 * encaixa agora. Antes de a de cima sair, so a frase "A contagem aparece depois do envio.".
 */
function useFollowUpCount(input: { enabled: boolean; filter: AudienceDefinition; noticeId: string | null; parentNodeId: string | null; parentSent: boolean }) {
  const [state, setState] = useState<FollowUpCountState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const filterKey = stableJson(input.filter);
  const active = input.enabled && input.parentSent && input.noticeId !== null;

  useEffect(() => {
    if (!active || !input.noticeId) {
      return;
    }

    const noticeId = input.noticeId;
    const current = request.current + 1;
    request.current = current;
    const timer = window.setTimeout(() => {
      setState({ status: "loading" });

      void previewFollowUpAudience({ filter: JSON.parse(filterKey) as AudienceDefinition, noticeId, parentNodeId: input.parentNodeId })
        .then((result) => {
          if (request.current === current) {
            setState(result.ok ? { qualified: result.data.qualified, recipients: result.data.recipients, status: "ready" } : { status: "error" });
          }
        })
        .catch(() => {
          if (request.current === current) {
            setState({ status: "error" });
          }
        });
    }, COUNT_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [active, attempt, filterKey, input.noticeId, input.parentNodeId]);

  if (!input.enabled) {
    return { retry: () => undefined, state: null };
  }

  return { retry: () => setAttempt((value) => value + 1), state: active ? state : ({ status: "waiting" } as FollowUpCountState) };
}

export function FollowUpCard({
  addChildProblem,
  children,
  contentError,
  countEnabled,
  disabled,
  errorFor,
  flowContext,
  item,
  names,
  noticeId,
  number,
  onAddChild,
  onChange,
  onDuplicate,
  onEditContent,
  onRemove,
  onSendTest,
  options,
  parent,
  parentSent,
  readOnly,
  stats,
  testBusy
}: FollowUpCardProps) {
  const base = `seguinte-${item.id}`;
  const title = followUpTitle(number);
  const headingId = `${base}-titulo`;
  const parts = whenParts(item.when.minutes);
  const [unit, setUnit] = useState<WhenUnit>(parts.unit);
  const [amount, setAmount] = useState(parts.amount);
  const [syncedMinutes, setSyncedMinutes] = useState(item.when.minutes);

  // Valor trocado por fora (rascunho recarregado, duplicado): numero e unidade seguem o valor.
  if (item.when.minutes !== syncedMinutes && !(Number.isNaN(item.when.minutes) && Number.isNaN(syncedMinutes))) {
    const next = whenParts(item.when.minutes);
    setSyncedMinutes(item.when.minutes);
    setUnit(next.unit);
    setAmount(next.amount);
  }

  const choices = quickChoicesFor(parent);
  const visibleChoices: QuickChoiceId[] = choices.includes(item.choice) ? choices : [...choices.slice(0, -1), item.choice, "rules"];
  const who = whoOfItem(item, parent);
  const count = useFollowUpCount({ enabled: countEnabled, filter: who, noticeId, parentNodeId: parent.level === "main" ? null : parent.nodeId, parentSent });
  const sentence = whenSentence(item.when, parent);
  const minutesError = errorFor("when.minutes") ?? (sentence?.tone === "error" ? sentence.text : undefined);
  const whoError = errorFor("who");
  const sender = previewSender(item.content.sender, options.senders);
  const productOptions = options.products.map((product) => ({ label: product.title, value: product.id }));
  const productName = (productId: string | null) =>
    (productId ? (options.products.find((product) => product.id === productId)?.title ?? names.products[productId]) : null) ?? "um produto";

  function changeWhen(nextAmount: number, nextUnit: WhenUnit) {
    const minutes = whenMinutes(nextAmount, nextUnit);
    setAmount(nextAmount);
    setUnit(nextUnit);
    setSyncedMinutes(minutes);
    onChange((current) => ({ ...current, when: { ...current.when, minutes } }));
  }

  const menu = readOnly
    ? []
    : [
        { icon: <Copy className="size-4" />, label: FOLLOW_UPS_COPY.duplicate, onSelect: onDuplicate },
        ...(onAddChild
          ? [{ disabled: addChildProblem !== null, icon: <CornerDownRight className="size-4" />, label: FOLLOW_UPS_COPY.addChild, onSelect: onAddChild }]
          : []),
        { destructive: true, icon: <Trash2 className="size-4" />, label: FOLLOW_UPS_COPY.remove, onSelect: onRemove, separated: true }
      ];

  return (
    <article aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4" id={base}>
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]" id={headingId}>
            {title}
          </h3>
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{followUpSummary(item, parent, names)}</p>
        </div>
        <RowMenu actions={menu} label={`Ações da ${title.toLocaleLowerCase("pt-BR")}`} />
      </header>

      <div className="flex min-w-0 items-center gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2.5">
        <SenderCircle iconUrl={options.branding.iconUrl} sender={sender} />
        {/* Titulo e tempo no sino: lado a lado quando cabem; no celular o tempo desce para baixo do titulo. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className={cn("min-w-0 flex-[1_1_12rem] text-sm leading-5 font-medium", item.content.title.trim() ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]")}>
            <NoticeTitleIcon icon={item.content.icon} size="bell" />
            {item.content.title.trim() || "Sem título ainda"}
          </p>
          <span className="min-w-0 text-xs leading-5 text-[var(--text-secondary)]">{followUpValidityLine(item.content.validity, parent.level)}</span>
        </div>
      </div>
      {contentError ? <FieldError id={`${base}-conteudo-erro`}>{contentError}</FieldError> : null}

      {readOnly ? null : (
        <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
          <legend className={cn(labelClass, "mb-2")}>Quando sai</legend>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[6rem_9rem_minmax(0,1fr)]">
            <WhenAmount disabled={disabled} id={`${base}-quando-numero`} invalid={Boolean(minutesError)} onChange={(next) => changeWhen(next, unit)} value={amount} />
            <CardSelect ariaLabel="Unidade" disabled={disabled} onChange={(next: WhenUnit) => changeWhen(amount, next)} options={WHEN_UNIT_OPTIONS} value={unit} />
            <CardSelect
              ariaLabel="A partir de quando"
              className="col-span-2 sm:col-span-1"
              disabled={disabled}
              id={`${base}-quando-base`}
              onChange={(anchor: FollowUpAnchor) => onChange((current) => changeFollowUpAnchor(current, anchor))}
              options={whenAnchorOptions(parent.level)}
              value={item.when.anchor}
            />
          </div>
          {minutesError ? (
            <FieldError id={`${base}-quando-erro`}>{minutesError}</FieldError>
          ) : sentence ? (
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{sentence.text}</p>
          ) : null}
        </fieldset>
      )}

      {readOnly ? null : (
        <div className="flex min-w-0 flex-col gap-3">
          <span className={labelClass} id={`${base}-para-quem`}>
            {followUpAudienceHeading(parent.level)}
          </span>
          <RadioGroup
            aria-labelledby={`${base}-para-quem`}
            className="flex min-w-0 flex-col gap-1"
            disabled={disabled}
            onValueChange={(next: string) => onChange((current) => changeQuickChoice(current, next as QuickChoiceId, parent))}
            value={item.choice}
          >
            {visibleChoices.map((choice) => {
              const copy = QUICK_CHOICE_COPY[choice];
              const checked = item.choice === choice;
              const hintId = `${base}-escolha-${choice}-dica`;

              return (
                <div className="flex min-w-0 flex-col" key={choice}>
                  <label className={cn("flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm leading-5", checked ? "bg-[var(--surface-2)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]", adminTransition)}>
                    <Radio.Root
                      aria-describedby={checked && copy.hint ? hintId : undefined}
                      className="grid size-4 shrink-0 place-items-center rounded-full border border-[var(--border-stronger)] outline-none data-[checked]:border-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      value={choice}
                    >
                      <Radio.Indicator className="size-2 rounded-full bg-[var(--text-primary)]" />
                    </Radio.Root>
                    <span className="min-w-0">{quickChoiceNeedsProduct(choice) ? `${copy.label} ${productName(checked ? item.productId : null)}` : copy.label}</span>
                  </label>
                  {checked && copy.hint ? (
                    <p className="pb-1 pl-9 text-xs leading-5 text-[var(--text-secondary)]" id={hintId}>
                      {copy.hint}
                    </p>
                  ) : null}
                  {checked && quickChoiceNeedsProduct(choice) ? (
                    <div className="flex min-w-0 flex-col gap-1.5 pt-1 pb-2 pl-9">
                      <CardSelect
                        ariaLabel="Produto"
                        disabled={disabled || !options.productsLoaded}
                        id={`${base}-produto`}
                        invalid={Boolean(whoError) && !item.productId}
                        onChange={(productId: string) => onChange((current) => ({ ...current, productId }))}
                        options={productOptions}
                        value={item.productId}
                      />
                      {options.productsLoaded ? null : <p className="text-xs leading-5 text-[var(--text-secondary)]">Os produtos não carregaram agora. Recarregue a página.</p>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </RadioGroup>

          {item.choice === "rules" ? (
            // Um <form> e ids proprios: os grupos do construtor nao se misturam com os do aviso.
            <form className="min-w-0 rounded-lg border border-[var(--border-subtle)] p-3" noValidate onSubmit={(event) => event.preventDefault()}>
              <AudienceBuilder
                cohorts={options.cohorts}
                disabled={disabled}
                errors={whoError ? { "": whoError } : {}}
                flowContext={flowContext}
                idPrefix={`${base}-regras`}
                mode="flow"
                notices={options.notices}
                onChange={(rules) => onChange((current) => ({ ...current, rules }))}
                products={options.products}
                productsLoaded={options.productsLoaded}
                segments={options.segments}
                value={item.rules}
              />
            </form>
          ) : whoError ? (
            <FieldError id={`${base}-para-quem-erro`}>{whoError}</FieldError>
          ) : null}

          {count.state && count.state.status !== "loading" ? (
            <div aria-live="polite" className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
              <span className="tabular-nums">{followUpCountCopy(count.state)}</span>
              {count.state.status === "error" ? (
                <Button className="h-8 px-2.5" onClick={count.retry} type="button" variant="ghost">
                  <RotateCw aria-hidden="true" className="size-3.5" />
                  Tentar de novo
                </Button>
              ) : null}
            </div>
          ) : count.state ? (
            <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-tertiary)]">
              Contando…
            </p>
          ) : null}
        </div>
      )}

      {readOnly ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            aria-describedby={contentError ? `${base}-conteudo-erro` : undefined}
            className="px-3"
            disabled={disabled}
            onClick={onEditContent}
            type="button"
            variant="secondary"
          >
            <Pencil aria-hidden="true" className="size-4" />
            {FOLLOW_UPS_COPY.editContent}
          </Button>
          {onSendTest ? (
            <Button className="px-3" disabled={disabled || testBusy} onClick={onSendTest} type="button" variant="secondary">
              <Send aria-hidden="true" className="size-4" />
              {testBusy ? "Enviando teste…" : FOLLOW_UPS_COPY.sendTest}
            </Button>
          ) : null}
        </div>
      )}

      {stats ? (
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-3 text-[13px] leading-5 sm:grid-cols-3">
          {followUpNumberRows(stats, item.content).map((row) => (
            <div className={cn("flex min-w-0 flex-col", row.label === "Não receberam" && "col-span-full")} key={row.label}>
              <dt className="text-xs text-[var(--text-tertiary)]">{row.label}</dt>
              <dd className="text-[var(--text-primary)] tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children ? <div className="flex min-w-0 flex-col gap-3 border-l-2 border-[var(--border-subtle)] pl-3 sm:pl-4">{children}</div> : null}
    </article>
  );
}
