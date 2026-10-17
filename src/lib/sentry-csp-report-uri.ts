// Endpoint de relatorio de violacao de CSP do Sentry, derivado do DSN publico do navegador:
//   https://<chave>@o123.ingest.us.sentry.io/<projeto>
//   -> https://o123.ingest.us.sentry.io/api/<projeto>/security/?sentry_key=<chave>
// Sem a diretiva `report-uri`, uma violacao de CSP so aparece no console do aluno; com ela o navegador
// tambem a envia ao Sentry, que a mostra como evento "CSP". Self-hosted com prefixo de caminho
// (https://chave@sentry.exemplo.com/sentry/42) mantem o prefixo antes de /api/.
export function getSentryCspReportUri(dsn: string | undefined | null) {
  if (!dsn) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();

  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.username || !projectId || !/^\d+$/.test(projectId)) {
    return null;
  }

  const prefix = segments.length ? `/${segments.join("/")}` : "";

  return `${url.origin}${prefix}/api/${projectId}/security/?sentry_key=${encodeURIComponent(url.username)}`;
}
