import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FlowTemplates } from "@/components/admin/v2/communication/flows/flow-templates";
import { FLOWS_HREF } from "@/components/admin/v2/communication/flows/flows-view-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadNoticeEditorOptions } from "@/server/communications/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

// Ativar conta quem entra agora dentro da Server Action desta rota.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Novo fluxo · Comunicação"
};

/** Hora da leitura (renderizado no servidor): o "agora" da previa. */
function readNow() {
  return Date.now();
}

// Comunicação › Fluxos › Novo fluxo (docs/23 §2.5): "Como você quer começar?" com os quatro modelos; o
// construtor abre na mesma tela e nada e gravado ate "Salvar rascunho". So quem cria (messaging.write) entra.
export default async function AdminNewFlowPage() {
  const { access } = await requirePageArea("comunicacao");

  if (!can(access, "messaging.write")) {
    redirect(FLOWS_HREF);
  }

  const loaded = await loadUnlessPendingMigration(() => loadNoticeEditorOptions());

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={[{ href: FLOWS_HREF, label: "Fluxos" }, { label: "Novo fluxo" }]} title="Novo fluxo" />
        <PendingMigrationNotice migration="202610200002" />
      </AdminPage>
    );
  }

  return (
    <FlowTemplates
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
