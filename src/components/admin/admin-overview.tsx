"use client";

import { BookOpen, Clock3, KeyRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminDashboardData, AdminStudent, AdminStudentAccessLog, AdminStudentCourse } from "@/lib/platform-types";

// Estado vazio honesto (docs/17 §1.2, regra 2): sem dado real, mostramos "—"
// e uma legenda; nunca um valor fixo, uma linha de exemplo ou uma caixa de
// gráfico vazia.
const EMPTY_VALUE = "—";
const EMPTY_KPI_CAPTION = "Sem dados no período";
const EMPTY_LIST_MESSAGE = "Nenhum dado ainda";

const accessActionLabels: Record<AdminStudentAccessLog["action"], string> = {
  access_email_sent: "Recebeu o e-mail de acesso",
  lesson_completed: "Concluiu uma aula",
  lesson_started: "Iniciou uma aula",
  login: "Entrou na plataforma",
  material_downloaded: "Baixou um material"
};

function getAverageProgress(courses: AdminStudentCourse[]) {
  if (courses.length === 0) {
    return null;
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

function getTimestamp(value: string) {
  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatOccurredAt(value: string) {
  const timestamp = getTimestamp(value);

  if (timestamp === null) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(timestamp);
}

type StudentOverviewRow = {
  fullName: string;
  id: string;
  lastActivityAt: string;
  product: string;
  progress: number | null;
  status: AdminStudent["status"];
};

type ActivityOverviewRow = {
  action: AdminStudentAccessLog["action"];
  id: string;
  occurredAt: string;
  student: string;
};

export function AdminOverview({ data }: { data: AdminDashboardData }) {
  const allCourses = data.students.flatMap((student) => student.courses);
  const averageProgress = getAverageProgress(allCourses);
  const activeStudents = data.students.filter((student) => student.status === "active").length;
  // Acessos vêm das linhas de produto de cada aluno (tabela student_courses),
  // não do JSON legado de configurações, que nunca é gravado pelo app.
  const activeAccesses = allCourses.filter((course) => course.status === "active").length;
  const publishedProducts = data.contentRecords.filter((record) => record.status !== "Bloqueado").length;
  const studentRows: StudentOverviewRow[] = [...data.students]
    .sort((first, second) => (getAverageProgress(second.courses) ?? -1) - (getAverageProgress(first.courses) ?? -1))
    .slice(0, 5)
    .map((student) => ({
      fullName: student.fullName,
      id: student.id,
      lastActivityAt: student.lastActivityAt,
      product: student.courses[0]?.product ?? "Sem produto",
      progress: getAverageProgress(student.courses),
      status: student.status
    }));
  const recentActivity: ActivityOverviewRow[] = data.students
    .flatMap((student) =>
      (student.accessHistory ?? []).slice(0, 1).map((access) => ({
        action: access.action,
        id: access.id,
        occurredAt: access.occurredAt,
        student: student.fullName
      }))
    )
    .sort((first, second) => (getTimestamp(second.occurredAt) ?? 0) - (getTimestamp(first.occurredAt) ?? 0))
    .slice(0, 4);
  const productPerformance = data.sellableProducts
    .map((product) => {
      const relatedCourses = allCourses.filter(
        (course) => course.targetId === product.id || course.product === product.title
      );

      return {
        ...product,
        progress: getAverageProgress(relatedCourses),
        students: relatedCourses.length
      };
    })
    .sort((first, second) => second.students - first.students)
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] xl:items-start">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(145deg,rgba(24,24,27,0.96),rgba(8,8,10,0.98))] shadow-2xl shadow-black/30">
          <CardHeader className="gap-3">
            <CardTitle className="text-2xl font-semibold tracking-normal">Progresso médio dos alunos</CardTitle>
            <CardDescription>Média do progresso registrado nos produtos dos alunos.</CardDescription>
          </CardHeader>
          <CardContent>
            <div>
              <div className="text-4xl font-semibold tracking-normal text-foreground">
                {averageProgress === null ? EMPTY_VALUE : `${averageProgress}%`}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {averageProgress === null ? EMPTY_KPI_CAPTION : "progresso médio registrado"}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5">
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(145deg,rgba(24,24,27,0.98),rgba(8,8,10,0.99))] shadow-2xl shadow-black/30">
            <CardHeader className="gap-4">
              <div>
                <CardTitle className="text-2xl font-semibold tracking-normal">Painel do produtor</CardTitle>
                <CardDescription>Números atuais de alunos, acessos e conteúdos.</CardDescription>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <PremiumKpi icon={Users} label="Alunos ativos" value={activeStudents.toString()} />
                <PremiumKpi icon={KeyRound} label="Acessos ativos" value={activeAccesses.toString()} />
                <PremiumKpi icon={BookOpen} label="Conteúdos" value={publishedProducts.toString()} />
              </div>
            </CardHeader>
          </Card>

          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(145deg,rgba(24,24,27,0.98),rgba(8,8,10,0.99))] shadow-2xl shadow-black/30">
            <CardHeader>
              <CardTitle className="text-2xl font-semibold tracking-normal">Atividade recente</CardTitle>
              <CardDescription>Últimos registros de acesso dos alunos.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentActivity.length > 0 ? (
                <div className="grid gap-3">
                  {recentActivity.map((activity) => (
                    <div className="flex items-center gap-3 rounded-[10px] border border-white/10 bg-white/[0.03] p-3" key={activity.id}>
                      <div className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-white/10">
                        <Clock3 className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{activity.student}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {accessActionLabels[activity.action] ?? activity.action} - {formatOccurredAt(activity.occurredAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyListState />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card className="border-white/10 bg-card/95 shadow-xl shadow-black/20">
          <CardHeader>
            <CardTitle className="text-xl font-semibold tracking-normal">Produtos com mais alunos</CardTitle>
            <CardDescription>Alunos vinculados e progresso médio registrado em cada produto.</CardDescription>
          </CardHeader>
          <CardContent>
            {productPerformance.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
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
                            {product.students} {product.students === 1 ? "aluno vinculado" : "alunos vinculados"}
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
              </div>
            ) : (
              <EmptyListState />
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/95 shadow-xl shadow-black/20">
          <CardHeader>
            <CardTitle className="text-xl font-semibold tracking-normal">Alunos para acompanhar</CardTitle>
            <CardDescription>Os cinco alunos com maior progresso registrado e o produto principal de cada um.</CardDescription>
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
                  {studentRows.length > 0 ? (
                    studentRows.map((student) => (
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
                    ))
                  ) : (
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableCell className="h-24 text-center text-sm text-muted-foreground" colSpan={4}>
                        {EMPTY_LIST_MESSAGE}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
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

function EmptyListState() {
  return (
    <div className="rounded-[10px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-muted-foreground">
      {EMPTY_LIST_MESSAGE}
    </div>
  );
}

function ProgressLine({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{EMPTY_KPI_CAPTION}</span>
        <span className="w-10 text-right font-medium">{EMPTY_VALUE}</span>
      </div>
    );
  }

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
