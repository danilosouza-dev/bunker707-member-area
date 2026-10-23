import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoticesListView } from "@/components/admin/v2/communication/notices-list-view";
import { noticesPageFallbackHref, parseNoticeKindParam, parseNoticesPage } from "@/components/admin/v2/communication/notices-view-model";
import { CommunicationTabs } from "@/components/admin/v2/frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE } from "@/components/admin/v2/frames/communication-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { readAdminPeriod } from "@/components/admin/v2/period";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { getCommunicationOverview, listNotices } from "@/server/communications/queries";
import { TEMPLATE_LIMITS } from "@/server/communications/template-model";
import { listRecentTemplates, type RecentTemplate } from "@/server/communications/template-queries";
import { isPendingMigrationError, loadUnlessPendingMigration } from "@/server/db/pending-migration";

// Aprovar, pausar ou retirar pela lista roda Server Actions desta rota (aprovar envia na hora).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Avisos e pop-ups · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const NO_RECENT_TEMPLATES: { items: RecentTemplate[]; total: number } = { items: [], total: 0 };

/**
 * Os modelos do menu "Novo aviso" (docs/28 §5.4; so os resumos, sem payload). Sem a migracao dos modelos, ou se a
 * leitura falhar, o botao continua o link de sempre: a lista de avisos nunca quebra por causa dos modelos.
 */
async function loadRecentTemplates(canWrite: boolean) {
  if (!canWrite) {
    return NO_RECENT_TEMPLATES;
  }

  try {
    return await listRecentTemplates(TEMPLATE_LIMITS.recentForNewNotice);
  } catch (error) {
    if (!isPendingMigrationError(error)) {
      console.error("[admin] Modelos do Novo aviso:", error instanceof Error ? error.message : error);
    }

    return NO_RECENT_TEMPLATES;
  }
}

// Comunicação › Avisos e pop-ups (docs/22 §2.1): os quatro numeros do periodo da barra superior, filtro
// por tipo (?tipo=notificacao|popup) e a lista paginada (?pagina=), com as acoes de cada aviso. Pagina
// depois da ultima volta para a ultima que tem avisos (ou para a primeira). Os modelos recentes (docs/28) vao
// para o menu do "Novo aviso", lidos junto com a lista.
export default async function AdminAnnouncementsPage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);
  const period = readAdminPeriod(params, new Date());
  const kind = parseNoticeKindParam(params.tipo);
  const pageNumber = parseNoticesPage(params.pagina);
  const permissions = {
    canPublish: can(access, "messaging.publish"),
    canPublishLarge: can(access, "messaging.publish_large"),
    canWrite: can(access, "messaging.write")
  };
  const [loaded, recent] = await Promise.all([
    loadUnlessPendingMigration(async () => {
      const [page, overview] = await Promise.all([
        listNotices({ kind, page: pageNumber, permissions }),
        getCommunicationOverview({ end: period.end, start: period.start })
      ]);

      return { overview, page };
    }),
    loadRecentTemplates(permissions.canWrite)
  ]);

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <PageHeader description={COMMUNICATION_TAB_META.avisos.description} title={COMMUNICATION_TITLE} />
          <CommunicationTabs />
        </div>
        <PendingMigrationNotice migration="202610200001" />
      </AdminPage>
    );
  }

  const fallback = noticesPageFallbackHref({
    itemCount: loaded.data.page.items.length,
    page: pageNumber,
    pageSize: loaded.data.page.pageSize,
    searchParams: params,
    total: loaded.data.page.total
  });

  if (fallback) {
    redirect(fallback);
  }

  return (
    <NoticesListView
      canWrite={permissions.canWrite}
      kind={kind}
      overview={loaded.data.overview}
      page={loaded.data.page}
      period={period}
      recent={recent}
      searchParams={params}
    />
  );
}
