import { ArrowRight, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { HeroGlow } from "@/components/member/hero-glow";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import type { HomeHeroConfig } from "@/lib/platform-types";
import { isSafeHeroCtaHref } from "@/server/member-area/home-hero-links";

// Destaque do topo da home do aluno (editado em Area de membros > Destaque).
// Responde por container query (`@container` na section + `@min-[...]:`) e nao pela janela, para a
// previa do admin (PreviewFrame, uma "tela" de 1280 ou 390 px reduzida) desenhar igual a home real;
// na home o container tem a largura da janela, entao o resultado e o mesmo de `sm:`/`lg:`.

type HeroSectionProps = {
  /** Modo "ver como" da home: mantem o modo nos links internos do botao. */
  accessPreviewMode?: AccessPreviewMode;
  hero: HomeHeroConfig;
  /** Previa do admin: sem preload nem prioridade de imagem, botao sem link (a moldura ja e inert). */
  preview?: boolean;
};

const ctaClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--member-button-radius)] bg-white px-6 py-3 text-base font-extrabold text-black shadow-xl shadow-black/25 transition hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none";

function HeroCta({
  accessPreviewMode,
  cta,
  preview
}: {
  accessPreviewMode?: AccessPreviewMode;
  cta: NonNullable<HomeHeroConfig["cta"]>;
  preview: boolean;
}) {
  const content = (
    <>
      {cta.label}
      <ArrowRight aria-hidden="true" className="h-5 w-5" strokeWidth={2.6} />
    </>
  );

  if (preview) {
    return <span className={ctaClass}>{content}</span>;
  }

  const newTab = cta.target === "new_tab";
  const newTabNote = newTab ? <span className="sr-only"> (abre em nova aba)</span> : null;

  if (cta.href.startsWith("/")) {
    const href = withAccessPreviewParam(cta.href, accessPreviewMode);

    return newTab ? (
      <a className={ctaClass} href={href} rel="noopener noreferrer" target="_blank">
        {content}
        {newTabNote}
      </a>
    ) : (
      <Link className={ctaClass} href={href}>
        {content}
      </Link>
    );
  }

  return newTab ? (
    <a className={ctaClass} href={cta.href} rel="noopener noreferrer" target="_blank">
      {content}
      {newTabNote}
    </a>
  ) : (
    <a className={ctaClass} href={cta.href}>
      {content}
    </a>
  );
}

export function HeroSection({ accessPreviewMode, hero, preview = false }: HeroSectionProps) {
  if (hero.enabled === false || !hero.image) {
    return null;
  }

  const showBadge = (hero.visibility?.badge ?? Boolean(hero.badge)) && Boolean(hero.badge);
  const showTitle = (hero.visibility?.title ?? Boolean(hero.title)) && Boolean(hero.title);
  const showDescription =
    (hero.visibility?.description ?? Boolean(hero.description)) && Boolean(hero.description);
  // O link e conferido de novo aqui: o admin antigo desenha o hero cru, sem resolveHomeHero.
  const cta = hero.cta && hero.cta.label && isSafeHeroCtaHref(hero.cta.href) ? hero.cta : null;
  const showCta = Boolean(cta) && (hero.visibility?.cta ?? true);
  const hasContent = showBadge || showTitle || showDescription || showCta;
  // Prévia do admin pode trazer rascunho em data:/blob:; isso não vai para o <head>.
  const preloadHeroImage = !preview && !/^(?:data|blob):/i.test(hero.image);
  const poster = hero.mediaType === "video" && hero.poster ? hero.poster : null;

  return (
    // flow-root: a margem de cima do destaque fica dentro do bloco, entao a luz comeca no topo da pagina.
    <div className="relative flow-root">
      <HeroGlow color={hero.glowColor} src={hero.mediaType === "video" ? poster : hero.image} />
      <section className="@container relative z-[1] min-h-[var(--member-hero-min-h)] overflow-hidden rounded-[var(--member-hero-radius)] mx-[var(--member-hero-inset)] mt-[var(--member-hero-top)]">
      {hero.mediaType === "video" ? (
        <>
          <video
            aria-hidden="true"
            autoPlay
            className={`absolute inset-0 h-full w-full object-cover ${poster ? "motion-reduce:hidden" : ""}`}
            loop
            muted
            playsInline
            poster={poster ?? undefined}
            preload={preview ? "metadata" : undefined}
            src={hero.image}
          />
          {poster ? (
            // Quem prefere menos movimento ve a capa parada no lugar do video (so CSS, sem JavaScript).
            <Image
              alt=""
              className="hidden object-cover object-center motion-reduce:block"
              fill
              sizes="100vw"
              src={poster}
              unoptimized={!canOptimizeImageSrc(poster)}
            />
          ) : null}
        </>
      ) : (
        <Image
          alt=""
          className="object-cover object-center"
          fetchPriority={preview ? undefined : "high"}
          fill
          preload={preloadHeroImage}
          sizes="100vw"
          src={hero.image}
          unoptimized={!canOptimizeImageSrc(hero.image)}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/35 to-black/15" />
      {/* Esfumacado inferior: some no modo arredondado (--member-hero-fade: 0), a capa vai limpa ate a borda. */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-black/5 to-black/35 opacity-[var(--member-hero-fade)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-b from-transparent via-[#141414]/85 to-[#141414] opacity-[var(--member-hero-fade)]" />
      {hasContent ? (
        <div className="relative z-10 flex min-h-[var(--member-hero-min-h)] max-w-6xl flex-col justify-center px-5 pb-[var(--member-hero-content-pb)] pt-28 @min-[640px]:px-8 @min-[1024px]:px-12">
          {showBadge ? (
            <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-[6px] border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-white backdrop-blur">
              <Zap className="h-4 w-4 text-[var(--accent-warm)]" />
              {hero.badge}
            </div>
          ) : null}
          {showTitle ? (
            <h1 className="max-w-4xl text-5xl font-black leading-[0.98] text-white @min-[640px]:text-6xl @min-[1024px]:text-7xl">
              {hero.title}
            </h1>
          ) : null}
          {showDescription ? (
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-200 @min-[640px]:text-lg">
              {hero.description}
            </p>
          ) : null}
          {showCta && cta ? (
            <div className={showTitle || showDescription ? "mt-8" : ""}>
              <HeroCta accessPreviewMode={accessPreviewMode} cta={cta} preview={preview} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
    </div>
  );
}
