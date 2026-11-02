import Image from "next/image";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";

// A logo da area num lugar so (docs/31 V2-3): o topo da area, a gaveta e o cabecalho da sala desenham a mesma imagem,
// com as mesmas classes, o mesmo arquivo e o mesmo candidato do srcset (o width de 306 sem sizes: 384 em tela 1x e
// 640 em 2x para uma logo enviada; o SVG padrao sai sem otimizador). Sem "use client": nao tem gancho, e quem usa ja e
// do navegador. Quem chama decide o link, o priority e a cor do nome em texto.

/** A logo da area (docs/12): 124 px abaixo de 640 e 150 a partir dai, no maximo 40 de altura, alinhada a esquerda. */
export const PLATFORM_LOGO_CLASS = "h-auto max-h-10 w-[124px] object-contain object-left sm:w-[150px]";
/** O nome da escola quando a Marca esta sem logo (o do topo da area). */
export const PLATFORM_LOGO_TEXT_CLASS = "text-lg font-black uppercase tracking-wide sm:text-xl";

export type PlatformLogoProps = {
  /** O nome da escola: o alt da imagem e, sem logo, o texto. */
  alt: string;
  /** Classes a mais na imagem (o brightness-0 da sala no tema claro). */
  className?: string;
  /** Pede a imagem antes (so o topo da area, que aparece primeiro). */
  priority?: boolean;
  /** A logo de Marca; nula, o nome em texto. */
  src: string | null;
  /** A cor do nome em texto. */
  textClassName?: string;
};

export function PlatformLogo({ alt, className, priority, src, textClassName }: PlatformLogoProps) {
  if (!src) {
    return <span className={cn(PLATFORM_LOGO_TEXT_CLASS, textClassName)}>{alt}</span>;
  }

  return (
    <Image
      alt={alt}
      className={cn(PLATFORM_LOGO_CLASS, className)}
      height={35}
      priority={priority}
      src={src}
      unoptimized={!canOptimizeImageSrc(src)}
      width={306}
    />
  );
}
