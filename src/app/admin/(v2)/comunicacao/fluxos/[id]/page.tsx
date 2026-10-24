import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FlowBuilder } from "@/components/admin/v2/communication/flows/flow-builder";
import { FlowReport } from "@/components/admin/v2/communication/flows/flow-report";
import { FLOW_EDIT_PARAM, FLOW_STEP_PARAM, FLOWS_HREF, parseFlowStepParam } from "@/components/admin/v2/communication/flows/flows-view-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { flowDefinitions, getFlowDetail } from "@/server/communications/flow-queries";
import { loadNoticeEditorOptions } from "@/server/communications/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

// Ativar, aprovar e aplicar alteracoes contam quem entra agora dentro das Server Actions desta rota.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Fluxo · Comunicação"
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura (renderizado no servidor): o "agora" da previa e dos numeros. */
function readNow() {
  return Date.now();
}

// Comunicação › Fluxos › um fluxo (docs/23 §2.5 a §2.8). Rascunho e aguardando aprovacao abrem no
// construtor; no ar, pausado, encerrado ou concluido, no relatorio (o desenho com os numeros). ?editar=1 abre
// as alteracoes de um fluxo no ar so para quem pode muda-lo (messaging.publish); os demais veem o
// relatorio. ?passo= abre um passo (o /avisos/[id] de uma notificacao de fluxo leva para ca).
export default async function AdminFlowPage({ params, searchParams }: PageProps) {
  const [{ access }, { id }, query] = await Promise.all([requirePageArea("comunicacao"), params, searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(FLOWS_HREF);
  }

  const now = readNow();
  const permissions = {
    canPublish: can(access, "messaging.publish"),
    canPublishLarge: can(access, "messaging.publish_large"),
    canWrite: true
  };
  const step = parseFlowStepParam(query[FLOW_STEP_PARAM]);
  const loaded = await loadUnlessPendingMigration(async () => {
    const detail = await getFlowDetail(id, { now, permissions });

    if (!detail) {
      return null;
    }

    const live = detail.status === "active" || detail.status === "paused";
    const editor = detail.status === "draft" || detail.status === "pending_approval" || (live && query[FLOW_EDIT_PARAM] === "1" && detail.actions.includes("edit"));
    const options = await loadNoticeEditorOptions({ audiences: flowDefinitions(detail.draft) });

    return { detail, options, view: editor ? ("builder" as const) : ("report" as const) };
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={[{ href: FLOWS_HREF, label: "Fluxos" }, { label: "Fluxo" }]} title="Fluxo" />
        <PendingMigrationNotice migration="202610200002" />
      </AdminPage>
    );
  }

  if (!loaded.data) {
    notFound();
  }

  const { detail, options, view } = loaded.data;

  if (view === "builder") {
    return <FlowBuilder initial={detail} initialStep={step} key={detail.id} now={now} options={options} permissions={permissions} />;
  }

  return <FlowReport detail={detail} initialStep={step} now={now} options={options} permissions={permissions} />;
}
