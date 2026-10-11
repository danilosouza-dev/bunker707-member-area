import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TopCommenter } from "@/server/community/types";
import { adminCard, adminTransition } from "../styles";
import { AuthorAvatar } from "./author-avatar";
import { studentSearchHref } from "./hrefs";

// Aba Top alunos (docs/17 §1.9 e §1.11): quem mais comenta, responde colegas e recebe reacoes nos
// ultimos 28 dias, sem a equipe. Pontos = comentarios + respostas a colegas + reacoes recebidas.
// Cabe na largura sem rolar (table-fixed + colunas por largura do cartao); abaixo de 600 px vira lista.

const integer = new Intl.NumberFormat("pt-BR");
const headCell = "h-9 px-3 text-left text-xs leading-4 font-medium whitespace-nowrap text-[var(--text-tertiary)]";
const linkClass = cn(
  "inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
  adminTransition
);

type TopTableProps = {
  items: readonly TopCommenter[];
  windowDays: number;
};

export function TopTable({ items, windowDays }: TopTableProps) {
  return (
    <section aria-labelledby="top-alunos-title" className={cn(adminCard, "@container min-w-0 overflow-hidden")}>
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="top-alunos-title">
          Top alunos
        </h2>
        <p className="text-xs leading-5 font-medium text-[var(--text-tertiary)]">
          últimos {windowDays} dias · pontos = comentários + respostas a colegas + reações recebidas
        </p>
      </header>

      <table className="hidden w-full table-fixed border-collapse text-sm text-[var(--text-primary)] @min-[600px]:table">
        <caption className="sr-only">Alunos que mais participam da comunidade nos últimos {windowDays} dias</caption>
        <thead>
          <tr className="border-b border-[var(--border-subtle)]">
            <th className={cn(headCell, "w-12 pl-4 text-right")} scope="col">
              <span className="sr-only">Posição</span>#
            </th>
            <th className={headCell} scope="col">
              Aluno
            </th>
            <th className={cn(headCell, "w-[112px] text-right")} scope="col">
              Comentários
            </th>
            <th className={cn(headCell, "hidden w-[168px] text-right @min-[760px]:table-cell")} scope="col">
              Respostas a colegas
            </th>
            <th className={cn(headCell, "hidden w-[156px] text-right @min-[880px]:table-cell")} scope="col">
              Reações recebidas
            </th>
            <th className={cn(headCell, "w-[88px] text-right")} scope="col">
              Pontos
            </th>
            <th className={cn(headCell, "w-[120px] pr-4")} scope="col">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr className={cn("h-12 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--hover-overlay)]", adminTransition)} key={item.author.id ?? `${item.author.name}-${index}`}>
              <td className="pl-4 text-right text-[13px] text-[var(--text-tertiary)] tabular-nums">{index + 1}</td>
              <td className="px-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <AuthorAvatar initials={item.author.initials} size="sm" />
                  <span className="truncate font-medium" title={item.author.name}>
                    {item.author.name}
                  </span>
                </div>
              </td>
              <td className="px-3 text-right tabular-nums">{integer.format(item.comments)}</td>
              <td className="hidden px-3 text-right tabular-nums @min-[760px]:table-cell">{integer.format(item.repliesToPeers)}</td>
              <td className="hidden px-3 text-right tabular-nums @min-[880px]:table-cell">{integer.format(item.reactionsReceived)}</td>
              <td className="px-3 text-right font-semibold tabular-nums">{integer.format(item.score)}</td>
              <td className="px-3 pr-4 text-right">
                <Link className={linkClass} data-navigation-feedback="false" href={studentSearchHref(item.author.name)}>
                  Ver aluno
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ol aria-label="Top alunos" className="flex flex-col @min-[600px]:hidden">
        {items.map((item, index) => (
          <li className="border-b border-[var(--border-subtle)] last:border-b-0" key={item.author.id ?? `${item.author.name}-${index}`}>
            <Link
              className={cn("flex min-h-16 min-w-0 items-center gap-3 px-4 py-3 hover:bg-[var(--hover-overlay)]", adminTransition)}
              data-navigation-feedback="false"
              href={studentSearchHref(item.author.name)}
            >
              <span className="w-5 shrink-0 text-right text-[13px] text-[var(--text-tertiary)] tabular-nums">{index + 1}</span>
              <AuthorAvatar initials={item.author.initials} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{item.author.name}</span>
                <span className="block truncate text-xs leading-5 text-[var(--text-secondary)] tabular-nums">
                  {integer.format(item.comments)} coment. · {integer.format(item.repliesToPeers)} resp. · {integer.format(item.reactionsReceived)} reações
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-[var(--text-primary)] tabular-nums">{integer.format(item.score)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
