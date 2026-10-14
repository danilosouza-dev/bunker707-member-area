// Schemas zod das entradas de Alunos (docs/17 §1.7 e §2.3: o mesmo schema valida a Server Action e,
// amanha, a rota de webhook que criar aluno a partir de uma venda). Modulo puro: os testes carregam
// pelo Node, por isso os imports sao relativos.

import { z } from "zod";
import { catalogIdSchema } from "../catalog/schemas";
import {
  ACCESS_DELIVERY_METHODS,
  TEMPORARY_PASSWORD_MIN_LENGTH,
  isStudentPace,
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

/** ?busca=&produto=&ritmo=&pagina= da lista de alunos. Valor estranho = filtro ignorado. */
export function parseStudentListSearchParams(params: Record<string, SearchParamValue> | undefined): StudentListQuery {
  const pageValue = Number.parseInt(firstParam(params?.pagina) ?? "1", 10);
  const productCheck = catalogIdSchema.safeParse(firstParam(params?.produto) ?? "");
  const pace = firstParam(params?.ritmo);
  const q = firstParam(params?.busca)?.trim().slice(0, SEARCH_MAX_LENGTH);

  return {
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    pageSize: STUDENT_LIST_PAGE_SIZE,
    ...(productCheck.success ? { productId: productCheck.data } : {}),
    ...(isStudentPace(pace) ? { pace } : {}),
    ...(q ? { q } : {})
  };
}
