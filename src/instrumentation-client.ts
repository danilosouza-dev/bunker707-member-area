import type { RouterTransitionType } from "next";

type SentryClient = typeof import("@sentry/nextjs");

// A CSP com nonce (src/proxy.ts) nao tem 'unsafe-eval'. Sem isto, o zod tenta `new Function("")` para
// compilar a validacao; o navegador bloqueia, o zod cai no caminho sem compilacao (mesmo resultado) e a
// tentativa vira violacao de CSP no console e no Sentry. Este arquivo roda antes de qualquer modulo do
// app, entao todo schema do navegador ja nasce sem compilacao. E o mesmo que `z.config({ jitless: true })`:
// o zod guarda a configuracao em globalThis.__zod_globalConfig. Gravar ali sem importar o zod evita
// baixar 7 KB de zod em toda tela do aluno, que nao usa zod no navegador (so o admin usa).
// tests/zod-sem-eval-no-navegador.test.mjs quebra se o zod mudar esse nome. No servidor nao ha CSP.
const zodGlobal = globalThis as typeof globalThis & { __zod_globalConfig?: { jitless?: boolean } };
zodGlobal.__zod_globalConfig = Object.assign(zodGlobal.__zod_globalConfig ?? {}, { jitless: true });

// Variavel NEXT_PUBLIC_* entra no bundle no build. Sem DSN, o chunk do Sentry nunca e baixado.
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

let sentry: SentryClient | null = null;

// Query string e fragmento podem carregar ?code= do login, ?next= ou #access_token= de convites.
function stripQueryAndHash(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const end = value.search(/[?#]/);

  return end === -1 ? value : value.slice(0, end);
}

function stripRequestUrl<T extends { request?: { url?: string } }>(event: T) {
  if (event.request?.url) {
    event.request.url = stripQueryAndHash(event.request.url) as string;
  }

  return event;
}

// Import dinamico: o SDK inicia logo depois da hidratacao em vez de antes. Perde-se no maximo um erro
// muito precoce, em troca de nao pesar no bundle de quem nao configurou o Sentry.
if (sentryDsn) {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
        // 10% das navegacoes viram trace de performance; erros sao sempre enviados.
        tracesSampleRate: 0.1,
        // Sem Session Replay e sem widget de feedback: nenhuma gravacao de tela do aluno.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: { request: { allow: ["user-agent"] }, response: false },
          httpBodies: [],
          urlQueryParams: false,
          stackFrameVariables: false
        },
        beforeSend: stripRequestUrl,
        beforeSendTransaction: stripRequestUrl,
        beforeBreadcrumb(breadcrumb) {
          if (breadcrumb.data) {
            for (const key of ["url", "from", "to"]) {
              if (key in breadcrumb.data) {
                breadcrumb.data[key] = stripQueryAndHash(breadcrumb.data[key]);
              }
            }
          }

          return breadcrumb;
        }
      });

      sentry = Sentry;
    })
    .catch(() => undefined);
}

// Spans de navegacao do App Router; enquanto o SDK nao carregou (ou sem DSN) e um no-op.
export function onRouterTransitionStart(url: string, navigationType: RouterTransitionType) {
  sentry?.captureRouterTransitionStart(url, navigationType);
}
