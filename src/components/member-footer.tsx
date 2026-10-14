import Image from "next/image";
import { MemberProgressLink } from "@/components/member/ui/member-progress-link";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import type { PlatformBrandingConfig } from "@/lib/platform-types";

export function MemberFooter({ branding }: { branding?: PlatformBrandingConfig }) {
  const logoImage = branding === undefined ? "/brand/logo-bunker.svg" : branding.logoImage;

  return (
    <footer className="border-t border-white/10 px-5 py-7 text-xs text-zinc-500 sm:px-8 lg:px-12">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        {/* Links do rodape gravam o progresso da aula antes de sair (o rodape tambem aparece na aula). */}
        <MemberProgressLink
          aria-label="Voltar para a home"
          className="inline-flex shrink-0 rounded-[6px] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          href="/"
        >
          {logoImage ? (
            <Image
              alt="Bunker707"
              className="h-auto max-h-9 w-[150px] object-contain object-left"
              height={35}
              src={logoImage}
              unoptimized
              width={306}
            />
          ) : (
            <span className="text-base font-black uppercase tracking-wide text-white">Bunker707</span>
          )}
        </MemberProgressLink>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p>(c) 2026 Bunker707</p>
          <p>Conteúdos liberados conforme os acessos ativos.</p>
        </div>

        <nav aria-label="Rodapé" className="flex flex-wrap gap-x-5 gap-y-2">
          <MemberProgressLink
            className="rounded-[4px] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            href={MEMBER_ROUTES.support}
          >
            Suporte
          </MemberProgressLink>
          <button className="transition hover:text-white" type="button">
            Termos
          </button>
          <button className="transition hover:text-white" type="button">
            Privacidade
          </button>
        </nav>
      </div>
    </footer>
  );
}
