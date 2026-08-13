"use client";

import * as React from "react";
import {
  BarChart3,
  BrainCircuit,
  KeyRound,
  Link2,
  LoaderCircle,
  Save,
  Settings2
} from "lucide-react";

import { AIConnectionsManager } from "@/components/admin/settings/ai-connections-manager";
import {
  AIUsageDashboard,
  type AIUsageSummary
} from "@/components/admin/settings/ai-usage-dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AIProvider, AIProviderConfig } from "@/server/ai/types";

type SettingsTab = "accounts" | "apis" | "models" | "usage";

type ProviderForm = {
  contextMaxCharacters: string;
  dailyQuestionLimit: string;
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
  maxOutputTokens: string;
  monthlyQuestionLimit: string;
  priority: string;
  temperature: string;
};

const providers: Array<{ defaultModel: string; id: AIProvider; label: string; shortLabel: string }> = [
  { defaultModel: "gemini-3.1-flash-lite", id: "gemini", label: "Google Gemini", shortLabel: "Gemini" },
  { defaultModel: "gpt-4.1-mini", id: "openai", label: "OpenAI / ChatGPT", shortLabel: "OpenAI" },
  { defaultModel: "claude-haiku-4-5-20251001", id: "anthropic", label: "Anthropic / Claude", shortLabel: "Claude" }
];

const tabs: Array<{ icon: React.ComponentType<{ className?: string }>; id: SettingsTab; label: string }> = [
  { icon: Settings2, id: "models", label: "Modelos e limites" },
  { icon: KeyRound, id: "apis", label: "APIs" },
  { icon: Link2, id: "accounts", label: "Contas conectadas" },
  { icon: BarChart3, id: "usage", label: "Consumo" }
];

function getProviderMeta(provider: AIProvider) {
  return providers.find((item) => item.id === provider) ?? providers[0];
}

function makeForm(provider: AIProvider, config?: AIProviderConfig): ProviderForm {
  return {
    contextMaxCharacters: String(config?.contextMaxCharacters ?? 60000),
    dailyQuestionLimit: String(config?.dailyQuestionLimit ?? 20),
    defaultModel: config?.defaultModel ?? getProviderMeta(provider).defaultModel,
    enabled: config?.enabled ?? true,
    isDefault: config?.isDefault ?? false,
    maxOutputTokens: String(config?.maxOutputTokens ?? 900),
    monthlyQuestionLimit: String(config?.monthlyQuestionLimit ?? 10000),
    priority: String(config?.priority ?? 0),
    temperature: String(config?.temperature ?? 0.2)
  };
}

export function AIProviderSettings() {
  const [tab, setTab] = React.useState<SettingsTab>("models");
  const [provider, setProvider] = React.useState<AIProvider>("gemini");
  const [configs, setConfigs] = React.useState<AIProviderConfig[]>([]);
  const [form, setForm] = React.useState<ProviderForm>(() => makeForm("gemini"));
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [usage, setUsage] = React.useState<AIUsageSummary | null>(null);
  const [usageDays, setUsageDays] = React.useState(30);
  const [usageLoading, setUsageLoading] = React.useState(false);
  const [gatewayModels, setGatewayModels] = React.useState<Partial<Record<AIProvider, string[]>>>({});
  const currentConfig = configs.find((config) => config.provider === provider);
  const detectedModels = gatewayModels[provider] ?? [];
  const gatewayModelsLoading = tab === "models" && gatewayModels[provider] === undefined;

  const loadConfigs = React.useCallback(async (focusProvider: AIProvider) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/ai-providers", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as { data?: AIProviderConfig[]; error?: string };

      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel carregar os modelos.");
      setConfigs(payload.data);
      setForm(makeForm(focusProvider, payload.data.find((config) => config.provider === focusProvider)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar os modelos.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => void loadConfigs("gemini"), 0);
    return () => window.clearTimeout(timeout);
  }, [loadConfigs]);

  React.useEffect(() => {
    if (tab !== "models" || gatewayModels[provider] !== undefined) return;
    const controller = new AbortController();

    void fetch(`/api/admin/ai-connections/models?provider=${provider}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json() as { data?: string[] };
      const models = response.ok && Array.isArray(payload.data) ? payload.data : [];

      setGatewayModels((current) => ({ ...current, [provider]: models }));
      if (!configs.some((config) => config.provider === provider) && models[0]) {
        setForm((current) => current.defaultModel === getProviderMeta(provider).defaultModel
          ? { ...current, defaultModel: models[0] }
          : current);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setGatewayModels((current) => ({ ...current, [provider]: [] }));
    });

    return () => controller.abort();
  }, [configs, gatewayModels, provider, tab]);

  const loadUsage = React.useCallback(async (days: number) => {
    setUsageLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/ai-usage?days=${days}`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as { data?: AIUsageSummary; error?: string };

      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel carregar o consumo.");
      setUsage(payload.data);
      setUsageDays(Number.isInteger(payload.data.days) ? payload.data.days : days);
    } catch (usageError) {
      setError(usageError instanceof Error ? usageError.message : "Nao foi possivel carregar o consumo.");
    } finally {
      setUsageLoading(false);
    }
  }, []);

  function selectTab(nextTab: SettingsTab) {
    setTab(nextTab);
    setError("");
    setMessage("");
    if (nextTab === "usage" && !usage) void loadUsage(usageDays);
  }

  function selectProvider(nextProvider: AIProvider) {
    setProvider(nextProvider);
    setForm(makeForm(nextProvider, configs.find((config) => config.provider === nextProvider)));
    setError("");
    setMessage("");
  }

  function updateForm(field: keyof ProviderForm, value: boolean | string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/ai-providers", {
        body: JSON.stringify({
          ...form,
          contextMaxCharacters: Number(form.contextMaxCharacters),
          dailyQuestionLimit: Number(form.dailyQuestionLimit),
          maxOutputTokens: Number(form.maxOutputTokens),
          monthlyQuestionLimit: Number(form.monthlyQuestionLimit),
          priority: Number(form.priority),
          provider,
          temperature: Number(form.temperature)
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = await response.json() as { data?: AIProviderConfig[]; error?: string };

      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel salvar o modelo.");
      setConfigs(payload.data);
      setForm(makeForm(provider, payload.data.find((config) => config.provider === provider)));
      setMessage("Modelo, ordem de fallback e limites salvos.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Nao foi possivel salvar o modelo.");
    } finally {
      setSaving(false);
    }
  }

  function changeUsageDays(days: number) {
    void loadUsage(days);
  }

  return (
    <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <CardHeader className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
            <BrainCircuit className="size-4 text-[var(--accent)]" />
            Tutor IA e IA Diretor
          </CardTitle>
          <Badge className="border-white/10 bg-white/[0.045] text-[10px] font-medium text-zinc-400" variant="outline">
            Bunker AI LB
          </Badge>
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Gerencie os provedores compartilhados pelos agentes, suas conexoes, limites e consumo auditado.
        </p>
        <div className="mt-4 flex gap-1 overflow-x-auto rounded-[8px] border border-white/[0.07] bg-black/15 p-1">
          {tabs.map((item) => (
            <button
              className={`inline-flex shrink-0 items-center gap-2 rounded-[6px] px-3 py-2 text-xs font-medium transition ${tab === item.id ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              key={item.id}
              onClick={() => selectTab(item.id)}
              type="button"
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-5">
        {tab !== "usage" ? (
          <ProviderPicker configs={configs} onSelect={selectProvider} provider={provider} />
        ) : null}

        {error ? <p className="mt-4 rounded-[8px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200">{error}</p> : null}
        {message ? <p className="mt-4 rounded-[8px] border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200">{message}</p> : null}

        {tab === "models" ? (
          <form className="mt-5 grid gap-5" onSubmit={savePolicy}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{getProviderMeta(provider).label}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">A politica vale para todas as APIs e contas deste provedor.</p>
              </div>
              {currentConfig ? (
                <Badge className={currentConfig.enabled ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/5 text-zinc-500"} variant="outline">
                  {currentConfig.isDefault ? "Primeiro provedor" : currentConfig.enabled ? "Ativo no fallback" : "Desativado"}
                </Badge>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-semibold text-zinc-500">Modelo</span>
                <Input className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-medium text-white" list={`gateway-models-${provider}`} onChange={(event) => updateForm("defaultModel", event.target.value)} value={form.defaultModel} />
                <datalist id={`gateway-models-${provider}`}>
                  {detectedModels.map((model) => <option key={model} value={model} />)}
                </datalist>
                {gatewayModelsLoading ? (
                  <span className="text-[10px] text-zinc-600">Consultando modelos das contas conectadas...</span>
                ) : detectedModels.length ? (
                  <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-600">
                    Detectados no gateway:
                    {detectedModels.slice(0, 12).map((model) => (
                      <button className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-1 font-mono text-zinc-500 transition hover:border-white/20 hover:text-zinc-200" key={model} onClick={() => updateForm("defaultModel", model)} type="button">{model}</button>
                    ))}
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-600">Digite um modelo da API ou conecte uma conta para detectar os modelos disponíveis.</span>
                )}
              </label>
              <NumberField label="Perguntas por aluno / 24h" min="1" onChange={(value) => updateForm("dailyQuestionLimit", value)} value={form.dailyQuestionLimit} />
              <NumberField label="Perguntas mensais deste provedor" min="1" onChange={(value) => updateForm("monthlyQuestionLimit", value)} value={form.monthlyQuestionLimit} />
              <NumberField label="Tokens maximos por resposta" min="64" onChange={(value) => updateForm("maxOutputTokens", value)} value={form.maxOutputTokens} />
              <NumberField label="Caracteres maximos de contexto" min="5000" onChange={(value) => updateForm("contextMaxCharacters", value)} value={form.contextMaxCharacters} />
              <NumberField label="Temperatura (0 a 1)" max="1" min="0" onChange={(value) => updateForm("temperature", value)} step="0.05" value={form.temperature} />
              <NumberField label="Prioridade entre provedores" min="-1000" onChange={(value) => updateForm("priority", value)} value={form.priority} />
              <ToggleField checked={form.enabled} label="Provedor ativo" onChange={(value) => updateForm("enabled", value)} />
              <ToggleField checked={form.isDefault} label="Tentar este provedor primeiro" onChange={(value) => updateForm("isDefault", value)} />
            </div>

            <div className="flex justify-end">
              <Button className="h-10 rounded-[8px] bg-white text-black hover:bg-zinc-200" disabled={loading || saving} type="submit">
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                Salvar politica
              </Button>
            </div>
          </form>
        ) : null}

        {tab === "apis" ? <AIConnectionsManager key={`api-${provider}`} mode="api_key" onConfigurePolicy={() => selectTab("models")} policyConfigured={Boolean(currentConfig)} policyModel={currentConfig?.defaultModel ?? null} provider={provider} /> : null}
        {tab === "accounts" ? <AIConnectionsManager key={`account-${provider}`} mode="account_gateway" onConfigurePolicy={() => selectTab("models")} policyConfigured={Boolean(currentConfig)} policyModel={currentConfig?.defaultModel ?? null} provider={provider} /> : null}
        {tab === "usage" ? <AIUsageDashboard days={usageDays} loading={usageLoading} onDaysChange={changeUsageDays} summary={usage} /> : null}
      </CardContent>
    </Card>
  );
}

function ProviderPicker({
  configs,
  onSelect,
  provider
}: {
  configs: AIProviderConfig[];
  onSelect: (provider: AIProvider) => void;
  provider: AIProvider;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {providers.map((item) => {
        const config = configs.find((entry) => entry.provider === item.id);

        return (
          <button
            className={`flex min-w-0 items-center justify-between gap-3 rounded-[8px] border px-3.5 py-3 text-left transition ${provider === item.id ? "border-white/20 bg-white/[0.08]" : "border-white/[0.07] bg-black/15 hover:bg-white/[0.045]"}`}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">{item.shortLabel}</span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-zinc-600">{config?.defaultModel ?? "Configure o modelo"}</span>
            </span>
            <span className={`size-2 shrink-0 rounded-full ${config?.enabled ? "bg-emerald-400" : "bg-zinc-700"}`} />
          </button>
        );
      })}
    </div>
  );
}

function NumberField({ label, max, min, onChange, step, value }: { label: string; max?: string; min: string; onChange: (value: string) => void; step?: string; value: string }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-zinc-500">{label}</span>
      <Input className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-medium text-white" max={max} min={min} onChange={(event) => onChange(event.target.value)} step={step} type="number" value={value} />
    </label>
  );
}

function ToggleField({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center gap-3 rounded-[8px] border border-white/[0.08] bg-black/15 px-3 text-xs font-semibold text-zinc-300">
      <input checked={checked} className="size-4 accent-[var(--accent)]" onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      {label}
    </label>
  );
}
