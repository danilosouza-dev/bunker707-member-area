"use client";

import { ArrowLeft, Hourglass, Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import { previewNoticeAudience } from "@/server/communications/actions";
import { describeAudience, isAudienceGroup, normalizeAudience, type AudienceDefinition, type AudienceNode } from "@/server/communications/audience-model";
import { APPROVAL_THRESHOLD, formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { activateFlow, saveFlow, sendFlowMessageTest } from "@/server/communications/flow-actions";
import type { FlowBranch, FlowStatus } from "@/server/communications/flow-model";
import type { FlowDetail } from "@/server/communications/flow-queries";
import { flowDraftSchema, type FlowDraft, type FlowNodeDraft, type FlowNoticeContent } from "@/server/communications/flow-schemas";
import type { NoticeEditorOptions } from "@/server/communications/queries";
import { audienceDefinitionSchema } from "@/server/communications/schemas";
import { ErrorBanner } from "../../error-banner";
import { AdminLinkButton } from "../../link-button";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import { useWarnBeforeUnload } from "../../products/use-warn-before-unload";
import { AdminSwitch, ConfirmDialog, RowMenu, type RowMenuAction } from "../../settings/kit";
import { AdminSheet } from "../../sheet";
import { StatusChip } from "../../status-chip";
import type { ProductPickerItem } from "../../storefront/product-picker";
import { adminToast } from "../../toast";
import { useAdminTopbarTitle } from "../../topbar-title";
import { useMediaQuery } from "../../use-media-query";
import type { AudienceCountState } from "../audience-builder";
import { audienceMessageOptions, audienceNamesWithMessages, NOTHING_TO_SAVE_MESSAGE, type NoticeSenderChoice } from "../notices-view-model";
import { FlowCanvas } from "./flow-canvas";
import { ConditionInspector, FlowSettingsPanel, MessageInspector, type InspectorContext } from "./flow-inspector";
import { FlowRemoveDialog, type RemoveTarget } from "./flow-remove-dialog";
import { FlowRowMenu, useFlowActions, type FlowActionTarget } from "./flow-row-menu";
import {
  activationDescription,
  activationErrors,
  applyGoalAccessFix,
  BUILDER_PRIMARY_LABELS,
  builderBarFor,
  ENTRY_MODE_OPTIONS,
  entryCountLine,
  entryLock,
  entryRulesChanged,
  entrySentence,
  FLOW_CHANGED_TITLE,
  FLOW_SITUATION_LABELS,
  FLOW_TOASTS,
  flowAudienceNames,
  flowErrorsFrom,
  flowErrorsFromAction,
  flowHref,
  flowIssuesOf,
  flowSituationOf,
  flowSituationTone,
  FLOWS_HREF,
  flowTitleOf,
  firstErrorTarget,
  formatReportValue,
  goalAccessFix,
  goalAccessFixMessage,
  insertFlowStep,
  isSameFlowDraft,
  LIVE_EDIT_BANNER,
  MAX_STEPS_MESSAGE,
  MOVED_TO_YES_TOAST,
  noticeOriginBanner,
  PENDING_APPROVAL_BANNER,
  PENDING_EDIT_NOTE,
  removeFlowStep,
  sourceNoticeHref,
  stepErrors,
  settingsErrors,
  UNAPPLIED_CHANGES,
  describeFlowReview,
  type FlowFieldErrors,
  type FlowPermissions,
  type NewStepKind,
  type RemoveMode
} from "./flows-view-model";

// Construtor de fluxos (docs/23 §2.5 a §2.7). A partir de 1024 px, dois paineis: o desenho do fluxo a
// esquerda (FlowCanvas, com rolagem lateral propria) e o painel do passo escolhido a direita (400 px, fixo
// ao rolar; sem passo escolhido, a configuracao do fluxo). Abaixo de 1024 px, uma coluna so: tocar num
// cartao abre o painel como folha de tela cheia, com "Concluir" embaixo; as acoes do topo vao para o menu
// "⋯", menos a principal.
//
// - Rascunho: "Salvar rascunho" (saveFlow com a versao lida; 409 -> banner com Recarregar, o que foi feito
//   fica) e o principal "Ativar fluxo" ou "Enviar para aprovação" (publishDecision com a contagem ao vivo; o
//   servidor conta de novo). Ativar pergunta antes e grava primeiro.
// - No ar ou pausado (?editar=1): as alteracoes ficam na tela ate "Aplicar alterações" (uma transacao so);
//   "Descartar" volta ao que esta no ar.
// - Fluxo de um aviso antes de ele sair: so "Salvar" e "Abrir a notificação" (a publicacao do aviso ativa).
// - A conferencia da arvore e a mesma do servidor (validateFlowTree); o erro leva ao passo e ao campo.

type FlowBuilderProps = {
  /** O fluxo gravado; null = novo (a partir de um modelo). */
  initial: FlowDetail | null;
  /** Passo aberto pelo endereco (?passo=). */
  initialStep?: string | null;
  now: number;
  /** Fluxo novo: volta para "Como você quer começar?". */
  onChangeTemplate?: () => void;
  options: NoticeEditorOptions;
  permissions: FlowPermissions;
  /** Rascunho do modelo escolhido (fluxo novo). */
  templateDraft?: FlowDraft | null;
};

type Failure = { message: string; status: number; title: string };
type Busy = "activate" | "apply" | "save" | "test" | null;
type SavedVersion = { id: string; status: FlowStatus; updatedAt: string };

const COUNT_DEBOUNCE_MS = 500;
/** O banner de erro (a tela rola ate ele). */
const FAILURE_ID = "fluxo-erro";
const NARROW_QUERY = "(min-width: 1024px)";

function toPickerItems(products: NoticeEditorOptions["products"]): ProductPickerItem[] {
  return products.map((product) => ({
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: PRODUCT_FORMAT_LABELS[product.format],
    flags: product.situation === "published" ? [] : [{ label: PRODUCT_SITUATION_LABELS[product.situation], tone: "muted" as const }],
    id: product.id,
    title: product.title
  }));
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function hasPageVisitRule(definition: AudienceDefinition | null): boolean {
  const visit = (node: AudienceNode): boolean => (isAudienceGroup(node) ? node.items.some(visit) : node.type === "page_visit");

  return Boolean(definition && definition.kind === "rules" && visit(definition.root));
}

function Banner({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
      {icon ?? <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Os dois paineis (computador) ou a coluna com a folha de tela cheia (celular e tablet). Tambem usado pelo
 * relatorio. Um painel so existe por vez: os campos nunca aparecem duas vezes na pagina.
 */
export function FlowWorkspace({
  canvas,
  onSheetOpenChange,
  panel,
  panelDescription,
  panelTitle,
  sheetOpen,
  wide
}: {
  canvas: ReactNode;
  onSheetOpenChange: (open: boolean) => void;
  panel: ReactNode;
  panelDescription?: ReactNode;
  panelTitle: string;
  sheetOpen: boolean;
  wide: boolean;
}) {
  return (
    <>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label="Passos do fluxo" className="min-w-0">
          {canvas}
        </section>
        {wide ? (
          <aside
            aria-label={panelTitle}
            className="flex min-w-0 flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain"
          >
            <div className="min-w-0">
              <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">{panelTitle}</h2>
              {panelDescription ? <p className="truncate text-[13px] leading-5 text-[var(--text-secondary)]">{panelDescription}</p> : null}
            </div>
            {panel}
          </aside>
        ) : null}
      </div>
      {!wide ? (
        <AdminSheet
          className="md:inset-0 md:h-dvh md:w-full md:max-w-full md:rounded-none md:border-0 md:shadow-none"
          closeLabel="Fechar o painel"
          description={panelDescription}
          footer={
            <Button className="ml-auto h-11 px-5" onClick={() => onSheetOpenChange(false)} type="button">
              Concluir
            </Button>
          }
          onOpenChange={onSheetOpenChange}
          open={sheetOpen}
          title={panelTitle}
        >
          {panel}
        </AdminSheet>
      ) : null}
    </>
  );
}

export function FlowBuilder({ initial, initialStep = null, now, onChangeTemplate, options, permissions, templateDraft = null }: FlowBuilderProps) {
  const router = useRouter();
  const wide = useMediaQuery(NARROW_QUERY);
  const startDraft = initial?.draft ?? templateDraft;
  const [draft, setDraft] = useState<FlowDraft>(() => startDraft as FlowDraft);
  const [saved, setSaved] = useState<FlowDraft | null>(() => initial?.draft ?? null);
  const [version, setVersion] = useState<SavedVersion | null>(() => (initial ? { id: initial.id, status: initial.status, updatedAt: initial.updatedAt } : null));
  const [serverVersion, setServerVersion] = useState<string | null>(initial?.updatedAt ?? null);
  const [selected, setSelected] = useState<string | null>(() => (initialStep && startDraft?.nodes.some((node) => node.id === initialStep) ? initialStep : null));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sides, setSides] = useState<Record<string, FlowBranch>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [serverErrors, setServerErrors] = useState<FlowFieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [confirm, setConfirm] = useState<"activate" | "apply" | null>(null);
  const [removing, setRemoving] = useState<RemoveTarget | null>(null);
  const [imageUpload, setImageUpload] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState<string | null>(null);
  const [senders, setSenders] = useState<NoticeSenderChoice[]>(() => options.senders);
  const [showNumbers, setShowNumbers] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [count, setCount] = useState<AudienceCountState>(() =>
    typeof initial?.entryCount === "number" ? { previous: { count: initial.entryCount, sample: [] }, status: "loading" } : { previous: null, status: "loading" }
  );
  const [countAttempt, setCountAttempt] = useState(0);
  const countRequest = useRef(0);
  const saveShortcut = useRef<() => void>(() => undefined);

  // Outra versao veio do servidor (Recarregar depois de um 409, ou outra tela): sem mudanca na tela, a tela
  // segue o banco; com mudanca, o que foi feito aqui fica e a proxima gravacao usa a versao nova.
  if (initial && initial.updatedAt !== serverVersion) {
    setServerVersion(initial.updatedAt);

    if (!version || Date.parse(initial.updatedAt) !== Date.parse(version.updatedAt)) {
      if (!saved || isSameFlowDraft(saved, draft)) {
        setDraft(initial.draft);
        setResetKey((key) => key + 1);
      }

      setSaved(initial.draft);
      setVersion({ id: initial.id, status: initial.status, updatedAt: initial.updatedAt });
      setFailure(null);
      setServerErrors({});
    }
  }

  const status: FlowStatus = version?.status ?? "draft";
  const live = status === "active" || status === "paused";
  const origin = draft.origin;
  const source = initial?.source ?? null;
  const report = initial?.report ?? null;
  const dirty = !saved || !isSameFlowDraft(saved, draft);
  const uploading = imageUpload !== null;
  const pickerItems = useMemo(() => toPickerItems(options.products), [options.products]);
  const baseNames = useMemo(() => audienceNamesWithMessages(options.names, audienceMessageOptions("segment", { notices: options.notices })), [options.names, options.notices]);
  const names = useMemo(() => flowAudienceNames(baseNames, draft, source), [baseNames, draft, source]);
  const titleOf = useMemo(() => flowTitleOf(draft, source), [draft, source]);
  const clientErrors = useMemo(() => {
    const parsed = flowDraftSchema.safeParse(draft);

    return parsed.success ? {} : flowErrorsFrom(parsed.error.issues, draft.nodes);
  }, [draft]);
  const issues = useMemo(() => flowIssuesOf(draft, source), [draft, source]);
  const activationProblems = useMemo(() => activationErrors(issues), [issues]);
  const errors = useMemo<FlowFieldErrors>(() => {
    const shownClient = submitted ? clientErrors : Object.fromEntries(Object.entries(clientErrors).filter(([key]) => touched.has(key)));

    return { ...(attempted ? activationProblems : {}), ...shownClient, ...serverErrors };
  }, [activationProblems, attempted, clientErrors, serverErrors, submitted, touched]);
  const audienceKey = JSON.stringify(normalizeAudience(draft.entry.audience));
  const audienceValid = useMemo(() => origin === "builder" && audienceDefinitionSchema.safeParse(JSON.parse(audienceKey)).success, [audienceKey, origin]);
  const countView: AudienceCountState = audienceValid ? count : { status: "incomplete" };
  const liveCount = countView.status === "ready" ? countView.count : countView.status === "loading" ? (countView.previous?.count ?? null) : null;
  const bar = builderBarFor({ count: liveCount, origin, permissions, saved: Boolean(version), sourceStatus: source?.status ?? null, status });
  const readOnly = bar.readOnly !== null;
  const locked = busy !== null;
  const disabled = locked || readOnly;
  const savedEntryMode = saved?.entry.mode ?? draft.entry.mode;
  const lock = entryLock({ live, mode: savedEntryMode, origin });
  const needsApproval = liveCount !== null && liveCount > APPROVAL_THRESHOLD && !permissions.canPublishLarge;
  const review = describeFlowReview({ count: liveCount, goal: draft.goal, mode: draft.entry.mode, names, nodes: draft.nodes, origin, sourceTitle: source?.title });
  const entryNode = draft.nodes.find((node) => node.kind === "entry") ?? null;
  const selectedNode = selected ? (draft.nodes.find((node) => node.id === selected) ?? null) : null;
  const panelNode = selectedNode && selectedNode.kind !== "entry" ? selectedNode : null;
  const situation = initial ? flowSituationOf({ endedReason: initial.endedReason, origin, sourceStatus: source?.status ?? null, status }) : "draft";

  useWarnBeforeUnload((dirty && !readOnly) || uploading || audioBusy !== null);
  useAdminTopbarTitle(initial ? initial.draft.name : "Novo fluxo");

  // Contagem ao vivo de "Quem entra" (500 ms depois da ultima mudanca; resposta velha e ignorada).
  useEffect(() => {
    if (!audienceValid) {
      return;
    }

    const audience = JSON.parse(audienceKey) as AudienceDefinition;
    const request = countRequest.current + 1;
    countRequest.current = request;
    const timer = window.setTimeout(() => {
      setCount((current) => ({ previous: current.status === "ready" ? { count: current.count, sample: current.sample } : current.status === "loading" ? current.previous : null, status: "loading" }));

      void previewNoticeAudience({ audience })
        .then((result) => {
          if (countRequest.current !== request) {
            return;
          }

          setCount(result.ok ? { count: result.data.count, sample: result.data.sample, status: "ready" } : { message: result.error || "Não foi possível contar agora.", status: "error" });
        })
        .catch(() => {
          if (countRequest.current === request) {
            setCount({ message: "Não foi possível contar agora.", status: "error" });
          }
        });
    }, COUNT_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [audienceKey, audienceValid, countAttempt]);

  // Ctrl/Cmd+Enter salva o rascunho (no ar, nao: aplicar pede o botao).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        saveShortcut.current();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* ----------------------------------------------------------------------------------------------
   * Edicao
   * -------------------------------------------------------------------------------------------- */

  function clearServerErrorsFor(prefixes: readonly string[]) {
    setServerErrors((current) => {
      const keys = Object.keys(current).filter((key) => prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)));

      if (keys.length === 0) {
        return current;
      }

      const next = { ...current };
      keys.forEach((key) => delete next[key]);
      return next;
    });
  }

  function change(next: FlowDraft, prefixes: readonly string[]) {
    setDraft(next);
    clearServerErrorsFor(prefixes);

    if (failure && failure.status !== 409) {
      setFailure(null);
    }
  }

  function touch(key: string) {
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
  }

  function select(nodeId: string | null) {
    const target = nodeId && nodeId !== entryNode?.id ? nodeId : null;
    setSelected(target);

    if (!wide) {
      setSheetOpen(true);
    }
  }

  function replaceNode(node: FlowNodeDraft) {
    change({ ...draft, nodes: draft.nodes.map((item) => (item.id === node.id ? node : item)) }, [`nodes.${node.id}`]);
  }

  function replaceMessage(nodeId: string, input: { content?: FlowNoticeContent; node?: FlowNodeDraft }) {
    change(
      {
        ...draft,
        messages: input.content ? { ...draft.messages, [nodeId]: input.content } : draft.messages,
        nodes: input.node ? draft.nodes.map((item) => (item.id === nodeId ? (input.node as FlowNodeDraft) : item)) : draft.nodes
      },
      [`nodes.${nodeId}`, `messages.${nodeId}`]
    );
  }

  function insert(input: { branch: FlowBranch | null; kind: NewStepKind; parentId: string }) {
    const id = crypto.randomUUID();
    const result = insertFlowStep(draft, { ...input, id, live, source });

    if (!result) {
      adminToast.info(MAX_STEPS_MESSAGE);
      return;
    }

    change(result.draft, ["nodes"]);

    if (result.movedToYes) {
      adminToast.info(MOVED_TO_YES_TOAST);
    }

    select(id);
    window.requestAnimationFrame(() => document.querySelector(`[data-flow-step="${id}"]`)?.scrollIntoView({ behavior: scrollBehavior(), block: "center" }));
  }

  function waitingOf(nodeId: string) {
    return live ? (report?.nodes[nodeId]?.waiting ?? 0) : 0;
  }

  function requestRemove(node: FlowNodeDraft) {
    if (node.kind === "entry") {
      return;
    }

    setRemoving({ id: node.id, kind: node.kind, title: node.kind === "message" ? titleOf(node.id) : "", waiting: waitingOf(node.id) });
  }

  function confirmRemove(mode: RemoveMode) {
    if (!removing) {
      return;
    }

    const node = draft.nodes.find((item) => item.id === removing.id);
    change(removeFlowStep(draft, removing.id, mode), ["nodes", "messages"]);
    setRemoving(null);
    setSelected(node?.parentId && node.parentId !== entryNode?.id ? node.parentId : null);
  }

  /* ----------------------------------------------------------------------------------------------
   * Gravar, ativar, aplicar
   * -------------------------------------------------------------------------------------------- */

  function showFailure(next: Failure) {
    setFailure(next);
    window.requestAnimationFrame(() => document.getElementById(FAILURE_ID)?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }));
  }

  /** Leva ao primeiro erro: o passo (ou a configuracao) no painel e o campo com o erro. */
  function focusFirstError(next: FlowFieldErrors) {
    const target = firstErrorTarget(next, draft.nodes);

    if (target === null) {
      return;
    }

    setSelected(target === "" ? null : target);

    if (!wide) {
      setSheetOpen(true);
    }

    window.setTimeout(() => {
      if (target) {
        document.querySelector(`[data-flow-step="${target}"]`)?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
      }

      document.querySelector<HTMLElement>('[data-flow-panel] [aria-invalid="true"]')?.focus({ preventScroll: false });
    }, 80);
  }

  /** Confere e grava; devolve a versao gravada ou null (erro ja na tela). */
  async function persist(): Promise<SavedVersion | null> {
    if (uploading) {
      showFailure({ message: "Espere a imagem terminar de enviar e tente de novo.", status: 0, title: "Não foi possível salvar" });
      return null;
    }

    if (audioBusy) {
      showFailure({ message: audioBusy, status: 0, title: "Não foi possível salvar" });
      return null;
    }

    setSubmitted(true);

    if (Object.keys(clientErrors).length > 0) {
      showFailure({ message: "Revise os passos destacados.", status: 400, title: "Não foi possível salvar" });
      focusFirstError(clientErrors);
      return null;
    }

    setFailure(null);
    setServerErrors({});
    const sent = draft;
    const result = await saveFlow({ expectedUpdatedAt: version?.updatedAt, flow: sent, id: version?.id });

    if (!result.ok) {
      const fieldErrors = flowErrorsFromAction(result.fieldErrors, sent.nodes);
      setServerErrors(fieldErrors);
      showFailure({
        message: result.status === 409 ? `${result.error} O que você mudou aqui continua na tela.` : result.error,
        status: result.status,
        title: result.status === 409 ? FLOW_CHANGED_TITLE : live ? "Não foi possível aplicar as alterações" : "Não foi possível salvar"
      });
      focusFirstError(fieldErrors);
      return null;
    }

    const next = { id: result.data.id, status: result.data.status, updatedAt: result.data.updatedAt };
    setVersion(next);
    setServerVersion(result.data.updatedAt);
    setSaved(sent);

    return next;
  }

  async function saveDraft() {
    if (busy || readOnly) {
      return;
    }

    if (version && !dirty && !uploading && !audioBusy) {
      adminToast.info(NOTHING_TO_SAVE_MESSAGE);
      return;
    }

    setBusy("save");
    const stored = await persist();
    setBusy(null);

    if (stored) {
      adminToast.success(FLOW_TOASTS.saved);

      if (!initial) {
        router.replace(flowHref(stored.id), { scroll: false });
      } else {
        router.refresh();
      }
    }
  }

  /** "Ativar fluxo" / "Enviar para aprovação": confere tudo antes (o que bloqueia ativar tambem). */
  function requestActivate() {
    if (busy) {
      return;
    }

    setSubmitted(true);
    setAttempted(true);
    const blocking = { ...clientErrors, ...activationProblems };

    if (Object.keys(blocking).length > 0) {
      showFailure({ message: "Revise os passos destacados.", status: 400, title: "Ainda não dá para ativar" });
      focusFirstError(blocking);
      return;
    }

    if (bar.primary === "request_approval") {
      void activate();
      return;
    }

    setConfirm("activate");
  }

  async function activate() {
    setBusy("activate");
    const current = dirty || !version ? await persist() : version;

    if (!current) {
      setBusy(null);
      setConfirm(null);
      return;
    }

    const result = await activateFlow({ expectedUpdatedAt: current.updatedAt, id: current.id });
    setBusy(null);
    setConfirm(null);

    if (!result.ok) {
      showFailure({
        message: result.status === 409 ? `${result.error} O que você mudou aqui continua na tela.` : result.error,
        status: result.status,
        title: result.status === 409 ? FLOW_CHANGED_TITLE : "O rascunho foi salvo, mas o fluxo não foi ativado"
      });

      if (!initial) {
        router.replace(flowHref(current.id), { scroll: false });
      }

      return;
    }

    adminToast.success(result.data.situation === "pending_approval" ? FLOW_TOASTS.approvalRequested : FLOW_TOASTS.activated);
    setVersion({ id: current.id, status: result.data.situation, updatedAt: result.data.updatedAt });
    router.replace(flowHref(current.id), { scroll: false });
    router.refresh();
  }

  function requestApply() {
    if (busy || !dirty) {
      return;
    }

    if (saved && origin === "builder" && draft.entry.mode === "current_and_new" && entryRulesChanged(saved, draft)) {
      setConfirm("apply");
      return;
    }

    void apply();
  }

  async function apply() {
    setBusy("apply");
    const applied = await persist();
    setBusy(null);
    setConfirm(null);

    if (applied) {
      adminToast.success(FLOW_TOASTS.applied);
      router.refresh();
    }
  }

  function discard() {
    if (saved) {
      setDraft(saved);
    }

    setServerErrors({});
    setFailure(null);
    setSubmitted(false);
    setAttempted(false);
    setTouched(new Set());
    setResetKey((key) => key + 1);
  }

  async function sendTest(nodeId: string) {
    if (busy) {
      return;
    }

    setBusy("test");
    const current = !live && (dirty || !version) ? await persist() : version;

    if (!current) {
      setBusy(null);
      return;
    }

    const result = await sendFlowMessageTest({ id: current.id, nodeId });
    setBusy(null);

    if (!result.ok) {
      showFailure({ message: result.error, status: result.status, title: "Não foi possível enviar o teste" });
      return;
    }

    adminToast.success(FLOW_TOASTS.testSent);

    if (!initial) {
      router.replace(flowHref(current.id), { scroll: false });
    }
  }

  function primaryAction() {
    if (bar.primary === "apply") {
      requestApply();
    } else if (bar.primary === "save") {
      void saveDraft();
    } else {
      requestActivate();
    }
  }

  useEffect(() => {
    saveShortcut.current = () => {
      if (!live) {
        void saveDraft();
      }
    };
  });

  /* ----------------------------------------------------------------------------------------------
   * Acoes do menu (duplicar, excluir, pausar, retomar, encerrar, aprovar, recusar)
   * -------------------------------------------------------------------------------------------- */

  const flowActions = useFlowActions({ onDeleted: () => router.push(FLOWS_HREF) });
  const actionTarget: FlowActionTarget | null = version
    ? {
        actions: bar.menu,
        entryCount: liveCount ?? initial?.entryCount ?? null,
        entryMode: saved?.entry.mode ?? draft.entry.mode,
        id: version.id,
        name: saved?.name ?? draft.name,
        origin,
        sourceId: source?.id ?? null,
        status,
        updatedAt: version.updatedAt
      }
    : null;
  const approvalTarget: FlowActionTarget | null = actionTarget ? { ...actionTarget, actions: ["approve", "reject"] } : null;

  /* ----------------------------------------------------------------------------------------------
   * Tela
   * -------------------------------------------------------------------------------------------- */

  const problems = useMemo(() => {
    const map = new Map<string, { text: string; tone: "error" | "warning" }>();

    for (const issue of issues) {
      if (issue.level === "warning" && issue.nodeId) {
        map.set(issue.nodeId, { text: issue.message, tone: "warning" });
      }
    }

    for (const node of draft.nodes) {
      const own = stepErrors(errors, node.id);

      if (node.kind !== "entry" && (Object.keys(own.node).length > 0 || Object.keys(own.content).length > 0)) {
        map.set(node.id, { text: "Revise este passo.", tone: "error" });
      }
    }

    if (entryNode && Object.keys(settingsErrors(errors)).length > 0) {
      map.set(entryNode.id, { text: "Revise o nome, quem entra ou o objetivo.", tone: "error" });
    }

    return map;
  }, [draft.nodes, entryNode, errors, issues]);

  const goalProduct = goalAccessFix({ entry: draft.entry.audience, goal: draft.goal, origin });
  const goalFix = goalProduct
    ? {
        message: goalAccessFixMessage(names.products[goalProduct] ?? "este produto"),
        onApply: (() => {
          const fixed = applyGoalAccessFix(draft.entry.audience, goalProduct);

          return fixed && !lock.rulesLocked ? () => change({ ...draft, entry: { ...draft.entry, audience: fixed } }, ["entry"]) : null;
        })()
      }
    : null;

  const context: InspectorContext = {
    disabled,
    live,
    names,
    now,
    onAudioBusyChange: setAudioBusy,
    onImageUploadChange: setImageUpload,
    onSendersChange: setSenders,
    onTouch: touch,
    options,
    pickerItems,
    resetKey,
    senders,
    source,
    stats: report?.nodes ?? null
  };

  let panel: ReactNode;
  let panelTitle = "Configuração do fluxo";
  let panelDescription: ReactNode = null;

  if (panelNode?.kind === "message") {
    const content = draft.messages[panelNode.id];
    panelTitle = "Notificação";
    panelDescription = titleOf(panelNode.id);
    panel = content ? (
      <MessageInspector
        content={content}
        context={context}
        draft={draft}
        errors={stepErrors(errors, panelNode.id)}
        imagePreview={imageUpload}
        key={`${panelNode.id}-${resetKey}`}
        locked={waitingOf(panelNode.id) > 0 && Boolean(saved?.nodes.some((node) => node.id === panelNode.id))}
        node={panelNode}
        onChange={(input) => replaceMessage(panelNode.id, input)}
        onTest={readOnly || (live && !saved?.nodes.some((node) => node.id === panelNode.id)) ? null : () => void sendTest(panelNode.id)}
        testBusy={busy === "test"}
        titleOf={titleOf}
        watchesNewPage={hasPageVisitRule(panelNode.filter)}
      />
    ) : null;
  } else if (panelNode?.kind === "condition") {
    panelTitle = "Condição";
    panelDescription = describeAudience(panelNode.condition, names);
    panel = (
      <ConditionInspector
        context={context}
        draft={draft}
        errors={stepErrors(errors, panelNode.id).node}
        key={`${panelNode.id}-${resetKey}`}
        locked={waitingOf(panelNode.id) > 0 && Boolean(saved?.nodes.some((node) => node.id === panelNode.id))}
        node={panelNode}
        onChange={replaceNode}
        watchesNewPage={hasPageVisitRule(panelNode.condition)}
      />
    );
  } else {
    panel = (
      <FlowSettingsPanel
        context={context}
        count={countView}
        draft={draft}
        entryDescription={describeAudience(normalizeAudience(draft.entry.audience), names)}
        entryLock={lock}
        errors={settingsErrors(errors)}
        goalFix={goalFix}
        key={`ajustes-${resetKey}`}
        needsApproval={needsApproval && !live}
        onChange={(patch) => change({ ...draft, ...patch }, Object.keys(patch))}
        onRetryCount={() => setCountAttempt((attempt) => attempt + 1)}
        review={review}
        sourceHref={source ? sourceNoticeHref(source.id) : null}
        sourceTitle={source?.title ?? null}
      />
    );
  }

  const panelWithBack =
    panelNode && wide ? (
      <div className="flex min-w-0 flex-col gap-4" data-flow-panel="">
        <Button className="w-fit px-2 text-[var(--text-secondary)]" onClick={() => setSelected(null)} type="button" variant="ghost">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Configuração do fluxo
        </Button>
        {panel}
      </div>
    ) : (
      <div className="flex min-w-0 flex-col gap-4" data-flow-panel="">
        {panel}
      </div>
    );

  const stepMenu = (node: FlowNodeDraft): RowMenuAction[] =>
    node.kind === "entry" || readOnly ? [] : [{ destructive: true, label: "Remover passo", onSelect: () => requestRemove(node) }];
  const canvasNumbers =
    showNumbers && report
      ? { entry: `Entraram ${formatReportValue(report.totals.entered)} · No fluxo agora ${formatReportValue(report.totals.active)}`, steps: report.nodes }
      : null;
  const primaryLabel = bar.primary ? BUILDER_PRIMARY_LABELS[bar.primary] : null;
  const working = (label: string) => (busy === "save" ? "Salvando…" : busy === "activate" ? "Ativando…" : busy === "apply" ? "Aplicando…" : label);

  // Barra do topo: no computador os botoes; abaixo de 1024 px, so o principal e o resto no menu "⋯".
  const secondaryMenu: RowMenuAction[] = [
    ...(bar.saveDraft ? [{ label: "Salvar rascunho", onSelect: () => void saveDraft() }] : []),
    ...(bar.applyBar && dirty ? [{ label: "Descartar", onSelect: discard }] : []),
    ...(bar.applyBar && version ? [{ label: "Ver relatório", onSelect: () => router.push(flowHref(version.id)) }] : []),
    ...(bar.openNotice && source ? [{ label: "Abrir a notificação", onSelect: () => router.push(sourceNoticeHref(source.id)) }] : []),
    ...(onChangeTemplate && !version ? [{ label: "Trocar de modelo", onSelect: onChangeTemplate }] : [])
  ];
  const headerActions = (
    <>
      {bar.applyBar && dirty ? <span className="text-[13px] leading-5 font-medium text-[var(--warning)]">{UNAPPLIED_CHANGES}</span> : null}
      {wide ? (
        <>
          {onChangeTemplate && !version ? (
            <Button className="px-4" disabled={locked} onClick={onChangeTemplate} type="button" variant="ghost">
              Trocar de modelo
            </Button>
          ) : null}
          {bar.openNotice && source ? (
            <AdminLinkButton href={sourceNoticeHref(source.id)} variant="secondary">
              Abrir a notificação
            </AdminLinkButton>
          ) : null}
          {bar.applyBar && version ? (
            <AdminLinkButton href={flowHref(version.id)} variant="ghost">
              Ver relatório
            </AdminLinkButton>
          ) : null}
          {bar.applyBar && dirty ? (
            <Button className="px-4" disabled={locked} onClick={discard} type="button" variant="secondary">
              Descartar
            </Button>
          ) : null}
          {bar.saveDraft ? (
            <Button className="px-4" disabled={locked || readOnly} onClick={() => void saveDraft()} type="button" variant="secondary">
              {busy === "save" ? "Salvando…" : "Salvar rascunho"}
            </Button>
          ) : null}
        </>
      ) : null}
      {primaryLabel ? (
        <Button className="px-4" disabled={locked || (bar.primary === "apply" && !dirty)} onClick={primaryAction} type="button">
          {working(primaryLabel)}
        </Button>
      ) : null}
      {!wide && secondaryMenu.length > 0 ? <RowMenu actions={secondaryMenu} label="Mais ações" /> : null}
      {actionTarget ? <FlowRowMenu flow={actionTarget} onRequest={flowActions.request} /> : null}
    </>
  );

  return (
    <AdminPage className="gap-6 pb-28">
      <PageHeader
        actions={headerActions}
        breadcrumb={[{ href: FLOWS_HREF, label: "Fluxos" }, { label: initial ? (live ? "Alterações" : "Editar fluxo") : "Novo fluxo" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip tone={initial ? flowSituationTone(situation) : "neutral"}>{FLOW_SITUATION_LABELS[situation]}</StatusChip>
            <span>{origin === "notice" ? "Notificações seguintes" : "Fluxo"}</span>
          </span>
        }
        title={
          <button
            className="max-w-full truncate rounded-md text-left outline-none hover:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            onClick={() => {
              select(null);
              window.setTimeout(() => document.getElementById("fluxo-nome")?.focus(), 80);
            }}
            title="Renomear"
            type="button"
          >
            {draft.name.trim() || "Fluxo sem nome"}
          </button>
        }
      />

      {flowActions.errorBanner}

      {origin === "notice" && source ? (
        <Banner>
          <p>{noticeOriginBanner(source.title)}</p>
          <Link className="mt-1 inline-block font-medium text-[var(--text-primary)] underline underline-offset-2" href={sourceNoticeHref(source.id)}>
            Abrir a notificação
          </Link>
        </Banner>
      ) : null}
      {live && !readOnly ? <Banner>{LIVE_EDIT_BANNER}</Banner> : null}
      {readOnly ? <Banner>{bar.readOnly}</Banner> : null}
      {status === "pending_approval" && origin === "builder" ? (
        <Banner icon={<Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />}>
          <p className="font-medium text-[var(--text-primary)]">{PENDING_APPROVAL_BANNER}</p>
          <p>
            {initial?.requestedBy ? `Pedido por ${initial.requestedBy.name}${initial.requestedAt ? ` em ${formatSaoPauloDateTime(initial.requestedAt)}` : ""}. ` : ""}
            {PENDING_EDIT_NOTE}
          </p>
          {permissions.canPublishLarge && approvalTarget ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="px-3"
                disabled={locked}
                onClick={() =>
                  dirty
                    ? showFailure({ message: "Salve as mudanças antes de aprovar.", status: 0, title: "Ainda não dá para aprovar" })
                    : flowActions.request("approve", approvalTarget)
                }
                type="button"
              >
                Aprovar e ativar
              </Button>
              <Button className="px-3" disabled={locked} onClick={() => flowActions.request("reject", approvalTarget)} type="button" variant="secondary">
                Recusar
              </Button>
            </div>
          ) : null}
        </Banner>
      ) : null}

      {failure ? (
        <div id={FAILURE_ID}>
          <ErrorBanner
            action={
              failure.status === 409 ? (
                <Button
                  className="px-3"
                  onClick={() => {
                    setFailure(null);
                    router.refresh();
                  }}
                  type="button"
                  variant="secondary"
                >
                  Recarregar
                </Button>
              ) : (
                <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
                  Fechar
                </Button>
              )
            }
            title={failure.title}
          >
            {failure.message}
          </ErrorBanner>
        </div>
      ) : null}

      {report ? (
        <div className="-mb-2 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <AdminSwitch checked={showNumbers} id="fluxo-mostrar-numeros" label="Mostrar números" onCheckedChange={setShowNumbers} />
        </div>
      ) : null}

      <FlowWorkspace
        canvas={
          <FlowCanvas
            draft={draft}
            editing={readOnly ? null : { onInsert: insert, stepMenu }}
            entry={{
              countLine: origin === "builder" ? entryCountLine(liveCount) : null,
              modeLabel: origin === "builder" ? (ENTRY_MODE_OPTIONS.find((option) => option.value === draft.entry.mode)?.label ?? null) : null,
              sentence: entrySentence({ audience: draft.entry.audience, names, origin, sourceTitle: source?.title })
            }}
            names={names}
            narrow={!wide}
            numbers={canvasNumbers}
            onSelect={select}
            onSideChange={(conditionId, side) => setSides((current) => ({ ...current, [conditionId]: side }))}
            problems={problems}
            schoolIconUrl={options.branding.iconUrl}
            selectedId={selected ?? entryNode?.id ?? null}
            senderOf={(userId) => {
              const person = userId ? senders.find((sender) => sender.id === userId) : null;
              return person ? { avatarUrl: person.avatarUrl, name: person.name } : null;
            }}
            sides={sides}
            titleOf={titleOf}
          />
        }
        onSheetOpenChange={setSheetOpen}
        panel={panelWithBack}
        panelDescription={panelDescription}
        panelTitle={panelTitle}
        sheetOpen={sheetOpen}
        wide={wide}
      />

      <ConfirmDialog
        busy={busy !== null}
        confirmLabel={confirm === "apply" ? "Aplicar" : "Ativar"}
        description={
          confirm === "apply"
            ? `≈ ${formatReportValue(liveCount)} alunos entram com as novas regras.`
            : `${activationDescription(draft.entry.mode, liveCount)} ${review}`
        }
        onConfirm={() => void (confirm === "apply" ? apply() : activate())}
        onOpenChange={(open) => {
          if (!open && busy === null) {
            setConfirm(null);
          }
        }}
        open={confirm !== null}
        title={confirm === "apply" ? "Aplicar alterações?" : "Ativar o fluxo?"}
      />
      <FlowRemoveDialog onCancel={() => setRemoving(null)} onConfirm={confirmRemove} target={removing} />
      {flowActions.confirmDialog}
    </AdminPage>
  );
}
