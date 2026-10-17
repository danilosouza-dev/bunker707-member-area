// Origem publica (`https://host`) a partir de um Request, para rotas que nao tem o `headers()` do Next
// a mao (webhooks). Mesma ordem de src/server/auth/site-origin.ts: NEXT_PUBLIC_SITE_URL primeiro; sem
// ela, os cabecalhos do proxy (Vercel/Caddy); por ultimo, a propria URL do pedido. Modulo puro.

export function requestOriginOf(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Valor invalido na variavel: cai nos cabecalhos.
    }
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (host) {
    const protocol = request.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");

    return `${protocol.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}
