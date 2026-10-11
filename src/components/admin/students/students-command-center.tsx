"use client";

import * as React from "react";
import {
  Filter,
  Search,
  TrendingUp,
  UserPlus,
  Users
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type {
  AdminEntitlementStatus,
  AdminSellableProduct,
  AdminSourceProvider,
  AdminStudent,
  AdminStudentCourse
} from "@/lib/platform-types";

export type StudentsCommandCenterProps = {
  courseFilter: string;
  onCourseFilterChange: (value: string) => void;
  onCreateStudent: () => void;
  onQueryChange: (value: string) => void;
  onSourceFilterChange: (value: "all" | AdminSourceProvider) => void;
  onStatusFilterChange: (value: "all" | AdminEntitlementStatus) => void;
  query: string;
  sellableProducts: AdminSellableProduct[];
  sourceFilter: "all" | AdminSourceProvider;
  statusFilter: "all" | AdminEntitlementStatus;
  students: AdminStudent[];
};

const sourceProviderOptions = ["Hotmart", "Ticto", "TikTok", "Kiwify", "Manual"] satisfies AdminSourceProvider[];
const statusOptions = ["active", "suspended", "revoked", "expired"] satisfies AdminEntitlementStatus[];

const statusLabels: Record<AdminEntitlementStatus, string> = {
  active: "Ativo",
  expired: "Expirado",
  revoked: "Revogado",
  suspended: "Suspenso"
};

// Estado vazio honesto (docs/17 §1.2, regra 2): sem dado real, o card mostra
// "—" e a legenda; nada de séries de exemplo, pontuação inventada nem caixa
// de gráfico vazia. Só ficam os cards com caminho de dado real.
const EMPTY_VALUE = "—";
const EMPTY_KPI_CAPTION = "Sem dados no período";

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function getAverageProgress(courses: AdminStudentCourse[]) {
  if (courses.length === 0) {
    return null;
  }

  return clampPercent(courses.reduce((total, course) => total + course.progressPercent, 0) / courses.length);
}

export function StudentsCommandCenter({
  courseFilter,
  onCourseFilterChange,
  onCreateStudent,
  onQueryChange,
  onSourceFilterChange,
  onStatusFilterChange,
  query,
  sellableProducts,
  sourceFilter,
  statusFilter,
  students
}: StudentsCommandCenterProps) {
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const totalStudents = students.length;
  const activeStudents = students.filter((student) => student.status === "active").length;
  const averageProgress = getAverageProgress(students.flatMap((student) => student.courses));

  return (
    <section className="space-y-6 text-zinc-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Relacionamento</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">Alunos</h1>
        </div>
        <Button
          className="h-10 rounded-[8px] bg-[var(--accent)] px-4 text-sm font-bold text-white shadow-[0_14px_34px_rgba(229,9,20,0.24)] hover:bg-[#ff1f2a]"
          onClick={onCreateStudent}
          type="button"
        >
          <UserPlus className="size-4" />
          Adicionar aluno
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(18rem,1fr)_minmax(18rem,1fr)_auto]">
        <label className="relative min-w-0">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <span className="sr-only">Buscar aluno</span>
          <Input
            className="h-11 rounded-[8px] border-[#2a2d35] bg-[#15161b] pr-10 pl-4 text-sm font-semibold text-white placeholder:text-zinc-600 focus-visible:border-white/30 focus-visible:ring-white/10"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar aluno por nome ou email"
            type="search"
            value={query}
          />
        </label>

        <FilterSelect
          label="Alunos em"
          onValueChange={onCourseFilterChange}
          value={courseFilter}
        >
          <SelectItem value="all">Todos os produtos</SelectItem>
          {sellableProducts.map((product) => (
            <SelectItem key={product.id} value={product.id}>
              {product.title}
            </SelectItem>
          ))}
        </FilterSelect>

        <Button
          className="h-11 rounded-[8px] border-[#2a2d35] bg-[#1b1d23] px-5 text-sm font-bold text-zinc-200 hover:bg-[#242731] hover:text-white"
          onClick={() => setFiltersOpen((current) => !current)}
          type="button"
          variant="outline"
        >
          <Filter className="size-4" />
          Filtrar
        </Button>
      </div>

      {filtersOpen ? (
        <div className="grid gap-3 rounded-[8px] border border-[#2a2d35] bg-[#15161b] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)] sm:grid-cols-2">
          <FilterSelect
            label="Status"
            onValueChange={(value) => onStatusFilterChange(value as "all" | AdminEntitlementStatus)}
            value={statusFilter}
          >
            <SelectItem value="all">Todos</SelectItem>
            {statusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabels[status]}
              </SelectItem>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Origem"
            onValueChange={(value) => onSourceFilterChange(value as "all" | AdminSourceProvider)}
            value={sourceFilter}
          >
            <SelectItem value="all">Todas</SelectItem>
            {sourceProviderOptions.map((provider) => (
              <SelectItem key={provider} value={provider}>
                {provider}
              </SelectItem>
            ))}
          </FilterSelect>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          detail={`${activeStudents} com acesso ativo`}
          icon={Users}
          label="Total de alunos"
          value={totalStudents.toString()}
        />
        <MetricCard
          detail={averageProgress === null ? EMPTY_KPI_CAPTION : "Média dos produtos liberados"}
          icon={TrendingUp}
          label="Progresso médio"
          value={averageProgress === null ? EMPTY_VALUE : `${averageProgress}%`}
        />
      </div>
    </section>
  );
}

function FilterSelect({
  children,
  label,
  onValueChange,
  value
}: {
  children: React.ReactNode;
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="sr-only">{label}</span>
      <Select
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string") {
            onValueChange(nextValue);
          }
        }}
        value={value}
      >
        <SelectTrigger className="h-11 w-full rounded-[8px] border-[#2a2d35] bg-[#15161b] px-4 text-sm font-semibold text-zinc-200 hover:bg-[#1b1d23] focus-visible:border-white/30 focus-visible:ring-white/10">
          <span className="mr-1 text-zinc-500">{label}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-[8px] border-[#2a2d35] bg-[#17181d] text-zinc-100 shadow-[0_20px_60px_rgba(0,0,0,0.48)]">
          {children}
        </SelectContent>
      </Select>
    </label>
  );
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  value
}: {
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="overflow-hidden rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)] ring-1 ring-white/[0.025]">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
              <Icon className="size-3.5" />
              {label}
            </p>
            <p className="mt-8 truncate text-3xl font-semibold tracking-normal text-white">{value}</p>
            <p className="mt-1 truncate text-xs font-semibold text-zinc-500">{detail}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
