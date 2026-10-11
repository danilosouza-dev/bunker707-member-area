// Schemas zod das entradas de Produtos (docs/17 §2.3: "o mesmo schema valida Server Action e rota").
// Modulo puro: o formulario do cliente pode reutilizar para validar ao sair do campo, e
// tests/catalog-schemas.test.mjs carrega direto pelo Node. Mensagens em portugues do produtor.

import { z } from "zod";
import { extractYouTubePlaylistId } from "../../lib/youtube-course-import";
import {
  CREATABLE_PRODUCT_FORMATS,
  MAX_LESSONS_PER_PASTE,
  MAX_STRUCTURE_LESSONS_PER_MODULE,
  MAX_STRUCTURE_MODULES,
  PRODUCT_ACCENT_ORDER,
  PRODUCT_AUDIENCES,
  PRODUCT_FORMATS,
  PRODUCT_SITUATIONS,
  type ProductAccent
} from "./model";

/* ------------------------------------------------------------------------------------------------
 * Blocos
 * ---------------------------------------------------------------------------------------------- */

/** Ids de content_items, course_modules e lessons: texto simples (ex.: course-ia-mf3k2, yt-course-PL...). */
export const catalogIdSchema = z
  .string({ error: "Identificador inválido." })
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,240}$/, "Identificador inválido.");

/** updated_at lido pela tela; a escrita falha com 409 se o registro mudou depois disso. */
export const expectedUpdatedAtSchema = z.iso.datetime({ error: "Recarregue a página e tente de novo.", offset: true });

export const productTitleSchema = z
  .string({ error: "Dê um nome ao produto." })
  .trim()
  .min(3, "Use pelo menos 3 caracteres.")
  .max(80, "Use no máximo 80 caracteres.");

export const shortDescriptionSchema = z.string().trim().max(300, "Use no máximo 300 caracteres.");

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2_048, "Link longo demais.")
  .refine(isHttpsUrl, "Use um link que comece com https://.");

/** Link de compra opcional: vazio vira null. */
export const purchaseUrlSchema = z
  .union([z.literal(""), httpsUrlSchema])
  .nullish()
  .transform((value) => (value ? value : null));

/**
 * Imagem recortada no cliente (docs/17 §2.3): WebP em data URL. Capa 720×1040 e hero 1920×720, ate
 * 150 KB; aceitamos ate 300 KB de texto base64 (~220 KB de arquivo) como folga. O servidor valida as
 * dimensoes lendo o cabecalho WebP, envia ao Storage (persistImageAsset) e grava so a URL publica.
 * Colar um link https tambem vale (a imagem fica onde esta).
 */
export const webpDataUrlSchema = z
  .string()
  .max(300_000, "A imagem ficou grande demais. Recorte de novo.")
  .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/, "Envie a imagem recortada (WebP).");

/** Espaco, aspas, parenteses, sinais de tag e barra invertida: quebram o `url(...)` do CSS. */
const UNSAFE_IMAGE_LINK_CHARACTERS = /[\s"'()<>\\]/;

export const IMAGE_LINK_MESSAGE = "Use um link de imagem que comece com https://, sem espaços, aspas nem parênteses.";

/**
 * Link de imagem colado (capa de produto, capa de modulo, imagens da Area de membros): https e sem os
 * caracteres que a area do aluno nao consegue desenhar como fundo (`url(...)`). Um link com `)` ou
 * aspas fecharia o url() e injetaria CSS na home de todos os alunos.
 */
export const imageLinkSchema = httpsUrlSchema.refine((value) => !UNSAFE_IMAGE_LINK_CHARACTERS.test(value), IMAGE_LINK_MESSAGE);

const WEBP_DATA_URL_MAX_LENGTH = 300_000;

export const imageInputSchema = z.union([webpDataUrlSchema, imageLinkSchema], {
  error: (issue) => {
    if (typeof issue.input !== "string" || !issue.input.startsWith("data:")) {
      return IMAGE_LINK_MESSAGE;
    }

    return issue.input.length > WEBP_DATA_URL_MAX_LENGTH ? "A imagem ficou grande demais. Recorte de novo." : "Envie a imagem recortada (WebP).";
  }
});

export const productFormatSchema = z.enum(PRODUCT_FORMATS, { error: "Escolha um formato." });
export const creatableFormatSchema = z.enum(CREATABLE_PRODUCT_FORMATS, { error: "Escolha um formato." });
export const productAudienceSchema = z.enum(PRODUCT_AUDIENCES, { error: "Escolha quem pode ver." });
export const productSituationSchema = z.enum(PRODUCT_SITUATIONS);
export const productAccentSchema = z.enum(PRODUCT_ACCENT_ORDER as [ProductAccent, ...ProductAccent[]]);

export const releasePhraseSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("immediate") }),
  z.object({
    amount: z.number().int("Use um número inteiro.").min(1, "Use pelo menos 1.").max(3_650, "Use no máximo 3.650."),
    mode: z.literal("after_access"),
    unit: z.enum(["dias", "horas"]).default("dias")
  }),
  z.object({ date: z.iso.datetime({ error: "Escolha uma data válida.", offset: true }), mode: z.literal("fixed_date") }),
  z.object({ mode: z.literal("after_previous_lesson") })
]);

/* ------------------------------------------------------------------------------------------------
 * Lista
 * ---------------------------------------------------------------------------------------------- */

export const PRODUCT_LIST_PAGE_SIZE = 25;

export const productListQuerySchema = z.object({
  format: productFormatSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1_000).default(1).catch(1),
  q: z.string().trim().max(80).optional().catch(undefined).transform((value) => value || undefined),
  situation: productSituationSchema.optional().catch(undefined)
});

type SearchParamsLike = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** searchParams de /admin/produtos (?formato=&situacao=&busca=&pagina=) -> consulta valida; lixo vira padrao. */
export function parseProductListSearchParams(searchParams: SearchParamsLike) {
  return productListQuerySchema.parse({
    format: first(searchParams.formato) || undefined,
    page: first(searchParams.pagina) || undefined,
    q: first(searchParams.busca) || undefined,
    situation: first(searchParams.situacao) || undefined
  });
}

/* ------------------------------------------------------------------------------------------------
 * Produto
 * ---------------------------------------------------------------------------------------------- */

export const createProductSchema = z
  .object({
    audience: productAudienceSchema.default("with_access"),
    cover: imageInputSchema.nullish(),
    format: creatableFormatSchema.default("curso"),
    /** "Criar curso aqui" dentro de uma Formação: o curso nasce incluido nela. */
    parentFormationId: catalogIdSchema.optional(),
    purchaseUrl: purchaseUrlSchema,
    shortDescription: shortDescriptionSchema.default(""),
    title: productTitleSchema
  })
  .refine((input) => !input.parentFormationId || input.format === "curso", {
    message: "Dentro de uma formação só entram cursos.",
    path: ["format"]
  });

export const renameProductSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  id: catalogIdSchema,
  title: productTitleSchema
});

/**
 * Aba Detalhes. Campos ausentes nao mudam; null limpa. `format` so muda entre formatos que nao sao
 * Formação e quando o produto nao tem acessos ativos (o tipo de acesso gravado depende do formato).
 * Descricao longa fica fora da fase 1: nao ha onde a area do aluno a mostre.
 */
export const updateProductDetailsSchema = z.object({
  accent: productAccentSchema.optional(),
  coursePresentationMode: z.enum(["module_cards", "lesson_playlist"]).optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  format: productFormatSchema.optional(),
  id: catalogIdSchema,
  instructorName: z.string().trim().max(80, "Use no máximo 80 caracteres.").nullish(),
  level: z.string().trim().max(40, "Use no máximo 40 caracteres.").nullish(),
  lockedActionMode: z.enum(["details_modal", "external_link"]).optional(),
  shortDescription: shortDescriptionSchema.optional(),
  title: productTitleSchema.optional()
});

/** Aba Acesso e venda. */
export const updateProductAccessSchema = z.object({
  audience: productAudienceSchema.optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  id: catalogIdSchema,
  maxStudents: z.number().int().min(1, "Use pelo menos 1.").max(1_000_000).nullish(),
  purchaseLabel: z.string().trim().max(40, "Use no máximo 40 caracteres.").nullish(),
  purchaseTarget: z.enum(["same_tab", "new_tab"]).optional(),
  purchaseUrl: purchaseUrlSchema.optional(),
  release: releasePhraseSchema.optional()
});

export const setProductImageSchema = z.object({
  id: catalogIdSchema,
  image: imageInputSchema.nullable(),
  slot: z.enum(["cover", "hero"])
});

export const publishProductSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  id: catalogIdSchema
});

/** Rascunho ou Arquivado (Publicar tem acao propria, com checklist). */
export const setProductSituationSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  id: catalogIdSchema,
  situation: z.enum(["draft", "archived"])
});

/** Excluir produto: confirmacao digitando o nome (sem window.confirm). */
export const deleteProductSchema = z.object({
  confirmTitle: z.string().trim().min(1, "Digite o nome do produto para confirmar."),
  id: catalogIdSchema
});

/* ------------------------------------------------------------------------------------------------
 * Conteúdo: módulos e aulas
 * ---------------------------------------------------------------------------------------------- */

export const structureTitleSchema = z
  .string({ error: "Dê um nome." })
  .trim()
  .min(1, "Dê um nome.")
  .max(120, "Use no máximo 120 caracteres.");

export const createModuleSchema = z.object({
  /** Insere logo depois deste modulo; ausente = no fim. */
  afterModuleId: catalogIdSchema.optional(),
  productId: catalogIdSchema,
  title: structureTitleSchema
});

export const updateModuleSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  id: catalogIdSchema,
  release: releasePhraseSchema.optional(),
  title: structureTitleSchema.optional()
});

/** Cada item vem de uma linha digitada ou colada (parseLessonPaste); video e o texto cru do link. */
export const createLessonsSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().max(120, "Use no máximo 120 caracteres.").default(""),
        videoInput: z.string().trim().max(16_384).optional()
      })
    )
    .min(1, "Adicione pelo menos uma aula.")
    .max(MAX_LESSONS_PER_PASTE, `Cole no máximo ${MAX_LESSONS_PER_PASTE} aulas de uma vez.`),
  moduleId: catalogIdSchema
});

/**
 * Capa do modulo (aba Conteúdo, menu do modulo › "Trocar capa do módulo…"): WebP 720×1040 recortado no
 * cliente (mesma medida da capa do produto) ou link https; null = voltar para a capa do produto.
 */
export const setModuleCoverSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  image: imageInputSchema.nullable(),
  moduleId: catalogIdSchema
});

/** Painel da aula. `videoInput` = texto colado (null remove o video); `allowEmbedCode` = "Outro provedor". */
export const updateLessonSchema = z.object({
  allowEmbedCode: z.boolean().default(false),
  description: z.string().trim().max(5_000, "Use no máximo 5.000 caracteres.").optional(),
  durationLabel: z.string().trim().max(20, "Use no máximo 20 caracteres.").optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  id: catalogIdSchema,
  release: releasePhraseSchema.optional(),
  status: z.enum(["published", "draft"]).optional(),
  title: structureTitleSchema.optional(),
  videoInput: z.string().trim().max(16_384).nullish()
});

export const setLessonsStatusSchema = z.object({
  ids: z.array(catalogIdSchema).min(1).max(500),
  status: z.enum(["published", "draft"])
});

/** Excluir com Desfazer: a resposta devolve o status anterior de cada item para o restore. */
export const softDeleteStructureSchema = z.object({
  ids: z.array(catalogIdSchema).min(1).max(500),
  kind: z.enum(["module", "lesson"])
});

export const restoreStructureSchema = z.object({
  items: z
    .array(z.object({ id: catalogIdSchema, previousStatus: z.enum(["published", "draft"]) }))
    .min(1)
    .max(500),
  kind: z.enum(["module", "lesson"])
});

/**
 * Reordenar salva tudo de uma vez: a ordem completa dos modulos (nao excluidos) do produto e a lista
 * completa de aulas de cada um. Os limites sao os da estrutura existente (MAX_STRUCTURE_*), nao os de
 * criacao: um modulo importado com mais de 100 aulas continua reordenavel. Mover aula entre modulos = aparecer na lista do outro modulo.
 * O servidor recusa com 409 se o conjunto de ids nao for exatamente o que esta no banco.
 */
export const reorderContentSchema = z.object({
  modules: z
    .array(
      z.object({
        id: catalogIdSchema,
        lessonIds: z
          .array(catalogIdSchema)
          .max(MAX_STRUCTURE_LESSONS_PER_MODULE, `No máximo ${MAX_STRUCTURE_LESSONS_PER_MODULE} aulas por módulo.`)
      })
    )
    .max(MAX_STRUCTURE_MODULES, `No máximo ${MAX_STRUCTURE_MODULES} módulos por produto.`),
  productId: catalogIdSchema
});

/* ------------------------------------------------------------------------------------------------
 * Formação
 * ---------------------------------------------------------------------------------------------- */

export const formationCourseSchema = z.object({
  courseId: catalogIdSchema,
  formationId: catalogIdSchema
});

export const reorderFormationCoursesSchema = z.object({
  formationId: catalogIdSchema,
  orderedCourseIds: z.array(catalogIdSchema).max(100)
});

/* ------------------------------------------------------------------------------------------------
 * Pacotes (antigos combos)
 * ---------------------------------------------------------------------------------------------- */

export const comboSchema = z.object({
  cohortName: z.string().trim().max(80, "Use no máximo 80 caracteres.").default(""),
  description: z.string().trim().max(300, "Use no máximo 300 caracteres.").default(""),
  id: catalogIdSchema.optional(),
  name: z.string().trim().min(2, "Dê um nome ao pacote.").max(80, "Use no máximo 80 caracteres."),
  productIds: z.array(catalogIdSchema).min(1, "Escolha pelo menos um produto.").max(50),
  status: z.enum(["active", "draft", "paused"]).default("draft")
});

export const deleteComboSchema = z.object({ id: catalogIdSchema });

/* ------------------------------------------------------------------------------------------------
 * Vídeo
 * ---------------------------------------------------------------------------------------------- */

export const videoPreviewSchema = z.object({
  allowEmbedCode: z.boolean().default(false),
  videoInput: z.string().trim().min(1, "Cole o link do vídeo.").max(16_384)
});

/* ------------------------------------------------------------------------------------------------
 * Acréscimos da frente A (fase 1)
 * ---------------------------------------------------------------------------------------------- */

/** Acoes que so recebem o produto (ex.: loadPublishChecklist). */
export const productIdInputSchema = z.object({ id: catalogIdSchema });

/** "Ler playlist" (/admin/produtos/importar). */
export const previewPlaylistSchema = z.object({
  playlistUrl: z
    .string({ error: "Cole o link de uma playlist do YouTube." })
    .trim()
    .min(1, "Cole o link de uma playlist do YouTube.")
    .max(2_048, "Link longo demais.")
    .refine((value) => Boolean(extractYouTubePlaylistId(value)), "Cole o link de uma playlist do YouTube.")
});

export const playlistModuleRangeSchema = z.object({
  endPosition: z.number().int().min(1).max(5_000),
  startPosition: z.number().int().min(1).max(5_000),
  title: z.string().trim().max(180, "Use no máximo 180 caracteres.").default("")
});

/**
 * "Importar como rascunho". Mesmo formato de YouTubeCourseImportCommitInput (o legado continua igual)
 * mais `audience` opcional: quando presente, decide "Quem pode ver" (inclusive "Oculto por enquanto",
 * que o accessModel sozinho nao expressa) e prevalece sobre `accessModel`. Capa: o WebP recortado
 * (720×1040), um link https ou vazio.
 */
export const importPlaylistSchema = z.object({
  accessModel: z.enum(["closed", "free"]).default("closed"),
  audience: productAudienceSchema.optional(),
  coursePresentationMode: z.enum(["lesson_playlist", "module_cards"]).default("lesson_playlist"),
  description: z.string().trim().max(10_000, "Use no máximo 10.000 caracteres.").default(""),
  image: z.union([z.literal(""), webpDataUrlSchema, httpsUrlSchema]).default(""),
  moduleRanges: z.array(playlistModuleRangeSchema).max(100, "No máximo 100 módulos.").default([]),
  organizationMode: z.enum(["automatic", "manual_ranges"]).default("automatic"),
  playlistUrl: previewPlaylistSchema.shape.playlistUrl,
  title: productTitleSchema
});
