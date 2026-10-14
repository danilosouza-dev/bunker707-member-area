import Image from "next/image";
import Link from "next/link";
import { LockKeyhole, Play } from "lucide-react";
import type { ReactNode } from "react";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";
import { MemberProgressBar } from "./member-progress";

// Card de aula (imagem 16:9) para Continue assistindo, aulas salvas em Favoritos e Minha jornada.
// Hover discreto (docs/12: "Continue assistindo" usa zoom minimo e play aparente no centro).
// Aula bloqueada pela liberacao: sem play, com cadeado e a frase de liberacao.

export const memberLessonGridClassName = "grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

const lessonSizes = "(min-width: 1536px) 24vw, (min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw";

export function MemberLessonCard({
  className,
  context,
  cornerAction,
  href,
  image,
  locked,
  meta,
  progress,
  thumbnailLabel,
  title
}: {
  className?: string;
  /** Onde a aula esta: "Curso de IA · Módulo 2". */
  context?: ReactNode;
  /** Acao no canto superior direito da imagem, fora do link (ex.: remover dos favoritos). */
  cornerAction?: ReactNode;
  href: string;
  image?: string | null;
  /** Aula ainda nao liberada: mostra cadeado e `locked.label` ("Liberação em 08/01/2026"). */
  locked?: { label: string };
  /** Linha final discreta: "Assistida há 2 dias". */
  meta?: ReactNode;
  progress?: { label: string; value: number };
  /** Selo no canto inferior direito da imagem (ex.: "faltam 12min", "18:40"). */
  thumbnailLabel?: string;
  title: string;
}) {
  const src = image?.trim();

  return (
    <article className={cn("group relative min-w-0", className)}>
      <Link
        aria-label={locked ? `${title}. ${locked.label}` : `Assistir ${title}`}
        className="block rounded-[var(--member-cover-radius)] outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-4 focus-visible:ring-offset-[#141414]"
        href={href}
      >
        <div className="relative aspect-video overflow-hidden rounded-[var(--member-cover-radius)] bg-[#1f1f1f] ring-1 ring-white/[0.08] transition duration-300 group-hover:ring-white/25 motion-reduce:transition-none">
          {src ? (
            <Image
              alt=""
              className={cn(
                "object-cover transition duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100",
                locked ? "brightness-[0.45] grayscale" : ""
              )}
              fill
              sizes={lessonSizes}
              src={src}
              unoptimized={!canOptimizeImageSrc(src)}
            />
          ) : (
            <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(160deg,#262626,#141414)]" />
          )}
          <div aria-hidden="true" className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/25" />
          {locked ? (
            <div className="absolute inset-0 grid place-items-center p-3 text-center">
              <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.4} />
                <span className="truncate">{locked.label}</span>
              </span>
            </div>
          ) : (
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black opacity-0 shadow-xl shadow-black/40 transition duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              <Play className="ml-0.5 size-5 fill-current" />
            </span>
          )}
          {thumbnailLabel && !locked ? (
            <span className="absolute bottom-3 right-2.5 rounded-[5px] bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
              {thumbnailLabel}
            </span>
          ) : null}
          {progress && !locked ? (
            <div className="absolute inset-x-0 bottom-0">
              <MemberProgressBar className="rounded-none bg-white/25" label={progress.label} size="sm" value={progress.value} />
            </div>
          ) : null}
        </div>
        <div className="mt-3 min-w-0 px-0.5">
          <h3 className="line-clamp-2 text-sm font-bold leading-5 text-white sm:text-[15px]">{title}</h3>
          {context ? <div className="mt-1 truncate text-xs font-medium text-zinc-400">{context}</div> : null}
          {meta ? <div className="mt-1 text-xs text-zinc-500">{meta}</div> : null}
        </div>
      </Link>
      {cornerAction ? <div className="absolute right-2 top-2 z-10">{cornerAction}</div> : null}
    </article>
  );
}
