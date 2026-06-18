"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpenCheck,
  BrainCircuit,
  Clock3,
  Crosshair,
  Gauge,
  GraduationCap,
  Layers3,
  LayoutGrid,
  LineChart,
  LockKeyhole,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Zap
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  AdminEntitlementStatus,
  AdminSellableProduct,
  AdminSourceProvider,
  AdminStudent,
  AdminStudentCourse
} from "@/lib/platform-types";

type StudentListMode = "students" | "courses";

export type StudentsCommandCenterProps = {
  courseFilter: string;
  listMode: StudentListMode;
  onCourseFilterChange: (value: string) => void;
  onCreateStudent: () => void;
  onListModeChange: (value: StudentListMode) => void;
  onOpenStudent: (studentId: string) => void;
  onQueryChange: (value: string) => void;
  onSourceFilterChange: (value: "all" | AdminSourceProvider) => void;
  onStatusFilterChange: (value: "all" | AdminEntitlementStatus) => void;
  query: string;
  selectedStudentId?: string;
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

const sourceAccent: Record<AdminSourceProvider, string> = {
  Hotmart: "bg-orange-400/15 text-orange-100 ring-orange-300/20",
  Kiwify: "bg-lime-400/15 text-lime-100 ring-lime-300/20",
  Manual: "bg-sky-400/15 text-sky-100 ring-sky-300/20",
  TikTok: "bg-fuchsia-400/15 text-fuchsia-100 ring-fuchsia-300/20",
  Ticto: "bg-indigo-400/15 text-indigo-100 ring-indigo-300/20"
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

function getStudentInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AL";
}

function getStatusClassName(status: AdminEntitlementStatus) {
  if (status === "active") {
    return "bg-emerald-400/12 text-emerald-100 ring-emerald-300/20";
  }

  if (status === "suspended") {
    return "bg-amber-400/14 text-amber-100 ring-amber-300/20";
  }

  if (status === "revoked") {
    return "bg-rose-500/14 text-rose-100 ring-rose-300/20";
  }

  return "bg-zinc-400/12 text-zinc-200 ring-zinc-300/20";
}

function getStudentPriority(student: AdminStudent) {
  const progress = getAverageProgress(student.courses);

  if (student.status !== "active") {
    return 0;
  }

  if ((student.accessCount ?? 0) === 0 || progress < 15) {
    return 1;
  }

  if (progress >= 75) {
    return 2;
  }

  return 3;
}

function hasNoFirstAccess(student: AdminStudent) {
  const firstAccess = (student.firstAccessAt ?? "").toLowerCase();

  return (student.accessCount ?? 0) === 0 || !firstAccess || firstAccess.includes("sem acesso");
}

function isAtRiskStudent(student: AdminStudent) {
  return student.status === "active" && (hasNoFirstAccess(student) || getAverageProgress(student.courses) < 20);
}

function isHighIntentStudent(student: AdminStudent) {
  return student.status === "active" && (getAverageProgress(student.courses) >= 75 || (student.accessCount ?? 0) >= 30);
}

function isExpansionOpportunity(student: AdminStudent) {
  return student.status === "active" && student.courses.length === 1 && getAverageProgress(student.courses) >= 60;
}

function getStudentHealthScore(student: AdminStudent) {
  if (student.status !== "active") {
    return 18;
  }

  const progressScore = getAverageProgress(student.courses) * 0.52;
  const accessScore = Math.min(30, (student.accessCount ?? 0) * 1.6);
  const productScore = Math.min(18, student.courses.length * 6);

  return clampPercent(progressScore + accessScore + productScore);
}

function getStudentStage(student: AdminStudent) {
  const progress = getAverageProgress(student.courses);

  if (student.status !== "active") {
    return "Acesso em revisao";
  }

  if (hasNoFirstAccess(student)) {
    return "Primeiro acesso";
  }

  if (progress >= 75) {
    return "Avancado";
  }

  if (progress >= 35) {
    return "Em progresso";
  }

  return "Onboarding";
}

function getNextBestAction(student: AdminStudent) {
  if (student.status !== "active") {
    return "Revisar entitlement antes de qualquer acao comercial.";
  }

  if (hasNoFirstAccess(student)) {
    return "Reenviar acesso e acompanhar o primeiro login.";
  }

  if (getAverageProgress(student.courses) < 20) {
    return "Acionar onboarding com recomendacao do primeiro modulo.";
  }

  if (isExpansionOpportunity(student)) {
    return "Mapear proxima formacao ou conteudo complementar.";
  }

  if (isHighIntentStudent(student)) {
    return "Priorizar relacionamento, depoimento ou oferta avancada.";
  }

  return "Manter acompanhamento semanal de progresso e atividade.";
}

function getAccessActionLabel(action: NonNullable<AdminStudent["accessHistory"]>[number]["action"]) {
  const labels = {
    access_email_sent: "Acesso enviado",
    lesson_completed: "Aula concluida",
    lesson_started: "Aula iniciada",
    login: "Login",
    material_downloaded: "Material baixado"
  } satisfies Record<NonNullable<AdminStudent["accessHistory"]>[number]["action"], string>;

  return labels[action];
}

function formatPercent(value: number) {
  return `${clampPercent(value)}%`;
}

function formatShare(value: number, total: number) {
  return `${total > 0 ? Math.round((value / total) * 100) : 0}% da base`;
}

function getProductSummary(product: AdminSellableProduct, students: AdminStudent[]) {
  const enrolledStudents = students.filter((student) =>
    student.courses.some((course) => course.targetId === product.id)
  );
  const courses = enrolledStudents.flatMap((student) =>
    student.courses.filter((course) => course.targetId === product.id)
  );
  const activeStudents = enrolledStudents.filter((student) =>
    student.status === "active" && student.courses.some((course) => course.targetId === product.id && course.status === "active")
  );
  const stalledStudents = enrolledStudents.filter((student) => {
    const productCourses = student.courses.filter((course) => course.targetId === product.id);

    return student.status === "active" && getAverageProgress(productCourses) < 20;
  });
  const highIntentStudents = enrolledStudents.filter((student) => {
    const productCourses = student.courses.filter((course) => course.targetId === product.id);

    return student.status === "active" && getAverageProgress(productCourses) >= 75;
  });

  return {
    activeStudents: activeStudents.length,
    averageProgress: getAverageProgress(courses),
    enrolledStudents: enrolledStudents.length,
    highIntentStudents: highIntentStudents.length,
    stalledStudents: stalledStudents.length,
    product
  };
}

function getSegmentToneClassName(tone: "amber" | "emerald" | "red" | "sky" | "zinc") {
  const tones = {
    amber: "border-amber-300/15 bg-amber-400/[0.07] text-amber-100",
    emerald: "border-emerald-300/15 bg-emerald-400/[0.07] text-emerald-100",
    red: "border-red-400/20 bg-red-500/[0.08] text-red-100",
    sky: "border-sky-300/15 bg-sky-400/[0.07] text-sky-100",
    zinc: "border-white/10 bg-white/[0.045] text-zinc-100"
  };

  return tones[tone];
}

export function StudentsCommandCenter({
  courseFilter,
  listMode,
  onCourseFilterChange,
  onCreateStudent,
  onListModeChange,
  onOpenStudent,
  onQueryChange,
  onSourceFilterChange,
  onStatusFilterChange,
  query,
  selectedStudentId,
  sellableProducts,
  sourceFilter,
  statusFilter,
  students
}: StudentsCommandCenterProps) {
  const metrics = React.useMemo(() => {
    const activeStudents = students.filter((student) => student.status === "active").length;
    const totalEnrollments = students.reduce((total, student) => total + student.courses.length, 0);
    const manualStudents = students.filter((student) => student.sourceProvider === "Manual").length;
    const averageProgress = getAverageProgress(students.flatMap((student) => student.courses));
    const attentionStudents = students.filter((student) => getStudentPriority(student) <= 1).length;

    return [
      {
        detail: `${manualStudents} manuais`,
        icon: Users,
        label: "Base CRM",
        value: students.length.toString()
      },
      {
        detail: `${students.length > 0 ? Math.round((activeStudents / students.length) * 100) : 0}% da base`,
        icon: ShieldCheck,
        label: "Com acesso ativo",
        value: activeStudents.toString()
      },
      {
        detail: `${totalEnrollments} matriculas`,
        icon: BookOpenCheck,
        label: "Progresso medio",
        value: formatPercent(averageProgress)
      },
      {
        detail: "Prioridade operacional",
        icon: Activity,
        label: "Acompanhar agora",
        value: attentionStudents.toString()
      }
    ];
  }, [students]);

  const intelligence = React.useMemo(() => {
    const activeStudents = students.filter((student) => student.status === "active");
    const atRiskStudents = students.filter(isAtRiskStudent);
    const highIntentStudents = students.filter(isHighIntentStudent);
    const onboardingStudents = students.filter((student) => student.status === "active" && hasNoFirstAccess(student));
    const expansionStudents = students.filter(isExpansionOpportunity);
    const accessReviewStudents = students.filter((student) => student.status !== "active");
    const withoutProductsStudents = students.filter((student) => student.courses.length === 0);

    return {
      activeStudents,
      atRiskStudents,
      expansionStudents,
      highIntentStudents,
      onboardingStudents,
      segments: [
        {
          detail: `${formatShare(atRiskStudents.length, students.length)} precisa de contato`,
          icon: AlertTriangle,
          label: "Risco de abandono",
          students: atRiskStudents,
          tone: "red" as const,
          value: atRiskStudents.length.toString()
        },
        {
          detail: `${formatShare(highIntentStudents.length, students.length)} com tracao`,
          icon: Zap,
          label: "Alta intencao",
          students: highIntentStudents,
          tone: "emerald" as const,
          value: highIntentStudents.length.toString()
        },
        {
          detail: `${formatShare(onboardingStudents.length, students.length)} sem primeiro ciclo`,
          icon: Clock3,
          label: "Onboarding",
          students: onboardingStudents,
          tone: "amber" as const,
          value: onboardingStudents.length.toString()
        },
        {
          detail: `${formatShare(expansionStudents.length, students.length)} prontos para proxima oferta`,
          icon: Target,
          label: "Expansao",
          students: expansionStudents,
          tone: "sky" as const,
          value: expansionStudents.length.toString()
        }
      ],
      strategicReads: [
        {
          detail: "Alunos ativos com baixo progresso ou sem primeiro acesso.",
          icon: Crosshair,
          label: "Fila de retencao",
          students: atRiskStudents,
          value: `${atRiskStudents.length} alunos`
        },
        {
          detail: "Base sem produto liberado ou com acesso fora do estado ativo.",
          icon: LockKeyhole,
          label: "Governanca de acesso",
          students: [...accessReviewStudents, ...withoutProductsStudents],
          value: `${accessReviewStudents.length + withoutProductsStudents.length} casos`
        },
        {
          detail: "Alunos de alta intencao com apenas uma compra ativa.",
          icon: BrainCircuit,
          label: "Leitura de receita",
          students: expansionStudents,
          value: `${expansionStudents.length} oportunidades`
        }
      ]
    };
  }, [students]);

  const funnelSteps = [
    { icon: Users, label: "Base", value: students.length },
    { icon: ShieldCheck, label: "Ativos", value: intelligence.activeStudents.length },
    { icon: Zap, label: "Alta intencao", value: intelligence.highIntentStudents.length },
    { icon: Target, label: "Expansao", value: intelligence.expansionStudents.length }
  ];

  const allProductSummaries = React.useMemo(
    () =>
      sellableProducts
        .map((product) => getProductSummary(product, students))
        .sort((first, second) => second.enrolledStudents - first.enrolledStudents),
    [sellableProducts, students]
  );

  const productSummaries = React.useMemo(() => allProductSummaries.slice(0, 4), [allProductSummaries]);

  const productSignals = React.useMemo(() => {
    const productWithTraction = [...allProductSummaries].sort((first, second) => second.activeStudents - first.activeStudents)[0];
    const productWithLowProgress = [...allProductSummaries]
      .filter((summary) => summary.enrolledStudents > 0)
      .sort((first, second) => first.averageProgress - second.averageProgress)[0];
    const productWithIntent = [...allProductSummaries].sort((first, second) => second.highIntentStudents - first.highIntentStudents)[0];

    return [
      {
        detail: productWithTraction
          ? `${productWithTraction.activeStudents} ativos em ${productWithTraction.product.kind}`
          : "Cadastre produtos para medir tracao",
        icon: LineChart,
        label: "Produto com maior tracao",
        value: productWithTraction?.product.title ?? "Sem dados"
      },
      {
        detail: productWithLowProgress
          ? `${productWithLowProgress.stalledStudents} alunos travados no inicio`
          : "Sem produto com matriculas ainda",
        icon: Radar,
        label: "Ponto de suporte",
        value: productWithLowProgress ? formatPercent(productWithLowProgress.averageProgress) : "0%"
      },
      {
        detail: productWithIntent
          ? `${productWithIntent.highIntentStudents} alunos avancados`
          : "Nenhuma turma avancada detectada",
        icon: Layers3,
        label: "Expansao por conteudo",
        value: productWithIntent?.product.title ?? "Sem dados"
      }
    ];
  }, [allProductSummaries]);

  const studentsToWatch = React.useMemo(
    () =>
      [...students]
        .sort((first, second) => {
          const priorityDelta = getStudentPriority(first) - getStudentPriority(second);

          if (priorityDelta !== 0) {
            return priorityDelta;
          }

          return getAverageProgress(second.courses) - getAverageProgress(first.courses);
        })
        .slice(0, 5),
    [students]
  );

  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null;
  const selectedStudentProgress = selectedStudent ? getAverageProgress(selectedStudent.courses) : 0;
  const selectedStudentJourney = selectedStudent?.accessHistory?.slice(0, 4) ?? [];
  const selectedStudentHealth = selectedStudent ? getStudentHealthScore(selectedStudent) : 0;

  return (
    <section className="overflow-hidden rounded-[8px] border border-white/10 bg-[#07080a] text-white shadow-2xl shadow-black/40">
      <div className="relative isolate border-b border-white/10 bg-[radial-gradient(circle_at_18%_0%,rgba(37,99,235,0.22),transparent_34%),radial-gradient(circle_at_82%_8%,rgba(220,38,38,0.18),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))] p-4 sm:p-5">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="h-6 rounded-[6px] bg-white/10 px-2.5 text-[11px] font-semibold uppercase tracking-normal text-zinc-200 ring-1 ring-white/15">
                <Sparkles className="size-3" />
                Alunos
              </Badge>
              <Badge className="h-6 rounded-[6px] bg-emerald-400/12 px-2.5 text-[11px] font-semibold text-emerald-100 ring-1 ring-emerald-300/20">
                Entitlements como verdade
              </Badge>
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-normal text-white sm:text-3xl">
                Command center de alunos
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                Base, acessos, progresso e sinais de acompanhamento para operar o relacionamento com alunos.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row xl:justify-end">
            <div className="flex rounded-[8px] border border-white/10 bg-black/35 p-1">
              <Button
                className={cn(
                  "h-9 rounded-[7px] px-3 text-sm",
                  listMode === "students"
                    ? "bg-white text-black hover:bg-zinc-200"
                    : "bg-transparent text-zinc-400 hover:bg-white/10 hover:text-white"
                )}
                onClick={() => onListModeChange("students")}
                type="button"
                variant="ghost"
              >
                <Users className="size-4" />
                Alunos
              </Button>
              <Button
                className={cn(
                  "h-9 rounded-[7px] px-3 text-sm",
                  listMode === "courses"
                    ? "bg-white text-black hover:bg-zinc-200"
                    : "bg-transparent text-zinc-400 hover:bg-white/10 hover:text-white"
                )}
                onClick={() => onListModeChange("courses")}
                type="button"
                variant="ghost"
              >
                <LayoutGrid className="size-4" />
                Cursos
              </Button>
            </div>
            <Button
              className="h-11 rounded-[8px] bg-red-600 px-4 text-sm font-semibold text-white shadow-lg shadow-red-950/30 hover:bg-red-500"
              onClick={onCreateStudent}
              type="button"
            >
              <UserPlus className="size-4" />
              Novo aluno
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;

            return (
              <Card className="rounded-[8px] border-white/10 bg-black/30 py-0 ring-0" key={metric.label}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{metric.label}</p>
                      <p className="mt-2 text-2xl font-semibold tracking-normal text-white">{metric.value}</p>
                      <p className="mt-1 truncate text-xs text-zinc-500">{metric.detail}</p>
                    </div>
                    <span className="grid size-10 shrink-0 place-items-center rounded-[8px] border border-white/10 bg-white/[0.055] text-zinc-200">
                      <Icon className="size-4" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <Card className="rounded-[8px] border-white/10 bg-[#101114] py-0 ring-0">
            <CardContent className="space-y-3 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <label className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                  <span className="sr-only">Buscar aluno</span>
                  <Input
                    className="h-11 rounded-[8px] border-white/10 bg-black/35 pl-9 text-sm text-white placeholder:text-zinc-600 focus-visible:border-white/25 focus-visible:ring-white/10"
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Buscar por nome, email, origem ou produto"
                    type="search"
                    value={query}
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[31rem]">
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

                  <FilterSelect label="Produto" onValueChange={onCourseFilterChange} value={courseFilter}>
                    <SelectItem value="all">Todos</SelectItem>
                    {sellableProducts.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.title}
                      </SelectItem>
                    ))}
                  </FilterSelect>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[8px] border-white/10 bg-[#101114] py-0 ring-0">
            <CardHeader className="border-b border-white/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
                    <BrainCircuit className="size-4 text-red-200" />
                    Inteligencia da base
                  </CardTitle>
                  <p className="mt-1 text-sm text-zinc-500">
                    Segmentos seguros para retencao, expansao e governanca de acesso.
                  </p>
                </div>
                <Badge className="w-fit rounded-[6px] bg-white/10 text-zinc-200 ring-1 ring-white/15">
                  {formatPercent(getAverageProgress(students.flatMap((student) => student.courses)))} progresso medio
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {intelligence.segments.map((segment) => {
                  const Icon = segment.icon;
                  const firstStudent = segment.students[0];

                  return (
                    <button
                      aria-label={`Abrir segmento ${segment.label}`}
                      className={cn(
                        "min-h-32 rounded-[8px] border p-3 text-left transition hover:border-white/25 hover:bg-white/[0.07]",
                        getSegmentToneClassName(segment.tone)
                      )}
                      disabled={!firstStudent}
                      key={segment.label}
                      onClick={() => {
                        if (firstStudent) {
                          onOpenStudent(firstStudent.id);
                        }
                      }}
                      type="button"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="grid size-9 place-items-center rounded-[7px] border border-current/15 bg-black/25">
                          <Icon className="size-4" />
                        </span>
                        <span className="text-2xl font-semibold tracking-normal text-white">{segment.value}</span>
                      </span>
                      <span className="mt-4 block text-sm font-semibold text-white">{segment.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-400">{segment.detail}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-[8px] border border-white/10 bg-black/25 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Funil da base</p>
                      <p className="mt-1 text-xs text-zinc-500">Da base cadastrada ate oportunidades de expansao.</p>
                    </div>
                    <Gauge className="size-4 text-zinc-500" />
                  </div>
                  <div className="space-y-3">
                    {funnelSteps.map((step) => {
                      const Icon = step.icon;
                      const stepWidth = students.length > 0 ? Math.round((step.value / students.length) * 100) : 0;

                      return (
                        <div className="space-y-1.5" key={step.label}>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-zinc-400">
                              <Icon className="size-3.5 shrink-0" />
                              <span className="truncate">{step.label}</span>
                            </span>
                            <span className="font-semibold text-zinc-200">{step.value}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-red-500 via-orange-300 to-emerald-300"
                              style={{ width: `${step.value > 0 ? Math.max(8, stepWidth) : 0}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-[8px] border border-white/10 bg-black/25 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Leituras estrategicas</p>
                      <p className="mt-1 text-xs text-zinc-500">Sinais de negocio sem expor documento, telefone ou pedidos externos.</p>
                    </div>
                    <Radar className="size-4 text-zinc-500" />
                  </div>
                  <div className="space-y-2">
                    {intelligence.strategicReads.map((read) => {
                      const Icon = read.icon;
                      const firstStudent = read.students[0];

                      return (
                        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[8px] border border-white/10 bg-white/[0.035] p-3" key={read.label}>
                          <span className="grid size-9 place-items-center rounded-[7px] bg-white/[0.055] text-zinc-300">
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-white">{read.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-zinc-500">{read.detail}</span>
                          </span>
                          <button
                            className="rounded-[7px] border border-white/10 bg-white/[0.055] px-2.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!firstStudent}
                            onClick={() => {
                              if (firstStudent) {
                                onOpenStudent(firstStudent.id);
                              }
                            }}
                            type="button"
                          >
                            {read.value}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-3">
            {productSignals.map((signal) => {
              const Icon = signal.icon;

              return (
                <Card className="rounded-[8px] border-white/10 bg-[#101114] py-0 ring-0" key={signal.label}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{signal.label}</p>
                        <p className="mt-2 truncate text-sm font-semibold text-white">{signal.value}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{signal.detail}</p>
                      </div>
                      <span className="grid size-9 shrink-0 place-items-center rounded-[8px] border border-white/10 bg-white/[0.055] text-zinc-300">
                        <Icon className="size-4" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {productSummaries.length > 0 ? (
              productSummaries.map((summary) => (
                <Card
                  className="group rounded-[8px] border-white/10 bg-[#101114] py-0 ring-0 transition hover:border-white/20"
                  key={summary.product.id}
                >
                  <CardContent className="grid grid-cols-[5.25rem_1fr] gap-3 p-3">
                    <div
                      className="relative min-h-28 overflow-hidden rounded-[8px] border border-white/10 bg-zinc-900 bg-cover bg-center"
                      style={{ backgroundImage: `url(${summary.product.image})` }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                      <div className="absolute bottom-2 left-2 rounded-[6px] bg-black/65 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
                        {formatPercent(summary.averageProgress)}
                      </div>
                    </div>
                    <div className="min-w-0 py-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{summary.product.title}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {summary.activeStudents} ativos / {summary.enrolledStudents} alunos
                          </p>
                        </div>
                        <GraduationCap className="mt-0.5 size-4 shrink-0 text-zinc-500 transition group-hover:text-zinc-300" />
                      </div>
                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-400 via-emerald-300 to-lime-300"
                          style={{ width: `${summary.averageProgress}%` }}
                        />
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                        <span>Progresso medio</span>
                        <span>{summary.product.kind}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="rounded-[8px] border-dashed border-white/10 bg-[#101114] py-0 ring-0 lg:col-span-2">
                <CardContent className="flex min-h-36 items-center justify-center p-6 text-center text-sm text-zinc-500">
                  Cadastre produtos vendaveis para acompanhar matriculas e progresso por oferta.
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <Card className="rounded-[8px] border-white/10 bg-[#101114] py-0 ring-0">
          <CardHeader className="border-b border-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
                  <Radar className="size-4 text-red-200" />
                  Fila operacional
                </CardTitle>
                <p className="mt-1 text-sm text-zinc-500">Prioridade, jornada e proxima melhor acao.</p>
              </div>
              <Badge className="rounded-[6px] bg-white/10 text-zinc-200 ring-1 ring-white/15">
                {studentsToWatch.length} itens
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-2">
            {studentsToWatch.length > 0 ? (
              <div className="space-y-1">
                {studentsToWatch.map((student) => {
                  const progress = getAverageProgress(student.courses);
                  const isSelected = selectedStudent?.id === student.id;
                  const healthScore = getStudentHealthScore(student);

                  return (
                    <button
                      className={cn(
                        "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[8px] p-2.5 text-left transition",
                        isSelected ? "bg-white/10" : "hover:bg-white/[0.055]"
                      )}
                      key={student.id}
                      onClick={() => onOpenStudent(student.id)}
                      type="button"
                    >
                      <Avatar className="size-10 border border-white/10">
                        {student.avatarUrl ? <AvatarImage alt="" src={student.avatarUrl} /> : null}
                        <AvatarFallback className="bg-zinc-800 text-xs font-semibold text-zinc-200">
                          {getStudentInitials(student.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">{student.fullName}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge className={cn("rounded-[6px] px-1.5 text-[11px] ring-1", getStatusClassName(student.status))}>
                            {statusLabels[student.status]}
                          </Badge>
                          <Badge className={cn("rounded-[6px] px-1.5 text-[11px] ring-1", sourceAccent[student.sourceProvider])}>
                            {student.sourceProvider}
                          </Badge>
                          <Badge className="rounded-[6px] bg-white/10 px-1.5 text-[11px] text-zinc-200 ring-1 ring-white/15">
                            {getStudentStage(student)}
                          </Badge>
                        </span>
                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10">
                          <span
                            className={cn(
                              "block h-full rounded-full",
                              healthScore < 35
                                ? "bg-red-400"
                                : healthScore < 70
                                  ? "bg-amber-300"
                                  : "bg-emerald-300"
                            )}
                            style={{ width: `${healthScore}%` }}
                          />
                        </span>
                      </span>
                      <span className="grid justify-items-end gap-1">
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-white">
                          {formatPercent(progress)}
                          <ArrowUpRight className="size-3 text-zinc-500" />
                        </span>
                        <span className="whitespace-nowrap text-[11px] font-medium text-zinc-500">
                          Saude {healthScore}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-52 items-center justify-center rounded-[8px] border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
                Nenhum aluno disponivel para acompanhamento.
              </div>
            )}

            {selectedStudent ? (
              <div className="mt-2 rounded-[8px] border border-white/10 bg-black/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{selectedStudent.fullName}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {getStudentStage(selectedStudent)} · {selectedStudent.courses.length} produtos liberados
                    </p>
                  </div>
                  <Button
                    className="h-8 rounded-[7px] border-white/10 bg-white/10 text-zinc-100 hover:bg-white/15"
                    onClick={() => onOpenStudent(selectedStudent.id)}
                    type="button"
                    variant="outline"
                  >
                    Abrir
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniSignal icon={Gauge} label="Saude" value={selectedStudentHealth.toString()} />
                  <MiniSignal icon={TrendingUp} label="Progresso" value={formatPercent(selectedStudentProgress)} />
                  <MiniSignal icon={UserCheck} label="Acessos" value={(selectedStudent.accessCount ?? 0).toString()} />
                </div>

                <div className="mt-3 rounded-[8px] border border-white/10 bg-white/[0.035] p-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-red-200" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Proxima melhor acao</p>
                      <p className="mt-1 text-sm leading-5 text-zinc-200">{getNextBestAction(selectedStudent)}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <MiniSignal icon={Clock3} label="Primeiro acesso" value={selectedStudent.firstAccessAt ?? "Sem acesso"} />
                  <MiniSignal icon={Activity} label="Ultima atividade" value={selectedStudent.lastActivityAt} />
                </div>

                <div className="mt-3 rounded-[8px] border border-white/10 bg-white/[0.025] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">Jornada recente</p>
                    <Badge className="rounded-[6px] bg-white/10 text-[11px] text-zinc-300 ring-1 ring-white/15">
                      Dados seguros
                    </Badge>
                  </div>
                  {selectedStudentJourney.length > 0 ? (
                    <div className="space-y-2">
                      {selectedStudentJourney.map((event) => (
                        <div className="grid grid-cols-[auto_1fr] gap-2" key={event.id}>
                          <span className="mt-1 size-2 rounded-full bg-red-300" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-zinc-200">
                              {getAccessActionLabel(event.action)}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                              {event.occurredAt} · {event.device}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-[7px] border border-dashed border-white/10 p-3 text-xs leading-5 text-zinc-500">
                      Sem eventos recentes. Use as acoes do perfil para preparar acesso ou registrar acompanhamento.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
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

function MiniSignal({
  icon: Icon,
  label,
  value
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-[8px] border border-white/10 bg-white/[0.035] p-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
        <Icon className="size-3" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
