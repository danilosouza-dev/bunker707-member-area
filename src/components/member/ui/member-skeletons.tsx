import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { memberLessonGridClassName } from "./member-lesson-card";
import { memberPosterGridClassName } from "./member-poster-card";

// Esqueletos para loading.tsx das paginas do aluno: mesma forma da pagina final, para o aluno ver a
// tela "nascer" no lugar certo em vez de um spinner. Sem o marcador do loading global (o do
// src/app/loading.tsx): o spinner some assim que o endereco muda e o esqueleto assume.
//
// O AppShell e renderizado por cada pagina; enquanto o loading.tsx esta na tela o topo real some, por
// isso MemberShellSkeleton desenha uma barra com o mesmo tamanho (64 px) e os mesmos espacos.

export function MemberSkeletonBlock({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cn("block rounded-[8px] bg-white/[0.07] motion-safe:animate-pulse", className)} style={style} />;
}

export function MemberShellSkeleton({
  children,
  label = "Carregando página..."
}: {
  children: ReactNode;
  /** Texto para leitor de tela, ex.: "Carregando Minha jornada...". */
  label?: string;
}) {
  return (
    <div aria-busy="true" className="min-h-screen bg-[#141414] text-white">
      <div aria-hidden="true" className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col items-center gap-1 border-r border-white/[0.06] bg-[#0f0f0f] md:flex">
        <div className="grid h-16 place-items-center">
          <MemberSkeletonBlock className="size-10 rounded-full bg-white/[0.05]" />
        </div>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
          <MemberSkeletonBlock className="size-12 rounded-xl bg-white/[0.05]" key={item} />
        ))}
      </div>
      <div aria-hidden="true" className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-4 bg-[#141414] px-4 sm:px-6 md:left-[72px]">
        <MemberSkeletonBlock className="size-10 rounded-full bg-white/[0.05] md:hidden" />
        <MemberSkeletonBlock className="h-7 w-[124px] bg-white/[0.05] sm:w-[150px] md:hidden" />
        <div className="ml-auto flex items-center gap-2">
          <MemberSkeletonBlock className="size-10 rounded-[6px] bg-white/[0.05]" />
          <MemberSkeletonBlock className="size-10 rounded-full bg-white/[0.05]" />
          <MemberSkeletonBlock className="h-10 w-10 rounded-[6px] bg-white/[0.05] sm:w-28" />
        </div>
      </div>
      <p className="sr-only" role="status">
        {label}
      </p>
      <div className="md:pl-[72px]">{children}</div>
    </div>
  );
}

export function MemberPageHeaderSkeleton({ withStats = false }: { withStats?: boolean }) {
  return (
    <div aria-hidden="true" className="mb-8 sm:mb-10">
      <MemberSkeletonBlock className="mb-3 h-4 w-32" />
      <MemberSkeletonBlock className="h-8 w-64 max-w-full sm:h-10 sm:w-80" />
      <MemberSkeletonBlock className="mt-4 h-4 w-full max-w-xl" />
      {withStats ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <MemberSkeletonBlock className="h-[72px] rounded-[12px]" key={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MemberFilterBarSkeleton() {
  return (
    <div aria-hidden="true" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-2 overflow-hidden">
        {[72, 96, 88, 80].map((width) => (
          <MemberSkeletonBlock className="h-9 shrink-0 rounded-full" key={width} style={{ width }} />
        ))}
      </div>
      <MemberSkeletonBlock className="h-10 w-full rounded-[10px] sm:w-72" />
    </div>
  );
}

export function MemberPosterGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div aria-hidden="true" className={memberPosterGridClassName}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <MemberSkeletonBlock className="aspect-[2/3] rounded-[10px]" />
          <MemberSkeletonBlock className="mt-3 h-4 w-4/5" />
          <MemberSkeletonBlock className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function MemberLessonGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden="true" className={memberLessonGridClassName}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <MemberSkeletonBlock className="aspect-video rounded-[10px]" />
          <MemberSkeletonBlock className="mt-3 h-4 w-4/5" />
          <MemberSkeletonBlock className="mt-2 h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function MemberListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="grid gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex items-center gap-4 rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-4 py-3" key={index}>
          <MemberSkeletonBlock className="size-11 shrink-0 rounded-[10px]" />
          <div className="min-w-0 flex-1">
            <MemberSkeletonBlock className="h-4 w-3/5" />
            <MemberSkeletonBlock className="mt-2 h-3 w-2/5" />
          </div>
          <MemberSkeletonBlock className="hidden h-9 w-24 shrink-0 sm:block" />
        </div>
      ))}
    </div>
  );
}
