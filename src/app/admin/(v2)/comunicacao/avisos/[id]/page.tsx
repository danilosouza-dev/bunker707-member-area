import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { NoticeEditor } from "@/components/admin/v2/communication/notice-editor";
import { NoticeReport } from "@/components/admin/v2/communication/notice-report";
import { PopupReportLoader } from "@/components/admin/v2/communication/popup-report-loader";
import { PopupReportSkeleton } from "@/components/admin/v2/communication/popup-report-section";
import { NOTICE_EDIT_PARAM, NOTICES_HREF, opensNoticeEditor } from "@/components/admin/v2/communication/notices-view-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { getNoticeDetail, loadNoticeBranding, loadNoticeEditorOptions } from "@/server/communications/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

// Publicar, aprovar e retirar rodam Server Actions desta rota (publicar agora envia em lotes).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Aviso · Comunicação"
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Conteudo de um passo de fluxo: o fluxo, aberto no passo (docs/23). */
function flowStepHref(flowId: string, nodeId: string | null) {
  const base = `/admin/comunicacao/fluxos/${encodeURIComponent(flowId)}`;

  return nodeId ? `${base}?passo=${encodeURIComponent(nodeId)}` : base;
}

/** Hora da leitura (renderizado no servidor): situacao do pop-up e o "agora" da previa. */
function readNow() {
  return Date.now();
}

// Comunicação › Avisos e pop-ups › um aviso (docs/22 §2.2 e §2.4). Rascunho, aguardando aprovação e
// notificação agendada abrem no editor; enviado, cancelado e encerrado, no relatório. Pop-up no ar ou
// pausado abre no relatório, com "Editar" (?editar=1) para o editor so para quem pode edita-lo. O
// conteudo de um passo de fluxo (v2) nao e aviso da lista: o endereco leva para o fluxo, no passo.
// v3a (docs/24 §2.2): a notificação enviada tambem abre no relatório; o editor (so o conteudo) so com
// ?editar=1 e "edit" nas ações (messaging.publish e, acima de 500 alunos, messaging.publish_large), pela
// mesma regra de opensNoticeEditor. Sem a permissao, o ?editar=1 abre o relatório.
// v3b-2 (docs/29 §2.6 e §6.2): no pop-up que ja foi ao ar, o relatorio "Como o pop-up foi visto" num Suspense (o
// funil e o resto da pagina nao esperam a RPC).
export default async function AdminNoticePage({ params, searchParams }: PageProps) {
  const [{ access }, { id }, query] = await Promise.all([requirePageArea("comunicacao"), params, searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(NOTICES_HREF);
  }

  const now = readNow();
  const permissions = {
    canPublish: can(access, "messaging.publish"),
    canPublishLarge: can(access, "messaging.publish_large"),
    canWrite: true
  };
  const wantsEditor = query[NOTICE_EDIT_PARAM] === "1";
  const loaded = await loadUnlessPendingMigration(async () => {
    const detail = await getNoticeDetail(id, { now, permissions });

    if (!detail) {
      return null;
    }

    if (detail.flowId) {
      return { href: flowStepHref(detail.flowId, detail.flowNodeId), view: "flow" as const };
    }

    if (opensNoticeEditor({ ...detail, wantsEditor })) {
      return { detail, options: await loadNoticeEditorOptions({ audiences: [detail.draft.audience] }), view: "editor" as const };
    }

    return { branding: await loadNoticeBranding(), detail, view: "report" as const };
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={[{ href: NOTICES_HREF, label: "Avisos e pop-ups" }, { label: "Aviso" }]} title="Aviso" />
        <PendingMigrationNotice migration="202610200001" />
      </AdminPage>
    );
  }

  if (!loaded.data) {
    notFound();
  }

  const data = loaded.data;

  if (data.view === "flow") {
    redirect(data.href);
  }

  if (data.view === "editor") {
    return <NoticeEditor defaultKind={data.detail.kind} initial={data.detail} now={now} options={data.options} permissions={permissions} />;
  }

  const popupReport =
    data.detail.kind === "popup" && data.detail.sentAt !== null ? (
      <Suspense fallback={<PopupReportSkeleton />}>
        <PopupReportLoader campaignId={data.detail.id} />
      </Suspense>
    ) : null;

  return <NoticeReport branding={data.branding} detail={data.detail} now={now} permissions={permissions} popupReport={popupReport} />;
}
