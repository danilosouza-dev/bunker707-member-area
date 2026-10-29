import { WebinarDetailSkeleton } from "@/components/admin/v2/communication/webinars/webinars-skeletons";

// O editor de um webinario: cabecalho (trilha, titulo e situacao) e duas colunas. Tambem aparece no primeiro
// "Salvar rascunho" de um webinario novo (/webinarios/novo -> /webinarios/[id]).
export default function AdminWebinarLoading() {
  return <WebinarDetailSkeleton />;
}
