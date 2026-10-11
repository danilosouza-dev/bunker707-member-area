import Link from "next/link";
import { Search, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Filtros, abas e busca das paginas do aluno.
// - MemberFilterPills: filtros que mudam a lista na mesma tela (botoes com aria-pressed). Use dentro de
//   componente de cliente (recebe onChange).
// - MemberTabNav: abas que trocam de endereco (?aba=...), renderizadas no servidor (links com aria-current).
// - MemberSearchField: busca local com botao de limpar. Use dentro de componente de cliente.

export type MemberFilterOption<T extends string> = {
  count?: number;
  id: T;
  label: string;
};

export function MemberFilterPills<T extends string>({
  ariaLabel,
  className,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: T) => void;
  options: readonly MemberFilterOption<T>[];
  value: T;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        // Rola na horizontal no celular sem alargar a pagina; o -mx/px mantem o respiro lateral.
        "-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden",
        className
      )}
      role="group"
    >
      {options.map((option) => {
        const active = option.id === value;

        return (
          <button
            aria-pressed={active}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
              active
                ? "border-white bg-white text-black"
                : "border-white/10 bg-white/[0.05] text-zinc-300 hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
            )}
            key={option.id}
            onClick={() => onChange(option.id)}
            type="button"
          >
            {option.label}
            {typeof option.count === "number" ? (
              <span
                className={cn(
                  "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                  active ? "bg-black/10 text-black" : "bg-white/[0.08] text-zinc-400"
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export type MemberTabNavItem = {
  active: boolean;
  count?: number;
  href: string;
  icon?: LucideIcon;
  label: string;
};

export function MemberTabNav({
  ariaLabel,
  className,
  items
}: {
  ariaLabel: string;
  className?: string;
  items: readonly MemberTabNavItem[];
}) {
  return (
    <nav aria-label={ariaLabel} className={cn("-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden", className)}>
      <ul className="flex min-w-max gap-1 border-b border-white/10">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                aria-current={item.active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-12 items-center gap-2 px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white sm:px-4",
                  item.active ? "text-white" : "text-zinc-400 hover:text-white"
                )}
                href={item.href}
                replace
                scroll={false}
              >
                {Icon ? <Icon aria-hidden="true" className="size-4" strokeWidth={2} /> : null}
                {item.label}
                {typeof item.count === "number" ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/[0.08] px-1.5 text-[11px] font-bold tabular-nums text-zinc-300">
                    {item.count}
                  </span>
                ) : null}
                {item.active ? (
                  <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--accent)] sm:inset-x-4" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MemberSearchField({
  className,
  label,
  onChange,
  placeholder,
  value
}: {
  className?: string;
  /** Nome acessivel, ex.: "Buscar em Minhas compras". */
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label
      className={cn(
        "flex h-10 w-full min-w-0 items-center gap-2.5 rounded-[10px] border border-white/10 bg-black/30 pl-3.5 pr-1 text-sm text-zinc-300 transition-colors focus-within:border-white/30 focus-within:bg-black/45 sm:max-w-xs",
        className
      )}
    >
      <Search aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
      <span className="sr-only">{label}</span>
      <input
        className="h-full min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value ? (
        <button
          aria-label="Limpar busca"
          className="grid size-8 shrink-0 place-items-center rounded-[8px] text-zinc-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          onClick={() => onChange("")}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </label>
  );
}
