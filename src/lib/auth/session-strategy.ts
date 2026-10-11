/**
 * Como o proxy valida a sessao do Supabase a cada request.
 *
 * - "user" (padrao): `supabase.auth.getUser()`, que sempre consulta o servidor de Auth.
 * - "claims": `supabase.auth.getClaims()`, que valida a assinatura do JWT localmente
 *   (chaves publicas do JWKS em cache) quando o projeto tem signing keys assimetricas.
 *   Sem signing keys assimetricas o getClaims ainda chama o Auth a cada request.
 *
 * Nunca use `getSession()` no servidor para decidir acesso: ele le o cookie sem validar.
 */
export type AuthSessionStrategy = "user" | "claims";

export const defaultAuthSessionStrategy: AuthSessionStrategy = "user";

export function parseAuthSessionStrategy(value?: string | null): AuthSessionStrategy {
  return value?.trim().toLowerCase() === "claims" ? "claims" : defaultAuthSessionStrategy;
}

export function getAuthSessionStrategy(): AuthSessionStrategy {
  return parseAuthSessionStrategy(process.env.AUTH_SESSION_STRATEGY);
}
