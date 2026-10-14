import { MemberPage } from "@/components/member/ui/member-page";
import { MemberPageHeaderSkeleton, MemberShellSkeleton, MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";

// Esqueleto de Minha jornada: cabecalho com numeros, aulas para retomar (4 no computador, 2 no
// celular, como a pagina) e cards de progresso por curso.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Minha jornada...">
      <MemberPage>
        <MemberPageHeaderSkeleton withStats />
        <div aria-hidden="true">
          <MemberSkeletonBlock className="mb-4 h-6 w-56" />
          <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 xl:grid-cols-4 max-sm:[&>*:nth-child(n+3)]:hidden">
            {["a", "b", "c", "d"].map((key) => (
              <div key={key}>
                <MemberSkeletonBlock className="aspect-video rounded-[10px]" />
                <MemberSkeletonBlock className="mt-3 h-4 w-4/5" />
                <MemberSkeletonBlock className="mt-2 h-3 w-3/5" />
              </div>
            ))}
          </div>
          <MemberSkeletonBlock className="mb-4 mt-14 h-6 w-40" />
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:w-[calc(100%-420px)]">
            {["a", "b", "c", "d"].map((key) => (
              <div className="flex gap-4 rounded-[12px] border border-white/[0.06] bg-white/[0.02] p-3 sm:p-4" key={key}>
                <MemberSkeletonBlock className="aspect-[2/3] w-[76px] shrink-0 sm:w-[92px]" />
                <div className="min-w-0 flex-1">
                  <MemberSkeletonBlock className="h-5 w-24 rounded-full" />
                  <MemberSkeletonBlock className="mt-3 h-4 w-4/5" />
                  <MemberSkeletonBlock className="mt-4 h-1.5 w-full rounded-full" />
                  <MemberSkeletonBlock className="mt-2 h-3 w-2/5" />
                  <MemberSkeletonBlock className="mt-4 h-9 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </MemberPage>
    </MemberShellSkeleton>
  );
}
