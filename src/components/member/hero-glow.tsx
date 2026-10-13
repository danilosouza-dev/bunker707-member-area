"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { canOptimizeImageSrc } from "@/lib/image-hosts";

// Luz de fundo atras do destaque, na cor da imagem (como na Netflix) ou na cor escolhida em Area de
// membros > Destaque > Luz de fundo: a cor media da imagem, um pouco mais viva, vira um degrade do topo
// da pagina ate o cinza (#141414) antes do fim do destaque. Calculada
// no navegador a partir de uma versao pequena da imagem (mesma origem quando o otimizador do Next atende
// o host); quando a imagem nao pode ser lida (outra origem sem CORS), a luz simplesmente nao aparece.
// `globals.css` desenha o degrade com `--member-hero-accent` (`.member-hero-glow`).

const SAMPLE_SIZE = 24;

/** Versao pequena da imagem para medir a cor: pelo otimizador do Next (mesma origem) quando o host permite. */
function sampleSrcFor(src: string) {
  return canOptimizeImageSrc(src) ? `/_next/image?url=${encodeURIComponent(src)}&w=64&q=75` : src;
}

function toHsl(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { hue: 0, lightness, saturation: 0 };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;

  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  hue = Math.round(hue * 60);

  return { hue: hue < 0 ? hue + 360 : hue, lightness, saturation };
}

/**
 * Cor media da imagem (ignorando pixels quase pretos e quase brancos, que so puxam para o cinza), com a
 * saturacao reforcada e a luminosidade presa numa faixa media: a luz fica visivel mesmo com imagens
 * escuras e nunca "lava" a pagina. Devolve `hsl(...)` ou null quando a imagem nao tem cor util.
 */
export function accentColorOf(image: CanvasImageSource & { height?: number; width?: number }) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  let red = 0;
  let green = 0;
  let blue = 0;
  let weightTotal = 0;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (data[index + 3] < 128 || luminance < 14 || luminance > 242) {
      continue;
    }

    // Pixels mais coloridos pesam mais: a luz segue a cor da arte, nao o cinza das sombras.
    const weight = 1 + 3 * toHsl(r, g, b).saturation;
    red += r * weight;
    green += g * weight;
    blue += b * weight;
    weightTotal += weight;
  }

  if (weightTotal === 0) {
    return null;
  }

  const { hue, saturation, lightness } = toHsl(red / weightTotal, green / weightTotal, blue / weightTotal);
  const boostedSaturation = Math.min(0.9, Math.max(0.32, saturation * 1.7));
  const clampedLightness = Math.min(0.48, Math.max(0.3, lightness));

  return `hsl(${hue} ${Math.round(boostedSaturation * 100)}% ${Math.round(clampedLightness * 100)}%)`;
}

type HeroGlowProps = {
  /** Cor escolhida pelo produtor (Destaque > Luz de fundo). Ausente = medida na imagem. */
  color?: string | null;
  /** Imagem do destaque (ou a capa do video). Sem imagem (e sem cor escolhida), sem luz. */
  src?: string | null;
};

export function HeroGlow({ color, src }: HeroGlowProps) {
  // Cor medida e para qual imagem: ao trocar a imagem, a luz some ate a nova medida chegar.
  const [measured, setMeasured] = useState<{ color: string | null; src: string } | null>(null);
  const accent = color ?? (src && measured?.src === src ? measured.color : null);

  useEffect(() => {
    if (!src || color) {
      return;
    }

    let cancelled = false;
    const image = new Image();

    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) {
        return;
      }

      let color: string | null = null;

      try {
        color = accentColorOf(image);
      } catch {
        color = null;
      }

      setMeasured({ color, src });
    };
    image.onerror = () => {
      if (!cancelled) {
        setMeasured({ color: null, src });
      }
    };
    image.src = sampleSrcFor(src);

    return () => {
      cancelled = true;
    };
  }, [color, src]);

  return (
    <div
      aria-hidden="true"
      className="member-hero-glow pointer-events-none absolute inset-x-0 top-0 z-0 h-full transition-opacity duration-700 ease-out motion-reduce:transition-none"
      style={{ "--member-hero-accent": accent ?? undefined, opacity: accent ? 1 : 0 } as CSSProperties}
    />
  );
}
