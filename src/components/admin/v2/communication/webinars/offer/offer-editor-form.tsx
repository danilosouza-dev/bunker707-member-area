"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { PRODUCT_ACCENT_ORDER, PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import type { ProductOption } from "@/server/catalog/types";
import { OFFER_LIMITS, type OfferTrigger, type OfferVariantLabel, type WebinarKind, type WebinarOffer } from "@/server/webinars/model";
import { archiveOffer, saveOffer } from "@/server/webinars/offer-actions";
import { ErrorBanner } from "../../../error-banner";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../../form";
import { AdminSwitch, ConfirmDialog } from "../../../settings/kit";
import { ProductPicker, type ProductPickerItem } from "../../../storefront/product-picker";
import { adminToast } from "../../../toast";
import {
  addVariant,
  nextVariantLabel,
  offerDraftOfForm,
  offerFieldErrors,
  offerFormOf,
  removeVariant,
  type OfferForm,
  type OfferVariantForm
} from "./offer-editor-model";

// O formulario do card Oferta do editor (docs/30 §2.2, §8.6 e M7): Situacao (Rascunho / Ligada), o produto que a
// compra libera (o ProductPicker do card Quem pode), o nome interno, Quando aparece (Num minuto do video / Pelo botao
// da equipe / Nunca), Some em (ate o fim ou minutos), o Prazo na tela com a dica do CDC, a Divisao igual (pesos 1), a
// atribuicao em dias (padrao 7) e as variantes A a D (titulo, selo, preco de/por, cupom, link de checkout https e o
// endereco da imagem), com o salvar proprio (saveOffer) e Arquivar. Os erros do zod aparecem junto de cada campo.

const COPY = WEBINAR_COPY.oferta.card;

const STATUS_OPTIONS = [
  { label: COPY.situacoes.draft, value: "draft" as const },
  { label: COPY.situacoes.active, value: "active" as const }
];
const TRIGGER_OPTIONS: { label: string; value: OfferTrigger }[] = [
  { label: COPY.gatilhos.at_offset, value: "at_offset" },
  { label: COPY.gatilhos.manual, value: "manual" },
  { label: COPY.gatilhos.never, value: "never" }
];
const VISIBLE_OPTIONS = [
  { label: COPY.ateOFim, value: "end" as const },
  { label: COPY.someEmMinutos, value: "minutes" as const }
];
const DEADLINE_OPTIONS = [
  { label: COPY.semPrazo, value: "none" as const },
  { label: COPY.comPrazo, value: "minutes" as const }
];

/**
 * Os produtos do seletor no desenho do ProductPicker (o mesmo do card Quem pode). O produto gravado que nao veio na
 * lista (fora dos 200 primeiros, ou a lista nao carregou) entra pelo id, para a escolha nunca sumir da tela.
 */
export function offerPickerItems(products: readonly ProductOption[], selectedId: string | null = null): ProductPickerItem[] {
  const items: ProductPickerItem[] = products.map((product) => ({
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: PRODUCT_FORMAT_LABELS[product.format],
    flags: product.situation === "published" ? [] : [{ label: PRODUCT_SITUATION_LABELS[product.situation], tone: "muted" as const }],
    id: product.id,
    title: product.title
  }));
  if (selectedId && !items.some((item) => item.id === selectedId)) {
    items.unshift({ accent: PRODUCT_ACCENT_ORDER[0], coverUrl: null, detail: "", id: selectedId, title: selectedId });
  }
  return items;
}

function Group({ children, hint, label }: { children: ReactNode; hint?: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{label}</span>
      {children}
      {hint ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{hint}</p> : null}
    </div>
  );
}

function TextInput(props: {
  disabled: boolean;
  error?: string;
  hint?: ReactNode;
  id: string;
  inputMode?: "numeric" | "text" | "url";
  maxLength?: number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "number" | "text" | "url";
  value: string;
}) {
  return (
    <input
      aria-describedby={fieldDescribedBy(props.id, { error: props.error, hint: props.hint })}
      aria-invalid={props.error ? true : undefined}
      className={adminInputClass}
      disabled={props.disabled}
      id={props.id}
      inputMode={props.inputMode}
      maxLength={props.maxLength}
      min={props.type === "number" ? 0 : undefined}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      type={props.type ?? "text"}
      value={props.value}
    />
  );
}

export type OfferEditorFormProps = {
  canWrite: boolean;
  disabled: boolean;
  kind: WebinarKind;
  offer: WebinarOffer | null;
  products: readonly ProductOption[];
  productsLoaded: boolean;
  webinarId: string;
};

export function OfferEditorForm({ canWrite, disabled, kind, offer, products, productsLoaded, webinarId }: OfferEditorFormProps) {
  const [current, setCurrent] = useState<WebinarOffer | null>(offer);
  const [form, setForm] = useState<OfferForm>(() => offerFormOf(offer));
  const [started, setStarted] = useState(offer !== null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const locked = disabled || !canWrite || saving || archiving;
  const pickerItems = offerPickerItems(products, form.productId);

  const patch = (next: Partial<OfferForm>) => setForm((value) => ({ ...value, ...next }));
  const patchVariant = (label: OfferVariantLabel, next: Partial<OfferVariantForm>) =>
    setForm((value) => ({ ...value, variants: value.variants.map((variant) => (variant.label === label ? { ...variant, ...next } : variant)) }));

  async function save() {
    setSaving(true);
    setFailure(null);
    setErrors({});
    const result = await saveOffer({ draft: offerDraftOfForm(form), webinarId });
    setSaving(false);
    if (!result.ok) {
      setFailure(result.error || COPY.erro);
      setErrors(offerFieldErrors(result.fieldErrors));
      return;
    }
    setCurrent(result.data);
    setForm(offerFormOf(result.data));
    adminToast.success(COPY.salva);
  }

  async function archive() {
    if (!current) {
      return;
    }
    setArchiving(true);
    setFailure(null);
    const result = await archiveOffer({ offerId: current.id, webinarId });
    setArchiving(false);
    setConfirmArchive(false);
    if (!result.ok) {
      setFailure(result.error || COPY.erro);
      return;
    }
    setCurrent(null);
    setForm(offerFormOf(null));
    setStarted(false);
    adminToast.success(COPY.arquivada);
  }

  const variantError = (index: number, field: string) => errors[`variants.${index}.${field}`];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-offer-card="">
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{kind === "live" ? COPY.soReplayNaLiveAoVivo : COPY.soLiveGravada}</p>
      {!canWrite ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.somenteLeitura}</p> : null}
      {failure ? <ErrorBanner>{failure}</ErrorBanner> : null}

      {!started ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--border-strong)] px-4 py-3">
          <p className="text-sm leading-5 text-[var(--text-secondary)]">{COPY.semOferta}</p>
          {canWrite ? (
            <Button disabled={locked} onClick={() => setStarted(true)} type="button" variant="secondary">
              <Plus aria-hidden="true" />
              {COPY.montarOferta}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <Group hint={COPY.situacaoDica} label={COPY.situacao}>
            <PillGroup ariaLabel={COPY.situacao} disabled={locked} name={`offer-status-${webinarId}`} onChange={(status) => patch({ status })} options={STATUS_OPTIONS} value={form.status} />
          </Group>

          <AdminField error={errors.productId} hint={COPY.produtoDica} id="offer-productId" label={COPY.produto}>
            <ProductPicker
              disabled={locked}
              emptyText={productsLoaded ? undefined : COPY.produtoNaoCarregou}
              error={errors.productId}
              id="offer-productId"
              items={pickerItems}
              mode="single"
              onChange={(ids) => patch({ productId: ids[0] ?? null })}
              value={form.productId ? [form.productId] : []}
            />
          </AdminField>

          <AdminField error={errors.title} id="offer-title" label={COPY.tituloInterno} optional>
            <TextInput disabled={locked} error={errors.title} id="offer-title" maxLength={OFFER_LIMITS.title} onChange={(title) => patch({ title })} value={form.title} />
          </AdminField>

          <Group hint={COPY.gatilhosDica[form.triggerKind]} label={COPY.quandoAparece}>
            <PillGroup ariaLabel={COPY.quandoAparece} disabled={locked} name={`offer-trigger-${webinarId}`} onChange={(triggerKind) => patch({ triggerKind })} options={TRIGGER_OPTIONS} value={form.triggerKind} />
          </Group>

          {form.triggerKind === "at_offset" ? (
            <AdminField error={errors.showAtOffsetMs} hint={COPY.minutoDoVideoDica} id="offer-showAt" label={COPY.minutoDoVideo}>
              <TextInput
                disabled={locked}
                error={errors.showAtOffsetMs}
                hint={COPY.minutoDoVideoDica}
                id="offer-showAt"
                inputMode="numeric"
                onChange={(showAtMinutes) => patch({ showAtMinutes })}
                type="number"
                value={form.showAtMinutes}
              />
            </AdminField>
          ) : null}

          {form.triggerKind !== "never" ? (
            <>
              <Group label={COPY.someEm}>
                <PillGroup ariaLabel={COPY.someEm} disabled={locked} name={`offer-visible-${webinarId}`} onChange={(visible) => patch({ visible })} options={VISIBLE_OPTIONS} value={form.visible} />
              </Group>
              {form.visible === "minutes" ? (
                <AdminField error={errors.visibleMinutes} id="offer-visibleMinutes" label={COPY.someEmQuantos}>
                  <TextInput disabled={locked} error={errors.visibleMinutes} id="offer-visibleMinutes" inputMode="numeric" onChange={(visibleMinutes) => patch({ visibleMinutes })} type="number" value={form.visibleMinutes} />
                </AdminField>
              ) : null}

              <Group hint={`${COPY.prazoDica} ${COPY.prazoReplay}`} label={COPY.prazo}>
                <PillGroup ariaLabel={COPY.prazo} disabled={locked} name={`offer-deadline-${webinarId}`} onChange={(deadline) => patch({ deadline })} options={DEADLINE_OPTIONS} value={form.deadline} />
              </Group>
              {form.deadline === "minutes" ? (
                <AdminField error={errors.deadlineMinutes} id="offer-deadlineMinutes" label={COPY.prazoMinutos}>
                  <TextInput disabled={locked} error={errors.deadlineMinutes} id="offer-deadlineMinutes" inputMode="numeric" onChange={(deadlineMinutes) => patch({ deadlineMinutes })} type="number" value={form.deadlineMinutes} />
                </AdminField>
              ) : null}
            </>
          ) : null}

          <Group hint={COPY.divisaoDica} label={COPY.divisao}>
            <p className="text-sm leading-6 text-[var(--text-primary)]">{COPY.divisaoIgual}</p>
          </Group>

          <AdminField error={errors.attributionDays} hint={COPY.atribuicaoDica} id="offer-attributionDays" label={COPY.atribuicao}>
            <div className="flex max-w-[12rem] items-center gap-2">
              <TextInput
                disabled={locked}
                error={errors.attributionDays}
                hint={COPY.atribuicaoDica}
                id="offer-attributionDays"
                inputMode="numeric"
                onChange={(attributionDays) => patch({ attributionDays })}
                type="number"
                value={form.attributionDays}
              />
              <span className="shrink-0 text-sm text-[var(--text-secondary)]">{COPY.diasRotulo(Number(form.attributionDays) || 0)}</span>
            </div>
          </AdminField>

          <fieldset className="flex min-w-0 flex-col gap-3" data-offer-variants="">
            <legend className="mb-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">{COPY.variantes}</legend>
            {errors.variants ? <p className="text-[13px] leading-5 text-[var(--error)]">{errors.variants}</p> : null}
            {form.variants.map((variant, index) => (
              <div
                className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-3", !variant.enabled && "opacity-80")}
                data-offer-variant-form={variant.label}
                key={variant.label}
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{COPY.variante(variant.label)}</h3>
                  <div className="flex items-start gap-1">
                    <AdminSwitch
                      checked={variant.enabled}
                      description={COPY.ligadaDica}
                      disabled={locked}
                      id={`offer-variant-${variant.label}-enabled`}
                      label={variant.enabled ? COPY.ligada : COPY.desligada}
                      onCheckedChange={(enabled) => patchVariant(variant.label, { enabled })}
                    />
                    {form.variants.length > 1 ? (
                      <Button
                        aria-label={`${COPY.removerVariante} ${variant.label}`}
                        className="size-11 text-[var(--text-secondary)]"
                        disabled={locked}
                        onClick={() => setForm((value) => removeVariant(value, variant.label))}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <AdminField error={variantError(index, "headline")} id={`offer-variant-${variant.label}-headline`} label={COPY.tituloVariante}>
                  <TextInput
                    disabled={locked}
                    error={variantError(index, "headline")}
                    id={`offer-variant-${variant.label}-headline`}
                    maxLength={OFFER_LIMITS.headline}
                    onChange={(headline) => patchVariant(variant.label, { headline })}
                    value={variant.headline}
                  />
                </AdminField>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <AdminField error={variantError(index, "badge")} id={`offer-variant-${variant.label}-badge`} label={COPY.selo} optional>
                    <TextInput
                      disabled={locked}
                      error={variantError(index, "badge")}
                      id={`offer-variant-${variant.label}-badge`}
                      maxLength={OFFER_LIMITS.badge}
                      onChange={(badge) => patchVariant(variant.label, { badge })}
                      placeholder={COPY.seloExemplo}
                      value={variant.badge}
                    />
                  </AdminField>
                  <AdminField error={variantError(index, "coupon")} id={`offer-variant-${variant.label}-coupon`} label={COPY.cupom} optional>
                    <TextInput
                      disabled={locked}
                      error={variantError(index, "coupon")}
                      id={`offer-variant-${variant.label}-coupon`}
                      maxLength={OFFER_LIMITS.coupon}
                      onChange={(coupon) => patchVariant(variant.label, { coupon })}
                      value={variant.coupon}
                    />
                  </AdminField>
                  <AdminField error={variantError(index, "priceFromLabel")} id={`offer-variant-${variant.label}-priceFrom`} label={COPY.precoDe} optional>
                    <TextInput
                      disabled={locked}
                      error={variantError(index, "priceFromLabel")}
                      id={`offer-variant-${variant.label}-priceFrom`}
                      maxLength={OFFER_LIMITS.priceLabel}
                      onChange={(priceFromLabel) => patchVariant(variant.label, { priceFromLabel })}
                      placeholder={COPY.precoExemplo}
                      value={variant.priceFromLabel}
                    />
                  </AdminField>
                  <AdminField error={variantError(index, "priceLabel")} id={`offer-variant-${variant.label}-price`} label={COPY.precoPor} optional>
                    <TextInput
                      disabled={locked}
                      error={variantError(index, "priceLabel")}
                      id={`offer-variant-${variant.label}-price`}
                      maxLength={OFFER_LIMITS.priceLabel}
                      onChange={(priceLabel) => patchVariant(variant.label, { priceLabel })}
                      value={variant.priceLabel}
                    />
                  </AdminField>
                </div>
                <AdminField error={variantError(index, "checkoutUrl")} hint={COPY.linkCheckoutDica} id={`offer-variant-${variant.label}-checkout`} label={COPY.linkCheckout}>
                  <TextInput
                    disabled={locked}
                    error={variantError(index, "checkoutUrl")}
                    hint={COPY.linkCheckoutDica}
                    id={`offer-variant-${variant.label}-checkout`}
                    inputMode="url"
                    maxLength={OFFER_LIMITS.url}
                    onChange={(checkoutUrl) => patchVariant(variant.label, { checkoutUrl })}
                    placeholder="https://"
                    type="url"
                    value={variant.checkoutUrl}
                  />
                </AdminField>
                <AdminField error={variantError(index, "imageUrl")} hint={COPY.imagemDica} id={`offer-variant-${variant.label}-image`} label={COPY.imagem} optional>
                  <TextInput
                    disabled={locked}
                    error={variantError(index, "imageUrl")}
                    hint={COPY.imagemDica}
                    id={`offer-variant-${variant.label}-image`}
                    inputMode="url"
                    maxLength={OFFER_LIMITS.url}
                    onChange={(imageUrl) => patchVariant(variant.label, { imageUrl })}
                    placeholder="https://"
                    type="url"
                    value={variant.imageUrl}
                  />
                </AdminField>
              </div>
            ))}
            {nextVariantLabel(form.variants) ? (
              <Button className="w-fit" disabled={locked} onClick={() => setForm((value) => addVariant(value))} type="button" variant="secondary">
                <Plus aria-hidden="true" />
                {COPY.adicionarVariante}
              </Button>
            ) : null}
          </fieldset>

          {canWrite ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button disabled={locked} onClick={() => void save()} type="button">
                {saving ? COPY.salvando : COPY.salvar}
              </Button>
              {current ? (
                <Button className="text-[var(--text-secondary)]" disabled={locked} onClick={() => setConfirmArchive(true)} type="button" variant="ghost">
                  {COPY.arquivar}
                </Button>
              ) : null}
            </div>
          ) : null}
          <ConfirmDialog
            busy={archiving}
            cancelLabel={COPY.cancelar}
            confirmLabel={COPY.arquivar}
            description={COPY.arquivarConfirmar}
            destructive
            onConfirm={() => void archive()}
            onOpenChange={setConfirmArchive}
            open={confirmArchive}
            title={COPY.arquivar}
          />
        </>
      )}
    </div>
  );
}
