// Os caminhos dos Webinarios que a casca da area precisa reconhecer sem carregar o resto (docs/30 §1.1 e §1.3).
// Modulo puro, sem imports: o AppShell (JS inicial de toda pagina) e a faixa "Ao vivo agora"
// (src/server/webinars/live-banner.ts) leem a mesma regra da sala.

/** A sala do Webinario: /webinarios/<slug>/sala (com ou sem barra no fim), em maiusculas ou minusculas. */
export const WEBINAR_ROOM_PATH = /^\/webinarios\/[^/]+\/sala(\/|$)/i;

/** O caminho e a sala de um Webinario? Ignora a ?query e o #hash (a sala abre num dialogo de tela cheia). */
export function isWebinarRoomPath(pathname: string | null | undefined): boolean {
  if (!pathname) {
    return false;
  }
  return WEBINAR_ROOM_PATH.test(pathname.split(/[?#]/)[0]!);
}
