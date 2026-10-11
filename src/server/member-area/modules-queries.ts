import "server-only";

// Leituras da tela Area de membros > Modulos e do interruptor "Fileira na home" da aba Detalhes.
// Colunas explicitas e so os ids da pagina (25 por vez); a lista de produtos vem da RPC
// admin_product_list (migracao 202610110011, sem cursos de dentro de formacao) e as fileiras da
// Vitrine de getStorefrontEditorData (gravadas, ou a ordem padrao quando nunca publicada).

import { catalogDb, failOnError, fetchSettingsFor } from "@/server/catalog/store";
import { coverUrlOf, type ProductListRpcRow } from "@/server/catalog/mappers";
import {
  PRODUCT_FORMAT_LABELS,
  formatFromKind,
  resolveProductAccent,
  situationFromPublicationStatus,
  type ProductAccent,
  type ProductSituation
} from "@/server/catalog/model";
import { getStorefrontEditorData } from "@/server/storefront/queries";
import {
  MODULE_SETTINGS_KINDS,
  MODULE_SETTINGS_PAGE_SIZE,
  computeHomeModuleRowState,
  countOwnModuleCovers,
  type CoursePresentationModeValue,
  type HomeModuleRowState,
  type ModuleSettingsQuery
} from "./modules-model";

export type ModuleSettingsRow = {
  accent: ProductAccent;
  /** /admin/produtos/{id} (aba Conteúdo, onde cada modulo troca de capa). */
  contentHref: string;
  coverUrl: string | null;
  formatLabel: string;
  homeRow: HomeModuleRowState;
  modulesCount: number;
  modulesWithOwnCover: number;
  opensAs: CoursePresentationModeValue;
  productId: string;
  situation: ProductSituation;
  title: string;
};

export type ModuleSettingsPage = {
  items: ModuleSettingsRow[];
  page: number;
  pageSize: typeof MODULE_SETTINGS_PAGE_SIZE;
  q?: string;
  total: number;
  /** Total sem a busca: distingue "nenhum curso ainda" de "nenhum curso com esse nome". */
  totalUnfiltered: number;
};

type ModuleImageRow = { image: string | null; owner_id: string | null };

async function callProductList(args: { limit: number; offset: number; search: string | null }) {
  const { data, error } = await catalogDb().rpc("admin_product_list", {
    p_kinds: [...MODULE_SETTINGS_KINDS],
    p_limit: args.limit,
    p_offset: args.offset,
    p_search: args.search,
    p_status: null
  });
  failOnError(error, "Lista de cursos");

  return (data ?? []) as ProductListRpcRow[];
}

async function readModuleImages(productIds: readonly string[]) {
  const byOwner = new Map<string, ModuleImageRow[]>();

  if (productIds.length === 0) {
    return byOwner;
  }

  const { data, error } = await catalogDb()
    .from("course_modules")
    .select("owner_id,image")
    .in("owner_id", [...productIds])
    .neq("status", "deleted");
  failOnError(error, "Módulos dos cursos");

  for (const row of (data ?? []) as ModuleImageRow[]) {
    if (row.owner_id) {
      byOwner.set(row.owner_id, [...(byOwner.get(row.owner_id) ?? []), row]);
    }
  }

  return byOwner;
}

function opensAsOf(settings: Record<string, unknown> | undefined): CoursePresentationModeValue {
  return settings?.coursePresentationMode === "lesson_playlist" ? "lesson_playlist" : "module_cards";
}

/** Uma pagina (25) de cursos com como abrem, a fileira na home e as capas dos modulos. */
export async function listModuleSettings(query: ModuleSettingsQuery): Promise<ModuleSettingsPage> {
  const page = Math.max(1, query.page);
  const search = query.q?.trim() || null;
  const rows = await callProductList({ limit: MODULE_SETTINGS_PAGE_SIZE, offset: (page - 1) * MODULE_SETTINGS_PAGE_SIZE, search });
  let total = Number(rows[0]?.total_count ?? 0);

  if (rows.length === 0 && page > 1) {
    // Pagina alem do fim: o total vem da primeira pagina com a mesma busca.
    total = Number((await callProductList({ limit: 1, offset: 0, search }))[0]?.total_count ?? 0);
  }

  const totalUnfiltered = search && total === 0
    ? Number((await callProductList({ limit: 1, offset: 0, search: null }))[0]?.total_count ?? 0)
    : total;
  const products = rows.filter((row) => formatFromKind(row.kind) && formatFromKind(row.kind) !== "formacao");
  const ids = products.map((row) => row.id);
  const [settings, modules, storefront] = await Promise.all([
    fetchSettingsFor(ids),
    readModuleImages(ids),
    ids.length > 0 ? getStorefrontEditorData() : Promise.resolve(null)
  ]);
  const storefrontById = new Map((storefront?.products ?? []).map((product) => [product.id, product]));

  return {
    items: products.map((row): ModuleSettingsRow => {
      const format = formatFromKind(row.kind);
      const productModules = modules.get(row.id) ?? [];

      return {
        accent: resolveProductAccent(row.id, row.accent),
        contentHref: `/admin/produtos/${encodeURIComponent(row.id)}`,
        coverUrl: coverUrlOf(row.image),
        formatLabel: format ? PRODUCT_FORMAT_LABELS[format] : row.kind,
        homeRow: computeHomeModuleRowState(storefrontById.get(row.id), storefront?.sections ?? [], storefront?.sectionsConfigured ?? false),
        modulesCount: productModules.length,
        modulesWithOwnCover: countOwnModuleCovers(productModules, row.image),
        opensAs: opensAsOf(settings.get(row.id)),
        productId: row.id,
        situation: situationFromPublicationStatus(row.publication_status),
        title: row.title
      };
    }),
    page,
    pageSize: MODULE_SETTINGS_PAGE_SIZE,
    ...(search ? { q: search } : {}),
    total,
    totalUnfiltered
  };
}

/** Estado da fileira de modulos de um produto (aba Detalhes). Produto fora da vitrine = indisponivel. */
export async function getHomeModuleRowState(productId: string): Promise<HomeModuleRowState> {
  const storefront = await getStorefrontEditorData();

  return computeHomeModuleRowState(
    storefront.products.find((product) => product.id === productId),
    storefront.sections,
    storefront.sectionsConfigured
  );
}
