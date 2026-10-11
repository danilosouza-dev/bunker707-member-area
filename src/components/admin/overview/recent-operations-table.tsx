import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminReleaseRule, AdminWebhookEvent } from "@/lib/platform-types";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";
type OperationRow = {
  area: string;
  event: string;
  id: string;
  status: string;
  variant: BadgeVariant;
};

function getWebhookStatusVariant(status: AdminWebhookEvent["status"]): BadgeVariant {
  if (status === "failed") {
    return "destructive";
  }

  if (status === "pending") {
    return "secondary";
  }

  return "outline";
}

function getReleaseRuleStatusVariant(status: AdminReleaseRule["status"]): BadgeVariant {
  if (status === "Ativa") {
    return "default";
  }

  if (status === "Rascunho") {
    return "secondary";
  }

  return "outline";
}

export function RecentOperationsTable({
  releaseRules,
  webhookEvents
}: {
  releaseRules: AdminReleaseRule[];
  webhookEvents: AdminWebhookEvent[];
}) {
  const rows: OperationRow[] = [
    ...webhookEvents.slice(0, 3).map((event) => ({
      area: "Venda recebida",
      event: `${event.provider} - ${event.type}`,
      id: `webhook-${event.id}`,
      status: event.status,
      variant: getWebhookStatusVariant(event.status)
    })),
    ...releaseRules.slice(0, 3).map((rule) => ({
      area: rule.scope,
      event: rule.title,
      id: `release-rule-${rule.id}`,
      status: rule.status,
      variant: getReleaseRuleStatusVariant(rule.status)
    }))
  ].slice(0, 5);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle>Operações recentes</CardTitle>
        <CardDescription>Vendas recebidas e regras de liberação.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Evento</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.event}</TableCell>
                  <TableCell className="text-muted-foreground">{row.area}</TableCell>
                  <TableCell>
                    <Badge variant={row.variant}>{row.status}</Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={3}>
                  Nenhum dado ainda
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
