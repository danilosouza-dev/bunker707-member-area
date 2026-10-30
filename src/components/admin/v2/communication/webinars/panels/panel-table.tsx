import Link from "next/link";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { panelTableColumns, type PanelTabKind, type PanelTableColumn, type PanelTableRow } from "@/server/webinars/panel-model";
import { adminCard } from "../../../styles";
import { PanelDataTable, PanelJitBadge, type PanelColumn } from "./panel-kit";

// A tabela "Lives do período" / "Sessões do período" (docs/30 §3.2 e §3.3): as colunas da especificacao na ordem, a
// mais recente primeiro, o produto como coluna, a sessao do "Comeca quando voce entra" com o selo e o link Relatorio
// (a aba Relatorio do webinario ja com a sessao, ?sessao=). <table> com <caption> no computador; abaixo de 768 px
// cada linha vira um cartao <dl>. As linhas chegam prontas de panel-model.ts (panelTableOf): aqui so o desenho.

const COPY = WEBINAR_COPY.paineis.tabela;
const TITLE_COLUMNS = new Set<PanelTableColumn>(["live", "webinario"]);

function columnsFor(kind: PanelTabKind): PanelColumn<PanelTableRow>[] {
  const columns: PanelColumn<PanelTableRow>[] = panelTableColumns(kind).map((id) =>
    TITLE_COLUMNS.has(id)
      ? {
          cell: (row: PanelTableRow) => (
            <span className="inline-flex min-w-0 flex-wrap items-center">
              <span className="min-w-0 [overflow-wrap:anywhere]">{row.values[id] ?? row.title}</span>
              {row.jit ? <PanelJitBadge label={WEBINAR_COPY.jit.card.titulo} /> : null}
            </span>
          ),
          header: COPY.colunas[id],
          id
        }
      : {
          align: id === "produto" || id === "data" || id === "horario" ? undefined : "right",
          cell: (row: PanelTableRow) => row.values[id] ?? "—",
          header: COPY.colunas[id],
          id
        }
  );

  columns.push({
    align: "right",
    cell: (row) => (
      <Link
        aria-label={COPY.abrirRelatorioDe(row.title)}
        className="font-medium text-[var(--text-primary)] underline-offset-4 hover:underline"
        data-navigation-feedback="false"
        href={row.reportHref}
      >
        {COPY.abrirRelatorio}
      </Link>
    ),
    header: COPY.colunas.relatorio,
    id: "relatorio"
  });

  return columns;
}

export function PanelSessionsTable({ kind, rows, total }: { kind: PanelTabKind; rows: readonly PanelTableRow[]; total: number }) {
  const title = kind === "live" ? COPY.tituloAoVivo : COPY.tituloGravadas;

  return (
    <section aria-label={title} className={`${adminCard} flex min-w-0 flex-col gap-3 p-4`} data-panel-sessions="">
      <h3 aria-hidden="true" className="text-base leading-6 font-semibold text-[var(--text-primary)] md:hidden">
        {title}
      </h3>
      <PanelDataTable caption={title} captionVisible columns={columnsFor(kind)} rowKey={(row) => row.id} rows={rows} />
      {total > rows.length ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{COPY.mostrando(rows.length, total)}</p> : null}
    </section>
  );
}
