import { Skeleton } from "@/components/ui/skeleton";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { adminDelayedReveal } from "../../../styles";
import { consoleSkeleton } from "./console-layout-model";

// Esqueleto do console da sessao (docs/17 §2.7; docs/31 V2-13): a forma do console V2 em tela cheia, no escuro (o
// servidor nao sabe o tema guardado no navegador): o topo de 56 px (a seta, o titulo, o seletor e os botoes), a coluna
// do palco (o palco e a barra de 72 px) e o painel. Nunca o spinner de tela cheia.

const bar = "bg-room-surface-2 motion-reduce:animate-none";
const skeleton = consoleSkeleton({ hasStage: true, panelOpen: true });
const PANEL_KEYS = ["chat", "perguntas", "enquetes"] as const;
const LINE_KEYS = ["a", "b", "c", "d"] as const;

export function SessionConsoleSkeleton() {
  return (
    <div className={skeleton.root} data-console-root="" data-room-theme="dark">
      <span aria-live="polite" className="sr-only" role="status">
        {WEBINAR_COPY.consoleV2.carregando}
      </span>
      <div aria-hidden="true" className={skeleton.top}>
        <div className={cn("flex min-w-0 items-center gap-3 lg:flex-1", adminDelayedReveal)}>
          <Skeleton className={cn("size-9 rounded-[var(--member-button-radius)]", bar)} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Skeleton className={cn("h-3 w-28", bar)} />
            <Skeleton className={cn("h-4 w-64 max-w-full", bar)} />
          </div>
        </div>
        <div className={cn("flex min-w-0 items-center gap-2", adminDelayedReveal)}>
          <Skeleton className={cn("h-9 w-64 max-w-full rounded-[var(--member-button-radius)]", bar)} />
          <Skeleton className={cn("size-9 rounded-[var(--member-button-radius)]", bar)} />
          <Skeleton className={cn("h-9 w-32 rounded-[var(--member-button-radius)]", bar)} />
        </div>
      </div>
      <div aria-hidden="true" className={skeleton.body}>
        <div className={skeleton.stageColumn ?? ""}>
          <div className={cn(skeleton.stage, adminDelayedReveal)} />
          <Skeleton className={cn("h-[72px] w-full shrink-0 rounded-[var(--member-cover-radius)]", bar, adminDelayedReveal)} />
        </div>
        <div className={skeleton.panel}>
          {PANEL_KEYS.map((key) => (
            <div className="flex min-w-0 flex-col gap-3 rounded-[var(--member-cover-radius)] border border-room-border bg-room-surface p-4" key={key}>
              <Skeleton className={cn("h-5 w-24", bar, adminDelayedReveal)} />
              {LINE_KEYS.map((line) => (
                <Skeleton className={cn("h-4 w-full", bar, adminDelayedReveal)} key={line} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
