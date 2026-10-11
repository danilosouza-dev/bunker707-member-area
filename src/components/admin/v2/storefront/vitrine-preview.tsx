"use client";

import { ExternalLink, Layers } from "lucide-react";
import Image from "next/image";
import type { HomeSectionConfig } from "@/lib/platform-types";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";
import { PRODUCT_ACCENTS } from "@/server/catalog/model";
import { resolveSectionPreview, type StorefrontHero, type StorefrontProduct } from "@/server/storefront/model";
import { getInitials } from "../format";
import { AdminLinkButton } from "../link-button";
import { adminCard, adminTransition } from "../styles";

// Previa simplificada da home do aluno (docs/17 §1.8): banner, depois cada fileira visivel com os
// cards verticais que ela mostra hoje para quem ainda nao comprou nada. Nada inventado: fileiras
// que dependem do aluno dizem isso; sem produto publicado, a fileira diz que esta vazia.

const MAX_CARDS = 6;

type VitrinePreviewProps = {
  hero: StorefrontHero;
  onSelectSection: (sectionId: string) => void;
  products: readonly StorefrontProduct[];
  sections: readonly HomeSectionConfig[];
  selectedSectionId: string | null;
};

function MiniCard({ product }: { product: StorefrontProduct }) {
  return (
    <span
      className="relative block aspect-[9/13] w-11 shrink-0 overflow-hidden rounded-[4px] border border-[var(--border-subtle)]"
      style={product.coverUrl ? undefined : { backgroundColor: PRODUCT_ACCENTS[product.accent] }}
      title={product.title}
    >
      {product.coverUrl ? (
        <Image
          alt=""
          className="object-cover"
          fill
          sizes="44px"
          src={product.coverUrl}
          unoptimized={!canOptimizeImageSrc(product.coverUrl)}
        />
      ) : (
        <span aria-hidden="true" className="grid size-full place-items-center text-[10px] font-semibold text-[var(--surface-0)]">
          {getInitials(product.title)}
        </span>
      )}
    </span>
  );
}

function PreviewNote({ children }: { children: string }) {
  return (
    <p className="rounded-md border border-dashed border-[var(--border-strong)] px-3 py-2.5 text-xs leading-5 text-[var(--text-secondary)]">
      {children}
    </p>
  );
}

function SectionBody({ products, section }: { products: readonly StorefrontProduct[]; section: HomeSectionConfig }) {
  const preview = resolveSectionPreview(section, products);

  if (preview.kind === "per_student") {
    return <PreviewNote>{preview.note}</PreviewNote>;
  }

  if (preview.kind === "structure") {
    if (!preview.product) {
      return <PreviewNote>O produto desta fileira ainda não está publicado: a fileira não aparece.</PreviewNote>;
    }

    const product = preview.product;

    return (
      <span className="flex min-w-0 items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2">
        <MiniCard product={product} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs leading-5 font-medium text-[var(--text-primary)]">{product.title}</span>
          <span className="text-xs leading-5 text-[var(--text-secondary)]">
            {product.modulesCount === 1 ? "1 módulo" : `${product.modulesCount} módulos`} ·{" "}
            {section.layout === "immersive" ? "imersiva" : "compacta"}
          </span>
        </span>
      </span>
    );
  }

  if (preview.kind === "products" && preview.products.length > 0) {
    const extra = preview.products.length - MAX_CARDS;

    return (
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {preview.products.slice(0, MAX_CARDS).map((product) => (
          <MiniCard key={product.id} product={product} />
        ))}
        {extra > 0 ? (
          <span className="grid aspect-[9/13] w-11 shrink-0 place-items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[11px] font-medium text-[var(--text-secondary)] tabular-nums">
            +{extra}
          </span>
        ) : null}
      </span>
    );
  }

  return <PreviewNote>Nenhum produto publicado para mostrar aqui agora: a fileira não aparece.</PreviewNote>;
}

export function VitrinePreview({ hero, onSelectSection, products, sections, selectedSectionId }: VitrinePreviewProps) {
  const visible = sections.filter((section) => section.isActive);
  const hiddenCount = sections.length - visible.length;
  const heroImage = hero.enabled && hero.image && hero.mediaType === "image" ? hero.image : null;

  return (
    <section aria-labelledby="vitrine-preview-title" className={cn(adminCard, "flex min-w-0 flex-col")}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="vitrine-preview-title">
            Prévia
          </h2>
          <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">Para quem ainda não comprou nada.</p>
        </div>
        <AdminLinkButton className="px-3" href="/" rel="noopener" target="_blank" variant="ghost">
          <ExternalLink aria-hidden="true" className="size-4" />
          Área do aluno
        </AdminLinkButton>
      </header>

      <div className="m-4 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-0)]">
        {hero.enabled ? (
          <div className="relative aspect-[16/6] w-full bg-[var(--surface-2)]">
            {heroImage ? (
              <Image alt="" className="object-cover" fill sizes="400px" src={heroImage} unoptimized={!canOptimizeImageSrc(heroImage)} />
            ) : (
              <span className="grid size-full place-items-center text-xs text-[var(--text-secondary)]">Banner em vídeo</span>
            )}
            <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[var(--surface-0)] to-transparent" />
          </div>
        ) : null}

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Layers aria-hidden="true" className="size-5 text-[var(--text-tertiary)]" />
            <p className="text-xs leading-5 text-[var(--text-secondary)]">Nenhuma fileira visível. A home fica só com o banner.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-1 p-2">
            {visible.map((section) => (
              <li key={section.id}>
                <button
                  aria-current={section.id === selectedSectionId ? "true" : undefined}
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-2 rounded-md px-2 py-2 text-left",
                    adminTransition,
                    section.id === selectedSectionId
                      ? "bg-[var(--surface-2)] outline outline-1 outline-[var(--border-strong)]"
                      : "hover:bg-[var(--hover-overlay)]"
                  )}
                  onClick={() => onSelectSection(section.id)}
                  type="button"
                >
                  <span className="truncate text-xs leading-5 font-semibold text-[var(--text-primary)]">{section.title}</span>
                  <SectionBody products={products} section={section} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="px-4 pb-4 text-xs leading-5 text-[var(--text-tertiary)]">
        {hiddenCount > 0 ? `${hiddenCount === 1 ? "1 fileira oculta não aparece" : `${hiddenCount} fileiras ocultas não aparecem`}. ` : ""}
        Quem já comprou vê também os próprios produtos e aulas.
      </p>
    </section>
  );
}
