"use client";

import {
  ArrowUpRight,
  CheckCircle2,
  Eye,
  GalleryVerticalEnd,
  Globe2,
  Home,
  ImageIcon,
  KeyRound,
  Layers3,
  LibraryBig,
  LockKeyhole,
  Palette,
  Pencil,
  PlayCircle,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AdminContentRecord } from "@/lib/platform-types";

type PersonalizationCommandCenterProps = {
  records: AdminContentRecord[];
  visiblePreviewRecords: AdminContentRecord[];
  personalizationItemsCount: number;
  onOpenShowcase: () => void;
  onOpenLogin: () => void;
  onOpenProducts: () => void;
  onOpenContent: (record: AdminContentRecord) => void;
};

type DestinationCard = {
  actionLabel: string;
  description: string;
  href: string;
  icon: LucideIcon;
  metric: string;
  onOpen: () => void;
  status: "Publicado" | "Em edicao";
  title: string;
};

function getPublishedRecords(records: AdminContentRecord[]) {
  return records.filter((record) => record.status !== "Bloqueado");
}

function getVisualCoverage(records: AdminContentRecord[]) {
  if (records.length === 0) {
    return 0;
  }

  const recordsWithCover = records.filter((record) => Boolean(record.content.image)).length;

  return Math.round((recordsWithCover / records.length) * 100);
}

function getAccessLabel(record: AdminContentRecord) {
  if (record.content.accessModel === "free") {
    return "Aberto";
  }

  if (record.access === "Liberado") {
    return "Com acesso";
  }

  if (record.access === "Bloqueado") {
    return "Fechado";
  }

  return record.access;
}

function getAccessClassName(record: AdminContentRecord) {
  if (record.content.accessModel === "free") {
    return "border-sky-400/25 bg-sky-400/10 text-sky-200";
  }

  if (record.access === "Liberado") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  }

  if (record.access === "Bloqueado") {
    return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  }

  return "border-border bg-muted text-muted-foreground";
}

function getStatusClassName(status: AdminContentRecord["status"]) {
  if (status === "Bloqueado" || status === "Em breve") {
    return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  }

  if (status === "Concluido" || status === "Liberado") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  }

  return "border-border bg-muted text-muted-foreground";
}

function CoverageMeter({ value }: { value: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
        <span>Cobertura visual</span>
        <span className="text-foreground">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary shadow-[0_0_24px_rgba(229,9,20,0.35)]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function OperationalStat({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/55 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function DestinationCardItem({ destination }: { destination: DestinationCard }) {
  const Icon = destination.icon;

  return (
    <Card className="border-border bg-card/95 shadow-2xl shadow-black/20 transition hover:border-foreground/20 hover:bg-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="grid size-11 place-items-center rounded-lg border border-border bg-background text-foreground">
            <Icon className="size-5" />
          </div>
          <Badge
            className={cn(
              "border",
              destination.status === "Publicado"
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                : "border-amber-400/25 bg-amber-400/10 text-amber-200"
            )}
            variant="outline"
          >
            {destination.status}
          </Badge>
        </div>
        <div>
          <CardTitle className="text-lg font-semibold text-foreground">{destination.title}</CardTitle>
          <CardDescription className="mt-1">{destination.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="mt-auto space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-background/55 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">{destination.href}</span>
          <span className="text-xs font-semibold text-foreground">{destination.metric}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button className="h-9 rounded-lg font-semibold" onClick={destination.onOpen} type="button">
            <Pencil className="size-4" />
            {destination.actionLabel}
          </Button>
          <Link
            aria-label={`Prever ${destination.title}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
            href={destination.href}
            target="_blank"
          >
            <Eye className="size-4" />
            Prever
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ProductPersonalizationCard({
  onOpen,
  record
}: {
  onOpen: (record: AdminContentRecord) => void;
  record: AdminContentRecord;
}) {
  const modulesLabel = record.modulesCount === 1 ? "1 modulo" : `${record.modulesCount} modulos`;
  const lessonsLabel = record.lessonsCount === 1 ? "1 aula" : `${record.lessonsCount} aulas`;

  return (
    <Card className="border-border bg-card/95 shadow-xl shadow-black/15 transition hover:border-foreground/20 hover:bg-card">
      <div className="relative aspect-[4/5] overflow-hidden bg-muted">
        {record.content.image ? (
          <div
            aria-label={`Capa de ${record.content.title}`}
            className="absolute inset-0 bg-cover bg-center"
            role="img"
            style={{ backgroundImage: `url(${record.content.image})` }}
          />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            <ImageIcon className="size-9" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <Badge className={cn("border", getAccessClassName(record))} variant="outline">
            {getAccessLabel(record)}
          </Badge>
          <Badge className={cn("border", getStatusClassName(record.status))} variant="outline">
            {record.status}
          </Badge>
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <p className="line-clamp-2 text-lg font-semibold leading-tight text-white">{record.content.title}</p>
          <p className="mt-1 text-xs font-medium text-zinc-300">
            {record.kind} / {modulesLabel} / {lessonsLabel}
          </p>
        </div>
      </div>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-border bg-background/55 p-2">
            <p className="text-muted-foreground">Preview</p>
            <p className="mt-1 truncate font-medium text-foreground">/conteudo/{record.content.id}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/55 p-2">
            <p className="text-muted-foreground">Entrega</p>
            <p className="mt-1 truncate font-medium text-foreground">{record.releaseSummary}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button className="h-9 rounded-lg font-semibold" onClick={() => onOpen(record)} type="button">
            <Palette className="size-4" />
            Personalizar
          </Button>
          <Link
            aria-label={`Prever ${record.content.title}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
            href={`/conteudo/${record.content.id}`}
            target="_blank"
          >
            <ArrowUpRight className="size-4" />
            Prever
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function PersonalizationCommandCenter({
  onOpenContent,
  onOpenLogin,
  onOpenProducts,
  onOpenShowcase,
  personalizationItemsCount,
  records,
  visiblePreviewRecords
}: PersonalizationCommandCenterProps) {
  const publishedRecords = getPublishedRecords(records);
  const visualCoverage = getVisualCoverage(visiblePreviewRecords);
  const closedRecords = visiblePreviewRecords.filter((record) => record.content.accessModel !== "free").length;
  const freeRecords = visiblePreviewRecords.length - closedRecords;
  const destinationCards: DestinationCard[] = [
    {
      actionLabel: "Abrir vitrine",
      description: "Hero, fileiras, ordem e regras de visibilidade da home do aluno.",
      href: "/",
      icon: Home,
      metric: `${visiblePreviewRecords.length} itens visiveis`,
      onOpen: onOpenShowcase,
      status: "Publicado",
      title: "Vitrine"
    },
    {
      actionLabel: "Editar login",
      description: "Template, imagem editorial, superficie do formulario e provedores ativos.",
      href: "/login",
      icon: KeyRound,
      metric: "Acesso fechado",
      onOpen: onOpenLogin,
      status: "Publicado",
      title: "Pagina de login"
    },
    {
      actionLabel: "Abrir produtos",
      description: "Tratamento visual da lista de compras, produtos liberados e cards de acesso.",
      href: "/minhas-compras",
      icon: LibraryBig,
      metric: `${publishedRecords.length} publicados`,
      onOpen: onOpenProducts,
      status: "Em edicao",
      title: "Pagina de produtos"
    }
  ];

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/30">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(229,9,20,0.22),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_38%)]" />
        <div className="relative grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-6">
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary" variant="outline">
                <Sparkles className="size-3" />
                Personalizacao
              </Badge>
              <Badge className="border-border bg-background/60 text-muted-foreground" variant="outline">
                {personalizationItemsCount} destinos editaveis
              </Badge>
            </div>
            <div>
              <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">Central visual da area do aluno</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Controle o acabamento publicado da vitrine, login, produtos e paginas de conteudo sem misturar catalogo,
                estrutura de aulas ou regras de pagamento.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <OperationalStat icon={GalleryVerticalEnd} label="Capas rastreadas" value={`${visualCoverage}%`} />
              <OperationalStat icon={LockKeyhole} label="Acesso fechado" value={`${closedRecords}`} />
              <OperationalStat icon={Globe2} label="Acesso aberto" value={`${freeRecords}`} />
            </div>
          </div>

          <Card className="border-border bg-background/70 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                <ShieldCheck className="size-5 text-primary" />
                Tema e publicacao
              </CardTitle>
              <CardDescription>Estado operacional das superficies que o aluno enxerga.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CoverageMeter value={visualCoverage} />
              <div className="grid gap-2">
                <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Destino principal</span>
                  <span className="font-medium text-foreground">/</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Fonte de acesso</span>
                  <span className="font-medium text-foreground">Entitlements internos</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Arquivos visuais</span>
                  <span className="font-medium text-foreground">{visiblePreviewRecords.length} capas</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {destinationCards.map((destination) => (
          <DestinationCardItem destination={destination} key={destination.title} />
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Layers3 className="size-4" />
              Produtos personalizaveis
            </div>
            <h3 className="mt-1 text-xl font-semibold text-foreground">Capas, pagina propria e estados de acesso</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="border-emerald-400/25 bg-emerald-400/10 text-emerald-200" variant="outline">
              <CheckCircle2 className="size-3" />
              {publishedRecords.length} publicados
            </Badge>
            <Badge className="border-border bg-background text-muted-foreground" variant="outline">
              <PlayCircle className="size-3" />
              {visiblePreviewRecords.length} em preview
            </Badge>
          </div>
        </div>

        {visiblePreviewRecords.length > 0 ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visiblePreviewRecords.map((record) => (
              <ProductPersonalizationCard key={record.content.id} onOpen={onOpenContent} record={record} />
            ))}
          </div>
        ) : (
          <div className="grid place-items-center px-5 py-14 text-center">
            <div className="grid size-12 place-items-center rounded-lg border border-border bg-background text-muted-foreground">
              <LibraryBig className="size-5" />
            </div>
            <h4 className="mt-4 text-base font-semibold text-foreground">Nenhum produto disponivel para preview</h4>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Quando o catalogo tiver conteudos visiveis, eles aparecem aqui com capa, status de acesso e atalho de
              personalizacao.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
