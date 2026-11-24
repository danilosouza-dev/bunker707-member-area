import Image from "next/image";
import type { ReactNode } from "react";
import type { PlatformBrandingConfig } from "@/lib/platform-types";

// A moldura de quem entra pelo link aberto (docs/30 §14): so a marca da escola em cima, sem menu, sem busca, sem sino e
// sem rodape com links da area de membros (quem nao e aluno ve so a live). O formulario de entrada, a pagina do
// webinario e as frases de recusa da sala usam esta moldura no lugar do AppShell.

export function GuestFrame({ branding, children, note }: { branding?: PlatformBrandingConfig; children: ReactNode; note?: string }) {
  const logoImage = branding === undefined ? "/brand/logo-bunker.svg" : branding.logoImage;

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--member-bg,#0b0b0c)] text-white" data-guest-frame="">
      <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-8 lg:px-12">
        {logoImage ? (
          <Image alt="Bunker707" className="h-auto max-h-9 w-[150px] object-contain object-left" height={35} priority src={logoImage} unoptimized width={306} />
        ) : (
          <span className="text-base font-black uppercase tracking-wide text-white">Bunker707</span>
        )}
        {note ? <p className="text-right text-xs leading-5 text-zinc-400">{note}</p> : null}
      </header>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      <footer className="px-4 py-6 text-xs text-zinc-500 sm:px-8 lg:px-12">
        <p>(c) 2026 Bunker707</p>
      </footer>
    </div>
  );
}
