import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { WEBINARS_ASSISTANT_MIGRATION, WEBINARS_OFFERS_MIGRATION } from "@/server/webinars/db";
import { bucketLabel } from "@/server/webinars/report-model";
import { assistantFacts, offerFacts, offerVariantRows, simulationLines, type SimulationSummary } from "@/server/webinars/report-page-model";
import type { WebinarReportView } from "@/server/webinars/report-model";
import { PendingMigrationNotice } from "../../../pending-migration-notice";
import { ReportBlock, ReportEmpty, ReportFacts, ReportSubheading } from "./report-blocks";

// Os blocos da fase 4 na aba Relatorio (docs/30 §3.4 e §3.5): a Oferta (viram, cliques, compras, receita com "—" sem
// valor gravado, M8, a conversao da sessao e a tabela por variante; so quando a sessao teve oferta), as Respostas do
// Assistente (respostas, tempo medio, corrigidas, apagadas e quem pediu a equipe; fora da Simulacao e das mensagens de
// aluno e equipe, D24) e a Simulacao completa (o selo com quem decidiu, o contador com os participantes de verdade ao
// lado, as entradas, os avisos de venda e o roteiro por Solta em; fundo diferente e a frase de que nada dali entra nos
// outros numeros, D6 e D10). Banco sem a parte: o aviso da migracao so no bloco. Sem hooks: desenha no servidor.

const COPY = WEBINAR_COPY.relatorio;
const EXPORTAR = WEBINAR_COPY.exportar;
const integer = new Intl.NumberFormat("pt-BR");

const cellClass = "h-10 border-b border-[var(--border-subtle)] px-3 align-middle";
const headClass = "h-9 border-b border-[var(--border-subtle)] px-3 align-middle text-xs font-medium text-[var(--text-tertiary)]";

export function OfferReportBlock({ report }: { report: WebinarReportView }) {
  const variants = offerVariantRows(report);
  const definitions = EXPORTAR.oferta.definicoes;

  return (
    <ReportBlock description={`${EXPORTAR.oferta.viram}: ${definitions.viram}`} id="webinario-relatorio-oferta" title={EXPORTAR.blocos.oferta}>
      <ReportFacts items={offerFacts(report)} />
      {variants.length > 0 ? (
        <>
          <ReportSubheading>{EXPORTAR.oferta.porVariante}</ReportSubheading>
          <table className="w-full border-collapse text-sm text-[var(--text-secondary)] tabular-nums">
            <caption className="sr-only">{EXPORTAR.oferta.porVariante}</caption>
            <thead>
              <tr>
                <th className={`${headClass} text-left`} scope="col">
                  {EXPORTAR.oferta.colunaVariante}
                </th>
                <th className={`${headClass} text-right`} scope="col">
                  {EXPORTAR.oferta.viram}
                </th>
                <th className={`${headClass} text-right`} scope="col">
                  {EXPORTAR.oferta.cliques}
                </th>
                <th className={`${headClass} text-right`} scope="col">
                  {EXPORTAR.oferta.compras}
                </th>
                <th className={`${headClass} text-right`} scope="col">
                  {EXPORTAR.oferta.conversao}
                </th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr className="last:[&>*]:border-b-0" key={variant.letter}>
                  <th className={`${cellClass} text-left font-normal text-[var(--text-primary)]`} scope="row">
                    {variant.label}
                  </th>
                  <td className={`${cellClass} text-right`}>{integer.format(variant.seen)}</td>
                  <td className={`${cellClass} text-right`}>{integer.format(variant.clicks)}</td>
                  <td className={`${cellClass} text-right`}>{integer.format(variant.purchases)}</td>
                  <td className={`${cellClass} text-right`}>{variant.conversion === null ? "—" : `${variant.conversion} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <p className="text-xs leading-5 text-[var(--text-tertiary)]">
        {EXPORTAR.oferta.compras}: {definitions.compras} · {EXPORTAR.oferta.conversao}: {definitions.conversao}
      </p>
    </ReportBlock>
  );
}

export function AssistantReportBlock({ pending, report }: { pending: boolean; report: WebinarReportView }) {
  return (
    <ReportBlock description={EXPORTAR.assistente.nota} id="webinario-relatorio-assistente" title={EXPORTAR.blocos.assistente}>
      {pending ? (
        <PendingMigrationNotice migration={WEBINARS_ASSISTANT_MIGRATION} size="compact" />
      ) : report.assistant.present ? (
        <ReportFacts items={assistantFacts(report)} />
      ) : (
        <ReportEmpty>{EXPORTAR.assistente.semRespostas}</ReportEmpty>
      )}
    </ReportBlock>
  );
}

export function SimulationReportBlock({ report, simulation }: { report: WebinarReportView; simulation: SimulationSummary }) {
  return (
    <ReportBlock className="bg-[var(--surface-2)]" description={COPY.avisoSimulacao} id="webinario-relatorio-simulacao" title={COPY.blocos.simulacao}>
      {simulation.pending ? <PendingMigrationNotice migration={WEBINARS_OFFERS_MIGRATION} size="compact" /> : null}
      <ul className="flex min-w-0 flex-col gap-1.5 text-sm leading-5 text-[var(--text-primary)]">
        {simulationLines(simulation).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {simulation.ackText ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{simulation.ackText}</p> : null}
      {report.presence.peak ? (
        <p className="text-xs leading-5 text-[var(--text-tertiary)]">
          {COPY.pico}: {report.presence.peak.n} · {bucketLabel(report.presence.peak.b)}
        </p>
      ) : null}
    </ReportBlock>
  );
}
