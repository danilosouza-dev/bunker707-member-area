import { z } from "zod";
import { ADMIN_ROLES, GRANTABLE_ACTIONS, MAX_SCOPED_PRODUCTS, type AdminAction } from "@/server/auth/roles";
import { catalogIdSchema } from "@/server/catalog/schemas";

// Entradas das Server Actions de Equipe (docs/17 §2.3). O servidor descarta o que a funcao nao usa
// (storedPermissionsFor) e confere as regras de mudanca (teamChangeError) depois desta validacao.

export const teamEmailSchema = z
  .string({ error: "Informe o e-mail da pessoa." })
  .trim()
  .toLowerCase()
  .max(254, "E-mail longo demais.")
  .pipe(z.email({ error: "E-mail inválido." }));

export const teamNameSchema = z.string().trim().max(120, "Use no máximo 120 caracteres.");

const roleSchema = z.enum(ADMIN_ROLES, { error: "Escolha a função." });
const actionSchema = z.enum(GRANTABLE_ACTIONS as unknown as [AdminAction, ...AdminAction[]], { error: "Permissão desconhecida." });

const accessFields = {
  actions: z.array(actionSchema).max(GRANTABLE_ACTIONS.length).default([]),
  productIds: z.array(catalogIdSchema).max(MAX_SCOPED_PRODUCTS, `Escolha no máximo ${MAX_SCOPED_PRODUCTS} cursos.`).default([]),
  role: roleSchema
};

function refineAccess(value: { actions: AdminAction[]; productIds: string[]; role: string }, context: z.RefinementCtx) {
  if (value.role === "instructor" && value.productIds.length === 0) {
    context.addIssue({ code: "custom", message: "Escolha pelo menos um curso.", path: ["productIds"] });
  }

  if (value.role === "custom" && value.actions.length === 0) {
    context.addIssue({ code: "custom", message: "Marque pelo menos uma permissão.", path: ["actions"] });
  }
}

export const addTeamMemberSchema = z
  .object({ ...accessFields, email: teamEmailSchema, fullName: teamNameSchema.default("") })
  .superRefine(refineAccess);

export const updateTeamMemberSchema = z
  .object({
    ...accessFields,
    /** updated_at lido pela tela: se mudou, outra pessoa alterou antes (409). */
    expectedUpdatedAt: z.string().min(10).max(40).optional(),
    userId: z.uuid({ error: "Pessoa inválida." })
  })
  .superRefine(refineAccess);

export const teamMemberIdSchema = z.object({ userId: z.uuid({ error: "Pessoa inválida." }) });

export type AddTeamMemberInput = z.input<typeof addTeamMemberSchema>;
export type UpdateTeamMemberInput = z.input<typeof updateTeamMemberSchema>;
