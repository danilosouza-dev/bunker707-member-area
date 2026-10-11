"use client";

import { useEffect } from "react";

// Último recurso do App Router: substitui o layout raiz quando o erro acontece nele,
// por isso renderiza as próprias tags <html> e <body>. Sem NEXT_PUBLIC_SENTRY_DSN o
// chunk do Sentry nunca é importado (mesmo padrão de src/instrumentation-client.ts).
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    if (!sentryDsn) {
      return;
    }

    import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(error);
      })
      .catch(() => undefined);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          alignItems: "center",
          background: "#141414",
          color: "#ffffff",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          margin: 0,
          minHeight: "100vh",
          padding: "24px"
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 12px" }}>Algo deu errado</h1>
          <p style={{ color: "#a3a3a3", lineHeight: 1.5, margin: "0 0 20px" }}>
            Não foi possível carregar a página. Tente de novo e, se o problema continuar, saia e entre novamente.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#ffffff",
              border: 0,
              borderRadius: "8px",
              color: "#141414",
              cursor: "pointer",
              fontSize: "0.9375rem",
              fontWeight: 600,
              padding: "10px 18px"
            }}
            type="button"
          >
            Tentar de novo
          </button>
          {error.digest ? (
            <p style={{ color: "#737373", fontSize: "0.75rem", margin: "20px 0 0" }}>Código do erro: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
