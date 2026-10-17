// Ajudantes comuns dos adaptadores das plataformas de venda (hotmart.ts, ticto.ts): leitura tolerante
// do payload e a copia so dos campos permitidos para guardar. A conferencia do token fica em secret.ts
// (o banco guarda so o SHA-256). Modulo puro, sem "server-only": os testes carregam direto pelo Node.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Texto curto do payload (numero vira texto); vazio ou de outro tipo e null. */
export function shortString(value: unknown, maximumLength: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maximumLength) : null;
}

export function normalizeBuyerEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";

  return email.length > 0 && email.length <= 320 && EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Copia so das chaves listadas de um objeto (valores escalares ou objetos tratados por `nested`), para o
 * payload guardado levar apenas o que a regra de acesso e a tela usam. Objeto vazio some.
 */
export function pick(source: Record<string, unknown> | null, keys: readonly string[], nested: Record<string, (value: unknown) => unknown> = {}) {
  if (!source) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  for (const key of keys) {
    if (!(key in source)) {
      continue;
    }

    const value = nested[key] ? nested[key](source[key]) : source[key];

    if (value !== undefined && (value === null || typeof value !== "object" || Object.keys(value as object).length > 0)) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
