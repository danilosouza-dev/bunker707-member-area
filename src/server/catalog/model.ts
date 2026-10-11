// Modelo de produto do Admin Bunker707 (docs/17 §1.3 "dois estados", §1.6, §2.4 e §2.12).
// Traduz o modelo gravado hoje (content_items, course_modules, lessons) para as palavras do produtor e
// de volta. Modulo puro (sem "server-only", sem React, so imports de tipo): o servidor usa para gravar,
// a UI usa para rotular e tests/catalog-model.test.mjs carrega direto pelo Node.
//
// Decisoes registradas aqui (e no plano da fase 1):
// - Formato = content_items.kind, sem migrar valores: "Produto" aparece como Material e "Webinario" como
//   Gravacao de live (D11 adotada so no rotulo; o tipo gravado continua o mesmo para nao mexer no
//   mapeamento de acesso target_type = "product"/"webinar" em src/server/access/*).
// - Situacao = content_items.publication_status (draft/published/archived).
// - Quem pode ver = access_model + content_items.listing (coluna nova, migracao da frente A):
//     Só quem tem acesso  -> access_model "closed", listing "listed"
//     Todos os alunos     -> access_model "free",   listing "listed"
//     Oculto por enquanto -> access_model "closed", listing "hidden"
//   "Oculto" e coluna (e nao content_page_settings.settings) porque e regra de listagem filtrada em
//   consulta (vitrine, busca, guia) e precisa de indice e de check no banco; settings guarda so
//   apresentacao (hero, cor, modo de abertura).
// - Campos legados continuam preenchidos por derivacao no servidor enquanto a area do aluno os le:
//   is_locked, status (ContentStatus) e purchase_label.

import type {
  CommerceScope,
  ContentAccessModel,
  ContentKind,
  ContentPublicationStatus,
  ContentStatus,
  ReleaseRuleConfig
} from "@/lib/platform-types";

/* ------------------------------------------------------------------------------------------------
 * Formato
 * ---------------------------------------------------------------------------------------------- */

export const PRODUCT_FORMATS = ["curso", "formacao", "mentoria", "bootcamp", "material", "gravacao_live"] as const;
export type ProductFormat = (typeof PRODUCT_FORMATS)[number];

/** Formatos oferecidos em "Novo produto" (Gravação de live só existe para itens antigos). */
export const CREATABLE_PRODUCT_FORMATS = ["curso", "formacao", "mentoria", "bootcamp", "material"] as const;
export type CreatableProductFormat = (typeof CREATABLE_PRODUCT_FORMATS)[number];

export const PRODUCT_FORMAT_LABELS: Record<ProductFormat, string> = {
  bootcamp: "Bootcamp",
  curso: "Curso",
  formacao: "Formação",
  gravacao_live: "Gravação de live",
  material: "Material",
  mentoria: "Mentoria"
};

const kindByFormat: Record<ProductFormat, ContentKind> = {
  bootcamp: "Bootcamp",
  curso: "Curso",
  formacao: "Formacao",
  gravacao_live: "Webinario",
  material: "Produto",
  mentoria: "Mentoria"
};

export function kindForFormat(format: ProductFormat): ContentKind {
  return kindByFormat[format];
}

/** Formato de um content_items.kind; "Aula" nao e produto e devolve null. */
export function formatFromKind(kind: ContentKind | string | null | undefined): ProductFormat | null {
  switch (kind) {
    case "Curso":
      return "curso";
    case "Formacao":
      return "formacao";
    case "Mentoria":
      return "mentoria";
    case "Bootcamp":
      return "bootcamp";
    case "Produto":
    case "Material":
      return "material";
    case "Webinario":
      return "gravacao_live";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Situação (estado editável do produtor)
 * ---------------------------------------------------------------------------------------------- */

export const PRODUCT_SITUATIONS = ["draft", "published", "archived"] as const satisfies readonly ContentPublicationStatus[];
export type ProductSituation = (typeof PRODUCT_SITUATIONS)[number];

export const PRODUCT_SITUATION_LABELS: Record<ProductSituation, string> = {
  archived: "Arquivado",
  draft: "Rascunho",
  published: "Publicado"
};

export function situationFromPublicationStatus(value: string | null | undefined): ProductSituation {
  return value === "draft" || value === "archived" ? value : "published";
}

/* ------------------------------------------------------------------------------------------------
 * Quem pode ver
 * ---------------------------------------------------------------------------------------------- */

export const PRODUCT_AUDIENCES = ["with_access", "all_students", "hidden"] as const;
export type ProductAudience = (typeof PRODUCT_AUDIENCES)[number];

export const PRODUCT_AUDIENCE_LABELS: Record<ProductAudience, string> = {
  all_students: "Todos os alunos",
  hidden: "Oculto por enquanto",
  with_access: "Só quem tem acesso"
};

export const PRODUCT_LISTINGS = ["listed", "hidden"] as const;
export type ProductListing = (typeof PRODUCT_LISTINGS)[number];

export function audienceFromColumns(columns: {
  accessModel: ContentAccessModel | string | null | undefined;
  listing: ProductListing | string | null | undefined;
}): ProductAudience {
  if (columns.listing === "hidden") {
    return "hidden";
  }

  return columns.accessModel === "free" ? "all_students" : "with_access";
}

export type AudienceColumns = {
  access_model: ContentAccessModel;
  is_locked: boolean;
  listing: ProductListing;
};

/** Colunas gravadas para cada "Quem pode ver". is_locked e legado (ja nao autoriza nada desde 01/10/2026). */
export function audienceToColumns(audience: ProductAudience): AudienceColumns {
  switch (audience) {
    case "all_students":
      return { access_model: "free", is_locked: false, listing: "listed" };
    case "hidden":
      return { access_model: "closed", is_locked: true, listing: "hidden" };
    default:
      return { access_model: "closed", is_locked: true, listing: "listed" };
  }
}

/**
 * content_items.status (ContentStatus) que a area do aluno ainda le ate a fase 3.
 * "Bloqueado" vira "Liberado" para quem tem acesso (applyAccessPreviewToItem em platform-store.ts);
 * por isso produto fechado grava "Bloqueado" e nunca "Em breve" (que esconderia o produto de quem comprou).
 */
export function deriveLegacyContentStatus(audience: ProductAudience): ContentStatus {
  return audience === "all_students" ? "Liberado" : "Bloqueado";
}

/** content_items.purchase_label legado: "Comprar" quando e fechado e tem link; texto proprio vence. */
export function deriveLegacyPurchaseLabel(input: {
  audience: ProductAudience;
  purchaseLabel?: string | null;
  purchaseUrl?: string | null;
}) {
  const custom = input.purchaseLabel?.trim();

  if (custom) {
    return custom;
  }

  return input.audience !== "all_students" && input.purchaseUrl?.trim() ? "Comprar" : null;
}

/**
 * "Em breve" calculado (docs/17 §1.3): quem nao tem acesso ve "Em breve" quando o produto e fechado e
 * nao tem link de compra. Usado como chip extra na lista de produtos; nunca gravado.
 */
export function isComingSoonForVisitors(input: {
  audience: ProductAudience;
  purchaseUrl?: string | null;
  situation: ProductSituation;
}) {
  return input.situation === "published" && input.audience === "with_access" && !input.purchaseUrl?.trim();
}

/** "Novo" calculado: publicado ha menos de 14 dias. */
export const NEW_PRODUCT_WINDOW_DAYS = 14;

export function isNewProduct(publishedAt: string | null | undefined, now: Date = new Date()) {
  if (!publishedAt) {
    return false;
  }

  const published = new Date(publishedAt).getTime();

  return Number.isFinite(published) && now.getTime() - published < NEW_PRODUCT_WINDOW_DAYS * 86_400_000 && published <= now.getTime();
}

/**
 * Vitrine e listas de "comprar" mostram so produtos listados. Oculto aparece apenas para quem tem
 * acesso (Minhas compras e a pagina do produto); para os demais, o produto nao existe.
 */
export function isListedInStorefront(item: { listing?: ProductListing | string | null }) {
  return item.listing !== "hidden";
}

export function canSeeProduct(item: { listing?: ProductListing | string | null }, hasAccess: boolean) {
  return isListedInStorefront(item) || hasAccess;
}

/* ------------------------------------------------------------------------------------------------
 * Bucket, id e ordem (compatibilidade com o leitor atual do aluno)
 * ---------------------------------------------------------------------------------------------- */

export type ContentBucket =
  | "bootcamps"
  | "continue_watching"
  | "courses"
  | "formation_internal_courses"
  | "formations"
  | "recent_lessons"
  | "upcoming_products";

/** Mesmo criterio de getContentBucket (platform-store.ts) para os formatos de produto. */
export function bucketForProduct(format: ProductFormat, commerceScope: CommerceScope = "sellable_product"): ContentBucket {
  if (format === "formacao") {
    return "formations";
  }

  if (format === "bootcamp") {
    return "bootcamps";
  }

  return commerceScope === "included_content" ? "formation_internal_courses" : "courses";
}

/** Buckets que a lista principal de Produtos ignora (itens de demonstracao antigos, nao sao produtos). */
export const NON_PRODUCT_BUCKETS: readonly ContentBucket[] = ["continue_watching", "recent_lessons"];

/** Prefixo de id igual ao normalizeContentInput do platform-store, para ids novos e antigos conviverem. */
export function idPrefixForProduct(format: ProductFormat, commerceScope: CommerceScope = "sellable_product") {
  switch (format) {
    case "formacao":
      return "formation";
    case "mentoria":
      return "mentorship";
    case "gravacao_live":
      return "webinar";
    case "material":
      return "product";
    case "bootcamp":
      return "bootcamp";
    default:
      return commerceScope === "included_content" ? "formation-course" : "course";
  }
}

export function slugifyTitle(title: string, maxLength = 48) {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** Id estavel e legivel: `${prefixo}-${slug}-${tempo em base 36}` (mesmo formato do makeId legado). */
export function makeCatalogId(prefix: string, title: string, now: number = Date.now()) {
  const slug = slugifyTitle(title);

  return slug ? `${prefix}-${slug}-${now.toString(36)}` : `${prefix}-${now.toString(36)}`;
}

/* ------------------------------------------------------------------------------------------------
 * Módulos e aulas
 * ---------------------------------------------------------------------------------------------- */

/**
 * "Ver como aluno" mostra o que o aluno ve, e o aluno so ve produto e aula publicados (o modo de
 * previa que mostra rascunhos para a equipe fica para depois; ver docs/17, Registro da fase 1).
 * Devolve o motivo para o botao ficar desativado, ou null quando o link ja leva a algo.
 */
export function studentPreviewBlockedReason(input: { lessonPublished?: boolean; productPublished: boolean }) {
  if (!input.productPublished) {
    return "Disponível depois de publicar";
  }

  if (input.lessonPublished === false) {
    return "Disponível depois de publicar a aula";
  }

  return null;
}

/**
 * Playlist que ja virou curso: importar de novo regravaria nome, descricao e aulas desse curso por
 * cima do que o produtor editou. A tela mostra o aviso com o link e o servidor recusa com 409.
 */
export function playlistAlreadyImportedMessage(courseTitle: string | null | undefined) {
  const name = courseTitle?.trim();

  return name
    ? `Esta playlist já virou o curso “${name}”. Abra o curso para editar.`
    : "Esta playlist já virou um curso. Abra o curso para editar.";
}

/** Limites para CRIAR modulos e aulas no admin novo (criar e colar). */
export const MAX_MODULES_PER_PRODUCT = 50;
export const MAX_LESSONS_PER_MODULE = 100;
export const MAX_LESSONS_PER_PASTE = 100;

/**
 * Tamanho maximo da estrutura que ja existe, aceita ao reordenar: o mesmo da importacao de playlist
 * (import_youtube_course aceita 100 modulos e 500 aulas por modulo) e acima dos limites de criacao,
 * porque reordenar manda a estrutura COMPLETA do produto. Um curso importado com um modulo de 150
 * aulas precisa poder ser reordenado, inclusive para tirar aulas desse modulo.
 */
export const MAX_STRUCTURE_MODULES = 100;
export const MAX_STRUCTURE_LESSONS_PER_MODULE = 500;

/** lessons.status e course_modules.status. "deleted" = excluido com Desfazer (some para o aluno e para o admin). */
export const STRUCTURE_STATUSES = ["published", "draft", "deleted"] as const;
export type StructureStatus = (typeof STRUCTURE_STATUSES)[number];
export type LessonStatus = Exclude<StructureStatus, "deleted">;

export const LESSON_STATUS_LABELS: Record<LessonStatus, string> = {
  draft: "Rascunho",
  published: "Publicada"
};

/**
 * Situacao de uma aula nova: dentro de produto em rascunho nasce publicada (publicar o produto publica
 * tudo de uma vez); dentro de produto ja publicado ou arquivado nasce em rascunho, para nao aparecer
 * pela metade para os alunos.
 */
export function initialLessonStatus(productSituation: ProductSituation): LessonStatus {
  return productSituation === "draft" ? "published" : "draft";
}

export function isRestorableStatus(value: unknown): value is LessonStatus {
  return value === "published" || value === "draft";
}

export type PastedLesson = {
  title: string;
  /** Texto do link exatamente como colado; o servidor passa por detectLessonVideo. */
  videoInput?: string;
};

const wholeLinkPattern = /^(?:https?:\/\/\S+|<iframe\b[\s\S]*)$/i;

/**
 * "Colar várias linhas cria várias aulas" (docs/17 §1.6.3). Cada linha nao vazia vira uma aula:
 * - "Título | https://link" -> titulo + video;
 * - "https://link" ou "<iframe ...>" -> video sem titulo (o servidor sugere o titulo do provedor ou "Aula N");
 * - "Título" -> aula sem video.
 * Linhas alem de MAX_LESSONS_PER_PASTE sao descartadas pelo chamador (a UI avisa).
 */
export function parseLessonPaste(text: string): PastedLesson[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (wholeLinkPattern.test(line)) {
        return { title: "", videoInput: line };
      }

      const pipeIndex = line.lastIndexOf("|");

      if (pipeIndex > 0) {
        const title = line.slice(0, pipeIndex).trim();
        const rest = line.slice(pipeIndex + 1).trim();

        if (wholeLinkPattern.test(rest)) {
          return { title, videoInput: rest };
        }
      }

      return { title: line };
    });
}

/* ------------------------------------------------------------------------------------------------
 * Liberação em frases (docs/17 §1.3)
 * ---------------------------------------------------------------------------------------------- */

export type ReleasePhrase =
  | { mode: "immediate" }
  | { amount: number; mode: "after_access"; unit: "dias" | "horas" }
  | { date: string; mode: "fixed_date" }
  | { mode: "after_previous_lesson" };

/** Regra gravada -> frase. "after_enrollment" e "after_purchase" viram uma coisa so: "depois de ganhar acesso". */
export function releaseRuleToPhrase(rule: ReleaseRuleConfig | null | undefined): ReleasePhrase {
  if (!rule || rule.mode === "immediate") {
    return { mode: "immediate" };
  }

  if (rule.mode === "after_enrollment" || rule.mode === "after_purchase") {
    const amount = Number(rule.delayValue ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return { mode: "immediate" };
    }

    return { amount, mode: "after_access", unit: rule.delayUnit === "horas" ? "horas" : "dias" };
  }

  if (rule.mode === "fixed_date") {
    return rule.fixedDate ? { date: rule.fixedDate, mode: "fixed_date" } : { mode: "immediate" };
  }

  if (rule.mode === "after_previous_lesson") {
    return { mode: "after_previous_lesson" };
  }

  // activity_required nunca foi liberado para o aluno (release-policy.ts); tratamos como imediato no
  // editor e o servidor so regrava se o produtor mudar a frase.
  return { mode: "immediate" };
}

/**
 * Frase -> regra gravada. Imediato grava null. "Depois de ganhar acesso" grava "after_enrollment"
 * (mesma semantica de "after_purchase" em release-policy.ts) ate a migracao para "after_access".
 */
export function releasePhraseToRule(phrase: ReleasePhrase): ReleaseRuleConfig | null {
  switch (phrase.mode) {
    case "after_access":
      return phrase.amount > 0
        ? { delayUnit: phrase.unit, delayValue: String(phrase.amount), mode: "after_enrollment" }
        : null;
    case "fixed_date":
      return { fixedDate: phrase.date, mode: "fixed_date" };
    case "after_previous_lesson":
      return { mode: "after_previous_lesson" };
    default:
      return null;
  }
}

function formatShortDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo", year: "numeric" }).format(date);
}

/** Texto curto da linha da arvore: "Libera na hora", "Libera 7 dias depois do acesso"... */
export function describeReleasePhrase(phrase: ReleasePhrase) {
  switch (phrase.mode) {
    case "after_access": {
      const unit = phrase.unit === "horas"
        ? (phrase.amount === 1 ? "hora" : "horas")
        : (phrase.amount === 1 ? "dia" : "dias");

      return `Libera ${phrase.amount} ${unit} depois do acesso`;
    }
    case "fixed_date":
      return `Libera em ${formatShortDate(phrase.date)}`;
    case "after_previous_lesson":
      return "Libera depois da aula anterior";
    default:
      return "Libera na hora";
  }
}

export type ReleaseEntity = "aula" | "módulo" | "produto";

/** Previa em frase completa para o editor: "O aluno verá esta aula 7 dias depois de ganhar acesso." */
export function describeReleaseForStudent(phrase: ReleasePhrase, entity: ReleaseEntity) {
  const subject = entity === "aula" ? "esta aula" : entity === "módulo" ? "este módulo" : "este produto";

  switch (phrase.mode) {
    case "after_access": {
      const unit = phrase.unit === "horas"
        ? (phrase.amount === 1 ? "hora" : "horas")
        : (phrase.amount === 1 ? "dia" : "dias");

      return `O aluno verá ${subject} ${phrase.amount} ${unit} depois de ganhar acesso.`;
    }
    case "fixed_date":
      return `O aluno verá ${subject} a partir de ${formatShortDate(phrase.date)}.`;
    case "after_previous_lesson":
      return `O aluno verá ${subject} depois de concluir a aula anterior.`;
    default:
      return `O aluno verá ${subject} assim que ganhar acesso.`;
  }
}

/** Data escolhida no campo (AAAA-MM-DD, horario de Sao Paulo) -> ISO a meia-noite de Sao Paulo (03:00Z). */
export function releaseDateInputToIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T03:00:00.000Z` : null;
}

/** ISO gravado -> valor do campo de data (AAAA-MM-DD em Sao Paulo). */
export function releaseIsoToDateInput(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo", year: "numeric" }).format(date);
}

/* ------------------------------------------------------------------------------------------------
 * Publicar com checklist (docs/17 §1.6.6)
 * ---------------------------------------------------------------------------------------------- */

export type PublishChecklistItemId = "cover" | "lessons" | "videos" | "audience" | "purchase_url";
export type PublishChecklistState = "ok" | "warning" | "blocker";

export type PublishChecklistItem = {
  detail?: string;
  id: PublishChecklistItemId;
  label: string;
  state: PublishChecklistState;
};

export type PublishChecklistInput = {
  audience: ProductAudience;
  format: ProductFormat;
  hasCover: boolean;
  /** Aulas publicadas e nao excluidas do produto (para Formação: somadas dos cursos incluidos). */
  publishedLessons: number;
  /** Aulas publicadas sem video configurado. */
  publishedLessonsWithoutVideo: number;
  purchaseUrl?: string | null;
};

export type PublishChecklist = {
  canPublish: boolean;
  items: PublishChecklistItem[];
};

/**
 * Bloqueiam: sem capa (o card do aluno e a capa) e zero aulas publicadas ("Publique pelo menos uma aula").
 * Avisam sem bloquear: aula publicada sem video e produto fechado sem link de compra.
 */
export function evaluatePublishChecklist(input: PublishChecklistInput): PublishChecklist {
  const isFormation = input.format === "formacao";
  const items: PublishChecklistItem[] = [
    input.hasCover
      ? { id: "cover", label: "Capa", state: "ok" }
      : { detail: "Adicione uma capa: ela é o card que o aluno vê.", id: "cover", label: "Capa", state: "blocker" },
    input.publishedLessons > 0
      ? {
          detail: `${input.publishedLessons} ${input.publishedLessons === 1 ? "aula publicada" : "aulas publicadas"}`,
          id: "lessons",
          label: "Pelo menos 1 aula publicada",
          state: "ok"
        }
      : {
          detail: isFormation
            ? "Publique pelo menos uma aula em um curso desta formação."
            : "Publique pelo menos uma aula.",
          id: "lessons",
          label: "Pelo menos 1 aula publicada",
          state: "blocker"
        },
    input.publishedLessonsWithoutVideo > 0
      ? {
          detail: `${input.publishedLessonsWithoutVideo} ${input.publishedLessonsWithoutVideo === 1 ? "aula publicada está" : "aulas publicadas estão"} sem vídeo.`,
          id: "videos",
          label: "Vídeos prontos",
          state: "warning"
        }
      : { id: "videos", label: "Vídeos prontos", state: "ok" },
    { detail: PRODUCT_AUDIENCE_LABELS[input.audience], id: "audience", label: "Quem pode ver", state: "ok" }
  ];

  if (input.audience === "with_access") {
    items.push(
      input.purchaseUrl?.trim()
        ? { id: "purchase_url", label: "Link de compra", state: "ok" }
        : {
            detail: "Sem link, o aluno sem acesso verá \"Em breve\".",
            id: "purchase_url",
            label: "Link de compra",
            state: "warning"
          }
    );
  }

  return { canPublish: items.every((item) => item.state !== "blocker"), items };
}

/* ------------------------------------------------------------------------------------------------
 * Cor do produto (content_page_settings.settings.accent, docs/17 §2.4 e §2.7)
 * ---------------------------------------------------------------------------------------------- */

export const PRODUCT_ACCENTS = {
  bege: "#d9c3a6",
  ciano: "#67e8f9",
  laranja: "#ffb257",
  lima: "#c4f05a",
  rosa: "#f0abfc",
  roxo: "#b89cff"
} as const;

export type ProductAccent = keyof typeof PRODUCT_ACCENTS;

export const PRODUCT_ACCENT_ORDER: readonly ProductAccent[] = ["lima", "laranja", "roxo", "bege", "ciano", "rosa"];

export const PRODUCT_ACCENT_LABELS: Record<ProductAccent, string> = {
  bege: "Bege",
  ciano: "Ciano",
  laranja: "Laranja",
  lima: "Lima",
  rosa: "Rosa",
  roxo: "Roxo"
};

export function isProductAccent(value: unknown): value is ProductAccent {
  return typeof value === "string" && Object.hasOwn(PRODUCT_ACCENTS, value);
}

/** Cor gravada quando valida; senao uma das seis, estavel pelo id (o mesmo produto sempre na mesma cor). */
export function resolveProductAccent(productId: string, stored?: unknown): ProductAccent {
  if (isProductAccent(stored)) {
    return stored;
  }

  let hash = 0;

  for (const character of productId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return PRODUCT_ACCENT_ORDER[hash % PRODUCT_ACCENT_ORDER.length];
}
