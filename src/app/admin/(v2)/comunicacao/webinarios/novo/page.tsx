import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WebinarEditor } from "@/components/admin/v2/communication/webinars/webinar-editor";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { WEBINARS_MIGRATION } from "@/server/webinars/db";
import { WEBINARS_HREF, WEBINAR_ADMIN_COPY, WEBINAR_KIND_PARAM, parseWebinarKindParam } from "@/server/webinars/editor-model";
import { liveRoomConfigured } from "@/server/webinars/live-model";
import { loadWebinarEditorOptions } from "@/server/webinars/queries";

// Publicar roda Server Actions desta rota (cria as sessoes).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Novo webinário · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura (renderizado no servidor): o "agora" da previa. */
function readNow() {
  return Date.now();
}

// Comunicação › Webinários › Novo webinário (docs/30 §2.2): pergunta o tipo em duas pilulas (ou abre ja no tipo de
// ?tipo=ao-vivo|gravada) e segue para os cards. So quem cria avisos (messaging.write) entra; o resto volta para a
// lista. O card Gravacao recebe, lido no servidor, se a sala ao vivo existe neste ambiente (so o booleano).
export default async function AdminNewWebinarPage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(WEBINARS_HREF);
  }

  const loaded = await loadUnlessPendingMigration(() => loadWebinarEditorOptions());

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader
          breadcrumb={[{ href: WEBINARS_HREF, label: WEBINAR_ADMIN_COPY.header.breadcrumbList }, { label: WEBINAR_ADMIN_COPY.header.newTitle }]}
          title={WEBINAR_ADMIN_COPY.header.newTitle}
        />
        <PendingMigrationNotice migration={WEBINARS_MIGRATION} />
      </AdminPage>
    );
  }

  return (
    <WebinarEditor
      defaultKind={parseWebinarKindParam(params[WEBINAR_KIND_PARAM])}
      initial={null}
      liveRoomReady={liveRoomConfigured(process.env)}
      now={readNow()}
      options={loaded.data}
      permissions={{ canPublish: can(access, "messaging.publish"), canWrite: true }}
    />
  );
}
