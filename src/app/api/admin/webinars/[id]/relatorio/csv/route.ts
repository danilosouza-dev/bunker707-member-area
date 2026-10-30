import { NextResponse } from "next/server";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { recordAudit } from "@/server/audit/log";
import { requireApiRole } from "@/server/auth/permissions";
import { isUuid, noStore } from "@/server/communications/route-support";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { jsonRouteError } from "@/server/http/route-errors";
import { WEBINARS_MIGRATION, isMissingWebinarSchema, webinarsDb } from "@/server/webinars/db";
import { parseSessionExportRequest } from "@/server/webinars/export-model";
import { loadSessionExport } from "@/server/webinars/export-queries";
import { EXPORT_MESSAGES } from "@/server/webinars/export-schemas";

// Os CSVs do relatorio de uma sessao com os nomes do Zoom (docs/30 §3.1 e §3.7): GET
// /api/admin/webinars/[id]/relatorio/csv?sessao=&relatorio=registration|attendee|performance|qa|poll|survey|simulacao
// (sem ?relatorio=, o Attendee de sempre). Rota, e nao Server Action, porque o navegador baixa o arquivo. Quem ve o
// relatorio baixa (messaging.write, como as rotas de /api/admin/communications); cada download grava a auditoria
// webinar_export com o relatorio, a sessao, o tipo dela e a contagem (ids e numeros, nunca nomes). Pedido invalido:
// 400; a sessao precisa ser deste webinario (senao 404); banco sem a migracao: 503. Resposta sem cache (M9).

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiRole("messaging.write");

  if (auth.response) {
    return noStore(auth.response);
  }

  const { id } = await context.params;
  const query = parseSessionExportRequest(new URL(request.url).searchParams);

  if (!isUuid(id) || !query) {
    return noStore(NextResponse.json({ error: EXPORT_MESSAGES.invalid }, { status: 400 }));
  }

  try {
    const result = await loadSessionExport(webinarsDb(), { report: query.report, sessionId: query.sessionId, webinarId: id });

    if (!result) {
      return noStore(NextResponse.json({ error: WEBINAR_COPY.exportar.sessaoNaoExiste }, { status: 404 }));
    }

    await recordAudit(webinarsDb(), {
      action: "webinar_export",
      actorId: auth.user?.id ?? null,
      count: result.count,
      entityId: id,
      entityType: "webinar",
      metadata: { kind: result.kind, report: query.report, session_id: query.sessionId, webinar_id: id }
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
