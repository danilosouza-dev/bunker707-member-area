"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import type { ModuleSettingsRow } from "@/server/member-area/modules-queries";
import {
  describeHomeRowChange,
  describeModuleCovers,
  type CoursePresentationModeValue,
  type HomeModuleRowState
} from "@/server/member-area/modules-model";
import { ErrorBanner } from "../../error-banner";
import { ProductThumb } from "../../product-thumb";
import { PRESENTATION_MODE_HINTS } from "../../products/product-forms";
import { situationTone, StatusChip } from "../../status-chip";
import { adminCard, adminTransition } from "../../styles";
import { adminToast } from "../../toast";
import {
  HomeRowTitleInput,
  RowSwitch,
  optimisticHomeRow,
  requestHomeRowChange,
  undoHomeRowChange,
  type HomeRowDesired,
  type RowError
} from "./home-row-control";
import { OPENS_AS_TOASTS, OpensAsPills, requestOpensAsChange } from "./opens-as-control";

// Tabela de Area de membros › Modulos: por produto, como abre (salva na hora), a fileira de modulos na
// home (chave + titulo editavel no lugar) e quantos modulos tem capa propria. A partir de 900 px de
// largura do proprio bloco e tabela; abaixo, lista de cartoes com os mesmos controles empilhados (alvos
// de 44 px). O estado de cada linha fica aqui em cima, entao tabela e cartoes mostram sempre o mesmo.

type ModulesTableProps = {
  canWriteCatalog: boolean;
  canWriteStorefront: boolean;
  rows: readonly ModuleSettingsRow[];
};

type LiveRow = {
  error: (RowError & { title: string }) | null;
  homeRow: HomeModuleRowState;
  homeRowPending: boolean;
  homeTitleError: string | null;
  opensAs: CoursePresentationModeValue;
  opensAsPending: boolean;
};

type LiveRows = Record<string, LiveRow>;

function fromServer(row: ModuleSettingsRow): LiveRow {
  return { error: null, homeRow: row.homeRow, homeRowPending: false, homeTitleError: null, opensAs: row.opensAs, opensAsPending: false };
}

/**
 * Leitura nova do servidor (Recarregar, busca, pagina, ou o refresh depois de cada gravacao): segue o
 * servidor, menos o que ainda grava. Aviso de "mudou em outra tela" some (a leitura nova resolve);
 * os outros avisos e o erro do titulo ficam ate o produtor fechar ou mexer de novo naquela linha.
 */
function mergeServerRows(rows: readonly ModuleSettingsRow[], current: LiveRows): LiveRows {
  return Object.fromEntries(
    rows.map((row) => {
      const live = current[row.productId];

      if (!live) {
        return [row.productId, fromServer(row)];
      }

      return [
        row.productId,
        {
          ...live,
          error: live.opensAsPending || live.homeRowPending || (live.error && !live.error.reload) ? live.error : null,
          homeRow: live.homeRowPending ? live.homeRow : row.homeRow,
          opensAs: live.opensAsPending ? live.opensAs : row.opensAs
        }
      ];
    })
  );
}

// Medidas da tabela padrao do admin (DataTable, prototipo aprovado): cabecalho de 36 px 12/500 em
// --text-tertiary, linhas de pelo menos 48 px e 16 px de respiro na primeira e na ultima celula. As
// linhas daqui tem controles de 36 px, entao crescem so o necessario para eles.
const headCell = "h-9 px-3 text-left text-xs leading-4 font-medium whitespace-nowrap text-[var(--text-tertiary)]";
const bodyCell = "h-12 px-3 py-1.5 align-middle";

export function ModulesTable({ canWriteCatalog, canWriteStorefront, rows }: ModulesTableProps) {
  const router = useRouter();
  const [source, setSource] = useState(rows);
  const [live, setLive] = useState<LiveRows>(() => Object.fromEntries(rows.map((row) => [row.productId, fromServer(row)])));
  const latest = useRef(live);
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    latest.current = live;
  });

  if (source !== rows) {
    setSource(rows);
    setLive((current) => mergeServerRows(rows, current));
  }

  function patch(productId: string, next: Partial<LiveRow>) {
    setLive((current) => (current[productId] ? { ...current, [productId]: { ...current[productId], ...next } } : current));
  }

  async function changeOpensAs(productId: string, mode: CoursePresentationModeValue, undoing = false) {
    const key = `${productId}:opensAs`;
    const current = latest.current[productId];

    if (!canWriteCatalog || !current || inflight.current.has(key) || current.opensAs === mode) {
      return;
    }

    const previous = current.opensAs;
    inflight.current.add(key);
    patch(productId, { error: null, opensAs: mode, opensAsPending: true });
    const result = await requestOpensAsChange(productId, mode);
    inflight.current.delete(key);

    if (!result.ok) {
      patch(productId, { error: { ...result.error, title: "“Como abre” não mudou." }, opensAs: previous, opensAsPending: false });
      return;
    }

    patch(productId, { opensAsPending: false });
    // Atualiza o cache do roteador: voltar para esta tela (botao Voltar) mostra o que foi gravado.
    router.refresh();

    if (!undoing) {
      adminToast.success(OPENS_AS_TOASTS[mode], { onUndo: () => void changeOpensAs(productId, previous, true) });
    }
  }

  async function changeHomeRow(productId: string, desired: HomeRowDesired, undoing = false) {
    const key = `${productId}:homeRow`;
    const current = latest.current[productId];

    if (!canWriteStorefront || !current || inflight.current.has(key) || current.homeRow.status === "unavailable") {
      return;
    }

    const previous = current.homeRow;
    inflight.current.add(key);
    patch(productId, { error: null, homeRow: optimisticHomeRow(previous, desired), homeRowPending: true, homeTitleError: null });
    const result = await requestHomeRowChange(productId, desired);
    inflight.current.delete(key);

    if (!result.ok) {
      patch(productId, {
        error: result.titleError ? null : { ...result.error, title: "A fileira da home não mudou." },
        homeRow: previous,
        homeRowPending: false,
        homeTitleError: result.titleError ?? null
      });
      return;
    }

    patch(productId, { homeRow: result.state, homeRowPending: false });
    router.refresh();
    const undo = undoHomeRowChange(previous, result.state);

    if (!undoing) {
      adminToast.success(
        describeHomeRowChange(previous, result.state),
        undo ? { onUndo: () => void changeHomeRow(productId, undo, true) } : undefined
      );
    }
  }

  function renderError(row: ModuleSettingsRow, state: LiveRow) {
    if (!state.error) {
      return null;
    }

    return (
      <ErrorBanner
        action={
          <>
            {state.error.reload ? (
              <Button className="h-8! px-3" onClick={() => router.refresh()} type="button" variant="secondary">
                Recarregar
              </Button>
            ) : null}
            <Button className="h-8! px-3 text-[var(--text-secondary)]" onClick={() => patch(row.productId, { error: null })} type="button" variant="ghost">
              Fechar
            </Button>
          </>
        }
        title={`${state.error.title} (${row.title})`}
      >
        {state.error.message}
      </ErrorBanner>
    );
  }

  function opensAsControl(row: ModuleSettingsRow, state: LiveRow, variant: "card" | "table") {
    return (
      <OpensAsPills
        compact={variant === "table"}
        disabled={!canWriteCatalog}
        label={`Como ${row.title} abre para o aluno`}
        name={`como-abre-${variant}-${row.productId}`}
        onChange={(mode) => void changeOpensAs(row.productId, mode)}
        pending={state.opensAsPending}
        value={state.opensAs}
      />
    );
  }

  function homeRowControl(row: ModuleSettingsRow, state: LiveRow, variant: "card" | "table") {
    const home = state.homeRow;

    if (home.status === "unavailable") {
      return <p className="text-xs leading-5 text-[var(--text-secondary)]">{home.note}</p>;
    }

    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-start gap-2">
          <RowSwitch
            checked={home.status === "on"}
            disabled={!canWriteStorefront}
            label={`Mostrar os módulos de ${row.title} numa fileira da home`}
            onChange={(checked) => void changeHomeRow(row.productId, { enabled: checked })}
            pending={state.homeRowPending}
          />
          {home.sectionId ? (
            <HomeRowTitleInput
              busy={state.homeRowPending}
              disabled={!canWriteStorefront}
              error={state.homeTitleError}
              id={`fileira-titulo-${variant}-${row.productId}`}
              label={`Título da fileira de ${row.title}`}
              onCommit={(title) => void changeHomeRow(row.productId, { enabled: home.status === "on", title })}
              title={home.title}
            />
          ) : (
            <p className="flex min-h-11 min-w-0 flex-1 items-center text-[13px] leading-5 text-[var(--text-secondary)] @min-[900px]:min-h-9">
              {home.status === "on" ? home.title : "Desligada"}
            </p>
          )}
        </div>
        {home.note ? <p className="text-xs leading-4 text-[var(--text-tertiary)]">{home.note}</p> : null}
      </div>
    );
  }

  function coversLabel(row: ModuleSettingsRow) {
    return describeModuleCovers(row.modulesWithOwnCover, row.modulesCount);
  }

  return (
    <div className="@container min-w-0">
      <div className={cn(adminCard, "hidden overflow-hidden @min-[900px]:block")}>
        <table className="w-full table-fixed border-collapse text-sm text-[var(--text-primary)]">
          <caption className="sr-only">Como cada curso abre, a fileira de módulos na home e as capas dos módulos</caption>
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className={cn(headCell, "pl-4")} scope="col">
                Produto
              </th>
              <th className={cn(headCell, "w-[264px]")} scope="col">
                Como abre
              </th>
              <th className={cn(headCell, "w-[272px]")} scope="col">
                Fileira na home
              </th>
              <th className={cn(headCell, "w-[120px] @min-[1100px]:w-[176px]")} scope="col">
                Capas
              </th>
              <th className={cn(headCell, "w-14 pr-4 @min-[1100px]:w-[164px]")} scope="col">
                <span className="sr-only">Conteúdo</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = live[row.productId] ?? fromServer(row);
              const error = renderError(row, state);

              return (
                <Fragment key={row.productId}>
                  <tr className={cn("border-b border-[var(--border-subtle)] last:border-b-0", error && "border-b-0")}>
                    <td className={cn(bodyCell, "pl-4")}>
                      <ProductCell row={row} />
                    </td>
                    <td className={bodyCell}>{opensAsControl(row, state, "table")}</td>
                    <td className={bodyCell}>{homeRowControl(row, state, "table")}</td>
                    <td className={cn(bodyCell, "text-sm leading-5 text-[var(--text-secondary)]")}>{coversLabel(row)}</td>
                    <td className={cn(bodyCell, "pr-4")}>
                      <ContentLink compact row={row} />
                    </td>
                  </tr>
                  {error ? (
                    <tr className="border-b border-[var(--border-subtle)] last:border-b-0">
                      <td className="px-4 pb-3" colSpan={5}>
                        {error}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul aria-label="Cursos" className="flex flex-col gap-3 @min-[900px]:hidden">
        {rows.map((row) => {
          const state = live[row.productId] ?? fromServer(row);

          return (
            <li className={cn(adminCard, "flex min-w-0 flex-col gap-4 p-4")} key={row.productId}>
              <ProductCell row={row} wrap />
              {renderError(row, state)}
              <div className="grid min-w-0 gap-4 @min-[640px]:grid-cols-2 @min-[640px]:gap-6">
                <CardField label="Como abre">
                  {opensAsControl(row, state, "card")}
                  <p className="text-xs leading-5 text-[var(--text-secondary)]">{PRESENTATION_MODE_HINTS[state.opensAs]}</p>
                </CardField>
                <CardField label="Fileira na home">{homeRowControl(row, state, "card")}</CardField>
              </div>
              <CardField label="Capas dos módulos">
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{coversLabel(row)}</p>
              </CardField>
              <div className="-mx-3 -mb-2 border-t border-[var(--border-subtle)] pt-2">
                <ContentLink row={row} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProductCell({ row, wrap = false }: { row: ModuleSettingsRow; wrap?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProductThumb accent={row.accent} coverUrl={row.coverUrl} size={wrap ? "md" : "sm"} title={row.title} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className={cn("text-sm leading-5 font-medium text-[var(--text-primary)]", wrap ? "break-words" : "truncate")} title={row.title}>
          {row.title}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs leading-4 text-[var(--text-secondary)]">
          {row.formatLabel}
          <StatusChip className="h-5" tone={situationTone(row.situation)}>
            {PRODUCT_SITUATION_LABELS[row.situation]}
          </StatusChip>
        </span>
      </div>
    </div>
  );
}

function ContentLink({ compact = false, row }: { compact?: boolean; row: ModuleSettingsRow }) {
  return (
    <Link
      aria-label={`Abrir conteúdo de ${row.title}`}
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "h-11 shrink-0 gap-1.5 px-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
        compact && "h-8 w-8 px-0 @min-[1100px]:h-9 @min-[1100px]:w-auto @min-[1100px]:px-3",
        adminTransition
      )}
      data-navigation-feedback="false"
      data-slot="button"
      href={row.contentHref}
      title="Abrir conteúdo"
    >
      <span className={cn(compact && "hidden @min-[1100px]:inline")}>Abrir conteúdo</span>
      <ArrowUpRight aria-hidden="true" className="size-4" />
    </Link>
  );
}

function CardField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{label}</span>
      {children}
    </div>
  );
}
