import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WebinarReportView } from "@/components/admin/v2/communication/webinars/report/report-view";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { isUuid } from "@/server/communications/route-support";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { WEBINARS_MIGRATION } from "@/server/webinars/db";
import { WEBINARS_HREF, WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { WEBINAR_REPORT_SESSION_PARAM } from "@/server/webinars/report-page-model";
import { getWebinarReportPage } from "@/server/webinars/report-queries";

export const metadata: Metadata = {
  title: "Relatório · Webinário · Comunicação"
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Comunicação › Webinários › um webinário › Relatório (docs/30 §2.5 e §3.4): o seletor de sessao (?sessao=), os
// numeros, a curva, o chat, as perguntas, as enquetes, as vagas, o replay, a Simulacao e a lista por aluno com o
// CSV. Ver e messaging.write, como as outras telas de Comunicacao; o relatorio da sessao fica 60 s em cache (tag
// webinars). Webinario que nao existe: 404. Banco sem a migracao 202610290001: o aviso no lugar dos numeros.
export default async function AdminWebinarReportPage({ params, searchParams }: PageProps) {
  const [{ access }, { id }, query] = await Promise.all([requirePageArea("comunicacao"), params, searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(WEBINARS_HREF);
  }

  if (!isUuid(id)) {
    notFound();
  }

  const requested = query[WEBINAR_REPORT_SESSION_PARAM];
  const sessionId = typeof requested === "string" && isUuid(requested) ? requested : null;
  const loaded = await loadUnlessPendingMigration(() => getWebinarReportPage(id, { sessionId }));

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader
          breadcrumb={[{ href: WEBINARS_HREF, label: WEBINAR_ADMIN_COPY.header.breadcrumbList }, { label: WEBINAR_COPY.relatorio.titulo }]}
          title={WEBINAR_COPY.relatorio.titulo}
        />
        <PendingMigrationNotice migration={WEBINARS_MIGRATION} />
      </AdminPage>
    );
  }

  if (!loaded.data) {
    notFound();
  }

  return <WebinarReportView page={loaded.data} />;
}
