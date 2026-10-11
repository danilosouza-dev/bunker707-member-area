import { CommunityPageSkeleton } from "@/components/admin/v2/community/community-skeletons";

export default function AdminCommunityLoading() {
  return <CommunityPageSkeleton label="Carregando as perguntas sem resposta" variant="queue" />;
}
