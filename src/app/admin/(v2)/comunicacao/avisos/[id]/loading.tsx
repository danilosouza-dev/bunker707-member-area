import { NoticeReportSkeleton } from "@/components/admin/v2/communication/notices-skeletons";

// O mesmo endereco abre o editor (rascunho) ou o relatorio (enviado): o skeleton e o do relatorio, que
// tem o cabecalho e os blocos na mesma posicao do editor.
export default function AdminNoticeLoading() {
  return <NoticeReportSkeleton />;
}
