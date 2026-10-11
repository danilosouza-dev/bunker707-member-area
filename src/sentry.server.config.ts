import * as Sentry from "@sentry/nextjs";

// Carregado por src/instrumentation.ts somente no runtime Node.js e somente com DSN configurado.
// Sem withSentryConfig (fase seguinte), erros de request chegam pelo onRequestError e nao ha upload de source maps.
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
  // 10% das requisicoes viram trace de performance; erros sao sempre enviados.
  tracesSampleRate: 0.1,
  // O SDK 11 coleta cookies, cabecalhos, corpos e query strings por padrao. Aqui so vai o necessario para
  // depurar: nada de sessao Supabase, corpo de request/resposta, prompts de IA ou variaveis locais.
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
