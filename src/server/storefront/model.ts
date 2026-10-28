// Area de membros (docs/17 §1.8): Vitrine (as fileiras da home do aluno) e Marca (banner, logo, icone da
// escola e estilo).
// Modulo puro, sem "server-only", sem React e so com imports de tipo por alias: o carregador
// (queries.ts) usa para mapear as linhas do banco, os editores usam para validar e mover fileiras,
// e tests/admin-storefront.test.mjs carrega direto pelo Node.
//
// O formato gravado continua o de hoje (platform_settings: homeSections, hero, branding), salvo
// pelas rotas PUT /api/admin/home-sections e PUT /api/admin/appearance. As regras abaixo espelham
// as do servidor (validateHomeSectionConfigs e getDefaultHomeSectionConfigs em platform-store.ts)
// para o erro aparecer antes de publicar; o servidor continua sendo quem decide. A limpeza de produto
// que saiu de venda (pruneHomeSectionRefs) e a mesma nos dois lados: o servidor importa daqui.

import { isSameMemberStyle, normalizeMemberStyle, type MemberStyleConfig } from "../../lib/member-style";
import { isDefaultSchoolIcon, normalizeSchoolIcon } from "../communications/message-meta";
import type { AccessPreviewMode } from "@/lib/access-preview";
import type {
  ContentKind,
  HomeSectionConfig,
  HomeSectionContentSource,
  HomeSectionLayout,
  RowVisibility
} from "@/lib/platform-types";
import {
  PRODUCT_FORMAT_LABELS,
  formatFromKind,
  isListedInStorefront,
  resolveProductAccent,
  situationFromPublicationStatus,
  type ProductAccent,
  type ProductSituation
} from "../catalog/model";

/* ------------------------------------------------------------------------------------------------
 * Linhas lidas do banco (colunas explicitas, ver queries.ts)
 * ---------------------------------------------------------------------------------------------- */

export type StorefrontContentRow = {
  bucket: string;
  commerce_scope: string | null;
  id: string;
  image: string | null;
  kind: string;
  /** Coluna nova (migracao 202610110010); ausente antes da migracao = listado. */
  listing?: string | null;
  publication_status: string | null;
  sort_order: number | null;
  title: string;
};

export type StorefrontSettingsRow = {
  accent?: unknown;
  content_id: string;
  /** settings->homeModuleSection (fileira de modulos padrao quando a vitrine nunca foi publicada). */
  home_module_section?: unknown;
};

export type StorefrontModuleRow = { owner_id: string | null };

/** Linha de platform_settings; `updated_at` e a versao da chave (checagem de "mudou em outra tela"). */
export type PlatformSettingRow = { key: string; updated_at?: string | null; value: unknown };

/* ------------------------------------------------------------------------------------------------
 * O que as telas recebem
 * ---------------------------------------------------------------------------------------------- */

export type StorefrontProduct = {
  accent: ProductAccent;
  coverUrl: string | null;
  formatLabel: string;
  id: string;
  kind: string;
  /** false = "Oculto por enquanto": fora da vitrine, so aparece para quem tem acesso. */
  listed: boolean;
  modulesCount: number;
  /** Produto a venda (formacao, bootcamp ou curso avulso): entra em escolha manual e fileira de modulos. */
  sellable: boolean;
  situation: ProductSituation;
  title: string;
  /** Produto marcado como lancamento futuro (fileira "Em breve"). */
  upcoming: boolean;
};

export type StorefrontHero = { enabled: boolean; image: string; mediaType: "image" | "video" };

export type StorefrontEditorData = {
  hero: StorefrontHero;
  logoImage: string | null;
  products: StorefrontProduct[];
  sections: HomeSectionConfig[];
  /** false: a vitrine nunca foi publicada e o aluno ve a ordem padrao. */
  sectionsConfigured: boolean;
  /**
   * Versao (updated_at) da chave homeSections quando a vitrine foi lida; null = nunca publicada.
   * Publicar manda de volta: se a tela Modulos mudou as fileiras no meio, 409.
   */
  sectionsUpdatedAt: string | null;
};

export type StorefrontBrand = {
  hero: StorefrontHero;
  logoImage: string | null;
  /** Icone da escola (circulo das notificacoes da escola); sempre um endereco, o simbolo padrao quando ausente. */
  schoolIcon: string;
  style: MemberStyleConfig;
};

export const DEFAULT_HERO_IMAGE = "/hero/bunker-707-red-front-hero.png";
export const DEFAULT_LOGO_IMAGE = "/brand/logo-bunker.svg";

const SELLABLE_BUCKETS = new Set(["formations", "bootcamps", "courses"]);
const UPCOMING_BUCKET = "upcoming_products";
/** Mesmos formatos que aceitam a fileira de modulos na ordem padrao (supportsCoursePresentationMode). */
const STRUCTURE_DEFAULT_KINDS = new Set(["Curso", "Bootcamp", "Mentoria", "Webinario", "Produto"]);

/* ------------------------------------------------------------------------------------------------
 * Marca (hero, logo e icone da escola)
 * ---------------------------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Mesmo padrao de platform-store: sem configuracao, banner padrao ligado. */
export function normalizeHero(value: unknown): StorefrontHero {
  if (!isRecord(value)) {
    return { enabled: true, image: DEFAULT_HERO_IMAGE, mediaType: "image" };
  }

  const image = typeof value.image === "string" ? value.image.trim() : "";

  return {
    enabled: value.enabled !== false && Boolean(image),
    image,
    mediaType: value.mediaType === "video" ? "video" : "image"
  };
}

/** Mesmo padrao de normalizePlatformBranding: null = sem logo; ausente ou vazio = logo padrao. */
export function normalizeLogo(value: unknown, configured: boolean): string | null {
  if (!configured || !isRecord(value)) {
    return DEFAULT_LOGO_IMAGE;
  }

  if (value.logoImage === null) {
    return null;
  }

  const logo = typeof value.logoImage === "string" ? value.logoImage.trim() : "";

  return logo || DEFAULT_LOGO_IMAGE;
}

/** Icone da escola gravado em branding.schoolIcon: ausente, vazio ou sem marca gravada = o simbolo padrao. */
export function normalizeBrandingSchoolIcon(branding: unknown): string {
  return normalizeSchoolIcon(isRecord(branding) ? branding.schoolIcon : undefined);
}

/* ------------------------------------------------------------------------------------------------
 * Fileiras gravadas
 * ---------------------------------------------------------------------------------------------- */

const SECTION_TYPES = new Set<HomeSectionConfig["sectionType"]>(["continue_watching", "content_carousel", "content_structure"]);
const CONTENT_SOURCES = new Set<HomeSectionContentSource>([
  "recent_lessons",
  "entitlement_products",
  "sellable_products",
  "upcoming_products",
  "manual",
  "selected_content_structure"
]);
const LAYOUTS = new Set<HomeSectionLayout>(["continue", "vertical", "compact", "immersive"]);
const VISIBILITIES = new Set<RowVisibility>(["students", "non_students", "all"]);

export function normalizeSectionOrder(sections: readonly HomeSectionConfig[]): HomeSectionConfig[] {
  return sections
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((section, order) => ({ ...section, order }));
}

/** Mesma leitura tolerante de normalizeHomeSectionConfigs: entrada invalida e descartada. */
export function normalizeStoredSections(value: unknown): HomeSectionConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeSectionOrder(
    value.flatMap((entry, index): HomeSectionConfig[] => {
      if (!isRecord(entry)) {
        return [];
      }

      const { contentSource, layout, sectionType, visibility } = entry;

      if (
        typeof entry.id !== "string" ||
        typeof entry.title !== "string" ||
        !SECTION_TYPES.has(sectionType as HomeSectionConfig["sectionType"]) ||
        !CONTENT_SOURCES.has(contentSource as HomeSectionContentSource) ||
        !LAYOUTS.has(layout as HomeSectionLayout) ||
        !VISIBILITIES.has(visibility as RowVisibility)
      ) {
        return [];
      }

      return [
        {
          contentSource: contentSource as HomeSectionContentSource,
          id: entry.id,
          isActive: entry.isActive !== false,
          itemIds: Array.isArray(entry.itemIds) ? entry.itemIds.filter((id): id is string => typeof id === "string") : [],
          layout: layout as HomeSectionLayout,
          order: typeof entry.order === "number" ? entry.order : index,
          sectionType: sectionType as HomeSectionConfig["sectionType"],
          sourceContentId: typeof entry.sourceContentId === "string" ? entry.sourceContentId : undefined,
          subtitle: typeof entry.subtitle === "string" ? entry.subtitle : undefined,
          title: entry.title,
          visibility: visibility as RowVisibility
        }
      ];
    })
  );
}

/* ------------------------------------------------------------------------------------------------
 * Fontes automaticas e textos para o produtor
 * ---------------------------------------------------------------------------------------------- */

export type AutomaticSource = Extract<
  HomeSectionContentSource,
  "recent_lessons" | "entitlement_products" | "sellable_products" | "upcoming_products"
>;

export type AutomaticSourceOption = {
  description: string;
  label: string;
  layout: HomeSectionLayout;
  sectionType: HomeSectionConfig["sectionType"];
  source: AutomaticSource;
  subtitle: string;
  visibility: RowVisibility;
};

export const AUTOMATIC_SOURCES: readonly AutomaticSourceOption[] = [
  {
    description: "As aulas que cada aluno começou, da mais recente para a mais antiga.",
    label: "Continue assistindo",
    layout: "continue",
    sectionType: "continue_watching",
    source: "recent_lessons",
    subtitle: "Retome exatamente de onde parou.",
    // Ja depende de cada aluno (as aulas que ele comecou, inclusive de conteudo gratuito): "Todos os alunos".
    visibility: "all"
  },
  {
    description: "Os produtos que cada aluno tem acesso.",
    label: "Minhas compras",
    layout: "vertical",
    sectionType: "content_carousel",
    source: "entitlement_products",
    subtitle: "Todos os produtos que você já tem acesso: formações, bootcamps e cursos.",
    visibility: "students"
  },
  {
    description: "Os produtos publicados e visíveis na vitrine que o aluno ainda não tem.",
    label: "Produtos à venda",
    layout: "vertical",
    sectionType: "content_carousel",
    source: "sellable_products",
    subtitle: "Produtos disponíveis e destaques da Bunker707.",
    visibility: "all"
  },
  {
    description: "Os lançamentos marcados como futuros.",
    label: "Em breve",
    layout: "vertical",
    sectionType: "content_carousel",
    source: "upcoming_products",
    subtitle: "Próximos cursos, formações e turmas para entrar no radar.",
    visibility: "all"
  }
];

export function isAutomaticSource(source: HomeSectionContentSource): source is AutomaticSource {
  return AUTOMATIC_SOURCES.some((option) => option.source === source);
}

export function getAutomaticSource(source: AutomaticSource): AutomaticSourceOption {
  return AUTOMATIC_SOURCES.find((option) => option.source === source) ?? AUTOMATIC_SOURCES[2];
}

export type SectionKind = "automatic" | "manual" | "structure";

export function sectionKind(section: Pick<HomeSectionConfig, "contentSource">): SectionKind {
  if (section.contentSource === "manual") {
    return "manual";
  }

  return section.contentSource === "selected_content_structure" ? "structure" : "automatic";
}

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  automatic: "Automática",
  manual: "Escolha manual",
  structure: "Fileira de módulos"
};

export const VISIBILITY_LABELS: Record<RowVisibility, string> = {
  all: "Todos os alunos",
  non_students: "Só quem ainda não comprou",
  students: "Só quem já comprou"
};

/**
 * Quem esta olhando a home, para o "Quem pode ver" de cada fileira (docs/02, Home). No "ver como" da equipe vale o
 * modo escolhido ("Produtor" ve todas as fileiras); para quem entra de verdade (aluno, ou a equipe sem o "ver como"),
 * "ja comprou" e ter pelo menos um acesso ativo: a mesma fonte que libera os conteudos (entitlements, AGENTS.md).
 */
export type HomeRowViewer = "everyone" | "students" | "non_students";

export function homeRowViewerOf(accessPreviewMode: AccessPreviewMode | undefined, hasActiveAccess: boolean): HomeRowViewer {
  if (accessPreviewMode === "producer") {
    return "everyone";
  }

  if (accessPreviewMode === "student_with_access") {
    return "students";
  }

  if (accessPreviewMode === "student_without_access") {
    return "non_students";
  }

  return hasActiveAccess ? "students" : "non_students";
}

/** A fileira aparece para quem esta olhando? "Todos os alunos" sempre; as outras, so para o publico delas. */
export function isHomeRowVisibleTo(visibility: RowVisibility, viewer: HomeRowViewer): boolean {
  return visibility === "all" || viewer === "everyone" || visibility === viewer;
}

export const VISIBILITY_OPTIONS: readonly { label: string; value: RowVisibility }[] = [
  { label: VISIBILITY_LABELS.all, value: "all" },
  { label: VISIBILITY_LABELS.students, value: "students" },
  { label: VISIBILITY_LABELS.non_students, value: "non_students" }
];

export const STRUCTURE_LAYOUT_OPTIONS: readonly { description: string; label: string; value: "compact" | "immersive" }[] = [
  { description: "Capa do produto e os módulos logo abaixo.", label: "Compacta", value: "compact" },
  { description: "Banner largo com os módulos por cima.", label: "Imersiva", value: "immersive" }
];

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Linha de apoio da fileira na lista, ex.: "Automática · Produtos à venda" ou "Escolha manual · 3 produtos". */
export function describeSection(section: HomeSectionConfig, productsById: ReadonlyMap<string, StorefrontProduct>) {
  const kind = sectionKind(section);

  if (kind === "automatic") {
    return `${SECTION_KIND_LABELS.automatic} · ${getAutomaticSource(section.contentSource as AutomaticSource).label}`;
  }

  if (kind === "manual") {
    return `${SECTION_KIND_LABELS.manual} · ${plural(section.itemIds.length, "produto", "produtos")}`;
  }

  const product = section.sourceContentId ? productsById.get(section.sourceContentId) : undefined;

  return `${SECTION_KIND_LABELS.structure} · ${product?.title ?? "produto removido"}`;
}

/* ------------------------------------------------------------------------------------------------
 * Mapeador do carregador
 * ---------------------------------------------------------------------------------------------- */

function readModuleSectionEnabled(value: unknown) {
  return isRecord(value) && value.enabled === true;
}

export function mapStorefrontProducts(input: {
  contentRows: readonly StorefrontContentRow[];
  moduleRows: readonly StorefrontModuleRow[];
  settingsRows: readonly StorefrontSettingsRow[];
}): { defaultStructureIds: string[]; products: StorefrontProduct[] } {
  const settingsById = new Map(input.settingsRows.map((row) => [row.content_id, row]));
  const modulesByOwner = new Map<string, number>();

  for (const row of input.moduleRows) {
    if (row.owner_id) {
      modulesByOwner.set(row.owner_id, (modulesByOwner.get(row.owner_id) ?? 0) + 1);
    }
  }

  const defaultStructureIds: string[] = [];
  const products = input.contentRows
    .filter((row) => SELLABLE_BUCKETS.has(row.bucket) || row.bucket === UPCOMING_BUCKET)
    .slice()
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.title.localeCompare(right.title, "pt-BR"))
    .map((row): StorefrontProduct => {
      const settings = settingsById.get(row.id);
      const format = formatFromKind(row.kind);
      const sellable = SELLABLE_BUCKETS.has(row.bucket) && row.commerce_scope === "sellable_product";
      const listed = isListedInStorefront({ listing: row.listing ?? null });
      const modulesCount = modulesByOwner.get(row.id) ?? 0;

      if (
        sellable &&
        listed &&
        modulesCount > 0 &&
        STRUCTURE_DEFAULT_KINDS.has(row.kind) &&
        readModuleSectionEnabled(settings?.home_module_section)
      ) {
        defaultStructureIds.push(row.id);
      }

      return {
        accent: resolveProductAccent(row.id, settings?.accent),
        coverUrl: row.image?.trim() ? row.image.trim() : null,
        formatLabel: format ? PRODUCT_FORMAT_LABELS[format] : row.kind,
        id: row.id,
        kind: row.kind,
        listed,
        modulesCount,
        sellable,
        situation: situationFromPublicationStatus(row.publication_status),
        title: row.title,
        upcoming: row.bucket === UPCOMING_BUCKET
      };
    });

  return { defaultStructureIds, products };
}

const ONLINE_SECTION_LABELS: Partial<Record<ContentKind, string>> = {
  Bootcamp: "Bootcamps Online",
  Curso: "Cursos Online",
  Mentoria: "Mentorias Online",
  Webinario: "Webinários Online"
};

/** Ordem padrao da home quando a vitrine nunca foi publicada (getDefaultHomeSectionConfigs). */
export function buildDefaultSections(products: readonly StorefrontProduct[], structureIds: readonly string[]): HomeSectionConfig[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const structural = structureIds.flatMap((id): HomeSectionConfig[] => {
    const product = byId.get(id);

    return product
      ? [
          {
            contentSource: "selected_content_structure",
            id: `course-modules-${product.id}`,
            isActive: true,
            itemIds: [],
            layout: "compact",
            order: 0,
            sectionType: "content_structure",
            sourceContentId: product.id,
            subtitle: ONLINE_SECTION_LABELS[product.kind as ContentKind] ?? "Conteúdos Online",
            title: product.title,
            visibility: "all"
          }
        ]
      : [];
  });
  const automatic = (source: AutomaticSource, id: string): HomeSectionConfig => {
    const option = getAutomaticSource(source);

    return {
      contentSource: option.source,
      id,
      isActive: true,
      itemIds: [],
      layout: option.layout,
      order: 0,
      sectionType: option.sectionType,
      subtitle: option.subtitle,
      title: option.label,
      visibility: option.visibility
    };
  };

  return [
    automatic("recent_lessons", "continue-watching"),
    automatic("entitlement_products", "my-purchases"),
    ...structural,
    automatic("sellable_products", "showcase"),
    { ...automatic("upcoming_products", "upcoming"), title: "Em breve na Bunker707" }
  ].map((section, order) => ({ ...section, order }));
}

export function mapStorefrontEditorData(input: {
  contentRows: readonly StorefrontContentRow[];
  moduleRows: readonly StorefrontModuleRow[];
  platformRows: readonly PlatformSettingRow[];
  settingsRows: readonly StorefrontSettingsRow[];
}): StorefrontEditorData {
  const settings = new Map(input.platformRows.map((row) => [row.key, row.value]));
  const { defaultStructureIds, products } = mapStorefrontProducts(input);
  const sectionsRow = input.platformRows.find((row) => row.key === "homeSections");
  const sectionsConfigured = Boolean(sectionsRow);

  return {
    hero: normalizeHero(settings.get("hero")),
    logoImage: normalizeLogo(settings.get("branding"), settings.has("branding")),
    products,
    sections: sectionsConfigured ? normalizeStoredSections(sectionsRow?.value) : buildDefaultSections(products, defaultStructureIds),
    sectionsConfigured,
    sectionsUpdatedAt: sectionsRow ? (sectionsRow.updated_at ?? null) : null
  };
}

export function mapStorefrontBrand(platformRows: readonly PlatformSettingRow[]): StorefrontBrand {
  const settings = new Map(platformRows.map((row) => [row.key, row.value]));

  return {
    hero: normalizeHero(settings.get("hero")),
    logoImage: normalizeLogo(settings.get("branding"), settings.has("branding")),
    schoolIcon: normalizeBrandingSchoolIcon(settings.get("branding")),
    style: normalizeMemberStyle(settings.get("branding"))
  };
}

/* ------------------------------------------------------------------------------------------------
 * Edicao das fileiras
 * ---------------------------------------------------------------------------------------------- */

/** Move a fileira `delta` posicoes (Alt+setas, menu "Mover para cima/baixo"). Fora dos limites: igual. */
export function moveSection(sections: readonly HomeSectionConfig[], sectionId: string, delta: number): HomeSectionConfig[] {
  const ordered = normalizeSectionOrder(sections);
  const index = ordered.findIndex((section) => section.id === sectionId);

  return index < 0 ? ordered : moveSectionTo(ordered, sectionId, index + delta);
}

/** Coloca a fileira na posicao `targetIndex` (arrastar e soltar). */
export function moveSectionTo(sections: readonly HomeSectionConfig[], sectionId: string, targetIndex: number): HomeSectionConfig[] {
  const ordered = normalizeSectionOrder(sections);
  const index = ordered.findIndex((section) => section.id === sectionId);

  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length || targetIndex === index) {
    return ordered;
  }

  const next = ordered.slice();
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);

  return next.map((section, order) => ({ ...section, order }));
}

/** Id novo e unico (o servidor recusa ids repetidos). */
export function makeSectionId(sections: readonly HomeSectionConfig[], now: number = Date.now()) {
  const taken = new Set(sections.map((section) => section.id));
  let seed = now;
  let id = `section-${seed.toString(36)}`;

  while (taken.has(id)) {
    seed += 1;
    id = `section-${seed.toString(36)}`;
  }

  return id;
}

export type SectionDraft = {
  itemIds: string[];
  kind: SectionKind;
  layout: "compact" | "immersive";
  source: AutomaticSource;
  sourceContentId: string;
  subtitle: string;
  title: string;
  visibility: RowVisibility;
};

export function emptySectionDraft(sections: readonly HomeSectionConfig[]): SectionDraft {
  const first = availableAutomaticSources(sections)[0];

  return {
    itemIds: [],
    kind: first ? "automatic" : "manual",
    layout: "compact",
    source: first?.source ?? "sellable_products",
    sourceContentId: "",
    // Fileira automatica nova ja vem com o subtitulo e o publico de sempre; o produtor pode mudar.
    subtitle: first?.subtitle ?? "",
    title: "",
    visibility: first?.visibility ?? "all"
  };
}

/**
 * Troca a fonte de uma fileira automatica nova: subtitulo e publico acompanham a fonte enquanto o
 * produtor nao os mudou (continuam iguais aos padroes da fonte anterior).
 */
export function changeDraftSource(draft: SectionDraft, source: AutomaticSource): SectionDraft {
  const previous = getAutomaticSource(draft.source);
  const next = getAutomaticSource(source);
  const subtitleUntouched = !draft.subtitle.trim() || draft.subtitle === previous.subtitle;
  const visibilityUntouched = draft.visibility === previous.visibility;

  return {
    ...draft,
    source,
    subtitle: subtitleUntouched ? next.subtitle : draft.subtitle,
    visibility: visibilityUntouched ? next.visibility : draft.visibility
  };
}

export function sectionToDraft(section: HomeSectionConfig): SectionDraft {
  const kind = sectionKind(section);

  return {
    itemIds: section.itemIds.slice(),
    kind,
    layout: section.layout === "immersive" ? "immersive" : "compact",
    source: kind === "automatic" ? (section.contentSource as AutomaticSource) : "sellable_products",
    sourceContentId: section.sourceContentId ?? "",
    subtitle: section.subtitle ?? "",
    title: section.title,
    visibility: section.visibility
  };
}

/** Fontes automaticas que ainda nao estao na vitrine (cada uma so pode aparecer uma vez). */
export function availableAutomaticSources(sections: readonly HomeSectionConfig[], exceptSectionId?: string) {
  const used = new Set(sections.filter((section) => section.id !== exceptSectionId).map((section) => section.contentSource));

  return AUTOMATIC_SOURCES.filter((option) => !used.has(option.source));
}

export type SectionDraftErrors = Partial<Record<"itemIds" | "source" | "sourceContentId" | "title", string>>;

export const SECTION_TITLE_MAX = 80;
export const SECTION_SUBTITLE_MAX = 200;

export function validateSectionDraft(
  draft: SectionDraft,
  context: { productsById: ReadonlyMap<string, StorefrontProduct>; sections: readonly HomeSectionConfig[]; sectionId?: string }
): SectionDraftErrors {
  const errors: SectionDraftErrors = {};
  const title = draft.title.trim();

  // Automatica e fileira de modulos usam o nome da fonte ou do produto quando o titulo fica vazio.
  if (draft.kind === "manual" && !title) {
    errors.title = "Dê um título à fileira.";
  } else if (title.length > SECTION_TITLE_MAX) {
    errors.title = `Use no máximo ${SECTION_TITLE_MAX} caracteres.`;
  }

  if (draft.kind === "automatic" && !availableAutomaticSources(context.sections, context.sectionId).some((option) => option.source === draft.source)) {
    errors.source = "Esta fileira automática já está na vitrine.";
  }

  if (draft.kind === "manual") {
    if (draft.itemIds.length === 0) {
      errors.itemIds = "Escolha pelo menos um produto.";
    } else if (draft.itemIds.some((id) => !context.productsById.get(id)?.sellable)) {
      errors.itemIds = "Um dos produtos escolhidos não está mais à venda. Tire-o da lista.";
    }
  }

  if (draft.kind === "structure" && !context.productsById.get(draft.sourceContentId)?.sellable) {
    errors.sourceContentId = "Escolha o produto da fileira.";
  }

  return errors;
}

/** Monta a fileira gravavel a partir do rascunho do painel (criar ou editar). */
export function draftToSection(
  draft: SectionDraft,
  base: { id: string; isActive: boolean; order: number },
  productsById: ReadonlyMap<string, StorefrontProduct>
): HomeSectionConfig {
  const subtitle = draft.subtitle.trim() || undefined;

  if (draft.kind === "automatic") {
    const option = getAutomaticSource(draft.source);

    return {
      contentSource: option.source,
      id: base.id,
      isActive: base.isActive,
      itemIds: [],
      layout: option.layout,
      order: base.order,
      sectionType: option.sectionType,
      subtitle,
      title: draft.title.trim() || option.label,
      visibility: draft.visibility
    };
  }

  if (draft.kind === "structure") {
    return {
      contentSource: "selected_content_structure",
      id: base.id,
      isActive: base.isActive,
      itemIds: [],
      layout: draft.layout,
      order: base.order,
      sectionType: "content_structure",
      sourceContentId: draft.sourceContentId,
      subtitle,
      title: draft.title.trim() || productsById.get(draft.sourceContentId)?.title || SECTION_KIND_LABELS.structure,
      visibility: draft.visibility
    };
  }

  return {
    contentSource: "manual",
    id: base.id,
    isActive: base.isActive,
    itemIds: Array.from(new Set(draft.itemIds)),
    layout: "vertical",
    order: base.order,
    sectionType: "content_carousel",
    subtitle,
    title: draft.title.trim(),
    visibility: draft.visibility
  };
}

/** Duplicar so vale para escolha manual e fileira de modulos (fonte automatica aparece uma vez so). */
export function canDuplicateSection(section: Pick<HomeSectionConfig, "contentSource">) {
  return sectionKind(section) !== "automatic";
}

export function duplicateSection(sections: readonly HomeSectionConfig[], sectionId: string, now: number = Date.now()) {
  const ordered = normalizeSectionOrder(sections);
  const index = ordered.findIndex((section) => section.id === sectionId);
  const source = ordered[index];

  if (!source || !canDuplicateSection(source)) {
    return { sections: ordered, newId: null };
  }

  const copy: HomeSectionConfig = {
    ...source,
    id: makeSectionId(ordered, now),
    itemIds: source.itemIds.slice(),
    title: `${source.title} (cópia)`.slice(0, SECTION_TITLE_MAX)
  };
  const next = ordered.slice();
  next.splice(index + 1, 0, copy);

  return { newId: copy.id, sections: next.map((section, order) => ({ ...section, order })) };
}

/* ------------------------------------------------------------------------------------------------
 * Produto que saiu de venda (excluido ou fora de venda)
 * ---------------------------------------------------------------------------------------------- */

export type RemovedSectionRef = {
  /** Produtos tirados da fileira (na fileira de modulos, o produto dela; vazio se ela nao tinha). */
  productIds: string[];
  /** true = a fileira inteira saiu (fileira de modulos sem produto, ou escolha manual que ficou vazia). */
  sectionRemoved: boolean;
  sectionId: string;
  title: string;
};

export type PrunedSections = { removed: RemovedSectionRef[]; sections: HomeSectionConfig[] };

function isModuleRowSection(section: Pick<HomeSectionConfig, "contentSource" | "sectionType">) {
  return section.contentSource === "selected_content_structure" || section.sectionType === "content_structure";
}

/**
 * Regra unica para produto que nao esta mais a venda, a mesma que a home do aluno ja aplica
 * (resolveConfiguredHomeRows ignora o que nao esta a venda): sai da escolha manual; a fileira de
 * modulos dele sai inteira; a escolha manual que fica vazia por causa disso sai tambem. Escolha
 * manual que ja estava vazia fica (e problema do produtor, ver findSectionProblems). Usada na
 * Vitrine (ao abrir e ao publicar), em publishHomeSections e ao excluir um produto.
 */
export function pruneHomeSectionRefs(
  sections: readonly HomeSectionConfig[],
  isAvailable: (productId: string) => boolean
): PrunedSections {
  const removed: RemovedSectionRef[] = [];
  const kept = normalizeSectionOrder(sections).flatMap((section): HomeSectionConfig[] => {
    const title = section.title.trim() || "Fileira sem título";

    if (section.contentSource === "manual") {
      const gone = Array.from(new Set(section.itemIds.filter((id) => !isAvailable(id))));

      if (gone.length === 0) {
        return [section];
      }

      const itemIds = section.itemIds.filter((id) => isAvailable(id));
      const sectionRemoved = itemIds.length === 0;
      removed.push({ productIds: gone, sectionId: section.id, sectionRemoved, title });

      return sectionRemoved ? [] : [{ ...section, itemIds }];
    }

    if (isModuleRowSection(section)) {
      if (section.sourceContentId && isAvailable(section.sourceContentId)) {
        return [section];
      }

      removed.push({
        productIds: section.sourceContentId ? [section.sourceContentId] : [],
        sectionId: section.id,
        sectionRemoved: true,
        title
      });

      return [];
    }

    return [section];
  });

  return { removed, sections: kept.map((section, order) => ({ ...section, order })) };
}

/** pruneHomeSectionRefs com os produtos da Vitrine: fica so o que esta a venda (sellable). */
export function pruneUnavailableSectionRefs(
  sections: readonly HomeSectionConfig[],
  productsById: ReadonlyMap<string, Pick<StorefrontProduct, "sellable">>
): PrunedSections {
  return pruneHomeSectionRefs(sections, (id) => productsById.get(id)?.sellable === true);
}

function listSectionTitles(titles: readonly string[]) {
  const quoted = titles.map((title) => `“${title}”`);

  if (quoted.length > 3) {
    return `${quoted.length} fileiras`;
  }

  return quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} e ${quoted[quoted.length - 1]}`;
}

/**
 * Aviso curto (neutro, nao bloqueia) do que a limpeza tirou, ex.: "1 produto que não está mais à
 * venda saiu de “Para você”. Publique para salvar." null = nada saiu.
 */
export function describeSectionCleanup(removed: readonly RemovedSectionRef[]): string | null {
  const trimmed = removed.filter((entry) => !entry.sectionRemoved);
  const dropped = removed.filter((entry) => entry.sectionRemoved);

  if (trimmed.length === 0 && dropped.length === 0) {
    return null;
  }

  const parts: string[] = [];

  if (trimmed.length > 0) {
    // Produtos diferentes: o mesmo curso em duas fileiras conta uma vez so.
    const count = new Set(trimmed.flatMap((entry) => entry.productIds)).size;
    const where = listSectionTitles(trimmed.map((entry) => entry.title));

    parts.push(
      count === 1
        ? `1 produto que não está mais à venda saiu de ${where}.`
        : `${count} produtos que não estão mais à venda saíram de ${where}.`
    );
  }

  if (dropped.length === 1) {
    parts.push(`A fileira “${dropped[0].title}” saiu: nenhum produto dela está mais à venda.`);
  } else if (dropped.length > 3) {
    // Muitas fileiras: so a quantidade (listSectionTitles ja resumiria em "N fileiras").
    parts.push(`${dropped.length} fileiras saíram: nenhum produto delas está mais à venda.`);
  } else if (dropped.length > 1) {
    const where = listSectionTitles(dropped.map((entry) => entry.title));

    parts.push(`As fileiras ${where} saíram: nenhum produto delas está mais à venda.`);
  }

  parts.push("Publique para salvar.");

  return parts.join(" ");
}

/**
 * Problemas que impedem publicar a vitrine inteira (mesmas regras de validateHomeSectionConfigs).
 * Olha o que vai ser publicado: produto que saiu de venda nao e problema, a limpeza
 * (pruneUnavailableSectionRefs) tira antes. Devolve um texto por fileira com problema, na ordem da lista.
 */
export function findSectionProblems(
  sections: readonly HomeSectionConfig[],
  productsById: ReadonlyMap<string, StorefrontProduct>
): { message: string; sectionId: string }[] {
  const problems: { message: string; sectionId: string }[] = [];
  const ids = new Set<string>();
  const automatic = new Set<string>();

  for (const section of pruneUnavailableSectionRefs(sections, productsById).sections) {
    const label = section.title.trim() || "Fileira sem título";

    if (ids.has(section.id)) {
      problems.push({ message: `“${label}” está repetida. Exclua uma das cópias.`, sectionId: section.id });
    }

    ids.add(section.id);

    if (!section.title.trim()) {
      problems.push({ message: "Uma fileira está sem título.", sectionId: section.id });
    }

    const kind = sectionKind(section);

    if (kind === "manual") {
      // Vazia aqui = o produtor deixou assim (a que esvazia por produto fora de venda ja saiu).
      if (section.itemIds.length === 0) {
        problems.push({ message: `“${label}” não tem nenhum produto escolhido.`, sectionId: section.id });
      }
    } else if (kind === "automatic") {
      if (automatic.has(section.contentSource)) {
        problems.push({ message: `“${label}” repete uma fileira automática. Exclua uma delas.`, sectionId: section.id });
      } else {
        automatic.add(section.contentSource);
      }
    }
  }

  return problems;
}

/** Comparacao do que sera publicado (ordem normalizada; espacos nas pontas nao contam). */
export function areSectionsEqual(left: readonly HomeSectionConfig[], right: readonly HomeSectionConfig[]) {
  const canonical = (sections: readonly HomeSectionConfig[]) =>
    JSON.stringify(
      normalizeSectionOrder(sections).map((section) => ({
        ...section,
        itemIds: section.itemIds,
        sourceContentId: section.sourceContentId ?? null,
        subtitle: section.subtitle?.trim() || null,
        title: section.title.trim()
      }))
    );

  return canonical(left) === canonical(right);
}

/* ------------------------------------------------------------------------------------------------
 * Previa (o que cada fileira mostra hoje)
 * ---------------------------------------------------------------------------------------------- */

export type SectionPreview =
  | { kind: "per_student"; note: string }
  | { kind: "products"; products: StorefrontProduct[]; hiddenCount: number }
  | { kind: "structure"; product: StorefrontProduct | null }
  | { kind: "off" };

const PER_STUDENT_NOTES: Partial<Record<AutomaticSource, string>> = {
  entitlement_products: "Muda para cada aluno: os produtos que ele tem acesso.",
  recent_lessons: "Muda para cada aluno: as aulas que ele começou."
};

/**
 * O que a fileira mostra para quem ainda nao comprou nada, so com produtos publicados. Fileiras que
 * dependem do aluno dizem isso em vez de inventar itens.
 */
export function resolveSectionPreview(section: HomeSectionConfig, products: readonly StorefrontProduct[]): SectionPreview {
  if (!section.isActive) {
    return { kind: "off" };
  }

  const published = products.filter((product) => product.situation === "published");
  const kind = sectionKind(section);

  if (kind === "automatic") {
    const note = PER_STUDENT_NOTES[section.contentSource as AutomaticSource];

    if (note) {
      return { kind: "per_student", note };
    }

    const pool =
      section.contentSource === "upcoming_products"
        ? published.filter((product) => product.upcoming)
        : published.filter((product) => product.sellable);

    return {
      hiddenCount: pool.filter((product) => !product.listed).length,
      kind: "products",
      products: pool.filter((product) => product.listed)
    };
  }

  if (kind === "structure") {
    const product = published.find((item) => item.id === section.sourceContentId) ?? null;

    return { kind: "structure", product: product && product.listed ? product : null };
  }

  const byId = new Map(published.map((product) => [product.id, product]));
  const chosen = section.itemIds.flatMap((id) => {
    const product = byId.get(id);
    return product ? [product] : [];
  });

  return {
    hiddenCount: chosen.filter((product) => !product.listed).length,
    kind: "products",
    products: chosen.filter((product) => product.listed)
  };
}

/* ------------------------------------------------------------------------------------------------
 * Marca: rascunho e corpo do PUT /api/admin/appearance
 * ---------------------------------------------------------------------------------------------- */

export type BrandDraft = {
  heroEnabled: boolean;
  heroImage: string;
  logoImage: string | null;
  /** Endereco do icone (ou data URL de um envio ainda nao publicado); o simbolo padrao quando nao ha icone. */
  schoolIcon: string;
  style: MemberStyleConfig;
};

export function brandToDraft(brand: StorefrontBrand): BrandDraft {
  return {
    heroEnabled: brand.hero.enabled,
    heroImage: brand.hero.image || DEFAULT_HERO_IMAGE,
    logoImage: brand.logoImage,
    schoolIcon: normalizeSchoolIcon(brand.schoolIcon),
    style: brand.style
  };
}

export function isBrandHeroDirty(published: BrandDraft, draft: BrandDraft) {
  return draft.heroEnabled !== published.heroEnabled || (draft.heroEnabled && draft.heroImage !== published.heroImage);
}

export function isBrandDirty(published: BrandDraft, draft: BrandDraft) {
  return (
    isBrandHeroDirty(published, draft) ||
    draft.logoImage !== published.logoImage ||
    normalizeSchoolIcon(draft.schoolIcon) !== normalizeSchoolIcon(published.schoolIcon) ||
    !isSameMemberStyle(draft.style, published.style)
  );
}

export type AppearancePayload = {
  hero?: { enabled: boolean; image?: string };
  logo?: { image: string | null };
  /** null = de volta ao simbolo padrao (a chave sai de branding). */
  schoolIcon?: { image: string | null };
  style?: MemberStyleConfig;
};

/** So manda o que mudou; imagem so quando trocou. */
export function buildAppearancePayload(published: BrandDraft, draft: BrandDraft) {
  const payload: AppearancePayload = {};

  if (isBrandHeroDirty(published, draft)) {
    payload.hero = draft.heroEnabled
      ? { enabled: true, ...(draft.heroImage !== published.heroImage ? { image: draft.heroImage } : {}) }
      : { enabled: false };
  }

  if (draft.logoImage !== published.logoImage) {
    payload.logo = { image: draft.logoImage };
  }

  const schoolIcon = normalizeSchoolIcon(draft.schoolIcon);

  if (schoolIcon !== normalizeSchoolIcon(published.schoolIcon)) {
    payload.schoolIcon = { image: isDefaultSchoolIcon(schoolIcon) ? null : schoolIcon };
  }

  if (!isSameMemberStyle(draft.style, published.style)) {
    payload.style = draft.style;
  }

  return payload;
}

/** Icone da escola (Marca): proporcao aceita, menor lado e a medida maxima depois de reduzir no navegador. */
export const SCHOOL_ICON_RULES = { maxRatio: 1.1, maxSide: 512, minRatio: 0.9, minSide: 128 } as const;

/**
 * Icone da escola enviado ou colado: quadrado (proporcao de 0,9 a 1,1) e, se for imagem de pixels, com
 * pelo menos 128 px de lado. Um SVG desenha em qualquer tamanho, entao so a proporcao conta. Sem largura
 * ou altura legivel nao da para conferir: recusa como nao quadrada.
 */
export function schoolIconSizeProblem(size: { height: number; vector?: boolean; width: number }): string | null {
  const { height, width } = size;

  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) {
    return "Use uma imagem quadrada (mesma largura e altura).";
  }

  const ratio = width / height;

  if (ratio < SCHOOL_ICON_RULES.minRatio || ratio > SCHOOL_ICON_RULES.maxRatio) {
    return "Use uma imagem quadrada (mesma largura e altura).";
  }

  if (!size.vector && Math.min(width, height) < SCHOOL_ICON_RULES.minSide) {
    return "Use uma imagem de pelo menos 128 × 128 px.";
  }

  return null;
}

/** Medida em px de um atributo width/height de SVG ("128" ou "128px"); porcentagem, unidade ou ausente = 0. */
function svgLength(value: string | null) {
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(value ?? "");
  return match ? Number(match[1]) : 0;
}

/** Medida de um SVG enviado pelos atributos da raiz: o viewBox, ou width e height em px (0 = sem medida). */
export function svgSizeOf(attributes: { height: string | null; viewBox: string | null; width: string | null }) {
  const box = (attributes.viewBox ?? "").trim().split(/[\s,]+/).map(Number);

  if (box.length === 4 && box[2] > 0 && box[3] > 0) {
    return { height: box[3], width: box[2] };
  }

  return { height: svgLength(attributes.height), width: svgLength(attributes.width) };
}

/** Link colado para banner, logo ou icone: https (ou caminho do proprio site), sem espacos nem aspas. */
export function validateImageLink(value: string): string | null {
  const link = value.trim();

  if (!link) {
    return "Cole o link da imagem.";
  }

  if (link.length > 2048 || /[\s"'()<>\\]/.test(link)) {
    return "Este link não parece de uma imagem. Confira e cole de novo.";
  }

  if (link.startsWith("/") && !link.startsWith("//")) {
    return null;
  }

  try {
    const url = new URL(link);
    return url.protocol === "https:" ? null : "Use um link que comece com https://.";
  } catch {
    return "Este link não parece de uma imagem. Confira e cole de novo.";
  }
}
