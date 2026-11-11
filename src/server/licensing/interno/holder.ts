// O titular da Licenca (docs/32 §1.2 e §2.4): quem e dono da Licenca, que nem sempre e quem pagou. No primeiro acesso a
// Minhas licencas, antes da primeira Chave, o comprador informa o nome ou a razao social, o CPF ou o CNPJ, um segundo
// e-mail de contato (diferente do da conta: o Emissor avisa os dois) e aceita a versao dos termos.
//
// Modulo puro: as regras e as frases dos campos (o formulario mostra as mesmas que a Server Action devolve).

import { z } from "zod";

/** So os digitos. */
export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

/** O documento sem pontuacao (pontos, barra, hifen e espacos) e em maiusculas: o CNPJ alfanumerico tem letras. */
export function normalizeDocument(value: string): string {
  return value.replace(/[\s./-]+/g, "").toUpperCase();
}

function allSameCharacter(text: string) {
  return /^(.)\1+$/.test(text);
}

/** CPF com os dois digitos verificadores certos (11 digitos, nunca todos iguais). */
export function isValidCpf(value: string): boolean {
  const digits = normalizeDocument(value);

  if (!/^\d{11}$/.test(digits) || allSameCharacter(digits)) {
    return false;
  }

  const check = (length: number) => {
    let sum = 0;

    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }

    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/**
 * CNPJ com os dois digitos verificadores certos: o numerico (14 digitos) e o alfanumerico, que a Receita usa desde
 * julho de 2026 (12 caracteres de 0 a 9 e de A a Z, e os dois verificadores numericos). O valor de cada caractere e o
 * codigo dele menos 48 (os digitos continuam valendo eles mesmos), com os mesmos pesos de sempre. Nunca todos iguais.
 */
export function isValidCnpj(value: string): boolean {
  const text = normalizeDocument(value);

  if (!/^[0-9A-Z]{12}\d{2}$/.test(text) || allSameCharacter(text)) {
    return false;
  }

  const valueOf = (index: number) => text.charCodeAt(index) - 48;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + valueOf(index) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return check(12) === Number(text[12]) && check(13) === Number(text[13]);
}

export type DocumentKind = "cpf" | "cnpj";

/** O tipo do documento (11 digitos = CPF, 14 caracteres = CNPJ), so quando os verificadores conferem. */
export function documentKindOf(value: string): DocumentKind | null {
  const text = normalizeDocument(value);

  if (text.length === 11) {
    return isValidCpf(text) ? "cpf" : null;
  }

  if (text.length === 14) {
    return isValidCnpj(text) ? "cnpj" : null;
  }

  return null;
}

export const HOLDER_MESSAGES = Object.freeze({
  documento: "Confira o CPF ou o CNPJ: os números não batem.",
  email2: "Informe um e-mail válido.",
  email2Igual: "Use um e-mail diferente do e-mail da sua conta: avisamos os dois.",
  nome: "Informe o nome ou a razão social (de 3 a 160 letras).",
  termos: "Para gerar a chave, leia e aceite os termos de uso da Licença."
});

/** O que o formulario manda: os textos digitados e o aceite (a versao vem do servidor, nunca do navegador). */
export const holderFormSchema = z.object({
  documento: z
    .string()
    .trim()
    .max(40, HOLDER_MESSAGES.documento)
    .refine((value) => documentKindOf(value) !== null, HOLDER_MESSAGES.documento),
  email2: z.string().trim().toLowerCase().max(320, HOLDER_MESSAGES.email2).pipe(z.email(HOLDER_MESSAGES.email2)),
  nome: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, " "))
    .pipe(z.string().min(3, HOLDER_MESSAGES.nome).max(160, HOLDER_MESSAGES.nome)),
  termos: z.literal(true, { error: HOLDER_MESSAGES.termos })
});

export type HolderForm = z.infer<typeof holderFormSchema>;

/**
 * O formulario conferido com o e-mail da conta: o segundo e-mail precisa ser outro (docs/32 §2.2: o Emissor avisa os
 * dois). Devolve os erros por campo, nas frases do HOLDER_MESSAGES.
 */
export function validateHolderForm(
  raw: unknown,
  accountEmail: string | null | undefined
): { ok: true; data: HolderForm & { documento: string } } | { ok: false; fieldErrors: Record<string, string[]> } {
  const parsed = holderFormSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "_");
      (fieldErrors[key] ??= []).push(issue.message);
    }

    return { fieldErrors, ok: false };
  }

  if (accountEmail && parsed.data.email2 === accountEmail.trim().toLowerCase()) {
    return { fieldErrors: { email2: [HOLDER_MESSAGES.email2Igual] }, ok: false };
  }

  return { data: { ...parsed.data, documento: normalizeDocument(parsed.data.documento) }, ok: true };
}

/**
 * O documento para a tela, mascarado: so o tipo e os ultimos digitos (o comprador ve que e o dele; o numero inteiro nao
 * fica escrito na pagina). "CPF terminado em 09", "CNPJ terminado em 95".
 */
export function maskedDocument(value: string): string {
  const text = normalizeDocument(value);
  const kind = text.length === 11 ? "CPF" : text.length === 14 ? "CNPJ" : "Documento";

  return text.length >= 4 ? `${kind} terminado em ${text.slice(-2)}` : kind;
}
