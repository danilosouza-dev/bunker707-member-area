"use client";

import * as React from "react";
import {
  CheckCircle2,
  EyeOff,
  MessageCircle,
  MessageSquareReply,
  OctagonAlert,
  Plus,
  Search,
  ShieldAlert,
  Trash2
} from "lucide-react";

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
  AdminBlockedWordRule,
  AdminCommentKind,
  AdminCommentStatus,
  AdminModerationItem,
  AdminSellableProduct
} from "@/lib/platform-types";

type ModerationCommandCenterProps = {
  blockedWordRules: AdminBlockedWordRule[];
  items: AdminModerationItem[];
  onModerationDataChange: (data: {
    blockedWordRules: AdminBlockedWordRule[];
    moderationItems: AdminModerationItem[];
  }) => void;
  products: AdminSellableProduct[];
};

const statusLabels: Record<AdminCommentStatus, string> = {
  approved: "Aprovado",
  hidden: "Ocultado",
  pending: "Pendente",
  spam: "Spam"
};

const kindLabels: Record<AdminCommentKind, string> = {
  comment: "Comentario",
  reply: "Resposta"
};

function getStatusClassName(status: AdminCommentStatus) {
  if (status === "approved") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "pending") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  }

  if (status === "spam") {
    return "border-red-400/25 bg-red-500/10 text-red-200";
  }

  return "border-zinc-400/20 bg-white/[0.055] text-zinc-300";
}

export function ModerationCommandCenter({
  blockedWordRules,
  items,
  onModerationDataChange,
  products
}: ModerationCommandCenterProps) {
  const [productFilter, setProductFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [kindFilter, setKindFilter] = React.useState<"all" | AdminCommentKind>("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "review" | AdminCommentStatus>("review");
  const [word, setWord] = React.useState("");
  const [message, setMessage] = React.useState("Alguma palavra usada esta contra as regras da comunidade.");
  const [requestError, setRequestError] = React.useState("");
  const [savingKey, setSavingKey] = React.useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const counts = React.useMemo(() => ({
    approved: items.filter((item) => item.status === "approved").length,
    hidden: items.filter((item) => item.status === "hidden").length,
    review: items.filter((item) => item.status === "pending" || item.reportCount > 0).length,
    spam: items.filter((item) => item.status === "spam").length
  }), [items]);
  const filteredItems = React.useMemo(() => (
    items.filter((item) => {
      const matchesProduct = productFilter === "all" || item.productId === productFilter;
      const matchesKind = kindFilter === "all" || item.kind === kindFilter;
      const matchesStatus = statusFilter === "all" || (
        statusFilter === "review"
          ? item.status === "pending" || item.reportCount > 0
          : item.status === statusFilter
      );
      const matchesQuery = !normalizedQuery || [
        item.authorName,
        item.body,
        item.lessonTitle,
        item.productTitle
      ].some((value) => value.toLowerCase().includes(normalizedQuery));

      return matchesProduct && matchesKind && matchesStatus && matchesQuery;
    })
  ), [items, kindFilter, normalizedQuery, productFilter, statusFilter]);

  async function requestModerationData(path: string, init: RequestInit, key: string) {
    setRequestError("");
    setSavingKey(key);

    try {
      const response = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init.headers
        }
      });
      const payload = await response.json() as {
        data?: {
          blockedWordRules: AdminBlockedWordRule[];
          moderationItems: AdminModerationItem[];
        };
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Nao foi possivel salvar a moderacao.");
      }

      onModerationDataChange(payload.data);
      return true;
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Nao foi possivel salvar a moderacao.");
      return false;
    } finally {
      setSavingKey("");
    }
  }

  async function updateItemStatus(itemId: string, status: AdminCommentStatus) {
    await requestModerationData(`/api/admin/moderation/comments/${encodeURIComponent(itemId)}`, {
      body: JSON.stringify({ status }),
      method: "PATCH"
    }, `comment:${itemId}`);
  }

  async function addBlockedWord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedWord = word.trim();

    if (!trimmedWord) {
      return;
    }

    const saved = await requestModerationData("/api/admin/moderation/blocked-words", {
      body: JSON.stringify({ message, word: trimmedWord }),
      method: "POST"
    }, "blocked-word:new");

    if (saved) setWord("");
  }

  async function toggleBlockedWord(ruleId: string) {
    const rule = blockedWordRules.find((candidate) => candidate.id === ruleId);

    if (!rule) return;

    await requestModerationData(`/api/admin/moderation/blocked-words/${encodeURIComponent(ruleId)}`, {
      body: JSON.stringify({ active: !rule.active }),
      method: "PATCH"
    }, `blocked-word:${ruleId}`);
  }

  async function removeBlockedWord(ruleId: string) {
    await requestModerationData(`/api/admin/moderation/blocked-words/${encodeURIComponent(ruleId)}`, {
      method: "DELETE"
    }, `blocked-word:${ruleId}`);
  }

  return (
    <section className="space-y-6 text-zinc-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">CRM / Comentarios</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">Moderacao</h1>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-500">
            Revise comentarios e respostas das aulas por produto, status e texto. Palavras bloqueadas impedem o envio antes da publicacao.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard icon={OctagonAlert} label="Em revisao" value={counts.review.toString()} tone="amber" />
        <MetricCard icon={CheckCircle2} label="Aprovados" value={counts.approved.toString()} tone="emerald" />
        <MetricCard icon={EyeOff} label="Ocultados" value={counts.hidden.toString()} tone="zinc" />
        <MetricCard icon={ShieldAlert} label="Spam" value={counts.spam.toString()} tone="red" />
      </div>

      {requestError ? (
        <div className="rounded-[8px] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100" role="alert">
          {requestError}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_12rem_10rem_10rem]">
              <label className="relative min-w-0">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <span className="sr-only">Buscar comentario</span>
                <Input
                  className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] pr-10 pl-3 text-sm font-semibold text-white placeholder:text-zinc-600"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por comentario, aula ou aluno"
                  type="search"
                  value={query}
                />
              </label>
              <FilterSelect onValueChange={setProductFilter} value={productFilter}>
                <SelectItem value="all">Todos produtos</SelectItem>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.title}
                  </SelectItem>
                ))}
              </FilterSelect>
              <FilterSelect onValueChange={(value) => setKindFilter(value as "all" | AdminCommentKind)} value={kindFilter}>
                <SelectItem value="all">Comentarios e respostas</SelectItem>
                <SelectItem value="comment">Comentarios</SelectItem>
                <SelectItem value="reply">Respostas</SelectItem>
              </FilterSelect>
              <FilterSelect onValueChange={(value) => setStatusFilter(value as "all" | "review" | AdminCommentStatus)} value={statusFilter}>
                <SelectItem value="review">Em revisao</SelectItem>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="approved">Aprovados</SelectItem>
                <SelectItem value="hidden">Ocultados</SelectItem>
                <SelectItem value="spam">Spam</SelectItem>
              </FilterSelect>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filteredItems.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <MessageCircle className="mx-auto size-10 text-zinc-700" />
                <p className="mt-4 text-lg font-semibold text-white">Nenhum comentario para moderar.</p>
                <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-zinc-500">
                  A fila esta atualizada. Novos comentarios, respostas e denuncias aparecem aqui automaticamente.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filteredItems.map((item) => (
                  <article className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto]" key={item.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={getStatusClassName(item.status)} variant="outline">
                          {statusLabels[item.status]}
                        </Badge>
                        <Badge className="border-white/10 bg-white/[0.055] text-zinc-300" variant="outline">
                          {kindLabels[item.kind]}
                        </Badge>
                        {item.reportCount > 0 ? (
                          <Badge className="border-red-400/25 bg-red-500/10 text-red-200" variant="outline">
                            {item.reportCount} {item.reportCount === 1 ? "denuncia" : "denuncias"}
                          </Badge>
                        ) : null}
                        <span className="text-xs font-semibold text-zinc-500">{item.productTitle} / {item.lessonTitle}</span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-white">
                        {item.authorName}
                        {item.parentAuthorName ? <span className="text-zinc-500"> respondeu {item.parentAuthorName}</span> : null}
                      </p>
                      <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-zinc-300">{item.body}</p>
                      <p className="mt-2 text-xs font-semibold text-zinc-600">
                        {item.reactionCount} {item.reactionCount === 1 ? "reacao" : "reacoes"} · {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short"
                        }).format(new Date(item.createdAt))}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <ActionButton disabled={savingKey === `comment:${item.id}` || item.status === "approved"} icon={CheckCircle2} label={item.status === "approved" ? "Aprovado" : "Aprovar"} onClick={() => updateItemStatus(item.id, "approved")} />
                      <ActionButton disabled={savingKey === `comment:${item.id}` || item.status === "hidden"} icon={EyeOff} label={item.status === "hidden" ? "Ocultado" : "Ocultar"} onClick={() => updateItemStatus(item.id, "hidden")} />
                      <ActionButton disabled={savingKey === `comment:${item.id}` || item.status === "spam"} icon={ShieldAlert} label={item.status === "spam" ? "Spam" : "Spam"} onClick={() => updateItemStatus(item.id, "spam")} />
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
              <ShieldAlert className="size-4 text-zinc-400" />
              Palavras bloqueadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <form className="space-y-3" onSubmit={addBlockedWord}>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Palavra ou termo</span>
                <Input
                  className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-semibold text-white placeholder:text-zinc-600"
                  onChange={(event) => setWord(event.target.value)}
                  placeholder="Ex.: palavra proibida"
                  value={word}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Mensagem para o aluno</span>
                <textarea
                  className="min-h-20 resize-none rounded-[8px] border border-[#2a2d35] bg-[#111217] px-3 py-2 text-sm font-medium leading-6 text-white outline-none placeholder:text-zinc-600 focus:border-white/30 focus:ring-3 focus:ring-white/10"
                  onChange={(event) => setMessage(event.target.value)}
                  value={message}
                />
              </label>
              <Button
                className="h-10 w-full rounded-[8px] bg-white text-sm font-semibold text-black hover:bg-zinc-200"
                disabled={!word.trim() || savingKey === "blocked-word:new"}
                type="submit"
              >
                <Plus className="size-4" />
                Adicionar palavra
              </Button>
            </form>

            <div className="space-y-2">
              {blockedWordRules.length === 0 ? (
                <p className="rounded-[8px] border border-white/10 bg-black/20 px-3 py-6 text-center text-sm font-medium text-zinc-500">
                  Nenhuma palavra bloqueada.
                </p>
              ) : blockedWordRules.map((rule) => (
                <div className="rounded-[8px] border border-white/10 bg-black/20 p-3" key={rule.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{rule.word}</p>
                      <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-zinc-500">{rule.message}</p>
                    </div>
                    <Button
                      aria-label={`Excluir palavra ${rule.word}`}
                      className="size-8 rounded-[8px] text-zinc-500 hover:bg-red-500/10 hover:text-red-200"
                      disabled={savingKey === `blocked-word:${rule.id}`}
                      onClick={() => removeBlockedWord(rule.id)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Button
                    className="mt-3 h-8 w-full rounded-[8px] border-white/10 bg-white/[0.04] text-xs font-semibold text-zinc-300 hover:bg-white/10"
                    disabled={savingKey === `blocked-word:${rule.id}`}
                    onClick={() => toggleBlockedWord(rule.id)}
                    type="button"
                    variant="outline"
                  >
                    {rule.active ? "Ativa" : "Inativa"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function FilterSelect({
  children,
  onValueChange,
  value
}: {
  children: React.ReactNode;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <Select
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") {
          onValueChange(nextValue);
        }
      }}
      value={value}
    >
      <SelectTrigger className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-semibold text-zinc-200">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-[8px] border-[#2a2d35] bg-[#17181d] text-zinc-100">
        {children}
      </SelectContent>
    </Select>
  );
}

function ActionButton({
  disabled,
  icon: Icon,
  label,
  onClick
}: {
  disabled?: boolean;
  icon: typeof CheckCircle2 | typeof EyeOff | typeof ShieldAlert;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-9 rounded-[8px] border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-300 hover:bg-white/10 hover:text-white"
      disabled={disabled}
      onClick={onClick}
      type="button"
      variant="outline"
    >
      <Icon className="size-4" />
      {label}
    </Button>
  );
}

function MetricCard({
  icon: Icon,
  label,
  tone,
  value
}: {
  icon: typeof CheckCircle2 | typeof EyeOff | typeof OctagonAlert | typeof ShieldAlert | typeof MessageSquareReply;
  label: string;
  tone: "amber" | "emerald" | "red" | "zinc";
  value: string;
}) {
  const toneClassName = tone === "emerald"
    ? "bg-emerald-500/10 text-emerald-200 ring-emerald-400/20"
    : tone === "amber"
      ? "bg-amber-500/10 text-amber-200 ring-amber-400/20"
      : tone === "red"
        ? "bg-red-500/10 text-red-200 ring-red-400/20"
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
