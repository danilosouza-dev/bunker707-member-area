"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Moldura de previa da Area de membros (login, destaque da home): desenha o componente REAL do aluno
// numa "tela" de largura fixa (computador 1280 × 800, celular 390 × 844) e reduz com transform para caber
// na coluna. Nada de iframe: o app manda X-Frame-Options DENY e frame-ancestors 'none'.
//
// Contrato com os componentes do aluno que aparecem aqui (LoginExperience, HeroSection):
// - responsividade por container query (`@container` + `@min-[1024px]:`), nunca por `lg:` da janela,
//   porque dentro da moldura a janela continua sendo a do admin;
// - altura de "tela cheia" por `var(--member-preview-vh, 100vh)` (aqui vale a altura da moldura);
// - os tokens do aluno (vermelho da marca em --accent, fundo #141414) voltam a valer dentro da moldura,
//   porque o admin troca --accent por cinza;
// - o conteudo fica `inert`: nada recebe foco nem clique e leitores de tela leem so o rotulo da moldura.

export const PREVIEW_DEVICES = {
  desktop: { height: 800, label: "Computador", width: 1280 },
  mobile: { height: 844, label: "Celular", width: 390 }
} as const;

export type PreviewDevice = keyof typeof PREVIEW_DEVICES;

/** Variavel CSS com a altura da "tela" da previa; fora dela os componentes caem em 100vh. */
export const MEMBER_PREVIEW_VH_VAR = "--member-preview-vh";

/** Tokens de :root (src/app/globals.css) que o admin sobrescreve e a area do aluno usa. */
const STUDENT_TOKENS: Record<string, string> = {
  "--accent": "#e50914",
  "--accent-foreground": "#ffffff",
  "--accent-warm": "#ff7a1a",
  "--background": "#141414",
  "--border": "rgba(255, 255, 255, 0.1)",
  "--card": "#171717",
  "--card-foreground": "#f7f7f4",
  "--foreground": "#f7f7f4",
  "--input": "rgba(255, 255, 255, 0.15)",
  "--muted": "#a8a8a2",
  "--muted-foreground": "#a8a8a2",
  "--popover": "#202020",
  "--popover-foreground": "#f7f7f4",
  "--primary": "#e50914",
  "--primary-foreground": "#ffffff",
  "--ring": "rgba(229, 9, 20, 0.65)",
  "--secondary": "#202020",
  "--secondary-foreground": "#f7f7f4"
};

type PreviewFrameProps = {
  /** Rotulo lido por leitores de tela, ex.: "Prévia da página de login no computador". */
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  device: PreviewDevice;
  /** Largura maxima da moldura na tela (px). Padrao: a largura da coluna. */
  maxWidth?: number;
  /** Altura da "tela" em px quando o conteudo nao ocupa a tela cheia (ex.: so o destaque da home). */
  screenHeight?: number;
};

export function PreviewFrame({ ariaLabel, children, className, device, maxWidth, screenHeight }: PreviewFrameProps) {
  const spec = PREVIEW_DEVICES[device];
  const height = screenHeight ?? spec.height;
  const outer = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => {
    const element = outer.current;

    if (!element) {
      return;
    }

    const measure = () => setAvailable(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const limit = Math.min(available ?? spec.width, maxWidth ?? Number.POSITIVE_INFINITY);
  const scale = Math.min(1, limit / spec.width);
  const screenStyle: CSSProperties & Record<string, string | number> = {
    ...STUDENT_TOKENS,
    [MEMBER_PREVIEW_VH_VAR]: `${height}px`,
    background: "#141414",
    color: "#f7f7f4",
    height,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    width: spec.width
  };

  const measured = available !== null;

  return (
    <figure aria-label={ariaLabel} className={cn("m-0 flex min-w-0 flex-col gap-2", className)}>
      {/* contain: inline-size -> a largura vem da coluna, nunca da "tela" de 1280 px la dentro. */}
      <div className="w-full min-w-0 [contain:inline-size]" ref={outer}>
        <div
          className="relative max-w-full overflow-hidden rounded-lg border border-[var(--border-strong)] bg-black"
          style={{
            height: Math.round(height * scale),
            visibility: measured ? undefined : "hidden",
            width: measured ? Math.round(spec.width * scale) : "100%"
          }}
        >
          <div className="@container absolute top-0 left-0 overflow-hidden" inert style={screenStyle}>
            {children}
          </div>
        </div>
      </div>
      <figcaption className="text-xs leading-5 text-[var(--text-secondary)]">
        {spec.label} · {spec.width} px
      </figcaption>
    </figure>
  );
}
