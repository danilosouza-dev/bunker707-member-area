"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CONFLICT_MESSAGE } from "@/server/catalog/errors";
import { PRODUCT_FORMAT_LABELS, type ProductFormat } from "@/server/catalog/model";
import { setProductHeroCorners, setProductImage, setProductThumbnailSize, updateProductDetails } from "@/server/catalog/product-actions";
import { shortDescriptionSchema, updateProductDetailsSchema } from "@/server/catalog/schemas";
import type { ProductDetails, ProductHeroCorners, ProductThumbnailSize } from "@/server/catalog/types";
import type { HomeModuleRowState } from "@/server/member-area/modules-model";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { HomeRowControl } from "../member-area/modules/home-row-control";
import { SaveBar } from "../save-bar";
import { adminToast } from "../toast";
import { AccentPicker } from "./accent-picker";
import { FieldError, FieldLegend, ReadOnlyField } from "./form-section";
import { ImageField } from "./image-field";
import {
  LOCKED_ACTION_HINTS,
  LOCKED_ACTION_OPTIONS,
  PRESENTATION_MODE_HINTS,
  PRESENTATION_MODE_OPTIONS,
  buildDetailsPatch,
  describeDurationTotal,
  detailsDraftFrom,
  editableFormats,
  firstErrorsByField,
  firstServerFieldErrors,
  isEmptyPatch,
  levelOptions,
  normalizeLevel,
  rebaseDraft,
  supportsPresentationMode,
  type DetailsDraft
} from "./product-forms";
import { useProductWorkspace } from "./product-workspace";
import { useWarnBeforeUnload } from "./use-warn-before-unload";

// Aba Detalhes (docs/17 §1.6.5) na disposicao do prototipo aprovado: uma coluna de 640 px, sem
// titulos de bloco, 24 px entre os campos, nesta ordem: descricao curta, instrutor, nivel, duracao
// calculada, como abre, clique quando bloqueado, cor do produto e capa. O que veio depois do prototipo
// entra em seguida, na mesma coluna: imagem de destaque, a fileira de modulos na home e o formato.
// Imagens e fileira salvam na hora; o resto salva junto pela SaveBar, enviando so o que mudou.

const DESCRIPTION_LIMIT = 300;

type ImageSlot = "cover" | "hero";

/** Tamanho da thumbnail do card (salva na hora). Define o recorte do envio e o tamanho do card do aluno. */
const THUMBNAIL_SIZE_OPTIONS: ReadonlyArray<{ label: string; value: ProductThumbnailSize }> = [
  { label: "Tamanho anterior (720 × 1040)", value: "classic" },
  { label: "284 × 426", value: "large" }
];
const THUMBNAIL_SIZE_HINTS: Record<ProductThumbnailSize, string> = {
  classic: "Recorte 9:13 em até 720 × 1040 px (imagem a partir de 540 × 780). Os cards deste produto e dos módulos ficam no tamanho anterior. Salva na hora.",
  large: "Recorte 2:3 em 284 × 426 px (imagem a partir de 284 × 426). Os cards deste produto e dos módulos ficam com 284 × 426 no computador. Salva na hora."
};
const THUMBNAIL_SIZE_TOASTS: Record<ProductThumbnailSize, string> = {
  classic: "Thumbnail no tamanho anterior",
  large: "Thumbnail em 284 × 426"
};

/** Cantos do banner da pagina do produto (salva na hora). "Como a área" segue Marca > Estilo. */
const HERO_CORNERS_OPTIONS: ReadonlyArray<{ label: string; value: ProductHeroCorners }> = [
  { label: "Como a área", value: "inherit" },
  { label: "Arredondados", value: "rounded" },
  { label: "Retos", value: "soft" }
];
const HERO_CORNERS_HINTS: Record<ProductHeroCorners, string> = {
  inherit: "Segue a escolha de Área de membros › Marca › Estilo. Salva na hora.",
  rounded: "Nesta página o banner tem margem e cantos redondos, como a home arredondada. Salva na hora.",
  soft: "Nesta página o banner vai de ponta a ponta. Salva na hora."
};
const HERO_CORNERS_TOASTS: Record<ProductHeroCorners, string> = {
  inherit: "Banner segue a área",
  rounded: "Banner com cantos arredondados",
  soft: "Banner com cantos retos"
};
type SaveFailure = { message: string; status: number };

const imageCopy: Record<ImageSlot, { removed: string; saved: string }> = {
  cover: { removed: "Thumbnail removida", saved: "Thumbnail salva" },
  hero: { removed: "Imagem de destaque removida", saved: "Imagem de destaque salva" }
};

function initialDraft(details: ProductDetails): DetailsDraft {
  return detailsDraftFrom({ ...details, level: normalizeLevel(details.level) });
}

type ProductDetailsFormProps = {
  /** Pode ligar a fileira de modulos na home (storefront.write)? */
  canWriteStorefront?: boolean;
  details: ProductDetails;
  /** Fileira de modulos na home; null = nao deu para ler (a linha some, a aba continua). */
  homeModuleRow?: HomeModuleRowState | null;
};

export function ProductDetailsForm({ canWriteStorefront = false, details, homeModuleRow = null }: ProductDetailsFormProps) {
  const router = useRouter();
  const { applyHeader, applyImage, capabilities, header } = useProductWorkspace();
  const readOnly = !capabilities.canWrite;
  const [source, setSource] = useState(details);
  const [baseline, setBaseline] = useState(() => initialDraft(details));
  const [draft, setDraft] = useState(baseline);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const [heroUrl, setHeroUrl] = useState(details.heroUrl);
  const [heroCorners, setHeroCorners] = useState<ProductHeroCorners>(details.heroCorners);
  const [thumbnailSize, setThumbnailSize] = useState<ProductThumbnailSize>(details.thumbnailSize);
  const [thumbnailPending, setThumbnailPending] = useState(false);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [cornersPending, setCornersPending] = useState(false);
  const [cornersError, setCornersError] = useState<string | null>(null);
  const [imagePending, setImagePending] = useState<ImageSlot | null>(null);
  const [imageErrors, setImageErrors] = useState<Partial<Record<ImageSlot, string>>>({});
  const patch = buildDetailsPatch(baseline, draft);
  const dirty = !readOnly && !isEmptyPatch(patch);
  const format = header.format;
  const formats = editableFormats(format);
  const presentation = supportsPresentationMode(format);
  const images: Record<ImageSlot, string | null> = { cover: header.coverUrl, hero: heroUrl };
  const hasFieldErrors = Object.keys(errors).length > 0;

  // Versao nova do servidor (Recarregar, publicar...): segue o servidor sem perder o que foi editado.
  if (source !== details) {
    const nextBaseline = initialDraft(details);

    setSource(details);
    setBaseline(nextBaseline);
    setDraft(rebaseDraft(baseline, draft, nextBaseline));
    setFailure(null);

    if (!imagePending) {
      setHeroUrl(details.heroUrl);
      setHeroCorners(details.heroCorners);
      setThumbnailSize(details.thumbnailSize);
    }
  }

  useWarnBeforeUnload(dirty);

  function update<Key extends keyof DetailsDraft>(key: Key, value: DetailsDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));

    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function checkField(key: "instructorName" | "level" | "shortDescription", value: string) {
    const schema = key === "shortDescription" ? shortDescriptionSchema : updateProductDetailsSchema.shape[key];
    const result = schema.safeParse(value);

    setErrors((current) => {
      const next = { ...current };

      if (result.success) {
        delete next[key];
      } else {
        next[key] = result.error.issues[0]?.message ?? "Valor inválido.";
      }

      return next;
    });
  }

  async function save() {
    if (saving || !dirty) {
      return;
    }

    const input = { ...patch, expectedUpdatedAt: header.updatedAt, id: header.id };
    const parsed = updateProductDetailsSchema.safeParse(input);

    if (!parsed.success) {
      setErrors(firstErrorsByField(parsed.error.issues));
      setFailure(null);
      return;
    }

    setSaving(true);
    setFailure(null);
    const result = await updateProductDetails(input);
    setSaving(false);

    if (!result.ok) {
      const fieldErrors = firstServerFieldErrors(result.fieldErrors);

      // 409 por regra (alunos com acesso, Formação) cai no campo Formato; 409 de edicao concorrente vai para o banner.
      if (result.status === 409 && patch.format && result.error !== CONFLICT_MESSAGE) {
        fieldErrors.format = result.error;
      }

      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
      } else {
        setFailure({ message: result.error, status: result.status });
      }

      return;
    }

    applyHeader(result.data.header);
    setBaseline(draft);
    setErrors({});
    adminToast.success("Detalhes salvos");
  }

  async function saveImage(slot: ImageSlot, value: string | null, options: { undoable?: boolean } = {}) {
    const previous = images[slot];

    setImagePending(slot);
    setImageErrors((current) => ({ ...current, [slot]: undefined }));
    // A thumbnail sobe no tamanho escolhido acima do campo ("cover" = anterior, "coverLarge" = 284 x 426).
    const result = await setProductImage({ id: header.id, image: value, slot: slot === "cover" && thumbnailSize === "large" ? "coverLarge" : slot });
    setImagePending(null);

    if (!result.ok) {
      setImageErrors((current) => ({
        ...current,
        [slot]: result.fieldErrors?.image?.[0] ?? result.error
      }));
      return;
    }

    applyImage(result.data);

    if (slot === "hero") {
      setHeroUrl(result.data.url);
    }

    if (result.data.url) {
      adminToast.success(imageCopy[slot].saved);
      return;
    }

    adminToast.success(
      imageCopy[slot].removed,
      options.undoable !== false && previous && /^https:\/\//.test(previous)
        ? { onUndo: () => void saveImage(slot, previous, { undoable: false }) }
        : undefined
    );
  }

  // Tamanho da thumbnail: salva na hora e define o recorte do proximo envio (produto e modulos).
  async function saveThumbnailSize(size: ProductThumbnailSize) {
    if (readOnly || thumbnailPending || size === thumbnailSize) {
      return;
    }

    const previous = thumbnailSize;
    setThumbnailSize(size);
    setThumbnailPending(true);
    setThumbnailError(null);

    const result = await setProductThumbnailSize({ id: header.id, thumbnailSize: size });
    setThumbnailPending(false);

    if (!result.ok) {
      setThumbnailSize(previous);
      setThumbnailError(result.error);
      return;
    }

    applyHeader({ ...header, updatedAt: result.data.updatedAt });
    adminToast.success(THUMBNAIL_SIZE_TOASTS[size]);
  }

  // Cantos do banner: salva na hora, como as imagens. Erro volta a escolha anterior.
  async function saveHeroCorners(corners: ProductHeroCorners) {
    if (readOnly || cornersPending || corners === heroCorners) {
      return;
    }

    const previous = heroCorners;
    setHeroCorners(corners);
    setCornersPending(true);
    setCornersError(null);

    const result = await setProductHeroCorners({ corners, id: header.id });
    setCornersPending(false);

    if (!result.ok) {
      setHeroCorners(previous);
      setCornersError(result.error);
      return;
    }

    applyHeader({ ...header, updatedAt: result.data.updatedAt });
    adminToast.success(HERO_CORNERS_TOASTS[corners]);
  }

  const descriptionHint = "Aparece no card e nos detalhes do produto na área do aluno.";

  return (
    <div className="flex w-full max-w-[640px] min-w-0 flex-col gap-6">
      {failure?.status === 409 ? (
        <ErrorBanner
          action={
            failure.status === 409 ? (
              <Button className="px-3" onClick={() => router.refresh()} type="button" variant="secondary">
                Recarregar
              </Button>
            ) : null
          }
        >
          {failure.message}
        </ErrorBanner>
      ) : null}

      <AdminField error={errors.shortDescription} hint={descriptionHint} id="detalhes-descricao" label="Descrição curta" optional>
        <textarea
          aria-describedby={fieldDescribedBy("detalhes-descricao", { error: errors.shortDescription, hint: descriptionHint })}
          aria-invalid={errors.shortDescription ? true : undefined}
          className={cn(adminTextareaClass, "min-h-[88px]")}
          disabled={readOnly}
          id="detalhes-descricao"
          maxLength={DESCRIPTION_LIMIT}
          onBlur={() => checkField("shortDescription", draft.shortDescription)}
          onChange={(event) => update("shortDescription", event.target.value)}
          placeholder="O que o aluno consegue fazer ao final."
          rows={3}
          value={draft.shortDescription}
        />
        <span
          className={cn(
            "self-end text-xs tabular-nums",
            draft.shortDescription.length >= DESCRIPTION_LIMIT - 30 ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"
          )}
        >
          {draft.shortDescription.length}/{DESCRIPTION_LIMIT}
        </span>
      </AdminField>

      <AdminField error={errors.instructorName} id="detalhes-instrutor" label="Instrutor" optional>
        <Input
          aria-describedby={fieldDescribedBy("detalhes-instrutor", { error: errors.instructorName })}
          aria-invalid={errors.instructorName ? true : undefined}
          autoComplete="off"
          className={adminInputClass}
          disabled={readOnly}
          id="detalhes-instrutor"
          maxLength={80}
          onBlur={() => checkField("instructorName", draft.instructorName)}
          onChange={(event) => update("instructorName", event.target.value)}
          placeholder="Quem dá as aulas"
          value={draft.instructorName}
        />
      </AdminField>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <FieldLegend>Nível</FieldLegend>
        <PillGroup
          ariaLabel="Nível"
          disabled={readOnly}
          name="detalhes-nivel"
          onChange={(value) => update("level", value)}
          options={levelOptions(baseline.level)}
          value={draft.level}
        />
        {errors.level ? <FieldError>{errors.level}</FieldError> : null}
      </fieldset>

      <ReadOnlyField label="Duração total">
        <span className={cn("tabular-nums", details.durationTotalLabel ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]")}>
          {describeDurationTotal(details.durationTotalLabel)}
        </span>
      </ReadOnlyField>

      {presentation ? (
        <>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <FieldLegend>Como abre</FieldLegend>
            <PillGroup
              ariaLabel="Como abre"
              disabled={readOnly}
              name="detalhes-como-abre"
              onChange={(value) => update("coursePresentationMode", value)}
              options={PRESENTATION_MODE_OPTIONS}
              value={draft.coursePresentationMode}
            />
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{PRESENTATION_MODE_HINTS[draft.coursePresentationMode]}</p>
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <FieldLegend>Ao clicar quando bloqueado</FieldLegend>
            <PillGroup
              ariaLabel="Ao clicar quando bloqueado"
              disabled={readOnly}
              name="detalhes-bloqueado"
              onChange={(value) => update("lockedActionMode", value)}
              options={LOCKED_ACTION_OPTIONS}
              value={draft.lockedActionMode}
            />
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{LOCKED_ACTION_HINTS[draft.lockedActionMode]}</p>
          </fieldset>
        </>
      ) : (
        <ReadOnlyField label="Como abre">
          <span className="text-[var(--text-secondary)]">Nos cursos da formação.</span>
        </ReadOnlyField>
      )}

      <fieldset className="flex min-w-0 flex-col gap-2">
        <FieldLegend>Cor do produto</FieldLegend>
        <AccentPicker disabled={readOnly} name="detalhes-cor" onChange={(value) => update("accent", value)} value={draft.accent} />
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
          Usada na miniatura sem capa, nos chips e nos gráficos deste produto dentro do admin.
        </p>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <FieldLegend>Tamanho da thumbnail do card</FieldLegend>
        <PillGroup
          ariaLabel="Tamanho da thumbnail do card"
          disabled={readOnly || thumbnailPending}
          name="detalhes-thumbnail-tamanho"
          onChange={(value: ProductThumbnailSize) => void saveThumbnailSize(value)}
          options={THUMBNAIL_SIZE_OPTIONS}
          value={thumbnailSize}
        />
        {thumbnailError ? (
          <FieldError>{thumbnailError}</FieldError>
        ) : (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{THUMBNAIL_SIZE_HINTS[thumbnailSize]}</p>
        )}
      </fieldset>

      <ImageField
        error={imageErrors.cover}
        id="detalhes-capa"
        label="Thumbnail do card"
        onChange={(value) => void saveImage("cover", value)}
        pending={imagePending === "cover"}
        readOnly={readOnly}
        slot={thumbnailSize === "large" ? "coverLarge" : "cover"}
        value={images.cover}
      />

      <ImageField
        error={imageErrors.hero}
        id="detalhes-destaque"
        label="Imagem de destaque"
        onChange={(value) => void saveImage("hero", value)}
        optional
        pending={imagePending === "hero"}
        readOnly={readOnly}
        slot="hero"
        value={images.hero}
      />

      <fieldset className="flex min-w-0 flex-col gap-2">
        <FieldLegend>Cantos do banner</FieldLegend>
        <PillGroup
          ariaLabel="Cantos do banner"
          disabled={readOnly || cornersPending}
          name="detalhes-banner-cantos"
          onChange={(value: ProductHeroCorners) => void saveHeroCorners(value)}
          options={HERO_CORNERS_OPTIONS}
          value={heroCorners}
        />
        {cornersError ? (
          <FieldError>{cornersError}</FieldError>
        ) : (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{HERO_CORNERS_HINTS[heroCorners]}</p>
        )}
      </fieldset>

      {presentation && homeModuleRow ? (
        <HomeRowControl canWrite={canWriteStorefront} productId={header.id} productTitle={header.title} state={homeModuleRow} />
      ) : null}

      {formats.length > 1 ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <FieldLegend>Formato</FieldLegend>
          <PillGroup
            ariaLabel="Formato"
            disabled={readOnly}
            name="detalhes-formato"
            onChange={(value: ProductFormat) => update("format", value)}
            options={formats.map((value) => ({ label: PRODUCT_FORMAT_LABELS[value], value }))}
            value={draft.format}
          />
          {errors.format ? (
            <FieldError>{errors.format}</FieldError>
          ) : (
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
              Dá para trocar enquanto ninguém tem acesso. Curso dentro de formação continua curso.
            </p>
          )}
        </fieldset>
      ) : (
        <ReadOnlyField hint="Uma formação reúne cursos e não muda de formato." label="Formato">
          {PRODUCT_FORMAT_LABELS[format]}
        </ReadOnlyField>
      )}

      <SaveBar
        error={failure?.message ?? (hasFieldErrors ? "Revise os campos destacados." : null)}
        onDiscard={() => {
          setDraft(baseline);
          setErrors({});
          setFailure(null);
        }}
        onSave={() => void save()}
        open={dirty}
        saving={saving}
      />
    </div>
  );
}
