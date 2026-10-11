"use client";

import { Bell, Menu, Search, Trophy } from "lucide-react";
import Image from "next/image";
import { HeroSection } from "@/components/hero-section";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import type { HomeHeroConfig } from "@/lib/platform-types";
import { cn } from "@/lib/utils";
import { isHeroVisible } from "@/server/member-area/home-hero-model";
import { PREVIEW_DEVICES, PreviewFrame, type PreviewDevice } from "../preview-frame";

// Previa do destaque: o HeroSection REAL da home do aluno numa "tela" de 1280 ou 390 px (PreviewFrame),
// com o topo da area do aluno (logo da Marca) e, no lugar das fileiras, uma faixa honesta dizendo onde
// elas comecam, sobrepondo 96 px como na home (-mt-24). Nada de cards inventados.

/** Altura da "tela": o destaque tem 680 px e a faixa das fileiras aparece logo abaixo. */
export const HERO_PREVIEW_SCREEN_HEIGHT = 760;

type HeroPreviewProps = {
  device: PreviewDevice;
  hero: HomeHeroConfig;
  logoImage: string | null;
  /** Largura maxima da moldura na tela (px). */
  maxWidth?: number;
};

/** Topo da area do aluno (AppShell) so com o que muda por escola: a logo. Os icones sao a moldura. */
function StudentTopBar({ logoImage }: { logoImage: string | null }) {
  const iconBox = "grid h-10 w-10 shrink-0 place-items-center rounded-[6px] text-white";

  return (
    <div className="absolute inset-x-0 top-0 z-40">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.68)_0%,rgba(0,0,0,0.26)_58%,rgba(0,0,0,0)_100%)]"
      />
      <div className="relative flex h-16 items-center gap-4 px-4 @min-[640px]:px-6">
        <span className={iconBox}>
          <Menu className="h-5 w-5" />
        </span>
        {logoImage ? (
          <Image
            alt="Bunker707"
            className="h-auto max-h-10 w-[150px] object-contain object-left @min-[640px]:w-[190px]"
            height={35}
            src={logoImage}
            unoptimized={!canOptimizeImageSrc(logoImage)}
            width={306}
          />
        ) : (
          <span className="text-lg font-black uppercase tracking-wide text-white @min-[640px]:text-xl">Bunker707</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className={iconBox}>
            <Search className="h-4 w-4" />
          </span>
          <span className={cn(iconBox, "@max-[479px]:hidden")}>
            <Trophy className="h-4 w-4" />
          </span>
          <span className={iconBox}>
            <Bell className="h-4 w-4" />
          </span>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#3f3f46]" />
        </span>
      </div>
    </div>
  );
}

/** Onde as fileiras da Vitrine comecam (sem itens: quem decide as fileiras e a aba Vitrine). */
function RowsStart({ overlap }: { overlap: boolean }) {
  const card =
    "aspect-[2/3] w-[9.5rem] shrink-0 rounded-[6px] border border-dashed border-white/20 bg-white/[0.03] @min-[640px]:w-[11.5rem] @min-[768px]:w-[13.5rem] @min-[1024px]:w-[15rem] @min-[1280px]:w-[16rem]";

  return (
    <div className={cn("relative z-20 overflow-hidden", overlap ? "-mt-24" : "pt-24")}>
      <p className="mb-4 px-5 text-xl font-semibold text-white/70 @min-[640px]:px-8 @min-[640px]:text-2xl @min-[1024px]:px-12">
        Aqui começam as fileiras da Vitrine
      </p>
      <div className="flex gap-3 px-5 @min-[640px]:px-8 @min-[1024px]:px-12">
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <span className={card} key={index} />
        ))}
      </div>
    </div>
  );
}

export function HeroPreview({ device, hero, logoImage, maxWidth }: HeroPreviewProps) {
  const visible = isHeroVisible(hero);
  const label = PREVIEW_DEVICES[device].label.toLowerCase();

  return (
    <PreviewFrame
      ariaLabel={`Prévia do topo da home no ${label}`}
      device={device}
      maxWidth={maxWidth}
      screenHeight={HERO_PREVIEW_SCREEN_HEIGHT}
    >
      <div className="relative min-h-full bg-[#141414] text-white">
        <StudentTopBar logoImage={logoImage} />
        <HeroSection hero={hero} preview />
        <RowsStart overlap={visible} />
      </div>
    </PreviewFrame>
  );
}
