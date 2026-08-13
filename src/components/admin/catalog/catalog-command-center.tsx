"use client";

import {
  ArrowRight,
  BookOpen,
  Boxes,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Edit3,
  Eye,
  Layers3,
  LibraryBig,
  LockKeyhole,
  PackagePlus,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AdminContentRecord } from "@/lib/platform-types";

type CatalogFilter = "all" | "sellable" | "included" | "locked";

export type CatalogCommandCenterProps = {
  records: AdminContentRecord[];
  selectedRecord?: AdminContentRecord;
  filteredRecords: AdminContentRecord[];
  query: string;
  onQueryChange: (value: string) => void;
  filter: CatalogFilter;
  onFilterChange: (value: CatalogFilter) => void;
  onCreateContent: () => void;
  onEditContent: (record: AdminContentRecord) => void;
  onSelectRecord: (record: AdminContentRecord) => void;
};

type MaintenanceItem = {
  label: string;
  meta: string;
  record: AdminContentRecord;
  tone: "amber" | "blue" | "emerald" | "zinc";
};

const filterOptions: Array<{ label: string; value: CatalogFilter }> = [
  { label: "Todos", value: "all" },
  { label: "Vendaveis", value: "sellable" },
  { label: "Internos", value: "included" },
  { label: "Bloqueados", value: "locked" }
];

function formatUpdatedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function getAccessModelLabel(record: AdminContentRecord) {
  return record.content.accessModel === "free" ? "Gratuito" : "Fechado";
}

function getCommerceLabel(record: AdminContentRecord) {
  if (record.commerceScope === "sellable_product") {
    return "Produto";
  }

  if (record.commerceScope === "included_content") {
    return "Interno";
  }

  return "Apoio";
}

function getVisibilityLabel(record: AdminContentRecord) {
  if (record.visibility === "students") {
    return "Alunos";
  }

  if (record.visibility === "non_students") {
    return "Visitantes";
  }

  return "Todos";
}

function getStatusClassName(record: AdminContentRecord) {
  if (record.access === "Bloqueado" || record.status === "Bloqueado") {
    return "border-red-400/25 bg-red-500/10 text-red-100";
  }

  if (record.access === "Drip" || record.status === "Em breve") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-100";
  }

  if (record.status === "Concluido" || record.status === "Liberado") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
  }

  return "border-sky-400/25 bg-sky-500/10 text-sky-100";
}

function getScopeClassName(record: AdminContentRecord) {
  if (record.commerceScope === "sellable_product") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
  }

  if (record.commerceScope === "included_content") {
    return "border-blue-400/25 bg-blue-500/10 text-blue-100";
  }

  return "border-zinc-400/20 bg-white/[0.055] text-zinc-200";
}

function getMaintenanceItems(records: AdminContentRecord[]) {
  return records.reduce<MaintenanceItem[]>((items, record) => {
    if (record.commerceScope === "sellable_product" && record.content.accessModel !== "free" && !record.content.purchaseUrl) {
      items.push({
        label: "Compra externa pendente",
        meta: "Produto fechado",
        record,
        tone: "amber"
      });
    }

    if (record.modulesCount === 0 && record.kind !== "Aula" && record.kind !== "Material") {
      items.push({
        label: "Estrutura vazia",
        meta: "Sem modulos",
        record,
        tone: "blue"
      });
    }

    if (record.access === "Bloqueado") {
      items.push({
        label: "Acesso bloqueado",
        meta: record.releaseSummary,
        record,
        tone: "zinc"
      });
    }

    if (record.content.accessModel === "free" && record.access === "Liberado") {
      items.push({
        label: "Pronto para vitrine",
        meta: "Gratuito",
        record,
        tone: "emerald"
      });
    }

    return items;
  }, []).slice(0, 5);
}

function getToneClassName(tone: MaintenanceItem["tone"]) {
  if (tone === "amber") {
    return "bg-amber-400";
  }

  if (tone === "blue") {
    return "bg-blue-400";
  }

  if (tone === "emerald") {
    return "bg-emerald-400";
  }

  return "bg-zinc-400";
}

function CoverArt({
  className,
  record
}: {
  className?: string;
  record: AdminContentRecord;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-zinc-950 ring-1 ring-white/10", className)}>
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${record.content.image})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
      {record.access === "Bloqueado" ? (
        <div className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/15">
          <LockKeyhole className="size-3.5" />
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail
}: {
  detail: string;
  icon: typeof LibraryBig;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-lg border-white/10 bg-white/[0.045] py-3 shadow-2xl shadow-black/20">
      <CardContent className="flex items-center gap-3 px-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-white ring-1 ring-white/10">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-zinc-500">{label}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-xl font-semibold leading-none text-white">{value}</p>
            <p className="truncate text-[11px] font-medium text-zinc-500">{detail}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CatalogCommandCenter({
  records,
  selectedRecord,
  filteredRecords,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  onCreateContent,
  onEditContent,
  onSelectRecord
}: CatalogCommandCenterProps) {
  const activeRecord = selectedRecord ?? filteredRecords[0] ?? records[0];
  const sellableCount = records.filter((record) => record.commerceScope === "sellable_product").length;
  const includedCount = records.filter((record) => record.commerceScope === "included_content").length;
  const lockedCount = records.filter((record) => record.access === "Bloqueado").length;
  const totalLessons = records.reduce((sum, record) => sum + record.lessonsCount, 0);
  const totalModules = records.reduce((sum, record) => sum + record.modulesCount, 0);
  const recentRecords = [...records]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 4);
  const maintenanceItems = getMaintenanceItems(records);
  const showcaseRecords = filteredRecords.slice(0, 6);

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.6fr)]">
        <Card className="relative min-h-[25rem] overflow-hidden rounded-lg border-white/10 bg-[#0a0a0b] py-0 shadow-2xl shadow-black/40">
          {activeRecord ? (
            <>
              <div
                className="absolute inset-0 scale-105 bg-cover bg-center opacity-45 blur-sm"
                style={{ backgroundImage: `url(${activeRecord.content.image})` }}
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(59,130,246,0.28),transparent_32%),linear-gradient(115deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_44%,rgba(0,0,0,0.44)_100%)]" />
            </>
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(59,130,246,0.18),transparent_34%),linear-gradient(115deg,#070708,#111113)]" />
          )}

          <CardContent className="relative grid h-full gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_13rem] lg:p-6">
            <div className="flex min-w-0 flex-col justify-between gap-6">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-white/10 bg-white/[0.08] text-zinc-200" variant="outline">
                    <Sparkles className="size-3" />
                    Catalogo
                  </Badge>
                  {activeRecord ? (
                    <>
                      <Badge className={getScopeClassName(activeRecord)} variant="outline">
                        {getCommerceLabel(activeRecord)}
                      </Badge>
                      <Badge className={getStatusClassName(activeRecord)} variant="outline">
                        {activeRecord.access}
                      </Badge>
                    </>
                  ) : null}
                </div>

                <div>
                  <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-white md:text-4xl">
                    {activeRecord?.content.title ?? "Novo item educacional"}
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-zinc-400">
                    {activeRecord?.content.description || "Produtos, conteudos internos, modulos e aulas em uma visao de operacao."}
                  </p>
                </div>

                {activeRecord ? (
                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      ["Tipo", activeRecord.kind],
                      ["Modelo", getAccessModelLabel(activeRecord)],
                      ["Estrutura", `${activeRecord.modulesCount} mod. / ${activeRecord.lessonsCount} aulas`],
                      ["Visibilidade", getVisibilityLabel(activeRecord)]
                    ].map(([label, value]) => (
                      <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2" key={label}>
                        <p className="text-[11px] font-medium uppercase text-zinc-500">{label}</p>
                        <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black hover:bg-zinc-200"
                  onClick={onCreateContent}
                  type="button"
                >
                  <PackagePlus className="size-4" />
                  Criar item
                </Button>
                {activeRecord ? (
                  <Button
                    className="h-10 rounded-lg border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white hover:bg-white/10"
                    onClick={() => onEditContent(activeRecord)}
                    type="button"
                    variant="outline"
                  >
                    <Edit3 className="size-4" />
                    Editar selecionado
                  </Button>
                ) : null}
              </div>
            </div>

            {activeRecord ? (
              <button
                className="group relative mx-auto aspect-[720/1040] w-full max-w-[13rem] self-center overflow-hidden rounded-lg text-left ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:ring-white/25"
                onClick={() => onSelectRecord(activeRecord)}
                type="button"
              >
                <CoverArt className="absolute inset-0 rounded-none ring-0" record={activeRecord} />
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <p className="text-[11px] font-semibold uppercase text-zinc-300">{activeRecord.kind}</p>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold text-white">{activeRecord.content.title}</p>
                </div>
              </button>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <StatCard detail={`${filteredRecords.length} no recorte`} icon={LibraryBig} label="Itens ativos" value={String(records.length)} />
          <StatCard detail={`${includedCount} internos`} icon={CircleDollarSign} label="Produtos vendaveis" value={String(sellableCount)} />
          <StatCard detail={`${totalModules} modulos`} icon={BookOpen} label="Aulas cadastradas" value={String(totalLessons)} />
          <StatCard detail="para revisar" icon={LockKeyhole} label="Bloqueios" value={String(lockedCount)} />
        </div>
      </div>

      <Card className="rounded-lg border-white/10 bg-[#101113] py-4 shadow-2xl shadow-black/25">
        <CardContent className="space-y-4 px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <Input
                aria-label="Buscar no catalogo"
                className="h-10 rounded-lg border-white/10 bg-black/30 pl-9 text-sm font-medium text-white placeholder:text-zinc-600 focus-visible:border-white/25"
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Buscar por item, tipo, acesso ou liberacao"
                value={query}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => {
                const isActive = filter === option.value;

                return (
                  <Button
                    className={cn(
                      "h-10 rounded-lg px-3 text-xs font-semibold",
                      isActive
                        ? "bg-white text-black hover:bg-zinc-200"
                        : "border-white/10 bg-white/[0.045] text-zinc-300 hover:bg-white/10 hover:text-white"
                    )}
                    key={option.value}
                    onClick={() => onFilterChange(option.value)}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {showcaseRecords.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {showcaseRecords.map((record) => {
                const isSelected = activeRecord?.content.id === record.content.id;

                return (
                  <button
                    className={cn(
                      "group flex min-w-0 gap-3 rounded-lg border bg-white/[0.035] p-2 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.07]",
                      isSelected ? "border-white/25" : "border-white/10"
                    )}
                    key={record.content.id}
                    onClick={() => onSelectRecord(record)}
                    type="button"
                  >
                    <CoverArt className="h-24 w-16 shrink-0" record={record} />
                    <span className="flex min-w-0 flex-1 flex-col justify-between py-1">
                      <span>
                        <span className="flex items-center gap-2">
                          <Badge className={getScopeClassName(record)} variant="outline">
                            {getCommerceLabel(record)}
                          </Badge>
                          <span className="text-[11px] font-medium text-zinc-500">{record.kind}</span>
                        </span>
                        <span className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-white">
                          {record.content.title}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-3 text-xs font-medium text-zinc-500">
                        <span>{record.modulesCount} mod.</span>
                        <span>{record.lessonsCount} aulas</span>
                        <ArrowRight className="size-3.5 text-zinc-500 transition group-hover:text-white" />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-white">Nenhum item neste recorte.</p>
              <p className="mt-1 text-xs font-medium text-zinc-500">Ajuste busca ou filtros.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="rounded-lg border-white/10 bg-[#101113] py-4 shadow-2xl shadow-black/25">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
              <CalendarClock className="size-4 text-zinc-400" />
              Conteudos recentes
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="h-9 px-0 text-xs font-semibold uppercase text-zinc-500">Item</TableHead>
                  <TableHead className="h-9 text-xs font-semibold uppercase text-zinc-500">Acesso</TableHead>
                  <TableHead className="h-9 text-xs font-semibold uppercase text-zinc-500">Estrutura</TableHead>
                  <TableHead className="h-9 pr-0 text-right text-xs font-semibold uppercase text-zinc-500">Acao</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRecords.map((record) => (
                  <TableRow className="border-white/10 hover:bg-white/[0.035]" key={record.content.id}>
                    <TableCell className="px-0">
                      <button
                        className="flex min-w-0 items-center gap-3 text-left"
                        onClick={() => onSelectRecord(record)}
                        type="button"
                      >
                        <CoverArt className="h-12 w-9 shrink-0" record={record} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{record.content.title}</span>
                          <span className="mt-1 block text-xs font-medium text-zinc-500">{formatUpdatedAt(record.updatedAt)}</span>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusClassName(record)} variant="outline">
                        {record.access}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium text-zinc-400">
                      {record.modulesCount} / {record.lessonsCount}
                    </TableCell>
                    <TableCell className="pr-0 text-right">
                      <Button
                        aria-label={`Editar ${record.content.title}`}
                        className="rounded-lg border-white/10 bg-white/[0.05] text-zinc-300 hover:bg-white/10 hover:text-white"
                        onClick={() => onEditContent(record)}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <Edit3 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-white/10 bg-[#101113] py-4 shadow-2xl shadow-black/25">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
              <ShieldCheck className="size-4 text-zinc-400" />
              Operacao
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Boxes, label: "Itens", value: records.length },
                { icon: Layers3, label: "Modulos", value: totalModules },
                { icon: TrendingUp, label: "Filtro", value: filteredRecords.length }
              ].map(({ icon: Icon, label, value }) => (
                <div className="rounded-lg border border-white/10 bg-black/25 p-3" key={label}>
                  <Icon className="size-4 text-zinc-400" />
                  <p className="mt-3 text-lg font-semibold leading-none text-white">{value}</p>
                  <p className="mt-1 text-[11px] font-medium text-zinc-500">{label}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {maintenanceItems.length > 0 ? maintenanceItems.map((item) => (
                <button
                  className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-left transition hover:bg-white/[0.07]"
                  key={`${item.record.content.id}-${item.label}`}
                  onClick={() => onSelectRecord(item.record)}
                  type="button"
                >
                  <span className={cn("size-2.5 shrink-0 rounded-full", getToneClassName(item.tone))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">{item.label}</span>
                    <span className="mt-1 block truncate text-xs font-medium text-zinc-500">
                      {item.record.content.title} - {item.meta}
                    </span>
                  </span>
                  <Eye className="size-4 shrink-0 text-zinc-500" />
                </button>
              )) : (
                <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-4">
                  <CheckCircle2 className="size-5 text-emerald-200" />
                  <p className="mt-3 text-sm font-semibold text-white">Catalogo em ordem.</p>
                  <p className="mt-1 text-xs font-medium text-emerald-100/70">Sem pendencias operacionais.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export { CatalogCommandCenter };
