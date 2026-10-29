"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { scriptQueueSummary, type ScriptQueueItem } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { offsetLabel } from "@/server/webinars/room-model";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// O painel Roteiro do console (docs/30 §2.4 e §6.6 D6-c): a fila na ordem do minuto, o que ja entrou marcado, os
// itens "Pelo botão da equipe" e "Soltar agora" em qualquer mensagem que ainda nao entrou.

const copy = WEBINAR_ADMIN_COPY.console.script;
const scriptCopy = WEBINAR_ADMIN_COPY.script;

type ConsoleScriptProps = {
  busyKey: string | null;
  canAct: boolean;
  onFire: (itemId: string) => void;
  queue: readonly ScriptQueueItem[];
};

export function ConsoleScript({ busyKey, canAct, onFire, queue }: ConsoleScriptProps) {
  const summary = scriptQueueSummary(queue);

  return (
    <SectionCard description={copy.summary(summary.fired, summary.pending, summary.manual)} title={copy.title} titleId="console-script-title">
      {queue.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</p> : null}
      <ol className="flex max-h-[50vh] min-w-0 flex-col gap-2 overflow-y-auto" data-console-script="">
        {queue.map((item) => (
          <li className={cn("flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--border-subtle)] px-3 py-2", item.fired && "opacity-70", item.status === "disabled" && "opacity-50")} data-script-item={item.id} data-script-fired={item.fired ? "true" : "false"} key={item.id}>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs leading-5 text-[var(--text-tertiary)]">
              <span className="tabular-nums">{item.dueOffsetMs == null ? copy.manual : offsetLabel(item.dueOffsetMs)}</span>
              <span className="font-medium text-[var(--text-primary)]">{item.personaName}</span>
              <span>· {scriptCopy.roles[item.personaRole]}</span>
              {item.fired ? <StatusChip tone="success">{copy.fired}</StatusChip> : item.passed ? <StatusChip tone="warning">{copy.passed}</StatusChip> : null}
              {item.status === "unresolved" ? <StatusChip tone="warning">{scriptCopy.statuses.unresolved}</StatusChip> : null}
              {item.status === "disabled" ? <StatusChip tone="muted">{scriptCopy.statuses.disabled}</StatusChip> : null}
            </div>
            <p className="line-clamp-2 text-sm leading-5 text-[var(--text-primary)]">{item.body}</p>
            {canAct && !item.fired && item.status !== "disabled" ? (
              <div>
                <Button className="h-8! px-2 text-[13px]" disabled={busyKey === `fire:${item.id}`} onClick={() => onFire(item.id)} type="button" variant="secondary">
                  <Zap aria-hidden="true" className="size-4" />
                  {copy.fire}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
