"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  HERO_TEXT_LIMITS,
  HOME_PAGE_LINKS,
  defaultCtaTarget,
  describeCtaDestination,
  homePageLabel,
  productHref,
  productIdFromHref,
  type HeroCtaDestinationMode,
  type HeroCtaTarget,
  type HomeHeroDraft
} from "@/server/member-area/home-hero-model";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../form";
import { AdminSwitch } from "../../settings/kit";
import { ProductPicker, type ProductPickerItem } from "../../storefront/product-picker";
import { HeroTextField } from "./fields";

// Botao do destaque: texto, para onde leva (um produto, uma pagina da area ou um link externo) e em
// que aba abre. O modo e deduzido do endereco gravado ao abrir a tela; trocar de modo lembra o que
// estava escolhido no outro, ate publicar ou descartar (o editor remonta este campo nesses casos).

type CtaDraft = Pick<HomeHeroDraft, "ctaHref" | "ctaLabel" | "ctaTarget" | "showCta">;

type CtaFieldProps = {
  disabled: boolean;
  draft: CtaDraft;
  errors: { ctaHref?: string; ctaLabel?: string };
  onBlurField: (field: "ctaHref" | "ctaLabel") => void;
  onChange: (next: Partial<CtaDraft>) => void;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
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

const EXTERNAL_HINT = "Uma página fora da área do aluno, como a de vendas.";

const MODE_DEFAULT_TARGET: Record<HeroCtaDestinationMode, HeroCtaTarget> = {
  external: "new_tab",
  page: "same_tab",
  product: "same_tab"
};

function Note({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "warning" }) {
  return (
    <p className={tone === "warning" ? "text-[13px] leading-5 text-[var(--warning)]" : "text-[13px] leading-5 text-[var(--text-secondary)]"}>
      {children}
    </p>
  );
}

export function CtaField({ disabled, draft, errors, onBlurField, onChange, products, productsLoaded }: CtaFieldProps) {
  const [mode, setMode] = useState<HeroCtaDestinationMode>(() => describeCtaDestination(draft.ctaHref).mode);
  // Ultimo endereco escolhido em cada modo, para voltar a ele ao trocar de modo.
  const remembered = useRef<Partial<Record<HeroCtaDestinationMode, string>>>({ [mode]: draft.ctaHref });
  const productId = productIdFromHref(draft.ctaHref);
  const selected = productId ? products.find((product) => product.id === productId) ?? null : null;
  const selectedFlag = selected?.flags?.[0]?.label ?? null;
  const knownPage = HOME_PAGE_LINKS.some((page) => page.href === draft.ctaHref);
  const pageOptions = [
    ...HOME_PAGE_LINKS.map((page) => ({ label: page.label, value: page.href as string })),
    ...(mode === "page" && draft.ctaHref && !knownPage ? [{ label: homePageLabel(draft.ctaHref), value: draft.ctaHref }] : [])
  ];
  const hrefError = errors.ctaHref;

  function setHref(href: string) {
    remembered.current[mode] = href;
    onChange({ ctaHref: href });
  }

  function changeMode(next: HeroCtaDestinationMode) {
    if (next === mode) {
      return;
    }

    remembered.current[mode] = draft.ctaHref;
    setMode(next);
    const href = remembered.current[next] ?? "";
    onChange({ ctaHref: href, ctaTarget: href ? defaultCtaTarget(href) : MODE_DEFAULT_TARGET[next] });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <AdminSwitch
        checked={draft.showCta}
        description={
          draft.showCta
            ? "O botão aparece embaixo dos textos do destaque."
            : "Desligado, o botão não aparece. O texto e o link ficam guardados."
        }
        disabled={disabled}
        id="destaque-botao-mostrar"
        label="Mostrar botão"
        onCheckedChange={(checked) => onChange({ showCta: checked })}
      />

      <HeroTextField
        disabled={disabled}
        error={errors.ctaLabel}
        id="destaque-botao-texto"
        label="Texto do botão"
        max={HERO_TEXT_LIMITS.ctaLabel}
        onBlur={() => onBlurField("ctaLabel")}
        onChange={(value) => onChange({ ctaLabel: value })}
        placeholder="Ex.: Começar agora"
        value={draft.ctaLabel}
      />

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">
          Para onde leva
        </span>
        <PillGroup
          ariaLabel="Para onde o botão leva"
          disabled={disabled}
          name="destaque-botao-destino"
          onChange={changeMode}
          options={MODE_OPTIONS}
          value={mode}
        />
      </div>

      {mode === "product" ? (
        productsLoaded ? (
          <div className="flex min-w-0 flex-col gap-2">
            <AdminField error={hrefError} id="destaque-botao-produto" label="Produto">
              <ProductPicker
                disabled={disabled}
                emptyText="Nenhum produto ainda. Crie um em Produtos."
                error={hrefError}
                id="destaque-botao-produto"
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
            {hrefError ? <p className="text-[13px] leading-5 text-[var(--error)]">{hrefError}</p> : null}
          </div>
        )
      ) : null}

      {mode === "page" ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Página</span>
          <PillGroup
            ariaLabel="Página da área do aluno"
            disabled={disabled}
            name="destaque-botao-pagina"
            onChange={setHref}
            options={pageOptions}
            value={draft.ctaHref}
          />
          {hrefError ? <p className="text-[13px] leading-5 text-[var(--error)]">{hrefError}</p> : null}
        </div>
      ) : null}

      {mode === "external" ? (
        <AdminField error={hrefError} hint={EXTERNAL_HINT} id="destaque-botao-link" label="Link">
          <Input
            aria-describedby={fieldDescribedBy("destaque-botao-link", { error: hrefError, hint: hrefError ? undefined : EXTERNAL_HINT })}
            aria-invalid={hrefError ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={disabled}
            id="destaque-botao-link"
            inputMode="url"
            onBlur={() => onBlurField("ctaHref")}
            onChange={(event) => setHref(event.target.value)}
            placeholder="https://"
            spellCheck={false}
            type="url"
            value={draft.ctaHref}
          />
        </AdminField>
      ) : null}

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Abrir em</span>
        <PillGroup
          ariaLabel="Onde o link abre"
          disabled={disabled}
          name="destaque-botao-aba"
          onChange={(target) => onChange({ ctaTarget: target })}
          options={TARGET_OPTIONS}
          value={draft.ctaTarget}
        />
      </div>
    </div>
  );
}
