"use client";

import * as React from "react";
import { Bot, Brain, MessageCircle, PauseCircle, PlayCircle, Save, Sparkles, Trash2 } from "lucide-react";

import { AIProviderSettings } from "@/components/admin/settings/ai-provider-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  AdminAIAgent,
  AdminAIAgentScope,
  AdminAIAgentStatus,
  AdminSellableProduct
} from "@/lib/platform-types";

type AIAgentsCommandCenterProps = {
  agents: AdminAIAgent[];
  onSaveAgents: (agents: AdminAIAgent[]) => Promise<void> | void;
  products: AdminSellableProduct[];
};

const scopeLabels: Record<AdminAIAgentScope, string> = {
  comments: "Responder comentarios",
  global_assistant: "Assistente geral",
  home_chat: "Chat da home",
  lesson_tutor: "Tutor de aula"
};

const statusLabels: Record<AdminAIAgentStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado",
  training: "Treinando"
};

const defaultInstructions: Record<AdminAIAgentScope, string> = {
  comments: "Responda como equipe Bunker707, com tom direto, util e sem prometer acesso ou suporte financeiro.",
  global_assistant: "Ajude o aluno a encontrar cursos, modulos e aulas usando a estrutura cadastrada na plataforma.",
  home_chat: "Oriente o aluno na home, priorizando conteudos liberados e proximos passos da jornada.",
  lesson_tutor: "Explique conceitos da aula atual com base no conteudo da aula, sem inventar trechos nao cadastrados."
};

function makeId(prefix: string, value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${prefix}-${slug || Date.now().toString(36)}`;
}

function getStatusClassName(status: AdminAIAgentStatus) {
  if (status === "active") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "training") {
    return "border-sky-400/25 bg-sky-500/10 text-sky-200";
  }

  if (status === "paused") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  }

  return "border-white/10 bg-white/[0.055] text-zinc-300";
}

export function AIAgentsCommandCenter({
  agents,
  onSaveAgents,
  products
}: AIAgentsCommandCenterProps) {
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<AdminAIAgentScope>("lesson_tutor");
  const [instructions, setInstructions] = React.useState(defaultInstructions.lesson_tutor);
  const [selectedProductIds, setSelectedProductIds] = React.useState<string[]>([]);
  const [autoReply, setAutoReply] = React.useState(false);
  const activeAgents = agents.filter((agent) => agent.status === "active").length;
  const tutorAgents = agents.filter((agent) => agent.scope === "lesson_tutor").length;

  function updateScope(nextScope: AdminAIAgentScope) {
    setScope(nextScope);
    setInstructions(defaultInstructions[nextScope]);
    setAutoReply(nextScope === "comments");
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) => (
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    ));
  }

  async function createAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      return;
    }

    const nextAgent: AdminAIAgent = {
      autoReply,
      id: makeId("ai-agent", trimmedName),
      instructions: instructions.trim(),
      lastTrainedAt: undefined,
      name: trimmedName,
      productIds: selectedProductIds,
      scope,
      status: "draft",
      trainingSources: ["catalog_structure", "lesson_metadata"]
    };

    await onSaveAgents([nextAgent, ...agents.filter((agent) => agent.id !== nextAgent.id)]);
    setName("");
    setSelectedProductIds([]);
    setAutoReply(false);
    setScope("lesson_tutor");
    setInstructions(defaultInstructions.lesson_tutor);
  }

  async function updateAgentStatus(agentId: string, status: AdminAIAgentStatus) {
    await onSaveAgents(agents.map((agent) => (
      agent.id === agentId
        ? {
          ...agent,
          lastTrainedAt: status === "training" ? new Date().toISOString() : agent.lastTrainedAt,
          status
        }
        : agent
    )));
  }

  async function removeAgent(agentId: string) {
    await onSaveAgents(agents.filter((agent) => agent.id !== agentId));
  }

  return (
    <section className="space-y-6 text-zinc-100">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">IA</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">Agentes de IA</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-500">
          Configure o Tutor IA, a IA Diretor e os demais agentes. Modelos, limites, conexoes e consumo ficam centralizados aqui.
        </p>
      </div>

      <AIProviderSettings />

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard icon={Bot} label="Agentes ativos" value={activeAgents.toString()} />
        <MetricCard icon={Brain} label="Tutores de aula" value={tutorAgents.toString()} />
        <MetricCard icon={MessageCircle} label="Auto resposta" value={agents.filter((agent) => agent.autoReply).length.toString()} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <CardTitle className="text-base font-semibold text-white">Agentes cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {agents.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Bot className="mx-auto size-10 text-zinc-700" />
                <p className="mt-4 text-lg font-semibold text-white">Nenhum agente configurado.</p>
                <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-zinc-500">
                  Crie agentes agora para definir onde cada um atua antes de conectar transcrições, embeddings e conversas.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {agents.map((agent) => (
                  <article className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto]" key={agent.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-white">{agent.name}</h2>
                        <Badge className={getStatusClassName(agent.status)} variant="outline">
                          {statusLabels[agent.status]}
                        </Badge>
                        <Badge className="border-white/10 bg-white/[0.055] text-zinc-300" variant="outline">
                          {scopeLabels[agent.scope]}
                        </Badge>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-zinc-500">{agent.instructions}</p>
                      <p className="mt-2 text-xs font-semibold text-zinc-600">
                        {agent.productIds.length > 0 ? `${agent.productIds.length} produto(s) vinculados` : "Todos os produtos"}
                        {agent.autoReply ? " / auto resposta ligada" : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <Button
                        className="h-9 rounded-[8px] border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-300 hover:bg-white/10"
                        onClick={() => updateAgentStatus(agent.id, agent.status === "active" ? "paused" : "active")}
                        type="button"
                        variant="outline"
                      >
                        {agent.status === "active" ? <PauseCircle className="size-4" /> : <PlayCircle className="size-4" />}
                        {agent.status === "active" ? "Pausar" : "Ativar"}
                      </Button>
                      <Button
                        className="h-9 rounded-[8px] border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-300 hover:bg-sky-500/10 hover:text-sky-200"
                        onClick={() => updateAgentStatus(agent.id, "training")}
                        type="button"
                        variant="outline"
                      >
                        <Sparkles className="size-4" />
                        Treinar
                      </Button>
                      <Button
                        aria-label={`Excluir agente ${agent.name}`}
                        className="size-9 rounded-[8px] border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-red-500/10 hover:text-red-200"
                        onClick={() => removeAgent(agent.id)}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
              <Sparkles className="size-4 text-zinc-400" />
              Novo agente
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <form className="space-y-4" onSubmit={createAgent}>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Nome</span>
                <Input
                  className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-semibold text-white placeholder:text-zinc-600"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Tutor Clone Perfeito"
                  value={name}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Onde aparece</span>
                <Select onValueChange={(value) => updateScope(value as AdminAIAgentScope)} value={scope}>
                  <SelectTrigger className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-semibold text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-[8px] border-[#2a2d35] bg-[#17181d] text-zinc-100">
                    <SelectItem value="lesson_tutor">Tutor de aula</SelectItem>
                    <SelectItem value="comments">Responder comentarios</SelectItem>
                    <SelectItem value="global_assistant">Assistente geral</SelectItem>
                    <SelectItem value="home_chat">Chat da home</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Instrucao base</span>
                <textarea
                  className="min-h-28 resize-none rounded-[8px] border border-[#2a2d35] bg-[#111217] px-3 py-2 text-sm font-medium leading-6 text-white outline-none placeholder:text-zinc-600 focus:border-white/30 focus:ring-3 focus:ring-white/10"
                  onChange={(event) => setInstructions(event.target.value)}
                  value={instructions}
                />
              </label>

              <div className="grid gap-2">
                <span className="text-xs font-semibold text-zinc-500">Produtos vinculados</span>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-[8px] border border-white/10 bg-black/20 p-2">
                  {products.map((product) => {
                    const checked = selectedProductIds.includes(product.id);

                    return (
                      <button
                        className={cn(
                          "flex w-full items-center gap-3 rounded-[8px] border px-3 py-2 text-left transition",
                          checked
                            ? "border-sky-400/25 bg-sky-500/10"
                            : "border-white/10 bg-white/[0.035] hover:bg-white/[0.07]"
                        )}
                        key={product.id}
                        onClick={() => toggleProduct(product.id)}
                        type="button"
                      >
                        <Checkbox checked={checked} className="pointer-events-none" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{product.title}</span>
                          <span className="text-xs font-medium text-zinc-500">{product.kind}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                className={cn(
                  "flex w-full items-center gap-3 rounded-[8px] border px-3 py-2 text-left transition",
                  autoReply
                    ? "border-emerald-400/25 bg-emerald-500/10"
                    : "border-white/10 bg-white/[0.035] hover:bg-white/[0.07]"
                )}
                onClick={() => setAutoReply((current) => !current)}
                type="button"
              >
                <Checkbox checked={autoReply} className="pointer-events-none" />
                <span>
                  <span className="block text-sm font-semibold text-white">Permitir resposta automatica</span>
                  <span className="text-xs font-medium text-zinc-500">Recomendado somente depois de validar o treinamento.</span>
                </span>
              </button>

              <Button
                className="h-10 w-full rounded-[8px] bg-white text-sm font-semibold text-black hover:bg-zinc-200"
                disabled={!name.trim()}
                type="submit"
              >
                <Save className="size-4" />
                Salvar agente
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
  value
}: {
  icon: typeof Bot | typeof Brain | typeof MessageCircle;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="grid size-11 shrink-0 place-items-center rounded-[8px] bg-white/[0.07] text-white ring-1 ring-white/10">
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
