import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";
import { MemberProgressBar } from "./member-progress";

// Card vertical (capa 2:3) para produtos nas grades de Minhas compras, Favoritos e Minha jornada.
// A capa fica limpa (so etiqueta e progresso na borda); titulo e detalhes ficam abaixo dela, legiveis.
//
// Acoes extras (ex.: remover dos favoritos) entram em `cornerAction`: ficam FORA do link, porque botao
// dentro de link e HTML invalido e quebra leitor de tela.

export const memberPosterGridClassName =
  "grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

const posterSizes = "(min-width: 1536px) 15vw, (min-width: 1280px) 18vw, (min-width: 1024px) 23vw, (min-width: 640px) 31vw, 46vw";

export function MemberPosterCard({
  ariaLabel,
  badge,
  className,
  cornerAction,
  footer,
  href,
  image,
  meta,
  priority = false,
  progress,
  title
}: {
  /** Nome acessivel do link; padrao "Abrir {titulo}". */
  ariaLabel?: string;
  /** Etiqueta no canto superior esquerdo da capa (ex.: <MemberChip>Formação</MemberChip>). */
  badge?: ReactNode;
  className?: string;
  /** Botao/acao no canto superior direito da capa, fora do link. */
  cornerAction?: ReactNode;
  /** Linha extra abaixo do titulo (ex.: "Continuar · Aula 4"). */
  footer?: ReactNode;
  href: string;
  image?: string | null;
  /** Linha discreta abaixo do titulo (ex.: "Curso · 12 de 40 aulas"). */
  meta?: ReactNode;
  /** true so para os primeiros cards visiveis na dobra. */
  priority?: boolean;
  /** Progresso do aluno; ausente = nao mostra barra. */
  progress?: { label: string; value: number };
  title: string;
}) {
  const src = image?.trim();

  return (
    <article className={cn("group relative min-w-0", className)}>
      <Link
        aria-label={ariaLabel ?? `Abrir ${title}`}
        className="block rounded-[var(--member-cover-radius)] outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-4 focus-visible:ring-offset-[#141414]"
        href={href}
      >
        <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--member-cover-radius)] bg-[#1f1f1f] ring-1 ring-white/[0.08] transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_26px_60px_rgba(0,0,0,0.6)] group-hover:ring-white/25 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
          {src ? (
            <Image
              alt=""
              className="object-cover transition duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              fill
              priority={priority}
              sizes={posterSizes}
              src={src}
              unoptimized={!canOptimizeImageSrc(src)}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#262626,#151515)] p-4 text-center">
              <span className="grid justify-items-center gap-2 text-zinc-500">
                <ImageOff aria-hidden="true" className="size-6" strokeWidth={1.8} />
                <span className="line-clamp-3 text-sm font-bold text-zinc-300">{title}</span>
              </span>
            </div>
          )}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
          {badge ? <div className="absolute left-2.5 top-2.5 flex max-w-[calc(100%-3.5rem)] flex-wrap gap-1.5">{badge}</div> : null}
          {progress ? (
            <div className="absolute inset-x-2.5 bottom-2.5">
              <MemberProgressBar label={progress.label} size="sm" value={progress.value} />
            </div>
          ) : null}
        </div>
        <div className="mt-3 min-w-0 px-0.5">
          <h3 className="line-clamp-2 text-sm font-bold leading-5 text-white transition-colors group-hover:text-white sm:text-[15px]">
            {title}
          </h3>
          {meta ? <div className="mt-1 truncate text-xs font-medium text-zinc-400">{meta}</div> : null}
          {footer ? <div className="mt-2 text-xs font-semibold text-zinc-300">{footer}</div> : null}
        </div>
      </Link>
      {cornerAction ? <div className="absolute right-2 top-2 z-10">{cornerAction}</div> : null}
    </article>
  );
}
