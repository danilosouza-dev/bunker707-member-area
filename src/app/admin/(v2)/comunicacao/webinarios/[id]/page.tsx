import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WebinarEditor } from "@/components/admin/v2/communication/webinars/webinar-editor";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { WEBINARS_MIGRATION } from "@/server/webinars/db";
import { WEBINARS_HREF, WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { getWebinarEditorData, loadWebinarEditorOptions } from "@/server/webinars/queries";

// Publicar, cancelar e excluir rodam Server Actions desta rota.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Webinário · Comunicação"
};

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Hora da leitura (renderizado no servidor): a situacao e o "agora" da previa. */
function readNow() {
  return Date.now();
}

// Comunicação › Webinários › um webinário (docs/30 §2.2 e §2.3): o editor em cards com a situacao e os botoes
// dela no topo. O relatorio (aba Relatório) chega com a fase 2. Webinario que nao existe (ou excluido): 404.
export default async function AdminWebinarPage({ params }: PageProps) {
  const [{ access }, { id }] = await Promise.all([requirePageArea("comunicacao"), params]);

  if (!can(access, "messaging.write")) {
    redirect(WEBINARS_HREF);
  }

  const now = readNow();
  const loaded = await loadUnlessPendingMigration(async () => {
    const detail = await getWebinarEditorData(id, now);

    if (!detail) {
      return null;
    }

    return { detail, options: await loadWebinarEditorOptions({ audiences: [detail.draft.audience] }) };
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader
          breadcrumb={[{ href: WEBINARS_HREF, label: WEBINAR_ADMIN_COPY.header.breadcrumbList }, { label: WEBINAR_ADMIN_COPY.header.pendingTitle }]}
          title={WEBINAR_ADMIN_COPY.header.pendingTitle}
        />
        <PendingMigrationNotice migration={WEBINARS_MIGRATION} />
      </AdminPage>
    );
  }

  if (!loaded.data) {
    notFound();
  }

  return (
    <WebinarEditor
      defaultKind={loaded.data.detail.draft.kind}
      initial={loaded.data.detail}
      now={now}
      options={loaded.data.options}
      permissions={{ canPublish: can(access, "messaging.publish"), canWrite: true }}
    />
  );
}
