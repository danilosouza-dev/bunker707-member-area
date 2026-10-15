"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { BULK_MAX_TOTAL } from "@/server/students/model";

// Selecao de alunos na lista (acoes em massa). O estado vive neste provedor cliente; as caixas ficam
// dentro da tabela (servidor) e a barra fixa le o mesmo contexto. Teto de 200 por rodada
// (docs/17 §1.7.1 sem fila): acima disso, a barra pede para filtrar melhor.

type SelectionContextValue = {
  clear: () => void;
  selected: ReadonlySet<string>;
  setMany: (ids: readonly string[], on: boolean) => void;
  toggle: (id: string) => void;
  tooMany: boolean;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function StudentSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }, []);
  const setMany = useCallback((ids: readonly string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);

      for (const id of ids) {
        if (on) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }

      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const value = useMemo<SelectionContextValue>(
    () => ({ clear, selected, setMany, toggle, tooMany: selected.size > BULK_MAX_TOTAL }),
    [clear, selected, setMany, toggle]
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useStudentSelection() {
  const context = useContext(SelectionContext);

  if (!context) {
    throw new Error("useStudentSelection precisa de StudentSelectionProvider");
  }

  return context;
}

const checkboxClass =
  "size-[18px] border-[var(--border-stronger)] bg-[var(--surface-1)] data-checked:border-[var(--text-primary)] data-checked:bg-[var(--text-primary)] data-checked:text-[var(--surface-0)] data-indeterminate:border-[var(--text-primary)] data-indeterminate:bg-[var(--text-primary)] data-indeterminate:text-[var(--surface-0)] pointer-coarse:size-6";

export function RowSelectCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useStudentSelection();

  return (
    <span className="flex min-h-11 items-center">
      <Checkbox aria-label={`Selecionar ${label}`} checked={selected.has(id)} className={checkboxClass} onCheckedChange={() => toggle(id)} />
    </span>
  );
}

export function SelectAllCheckbox({ ids }: { ids: readonly string[] }) {
  const { selected, setMany } = useStudentSelection();
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  const some = !all && ids.some((id) => selected.has(id));

  return (
    <Checkbox
      aria-label="Selecionar todos desta página"
      checked={all}
      className={checkboxClass}
      indeterminate={some}
      onCheckedChange={(next) => setMany(ids, next === true)}
    />
  );
}
