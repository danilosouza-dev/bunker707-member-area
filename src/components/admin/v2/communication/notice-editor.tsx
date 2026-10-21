"use client";

import { Hourglass, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import { MemberFilterPills } from "@/components/member/ui/member-filters";
import { previewNoticeAudience, publishNotice, saveNoticeDraft, saveNoticeFollowUps, sendFollowUpTestToMe, sendNoticeTestToMe } from "@/server/communications/actions";
import { describeAudience, normalizeAudience, type AudienceDefinition } from "@/server/communications/audience-model";
import {
  APPROVAL_THRESHOLD,
  describeNoticeReview,
  formatSaoPauloDateTime,
  type CampaignKind,
  type CampaignStatus,
  type NoticePermissions
} from "@/server/communications/campaign-model";
import { describeValidity, type Validity } from "@/server/communications/message-meta";
import { saveNoticeFollowUpsSchema } from "@/server/communications/flow-schemas";
import type { NoticeDetail, NoticeEditorOptions } from "@/server/communications/queries";
import { audienceDefinitionSchema, emptyNoticeDraft, noticeDraftSchema, publishProblems, type NoticeDraft } from "@/server/communications/schemas";
import { ErrorBanner } from "../error-banner";
import { PillGroup } from "../form";
import type { PreviewDevice } from "../member-area/preview-frame";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { useWarnBeforeUnload } from "../products/use-warn-before-unload";
import { ConfirmDialog, SectionCard } from "../settings/kit";
import { StatusChip } from "../status-chip";
import type { ProductPickerItem } from "../storefront/product-picker";
import { adminCard } from "../styles";
import { adminToast } from "../toast";
import { useAdminTopbarTitle } from "../topbar-title";
import { AudienceBuilder, AudienceCount, type AudienceCountState } from "./audience-builder";
import {
  FOLLOW_UPS_COPY,
  countFollowUps,
  findFollowUp,
  followUpFormItemsOf,
  followUpParentOf,
  followUpPreviewAnchorExpiry,
  followUpPreviewOptions,
  followUpsStateKey,
  followUpsToSave,
  followUpErrorAt,
  followUpTreeErrors,
  goalOfStopLine,
  parentOfItem,
  popupSwitchConfirm,
  stopLineOfGoal,
  stopProductName,
  type FollowUpFormItem,
  type FollowUpPreviewChoice,
  type FollowUpStopLine
} from "./follow-ups-view-model";
import { NoticeContentFields } from "./notice-content-fields";
import { NoticeFollowUps, ViewAsFlowLink } from "./notice-follow-ups";
import { NoticePreview } from "./notice-preview";
import { NoticeRowMenu, useNoticeActions, type NoticeActionTarget } from "./notice-row-menu";
import { NoticeValidityField } from "./notice-validity-field";
import { NoticeWhenFields } from "./notice-when-fields";
import {
  NOTHING_TO_SAVE_MESSAGE,
  NOTICES_HREF,
  PRIMARY_INTENT_LABELS,
  audienceErrorsFrom,
  audienceMessageOptions,
  audienceNamesWithMessages,
  canonicalNoticeDraft,
  isLivePopupStatus,
  isNoticeKindLocked,
  isSameNoticeDraft,
  noticeDraftForKind,
  noticeErrorsFrom,
  noticeErrorsFromAction,
  noticeFailureTitle,
  noticeHref,
  noticeStatusAfterPublish,
  primaryIntentFor,
  publishedNoticeToast,
  rebaseNoticeDraft,
  savedNoticeToast,
  testSentToast,
  type NoticeFieldErrors,
  type NoticeSenderChoice
} from "./notices-view-model";

// Editor de aviso (docs/22 §2.2; docs/17 §1.8.2; v2 em docs/23): uma pagina com o formulario a esquerda
// (O que, Imagem e audio, Botao, Resposta, Para quem, Quando, Revisao) e a previa ao vivo a direita com
// os componentes reais do aluno. Modelo: o editor do Destaque (member-area/home-hero/hero-editor.tsx).
// O conteudo (titulo ate a resposta, com quem envia e o icone) e o NoticeContentFields, o mesmo da
// notificacao seguinte e do construtor de fluxos; "Fica no sino por" fica no cartao "Quando".
//
// - "Salvar rascunho" grava pela Server Action saveNoticeDraft com a versao lida (409 -> banner
//   "Este aviso mudou em outra tela" com Recarregar, mantendo o rascunho). Cmd/Ctrl+Enter salva. Sem
//   mudanca, nao grava (gravar volta agendado e aguardando aprovacao para rascunho).
// - O botao principal salva e publica com a versao devolvida: "Enviar agora", "Agendar envio",
//   "Publicar pop-up" ou "Enviar para aprovação" (publishDecision com a contagem ao vivo; o servidor
//   decide de novo e conta outra vez).
// - Pop-up no ar ou pausado: o botao principal so salva (continua no ar).
// - A contagem do segmento vem do servidor (previewNoticeAudience) 500 ms depois da ultima mudanca.
// - Imagem: recorte WebP no navegador e envio logo depois (uploadNoticeImage). Audio: NoticeAudioField.

type NoticeEditorProps = {
  /** Tipo de um aviso novo (?tipo=popup abre em pop-up). */
  defaultKind: CampaignKind;
  initial: NoticeDetail | null;
  /** Hora da leitura (servidor): base do "agora" na previa. */
  now: number;
  options: NoticeEditorOptions;
  permissions: NoticePermissions;
};

type Failure = { message: string; status: number; title: string };
type Busy = "publish" | "save" | "test" | null;
type SavedVersion = { id: string; status: CampaignStatus; updatedAt: string };

const KIND_OPTIONS = [
  { label: "Notificação no sino", value: "inbox" },
  { label: "Pop-up na home", value: "popup" }
] as const satisfies readonly { label: string; value: CampaignKind }[];

const DEVICE_OPTIONS = [
  { label: "Computador", value: "desktop" },
  { label: "Celular", value: "mobile" }
] as const satisfies readonly { label: string; value: PreviewDevice }[];

const COUNT_DEBOUNCE_MS = 500;

/** Elemento que recebe foco quando o campo tem erro (na ordem da tela). */
const FIELD_FOCUS: readonly [string, string][] = [
  ["kind", "[name='aviso-tipo']"],
  ["title", "#aviso-titulo"],
  ["body", "#aviso-texto"],
  ["sender", "#aviso-quem-envia"],
  ["icon", "#aviso-icone [aria-checked='true']"],
  ["image", "[aria-labelledby='aviso-imagem-label']"],
  ["audio", "#aviso-audio"],
  ["cta.label", "#aviso-botao-texto"],
  ["cta.href", "#aviso-botao-produto, [name='aviso-botao-pagina'], #aviso-botao-link"],
  ["cta", "#aviso-botao-mostrar"],
  ["response.acceptLabel", "#aviso-aceitar"],
  ["response.declineLabel", "#aviso-recusar"],
  ["response", "#aviso-resposta"],
  ["audience", "[name='aviso-para-quem']"],
  ["schedule", "#aviso-envio-data"],
  ["validity.endsAt", "#aviso-validade-fim-data"],
  ["validity.minutes", "#aviso-validade-numero"],
  ["validity", "[name='aviso-validade']"],
  ["window.startsAt", "#aviso-inicio-data"],
  ["window", "#aviso-fim-data"],
  // v2: "Depois desta notificação" (o cartao recebe o foco; o campo com erro fica marcado nele).
  ["goal", "#aviso-seguintes-parar"],
  ["followUps", "#aviso-seguintes"]
];

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function focusFirstError(errors: NoticeFieldErrors) {
  const keys = Object.keys(errors);

  if (keys.length === 0) {
    return;
  }

  let selector: string | null = null;
  const audienceKey = Object.keys(audienceErrorsFrom(errors)).find((key) => key !== "");

  for (const [prefix, target] of FIELD_FOCUS) {
    if (keys.some((key) => key === prefix || key.startsWith(`${prefix}.`))) {
      selector = prefix === "audience" && audienceKey !== undefined ? `#aviso-regra-${audienceKey.replace(/\./g, "-")}` : target;
      break;
    }
  }

  window.requestAnimationFrame(() => {
    const element = selector ? document.querySelector<HTMLElement>(selector) : null;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  });
}

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

/** As seguintes como o servidor gravou, no formato do cartao (v2, "Depois desta notificação"). */
function followUpsStateOf(detail: NoticeDetail | null, entryId: string): { items: FollowUpFormItem[]; stop: FollowUpStopLine } {
  const followUps = detail?.followUps ?? null;

  return {
    items: detail && followUps?.items ? followUpFormItemsOf(followUps.items, followUpParentOf(entryId, "main", detail.draft)) : [],
    stop: stopLineOfGoal(followUps?.goal ?? null)
  };
}

/** Placeholders validos para conferir as seguintes no navegador com o mesmo schema da Server Action. */
const FOLLOW_UPS_CHECK_INPUT = { expectedNoticeUpdatedAt: "2026-01-01T00:00:00.000Z", noticeId: "00000000-0000-4000-8000-000000000000" } as const;

function Note({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function NoticeEditor({ defaultKind, initial, now, options, permissions }: NoticeEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<NoticeDraft>(() => initial?.draft ?? emptyNoticeDraft(defaultKind));
  const [saved, setSaved] = useState<NoticeDraft>(() => initial?.draft ?? emptyNoticeDraft(defaultKind));
  const [savedVersion, setSavedVersion] = useState<SavedVersion | null>(() =>
    initial ? { id: initial.id, status: initial.status, updatedAt: initial.updatedAt } : null
  );
  // Ultima versao vinda do servidor: "Recarregar" (depois de um 409) traz outra e a tela segue o banco
  // sem perder o que o produtor mudou.
  const [serverVersion, setServerVersion] = useState<string | null>(initial?.updatedAt ?? null);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [serverErrors, setServerErrors] = useState<NoticeFieldErrors>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [imageUpload, setImageUpload] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState<string | null>(null);
  // Equipe de "Quem envia" (relida quando a pessoa volta de Perfil com a foto nova).
  const [senders, setSenders] = useState<NoticeSenderChoice[]>(() => options.senders);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [count, setCount] = useState<AudienceCountState>(() =>
    initial?.audienceCount !== null && initial?.audienceCount !== undefined
      ? { previous: { count: initial.audienceCount, sample: [] }, status: "loading" }
      : { previous: null, status: "loading" }
  );
  const [countAttempt, setCountAttempt] = useState(0);
  // Remonta os campos com memoria propria (botao, datas) quando o rascunho e trocado de uma vez.
  const [resetKey, setResetKey] = useState(0);
  const countRequest = useRef(0);
  const rememberedResponse = useRef<NoticeDraft["response"]>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const saveShortcut = useRef<() => void>(() => undefined);
  // v2 "Depois desta notificação": as seguintes (estado do formulario: trocar para pop-up e voltar antes de
  // salvar traz de volta), a versao do fluxo do aviso e o que foi gravado por ultimo (dirty).
  const [entryId, setEntryId] = useState(() => initial?.followUps?.entryNodeId ?? crypto.randomUUID());
  const [followUps, setFollowUps] = useState(() => followUpsStateOf(initial, initial?.followUps?.entryNodeId ?? ""));
  const [flowVersion, setFlowVersion] = useState<{ flowId: string | null; updatedAt: string | null }>(() => ({
    flowId: initial?.followUps?.flowId ?? null,
    updatedAt: initial?.followUps?.updatedAt ?? null
  }));
  const [serverFlowVersion, setServerFlowVersion] = useState<string | null>(initial?.followUps?.updatedAt ?? null);
  const [savedFollowUpsKey, setSavedFollowUpsKey] = useState(() => {
    const entry = initial?.followUps?.entryNodeId ?? "";
    const state = followUpsStateOf(initial, entry);

    return initial ? followUpsStateKey(state.items, state.stop, followUpParentOf(entry, "main", initial.draft)) : followUpsStateKey([], state.stop, followUpParentOf("", "main", emptyNoticeDraft(defaultKind)));
  });
  const [followUpUpload, setFollowUpUpload] = useState<string | null>(null);
  const [followUpAudioBusy, setFollowUpAudioBusy] = useState<string | null>(null);
  const [testBusyId, setTestBusyId] = useState<string | null>(null);
  const [kindConfirm, setKindConfirm] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<FollowUpPreviewChoice>("main");

  if (initial && initial.updatedAt !== serverVersion) {
    setServerVersion(initial.updatedAt);

    if (!savedVersion || Date.parse(initial.updatedAt) !== Date.parse(savedVersion.updatedAt)) {
      setDraft(rebaseNoticeDraft(saved, draft, initial.draft));
      setSaved(initial.draft);
      setSavedVersion({ id: initial.id, status: initial.status, updatedAt: initial.updatedAt });
      setFailure(null);
      setServerErrors({});
      setResetKey((key) => key + 1);
    }
  }

  const status = savedVersion?.status ?? null;
  const livePopup = isLivePopupStatus(draft.kind, status);
  const kindLocked = isNoticeKindLocked(status);
  // v2: as seguintes so mudam aqui antes do envio (depois, no relatorio); arvore do construtor = so leitura.
  const followUpsMode = initial?.followUps?.mode ?? { kind: "edit" as const };
  const followUpsEditable = followUpsMode.kind === "edit";
  const mainFollowUpParent = useMemo(
    () => followUpParentOf(entryId, "main", draft, draft.schedule.mode === "at" ? Date.parse(draft.schedule.sendAt) : now),
    [draft, entryId, now]
  );
  const followUpsKey = followUpsStateKey(followUps.items, followUps.stop, mainFollowUpParent);
  // Pop-up com fluxo gravado: salvar tira o fluxo (tambem o que so o construtor desenha).
  const followUpsDirty =
    draft.kind === "popup"
      ? flowVersion.flowId !== null
      : followUpsEditable && (followUpsKey !== savedFollowUpsKey || (flowVersion.flowId === null && followUps.items.length > 0));
  const followUpsCount = followUps.items.length > 0 ? countFollowUps(followUps.items) : flowVersion.flowId ? (initial?.followUps?.count ?? 0) : 0;
  const dirty = !isSameNoticeDraft(saved, draft) || followUpsDirty;
  const uploading = imageUpload !== null || followUpUpload !== null;

  // O fluxo do aviso mudou no servidor (outra tela, "Recarregar"): a versao segue o banco; sem mudanca
  // local, as seguintes tambem (com mudanca, o que o produtor escreveu fica e grava por cima).
  if (initial?.followUps && initial.followUps.updatedAt !== serverFlowVersion) {
    setServerFlowVersion(initial.followUps.updatedAt);

    if (initial.followUps.updatedAt !== flowVersion.updatedAt) {
      setFlowVersion({ flowId: initial.followUps.flowId, updatedAt: initial.followUps.updatedAt });

      if (!followUpsDirty) {
        const entry = initial.followUps.entryNodeId ?? entryId;
        const state = followUpsStateOf(initial, entry);
        setEntryId(entry);
        setFollowUps(state);
        setSavedFollowUpsKey(followUpsStateKey(state.items, state.stop, followUpParentOf(entry, "main", initial.draft)));
      }
    }
  }

  const locked = busy !== null;
  const pickerItems = useMemo(() => toPickerItems(options.products), [options.products]);
  const payload = useMemo(() => noticeDraftForKind(draft), [draft]);
  const clientErrors = useMemo(() => {
    const parsed = noticeDraftSchema.safeParse(payload);

    return parsed.success ? {} : noticeErrorsFrom(parsed.error.issues);
  }, [payload]);
  // As seguintes conferidas no navegador com o mesmo schema e a mesma arvore do servidor.
  const followUpErrors = useMemo(() => {
    if (draft.kind !== "inbox" || !followUpsEditable || followUps.items.length === 0) {
      return {};
    }

    const drafts = followUpsToSave("inbox", followUps.items, mainFollowUpParent);
    const parsed = saveNoticeFollowUpsSchema.safeParse({ ...FOLLOW_UPS_CHECK_INPUT, followUps: drafts, goal: goalOfStopLine(followUps.stop) });

    return { ...followUpTreeErrors({ drafts, entryId, notice: draft }), ...(parsed.success ? {} : noticeErrorsFrom(parsed.error.issues)) };
  }, [draft, entryId, followUps, followUpsEditable, mainFollowUpParent]);
  const audienceKey = JSON.stringify(normalizeAudience(draft.audience));
  const audienceValid = useMemo(() => audienceDefinitionSchema.safeParse(JSON.parse(audienceKey)).success, [audienceKey]);

  useWarnBeforeUnload(dirty || uploading || audioBusy !== null);
  useAdminTopbarTitle(initial ? initial.title : "Novo aviso");

  // Contagem ao vivo do segmento (500 ms depois da ultima mudanca; resposta velha e ignorada).
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

          setCount(
            result.ok
              ? { count: result.data.count, sample: result.data.sample, status: "ready" }
              : { message: result.error || "Não foi possível contar agora.", status: "error" }
          );
        })
        .catch(() => {
          if (countRequest.current === request) {
            setCount({ message: "Não foi possível contar agora.", status: "error" });
          }
        });
    }, COUNT_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [audienceKey, audienceValid, countAttempt]);

  // Cmd/Ctrl+Enter salva o rascunho (o atalho le a versao mais nova da funcao).
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

  const countView: AudienceCountState = audienceValid ? count : { status: "incomplete" };
  const liveCount = countView.status === "ready" ? countView.count : countView.status === "loading" ? (countView.previous?.count ?? null) : null;
  const intent = primaryIntentFor({ audienceCount: liveCount, kind: draft.kind, permissions, scheduleMode: draft.schedule.mode });
  const needsApproval = liveCount !== null && liveCount > APPROVAL_THRESHOLD && !permissions.canPublishLarge;
  const audienceErrors = audienceErrorsFrom(submitted ? { ...clientErrors, ...serverErrors } : serverErrors);
  const incompleteDate = (value: string | null) => value !== null && !Number.isFinite(Date.parse(value));
  const scheduleIncomplete =
    draft.kind === "inbox"
      ? draft.schedule.mode === "at" && incompleteDate(draft.schedule.sendAt)
      : incompleteDate(draft.window.startsAt) || incompleteDate(draft.window.endsAt);
  const reviewSentence = scheduleIncomplete
    ? `Escolha a data e a hora ${draft.kind === "inbox" ? "do envio" : "da janela"} para ver o resumo.`
    : describeNoticeReview({
        audienceCount: liveCount,
        followUps:
          draft.kind === "inbox" && followUps.items.length > 0
            ? { count: countFollowUps(followUps.items), stopProductName: stopProductName(followUps.stop, options.names) }
            : null,
        kind: draft.kind,
        repeat: draft.repeat,
        schedule: payload.schedule,
        // "Ate uma data" ainda sem data e hora: a frase espera (o campo ja pede "Escolha data e hora.").
        validity: draft.validity.mode === "until" && !Number.isFinite(Date.parse(draft.validity.endsAt)) ? null : describeValidity(payload.validity),
        window: payload.window
      });
  const audienceNames = useMemo(
    () => audienceNamesWithMessages(options.names, audienceMessageOptions("segment", { notices: options.notices })),
    [options.names, options.notices]
  );
  const audienceDescription = describeAudience(normalizeAudience(draft.audience), audienceNames);
  // Nomes das frases das seguintes: a principal e cada seguinte pelo passo ("node:<id>").
  const followUpNames = useMemo(() => {
    const messages: Record<string, string> = { ...audienceNames.messages, ...initial?.followUps?.names.messages, [`node:${entryId}`]: draft.title.trim() || "Sem título" };
    const walk = (items: readonly FollowUpFormItem[]) =>
      items.forEach((item) => {
        messages[`node:${item.id}`] = item.content.title.trim() || "Sem título";
        walk(item.children);
      });

    walk(followUps.items);

    return { ...audienceNames, messages, products: { ...initial?.followUps?.names.products, ...audienceNames.products } };
  }, [audienceNames, draft.title, entryId, followUps.items, initial?.followUps?.names]);
  const followUpOptions = useMemo(
    () => ({
      branding: options.branding,
      canEditBrand: options.canEditBrand,
      cohorts: options.cohorts,
      notices: options.notices,
      products: pickerItems,
      productsLoaded: options.productsLoaded,
      segments: options.segments,
      senders
    }),
    [options, pickerItems, senders]
  );
  const shownFollowUpErrors = useMemo(() => {
    const fromServer = Object.fromEntries(Object.entries(serverErrors).filter(([key]) => key === "goal" || key.startsWith("goal.") || key === "followUps" || key.startsWith("followUps.")));

    return { ...(submitted ? followUpErrors : {}), ...fromServer };
  }, [followUpErrors, serverErrors, submitted]);
  const previewLocation = draft.kind === "inbox" && previewTarget !== "main" ? findFollowUp(followUps.items, previewTarget) : null;
  const sendAtTime = draft.schedule.mode === "at" ? Date.parse(draft.schedule.sendAt) : now;
  const savedSender = initial?.sender ? { id: initial.sender.id, name: initial.sender.name } : null;

  function errorFor(key: string) {
    return serverErrors[key] ?? (submitted || touched.has(key) ? clientErrors[key] : undefined);
  }

  function touch(key: string) {
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
  }

  function clearServerErrors(prefixes: readonly string[]) {
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

  function change(patch: Partial<NoticeDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    clearServerErrors(Object.keys(patch));

    if (failure && failure.status !== 409) {
      setFailure(null);
    }
  }

  function changeKind(kind: CampaignKind) {
    if (kind === draft.kind) {
      return;
    }

    // A resposta so vale para notificacao: guarda ao ir para pop-up e devolve ao voltar.
    if (kind === "popup") {
      rememberedResponse.current = draft.response;
      change({ kind, response: null });
      return;
    }

    change({ kind, response: rememberedResponse.current });
  }

  function showFailure(next: Omit<Failure, "title"> & { title?: string }) {
    setFailure({ ...next, title: next.title ?? noticeFailureTitle({ savedDraft: false, status: next.status, step: "save" }) });
    window.requestAnimationFrame(() => bannerRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }));
  }

  /** Confere e grava o rascunho; devolve a versao gravada ou null (erro ja na tela). */
  async function persist(extraErrors: NoticeFieldErrors = {}): Promise<SavedVersion | null> {
    if (uploading) {
      showFailure({ message: "Espere a imagem terminar de enviar e tente de novo.", status: 0 });
      return null;
    }

    if (audioBusy || followUpAudioBusy) {
      showFailure({ message: audioBusy ?? followUpAudioBusy ?? "", status: 0 });
      return null;
    }

    setSubmitted(true);
    const errors = { ...clientErrors, ...extraErrors, ...followUpErrors };

    if (Object.keys(errors).length > 0) {
      setServerErrors(extraErrors);
      showFailure({ message: "Revise os campos destacados.", status: 400 });
      focusFirstError(errors);
      return null;
    }

    setFailure(null);
    setServerErrors({});
    const sent = payload;
    const result = await saveNoticeDraft({ draft: sent, expectedUpdatedAt: savedVersion?.updatedAt, id: savedVersion?.id });

    if (!result.ok) {
      const fieldErrors = noticeErrorsFromAction(result.fieldErrors);
      setServerErrors(fieldErrors);
      showFailure({ message: result.error, status: result.status });
      focusFirstError(fieldErrors);
      return null;
    }

    const version = { id: result.data.id, status: result.data.status, updatedAt: result.data.updatedAt };
    setSavedVersion(version);
    setSaved(canonicalNoticeDraft(sent));

    // v2: logo depois do aviso, as seguintes (pop-up grava "followUps: []": o fluxo do aviso sai).
    if (followUpsDirty) {
      const savedFollowUps = await saveNoticeFollowUps({
        expectedFlowUpdatedAt: flowVersion.updatedAt ?? undefined,
        expectedNoticeUpdatedAt: version.updatedAt,
        followUps: followUpsToSave(draft.kind, followUps.items, mainFollowUpParent),
        goal: draft.kind === "inbox" ? goalOfStopLine(followUps.stop) : null,
        noticeId: version.id
      });

      if (!savedFollowUps.ok) {
        const fieldErrors = noticeErrorsFromAction(savedFollowUps.fieldErrors);
        setServerErrors(fieldErrors);
        // O aviso ficou gravado: o banner diz que as seguintes nao, e o que foi escrito continua na tela.
        showFailure({ message: FOLLOW_UPS_COPY.partialSaveText, status: savedFollowUps.status, title: FOLLOW_UPS_COPY.partialSaveTitle });
        focusFirstError(fieldErrors);
        return null;
      }

      const nextEntry = savedFollowUps.data.entryNodeId ?? crypto.randomUUID();
      setEntryId(nextEntry);
      setFlowVersion({ flowId: savedFollowUps.data.flowId, updatedAt: savedFollowUps.data.flowUpdatedAt });
      setServerFlowVersion(savedFollowUps.data.flowUpdatedAt);
      setSavedFollowUpsKey(followUpsStateKey(followUps.items, followUps.stop, { ...mainFollowUpParent, nodeId: nextEntry }));
    }

    return version;
  }

  /**
   * Ainda no endereco de "Novo aviso" com o rascunho gravado: a tela passa para o endereco do aviso
   * (recarregar, "Recarregar" depois de um 409 e o menu de acoes valem para ele). Depende so do
   * endereco: um teste que falhou antes (rascunho gravado, banner na tela) nao impede que o proximo
   * sucesso troque o endereco. So os caminhos de sucesso chamam (trocar remonta o editor e levaria o
   * banner de erro). Nada se perde: o que esta na tela e o que foi gravado.
   */
  function openSavedNotice(id: string) {
    if (!initial) {
      router.replace(noticeHref(id), { scroll: false });
    }
  }

  async function saveDraft() {
    if (busy) {
      return;
    }

    // Nada mudou: gravar de novo cancelaria o agendamento ou o pedido de aprovacao sem motivo.
    if (savedVersion && !dirty && !uploading && !audioBusy) {
      adminToast.info(NOTHING_TO_SAVE_MESSAGE);
      openSavedNotice(savedVersion.id);
      return;
    }

    const previousStatus = status;
    setBusy("save");
    const version = await persist();
    setBusy(null);

    if (version) {
      adminToast.success(savedNoticeToast(draft.kind, previousStatus));
      openSavedNotice(version.id);
    }
  }

  async function publish() {
    if (busy) {
      return;
    }

    const problems = publishProblems(payload, Date.now());
    const extra = Object.fromEntries(problems.map((problem) => [problem.path, problem.message]));

    setBusy("publish");
    const version = await persist(extra);

    if (!version) {
      setBusy(null);
      return;
    }

    const result = await publishNotice({ expectedUpdatedAt: version.updatedAt, id: version.id });
    setBusy(null);

    if (!result.ok) {
      const fieldErrors = noticeErrorsFromAction(result.fieldErrors);
      setServerErrors(fieldErrors);
      // O rascunho ja foi gravado: o banner diz isso e a tela fica (sem trocar de endereco, que remontaria
      // o editor e levaria o banner junto).
      showFailure({ message: result.error, status: result.status, title: noticeFailureTitle({ savedDraft: true, status: result.status, step: "publish" }) });
      focusFirstError(fieldErrors);
      return;
    }

    setSavedVersion({ id: result.data.id, status: noticeStatusAfterPublish(draft.kind, result.data.situation), updatedAt: result.data.updatedAt });
    adminToast.success(publishedNoticeToast(result.data, draft.kind));
    router.push(noticeHref(result.data.id));
  }

  async function sendTest() {
    if (busy) {
      return;
    }

    const previousStatus = status;
    const saves = dirty || !savedVersion;
    setBusy("test");
    const version = saves ? await persist() : savedVersion;

    if (!version) {
      setBusy(null);
      return;
    }

    const result = await sendNoticeTestToMe({ expectedUpdatedAt: version.updatedAt, id: version.id });
    setBusy(null);

    if (!result.ok) {
      // Sem trocar de endereco: remontar o editor levaria o banner. "Abrir rascunho" fica no banner.
      showFailure({ message: result.error, status: result.status, title: noticeFailureTitle({ savedDraft: saves, status: result.status, step: "test" }) });
      return;
    }

    adminToast.success(testSentToast(saves, previousStatus));
    openSavedNotice(version.id);
  }

  /** "Enviar teste para mim" de uma seguinte: grava antes (como o teste do aviso) e manda a versao gravada. */
  async function sendFollowUpTest(nodeId: string) {
    if (busy) {
      return;
    }

    const previousStatus = status;
    const saves = dirty || !savedVersion;
    setBusy("test");
    setTestBusyId(nodeId);
    const version = saves ? await persist() : savedVersion;

    if (!version) {
      setBusy(null);
      setTestBusyId(null);
      return;
    }

    const result = await sendFollowUpTestToMe({ nodeId, noticeId: version.id });
    setBusy(null);
    setTestBusyId(null);

    if (!result.ok) {
      showFailure({ message: result.error, status: result.status, title: noticeFailureTitle({ savedDraft: saves, status: result.status, step: "test" }) });
      return;
    }

    adminToast.success(testSentToast(saves, previousStatus));
    openSavedNotice(version.id);
  }

  /** Trocar o Tipo para pop-up com seguintes pergunta antes (elas saem ao salvar). */
  function requestKind(kind: CampaignKind) {
    if (kind === "popup" && draft.kind === "inbox" && followUpsCount > 0) {
      setKindConfirm(true);
      return;
    }

    changeKind(kind);
  }

  function discard() {
    setDraft(saved);
    setServerErrors({});
    setFailure(null);
    setSubmitted(false);
    setTouched(new Set());
    setResetKey((key) => key + 1);
  }

  useEffect(() => {
    saveShortcut.current = () => void saveDraft();
  });

  const actionTarget: NoticeActionTarget | null =
    initial && savedVersion
      ? {
          actions: initial.actions,
          audienceCount: initial.audienceCount,
          id: savedVersion.id,
          kind: initial.kind,
          recipients: initial.stats.recipients,
          status: savedVersion.status,
          title: initial.title,
          updatedAt: savedVersion.updatedAt
        }
      : null;
  const noticeActions = useNoticeActions({ onDeleted: () => router.push(NOTICES_HREF) });
  const conflict = failure?.status === 409;
  const previewImage = imageUpload ?? draft.image?.url ?? null;
  const primaryLabel = livePopup ? "Salvar alterações" : PRIMARY_INTENT_LABELS[intent];
  const working = (label: string, key: Exclude<Busy, null>) => (busy === key ? (key === "publish" ? "Publicando…" : key === "test" ? "Enviando teste…" : "Salvando…") : label);

  let previewStatus: string;

  if (dirty) {
    previewStatus = livePopup ? "Mudanças não salvas: os alunos ainda veem a versão anterior." : "Rascunho: os alunos só veem depois de publicar.";
  } else if (livePopup) {
    previewStatus = status === "paused" ? "Pausado: os alunos não veem até retomar." : "É o que os alunos veem agora.";
  } else if (status === "scheduled") {
    previewStatus = "É o que os alunos vão receber.";
  } else {
    previewStatus = "Os alunos só veem depois de publicar.";
  }

  return (
    <AdminPage className="gap-6 pb-28">
      <PageHeader
        actions={
          actionTarget ? <NoticeRowMenu exclude={["edit", "send_test", "approve", "reject"]} notice={actionTarget} onRequest={noticeActions.request} /> : null
        }
        breadcrumb={[{ href: NOTICES_HREF, label: "Avisos e pop-ups" }, { label: initial ? "Editar aviso" : "Novo aviso" }]}
        description={
          initial ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusChip tone={initial.situationTone}>{initial.situationLabel}</StatusChip>
              <span>{initial.kindLabel}</span>
            </span>
          ) : (
            "Uma notificação no sino ou um pop-up na home, para um segmento."
          )
        }
        title={initial ? initial.title : "Novo aviso"}
      />

      {noticeActions.errorBanner}

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {status === "pending_approval" ? (
            <Note icon={<Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />}>
              <p className="font-medium text-[var(--text-primary)]">Aguardando aprovação de um dono ou administrador.</p>
              <p>
                {initial?.requestedBy ? `Pedido por ${initial.requestedBy.name}${initial.requestedAt ? ` em ${formatSaoPauloDateTime(initial.requestedAt)}` : ""}. ` : ""}
                Salvar uma mudança volta o aviso para rascunho e cancela o pedido.
              </p>
              {permissions.canPublishLarge && actionTarget ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    className="px-3"
                    disabled={locked}
                    onClick={() =>
                      dirty
                        ? showFailure({ message: "Salve as mudanças antes de aprovar.", status: 0, title: noticeFailureTitle({ savedDraft: false, status: 0, step: "approve" }) })
                        : noticeActions.request("approve", actionTarget)
                    }
                    type="button"
                  >
                    Aprovar e publicar
                  </Button>
                  <Button className="px-3" disabled={locked} onClick={() => noticeActions.request("reject", actionTarget)} type="button" variant="secondary">
                    Recusar
                  </Button>
                </div>
              ) : null}
            </Note>
          ) : null}

          {status === "scheduled" && initial?.sendAt ? (
            <Note icon={<Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
              Agendado para {formatSaoPauloDateTime(initial.sendAt)}. Salvar uma mudança volta o aviso para rascunho: agende de novo depois.
            </Note>
          ) : null}

          {livePopup ? (
            <Note icon={<Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
              {status === "paused"
                ? "Este pop-up está pausado. As mudanças valem quando ele voltar ao ar."
                : "Este pop-up está no ar. As mudanças valem assim que você salvar; quem já fechou não vê de novo."}
            </Note>
          ) : null}

          {failure ? (
            <div ref={bannerRef}>
              <ErrorBanner
                action={
                  conflict ? (
                    <Button
                      className="px-3"
                      onClick={() => {
                        setFailure(null);

                        // Ainda no endereco de "Novo aviso" (publicar falhou depois de gravar): abre o aviso.
                        if (!initial && savedVersion) {
                          router.replace(noticeHref(savedVersion.id), { scroll: false });
                          return;
                        }

                        router.refresh();
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Recarregar
                    </Button>
                  ) : (
                    <>
                      {/* Ainda em "Novo aviso", mas o rascunho ja foi gravado: abre o endereco dele. */}
                      {!initial && savedVersion ? (
                        <Button
                          className="px-3"
                          onClick={() => {
                            setFailure(null);
                            router.replace(noticeHref(savedVersion.id), { scroll: false });
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Abrir rascunho
                        </Button>
                      ) : null}
                      <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
                        Fechar
                      </Button>
                    </>
                  )
                }
                title={failure.title}
              >
                {conflict ? `${failure.message} O que você mudou aqui continua no rascunho.` : failure.message}
              </ErrorBanner>
            </div>
          ) : null}

          <NoticeContentFields
            canEditBrand={options.canEditBrand}
            disabled={locked}
            errorFor={errorFor}
            kind={draft.kind}
            leading={
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Tipo</span>
                <PillGroup ariaLabel="Tipo do aviso" disabled={locked || kindLocked} name="aviso-tipo" onChange={requestKind} options={KIND_OPTIONS} value={draft.kind} />
                <p className="text-xs leading-5 text-[var(--text-secondary)]">
                  {kindLocked
                    ? "O tipo não muda depois de publicado. Para trocar, duplique o aviso."
                    : draft.kind === "inbox"
                      ? "O aluno vê quando abrir o sino."
                      : "Aparece no centro da home, 3 segundos depois de abrir. Nunca durante uma aula."}
                </p>
              </div>
            }
            onAudioBusyChange={setAudioBusy}
            onBlurField={touch}
            // Sem "Fica no sino por" aqui (showValidity false): ele fica no cartao "Quando".
            onChange={(patch) => change(patch as Partial<NoticeDraft>)}
            onImageUploadChange={setImageUpload}
            onSendersChange={setSenders}
            products={pickerItems}
            productsLoaded={options.productsLoaded}
            resetKey={resetKey}
            savedSender={savedSender}
            schoolIconUrl={options.branding.iconUrl}
            schoolName={options.branding.name}
            sendAt={sendAtTime}
            senders={senders}
            showValidity={false}
            value={draft}
          />

          <SectionCard description="Todos os alunos ou só quem combina com as regras." title="Para quem">
            <div className="flex min-w-0 flex-col gap-4">
              <AudienceBuilder
                cohorts={options.cohorts}
                disabled={locked}
                errors={audienceErrors}
                notices={options.notices}
                onChange={(audience) => change({ audience })}
                products={pickerItems}
                productsLoaded={options.productsLoaded}
                segments={options.segments}
                value={draft.audience}
              />
              <AudienceCount description={audienceDescription} needsApproval={needsApproval} onRetry={() => setCountAttempt((attempt) => attempt + 1)} state={countView} />
            </div>
          </SectionCard>

          <SectionCard
            description={draft.kind === "inbox" ? "Agora ou numa data e hora, e quanto tempo fica no sino." : "A janela em que o pop-up aparece e quantas vezes."}
            title="Quando"
          >
            <div className="flex min-w-0 flex-col gap-6">
              <NoticeWhenFields
                disabled={locked}
                key={resetKey}
                draft={draft}
                errors={{ endsAt: errorFor("window.endsAt"), sendAt: errorFor("schedule.sendAt"), startsAt: errorFor("window.startsAt") }}
                onChange={(patch) => change(patch)}
              />
              {draft.kind === "inbox" ? (
                <NoticeValidityField
                  disabled={locked}
                  errors={{ endsAt: errorFor("validity.endsAt"), minutes: errorFor("validity.minutes"), validity: errorFor("validity") }}
                  idPrefix="aviso-validade"
                  key={`validade-${resetKey}`}
                  // O aviso nunca tem "Até a notificação principal sumir" (sem anchorLabel).
                  onChange={(validity) => change({ validity: validity as Validity })}
                  sendAt={sendAtTime}
                  value={draft.validity}
                />
              ) : null}
            </div>
          </SectionCard>

          {draft.kind === "inbox" ? (
            <NoticeFollowUps
              actions={flowVersion.flowId ? <ViewAsFlowLink flowId={flowVersion.flowId} /> : undefined}
              contentErrorOf={(path) => followUpErrorAt(shownFollowUpErrors, `${path}.content`)}
              disabled={locked}
              errorFor={(path) => followUpErrorAt(shownFollowUpErrors, path)}
              fieldErrorFor={(path) => shownFollowUpErrors[path]}
              flowId={flowVersion.flowId}
              flowLive={false}
              id="aviso-seguintes"
              items={followUps.items}
              lines={initial?.followUps?.lines ?? []}
              main={mainFollowUpParent}
              mainSent={false}
              mode={followUpsMode}
              names={followUpNames}
              noticeCtaHref={draft.cta?.href ?? null}
              noticeId={savedVersion?.id ?? null}
              now={now}
              onAudioBusyChange={setFollowUpAudioBusy}
              onChange={(next) => {
                setFollowUps(next);
                clearServerErrors(["followUps", "goal"]);

                if (failure && failure.status !== 409) {
                  setFailure(null);
                }
              }}
              onImageUploadChange={setFollowUpUpload}
              onSendersChange={setSenders}
              onSendTest={(nodeId) => void sendFollowUpTest(nodeId)}
              options={followUpOptions}
              stats={{}}
              stop={followUps.stop}
              testBusyId={testBusyId}
              title={FOLLOW_UPS_COPY.title}
            />
          ) : null}

          <SectionCard title="Revisão">
            <div className="flex min-w-0 flex-col gap-4">
              <p aria-live="polite" className="text-sm leading-6 text-[var(--text-primary)]">
                {livePopup ? `${reviewSentence} Já publicado: salvar mantém no ar.` : reviewSentence}
              </p>
              {intent === "approval" && !livePopup ? (
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
                  {permissions.canPublish
                    ? "Acima de 500 alunos, um dono ou administrador aprova antes de sair."
                    : "Sua função na equipe envia para um dono ou administrador aprovar antes de sair."}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button className="px-4" disabled={locked} onClick={() => void (livePopup ? saveDraft() : publish())} type="button">
                  {livePopup ? working(primaryLabel, "save") : working(primaryLabel, "publish")}
                </Button>
                {livePopup ? (
                  dirty ? (
                    <Button className="px-4" disabled={locked} onClick={discard} type="button" variant="secondary">
                      Descartar mudanças
                    </Button>
                  ) : null
                ) : (
                  <Button className="px-4" disabled={locked} onClick={() => void saveDraft()} type="button" variant="secondary">
                    {working("Salvar rascunho", "save")}
                  </Button>
                )}
                {draft.kind === "inbox" && !livePopup ? (
                  <Button className="px-4" disabled={locked} onClick={() => void sendTest()} type="button" variant="secondary">
                    {working("Enviar teste para mim", "test")}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs leading-5 text-[var(--text-tertiary)]">
                {draft.kind === "inbox" && !livePopup ? "O teste chega só no seu sino e não conta nos números. " : ""}
                Ctrl+Enter (⌘+Enter no Mac) salva {livePopup ? "as alterações" : "o rascunho"}.
              </p>
            </div>
          </SectionCard>
        </div>

        {/* Fixa ao rolar; mais alta que a janela, rola por dentro (o fim do aviso nunca fica escondido). */}
        <section
          aria-labelledby="aviso-previa-titulo"
          className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain")}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="aviso-previa-titulo">
                Prévia
              </h2>
              <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-secondary)]">
                {previewStatus}
              </p>
            </div>
            <PillGroup ariaLabel="Aparelho da prévia" name="aviso-previa-aparelho" onChange={setDevice} options={DEVICE_OPTIONS} value={device} />
          </div>
          {draft.kind === "inbox" && followUps.items.length > 0 ? (
            <MemberFilterPills
              ariaLabel="Qual notificação a prévia mostra"
              // 44 px no toque, como as pilulas do aparelho logo acima.
              className="mx-0 px-0 sm:mx-0 sm:px-0 pointer-coarse:[&>button]:h-11"
              onChange={setPreviewTarget}
              options={followUpPreviewOptions(followUps.items)}
              value={previewLocation ? previewTarget : "main"}
            />
          ) : null}
          {previewLocation ? (
            <NoticePreview
              anchorExpiresAt={followUpPreviewAnchorExpiry(previewLocation.item.when, parentOfItem(previewLocation, mainFollowUpParent), now)}
              branding={options.branding}
              device={device}
              draft={{ ...previewLocation.item.content, kind: "inbox" }}
              imageUrl={followUpUpload}
              key={previewLocation.item.id}
              now={now}
              senders={senders}
            />
          ) : (
            <NoticePreview branding={options.branding} device={device} draft={draft} imageUrl={previewImage} now={now} senders={senders} />
          )}
        </section>
      </div>

      {noticeActions.confirmDialog}

      <ConfirmDialog
        confirmLabel={popupSwitchConfirm(followUpsCount).confirmLabel}
        description={popupSwitchConfirm(followUpsCount).description}
        onConfirm={() => {
          setKindConfirm(false);
          setPreviewTarget("main");
          changeKind("popup");
        }}
        onOpenChange={setKindConfirm}
        open={kindConfirm}
        title={popupSwitchConfirm(followUpsCount).title}
      />
    </AdminPage>
  );
}
