import "server-only";

// Carregador enxuto da Area de membros (docs/17 §1.8 e plano da fase 1, frente E). Le so o que a
// Vitrine e a Marca mostram, com colunas explicitas; nunca o painel inteiro (getAdminDashboardData).
// O mapeamento e puro e testado em tests/admin-storefront.test.mjs (model.ts).

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import {
  mapStorefrontBrand,
  mapStorefrontEditorData,
  type PlatformSettingRow,
  type StorefrontBrand,
  type StorefrontContentRow,
  type StorefrontEditorData,
  type StorefrontModuleRow,
  type StorefrontSettingsRow
} from "./model";

type DbError = { code?: string; message: string } | null;

const STOREFRONT_SETTING_KEYS = ["homeSections", "hero", "branding"] as const;
const BRAND_SETTING_KEYS = ["hero", "branding"] as const;
/** Produtos que podem aparecer na home: a venda (formacao, bootcamp, curso) e os "em breve". */
const STOREFRONT_BUCKETS = ["formations", "bootcamps", "courses", "upcoming_products"] as const;
const CONTENT_COLUMNS = "id,title,kind,bucket,commerce_scope,image,publication_status,sort_order";
/** Postgres: coluna inexistente (banco ainda sem a migracao de content_items.listing). */
const UNDEFINED_COLUMN = "42703";

function failOnError(error: DbError, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

/** Le tambem updated_at: e a versao que a Vitrine manda de volta ao publicar (409 se mudou no meio). */
async function readPlatformSettings(keys: readonly string[]): Promise<PlatformSettingRow[]> {
  const { data, error } = await getSupabaseAdminClient().from("platform_settings").select("key,value,updated_at").in("key", [...keys]);
  failOnError(error, "Configurações da área de membros");

  return (data ?? []) as PlatformSettingRow[];
}

async function readStorefrontContent(): Promise<StorefrontContentRow[]> {
  const db = getSupabaseAdminClient();
  const withListing = await db
    .from("content_items")
    .select(`${CONTENT_COLUMNS},listing`)
    .in("bucket", [...STOREFRONT_BUCKETS])
    .order("sort_order", { ascending: true });

  if (withListing.error?.code === UNDEFINED_COLUMN) {
    // Antes da migracao 202610110010 nao ha "Oculto por enquanto": tudo e listado.
    const legacy = await db
      .from("content_items")
      .select(CONTENT_COLUMNS)
      .in("bucket", [...STOREFRONT_BUCKETS])
      .order("sort_order", { ascending: true });
    failOnError(legacy.error, "Produtos da vitrine");

    return (legacy.data ?? []) as StorefrontContentRow[];
  }

  failOnError(withListing.error, "Produtos da vitrine");

  return (withListing.data ?? []) as StorefrontContentRow[];
}

async function readProductSettings(productIds: readonly string[]): Promise<StorefrontSettingsRow[]> {
  if (productIds.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("content_page_settings")
    .select("content_id,accent:settings->>accent,home_module_section:settings->homeModuleSection")
    .in("content_id", [...productIds]);
  failOnError(error, "Cores e destaques dos produtos");

  return (data ?? []) as StorefrontSettingsRow[];
}

async function readModuleOwners(productIds: readonly string[]): Promise<StorefrontModuleRow[]> {
  if (productIds.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("course_modules")
    .select("owner_id")
    .in("owner_id", [...productIds])
    .neq("status", "deleted");
  failOnError(error, "Módulos dos produtos");

  return (data ?? []) as StorefrontModuleRow[];
}

/**
 * Vitrine: fileiras gravadas (ou a ordem padrao) com a versao, banner, logo e os produtos que podem
 * aparecer. Tambem e a leitura da tela Modulos e de setHomeModuleRow (src/server/member-area).
 */
export async function getStorefrontEditorData(): Promise<StorefrontEditorData> {
  const [platformRows, contentRows] = await Promise.all([readPlatformSettings(STOREFRONT_SETTING_KEYS), readStorefrontContent()]);
  const productIds = contentRows.map((row) => row.id);
  const [settingsRows, moduleRows] = await Promise.all([readProductSettings(productIds), readModuleOwners(productIds)]);

  return mapStorefrontEditorData({ contentRows, moduleRows, platformRows, settingsRows });
}

/** Marca: banner da home, logo, icone da escola (branding.schoolIcon, o simbolo padrao quando ausente) e estilo. */
export async function getStorefrontBrand(): Promise<StorefrontBrand> {
  return mapStorefrontBrand(await readPlatformSettings(BRAND_SETTING_KEYS));
}
