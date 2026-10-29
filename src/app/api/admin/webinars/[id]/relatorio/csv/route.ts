import { NextResponse } from "next/server";
import { recordAudit } from "@/server/audit/log";
import { requireApiRole } from "@/server/auth/permissions";
import { isUuid, noStore } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";
import { webinarsDb } from "@/server/webinars/db";
import { WEBINAR_REPORT_SESSION_PARAM } from "@/server/webinars/report-page-model";
import { webinarReportCsv } from "@/server/webinars/report-queries";

// O CSV "Attendee" do relatorio de uma sessao (docs/30 §3.1 e §3.7): GET /api/admin/webinars/[id]/relatorio/csv?sessao=.
// Rota, e nao Server Action, porque o navegador baixa o arquivo. Quem ve o relatorio baixa (messaging.write, como
// as rotas de /api/admin/communications); cada download grava a auditoria webinar_export com o relatorio e a
// sessao (ids e a contagem, nunca nomes). A sessao precisa ser deste webinario (senao 404). Resposta sem cache.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const INVALID_MESSAGE = "Pedido inválido.";
const MISSING_MESSAGE = "Essa sessão não existe mais.";

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiRole("messaging.write");

  if (auth.response) {
    return noStore(auth.response);
  }

  const { id } = await context.params;
  const sessionId = new URL(request.url).searchParams.get(WEBINAR_REPORT_SESSION_PARAM);

  if (!isUuid(id) || !isUuid(sessionId)) {
    return noStore(NextResponse.json({ error: INVALID_MESSAGE }, { status: 400 }));
  }

  try {
    const result = await webinarReportCsv({ sessionId, webinarId: id });

    if (!result) {
      return noStore(NextResponse.json({ error: MISSING_MESSAGE }, { status: 404 }));
    }

    await recordAudit(webinarsDb(), {
      action: "webinar_export",
      actorId: auth.user?.id ?? null,
      count: result.count,
      entityId: id,
      entityType: "webinar",
      metadata: { report: "attendee", session_id: sessionId, webinar_id: id }
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
    return noStore(jsonRouteError(error, "Não foi possível gerar o CSV. Tente de novo em instantes."));
  }
}
