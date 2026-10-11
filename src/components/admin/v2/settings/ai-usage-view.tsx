"use client";

import { ChartLine, Search, Table2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AIUsageSummaryBetween } from "@/server/ai/usage-analytics";
import { ChartCard } from "../chart-card";
import type { DataTableColumn } from "../data-table";
import { adminInputClass } from "../form";
import { getInitials } from "../format";
import { KpiTile } from "../kpi-tile";
import { listAdminPeriodBuckets, parseAdminPeriodParam, resolveAdminPeriod } from "../period";
import { adminTransition } from "../styles";
import {
  aiFailureRate,
  buildAiUsageBucketSeries,
  formatAiCompact,
  formatAiDateTime,
  formatAiNumber,
  getAiProviderMeta,
  isAiProviderId,
  type AiUsageBucketPoint
} from "./ai-settings-model";
import { ResponsiveTable, SectionCard } from "./kit";

const CHART_HEIGHT = 280;
/** Corpo do SectionCard quando ele so contem uma tabela encostada nas bordas. */
const flushBody = "px-0 pb-0";
const STUDENT_LIMIT = 100;

const AiUsageChart = dynamic(() => import("./ai-usage-chart"), {
  loading: () => <Skeleton className="size-full rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />,
  ssr: false
});

type StudentRow = AIUsageSummaryBetween["byStudent"][number];
type LessonRow = AIUsageSummaryBetween["byLesson"][number];
type ProviderRow = AIUsageSummaryBetween["byProvider"][number];
type ConnectionRow = AIUsageSummaryBetween["byConnection"][number];

type AgentRow = { answers: number; conversations: number; id: string; label: string; students: number; tokens: number };

type AiUsageViewProps = {
  /** Hora da leitura no servidor: periodo, baldes e rotulos saem iguais no servidor e na hidratacao. */
  nowIso: string;
  /** Valor canonico de ?periodo= ja lido pela pagina ("30d", "hoje", "2026-10-01..2026-10-10"). */
  param: string;
  summary: AIUsageSummaryBetween;
};

function providerLabel(value: string) {
  return isAiProviderId(value) ? getAiProviderMeta(value).shortLabel : value === "unknown" ? "Desconhecido" : value;
}

function NumberCell({ value }: { value: number }) {
  return <span className="tabular-nums">{formatAiNumber(value)}</span>;
}

function ViewToggle({ onChange, view }: { onChange: (view: "chart" | "table") => void; view: "chart" | "table" }) {
  const options = [
    { icon: ChartLine, label: "Ver como gráfico", value: "chart" as const },
    { icon: Table2, label: "Ver como tabela", value: "table" as const }
  ];

  return (
    <div aria-label="Formato" className="flex h-9 items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-0.5" role="group">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === view;

        return (
          <button
            aria-label={option.label}
            aria-pressed={active}
            className={cn(
              "grid h-7 w-8 place-items-center rounded-md",
              adminTransition,
              active ? "bg-[var(--surface-3)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            title={option.label}
            type="button"
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

function UsageTable({ hourly, points }: { hourly: boolean; points: readonly AiUsageBucketPoint[] }) {
  const rows = points.slice().reverse();

  return (
    <div className="size-full overflow-y-auto rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full text-sm">
        <caption className="sr-only">{hourly ? "Consumo por hora" : "Consumo por dia"}</caption>
        <thead className="sticky top-0 bg-[var(--surface-1)]">
          <tr className="h-9 border-b border-[var(--border-subtle)] text-xs font-medium text-[var(--text-tertiary)]">
            <th className="px-3 text-left font-medium" scope="col">{hourly ? "Hora" : "Dia"}</th>
            <th className="px-3 text-right font-medium" scope="col">Respostas</th>
            <th className="px-3 text-right font-medium" scope="col">Entrada</th>
            <th className="px-3 text-right font-medium" scope="col">Saída</th>
            <th className="px-3 text-right font-medium" scope="col">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <tr className="h-10 border-b border-[var(--border-subtle)] last:border-0" key={point.key}>
              <td className="px-3 text-[var(--text-primary)] tabular-nums" title={point.longLabel}>{point.label}</td>
              <td className="px-3 text-right tabular-nums">{formatAiNumber(point.answers)}</td>
              <td className="px-3 text-right text-[var(--text-secondary)] tabular-nums">{formatAiNumber(point.inputTokens)}</td>
              <td className="px-3 text-right text-[var(--text-secondary)] tabular-nums">{formatAiNumber(point.outputTokens)}</td>
              <td className="px-3 text-right font-medium tabular-nums">{formatAiNumber(point.totalTokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudentName({ student }: { student: StudentRow }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-primary)]"
      >
        {getInitials(student.fullName)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-[var(--text-primary)]">{student.fullName}</span>
        <span className="truncate text-xs text-[var(--text-secondary)]">{student.email ?? "Sem e-mail"}</span>
      </span>
    </span>
  );
}

/**
 * Consumo do Tutor IA no periodo da barra superior (?periodo=: Hoje, 1d, 3d, 7d, 30d ou um intervalo do
 * calendario), com os mesmos dados do admin antigo. Ate 3 dias, o grafico e por hora; acima, por dia.
 */
export function AiUsageView({ nowIso, param, summary }: AiUsageViewProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [search, setSearch] = useState("");
  const totals = summary.totals;
  const resolved = useMemo(() => {
    const now = new Date(nowIso);

    return resolveAdminPeriod(parseAdminPeriodParam(param, now), now);
  }, [nowIso, param]);
  const hourly = resolved.granularity === "hour";
  const points = useMemo(
    () => buildAiUsageBucketSeries(summary.byBucket ?? [], listAdminPeriodBuckets(resolved)),
    [resolved, summary.byBucket]
  );
  const hasUsage = totals.answers > 0 || totals.failures > 0;
  const failureRate = aiFailureRate(totals.answers, totals.failures);
  const period = resolved.label.toLocaleLowerCase("pt-BR");
  const updatedAt = summary.generatedAt ? formatAiDateTime(summary.generatedAt, "") : "";

  const agents: AgentRow[] = useMemo(() => {
    const find = (type: string) => (summary.byAgent ?? []).find((agent) => agent.agentType === type);
    const tutor = find("lesson_tutor");
    const director = find("platform_guide");

    return [
      {
        answers: tutor?.answers ?? 0,
        conversations: tutor?.conversations ?? 0,
        id: "lesson_tutor",
        label: "Tutor das aulas",
        students: tutor?.activeStudents ?? 0,
        tokens: tutor?.totalTokens ?? 0
      },
      {
        answers: director?.answers ?? 0,
        conversations: director?.conversations ?? 0,
        id: "platform_guide",
        label: "Diretor",
        students: director?.activeStudents ?? 0,
        tokens: director?.totalTokens ?? 0
      }
    ];
  }, [summary.byAgent]);

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const all = summary.byStudent ?? [];

    return term ? all.filter((student) => `${student.fullName} ${student.email ?? ""}`.toLocaleLowerCase("pt-BR").includes(term)) : all;
  }, [search, summary.byStudent]);

  const agentColumns: DataTableColumn<AgentRow>[] = [
    { cell: (row) => <span className="font-medium text-[var(--text-primary)]">{row.label}</span>, header: "Quem respondeu", id: "label" },
    { align: "right", cell: (row) => <NumberCell value={row.answers} />, header: "Respostas", headerClassName: "w-28", id: "answers" },
    { align: "right", cell: (row) => <NumberCell value={row.students} />, header: "Alunos", headerClassName: "w-24", id: "students" },
    { align: "right", cell: (row) => formatAiCompact(row.tokens), header: "Tokens", headerClassName: "w-28", id: "tokens" }
  ];

  const studentColumns: DataTableColumn<StudentRow>[] = [
    { cell: (row) => <StudentName student={row} />, className: "max-w-0", header: "Aluno", id: "student" },
    { align: "right", cell: (row) => <NumberCell value={row.lessonTutorAnswers} />, header: "Tutor", headerClassName: "w-24", id: "tutor" },
    { align: "right", cell: (row) => <NumberCell value={row.platformGuideAnswers} />, header: "Diretor", headerClassName: "w-24", id: "director" },
    { align: "right", cell: (row) => <NumberCell value={row.conversations} />, header: "Conversas", headerClassName: "w-28", id: "conversations" },
    { align: "right", cell: (row) => formatAiCompact(row.totalTokens), header: "Tokens", headerClassName: "w-28", id: "tokens" },
    {
      align: "right",
      cell: (row) => <span className="text-[var(--text-secondary)]">{formatAiDateTime(row.lastActivityAt, "—")}</span>,
      header: "Último uso",
      headerClassName: "w-40",
      id: "last"
    }
  ];

  const lessonColumns: DataTableColumn<LessonRow>[] = [
    {
      cell: (row) => <span className="block truncate font-medium text-[var(--text-primary)]" title={row.lessonTitle}>{row.lessonTitle}</span>,
      className: "max-w-0",
      header: "Aula",
      id: "lesson"
    },
    { align: "right", cell: (row) => <NumberCell value={row.answers} />, header: "Respostas", headerClassName: "w-28", id: "answers" },
    { align: "right", cell: (row) => <NumberCell value={row.activeStudents} />, header: "Alunos", headerClassName: "w-24", id: "students" },
    { align: "right", cell: (row) => formatAiCompact(row.totalTokens), header: "Tokens", headerClassName: "w-28", id: "tokens" }
  ];

  const providerColumns: DataTableColumn<ProviderRow>[] = [
    {
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-[13px] text-[var(--text-primary)]" title={row.model}>{row.model}</span>
          <span className="text-xs text-[var(--text-secondary)]">{providerLabel(row.provider)}</span>
        </span>
      ),
      className: "max-w-0",
      header: "Modelo",
      id: "model"
    },
    { align: "right", cell: (row) => <NumberCell value={row.answers} />, header: "Respostas", headerClassName: "w-28", id: "answers" },
    { align: "right", cell: (row) => formatAiCompact(row.totalTokens), header: "Tokens", headerClassName: "w-24", id: "tokens" }
  ];

  const connectionColumns: DataTableColumn<ConnectionRow>[] = [
    {
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-[var(--text-primary)]" title={row.label}>{row.connectionId ? row.label : "Conexão removida"}</span>
          <span className="text-xs text-[var(--text-secondary)]">
            {providerLabel(row.provider)} · {row.authMode === "account_gateway" ? "Conta" : row.authMode === "api_key" ? "Chave de API" : "Removida"}
          </span>
        </span>
      ),
      className: "max-w-0",
      header: "Conexão",
      id: "connection"
    },
    { align: "right", cell: (row) => <NumberCell value={row.answers} />, header: "Respostas", headerClassName: "w-28", id: "answers" },
    { align: "right", cell: (row) => formatAiCompact(row.totalTokens), header: "Tokens", headerClassName: "w-24", id: "tokens" }
  ];

  const fixed = "[&_table]:table-fixed";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-label={`Números do Tutor IA, ${period}`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          comparisonLabel={`em ${formatAiNumber(totals.conversations)} ${totals.conversations === 1 ? "conversa" : "conversas"}`}
          label="Respostas"
          periodLabel={period}
          value={totals.answers}
        />
        <KpiTile
          comparisonLabel={`em ${formatAiNumber(totals.lessons)} ${totals.lessons === 1 ? "aula" : "aulas"}`}
          label="Alunos que usaram"
          periodLabel={period}
          value={totals.activeStudents}
        />
        <KpiTile
          comparisonLabel={`entrada ${formatAiCompact(totals.inputTokens)} · saída ${formatAiCompact(totals.outputTokens)}`}
          label="Tokens"
          periodLabel={period}
          value={totals.totalTokens}
        />
        <KpiTile
          comparisonLabel={failureRate === null ? "nenhuma tentativa" : `${String(failureRate).replace(".", ",")}% das tentativas`}
          label="Falhas"
          periodLabel={period}
          value={totals.failures}
        />
      </section>

      <ChartCard
        actions={<ViewToggle onChange={setView} view={view} />}
        meta={`tokens de entrada e saída somados, ${period}`}
        emptyDescription="O gráfico aparece quando os alunos usarem o Tutor ou o Diretor neste período."
        footer={updatedAt ? `Atualizado em ${updatedAt}` : undefined}
        height={CHART_HEIGHT}
        state={hasUsage ? "ready" : "empty"}
        title={hourly ? "Consumo por hora" : "Consumo por dia"}
      >
        {view === "chart" ? <AiUsageChart height={CHART_HEIGHT} points={points} /> : <UsageTable hourly={hourly} points={points} />}
      </ChartCard>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <SectionCard bodyClassName={flushBody} title="Por quem respondeu" meta={period}>
          <ResponsiveTable
            caption="Consumo por agente"
            className={fixed}
            flush
            columns={agentColumns}
            getRowKey={(row) => row.id}
            renderCard={(row) => (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-[var(--text-primary)]">{row.label}</span>
                <span className="text-[var(--text-secondary)] tabular-nums">
                  {formatAiNumber(row.answers)} respostas · {formatAiCompact(row.tokens)} tokens
                </span>
              </div>
            )}
            rows={agents}
          />
        </SectionCard>

        <SectionCard bodyClassName={flushBody} title="Por provedor e modelo" meta={period}>
          <ResponsiveTable
            caption="Consumo por provedor e modelo"
            className={fixed}
            flush
            columns={providerColumns}
            emptyDescription="Nenhuma resposta no período."
            emptyTitle="Sem dados no período"
            getRowKey={(row) => `${row.provider}-${row.model}`}
            renderCard={(row) => (
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="truncate font-mono text-[13px] text-[var(--text-primary)]">{row.model}</span>
                <span className="text-[13px] text-[var(--text-secondary)] tabular-nums">
                  {providerLabel(row.provider)} · {formatAiNumber(row.answers)} respostas · {formatAiCompact(row.totalTokens)} tokens
                </span>
              </div>
            )}
            rows={summary.byProvider ?? []}
          />
        </SectionCard>
      </div>

      <SectionCard
        actions={
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Buscar aluno</span>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              className={cn(adminInputClass, "pl-9")}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar pelo nome ou e-mail"
              type="search"
              value={search}
            />
          </label>
        }
        bodyClassName={flushBody}
        description="Ordenado pelo total de tokens do período."
        title="Alunos que mais usam"
      >
        <ResponsiveTable
          caption="Alunos que mais usam o Tutor IA"
          className={fixed}
          flush
          columns={studentColumns}
          emptyDescription={search ? "Tente outro nome ou e-mail." : "Nenhum aluno usou o Tutor ou o Diretor neste período."}
          emptyTitle={search ? "Nenhum aluno encontrado" : "Sem dados no período"}
          getRowKey={(row) => row.userId}
          renderCard={(row) => (
            <div className="flex min-w-0 flex-col gap-2">
              <StudentName student={row} />
              <p className="text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
                Tutor {formatAiNumber(row.lessonTutorAnswers)} · Diretor {formatAiNumber(row.platformGuideAnswers)} ·{" "}
                {formatAiCompact(row.totalTokens)} tokens
              </p>
            </div>
          )}
          rows={filteredStudents.slice(0, STUDENT_LIMIT)}
        />
        {filteredStudents.length > STUDENT_LIMIT ? (
          <p className="border-t border-[var(--border-subtle)] px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
            Mostrando os {STUDENT_LIMIT} primeiros de {formatAiNumber(filteredStudents.length)}. Use a busca para achar um aluno.
          </p>
        ) : null}
      </SectionCard>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SectionCard
          bodyClassName={flushBody}
          description="Só as perguntas feitas ao Tutor dentro de cada aula."
          title="Aulas com mais perguntas ao Tutor"
        >
          <ResponsiveTable
            caption="Consumo por aula"
            className={fixed}
            flush
            columns={lessonColumns}
            emptyDescription="Nenhuma pergunta ao Tutor das aulas neste período."
            emptyTitle="Sem dados no período"
            getRowKey={(row) => `${row.lessonId ?? "sem-aula"}-${row.lessonTitle}`}
            renderCard={(row) => (
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="truncate font-medium text-[var(--text-primary)]">{row.lessonTitle}</span>
                <span className="text-[13px] text-[var(--text-secondary)] tabular-nums">
                  {formatAiNumber(row.answers)} respostas · {formatAiNumber(row.activeStudents)} alunos
                </span>
              </div>
            )}
            rows={summary.byLesson ?? []}
          />
        </SectionCard>

        <SectionCard
          bodyClassName={flushBody}
          description="Qual chave ou conta respondeu."
          title="Por conexão"
        >
          <ResponsiveTable
            caption="Consumo por conexão"
            className={fixed}
            flush
            columns={connectionColumns}
            emptyDescription="Nenhuma resposta no período."
            emptyTitle="Sem dados no período"
            getRowKey={(row) => `${row.connectionId ?? "removida"}-${row.provider}-${row.label}`}
            renderCard={(row) => (
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="truncate font-medium text-[var(--text-primary)]">{row.connectionId ? row.label : "Conexão removida"}</span>
                <span className="text-[13px] text-[var(--text-secondary)] tabular-nums">
                  {providerLabel(row.provider)} · {formatAiNumber(row.answers)} respostas · {formatAiCompact(row.totalTokens)} tokens
                </span>
              </div>
            )}
            rows={summary.byConnection ?? []}
          />
        </SectionCard>
      </div>
    </div>
  );
}
