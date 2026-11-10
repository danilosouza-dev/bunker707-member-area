import { MemberShellSkeleton, MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";

// Esqueleto da pagina do Webinario, na forma do destaque (docs/31 V2-17): o caminho, os selos, o titulo grande, a
// descricao, a linha de fatos, a contagem e o botao; a capa vertical em cima no celular e a direita no computador; e as
// tres linhas de baixo. As mesmas medidas do destaque da area (--member-hero-*) e o recuo das fileiras.
export default function Loading() {
  return (
    <MemberShellSkeleton label="Carregando a live...">
      <div className="min-h-screen bg-[#141414] pb-24">
        <div className="mx-[var(--member-hero-inset)] mt-[var(--member-hero-top)] rounded-[var(--member-hero-radius)]">
          <div className="flex w-full max-w-[1440px] flex-col px-5 pb-12 pt-24 sm:px-8 sm:pb-14 lg:px-12 lg:pt-28">
            <MemberSkeletonBlock className="h-4 w-56" />
            <div className="mt-8 grid gap-7 lg:mt-10 lg:grid-cols-[minmax(0,760px)_280px] lg:items-end lg:justify-between lg:gap-14">
              <MemberSkeletonBlock className="aspect-[2/3] w-[136px] rounded-[var(--member-cover-radius)] sm:w-[168px] lg:order-last lg:w-full" />
              <div>
                <MemberSkeletonBlock className="h-5 w-40" />
                <MemberSkeletonBlock className="mt-4 h-9 w-3/4 sm:h-12 lg:h-14" />
                <MemberSkeletonBlock className="mt-4 h-4 w-full max-w-2xl" />
                <MemberSkeletonBlock className="mt-2 h-4 w-2/3 max-w-xl" />
                <MemberSkeletonBlock className="mt-6 h-5 w-full max-w-lg" />
                <MemberSkeletonBlock className="mt-7 h-7 w-64" />
                <MemberSkeletonBlock className="mt-6 h-12 w-full rounded-[var(--member-button-radius)] sm:w-56" />
              </div>
            </div>
          </div>
        </div>
        <div className="grid w-full max-w-[1440px] gap-4 px-[var(--member-row-inset)] pt-10">
          <MemberSkeletonBlock className="h-5 w-36" />
          <div className="grid max-w-5xl gap-4 sm:grid-cols-3 sm:gap-6">
            <MemberSkeletonBlock className="h-10" />
            <MemberSkeletonBlock className="h-10" />
            <MemberSkeletonBlock className="h-10" />
          </div>
        </div>
      </div>
    </MemberShellSkeleton>
  );
}
