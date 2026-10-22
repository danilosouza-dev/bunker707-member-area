"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FlowNoticeContent } from "@/server/communications/flow-schemas";
import { PillGroup } from "../form";
import type { PreviewDevice } from "../member-area/preview-frame";
import { AdminSheet, AdminSheetSection } from "../sheet";
import type { ProductPickerItem } from "../storefront/product-picker";
import { FOLLOW_UPS_COPY, followUpValidityAnchorLabel, type FollowUpLevel } from "./follow-ups-view-model";
import { NoticeContentFields, type NoticeLockedFields } from "./notice-content-fields";
import { NoticePreview } from "./notice-preview";
import type { NoticeSenderChoice } from "./notices-view-model";

// Folha de uma notificacao seguinte (docs/23 §2.2): o mesmo formulario de conteudo do aviso
// (NoticeContentFields, com "Fica no sino por" aqui e a opcao "Até a notificação principal sumir") e a
// propria previa. Painel lateral do admin (AdminSheet: tela cheia no celular), "Concluir" no rodape. O
// conteudo fica no estado do cartao; quem grava e o editor (ou "Aplicar alterações" no relatorio).
//
// O formulario e a previa ficam num <form> proprio, com ids e nomes de `idPrefix`: os campos e os grupos
// de opcoes nao se misturam com os do editor aberto embaixo. v3a: a enquete da seguinte nao tem data de
// fim (pollCanEndAtDate false): a hora de envio e relativa, entao uma data fixa poderia cair antes dela.
// Ajustes da v3a: no fluxo no ar, a enquete de uma seguinte que ja chegou a alguem chega travada
// (`lockedFields`, de livePollLockedFields em notice-follow-ups).

type FollowUpSheetProps = {
  /** Fim da notificacao de cima na previa ("Até a notificação principal sumir"). */
  anchorExpiresAt: number | null;
  branding: { iconUrl: string; logoUrl: string | null; name: string };
  canEditBrand: boolean;
  content: FlowNoticeContent;
  disabled: boolean;
  /** Erros do conteudo, com as chaves do zod relativas ao conteudo ("title", "cta.href"). */
  errorFor: (key: string) => string | undefined;
  /** Prefixo unico dos ids dos campos (o editor ja usa "aviso-..."). */
  idPrefix: string;
  level: FollowUpLevel;
  /** No relatorio da notificacao enviada: as mudancas valem com "Aplicar alterações" (nao ha rascunho). */
  live?: boolean;
  /** O que nao muda mais nesta seguinte, com o motivo (a enquete, quando ja chegou a alguem no fluxo no ar). */
  lockedFields?: NoticeLockedFields;
  now: number;
  onAudioBusyChange: (reason: string | null) => void;
  onBlurField: (key: string) => void;
  onChange: (patch: Partial<FlowNoticeContent>) => void;
  onImageUploadChange: (preview: string | null) => void;
  onOpenChange: (open: boolean) => void;
  onSendersChange?: (senders: NoticeSenderChoice[]) => void;
  open: boolean;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  senders: readonly NoticeSenderChoice[];
  /** "Notificação seguinte 1". */
  title: string;
};

const DEVICE_OPTIONS = [
  { label: "Computador", value: "desktop" },
  { label: "Celular", value: "mobile" }
] as const satisfies readonly { label: string; value: PreviewDevice }[];

export function FollowUpSheet({
  anchorExpiresAt,
  branding,
  canEditBrand,
  content,
  disabled,
  errorFor,
  idPrefix,
  level,
  live = false,
  lockedFields,
  now,
  onAudioBusyChange,
  onBlurField,
  onChange,
  onImageUploadChange,
  onOpenChange,
  onSendersChange,
  open,
  products,
  productsLoaded,
  senders,
  title
}: FollowUpSheetProps) {
  const [device, setDevice] = useState<PreviewDevice>("mobile");
  const [imageUpload, setImageUpload] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState<string | null>(null);

  return (
    <AdminSheet
      description="O aluno recebe como uma notificação comum, com quem envia, ícone, texto e tempo no sino próprios."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-xs leading-5 text-[var(--text-secondary)]">
            {audioBusy ?? (imageUpload ? "Enviando a imagem…" : live ? FOLLOW_UPS_COPY.sheetLiveNote : FOLLOW_UPS_COPY.sheetDraftNote)}
          </p>
          <Button className="px-4" disabled={audioBusy !== null || imageUpload !== null} onClick={() => onOpenChange(false)} type="button">
            {FOLLOW_UPS_COPY.done}
          </Button>
        </div>
      }
      onBeforeClose={() => audioBusy === null && imageUpload === null}
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title={title}
    >
      <form className="flex min-w-0 flex-col gap-6" noValidate onSubmit={(event) => event.preventDefault()}>
        <NoticeContentFields
          canEditBrand={canEditBrand}
          disabled={disabled}
          errorFor={errorFor}
          idPrefix={idPrefix}
          kind="inbox"
          layout="plain"
          lockedFields={lockedFields}
          onAudioBusyChange={(reason) => {
            setAudioBusy(reason);
            onAudioBusyChange(reason);
          }}
          onBlurField={onBlurField}
          onChange={onChange}
          onImageUploadChange={(preview) => {
            setImageUpload(preview);
            onImageUploadChange(preview);
          }}
          onSendersChange={onSendersChange}
          // v3a: a seguinte sai numa hora relativa; a enquete dela so encerra quando sai do sino (docs/24 T13).
          pollCanEndAtDate={false}
          products={products}
          productsLoaded={productsLoaded}
          schoolIconUrl={branding.iconUrl}
          schoolName={branding.name}
          sendAt={now}
          senders={senders}
          showValidity
          validityAnchor={{ label: followUpValidityAnchorLabel(level) }}
          value={content}
        />

        <AdminSheetSection title="Prévia">
          <PillGroup ariaLabel="Aparelho da prévia da notificação seguinte" name={`${idPrefix}-previa-aparelho`} onChange={setDevice} options={DEVICE_OPTIONS} value={device} />
          <NoticePreview
            anchorExpiresAt={anchorExpiresAt}
            branding={branding}
            device={device}
            draft={{ ...content, kind: "inbox" }}
            imageUrl={imageUpload}
            now={now}
            senders={senders}
          />
        </AdminSheetSection>
      </form>
    </AdminSheet>
  );
}
