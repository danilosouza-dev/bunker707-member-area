"use client";

import { ExternalLink, Info, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import { saveNoticeFollowUps } from "@/server/communications/actions";
import { describeAudience, type AudienceNames } from "@/server/communications/audience-model";
import { saveNoticeFollowUpsSchema } from "@/server/communications/flow-schemas";
import type { NoticeDetail, NoticeEditorOptions } from "@/server/communications/queries";
import { pageKeyOfHref } from "@/server/member-area/page-visit-model";
import { ErrorBanner } from "../error-banner";
import { AdminLinkButton } from "../link-button";
import { ConfirmDialog, SectionCard } from "../settings/kit";
import type { ProductPickerItem } from "../storefront/product-picker";
import { adminToast } from "../toast";
import { CardSelect, FollowUpCard, type FollowUpEditorOptions } from "./follow-up-card";
import { FollowUpSheet } from "./follow-up-sheet";
import { livePollLockedFields } from "./flows/flows-view-model";
import {
  FOLLOW_UPS_COPY,
  FOLLOW_UPS_SECTION_TITLE,
  addFollowUpProblem,
  appendFollowUp,
  canNestFollowUp,
  duplicateFollowUp,
  findFollowUp,
  followUpAudienceNames,
  followUpChoiceErrors,
  followUpErrorAt,
  followUpFormItemsOf,
  followUpNumbers,
  followUpParentOf,
  followUpPaths,
  followUpPreviewAnchorExpiry,
  followUpsStateKey,
  followUpsToSave,
  followUpTitle,
  followUpTreeErrors,
  goalOfStopLine,
  hasSomethingToOpen,
  initialStopLine,
  newFollowUpItem,
  noticeFlowHref,
  parentOfItem,
  removeFollowUp,
  removeFollowUpConfirm,
  stopLineHint,
  stopLineOfGoal,
  updateFollowUp,
  type FollowUpFormItem,
  type FollowUpParent,
  type FollowUpsMode,
  type FollowUpStats,
  type FollowUpStopLine
} from "./follow-ups-view-model";
import { noticeErrorsFrom, noticeErrorsFromAction, type AudienceFlowMessageChoice, type NoticeSenderChoice } from "./notices-view-model";

// Cartao "Depois desta notificação" do editor de avisos e secao "Notificações seguintes" do relatorio
// (docs/23 §2.2): a linha "Parar as notificações seguintes para quem tiver acesso a [produto]", os cartoes
// de cada seguinte (FollowUpCard, com as seguintes delas recuadas), "Adicionar notificação seguinte", os
// limites fixos em texto, a folha do conteudo (FollowUpSheet) e a confirmacao de remover. Quem guarda o
// estado e grava e o editor (Salvar rascunho) ou o relatorio (Aplicar alterações): aqui so as mudancas.
// Quando o construtor mudou o fluxo para algo que o cartao nao desenha, ficam as frases e "Editar no fluxo".

type NoticeFollowUpsProps = {
  /** Acoes do cabecalho do cartao ("Ver como fluxo"). */
  actions?: ReactNode;
  /** false: a folha de cada seguinte sem "Até uma data" no tempo no sino (modo modelo, docs/28 §5.6). */
  allowUntil?: boolean;
  /** Antes dos cartoes (o aviso do relatorio no ar). */
  banner?: ReactNode;
  /** Primeiro erro do conteudo de uma seguinte ("followUps.0" -> "Escreva um título."). */
  contentErrorOf: (path: string) => string | undefined;
  description?: string;
  disabled: boolean;
  /** Erro de um campo pelo caminho do zod ("followUps.0.when.minutes", "goal.productId"), ou o primeiro de dentro dele. */
  errorFor: (path: string) => string | undefined;
  /** So o erro do proprio campo (os campos da folha; o grupo "Fica no sino por" nao repete o do numero). */
  fieldErrorFor: (path: string) => string | undefined;
  flowId: string | null;
  /** O fluxo esta no ar ou pausado ("Editar no fluxo" abre o editor em etapas). */
  flowLive: boolean;
  /** Depois dos cartoes (a barra "Alterações não aplicadas" do relatorio). */
  footer?: ReactNode;
  /** Prefixo dos ids ("aviso-seguintes"). */
  id: string;
  items: readonly FollowUpFormItem[];
  /** Frases dos passos quando so o construtor desenha. */
  lines: readonly string[];
  /** A notificacao principal (o aviso) como notificacao de cima. */
  main: FollowUpParent;
  /** A principal ja saiu (a contagem ao vivo conta). */
  mainSent: boolean;
  mode: FollowUpsMode;
  names: AudienceNames;
  noticeCtaHref: string | null;
  noticeId: string | null;
  now: number;
  onAudioBusyChange?: (reason: string | null) => void;
  onChange: (next: { items: FollowUpFormItem[]; stop: FollowUpStopLine }) => void;
  onImageUploadChange?: (preview: string | null) => void;
  onSendersChange?: (senders: NoticeSenderChoice[]) => void;
  /** "Enviar teste para mim" de uma seguinte (no editor; grava antes). */
  onSendTest?: (id: string) => void;
  options: FollowUpEditorOptions;
  stats: Readonly<Record<string, FollowUpStats>>;
  stop: FollowUpStopLine;
  testBusyId: string | null;
  title: string;
};

/** A notificacao de cima como opcao das regras "O que fez com uma notificação" das seguintes de baixo. */
function flowMessageOf(parent: FollowUpParent): AudienceFlowMessageChoice {
  return {
    allowsReactions: parent.allowsReactions,
    canOpen: hasSomethingToOpen(parent),
    ctaPageKey: pageKeyOfHref(parent.ctaHref),
    hasAudio: parent.hasAudio,
    hasCta: Boolean(parent.ctaHref),
    hasPoll: parent.hasPoll,
    hasResponse: parent.hasResponse,
    nodeId: parent.nodeId,
    pollOptions: parent.pollOptions,
    title: parent.title
  };
}

export function NoticeFollowUps({
  actions,
  allowUntil = true,
  banner,
  contentErrorOf,
  description = FOLLOW_UPS_COPY.description,
  disabled,
  errorFor,
  fieldErrorFor,
  flowId,
  flowLive,
  footer,
  id,
  items,
  lines,
  main,
  mainSent,
  mode,
  names,
  noticeCtaHref,
  noticeId,
  now,
  onAudioBusyChange,
  onChange,
  onImageUploadChange,
  onSendersChange,
  onSendTest,
  options,
  stats,
  stop,
  testBusyId,
  title
}: NoticeFollowUpsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const readOnly = mode.kind === "readonly";
  const builderOnly = mode.kind === "readonly" && mode.reason === "builder";
  const live = mode.kind === "live";
  const numbers = followUpNumbers(items);
  const paths = followUpPaths(items);
  const rootProblem = addFollowUpProblem([...items], null);
  const editing = editingId ? findFollowUp([...items], editingId) : null;
  const removing = removingId ? findFollowUp([...items], removingId) : null;
  // v3a: as opcoes das enquetes nas frases das regras ("votaram em “Sábado” na enquete …").
  const cardNames = useMemo(() => followUpAudienceNames(names, main, items), [items, main, names]);

  function change(nextItems: FollowUpFormItem[], nextStop: FollowUpStopLine = stop) {
    onChange({ items: nextItems, stop: nextStop });
  }

  function add(parentId: string | null) {
    const location = parentId ? findFollowUp([...items], parentId) : null;
    const parent = location ? followUpParentOf(location.item.id, "previous", location.item.content) : main;
    const item = newFollowUpItem(crypto.randomUUID(), parent);
    // A primeira seguinte marca a linha de parar com o produto do destino do aviso (quando abre um produto).
    const nextStop = items.length === 0 && stop.kind === "product" && !stop.enabled && !stop.productId ? initialStopLine(noticeCtaHref) : stop;

    change(appendFollowUp([...items], parentId, item), nextStop);
    setEditingId(item.id);
  }

  function update(itemId: string, next: (item: FollowUpFormItem) => FollowUpFormItem) {
    change(updateFollowUp([...items], itemId, next));
  }

  function renderItems(list: readonly FollowUpFormItem[], parent: FollowUpParent, parentItem: FollowUpFormItem | null, depth: number, ancestors: AudienceFlowMessageChoice[]): ReactNode {
    return list.map((item) => {
      const path = paths.get(item.id) ?? "followUps";
      const number = numbers.get(item.id) ?? "";
      const nested = followUpParentOf(item.id, "previous", item.content);
      const parentSent = parentItem ? parentItem.campaignId !== "" && (stats[parentItem.id]?.received ?? 0) > 0 : mainSent;

      return (
        <FollowUpCard
          addChildProblem={addFollowUpProblem([...items], item.id)}
          contentError={contentErrorOf(path)}
          countEnabled={!readOnly}
          disabled={disabled}
          errorFor={(field) => errorFor(`${path}.${field}`)}
          flowContext={{ messages: ancestors }}
          item={item}
          key={item.id}
          names={cardNames}
          noticeId={noticeId}
          number={number}
          onAddChild={canNestFollowUp(depth) ? () => add(item.id) : null}
          onChange={(next) => update(item.id, next)}
          onDuplicate={() => change(duplicateFollowUp([...items], item.id, () => crypto.randomUUID()).items)}
          onEditContent={() => setEditingId(item.id)}
          onRemove={() => setRemovingId(item.id)}
          onSendTest={onSendTest && !live ? () => onSendTest(item.id) : null}
          options={options}
          parent={parent}
          parentSent={parentSent}
          readOnly={readOnly}
          stats={mode.kind === "edit" ? null : (stats[item.id] ?? null)}
          testBusy={testBusyId === item.id}
        >
          {item.children.length > 0 ? renderItems(item.children, nested, item, depth + 1, [...ancestors, flowMessageOf(nested)]) : null}
        </FollowUpCard>
      );
    });
  }

  const removeCopy = removing
    ? removeFollowUpConfirm({ live, title: removing.item.content.title, waiting: live ? (stats[removing.item.id]?.waiting ?? 0) : 0 })
    : null;
  const editingParent = editing ? parentOfItem(editing, main) : null;
  const productOptions = options.products.map((product) => ({ label: product.title, value: product.id }));
  const stopProductName = stop.kind === "product" && stop.productId ? (options.products.find((product) => product.id === stop.productId)?.title ?? names.products[stop.productId] ?? null) : null;
  const stopError = errorFor("goal.productId") ?? errorFor("goal");

  return (
    <SectionCard actions={actions} description={description} title={title}>
      <div className="flex min-w-0 flex-col gap-4" id={id} tabIndex={-1}>
        {banner}

        {builderOnly ? (
          <div className="flex min-w-0 flex-col gap-3">
            {lines.length > 0 ? (
              <ul className="flex min-w-0 list-disc flex-col gap-1 pl-5 text-sm leading-5 text-[var(--text-primary)]">
                {lines.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            ) : null}
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{FOLLOW_UPS_COPY.builderOnly}</p>
            {flowId ? (
              <div>
                <AdminLinkButton href={noticeFlowHref(flowId, { edit: flowLive })} variant="secondary">
                  {FOLLOW_UPS_COPY.editInFlow}
                </AdminLinkButton>
              </div>
            ) : null}
          </div>
        ) : null}

        {!builderOnly && mode.kind === "readonly" && mode.note ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{mode.note}</p> : null}

        {!builderOnly && items.length > 0 ? (
          stop.kind === "other" ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5">
              <span className="text-[var(--text-primary)]">{`Param para quem: ${describeAudience(stop.goal, names).replace(/^Alunos/, "alunos")}`}</span>
              {flowId ? (
                <AdminLinkButton className="h-9 px-3" href={noticeFlowHref(flowId, { edit: flowLive })} variant="secondary">
                  {FOLLOW_UPS_COPY.editInFlow}
                </AdminLinkButton>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5" id={`${id}-parar`}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <label className={cn("flex min-h-11 items-center gap-2.5 text-sm leading-5 text-[var(--text-primary)]", !readOnly && !disabled && "cursor-pointer")}>
                  <Checkbox
                    checked={stop.enabled}
                    className="size-[18px] rounded border-[var(--border-stronger)] data-checked:border-[var(--text-primary)] data-checked:bg-[var(--text-primary)] data-checked:text-[var(--surface-1)]"
                    disabled={disabled || readOnly}
                    onCheckedChange={(checked) => change([...items], { ...stop, enabled: checked === true })}
                  />
                  {FOLLOW_UPS_COPY.stopLabel}
                </label>
                <div className="w-full min-w-0 sm:w-64">
                  <CardSelect
                    ariaLabel="Produto que faz parar"
                    disabled={disabled || readOnly || !stop.enabled || !options.productsLoaded}
                    invalid={Boolean(stopError)}
                    onChange={(productId: string) => change([...items], { ...stop, productId })}
                    options={productOptions}
                    value={stop.productId}
                  />
                </div>
              </div>
              {stop.enabled ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{stopLineHint(stopProductName)}</p> : null}
              {stopError ? <p className="text-[13px] leading-5 text-[var(--error)]">{stopError}</p> : null}
            </div>
          )
        ) : null}

        {!builderOnly && items.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-3">{renderItems(items, main, null, 1, [flowMessageOf(main)])}</div>
        ) : null}

        {!builderOnly && !readOnly ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <div>
              <Button className="px-3" disabled={disabled || rootProblem !== null} onClick={() => add(null)} type="button" variant="secondary">
                <Plus aria-hidden="true" className="size-4" />
                {FOLLOW_UPS_COPY.add}
              </Button>
            </div>
            {rootProblem ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{rootProblem}</p> : null}
          </div>
        ) : null}

        {errorFor("followUps") ? <p className="text-[13px] leading-5 text-[var(--error)]">{errorFor("followUps")}</p> : null}

        {!builderOnly && (items.length > 0 || !readOnly) ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{FOLLOW_UPS_COPY.limits}</p> : null}

        {footer}
      </div>

      {editing && editingParent ? (
        <FollowUpSheet
          allowUntil={allowUntil}
          anchorExpiresAt={followUpPreviewAnchorExpiry(editing.item.when, editingParent, now)}
          branding={options.branding}
          canEditBrand={options.canEditBrand}
          content={editing.item.content}
          disabled={disabled || readOnly}
          errorFor={(key) => fieldErrorFor(`${paths.get(editing.item.id) ?? "followUps"}.content.${key}`)}
          idPrefix={`seguinte-${(numbers.get(editing.item.id) ?? "x").replace(/\./g, "-")}`}
          level={editingParent.level}
          live={mode.kind === "live"}
          // Ajustes da v3a: no fluxo no ar, a enquete de uma seguinte que ja chegou a alguem nao muda.
          lockedFields={livePollLockedFields({ live: flowLive, received: stats[editing.item.id]?.received })}
          now={now}
          onAudioBusyChange={(reason) => onAudioBusyChange?.(reason)}
          onBlurField={() => undefined}
          onChange={(patch) => update(editing.item.id, (current) => ({ ...current, content: { ...current.content, ...patch } }))}
          onImageUploadChange={(preview) => onImageUploadChange?.(preview)}
          onOpenChange={(open) => {
            if (!open) {
              setEditingId(null);
            }
          }}
          onSendersChange={onSendersChange}
          open
          products={options.products}
          productsLoaded={options.productsLoaded}
          senders={options.senders}
          title={followUpTitle(numbers.get(editing.item.id) ?? "")}
        />
      ) : null}

      <ConfirmDialog
        confirmLabel={removeCopy?.confirmLabel ?? FOLLOW_UPS_COPY.remove}
        description={removeCopy?.description}
        destructive
        onConfirm={() => {
          if (removing) {
            change(removeFollowUp([...items], removing.item.id));
          }

          setRemovingId(null);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setRemovingId(null);
          }
        }}
        open={removing !== null}
        title={removeCopy?.title ?? ""}
      />
    </SectionCard>
  );
}

/** "Ver como fluxo" no canto do cartao, depois de gravado. */
export function ViewAsFlowLink({ flowId }: { flowId: string }) {
  return (
    <AdminLinkButton className="h-9 px-3" href={noticeFlowHref(flowId)} variant="secondary">
      <ExternalLink aria-hidden="true" className="size-4" />
      {FOLLOW_UPS_COPY.viewAsFlow}
    </AdminLinkButton>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Relatorio: "Notificações seguintes" depois do envio (mudancas em etapas, "Aplicar alterações")
 * ---------------------------------------------------------------------------------------------- */

/** Os produtos do editor no formato do seletor (o mesmo do editor do aviso). */
function pickerItemsOf(products: NoticeEditorOptions["products"]): ProductPickerItem[] {
  return products.map((product) => ({
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: PRODUCT_FORMAT_LABELS[product.format],
    flags: product.situation === "published" ? [] : [{ label: PRODUCT_SITUATION_LABELS[product.situation], tone: "muted" as const }],
    id: product.id,
    title: product.title
  }));
}

function stateOf(detail: NoticeDetail, entryId: string): { items: FollowUpFormItem[]; stop: FollowUpStopLine } {
  const followUps = detail.followUps;

  return {
    items: followUps?.items ? followUpFormItemsOf(followUps.items, followUpParentOf(entryId, "main", detail.draft)) : [],
    stop: stopLineOfGoal(followUps?.goal ?? null)
  };
}

const FOLLOW_UPS_CHECK = { expectedNoticeUpdatedAt: "2026-01-01T00:00:00.000Z", noticeId: "00000000-0000-4000-8000-000000000000" } as const;

type Failure = { message: string; status: number };

/**
 * A secao do relatorio de uma notificacao enviada: as mesmas seguintes do editor, no ar para quem pode
 * publicar (as mudancas ficam numa copia de trabalho e valem com "Aplicar alterações", pelo mesmo RPC do
 * construtor); so leitura quando foi retirada, quando todas as linhas sairam do sino ou sem permissao. Um
 * 409 mantem a copia de trabalho (o padrao da v1).
 */
export function NoticeFollowUpsReport({ detail, now }: { detail: NoticeDetail; now: number }) {
  const router = useRouter();
  const followUps = detail.followUps;
  // A entrada do fluxo (a principal nas regras): a gravada no servidor assim que existe (depois de aplicar
  // ou de outra tela), para "Descartar" e a releitura desenharem as escolhas com o mesmo id das regras.
  const [entryId, setEntryId] = useState(() => followUps?.entryNodeId ?? crypto.randomUUID());
  const [state, setState] = useState(() => stateOf(detail, entryId));
  const [serverVersion, setServerVersion] = useState<string | null>(followUps?.updatedAt ?? null);
  const [flowVersion, setFlowVersion] = useState<string | null>(followUps?.updatedAt ?? null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState<string | null>(null);
  const [senders, setSenders] = useState<NoticeSenderChoice[]>(() => detail.followUpOptions?.senders ?? []);
  const sentAt = detail.sentAt ? Date.parse(detail.sentAt) : now;
  const main = useMemo(() => followUpParentOf(entryId, "main", detail.draft, sentAt), [detail.draft, entryId, sentAt]);
  const [savedKey, setSavedKey] = useState(() => followUpsStateKey(state.items, state.stop, main));
  const key = followUpsStateKey(state.items, state.stop, main);
  const dirty = key !== savedKey;

  // Nova leitura do servidor (depois de aplicar, ou "Recarregar"): sem mudanca local, segue o banco (e a
  // entrada gravada).
  if (followUps && followUps.updatedAt !== serverVersion) {
    setServerVersion(followUps.updatedAt);
    setFlowVersion(followUps.updatedAt);

    if (!dirty) {
      const nextEntry = followUps.entryNodeId ?? entryId;
      const next = stateOf(detail, nextEntry);
      setEntryId(nextEntry);
      setState(next);
      setSavedKey(followUpsStateKey(next.items, next.stop, { ...main, nodeId: nextEntry }));
    }
  }

  const options = detail.followUpOptions;
  const mode: FollowUpsMode = followUps?.mode.kind === "live" && !options ? { kind: "readonly", note: FOLLOW_UPS_COPY.needsPublish, reason: "permission" } : (followUps?.mode ?? { kind: "edit" });
  const editorOptions: FollowUpEditorOptions = useMemo(
    () => ({
      branding: options?.branding ?? { iconUrl: "", logoUrl: null, name: "" },
      canEditBrand: options?.canEditBrand ?? false,
      cohorts: options?.cohorts ?? [],
      notices: options?.notices ?? [],
      products: options ? pickerItemsOf(options.products) : [],
      productsLoaded: options?.productsLoaded ?? false,
      segments: options?.segments ?? [],
      senders,
      webinars: options?.webinars ?? []
    }),
    [options, senders]
  );
  const names = useMemo(() => {
    const messages: Record<string, string> = { ...options?.names.messages, ...followUps?.names.messages, [`node:${entryId}`]: detail.title };
    const walk = (items: readonly FollowUpFormItem[]) =>
      items.forEach((item) => {
        messages[`node:${item.id}`] = item.content.title.trim() || "Sem título";
        walk(item.children);
      });

    walk(state.items);

    return {
      cohorts: { ...options?.names.cohorts },
      messages,
      products: { ...followUps?.names.products, ...options?.names.products },
      // As lives da regra "Participação em lives" ("participaram da live “X”").
      webinars: { ...followUps?.names.webinars, ...options?.names.webinars }
    };
  }, [detail.title, entryId, followUps?.names, options?.names, state.items]);
  const clientErrors = useMemo(() => {
    if (mode.kind !== "live" || state.items.length === 0) {
      return {};
    }

    const drafts = followUpsToSave("inbox", state.items, main);
    const parsed = saveNoticeFollowUpsSchema.safeParse({ ...FOLLOW_UPS_CHECK, followUps: drafts, goal: goalOfStopLine(state.stop) });

    return {
      ...followUpTreeErrors({ drafts, entryId, notice: detail.draft }),
      ...followUpChoiceErrors(state.items, main),
      ...(parsed.success ? {} : noticeErrorsFrom(parsed.error.issues))
    };
  }, [detail.draft, entryId, main, mode.kind, state]);
  const shown = { ...(submitted ? clientErrors : {}), ...serverErrors };

  if (!followUps) {
    return null;
  }

  // Retirada sem nenhuma seguinte: nada para mostrar.
  if (mode.kind === "readonly" && mode.reason === "withdrawn" && state.items.length === 0) {
    return null;
  }

  async function apply() {
    if (busy) {
      return;
    }

    if (uploading || audioBusy) {
      setFailure({ message: audioBusy ?? "Espere a imagem terminar de enviar e tente de novo.", status: 0 });
      return;
    }

    setSubmitted(true);

    if (Object.keys(clientErrors).length > 0) {
      setFailure({ message: "Revise os campos destacados.", status: 400 });
      return;
    }

    setBusy(true);
    setFailure(null);
    setServerErrors({});
    const result = await saveNoticeFollowUps({
      // null = esta tela nao viu fluxo nenhum: se outra criou um no meio, 409 em vez de gravar por cima.
      expectedFlowUpdatedAt: flowVersion,
      expectedNoticeUpdatedAt: detail.updatedAt,
      followUps: followUpsToSave("inbox", state.items, main),
      goal: goalOfStopLine(state.stop),
      noticeId: detail.id
    }).catch(() => null);
    setBusy(false);

    if (!result || !result.ok) {
      setServerErrors(result ? noticeErrorsFromAction(result.fieldErrors) : {});
      setFailure({ message: result?.error ?? "Não foi possível aplicar agora. Tente de novo.", status: result?.status ?? 0 });
      return;
    }

    // A entrada gravada pode ser outra (o primeiro "Aplicar" sem regra que cite a principal sorteia uma):
    // nenhuma regra local cita a antiga nesse caso, entao so o id muda.
    const nextEntry = result.data.entryNodeId ?? entryId;
    setEntryId(nextEntry);
    setFlowVersion(result.data.flowUpdatedAt);
    setServerVersion(result.data.flowUpdatedAt);
    setSavedKey(followUpsStateKey(state.items, state.stop, { ...main, nodeId: nextEntry }));
    setSubmitted(false);
    adminToast.success("Alterações aplicadas.");
    router.refresh();
  }

  function discard() {
    const next = stateOf(detail, entryId);
    setState(next);
    setSavedKey(followUpsStateKey(next.items, next.stop, main));
    setServerErrors({});
    setFailure(null);
    setSubmitted(false);
  }

  const live = mode.kind === "live";
  const conflict = failure?.status === 409;

  return (
    <NoticeFollowUps
      actions={followUps.flowId ? <ViewAsFlowLink flowId={followUps.flowId} /> : undefined}
      banner={
        <>
          {live ? (
            <p className="flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{FOLLOW_UPS_COPY.liveBanner}</span>
            </p>
          ) : null}
          {failure ? (
            <ErrorBanner
              action={
                conflict ? (
                  <Button className="px-3" onClick={() => router.refresh()} type="button" variant="secondary">
                    Recarregar
                  </Button>
                ) : (
                  <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
                    Fechar
                  </Button>
                )
              }
              title={conflict ? "As notificações seguintes mudaram em outra tela" : "Não foi possível aplicar as alterações"}
            >
              {conflict ? `${failure.message} O que você mudou aqui continua na tela.` : failure.message}
            </ErrorBanner>
          ) : null}
        </>
      }
      contentErrorOf={(path) => followUpErrorAt(shown, `${path}.content`)}
      description={live ? FOLLOW_UPS_COPY.description : ""}
      disabled={busy}
      errorFor={(path) => followUpErrorAt(shown, path)}
      fieldErrorFor={(path) => shown[path]}
      flowId={followUps.flowId}
      flowLive={followUps.status === "active" || followUps.status === "paused"}
      footer={
        live && dirty ? (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-3">
            <span aria-live="polite" className="text-sm leading-5 font-medium text-[var(--text-primary)]">
              {FOLLOW_UPS_COPY.pending}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button className="px-3" disabled={busy} onClick={discard} type="button" variant="secondary">
                {FOLLOW_UPS_COPY.discard}
              </Button>
              <Button className="px-4" disabled={busy} onClick={() => void apply()} type="button">
                {busy ? "Aplicando…" : FOLLOW_UPS_COPY.apply}
              </Button>
            </div>
          </div>
        ) : null
      }
      id="relatorio-seguintes"
      items={state.items}
      lines={followUps.lines}
      main={main}
      mainSent
      mode={mode}
      names={names}
      noticeCtaHref={detail.draft.cta?.href ?? null}
      noticeId={detail.id}
      now={now}
      onAudioBusyChange={setAudioBusy}
      onChange={(next) => {
        setState(next);
        setServerErrors({});

        if (failure && failure.status !== 409) {
          setFailure(null);
        }
      }}
      onImageUploadChange={setUploading}
      onSendersChange={setSenders}
      options={editorOptions}
      stats={followUps.stats}
      stop={state.stop}
      testBusyId={null}
      title={FOLLOW_UPS_SECTION_TITLE}
    />
  );
}
