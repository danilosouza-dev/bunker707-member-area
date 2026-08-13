"use client";

import * as React from "react";
import {
  Activity,
  Bot,
  BrainCircuit,
  Cable,
  CalendarDays,
  GraduationCap,
  MessageSquareText,
  Search,
  Sparkles,
  UserRound,
  Users
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export type AIAgentType = "lesson_tutor" | "platform_guide";

export type AIUsageSummary = {
  byAgent: Array<{
    activeStudents: number;
    agentType: AIAgentType;
    answers: number;
    conversations: number;
    inputTokens: number;
    lessons: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  byConnection: Array<{
    answers: number;
    authMode: "account_gateway" | "api_key" | null;
    connectionId: string | null;
    inputTokens: number;
    label: string;
    outputTokens: number;
    provider: string;
    totalTokens: number;
  }>;
  byDay: Array<{
    activeStudents: number;
    answers: number;
    date: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  byLesson: Array<{
    activeStudents: number;
    answers: number;
    conversations: number;
    inputTokens: number;
    lessonId: string | null;
    lessonTitle: string;
    outputTokens: number;
    totalTokens: number;
  }>;
  byProvider: Array<{
    activeStudents: number;
    answers: number;
    inputTokens: number;
    model: string;
    outputTokens: number;
    provider: string;
    totalTokens: number;
  }>;
  byStudent: Array<{
    activeDays: number;
    answers: number;
    avatarUrl: string | null;
    conversations: number;
    email: string | null;
    fullName: string;
    inputTokens: number;
    lastActivityAt: string;
    lessonTutorAnswers: number;
    lessons: number;
    outputTokens: number;
    platformGuideAnswers: number;
    totalTokens: number;
    userId: string;
  }>;
  days: number;
  from: string;
  generatedAt?: string;
  totals: {
    activeStudents: number;
    answers: number;
    conversations: number;
    failures: number;
    inputTokens: number;
    lessons: number;
    outputTokens: number;
    totalTokens: number;
  };
};

type StudentUsage = AIUsageSummary["byStudent"][number];

const numberFormatter = new Intl.NumberFormat("pt-BR");
const compactFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
  notation: "compact"
});

function formatNumber(value: number) {
  return numberFormatter.format(Number(value) || 0);
}

function formatCompact(value: number) {
  return compactFormatter.format(Number(value) || 0);
}

function formatDate(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase() || "A";
}

export function AIUsageDashboard({
  days,
  loading,
  onDaysChange,
  summary
}: {
  days: number;
  loading: boolean;
  onDaysChange: (days: number) => void;
  summary: AIUsageSummary | null;
}) {
  if (loading && !summary) {
    return <div className="grid min-h-56 place-items-center text-sm text-zinc-500">Carregando consumo de IA...</div>;
  }

  if (!summary) {
    return <div className="grid min-h-56 place-items-center text-sm text-zinc-500">O consumo ainda não está disponível.</div>;
  }

  return (
    <UsageDashboardContent
      days={Number.isInteger(summary.days) ? summary.days : days}
      loading={loading}
      onDaysChange={onDaysChange}
      summary={summary}
    />
  );
}

function UsageDashboardContent({
  days,
  loading,
  onDaysChange,
  summary
}: {
  days: number;
  loading: boolean;
  onDaysChange: (days: number) => void;
  summary: AIUsageSummary;
}) {
  const [studentSearch, setStudentSearch] = React.useState("");
  const students = React.useMemo(() => summary.byStudent ?? [], [summary.byStudent]);
  const normalizedSearch = studentSearch.trim().toLocaleLowerCase("pt-BR");
  const filteredStudents = React.useMemo(() => {
    if (!normalizedSearch) return students;

    return students.filter((student) => (
      `${student.fullName} ${student.email ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
    ));
  }, [normalizedSearch, students]);
  const visibleStudents = filteredStudents.slice(0, 100);
  const rankByUserId = React.useMemo(
    () => new Map(students.map((student, index) => [student.userId, index + 1])),
    [students]
  );
  const maxDailyTokens = Math.max(1, ...summary.byDay.map((item) => item.totalTokens));
  const metrics = [
    {
      detail: `${formatNumber(summary.totals.inputTokens)} entrada · ${formatNumber(summary.totals.outputTokens)} saída`,
      icon: Activity,
      label: "Tokens totais",
      value: formatCompact(summary.totals.totalTokens)
    },
    {
      detail: `${formatNumber(summary.totals.conversations)} chats no período`,
      icon: MessageSquareText,
      label: "Respostas",
      value: formatNumber(summary.totals.answers)
    },
    {
      detail: `em ${formatNumber(summary.totals.lessons)} aulas`,
      icon: Users,
      label: "Alunos ativos",
      value: formatNumber(summary.totals.activeStudents)
    },
    {
      detail: "tentativas sem resposta concluída",
      icon: Bot,
      label: "Falhas",
      value: formatNumber(summary.totals.failures)
    }
  ];

  return (
    <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">Consumo de inteligência artificial</p>
            {loading ? <span className="size-1.5 animate-pulse rounded-full bg-[var(--accent)]" /> : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Uso real por agente, aula, aluno, modelo e conexão do Bunker AI LB.
          </p>
        </div>
        <div aria-label="Período do relatório" className="flex rounded-[8px] border border-white/10 bg-black/20 p-1">
          {[7, 30, 90].map((value) => (
            <button
              aria-pressed={days === value}
              className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition ${days === value ? "bg-white text-black" : "text-zinc-500 hover:text-zinc-200"}`}
              disabled={loading}
              key={value}
              onClick={() => onDaysChange(value)}
              type="button"
            >
              {value} dias
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card className="rounded-[8px] border-white/[0.08] bg-black/15 py-0" key={metric.label}>
            <CardContent className="p-4">
              <span className="grid size-8 place-items-center rounded-[7px] bg-white/[0.055] text-zinc-400">
                <metric.icon className="size-4" />
              </span>
              <p className="mt-4 text-2xl font-semibold tracking-tight text-white">{metric.value}</p>
              <p className="mt-1 text-xs font-semibold text-zinc-400">{metric.label}</p>
              <p className="mt-1 text-[11px] text-zinc-600">{metric.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AgentUsageOverview agents={summary.byAgent ?? []} />

      <div className="rounded-[8px] border border-white/[0.08] bg-black/15 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-zinc-500" />
            <p className="text-xs font-semibold text-zinc-300">Consumo por dia</p>
          </div>
          <span className="text-[11px] text-zinc-600">Entrada + saída</span>
        </div>
        {summary.byDay.length ? (
          <>
            <div className="mt-5 flex h-32 items-end gap-1.5 overflow-hidden">
              {summary.byDay.map((day) => (
                <div
                  aria-label={`${formatDate(day.date)}: ${formatNumber(day.totalTokens)} tokens, ${formatNumber(day.answers)} respostas`}
                  className="group flex min-w-0 flex-1 flex-col items-center justify-end"
                  key={day.date}
                >
                  <div
                    className="w-full min-w-1 rounded-t-[3px] bg-[var(--accent)]/50 transition group-hover:bg-[var(--accent)]"
                    style={{ height: `${Math.max(4, (day.totalTokens / maxDailyTokens) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
              <span>{formatDate(summary.byDay[0].date)}</span>
              <span>{formatDate(summary.byDay[summary.byDay.length - 1].date)}</span>
            </div>
          </>
        ) : <p className="mt-5 text-xs text-zinc-600">Ainda não houve respostas neste período.</p>}
      </div>

      <StudentUsageRanking
        filteredCount={filteredStudents.length}
        onSearchChange={setStudentSearch}
        rankByUserId={rankByUserId}
        search={studentSearch}
        students={visibleStudents}
        totalCount={students.length}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <LessonUsage lessons={summary.byLesson ?? []} />

        <div className="space-y-4">
          <UsageBreakdown
            icon={BrainCircuit}
            items={(summary.byProvider ?? []).map((item) => ({
              detail: `${item.provider} · ${formatNumber(item.answers)} respostas · ${formatNumber(item.activeStudents)} alunos`,
              label: item.model,
              value: formatCompact(item.totalTokens)
            }))}
            title="Por provedor e modelo"
          />
          <UsageBreakdown
            icon={Cable}
            items={(summary.byConnection ?? []).map((item) => ({
              detail: `${item.provider} · ${item.authMode === "account_gateway" ? "Conta" : item.authMode === "api_key" ? "API" : "Conexão removida"} · ${formatNumber(item.answers)} respostas`,
              label: item.label,
              value: formatCompact(item.totalTokens)
            }))}
            title="Por conexão"
          />
        </div>
      </div>
    </div>
  );
}

function AgentUsageOverview({ agents }: { agents: AIUsageSummary["byAgent"] }) {
  const agentCards: Array<{
    description: string;
    icon: typeof GraduationCap;
    label: string;
    type: AIAgentType;
  }> = [
    {
      description: "Professores de IA vinculados ao conteúdo de cada aula.",
      icon: GraduationCap,
      label: "Tutores das aulas",
      type: "lesson_tutor"
    },
    {
      description: "Orientação geral sobre cursos, assuntos e trilhas da plataforma.",
      icon: Sparkles,
      label: "IA geral · Diretor",
      type: "platform_guide"
    }
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {agentCards.map((card) => {
        const usage = agents.find((agent) => agent.agentType === card.type);

        return (
          <div className="rounded-[8px] border border-white/[0.08] bg-black/15 p-4" key={card.type}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-white/[0.055] text-zinc-400 ring-1 ring-white/[0.06]">
                  <card.icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-200">{card.label}</p>
                  <p className="mt-1 text-[11px] leading-4 text-zinc-600">{card.description}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-semibold tracking-tight text-white">{formatCompact(usage?.totalTokens ?? 0)}</p>
                <p className="text-[10px] uppercase tracking-wide text-zinc-600">tokens</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-3">
              <AgentStat label="Respostas" value={usage?.answers ?? 0} />
              <AgentStat label="Alunos" value={usage?.activeStudents ?? 0} />
              <AgentStat label="Chats" value={usage?.conversations ?? 0} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-sm font-semibold text-zinc-300">{formatNumber(value)}</p>
      <p className="mt-0.5 text-[10px] text-zinc-600">{label}</p>
    </div>
  );
}

function StudentUsageRanking({
  filteredCount,
  onSearchChange,
  rankByUserId,
  search,
  students,
  totalCount
}: {
  filteredCount: number;
  onSearchChange: (value: string) => void;
  rankByUserId: Map<string, number>;
  search: string;
  students: StudentUsage[];
  totalCount: number;
}) {
  return (
    <section className="overflow-hidden rounded-[8px] border border-white/[0.08] bg-black/15">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2">
          <UserRound className="size-4 text-zinc-500" />
          <div>
            <p className="text-xs font-semibold text-zinc-300">Ranking de uso por aluno</p>
            <p className="mt-0.5 text-[10px] text-zinc-600">Ordenado pelo total de tokens consumidos no período.</p>
          </div>
        </div>
        <label className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <span className="sr-only">Buscar aluno</span>
          <input
            className="h-9 w-full rounded-[8px] border border-white/[0.08] bg-black/25 pl-9 pr-3 text-xs text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-white/20"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar aluno ou e-mail"
            type="search"
            value={search}
          />
        </label>
      </div>

      {students.length ? (
        <div className="max-h-[30rem] overflow-y-auto">
          {students.map((student) => (
            <StudentUsageRow
              key={student.userId}
              rank={rankByUserId.get(student.userId) ?? 0}
              student={student}
            />
          ))}
        </div>
      ) : (
        <p className="px-4 py-10 text-center text-xs text-zinc-600">
          {totalCount ? "Nenhum aluno corresponde à busca." : "Nenhum aluno consumiu IA neste período."}
        </p>
      )}

      {filteredCount > students.length ? (
        <p className="border-t border-white/[0.06] px-4 py-2.5 text-center text-[10px] text-zinc-600">
          Mostrando os primeiros {formatNumber(students.length)} de {formatNumber(filteredCount)} resultados. Use a busca para localizar um aluno específico.
        </p>
      ) : null}
    </section>
  );
}

function StudentUsageRow({ rank, student }: { rank: number; student: StudentUsage }) {
  return (
    <div className="grid gap-3 border-b border-white/[0.055] px-4 py-3 last:border-0 md:grid-cols-[2rem_minmax(0,1fr)_auto_auto] md:items-center">
      <span className={`hidden text-center text-xs font-semibold md:block ${rank <= 3 ? "text-[var(--accent)]" : "text-zinc-600"}`}>
        {rank ? `${rank}º` : "—"}
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.065] text-[10px] font-semibold text-zinc-300 ring-1 ring-white/[0.07]">
          {getInitials(student.fullName)}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`text-[10px] font-semibold md:hidden ${rank <= 3 ? "text-[var(--accent)]" : "text-zinc-600"}`}>{rank}º</span>
            <p className="truncate text-xs font-semibold text-zinc-200">{student.fullName}</p>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-zinc-600">{student.email ?? "E-mail não informado"}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        <span className="rounded-full bg-white/[0.045] px-2 py-1 text-[10px] text-zinc-500">Tutor {formatNumber(student.lessonTutorAnswers)}</span>
        {student.platformGuideAnswers > 0 ? (
          <span className="rounded-full bg-[var(--accent)]/10 px-2 py-1 text-[10px] text-[var(--accent)]">Diretor {formatNumber(student.platformGuideAnswers)}</span>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-4 md:min-w-40 md:justify-end md:text-right">
        <div className="text-left md:text-right">
          <p className="text-xs font-semibold text-zinc-300">{formatCompact(student.totalTokens)} tokens</p>
          <p className="mt-0.5 text-[10px] text-zinc-600">{formatNumber(student.answers)} respostas · {formatNumber(student.conversations)} chats</p>
        </div>
        <p className="shrink-0 text-[10px] text-zinc-700 md:hidden">{formatDate(student.lastActivityAt)}</p>
      </div>
    </div>
  );
}

function LessonUsage({ lessons }: { lessons: AIUsageSummary["byLesson"] }) {
  return (
    <section className="overflow-hidden rounded-[8px] border border-white/[0.08] bg-black/15">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
        <GraduationCap className="size-4 text-zinc-500" />
        <div>
          <p className="text-xs font-semibold text-zinc-300">Consumo por aula / tutor</p>
          <p className="mt-0.5 text-[10px] text-zinc-600">Somente interações do professor de IA daquela aula.</p>
        </div>
      </div>
      <div className="max-h-[30rem] overflow-y-auto">
        {lessons.length ? lessons.map((lesson) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-white/[0.055] px-4 py-3 last:border-0" key={`${lesson.lessonId}-${lesson.lessonTitle}`}>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-zinc-200">{lesson.lessonTitle}</p>
              <p className="mt-1 text-[11px] text-zinc-600">
                {formatNumber(lesson.answers)} respostas · {formatNumber(lesson.activeStudents)} alunos · {formatNumber(lesson.conversations)} chats
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-zinc-300">{formatCompact(lesson.totalTokens)}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">tokens</p>
            </div>
          </div>
        )) : <p className="px-4 py-8 text-center text-xs text-zinc-600">Nenhuma aula consumiu IA neste período.</p>}
      </div>
    </section>
  );
}

function UsageBreakdown({
  icon: Icon,
  items,
  title
}: {
  icon: typeof Activity;
  items: Array<{ detail: string; label: string; value: string }>;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-[8px] border border-white/[0.08] bg-black/15">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
        <Icon className="size-4 text-zinc-500" />
        <p className="text-xs font-semibold text-zinc-300">{title}</p>
      </div>
      {items.length ? items.map((item, index) => (
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.055] px-4 py-3 last:border-0" key={`${item.label}-${index}`}>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-zinc-300">{item.label}</p>
            <p className="mt-1 truncate text-[10px] text-zinc-600">{item.detail}</p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-zinc-400">{item.value}</span>
        </div>
      )) : <p className="px-4 py-6 text-center text-xs text-zinc-600">Sem dados.</p>}
    </section>
  );
}
