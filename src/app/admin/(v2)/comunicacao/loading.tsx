import { CommunicationFrameSkeleton } from "@/components/admin/v2/frames/frame-skeletons";

// /admin/comunicacao so redireciona para a primeira aba.
export default function AdminCommunicationLoading() {
  return <CommunicationFrameSkeleton tab="avisos" />;
}
