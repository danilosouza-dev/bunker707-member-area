import { MemberPage } from "@/components/member/ui/member-page";
import { MemberPageHeaderSkeleton, MemberShellSkeleton, MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";

// Esqueleto de Minhas licencas: o cabecalho e dois cartoes de Licenca, enquanto a lista vem do servico de licencas.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Minhas licenças...">
      <MemberPage width="narrow">
        <MemberPageHeaderSkeleton />
        <div aria-hidden="true" className="grid gap-4">
          <MemberSkeletonBlock className="h-56 w-full" />
          <MemberSkeletonBlock className="h-56 w-full" />
        </div>
      </MemberPage>
    </MemberShellSkeleton>
  );
}
