// A conta de convidado do link aberto de um webinario (docs/30 §14, D129): o app_metadata que so o servidor grava
// (`webinar_guest: { webinar_id, slug }`, vem no JWT) e as paginas que o convidado abre. No nucleo, sem depender do
// codigo dos Webinarios: o proxy e a sessao leem daqui. Modulo puro.

/** A chave do app_metadata da conta de convidado (so o servidor grava; vem no JWT). */
export const GUEST_APP_METADATA_KEY = "webinar_guest";

export type GuestIdentity = { slug: string; webinarId: string };

/** O convidado do link aberto pelo app_metadata da conta (nulo para aluno e equipe). */
export function guestIdentityOf(appMetadata: unknown): GuestIdentity | null {
  if (!appMetadata || typeof appMetadata !== "object") {
    return null;
  }

  const raw = (appMetadata as Record<string, unknown>)[GUEST_APP_METADATA_KEY];

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const webinarId = typeof value.webinar_id === "string" ? value.webinar_id : null;
  // O slug vira endereco no proxy: so o formato do webinario (student-model.isWebinarSlug).
  const slug = typeof value.slug === "string" && /^[a-z0-9][a-z0-9-]{2,63}$/.test(value.slug) ? value.slug : null;

  return webinarId && slug ? { slug, webinarId } : null;
}

export function isGuestUser(user: { app_metadata?: unknown } | null | undefined): boolean {
  return Boolean(user && guestIdentityOf(user.app_metadata));
}

/**
 * As paginas que o convidado abre: a do webinario, a sala e o formulario (de qualquer webinario: a pagina confere o
 * acesso, e o convidado de outro webinario recebe o "nao encontrado"), o login (para entrar com uma conta de aluno) e
 * os retornos do Auth. O resto manda para a pagina do webinario dele.
 */
export function guestAllowedPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/auth/")) {
    return true;
  }

  return /^\/webinarios\/[a-z0-9-]+(\/(sala|entrar))?\/?$/.test(pathname);
}

/** Sem sessao, o proxy deixa estas paginas decidirem (a do webinario manda ao formulario quando o link esta aberto). */
export function openLinkAnonymousPath(pathname: string): boolean {
  return /^\/webinarios\/[a-z0-9-]+(\/entrar)?\/?$/.test(pathname);
}
