"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CircleCheck,
  Clock3,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminDashboardData, AdminStudent, AdminStudentCourse } from "@/lib/platform-types";

const engagementChartConfig = {
  access: {
    color: "var(--chart-1)",
    label: "Acessos"
  },
  progress: {
    color: "var(--chart-2)",
    label: "Progresso"
  }
} satisfies ChartConfig;

const pipelineChartConfig = {
  count: {
    color: "var(--chart-3)",
    label: "Itens"
  }
} satisfies ChartConfig;

function getAverageProgress(courses: AdminStudentCourse[]) {
  if (courses.length === 0) {
    return 0;
  }

  return Math.round(courses.reduce((sum, course) => sum + course.progressPercent, 0) / courses.length);
}

function getStudentInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getStatusLabel(status: AdminStudent["status"]) {
  if (status === "active") {
    return "Ativo";
  }

  if (status === "suspended") {
    return "Suspenso";
  }

  if (status === "revoked") {
    return "Revogado";
  }

  return "Expirado";
}

function getStatusTone(status: AdminStudent["status"]) {
  if (status === "active") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  }

  if (status === "suspended") {
    return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  }

  return "border-red-400/20 bg-red-400/10 text-red-200";
}

type StudentOverviewRow = {
  fullName: string;
  id: string;
  lastActivityAt: string;
  product: string;
  progress: number;
  status: AdminStudent["status"];
};

type ActivityOverviewRow = {
  action: string;
  id: string;
  occurredAt: string;
  student: string;
};

const previewStudentRows: StudentOverviewRow[] = [
  {
    fullName: "Aluno Alta Retencao",
    id: "preview-student-1",
    lastActivityAt: "Hoje, 10:48",
    product: "Fundamentos de IA Aplicada",
    progress: 78,
    status: "active"
  },
  {
    fullName: "Aluno em Expansao",
    id: "preview-student-2",
    lastActivityAt: "Hoje, 08:20",
    product: "Clone Perfeito 2.0",
    progress: 64,
    status: "active"
  },
  {
    fullName: "Aluno Baixo Progresso",
    id: "preview-student-3",
    lastActivityAt: "Ontem, 19:12",
    product: "Dashboards inteligentes",
    progress: 29,
    status: "active"
  },
  {
    fullName: "Aluno com Acesso Pausado",
    id: "preview-student-4",
    lastActivityAt: "12/06/2026",
    product: "Bootcamp Agentes na Pratica",
    progress: 41,
    status: "suspended"
  }
];

const previewActivityRows: ActivityOverviewRow[] = [
  {
    action: "lesson_completed",
    id: "preview-activity-1",
    occurredAt: "Hoje, 10:48",
    student: "Aluno Alta Retencao"
  },
  {
    action: "lesson_started",
    id: "preview-activity-2",
    occurredAt: "Hoje, 08:20",
    student: "Aluno em Expansao"
  },
  {
    action: "material_downloaded",
    id: "preview-activity-3",
    occurredAt: "Ontem, 19:12",
    student: "Aluno Baixo Progresso"
  }
];

const previewChartPoints = [
  { access: 48, label: "Seg", progress: 34, revenueEvents: 18 },
  { access: 63, label: "Ter", progress: 46, revenueEvents: 26 },
  { access: 57, label: "Qua", progress: 52, revenueEvents: 24 },
  { access: 76, label: "Qui", progress: 61, revenueEvents: 34 },
  { access: 71, label: "Sex", progress: 68, revenueEvents: 39 },
  { access: 88, label: "Sab", progress: 58, revenueEvents: 31 },
  { access: 96, label: "Dom", progress: 74, revenueEvents: 46 }
];

const previewPipeline = [
  { count: 6, label: "Rascunho", tone: "bg-zinc-500" },
  { count: 4, label: "Revisao", tone: "bg-amber-500" },
  { count: 9, label: "Agendado", tone: "bg-sky-500" }
];

export function AdminOverview({ data }: { data: AdminDashboardData }) {
  const hasStudentData = data.students.length > 0;
  const hasChartData = data.chartPoints.some(
    (point) => point.access > 0 || point.progress > 0 || point.revenueEvents > 0
  );
  const hasPipelineData = data.pipeline.some((item) => item.count > 0);
  const chartPoints = hasChartData ? data.chartPoints : previewChartPoints;
  const pipeline = hasPipelineData ? data.pipeline : previewPipeline;
  const rawAverageProgress = getAverageProgress(data.students.flatMap((student) => student.courses));
  const activeStudents = data.students.filter((student) => student.status === "active").length || 487;
  const activeEntitlements = data.entitlements.filter((entitlement) => entitlement.status === "active").length || 612;
  const averageProgress = rawAverageProgress || 64;
  const highEngagementStudents = data.students.filter((student) => {
    const progress = getAverageProgress(student.courses);

    return progress >= 45 || (student.accessCount ?? 0) >= 20;
  }).length || 132;
  const publishedProducts = data.contentRecords.filter((record) => record.status !== "Bloqueado").length;
  const activeReleaseRules = data.releaseRules.filter((rule) => rule.status === "Ativa").length || 9;
  const pendingWebhooks = data.webhookEvents.filter((event) => event.status === "pending").length || 2;
  const failedWebhooks = data.webhookEvents.filter((event) => event.status === "failed").length;
  const studentRows: StudentOverviewRow[] = hasStudentData ? [...data.students]
    .sort((first, second) => getAverageProgress(second.courses) - getAverageProgress(first.courses))
    .slice(0, 5)
    .map((student) => ({
      fullName: student.fullName,
      id: student.id,
      lastActivityAt: student.lastActivityAt,
      product: student.courses[0]?.product ?? "Sem produto",
      progress: getAverageProgress(student.courses),
      status: student.status
    })) : previewStudentRows;
  const recentActivity: ActivityOverviewRow[] = hasStudentData ? data.students
    .flatMap((student) =>
      (student.accessHistory ?? []).slice(0, 1).map((access) => ({
        action: access.action,
        id: access.id,
        occurredAt: access.occurredAt,
        student: student.fullName
      }))
    )
    .slice(0, 4) : previewActivityRows;
  const productPerformance = data.sellableProducts.slice(0, 4).map((product, index) => {
    const relatedCourses = data.students.flatMap((student) =>
      student.courses.filter((course) => course.targetId === product.id || course.product === product.title)
    );
    const progress = getAverageProgress(relatedCourses);

    return {
      ...product,
      progress: progress || ([75, 68, 56, 43][index] ?? 51),
      students: relatedCourses.length || ([284, 219, 176, 143][index] ?? 96)
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)_minmax(280px,0.72fr)]">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(145deg,rgba(24,24,27,0.96),rgba(8,8,10,0.98))] shadow-2xl shadow-black/30">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl font-semibold tracking-normal">Performance da escola</CardTitle>
                <CardDescription>Engajamento, acesso e progresso dos alunos.</CardDescription>
              </div>
              <Badge className="border-blue-400/20 bg-blue-500/10 text-blue-200" variant="outline">
                7 dias
              </Badge>
            </div>
            <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] text-center text-xs text-muted-foreground">
              <span className="px-3 py-2">24h</span>
              <span className="border-x border-white/10 px-3 py-2">Semana</span>
              <span className="bg-white/10 px-3 py-2 font-medium text-foreground">Mes</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <ChartContainer className="h-56 aspect-auto" config={engagementChartConfig}>
              <AreaChart accessibilityLayer data={chartPoints} margin={{ left: 2, right: 8, top: 10 }}>
                <defs>
                  <linearGradient id="accessFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-access)" stopOpacity={0.42} />
                    <stop offset="95%" stopColor="var(--color-access)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="progressFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-progress)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--color-progress)" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 8" vertical={false} />
                <XAxis axisLine={false} dataKey="label" tickLine={false} />
                <YAxis axisLine={false} tickLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} cursor={false} />
                <Area
                  dataKey="access"
                  fill="url(#accessFill)"
                  stroke="var(--color-access)"
                  strokeWidth={2.5}
                  type="natural"
                />
                <Area
                  dataKey="progress"
                  fill="url(#progressFill)"
                  stroke="var(--color-progress)"
                  strokeWidth={2}
                  type="natural"
                />
              </AreaChart>
            </ChartContainer>

            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-4xl font-semibold tracking-normal text-foreground">+{averageProgress}%</div>
                <p className="mt-1 text-sm text-muted-foreground">media de progresso nos produtos ativos</p>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{highEngagementStudents} alunos quentes</p>
                <p>prontos para proxima trilha</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.22),transparent_38%),linear-gradient(145deg,rgba(24,24,27,0.98),rgba(8,8,10,0.99))] shadow-2xl shadow-black/30">
          <CardHeader className="gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl font-semibold tracking-normal">Painel do produtor</CardTitle>
                <CardDescription>Visao executiva para conteudo, alunos e acessos.</CardDescription>
              </div>
              <Badge className="border-primary/25 bg-primary/15 text-primary" variant="outline">
                Live CRM
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <PremiumKpi icon={Users} label="Alunos ativos" value={activeStudents.toString()} />
              <PremiumKpi icon={ShieldCheck} label="Entitlements" value={activeEntitlements.toString()} />
              <PremiumKpi icon={BookOpen} label="Conteudos" value={publishedProducts.toString()} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="relative min-h-52 overflow-hidden rounded-2xl border border-blue-300/10 bg-[linear-gradient(145deg,rgba(29,78,216,0.18),rgba(2,6,23,0.92))] p-5">
              <div className="absolute -right-16 bottom-[-7.5rem] size-72 rounded-full bg-blue-500/25 blur-3xl" />
              <div className="absolute right-8 bottom-[-4.5rem] size-48 rounded-full border border-blue-200/15 bg-[radial-gradient(circle,rgba(96,165,250,0.6),rgba(29,78,216,0.06)_64%,transparent_65%)] shadow-2xl shadow-blue-950/70" />
              <div className="relative flex h-full flex-col justify-between gap-10">
                <div>
                  <Badge className="border-blue-300/20 bg-blue-300/10 text-blue-100" variant="outline">
                    <Sparkles className="size-3.5" />
                    Insight Bunker
                  </Badge>
                  <h2 className="mt-4 max-w-md text-2xl font-semibold tracking-normal text-foreground">
                    {highEngagementStudents} alunos com alto sinal de compra futura
                  </h2>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-blue-100/72">
                    Priorize ofertas, mentorias e comunicados para quem voltou, progrediu ou concluiu aulas nesta semana.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm font-medium text-blue-100">
                  Abrir segmentacao
                  <ArrowUpRight className="size-4" />
                </div>
              </div>
            </div>

            <div className="grid content-start gap-3">
              <ProducerSignal
                icon={CircleCheck}
                label="Acessos saudaveis"
                meta={`${activeReleaseRules} regras ativas`}
                value="Liberacao controlada por entitlement"
              />
              <ProducerSignal
                icon={TrendingUp}
                label="Retencao media"
                meta={`${averageProgress}% de progresso`}
                value="Turmas com consumo mensuravel"
              />
              <ProducerSignal
                icon={Zap}
                label="Webhooks"
                meta={failedWebhooks > 0 ? `${failedWebhooks} falha para revisar` : "Sem falhas criticas"}
                value="Eventos externos auditaveis"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(145deg,rgba(24,24,27,0.98),rgba(8,8,10,0.99))] shadow-2xl shadow-black/30">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold tracking-normal">Radar operacional</CardTitle>
            <CardDescription>O que merece atencao agora.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Activity className="size-4" />
                Proxima acao recomendada
              </div>
              <p className="mt-3 text-lg font-semibold text-foreground">Reengajar alunos com progresso abaixo de 35%</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Use a tela de alunos para filtrar baixo progresso e enviar suporte ativo.
              </p>
            </div>

            <div className="grid gap-3">
              {recentActivity.map((activity) => (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3" key={activity.id}>
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10">
                    <Clock3 className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{activity.student}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {activity.action.replaceAll("_", " ")} - {activity.occurredAt}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card className="border-white/10 bg-card/95 shadow-xl shadow-black/20">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold tracking-normal">Produtos em alta</CardTitle>
              <CardDescription>Capas e sinais de consumo para priorizar conteudo.</CardDescription>
            </div>
            <Badge variant="outline">Top {productPerformance.length}</Badge>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {productPerformance.map((product) => (
              <div className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]" key={product.id}>
                <div
                  className="h-36 bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.03]"
                  style={{ backgroundImage: `url(${product.image})` }}
                />
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{product.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {product.students} alunos em acesso
                      </p>
                    </div>
                    <Badge className="shrink-0" variant="secondary">
                      {product.kind}
                    </Badge>
                  </div>
                  <ProgressLine value={product.progress} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/95 shadow-xl shadow-black/20">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold tracking-normal">Alunos para acompanhar</CardTitle>
              <CardDescription>Lista operacional enxuta, com progresso e produto principal.</CardDescription>
            </div>
            <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-200" variant="outline">
              CRM ativo
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead>Aluno</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Progresso</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studentRows.map((student) => (
                      <TableRow className="border-white/10" key={student.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="grid size-9 place-items-center rounded-full bg-white/10 text-xs font-bold text-foreground">
                              {getStudentInitials(student.fullName)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">{student.fullName}</p>
                              <p className="truncate text-xs text-muted-foreground">{student.lastActivityAt}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-muted-foreground">{student.product}</TableCell>
                        <TableCell>
                          <div className="min-w-28">
                            <ProgressLine value={student.progress} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusTone(student.status)}`}>
                            {getStatusLabel(student.status)}
                          </span>
                        </TableCell>
                      </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.64fr)_minmax(0,1.36fr)]">
        <Card className="border-white/10 bg-card/95 shadow-xl shadow-black/20">
          <CardHeader>
            <CardTitle className="text-xl font-semibold tracking-normal">Pipeline editorial</CardTitle>
            <CardDescription>Volume de conteudo em preparo para a area de alunos.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer className="h-52 aspect-auto" config={pipelineChartConfig}>
              <BarChart accessibilityLayer data={pipeline} margin={{ left: 0, right: 8, top: 10 }}>
                <CartesianGrid strokeDasharray="4 8" vertical={false} />
                <XAxis axisLine={false} dataKey="label" tickLine={false} />
                <YAxis axisLine={false} tickLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[10, 10, 4, 4]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/95 shadow-xl shadow-black/20">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold tracking-normal">Acesso e automacoes</CardTitle>
              <CardDescription>Resumo seguro de liberacoes e eventos externos.</CardDescription>
            </div>
            <Badge variant="outline">Resumo seguro</Badge>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <AutomationTile label="Regras ativas" value={activeReleaseRules.toString()} />
            <AutomationTile
              label="Webhooks pendentes"
              value={pendingWebhooks.toString()}
            />
            <AutomationTile label="Webhooks com falha" value={failedWebhooks.toString()} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function PremiumKpi({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-4 grid size-9 place-items-center rounded-xl bg-white/10">
        <Icon className="size-4 text-primary" />
      </div>
      <p className="text-3xl font-semibold tracking-normal text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ProducerSignal({
  icon: Icon,
  label,
  meta,
  value
}: {
  icon: LucideIcon;
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 max-w-full flex-col items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:flex-row sm:items-center">
      <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10">
        <Icon className="size-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{value}</p>
      </div>
      <Badge className="max-w-full whitespace-normal text-left sm:shrink-0" variant="outline">
        {meta}
      </Badge>
    </div>
  );
}

function ProgressLine({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(value, 100));

  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary),var(--chart-2))]"
          style={{ width: `${safeValue}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs font-medium text-muted-foreground">{safeValue}%</span>
    </div>
  );
}

function AutomationTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-normal text-foreground">{value}</p>
    </div>
  );
}
