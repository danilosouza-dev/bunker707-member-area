import { BellOff } from "lucide-react";
import { NOTICES_HREF } from "@/components/admin/v2/communication/notices-view-model";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { AdminPage } from "@/components/admin/v2/page-container";

// Aviso que nao existe (endereco errado ou aviso excluido).
export default function AdminNoticeNotFound() {
  return (
    <AdminPage className="gap-6">
      <EmptyState
        action={{ href: NOTICES_HREF, label: "Ver avisos e pop-ups" }}
        description="Ele pode ter sido excluído. Os outros avisos continuam na lista."
        icon={BellOff}
        title="Este aviso não existe mais"
      />
    </AdminPage>
  );
}
