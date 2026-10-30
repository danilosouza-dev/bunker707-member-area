import { NextResponse } from "next/server";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { recordAudit } from "@/server/audit/log";
import { requireApiRole } from "@/server/auth/permissions";
import { noStore } from "@/server/communications/route-support";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { jsonRouteError } from "@/server/http/route-errors";
import { WEBINARS_MIGRATION, isMissingWebinarSchema, webinarsDb } from "@/server/webinars/db";
import { parsePanelExportRequest } from "@/server/webinars/export-model";
import { loadPanelExport } from "@/server/webinars/export-queries";
import { EXPORT_MESSAGES } from "@/server/webinars/export-schemas";

// Os CSVs do periodo de um painel (docs/30 §3.1 a §3.3 e §3.7): GET /api/admin/webinars/painel/csv?tipo=ao-vivo|gravadas
// &inicio=&fim=&relatorio=performance|simulacao, mais os filtros da aba (PANEL_FILTER_PARAMS de export-model.ts). O
// Performance traz uma linha por sessao do periodo (so numeros reais: nunca o contador, as entradas, os avisos nem o
// roteiro, D6 e M6); o Simulacao, so a parte simulada das sessoes gravadas. messaging.write, como o relatorio; cada
// download grava a auditoria webinar_export com o relatorio, o tipo, o periodo e a contagem (nunca nomes). Pedido
// invalido (tipo, periodo de mais de 1 ano ou relatorio que so existe por sessao): 400; banco sem a migracao: 503.
// Resposta sem cache (M9).

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requireApiRole("messaging.write");

  if (auth.response) {
    return noStore(auth.response);
  }

  const query = parsePanelExportRequest(new URL(request.url).searchParams);

  if (!query) {
    return noStore(NextResponse.json({ error: EXPORT_MESSAGES.invalid }, { status: 400 }));
  }

  try {
    const result = await loadPanelExport(webinarsDb(), query);

    await recordAudit(webinarsDb(), {
      action: "webinar_export",
      actorId: auth.user?.id ?? null,
      count: result.count,
      entityType: "webinar",
      metadata: { kind: query.kind, period: { end: query.period.end, start: query.period.start }, report: query.report, sessions: result.sessions }
    });

    return noStore(
      new NextResponse(result.csv, {
        headers: {
          "Content-Disposition": `attachment; filename="${result.fileName}"`,
          "Content-Type": "text/csv; charset=utf-8"
        },
        status: 200
      })
    );
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return noStore(NextResponse.json({ error: WEBINAR_COPY.exportar.migracaoPendente(WEBINARS_MIGRATION) }, { status: 503 }));
    }

    return noStore(jsonRouteError(error, WEBINAR_COPY.exportar.erro));
  }
}
