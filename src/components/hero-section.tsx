import { Zap } from "lucide-react";
import type { HomeHeroConfig } from "@/lib/platform-types";

export function HeroSection({ hero }: { hero: HomeHeroConfig }) {
  const showBadge = (hero.visibility?.badge ?? Boolean(hero.badge)) && Boolean(hero.badge);
  const showTitle = (hero.visibility?.title ?? Boolean(hero.title)) && Boolean(hero.title);
  const showDescription =
    (hero.visibility?.description ?? Boolean(hero.description)) && Boolean(hero.description);
  const hasContent = showBadge || showTitle || showDescription;

  return (
    <section className="relative min-h-[680px] overflow-hidden">
      {hero.mediaType === "video" ? (
        <video
          aria-hidden="true"
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
          loop
          muted
          playsInline
          src={hero.image}
        />
      ) : (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${hero.image})` }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/35 to-black/15" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-black/5 to-black/35" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-b from-transparent via-[#141414]/85 to-[#141414]" />
      {hasContent ? (
        <div className="relative z-10 flex min-h-[680px] max-w-6xl flex-col justify-center px-5 pb-48 pt-28 sm:px-8 lg:px-12">
          {showBadge ? (
            <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-[6px] border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-white backdrop-blur">
              <Zap className="h-4 w-4 text-[var(--accent-warm)]" />
              {hero.badge}
            </div>
          ) : null}
          {showTitle ? (
            <h1 className="max-w-4xl text-5xl font-black leading-[0.98] text-white sm:text-6xl lg:text-7xl">
              {hero.title}
            </h1>
          ) : null}
          {showDescription ? (
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-200 sm:text-lg">
              {hero.description}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
