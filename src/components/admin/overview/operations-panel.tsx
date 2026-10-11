import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminPipelineItem, AdminReleaseRule, AdminWebhookEvent } from "@/lib/platform-types";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function getWebhookStatusVariant(status: AdminWebhookEvent["status"]): BadgeVariant {
  if (status === "failed") {
    return "destructive";
  }

  if (status === "pending") {
    return "secondary";
  }

  return "outline";
}

export function OperationsPanel({
  pipeline,
  releaseRules,
  webhookEvents
}: {
  pipeline: AdminPipelineItem[];
  releaseRules: AdminReleaseRule[];
  webhookEvents: AdminWebhookEvent[];
}) {
  const failedWebhooks = webhookEvents.filter((event) => event.status === "failed").length;
  const pendingWebhooks = webhookEvents.filter((event) => event.status === "pending").length;
  const activeReleaseRules = releaseRules.filter((rule) => rule.status === "Ativa").length;
  const visiblePipeline = pipeline.slice(0, 3);
  const visibleWebhookEvents = webhookEvents.slice(0, 3);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle>Operação de acesso</CardTitle>
        <CardDescription>Regras de liberação e vendas recebidas das plataformas.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
            <span className="text-sm text-muted-foreground">Regras ativas</span>
            <strong className="text-2xl font-semibold text-foreground">{activeReleaseRules}</strong>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
            <span className="text-sm text-muted-foreground">Vendas pendentes</span>
            <strong className="text-2xl font-semibold text-foreground">{pendingWebhooks}</strong>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
            <span className="text-sm text-muted-foreground">Vendas com falha</span>
            <strong className="text-2xl font-semibold text-foreground">{failedWebhooks}</strong>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Pipeline editorial</h3>
            <Badge variant="outline">3 primeiros</Badge>
          </div>
          {visiblePipeline.length > 0 ? (
            <div className="flex flex-col gap-2">
              {visiblePipeline.map((item) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3" key={item.label}>
                  <span className="text-sm text-foreground">{item.label}</span>
                  <Badge variant="secondary">{item.count}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum dado ainda</p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-foreground">Vendas recebidas recentes</h3>
          {visibleWebhookEvents.length > 0 ? (
            <div className="flex flex-col gap-2">
              {visibleWebhookEvents.map((event) => (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3" key={event.id}>
                  <span className="text-sm text-foreground">
                    {event.provider} - {event.type}
                  </span>
                  <Badge variant={getWebhookStatusVariant(event.status)}>{event.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum dado ainda</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
