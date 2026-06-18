import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { AdminMetricCard } from "@/components/admin/overview/metric-card";
import { OperationsPanel } from "@/components/admin/overview/operations-panel";
import { RecentOperationsTable } from "@/components/admin/overview/recent-operations-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminDashboardData } from "@/lib/platform-types";

export function AdminOverview({ data }: { data: AdminDashboardData }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col gap-3">
          <Badge className="w-fit" variant="outline">
            Entitlements internos
          </Badge>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold text-foreground">Visao geral</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Painel operacional do CRM para acompanhar acesso, conteudo e sinais externos sem expor dados sensiveis.
            </p>
          </div>
        </div>

        <Button render={<Link href="/" />} nativeButton={false} variant="outline">
          Ver area do aluno
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <AdminMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Acesso e conteudo</CardTitle>
            <CardDescription>Contagens seguras para leitura operacional.</CardDescription>
            <CardAction>
              <Badge variant="secondary">Fonte de verdade</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
              <span className="text-sm text-muted-foreground">Conteudos</span>
              <strong className="text-2xl font-semibold text-foreground">{data.contentRecords.length}</strong>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
              <span className="text-sm text-muted-foreground">Alunos</span>
              <strong className="text-2xl font-semibold text-foreground">{data.students.length}</strong>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
              <span className="text-sm text-muted-foreground">Entitlements</span>
              <strong className="text-2xl font-semibold text-foreground">{data.entitlements.length}</strong>
            </div>
          </CardContent>
        </Card>

        <OperationsPanel pipeline={data.pipeline} releaseRules={data.releaseRules} webhookEvents={data.webhookEvents} />
      </section>

      <RecentOperationsTable releaseRules={data.releaseRules} webhookEvents={data.webhookEvents} />
    </div>
  );
}
