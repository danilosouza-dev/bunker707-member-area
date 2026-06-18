"use client";

import * as React from "react";
import {
  Activity,
  Filter,
  Gauge,
  Search,
  TrendingUp,
  UserPlus,
  Users
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function getAverageProgress(courses: AdminStudentCourse[]) {
  if (courses.length === 0) {
    return 0;
  }

  return clampPercent(courses.reduce((total, course) => total + course.progressPercent, 0) / courses.length);
}

function getStudentEngagementScore(student: AdminStudent) {
  if (student.status !== "active") {
    return 0;
  }

  const progressScore = getAverageProgress(student.courses) * 0.68;
  const accessScore = Math.min(32, (student.accessCount ?? 0) * 1.8);

  return clampPercent(progressScore + accessScore);
}

function getEngagementLabel(score: number) {
  if (score <= 5) {
    return "Nenhum";
  }

  if (score < 30) {
    return "Baixo";
  }

  if (score < 58) {
    return "Medio";
  }

  if (score < 82) {
    return "Alto";
  }

  return "Altissimo";
}

function formatPercent(value: number) {
  return `${clampPercent(value)}%`;
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
  const [filtersOpen, setFiltersOpen] = React.useState(true);
  const totalStudents = students.length;
  const activeStudents = students.filter((student) => student.status === "active").length;
  const averageProgress = getAverageProgress(students.flatMap((student) => student.courses));
  const averageEngagement = students.length > 0
    ? clampPercent(students.reduce((total, student) => total + getStudentEngagementScore(student), 0) / students.length)
    : 0;
  const engagementLabel = getEngagementLabel(averageEngagement);
  const engagementSeries = students.slice(0, 10).map(getStudentEngagementScore);
  const progressSeries = students.slice(0, 10).map((student) => getAverageProgress(student.courses));
  const memberSeries = [20, 34, 44, 58, 73, Math.max(78, totalStudents > 0 ? 92 : 24)];

  return (
    <section className="space-y-4">
      <div className="rounded-[8px] border border-white/10 bg-[#101114] p-4 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="h-6 rounded-[6px] bg-white/10 px-2.5 text-[11px] font-semibold uppercase tracking-normal text-zinc-200 ring-1 ring-white/15">
                Alunos
              </Badge>
              <Badge className="h-6 rounded-[6px] bg-emerald-400/12 px-2.5 text-[11px] font-semibold text-emerald-100 ring-1 ring-emerald-300/20">
                {activeStudents} ativos
              </Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-normal text-white sm:text-3xl">
              Membros
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Busque, filtre e acompanhe os alunos cadastrados no CRM.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="h-11 rounded-[8px] border-white/10 bg-white/[0.055] px-4 text-sm font-semibold text-zinc-100 hover:bg-white/10"
              onClick={() => setFiltersOpen((current) => !current)}
              type="button"
              variant="outline"
            >
              <Filter className="size-4" />
              Filtrar
            </Button>
            <Button
              className="h-11 rounded-[8px] bg-red-600 px-4 text-sm font-semibold text-white shadow-lg shadow-red-950/30 hover:bg-red-500"
              onClick={onCreateStudent}
              type="button"
            >
              <UserPlus className="size-4" />
              Adicionar membro
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_auto] xl:items-end">
          <label className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <span className="sr-only">Buscar membro</span>
            <Input
              className="h-11 rounded-[8px] border-white/10 bg-black/35 pl-9 text-sm text-white placeholder:text-zinc-600 focus-visible:border-white/25 focus-visible:ring-white/10"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Buscar por nome ou email"
              type="search"
              value={query}
            />
          </label>

          {filtersOpen ? (
            <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[32rem]">
              <FilterSelect
                label="Produto"
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
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <MetricCard
          detail={`${activeStudents} com acesso ativo`}
          icon={Users}
          label="Total de membros"
          series={memberSeries}
          value={totalStudents.toString()}
        />
        <MetricCard
          detail="Media dos produtos liberados"
          icon={TrendingUp}
          label="Progresso medio"
          series={progressSeries}
          tone="green"
          value={formatPercent(averageProgress)}
        />
        <MetricCard
          detail={`${averageEngagement} pontos de atividade`}
          icon={Activity}
          label="Engajamento"
          series={engagementSeries}
          tone={averageEngagement >= 58 ? "green" : averageEngagement >= 30 ? "amber" : "red"}
          value={engagementLabel}
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
      <span className="text-[11px] font-semibold uppercase tracking-normal text-zinc-500">{label}</span>
      <Select
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string") {
            onValueChange(nextValue);
          }
        }}
        value={value}
      >
        <SelectTrigger className="h-9 w-full rounded-[8px] border-white/10 bg-black/35 text-zinc-100 hover:bg-black/45">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border border-white/10 bg-[#111216] text-zinc-100 shadow-2xl shadow-black/50">
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
  series,
  tone = "neutral",
  value
}: {
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  series: number[];
  tone?: "amber" | "green" | "neutral" | "red";
  value: string;
}) {
  const chartColor = tone === "green"
    ? "bg-emerald-300"
    : tone === "amber"
      ? "bg-amber-300"
      : tone === "red"
        ? "bg-red-400"
        : "bg-zinc-200";

  return (
    <Card className="overflow-hidden rounded-[8px] border-white/10 bg-[#101114] py-0 ring-0">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{label}</p>
            <p className="mt-2 truncate text-3xl font-semibold tracking-normal text-white">{value}</p>
            <p className="mt-1 truncate text-xs text-zinc-500">{detail}</p>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-[8px] border border-white/10 bg-white/[0.055] text-zinc-200">
            <Icon className="size-4" />
          </span>
        </div>

        <div className="mt-5 flex h-16 items-end gap-1.5 rounded-[8px] border border-white/10 bg-black/25 p-2">
          {series.length > 0 ? (
            series.map((item, index) => (
              <span
                className={`block flex-1 rounded-t-[4px] ${chartColor}`}
                key={`${label}-${index}`}
                style={{ height: `${Math.max(8, clampPercent(item))}%`, opacity: 0.35 + (index / Math.max(1, series.length - 1)) * 0.55 }}
              />
            ))
          ) : (
            <span className="grid h-full w-full place-items-center text-xs font-medium text-zinc-600">
              <Gauge className="size-4" />
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
