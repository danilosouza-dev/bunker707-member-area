import { MemberPage } from "@/components/member/ui/member-page";
import {
  MemberLessonGridSkeleton,
  MemberPageHeaderSkeleton,
  MemberShellSkeleton,
  MemberSkeletonBlock
} from "@/components/member/ui/member-skeletons";

// Esqueleto de Continue assistindo: cabecalho e grade de aulas 16:9.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Continue assistindo...">
      <MemberPage>
        <MemberPageHeaderSkeleton />
        <MemberSkeletonBlock className="mb-4 h-6 w-40" />
        <MemberLessonGridSkeleton count={8} />
      </MemberPage>
    </MemberShellSkeleton>
  );
}
