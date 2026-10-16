import { test as base, expect } from "@playwright/test";

// Base dos testes de ponta a ponta: o navegador so fala com a maquina. Qualquer pedido para fora
// (YouTube, PostHog, Sentry, fontes, CDNs) e cortado antes de sair. O player do YouTube continua
// desenhado na pagina; so o video nao carrega, e nenhum teste depende dele.
export const test = base.extend({
  context: async ({ context }, run) => {
    await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort("blockedbyclient"));
    await run(context);
  }
});

export { expect };
