import { BookmarkX } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DesignTemplateEditor } from "@/components/admin/v2/communication/design-template-editor";
import { NoticeEditor } from "@/components/admin/v2/communication/notice-editor";
import { TEMPLATE_EDITOR_COPY } from "@/components/admin/v2/communication/template-editor-model";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { COMMUNICATION_HOME_HREF } from "@/components/admin/v2/frames/communication-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadNoticeEditorOptions } from "@/server/communications/queries";
import { TEMPLATES_HREF } from "@/server/communications/template-model";
import { prepareTemplateEditor } from "@/server/communications/template-queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: TEMPLATE_EDITOR_COPY.pageTitles.edit
};

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Hora da leitura (renderizado no servidor): o "agora" da previa. */
function readNow() {
  return Date.now();
}

// Comunicação › Modelos › Editar modelo (docs/28 §5.6 e §5.7): o editor do aviso em modo modelo (notificacao e pop-up)
// ou a pagina do modelo de Design, com os ids gravados (D28). Payload que nao abre: o estado vazio com "Ver modelos".
// Inexistente, excluido ou id invalido: not-found. So quem cria avisos (messaging.write) entra.
export default async function AdminTemplatePage({ params }: PageProps) {
  const [{ access }, { id }] = await Promise.all([requirePageArea("comunicacao"), params]);

  if (!can(access, "messaging.write")) {
    redirect(COMMUNICATION_HOME_HREF);
  }

  const loaded = await loadUnlessPendingMigration(async () => {
    const editor = await prepareTemplateEditor({ id });
    const options = editor?.ok ? await loadNoticeEditorOptions({ audiences: editor.audiences }) : null;

    return { editor, options };
  });
  const breadcrumb = [{ href: TEMPLATES_HREF, label: TEMPLATE_EDITOR_COPY.breadcrumb.list }, { label: TEMPLATE_EDITOR_COPY.breadcrumb.edit }];

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={breadcrumb} title={TEMPLATE_EDITOR_COPY.breadcrumb.edit} />
        <PendingMigrationNotice migration="202610250001" />
      </AdminPage>
    );
  }

  const { editor, options } = loaded.data;

  if (!editor) {
    notFound();
  }

  if (!editor.ok || !options) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={breadcrumb} title={TEMPLATE_EDITOR_COPY.title(editor.ok ? editor.template.name : editor.name)} />
        <EmptyState
          action={{ href: TEMPLATES_HREF, label: TEMPLATE_EDITOR_COPY.unreadable.action }}
          description={TEMPLATE_EDITOR_COPY.unreadable.description}
          icon={BookmarkX}
          title={TEMPLATE_EDITOR_COPY.unreadable.title}
        />
      </AdminPage>
    );
  }

  if (editor.template.kind === "design") {
    return <DesignTemplateEditor now={readNow()} options={options} template={editor.template} />;
  }

  return (
    <NoticeEditor
      defaultKind={editor.template.kind}
      initial={null}
      now={readNow()}
      options={options}
      permissions={{ canPublish: can(access, "messaging.publish"), canPublishLarge: can(access, "messaging.publish_large"), canWrite: true }}
      template={editor.template}
    />
  );
}
