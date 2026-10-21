import { Workflow } from "lucide-react";
import { FLOWS_HREF } from "@/components/admin/v2/communication/flows/flows-view-model";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { AdminPage } from "@/components/admin/v2/page-container";

// Fluxo que nao existe (endereco errado ou fluxo excluido).
export default function AdminFlowNotFound() {
  return (
    <AdminPage className="gap-6">
      <EmptyState
        action={{ href: FLOWS_HREF, label: "Ver fluxos" }}
        description="Ele pode ter sido excluído. Os outros fluxos continuam na lista."
        icon={Workflow}
        title="Este fluxo não existe mais"
      />
    </AdminPage>
  );
}
