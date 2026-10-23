"use client";

import { Lock } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { uploadNoticeImage } from "@/server/communications/actions";
import { NOTICE_LIMITS, type CampaignKind } from "@/server/communications/campaign-model";
import type { PollDefinition } from "@/server/communications/interactions-model";
import type { FlowValidity } from "@/server/communications/message-meta";
import type { NoticeDraft } from "@/server/communications/schemas";
import { HeroTextField } from "../member-area/home-hero/fields";
import { ImageField } from "../products/image-field";
import { AdminSwitch, SectionCard } from "../settings/kit";
import type { ProductPickerItem } from "../storefront/product-picker";
import { NoticeAudioField } from "./notice-audio-field";
import { NoticeCtaField } from "./notice-cta-field";
import { NoticeIconField } from "./notice-icon-field";
import { NoticePollField } from "./notice-poll-field";
import { NoticeSenderField } from "./notice-sender-field";
import { NoticeValidityField } from "./notice-validity-field";
import { CTA_FIELD_COPY, NOTICE_INTERACTION_COPY, emptyPoll, type NoticeSenderChoice } from "./notices-view-model";
import { POPUP_DESIGN_COPY } from "./popup-design/popup-design-editor-model";

// Conteudo de uma notificacao (docs/23; docs/22 §2.2): titulo, texto, quem envia, icone ao lado do
// titulo, imagem e audio, botao, resposta e, quando `showValidity`, quanto tempo fica no sino. O mesmo
// formulario no editor do aviso (em cartoes; ali o tempo no sino fica no cartao "Quando"), na folha da
// notificacao seguinte e no painel do passo do construtor de fluxos (`layout="plain"`, com o tempo no
// sino aqui e, com `validityAnchor`, "Até a notificação principal sumir").
//
// Quem chama guarda o conteudo e os erros (errorFor/onBlurField com as chaves do zod: "title",
// "cta.href"...). A imagem recortada sobe aqui mesmo (uploadNoticeImage); enquanto sobe, a previa ja
// mostra o recorte (onImageUploadChange) e quem chama nao deixa salvar.
//
// v3a (docs/24 §2.5): "Botão" vira "Para onde leva" (com "Como o aluno chega lá" na notificacao) e
// "Resposta" vira "Interação": "Permitir reações", "Pedir uma resposta" e "Fazer uma enquete" (resposta
// e enquete nao convivem: uma desliga a outra). `lockedFields` (notificacao ja enviada) trava o audio, a
// enquete e ligar ou desligar a resposta, com o motivo embaixo; `pollCanEndAtDate` false (folha da
// seguinte e passo do fluxo) tira o fim numa data.
//
// Ajustes da v3a: "Permitir que o aluno exclua do sino" (allowHide, ligado por padrao) logo depois de
// "Permitir reações"; muda tambem depois do envio. Num passo de fluxo no ar que ja chegou a alguem, a
// enquete chega travada (lockedFields.poll).
//
// Design do pop-up (docs/26), `popupDesign` (pop-up "Personalizado"): o texto e o icone nao aparecem para o
// aluno (os blocos do design sao o texto), entao somem daqui; a imagem vai para o card Design > Mídia e o
// "Para onde leva" para o bloco Botão principal. "Título" vira "Nome do pop-up" (listas e relatorios; o mesmo
// id "aviso-titulo") e o bloco de midia fica so com o Áudio. No Livre (docs/27, `popupDesign="free"`), o mesmo: o
// texto, a imagem e o destino do Botão principal ficam no editor Livre.

/** O conteudo editado aqui: o do aviso, com a validade dos passos de fluxo ("with_anchor"). */
export type NoticeContentValue = Pick<NoticeDraft, "allowHide" | "audio" | "body" | "cta" | "icon" | "image" | "poll" | "reactions" | "response" | "sender" | "title"> & {
  validity: FlowValidity;
};

/** Campos travados depois do envio, cada um com o motivo que aparece embaixo dele (docs/24 §2.2). */
export type NoticeLockedFields = Partial<Record<"audio" | "poll" | "responseMode", string>>;

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
  /** Notificacao ja enviada: o que nao muda mais e o motivo (o editor passa; o servidor confere de novo). */
  lockedFields?: NoticeLockedFields;
  /** Motivo para nao salvar agora (audio gravando ou enviando); null = livre. */
  onAudioBusyChange?: (reason: string | null) => void;
  onBlurField: (key: string) => void;
  onChange: (patch: Partial<NoticeContentValue>) => void;
  /** Recorte da imagem subindo (data URL, para a previa) ou null quando terminou. */
  onImageUploadChange?: (preview: string | null) => void;
  /** Equipe relida (foto nova em Perfil). */
  onSendersChange?: (senders: NoticeSenderChoice[]) => void;
  /** A enquete pode encerrar numa data (editor do aviso); false na folha da seguinte e no passo do fluxo. */
  pollCanEndAtDate?: boolean;
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
  /** false: "Fica no sino por" sem "Até uma data" (modo modelo, docs/28 §5.6; a folha da seguinte repassa). */
  validityAllowUntil?: boolean;
  /**
   * Pop-up "Personalizado" (docs/26) ou "Livre" (`"free"`, docs/27): sem texto, icone, imagem e destino aqui (vao
   * para o card Design; no Livre, para o editor Livre).
   */
  popupDesign?: boolean | "free";
  value: NoticeContentValue;
};

type BlockProps = { children: ReactNode; description?: string; layout: "cards" | "plain"; meta?: string; title: string };

/** Motivo de um campo travado depois do envio, embaixo dele. */
function LockedNote({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--text-secondary)]">
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-5 text-[var(--error)]">{children}</p>;
}

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
  lockedFields = {},
  onAudioBusyChange,
  onBlurField,
  onChange,
  onImageUploadChange,
  onSendersChange,
  pollCanEndAtDate = true,
  popupDesign = false,
  products,
  productsLoaded,
  resetKey,
  savedSender,
  schoolIconUrl,
  schoolName,
  sendAt,
  senders,
  showValidity,
  validityAllowUntil = true,
  validityAnchor,
  value
}: NoticeContentFieldsProps) {
  const [imageUpload, setImageUpload] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Desligar e religar "Pedir uma resposta" (ou "Fazer uma enquete") volta com o que foi escrito antes.
  const rememberedResponse = useRef<NoticeDraft["response"]>(value.response);
  const rememberedPoll = useRef<PollDefinition | null>(value.poll ?? null);
  // O envio da imagem termina depois: a descricao escrita no meio vem do conteudo mais novo.
  const latest = useRef(value);
  const limits = NOTICE_LIMITS[kind];
  const inbox = kind === "inbox";
  // Design do pop-up (docs/26): no Personalizado, o design desenha o pop-up (o titulo vira o nome).
  const custom = !inbox && Boolean(popupDesign);
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

  function changePoll(poll: PollDefinition) {
    rememberedPoll.current = poll;
    onChange({ poll });
  }

  function togglePoll(checked: boolean) {
    if (!checked) {
      onChange({ poll: null });
      return;
    }

    const poll = rememberedPoll.current ?? emptyPoll();
    rememberedPoll.current = poll;
    onChange({ poll });
  }

  const poll = inbox ? (value.poll ?? null) : null;
  // Rascunho de antes dos ajustes da v3a (sem a chave): o aluno pode excluir, como sempre foi.
  const allowHide = value.allowHide !== false;
  const responseLocked = lockedFields.responseMode;
  const pollLocked = lockedFields.poll;
  const audioLocked = lockedFields.audio;
  // Resposta e enquete nao convivem (docs/24 T13): com uma ligada, a chave da outra fica desligada e explica.
  const responseBlockedByPoll = poll !== null && value.response === null;
  const pollBlockedByResponse = value.response !== null && poll === null;

  const validityErrors = {
    endsAt: errorFor("validity.endsAt"),
    minutes: errorFor("validity.minutes"),
    validity: errorFor("validity")
  };

  return (
    <>
      <Block description={leading ? "O tipo e o texto que o aluno lê." : "O texto que o aluno lê."} layout={layout} title="O que">
        <div className="flex min-w-0 flex-col gap-5">
          {leading}
          <HeroTextField
            disabled={disabled}
            error={errorFor("title")}
            hint={custom ? POPUP_DESIGN_COPY.content.titleHint : undefined}
            id={id("titulo")}
            label={custom ? POPUP_DESIGN_COPY.content.titleLabel : "Título"}
            max={limits.title}
            onBlur={() => onBlurField("title")}
            onChange={(title) => onChange({ title })}
            value={value.title}
          />
          {custom ? null : (
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
          )}
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
          {custom ? null : <NoticeIconField disabled={disabled} id={id("icone")} onChange={(icon) => onChange({ icon })} value={value.icon} />}
        </div>
      </Block>

      <Block
        description={
          custom
            ? popupDesign === "free"
              ? POPUP_DESIGN_COPY.free.audioDescription
              : POPUP_DESIGN_COPY.content.audioDescription
            : "Uma imagem 16:9 e um áudio curto, para o aviso ganhar atenção."
        }
        layout={layout}
        meta="opcional"
        title={custom ? POPUP_DESIGN_COPY.content.audioTitle : "Imagem e áudio"}
      >
        <div className="flex min-w-0 flex-col gap-5">
          {custom ? null : (
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
          )}
          {value.image && !custom ? (
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
            {/* Personalizado: o bloco ja se chama "Áudio" (opcional); o rotulo de dentro so repetiria. */}
            {custom ? null : (
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                Áudio<span className="font-normal text-[var(--text-tertiary)]"> (opcional)</span>
              </span>
            )}
            <NoticeAudioField
              disabled={disabled || audioLocked !== undefined}
              error={errorFor("audio.url") ?? errorFor("audio.durationSeconds") ?? errorFor("audio")}
              id={id("audio")}
              onBusyChange={onAudioBusyChange}
              onChange={(audio) => onChange({ audio })}
              value={value.audio}
            />
            {audioLocked ? <LockedNote>{audioLocked}</LockedNote> : null}
          </div>
        </div>
      </Block>

      {/* Personalizado: o texto e o destino do botao ficam no bloco Botão principal do design. */}
      {custom ? null : (
        <Block description={CTA_FIELD_COPY.blockDescription} layout={layout} meta="opcional" title={CTA_FIELD_COPY.blockTitle}>
          <NoticeCtaField
            disabled={disabled}
            errors={{ display: errorFor("cta.display"), href: errorFor("cta.href"), label: errorFor("cta.label") }}
            idPrefix={idPrefix}
            key={resetKey}
            kind={kind}
            onBlurField={onBlurField}
            onChange={(cta) => onChange({ cta })}
            products={products}
            productsLoaded={productsLoaded}
            value={value.cta}
          />
        </Block>
      )}

      {inbox ? (
        <Block description={NOTICE_INTERACTION_COPY.blockDescription} layout={layout} meta="opcional" title={NOTICE_INTERACTION_COPY.blockTitle}>
          <div className="flex min-w-0 flex-col gap-5">
            <AdminSwitch
              checked={value.reactions === true}
              description={value.reactions ? NOTICE_INTERACTION_COPY.reactionsOn : NOTICE_INTERACTION_COPY.reactionsOff}
              disabled={disabled}
              id={id("reacoes")}
              label={NOTICE_INTERACTION_COPY.reactionsLabel}
              onCheckedChange={(reactions) => onChange({ reactions })}
            />

            <AdminSwitch
              checked={allowHide}
              description={allowHide ? NOTICE_INTERACTION_COPY.allowHideOn : NOTICE_INTERACTION_COPY.allowHideOff}
              disabled={disabled}
              id={id("excluir")}
              label={NOTICE_INTERACTION_COPY.allowHideLabel}
              onCheckedChange={(next) => onChange({ allowHide: next })}
            />

            <div className="flex min-w-0 flex-col gap-4">
              <AdminSwitch
                checked={value.response !== null}
                description={
                  responseLocked ??
                  (responseBlockedByPoll
                    ? NOTICE_INTERACTION_COPY.responseDisabledByPoll
                    : value.response
                      ? NOTICE_INTERACTION_COPY.responseOn
                      : NOTICE_INTERACTION_COPY.responseOff)
                }
                disabled={disabled || responseLocked !== undefined || responseBlockedByPoll}
                id={id("resposta")}
                label={NOTICE_INTERACTION_COPY.responseLabel}
                onCheckedChange={(checked) => onChange({ response: checked ? (rememberedResponse.current ?? { acceptLabel: "Aceitar", declineLabel: "Recusar" }) : null })}
              />
              {errorFor("response") ? <FieldError>{errorFor("response")}</FieldError> : null}
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

            <div className="flex min-w-0 flex-col gap-4">
              <AdminSwitch
                checked={poll !== null}
                description={
                  pollLocked ??
                  (pollBlockedByResponse ? NOTICE_INTERACTION_COPY.pollDisabledByResponse : poll ? NOTICE_INTERACTION_COPY.pollOn : NOTICE_INTERACTION_COPY.pollOff)
                }
                disabled={disabled || pollLocked !== undefined || pollBlockedByResponse}
                id={id("enquete")}
                label={NOTICE_INTERACTION_COPY.pollLabel}
                onCheckedChange={togglePoll}
              />
              {errorFor("poll") ? <FieldError>{errorFor("poll")}</FieldError> : null}
              {poll ? (
                <NoticePollField
                  canEndAtDate={pollCanEndAtDate}
                  disabled={disabled || pollLocked !== undefined}
                  errorFor={errorFor}
                  idPrefix={idPrefix}
                  key={resetKey}
                  onBlurField={onBlurField}
                  onChange={changePoll}
                  sendAt={sendAt}
                  value={poll}
                />
              ) : null}
            </div>
          </div>
        </Block>
      ) : null}

      {showValidity && inbox ? (
        <Block layout={layout} title="Tempo no sino">
          <div className="flex min-w-0 flex-col gap-4">
            <NoticeValidityField
              allowUntil={validityAllowUntil}
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
