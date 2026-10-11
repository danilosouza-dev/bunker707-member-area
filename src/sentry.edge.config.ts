import * as Sentry from "@sentry/nextjs";

// Carregado por src/instrumentation.ts somente no runtime Edge e somente com DSN configurado.
// Hoje nenhuma rota usa Edge (o proxy.ts roda em Node.js); o arquivo existe para quando alguma passar a usar.
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Mesmas restricoes do servidor Node.js (src/sentry.server.config.ts): manter os dois em sincronia.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { allow: ["user-agent", "content-type", "accept-language", "x-vercel-id"] },
      response: false
    },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false
  }
});
