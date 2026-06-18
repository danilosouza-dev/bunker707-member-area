import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminMetric } from "@/lib/platform-types";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function getMetricBadgeVariant(tone: AdminMetric["tone"]): BadgeVariant {
  if (tone === "red") {
    return "destructive";
  }

  if (tone === "neutral") {
    return "outline";
  }

  return "secondary";
}

export function AdminMetricCard({ metric }: { metric: AdminMetric }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardDescription>{metric.label}</CardDescription>
        <CardTitle className="text-3xl font-semibold text-foreground">{metric.value}</CardTitle>
      </CardHeader>
      <CardContent>
        <Badge variant={getMetricBadgeVariant(metric.tone)}>{metric.delta}</Badge>
      </CardContent>
    </Card>
  );
}
