"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { adminTransition } from "../styles";
import { ContentDialog } from "./content-dialog";
import { pluralize } from "./content-ui";
import type { ContentTree } from "./tree-model";

// "Mover para…" (docs/17 §1.6.3): a alternativa sem arrastar. Lista os modulos; escolher um move as
// aulas para o fim dele e fecha. O modulo onde todas ja estao aparece marcado e nao faz nada.

type MoveLessonsDialogProps = {
  lessonIds: readonly string[];
  onMove: (moduleId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tree: ContentTree;
};

export function MoveLessonsDialog({ lessonIds, onMove, onOpenChange, open, tree }: MoveLessonsDialogProps) {
  const wanted = new Set(lessonIds);
  const count = lessonIds.length;
  const modules = tree.filter((module) => !module.pending);

  return (
    <ContentDialog
      description={
        count === 1
          ? "A aula vai para o fim do módulo escolhido."
          : `As ${count} aulas vão para o fim do módulo escolhido, na ordem em que estão.`
      }
      footer={
        <Button className="px-4" onClick={() => onOpenChange(false)} type="button" variant="ghost">
          Cancelar
        </Button>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={count === 1 ? "Mover aula para…" : `Mover ${count} aulas para…`}
    >
      <ul aria-label="Módulos" className="flex flex-col gap-1">
        {modules.map((module) => {
          const holdsAll = module.lessons.length > 0 && count > 0 && module.lessons.filter((lesson) => wanted.has(lesson.id)).length === count;

          return (
            <li key={module.clientKey ?? module.id}>
              <button
                aria-current={holdsAll ? "true" : undefined}
                className={cn(
                  "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left",
                  holdsAll
                    ? "cursor-default bg-[var(--surface-2)]"
                    : "hover:bg-[var(--hover-overlay)]",
                  adminTransition
                )}
                onClick={() => {
                  if (!holdsAll) {
                    onMove(module.id);
                  }

                  onOpenChange(false);
                }}
                type="button"
              >
                <span className="w-20 shrink-0 text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
                  Módulo {module.position}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium text-[var(--text-primary)]">
                  {module.title}
                </span>
                <span className="shrink-0 text-[13px] leading-5 text-[var(--text-tertiary)] tabular-nums">
                  {pluralize(module.lessons.length, "aula", "aulas")}
                </span>
                {holdsAll ? <Check aria-label="Já está aqui" className="size-4 shrink-0 text-[var(--text-secondary)]" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </ContentDialog>
  );
}
