import { MemberPage } from "@/components/member/ui/member-page";
import {
  MemberFilterBarSkeleton,
  MemberListSkeleton,
  MemberPageHeaderSkeleton,
  MemberShellSkeleton,
  MemberSkeletonBlock
} from "@/components/member/ui/member-skeletons";

// Esqueleto de Materiais: cabecalho, filtros e lista de arquivos por aula.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Materiais...">
      <MemberPage width="default">
        <MemberPageHeaderSkeleton />
        <MemberFilterBarSkeleton />
        <MemberSkeletonBlock className="mb-5 mt-8 h-6 w-64 max-w-full" />
        <MemberListSkeleton rows={5} />
      </MemberPage>
    </MemberShellSkeleton>
  );
}
