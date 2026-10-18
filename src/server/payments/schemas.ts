import { z } from "zod";
import { MAX_SALES_SECRET_LENGTH, MIN_SALES_SECRET_LENGTH, SALES_PROVIDERS } from "./types";

// Entradas das Server Actions de Configuracoes > Vendas (settings.sales) e do codigo do produto na
// plataforma (catalog.access). Modulo puro: a tela valida antes de enviar e o servidor valida de novo.

export const salesProviderSchema = z.enum(SALES_PROVIDERS, { error: "Plataforma desconhecida." });

/** Token da plataforma (Hotmart: hottok): texto sem espacos, entre 16 e 200 caracteres. */
export const salesSecretSchema = z
  .string({ error: "Cole o token da plataforma." })
  .trim()
  .min(MIN_SALES_SECRET_LENGTH, `O token tem pelo menos ${MIN_SALES_SECRET_LENGTH} caracteres. Confira se copiou inteiro.`)
  .max(MAX_SALES_SECRET_LENGTH, "Token longo demais. Confira se copiou só o token.")
  .regex(/^\S+$/, "O token não tem espaços. Confira se copiou só o token.");

export const saveSalesSecretSchema = z.object({
  provider: salesProviderSchema,
  secret: salesSecretSchema
});

export const salesProviderInputSchema = z.object({ provider: salesProviderSchema });

export const reprocessSalesEventSchema = z.object({ id: z.uuid({ error: "Venda inválida." }) });

/**
 * Codigo do produto na plataforma (Hotmart: o numero do produto). Vazio vira null (tira a ligacao).
 * Letras, numeros, ponto, hifen e sublinhado, ate 120 caracteres.
 */
export const externalProductIdSchema = z
  .union([z.literal(""), z.string().trim().max(120, "Código longo demais.").regex(/^[A-Za-z0-9._-]+$/, "Use só letras, números, ponto, hífen ou sublinhado.")])
  .nullish()
  .transform((value) => (value ? value : null));

export type SaveSalesSecretInput = z.input<typeof saveSalesSecretSchema>;
