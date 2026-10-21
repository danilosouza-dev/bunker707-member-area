"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { uploadNoticeImage } from "@/server/communications/actions";
import { NOTICE_LIMITS, type CampaignKind } from "@/server/communications/campaign-model";
import type { FlowValidity } from "@/server/communications/message-meta";
import type { NoticeDraft } from "@/server/communications/schemas";
import { HeroTextField } from "../member-area/home-hero/fields";
import { ImageField } from "../products/image-field";
import { AdminSwitch, SectionCard } from "../settings/kit";
import type { ProductPickerItem } from "../storefront/product-picker";
import { NoticeAudioField } from "./notice-audio-field";
import { NoticeCtaField } from "./notice-cta-field";
import { NoticeIconField } from "./notice-icon-field";
import { NoticeSenderField } from "./notice-sender-field";
import { NoticeValidityField } from "./notice-validity-field";
import type { NoticeSenderChoice } from "./notices-view-model";

// Conteudo de uma notificacao (docs/23; docs/22 §2.2): titulo, texto, quem envia, icone ao lado do
// titulo, imagem e audio, botao, resposta e, quando `showValidity`, quanto tempo fica no sino. O mesmo
// formulario no editor do aviso (em cartoes; ali o tempo no sino fica no cartao "Quando"), na folha da
// notificacao seguinte e no painel do passo do construtor de fluxos (`layout="plain"`, com o tempo no
// sino aqui e, com `validityAnchor`, "Até a notificação principal sumir").
//
// Quem chama guarda o conteudo e os erros (errorFor/onBlurField com as chaves do zod: "title",
// "cta.href"...). A imagem recortada sobe aqui mesmo (uploadNoticeImage); enquanto sobe, a previa ja
// mostra o recorte (onImageUploadChange) e quem chama nao deixa salvar.

/** O conteudo editado aqui: o do aviso, com a validade dos passos de fluxo ("with_anchor"). */
export type NoticeContentValue = Pick<NoticeDraft, "audio" | "body" | "cta" | "icon" | "image" | "response" | "sender" | "title"> & {
  validity: FlowValidity;
};

type NoticeContentFieldsProps = {
  /** Quem esta com o editor aberto pode trocar o icone da escola (Marca). */
  canEditBrand: boolean;
  disabled: boolean;
  errorFor: (key: string) => string | undefined;
  /** Prefixo dos ids ("aviso" no editor: "aviso-titulo", "aviso-quem-envia"...). */
  idPrefix?: string;
  kind: CampaignKind;
  /** "cards": um SectionCard por bloco (editor do aviso); "plain": blocos com titulo (folha, painel). */
  layout?: "cards" | "plain";
  /** Antes do titulo, no primeiro bloco (o Tipo do aviso, no editor). */
  leading?: ReactNode;
  /** Motivo para nao salvar agora (audio gravando ou enviando); null = livre. */
  onAudioBusyChange?: (reason: string | null) => void;
  onBlurField: (key: string) => void;
  onChange: (patch: Partial<NoticeContentValue>) => void;
  /** Recorte da imagem subindo (data URL, para a previa) ou null quando terminou. */
  onImageUploadChange?: (preview: string | null) => void;
  /** Equipe relida (foto nova em Perfil). */
  onSendersChange?: (senders: NoticeSenderChoice[]) => void;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  /** Muda para remontar os campos com memoria propria (botao) quando o conteudo e trocado de uma vez. */
  resetKey?: number;
  /** Quem estava gravado em "Quem envia" (o nome de quem saiu da equipe). */
  savedSender?: { id: string; name: string } | null;
  schoolIconUrl: string;
  schoolName: string;
  /** Hora do envio (agora ou a agendada): base do "Termina em" na dica do tempo no sino. */
  sendAt: number;
  senders: readonly NoticeSenderChoice[];
  /** Mostra "Fica no sino por" aqui (folha e painel); no editor ele fica no cartao "Quando". */
  showValidity: boolean;
  /** Acrescenta "Até a notificação principal sumir" (passo que conta de uma notificacao). */
  validityAnchor?: { label: string };
  value: NoticeContentValue;
};

type BlockProps = { children: ReactNode; description?: string; layout: "cards" | "plain"; meta?: string; title: string };

function Block({ children, description, layout, meta, title }: BlockProps) {
  if (layout === "cards") {
    return (
      <SectionCard description={description} meta={meta} title={title}>
        {children}
      </SectionCard>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-4 border-t border-[var(--border-subtle)] pt-5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm leading-5 font-semibold text-[var(--text-primary)]">
          {title}
          {meta ? <span className="text-xs leading-5 font-medium text-[var(--text-tertiary)]">{meta}</span> : null}
        </h3>
        {description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function NoticeContentFields({
  canEditBrand,
  disabled,
  errorFor,
  idPrefix = "aviso",
  kind,
  layout = "cards",
  leading,
  onAudioBusyChange,
  onBlurField,
  onChange,
  onImageUploadChange,
  onSendersChange,
  products,
  productsLoaded,
  resetKey,
  savedSender,
  schoolIconUrl,
  schoolName,
  sendAt,
  senders,
  showValidity,
  validityAnchor,
  value
}: NoticeContentFieldsProps) {
  const [imageUpload, setImageUpload] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Desligar e religar "Pedir uma resposta" volta com os textos de antes.
  const rememberedResponse = useRef<NoticeDraft["response"]>(value.response);
  // O envio da imagem termina depois: a descricao escrita no meio vem do conteudo mais novo.
  const latest = useRef(value);
  const limits = NOTICE_LIMITS[kind];
  const inbox = kind === "inbox";
  const id = (suffix: string) => `${idPrefix}-${suffix}`;

  useEffect(() => {
    latest.current = value;
  });

  function setUpload(preview: string | null) {
    setImageUpload(preview);
    onImageUploadChange?.(preview);
  }

  async function changeImage(next: string | null) {
    setImageError(null);
    onBlurField("image.url");

    // Remover ou link https colado (sem recorte): vai direto para o conteudo.
    if (next === null || !next.startsWith("data:")) {
      onChange({ image: next ? { alt: latest.current.image?.alt ?? "", url: next } : null });
      return;
    }

    setUpload(next);
    const result = await uploadNoticeImage({ image: next }).catch(() => null);
    setUpload(null);

    if (!result || !result.ok) {
      setImageError(result ? (result.fieldErrors?.image?.[0] ?? result.error) : "Não foi possível enviar a imagem. Tente de novo.");
      return;
    }

    onChange({ image: { alt: latest.current.image?.alt ?? "", url: result.data.url } });
  }

  function changeResponse(response: NonNullable<NoticeDraft["response"]>) {
    rememberedResponse.current = response;
    onChange({ response });
  }

  const validityErrors = {
    endsAt: errorFor("validity.endsAt"),
    minutes: errorFor("validity.minutes"),
    validity: errorFor("validity")
  };

  return (
    <>
      <Block description="O tipo e o texto que o aluno lê." layout={layout} title="O que">
        <div className="flex min-w-0 flex-col gap-5">
          {leading}
          <HeroTextField
            disabled={disabled}
            error={errorFor("title")}
            id={id("titulo")}
            label="Título"
            max={limits.title}
            onBlur={() => onBlurField("title")}
            onChange={(title) => onChange({ title })}
            value={value.title}
          />
          <HeroTextField
            disabled={disabled}
            error={errorFor("body")}
            hint={inbox ? "Textos longos ficam com “Ver mais” no sino." : undefined}
            id={id("texto")}
            label="Texto (opcional)"
            max={limits.body}
            multiline
            onBlur={() => onBlurField("body")}
            onChange={(body) => onChange({ body })}
            value={value.body}
          />
          {inbox ? (
            <NoticeSenderField
              canEditBrand={canEditBrand}
              disabled={disabled}
              error={errorFor("sender") ?? errorFor("sender.userId")}
              id={id("quem-envia")}
              onChange={(sender) => onChange({ sender })}
              onSendersChange={onSendersChange}
              saved={savedSender}
              schoolIconUrl={schoolIconUrl}
              schoolName={schoolName}
              senders={senders}
              value={value.sender}
            />
          ) : null}
          <NoticeIconField disabled={disabled} id={id("icone")} onChange={(icon) => onChange({ icon })} value={value.icon} />
        </div>
      </Block>

      <Block description="Uma imagem 16:9 e um áudio curto, para o aviso ganhar atenção." layout={layout} meta="opcional" title="Imagem e áudio">
        <div className="flex min-w-0 flex-col gap-5">
          <ImageField
            error={imageError ?? errorFor("image.url")}
            id={id("imagem")}
            label="Imagem"
            onChange={(next) => void changeImage(next)}
            optional
            pending={imageUpload !== null}
            slot="notice"
            value={imageUpload ?? value.image?.url ?? null}
          />
          {value.image ? (
            <HeroTextField
              disabled={disabled}
              error={errorFor("image.alt")}
              hint="Ajuda quem usa leitor de tela. Ex.: Professora apresentando a aula nova."
              id={id("imagem-descricao")}
              label="Descrição da imagem (opcional)"
              max={NOTICE_LIMITS.imageAlt}
              onBlur={() => onBlurField("image.alt")}
              onChange={(alt) => onChange({ image: value.image ? { ...value.image, alt } : null })}
              value={value.image.alt}
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">
              Áudio<span className="font-normal text-[var(--text-tertiary)]"> (opcional)</span>
            </span>
            <NoticeAudioField
              disabled={disabled}
              error={errorFor("audio.url") ?? errorFor("audio.durationSeconds") ?? errorFor("audio")}
              id={id("audio")}
              onBusyChange={onAudioBusyChange}
              onChange={(audio) => onChange({ audio })}
              value={value.audio}
            />
          </div>
        </div>
      </Block>

      <Block description="Leva o aluno para um produto, uma página da área ou um site." layout={layout} meta="opcional" title="Botão">
        <NoticeCtaField
          disabled={disabled}
          errors={{ href: errorFor("cta.href"), label: errorFor("cta.label") }}
          key={resetKey}
          onBlurField={onBlurField}
          onChange={(cta) => onChange({ cta })}
          products={products}
          productsLoaded={productsLoaded}
          value={value.cta}
        />
      </Block>

      {inbox ? (
        <Block description="Para convites e confirmações: o aluno responde direto no sino." layout={layout} meta="opcional" title="Resposta">
          <div className="flex min-w-0 flex-col gap-5">
            <AdminSwitch
              checked={value.response !== null}
              description={value.response ? "Aparecem dois botões no aviso. As respostas ficam no relatório." : "Sem resposta, o aviso só informa."}
              disabled={disabled}
              id={id("resposta")}
              label="Pedir uma resposta (Aceitar ou Recusar)"
              onCheckedChange={(checked) => onChange({ response: checked ? (rememberedResponse.current ?? { acceptLabel: "Aceitar", declineLabel: "Recusar" }) : null })}
            />
            {value.response ? (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <HeroTextField
                  disabled={disabled}
                  error={errorFor("response.acceptLabel")}
                  id={id("aceitar")}
                  label="Botão de aceitar"
                  max={NOTICE_LIMITS.responseLabel}
                  onBlur={() => onBlurField("response.acceptLabel")}
                  onChange={(acceptLabel) => changeResponse({ acceptLabel, declineLabel: value.response?.declineLabel ?? "Recusar" })}
                  value={value.response.acceptLabel}
                />
                <HeroTextField
                  disabled={disabled}
                  error={errorFor("response.declineLabel")}
                  id={id("recusar")}
                  label="Botão de recusar"
                  max={NOTICE_LIMITS.responseLabel}
                  onBlur={() => onBlurField("response.declineLabel")}
                  onChange={(declineLabel) => changeResponse({ acceptLabel: value.response?.acceptLabel ?? "Aceitar", declineLabel })}
                  value={value.response.declineLabel}
                />
              </div>
            ) : null}
          </div>
        </Block>
      ) : null}

      {showValidity && inbox ? (
        <Block layout={layout} title="Tempo no sino">
          <div className="flex min-w-0 flex-col gap-4">
            <NoticeValidityField
              anchorLabel={validityAnchor?.label}
              disabled={disabled}
              errors={validityErrors}
              idPrefix={id("validade")}
              onChange={(validity) => onChange({ validity })}
              sendAt={sendAt}
              value={value.validity}
            />
          </div>
        </Block>
      ) : null}
    </>
  );
}
