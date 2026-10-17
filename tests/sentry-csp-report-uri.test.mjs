import assert from "node:assert/strict";
import test from "node:test";
import { getSentryCspReportUri } from "../src/lib/sentry-csp-report-uri.ts";

// A CSP do proxy so ganha `report-uri` quando NEXT_PUBLIC_SENTRY_DSN existe; o endpoint vem do DSN.

test("DSN do Sentry na nuvem vira o endpoint de seguranca do projeto, com a chave publica na query", () => {
  assert.equal(
    getSentryCspReportUri("https://abc123@o456.ingest.us.sentry.io/789"),
    "https://o456.ingest.us.sentry.io/api/789/security/?sentry_key=abc123"
  );
});

test("DSN self-hosted com prefixo de caminho mantem o prefixo antes de /api/", () => {
  assert.equal(
    getSentryCspReportUri("https://chave@sentry.exemplo.com/sentry/42"),
    "https://sentry.exemplo.com/sentry/api/42/security/?sentry_key=chave"
  );
});

test("sem DSN, DSN invalido, sem chave ou sem projeto numerico: nenhum report-uri", () => {
  for (const dsn of [undefined, null, "", "nao-e-url", "ftp://chave@host/1", "https://o1.ingest.sentry.io/1", "https://chave@o1.ingest.sentry.io/", "https://chave@o1.ingest.sentry.io/abc"]) {
    assert.equal(getSentryCspReportUri(dsn), null, `${dsn}`);
  }
});
