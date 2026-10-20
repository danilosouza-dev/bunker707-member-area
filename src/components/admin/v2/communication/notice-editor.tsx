"use client";

import { Hourglass, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import { previewNoticeAudience, publishNotice, saveNoticeDraft, sendNoticeTestToMe, uploadNoticeImage } from "@/server/communications/actions";
import { describeAudience, normalizeAudience, type AudienceDefinition } from "@/server/communications/audience-model";
import {
  APPROVAL_THRESHOLD,
  NOTICE_LIMITS,
  describeNoticeReview,
  formatSaoPauloDateTime,
  type CampaignKind,
  type CampaignStatus,
  type NoticePermissions
} from "@/server/communications/campaign-model";
import type { NoticeDetail, NoticeEditorOptions } from "@/server/communications/queries";
import { audienceDefinitionSchema, emptyNoticeDraft, noticeDraftSchema, publishProblems, type NoticeDraft } from "@/server/communications/schemas";
import { ErrorBanner } from "../error-banner";
import { PillGroup } from "../form";
import { HeroTextField } from "../member-area/home-hero/fields";
import type { PreviewDevice } from "../member-area/preview-frame";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { ImageField } from "../products/image-field";
import { useWarnBeforeUnload } from "../products/use-warn-before-unload";
import { AdminSwitch, SectionCard } from "../settings/kit";
import { StatusChip } from "../status-chip";
import type { ProductPickerItem } from "../storefront/product-picker";
import { adminCard } from "../styles";
import { adminToast } from "../toast";
import { useAdminTopbarTitle } from "../topbar-title";
import { AudienceBuilder, AudienceCount, type AudienceCountState } from "./audience-builder";
import { NoticeAudioField } from "./notice-audio-field";
import { NoticeCtaField } from "./notice-cta-field";
import { NoticePreview } from "./notice-preview";
import { NoticeRowMenu, useNoticeActions, type NoticeActionTarget } from "./notice-row-menu";
import { NoticeWhenFields } from "./notice-when-fields";
import {
  NOTICES_HREF,
  PRIMARY_INTENT_LABELS,
  audienceErrorsFrom,
  canonicalNoticeDraft,
  isLivePopupStatus,
  isNoticeKindLocked,
  isSameNoticeDraft,
  noticeDraftForKind,
  noticeErrorsFrom,
  noticeErrorsFromAction,
  noticeHref,
  primaryIntentFor,
  publishedNoticeToast,
  rebaseNoticeDraft,
  type NoticeFieldErrors
} from "./notices-view-model";

// Editor de aviso (docs/22 §2.2; docs/17 §1.8.2): uma pagina com o formulario a esquerda (O que,
// Imagem e audio, Botao, Resposta, Para quem, Quando, Revisao) e a previa ao vivo a direita com os
// componentes reais do aluno. Modelo: o editor do Destaque (member-area/home-hero/hero-editor.tsx).
//
// - "Salvar rascunho" grava pela Server Action saveNoticeDraft com a versao lida (409 -> banner
//   "Este aviso mudou em outra tela" com Recarregar, mantendo o rascunho). Cmd/Ctrl+Enter salva.
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

type Failure = { message: string; status: number };
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
  ["window.startsAt", "#aviso-inicio-data"],
  ["window", "#aviso-fim-data"]
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
  const [imageError, setImageError] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState<string | null>(null);
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
  const dirty = !isSameNoticeDraft(saved, draft);
  const uploading = imageUpload !== null;
  const locked = busy !== null;
  const pickerItems = useMemo(() => toPickerItems(options.products), [options.products]);
  const payload = useMemo(() => noticeDraftForKind(draft), [draft]);
  const clientErrors = useMemo(() => {
    const parsed = noticeDraftSchema.safeParse(payload);

    return parsed.success ? {} : noticeErrorsFrom(parsed.error.issues);
  }, [payload]);
  const audienceKey = JSON.stringify(normalizeAudience(draft.audience));
  const audienceValid = useMemo(() => audienceDefinitionSchema.safeParse(JSON.parse(audienceKey)).success, [audienceKey]);
  const limits = NOTICE_LIMITS[draft.kind];

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
    : describeNoticeReview({ audienceCount: liveCount, kind: draft.kind, repeat: draft.repeat, schedule: payload.schedule, window: payload.window });
  const audienceDescription = describeAudience(normalizeAudience(draft.audience), options.names);

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

  async function changeImage(value: string | null) {
    setImageError(null);
    touch("image.url");

    // Remover ou link https colado (sem recorte): vai direto para o rascunho.
    if (value === null || !value.startsWith("data:")) {
      setDraft((current) => ({ ...current, image: value ? { alt: current.image?.alt ?? "", url: value } : null }));
      clearServerErrors(["image"]);
      return;
    }

    setImageUpload(value);
    const result = await uploadNoticeImage({ image: value });
    setImageUpload(null);

    if (!result.ok) {
      setImageError(result.fieldErrors?.image?.[0] ?? result.error);
      return;
    }

    setDraft((current) => ({ ...current, image: { alt: current.image?.alt ?? "", url: result.data.url } }));
    clearServerErrors(["image"]);
  }

  function showFailure(next: Failure) {
    setFailure(next);
    window.requestAnimationFrame(() => bannerRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }));
  }

  /** Confere e grava o rascunho; devolve a versao gravada ou null (erro ja na tela). */
  async function persist(extraErrors: NoticeFieldErrors = {}): Promise<SavedVersion | null> {
    if (uploading) {
      showFailure({ message: "Espere a imagem terminar de enviar e tente de novo.", status: 0 });
      return null;
    }

    if (audioBusy) {
      showFailure({ message: audioBusy, status: 0 });
      return null;
    }

    setSubmitted(true);
    const errors = { ...clientErrors, ...extraErrors };

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

    return version;
  }

  /**
   * Aviso novo acabou de ser gravado: a tela passa para o endereco do aviso (recarregar, "Recarregar"
   * depois de um 409 e o menu de acoes valem para ele). Nada se perde: o que esta na tela e o que foi
   * gravado.
   */
  function openSavedNotice(id: string, wasNew: boolean) {
    if (wasNew && !initial) {
      router.replace(noticeHref(id), { scroll: false });
    }
  }

  async function saveDraft() {
    if (busy) {
      return;
    }

    const wasNew = !savedVersion;
    setBusy("save");
    const version = await persist();
    setBusy(null);

    if (version) {
      adminToast.success(livePopup ? (status === "paused" ? "Pop-up salvo. Ele continua pausado." : "Pop-up atualizado. Quem já fechou não vê de novo.") : "Rascunho salvo.");
      openSavedNotice(version.id, wasNew);
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
      showFailure({ message: result.error, status: result.status });
      focusFirstError(fieldErrors);
      return;
    }

    setSavedVersion({ id: result.data.id, status: result.data.situation === "sent" ? "sent" : version.status, updatedAt: result.data.updatedAt });
    adminToast.success(publishedNoticeToast(result.data, draft.kind));
    router.push(noticeHref(result.data.id));
  }

  async function sendTest() {
    if (busy) {
      return;
    }

    const wasNew = !savedVersion;
    setBusy("test");
    const version = dirty || !savedVersion ? await persist() : savedVersion;

    if (!version) {
      setBusy(null);
      return;
    }

    const result = await sendNoticeTestToMe({ expectedUpdatedAt: version.updatedAt, id: version.id });
    setBusy(null);

    if (!result.ok) {
      showFailure({ message: result.error, status: result.status });
      openSavedNotice(version.id, wasNew);
      return;
    }

    adminToast.success("Enviamos a notificação para o seu sino.");
    openSavedNotice(version.id, wasNew);
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
                    onClick={() => (dirty ? showFailure({ message: "Salve ou descarte as mudanças antes de aprovar.", status: 0 }) : noticeActions.request("approve", actionTarget))}
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
                    <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
                      Fechar
                    </Button>
                  )
                }
                title={conflict ? "Este aviso mudou em outra tela" : "O aviso não foi salvo"}
              >
                {conflict ? `${failure.message} O que você mudou aqui continua no rascunho.` : failure.message}
              </ErrorBanner>
            </div>
          ) : null}

          <SectionCard description="O tipo e o texto que o aluno lê." title="O que">
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Tipo</span>
                <PillGroup ariaLabel="Tipo do aviso" disabled={locked || kindLocked} name="aviso-tipo" onChange={changeKind} options={KIND_OPTIONS} value={draft.kind} />
                <p className="text-xs leading-5 text-[var(--text-secondary)]">
                  {kindLocked
                    ? "O tipo não muda depois de publicado. Para trocar, duplique o aviso."
                    : draft.kind === "inbox"
                      ? "Fica no sino por 90 dias. O aluno vê quando abrir o sino."
                      : "Aparece no centro da home, 3 segundos depois de abrir. Nunca durante uma aula."}
                </p>
              </div>
              <HeroTextField
                disabled={locked}
                error={errorFor("title")}
                id="aviso-titulo"
                label="Título"
                max={limits.title}
                onBlur={() => touch("title")}
                onChange={(title) => change({ title })}
                value={draft.title}
              />
              <HeroTextField
                disabled={locked}
                error={errorFor("body")}
                hint={draft.kind === "inbox" ? "Textos longos ficam com “Ver mais” no sino." : undefined}
                id="aviso-texto"
                label="Texto"
                max={limits.body}
                multiline
                onBlur={() => touch("body")}
                onChange={(body) => change({ body })}
                value={draft.body}
              />
            </div>
          </SectionCard>

          <SectionCard description="Uma imagem 16:9 e um áudio curto, para o aviso ganhar atenção." meta="opcional" title="Imagem e áudio">
            <div className="flex min-w-0 flex-col gap-5">
              <ImageField
                error={imageError ?? errorFor("image.url")}
                id="aviso-imagem"
                label="Imagem"
                onChange={(value) => void changeImage(value)}
                optional
                pending={uploading}
                slot="notice"
                value={previewImage}
              />
              {draft.image ? (
                <HeroTextField
                  disabled={locked}
                  error={errorFor("image.alt")}
                  hint="Ajuda quem usa leitor de tela. Ex.: Professora apresentando a aula nova."
                  id="aviso-imagem-descricao"
                  label="Descrição da imagem (opcional)"
                  max={NOTICE_LIMITS.imageAlt}
                  onBlur={() => touch("image.alt")}
                  onChange={(alt) => setDraft((current) => (current.image ? { ...current, image: { ...current.image, alt } } : current))}
                  value={draft.image.alt}
                />
              ) : null}
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                  Áudio<span className="font-normal text-[var(--text-tertiary)]"> (opcional)</span>
                </span>
                <NoticeAudioField
                  disabled={locked}
                  error={errorFor("audio.url") ?? errorFor("audio.durationSeconds") ?? errorFor("audio")}
                  id="aviso-audio"
                  onBusyChange={setAudioBusy}
                  onChange={(audio) => change({ audio })}
                  value={draft.audio}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard description="Leva o aluno para um produto, uma página da área ou um site." meta="opcional" title="Botão">
            <NoticeCtaField
              disabled={locked}
              errors={{ href: errorFor("cta.href"), label: errorFor("cta.label") }}
              key={resetKey}
              onBlurField={touch}
              onChange={(cta) => change({ cta })}
              products={pickerItems}
              productsLoaded={options.productsLoaded}
              value={draft.cta}
            />
          </SectionCard>

          {draft.kind === "inbox" ? (
            <SectionCard description="Para convites e confirmações: o aluno responde direto no sino." meta="opcional" title="Resposta">
              <div className="flex min-w-0 flex-col gap-5">
                <AdminSwitch
                  checked={draft.response !== null}
                  description={draft.response ? "Aparecem dois botões no aviso. As respostas ficam no relatório." : "Sem resposta, o aviso só informa."}
                  disabled={locked}
                  id="aviso-resposta"
                  label="Pedir uma resposta (Aceitar ou Recusar)"
                  onCheckedChange={(checked) =>
                    change({ response: checked ? (rememberedResponse.current ?? { acceptLabel: "Aceitar", declineLabel: "Recusar" }) : null })
                  }
                />
                {draft.response ? (
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <HeroTextField
                      disabled={locked}
                      error={errorFor("response.acceptLabel")}
                      id="aviso-aceitar"
                      label="Botão de aceitar"
                      max={NOTICE_LIMITS.responseLabel}
                      onBlur={() => touch("response.acceptLabel")}
                      onChange={(acceptLabel) => {
                        const response = { acceptLabel, declineLabel: draft.response?.declineLabel ?? "Recusar" };
                        rememberedResponse.current = response;
                        change({ response });
                      }}
                      value={draft.response.acceptLabel}
                    />
                    <HeroTextField
                      disabled={locked}
                      error={errorFor("response.declineLabel")}
                      id="aviso-recusar"
                      label="Botão de recusar"
                      max={NOTICE_LIMITS.responseLabel}
                      onBlur={() => touch("response.declineLabel")}
                      onChange={(declineLabel) => {
                        const response = { acceptLabel: draft.response?.acceptLabel ?? "Aceitar", declineLabel };
                        rememberedResponse.current = response;
                        change({ response });
                      }}
                      value={draft.response.declineLabel}
                    />
                  </div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard description="Todos os alunos ou só quem combina com as regras." title="Para quem">
            <div className="flex min-w-0 flex-col gap-4">
              <AudienceBuilder
                cohorts={options.cohorts}
                disabled={locked}
                errors={audienceErrors}
                onChange={(audience) => change({ audience })}
                products={pickerItems}
                productsLoaded={options.productsLoaded}
                segments={options.segments}
                value={draft.audience}
              />
              <AudienceCount description={audienceDescription} needsApproval={needsApproval} onRetry={() => setCountAttempt((attempt) => attempt + 1)} state={countView} />
            </div>
          </SectionCard>

          <SectionCard description={draft.kind === "inbox" ? "Agora ou numa data e hora." : "A janela em que o pop-up aparece e quantas vezes."} title="Quando">
            <NoticeWhenFields
              disabled={locked}
              key={resetKey}
              draft={draft}
              errors={{ endsAt: errorFor("window.endsAt"), sendAt: errorFor("schedule.sendAt"), startsAt: errorFor("window.startsAt") }}
              onChange={(patch) => change(patch)}
            />
          </SectionCard>

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
          <NoticePreview branding={options.branding} device={device} draft={draft} imageUrl={previewImage} now={now} />
        </section>
      </div>

      {noticeActions.confirmDialog}
    </AdminPage>
  );
}
