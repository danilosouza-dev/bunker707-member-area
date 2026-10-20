import { NoticesListSkeleton } from "@/components/admin/v2/communication/notices-skeletons";

// /admin/comunicacao so redireciona para a primeira aba (Avisos e pop-ups).
export default function AdminCommunicationLoading() {
  return <NoticesListSkeleton />;
}
