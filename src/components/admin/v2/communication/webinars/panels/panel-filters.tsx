"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { PanelFilters } from "@/server/webinars/export-schemas";
import { OFFER_VARIANT_LABELS, type OfferVariantLabel } from "@/server/webinars/model";
import { PANEL_SITUATION_VALUES, panelHref, type PanelFilterOptions, type PanelSituation, type PanelTabKind } from "@/server/webinars/panel-model";
import { adminInputClass, adminPillClasses } from "../../../form";

// Os filtros da aba (docs/30 §3.2 e §3.3), no endereco: Lives ao vivo com Situacao (Realizadas · Agendadas ·
// Canceladas; sem nenhuma marcada, as realizadas e as agendadas, nunca as canceladas), Apresentador e Produto; Lives
// gravadas com Webinario, Horario do dia (hora de Sao Paulo), Com oferta, Variante e Produto. Poucas opcoes viram
// pilulas (links, funcionam sem JavaScript; clicar na marcada tira o filtro, como o tipo na lista); listas longas
// viram <select> com rotulo para o leitor de tela, que troca o endereco ao escolher. Toda troca tira a sessao da curva
// (?sessao=) e leva o periodo da barra junto. As opcoes saem das sessoes do periodo.

const COPY = WEBINAR_COPY.paineis.filtros;
const pillFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";
const selectClass = cn(adminInputClass, "h-9 w-full bg-[var(--surface-1)] text-[13px] md:w-auto md:max-w-[260px] md:min-w-[180px] pointer-coarse:h-11");

type PanelFiltersBarProps = {
  /** O botao Exportar do painel (o menu fica a direita dos filtros). */
  actions?: ReactNode;
  filters: PanelFilters;
  hasFilters: boolean;
  kind: PanelTabKind;
  options: PanelFilterOptions;
  periodo: string | null;
};

function Pill({ active, children, href }: { active: boolean; children: ReactNode; href: string }) {
  return (
    <Link aria-current={active ? "page" : undefined} className={cn(adminPillClasses(active), pillFocus)} data-navigation-feedback="false" href={href} scroll={false}>
      {children}
    </Link>
  );
}

function SelectFilter({
  allLabel,
  label,
  onChange,
  options,
  value
}: {
  allLabel: string;
  label: string;
  onChange: (value: string | null) => void;
  options: readonly { id: string; label: string }[];
  value: string | null;
}) {
  return (
    <label className="block w-full min-w-0 md:w-auto">
      <span className="sr-only">{label}</span>
      <select className={selectClass} onChange={(event) => onChange(event.target.value || null)} value={value ?? ""}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PanelFiltersBar({ actions, filters, hasFilters, kind, options, periodo }: PanelFiltersBarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = (patch: Partial<PanelFilters>) => panelHref({ filters: { ...filters, ...patch }, kind, periodo });
  const go = (patch: Partial<PanelFilters>) => startTransition(() => router.replace(href(patch), { scroll: false }));
  const situations = Object.keys(PANEL_SITUATION_VALUES) as PanelSituation[];
  const variants = OFFER_VARIANT_LABELS.filter((label) => options.variants.includes(label) || filters.variant === label);

  return (
    <div aria-busy={pending || undefined} className="flex min-w-0 flex-col gap-2" data-panel-filters="" role="search">
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        {kind === "live" ? (
          <>
            {options.hosts.length > 0 || filters.hostUserId ? (
              <SelectFilter allLabel={COPY.todosApresentadores} label={COPY.apresentador} onChange={(value) => go({ hostUserId: value })} options={options.hosts} value={filters.hostUserId} />
            ) : null}
          </>
        ) : (
          <>
            {options.webinars.length > 0 || filters.webinarId ? (
              <SelectFilter allLabel={COPY.todosWebinarios} label={COPY.webinario} onChange={(value) => go({ webinarId: value })} options={options.webinars} value={filters.webinarId} />
            ) : null}
            <SelectFilter
              allLabel={COPY.qualquerHorario}
              label={COPY.horarioDoDia}
              onChange={(value) => go({ hour: value === null ? null : Number(value) })}
              options={[...new Set([...options.hours, ...(typeof filters.hour === "number" ? [filters.hour] : [])])]
                .sort((left, right) => left - right)
                .map((hour) => ({ id: String(hour), label: WEBINAR_COPY.paineis.graficos.hora(hour) }))}
              value={typeof filters.hour === "number" ? String(filters.hour) : null}
            />
          </>
        )}
        {options.products.length > 0 || filters.productId ? (
          <SelectFilter allLabel={COPY.todosProdutos} label={COPY.produto} onChange={(value) => go({ productId: value })} options={options.products} value={filters.productId} />
        ) : null}
        {actions ? <div className="flex shrink-0 items-center gap-2 md:ml-auto">{actions}</div> : null}
      </div>

      {kind === "live" ? (
        <nav aria-label={COPY.situacao} className="flex min-w-0 flex-wrap gap-2">
          {situations.map((situation) => (
            <Pill active={filters.situation === situation} href={href({ situation: filters.situation === situation ? null : situation })} key={situation}>
              {COPY.situacoes[situation]}
            </Pill>
          ))}
        </nav>
      ) : options.withOffer || filters.withOffer || variants.length > 0 ? (
        <nav aria-label={COPY.rotulo} className="flex min-w-0 flex-wrap gap-2">
          {options.withOffer || filters.withOffer ? (
            <Pill active={filters.withOffer} href={href({ withOffer: !filters.withOffer })}>
              {COPY.comOferta}
            </Pill>
          ) : null}
          {variants.map((label: OfferVariantLabel) => (
            <Pill active={filters.variant === label} href={href({ variant: filters.variant === label ? null : label })} key={label}>
              {COPY.varianteN(label)}
            </Pill>
          ))}
        </nav>
      ) : null}

      {hasFilters ? (
        <div>
          <Link
            className="text-[13px] leading-5 font-medium text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline"
            data-navigation-feedback="false"
            href={panelHref({ filters: {}, kind, periodo })}
            scroll={false}
          >
            {COPY.limpar}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
