import { MemberPage } from "@/components/member/ui/member-page";
import {
  MemberFilterBarSkeleton,
  MemberPageHeaderSkeleton,
  MemberPosterGridSkeleton,
  MemberShellSkeleton,
  MemberSkeletonBlock
} from "@/components/member/ui/member-skeletons";

// Esqueleto com a forma final de Favoritos (cabecalho, filtros por tipo e grade de capas).
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Favoritos...">
      <MemberPage>
        <MemberPageHeaderSkeleton />
        <MemberFilterBarSkeleton />
        <MemberSkeletonBlock className="mb-4 h-6 w-36" />
        <MemberPosterGridSkeleton count={6} />
      </MemberPage>
    </MemberShellSkeleton>
  );
}
