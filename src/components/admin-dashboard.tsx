"use client";

import {
  Bell,
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  Flame,
  GalleryVerticalEnd,
  Home,
  LibraryBig,
  Lock,
  Menu,
  MonitorPlay,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
  Zap
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  adminChartPoints,
  adminContentRecords,
  adminEntitlements,
  adminHomeSections,
  adminMetrics,
  adminPipeline,
  adminReleaseRules,
  adminWebhookEvents,
  type AdminContentAccess,
  type AdminContentRecord,
  type AdminMetric,
  type AdminView
} from "@/lib/admin-mock-data";
import { courseModules, formationInternalCourses } from "@/lib/mock-data";

type AdminNavItem = {
  icon: LucideIcon;
  id: AdminView;
  label: string;
};

const adminNavItems = [
  { icon: Trophy, id: "overview", label: "Visao geral" },
  { icon: LibraryBig, id: "catalog", label: "Catalogo" },
  { icon: GalleryVerticalEnd, id: "structure", label: "Estrutura" },
  { icon: Clock3, id: "release", label: "Liberacao" },
  { icon: ShieldCheck, id: "access", label: "Acessos" }
] satisfies AdminNavItem[];

const panelClassName = "rounded-[8px] border border-white/10 bg-[#171717] shadow-2xl shadow-black/20";
const subtlePanelClassName = "rounded-[8px] border border-white/10 bg-white/[0.045]";
const inputClassName =
  "h-11 rounded-[8px] border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-white/30";

function getToneClassName(tone: AdminMetric["tone"]) {
  if (tone === "red") {
    return "from-[var(--accent)]/20 to-[var(--accent)]/0 text-[var(--accent)]";
  }

  if (tone === "green") {
    return "from-emerald-500/18 to-emerald-500/0 text-emerald-400";
  }

  if (tone === "amber") {
    return "from-amber-500/18 to-amber-500/0 text-amber-300";
  }

  return "from-white/10 to-white/0 text-zinc-300";
}

function getAccessClassName(access: AdminContentAccess) {
  if (access === "Liberado") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-300";
  }

  if (access === "Drip") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-300";
  }

  if (access === "Em breve") {
    return "border-sky-400/25 bg-sky-500/10 text-sky-300";
  }

  return "border-red-400/25 bg-red-500/10 text-red-300";
}

function getWebhookClassName(status: string) {
  if (status === "processed") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-300";
  }

  if (status === "pending") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-300";
  }

  return "border-red-400/25 bg-red-500/10 text-red-300";
}

function StatusPill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[11px] font-bold ${className}`}>
      {children}
    </span>
  );
}

function IconButton({
  children,
  label
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      className="grid h-10 w-10 place-items-center rounded-[8px] border border-white/10 bg-white/[0.055] text-zinc-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
      type="button"
    >
      {children}
    </button>
  );
}

function AdminSidebar({
  activeView,
  onChangeView
}: {
  activeView: AdminView;
  onChangeView: (view: AdminView) => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[17.5rem] flex-col border-r border-white/10 bg-[#0b0b0b] lg:flex">
      <div className="border-b border-white/10 px-5 py-5">
        <Link className="inline-flex rounded-[6px] transition-opacity hover:opacity-85" href="/">
          <Image alt="Bunker707" className="h-auto w-[190px]" height={35} src="/brand/logo-bunker.png" width={306} />
        </Link>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-200">
          <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
          CMS Command Center
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {adminNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeView;

          return (
            <button
              className={`flex w-full items-center gap-3 rounded-[8px] px-4 py-3 text-left text-sm font-bold transition ${
                isActive
                  ? "bg-[var(--accent)] text-white shadow-[0_16px_42px_rgba(229,9,20,0.28)]"
                  : "text-zinc-400 hover:bg-white/[0.07] hover:text-white"
              }`}
              key={item.id}
              onClick={() => onChangeView(item.id)}
              type="button"
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="space-y-4 border-t border-white/10 p-5">
        <div className="rounded-[8px] border border-white/10 bg-white/[0.045] p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Ambiente seguro
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            Acesso, conteudo e eventos externos ficam separados de checkout.
          </p>
        </div>
        <Link
          className="flex items-center gap-3 rounded-[8px] px-4 py-3 text-sm font-bold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          href="/"
        >
          <Home className="h-5 w-5" />
          Area do aluno
        </Link>
      </div>
    </aside>
  );
}

function AdminTopbar({
  activeView,
  mobileNavOpen,
  onChangeView,
  onToggleMobileNav
}: {
  activeView: AdminView;
  mobileNavOpen: boolean;
  onChangeView: (view: AdminView) => void;
  onToggleMobileNav: () => void;
}) {
  const activeLabel = adminNavItems.find((item) => item.id === activeView)?.label ?? "CMS";

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0b0b0b]/92 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <button
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "Fechar menu do CMS" : "Abrir menu do CMS"}
          className="grid h-10 w-10 place-items-center rounded-[8px] border border-white/10 bg-white/[0.055] text-white lg:hidden"
          onClick={onToggleMobileNav}
          type="button"
        >
          {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-zinc-500">Bunker707 CMS</p>
          <h1 className="truncate text-lg font-black text-white sm:text-xl">{activeLabel}</h1>
        </div>

        <label className="ml-auto hidden h-10 w-full max-w-md items-center gap-3 rounded-[8px] border border-white/10 bg-black/30 px-3 text-sm text-zinc-400 focus-within:border-white/25 md:flex">
          <Search className="h-4 w-4 text-zinc-500" />
          <span className="sr-only">Buscar no CMS</span>
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-zinc-600"
            placeholder="Buscar produtos, aulas, alunos..."
            type="search"
          />
        </label>

        <IconButton label="Notificacoes">
          <Bell className="h-4 w-4" />
        </IconButton>
        <button
          className="hidden h-10 items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-sm font-bold text-white transition hover:bg-white/10 sm:flex"
          type="button"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-xs">DS</span>
          Danilo
        </button>
      </div>

      {mobileNavOpen ? (
        <div className="mt-3 grid gap-2 rounded-[8px] border border-white/10 bg-[#141414] p-2 lg:hidden">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeView;

            return (
              <button
                className={`flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-sm font-bold ${
                  isActive ? "bg-[var(--accent)] text-white" : "text-zinc-300 hover:bg-white/10"
                }`}
                key={item.id}
                onClick={() => onChangeView(item.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </header>
  );
}

function MetricCard({ metric }: { metric: AdminMetric }) {
  return (
    <div className={`${panelClassName} overflow-hidden p-4`}>
      <div className={`pointer-events-none -mx-4 -mt-4 mb-4 h-1 bg-gradient-to-r ${getToneClassName(metric.tone)}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-400">{metric.label}</p>
          <p className="mt-3 text-3xl font-black leading-none text-white">{metric.value}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-[8px] bg-gradient-to-br ${getToneClassName(metric.tone)}`}>
          <Sparkles className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-4 text-xs font-bold text-zinc-500">{metric.delta}</p>
    </div>
  );
}

function ConsumptionChart() {
  return (
    <div className={`${panelClassName} p-5 lg:col-span-2`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">Consumo e acesso</h2>
          <p className="mt-1 text-sm text-zinc-500">Eventos de progresso, aulas iniciadas e acessos liberados.</p>
        </div>
        <div className="flex items-center gap-2">
          {["7D", "30D", "90D"].map((range, index) => (
            <button
              className={`rounded-[7px] px-3 py-2 text-xs font-black transition ${
                index === 0 ? "bg-white text-black" : "bg-white/[0.06] text-zinc-300 hover:bg-white/10 hover:text-white"
              }`}
              key={range}
              type="button"
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 flex h-72 items-end gap-3 border-b border-l border-white/10 px-2 pb-5 sm:gap-5 sm:px-5">
        {adminChartPoints.map((point) => (
          <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2" key={point.label}>
            <div className="flex h-56 w-full items-end justify-center gap-1.5">
              <div
                className="w-full max-w-[1.6rem] rounded-t-[5px] bg-[var(--accent)] shadow-[0_0_24px_rgba(229,9,20,0.28)]"
                style={{ height: `${point.progress}%` }}
              />
              <div
                className="w-full max-w-[1.6rem] rounded-t-[5px] bg-white/24"
                style={{ height: `${point.access}%` }}
              />
            </div>
            <span className="text-xs font-bold text-zinc-500">{point.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-bold text-zinc-500">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
          Progresso
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-white/40" />
          Acessos
        </span>
      </div>
    </div>
  );
}

function PipelinePanel() {
  return (
    <div className={`${panelClassName} p-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-white">Fila editorial</h2>
          <p className="mt-1 text-sm text-zinc-500">Conteudos em producao e publicacao.</p>
        </div>
        <IconButton label="Mais opcoes">
          <MoreHorizontal className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="mt-6 space-y-4">
        {adminPipeline.map((item) => (
          <div className="flex items-center gap-3" key={item.label}>
            <span className={`h-3 w-3 rounded-full ${item.tone}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-bold text-white">{item.label}</span>
                <span className="font-black text-zinc-300">{item.count}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full ${item.tone}`} style={{ width: `${Math.min(item.count * 8, 100)}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PosterStrip({ records }: { records: AdminContentRecord[] }) {
  return (
    <div className={`${panelClassName} overflow-hidden p-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-white">Catalogo em destaque</h2>
          <p className="mt-1 text-sm text-zinc-500">Como os produtos aparecem nas linhas da area do aluno.</p>
        </div>
        <button className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200" type="button">
          <Plus className="h-4 w-4" />
          Novo
        </button>
      </div>

      <div className="-mx-5 mt-5 flex gap-3 overflow-x-auto px-5 pb-2 scrollbar-hidden">
        {records.slice(0, 8).map((record) => (
          <button
            className="group relative aspect-[720/1040] w-[9.5rem] shrink-0 overflow-hidden rounded-[8px] bg-[#101010] text-left shadow-xl shadow-black/35 transition hover:-translate-y-1 hover:shadow-[0_28px_72px_rgba(0,0,0,0.6)] sm:w-[11rem]"
            key={record.content.id}
            type="button"
          >
            <div
              className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-[1.04]"
              style={{ backgroundImage: `url(${record.content.image})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/64 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3">
              <StatusPill className={getAccessClassName(record.access)}>{record.access}</StatusPill>
              <h3 className="mt-3 line-clamp-2 text-sm font-black leading-tight text-white">{record.content.title}</h3>
              <p className="mt-1 line-clamp-1 text-xs font-semibold text-zinc-400">{record.kind}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function HomeSectionsPanel() {
  return (
    <div className={`${panelClassName} p-5`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-white">Home do aluno</h2>
          <p className="mt-1 text-sm text-zinc-500">Linhas configuraveis e visibilidade.</p>
        </div>
        <Home className="h-5 w-5 text-zinc-500" />
      </div>
      <div className="mt-5 space-y-3">
        {adminHomeSections.map((section) => (
          <div className="rounded-[8px] border border-white/10 bg-black/20 p-3" key={section.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">
                  {section.order}. {section.title}
                </p>
                <p className="mt-1 text-xs text-zinc-500">{section.source}</p>
              </div>
              <StatusPill className="border-white/10 bg-white/[0.055] text-zinc-300">
                {section.contentCount}
              </StatusPill>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs font-bold text-zinc-500">
              <span>Visibilidade</span>
              <span>{section.visibility}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewView({ records }: { records: AdminContentRecord[] }) {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[8px] border border-white/10 bg-[#111]">
        <div className="relative p-5 sm:p-8">
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(229,9,20,0.26),rgba(20,20,20,0.34)_46%,rgba(255,255,255,0.04))]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-black text-red-100">
                <Flame className="h-4 w-4 text-[var(--accent)]" />
                Netflix-style control room
              </div>
              <h2 className="mt-5 text-4xl font-black leading-none text-white sm:text-5xl">
                CMS para controlar toda a area de membros.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                Catalogo, home, hierarquia de aulas, regras de drip, materiais, entitlements e eventos externos no mesmo painel.
              </p>
            </div>
            <div className="grid min-w-[18rem] gap-3 rounded-[8px] border border-white/10 bg-black/30 p-4 backdrop-blur">
              <div className="flex items-center justify-between text-sm font-bold">
                <span className="text-zinc-400">Status operacional</span>
                <StatusPill className="border-emerald-400/25 bg-emerald-500/10 text-emerald-300">
                  Online
                </StatusPill>
              </div>
              <div className="flex items-center justify-between text-sm font-bold">
                <span className="text-zinc-400">Entitlement truth</span>
                <span className="text-white">Interno</span>
              </div>
              <div className="flex items-center justify-between text-sm font-bold">
                <span className="text-zinc-400">Checkout</span>
                <span className="text-white">Externo</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {adminMetrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <ConsumptionChart />
        <PipelinePanel />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.8fr)]">
        <PosterStrip records={records} />
        <HomeSectionsPanel />
      </section>
    </div>
  );
}

function CatalogTable({
  filteredRecords,
  onSelectRecord,
  selectedRecord
}: {
  filteredRecords: AdminContentRecord[];
  onSelectRecord: (record: AdminContentRecord) => void;
  selectedRecord: AdminContentRecord;
}) {
  return (
    <div className={`${panelClassName} overflow-hidden`}>
      <div className="grid min-w-[56rem] grid-cols-[2fr_0.9fr_1fr_0.9fr_0.9fr_0.8fr] border-b border-white/10 px-4 py-3 text-xs font-black uppercase text-zinc-500">
        <span>Conteudo</span>
        <span>Tipo</span>
        <span>Acesso</span>
        <span>Estrutura</span>
        <span>Atualizado</span>
        <span className="text-right">Acoes</span>
      </div>

      <div className="overflow-x-auto">
        {filteredRecords.map((record) => {
          const isSelected = selectedRecord.content.id === record.content.id;

          return (
            <button
              className={`grid min-w-[56rem] grid-cols-[2fr_0.9fr_1fr_0.9fr_0.9fr_0.8fr] items-center gap-4 border-b border-white/10 px-4 py-4 text-left transition last:border-b-0 ${
                isSelected ? "bg-white/[0.075]" : "hover:bg-white/[0.045]"
              }`}
              key={record.content.id}
              onClick={() => onSelectRecord(record)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="relative h-16 w-11 shrink-0 overflow-hidden rounded-[6px] bg-[#101010]">
                  <span
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${record.content.image})` }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-white">{record.content.title}</span>
                  <span className="mt-1 block truncate text-xs font-semibold text-zinc-500">
                    {record.releaseSummary}
                  </span>
                </span>
              </span>
              <span className="text-sm font-bold text-zinc-300">{record.kind}</span>
              <span>
                <StatusPill className={getAccessClassName(record.access)}>{record.access}</StatusPill>
              </span>
              <span className="text-sm font-bold text-zinc-400">
                {record.modulesCount} mod. / {record.lessonsCount} aulas
              </span>
              <span className="text-sm font-bold text-zinc-500">{record.updatedAt}</span>
              <span className="flex justify-end gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[7px] border border-white/10 bg-white/[0.055] text-zinc-300">
                  <Play className="h-4 w-4" />
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-[7px] border border-white/10 bg-white/[0.055] text-zinc-300">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectedContentPanel({ selectedRecord }: { selectedRecord: AdminContentRecord }) {
  return (
    <aside className={`${panelClassName} p-5`}>
      <div className="relative aspect-[720/1040] overflow-hidden rounded-[8px] bg-black">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${selectedRecord.content.image})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <StatusPill className={getAccessClassName(selectedRecord.access)}>{selectedRecord.access}</StatusPill>
          <h2 className="mt-3 text-2xl font-black leading-tight text-white">{selectedRecord.content.title}</h2>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {[
          ["Escopo", selectedRecord.commerceScope],
          ["Visibilidade", selectedRecord.visibility],
          ["Responsavel", selectedRecord.owner],
          ["Status", selectedRecord.status]
        ].map(([label, value]) => (
          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3 text-sm" key={label}>
            <span className="font-semibold text-zinc-500">{label}</span>
            <span className="text-right font-bold text-white">{value}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3">
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200" type="button">
          <BookOpen className="h-4 w-4" />
          Editar conteudo
        </button>
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-black text-white transition hover:bg-white/10" type="button">
          <MonitorPlay className="h-4 w-4" />
          Preview do aluno
        </button>
      </div>
    </aside>
  );
}

function CatalogView({
  records,
  selectedRecord,
  setSelectedRecord
}: {
  records: AdminContentRecord[];
  selectedRecord: AdminContentRecord;
  setSelectedRecord: (record: AdminContentRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sellable" | "included" | "locked">("all");
  const normalizedQuery = query.trim().toLowerCase();

  const filteredRecords = useMemo(() => (
    records.filter((record) => {
      const matchesText = !normalizedQuery || [
        record.content.title,
        record.kind,
        record.status,
        record.access,
        record.releaseSummary
      ].some((value) => value.toLowerCase().includes(normalizedQuery));

      const matchesFilter =
        filter === "all" ||
        (filter === "sellable" && record.commerceScope === "sellable_product") ||
        (filter === "included" && record.commerceScope === "included_content") ||
        (filter === "locked" && record.access === "Bloqueado");

      return matchesText && matchesFilter;
    })
  ), [filter, normalizedQuery, records]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-black text-white">Catalogo de produtos e conteudos</h2>
            <p className="mt-2 text-sm text-zinc-500">Formacoes, cursos avulsos, bootcamps e cursos internos em uma unica grade.</p>
          </div>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-[var(--accent)] px-4 py-2 text-sm font-black text-white transition hover:bg-red-600" type="button">
            <Plus className="h-4 w-4" />
            Novo conteudo
          </button>
        </div>

        <div className={`${subtlePanelClassName} flex flex-col gap-3 p-3 lg:flex-row lg:items-center`}>
          <label className="flex h-11 flex-1 items-center gap-3 rounded-[8px] border border-white/10 bg-black/30 px-3 text-sm text-zinc-400 focus-within:border-white/25">
            <Search className="h-4 w-4 text-zinc-500" />
            <span className="sr-only">Buscar conteudo</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-zinc-600"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por produto, curso, regra..."
              type="search"
              value={query}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              ["all", "Todos"],
              ["sellable", "Vendaveis"],
              ["included", "Inclusos"],
              ["locked", "Bloqueados"]
            ].map(([id, label]) => (
              <button
                className={`min-h-10 rounded-[8px] px-3 text-sm font-black transition ${
                  filter === id ? "bg-white text-black" : "bg-white/[0.055] text-zinc-300 hover:bg-white/10 hover:text-white"
                }`}
                key={id}
                onClick={() => setFilter(id as typeof filter)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <CatalogTable filteredRecords={filteredRecords} onSelectRecord={setSelectedRecord} selectedRecord={selectedRecord} />
      </section>

      <SelectedContentPanel selectedRecord={selectedRecord} />
    </div>
  );
}

function StructureView({ selectedRecord }: { selectedRecord: AdminContentRecord }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-5">
        <div>
          <h2 className="text-3xl font-black text-white">Construtor de formacoes</h2>
          <p className="mt-2 text-sm text-zinc-500">Hierarquia editorial do produto ate a aula.</p>
        </div>

        <div className={`${panelClassName} overflow-hidden`}>
          <div className="border-b border-white/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <StatusPill className="border-red-400/25 bg-red-500/10 text-red-200">Formacao</StatusPill>
                <h3 className="mt-3 text-2xl font-black text-white">Fundamentos de IA Aplicada</h3>
              </div>
              <button className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200" type="button">
                <Plus className="h-4 w-4" />
                Curso interno
              </button>
            </div>
          </div>

          <div className="divide-y divide-white/10">
            {formationInternalCourses.slice(0, 5).map((course, courseIndex) => (
              <div className="p-5" key={course.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-white/10 text-sm font-black text-white">
                    {courseIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-base font-black text-white">{course.title}</h4>
                    <p className="mt-1 text-sm text-zinc-500">{course.durationLabel} / incluso na formacao</p>
                  </div>
                  <StatusPill className={getAccessClassName(courseIndex > 1 ? "Drip" : "Liberado")}>
                    {courseIndex > 1 ? `D+${courseIndex * 3}` : "Liberado"}
                  </StatusPill>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {courseModules.slice(0, 4).map((module, moduleIndex) => (
                    <div className="rounded-[8px] border border-white/10 bg-black/25 p-4" key={`${course.id}-${module.id}`}>
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-white/[0.08] text-white">
                          <GalleryVerticalEnd className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <h5 className="truncate text-sm font-black text-white">{module.title}</h5>
                            <button aria-label="Mais opcoes" className="text-zinc-500 hover:text-white" type="button">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-zinc-500">{module.lessons.length} aulas</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <StatusPill className={getAccessClassName(moduleIndex === 0 ? "Liberado" : "Drip")}>
                              {moduleIndex === 0 ? "Agora" : `${moduleIndex * 24}h`}
                            </StatusPill>
                            <StatusPill className="border-white/10 bg-white/[0.055] text-zinc-300">
                              Aula + material
                            </StatusPill>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className={`${panelClassName} h-fit p-5`}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[8px] bg-[var(--accent)] text-white">
            <BookOpen className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-black text-white">Editor rapido</h3>
            <p className="text-sm text-zinc-500">{selectedRecord.content.title}</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="grid gap-2 text-sm font-bold text-zinc-400">
            Nome publico
            <input className={inputClassName} defaultValue={selectedRecord.content.title} />
          </label>
          <label className="grid gap-2 text-sm font-bold text-zinc-400">
            Tipo
            <select className={inputClassName} defaultValue={selectedRecord.kind}>
              <option>Formacao</option>
              <option>Curso</option>
              <option>Bootcamp</option>
              <option>Aula</option>
              <option>Material</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-bold text-zinc-400">
            Abertura de aulas
            <select className={inputClassName} defaultValue="course_lesson_format">
              <option value="course_lesson_format">Direto para playlist</option>
              <option value="course_page_modules">Pagina de modulos</option>
            </select>
          </label>
          <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200" type="button">
            <CheckCircle2 className="h-4 w-4" />
            Salvar rascunho
          </button>
        </div>
      </aside>
    </div>
  );
}

function ReleaseView() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="space-y-5">
        <div>
          <h2 className="text-3xl font-black text-white">Regras de bloqueio e liberacao</h2>
          <p className="mt-2 text-sm text-zinc-500">Controle por compra, tempo, data fixa, aula concluida, avaliacao ou comentario.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {adminReleaseRules.map((rule) => (
            <article className={`${panelClassName} p-5`} key={rule.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <StatusPill
                    className={
                      rule.status === "Ativa"
                        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
                        : rule.status === "Pausada"
                          ? "border-zinc-400/20 bg-zinc-500/10 text-zinc-300"
                          : "border-amber-400/25 bg-amber-500/10 text-amber-300"
                    }
                  >
                    {rule.status}
                  </StatusPill>
                  <h3 className="mt-3 text-lg font-black text-white">{rule.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{rule.target}</p>
                </div>
                <span className="grid h-11 w-11 place-items-center rounded-[8px] bg-white/[0.055] text-zinc-300">
                  {rule.mode === "fixed_date" ? <Clock3 className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                </span>
              </div>
              <div className="mt-5 grid gap-3 text-sm">
                <div className="flex items-center justify-between border-t border-white/10 pt-3">
                  <span className="font-semibold text-zinc-500">Escopo</span>
                  <span className="font-bold text-white">{rule.scope}</span>
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-3">
                  <span className="font-semibold text-zinc-500">Condicao</span>
                  <span className="max-w-[13rem] text-right font-bold text-white">{rule.condition}</span>
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-3">
                  <span className="font-semibold text-zinc-500">Tempo</span>
                  <span className="font-bold text-white">{rule.delay}</span>
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-3">
                  <span className="font-semibold text-zinc-500">Alunos afetados</span>
                  <span className="font-bold text-white">{rule.affectedStudents}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className={`${panelClassName} h-fit p-5`}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[8px] bg-[var(--accent)] text-white">
            <Zap className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-black text-white">Nova regra</h3>
            <p className="text-sm text-zinc-500">Drip, bloqueio e material bonus.</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="grid gap-2 text-sm font-bold text-zinc-400">
            Nivel
            <select className={inputClassName} defaultValue="Aula">
              <option>Produto</option>
              <option>Curso</option>
              <option>Modulo</option>
              <option>Aula</option>
              <option>Material</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-bold text-zinc-400">
            Condicao
            <select className={inputClassName} defaultValue="after_purchase">
              <option value="immediate">Liberar imediatamente</option>
              <option value="after_purchase">Depois da compra</option>
              <option value="after_previous_lesson">Depois da aula anterior</option>
              <option value="fixed_date">Data e hora fixa</option>
              <option value="activity_required">Atividade obrigatoria</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Tempo
              <input className={inputClassName} defaultValue="7" type="number" />
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-400">
              Unidade
              <select className={inputClassName} defaultValue="dias">
                <option>horas</option>
                <option>dias</option>
              </select>
            </label>
          </div>
          <label className="grid gap-2 text-sm font-bold text-zinc-400">
            Requisito extra
            <select className={inputClassName} defaultValue="none">
              <option value="none">Nenhum</option>
              <option>Aula concluida</option>
              <option>Avaliacao enviada</option>
              <option>Comentario enviado</option>
              <option>30% assistido</option>
            </select>
          </label>
          <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200" type="button">
            <Clock3 className="h-4 w-4" />
            Criar regra
          </button>
        </div>
      </aside>
    </div>
  );
}

function AccessView() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="space-y-5">
        <div>
          <h2 className="text-3xl font-black text-white">Entitlements e webhooks</h2>
          <p className="mt-2 text-sm text-zinc-500">Acesso interno como fonte de verdade, eventos externos como entrada auditavel.</p>
        </div>

        <div className={`${panelClassName} overflow-hidden`}>
          <div className="grid min-w-[52rem] grid-cols-[1.2fr_1.2fr_0.8fr_0.8fr_0.8fr] border-b border-white/10 px-4 py-3 text-xs font-black uppercase text-zinc-500">
            <span>Aluno</span>
            <span>Produto</span>
            <span>Fonte</span>
            <span>Status</span>
            <span>Expira</span>
          </div>
          <div className="overflow-x-auto">
            {adminEntitlements.map((entitlement) => (
              <div
                className="grid min-w-[52rem] grid-cols-[1.2fr_1.2fr_0.8fr_0.8fr_0.8fr] items-center gap-4 border-b border-white/10 px-4 py-4 last:border-b-0"
                key={entitlement.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-white">{entitlement.user}</p>
                  <p className="mt-1 truncate text-xs font-semibold text-zinc-500">{entitlement.email}</p>
                </div>
                <p className="truncate text-sm font-bold text-zinc-300">{entitlement.product}</p>
                <p className="text-sm font-bold text-zinc-400">{entitlement.sourceProvider}</p>
                <StatusPill
                  className={
                    entitlement.status === "active"
                      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
                      : "border-red-400/25 bg-red-500/10 text-red-300"
                  }
                >
                  {entitlement.status}
                </StatusPill>
                <p className="text-sm font-bold text-zinc-500">{entitlement.endsAt}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className={`${panelClassName} h-fit p-5`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-black text-white">Eventos recentes</h3>
            <p className="mt-1 text-sm text-zinc-500">Entrada bruta e processamento.</p>
          </div>
          <Download className="h-5 w-5 text-zinc-500" />
        </div>
        <div className="mt-5 space-y-3">
          {adminWebhookEvents.map((event) => (
            <div className="rounded-[8px] border border-white/10 bg-black/25 p-3" key={event.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-white">{event.type}</p>
                  <p className="mt-1 text-xs font-semibold text-zinc-500">
                    {event.provider} / {event.receivedAt}
                  </p>
                </div>
                <StatusPill className={getWebhookClassName(event.status)}>{event.status}</StatusPill>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs font-bold text-zinc-500">
                <span>{event.id}</span>
                <span>{event.retries} retries</span>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function AdminDashboard() {
  const [activeView, setActiveView] = useState<AdminView>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(adminContentRecords[0]);

  if (!selectedRecord) {
    return null;
  }

  function handleChangeView(view: AdminView) {
    setActiveView(view);
    setMobileNavOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white">
      <AdminSidebar activeView={activeView} onChangeView={handleChangeView} />
      <div className="min-h-screen lg:pl-[17.5rem]">
        <AdminTopbar
          activeView={activeView}
          mobileNavOpen={mobileNavOpen}
          onChangeView={handleChangeView}
          onToggleMobileNav={() => setMobileNavOpen((current) => !current)}
        />

        <main className="px-4 py-6 sm:px-6 lg:px-8">
          {activeView === "overview" ? <OverviewView records={adminContentRecords} /> : null}
          {activeView === "catalog" ? (
            <CatalogView
              records={adminContentRecords}
              selectedRecord={selectedRecord}
              setSelectedRecord={setSelectedRecord}
            />
          ) : null}
          {activeView === "structure" ? <StructureView selectedRecord={selectedRecord} /> : null}
          {activeView === "release" ? <ReleaseView /> : null}
          {activeView === "access" ? <AccessView /> : null}
        </main>
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-red-950/10 to-transparent" />
      <div className="pointer-events-none fixed bottom-4 right-4 hidden rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-bold text-zinc-500 backdrop-blur md:block">
        UI-first / mock data
      </div>
    </div>
  );
}
