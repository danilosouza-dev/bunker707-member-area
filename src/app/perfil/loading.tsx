import { MemberPage } from "@/components/member/ui/member-page";
import { MemberShellSkeleton, MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";

// Esqueleto do Perfil: foto e nome, abas e a lista de dados.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Perfil...">
      <MemberPage width="narrow">
        <div aria-hidden="true">
          <MemberSkeletonBlock className="mb-4 h-4 w-24" />
          <div className="flex items-center gap-4 sm:gap-5">
            <MemberSkeletonBlock className="size-16 shrink-0 rounded-full sm:size-20" />
            <div className="min-w-0 flex-1">
              <MemberSkeletonBlock className="h-7 w-56 max-w-full sm:h-9" />
              <MemberSkeletonBlock className="mt-2 h-4 w-44 max-w-full" />
            </div>
          </div>
          <div className="mb-8 mt-8 flex gap-6 border-b border-white/10 pb-4 sm:mt-10">
            {[96, 112, 84].map((width, index) => (
              <MemberSkeletonBlock className="h-5" key={index} style={{ width }} />
            ))}
          </div>
          <div className="grid gap-px overflow-hidden rounded-[12px]">
            {["a", "b", "c", "d", "e"].map((key) => (
              <MemberSkeletonBlock className="h-[68px] rounded-none" key={key} />
            ))}
          </div>
        </div>
      </MemberPage>
    </MemberShellSkeleton>
  );
}
