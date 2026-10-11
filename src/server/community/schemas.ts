// Schemas zod das entradas da Comunidade. Puro: tests/community-model.test.mjs carrega direto.

import { z } from "zod";
import { resolveCommunityPeriod, type CommunityPeriod } from "./model";

const commentIdSchema = z.uuid({ error: "Comentário inválido." });
const simpleIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,240}$/, "Identificador inválido.");

export const COMMUNITY_PAGE_SIZE = 20;

/**
 * Filtros comuns das abas. O periodo (?periodo=) nao passa pelo zod: depende da hora da leitura e vem
 * de resolveCommunityPeriod (./model), com o modelo do admin (Hoje, 1d, 3d, 7d, 30d e os links 7, 30, 90).
 */
export const communityQuerySchema = z.object({
  lesson: simpleIdSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1_000).default(1).catch(1),
  product: simpleIdSchema.optional().catch(undefined)
});

export const commentListQuerySchema = communityQuerySchema.extend({
  answered: z.enum(["sim", "nao"]).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined).transform((value) => value || undefined),
  status: z.enum(["approved", "hidden", "spam", "pending"]).optional().catch(undefined)
});

type SearchParamsLike = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Periodo da aba, lido com a mesma hora para a pagina inteira. */
function readPeriod(searchParams: SearchParamsLike, now: Date): { period: CommunityPeriod } {
  return { period: resolveCommunityPeriod(first(searchParams.periodo), now) };
}

/** ?produto=&aula=&periodo=&pagina= (mesmos nomes dos filtros globais do admin). */
export function parseCommunitySearchParams(searchParams: SearchParamsLike, now: Date = new Date()) {
  return {
    ...communityQuerySchema.parse({
      lesson: first(searchParams.aula) || undefined,
      page: first(searchParams.pagina) || undefined,
      product: first(searchParams.produto) || undefined
    }),
    ...readPeriod(searchParams, now)
  };
}

/** Aba Comentários: acrescenta ?situacao=&respondido=&busca=. */
export function parseCommentListSearchParams(searchParams: SearchParamsLike, now: Date = new Date()) {
  return {
    ...commentListQuerySchema.parse({
      answered: first(searchParams.respondido) || undefined,
      lesson: first(searchParams.aula) || undefined,
      page: first(searchParams.pagina) || undefined,
      product: first(searchParams.produto) || undefined,
      q: first(searchParams.busca) || undefined,
      status: first(searchParams.situacao) || undefined
    }),
    ...readPeriod(searchParams, now)
  };
}

export const commentBodySchema = z
  .string({ error: "Escreva a resposta." })
  .trim()
  .min(1, "Escreva a resposta.")
  .max(2_000, "Use no máximo 2.000 caracteres.");

export const replyToCommentSchema = z.object({
  body: commentBodySchema,
  commentId: commentIdSchema,
  /** Ja respondida: marca como resolvida junto (padrao), tirando da fila. */
  resolve: z.boolean().default(true)
});

export const resolveCommentSchema = z.object({
  commentId: commentIdSchema,
  resolved: z.boolean().default(true)
});

export const moderateCommentSchema = z.object({
  commentId: commentIdSchema,
  note: z.string().trim().max(1_000, "Use no máximo 1.000 caracteres.").optional(),
  status: z.enum(["approved", "hidden", "spam"])
});

export const quickReplySchema = z.object({
  body: z.string().trim().min(1, "Escreva o texto da resposta.").max(2_000, "Use no máximo 2.000 caracteres."),
  id: z.uuid().optional(),
  title: z.string().trim().min(1, "Dê um nome curto.").max(60, "Use no máximo 60 caracteres.")
});

export const deleteQuickReplySchema = z.object({ id: z.uuid() });

export const blockedWordSchema = z.object({
  message: z.string().trim().max(500, "Use no máximo 500 caracteres.").optional(),
  word: z.string().trim().min(1, "Informe a palavra ou o termo.").max(120, "Use no máximo 120 caracteres.")
});

export const toggleBlockedWordSchema = z.object({ active: z.boolean(), id: z.uuid() });
export const deleteBlockedWordSchema = z.object({ id: z.uuid() });

/* ------------------------------------------------------------------------------------------------
 * Acrescimos da frente D (fase 1)
 * ---------------------------------------------------------------------------------------------- */

/** ?periodo= foi escolhido de proposito (e e valido)? Sem ele, fila e denuncias mostram tudo. */
export function hasExplicitPeriod(searchParams: SearchParamsLike, now: Date = new Date()) {
  return resolveCommunityPeriod(first(searchParams.periodo), now).explicit;
}

export const LESSON_ROWS_SORTS = ["doubts", "worst", "best"] as const;

/** Valor de ?ordem= na aba Aulas (palavras do produtor no endereco). */
export const LESSON_ROWS_SORT_PARAMS = {
  best: "melhores",
  doubts: "duvidas",
  worst: "piores"
} as const satisfies Record<(typeof LESSON_ROWS_SORTS)[number], string>;

export const lessonRowsQuerySchema = communityQuerySchema.extend({
  sort: z.enum(LESSON_ROWS_SORTS).default("doubts").catch("doubts")
});

/** Aba Aulas: acrescenta ?ordem=duvidas|piores|melhores. */
export function parseLessonRowsSearchParams(searchParams: SearchParamsLike, now: Date = new Date()) {
  const order = first(searchParams.ordem);
  const sort = (Object.keys(LESSON_ROWS_SORT_PARAMS) as (keyof typeof LESSON_ROWS_SORT_PARAMS)[]).find(
    (key) => LESSON_ROWS_SORT_PARAMS[key] === order
  );

  return {
    ...lessonRowsQuerySchema.parse({
      lesson: first(searchParams.aula) || undefined,
      page: first(searchParams.pagina) || undefined,
      product: first(searchParams.produto) || undefined,
      sort
    }),
    ...readPeriod(searchParams, now)
  };
}

/** Moderacao em massa da aba Comentarios (uma chamada da RPC por comentario). */
export const COMMUNITY_BULK_LIMIT = 50;

export const moderateCommentsSchema = z.object({
  commentIds: z
    .array(commentIdSchema)
    .min(1, "Selecione pelo menos um comentário.")
    .max(COMMUNITY_BULK_LIMIT, `Selecione no máximo ${COMMUNITY_BULK_LIMIT} comentários por vez.`)
    .transform((ids) => Array.from(new Set(ids))),
  note: z.string().trim().max(1_000, "Use no máximo 1.000 caracteres.").optional(),
  status: z.enum(["approved", "hidden", "spam"])
});
