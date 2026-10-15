import { PRODUCT_ACCENTS } from "@/server/catalog/model";
import type { StudentProductChip } from "@/server/students/model";
import { cn } from "@/lib/utils";

// Produtos de um aluno na tabela: ate `max` chips com o ponto na cor do produto e "+N" para o resto.
// Nunca inventa produto: sem acesso aberto, mostra "Sem acesso".

type ProductChipsProps = {
  className?: string;
  max?: number;
  products: readonly StudentProductChip[];
};

export function ProductChips({ className, max = 2, products }: ProductChipsProps) {
  if (products.length === 0) {
    return <span className="text-[var(--text-tertiary)]">Sem acesso</span>;
  }

  const shown = products.slice(0, max);
  const rest = products.length - shown.length;

  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {shown.map((product) => (
        <span
          className="inline-flex h-[22px] max-w-[170px] items-center max-md:max-w-full gap-1.5 rounded-[6px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.06)] px-2 text-xs leading-none font-medium text-[var(--text-primary)]"
          key={product.id}
          title={product.title}
        >
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: PRODUCT_ACCENTS[product.accent] }} />
          <span className="truncate">{product.title}</span>
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-xs font-medium text-[var(--text-tertiary)] tabular-nums" title={products.slice(max).map((product) => product.title).join(", ")}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
