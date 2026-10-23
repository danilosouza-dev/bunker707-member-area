import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DesignTemplateEditor } from "@/components/admin/v2/communication/design-template-editor";
import { NoticeEditor } from "@/components/admin/v2/communication/notice-editor";
import { TemplateKindChoice } from "@/components/admin/v2/communication/template-kind-choice";
import { TEMPLATE_EDITOR_COPY } from "@/components/admin/v2/communication/template-editor-model";
import { COMMUNICATION_HOME_HREF } from "@/components/admin/v2/frames/communication-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadNoticeEditorOptions } from "@/server/communications/queries";
import { TEMPLATES_HREF, kindOfTemplateType, parseTemplateTypeParam } from "@/server/communications/template-model";
import { prepareTemplateEditor } from "@/server/communications/template-queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: TEMPLATE_EDITOR_COPY.pageTitles.new
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura (renderizado no servidor): o "agora" da previa. */
function readNow() {
  return Date.now();
}

// Comunicação › Modelos › Novo modelo (docs/28 §5.5 e §5.6): sem ?tipo (ou com um valor desconhecido), a escolha do
// tipo; com ?tipo=notificacao|popup, o editor do aviso em modo modelo, vazio; com ?tipo=design-personalizado|
// design-livre, a pagina do modelo de Design, vazia. Nada e gravado ate "Salvar modelo". So quem cria avisos
// (messaging.write) entra; o resto volta para a Comunicação.
export default async function AdminNewTemplatePage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(COMMUNICATION_HOME_HREF);
  }

  const type = parseTemplateTypeParam(params.tipo);

  if (!type) {
    return <TemplateKindChoice />;
  }

  const { kind, mode } = kindOfTemplateType(type);
  const loaded = await loadUnlessPendingMigration(async () => {
    const editor = await prepareTemplateEditor(kind === "design" && mode ? { kind, mode } : { kind });
    const options = await loadNoticeEditorOptions(editor?.ok ? { audiences: editor.audiences } : {});

    return { editor, options };
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader
          breadcrumb={[{ href: TEMPLATES_HREF, label: TEMPLATE_EDITOR_COPY.breadcrumb.list }, { label: TEMPLATE_EDITOR_COPY.breadcrumb.new }]}
          title={TEMPLATE_EDITOR_COPY.choice.title}
        />
        <PendingMigrationNotice migration="202610250001" />
      </AdminPage>
    );
  }

  const { editor, options } = loaded.data;

  // Um tipo que nao abre (Design sem modo): a escolha do tipo.
  if (!editor || !editor.ok) {
    return <TemplateKindChoice />;
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
