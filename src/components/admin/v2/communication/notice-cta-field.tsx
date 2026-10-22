"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NOTICE_LIMITS, type CampaignKind } from "@/server/communications/campaign-model";
import type { CtaDisplay } from "@/server/communications/notification-model";
import type { NoticeDraft } from "@/server/communications/schemas";
import {
  HOME_PAGE_LINKS,
  defaultCtaTarget,
  describeCtaDestination,
  homePageLabel,
  productHref,
  productIdFromHref,
  type HeroCtaDestinationMode,
  type HeroCtaTarget
} from "@/server/member-area/home-hero-links";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../form";
import { HeroTextField } from "../member-area/home-hero/fields";
import { AdminSwitch } from "../settings/kit";
import { ProductPicker, type ProductPickerItem } from "../storefront/product-picker";
import {
  CTA_DISPLAY_OPTIONS,
  CTA_FIELD_COPY,
  ctaDestinationAriaLabel,
  ctaDisplayOf,
  ctaLabelError,
  ctaSwitchDescription,
  ctaTextFieldCopy
} from "./notices-view-model";

// Botao do aviso (docs/22 §2.2): texto, para onde leva (um produto, uma pagina da area ou um link
// externo) e em que aba abre. Mesma logica do botao do Destaque (member-area/home-hero/cta-field.tsx)
// e os mesmos links aceitos (home-hero-links.ts, conferidos de novo pelo servidor e na hora de
// desenhar para o aluno). Desligar guarda o que foi escrito ate sair da tela.
//
// v3a (docs/24 §2.5): a chave vira "Levar o aluno a algum lugar" e, na notificacao, o primeiro campo e
// "Como o aluno chega lá" (pelo botao; pelo botao ou tocando na notificacao; so tocando, sem botao). No
// "Só tocando" o texto e o que aparece ao lado da seta no pe da notificacao. O pop-up abre sempre pelo botao.

export type NoticeCta = NonNullable<NoticeDraft["cta"]>;

type NoticeCtaFieldProps = {
  disabled: boolean;
  errors: { display?: string; href?: string; label?: string };
  /** Prefixo dos ids e nomes ("aviso" no editor: "aviso-botao-texto"); unico em cada formulario na tela. */
  idPrefix?: string;
  /** Notificacao escolhe como o aluno chega la; pop-up, so o botao. */
  kind: CampaignKind;
  onBlurField: (field: "cta.href" | "cta.label") => void;
  onChange: (cta: NoticeCta | null) => void;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  value: NoticeCta | null;
};

const MODE_OPTIONS = [
  { label: "Um produto", value: "product" },
  { label: "Página da área", value: "page" },
  { label: "Link externo", value: "external" }
] as const satisfies readonly { label: string; value: HeroCtaDestinationMode }[];

const TARGET_OPTIONS = [
  { label: "Mesma aba", value: "same_tab" },
  { label: "Nova aba", value: "new_tab" }
] as const satisfies readonly { label: string; value: HeroCtaTarget }[];

const MODE_DEFAULT_TARGET: Record<HeroCtaDestinationMode, HeroCtaTarget> = {
  external: "new_tab",
  page: "same_tab",
  product: "same_tab"
};

const EXTERNAL_HINT = "Uma página fora da área do aluno, como a de vendas ou um formulário.";
const EMPTY_CTA: NoticeCta = { display: "button", href: "", label: "", target: "same_tab" };

function Note({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "warning" }) {
  return (
    <p className={tone === "warning" ? "text-[13px] leading-5 text-[var(--warning)]" : "text-[13px] leading-5 text-[var(--text-secondary)]"}>
      {children}
    </p>
  );
}

export function NoticeCtaField({ disabled, errors, idPrefix = "aviso", kind, onBlurField, onChange, products, productsLoaded, value }: NoticeCtaFieldProps) {
  const cta = value ?? EMPTY_CTA;
  const id = (suffix: string) => `${idPrefix}-botao-${suffix}`;
  const display = ctaDisplayOf(kind, cta);
  const text = ctaTextFieldCopy(display);
  const [mode, setMode] = useState<HeroCtaDestinationMode>(() => describeCtaDestination(cta.href).mode);
  // Ultimo endereco escolhido em cada modo (voltar a ele ao trocar) e o botao inteiro ao desligar.
  const remembered = useRef<Partial<Record<HeroCtaDestinationMode, string>>>({ [mode]: cta.href });
  const lastCta = useRef<NoticeCta>(cta);
  const productId = productIdFromHref(cta.href);
  const selected = productId ? (products.find((product) => product.id === productId) ?? null) : null;
  const selectedFlag = selected?.flags?.[0]?.label ?? null;
  const knownPage = HOME_PAGE_LINKS.some((page) => page.href === cta.href);
  const pageOptions = [
    ...HOME_PAGE_LINKS.map((page) => ({ label: page.label, value: page.href as string })),
    ...(mode === "page" && cta.href && !knownPage ? [{ label: homePageLabel(cta.href), value: cta.href }] : [])
  ];

  function update(next: Partial<NoticeCta>) {
    const merged = { ...cta, ...next };
    lastCta.current = merged;
    onChange(merged);
  }

  function setHref(href: string) {
    remembered.current[mode] = href;
    update({ href });
  }

  function changeMode(next: HeroCtaDestinationMode) {
    if (next === mode) {
      return;
    }

    remembered.current[mode] = cta.href;
    setMode(next);
    const href = remembered.current[next] ?? "";
    update({ href, target: href ? defaultCtaTarget(href) : MODE_DEFAULT_TARGET[next] });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <AdminSwitch
        checked={value !== null}
        description={ctaSwitchDescription(kind, value)}
        disabled={disabled}
        id={id("mostrar")}
        label={CTA_FIELD_COPY.switchLabel}
        // O que foi escrito volta ao religar; no pop-up, sempre pelo botao (o modo pode ser de quando era notificacao).
        onCheckedChange={(checked) => onChange(checked ? { ...lastCta.current, ...(kind === "popup" ? { display: "button" as const } : {}) } : null)}
      />

      {value ? (
        <>
          {kind === "inbox" ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{CTA_FIELD_COPY.displayLabel}</span>
              <PillGroup
                ariaLabel={CTA_FIELD_COPY.displayLabel}
                disabled={disabled}
                name={id("modo")}
                onChange={(next: CtaDisplay) => update({ display: next })}
                options={CTA_DISPLAY_OPTIONS}
                value={display}
              />
              {errors.display ? <p className="text-[13px] leading-5 text-[var(--error)]">{errors.display}</p> : null}
            </div>
          ) : null}

          <HeroTextField
            disabled={disabled}
            error={ctaLabelError(display, errors.label)}
            hint={text.hint}
            id={id("texto")}
            label={text.label}
            max={NOTICE_LIMITS.ctaLabel}
            onBlur={() => onBlurField("cta.label")}
            onChange={(label) => update({ label })}
            placeholder={text.placeholder}
            value={cta.label}
          />

          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{CTA_FIELD_COPY.destinationLabel}</span>
            <PillGroup ariaLabel={ctaDestinationAriaLabel(display)} disabled={disabled} name={id("destino")} onChange={changeMode} options={MODE_OPTIONS} value={mode} />
          </div>

          {mode === "product" ? (
            productsLoaded ? (
              <div className="flex min-w-0 flex-col gap-2">
                <AdminField error={errors.href} id={id("produto")} label="Produto">
                  <ProductPicker
                    disabled={disabled}
                    emptyText="Nenhum produto ainda. Crie um em Produtos."
                    error={errors.href}
                    id={id("produto")}
                    items={products}
                    mode="single"
                    onChange={(ids) => setHref(ids[0] ? productHref(ids[0]) : "")}
                    value={productId ? [productId] : []}
                  />
                </AdminField>
                {productId && !selected ? (
                  <Note tone="warning">O produto deste botão não aparece mais na lista (pode ter sido excluído). Escolha outro.</Note>
                ) : null}
                {selected && selectedFlag ? (
                  <Note tone="warning">{`“${selected.title}” está como ${selectedFlag.toLowerCase()}: o aluno só consegue abrir depois de publicado.`}</Note>
                ) : null}
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-1.5">
                <Note tone="warning">Não foi possível carregar a lista de produtos agora. Recarregue a página para escolher um produto.</Note>
                {errors.href ? <p className="text-[13px] leading-5 text-[var(--error)]">{errors.href}</p> : null}
              </div>
            )
          ) : null}

          {mode === "page" ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Página</span>
              <PillGroup ariaLabel="Página da área do aluno" disabled={disabled} name={id("pagina")} onChange={setHref} options={pageOptions} value={cta.href} />
              {errors.href ? <p className="text-[13px] leading-5 text-[var(--error)]">{errors.href}</p> : null}
            </div>
          ) : null}

          {mode === "external" ? (
            <AdminField error={errors.href} hint={EXTERNAL_HINT} id={id("link")} label="Link">
              <Input
                aria-describedby={fieldDescribedBy(id("link"), { error: errors.href, hint: errors.href ? undefined : EXTERNAL_HINT })}
                aria-invalid={errors.href ? true : undefined}
                autoComplete="off"
                className={adminInputClass}
                disabled={disabled}
                id={id("link")}
                inputMode="url"
                onBlur={() => onBlurField("cta.href")}
                onChange={(event) => setHref(event.target.value)}
                placeholder="https://"
                spellCheck={false}
                type="url"
                value={cta.href}
              />
            </AdminField>
          ) : null}

          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Abrir em</span>
            <PillGroup
              ariaLabel="Onde o link abre"
              disabled={disabled}
              name={id("aba")}
              onChange={(target) => update({ target })}
              options={TARGET_OPTIONS}
              value={cta.target}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
