"use client";

import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { suggestYouTubeCourseModuleRanges, type YouTubeCourseImportModuleRange } from "@/lib/youtube-course-import";
import { cn } from "@/lib/utils";
import {
  PRODUCT_AUDIENCES,
  PRODUCT_AUDIENCE_LABELS,
  playlistAlreadyImportedMessage,
  type ProductAudience
} from "@/server/catalog/model";
import { importPlaylist, previewPlaylist } from "@/server/catalog/import-actions";
import { importPlaylistSchema, previewPlaylistSchema, productTitleSchema, shortDescriptionSchema } from "@/server/catalog/schemas";
import type { PlaylistImported, PlaylistPreview } from "@/server/catalog/types";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { AdminLinkButton } from "../link-button";
import { adminCard } from "../styles";
import { adminToast } from "../toast";
import { FieldLegend, FormSection } from "./form-section";
import { ImageField } from "./image-field";
import { PlaylistModulesPreview, PlaylistRangeEditor } from "./playlist-preview";
import {
  PLAYLIST_ORGANIZATION_LABELS,
  arrangePlaylist,
  describeFoundLessons,
  describeLessonCount,
  describeModuleCount,
  describeOrganization,
  initialManualRanges,
  organizationModeFor,
  suggestedOrganization,
  suggestedProductText,
  type PlaylistOrganization
} from "./playlist-ranges";
import { AUDIENCE_HINTS, firstErrorsByField, firstServerFieldErrors } from "./product-forms";
import { useWarnBeforeUnload } from "./use-warn-before-unload";

// Importar playlist do YouTube (docs/17 §1.6.7): colar o link, "Ler playlist", escolher como
// organizar (pelos titulos, tudo em um modulo ou manual), conferir a previa, dar nome e capa e
// "Importar como rascunho". O fluxo do admin antigo continua igual; aqui so muda a tela.

const DESCRIPTION_LIMIT = 300;
const ORGANIZATIONS: PlaylistOrganization[] = ["automatic", "single", "manual"];

type Done = PlaylistImported & { hasCover: boolean; title: string };

/** canSetAccess: pode decidir quem ve ("regras de acesso e venda"); sem isso o curso nasce so para quem tiver acesso. */
export function PlaylistImport({ canSetAccess }: { canSetAccess: boolean }) {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readFailure, setReadFailure] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [organization, setOrganization] = useState<PlaylistOrganization>("automatic");
  const [manualRanges, setManualRanges] = useState<YouTubeCourseImportModuleRange[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<string | null>(null);
  const [audience, setAudience] = useState<ProductAudience>("with_access");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const existingCourse = preview?.existingCourse ?? null;
  const arranged = preview && !existingCourse ? arrangePlaylist(preview, organization, manualRanges) : null;
  const lessonsTotal = arranged?.modules.reduce((total, courseModule) => total + courseModule.lessons.length, 0) ?? 0;

  useWarnBeforeUnload(Boolean(preview) && !existingCourse && !done);

  function setFieldError(field: string, message: string | null) {
    setErrors((current) => {
      const next = { ...current };

      if (message) {
        next[field] = message;
      } else {
        delete next[field];
      }

      return next;
    });
  }

  function reset() {
    setPreview(null);
    setDone(null);
    setUrl("");
    setTitle("");
    setDescription("");
    setCover(null);
    setAudience("with_access");
    setErrors({});
    setFailure(null);
    setReadFailure(null);
    setManualRanges([]);
  }

  async function read(event?: FormEvent) {
    event?.preventDefault();

    if (reading) {
      return;
    }

    const checked = previewPlaylistSchema.shape.playlistUrl.safeParse(url);

    if (!checked.success) {
      setUrlError(checked.error.issues[0]?.message ?? "Cole o link de uma playlist do YouTube.");
      return;
    }

    setUrlError(null);
    setReadFailure(null);
    setReading(true);
    const result = await previewPlaylist({ playlistUrl: checked.data });
    setReading(false);

    if (!result.ok) {
      const fieldMessage = result.fieldErrors?.playlistUrl?.[0];

      if (fieldMessage) {
        setUrlError(fieldMessage);
      } else {
        setReadFailure(result.error);
      }

      return;
    }

    const suggested = suggestedProductText(result.data);

    setPreview(result.data);
    setOrganization(suggestedOrganization(result.data.naming));
    setManualRanges(initialManualRanges(suggestYouTubeCourseModuleRanges(result.data)));
    setTitle(suggested.title);
    setDescription(suggested.description);
    setErrors({});
    setFailure(null);
  }

  async function runImport() {
    if (!preview || !arranged || importing) {
      return;
    }

    if (arranged.problem) {
      setFailure(arranged.problem);
      return;
    }

    const chosenAudience: ProductAudience = canSetAccess ? audience : "with_access";
    const input = {
      accessModel: chosenAudience === "all_students" ? ("free" as const) : ("closed" as const),
      audience: chosenAudience,
      coursePresentationMode: "lesson_playlist" as const,
      description: description.trim(),
      image: cover ?? "",
      moduleRanges: organization === "automatic" ? [] : arranged.ranges,
      organizationMode: organizationModeFor(organization),
      playlistUrl: preview.playlistUrl,
      title: title.trim()
    };
    const parsed = importPlaylistSchema.safeParse(input);

    if (!parsed.success) {
      const fieldErrors = firstErrorsByField(parsed.error.issues);
      setErrors(fieldErrors);
      setFailure(fieldErrors.moduleRanges ?? null);
      document.getElementById(fieldErrors.title ? "importar-nome" : "importar-descricao")?.focus();
      return;
    }

    setImporting(true);
    setFailure(null);
    const result = await importPlaylist(input);
    setImporting(false);

    if (!result.ok) {
      const fieldErrors = firstServerFieldErrors(result.fieldErrors);

      if (fieldErrors.image || fieldErrors.title || fieldErrors.description) {
        setErrors(fieldErrors);
      } else {
        setFailure(result.error);
      }

      return;
    }

    setDone({ ...result.data, hasCover: Boolean(cover), title: input.title });
    adminToast.success("Playlist importada como rascunho");
  }

  if (done) {
    return (
      <div className={cn(adminCard, "flex w-full max-w-[640px] min-w-0 flex-col gap-5 p-6")} role="status">
        <div className="flex items-start gap-3">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--success)]" />
          <div className="min-w-0">
            <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">“{done.title}” foi importado como rascunho</h2>
            <p className="mt-0.5 text-sm leading-5 text-[var(--text-secondary)] tabular-nums">
              {describeModuleCount(done.moduleCount)} · {describeLessonCount(done.lessonCount)}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2.5 text-sm leading-5 text-[var(--text-primary)]">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
          <p>
            <span className="font-medium">Falta publicar.</span>{" "}
            {done.hasCover
              ? "Os alunos só veem o produto depois que você publicar."
              : "Adicione uma capa em Detalhes e publique quando estiver pronto."}
          </p>
        </div>

        {done.warnings.length > 0 ? (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            Alguns títulos não indicaram o módulo ou vieram com nomes diferentes. Confira a ordem na aba Conteúdo.
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <AdminLinkButton href={done.href}>Abrir produto</AdminLinkButton>
          <Button className="px-4" onClick={reset} type="button" variant="secondary">
            Importar outra playlist
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[640px] min-w-0 flex-col gap-8">
      <FormSection title="Playlist">
        <form className="flex min-w-0 flex-col gap-1.5" noValidate onSubmit={(event) => void read(event)}>
          <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor="importar-link">
            Link da playlist do YouTube
          </label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input
              aria-describedby={urlError ? "importar-link-error" : "importar-link-hint"}
              aria-invalid={urlError ? true : undefined}
              autoComplete="off"
              autoFocus={!preview}
              className={cn(adminInputClass, "sm:flex-1")}
              disabled={reading || importing}
              id="importar-link"
              inputMode="url"
              onChange={(event) => {
                setUrl(event.target.value);
                if (urlError) {
                  setUrlError(null);
                }
              }}
              placeholder="https://www.youtube.com/playlist?list=..."
              type="url"
              value={url}
            />
            <Button className="shrink-0 px-4" disabled={reading || importing} type="submit" variant={preview ? "secondary" : "default"}>
              {reading ? (
                <>
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                  Lendo…
                </>
              ) : preview ? (
                "Ler de novo"
              ) : (
                "Ler playlist"
              )}
            </Button>
          </div>
          {urlError ? (
            <p className="text-[13px] leading-5 text-[var(--error)]" id="importar-link-error" role="alert">
              {urlError}
            </p>
          ) : (
            <p className="text-xs leading-5 text-[var(--text-secondary)]" id="importar-link-hint">
              A playlist precisa ser pública ou não listada. Cada vídeo vira uma aula.
            </p>
          )}
        </form>
        {readFailure ? <ErrorBanner>{readFailure}</ErrorBanner> : null}
      </FormSection>

      {existingCourse ? (
        <div
          className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4"
          role="status"
        >
          <div className="flex items-start gap-2 text-sm leading-5 text-[var(--text-primary)]">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
            <p className="min-w-0 break-words">
              {playlistAlreadyImportedMessage(existingCourse.title)} Importar de novo trocaria o nome, a descrição e as
              aulas dele.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <AdminLinkButton href={existingCourse.href}>Abrir curso</AdminLinkButton>
            <Button className="px-4" onClick={reset} type="button" variant="secondary">
              Ler outra playlist
            </Button>
          </div>
        </div>
      ) : null}

      {preview && arranged ? (
        <>
          <FormSection
            description={`${describeFoundLessons(preview.totalLessons)} em “${preview.title}”.`}
            title="Como organizar"
          >
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="sr-only">Como organizar</legend>
              <PillGroup
                ariaLabel="Como organizar"
                disabled={importing}
                name="importar-organizar"
                onChange={setOrganization}
                options={ORGANIZATIONS.map((value) => ({ label: PLAYLIST_ORGANIZATION_LABELS[value], value }))}
                value={organization}
              />
              <p className="text-xs leading-5 text-[var(--text-secondary)]">{describeOrganization(organization, preview.naming)}</p>
            </fieldset>

            {organization === "manual" ? (
              <PlaylistRangeEditor disabled={importing} onChange={setManualRanges} ranges={manualRanges} videos={preview.videos} />
            ) : null}

            {arranged.problem ? (
              <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" role="alert">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {arranged.problem}
              </p>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
                  Vai ficar assim: {describeModuleCount(arranged.modules.length)} · {describeLessonCount(lessonsTotal)}
                </p>
                <PlaylistModulesPreview modules={arranged.modules} />
              </div>
            )}
          </FormSection>

          <FormSection description="Dá para mudar tudo depois, nas abas do produto." title="Sobre o produto">
            <AdminField error={errors.title} id="importar-nome" label="Nome">
              <Input
                aria-describedby={fieldDescribedBy("importar-nome", { error: errors.title })}
                aria-invalid={errors.title ? true : undefined}
                autoComplete="off"
                className={adminInputClass}
                disabled={importing}
                id="importar-nome"
                maxLength={80}
                onBlur={() => {
                  const result = productTitleSchema.safeParse(title);
                  setFieldError("title", result.success ? null : (result.error.issues[0]?.message ?? "Nome inválido."));
                }}
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </AdminField>

            <AdminField error={errors.description} id="importar-descricao" label="Descrição curta" optional>
              <textarea
                aria-describedby={fieldDescribedBy("importar-descricao", { error: errors.description })}
                aria-invalid={errors.description ? true : undefined}
                className={cn(adminTextareaClass, "min-h-[88px]")}
                disabled={importing}
                id="importar-descricao"
                maxLength={DESCRIPTION_LIMIT}
                onBlur={() => {
                  const result = shortDescriptionSchema.safeParse(description);
                  setFieldError("description", result.success ? null : (result.error.issues[0]?.message ?? "Descrição inválida."));
                }}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                value={description}
              />
              <span className="self-end text-xs text-[var(--text-tertiary)] tabular-nums">
                {description.length}/{DESCRIPTION_LIMIT}
              </span>
            </AdminField>

            <ImageField
              error={errors.image}
              id="importar-capa"
              label="Capa"
              onChange={(value) => {
                setCover(value);
                setFieldError("image", null);
              }}
              optional
              pending={importing}
              slot="cover"
              value={cover}
            />

            {canSetAccess ? (
              <fieldset className="flex min-w-0 flex-col gap-1.5">
                <FieldLegend>Quem pode ver</FieldLegend>
                <PillGroup
                  ariaLabel="Quem pode ver"
                  disabled={importing}
                  name="importar-quem-pode-ver"
                  onChange={setAudience}
                  options={PRODUCT_AUDIENCES.map((value) => ({ label: PRODUCT_AUDIENCE_LABELS[value], value }))}
                  value={audience}
                />
                <p className="text-xs leading-5 text-[var(--text-secondary)]">{AUDIENCE_HINTS[audience]}</p>
              </fieldset>
            ) : (
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                {AUDIENCE_HINTS.with_access} Quem pode ver fica com quem cuida de acesso e venda.
              </p>
            )}
          </FormSection>

          <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--border-subtle)] pt-6">
            {failure ? <ErrorBanner>{failure}</ErrorBanner> : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button className="px-4" disabled={importing} onClick={() => void runImport()} type="button">
                {importing ? (
                  <>
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                    Importando…
                  </>
                ) : (
                  "Importar como rascunho"
                )}
              </Button>
              <Button className="px-4 text-[var(--text-secondary)]" disabled={importing} onClick={reset} type="button" variant="ghost">
                Começar de novo
              </Button>
            </div>
            {importing ? (
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
                Criando {describeModuleCount(arranged.modules.length)} e {describeLessonCount(lessonsTotal)} de uma vez. Leva alguns segundos.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
