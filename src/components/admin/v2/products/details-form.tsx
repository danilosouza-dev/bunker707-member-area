"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CONFLICT_MESSAGE } from "@/server/catalog/errors";
import { PRODUCT_FORMAT_LABELS, type ProductFormat } from "@/server/catalog/model";
import type { HeroVideoOptions } from "@/lib/platform-types";
import { setProductHeroCorners, setProductHeroVideo, setProductHeroVideoOptions, setProductImage, updateProductDetails } from "@/server/catalog/product-actions";
import { shortDescriptionSchema, updateProductDetailsSchema } from "@/server/catalog/schemas";
import type { ProductDetails, ProductHeroCorners } from "@/server/catalog/types";
import type { HomeModuleRowState } from "@/server/member-area/modules-model";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, adminPillClasses, adminTextareaClass, fieldDescribedBy } from "../form";
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
type VideoOptionKey = keyof Required<HeroVideoOptions>;

const VIDEO_OPTION_PILLS: ReadonlyArray<{ key: VideoOptionKey; label: string; youtubeOnly?: boolean }> = [
  { key: "autoplay", label: "Tocar sozinho" },
  { key: "startWithSound", label: "Começar com som" },
  { key: "loop", label: "Repetir" },
  { key: "soundButton", label: "Botão de som" },
  { key: "volumeSlider", label: "Controle de volume" },
  { key: "pauseButton", label: "Botão de pausar" },
  { key: "timeline", label: "Linha do tempo" },
  { key: "hideBranding", label: "Esconder logo e título do YouTube", youtubeOnly: true }
];

const VIDEO_OPTIONS_HINTS = {
  file: "Os controles escolhidos (som, volume, pausar, linha do tempo) aparecem num grupo no canto do vídeo. Sem \"tocar sozinho\", o aluno vê a capa com um botão de tocar. \"Começar com som\" depende do navegador: funciona quando o aluno já clicou na página (como ao abrir o modal); se for bloqueado, começa sem som e o botão de som fica disponível. Em celulares costuma ser bloqueado.",
  youtube:
    "Os controles escolhidos (som, volume, pausar, linha do tempo) aparecem num grupo no canto do vídeo. \"Começar com som\" depende do navegador: funciona quando o aluno já clicou na página (como ao abrir o modal); se for bloqueado, recomeça sem som. Esconder a logo recorta um pouco as bordas do vídeo e bloqueia o clique sobre ele; os controles ficam todos pelos nossos botões. Ao pular na linha do tempo, o YouTube mostra por um instante os próprios botões no centro. É um recorte visual, fora das regras do player incorporado do YouTube, e não um recurso oficial: se o player mudar ou você preferir seguir as regras à risca, desligue a opção."
};

function OptionPill({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label
      className={cn(
        adminPillClasses(checked),
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <input checked={checked} className="sr-only" disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      {checked ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
      {label}
    </label>
  );
}

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
  const [heroVideoUrl, setHeroVideoUrl] = useState(details.heroVideoUrl);
  const [heroVideoKind, setHeroVideoKind] = useState(details.heroVideoKind);
  const [videoOptions, setVideoOptions] = useState(details.heroVideoOptions);
  const [optionsPending, setOptionsPending] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [videoDraft, setVideoDraft] = useState(details.heroVideoUrl ?? "");
  const [videoPending, setVideoPending] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
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
    }

    if (!videoPending) {
      // So substitui o rascunho do link quando ele nao foi mexido (igual ao valor salvo anterior).
      if (videoDraft === (heroVideoUrl ?? "")) {
        setVideoDraft(details.heroVideoUrl ?? "");
      }

      setHeroVideoUrl(details.heroVideoUrl);
      setHeroVideoKind(details.heroVideoKind);
    }

    if (!optionsPending) {
      setVideoOptions(details.heroVideoOptions);
    }
  }

  const videoDirty = !readOnly && videoDraft.trim() !== (heroVideoUrl ?? "");

  useWarnBeforeUnload(dirty || videoDirty);

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
    const result = await setProductImage({ id: header.id, image: value, slot });
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

  // Video de destaque: salva na hora, como as imagens. A imagem de destaque vira a capa do video.
  async function saveHeroVideo(value: string | null) {
    const next = value?.trim() || null;

    if (readOnly || videoPending || next === heroVideoUrl) {
      return;
    }

    setVideoPending(true);
    setVideoError(null);
    const result = await setProductHeroVideo({ id: header.id, videoUrl: next });
    setVideoPending(false);

    if (!result.ok) {
      setVideoError(result.fieldErrors?.videoUrl?.[0] ?? result.error);
      return;
    }

    setHeroVideoUrl(result.data.videoUrl);
    setHeroVideoKind(result.data.videoKind);
    setVideoDraft(result.data.videoUrl ?? "");
    adminToast.success(result.data.videoUrl ? "Vídeo de destaque salvo" : "Vídeo de destaque removido");
  }

  // Opcoes do video: cada pilula salva na hora; erro volta a escolha anterior.
  async function saveVideoOption(key: VideoOptionKey, checked: boolean) {
    if (readOnly || optionsPending) {
      return;
    }

    const previous = videoOptions;
    const next = { ...videoOptions, [key]: checked };

    setVideoOptions(next);
    setOptionsPending(true);
    setOptionsError(null);
    const result = await setProductHeroVideoOptions({ id: header.id, options: next });
    setOptionsPending(false);

    if (!result.ok) {
      setVideoOptions(previous);
      setOptionsError(result.error);
      return;
    }

    setVideoOptions(result.data.options);
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

      <ImageField
        error={imageErrors.cover}
        id="detalhes-capa"
        label="Thumbnail do card"
        onChange={(value) => void saveImage("cover", value)}
        pending={imagePending === "cover"}
        readOnly={readOnly}
        slot="cover"
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

      <AdminField
        error={videoError}
        hint={
          heroVideoUrl
            ? "Visível para todos os alunos, inclusive quem ainda não comprou. Toca no topo do modal da home e na página do produto; a imagem de destaque é a capa (no YouTube, sem imagem, usa a miniatura do vídeo)."
            : "Link do YouTube ou link direto do arquivo (.mp4, .webm ou .mov), por exemplo do Bunny Stream. Fica visível para todos os alunos, inclusive quem não comprou: use um trailer, nunca uma aula. Por padrão toca sozinho, sem som e em repetição; dá para mudar nas opções depois de salvar. A imagem de destaque vira a capa."
        }
        id="detalhes-video-destaque"
        label="Vídeo de destaque"
        optional
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
          <Input
            aria-describedby={fieldDescribedBy("detalhes-video-destaque", { error: videoError, hint: true })}
            aria-invalid={videoError ? true : undefined}
            autoComplete="off"
            className={cn(adminInputClass, "min-w-0 flex-1")}
            disabled={readOnly || videoPending}
            id="detalhes-video-destaque"
            inputMode="url"
            maxLength={2048}
            onChange={(event) => setVideoDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveHeroVideo(videoDraft);
              }
            }}
            placeholder="https://youtube.com/watch?v=… ou https://…/video.mp4"
            value={videoDraft}
          />
          {!readOnly ? (
            <div className="flex shrink-0 gap-2">
              <Button
                className="px-3"
                disabled={videoPending || videoDraft.trim() === (heroVideoUrl ?? "")}
                onClick={() => void saveHeroVideo(videoDraft)}
                type="button"
                variant="secondary"
              >
                {videoPending ? "Salvando…" : "Salvar vídeo"}
              </Button>
              {heroVideoUrl ? (
                <Button className="px-3" disabled={videoPending} onClick={() => void saveHeroVideo(null)} type="button" variant="ghost">
                  Remover
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </AdminField>

      {heroVideoUrl ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <FieldLegend>Opções do vídeo</FieldLegend>
          <div className="flex min-w-0 flex-wrap gap-2">
            {VIDEO_OPTION_PILLS.filter((pill) => !pill.youtubeOnly || heroVideoKind === "youtube").map((pill) => (
              <OptionPill
                checked={videoOptions[pill.key]}
                disabled={readOnly || optionsPending}
                key={pill.key}
                label={pill.label}
                onChange={(checked) => void saveVideoOption(pill.key, checked)}
              />
            ))}
          </div>
          {optionsError ? (
            <FieldError>{optionsError}</FieldError>
          ) : (
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
              {heroVideoKind === "youtube" ? VIDEO_OPTIONS_HINTS.youtube : VIDEO_OPTIONS_HINTS.file}
            </p>
          )}
        </fieldset>
      ) : null}

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
