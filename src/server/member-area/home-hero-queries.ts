import "server-only";

// Leitura da tela Area de membros > Destaque. Sem cache (admin): a tela precisa da versao atual da
// chave `hero` para a checagem de conflito ao publicar. Chamada depois de requirePageAdmin().

import type { ProductPickerItem } from "@/components/admin/v2/storefront/product-picker";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import { listProductOptions } from "@/server/catalog/queries";
import type { ProductOption } from "@/server/catalog/types";
import { normalizeLogo } from "@/server/storefront/model";
import { heroDraftFromStored, type HomeHeroDraft } from "./home-hero-model";
import { readPlatformSettings } from "./settings-store";

export type HomeHeroEditorData = {
  draft: HomeHeroDraft;
  /** Versao da chave `hero` (updated_at); null = nunca gravada (a home usa o padrao). */
  updatedAt: string | null;
  /** Logo da Marca, para o topo da previa. */
  logoImage: string | null;
  /** Produtos para "Para onde leva > Um produto". */
  products: ProductPickerItem[];
  /** false: a lista de produtos nao carregou agora (o resto da tela funciona). */
  productsLoaded: boolean;
};

function toPickerItem(product: ProductOption): ProductPickerItem {
  return {
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: PRODUCT_FORMAT_LABELS[product.format],
    flags: product.situation === "published" ? [] : [{ label: PRODUCT_SITUATION_LABELS[product.situation], tone: "muted" }],
    id: product.id,
    title: product.title
  };
}

async function loadProducts() {
  try {
    return { items: (await listProductOptions()).map(toPickerItem), loaded: true };
  } catch (error) {
    console.error("[admin/area-de-membros/destaque] produtos", error);
    return { items: [], loaded: false };
  }
}

export async function getHomeHeroEditorData(): Promise<HomeHeroEditorData> {
  const [settings, products] = await Promise.all([readPlatformSettings(["hero", "branding"]), loadProducts()]);

  return {
    draft: heroDraftFromStored(settings.hero.exists ? settings.hero.value : undefined),
    logoImage: normalizeLogo(settings.branding.value, settings.branding.exists),
    products: products.items,
    productsLoaded: products.loaded,
    updatedAt: settings.hero.updatedAt
  };
}
