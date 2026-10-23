"use client";

import { POPUP_DESIGN_LIMITS, type PopupCardStyle, type PopupContrastHint, type PopupDesign, type PopupTextZone } from "@/server/communications/popup-design-model";
import { CardBackgroundField } from "./card-background-field";
import { BorderField, ColorField, ContrastHint, DesignFieldError, DesignSection, NumberField, PillField } from "./design-controls";
import { ALIGN_OPTIONS, CARD_SHADOW_OPTIONS, CARD_WIDTH_OPTIONS, POPUP_DESIGN_COPY, TEXT_PLACEMENT_OPTIONS } from "./popup-design-editor-model";

// Secoes "Texto e posição", "Cartão" e "Fechar e links" do design (docs/26 §7.2). Tudo por zonas (sem arrastar):
// onde fica o texto, quanto sobe sobre a midia, o alinhamento e o espaco entre os blocos; a largura do cartao no
// computador (no celular encolhe junto), o fundo (cor, degrade ou imagem, card-background-field), a borda, os
// cantos, o respiro e a sombra; as cores do X e dos links "Lembrar depois" e "Não mostrar de novo", com a dica
// de contraste.

const LIMITS = POPUP_DESIGN_LIMITS;

type SectionProps = {
  design: PopupDesign;
  disabled: boolean;
  errorFor: (key: string) => string | undefined;
  onChange: (design: PopupDesign) => void;
};

type CardSectionProps = SectionProps & {
  hints: readonly PopupContrastHint[];
  /** O design mais novo (o envio da imagem do fundo termina depois). */
  latestDesign: () => PopupDesign;
  /** A imagem do fundo subindo segura o salvar. */
  onBusyChange?: (reason: string | null) => void;
};

export function TextZoneSection({ design, disabled, errorFor, onChange }: SectionProps) {
  const copy = POPUP_DESIGN_COPY.text;
  const zone = design.text;
  const update = (patch: Partial<PopupTextZone>) => onChange({ ...design, text: { ...zone, ...patch } });
  const showsOverlap = zone.placement === "below" && design.media.kind !== "none";

  return (
    <DesignSection title={POPUP_DESIGN_COPY.sections.text}>
      <PillField
        disabled={disabled}
        error={errorFor("design.text.placement") ?? errorFor("design.text")}
        label={copy.placement}
        name="popup-design-posicao"
        onChange={(placement) => update({ placement })}
        options={TEXT_PLACEMENT_OPTIONS}
        value={zone.placement}
      />
      {showsOverlap ? (
        <NumberField
          disabled={disabled}
          error={errorFor("design.text.overlap")}
          hint={copy.overlapHint}
          id="popup-design-subir"
          label={copy.overlap}
          max={LIMITS.overlap.max}
          min={LIMITS.overlap.min}
          onChange={(overlap) => update({ overlap })}
          suffix="%"
          value={zone.overlap}
        />
      ) : null}
      <PillField disabled={disabled} label={copy.align} name="popup-design-alinhamento" onChange={(align) => update({ align })} options={ALIGN_OPTIONS} value={zone.align} />
      <NumberField
        disabled={disabled}
        error={errorFor("design.text.gap")}
        id="popup-design-espaco"
        label={copy.gap}
        max={LIMITS.gap.max}
        min={LIMITS.gap.min}
        onChange={(gap) => update({ gap })}
        suffix="px"
        value={zone.gap}
      />
    </DesignSection>
  );
}

export function CardSection({ design, disabled, errorFor, hints, latestDesign, onBusyChange, onChange }: CardSectionProps) {
  const copy = POPUP_DESIGN_COPY.cardSection;
  const card = design.card;
  const update = (patch: Partial<PopupCardStyle>) => onChange({ ...design, card: { ...card, ...patch } });
  // Sem imagem enviada ainda, nada para conferir.
  const cardHints = card.background.kind === "image" && !card.background.url ? [] : hints.filter((hint) => hint.key === "card.background");

  return (
    <DesignSection id="popup-design-cartao" title={POPUP_DESIGN_COPY.sections.card}>
      <PillField
        disabled={disabled}
        hint={copy.widthHint}
        label={copy.width}
        name="popup-design-largura"
        onChange={(width) => update({ width })}
        options={CARD_WIDTH_OPTIONS}
        value={card.width}
      />
      <CardBackgroundField
        disabled={disabled}
        errorFor={errorFor}
        latest={() => latestDesign().card.background}
        onBusyChange={onBusyChange}
        onChange={(background) => {
          const current = latestDesign();
          onChange({ ...current, card: { ...current.card, background } });
        }}
        value={card.background}
      />
      {cardHints.map((hint) => (
        <ContrastHint key={`${hint.key}-${hint.blockId ?? ""}`} message={hint.message} />
      ))}
      <BorderField disabled={disabled} id="popup-design-cartao-borda" label={copy.border} onChange={(border) => update({ border })} value={card.border} />
      <div className="grid min-w-0 grid-cols-2 gap-4">
        <NumberField
          disabled={disabled}
          id="popup-design-cartao-cantos"
          label={copy.radius}
          max={LIMITS.cardRadius.max}
          min={LIMITS.cardRadius.min}
          onChange={(radius) => update({ radius })}
          suffix="px"
          value={card.radius}
        />
        <NumberField
          disabled={disabled}
          id="popup-design-cartao-respiro"
          label={copy.padding}
          max={LIMITS.cardPadding.max}
          min={LIMITS.cardPadding.min}
          onChange={(padding) => update({ padding })}
          suffix="px"
          value={card.padding}
        />
      </div>
      <PillField disabled={disabled} label={copy.shadow} name="popup-design-sombra" onChange={(shadow) => update({ shadow })} options={CARD_SHADOW_OPTIONS} value={card.shadow} />
      <DesignFieldError message={errorFor("design.card")} />
    </DesignSection>
  );
}

export function CloseSection({ design, disabled, errorFor, hints, onChange }: SectionProps & { hints: readonly PopupContrastHint[] }) {
  const copy = POPUP_DESIGN_COPY.close;
  const closeHint = hints.find((hint) => hint.key === "close");
  const linksHint = hints.find((hint) => hint.key === "links");

  return (
    <DesignSection id="popup-design-fechar" title={POPUP_DESIGN_COPY.sections.close}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <ColorField disabled={disabled} error={errorFor("design.close.color")} id="popup-design-x-cor" label={copy.color} onChange={(color) => onChange({ ...design, close: { ...design.close, color } })} value={design.close.color} />
        <ColorField
          disabled={disabled}
          error={errorFor("design.close.background")}
          id="popup-design-x-fundo"
          label={copy.background}
          onChange={(background) => onChange({ ...design, close: { ...design.close, background } })}
          value={design.close.background}
        />
      </div>
      {closeHint ? <ContrastHint message={closeHint.message} /> : null}
      <ColorField disabled={disabled} error={errorFor("design.links.color")} id="popup-design-links-cor" label={copy.links} onChange={(color) => onChange({ ...design, links: { color } })} value={design.links.color} />
      {linksHint ? <ContrastHint message={linksHint.message} /> : null}
    </DesignSection>
  );
}
