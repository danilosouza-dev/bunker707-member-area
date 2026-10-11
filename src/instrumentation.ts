import type { Instrumentation } from "next";

// O DSN nao e segredo, mas sem ele nada do Sentry e importado: zero custo de cold start quando desligado.
const sentryDsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!sentryDsn) {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Erros de Server Components, Route Handlers, Server Actions e do proxy.ts.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!sentryDsn) {
    return;
  }

  const { captureRequestError } = await import("@sentry/nextjs");

  captureRequestError(error, request, context);
};
