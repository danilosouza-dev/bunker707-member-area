"use client";

import { CheckCircle2, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { uploadNoticeImage } from "@/server/communications/actions";
import { NOTICE_LIMITS } from "@/server/communications/campaign-model";
import { POPUP_DESIGN_LIMITS, type PopupDesign, type PopupMedia } from "@/server/communications/popup-design-model";
import type { NoticeDraft } from "@/server/communications/schemas";
import { HeroTextField } from "../../member-area/home-hero/fields";
import { ImageField } from "../../products/image-field";
import { AdminSwitch } from "../../settings/kit";
import { ColorField, DesignFieldError, DesignSection, NumberField, PillField } from "./design-controls";
import {
  MEDIA_ASPECT_OPTIONS,
  MEDIA_KIND_OPTIONS,
  MEDIA_POSITION_OPTIONS,
  POPUP_DESIGN_COPY,
  videoDurationHint,
  videoFileProblem,
  videoMimeTypeOf
} from "./popup-design-editor-model";
import { captureVideoFrame, readVideoDuration, uploadPopupVideo } from "./video-upload";

// Secao "Mídia" do design (docs/26 §7.2): Sem mídia | Imagem | Vídeo. A imagem e a do aviso (o mesmo campo, o
// mesmo recorte 16:9 e o mesmo id "aviso-imagem"); ela tambem e a capa do video (quem prefere menos movimento ou
// economiza dados ve so ela). O video vai direto ao Storage (video-upload.ts); enviado sem imagem, um quadro dele
// vira a capa. Depois: formato, recorte e o degrade para o fundo do cartao.

const copy = POPUP_DESIGN_COPY.media;
const videoCopy = POPUP_DESIGN_COPY.video;
const ACCEPT = "video/mp4,video/webm";

type VideoPhase = { kind: "idle" } | { kind: "checking" } | { kind: "uploading"; percent: number };

type MediaSectionProps = {
  design: PopupDesign;
  disabled: boolean;
  draft: Pick<NoticeDraft, "image">;
  errorFor: (key: string) => string | undefined;
  onBusyChange?: (reason: string | null) => void;
  onChange: (patch: Partial<Pick<NoticeDraft, "design" | "image">>) => void;
  /** O rascunho mais novo (o envio termina depois: a imagem e o design podem ter mudado no meio). */
  latest: () => Pick<NoticeDraft, "design" | "image">;
  onImageUploadChange?: (preview: string | null) => void;
};

export function MediaSection({ design, disabled, draft, errorFor, latest, onBusyChange, onChange, onImageUploadChange }: MediaSectionProps) {
  const media = design.media;
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageUpload, setImageUpload] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoPhase>({ kind: "idle" });
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoHint, setVideoHint] = useState<string | null>(null);
  const busyRef = useRef(onBusyChange);
  const sending = video.kind !== "idle";

  useEffect(() => {
    busyRef.current = onBusyChange;
  });

  // Sair da tela no meio do envio libera o "Salvar".
  useEffect(() => () => busyRef.current?.(null), []);

  function updateMedia(patch: Partial<PopupMedia>) {
    const current = latest().design ?? design;
    onChange({ design: { ...current, media: { ...current.media, ...patch } } });
  }

  function setUpload(preview: string | null) {
    setImageUpload(preview);
    onImageUploadChange?.(preview);
  }

  async function sendImage(dataUrl: string, silent: boolean) {
    setUpload(dataUrl);
    const result = await uploadNoticeImage({ image: dataUrl }).catch(() => null);
    setUpload(null);

    if (!result || !result.ok) {
      if (!silent) {
        setImageError(result ? (result.fieldErrors?.image?.[0] ?? result.error) : "Não foi possível enviar a imagem. Tente de novo.");
      }

      return;
    }

    onChange({ image: { alt: latest().image?.alt ?? "", url: result.data.url } });
  }

  async function changeImage(next: string | null) {
    setImageError(null);

    // Remover ou link https colado (sem recorte): vai direto para o conteudo.
    if (next === null || !next.startsWith("data:")) {
      onChange({ image: next ? { alt: latest().image?.alt ?? "", url: next } : null });
      return;
    }

    await sendImage(next, false);
  }

  async function sendVideo(file: File | undefined) {
    if (!file || sending) {
      return;
    }

    setVideoError(null);
    setVideoHint(null);
    const problem = videoFileProblem(file);
    const mimeType = videoMimeTypeOf(file);

    if (problem || !mimeType) {
      setVideoError(problem ?? videoCopy.format);
      return;
    }

    setVideo({ kind: "checking" });
    busyRef.current?.(videoCopy.busy);
    const localUrl = URL.createObjectURL(file);

    try {
      const duration = await readVideoDuration(localUrl);

      if (duration === null) {
        setVideoError(videoCopy.cannotPlay);
        return;
      }

      setVideoHint(videoDurationHint(duration));
      setVideo({ kind: "uploading", percent: 0 });
      const uploaded = await uploadPopupVideo(file, mimeType, (percent) => setVideo({ kind: "uploading", percent }));
      updateMedia({ kind: "video", video: uploaded });

      // Sem imagem no aviso: um quadro do video vira a capa (falhar nao impede: o campo Imagem continua pedindo).
      if (!latest().image) {
        const frame = await captureVideoFrame(localUrl);

        if (frame) {
          await sendImage(frame, true);
        }
      }
    } catch (caught) {
      setVideoError(caught instanceof Error && caught.message ? caught.message : videoCopy.failed);
    } finally {
      URL.revokeObjectURL(localUrl);
      setVideo({ kind: "idle" });
      busyRef.current?.(null);
    }
  }

  const imageField = (
    <div className="flex min-w-0 flex-col gap-3">
      <ImageField
        error={imageError ?? errorFor("image") ?? errorFor("image.url")}
        id="aviso-imagem"
        label={copy.image}
        onChange={(next) => void changeImage(next)}
        pending={imageUpload !== null}
        slot="notice"
        value={imageUpload ?? draft.image?.url ?? null}
      />
      <p className="-mt-1 text-xs leading-5 text-[var(--text-secondary)]">{copy.imageHint}</p>
      {draft.image ? (
        <HeroTextField
          disabled={disabled}
          error={errorFor("image.alt")}
          hint={copy.imageAltHint}
          id="aviso-imagem-descricao"
          label={copy.imageAlt}
          max={NOTICE_LIMITS.imageAlt}
          onBlur={() => undefined}
          onChange={(alt) => onChange({ image: draft.image ? { ...draft.image, alt } : null })}
          value={draft.image.alt}
        />
      ) : null}
    </div>
  );

  return (
    <DesignSection title={POPUP_DESIGN_COPY.sections.media}>
      <PillField
        disabled={disabled || sending}
        error={errorFor("design.media.kind")}
        label={copy.groupLabel}
        name="popup-design-midia"
        onChange={(kind) => updateMedia({ kind })}
        options={MEDIA_KIND_OPTIONS}
        value={media.kind}
      />

      {media.kind === "video" ? (
        <div className="flex min-w-0 flex-col gap-2 outline-none" id="popup-design-video" tabIndex={-1}>
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{videoCopy.label}</span>
          {video.kind === "uploading" || video.kind === "checking" ? (
            <p aria-live="polite" className="flex items-center gap-2 text-sm leading-5 text-[var(--text-primary)]" role="status">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
              {video.kind === "uploading" ? `Enviando o vídeo… ${video.percent}%` : "Enviando o vídeo… 0%"}
            </p>
          ) : media.video ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="flex items-center gap-1.5 text-sm leading-5 text-[var(--text-primary)]">
                <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--success)]" />
                {videoCopy.done}
              </p>
              <Button className="h-9 px-3 pointer-coarse:h-11" disabled={disabled} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
                {videoCopy.replace}
              </Button>
              <Button className="h-9 px-3 text-[var(--text-secondary)] pointer-coarse:h-11" disabled={disabled} onClick={() => updateMedia({ video: null })} type="button" variant="ghost">
                {videoCopy.remove}
              </Button>
            </div>
          ) : (
            <div>
              <Button className="h-10 gap-1.5 px-3" disabled={disabled} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
                <Upload aria-hidden="true" className="size-4" />
                {videoCopy.send}
              </Button>
            </div>
          )}
          <input
            accept={ACCEPT}
            aria-label={videoCopy.send}
            className="sr-only"
            disabled={disabled || sending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void sendVideo(file);
            }}
            ref={fileInput}
            tabIndex={-1}
            type="file"
          />
          {videoError || errorFor("design.media.video") ? (
            <DesignFieldError message={videoError ?? errorFor("design.media.video")} />
          ) : (
            <p className="text-xs leading-5 text-[var(--text-secondary)]">{videoHint ?? videoCopy.hint}</p>
          )}
        </div>
      ) : null}

      {media.kind !== "none" ? imageField : null}

      {media.kind !== "none" ? (
        <>
          <PillField disabled={disabled} label={copy.aspect} name="popup-design-midia-formato" onChange={(aspect) => updateMedia({ aspect })} options={MEDIA_ASPECT_OPTIONS} value={media.aspect} />
          <PillField disabled={disabled} label={copy.position} name="popup-design-midia-recorte" onChange={(position) => updateMedia({ position })} options={MEDIA_POSITION_OPTIONS} value={media.position} />
          <div className="flex min-w-0 flex-col gap-4">
            <AdminSwitch
              checked={media.fade.enabled}
              disabled={disabled}
              id="popup-design-degrade"
              label={copy.fade}
              onCheckedChange={(enabled) => updateMedia({ fade: { ...media.fade, enabled } })}
            />
            {media.fade.enabled ? (
              <div className="flex min-w-0 flex-col gap-4 border-l-2 border-[var(--border-subtle)] pl-4">
                <NumberField
                  disabled={disabled}
                  error={errorFor("design.media.fade.height")}
                  id="popup-design-degrade-altura"
                  label={copy.fadeHeight}
                  max={POPUP_DESIGN_LIMITS.fadeHeight.max}
                  min={POPUP_DESIGN_LIMITS.fadeHeight.min}
                  onChange={(height) => updateMedia({ fade: { ...media.fade, height } })}
                  suffix="%"
                  value={media.fade.height}
                />
                <AdminSwitch
                  checked={media.fade.color === "auto"}
                  disabled={disabled}
                  id="popup-design-degrade-auto"
                  label={copy.fadeAuto}
                  onCheckedChange={(auto) =>
                    updateMedia({ fade: { ...media.fade, color: auto ? "auto" : design.card.background.kind === "solid" ? design.card.background.color : design.card.background.from } })
                  }
                />
                {media.fade.color !== "auto" ? (
                  <ColorField disabled={disabled} id="popup-design-degrade-cor" label={copy.fadeColor} onChange={(color) => updateMedia({ fade: { ...media.fade, color } })} value={media.fade.color} />
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </DesignSection>
  );
}
