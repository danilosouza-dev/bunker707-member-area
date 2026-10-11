// Recuperacao de senha pelo login (fluxo PKCE do navegador -> /auth/callback -> /alterar-senha).
//
// Cada pedido de link grava um codigo de verificacao novo no navegador ANTES de chamar o Supabase,
// mesmo quando o pedido falha. Por isso um segundo clique invalida o link do e-mail anterior: o botao
// fica travado enquanto envia e por um minuto depois do envio, e os avisos dizem para usar o e-mail
// mais recente no mesmo navegador.

/** Tempo em que o botao "Esqueci minha senha" fica travado depois de um envio bem-sucedido. */
export const PASSWORD_RESET_COOLDOWN_MS = 60_000;

export const PASSWORD_RESET_SENT_NOTICE =
  "Se o e-mail estiver cadastrado, enviamos um link. Abra o e-mail mais recente neste mesmo navegador.";

export const PASSWORD_RESET_MISSING_EMAIL = "Informe seu e-mail para receber o link de recuperação.";

/** Parametro que o /auth/callback poe no /login quando o link do e-mail nao pode ser usado. */
export const AUTH_LINK_ERROR_PARAM = "erro";
export const AUTH_LINK_ERROR_VALUE = "link";

export const AUTH_LINK_ERROR_MESSAGE =
  "Este link não vale mais. Ele pode ter expirado, já ter sido usado ou ter sido aberto em outro navegador. Peça um novo em \"Esqueci minha senha\".";

/** Falha ao concluir a entrada por Google/Apple/etc.: nao tem link de e-mail envolvido. */
export const AUTH_OAUTH_ERROR_VALUE = "oauth";

export const AUTH_OAUTH_ERROR_MESSAGE = "Não foi possível concluir a entrada. Tente de novo.";

/** Valor de ?erro= que o /auth/callback usa: links de e-mail (provider=email) ou login social. */
export function authCallbackErrorValue(provider: string | null | undefined) {
  return provider === "email" ? AUTH_LINK_ERROR_VALUE : AUTH_OAUTH_ERROR_VALUE;
}

type AuthErrorLike = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
} | null | undefined;

/** Traduz o erro do Supabase Auth em uma frase que diz o que fazer. Nunca repassa a mensagem tecnica. */
export function describePasswordResetError(error: AuthErrorLike) {
  const code = typeof error?.code === "string" ? error.code : "";

  if (code === "over_email_send_rate_limit") {
    return "O limite de e-mails de recuperação foi atingido. Aguarde alguns minutos e tente de novo.";
  }

  if (code === "over_request_rate_limit" || error?.status === 429) {
    return "Você pediu um link há pouco. Aguarde 1 minuto e use o e-mail mais recente.";
  }

  if (code === "email_address_invalid" || code === "validation_failed") {
    return "Confira o e-mail digitado.";
  }

  return "Não foi possível enviar a recuperação de senha. Tente de novo em instantes.";
}

/** Mensagem inicial do login a partir do ?erro= que o /auth/callback devolve. */
export function readAuthLinkError(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;

  if (first === AUTH_LINK_ERROR_VALUE) {
    return AUTH_LINK_ERROR_MESSAGE;
  }

  return first === AUTH_OAUTH_ERROR_VALUE ? AUTH_OAUTH_ERROR_MESSAGE : undefined;
}
