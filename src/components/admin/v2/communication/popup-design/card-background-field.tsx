"use client";

import { useEffect, useRef, useState } from "react";
import { uploadNoticeImage } from "@/server/communications/actions";
import { POPUP_DESIGN_LIMITS, isOwnPopupCardImageUrl, type PopupCardBackground, type PopupCardImage } from "@/server/communications/popup-design-model";
import { ImageField } from "../../products/image-field";
import { ColorField, DesignFieldError, NumberField, PaintColorFields, PillField } from "./design-controls";
import { CARD_BACKGROUND_KIND_OPTIONS, MEDIA_POSITION_OPTIONS, POPUP_DESIGN_COPY, cardBackgroundOfKind, type CardBackgroundKind } from "./popup-design-editor-model";

// "Fundo" do Cartão (docs/26): "Cor" | "Degradê" | "Imagem". A imagem fica atras da midia e do texto, na
// largura do cartao, presa em cima, no meio ou embaixo ("Onde a imagem fica"), com a borda sumindo na cor de
// apoio (cardBackgroundCss). Sobe pelo mesmo envio da imagem do aviso (o campo de sempre, recorte 16:9,
// uploadNoticeImage): so o endereco do nosso bucket de imagens vale (link de outro site e recusado aqui e no
// zod). Por cima, o "Escurecer a imagem"; no resto do cartao, a cor de apoio (aparece enquanto a imagem carrega
// e e a cor "auto" do degrade). Enquanto a imagem sobe, salvar e sair da pagina esperam (onBusyChange). A
// ultima imagem fica guardada ao trocar para Cor ou Degradê e volta ao escolher Imagem de novo.

// Ids escritos por inteiro (o teste do foco confere que existem): popupDesignFocusSelector leva cada erro do
// fundo ao campo certo.
const copy = POPUP_DESIGN_COPY.cardSection;

type CardBackgroundFieldProps = {
  disabled: boolean;
  errorFor: (key: string) => string | undefined;
  /** O fundo mais novo (o envio termina depois: o fundo pode ter mudado no meio). */
  latest: () => PopupCardBackground;
  /** A imagem subindo segura o salvar (a frase de espera) e solta no fim (null). */
  onBusyChange?: (reason: string | null) => void;
  onChange: (background: PopupCardBackground) => void;
  value: PopupCardBackground;
};

export function CardBackgroundField({ disabled, errorFor, latest, onBusyChange, onChange, value }: CardBackgroundFieldProps) {
  const rememberedImage = useRef<PopupCardImage | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const busyRef = useRef(onBusyChange);

  useEffect(() => {
    busyRef.current = onBusyChange;
  });

  // Sair da tela no meio do envio libera o "Salvar".
  useEffect(() => () => busyRef.current?.(null), []);

  function changeKind(kind: CardBackgroundKind) {
    if (kind === value.kind) {
      return;
    }

    setImageError(null);

    if (value.kind === "image") {
      rememberedImage.current = value;
    }

    onChange(cardBackgroundOfKind(kind, value, rememberedImage.current));
  }

  function updateImage(patch: Partial<PopupCardImage>) {
    const current = latest();

    if (current.kind === "image") {
      onChange({ ...current, ...patch });
    }
  }

  async function changeImage(next: string | null) {
    setImageError(null);

    if (next === null) {
      updateImage({ url: "" });
      return;
    }

    // Link colado que o site nao deixa recortar: so vale se ja e uma imagem nossa.
    if (!next.startsWith("data:")) {
      if (isOwnPopupCardImageUrl(next)) {
        updateImage({ url: next });
      } else {
        setImageError(copy.backgroundImageNotOurs);
      }

      return;
    }

    setUploading(next);
    busyRef.current?.(copy.backgroundImageBusy);
    const result = await uploadNoticeImage({ image: next }).catch(() => null);
    setUploading(null);
    busyRef.current?.(null);

    if (!result || !result.ok) {
      setImageError(result ? (result.fieldErrors?.image?.[0] ?? result.error) : copy.backgroundImageFailed);
      return;
    }

    updateImage({ url: result.data.url });
  }

  // Sem imagem ainda, o zod diz "Envie a imagem do fundo de novo."; aqui a frase de quem ainda nao enviou.
  const urlError = value.kind === "image" ? (errorFor("design.card.background.url") ?? errorFor("design.card.background")) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-3" id="popup-design-cartao-fundo">
      <PillField
        disabled={disabled || uploading !== null}
        error={errorFor("design.card.background.kind")}
        label={copy.background}
        name="popup-design-cartao-fundo-tipo"
        onChange={changeKind}
        options={CARD_BACKGROUND_KIND_OPTIONS}
        value={value.kind}
      />
      {value.kind === "image" ? (
        <div className="flex min-w-0 flex-col gap-4 border-l-2 border-[var(--border-subtle)] pl-4">
          <div className="flex min-w-0 flex-col gap-1">
            <ImageField
              error={imageError ?? (urlError ? (value.url ? urlError : copy.backgroundImageMissing) : null)}
              id="popup-design-cartao-imagem"
              label={copy.backgroundImage}
              onChange={(next) => void changeImage(next)}
              pending={uploading !== null}
              slot="notice"
              value={uploading ?? (value.url || null)}
            />
            <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.backgroundImageHint}</p>
          </div>
          <PillField
            disabled={disabled}
            error={errorFor("design.card.background.position")}
            hint={copy.backgroundImagePositionHint}
            label={copy.backgroundImagePosition}
            name="popup-design-cartao-imagem-parte"
            onChange={(position) => updateImage({ position })}
            options={MEDIA_POSITION_OPTIONS}
            value={value.position}
          />
          <NumberField
            disabled={disabled}
            error={errorFor("design.card.background.dim")}
            hint={copy.backgroundImageDimHint}
            id="popup-design-cartao-imagem-escurecer"
            label={copy.backgroundImageDim}
            max={POPUP_DESIGN_LIMITS.cardImageDim.max}
            min={POPUP_DESIGN_LIMITS.cardImageDim.min}
            onChange={(dim) => updateImage({ dim })}
            slider
            suffix="%"
            value={value.dim}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <ColorField
              disabled={disabled}
              error={errorFor("design.card.background.color")}
              id="popup-design-cartao-fundo-cor"
              label={copy.backgroundImageColor}
              onChange={(color) => updateImage({ color })}
              value={value.color}
            />
            <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.backgroundImageColorHint}</p>
          </div>
        </div>
      ) : (
        <PaintColorFields disabled={disabled} id="popup-design-cartao-fundo" label={copy.background} onChange={onChange} value={value} />
      )}
      <DesignFieldError id="popup-design-cartao-fundo-error" message={value.kind === "image" ? null : errorFor("design.card.background")} />
    </div>
  );
}
