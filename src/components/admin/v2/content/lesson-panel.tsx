"use client";

import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { detectLessonVideo } from "@/lib/video-detect";
import { previewVideo } from "@/server/catalog/content-actions";
import { studentPreviewBlockedReason } from "@/server/catalog/model";
import type { LessonEditorData, LessonNode, UpdateLessonInput, VideoPreview } from "@/server/catalog/types";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { ReleasePhraseField } from "../release-phrase-field";
import { AdminSheet, AdminSheetSection } from "../sheet";
import { StudentPreviewButton } from "../student-preview-button";
import { adminToast } from "../toast";
import { AdminSwitch } from "./content-ui";
import {
  buildLessonUpdate,
  draftFromLesson,
  isDraftDirty,
  rebaseDraft,
  shouldAdoptSuggestedTitle,
  validateLessonDraft,
  type LessonDraft
} from "./lesson-draft";
import { LessonTranscriptSection } from "./lesson-transcript";
import { LessonVideoField } from "./lesson-video-field";
import type { TreeLesson } from "./tree-model";

// Painel da aula (docs/17 §1.6.4, shot 07): sobrepoe a arvore com scrim (AdminSheet), cabecalho com a
// capa do produto, o nome e "Produto · Módulo 1, aula 1 de 4", corpo rolavel (Vídeo, Conteúdo, Transcrição e Tutor
// IA, Liberação) e rodape fixo (chave Publicada, Ver como aluno da propria aula, Salvar). Endereco proprio: ?aula=<id>.
// Fechar ou trocar de aula com alteracao nao salva transforma o rodape na pergunta (nunca
// window.confirm).

type FieldKey = "description" | "durationLabel" | "release" | "title" | "videoInput";
type FieldErrors = Partial<Record<FieldKey, string>>;

type Session = {
  baseline: LessonDraft;
  draft: LessonDraft;
  errors: FieldErrors;
  /** updated_at mais novo conhecido (leitura ou ultimo salvar): vai como expectedUpdatedAt. */
  knownUpdatedAt: string;
  lessonId: string;
  /** updated_at da ultima leitura do servidor que a sessao ja considerou. */
  serverStamp: string;
};

type PendingLeave = { kind: "close" } | { kind: "navigate"; lessonId: string };

export type SaveLessonFn = (
  lessonId: string,
  knownUpdatedAt: string,
  build: (expectedUpdatedAt: string) => UpdateLessonInput
) => Promise<ActionResult<LessonNode>>;

type LessonPanelProps = {
  canWrite: boolean;
  /** Leitura do servidor da aula aberta; null enquanto a navegacao para ?aula= ainda nao chegou. */
  editor: LessonEditorData | null;
  lessonId: string | null;
  /** Capa do produto (28 x 40) a esquerda do titulo, como no prototipo. */
  media?: ReactNode;
  neighbors: { next: string | null; previous: string | null };
  onClose: () => void;
  onNavigate: (lessonId: string) => void;
  onReload: () => void;
  open: boolean;
  positionLabel: string | null;
  productPublished: boolean;
  productTitle: string;
  saveLesson: SaveLessonFn;
  studentPreviewHref: string;
  treeLesson: TreeLesson | null;
};

function createSession(editor: LessonEditorData): Session {
  const baseline = draftFromLesson(editor.lesson);

  return {
    baseline,
    draft: baseline,
    errors: {},
    knownUpdatedAt: editor.lesson.updatedAt,
    lessonId: editor.lesson.id,
    serverStamp: editor.lesson.updatedAt
  };
}

/** Leitura nova do servidor (Recarregar, ou publicacao em massa): entra sem apagar o que foi digitado. */
function adoptServerRead(session: Session, editor: LessonEditorData): Session {
  const stamp = editor.lesson.updatedAt;

  if (Date.parse(stamp) < Date.parse(session.knownUpdatedAt)) {
    return { ...session, serverStamp: stamp };
  }

  const baseline = draftFromLesson(editor.lesson);

  return {
    ...session,
    baseline,
    draft: rebaseDraft(session.baseline, baseline, session.draft),
    knownUpdatedAt: stamp,
    serverStamp: stamp
  };
}

/** Sugestoes do provedor: titulo so quando o nome esta vazio ou generico; duracao quando o video mudou. */
function applySuggestions(session: Session | null, input: string, preview: VideoPreview): Session | null {
  if (!session || session.draft.videoInput.trim() !== input) {
    return session;
  }

  const draft = { ...session.draft };

  if (preview.suggestedTitle && shouldAdoptSuggestedTitle(draft.title)) {
    draft.title = preview.suggestedTitle.slice(0, 120);
  }

  if (input !== session.baseline.videoInput.trim() && draft.durationLabel.trim() === session.baseline.durationLabel.trim()) {
    draft.durationLabel = preview.durationLabel ?? "";
  }

  return { ...session, draft };
}

function fieldErrorsFrom(result: ActionResult<unknown>): FieldErrors {
  if (result.ok || !result.fieldErrors) {
    return {};
  }

  const errors: FieldErrors = {};

  for (const [path, messages] of Object.entries(result.fieldErrors)) {
    const key = path.split(".")[0] as FieldKey;

    if (["description", "durationLabel", "release", "title", "videoInput"].includes(key) && messages[0]) {
      errors[key] = messages[0];
    }
  }

  return errors;
}

export function LessonPanel({
  canWrite,
  editor,
  lessonId,
  media,
  neighbors,
  onClose,
  onNavigate,
  onReload,
  open,
  positionLabel,
  productPublished,
  productTitle,
  saveLesson,
  studentPreviewHref,
  treeLesson
}: LessonPanelProps) {
  const baseId = useId();
  const videoFieldRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reload: boolean } | null>(null);
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const [preview, setPreview] = useState<{ data: VideoPreview; input: string } | null>(null);
  const [previewingInput, setPreviewingInput] = useState<string | null>(null);

  // Sessao do formulario acompanha a aula aberta e as leituras novas do servidor (ajuste durante o
  // render, sem efeito: trocar de aula zera o formulario na mesma pintura).
  const editorMatches = editor !== null && editor.lesson.id === lessonId;

  if (editorMatches && (session === null || session.lessonId !== editor.lesson.id)) {
    setSession(createSession(editor));
    setFailure(null);
    setPendingLeave(null);
    setPreview(null);
  } else if (editorMatches && session && session.serverStamp !== editor.lesson.updatedAt) {
    setSession(adoptServerRead(session, editor));
  }

  const active = editorMatches && session?.lessonId === lessonId ? session : null;
  const dirty = active ? isDraftDirty(active.baseline, active.draft) : false;
  const videoInput = active?.draft.videoInput.trim() ?? "";
  const baselineVideoInput = active?.baseline.videoInput.trim() ?? "";
  const allowEmbedCode = active?.draft.allowEmbedCode ?? false;

  // Titulo, miniatura e duracao sugeridos pelo provedor, 400 ms depois de colar ou digitar o link.
  useEffect(() => {
    if (!canWrite || !videoInput || videoInput === baselineVideoInput) {
      return;
    }

    if (!detectLessonVideo(videoInput, { allowEmbedCode }).ok) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreviewingInput(videoInput);
      void previewVideo({ allowEmbedCode, videoInput }).then((result) => {
        if (cancelled) {
          return;
        }

        setPreviewingInput((current) => (current === videoInput ? null : current));

        if (!result.ok) {
          return;
        }

        setPreview({ data: result.data, input: videoInput });
        setSession((current) => applySuggestions(current, videoInput, result.data));
      });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allowEmbedCode, baselineVideoInput, canWrite, videoInput]);

  // Foco ao abrir (nao ao trocar de aula pelas setas do cabecalho): com video, o nome; sem video, o
  // campo do link. Espera a leitura do servidor quando o painel abriu antes dela.
  const focusOnLoad = useRef(false);
  const activeLessonId = active?.lessonId ?? null;
  const focusTitle = Boolean(baselineVideoInput);

  useEffect(() => {
    focusOnLoad.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || !activeLessonId || !focusOnLoad.current) {
      return;
    }

    focusOnLoad.current = false;
    const frame = window.requestAnimationFrame(() => {
      const target = focusTitle ? titleRef.current : videoFieldRef.current?.querySelector<HTMLElement>("input, textarea");
      target?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeLessonId, focusTitle, open]);

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canWrite && active && !saving) {
      event.preventDefault();
      void save();
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      handleShortcut(event);
    }

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || !dirty) {
      return;
    }

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, open]);

  function updateDraft(patch: Partial<LessonDraft>, clear: FieldKey[] = []) {
    setSession((current) => {
      if (!current) {
        return current;
      }

      const errors = { ...current.errors };
      clear.forEach((key) => delete errors[key]);

      return { ...current, draft: { ...current.draft, ...patch }, errors };
    });
    setPendingLeave(null);
  }

  function validateField(key: FieldKey) {
    setSession((current) => {
      if (!current) {
        return current;
      }

      const message = (validateLessonDraft(current.draft) as FieldErrors)[key];
      const errors = { ...current.errors };

      if (message) {
        errors[key] = message;
      } else {
        delete errors[key];
      }

      return { ...current, errors };
    });
  }

  function leave(action: PendingLeave) {
    setPendingLeave(null);

    if (action.kind === "close") {
      onClose();
    } else {
      onNavigate(action.lessonId);
    }
  }

  async function save(after?: PendingLeave) {
    if (!active || saving || !canWrite) {
      return;
    }

    const errors = validateLessonDraft(active.draft) as FieldErrors;

    if (Object.keys(errors).length > 0) {
      setSession({ ...active, errors });
      setPendingLeave(null);

      if (errors.videoInput) {
        videoFieldRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
      } else if (errors.title) {
        titleRef.current?.focus();
      }

      return;
    }

    if (!isDraftDirty(active.baseline, active.draft)) {
      if (after) {
        leave(after);
      }

      return;
    }

    const sent = active.draft;
    const sentBaseline = active.baseline;
    const sentId = active.lessonId;

    setSaving(true);
    setFailure(null);
    const result = await saveLesson(sentId, active.knownUpdatedAt, (expectedUpdatedAt) =>
      buildLessonUpdate({ baseline: sentBaseline, draft: sent, expectedUpdatedAt, id: sentId })
    );
    setSaving(false);

    if (result.ok) {
      const saved = result.data;

      setSession((current) =>
        current && current.lessonId === sentId
          ? {
              ...current,
              baseline: {
                ...sent,
                durationLabel: saved.durationLabel ?? sent.durationLabel,
                release: saved.release,
                status: saved.status,
                title: saved.title
              },
              errors: {},
              knownUpdatedAt: saved.updatedAt
            }
          : current
      );
      adminToast.success("Aula salva");

      if (after) {
        leave(after);
      }

      return;
    }

    setPendingLeave(null);
    const fieldErrors = fieldErrorsFrom(result);

    if (Object.keys(fieldErrors).length > 0) {
      setSession((current) => (current && current.lessonId === sentId ? { ...current, errors: { ...current.errors, ...fieldErrors } } : current));

      return;
    }

    setFailure({ message: result.error, reload: result.status === 409 || result.status === 404 });
  }

  function requestLeave(action: PendingLeave) {
    if (dirty && canWrite) {
      setPendingLeave(action);

      return;
    }

    leave(action);
  }

  const title = active?.draft.title.trim() || treeLesson?.title || editor?.lesson.title || "Aula";
  // Provedor do video salvo (depois de "Salvar", o link novo ja vale para "Importar do YouTube").
  const savedDetection = baselineVideoInput
    ? detectLessonVideo(baselineVideoInput, { allowEmbedCode: active?.baseline.allowEmbedCode ?? false })
    : null;
  const savedProvider = savedDetection?.ok ? savedDetection.provider : null;
  const published = (active?.draft.status ?? treeLesson?.status) === "published";
  const ids = {
    description: `${baseId}-description`,
    duration: `${baseId}-duration`,
    publish: `${baseId}-publish`,
    release: `${baseId}-release`,
    title: `${baseId}-title`,
    video: `${baseId}-video`
  };

  const footer = pendingLeave ? (
    <>
      <p className="flex min-w-0 items-center gap-2 text-sm leading-5 font-medium text-[var(--text-primary)]" role="alert">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-[var(--warning)]" />
        <span className="truncate">Alterações não salvas nesta aula.</span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          className="px-4 text-[var(--text-secondary)]"
          disabled={saving}
          onClick={() => {
            setSession((current) => (current ? { ...current, draft: current.baseline, errors: {} } : current));
            leave(pendingLeave);
          }}
          type="button"
          variant="ghost"
        >
          Descartar
        </Button>
        <Button className="px-4" disabled={saving} onClick={() => void save(pendingLeave)} type="button">
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </>
  ) : (
    <>
      <AdminSwitch
        checked={published}
        disabled={!canWrite || !active || saving}
        effect={published ? "Alunos com acesso veem" : "Só a equipe vê"}
        id={ids.publish}
        label="Publicada"
        onCheckedChange={(checked) => updateDraft({ status: checked ? "published" : "draft" })}
      />
      <div className="flex shrink-0 items-center gap-2">
        {dirty ? <span className="hidden text-[13px] leading-5 text-[var(--text-secondary)] sm:inline">Não salvo</span> : null}
        <StudentPreviewButton
          blockedReason={studentPreviewBlockedReason({
            // A aula como esta salva (o que o aluno veria agora), nao a chave ainda nao salva.
            lessonPublished: (active?.baseline.status ?? treeLesson?.status) === "published",
            productPublished
          })}
          compactOnMobile
          href={editorMatches && editor ? editor.studentPreviewHref : studentPreviewHref}
        />
        {canWrite ? (
          <Button
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="px-4"
            disabled={saving || !active}
            onClick={() => void save()}
            type="button"
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        ) : null}
      </div>
    </>
  );

  const navButtonClass =
    "size-8! text-[var(--text-secondary)] hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)] disabled:opacity-40 pointer-coarse:size-11!";

  return (
    <AdminSheet
      description={positionLabel ?? editor?.positionLabel ?? undefined}
      eyebrow={productTitle}
      footer={footer}
      media={media}
      headerActions={
        <>
          <Button
            aria-label="Aula anterior"
            className={navButtonClass}
            disabled={!neighbors.previous}
            onClick={() => neighbors.previous && requestLeave({ kind: "navigate", lessonId: neighbors.previous })}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronUp aria-hidden="true" className="size-5" />
          </Button>
          <Button
            aria-label="Próxima aula"
            className={navButtonClass}
            disabled={!neighbors.next}
            onClick={() => neighbors.next && requestLeave({ kind: "navigate", lessonId: neighbors.next })}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronDown aria-hidden="true" className="size-5" />
          </Button>
        </>
      }
      onBeforeClose={() => {
        if (dirty && canWrite) {
          setPendingLeave({ kind: "close" });

          return false;
        }

        return true;
      }}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
      title={title}
    >
      {failure ? (
        <ErrorBanner
          action={
            failure.reload ? (
              <Button className="h-8! px-3" onClick={onReload} type="button" variant="secondary">
                Recarregar
              </Button>
            ) : null
          }
          className="mt-4"
          title="A aula não foi salva."
        >
          {failure.message}
        </ErrorBanner>
      ) : null}

      {active ? (
        <>
          <AdminSheetSection title="Vídeo">
            <div ref={videoFieldRef}>
              <LessonVideoField
                allowEmbedCode={active.draft.allowEmbedCode}
                disabled={!canWrite || saving}
                durationLabel={active.draft.durationLabel}
                error={active.errors.videoInput}
                id={ids.video}
                onAllowEmbedCodeChange={(allow) => updateDraft({ allowEmbedCode: allow }, ["videoInput"])}
                onBlur={() => validateField("videoInput")}
                onChange={(value) => updateDraft({ videoInput: value }, ["videoInput"])}
                preview={preview && preview.input === videoInput ? preview.data : null}
                previewLoading={previewingInput !== null && previewingInput === videoInput}
                savedThumbnailUrl={editor?.lesson.thumbnailUrl ?? null}
                savedVideoInput={active.baseline.videoInput}
                value={active.draft.videoInput}
              />
            </div>
          </AdminSheetSection>

          <AdminSheetSection title="Conteúdo">
            <AdminField error={active.errors.title} id={ids.title} label="Nome">
              <input
                aria-describedby={fieldDescribedBy(ids.title, { error: active.errors.title })}
                aria-invalid={active.errors.title ? true : undefined}
                autoComplete="off"
                className={adminInputClass}
                disabled={!canWrite || saving}
                id={ids.title}
                maxLength={120}
                onBlur={() => validateField("title")}
                onChange={(event) => updateDraft({ title: event.target.value }, ["title"])}
                ref={titleRef}
                value={active.draft.title}
              />
            </AdminField>
            <AdminField error={active.errors.description} id={ids.description} label="Descrição" optional>
              <textarea
                aria-describedby={fieldDescribedBy(ids.description, { error: active.errors.description })}
                aria-invalid={active.errors.description ? true : undefined}
                className={adminTextareaClass}
                disabled={!canWrite || saving}
                id={ids.description}
                maxLength={5000}
                onChange={(event) => updateDraft({ description: event.target.value }, ["description"])}
                placeholder="O que o aluno aprende nesta aula"
                rows={4}
                value={active.draft.description}
              />
            </AdminField>
            <AdminField
              error={active.errors.durationLabel}
              hint="Ex.: 12:40. Vem do provedor quando ele informa."
              id={ids.duration}
              label="Duração"
              optional
            >
              <input
                aria-describedby={fieldDescribedBy(ids.duration, {
                  error: active.errors.durationLabel,
                  hint: "Ex.: 12:40. Vem do provedor quando ele informa."
                })}
                aria-invalid={active.errors.durationLabel ? true : undefined}
                autoComplete="off"
                className={cn(adminInputClass, "w-32 tabular-nums")}
                disabled={!canWrite || saving}
                id={ids.duration}
                maxLength={20}
                onChange={(event) => updateDraft({ durationLabel: event.target.value }, ["durationLabel"])}
                value={active.draft.durationLabel}
              />
            </AdminField>
          </AdminSheetSection>

          <AdminSheetSection title="Transcrição e Tutor IA">
            <LessonTranscriptSection
              canWrite={canWrite}
              key={active.lessonId}
              lessonId={active.lessonId}
              savedProvider={savedProvider}
            />
          </AdminSheetSection>

          <AdminSheetSection title="Liberação">
            <ReleasePhraseField
              disabled={!canWrite || saving}
              entity="aula"
              error={active.errors.release}
              id={ids.release}
              onChange={(release) => updateDraft({ release }, ["release"])}
              value={active.draft.release}
            />
          </AdminSheetSection>
        </>
      ) : (
        <LessonPanelSkeleton />
      )}
    </AdminSheet>
  );
}

/** Corpo do painel enquanto a aula carrega: a forma das secoes, sem dado inventado. */
function LessonPanelSkeleton() {
  const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

  return (
    <div aria-busy="true" className="flex flex-col">
      <span className="sr-only" role="status">
        Carregando a aula
      </span>
      {[0, 1, 2].map((section) => (
        <div aria-hidden="true" className="flex flex-col gap-3 border-b border-[var(--border-subtle)] py-5 last:border-b-0" key={section}>
          <Skeleton className={cn("h-5 w-24", bar)} />
          <Skeleton className={cn("h-4 w-28", bar)} />
          <Skeleton className={cn("h-10 w-full rounded-lg", bar)} />
          {section === 0 ? <Skeleton className={cn("h-[62px] w-full rounded-lg", bar)} /> : null}
          {section === 1 ? <Skeleton className={cn("h-24 w-full rounded-lg", bar)} /> : null}
        </div>
      ))}
    </div>
  );
}
