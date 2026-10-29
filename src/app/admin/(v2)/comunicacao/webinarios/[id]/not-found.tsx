import { CalendarX } from "lucide-react";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { AdminPage } from "@/components/admin/v2/page-container";
import { WEBINARS_HREF, WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";

// Webinario que nao existe (endereco errado ou rascunho excluido).
export default function AdminWebinarNotFound() {
  return (
    <AdminPage className="gap-6">
      <EmptyState
        action={{ href: WEBINARS_HREF, label: WEBINAR_ADMIN_COPY.header.notFoundAction }}
        description={WEBINAR_ADMIN_COPY.header.notFoundDescription}
        icon={CalendarX}
        title={WEBINAR_ADMIN_COPY.header.notFoundTitle}
      />
    </AdminPage>
  );
}
