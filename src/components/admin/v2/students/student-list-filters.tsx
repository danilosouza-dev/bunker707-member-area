"use client";

import { Check, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LIFECYCLE_GROUP_LABELS, STUDENT_PACES, STUDENT_PACE_LABELS, type StudentCohort, type StudentPace } from "@/server/students/model";
import { adminPillClasses } from "../form";
import { resolveSearchText } from "../products/list-filters";
import { adminTransition } from "../styles";
import { studentListHref, type StudentListFilters } from "./hrefs";

// Filtros da lista de alunos, na mesma linha da lista de Produtos: pilulas de Ritmo, select de Produto
// e a busca por nome ou e-mail a direita. Tudo no endereco (?ritmo=&produto=&busca=&pagina=);
// a busca espera 300 ms antes de navegar.

const SEARCH_DEBOUNCE_MS = 300;

export type StudentFilterProduct = { id: string; title: string };

type StudentListFiltersBarProps = {
  cohorts: readonly StudentCohort[];
  filters: StudentListFilters;
  products: readonly StudentFilterProduct[];
};

/** Filtros que so entram por segmento ou pelo ciclo de vida: aparecem como chips removiveis. */
function extraFilterChips(filters: StudentListFilters) {
  const chips: { label: string; patch: Partial<StudentListFilters> }[] = [];

  if (filters.expiring) chips.push({ label: "Expiram em 30 dias", patch: { expiring: undefined } });
  if (filters.account === "never") chips.push({ label: "Nunca entraram", patch: { account: undefined } });
  if (filters.notStarted) chips.push({ label: "Compraram e não começaram", patch: { notStarted: undefined } });
  if (filters.commenters === "top") chips.push({ label: "Top comentadores", patch: { commenters: undefined } });
  if (filters.week && filters.group) {
    chips.push({ label: `${LIFECYCLE_GROUP_LABELS[filters.group]} na semana de ${filters.week.slice(8, 10)}/${filters.week.slice(5, 7)}`, patch: { group: undefined, week: undefined } });
  }

  return chips;
}

const paceOptions: { label: string; value: StudentPace | undefined }[] = [
  { label: "Todos", value: undefined },
  ...STUDENT_PACES.map((pace) => ({ label: STUDENT_PACE_LABELS[pace], value: pace }))
];

export function StudentListFiltersBar({ cohorts, filters, products }: StudentListFiltersBarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const addressQuery = filters.q ?? "";
  const [typed, setTyped] = useState({ base: addressQuery, text: addressQuery });
  const searchText = resolveSearchText(addressQuery, typed);
  const productOptions = [{ label: "Todos", value: null as string | null }, ...products.map((product) => ({ label: product.title, value: product.id }))];
  const cohortOptions = [{ label: "Todas", value: null as string | null }, ...cohorts.map((cohort) => ({ label: cohort.name, value: cohort.id }))];
  const chips = extraFilterChips(filters);

  useEffect(() => {
    const next = searchText.trim();

    if (next === addressQuery) {
      return;
    }

    const timer = window.setTimeout(() => {
      startTransition(() => {
        router.replace(studentListHref(filters, { q: next }), { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [addressQuery, filters, router, searchText]);

  return (
    <div aria-busy={pending || undefined} className="flex min-w-0 flex-wrap items-center gap-2">
      <nav aria-label="Ritmo" className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {paceOptions.map((option) => {
            const active = filters.pace === option.value;

            return (
              <li key={option.label}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={adminPillClasses(active)}
                  data-navigation-feedback="false"
                  href={studentListHref(filters, { pace: option.value })}
                  scroll={false}
                >
                  {active ? <Check aria-hidden="true" className="size-4" /> : null}
                  {option.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 items-center gap-1.5 max-md:flex-[1_1_160px]">
        <span className="text-[13px] font-medium text-[var(--text-tertiary)] max-md:sr-only" id="filtro-aluno-produto">
          Produto
        </span>
        <Select
          items={productOptions}
          onValueChange={(value) => {
            startTransition(() => {
              router.push(studentListHref(filters, { productId: (value as string | null) ?? undefined }), { scroll: false });
            });
          }}
          value={filters.productId ?? null}
        >
          <SelectTrigger
            aria-labelledby="filtro-aluno-produto"
            className={cn(
              "w-[180px] rounded-lg border-[var(--border-subtle)] bg-[var(--surface-1)] pr-2.5 pl-3 text-[13px] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] data-[size=default]:h-9 max-md:w-full",
              adminTransition
            )}
          >
            <SelectValue className="min-w-0 truncate" />
          </SelectTrigger>
          <SelectContent className="max-h-80 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0">
            {productOptions.map((option) => (
              <SelectItem key={option.value ?? "todos"} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {cohorts.length > 0 ? (
        <div className="flex min-w-0 items-center gap-1.5 max-md:flex-[1_1_160px]">
          <span className="text-[13px] font-medium text-[var(--text-tertiary)] max-md:sr-only" id="filtro-aluno-turma">
            Turma
          </span>
          <Select
            items={cohortOptions}
            onValueChange={(value) => {
              startTransition(() => {
                router.push(studentListHref(filters, { cohortId: (value as string | null) ?? undefined }), { scroll: false });
              });
            }}
            value={filters.cohortId ?? null}
          >
            <SelectTrigger
              aria-labelledby="filtro-aluno-turma"
              className={cn(
                "w-[160px] rounded-lg border-[var(--border-subtle)] bg-[var(--surface-1)] pr-2.5 pl-3 text-[13px] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] data-[size=default]:h-9 max-md:w-full",
                adminTransition
              )}
            >
              <SelectValue className="min-w-0 truncate" />
            </SelectTrigger>
            <SelectContent className="max-h-80 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0">
              {cohortOptions.map((option) => (
                <SelectItem key={option.value ?? "todas"} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {chips.map((chip) => (
        <Link
          className={cn(adminPillClasses(true), "gap-1 pr-2.5")}
          data-navigation-feedback="false"
          href={studentListHref(filters, chip.patch)}
          key={chip.label}
          scroll={false}
          title="Tirar este filtro"
        >
          {chip.label}
          <X aria-hidden="true" className="size-3.5" />
        </Link>
      ))}

      <span aria-hidden="true" className="hidden flex-1 md:block" />

      <div className="relative min-w-[200px] flex-[0_1_280px]">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <label className="sr-only" htmlFor="alunos-busca">
          Buscar aluno por nome ou e-mail
        </label>
        <Input
          autoComplete="off"
          className={cn(
            "h-9 w-full min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] pr-3 pl-8 text-sm text-[var(--text-primary)]",
            "placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus-visible:border-[var(--text-secondary)] focus-visible:ring-0",
            adminTransition
          )}
          id="alunos-busca"
          onChange={(event) => setTyped({ base: addressQuery, text: event.target.value })}
          placeholder="Nome ou e-mail"
          type="search"
          value={searchText}
        />
      </div>
    </div>
  );
}
