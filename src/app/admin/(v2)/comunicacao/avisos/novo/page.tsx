import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoticeEditor } from "@/components/admin/v2/communication/notice-editor";
import { NOTICES_HREF, parseNoticeKindParam } from "@/components/admin/v2/communication/notices-view-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadNoticeEditorOptions } from "@/server/communications/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

// Publicar agora envia dentro da Server Action desta rota (em lotes).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Novo aviso · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura (renderizado no servidor): o "agora" da previa. */
function readNow() {
  return Date.now();
}

// Comunicação › Avisos e pop-ups › Novo aviso (docs/22 §2.2): ?tipo=popup abre em pop-up. So quem cria
// avisos (messaging.write) entra; o resto volta para a lista.
export default async function AdminNewNoticePage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(NOTICES_HREF);
  }

  const loaded = await loadUnlessPendingMigration(() => loadNoticeEditorOptions());

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={[{ href: NOTICES_HREF, label: "Avisos e pop-ups" }, { label: "Novo aviso" }]} title="Novo aviso" />
        <PendingMigrationNotice migration="202610200001" />
      </AdminPage>
    );
  }

  return (
    <NoticeEditor
      defaultKind={parseNoticeKindParam(params.tipo) ?? "inbox"}
      initial={null}
      now={readNow()}
      options={loaded.data}
      permissions={{
        canPublish: can(access, "messaging.publish"),
        canPublishLarge: can(access, "messaging.publish_large"),
        canWrite: true
      }}
    />
  );
}
