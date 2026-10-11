"use client";

import { Search } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import type { ProductOption } from "@/server/catalog/types";
import { adminInputClass } from "../form";
import { ProductThumb } from "../product-thumb";
import { StatusChip, situationTone } from "../status-chip";
import { adminTransition } from "../styles";
import { ContentDialog } from "./content-dialog";

// "Adicionar curso existente" (docs/17 §1.6.9): busca entre os cursos que ainda nao estao em uma
// formacao (a lista chega pronta do servidor). O servidor confere de novo as regras (formato Curso,
// sem acessos proprios, fora de outra formacao) e responde com a mensagem do produtor se recusar.

type AddCourseDialogProps = {
  excludedIds: ReadonlySet<string>;
  onAdd: (courseId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  options: readonly ProductOption[];
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function AddCourseDialog({ excludedIds, onAdd, onOpenChange, open, options }: AddCourseDialogProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const search = normalize(query);
  const available = options.filter((option) => !excludedIds.has(option.id));
  const visible = search ? available.filter((option) => normalize(option.title).includes(search)) : available;

  return (
    <ContentDialog
      className="max-h-[min(640px,calc(100dvh-2rem))]"
      description="Só aparecem cursos que ainda não estão em outra formação."
      footer={
        <Button className="px-4" onClick={() => onOpenChange(false)} type="button" variant="ghost">
          Cancelar
        </Button>
      }
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);

        if (!nextOpen) {
          setQuery("");
        }
      }}
      open={open}
      title="Adicionar curso existente"
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <label className="sr-only" htmlFor={searchId}>
            Buscar curso pelo nome
          </label>
          <input
            autoComplete="off"
            autoFocus
            className={cn(adminInputClass, "pl-9")}
            id={searchId}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar curso pelo nome"
            type="search"
            value={query}
          />
        </div>

        {visible.length > 0 ? (
          <ul aria-label="Cursos disponíveis" className="flex flex-col gap-1">
            {visible.map((option) => (
              <li key={option.id}>
                <button
                  className={cn(
                    "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--hover-overlay)]",
                    adminTransition
                  )}
                  onClick={() => {
                    onAdd(option.id);
                    onOpenChange(false);
                    setQuery("");
                  }}
                  type="button"
                >
                  <ProductThumb accent={option.accent} coverUrl={option.coverUrl} title={option.title} />
                  <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium text-[var(--text-primary)]">
                    {option.title}
                  </span>
                  <StatusChip tone={situationTone(option.situation)}>{PRODUCT_SITUATION_LABELS[option.situation]}</StatusChip>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm leading-5 text-[var(--text-secondary)]">
            {available.length === 0
              ? "Nenhum curso disponível. Crie um curso aqui ou tire um curso de outra formação antes."
              : `Nenhum curso com “${query.trim()}”.`}
          </p>
        )}
      </div>
    </ContentDialog>
  );
}
