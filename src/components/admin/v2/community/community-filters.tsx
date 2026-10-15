"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useState, useTransition, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { lessonsForProduct } from "@/server/community/mappers";
import type { CommunityFilterOptions } from "@/server/community/types";
import { adminInputClass } from "../form";
import { PeriodMenu } from "../period-menu";
import { adminTransition } from "../styles";
import { communityHref } from "./hrefs";

// Filtros das abas da Comunidade, todos no endereco (?produto=&aula=&periodo=&situacao=&respondido=
// &busca=), na disposicao do prototipo aprovado: rotulo 13/500 fora do campo ("Produto [Todos ▾]"),
// campos de 36 px com a largura do prototipo e a dica de teclado encostada a direita. No celular os
// rotulos somem e os campos dividem a linha. Cada troca entra no historico e volta para a pagina 1.

type Option = { label: string; value: string | null };

/** "periodo" das listas de trabalho (fila, denuncias) aceita "Tudo" (sem janela); as demais, nao. */
export type PeriodMode = "all-or-window" | "window" | "none";

const STATUS_OPTIONS: Option[] = [
  { label: "Todas", value: null },
  { label: "Visível", value: "approved" },
  { label: "Oculto", value: "hidden" },
  { label: "Spam", value: "spam" },
  { label: "Aguardando", value: "pending" }
];

const ANSWERED_OPTIONS: Option[] = [
  { label: "Todos", value: null },
  { label: "Com resposta", value: "sim" },
  { label: "Sem resposta", value: "nao" }
];

const ALL_PERIODS = { label: "Tudo" } as const;

const triggerClass = cn(
  "h-9! w-full min-w-0 border-[var(--border-subtle)] bg-[var(--surface-1)] pr-2.5 pl-3 text-[13px] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] dark:bg-[var(--surface-1)] dark:hover:bg-[var(--surface-1)]",
  adminTransition
);

const contentClass = "max-h-80 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0";

/** Campo com o rotulo fora: "Produto [Todos ▾]". No celular o rotulo some e o campo divide a linha. */
const fieldClass = "flex min-w-0 items-center gap-1.5 max-md:flex-[1_1_130px]";
const fieldLabelClass = "hidden shrink-0 text-[13px] leading-5 font-medium text-[var(--text-tertiary)] md:inline";

type FilterSelectProps = {
  /** Largura do campo a partir de 768 px (a do prototipo). */
  className?: string;
  label: string;
  onChange: (value: string | null) => void;
  options: Option[];
  value: string | null;
};

function FilterSelect({ className, label, onChange, options, value }: FilterSelectProps) {
  const known = options.some((option) => option.value === value);
  // Endereco compartilhado com um valor fora da lista: mostra o filtro em vez de esconde-lo.
  const items = known ? options : [...options, { label: "Selecionado", value }];

  return (
    <div className={fieldClass}>
      <span aria-hidden="true" className={fieldLabelClass}>
        {label}
      </span>
      <Select items={items} onValueChange={(next) => onChange((next as string | null) ?? null)} value={value}>
        <SelectTrigger aria-label={label} className={cn(triggerClass, className)}>
          <SelectValue className="min-w-0 truncate" />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className={contentClass}>
          {items.map((option) => (
            <SelectItem className="h-9 rounded-md px-2 text-sm" key={option.value ?? "todos"} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type CommunityFiltersProps = {
  /** false = sem "Todos" no Produto (Professor: um curso dele por vez). */
  allowAllProducts?: boolean;
  /** Conteudo a direita (ex.: dica de teclado da fila). */
  aside?: ReactNode;
  options: CommunityFilterOptions;
  periodMode?: PeriodMode;
  showAnswered?: boolean;
  showLesson?: boolean;
  showSearch?: boolean;
  showStatus?: boolean;
};

export function CommunityFilters({
  allowAllProducts = true,
  aside,
  options,
  periodMode = "window",
  showAnswered = false,
  showLesson = true,
  showSearch = false,
  showStatus = false
}: CommunityFiltersProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const product = searchParams.get("produto");
  const lesson = searchParams.get("aula");

  function navigate(patch: Record<string, string | null>, mode: "push" | "replace" = "push") {
    const href = communityHref(pathname, new URLSearchParams(searchParams.toString()), patch);

    startTransition(() => {
      if (mode === "replace") {
        router.replace(href, { scroll: false });
      } else {
        router.push(href, { scroll: false });
      }
    });
  }

  const productOptions: Option[] = [
    ...(allowAllProducts ? [{ label: "Todos", value: null }] : []),
    ...options.products.map((item) => ({ label: item.label, value: item.id }))
  ];
  const lessonOptions: Option[] = [
    { label: "Todas", value: null },
    ...lessonsForProduct(options.lessons, product).map((item) => ({ label: item.label, value: item.id }))
  ];

  return (
    <div aria-busy={pending || undefined} className="flex min-w-0 flex-wrap items-center gap-2" role="search">
      {showSearch ? <SearchField onSearch={(value) => navigate({ busca: value }, "replace")} value={searchParams.get("busca") ?? ""} /> : null}
      <FilterSelect
        className="md:w-[230px]"
        label="Produto"
        onChange={(value) => navigate({ aula: null, produto: value })}
        options={productOptions}
        value={product}
      />
      {showLesson ? (
        <FilterSelect
          className="md:w-[260px]"
          label="Aula"
          onChange={(value) => navigate({ aula: value })}
          options={lessonOptions}
          value={lesson}
        />
      ) : null}
      {showStatus ? (
        <FilterSelect
          className="md:w-[150px]"
          label="Situação"
          onChange={(value) => navigate({ situacao: value })}
          options={STATUS_OPTIONS}
          value={searchParams.get("situacao")}
        />
      ) : null}
      {showAnswered ? (
        <FilterSelect
          className="md:w-[160px]"
          label="Resposta"
          onChange={(value) => navigate({ respondido: value })}
          options={ANSWERED_OPTIONS}
          value={searchParams.get("respondido")}
        />
      ) : null}
      {periodMode !== "none" ? (
        // Periodo com o modelo do admin (Hoje, 24 horas, 3, 7 e 30 dias), mais "Tudo" na fila e em
        // Denúncias. Sem calendario: as consultas da Comunidade so recebem o inicio da janela.
        <div className="max-md:flex-[1_1_130px] max-md:[&>div]:w-full max-md:[&>div>span:first-child]:hidden max-md:[&_button]:w-full">
          <PeriodMenu allOption={periodMode === "all-or-window" ? ALL_PERIODS : null} allowRange={false} variant="inline" />
        </div>
      ) : null}
      {aside ? <div className="ml-auto hidden min-w-0 items-center md:flex">{aside}</div> : null}
    </div>
  );
}

function SearchField({ onSearch, value }: { onSearch: (value: string) => void; value: string }) {
  const [text, setText] = useState(value);
  // Ultimo valor do endereco visto e ultimo enviado: so sobrescreve o campo quando o endereco mudou
  // por fora (ex.: "Limpar filtros"), nunca no meio da digitacao.
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  const search = useEffectEvent((next: string) => onSearch(next));

  if (value !== seen) {
    setSeen(value);

    if (value !== sent) {
      setSent(value);
      setText(value);
    }
  }

  useEffect(() => {
    const next = text.trim();

    if (next === sent.trim()) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSent(next);
      search(next);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [sent, text]);

  return (
    <label className="relative block w-full min-w-0 md:w-[280px]">
      <span className="sr-only">Buscar no texto ou no nome do aluno</span>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
      <input
        className={cn(adminInputClass, "h-9 bg-[var(--surface-1)] pl-9 text-[13px]")}
        maxLength={80}
        onChange={(event) => setText(event.target.value)}
        placeholder="Buscar no texto ou no nome"
        type="search"
        value={text}
      />
    </label>
  );
}
