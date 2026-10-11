"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, KeyRound, PlugZap, RotateCw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type {
  AdminIntegrationProvider,
  AdminIntegrationSetting,
  AdminIntegrationStatus
} from "@/lib/platform-types";

type IntegrationsCommandCenterProps = {
  integrations: AdminIntegrationSetting[];
  onSaveIntegrations: (integrations: AdminIntegrationSetting[]) => Promise<void> | void;
};

const providers = ["Hotmart", "Ticto", "TikTok", "Kiwify", "Manual"] satisfies AdminIntegrationProvider[];

const providerEvents: Record<AdminIntegrationProvider, string[]> = {
  Hotmart: ["purchase_approved", "subscription_canceled", "refund"],
  Kiwify: ["order.paid", "order.refunded", "subscription.canceled"],
  Manual: ["manual_grant", "manual_revoke"],
  Ticto: ["order_approved", "order_refunded", "subscription_past_due"],
  TikTok: ["lead_created", "purchase_confirmed", "refund_confirmed"]
};

const statusLabels: Record<AdminIntegrationStatus, string> = {
  configured: "Configurada",
  needs_attention: "Ajustar",
  not_configured: "Pendente"
};

function getStatusClassName(status: AdminIntegrationStatus) {
  if (status === "configured") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "needs_attention") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  }

  return "border-white/10 bg-white/[0.055] text-zinc-300";
}

function getProviderRecord(provider: AdminIntegrationProvider, integrations: AdminIntegrationSetting[]) {
  return integrations.find((integration) => integration.provider === provider) ?? {
    events: providerEvents[provider],
    id: provider.toLowerCase(),
    provider,
    secretStatus: "missing",
    status: "not_configured",
    webhookUrl: ""
  } satisfies AdminIntegrationSetting;
}

export function IntegrationsCommandCenter({
  integrations,
  onSaveIntegrations
}: IntegrationsCommandCenterProps) {
  const [provider, setProvider] = React.useState<AdminIntegrationProvider>("Hotmart");
  const selectedIntegration = getProviderRecord(provider, integrations);
  const [webhookUrl, setWebhookUrl] = React.useState(selectedIntegration.webhookUrl);
  const [secretStatus, setSecretStatus] = React.useState<"missing" | "saved">(selectedIntegration.secretStatus);
  const configuredCount = providers.filter((item) => getProviderRecord(item, integrations).status === "configured").length;
  const needsAttentionCount = providers.filter((item) => getProviderRecord(item, integrations).status === "needs_attention").length;

  async function saveIntegration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedWebhookUrl = webhookUrl.trim();
    const status: AdminIntegrationStatus = trimmedWebhookUrl && secretStatus === "saved"
      ? "configured"
      : trimmedWebhookUrl || secretStatus === "saved"
        ? "needs_attention"
        : "not_configured";
    const nextIntegration: AdminIntegrationSetting = {
      events: providerEvents[provider],
      id: provider.toLowerCase(),
      lastSyncAt: status === "configured" ? new Date().toISOString() : selectedIntegration.lastSyncAt,
      provider,
      secretStatus,
      status,
      webhookUrl: trimmedWebhookUrl
    };

    await onSaveIntegrations([
      nextIntegration,
      ...integrations.filter((integration) => integration.provider !== provider)
    ]);
  }

  function selectProvider(nextProvider: AdminIntegrationProvider) {
    const nextIntegration = getProviderRecord(nextProvider, integrations);
    setProvider(nextProvider);
    setWebhookUrl(nextIntegration.webhookUrl);
    setSecretStatus(nextIntegration.secretStatus);
  }

  return (
    <section className="space-y-6 text-zinc-100">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Configurações</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">Integracoes</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-500">
          Configure provedores externos como entrada de eventos. A liberação final continua sendo feita pelos acessos internos da Bunker707.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard icon={PlugZap} label="Configuradas" value={configuredCount.toString()} tone="emerald" />
        <MetricCard icon={AlertTriangle} label="Precisam de ajuste" value={needsAttentionCount.toString()} tone="amber" />
        <MetricCard icon={KeyRound} label="Segredos no browser" value="0" tone="zinc" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <CardTitle className="text-base font-semibold text-white">Plataformas</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-white/10 p-0">
            {providers.map((item) => {
              const integration = getProviderRecord(item, integrations);

              return (
                <button
                  className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition ${
                    provider === item ? "bg-white/[0.075]" : "hover:bg-white/[0.045]"
                  }`}
                  key={item}
                  onClick={() => selectProvider(item)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{item}</span>
                    <span className="mt-1 block truncate text-xs font-medium text-zinc-500">
                      {integration.webhookUrl || "Webhook ainda nao configurado"}
                    </span>
                  </span>
                  <Badge className={getStatusClassName(integration.status)} variant="outline">
                    {statusLabels[integration.status]}
                  </Badge>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
              <PlugZap className="size-4 text-zinc-400" />
              {provider}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <form className="space-y-4" onSubmit={saveIntegration}>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">URL ou identificador do webhook</span>
                <Input
                  className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-semibold text-white placeholder:text-zinc-600"
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder="https://..."
                  value={webhookUrl}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Status do segredo</span>
                <Select onValueChange={(value) => setSecretStatus(value as "missing" | "saved")} value={secretStatus}>
                  <SelectTrigger className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-semibold text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-[8px] border-[#2a2d35] bg-[#17181d] text-zinc-100">
                    <SelectItem value="missing">Pendente</SelectItem>
                    <SelectItem value="saved">Salvo no servidor</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <div className="rounded-[8px] border border-white/10 bg-black/20 p-3">
                <p className="text-xs font-semibold text-zinc-500">Eventos esperados</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {providerEvents[provider].map((eventName) => (
                    <span className="rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1 text-[11px] font-semibold text-zinc-300" key={eventName}>
                      {eventName}
                    </span>
                  ))}
                </div>
              </div>

              <Button className="h-10 w-full rounded-[8px] bg-white text-sm font-semibold text-black hover:bg-zinc-200" type="submit">
                <Save className="size-4" />
                Salvar integracao
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  tone,
  value
}: {
  icon: typeof AlertTriangle | typeof CheckCircle2 | typeof KeyRound | typeof PlugZap | typeof RotateCw;
  label: string;
  tone: "amber" | "emerald" | "zinc";
  value: string;
}) {
  const toneClassName = tone === "emerald"
    ? "bg-emerald-500/10 text-emerald-200 ring-emerald-400/20"
    : tone === "amber"
      ? "bg-amber-500/10 text-amber-200 ring-amber-400/20"
      : "bg-white/[0.055] text-zinc-300 ring-white/10";

  return (
    <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`grid size-11 shrink-0 place-items-center rounded-[8px] ring-1 ${toneClassName}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
