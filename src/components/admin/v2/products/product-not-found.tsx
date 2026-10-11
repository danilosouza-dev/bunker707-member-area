import { PackageX } from "lucide-react";
import { EmptyState } from "../empty-state";

/** Produto inexistente ou excluido: fica dentro da moldura do admin, com o caminho de volta. */
export function ProductNotFound() {
  return (
    <EmptyState
      action={{ href: "/admin/produtos", label: "Ver produtos" }}
      description="Ele pode ter sido excluído, ou o endereço está incompleto."
      icon={PackageX}
      title="Produto não encontrado"
    />
  );
}
