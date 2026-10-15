import { Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatRatingBalance } from "@/server/community/model";
import type { LessonCommunityRow } from "@/server/community/types";
import { adminCard, adminTransition } from "../styles";
import { communityHref, type SearchParamsRecord } from "./hrefs";
import { LESSON_ROWS_SORT_OPTIONS, describeRatings, ratingSegments, ratingTone, type RatingTone } from "./lesson-rows-model";

// Aba Aulas (docs/17 §1.9 e §1.11): por aula, duvidas no periodo (comentarios, sem resposta,
// perguntas ao Tutor IA) e avaliacao desde sempre (Não gostei / Gostei / Amei numa barra 100 % com os
// numeros escritos ao lado, mais o saldo). O saldo so ganha cor com 20 respostas ou mais.
// Cabe na largura sem rolar (table-fixed + colunas por largura do cartao); abaixo de 640 px vira lista.

const integer = new Intl.NumberFormat("pt-BR");
const headCell = "h-9 px-3 text-left text-xs leading-4 font-medium whitespace-nowrap text-[var(--text-tertiary)]";
const openLinkClass = cn(
  "inline-flex h-8 items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-[13px] font-medium whitespace-nowrap text-[var(--text-primary)] hover:bg-[var(--surface-3)]",
  adminTransition
);

const SEGMENT_COLORS = {
  liked: "bg-[var(--series-2)]",
  loved: "bg-[var(--success)]",
  notForMe: "bg-[var(--error)]"
} as const;

const TONE_CLASS: Record<RatingTone, string> = {
  insufficient: "text-[var(--text-secondary)]",
  negative: "text-[var(--error)]",
  neutral: "text-[var(--text-primary)]",
  none: "text-[var(--text-tertiary)]",
  positive: "text-[var(--success)]"
};

function toneTitle(tone: RatingTone, total: number) {
  if (tone === "insufficient") {
    return `Só ${total} ${total === 1 ? "resposta" : "respostas"}: espere 20 ou mais antes de mudar a aula.`;
  }

  if (tone === "negative") {
    return "Avaliação negativa com respostas suficientes: vale regravar ou mover esta aula.";
  }

  return "Saldo = (Amei − Não gostei) ÷ respostas.";
}

export function RatingBar({ className, row }: { className?: string; row: LessonCommunityRow }) {
  const segments = ratingSegments(row.ratings);
  const total = row.ratings.total;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div
        aria-label={describeRatings(row.ratings)}
        className="flex h-1.5 w-full min-w-0 overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="img"
      >
        {total > 0
          ? segments.map((segment) =>
              segment.percent > 0 ? (
                <span className={cn("h-full", SEGMENT_COLORS[segment.key])} key={segment.key} style={{ width: `${segment.percent}%` }} />
              ) : null
            )
          : null}
      </div>
      <span aria-hidden="true" className="truncate text-xs leading-4 text-[var(--text-tertiary)] tabular-nums">
        {total > 0 ? `${integer.format(row.ratings.notForMe)} · ${integer.format(row.ratings.liked)} · ${integer.format(row.ratings.loved)}` : "sem avaliações"}
      </span>
    </div>
  );
}

function BalanceCell({ row }: { row: LessonCommunityRow }) {
  const tone = ratingTone(row.ratings.balance, row.ratings.total);

  return (
    <span className={cn("font-medium tabular-nums", TONE_CLASS[tone])} title={toneTitle(tone, row.ratings.total)}>
      {formatRatingBalance(row.ratings.balance)}
    </span>
  );
}

function LessonCell({ row }: { row: LessonCommunityRow }) {
  const context = [row.path.productTitle, row.path.moduleTitle].filter(Boolean).join(" › ");

  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]" title={row.path.lessonTitle}>
        {row.path.lessonTitle}
      </span>
      <span className="truncate text-xs leading-5 text-[var(--text-tertiary)]" title={context}>
        {context}
      </span>
    </div>
  );
}

type LessonRowsTableProps = {
  items: readonly LessonCommunityRow[];
  /** Periodo no meio da frase: "nos últimos 30 dias", "hoje". */
  periodLabel: string;
};

export function LessonRowsTable({ items, periodLabel }: LessonRowsTableProps) {
  return (
    <div className="@container min-w-0">
      <div className={cn(adminCard, "hidden overflow-hidden @min-[640px]:block")}>
        <table className="w-full table-fixed border-collapse text-sm text-[var(--text-primary)]">
          <caption className="sr-only">
            Dúvidas por aula {periodLabel} e avaliação das aulas desde sempre
          </caption>
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className={cn(headCell, "pl-4")} scope="col">
                Aula
              </th>
              <th className={cn(headCell, "w-[108px] text-right")} scope="col" title={`Comentários de alunos ${periodLabel}, sem spam.`}>
                Comentários
              </th>
              <th
                className={cn(headCell, "hidden w-[116px] text-right @min-[820px]:table-cell")}
                scope="col"
                title="Perguntas de alunos esperando resposta do professor agora."
              >
                Sem resposta
              </th>
              <th
                className={cn(headCell, "hidden w-[92px] text-right @min-[900px]:table-cell")}
                scope="col"
                title={`Mensagens de alunos ao Tutor IA nesta aula ${periodLabel}.`}
              >
                Tutor IA
              </th>
              <th className={cn(headCell, "hidden w-[184px] @min-[760px]:table-cell")} scope="col" title="Não gostei · Gostei · Amei, desde sempre.">
                Avaliação
              </th>
              <th className={cn(headCell, "w-[76px] text-right")} scope="col" title="Saldo = (Amei − Não gostei) ÷ respostas.">
                Saldo
              </th>
              <th className={cn(headCell, "w-[120px] pr-4")} scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr className={cn("h-14 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--hover-overlay)]", adminTransition)} key={row.path.lessonId}>
                <td className="min-w-0 px-3 pl-4">
                  <LessonCell row={row} />
                </td>
                <td className="px-3 text-right tabular-nums">{integer.format(row.comments)}</td>
                <td
                  className={cn(
                    "hidden px-3 text-right tabular-nums @min-[820px]:table-cell",
                    row.unanswered > 0 ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"
                  )}
                >
                  {integer.format(row.unanswered)}
                </td>
                <td className="hidden px-3 text-right text-[var(--text-secondary)] tabular-nums @min-[900px]:table-cell">
                  {integer.format(row.tutorQuestions)}
                </td>
                <td className="hidden px-3 @min-[760px]:table-cell">
                  <RatingBar row={row} />
                </td>
                <td className="px-3 text-right">
                  <BalanceCell row={row} />
                </td>
                <td className="px-3 pr-4 text-right">
                  {row.path.adminHref ? (
                    <Link className={openLinkClass} data-navigation-feedback="false" href={row.path.adminHref}>
                      Abrir aula
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="Aulas" className="flex flex-col gap-2 @min-[640px]:hidden">
        {items.map((row) => (
          <li className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-3")} key={row.path.lessonId}>
            <LessonCell row={row} />
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-[var(--text-secondary)] tabular-nums">
              <span>{integer.format(row.comments)} comentários</span>
              <span className={row.unanswered > 0 ? "text-[var(--warning)]" : undefined}>{integer.format(row.unanswered)} sem resposta</span>
              <span>{integer.format(row.tutorQuestions)} no Tutor IA</span>
            </p>
            <div className="flex items-center gap-3">
              <RatingBar className="flex-1" row={row} />
              <BalanceCell row={row} />
            </div>
            {row.path.adminHref ? (
              <Link className={cn(openLinkClass, "h-11 justify-center")} data-navigation-feedback="false" href={row.path.adminHref}>
                Abrir aula
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

type LessonSortPillsProps = {
  active: (typeof LESSON_ROWS_SORT_OPTIONS)[number]["sort"];
  pathname: string;
  searchParams: SearchParamsRecord;
};

/** Ordem da tabela em pilulas-link (?ordem=), com a legenda da barra de avaliacao ao lado. */
export function LessonSortBar({ active, pathname, searchParams }: LessonSortPillsProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <nav aria-label="Ordenar aulas" className="flex min-w-0 flex-wrap gap-2">
        {LESSON_ROWS_SORT_OPTIONS.map((option) => {
          const selected = option.sort === active;

          return (
            <Link
              aria-current={selected ? "true" : undefined}
              className={cn(
                "inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap md:h-9",
                selected
                  ? "border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]"
                  : "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
                adminTransition
              )}
              data-navigation-feedback="false"
              href={communityHref(pathname, searchParams, { ordem: option.value })}
              key={option.sort}
              scroll={false}
            >
              {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
              {option.label}
            </Link>
          );
        })}
      </nav>
      <p aria-hidden="true" className="flex items-center gap-3 text-xs leading-5 font-medium text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", SEGMENT_COLORS.notForMe)} />
          Não gostei
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", SEGMENT_COLORS.liked)} />
          Gostei
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", SEGMENT_COLORS.loved)} />
          Amei
        </span>
      </p>
    </div>
  );
}
