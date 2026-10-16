// Enderecos que o app aceita como "publicos e seguros" para imagens e fotos: https, ou http so quando o
// servidor e a propria maquina (Supabase local dos testes de integracao e de ponta a ponta, docs/18
// §2.5). Qualquer outro http continua recusado. Modulo puro: servidor, proxy e modelos.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLoopbackHost(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname);
}

/** https em qualquer host, ou http em loopback. */
export function isHttpsOrLoopbackUrl(url: URL) {
  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
}
