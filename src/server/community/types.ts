// Contratos da Comunidade v1 (docs/17 §1.9). So tipos; a frente D implementa:
// - leituras em src/server/community/queries.ts ("server-only"), sempre via RPC SQL para contagens;
// - Server Actions em src/server/community/actions.ts ("use server", runAdminAction + ./schemas.ts).
// Comentarios nao fazem parte do cache do catalogo: as acoes chamam refresh() (next/cache), nunca
// invalidateCatalog.

import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import type { AdminBlockedWordRule, LessonCommentAuthorRole, LessonCommentStatus } from "@/lib/platform-types";
import type { ProductAccent } from "@/server/catalog/model";
import type { CommunityPeriod } from "./model";
import type {
  blockedWordSchema,
  commentListQuerySchema,
  communityQuerySchema,
  deleteBlockedWordSchema,
  deleteQuickReplySchema,
  lessonRowsQuerySchema,
  moderateCommentSchema,
  moderateCommentsSchema,
  quickReplySchema,
  replyToCommentSchema,
  resolveCommentSchema,
  toggleBlockedWordSchema
} from "./schemas";

/* ================================================================================================
 * Entradas
 * ============================================================================================== */

/** Filtros da aba mais o periodo ja resolvido (ver resolveCommunityPeriod em ./model). */
export type CommunityQuery = z.output<typeof communityQuerySchema> & { period: CommunityPeriod };
export type CommentListQuery = z.output<typeof commentListQuerySchema> & { period: CommunityPeriod };
export type ReplyToCommentInput = z.input<typeof replyToCommentSchema>;
export type ResolveCommentInput = z.input<typeof resolveCommentSchema>;
export type ModerateCommentInput = z.input<typeof moderateCommentSchema>;
export type QuickReplyInput = z.input<typeof quickReplySchema>;
export type DeleteQuickReplyInput = z.input<typeof deleteQuickReplySchema>;
export type BlockedWordInput = z.input<typeof blockedWordSchema>;
export type ToggleBlockedWordInput = z.input<typeof toggleBlockedWordSchema>;
export type DeleteBlockedWordInput = z.input<typeof deleteBlockedWordSchema>;
export type ModerateCommentsInput = z.input<typeof moderateCommentsSchema>;
export type LessonRowsQuery = z.output<typeof lessonRowsQuerySchema> & { period: CommunityPeriod };
export type LessonRowsSort = LessonRowsQuery["sort"];

/*
 * Janela das listas de trabalho (fila e denuncias): sem ?periodo= explicito no endereco
 * (query.period.explicit), mostram tudo o que esta aberto (a pergunta mais antiga e a mais urgente);
 * com ?periodo=, so o periodo.
 */

/* ================================================================================================
 * Leituras (DTOs)
 * ============================================================================================== */

export type CommunityAuthor = {
  avatarUrl: string | null;
  /** auth.users.id; null quando a conta foi removida. */
  id: string | null;
  initials: string;
  name: string;
};

/** "Produto › Módulo › Aula", com ids para os links "Abrir aula" e filtros. */
export type CommunityLessonPath = {
  /**
   * Painel da aula no admin novo: /admin/produtos/{produto}?aula={aula}. null para quem nao abre a
   * pagina do produto (ex.: Suporte): o "Abrir aula no admin" some (lessonPathFor em scope.ts).
   */
  adminHref: string | null;
  /** Produto em que o aluno comentou (content_id do comentario; pode ser a formacao). */
  contentId: string;
  label: string;
  lessonId: string;
  lessonTitle: string;
  moduleId: string | null;
  moduleTitle: string | null;
  /** Cor do produto dono da aula (avatar e destaque). */
  productAccent: ProductAccent;
  /** Produto dono da aula (modulo.owner_id); cai no content_id quando o modulo nao tem dono. */
  productId: string;
  productTitle: string;
  /** Aula na area do aluno, ou null sem modulo conhecido. */
  studentHref: string | null;
};

/** Numeros do topo (janela fixa de 28 dias; "—" quando null). */
export type CommunityStats = {
  commentsInWindow: number;
  medianResponseHours: number | null;
  oldestUnansweredHours: number | null;
  openReports: number;
  p90ResponseHours: number | null;
  unanswered: number;
  windowDays: number;
};

/**
 * Pergunta sem resposta: comentario raiz de aluno (author_role = "student"), visivel, nao excluido,
 * sem resposta de "producer"/"moderator" e nao resolvido. Ordem: mais antigas primeiro.
 */
export type QueueItem = {
  author: CommunityAuthor;
  body: string;
  createdAt: string;
  id: string;
  /** Mais de 24 h esperando. */
  isOverdue: boolean;
  path: CommunityLessonPath;
  reactionCount: number;
  reportCount: number;
  /** Respostas de outros alunos ja publicadas (contexto antes de responder). */
  studentReplies: { author: CommunityAuthor; body: string; createdAt: string; id: string }[];
};

export type QueuePage = {
  items: QueueItem[];
  page: number;
  pageSize: number;
  query: CommunityQuery;
  total: number;
};

export type CommentListItem = {
  /** Ja tem resposta do professor (so para comentarios raiz). */
  answered: boolean;
  author: CommunityAuthor;
  authorRole: LessonCommentAuthorRole;
  body: string;
  createdAt: string;
  id: string;
  kind: "comment" | "reply";
  parentAuthorName: string | null;
  path: CommunityLessonPath;
  reactionCount: number;
  reportCount: number;
  resolved: boolean;
  status: LessonCommentStatus;
  statusLabel: string;
};

export type CommentListPage = {
  items: CommentListItem[];
  page: number;
  pageSize: number;
  query: CommentListQuery;
  total: number;
};

export type ReportHistoryEntry = {
  action: "approved" | "hidden" | "restored" | "marked_spam";
  actorName: string | null;
  createdAt: string;
  note: string | null;
};

/** Denuncia aberta = comentario visivel com denuncia mais nova que a ultima acao de moderacao. */
export type ReportItem = {
  comment: CommentListItem;
  history: ReportHistoryEntry[];
  lastReportedAt: string;
  open: boolean;
  reasons: string[];
  reportCount: number;
};

/** Top alunos (28 d): comentarios aprovados + respostas a colegas + reacoes recebidas. */
export type TopCommenter = {
  author: CommunityAuthor;
  comments: number;
  reactionsReceived: number;
  repliesToPeers: number;
  score: number;
};

/** Aba Aulas: duvidas (comentarios + perguntas ao Tutor) e avaliacao (Não gostei / Gostei / Amei). */
export type LessonCommunityRow = {
  comments: number;
  path: CommunityLessonPath;
  ratings: {
    /** (Amei - Não gostei) / respostas; null sem respostas. */
    balance: number | null;
    liked: number;
    loved: number;
    notForMe: number;
    total: number;
  };
  /** Mensagens de alunos ao Tutor IA naquela aula, no periodo. */
  tutorQuestions: number;
  unanswered: number;
};

export type QuickReply = {
  body: string;
  id: string;
  title: string;
  updatedAt: string;
};

export type CommunityRules = {
  blockedWords: AdminBlockedWordRule[];
  quickReplies: QuickReply[];
};

/** Opcoes dos filtros Produto e Aula (so produtos/aulas com comentarios). */
export type CommunityFilterOptions = {
  /** formationId: formacao que inclui o curso dono da aula (filtrar pela formacao mostra a aula). */
  lessons: { formationId?: string | null; id: string; label: string; productId: string }[];
  products: { id: string; label: string }[];
};

export type ReportPage = {
  items: ReportItem[];
  page: number;
  pageSize: number;
  query: CommunityQuery;
  total: number;
};

export type LessonRowsPage = {
  items: LessonCommunityRow[];
  page: number;
  pageSize: number;
  query: LessonRowsQuery;
  total: number;
};

/** Resultado da moderacao em massa: o que mudou e o que nao foi possivel (ex.: excluido no meio). */
export type BulkModerationResult = {
  failed: string[];
  status: LessonCommentStatus;
  updated: string[];
};

/* ================================================================================================
 * Assinaturas: leituras (frente D, src/server/community/queries.ts)
 * ============================================================================================== */

export type GetCommunityStats = (query: Pick<CommunityQuery, "product">) => Promise<CommunityStats>;
export type ListUnansweredQueue = (query: CommunityQuery) => Promise<QueuePage>;
export type ListComments = (query: CommentListQuery) => Promise<CommentListPage>;
export type ListReports = (query: CommunityQuery) => Promise<ReportItem[]>;
export type ListTopCommenters = (query: CommunityQuery) => Promise<TopCommenter[]>;
export type ListLessonCommunityRows = (query: CommunityQuery) => Promise<LessonCommunityRow[]>;
export type GetCommunityRules = () => Promise<CommunityRules>;
export type GetCommunityFilterOptions = () => Promise<CommunityFilterOptions>;
/** Contador do menu (Comunidade) e do alerta de Hoje: perguntas sem resposta ha mais de 24 h. */
export type CountOverdueQuestions = () => Promise<number>;
/** Pagina de denuncias (a mesma lista de ListReports, com total para a paginacao). */
export type ListReportsPage = (query: CommunityQuery) => Promise<ReportPage>;
/** Pagina da aba Aulas, ordenada no servidor (mais duvidas, piores ou melhores avaliacoes). */
export type ListLessonCommunityRowsPage = (query: LessonRowsQuery) => Promise<LessonRowsPage>;
/** Respostas rapidas para o editor da fila (sem as palavras bloqueadas). */
export type ListQuickReplies = () => Promise<QuickReply[]>;

/* ================================================================================================
 * Assinaturas: Server Actions (frente D, src/server/community/actions.ts)
 * ============================================================================================== */

export type ReplyToCommentAction = (input: ReplyToCommentInput) => Promise<ActionResult<{ questionId: string; reply: CommentListItem }>>; // [community.reply]
export type ResolveCommentAction = (input: ResolveCommentInput) => Promise<ActionResult<{ commentId: string; resolved: boolean }>>; // [community.reply]
export type ModerateCommentAction = (input: ModerateCommentInput) => Promise<ActionResult<{ commentId: string; status: LessonCommentStatus }>>; // [community.moderate]
export type ModerateCommentsAction = (input: ModerateCommentsInput) => Promise<ActionResult<BulkModerationResult>>; // [community.moderate]
export type SaveQuickReplyAction = (input: QuickReplyInput) => Promise<ActionResult<QuickReply>>; // [community.reply]
export type DeleteQuickReplyAction = (input: DeleteQuickReplyInput) => Promise<ActionResult<{ id: string }>>; // [community.reply]
export type CreateBlockedWordAction = (input: BlockedWordInput) => Promise<ActionResult<AdminBlockedWordRule>>; // [community.moderate]
export type ToggleBlockedWordAction = (input: ToggleBlockedWordInput) => Promise<ActionResult<AdminBlockedWordRule>>; // [community.moderate]
export type DeleteBlockedWordAction = (input: DeleteBlockedWordInput) => Promise<ActionResult<{ id: string }>>; // [community.moderate]
