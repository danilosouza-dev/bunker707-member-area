"use client";

import { Radio, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { previewNoticeAudience } from "@/server/communications/actions";
import { normalizeAudience, type AudienceDefinition } from "@/server/communications/audience-model";
import { audienceDefinitionSchema } from "@/server/communications/schemas";
import { publishWebinar, saveWebinarDraft, uploadWebinarCover } from "@/server/webinars/actions";
import {
  WEBINARS_HREF,
  WEBINAR_ADMIN_COPY,
  WEBINAR_EDITOR_LIMITS,
  accessUsesAudience,
  canonicalWebinarDraft,
  isSameWebinarDraft,
  isWebinarKindLocked,
  rebaseWebinarDraft,
  savedWebinarToast,
  startWebinarDraft,
  webinarAdminHref,
  webinarAudienceDescription,
  webinarAudienceErrorsFrom,
  webinarCardOfField,
  webinarCountAudience,
  webinarCardTitle,
  webinarDraftForKind,
  webinarEditorCards,
  webinarErrorsFrom,
  webinarErrorsFromAction,
  webinarFailureTitle,
  webinarHeaderButtons,
  webinarKindLabel,
  webinarNotifyShortcuts,
  webinarPublishProblems,
  webinarReviewSentence,
  webinarScreenProblems,
  webinarSituationLabel,
  webinarSituationTone,
  type WebinarEditorCard,
  type WebinarFieldErrors,
  type WebinarPermissions
} from "@/server/webinars/editor-model";
import { defaultJitSettings, type JitSettings, type WebinarDraft, type WebinarKind, type WebinarSession, type WebinarSituation, type WebinarStatus } from "@/server/webinars/model";
import type { WebinarEditorData, WebinarEditorOptions } from "@/server/webinars/queries";
import { cancelReplaySession, createReplaySession } from "@/server/webinars/room-actions";
import { webinarDraftSchema } from "@/server/webinars/schemas";
import { ErrorBanner } from "../../error-banner";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../../form";
import { AdminLinkButton } from "../../link-button";
import type { PreviewDevice } from "../../member-area/preview-frame";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import { ImageField } from "../../products/image-field";
import { useWarnBeforeUnload } from "../../products/use-warn-before-unload";
import { SectionCard } from "../../settings/kit";
import { StatusChip } from "../../status-chip";
import { adminCard } from "../../styles";
import { adminToast } from "../../toast";
import { useAdminTopbarTitle } from "../../topbar-title";
import type { AudienceCountState } from "../audience-builder";
import { DateTimeField } from "../notice-when-fields";
import { audienceMessageOptions, audienceNamesWithMessages } from "../notices-view-model";
import { isEditorSaveShortcut } from "../save-shortcut";
import { AssistantCard } from "./assistant-card";
import { OfferCard } from "./offer-card";
import { PollsCard } from "./polls-card";
import { ScriptCard } from "./script-card";
import { SimulationCard } from "./simulation-card";
import { AccessCard, NotifyCard, QualityCard, RecordingCard, RegistrationCard, ReplayLessonCard, RoomCard, SessionsCard, toPickerItems, type ReplayControl } from "./webinar-editor-cards";
import { PeoplePicker, PersonSelect } from "./webinar-people-fields";
import { WebinarPreview } from "./webinar-preview";
import { WebinarActionIcon, WebinarRowMenu, useWebinarActions, type WebinarActionTarget } from "./webinar-row-menu";

// Editor do webinario (docs/30 §2.2 e §2.3), no molde do editor do aviso (notice-editor.tsx): "Novo webinário"
// pergunta o tipo em duas pilulas e abre os cards a esquerda (Dados, Sessões, Quem pode, Vaga e lembretes, Avisar,
// Sala, Qualidade, Gravação, Publicar replay como aula, Revisão) com a previa do card do aluno a direita. Regras:
// - o rascunho salva sem exigir nada (webinarDraftSchema); Publicar exige o que publishProblems lista, campo a campo;
// - erros do zod e do servidor ficam no campo (webinarErrorsFrom / webinarErrorsFromAction) e o primeiro recebe o
//   foco; o banner de erro e persistente (ErrorBanner); toast so no sucesso (adminToast);
// - cada acao leva a versao lida (updatedAt): 409 = "mudou em outra tela" com Recarregar, e a tela refaz o
//   rascunho sem perder o que foi digitado (rebaseWebinarDraft);
// - a contagem do segmento vem do servidor (previewNoticeAudience) 500 ms depois da ultima mudanca; em "Quem tem o
//   produto e está no segmento" ela conta o produto junto (webinarCountAudience);
// - Ctrl+Enter (⌘+Enter) salva o rascunho; sair com mudanca nao salva avisa (useWarnBeforeUnload);
// - o que chega em outra fase aparece desligado com "em breve", nunca some em silencio (docs/30 §2.8);
// - fase 3: na Live ao vivo publicada, Abrir a sala, Abrir o console e Encerrar live levam ao console /[id]/sala (a
//   sala e as acoes dela moram la); sem messaging.publish, Abrir a sala e Encerrar live aparecem desligados com a
//   explicacao embaixo do cabecalho (§2.6); o card Gravacao mostra a situacao do gravador da sessao `live`;
// - Avisar › Aviso no sino e Pop-up levam a /admin/comunicacao/avisos/novo?webinario=<id>&tipo= (o aviso preenchido
//   pelo webinario salvo, nada gravado ate salvar); desligados com o motivo (webinarNotifyShortcuts);
// - fase 4e: o card Sessoes da Live gravada termina com o "Comeca quando voce entra" (JitCard, salva sozinho); com ele
//   ligado e gravado, Publicar nao pede hora marcada (webinarPublishProblems) e a Revisao diz os horarios dele.

type WebinarEditorProps = {
  /** Tipo ja escolhido (?tipo= no "Novo webinário"); null pergunta o tipo primeiro. */
  defaultKind: WebinarKind | null;
  initial: WebinarEditorData | null;
  /** A sala ao vivo existe neste ambiente (liveRoomConfigured(process.env), lido no servidor pela pagina). */
  liveRoomReady: boolean;
  /** Hora da leitura no servidor: o "agora" da previa e das regras de data. */
  now: number;
  options: WebinarEditorOptions;
  permissions: WebinarPermissions;
};

type SavedVersion = { id: string; registeredCount: number; situation: WebinarSituation; slug: string; status: WebinarStatus; updatedAt: string };
type Busy = "publish" | "save" | null;
type Failure = { message: string; status: number; title: string };
type PersistOutcome = { ok: true; version: SavedVersion } | { errors: WebinarFieldErrors; message: string; ok: false };

const KIND_OPTIONS: readonly { label: string; value: WebinarKind }[] = [
  { label: WEBINAR_ADMIN_COPY.kindChoice.live.title, value: "live" },
  { label: WEBINAR_ADMIN_COPY.kindChoice.simulated.title, value: "simulated" }
];

const DEVICE_OPTIONS: readonly { label: string; value: PreviewDevice }[] = [
  { label: "Computador", value: "desktop" },
  { label: "Celular", value: "mobile" }
];

const COUNT_DEBOUNCE_MS = 500;
const READ_ONLY_SITUATIONS: readonly WebinarSituation[] = ["in_progress", "ended", "cancelled"];

function scrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Leva o foco (ou a rolagem) ao primeiro campo com erro; sem campo com id, ao card dele. */
function focusFirstError(errors: WebinarFieldErrors) {
  const [key] = Object.keys(errors);

  if (!key || typeof document === "undefined") {
    return;
  }

  const base = `webinar-${key.replace(/\./g, "-")}`;
  const candidates = [base, `${base}-data`, `webinar-${key.split(".")[0]}`, `webinar-card-${webinarCardOfField(key)}`];

  for (const id of candidates) {
    const element = document.getElementById(id);

    if (!element) {
      continue;
    }

    element.scrollIntoView({ behavior: scrollBehavior(), block: "center" });

    if (element.matches("input, textarea, select, button, [tabindex]")) {
      (element as HTMLElement).focus({ preventScroll: true });
    }

    return;
  }
}

function situationAfterSave(status: WebinarStatus, previous: WebinarSituation | null): WebinarSituation {
  if (status === "draft") {
    return "draft";
  }

  return previous && previous !== "draft" ? previous : "scheduled";
}

function versionOf(initial: WebinarEditorData): SavedVersion {
  return { id: initial.id, registeredCount: initial.registeredCount, situation: initial.situation, slug: initial.slug, status: initial.status, updatedAt: initial.updatedAt };
}

export function WebinarEditor({ defaultKind, initial, liveRoomReady, now, options, permissions }: WebinarEditorProps) {
  const router = useRouter();
  const [kind, setKind] = useState<WebinarKind | null>(() => initial?.draft.kind ?? defaultKind);
  const [draft, setDraft] = useState<WebinarDraft>(() => initial?.draft ?? startWebinarDraft(initial?.draft.kind ?? defaultKind ?? "live"));
  const [saved, setSaved] = useState<WebinarDraft>(() => initial?.draft ?? startWebinarDraft(defaultKind ?? "live"));
  const [savedVersion, setSavedVersion] = useState<SavedVersion | null>(() => (initial ? versionOf(initial) : null));
  // Ultima versao vinda do servidor: "Recarregar" (depois de um 409) traz outra e a tela segue o banco sem perder o
  // que a pessoa mudou.
  const [serverVersion, setServerVersion] = useState<string | null>(initial?.updatedAt ?? null);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [serverErrors, setServerErrors] = useState<WebinarFieldErrors>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [coverUpload, setCoverUpload] = useState<string | null>(null);
  const [device, setDevice] = useState<PreviewDevice>("mobile");
  const [count, setCount] = useState<AudienceCountState>({ previous: null, status: "loading" });
  const [countAttempt, setCountAttempt] = useState(0);
  // Remonta os campos com memoria propria (datas) quando o rascunho e trocado de uma vez.
  const [resetKey, setResetKey] = useState(0);
  // O Replay livre (fase 2): a sessao `replay` do webinario, ligada e desligada pelo card Sessoes.
  const [replaySession, setReplaySession] = useState<WebinarSession | null>(initial?.replaySession ?? null);
  const [replayBusy, setReplayBusy] = useState(false);
  // O "Comeca quando voce entra" gravado (fase 4e): o card salva sozinho e avisa aqui (Publicar e a Revisao leem).
  const [jitSaved, setJitSaved] = useState<JitSettings>(() => initial?.jit ?? defaultJitSettings());
  const countRequest = useRef(0);
  const bannerRef = useRef<HTMLDivElement>(null);
  const saveShortcut = useRef<() => void>(() => undefined);

  if (initial && initial.updatedAt !== serverVersion) {
    setServerVersion(initial.updatedAt);

    if (!savedVersion || Date.parse(initial.updatedAt) !== Date.parse(savedVersion.updatedAt)) {
      setDraft(rebaseWebinarDraft(saved, draft, initial.draft));
      setSaved(initial.draft);
      setSavedVersion(versionOf(initial));
      setFailure(null);
      setServerErrors({});
      setResetKey((key) => key + 1);
    }
  }

  const status = savedVersion?.status ?? null;
  const situation = savedVersion?.situation ?? null;
  const kindLocked = isWebinarKindLocked(status);
  const readOnly = situation !== null && READ_ONLY_SITUATIONS.includes(situation);
  const payload = useMemo(() => canonicalWebinarDraft(draft), [draft]);
  const publishers = useMemo(() => (options.peopleLoaded ? new Set(options.people.filter((person) => person.canPublish).map((person) => person.id)) : null), [options.people, options.peopleLoaded]);
  const pickerItems = useMemo(() => toPickerItems(options.products), [options.products]);
  const clientErrors = useMemo<WebinarFieldErrors>(() => {
    const parsed = webinarDraftSchema.safeParse(payload);

    return { ...webinarScreenProblems(payload, { publishers }), ...(parsed.success ? {} : webinarErrorsFrom(parsed.error.issues)) };
  }, [payload, publishers]);
  // O que a contagem conta: o segmento (sem a propria live na regra "nunca ... em nenhuma live") e, em "Quem tem o
  // produto e está no segmento", o produto junto (webinarCountAudience).
  const audienceKey = JSON.stringify(normalizeAudience(webinarCountAudience(draft, savedVersion?.id)));
  const audienceValid = useMemo(() => audienceDefinitionSchema.safeParse(JSON.parse(audienceKey)).success, [audienceKey]);
  const usesAudience = accessUsesAudience(draft.accessMode);
  const dirty = !isSameWebinarDraft(saved, draft);
  // Avisar › Aviso no sino e Pop-up: abrem o editor da Comunicacao com o webinario SALVO (por isso o `saved`).
  const notifyShortcuts = webinarNotifyShortcuts({
    dirty,
    draft: saved,
    permissions,
    saved: savedVersion ? { id: savedVersion.id, situation: savedVersion.situation, status: savedVersion.status } : null
  });
  const uploading = coverUpload !== null;
  const locked = busy !== null;
  const disabled = locked || readOnly;

  useWarnBeforeUnload(dirty || uploading);
  useAdminTopbarTitle(initial ? initial.title : WEBINAR_ADMIN_COPY.header.newTitle);

  // Contagem ao vivo do segmento (500 ms depois da ultima mudanca; resposta velha e ignorada).
  useEffect(() => {
    if (!audienceValid || !usesAudience) {
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
  }, [audienceKey, audienceValid, countAttempt, usesAudience]);

  // Cmd/Ctrl+Enter salva o rascunho (o atalho le a versao mais nova da funcao); nunca com o foco num dialogo.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditorSaveShortcut(event)) {
        event.preventDefault();
        saveShortcut.current();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const countView: AudienceCountState = audienceValid ? count : { status: "incomplete" };
  const audienceErrors = webinarAudienceErrorsFrom(submitted ? { ...clientErrors, ...serverErrors } : serverErrors);
  const audienceNames = useMemo(() => audienceNamesWithMessages(options.names, audienceMessageOptions("segment", { notices: options.notices })), [options.names, options.notices]);
  // A frase descreve o segmento como a equipe montou: a troca da propria live vale so para o numero (audienceKey).
  const audienceDescription = webinarAudienceDescription(draft, audienceNames);
  const productName = draft.productId ? (options.names.products[draft.productId] ?? null) : null;
  const reviewSentence = webinarReviewSentence({ draft: payload, jit: jitSaved, now, productName, registeredCount: savedVersion?.registeredCount ?? null, situation });

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

  function change(patch: Partial<WebinarDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    clearServerErrors(Object.keys(patch));

    if (failure && failure.status !== 409) {
      setFailure(null);
    }
  }

  function chooseKind(next: WebinarKind) {
    setKind(next);
    setDraft((current) => webinarDraftForKind(current, next));
    setSaved((current) => (savedVersion ? current : startWebinarDraft(next)));
    clearServerErrors(["kind", "scheduledAt", "sessions", "recordingVideoUrl"]);
  }

  function showFailure(next: Omit<Failure, "title"> & { title?: string }) {
    setFailure({ ...next, title: next.title ?? webinarFailureTitle({ savedDraft: false, status: next.status }) });
    window.requestAnimationFrame(() => bannerRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }));
  }

  async function changeCover(next: string | null) {
    touch("coverUrl");
    clearServerErrors(["coverUrl"]);

    // Remover ou link https colado (sem recorte): vai direto para o rascunho.
    if (next === null || !next.startsWith("data:")) {
      change({ coverUrl: next });
      return;
    }

    setCoverUpload(next);
    const result = await uploadWebinarCover({ image: next, slot: "cover" }).catch(() => null);
    setCoverUpload(null);

    if (!result || !result.ok) {
      setServerErrors((current) => ({ ...current, coverUrl: result ? (result.fieldErrors?.coverUrl?.[0] ?? result.error) : "Não foi possível enviar a capa. Tente de novo." }));
      return;
    }

    change({ coverUrl: result.data.url });
  }

  /** Confere e grava o rascunho; devolve a versao gravada ou os erros (ja na tela). */
  async function persist(extraErrors: WebinarFieldErrors = {}): Promise<PersistOutcome> {
    if (uploading) {
      const message = WEBINAR_ADMIN_COPY.failures.waitUpload;
      showFailure({ message, status: 0 });
      return { errors: {}, message, ok: false };
    }

    setSubmitted(true);
    const errors = { ...clientErrors, ...extraErrors };

    if (Object.keys(errors).length > 0) {
      const message = WEBINAR_ADMIN_COPY.failures.reviewFields;
      setServerErrors(extraErrors);
      showFailure({ message, status: 400 });
      focusFirstError(errors);
      return { errors, message, ok: false };
    }

    setFailure(null);
    setServerErrors({});
    const result = await saveWebinarDraft({ draft: payload, expectedUpdatedAt: savedVersion?.updatedAt, id: savedVersion?.id });

    if (!result.ok) {
      const fieldErrors = webinarErrorsFromAction(result.fieldErrors);
      setServerErrors(fieldErrors);
      showFailure({ message: result.error, status: result.status });
      focusFirstError(fieldErrors);
      return { errors: fieldErrors, message: result.error, ok: false };
    }

    const version: SavedVersion = {
      id: result.data.id,
      registeredCount: savedVersion?.registeredCount ?? 0,
      situation: situationAfterSave(result.data.status, situation),
      slug: result.data.slug,
      status: result.data.status,
      updatedAt: result.data.updatedAt
    };
    setSavedVersion(version);
    setSaved(payload);

    return { ok: true, version };
  }

  function openSaved(id: string) {
    if (!initial) {
      router.replace(webinarAdminHref(id), { scroll: false });
    }
  }

  async function saveDraft() {
    if (busy) {
      return;
    }

    // Nada mudou: gravar de novo nao faria nada.
    if (savedVersion && !dirty && !uploading) {
      adminToast.info(WEBINAR_ADMIN_COPY.toasts.nothingToSave);
      openSaved(savedVersion.id);
      return;
    }

    setBusy("save");
    const outcome = await persist();
    setBusy(null);

    if (!outcome.ok) {
      return;
    }

    adminToast.success(savedWebinarToast(outcome.version.status));
    openSaved(outcome.version.id);
  }

  useEffect(() => {
    saveShortcut.current = () => {
      if (!readOnly) {
        void saveDraft();
      }
    };
  });

  async function publish() {
    if (busy) {
      return;
    }

    const problems = webinarPublishProblems(payload, Date.now(), jitSaved);
    const extra = Object.fromEntries(problems.map((problem) => [problem.path, problem.message]));

    setBusy("publish");
    const outcome = await persist(extra);

    if (!outcome.ok) {
      setBusy(null);
      return;
    }

    const { version } = outcome;
    const result = await publishWebinar({ expectedUpdatedAt: version.updatedAt, id: version.id });
    setBusy(null);

    if (!result.ok) {
      const fieldErrors = webinarErrorsFromAction(result.fieldErrors);
      setServerErrors(fieldErrors);
      // O rascunho ja foi gravado: o banner diz isso e a tela fica.
      showFailure({ message: result.error, status: result.status, title: webinarFailureTitle({ savedDraft: true, status: result.status }) });
      focusFirstError(fieldErrors);
      return;
    }

    setSavedVersion({ ...version, situation: result.data.situation, status: result.data.status, updatedAt: result.data.updatedAt });
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.published);
    router.push(webinarAdminHref(result.data.id));
  }

  const webinarActions = useWebinarActions({ onDeleted: () => router.push(WEBINARS_HREF), permissions });
  const actionTarget: WebinarActionTarget | null = savedVersion
    ? {
        id: savedVersion.id,
        // O tipo gravado (o do rascunho na tela so vale depois de salvar).
        kind: saved.kind,
        registeredCount: savedVersion.registeredCount,
        runningSessionId: initial?.runningSessionId ?? null,
        situation: savedVersion.situation,
        status: savedVersion.status,
        title: draft.title.trim() || initial?.title || WEBINAR_ADMIN_COPY.header.newTitle,
        updatedAt: savedVersion.updatedAt
      }
    : null;
  const conflict = failure?.status === 409;
  const working = (label: string, key: Exclude<Busy, null>) => (busy === key ? WEBINAR_ADMIN_COPY.review.working[key] : label);
  // Os botoes do topo que navegam (Abrir a sala, Abrir o console, Ver relatório; Encerrar live da Live ao vivo) ou
  // que chegam depois ("em breve"); o resto fica no menu "…" ao lado.
  const headerButtons = actionTarget ? webinarHeaderButtons({ id: actionTarget.id, kind: actionTarget.kind, permissions, situation: actionTarget.situation }) : [];
  const blockedNotes = Array.from(new Set(headerButtons.flatMap((button) => (button.blocked ? [button.blocked] : []))));
  const cards = kind ? webinarEditorCards(kind) : [];
  const savedSessions = initial?.sessions ?? [];

  async function toggleReplay(create: boolean) {
    if (!savedVersion || replayBusy) {
      return;
    }

    setReplayBusy(true);

    if (create) {
      const result = await createReplaySession({ webinarId: savedVersion.id });
      setReplayBusy(false);

      if (!result.ok) {
        showFailure({ message: result.error, status: result.status });
        return;
      }

      setReplaySession(result.data.session);
      adminToast.success(WEBINAR_ADMIN_COPY.toasts.replayCreated);
      return;
    }

    const result = await cancelReplaySession({ webinarId: savedVersion.id });
    setReplayBusy(false);

    if (!result.ok) {
      showFailure({ message: result.error, status: result.status });
      return;
    }

    setReplaySession(null);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.replayCancelled);
  }

  const replayControl: ReplayControl | null = savedVersion
    ? {
        busy: replayBusy,
        firstEnded: savedSessions.some((session) => session.kind !== "replay" && session.status === "ended"),
        onCancel: () => void toggleReplay(false),
        onCreate: () => void toggleReplay(true),
        session: replaySession
      }
    : null;
  const coHostIds = draft.presenters.filter((presenter) => presenter.role === "co_host").map((presenter) => presenter.userId);
  const teamIds = draft.presenters.filter((presenter) => presenter.role === "team").map((presenter) => presenter.userId);
  const moderation = new Map(draft.presenters.filter((presenter) => presenter.role === "team").map((presenter) => [presenter.userId, presenter.canModerateRoom]));
  const teamPeople = options.people.filter((person) => person.canWrite || teamIds.includes(person.id));
  const hostPeople = options.people.filter((person) => person.canPublish || person.id === draft.hostUserId);

  function setPresenters(role: "co_host" | "team", ids: string[]) {
    const current = new Map(draft.presenters.filter((presenter) => presenter.role === role).map((presenter) => [presenter.userId, presenter]));
    const others = draft.presenters.filter((presenter) => presenter.role !== role && !ids.includes(presenter.userId));

    change({ presenters: [...others, ...ids.map((id) => current.get(id) ?? { canModerateRoom: false, role, userId: id })] });
    touch("presenters");
  }

  function toggleModeration(userId: string, checked: boolean) {
    change({ presenters: draft.presenters.map((presenter) => (presenter.userId === userId ? { ...presenter, canModerateRoom: checked } : presenter)) });
  }

  const previewNote = savedVersion && savedVersion.status === "published" ? (dirty ? WEBINAR_ADMIN_COPY.review.publishedHint : WEBINAR_ADMIN_COPY.preview.publishedNote) : WEBINAR_ADMIN_COPY.preview.draftNote;

  let reviewButtons: ReactNode = null;

  if (!readOnly) {
    const isDraft = situation === null || situation === "draft";

    reviewButtons = (
      <div className="flex flex-wrap items-center gap-2">
        {isDraft && permissions.canPublish ? (
          <Button className="px-4" disabled={locked} onClick={() => void publish()} type="button">
            {working(WEBINAR_ADMIN_COPY.review.buttons.publish, "publish")}
          </Button>
        ) : null}
        <Button className="px-4" disabled={locked} onClick={() => void saveDraft()} type="button" variant={isDraft && permissions.canPublish ? "secondary" : "default"}>
          {working(isDraft ? WEBINAR_ADMIN_COPY.review.buttons.saveDraft : WEBINAR_ADMIN_COPY.review.buttons.save, "save")}
        </Button>
      </div>
    );
  }

  const cardProps = { disabled, draft, errorFor, now, onBlur: touch, onChange: change };

  function renderCard(card: WebinarEditorCard): ReactNode {
    const meta = webinarCardTitle(card);
    const titleId = `webinar-card-${card}`;

    switch (card) {
      case "dados":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id="webinar-kind-label">
                  {WEBINAR_ADMIN_COPY.fields.type}
                </span>
                <PillGroup
                  ariaLabel={WEBINAR_ADMIN_COPY.fields.type}
                  describedBy={kindLocked ? "webinar-kind-hint" : undefined}
                  disabled={disabled || kindLocked}
                  name="webinar-kind"
                  onChange={(next: WebinarKind) => chooseKind(next)}
                  options={KIND_OPTIONS}
                  value={draft.kind}
                />
                {kindLocked ? (
                  <p className="text-xs leading-5 text-[var(--text-secondary)]" id="webinar-kind-hint">
                    {WEBINAR_ADMIN_COPY.fields.typeLocked}
                  </p>
                ) : null}
                {errorFor("kind") ? <p className="text-[13px] leading-5 text-[var(--error)]">{errorFor("kind")}</p> : null}
              </div>

              <AdminField error={errorFor("title")} id="webinar-title" label={WEBINAR_ADMIN_COPY.fields.title}>
                <input
                  aria-describedby={fieldDescribedBy("webinar-title", { error: errorFor("title") })}
                  aria-invalid={errorFor("title") ? true : undefined}
                  className={adminInputClass}
                  disabled={disabled}
                  id="webinar-title"
                  maxLength={WEBINAR_EDITOR_LIMITS.title}
                  onBlur={() => touch("title")}
                  onChange={(event) => change({ title: event.target.value })}
                  placeholder={WEBINAR_ADMIN_COPY.fields.titlePlaceholder}
                  type="text"
                  value={draft.title}
                />
              </AdminField>

              <div className="flex min-w-0 flex-col gap-1.5">
                <ImageField
                  error={errorFor("coverUrl")}
                  id="webinar-coverUrl"
                  label={WEBINAR_ADMIN_COPY.fields.cover}
                  onChange={(next) => void changeCover(next)}
                  optional
                  pending={uploading}
                  readOnly={disabled}
                  slot="cover"
                  value={coverUpload ?? draft.coverUrl}
                />
                <p className="text-xs leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.fields.coverHint}</p>
              </div>

              <AdminField error={errorFor("description")} id="webinar-description" label={WEBINAR_ADMIN_COPY.fields.description} optional>
                <textarea
                  aria-describedby={fieldDescribedBy("webinar-description", { error: errorFor("description") })}
                  aria-invalid={errorFor("description") ? true : undefined}
                  className={adminTextareaClass}
                  disabled={disabled}
                  id="webinar-description"
                  maxLength={WEBINAR_EDITOR_LIMITS.description}
                  onBlur={() => touch("description")}
                  onChange={(event) => change({ description: event.target.value })}
                  rows={4}
                  value={draft.description}
                />
              </AdminField>

              <PersonSelect
                disabled={disabled}
                error={errorFor("hostUserId")}
                hint={WEBINAR_ADMIN_COPY.fields.hostHint}
                id="webinar-hostUserId"
                label={WEBINAR_ADMIN_COPY.fields.host}
                onChange={(hostUserId) => {
                  change({ hostUserId });
                  touch("hostUserId");
                }}
                people={hostPeople}
                placeholder={WEBINAR_ADMIN_COPY.fields.hostPlaceholder}
                value={draft.hostUserId}
              />

              <AdminField error={errorFor("presenters") ?? firstPresenterError(clientErrors, serverErrors, submitted)} hint={WEBINAR_ADMIN_COPY.fields.coHostsHint} id="webinar-presenters-cohosts" label={WEBINAR_ADMIN_COPY.fields.coHosts} optional>
                <PeoplePicker
                  disabled={disabled}
                  error={errorFor("presenters")}
                  id="webinar-presenters-cohosts"
                  items={options.people}
                  max={WEBINAR_EDITOR_LIMITS.coHostsMax}
                  onChange={(ids) => setPresenters("co_host", ids)}
                  value={coHostIds}
                />
              </AdminField>

              <AdminField hint={WEBINAR_ADMIN_COPY.fields.teamHint} id="webinar-presenters-team" label={WEBINAR_ADMIN_COPY.fields.team} optional>
                <PeoplePicker
                  disabled={disabled}
                  id="webinar-presenters-team"
                  items={teamPeople}
                  max={WEBINAR_EDITOR_LIMITS.presentersMax - coHostIds.length}
                  moderation={{ onToggle: toggleModeration, values: moderation }}
                  onChange={(ids) => setPresenters("team", ids)}
                  value={teamIds}
                />
              </AdminField>

              {draft.kind === "live" ? (
                <DateTimeField
                  disabled={disabled}
                  error={errorFor("scheduledAt")}
                  idPrefix="webinar-scheduledAt"
                  key={`scheduledAt-${resetKey}`}
                  label={WEBINAR_ADMIN_COPY.fields.scheduledAt}
                  onChange={(iso) => {
                    change({ scheduledAt: iso });
                    touch("scheduledAt");
                  }}
                  value={draft.scheduledAt ?? ""}
                />
              ) : null}

              <AdminField error={errorFor("durationMinutes")} id="webinar-durationMinutes" label={WEBINAR_ADMIN_COPY.fields.duration}>
                <input
                  aria-describedby={fieldDescribedBy("webinar-durationMinutes", { error: errorFor("durationMinutes") })}
                  aria-invalid={errorFor("durationMinutes") ? true : undefined}
                  className={cn(adminInputClass, "w-36")}
                  disabled={disabled}
                  id="webinar-durationMinutes"
                  inputMode="numeric"
                  max={WEBINAR_EDITOR_LIMITS.durationMax}
                  min={WEBINAR_EDITOR_LIMITS.durationMin}
                  onBlur={() => touch("durationMinutes")}
                  onChange={(event) => change({ durationMinutes: Math.trunc(Number(event.target.value)) || 0 })}
                  type="number"
                  value={draft.durationMinutes || ""}
                />
              </AdminField>

              {draft.kind === "simulated" ? (
                <AdminField error={errorFor("recordingVideoUrl")} hint={WEBINAR_ADMIN_COPY.fields.recordingUrlHint} id="webinar-recordingVideoUrl" label={WEBINAR_ADMIN_COPY.fields.recordingUrl}>
                  <input
                    aria-describedby={fieldDescribedBy("webinar-recordingVideoUrl", { error: errorFor("recordingVideoUrl"), hint: WEBINAR_ADMIN_COPY.fields.recordingUrlHint })}
                    aria-invalid={errorFor("recordingVideoUrl") ? true : undefined}
                    className={adminInputClass}
                    disabled={disabled}
                    id="webinar-recordingVideoUrl"
                    inputMode="url"
                    maxLength={WEBINAR_EDITOR_LIMITS.recordingUrl}
                    onBlur={() => touch("recordingVideoUrl")}
                    onChange={(event) => change({ recordingVideoUrl: event.target.value })}
                    placeholder="https://iframe.mediadelivery.net/embed/…"
                    type="url"
                    value={draft.recordingVideoUrl ?? ""}
                  />
                </AdminField>
              ) : null}
            </div>
          </SectionCard>
        );
      case "sessoes":
        return (
          <SectionCard description={meta.description} key={`${card}-${resetKey}`} title={meta.title} titleId={titleId}>
            <SessionsCard
              {...cardProps}
              jit={{
                canPublish: permissions.canPublish,
                currentUserName: options.currentUserName,
                deciderNames: initial?.deciderNames ?? {},
                disabled: locked || situation === "cancelled",
                hasVideo: Boolean(saved.recordingVideoUrl),
                initial: jitSaved,
                now,
                onSaved: (settings, updatedAt) => {
                  setJitSaved(settings);
                  // jit_settings muda o updated_at do webinario: o proximo Salvar leva a versao nova.
                  setSavedVersion((current) => (current ? { ...current, updatedAt } : current));
                },
                sessionsToday: initial?.jitSessionsToday ?? [],
                webinarId: savedVersion?.id ?? null
              }}
              replay={replayControl}
              savedSessions={savedSessions}
              webinarId={savedVersion?.id ?? null}
            />
          </SectionCard>
        );
      case "simulacao":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            {savedVersion ? (
              <SimulationCard canPublish={permissions.canPublish} currentUserName={options.currentUserName} deciderNames={initial?.deciderNames ?? {}} disabled={locked} now={now} sessions={savedSessions} />
            ) : (
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.review.saveFirst}</p>
            )}
          </SectionCard>
        );
      case "roteiro":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            {savedVersion ? (
              <ScriptCard
                disabled={locked}
                hasRecording={Boolean(initial?.recordingId) || Boolean(saved.recordingVideoUrl)}
                initialItems={initial?.scriptItems ?? []}
                initialTranscript={initial?.transcript ?? null}
                sessions={savedSessions}
                webinarId={savedVersion.id}
              />
            ) : (
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.review.saveFirst}</p>
            )}
          </SectionCard>
        );
      case "enquetes":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            {savedVersion ? <PollsCard disabled={locked} initial={initial?.polls ?? []} webinarId={savedVersion.id} /> : <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.review.saveFirst}</p>}
          </SectionCard>
        );
      case "oferta":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            {savedVersion ? (
              <OfferCard canWrite={permissions.canWrite} disabled={locked} kind={draft.kind} webinarId={savedVersion.id} />
            ) : (
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.review.saveFirst}</p>
            )}
          </SectionCard>
        );
      case "assistente":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            {savedVersion ? (
              <AssistantCard
                canWrite={permissions.canWrite}
                disabled={locked}
                // assistant_settings muda o updated_at do webinario: o proximo Salvar leva a versao nova.
                onSaved={(updatedAt) => setSavedVersion((current) => (current ? { ...current, updatedAt } : current))}
                webinarId={savedVersion.id}
              />
            ) : (
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.review.saveFirst}</p>
            )}
          </SectionCard>
        );
      case "quemPode":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            <AccessCard
              {...cardProps}
              audienceDescription={audienceDescription}
              audienceErrors={audienceErrors}
              countState={countView}
              onRetryCount={() => setCountAttempt((attempt) => attempt + 1)}
              options={options}
              pickerItems={pickerItems}
              webinarId={savedVersion?.id ?? null}
            />
          </SectionCard>
        );
      case "vagaLembretes":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            <RegistrationCard {...cardProps} />
          </SectionCard>
        );
      case "avisar":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            <NotifyCard {...cardProps} shortcuts={notifyShortcuts} />
          </SectionCard>
        );
      case "sala":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            <RoomCard {...cardProps} />
          </SectionCard>
        );
      case "qualidade":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            <QualityCard {...cardProps} />
          </SectionCard>
        );
      case "gravacao":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            <RecordingCard {...cardProps} liveRoomReady={liveRoomReady} liveSession={initial?.liveSession ?? null} permissions={permissions} webinarId={savedVersion?.id ?? null} />
          </SectionCard>
        );
      case "replayAula":
        return (
          <SectionCard description={meta.description} key={card} title={meta.title} titleId={titleId}>
            <ReplayLessonCard {...cardProps} pickerItems={pickerItems} />
          </SectionCard>
        );
      case "revisao":
        return (
          <SectionCard key={card} title={meta.title} titleId={titleId}>
            <div className="flex min-w-0 flex-col gap-4">
              <p aria-live="polite" className="text-sm leading-6 text-[var(--text-primary)]">
                {reviewSentence}
              </p>
              {savedVersion?.status === "published" && !readOnly ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.review.publishedHint}</p> : null}
              {situation === "cancelled" && initial?.cancelReason ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Motivo: {initial.cancelReason}</p> : null}
              {reviewButtons}
              {!readOnly ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{WEBINAR_ADMIN_COPY.review.shortcutHint}</p> : null}
            </div>
          </SectionCard>
        );
      default:
        return null;
    }
  }

  return (
    <AdminPage className="gap-6 pb-28">
      <PageHeader
        actions={
          actionTarget ? (
            <>
              {headerButtons.map((button) =>
                button.href ? (
                  <AdminLinkButton data-header-action={button.action} href={button.href} key={button.action} variant="secondary">
                    <WebinarActionIcon action={button.action} />
                    {button.label}
                  </AdminLinkButton>
                ) : (
                  <Button
                    aria-describedby={button.blocked ? "webinar-header-blocked" : undefined}
                    className="px-3"
                    data-header-action={button.action}
                    disabled
                    key={button.action}
                    title={button.blocked ?? WEBINAR_ADMIN_COPY.emBreve}
                    type="button"
                    variant="secondary"
                  >
                    <WebinarActionIcon action={button.action} />
                    {button.soon ? `${button.label} · ${WEBINAR_ADMIN_COPY.emBreve}` : button.label}
                  </Button>
                )
              )}
              <WebinarRowMenu exclude={["open", ...headerButtons.map((button) => button.action)]} onRequest={webinarActions.request} permissions={permissions} webinar={actionTarget} />
            </>
          ) : null
        }
        breadcrumb={[{ href: WEBINARS_HREF, label: WEBINAR_ADMIN_COPY.header.breadcrumbList }, { label: initial ? WEBINAR_ADMIN_COPY.header.editTitle : WEBINAR_ADMIN_COPY.header.newTitle }]}
        description={
          savedVersion && situation ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusChip tone={webinarSituationTone(situation)}>{webinarSituationLabel(situation)}</StatusChip>
              <span>{webinarKindLabel(draft.kind)}</span>
              {savedVersion.registeredCount > 0 ? (
                <span className="tabular-nums">
                  · {savedVersion.registeredCount} {savedVersion.registeredCount === 1 ? "vaga garantida" : "vagas garantidas"}
                </span>
              ) : null}
            </span>
          ) : (
            WEBINAR_ADMIN_COPY.header.newDescription
          )
        }
        title={initial ? initial.title : WEBINAR_ADMIN_COPY.header.newTitle}
      />

      {blockedNotes.length > 0 ? (
        <p className="-mt-3 text-[13px] leading-5 text-[var(--text-secondary)]" id="webinar-header-blocked">
          {blockedNotes.join(" ")}
        </p>
      ) : null}

      {webinarActions.errorBanner}

      {failure ? (
        <div ref={bannerRef}>
          <ErrorBanner
            action={
              conflict ? (
                <Button
                  className="px-3"
                  onClick={() => {
                    setFailure(null);
                    router.refresh();
                  }}
                  type="button"
                  variant="secondary"
                >
                  {WEBINAR_ADMIN_COPY.failures.reload}
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

      {kind === null ? (
        <section aria-labelledby="webinar-kind-choice" className={cn(adminCard, "flex min-w-0 flex-col gap-4 p-5")}>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="webinar-kind-choice">
              {WEBINAR_ADMIN_COPY.kindChoice.title}
            </h2>
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.kindChoice.description}</p>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {(["live", "simulated"] as const).map((option) => {
              const Icon = option === "live" ? Radio : Video;
              const text = WEBINAR_ADMIN_COPY.kindChoice[option];

              return (
                <button
                  className={cn(
                    "flex min-h-[112px] min-w-0 flex-col items-start gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] p-4 text-left",
                    "hover:border-[var(--text-secondary)] hover:bg-[var(--surface-3)]"
                  )}
                  key={option}
                  onClick={() => chooseKind(option)}
                  type="button"
                >
                  <span className="flex items-center gap-2 text-sm leading-6 font-semibold text-[var(--text-primary)]">
                    <Icon aria-hidden="true" className="size-4" />
                    {text.title}
                  </span>
                  <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{text.description}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">{cards.map((card) => renderCard(card))}</div>

          <section aria-label="Prévia" className={cn(adminCard, "flex min-w-0 flex-col gap-4 p-4 lg:sticky lg:top-20")}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">Prévia</h2>
              <PillGroup ariaLabel={WEBINAR_ADMIN_COPY.preview.deviceLabel} name="webinar-preview-device" onChange={setDevice} options={DEVICE_OPTIONS} value={device} />
            </div>
            <WebinarPreview coverUrl={coverUpload} device={device} draft={draft} now={now} />
            <p className="text-center text-xs leading-5 text-[var(--text-tertiary)]">{previewNote}</p>
          </section>
        </div>
      )}

      {webinarActions.confirmDialog}
    </AdminPage>
  );
}

/** O primeiro erro de uma pessoa da lista ("presenters.2.userId"), para o campo dos co-apresentadores. */
function firstPresenterError(clientErrors: WebinarFieldErrors, serverErrors: WebinarFieldErrors, submitted: boolean) {
  const merged = submitted ? { ...clientErrors, ...serverErrors } : serverErrors;
  const key = Object.keys(merged).find((item) => item.startsWith("presenters."));

  return key ? merged[key] : undefined;
}
