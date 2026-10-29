import { MemberPage } from "@/components/member/ui/member-page";
import { MemberPageHeaderSkeleton, MemberPosterGridSkeleton, MemberShellSkeleton, MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";

// Esqueleto de Webinarios: cabecalho, o destaque da Proxima live e a grade dos seguintes.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Webinários...">
      <MemberPage width="default">
        <MemberPageHeaderSkeleton />
        <MemberSkeletonBlock className="mb-4 h-6 w-40" />
        <MemberSkeletonBlock className="mb-10 h-[260px] rounded-[12px] sm:h-[300px]" />
        <MemberPosterGridSkeleton count={5} />
      </MemberPage>
    </MemberShellSkeleton>
  );
}
