import { BellPlus, ChartColumn, Pencil } from "lucide-react";
import Link from "next/link";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { WEBINARS_HREF, WEBINAR_ADMIN_COPY, webinarAdminHref } from "@/server/webinars/editor-model";
import { WEBINAR_ABSENTEES, webinarNoticeHref } from "@/server/webinars/notice-shortcut-model";
import { watchTimeLabel } from "@/server/webinars/report-model";
import {
  messagesPerMinuteBars,
  personName,
  questionStatusBars,
  questionsTotal,
  reactionBars,
  registrationSourceBars,
  reportKpis,
  type ReportSessionOption
} from "@/server/webinars/report-page-model";
import type { WebinarReportPage, WebinarReportSelection } from "@/server/webinars/report-queries";
import { EmptyState } from "../../../empty-state";
import { KpiTile } from "../../../kpi-tile";
import { AdminLinkButton } from "../../../link-button";
import { AdminPage } from "../../../page-container";
import { PageHeader } from "../../../page-header";
import { StatusChip } from "../../../status-chip";
import { adminTransition } from "../../../styles";
import { WebinarExportMenu } from "../export-menu";
import { AttendeesTable } from "./attendees-table";
import { PresenceCurveCard } from "./presence-curve";
import { ReportBars, ReportBlock, ReportFacts, ReportNote, ReportRanking, ReportSubheading, type ReportPersonItem } from "./report-blocks";
import { AssistantReportBlock, OfferReportBlock, SimulationReportBlock } from "./report-extra-blocks";

// A aba Relatorio de um webinario (docs/30 §2.5, §3.4, §3.5 e §3.7): o seletor de sessao no topo (?sessao=: as horas
// marcadas que ja comecaram, as "Comeca quando voce entra" dos ultimos 7 dias e o replay), o botao Exportar com os sete
// CSVs nos nomes do Zoom (a Simulacao so na sessao gravada), os onze numeros (KpiTile, 4 por linha, 2 abaixo de 768 px),
// a curva "Presentes minuto a minuto" com as 5 maiores quedas e o trecho da transcricao de cada uma, o Chat (mensagens
// por minuto, Quem mais comentou, Mais quentes com a formula escrita), as Perguntas, as Enquetes por opcao, as Vagas, o
// Replay, a Oferta (so com oferta), as Respostas do Assistente (fora da Simulacao, D24), a Simulacao completa (fundo
// diferente e a frase de que nada dali entra nos outros numeros) e a Lista por aluno com o CSV. Nada aqui e estimado:
// sem dado, "—". Os nomes vem de profiles numa segunda leitura; o e-mail so nos CSVs. Tudo desenha no servidor; so a
// curva e o menu Exportar sao cliente.

const COPY = WEBINAR_COPY.relatorio;
const integer = new Intl.NumberFormat("pt-BR");

const pillClass = (selected: boolean) =>
  cn(
    "inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap select-none pointer-coarse:min-h-11",
    selected
      ? "border-[var(--text-primary)] bg-[var(--surface-3)] text-[var(--text-primary)]"
      : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
    adminTransition
  );

function SessionSelector({ sessions }: { sessions: readonly ReportSessionOption[] }) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <nav aria-label={COPY.sessaoLabel} className="min-w-0">
      <ul className="flex min-w-0 flex-wrap gap-2">
        {sessions.map((session) => (
          <li key={session.id}>
            <Link aria-current={session.selected ? "page" : undefined} className={pillClass(session.selected)} data-navigation-feedback="false" href={session.href} scroll={false}>
              {session.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function studentHref(userId: string) {
  return `/admin/alunos/${userId}`;
}

function ReportBody({ hasReplay, selected, webinarId }: { hasReplay: boolean; selected: WebinarReportSelection; webinarId: string }) {
  const { assistant, attendees, csvHref, dropExcerpts, durationMs, exportReports, offerClicked, people, polls, questions, report, session, simulation } = selected;
  const live = session.status === "live";
  const kpis = reportKpis(report, { hasReplay });
  // O bloco do Assistente: ligado no webinario, com resposta nesta sessao ou o aviso da migracao 202610300004.
  const showAssistant = assistant.enabled || assistant.pending || report.assistant.present;
  const topChat: ReportPersonItem[] = report.chat.top.map((entry) => ({ href: studentHref(entry.userId), id: entry.userId, label: personName(people, entry.userId), meta: COPY.mensagensDe(entry.total) }));
  const hottest: ReportPersonItem[] = report.chat.hot.map((entry) => ({ href: studentHref(entry.userId), id: entry.userId, label: personName(people, entry.userId), meta: COPY.pontos(entry.score) }));
  const topQuestions: ReportPersonItem[] = report.questions.top.map((entry) => {
    const info = questions[entry.questionId];
    const status = info ? COPY.perguntasStatus[info.status] : null;
    const answeredBy = info?.answeredBy ? COPY.respondidaPor(personName(people, info.answeredBy)) : null;

    return { id: entry.questionId, label: info?.body ?? COPY.perguntas, meta: [COPY.votos(entry.votes), status, answeredBy].filter(Boolean).join(" · ") };
  });

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusChip tone={live ? "warning" : "neutral"}>{live ? COPY.situacaoSessao.live : COPY.situacaoSessao.ended}</StatusChip>
        {session.endedAt ? <span className="text-[13px] leading-5 text-[var(--text-tertiary)]">{formatSaoPauloDateTime(session.endedAt)}</span> : null}
        <div className="ml-auto">
          <WebinarExportMenu reports={exportReports} scope="session" sessionId={session.id} webinarId={webinarId} />
        </div>
      </div>
      {live ? <ReportNote>{COPY.emAndamento}</ReportNote> : null}

      <section aria-label={COPY.titulo} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiTile definition={kpi.definition} emptyLabel="—" format={kpi.format} key={kpi.id} label={kpi.label} value={kpi.value} />
        ))}
      </section>

      <PresenceCurveCard
        avgPresent={report.presence.avgPresent}
        curve={report.presence.curve}
        dropExcerpts={dropExcerpts}
        drops={report.presence.drops}
        durationMs={durationMs}
        live={live}
        peak={report.presence.peak}
      />

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <ReportBlock description={COPY.definicoes.mensagens} id="webinario-relatorio-chat" title={COPY.blocos.chat}>
          <ReportSubheading>{COPY.mensagensPorMinuto}</ReportSubheading>
          <ReportBars
            bars={messagesPerMinuteBars(report.chat.perMinute)}
            caption={COPY.mensagensPorMinuto}
            emptyText={COPY.semMensagens}
            format={(bar) => `${COPY.mensagensDe(bar.total)}${bar.students ? ` · ${bar.students} ${bar.students === 1 ? "aluno" : "alunos"}` : ""}`}
          />
          <ReportSubheading>{COPY.topComentadores}</ReportSubheading>
          <ReportRanking caption={COPY.topComentadores} emptyText={COPY.semMensagens} items={topChat} />
          <ReportSubheading>{COPY.maisQuentes}</ReportSubheading>
          <ReportRanking caption={COPY.maisQuentes} emptyText={COPY.semMensagens} items={hottest} />
          <p className="text-xs leading-5 text-[var(--text-tertiary)]">{COPY.formulaQuentes}</p>
        </ReportBlock>

        <div className="flex min-w-0 flex-col gap-4">
          <ReportBlock description={COPY.definicoes.reacoes} id="webinario-relatorio-reacoes" title={COPY.reacoes}>
            <ReportBars bars={reactionBars(report.reactions.byType)} caption={COPY.reacoes} emptyText={COPY.semReacoes} format={(bar) => `${integer.format(bar.total)} · ${bar.students ?? 0} ${bar.students === 1 ? "aluno" : "alunos"}`} />
          </ReportBlock>

          <ReportBlock description={`${COPY.feitas}: ${integer.format(questionsTotal(report.questions))}`} id="webinario-relatorio-perguntas" title={COPY.blocos.perguntas}>
            <ReportBars bars={questionStatusBars(report.questions)} caption={COPY.blocos.perguntas} emptyText={COPY.semPerguntas} format={(bar) => integer.format(bar.total)} />
            <ReportSubheading>{COPY.maisVotadas}</ReportSubheading>
            <ReportRanking caption={COPY.maisVotadas} emptyText={COPY.semPerguntas} items={topQuestions} />
          </ReportBlock>
        </div>

        <ReportBlock description={COPY.definicoes.enquetes} id="webinario-relatorio-enquetes" title={COPY.blocos.enquetes}>
          {polls.length === 0 ? (
            <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">{COPY.semEnquetes}</p>
          ) : (
            polls.map((poll) => (
              <div className="flex min-w-0 flex-col gap-3" key={poll.id}>
                <ReportSubheading>{poll.question}</ReportSubheading>
                {poll.anonymous ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{COPY.anonima}</p> : null}
                <ReportBars
                  bars={poll.options.map((option) => ({ id: option.id, label: option.label, percent: option.percent, students: option.students, total: option.total }))}
                  caption={poll.question}
                  emptyText={COPY.semRespostas}
                  format={(bar) => integer.format(bar.total)}
                />
              </div>
            ))
          )}
        </ReportBlock>

        <div className="flex min-w-0 flex-col gap-4">
          <ReportBlock
            actions={
              report.registration.absent > 0 ? (
                <AdminLinkButton
                  href={webinarNoticeHref(webinarId, "inbox", WEBINAR_ABSENTEES)}
                  prefetch={false}
                  title={COPY.avisarQuemFaltouDica}
                  variant="secondary"
                >
                  <BellPlus aria-hidden="true" className="size-4" />
                  {COPY.avisarQuemFaltou}
                </AdminLinkButton>
              ) : null
            }
            description={COPY.definicoes.vagasGarantidas}
            id="webinario-relatorio-vagas"
            title={COPY.blocos.vagas}
          >
            <ReportFacts
              items={[
                { label: COPY.vagasGarantidas, value: integer.format(report.registration.registered) },
                { label: COPY.compareceram, value: integer.format(report.registration.attended) },
                { label: COPY.faltaram, value: integer.format(report.registration.absent) },
                { label: COPY.tempoMaximo, value: report.presence.watchMaxSeconds > 0 ? watchTimeLabel(report.presence.watchMaxSeconds) : "—" }
              ]}
            />
            <ReportSubheading>{COPY.origemDaVaga}</ReportSubheading>
            <ReportBars bars={registrationSourceBars(report.registration)} caption={COPY.origemDaVaga} emptyText="—" format={(bar) => integer.format(bar.total)} />
          </ReportBlock>

          {hasReplay ? (
            <ReportBlock description={COPY.definicoes.replay} id="webinario-relatorio-replay" title={COPY.blocos.replay}>
              <ReportFacts
                items={[
                  { label: COPY.replayVistos, value: integer.format(report.replay.viewers) },
                  { label: COPY.replayAssistido, value: report.replay.viewers > 0 ? `${report.replay.watchedPct} %` : "—" }
                ]}
              />
            </ReportBlock>
          ) : null}
        </div>
      </div>

      {report.offer.present || showAssistant ? (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
          {report.offer.present ? <OfferReportBlock report={report} /> : null}
          {showAssistant ? <AssistantReportBlock pending={assistant.pending} report={report} /> : null}
        </div>
      ) : null}

      {session.kind === "simulated" ? <SimulationReportBlock report={report} simulation={simulation} /> : null}

      <AttendeesTable attendees={attendees} csvHref={csvHref} offerClicked={offerClicked} />
    </>
  );
}

export function WebinarReportView({ page }: { page: WebinarReportPage }) {
  const { hasReplay, selected, sessions, webinar } = page;

  return (
    <AdminPage className="gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader
          actions={
            <AdminLinkButton href={webinarAdminHref(webinar.id)} variant="secondary">
              <Pencil aria-hidden="true" className="size-4" />
              {COPY.editar}
            </AdminLinkButton>
          }
          breadcrumb={[{ href: WEBINARS_HREF, label: WEBINAR_ADMIN_COPY.header.breadcrumbList }, { href: webinarAdminHref(webinar.id), label: webinar.title }, { label: COPY.titulo }]}
          description={COPY.descricao}
          title={webinar.title}
        />
        <SessionSelector sessions={sessions} />
      </div>

      {selected ? <ReportBody hasReplay={hasReplay} selected={selected} webinarId={webinar.id} /> : <EmptyState description={COPY.semDados} icon={ChartColumn} title={COPY.semSessoes} />}
    </AdminPage>
  );
}
