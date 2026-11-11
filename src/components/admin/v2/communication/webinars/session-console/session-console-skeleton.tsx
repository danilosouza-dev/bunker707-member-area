import { Skeleton } from "@/components/ui/skeleton";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { adminDelayedReveal } from "../../../styles";
import { consoleSkeleton } from "./console-layout-model";

// Esqueleto do console da sessao (docs/17 §2.7; docs/31 V2-13 e §10): a forma do console V2 em tela cheia, no
// escuro (o servidor nao sabe o tema guardado no navegador): o topo de 64 px (a seta, o titulo com a linha de baixo, o
// seletor e os botoes), a coluna do palco (o palco e a barra de 72 px), o painel em cartao com o cabecalho e o trilho a
// direita. Nunca o spinner de tela cheia.

const bar = "bg-room-surface-2 motion-reduce:animate-none";
const skeleton = consoleSkeleton({ hasStage: true, panelOpen: true });
const LINE_KEYS = ["a", "b", "c", "d", "e", "f"] as const;
const RAIL_KEYS = ["chat", "perguntas", "maos", "pessoas", "mais"] as const;

export function SessionConsoleSkeleton() {
  return (
    <div className={skeleton.root} data-console-root="" data-room-theme="dark">
      <span aria-live="polite" className="sr-only" role="status">
        {WEBINAR_COPY.consoleV2.carregando}
      </span>
      <div aria-hidden="true" className={skeleton.top}>
        <div className={cn("flex min-w-0 items-center gap-2 lg:flex-1 lg:gap-4", adminDelayedReveal)}>
          <Skeleton className={cn("size-10 rounded-full", bar)} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Skeleton className={cn("h-5 w-72 max-w-full", bar)} />
            <Skeleton className={cn("h-3.5 w-28", bar)} />
          </div>
        </div>
        <div className={cn("flex min-w-0 items-center gap-2", adminDelayedReveal)}>
          <Skeleton className={cn("h-10 w-64 max-w-full rounded-full", bar)} />
          <Skeleton className={cn("size-10 rounded-full", bar)} />
          <Skeleton className={cn("h-10 w-32 rounded-full", bar)} />
          <Skeleton className={cn("size-10 rounded-full", bar)} />
        </div>
      </div>
      <div aria-hidden="true" className={skeleton.body}>
        <div className={skeleton.stageColumn ?? ""}>
          <div className={cn(skeleton.stage, adminDelayedReveal)} />
          <Skeleton className={cn("h-[72px] w-full shrink-0 rounded-[var(--member-cover-radius)]", bar, adminDelayedReveal)} />
        </div>
        <div className={cn(skeleton.panel, "gap-4 lg:p-4")}>
          <Skeleton className={cn("h-7 w-24", bar, adminDelayedReveal)} />
          {LINE_KEYS.map((line) => (
            <div className={cn("flex min-w-0 items-start gap-3", adminDelayedReveal)} key={line}>
              <Skeleton className={cn("size-6 shrink-0 rounded-full", bar)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-3 w-24", bar)} />
                <Skeleton className={cn("h-4 w-full", bar)} />
              </div>
            </div>
          ))}
        </div>
        <div className={skeleton.rail ?? ""}>
          {RAIL_KEYS.map((key) => (
            <Skeleton className={cn("size-12 rounded-[8px]", bar, adminDelayedReveal)} key={key} />
          ))}
        </div>
      </div>
    </div>
  );
}
