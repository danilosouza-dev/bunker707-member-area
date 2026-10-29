import { Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ReportBar } from "@/server/webinars/report-page-model";
import { adminCard } from "../../../styles";

// Pecas da aba Relatorio do webinario (docs/30 §3.4), no desenho do relatorio do pop-up (popup-report-section.tsx):
// blocos em card com o titulo (h2), barras horizontais simples com o numero escrito ao lado (a barra fora do leitor
// de tela, nada de pizza), listas de pessoas com a posicao e a nota em texto. Sem hooks: tudo desenha no servidor.

type ReportBlockProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  id: string;
  title: string;
};

export function ReportBlock({ actions, children, className, description, id, title }: ReportBlockProps) {
  return (
    <section aria-labelledby={id} className={cn(adminCard, "flex min-w-0 flex-col gap-4 p-4", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id={id}>
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function ReportNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function ReportEmpty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">{children}</p>;
}

/** Subtitulo dentro de um bloco (h3). */
export function ReportSubheading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]" id={id}>
      {children}
    </h3>
  );
}

type ReportBarsProps = {
  bars: readonly ReportBar[];
  caption: string;
  emptyText: string;
  /** O que fica escrito ao lado do nome ("12 mensagens · 4 alunos"). */
  format: (bar: ReportBar) => string;
};

/** Uma barra por item: o nome, o numero escrito e a porcentagem; a barra repete a porcentagem (aria-hidden). */
export function ReportBars({ bars, caption, emptyText, format }: ReportBarsProps) {
  if (bars.length === 0) {
    return <ReportEmpty>{emptyText}</ReportEmpty>;
  }

  return (
    <ul aria-label={caption} className="flex min-w-0 flex-col gap-3">
      {bars.map((bar) => (
        <li className="flex min-w-0 flex-col gap-1.5" key={bar.id}>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm leading-5">
            <span className="min-w-0 text-[var(--text-primary)] [overflow-wrap:anywhere]">{bar.label}</span>
            <span className="text-[13px] text-[var(--text-secondary)] tabular-nums">
              {format(bar)}
              {bar.percent !== null ? ` · ${bar.percent} %` : ""}
            </span>
          </div>
          <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="h-full rounded-full bg-[var(--text-primary)]/25" style={{ width: `${Math.min(100, bar.percent ?? 0)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export type ReportPersonItem = { href?: string; id: string; label: string; meta: string };

/** "Quem mais comentou", "Mais quentes", "Mais votadas": a posicao, o nome (link para a ficha) e a nota. */
export function ReportRanking({ caption, emptyText, items }: { caption: string; emptyText: string; items: readonly ReportPersonItem[] }) {
  if (items.length === 0) {
    return <ReportEmpty>{emptyText}</ReportEmpty>;
  }

  return (
    <ol aria-label={caption} className="flex min-w-0 flex-col divide-y divide-[var(--border-subtle)]">
      {items.map((item, index) => (
        <li className="flex min-w-0 items-baseline gap-3 py-2 text-sm leading-5 first:pt-0 last:pb-0" key={item.id}>
          <span className="w-5 shrink-0 text-[13px] text-[var(--text-tertiary)] tabular-nums">{index + 1}.</span>
          <span className="min-w-0 flex-1 text-[var(--text-primary)] [overflow-wrap:anywhere]">
            {item.href ? (
              <Link className="underline-offset-4 hover:underline" href={item.href}>
                {item.label}
              </Link>
            ) : (
              item.label
            )}
          </span>
          <span className="shrink-0 text-[13px] text-[var(--text-secondary)] tabular-nums">{item.meta}</span>
        </li>
      ))}
    </ol>
  );
}

export type ReportFact = { label: string; value: string };

/** Pares rotulo/valor ("Vistos: 12"), em <dl>, duas colunas no computador. */
export function ReportFacts({ items }: { items: readonly ReportFact[] }) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm leading-5 sm:grid-cols-2">
      {items.map((item) => (
        <div className="flex min-w-0 justify-between gap-3 border-b border-[var(--border-subtle)] pb-2" key={item.label}>
          <dt className="text-[var(--text-tertiary)]">{item.label}</dt>
          <dd className="text-[var(--text-primary)] tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
