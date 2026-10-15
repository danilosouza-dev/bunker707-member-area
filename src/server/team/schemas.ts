import { z } from "zod";
import {
  GRANTABLE_ACTIONS,
  MAX_MEMBER_FUNCTIONS,
  MAX_SCOPED_PRODUCTS,
  SCOPABLE_ACTIONS,
  isCombinablePreset,
  isCustomFunctionId,
  type AdminAction
} from "@/server/auth/roles";
import { catalogIdSchema } from "@/server/catalog/schemas";

// Entradas das Server Actions de Equipe (docs/17 §2.3). O servidor descarta o que nao vale (extras
// repetidos, cursos sem permissao por curso), confere as funcoes personalizadas citadas e as regras
// de mudanca (teamChangeError) depois desta validacao.

export const teamEmailSchema = z
  .string({ error: "Informe o e-mail da pessoa." })
  .trim()
  .toLowerCase()
  .max(254, "E-mail longo demais.")
  .pipe(z.email({ error: "E-mail inválido." }));

export const teamNameSchema = z.string().trim().max(120, "Use no máximo 120 caracteres.");

const grantableActionSchema = z.enum(GRANTABLE_ACTIONS as unknown as [AdminAction, ...AdminAction[]], { error: "Permissão desconhecida." });
const scopableActionSchema = z.enum(SCOPABLE_ACTIONS as unknown as [AdminAction, ...AdminAction[]], { error: "Essa permissão não vale por curso." });
const functionRefSchema = z.string().refine((value) => isCombinablePreset(value) || isCustomFunctionId(value), "Função inválida.");

const memberAccessFields = {
  extraActions: z.array(grantableActionSchema).max(GRANTABLE_ACTIONS.length).default([]),
  extraScopedActions: z.array(scopableActionSchema).max(SCOPABLE_ACTIONS.length).default([]),
  functions: z.array(functionRefSchema).max(MAX_MEMBER_FUNCTIONS, `Escolha no máximo ${MAX_MEMBER_FUNCTIONS} funções.`).default([]),
  owner: z.boolean().default(false),
  productIds: z.array(catalogIdSchema).max(MAX_SCOPED_PRODUCTS, `Escolha no máximo ${MAX_SCOPED_PRODUCTS} cursos.`).default([])
};

function refineMemberAccess(value: { extraActions: AdminAction[]; functions: string[]; owner: boolean }, context: z.RefinementCtx) {
  if (!value.owner && value.functions.length === 0 && value.extraActions.length === 0) {
    context.addIssue({ code: "custom", message: "Escolha pelo menos uma função ou permissão.", path: ["functions"] });
  }
}

export const addTeamMemberSchema = z
  .object({ ...memberAccessFields, email: teamEmailSchema, fullName: teamNameSchema.default("") })
  .superRefine(refineMemberAccess);

export const updateTeamMemberSchema = z
  .object({
    ...memberAccessFields,
    /** updated_at lido pela tela: se mudou, outra pessoa alterou antes (409). */
    expectedUpdatedAt: z.string().min(10).max(40).optional(),
    userId: z.uuid({ error: "Pessoa inválida." })
  })
  .superRefine(refineMemberAccess);

export const teamMemberIdSchema = z.object({ userId: z.uuid({ error: "Pessoa inválida." }) });

const teamFunctionFields = {
  actions: z.array(grantableActionSchema).min(1, "Marque pelo menos uma permissão.").max(GRANTABLE_ACTIONS.length),
  description: z.string().trim().max(240, "Use no máximo 240 caracteres.").default(""),
  name: z.string({ error: "Dê um nome para a função." }).trim().min(2, "Use pelo menos 2 caracteres.").max(60, "Use no máximo 60 caracteres."),
  scopedActions: z.array(scopableActionSchema).max(SCOPABLE_ACTIONS.length).default([])
};

export const createTeamFunctionSchema = z.object(teamFunctionFields);

export const updateTeamFunctionSchema = z.object({
  ...teamFunctionFields,
  expectedUpdatedAt: z.string().min(10).max(40).optional(),
  id: z.uuid({ error: "Função inválida." })
});

export const teamFunctionIdSchema = z.object({ id: z.uuid({ error: "Função inválida." }) });

export type AddTeamMemberInput = z.input<typeof addTeamMemberSchema>;
export type UpdateTeamMemberInput = z.input<typeof updateTeamMemberSchema>;
export type TeamFunctionInput = z.input<typeof createTeamFunctionSchema>;
