"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NOTICE_LIMITS } from "@/server/communications/campaign-model";
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

// Botao do aviso (docs/22 §2.2): texto, para onde leva (um produto, uma pagina da area ou um link
// externo) e em que aba abre. Mesma logica do botao do Destaque (member-area/home-hero/cta-field.tsx)
// e os mesmos links aceitos (home-hero-links.ts, conferidos de novo pelo servidor e na hora de
// desenhar para o aluno). Desligar guarda o que foi escrito ate sair da tela.

export type NoticeCta = NonNullable<NoticeDraft["cta"]>;

type NoticeCtaFieldProps = {
  disabled: boolean;
  errors: { href?: string; label?: string };
  /** Prefixo dos ids e nomes ("aviso" no editor: "aviso-botao-texto"); unico em cada formulario na tela. */
  idPrefix?: string;
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
const EMPTY_CTA: NoticeCta = { href: "", label: "", target: "same_tab" };

function Note({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "warning" }) {
  return (
    <p className={tone === "warning" ? "text-[13px] leading-5 text-[var(--warning)]" : "text-[13px] leading-5 text-[var(--text-secondary)]"}>
      {children}
    </p>
  );
}

export function NoticeCtaField({ disabled, errors, idPrefix = "aviso", onBlurField, onChange, products, productsLoaded, value }: NoticeCtaFieldProps) {
  const cta = value ?? EMPTY_CTA;
  const id = (suffix: string) => `${idPrefix}-botao-${suffix}`;
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
        description={value ? "O botão aparece embaixo do texto do aviso." : "Sem botão, o aviso só informa."}
        disabled={disabled}
        id={id("mostrar")}
        label="Mostrar um botão"
        onCheckedChange={(checked) => onChange(checked ? { ...lastCta.current } : null)}
      />

      {value ? (
        <>
          <HeroTextField
            disabled={disabled}
            error={errors.label}
            id={id("texto")}
            label="Texto do botão"
            max={NOTICE_LIMITS.ctaLabel}
            onBlur={() => onBlurField("cta.label")}
            onChange={(label) => update({ label })}
            placeholder="Ex.: Assistir agora"
            value={cta.label}
          />

          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Para onde leva</span>
            <PillGroup ariaLabel="Para onde o botão leva" disabled={disabled} name={id("destino")} onChange={changeMode} options={MODE_OPTIONS} value={mode} />
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
