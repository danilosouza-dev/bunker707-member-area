import { Download } from "lucide-react";
import Link from "next/link";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { attendeeLeftAtIso, attendeeTimeLabel, attendeeWasPresent, type ReportAttendee } from "@/server/webinars/report-page-model";
import { DataTable, type DataTableColumn } from "../../../data-table";
import { EMPTY_VALUE } from "../../../format";
import { AdminLinkButton } from "../../../link-button";
import { ReportBlock } from "./report-blocks";

// A lista por aluno (docs/30 §3.4.1, estilo Attendee report): uma linha por aluno presente ou com vaga; quem so
// garantiu vaga aparece com "—" nas colunas de presenca (o "Absentee" do Zoom). O nome leva a ficha do aluno em
// /admin/alunos/[id]; o e-mail so vai no CSV ("Baixar CSV", a rota /api/admin/webinars/[id]/relatorio/csv, que
// grava a auditoria webinar_export). Abaixo de 768 px cada linha vira um cartao (DataTable mobile="cards").

const COPY = WEBINAR_COPY.relatorio;
const integer = new Intl.NumberFormat("pt-BR");

function when(iso: string | null) {
  return iso ? formatSaoPauloDateTime(iso) : EMPTY_VALUE;
}

const COLUMNS: readonly DataTableColumn<ReportAttendee>[] = [
  {
    cell: (row) => (
      <Link className="block max-w-[220px] truncate underline-offset-4 hover:underline" href={`/admin/alunos/${row.userId}`}>
        {row.name}
      </Link>
    ),
    emphasis: true,
    header: COPY.colunas.aluno,
    id: "aluno"
  },
  {
    cell: (row) => (
      <span className="block text-[13px] leading-5">
        {row.registered ? COPY.vagaGarantidaCurta : COPY.semVaga}
        {row.registered && row.registeredAt ? <span className="block text-xs text-[var(--text-tertiary)]">{formatSaoPauloDateTime(row.registeredAt)}</span> : null}
        {row.registered && row.source ? <span className="block text-xs text-[var(--text-tertiary)]">{row.source}</span> : null}
      </span>
    ),
    header: COPY.colunas.vaga,
    id: "vaga",
    mobileLabel: COPY.colunas.vaga
  },
  { cell: (row) => <span className="whitespace-nowrap max-md:whitespace-normal">{attendeeWasPresent(row) ? when(row.firstAt) : EMPTY_VALUE}</span>, header: COPY.colunas.entrou, id: "entrou", mobileLabel: COPY.colunas.entrou },
  {
    cell: (row) => <span className="whitespace-nowrap max-md:whitespace-normal">{attendeeWasPresent(row) ? when(attendeeLeftAtIso(row.lastAt)) : EMPTY_VALUE}</span>,
    header: COPY.colunas.saiu,
    id: "saiu",
    mobileLabel: COPY.colunas.saiu
  },
  { align: "right", cell: (row) => (attendeeWasPresent(row) ? integer.format(row.entries) : EMPTY_VALUE), header: COPY.colunas.entradas, id: "entradas", mobileLabel: COPY.colunas.entradas },
  { align: "right", cell: (row) => attendeeTimeLabel(row.seconds), header: COPY.colunas.tempo, id: "tempo", mobileLabel: COPY.colunas.tempo },
  {
    align: "right",
    cell: (row) => (attendeeWasPresent(row) ? (row.reachedEnd ? COPY.sim : COPY.nao) : EMPTY_VALUE),
    header: COPY.colunas.ateOFim,
    id: "ate-o-fim",
    mobileLabel: COPY.colunas.ateOFim
  },
  { align: "right", cell: (row) => integer.format(row.messages), header: COPY.colunas.mensagens, id: "mensagens", mobileLabel: COPY.colunas.mensagens },
  { align: "right", cell: (row) => integer.format(row.reactions), header: COPY.colunas.reacoes, id: "reacoes", mobileLabel: COPY.colunas.reacoes },
  { align: "right", cell: (row) => integer.format(row.questions), header: COPY.colunas.perguntas, id: "perguntas", mobileLabel: COPY.colunas.perguntas },
  { align: "right", cell: (row) => integer.format(row.polls), header: COPY.colunas.enquetes, id: "enquetes", mobileLabel: COPY.colunas.enquetes },
  { align: "right", cell: (row) => integer.format(row.score), header: COPY.colunas.pontuacao, id: "pontuacao", mobileLabel: COPY.colunas.pontuacao }
];

type AttendeesTableProps = {
  attendees: readonly ReportAttendee[];
  csvHref: string;
};

export function AttendeesTable({ attendees, csvHref }: AttendeesTableProps) {
  return (
    <ReportBlock
      actions={
        <AdminLinkButton href={csvHref} prefetch={false} variant="secondary">
          <Download aria-hidden="true" className="size-4" />
          {COPY.baixarCsv}
        </AdminLinkButton>
      }
      description={COPY.csvNota}
      id="webinario-relatorio-alunos"
      title={COPY.blocos.alunos}
    >
      <DataTable caption={COPY.blocos.alunos} columns={COLUMNS} emptyTitle={COPY.semAlunos} getRowKey={(row) => row.userId} mobile="cards" rows={attendees} />
    </ReportBlock>
  );
}
