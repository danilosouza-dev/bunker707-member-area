"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CalendarClock,
  CircleCheck,
  CirclePlay,
  Layers3,
  LibraryBig,
  LifeBuoy,
  ListChecks,
  LockKeyhole,
  Play,
  RotateCcw,
  SearchX,
  type LucideIcon
} from "lucide-react";
import { MemberButton, MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberFilterPills, MemberSearchField, type MemberFilterOption } from "@/components/member/ui/member-filters";
import { MemberPage, MemberPageHeader } from "@/components/member/ui/member-page";
import { MemberPosterCard, memberPosterGridClassName } from "@/components/member/ui/member-poster-card";
import { MemberStat, MemberStatGrid } from "@/components/member/ui/member-stat";
import { formatMemberCount } from "@/lib/member-format";
import type { ContentItem, ContentKind } from "@/lib/platform-types";
import { cn } from "@/lib/utils";
import {
  buildPurchasesPreviewView,
  getPurchaseLessonsMeta,
  normalizeMemberSearchText,
  type PurchaseProductView,
  type PurchaseResumeKind,
  type PurchaseStatusFilter,
  type PurchasesPageView
} from "@/server/member-area/purchases-view";

// Minhas compras (cliente leve): recebe so o recorte montado no servidor (buildPurchasesPageView) e
// cuida de filtro e busca. Progresso e situacao sao do proprio aluno; nada vem de content_items.progress.

type PurchasesExperienceProps =
  | { items?: never; view: PurchasesPageView }
  /** Previa de layout da tela antiga do admin (/admin/legado): itens do catalogo, sem aluno. */
  | { items: ContentItem[]; view?: never };

type KindFilter = "all" | ContentKind;

const resumeVerbs: Record<PurchaseResumeKind, { icon: LucideIcon; label: string }> = {
  browse: { icon: Layers3, label: "Ver cursos" },
  continue: { icon: Play, label: "Continuar" },
  review: { icon: RotateCcw, label: "Revisar" },
  start: { icon: Play, label: "Começar" }
};

const statusFilterLabels: Record<PurchaseStatusFilter, string> = {
  all: "Todos",
  completed: "Concluídos",
  in_progress: "Em andamento",
  not_started: "Não iniciados"
};

function PurchaseResumeLink({ product }: { product: PurchaseProductView }) {
  if (!product.resumeHref || !product.resumeKind) {
    return null;
  }

  const verb = resumeVerbs[product.resumeKind];
  const Icon = verb.icon;
  const highlighted = product.resumeKind === "continue" || product.resumeKind === "start";

  return (
    <Link
      aria-label={product.resumeAriaLabel ?? undefined}
      className="group/resume mt-2.5 flex min-w-0 items-center gap-2.5 rounded-[8px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      href={product.resumeHref}
      title={product.resumeLabel ?? undefined}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full transition-[transform,background-color] duration-200 group-hover/resume:scale-105 motion-reduce:transition-none motion-reduce:group-hover/resume:scale-100",
          highlighted ? "bg-white text-black group-hover/resume:bg-zinc-200" : "bg-white/[0.08] text-white ring-1 ring-white/10 group-hover/resume:bg-white/[0.14]"
        )}
      >
        <Icon className={cn("size-3.5", verb.icon === Play ? "ml-0.5 fill-current" : "")} strokeWidth={2.4} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-semibold text-white">{verb.label}</span>
        {product.resumeLessonTitle ? (
          <span className="mt-0.5 block truncate text-xs text-zinc-400 transition-colors group-hover/resume:text-zinc-300">
            {product.resumeLessonTitle}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function PurchaseInfoLines({ product }: { product: PurchaseProductView }) {
  const releaseLine = product.releaseLabel
    ? product.releaseLabel
    : product.lockedLessons > 0
      ? `${formatMemberCount(product.lockedLessons, "aula")} para liberar`
      : null;

  if (!releaseLine && !product.accessLabel) {
    return null;
  }

  return (
    <div className="mt-2.5 grid gap-1.5 text-[11px] font-medium leading-4">
      {releaseLine ? (
        <p className={cn("flex min-w-0 items-start gap-1.5", product.releaseLabel ? "text-amber-200" : "text-zinc-400")}>
          <LockKeyhole aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={2.2} />
          <span className="min-w-0">{releaseLine}</span>
        </p>
      ) : null}
      {product.accessLabel ? (
        <p className={cn("flex min-w-0 items-start gap-1.5", product.accessEndsSoon ? "text-amber-200" : "text-zinc-500")}>
          <CalendarClock aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={2.2} />
          <span className="min-w-0">{product.accessLabel}</span>
        </p>
      ) : null}
    </div>
  );
}

function PurchaseProductCard({
  priority,
  product,
  showProgress
}: {
  priority: boolean;
  product: PurchaseProductView;
  showProgress: boolean;
}) {
  const lessonsMeta = getPurchaseLessonsMeta(product);

  return (
    <>
      <MemberPosterCard
        ariaLabel={`Abrir ${product.title}`}
        badge={
          <>
            <MemberChip tone="solid">{product.kindLabel}</MemberChip>
            {product.status === "completed" ? (
              <MemberChip className="border-emerald-400/40 bg-black/70 text-emerald-200 backdrop-blur" icon={CircleCheck} tone="success">
                Concluído
              </MemberChip>
            ) : null}
          </>
        }
        href={product.href}
        image={product.image}
        meta={
          !showProgress
            ? product.eyebrow || undefined
            : product.status === "not_started" || product.totalLessons === 0
              ? lessonsMeta
              : `${lessonsMeta} · ${product.percent}%`
        }
        priority={priority}
        progress={
          product.status === "not_started"
            ? undefined
            : { label: `Seu progresso em ${product.title}: ${product.percent}%`, value: product.percent }
        }
        title={product.title}
      />
      <PurchaseResumeLink product={product} />
      <PurchaseInfoLines product={product} />
    </>
  );
}

function ContinueAction({ target }: { target: NonNullable<PurchasesPageView["continueTarget"]> }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col items-start gap-2 lg:items-end">
      <MemberButtonLink
        aria-label={`Continuar de onde parei: ${target.lessonTitle}, em ${target.productTitle}`}
        href={target.href}
        size="lg"
        variant="primary"
      >
        <Play className="ml-0.5 fill-current" />
        Continuar de onde parei
      </MemberButtonLink>
      <p className="max-w-[20rem] truncate text-xs text-zinc-500" title={`${target.lessonTitle} · ${target.productTitle}`}>
        {target.lessonTitle} <span aria-hidden="true">·</span> {target.productTitle}
      </p>
    </div>
  );
}

export function PurchasesExperience(props: PurchasesExperienceProps) {
  const { items, view: serverView } = props;
  const view = useMemo(() => serverView ?? buildPurchasesPreviewView(items ?? []), [items, serverView]);
  const [statusFilter, setStatusFilter] = useState<PurchaseStatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeMemberSearchText(query);
  const { products, stats } = view;

  const statusOptions = useMemo<MemberFilterOption<PurchaseStatusFilter>[]>(() => {
    const counts: Record<PurchaseStatusFilter, number> = {
      all: stats.products,
      completed: stats.completed,
      in_progress: stats.inProgress,
      not_started: stats.notStarted
    };

    return (["all", "in_progress", "not_started", "completed"] as const)
      .filter((id) => id === "all" || counts[id] > 0)
      .map((id) => ({ count: counts[id], id, label: statusFilterLabels[id] }));
  }, [stats]);

  const kindOptions = useMemo<MemberFilterOption<KindFilter>[]>(() => [
    { id: "all", label: "Todos os tipos" },
    ...view.kindOptions.map((option) => ({ count: option.count, id: option.id, label: option.label }))
  ], [view.kindOptions]);

  const filteredProducts = useMemo(() => products.filter((product) => (
    (statusFilter === "all" || product.status === statusFilter) &&
    (kindFilter === "all" || product.kind === kindFilter) &&
    (!normalizedQuery || product.searchText.includes(normalizedQuery))
  )), [kindFilter, normalizedQuery, products, statusFilter]);

  const isFiltering = statusFilter !== "all" || kindFilter !== "all" || Boolean(normalizedQuery);

  function clearFilters() {
    setStatusFilter("all");
    setKindFilter("all");
    setQuery("");
  }

  return (
    <MemberPage>
      <MemberPageHeader
        actions={view.continueTarget ? <ContinueAction target={view.continueTarget} /> : null}
        description="Tudo o que você comprou ou recebeu acesso, com o seu progresso em cada um."
        eyebrow={{ icon: LibraryBig, label: "Sua biblioteca" }}
        title="Minhas compras"
      >
        {view.showProgress && stats.products > 0 ? (
          <MemberStatGrid>
            <MemberStat icon={LibraryBig} label={stats.products === 1 ? "Produto" : "Produtos"} value={stats.products} />
            <MemberStat icon={CirclePlay} label="Em andamento" value={stats.inProgress} />
            <MemberStat icon={CircleCheck} label={stats.completed === 1 ? "Concluído" : "Concluídos"} value={stats.completed} />
            <MemberStat
              hint={stats.totalLessons > 0 ? `de ${formatMemberCount(stats.totalLessons, "aula")}` : undefined}
              icon={ListChecks}
              label="Aulas concluídas"
              value={stats.completedLessons}
            />
          </MemberStatGrid>
        ) : null}
      </MemberPageHeader>

      {products.length === 0 ? (
        <MemberEmptyState
          action={
            <>
              <MemberButtonLink href="/suporte" variant="primary">
                <LifeBuoy />
                Falar com o suporte
              </MemberButtonLink>
              <MemberButtonLink href={view.homeHref} variant="secondary">
                Ir para o início
              </MemberButtonLink>
            </>
          }
          description="Quando uma compra for confirmada, o produto aparece aqui com o seu progresso. Comprou e não aparece? Fale com o suporte."
          icon={LibraryBig}
          title="Você ainda não tem produtos liberados"
        />
      ) : (
        <>
          <div className="mb-6 grid gap-3">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {view.showProgress ? (
                <MemberFilterPills
                  ariaLabel="Filtrar por situação"
                  className="min-w-0"
                  onChange={setStatusFilter}
                  options={statusOptions}
                  value={statusFilter}
                />
              ) : (
                <MemberFilterPills ariaLabel="Filtrar por tipo" className="min-w-0" onChange={setKindFilter} options={kindOptions} value={kindFilter} />
              )}
              <MemberSearchField
                className="sm:w-72 sm:max-w-none sm:shrink-0"
                label="Buscar em Minhas compras"
                onChange={setQuery}
                placeholder="Buscar pelo nome..."
                value={query}
              />
            </div>
            {view.showProgress && view.kindOptions.length > 1 ? (
              <MemberFilterPills ariaLabel="Filtrar por tipo" onChange={setKindFilter} options={kindOptions} value={kindFilter} />
            ) : null}
          </div>

          <p aria-live="polite" className={isFiltering ? "mb-4 text-xs font-medium text-zinc-500" : "sr-only"} role="status">
            {isFiltering
              ? `${filteredProducts.length.toLocaleString("pt-BR")} de ${formatMemberCount(products.length, "produto")}`
              : formatMemberCount(products.length, "produto")}
          </p>

          {filteredProducts.length > 0 ? (
            <ul className={memberPosterGridClassName}>
              {filteredProducts.map((product, index) => (
                <li className="min-w-0" key={product.id}>
                  <PurchaseProductCard priority={index < 5} product={product} showProgress={view.showProgress} />
                </li>
              ))}
            </ul>
          ) : (
            <MemberEmptyState
              action={
                <MemberButton onClick={clearFilters} variant="secondary">
                  Limpar filtros
                </MemberButton>
              }
              description="Nenhum produto combina com a busca e os filtros escolhidos."
              icon={SearchX}
              title="Nada encontrado"
            />
          )}
        </>
      )}
    </MemberPage>
  );
}
