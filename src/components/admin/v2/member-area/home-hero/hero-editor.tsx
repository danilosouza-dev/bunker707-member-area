"use client";

import { Info, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadMemberAreaImage } from "@/server/member-area/image-actions";
import { saveHomeHero } from "@/server/member-area/home-hero-actions";
import {
  DEFAULT_HOME_HERO_DRAFT,
  DEFAULT_HOME_HERO_IMAGE,
  HERO_IMAGE_SIZES,
  HERO_TEXT_LIMITS,
  autoShowFilledFields,
  heroFieldErrorsFrom,
  isHeroDraftEqual,
  isHeroVisible,
  previewHeroFromDraft,
  rebaseHeroDraft,
  validateHomeHeroDraft,
  type HeroImageSizeField,
  type HomeHeroDraft,
  type HomeHeroDraftErrors,
  type HomeHeroDraftField
} from "@/server/member-area/home-hero-model";
import type { MemberAreaUploadSlot } from "@/server/member-area/schemas";
import type { HomeHeroEditorData } from "@/server/member-area/home-hero-queries";
import { ErrorBanner } from "../../error-banner";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../form";
import { ImageField } from "../../products/image-field";
import { useWarnBeforeUnload } from "../../products/use-warn-before-unload";
import { SaveBar } from "../../save-bar";
import { AdminSwitch, SectionCard } from "../../settings/kit";
import { adminCard } from "../../styles";
import { adminToast } from "../../toast";
import { CtaField } from "./cta-field";
import { GLOW_COLOR_PRESETS, GlowColorPicker, HeroTextField } from "./fields";
import { HeroPreview } from "./hero-preview";

// Area de membros > Destaque (docs/17 §1.6.8): o topo da home do aluno. Rascunho local ate "Publicar
// destaque", que grava platform_settings.hero pela Server Action saveHomeHero com a versao lida (409 se
// mudou em outra tela). Imagens: recorte WebP no navegador, envio logo depois do recorte
// (uploadMemberAreaImage, slot "hero") e so a URL no rascunho. A previa desenha o HeroSection real.
//
// Capas por tamanho de tela: alem da imagem principal (1920 × 720, telas grandes), o produtor pode enviar a mesma
// arte ajustada para notebook, tablet e celular (HERO_IMAGE_SIZES). Cada uma e opcional; a previa troca de "tela"
// para mostrar qual capa cada tamanho desenha.

type HeroEditorProps = {
  canEdit: boolean;
  data: HomeHeroEditorData;
};

type ImageSlotField = "image" | "poster" | HeroImageSizeField;
type Failure = { message: string; status: number };

const MEDIA_OPTIONS = [
  { label: "Imagem", value: "image" },
  { label: "Vídeo", value: "video" }
] as const;

/** "Telas" da previa: uma por tamanho de capa, com uma largura tipica de cada faixa. */
const PREVIEW_SCREENS = [
  { label: "Tela grande", value: "wide", width: 1920 },
  { label: "Notebook", value: "notebook", width: 1280 },
  { label: "Tablet", value: "tablet", width: 768 },
  { label: "Celular", value: "mobile", width: 390 }
] as const;

type PreviewScreen = (typeof PREVIEW_SCREENS)[number]["value"];

/** Medida de recorte e de envio de cada campo de imagem (a capa do video tem a medida da imagem principal). */
const UPLOAD_SLOT: Record<ImageSlotField, MemberAreaUploadSlot> = {
  image: "hero",
  imageMobile: "heroMobile",
  imageNotebook: "heroNotebook",
  imageTablet: "heroTablet",
  poster: "hero"
};

/** Campos das capas por tamanho de tela, da tela maior para a menor. */
const SIZE_FIELDS = [...HERO_IMAGE_SIZES].reverse();

const SIZE_TEXT: Record<(typeof HERO_IMAGE_SIZES)[number]["key"], { hint: string; id: string; label: string }> = {
  mobile: { hint: "Celulares: telas de até 639 px de largura.", id: "destaque-capa-celular", label: "Capa de celular" },
  notebook: {
    hint: "Notebooks e monitores menores: telas de 1200 a 1535 px de largura.",
    id: "destaque-capa-notebook",
    label: "Capa de notebook"
  },
  tablet: { hint: "Tablets, em pé ou deitados: telas de 640 a 1199 px de largura.", id: "destaque-capa-tablet", label: "Capa de tablet" }
};

const VIDEO_LINK_HINT = "Use um link direto de vídeo, como o do Bunny. O vídeo toca sem som, em repetição.";
const UNDO_OUTDATED = "Não foi possível desfazer: já existe uma publicação mais nova do destaque.";

/** Elemento que recebe foco quando o campo tem erro ao publicar. */
const FIELD_FOCUS: Record<HomeHeroDraftField, string> = {
  badge: "#destaque-selo",
  ctaHref: "#destaque-botao-produto, [name='destaque-botao-pagina'], #destaque-botao-link",
  ctaLabel: "#destaque-botao-texto",
  ctaTarget: "[name='destaque-botao-aba']",
  description: "#destaque-descricao",
  enabled: "#destaque-ligado",
  image: "[aria-labelledby='destaque-imagem-label']",
  imageMobile: "[aria-labelledby='destaque-capa-celular-label']",
  imageNotebook: "[aria-labelledby='destaque-capa-notebook-label']",
  imageTablet: "[aria-labelledby='destaque-capa-tablet-label']",
  glowColor: "[name='destaque-luz']",
  mediaType: "[name='destaque-midia']",
  poster: "[aria-labelledby='destaque-capa-label']",
  showBadge: "#destaque-selo",
  showCta: "#destaque-botao-mostrar",
  showDescription: "#destaque-descricao",
  showTitle: "#destaque-titulo",
  title: "#destaque-titulo",
  videoUrl: "#destaque-video"
};

const FIELD_ORDER: HomeHeroDraftField[] = ["image", "imageNotebook", "imageTablet", "imageMobile", "videoUrl", "poster", "glowColor", "badge", "title", "description", "ctaLabel", "ctaHref"];

type GlowMode = "auto" | "custom";
const GLOW_OPTIONS: ReadonlyArray<{ label: string; value: GlowMode }> = [
  { label: "Automática (cor da imagem)", value: "auto" },
  { label: "Escolher cor", value: "custom" }
];

function omitKey<Value>(record: Partial<Record<ImageSlotField, Value>>, key: ImageSlotField) {
  const next = { ...record };
  delete next[key];
  return next;
}

function imagePatch(field: ImageSlotField, value: string | null): Partial<HomeHeroDraft> {
  return { [field]: value };
}

/** Campos com problema no que esta publicado (ex.: link antigo gravado pelo admin antigo). */
function initialTouched(draft: HomeHeroDraft): ReadonlySet<HomeHeroDraftField> {
  return new Set(Object.keys(validateHomeHeroDraft(draft)) as HomeHeroDraftField[]);
}

/** Mesma versao? O banco devolve "+00:00" e o JavaScript "Z": compara o instante. */
function isSameVersion(left: string | null, right: string | null) {
  return left === right || (left !== null && right !== null && Date.parse(left) === Date.parse(right));
}

/** Rolagem suave, menos para quem pediu menos movimento. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function focusFirstError(errors: HomeHeroDraftErrors) {
  const field = FIELD_ORDER.find((key) => errors[key]) ?? (Object.keys(errors)[0] as HomeHeroDraftField | undefined);

  if (!field) {
    return;
  }

  window.requestAnimationFrame(() => {
    const element = document.querySelector<HTMLElement>(FIELD_FOCUS[field]);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  });
}

export function HeroEditor({ canEdit, data }: HeroEditorProps) {
  const router = useRouter();
  const [published, setPublished] = useState<HomeHeroDraft>(data.draft);
  const [draft, setDraft] = useState<HomeHeroDraft>(data.draft);
  const [version, setVersion] = useState<string | null>(data.updatedAt);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [serverErrors, setServerErrors] = useState<HomeHeroDraftErrors>({});
  const [touched, setTouched] = useState<ReadonlySet<HomeHeroDraftField>>(() => initialTouched(data.draft));
  const [submitted, setSubmitted] = useState(false);
  const [uploads, setUploads] = useState<Partial<Record<ImageSlotField, string>>>({});
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<ImageSlotField, string>>>({});
  const [screen, setScreen] = useState<PreviewScreen>("notebook");
  // Remonta o campo do botao quando o rascunho e trocado de uma vez (descartar, padrao, publicar).
  const [resetKey, setResetKey] = useState(0);
  // Ultima versao recebida do servidor. "Recarregar" (depois de um 409) traz outra: a tela segue o
  // banco sem perder o que o produtor mudou (rebaseHeroDraft). O router.refresh depois de publicar traz
  // a mesma: nada muda.
  const [serverVersion, setServerVersion] = useState<string | null>(data.updatedAt);
  const publishedRef = useRef(published);
  const draftRef = useRef(draft);
  const bannerRef = useRef<HTMLDivElement>(null);
  // Toast com "Desfazer" da ultima publicacao: some quando ha uma publicacao mais nova.
  const undoToast = useRef<string | number | null>(null);

  if (!isSameVersion(data.updatedAt, serverVersion)) {
    setServerVersion(data.updatedAt);

    if (!isSameVersion(data.updatedAt, version)) {
      setPublished(data.draft);
      setDraft(rebaseHeroDraft(published, draft, data.draft));
      setVersion(data.updatedAt);
      setFailure(null);
      setServerErrors({});
      setSubmitted(false);
      setResetKey((key) => key + 1);
    }
  }

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    publishedRef.current = published;
  }, [published]);

  const uploading = Object.keys(uploads).length > 0;
  const dirty = canEdit && !isHeroDraftEqual(published, draft);
  const locked = !canEdit || saving;
  const clientErrors = useMemo(() => validateHomeHeroDraft(draft), [draft]);
  const previewHero = useMemo(() => previewHeroFromDraft(draft, uploads), [draft, uploads]);
  const isDefault = isHeroDraftEqual(draft, DEFAULT_HOME_HERO_DRAFT);
  const storedNeedsFix = canEdit && !dirty && Object.keys(validateHomeHeroDraft(published)).length > 0;

  useWarnBeforeUnload(dirty || uploading);

  function errorFor(field: HomeHeroDraftField) {
    return serverErrors[field] ?? (submitted || touched.has(field) ? clientErrors[field] : undefined);
  }

  function touch(field: HomeHeroDraftField) {
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
  }

  function change(next: Partial<HomeHeroDraft>) {
    setDraft((current) => autoShowFilledFields(current, { ...current, ...next }));
    setServerErrors((current) => {
      const keys = Object.keys(next).filter((key) => key in current);

      if (keys.length === 0) {
        return current;
      }

      const copy = { ...current };
      keys.forEach((key) => delete copy[key as HomeHeroDraftField]);
      return copy;
    });

    if (failure && failure.status !== 409) {
      setFailure(null);
    }
  }

  function replaceDraft(next: HomeHeroDraft) {
    setDraft(next);
    setServerErrors({});
    setUploadErrors({});
    setTouched(new Set());
    setSubmitted(false);
    setResetKey((key) => key + 1);
  }

  function setMediaType(mediaType: HomeHeroDraft["mediaType"]) {
    setDraft((current) => {
      if (current.mediaType === mediaType) {
        return current;
      }

      // A imagem e a capa do video tem a mesma medida: uma serve de ponto de partida para a outra.
      return mediaType === "video"
        ? { ...current, mediaType, poster: current.poster ?? current.image }
        : { ...current, image: current.image ?? current.poster, mediaType };
    });
  }

  async function changeImage(field: ImageSlotField, value: string | null) {
    setUploadErrors((current) => omitKey(current, field));
    touch(field);

    // Remover ou link https colado (sem recorte): vai direto para o rascunho.
    if (value === null || !value.startsWith("data:")) {
      change(imagePatch(field, value));
      return;
    }

    setUploads((current) => ({ ...omitKey(current, field), [field]: value }));
    const result = await uploadMemberAreaImage({ image: value, slot: UPLOAD_SLOT[field] });
    setUploads((current) => omitKey(current, field));

    if (!result.ok) {
      const message = result.fieldErrors?.image?.[0] ?? result.error;
      setUploadErrors((current) => ({ ...current, [field]: message }));
      return;
    }

    change(imagePatch(field, result.data.url));
  }

  function showFailure(next: Failure) {
    setFailure(next);
    window.requestAnimationFrame(() => bannerRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }));
  }

  async function undo(previous: HomeHeroDraft, fromVersion: string) {
    const result = await saveHomeHero({ expectedUpdatedAt: fromVersion, hero: previous });

    if (!result.ok) {
      // 409 aqui = toast velho (alguem publicou depois): nao e conflito da tela, so nao ha o que desfazer.
      showFailure(
        result.status === 409
          ? { message: UNDO_OUTDATED, status: 0 }
          : { message: `Não foi possível desfazer. ${result.error}`, status: result.status }
      );
      return;
    }

    const justPublished = publishedRef.current;
    setPublished(result.data.hero);
    setVersion(result.data.updatedAt);

    // Rascunho sem mudancas acompanha o desfazer; com mudancas em andamento, fica como esta.
    if (isHeroDraftEqual(draftRef.current, justPublished)) {
      replaceDraft(result.data.hero);
    }

    adminToast.success("Destaque anterior de volta na home.");
    router.refresh();
  }

  async function publish() {
    if (!canEdit || saving) {
      return;
    }

    if (uploading) {
      showFailure({ message: "Espere a imagem terminar de enviar e publique de novo.", status: 0 });
      return;
    }

    setSubmitted(true);
    const errors = validateHomeHeroDraft(draft);

    if (Object.keys(errors).length > 0) {
      setFailure({ message: "Revise os campos destacados.", status: 400 });
      focusFirstError(errors);
      return;
    }

    const previous = published;
    setSaving(true);
    setFailure(null);
    setServerErrors({});
    const result = await saveHomeHero({ expectedUpdatedAt: version, hero: draft });
    setSaving(false);

    if (!result.ok) {
      const fieldErrors = heroFieldErrorsFrom(result.fieldErrors);
      setServerErrors(fieldErrors);
      showFailure({ message: result.error, status: result.status });
      focusFirstError(fieldErrors);
      return;
    }

    setPublished(result.data.hero);
    setVersion(result.data.updatedAt);
    replaceDraft(result.data.hero);

    if (undoToast.current !== null) {
      adminToast.dismiss(undoToast.current);
    }

    undoToast.current = adminToast.success("Destaque publicado. Os alunos já veem o novo topo da home.", {
      onUndo: () => void undo(previous, result.data.updatedAt)
    });
    // Atualiza o cache do roteador: voltar para esta aba mostra o que acabou de ser publicado.
    router.refresh();
  }

  function discard() {
    replaceDraft(published);
    setFailure(null);
  }

  const imageError = uploadErrors.image ?? errorFor("image");
  const posterError = uploadErrors.poster ?? errorFor("poster");
  const videoError = errorFor("videoUrl");
  const conflict = failure?.status === 409;
  // Erro fora da barra de salvar (conflito, desfazer que falhou ou sem nada para publicar).
  const bannerFailure = failure && (conflict || !dirty) ? failure : null;
  const previewScreen = PREVIEW_SCREENS.find((option) => option.value === screen) ?? PREVIEW_SCREENS[1];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {!canEdit ? (
            <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
              Só o dono, um administrador ou um editor pode mudar o destaque. Você está vendo a versão atual.
            </p>
          ) : null}

          {storedNeedsFix ? (
            <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
              O destaque publicado tem um ponto a corrigir, marcado abaixo. Ajuste e publique.
            </p>
          ) : null}

          {bannerFailure ? (
            <div ref={bannerRef}>
              <ErrorBanner
                action={
                  conflict ? (
                    <Button
                      className="px-3"
                      onClick={() => {
                        // Sempre limpa o aviso: se o banco tiver outra versao, a tela segue o banco
                        // mantendo o rascunho; se for a mesma, nao ha mais nada a resolver.
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
                title={conflict ? "O destaque mudou em outra tela" : "O destaque não mudou"}
              >
                {conflict ? `${bannerFailure.message} O que você mudou aqui continua no rascunho.` : bannerFailure.message}
              </ErrorBanner>
            </div>
          ) : null}

          <SectionCard description="O topo da home, a primeira coisa que o aluno vê ao entrar." title="Destaque">
            <AdminSwitch
              checked={draft.enabled}
              description={draft.enabled ? "O destaque aparece no topo da home, atrás da primeira fileira." : "A home começa direto nas fileiras."}
              disabled={locked}
              id="destaque-ligado"
              label="Mostrar destaque no topo da home"
              onCheckedChange={(checked) => change({ enabled: checked })}
            />
          </SectionCard>

          <SectionCard description="Uma imagem parada ou um vídeo em repetição, sem som." title="Imagem ou vídeo">
            <div className="flex min-w-0 flex-col gap-5">
              <PillGroup
                ariaLabel="Imagem ou vídeo"
                disabled={locked}
                name="destaque-midia"
                onChange={setMediaType}
                options={MEDIA_OPTIONS}
                value={draft.mediaType}
              />

              {draft.mediaType === "image" ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <ImageField
                    error={imageError}
                    id="destaque-imagem"
                    label="Imagem do destaque"
                    onChange={(value) => void changeImage("image", value)}
                    pending={Boolean(uploads.image)}
                    readOnly={!canEdit}
                    slot="hero"
                    value={uploads.image ?? draft.image}
                  />
                  {canEdit ? (
                    <div>
                      <Button
                        className="px-3 text-[var(--text-secondary)]"
                        disabled={locked || Boolean(uploads.image) || draft.image === DEFAULT_HOME_HERO_IMAGE}
                        onClick={() => {
                          touch("image");
                          change({ image: DEFAULT_HOME_HERO_IMAGE });
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <RotateCcw aria-hidden="true" className="size-4" />
                        Usar a imagem padrão
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-5">
                  <AdminField error={videoError} hint={VIDEO_LINK_HINT} id="destaque-video" label="Link do vídeo">
                    <Input
                      aria-describedby={fieldDescribedBy("destaque-video", { error: videoError, hint: videoError ? undefined : VIDEO_LINK_HINT })}
                      aria-invalid={videoError ? true : undefined}
                      autoComplete="off"
                      className={adminInputClass}
                      disabled={locked}
                      id="destaque-video"
                      inputMode="url"
                      onBlur={() => touch("videoUrl")}
                      onChange={(event) => change({ videoUrl: event.target.value.trim() ? event.target.value : null })}
                      placeholder="https://…/video.mp4"
                      spellCheck={false}
                      type="url"
                      value={draft.videoUrl ?? ""}
                    />
                  </AdminField>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <ImageField
                      error={posterError}
                      id="destaque-capa"
                      label="Capa do vídeo"
                      onChange={(value) => void changeImage("poster", value)}
                      pending={Boolean(uploads.poster)}
                      readOnly={!canEdit}
                      slot="hero"
                      value={uploads.poster ?? draft.poster}
                    />
                    <p className="text-xs leading-5 text-[var(--text-secondary)]">
                      Aparece enquanto o vídeo carrega e para quem prefere menos movimento.
                    </p>
                  </div>
                </div>
              )}

              <p className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {draft.mediaType === "image"
                  ? "Em telas menores esta imagem é cortada nas laterais. Para escolher o que aparece em cada tela, envie as capas logo abaixo."
                  : "No celular o vídeo é cortado nas laterais; deixe o assunto principal no centro."}
              </p>
            </div>
          </SectionCard>

          {draft.mediaType === "image" ? (
            <SectionCard
              description="Opcional. A imagem acima vale para telas grandes; aqui entra a mesma arte ajustada para telas menores."
              title="Capas por tamanho de tela"
            >
              <div className="flex min-w-0 flex-col gap-5">
                {SIZE_FIELDS.map((size) => {
                  const copy = SIZE_TEXT[size.key];

                  return (
                    <div className="flex min-w-0 flex-col gap-1.5" key={size.field}>
                      <ImageField
                        error={uploadErrors[size.field] ?? errorFor(size.field)}
                        id={copy.id}
                        label={copy.label}
                        onChange={(value) => void changeImage(size.field, value)}
                        optional
                        pending={Boolean(uploads[size.field])}
                        readOnly={!canEdit}
                        slot={size.slot}
                        value={uploads[size.field] ?? draft[size.field]}
                      />
                      <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.hint}</p>
                    </div>
                  );
                })}
                <p className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  Com pelo menos uma capa aqui, a home mostra cada capa inteira, sem cortar as laterais. Tela sem capa própria usa a do tamanho maior mais próximo. Sem nenhuma capa aqui, todas as telas usam a imagem do destaque, cortada nas laterais.
                </p>
              </div>
            </SectionCard>
          ) : null}

          <SectionCard description="A cor que aparece atrás do destaque e some no cinza da página, como na Netflix." title="Luz de fundo">
            <div className="flex min-w-0 flex-col gap-4">
              <PillGroup
                ariaLabel="Luz de fundo"
                disabled={locked}
                name="destaque-luz"
                onChange={(mode: GlowMode) => change({ glowColor: mode === "custom" ? (draft.glowColor ?? GLOW_COLOR_PRESETS[0].value) : null })}
                options={GLOW_OPTIONS}
                value={draft.glowColor ? "custom" : "auto"}
              />
              {draft.glowColor ? (
                <GlowColorPicker color={draft.glowColor} disabled={locked} onChange={(glowColor) => change({ glowColor })} />
              ) : (
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
                  Automática: a cor média da imagem do destaque (ou da capa do vídeo), medida na hora de mostrar.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard description="Desligar “Mostrar” esconde o texto da home sem apagar o que você escreveu." title="Textos">
            <div className="flex min-w-0 flex-col gap-4">
              <HeroTextField
                disabled={locked}
                error={errorFor("badge")}
                id="destaque-selo"
                label="Selo"
                max={HERO_TEXT_LIMITS.badge}
                onBlur={() => touch("badge")}
                onChange={(value) => change({ badge: value })}
                onShownChange={(shown) => change({ showBadge: shown })}
                placeholder="Ex.: Nova turma"
                showLabel="o selo"
                shown={draft.showBadge}
                value={draft.badge}
              />
              <HeroTextField
                disabled={locked}
                error={errorFor("title")}
                id="destaque-titulo"
                label="Título"
                max={HERO_TEXT_LIMITS.title}
                onBlur={() => touch("title")}
                onChange={(value) => change({ title: value })}
                onShownChange={(shown) => change({ showTitle: shown })}
                showLabel="o título"
                shown={draft.showTitle}
                value={draft.title}
              />
              <HeroTextField
                disabled={locked}
                error={errorFor("description")}
                id="destaque-descricao"
                label="Descrição"
                max={HERO_TEXT_LIMITS.description}
                multiline
                onBlur={() => touch("description")}
                onChange={(value) => change({ description: value })}
                onShownChange={(shown) => change({ showDescription: shown })}
                showLabel="a descrição"
                shown={draft.showDescription}
                value={draft.description}
              />
            </div>
          </SectionCard>

          <SectionCard description="Um botão claro embaixo dos textos, levando para um produto, uma página da área ou um site." title="Botão">
            <CtaField
              disabled={locked}
              draft={draft}
              errors={{ ctaHref: errorFor("ctaHref"), ctaLabel: errorFor("ctaLabel") }}
              key={resetKey}
              onBlurField={touch}
              onChange={change}
              products={data.products}
              productsLoaded={data.productsLoaded}
            />
          </SectionCard>

          {canEdit ? (
            <div className="flex flex-col items-start gap-1">
              <Button className="px-3 text-[var(--text-secondary)]" disabled={locked || isDefault} onClick={() => replaceDraft({ ...DEFAULT_HOME_HERO_DRAFT })} type="button" variant="ghost">
                <RotateCcw aria-hidden="true" className="size-4" />
                Restaurar padrão
              </Button>
              <p className="px-3 text-xs leading-5 text-[var(--text-secondary)]">
                Volta para a imagem padrão, sem textos nem botão. Só muda para os alunos depois de publicar.
              </p>
            </div>
          ) : null}
        </div>

        <section aria-labelledby="destaque-previa-titulo" className={`${adminCard} flex min-w-0 flex-col gap-3 p-4 lg:sticky lg:top-20`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="destaque-previa-titulo">
                Prévia
              </h2>
              <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-secondary)]">
                {dirty ? "Rascunho: os alunos só veem depois de publicar." : "É o que os alunos veem agora."}
              </p>
            </div>
            <PillGroup ariaLabel="Tamanho de tela da prévia" name="destaque-previa-aparelho" onChange={setScreen} options={PREVIEW_SCREENS} value={screen} />
          </div>
          <HeroPreview
            hero={previewHero}
            logoImage={data.logoImage}
            maxWidth={screen === "mobile" ? 300 : screen === "tablet" ? 460 : undefined}
            screen={previewScreen}
          />
          {!isHeroVisible(previewHero) ? (
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
              {draft.enabled ? "Sem imagem ou vídeo válido, o destaque não aparece e a home começa nas fileiras." : "Destaque desligado: a home começa direto nas fileiras."}
            </p>
          ) : null}
        </section>
      </div>

      <SaveBar
        error={failure && !conflict && dirty ? failure.message : null}
        message="Alterações não publicadas"
        onDiscard={discard}
        onSave={() => void publish()}
        open={dirty}
        saveLabel="Publicar destaque"
        saving={saving}
      />
    </div>
  );
}
