import { MemberPage } from "@/components/member/ui/member-page";
import { MemberPageHeaderSkeleton, MemberShellSkeleton, MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";

// Esqueleto de Suporte: canais, perguntas frequentes e atalhos.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando Suporte...">
      <MemberPage width="narrow">
        <MemberPageHeaderSkeleton />
        <div aria-hidden="true">
          <MemberSkeletonBlock className="mb-4 h-6 w-44" />
          <div className="grid gap-3 sm:grid-cols-2">
            <MemberSkeletonBlock className="h-[164px] rounded-[12px]" />
            <MemberSkeletonBlock className="h-[164px] rounded-[12px]" />
          </div>
          <MemberSkeletonBlock className="mb-4 mt-14 h-6 w-52" />
          <div className="grid gap-px overflow-hidden rounded-[12px]">
            {["a", "b", "c", "d", "e", "f"].map((key) => (
              <MemberSkeletonBlock className="h-[53px] rounded-none" key={key} />
            ))}
          </div>
        </div>
      </MemberPage>
    </MemberShellSkeleton>
  );
}
