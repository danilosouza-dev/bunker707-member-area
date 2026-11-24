import { NextResponse } from "next/server";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { csvFileName, toCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit/log";
import { requireApiRole } from "@/server/auth/permissions";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { isUuid, noStore } from "@/server/communications/route-support";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { jsonRouteError } from "@/server/http/route-errors";
import { isMissingWebinarSchema, webinarsDb } from "@/server/webinars/db";
import { listGuestRows } from "@/server/webinars/guest-store";
import { guestCsvRows } from "@/server/webinars/open-link-model";
import { fetchWebinarRow } from "@/server/webinars/store";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import { licenseRouteRefusal } from "@/server/licensing/guards";

// A lista de quem entrou pelo link aberto (docs/30 §14, D133): GET /api/admin/webinars/[id]/convidados/csv baixa o CSV
// (Entrada, Nome, E-mail, Telefone, Autorização, Autorizado em, Origem), do mais novo ao mais antigo. Quem ve o
// relatorio baixa (messaging.write, como os CSVs do relatorio); cada download grava a auditoria webinar_export com a
// contagem (numeros, nunca nomes). Webinario que nao existe: 404; banco sem a migracao 202611190001: 503. Sem cache.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const OPEN_LINK_MIGRATION = "202611190001";

export async function GET(_request: Request, context: RouteContext) {
  const licenseRefusal = await licenseRouteRefusal({ feature: WEBINARS_FEATURE });
  if (licenseRefusal) return licenseRefusal;

  const auth = await requireApiRole("messaging.write");

  if (auth.response) {
    return noStore(auth.response);
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return noStore(NextResponse.json({ error: WEBINAR_COPY.exportar.sessaoNaoExiste }, { status: 400 }));
  }

  try {
    const db = webinarsDb();
    const webinar = await fetchWebinarRow(db, id.toLowerCase());

    if (!webinar) {
      return noStore(NextResponse.json({ error: WEBINAR_COPY.exportar.sessaoNaoExiste }, { status: 404 }));
    }

    const rows = await listGuestRows(db, webinar.id);
    const csv = toCsv(
      WEBINAR_COPY.linkAberto.csv.colunas,
      guestCsvRows(
        rows.map((row) => ({
          consentAt: row.consent_at,
          consentText: row.consent_text,
          createdAt: row.created_at,
          email: row.email,
          name: row.full_name,
          phone: row.phone,
          source: row.source
        })),
        (iso) => formatSaoPauloDateTime(iso)
      )
    );

    await recordAudit(db, {
      action: "webinar_export",
      actorId: auth.user?.id ?? null,
      count: rows.length,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { report: "open_link", webinar_id: webinar.id }
    });

    return noStore(
      new NextResponse(csv, {
        headers: {
          "Content-Disposition": `attachment; filename="${csvFileName(`${WEBINAR_COPY.linkAberto.csv.arquivo}-${webinar.slug}`, new Date())}"`,
          "Content-Type": "text/csv; charset=utf-8"
        },
        status: 200
      })
    );
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return noStore(NextResponse.json({ error: WEBINAR_COPY.exportar.migracaoPendente(OPEN_LINK_MIGRATION) }, { status: 503 }));
    }

    return noStore(jsonRouteError(error, WEBINAR_COPY.exportar.erro));
  }
}
