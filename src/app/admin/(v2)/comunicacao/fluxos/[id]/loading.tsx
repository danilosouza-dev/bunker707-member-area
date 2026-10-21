import { FlowBuilderSkeleton } from "@/components/admin/v2/communication/flows/flows-skeletons";

// O mesmo endereco abre o construtor (rascunho) ou o relatorio (no ar, pausado, encerrado): a coluna de
// passos e o painel servem para os dois. Tambem aparece no primeiro "Salvar rascunho" (/novo -> /[id]).
export default function AdminFlowLoading() {
  return <FlowBuilderSkeleton />;
}
