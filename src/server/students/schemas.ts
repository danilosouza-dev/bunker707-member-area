// Schemas zod das entradas de Alunos (docs/17 §1.7 e §2.3: o mesmo schema valida a Server Action e,
// amanha, a rota de webhook que criar aluno a partir de uma venda). Modulo puro: os testes carregam
// pelo Node, por isso os imports sao relativos.

import { z } from "zod";
import { catalogIdSchema } from "../catalog/schemas";
import {
  ACCESS_DELIVERY_METHODS,
  BULK_ACTIONS,
  BULK_BATCH_SIZE,
  IMPORT_BATCH_SIZE,
  IMPORT_DELIVERY_METHODS,
  LIFECYCLE_GROUPS,
  STUDENT_LIST_PARAM_NAMES,
  STUDENT_PACES,
  TEMPORARY_PASSWORD_MIN_LENGTH,
  isLifecycleGroup,
  isStudentPace,
  type StudentListParams,
  type StudentListQuery
} from "./model";

export const STUDENT_LIST_PAGE_SIZE = 25;
const SEARCH_MAX_LENGTH = 120;

export const userIdSchema = z.uuid({ error: "Aluno inválido." });
export const entitlementIdSchema = z.uuid({ error: "Acesso inválido." });

export const studentNameSchema = z
  .string({ error: "Informe o nome do aluno." })
  .trim()
  .min(2, "Use pelo menos 2 caracteres.")
  .max(120, "Use no máximo 120 caracteres.");

export const studentEmailSchema = z
  .string({ error: "Informe o e-mail do aluno." })
  .trim()
  .toLowerCase()
  .max(254, "E-mail longo demais.")
  .pipe(z.email({ error: "E-mail inválido." }));

export const studentPhoneSchema = z
  .string()
  .trim()
  .max(40, "Telefone longo demais.")
  .refine((value) => value === "" || /^\+?[\d\s().-]{8,40}$/.test(value), "Telefone inválido.")
  .nullish()
  .transform((value) => value || null);

/** "AAAA-MM-DD" do campo de data; vazio = sem prazo. */
export const accessEndDateSchema = z.iso.date({ error: "Data inválida." }).nullish();

export const productIdsSchema = z.array(catalogIdSchema).max(50, "Escolha até 50 produtos.");

export const deliverySchema = z.enum(ACCESS_DELIVERY_METHODS, { error: "Escolha como entregar o acesso." });

const optionalTemporaryPasswordSchema = z
  .string()
  .trim()
  .max(72, "Use no máximo 72 caracteres.")
  .nullish()
  .transform((value) => value || null);

export const createStudentSchema = z
  .object({
    cohortId: z.uuid().nullish(),
    delivery: deliverySchema,
    email: studentEmailSchema,
    endsAt: accessEndDateSchema,
    fullName: studentNameSchema,
    phone: studentPhoneSchema,
    productIds: productIdsSchema.default([]),
    temporaryPassword: optionalTemporaryPasswordSchema
  })
  .superRefine((value, context) => {
    if (
      value.delivery === "temporary_password" &&
      value.temporaryPassword &&
      value.temporaryPassword.length < TEMPORARY_PASSWORD_MIN_LENGTH
    ) {
      context.addIssue({
        code: "custom",
        message: `Use pelo menos ${TEMPORARY_PASSWORD_MIN_LENGTH} caracteres ou deixe em branco para gerar uma.`,
        path: ["temporaryPassword"]
      });
    }
  });

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const grantAccessSchema = z.object({
  endsAt: accessEndDateSchema,
  productIds: productIdsSchema.min(1, "Escolha pelo menos um produto."),
  userId: userIdSchema
});

export type GrantAccessInput = z.infer<typeof grantAccessSchema>;

export const ACCESS_ACTIONS = ["extend_30", "extend_90", "set_end", "remove_end", "revoke", "suspend", "reactivate"] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export const accessActionSchema = z
  .object({
    action: z.enum(ACCESS_ACTIONS, { error: "Ação inválida." }),
    endsAt: accessEndDateSchema,
    entitlementId: entitlementIdSchema,
    userId: userIdSchema
  })
  .superRefine((value, context) => {
    if (value.action === "set_end" && !value.endsAt) {
      context.addIssue({ code: "custom", message: "Escolha a nova data de término.", path: ["endsAt"] });
    }
  });

export type AccessActionInput = z.infer<typeof accessActionSchema>;

export const updateStudentProfileSchema = z.object({
  fullName: studentNameSchema,
  phone: studentPhoneSchema,
  userId: userIdSchema
});

export const sendAccessEmailSchema = z.object({ userId: userIdSchema });

export const deleteStudentSchema = z.object({
  confirmEmail: studentEmailSchema,
  userId: userIdSchema
});

export const studentOptionsQuerySchema = z.object({
  productId: catalogIdSchema.nullish(),
  q: z.string().trim().max(80).default("")
});

type SearchParamValue = string | string[] | undefined;

function firstParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros canonicos (segmento salvo e endereco): so valores conhecidos; o resto e ignorado. */
export const studentListParamsSchema = z
  .object({
    account: z.literal("never").optional(),
    cohortId: z.uuid().optional(),
    commenters: z.literal("top").optional(),
    expiring: z.literal(true).optional(),
    group: z.enum(LIFECYCLE_GROUPS).optional(),
    notStarted: z.literal(true).optional(),
    pace: z.enum(STUDENT_PACES).optional(),
    productId: catalogIdSchema.optional(),
    q: z.string().trim().max(SEARCH_MAX_LENGTH).optional(),
    week: z.iso.date().optional()
  })
  .strict();

/** Tira chaves vazias e exige semana e grupo juntos. */
export function normalizeStudentListParams(params: StudentListParams): StudentListParams {
  const next: StudentListParams = {};

  if (params.productId) next.productId = params.productId;
  if (params.pace) next.pace = params.pace;
  if (params.cohortId) next.cohortId = params.cohortId;
  if (params.expiring) next.expiring = true;
  if (params.account === "never") next.account = "never";
  if (params.notStarted) next.notStarted = true;
  if (params.commenters === "top") next.commenters = "top";
  if (params.week && params.group) {
    next.week = params.week;
    next.group = params.group;
  }
  const q = params.q?.trim().slice(0, SEARCH_MAX_LENGTH);
  if (q) next.q = q;

  return next;
}

/** ?busca=&produto=&ritmo=&turma=&expira=30&conta=nunca&comecou=nao&comentadores=top&semana=&grupo=&pagina= */
export function parseStudentListSearchParams(params: Record<string, SearchParamValue> | undefined): StudentListQuery {
  const n = STUDENT_LIST_PARAM_NAMES;
  const pageValue = Number.parseInt(firstParam(params?.[n.page]) ?? "1", 10);
  const productCheck = catalogIdSchema.safeParse(firstParam(params?.[n.productId]) ?? "");
  const pace = firstParam(params?.[n.pace]);
  const cohort = firstParam(params?.[n.cohortId]) ?? "";
  const week = firstParam(params?.[n.week]) ?? "";
  const group = firstParam(params?.[n.group]);

  return {
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    pageSize: STUDENT_LIST_PAGE_SIZE,
    ...normalizeStudentListParams({
      account: firstParam(params?.[n.account]) === "nunca" ? "never" : undefined,
      cohortId: UUID_RE.test(cohort) ? cohort : undefined,
      commenters: firstParam(params?.[n.commenters]) === "top" ? "top" : undefined,
      expiring: firstParam(params?.[n.expiring]) === "30" ? true : undefined,
      group: isLifecycleGroup(group) ? group : undefined,
      notStarted: firstParam(params?.[n.notStarted]) === "nao" ? true : undefined,
      pace: isStudentPace(pace) ? pace : undefined,
      productId: productCheck.success ? productCheck.data : undefined,
      q: firstParam(params?.[n.q]),
      week: WEEK_RE.test(week) && !Number.isNaN(Date.parse(`${week}T00:00:00Z`)) ? week : undefined
    })
  };
}

/* ------------------------------------------------------------------------------------------------
 * Segmentos salvos, turmas, acoes em massa, importacao e exportacao
 * ---------------------------------------------------------------------------------------------- */

export const segmentNameSchema = z
  .string({ error: "Dê um nome ao segmento." })
  .trim()
  .min(2, "Use pelo menos 2 caracteres.")
  .max(60, "Use no máximo 60 caracteres.");

export const saveSegmentSchema = z.object({
  name: segmentNameSchema,
  params: studentListParamsSchema
});

export const deleteSegmentSchema = z.object({ id: z.uuid({ error: "Segmento inválido." }) });

export const cohortNameSchema = z
  .string({ error: "Dê um nome à turma." })
  .trim()
  .min(1, "Dê um nome à turma.")
  .max(80, "Use no máximo 80 caracteres.");

export const createCohortSchema = z.object({ name: cohortNameSchema });

/** Turma do aluno em um produto; `cohortId` null tira o aluno da turma. */
export const setStudentCohortSchema = z.object({
  cohortId: z.uuid({ error: "Turma inválida." }).nullable(),
  productId: catalogIdSchema,
  userId: userIdSchema
});

export const bulkActionSchema = z
  .object({
    action: z.enum(BULK_ACTIONS, { error: "Ação inválida." }),
    batchId: z.uuid({ error: "Lote inválido." }),
    cohortId: z.uuid().nullish(),
    endsAt: accessEndDateSchema,
    productId: catalogIdSchema.nullish(),
    userIds: z.array(userIdSchema).min(1, "Marque pelo menos um aluno.").max(BULK_BATCH_SIZE, `No máximo ${BULK_BATCH_SIZE} alunos por lote.`)
  })
  .superRefine((value, context) => {
    const needsProduct = value.action !== "resend_access_email";

    if (needsProduct && !value.productId) {
      context.addIssue({ code: "custom", message: "Escolha o produto.", path: ["productId"] });
    }

    if (value.action === "set_end" && !value.endsAt) {
      context.addIssue({ code: "custom", message: "Escolha a nova data de término.", path: ["endsAt"] });
    }

    if (value.action === "set_cohort" && value.cohortId === undefined) {
      context.addIssue({ code: "custom", message: "Escolha a turma.", path: ["cohortId"] });
    }
  });

export type BulkActionInput = z.infer<typeof bulkActionSchema>;

export const restoreEntitlementsSchema = z.object({
  batchId: z.uuid({ error: "Lote inválido." }),
  snapshots: z
    .array(
      z.object({
        endsAt: z.iso.datetime({ offset: true }).nullable(),
        id: entitlementIdSchema,
        startsAt: z.iso.datetime({ offset: true }),
        status: z.enum(["active", "suspended", "revoked", "expired"])
      })
    )
    .min(1)
    .max(BULK_BATCH_SIZE * 8)
});

export const importRowSchema = z.object({
  cohortId: z.uuid().nullish(),
  email: studentEmailSchema,
  fullName: studentNameSchema,
  /** Linha do arquivo (1 = primeira linha de dados), so para o resumo. */
  index: z.number().int().min(1).max(100_000),
  phone: studentPhoneSchema,
  productIds: productIdsSchema.default([])
});

export type ImportRowInput = z.infer<typeof importRowSchema>;

export const importBatchSchema = z.object({
  batchId: z.uuid({ error: "Lote inválido." }),
  delivery: z.enum(IMPORT_DELIVERY_METHODS, { error: "Escolha como entregar o acesso." }),
  endsAt: accessEndDateSchema,
  rows: z.array(importRowSchema).min(1).max(IMPORT_BATCH_SIZE, `No máximo ${IMPORT_BATCH_SIZE} linhas por lote.`)
});

export type ImportBatchInput = z.infer<typeof importBatchSchema>;

/** Exportacao: os filtros da lista ou uma selecao de ate 200 ids (nunca os dois ao mesmo tempo). */
export const exportQuerySchema = z.object({
  ids: z.array(userIdSchema).max(200).optional(),
  params: studentListParamsSchema.default({})
});

export type ExportQueryInput = z.infer<typeof exportQuerySchema>;
