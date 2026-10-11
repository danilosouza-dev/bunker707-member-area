import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Estrutura das paginas internas do aluno (Minhas compras, Favoritos, Minha jornada, Continue
// assistindo, Materiais, Suporte, Perfil). O AppShell ja abre <main>; aqui so o miolo.
//
// Larguras: "wide" para grades de cards, "default" para listas, "narrow" para leitura/formulario.
// Respiro lateral: 16 px no celular, 32 px no tablet, 48 px no computador (igual ao restante da area).

export type MemberPageWidth = "default" | "narrow" | "wide";

const widthClassNames: Record<MemberPageWidth, string> = {
  default: "max-w-[80rem]",
  narrow: "max-w-[60rem]",
  wide: "max-w-[104rem]"
};

export function MemberPage({
  children,
  className,
  width = "wide"
}: {
  children: ReactNode;
  className?: string;
  width?: MemberPageWidth;
}) {
  return (
    <div className="min-h-screen bg-[#141414] px-4 pb-24 pt-24 text-white sm:px-8 sm:pt-28 lg:px-12">
      <div className={cn("mx-auto w-full min-w-0", widthClassNames[width], className)}>{children}</div>
    </div>
  );
}

export function MemberPageHeader({
  actions,
  children,
  className,
  description,
  eyebrow,
  title
}: {
  /** Acoes a direita no computador (abaixo do texto no celular). */
  actions?: ReactNode;
  /** Conteudo abaixo do cabecalho que faz parte dele (ex.: numeros do topo). */
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: { icon?: LucideIcon; label: string };
  title: ReactNode;
}) {
  const EyebrowIcon = eyebrow?.icon;

  return (
    <header className={cn("mb-8 sm:mb-10", className)}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? (
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-zinc-400">
              {EyebrowIcon ? <EyebrowIcon aria-hidden="true" className="size-4 text-[var(--accent)]" strokeWidth={2.2} /> : null}
              {eyebrow.label}
            </p>
          ) : null}
          <h1 className="text-[28px] font-black leading-[1.08] text-white sm:text-4xl lg:text-[40px]">{title}</h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-[15px] sm:leading-7">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div> : null}
      </div>
      {children ? <div className="mt-6 sm:mt-8">{children}</div> : null}
    </header>
  );
}

export function MemberSection({
  action,
  children,
  className,
  count,
  description,
  id,
  title
}: {
  /** Link/botao a direita do titulo (ex.: "Ver tudo"). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  count?: number;
  description?: ReactNode;
  /** Id estavel para o aria-labelledby; obrigatorio quando a pagina tem mais de uma secao. */
  id: string;
  title: ReactNode;
}) {
  const titleId = `${id}-titulo`;

  return (
    <section aria-labelledby={titleId} className={cn("min-w-0", className)} id={id}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg" id={titleId}>
            {title}
            {typeof count === "number" ? (
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/[0.08] px-2 text-xs font-semibold tabular-nums text-zinc-300">
                {count}
              </span>
            ) : null}
          </h2>
          {description ? <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
