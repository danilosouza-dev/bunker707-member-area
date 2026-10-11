// Valores de ambiente colados em paineis (Vercel, Supabase) as vezes chegam com espaco ou quebra de
// linha no meio ou nas pontas. Chaves e enderecos do Supabase nunca tem espaco: com ele, o fetch
// recusa o cabecalho ("invalid header value") e a mensagem de erro carrega a chave inteira.
// Modulo puro (servidor, navegador e proxy).

/** Tira todo espaco em branco; vazio vira undefined, para o `??` cair na proxima opcao. */
export function cleanEnvValue(value: string | null | undefined) {
  const cleaned = (value ?? "").replace(/\s+/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Esconde chaves e tokens antes de registrar ou mostrar uma mensagem de erro. */
export function redactSecrets(text: string) {
  return text
    .replace(/sb_secret_[A-Za-z0-9_\-\s]{6,}/g, "sb_secret_[oculto]")
    .replace(/sb_publishable_[A-Za-z0-9_-]{6,}/g, "sb_publishable_[oculto]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[token oculto]")
    .replace(/\b(sk|rk|pk)[-_](live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}/g, "[chave oculta]");
}
