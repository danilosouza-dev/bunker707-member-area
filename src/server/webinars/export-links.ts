// Os enderecos de download dos CSVs (docs/30 §3.7): o relatorio de uma sessao pela rota que ja existe
// (GET /api/admin/webinars/[id]/relatorio/csv?sessao=, agora com &relatorio=; sem ele, o Attendee de sempre) e o
// periodo de um painel (GET /api/admin/webinars/painel/csv). Rotas e nao Server Actions: o navegador baixa o arquivo.
// Modulo puro: o menu Exportar do relatorio e dos paineis monta os links com as mesmas funcoes que as rotas leem.

import type { WebinarExportReport } from "./model";

/** O parametro do relatorio e os do periodo do painel (em portugues, como ?sessao= e ?periodo=). */
export const EXPORT_PARAMS = { end: "fim", kind: "tipo", report: "relatorio", session: "sessao", start: "inicio" } as const;

/** "ao-vivo" / "gravadas": os mesmos valores das abas da pagina (WEBINAR_LIST_TABS). */
export const PANEL_KIND_PARAMS = { live: "ao-vivo", simulated: "gravadas" } as const;

export function webinarSessionExportHref(input: { report: WebinarExportReport; sessionId: string; webinarId: string }) {
  const query = new URLSearchParams({ [EXPORT_PARAMS.session]: input.sessionId, [EXPORT_PARAMS.report]: input.report });
  return `/api/admin/webinars/${encodeURIComponent(input.webinarId)}/relatorio/csv?${query.toString()}`;
}

/**
 * O CSV do periodo de um painel (so Performance e Simulacao, webinarExportSchema). Os filtros da aba vao como os
 * mesmos parametros da pagina (o painel repassa os seus searchParams em `extra`).
 */
export function webinarPanelExportHref(input: {
  end: string;
  extra?: Record<string, string>;
  kind: "live" | "simulated";
  report: "performance" | "simulacao";
  start: string;
}) {
  const query = new URLSearchParams({
    ...(input.extra ?? {}),
    [EXPORT_PARAMS.kind]: PANEL_KIND_PARAMS[input.kind],
    [EXPORT_PARAMS.start]: input.start,
    [EXPORT_PARAMS.end]: input.end,
    [EXPORT_PARAMS.report]: input.report
  });
  return `/api/admin/webinars/painel/csv?${query.toString()}`;
}
