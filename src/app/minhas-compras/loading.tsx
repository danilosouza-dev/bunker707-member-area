import { MemberPage } from "@/components/member/ui/member-page";
import {
  MemberFilterBarSkeleton,
  MemberPageHeaderSkeleton,
  MemberPosterGridSkeleton,
  MemberShellSkeleton
} from "@/components/member/ui/member-skeletons";

// Esqueleto com a forma final de Minhas compras (cabecalho com numeros, filtros e grade de capas).
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Minhas compras...">
      <MemberPage>
        <MemberPageHeaderSkeleton withStats />
        <MemberFilterBarSkeleton />
        <MemberPosterGridSkeleton count={10} />
      </MemberPage>
    </MemberShellSkeleton>
  );
}
