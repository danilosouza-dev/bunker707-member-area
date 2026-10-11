import Image from "next/image";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";
import { PRODUCT_ACCENTS, type ProductAccent } from "@/server/catalog/model";
import { getInitials } from "./format";

// Miniatura do produto na primeira coluna das tabelas, no cabecalho do produto, no painel da aula e
// nos seletores. Sem capa, mostra as iniciais na cor do produto.
//
// Tamanhos do prototipo aprovado:
// - "xs" (28 x 28, raio 6): lista de Produtos e cabecalho do produto. Sem capa, iniciais na cor do
//   produto sobre a mesma cor a 20 % (como no prototipo).
// - "cover" (28 x 40, raio 4, quase 9:13): cabecalho do painel da aula. Sem capa, a cor cheia.
// - "sm" / "md" / "lg" (32, 40, 56): seletores, Pacotes e Area de membros (sem mudanca).

const sizes = {
  cover: { box: "h-10 w-7 rounded-[4px] text-[11px] tracking-[0.02em]", pixels: 40, tint: false },
  lg: { box: "size-14 rounded-lg text-base", pixels: 56, tint: false },
  md: { box: "size-10 rounded-lg text-sm", pixels: 40, tint: false },
  sm: { box: "size-8 rounded-md text-xs", pixels: 32, tint: false },
  xs: { box: "size-7 rounded-md text-[11px] tracking-[0.02em]", pixels: 28, tint: true }
} as const;

export type ProductThumbSize = keyof typeof sizes;

type ProductThumbProps = {
  accent: ProductAccent;
  className?: string;
  coverUrl: string | null;
  size?: ProductThumbSize;
  title: string;
};

export function ProductThumb({ accent, className, coverUrl, size = "sm", title }: ProductThumbProps) {
  const { box, pixels, tint } = sizes[size];
  const color = PRODUCT_ACCENTS[accent];

  if (coverUrl) {
    return (
      <span className={cn("relative block shrink-0 overflow-hidden bg-[var(--surface-2)]", box, className)}>
        <Image
          alt=""
          className="object-cover"
          fill
          sizes={`${pixels}px`}
          src={coverUrl}
          unoptimized={!canOptimizeImageSrc(coverUrl)}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center leading-none font-semibold", !tint && "text-[var(--surface-0)]", box, className)}
      style={tint ? { backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color } : { backgroundColor: color }}
    >
      {getInitials(title)}
    </span>
  );
}
