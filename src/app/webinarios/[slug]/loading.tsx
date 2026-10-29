import { MemberPage } from "@/components/member/ui/member-page";
import { MemberShellSkeleton, MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";

// Esqueleto da pagina do Webinario: capa a esquerda, titulo, detalhes e o bloco do Garantir vaga.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando a live...">
      <MemberPage width="default">
        <MemberSkeletonBlock className="mb-6 h-4 w-24" />
        <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-8 lg:grid-cols-[240px_1fr] lg:gap-10">
          <MemberSkeletonBlock className="mx-auto aspect-[2/3] w-full max-w-[220px] rounded-[var(--member-cover-radius)] sm:mx-0 sm:max-w-none" />
          <div>
            <MemberSkeletonBlock className="h-5 w-40" />
            <MemberSkeletonBlock className="mt-4 h-9 w-3/4 sm:h-11" />
            <MemberSkeletonBlock className="mt-4 h-4 w-full max-w-2xl" />
            <MemberSkeletonBlock className="mt-2 h-4 w-2/3 max-w-xl" />
            <MemberSkeletonBlock className="mt-6 h-4 w-72" />
            <MemberSkeletonBlock className="mt-2 h-4 w-40" />
            <MemberSkeletonBlock className="mt-8 h-12 w-44 rounded-[var(--member-button-radius)]" />
          </div>
        </div>
      </MemberPage>
    </MemberShellSkeleton>
  );
}
