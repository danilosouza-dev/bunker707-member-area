"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
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
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
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

const studentMetricFallbackSeries = {
  engagement: [28, 35, 42, 48, 56, 63, 71],
  members: [312, 338, 361, 389, 422, 456, 487],
  progress: [36, 41, 46, 52, 57, 61, 66]
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

function buildMetricSeries(values: number[], fallback: number[]) {
  const normalizedValues = values
    .filter((value) => Number.isFinite(value))
    .slice(0, fallback.length)
    .map(clampPercent);

  if (normalizedValues.length === 0) {
    return fallback;
  }

  if (normalizedValues.length === fallback.length) {
    return normalizedValues;
  }

  const [firstValue] = normalizedValues;
  const missingCount = fallback.length - normalizedValues.length;
  const leadingValues = fallback.slice(0, missingCount).map((value, index) => {
    const progress = (index + 1) / (missingCount + 1);
    return clampPercent(value + (firstValue - value) * progress);
  });

  return [...leadingValues, ...normalizedValues];
}

function buildMemberSeries(totalStudents: number) {
  if (totalStudents <= 0) {
    return studentMetricFallbackSeries.members;
  }

  return studentMetricFallbackSeries.members.map((_, index, series) => {
    const progress = (index + 1) / series.length;
    return Math.max(1, Math.round(totalStudents * (0.62 + progress * 0.38)));
  });
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
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const totalStudents = students.length;
  const activeStudents = students.filter((student) => student.status === "active").length;
  const averageProgress = getAverageProgress(students.flatMap((student) => student.courses));
  const averageEngagement = students.length > 0
    ? clampPercent(students.reduce((total, student) => total + getStudentEngagementScore(student), 0) / students.length)
    : 0;
  const engagementLabel = getEngagementLabel(averageEngagement);
  const engagementSeries = buildMetricSeries(students.map(getStudentEngagementScore), studentMetricFallbackSeries.engagement);
  const progressSeries = buildMetricSeries(
    students.map((student) => getAverageProgress(student.courses)),
    studentMetricFallbackSeries.progress
  );
  const memberSeries = buildMemberSeries(totalStudents);

  return (
    <section className="space-y-6 text-zinc-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">CRM / Relacionamento</p>
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

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard
          chartColor="#e50914"
          detail={`${activeStudents} com acesso ativo`}
          icon={Users}
          label="Total de alunos"
          series={memberSeries}
          tone={activeStudents > 0 ? "green" : "neutral"}
          value={totalStudents.toString()}
        />
        <MetricCard
          chartColor="#22c55e"
          detail="Media dos produtos liberados"
          icon={TrendingUp}
          label="Progresso medio"
          series={progressSeries}
          tone="green"
          value={formatPercent(averageProgress)}
        />
        <MetricCard
          chartColor="#f59e0b"
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
  chartColor,
  detail,
  icon: Icon,
  label,
  series,
  tone = "neutral",
  value
}: {
  chartColor: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  series: number[];
  tone?: "amber" | "green" | "neutral" | "red";
  value: string;
}) {
  const gradientId = React.useId().replace(/:/g, "");
  const toneClassName = tone === "green"
    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
    : tone === "amber"
      ? "border-amber-400/25 bg-amber-500/10 text-amber-200"
      : tone === "red"
        ? "border-red-400/25 bg-red-500/10 text-red-200"
        : "border-white/10 bg-white/[0.055] text-zinc-300";
  const chartData = series.map((item, index) => ({
    label: `${index + 1}`,
    value: item
  }));
  const firstValue = series[0] ?? 0;
  const lastValue = series.at(-1) ?? firstValue;
  const trendLabel = Math.abs(lastValue - firstValue) <= 3 ? "Estavel" : lastValue > firstValue ? "Subindo" : "Oscilando";
  const yMax = Math.max(10, ...series);
  const chartConfig = {
    value: {
      color: chartColor,
      label
    }
  } satisfies ChartConfig;

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

        <div className="mt-5 rounded-[8px] border border-white/10 bg-[#111217] p-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-semibold ${toneClassName}`}>
              {trendLabel}
            </span>
            <span className="text-[11px] font-semibold text-zinc-600">Tendencia</span>
          </div>
          <ChartContainer
            className="h-20 w-full"
            config={chartConfig}
            initialDimension={{ width: 320, height: 80 }}
          >
            <AreaChart data={chartData} margin={{ bottom: 0, left: 0, right: 4, top: 8 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.34} />
                  <stop offset="62%" stopColor={chartColor} stopOpacity={0.11} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartColor} strokeDasharray="4 6" strokeOpacity={0.12} vertical />
              <XAxis
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                dataKey="label"
                interval="preserveStartEnd"
                minTickGap={18}
                tick={{ fill: "rgba(161,161,170,0.68)", fontSize: 10 }}
                tickLine={false}
              />
              <YAxis
                domain={[0, Math.ceil(yMax * 1.15)]}
                hide
              />
              <Area
                activeDot={{ r: 4, stroke: chartColor, strokeWidth: 2 }}
                dataKey="value"
                dot={false}
                fill={`url(#${gradientId})`}
                stroke="var(--color-value)"
                strokeLinecap="round"
                strokeWidth={2.4}
                type="monotone"
              />
            </AreaChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
