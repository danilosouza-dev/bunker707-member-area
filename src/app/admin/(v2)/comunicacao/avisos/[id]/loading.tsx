import { NoticeDetailSkeleton } from "@/components/admin/v2/communication/notices-skeletons";

// O mesmo endereco abre o editor (rascunho, agendado, aguardando aprovacao) ou o relatorio (enviado, pop-up
// no ar): skeleton neutro, so com o cabecalho e duas colunas, que serve para os dois. Tambem aparece no
// primeiro "Salvar rascunho" de um aviso novo (/avisos/novo -> /avisos/[id]).
export default function AdminNoticeLoading() {
  return <NoticeDetailSkeleton />;
}
