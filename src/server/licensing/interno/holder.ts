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

function allSameDigit(digits: string) {
  return /^(\d)\1+$/.test(digits);
}

/** CPF com os dois digitos verificadores certos (11 digitos, nunca todos iguais). */
export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);

  if (digits.length !== 11 || allSameDigit(digits)) {
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

/** CNPJ com os dois digitos verificadores certos (14 digitos, nunca todos iguais). */
export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);

  if (digits.length !== 14 || allSameDigit(digits)) {
    return false;
  }

  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

export type DocumentKind = "cpf" | "cnpj";

/** O tipo do documento pelos digitos (11 = CPF, 14 = CNPJ), so quando os verificadores conferem. */
export function documentKindOf(value: string): DocumentKind | null {
  const digits = onlyDigits(value);

  if (digits.length === 11) {
    return isValidCpf(digits) ? "cpf" : null;
  }

  if (digits.length === 14) {
    return isValidCnpj(digits) ? "cnpj" : null;
  }

  return null;
}

export const HOLDER_MESSAGES = Object.freeze({
  documento: "Confira o CPF ou o CNPJ: os números não batem.",
  email2: "Informe um e-mail válido.",
  email2Igual: "Use um e-mail diferente do e-mail da sua conta: avisamos os dois.",
  nome: "Informe o nome ou a razão social (de 3 a 200 letras).",
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
    .pipe(z.string().min(3, HOLDER_MESSAGES.nome).max(200, HOLDER_MESSAGES.nome)),
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

  return { data: { ...parsed.data, documento: onlyDigits(parsed.data.documento) }, ok: true };
}

/** O documento para mostrar: 123.456.789-09 ou 12.345.678/0001-95; o que veio mascarado do Emissor fica como veio. */
export function formatDocument(value: string): string {
  const digits = onlyDigits(value);

  if (digits.length === 11 && digits === value) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  if (digits.length === 14 && digits === value) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }

  return value;
}
