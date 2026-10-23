import { BookmarkX } from "lucide-react";
import { TEMPLATE_EDITOR_COPY } from "@/components/admin/v2/communication/template-editor-model";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { AdminPage } from "@/components/admin/v2/page-container";
import { TEMPLATES_HREF } from "@/server/communications/template-model";

// Modelo que nao existe (endereco errado ou modelo excluido; docs/28 §5.6).
export default function AdminTemplateNotFound() {
  return (
    <AdminPage className="gap-6">
      <EmptyState
        action={{ href: TEMPLATES_HREF, label: TEMPLATE_EDITOR_COPY.viewTemplates }}
        description={TEMPLATE_EDITOR_COPY.notFound.description}
        icon={BookmarkX}
        title={TEMPLATE_EDITOR_COPY.notFound.title}
      />
    </AdminPage>
  );
}
