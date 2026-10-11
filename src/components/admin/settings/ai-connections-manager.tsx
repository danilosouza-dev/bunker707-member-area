"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CirclePause,
  CirclePlay,
  Clock3,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  ShieldCheck,
  TestTube2,
  Trash2
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  AIProvider,
  AIProviderAuthMode,
  AIProviderConnection
} from "@/server/ai/types";

type GatewayStatus = {
  configured: boolean;
  message: string;
  reachable: boolean;
};

type ConnectionsPayload = {
  connections: AIProviderConnection[];
  gateway: GatewayStatus;
};

type ConnectionEditor = {
  apiKey: string;
  connectionId: string | null;
  label: string;
  priority: string;
};

type AccountLink = {
  expiresAt: string;
  redirectUrl: string;
  sessionId: string;
  status: "pending" | "processing";
  url: string;
};

const providerLabels: Record<AIProvider, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  openai: "ChatGPT / Codex"
};

const accountLabels: Record<AIProvider, string> = {
  anthropic: "Conta Claude",
  gemini: "Conta Gemini",
  openai: "Conta ChatGPT / Codex"
};

function emptyEditor(provider: AIProvider): ConnectionEditor {
  return {
    apiKey: "",
    connectionId: null,
    label: `API ${providerLabels[provider]}`,
    priority: "0"
  };
}

async function readResponse<T>(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error || fallback);
  }

  return payload.data;
}

function formatDate(value: string | null) {
  if (!value) return "Nunca";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Nunca"
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(date);
}

function connectionState(connection: AIProviderConnection) {
  if (connection.status === "paused") {
    return { className: "border-white/10 bg-white/[0.045] text-zinc-500", label: "Pausada" };
  }

  if (connection.status === "needs_attention") {
    return { className: "border-red-400/20 bg-red-500/10 text-red-200", label: "Requer atenção" };
  }

  if (connection.status === "connecting") {
    return { className: "border-amber-400/20 bg-amber-500/10 text-amber-200", label: "Conectando" };
  }

  if (connection.cooldownUntil && new Date(connection.cooldownUntil).getTime() > Date.now()) {
    return { className: "border-amber-400/20 bg-amber-500/10 text-amber-200", label: "Em espera" };
  }

  if (connection.healthTier === "draining") {
    return { className: "border-amber-400/20 bg-amber-500/10 text-amber-200", label: "Instável" };
  }

  if (connection.healthTier === "probing") {
    return { className: "border-sky-400/20 bg-sky-500/10 text-sky-200", label: "Recuperando" };
  }

  return { className: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200", label: "Saudável" };
}

export function AIConnectionsManager({
  mode,
  onConfigurePolicy,
  policyConfigured,
  policyModel,
  provider
}: {
  mode: AIProviderAuthMode;
  onConfigurePolicy: () => void;
  policyConfigured: boolean;
  policyModel: string | null;
  provider: AIProvider;
}) {
  const [connections, setConnections] = React.useState<AIProviderConnection[]>([]);
  const [gateway, setGateway] = React.useState<GatewayStatus>({ configured: false, message: "", reachable: false });
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editor, setEditor] = React.useState<ConnectionEditor>(() => emptyEditor(provider));
  const [deleteTarget, setDeleteTarget] = React.useState<AIProviderConnection | null>(null);
  const [accountLabel, setAccountLabel] = React.useState(accountLabels[provider]);
  const [accountStartOpen, setAccountStartOpen] = React.useState(false);
  const [accountLink, setAccountLink] = React.useState<AccountLink | null>(null);
  const [accountLoginCopyState, setAccountLoginCopyState] = React.useState<"idle" | "copied" | "error">("idle");
  const accountLoginCopyResetRef = React.useRef<number | null>(null);
  const accountLinkSessionId = accountLink?.sessionId ?? null;

  React.useEffect(() => () => {
    if (accountLoginCopyResetRef.current !== null) {
      window.clearTimeout(accountLoginCopyResetRef.current);
    }
  }, []);

  const loadConnections = React.useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/ai-connections", {
        cache: "no-store",
        credentials: "same-origin"
      });
      const data = await readResponse<ConnectionsPayload>(response, "Não foi possível carregar as conexões de IA.");
      setConnections(data.connections);
      setGateway(data.gateway);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as conexões de IA.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => void loadConnections(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadConnections]);

  React.useEffect(() => {
    if (!accountLinkSessionId) return;
    let cancelled = false;
    let terminal = false;
    let nextPollTimeout: number | null = null;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const response = await fetch(`/api/admin/ai-connections/account/${accountLinkSessionId}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal
        });
        const data = await readResponse<{
          error?: string;
          status: "cancelled" | "completed" | "failed" | "pending";
        }>(response, "Não foi possível consultar a conexão da conta.");

        if (cancelled) return;
        if (data.status === "completed") {
          terminal = true;
          setAccountLink(null);
          setAccountStartOpen(false);
          setMessage("Conta conectada e adicionada ao pool com sucesso.");
          await loadConnections(true);
        } else if (data.status === "failed" || data.status === "cancelled") {
          terminal = true;
          setError(data.error || "A conexão da conta não foi concluída.");
          setAccountLink(null);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : "Não foi possível acompanhar a conexão da conta.");
        }
      } finally {
        if (!cancelled && !terminal) {
          nextPollTimeout = window.setTimeout(() => void poll(), 2_000);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (nextPollTimeout !== null) window.clearTimeout(nextPollTimeout);
    };
  }, [accountLinkSessionId, loadConnections]);

  const visibleConnections = connections.filter((connection) => (
    connection.provider === provider && connection.authMode === mode
  ));

  function openCreateEditor() {
    setEditor(emptyEditor(provider));
    setEditorOpen(true);
    setError("");
    setMessage("");
  }

  function openEditEditor(connection: AIProviderConnection) {
    setEditor({
      apiKey: "",
      connectionId: connection.id,
      label: connection.label,
      priority: String(connection.priority)
    });
    setEditorOpen(true);
    setError("");
    setMessage("");
  }

  async function saveConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = editor.connectionId;
    setBusyId(id ?? "create");
    setError("");
    setMessage("");

    try {
      const response = await fetch(id ? `/api/admin/ai-connections/${id}` : "/api/admin/ai-connections", {
        body: JSON.stringify({
          ...(mode === "api_key" && editor.apiKey.trim() ? { apiKey: editor.apiKey.trim() } : {}),
          label: editor.label,
          priority: Number(editor.priority),
          provider
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: id ? "PATCH" : "POST"
      });
      await readResponse<AIProviderConnection>(response, "Não foi possível salvar a conexão.");
      setEditorOpen(false);
      setEditor(emptyEditor(provider));
      setMessage(id ? "Conexão atualizada." : "API adicionada ao pool.");
      await loadConnections(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a conexão.");
    } finally {
      setBusyId(null);
    }
  }

  async function patchConnection(connection: AIProviderConnection, body: Record<string, unknown>, successMessage: string) {
    setBusyId(connection.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/ai-connections/${connection.id}`, {
        body: JSON.stringify(body),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      await readResponse<AIProviderConnection>(response, "Não foi possível atualizar a conexão.");
      setMessage(successMessage);
      await loadConnections(true);
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Não foi possível atualizar a conexão.");
    } finally {
      setBusyId(null);
    }
  }

  async function testConnection(connection: AIProviderConnection) {
    setBusyId(connection.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/ai-connections/${connection.id}/test`, {
        credentials: "same-origin",
        method: "POST"
      });
      const data = await readResponse<{ message: string }>(response, "Não foi possível testar a conexão.");
      setMessage(data.message);
      await loadConnections(true);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Não foi possível testar a conexão.");
      await loadConnections(true);
    } finally {
      setBusyId(null);
    }
  }

  async function removeConnection() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyId(target.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/ai-connections/${target.id}`, {
        credentials: "same-origin",
        method: "DELETE"
      });
      await readResponse<{ id: string }>(response, "Não foi possível remover a conexão.");
      setDeleteTarget(null);
      setMessage("Conexão removida do pool.");
      await loadConnections(true);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Não foi possível remover a conexão.");
    } finally {
      setBusyId(null);
    }
  }

  async function startAccountLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("account-start");
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/ai-connections/account/start", {
        body: JSON.stringify({ label: accountLabel, provider }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = await readResponse<{ expiresAt: string; sessionId: string; url: string }>(response, "Não foi possível iniciar o login da conta.");
      setAccountLoginCopyState("idle");
      setAccountLink({ ...data, redirectUrl: "", status: "pending" });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Não foi possível iniciar o login da conta.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyAccountLoginLink() {
    if (!accountLink) return;

    if (accountLoginCopyResetRef.current !== null) {
      window.clearTimeout(accountLoginCopyResetRef.current);
    }

    try {
      await navigator.clipboard.writeText(accountLink.url);
      setAccountLoginCopyState("copied");
    } catch {
      setAccountLoginCopyState("error");
    }

    accountLoginCopyResetRef.current = window.setTimeout(() => {
      setAccountLoginCopyState("idle");
      accountLoginCopyResetRef.current = null;
    }, 1_800);
  }

  async function submitAccountCallback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountLink) return;
    setBusyId("account-callback");
    setError("");

    try {
      const response = await fetch(`/api/admin/ai-connections/account/${accountLink.sessionId}`, {
        body: JSON.stringify({ redirectUrl: accountLink.redirectUrl }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      await readResponse<{ status: "processing" }>(response, "Não foi possível concluir o retorno da conta.");
      setAccountLink((current) => current ? { ...current, status: "processing" } : current);
    } catch (callbackError) {
      setError(callbackError instanceof Error ? callbackError.message : "Não foi possível concluir o retorno da conta.");
    } finally {
      setBusyId(null);
    }
  }

  async function closeAccountDialog(open: boolean) {
    if (open) {
      setAccountStartOpen(true);
      return;
    }

    const currentLink = accountLink;
    setAccountLoginCopyState("idle");
    setAccountLink(null);
    setAccountStartOpen(false);

    if (currentLink) {
      await fetch(`/api/admin/ai-connections/account/${currentLink.sessionId}`, {
        credentials: "same-origin",
        method: "DELETE"
      }).catch(() => undefined);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            {mode === "api_key" ? <KeyRound className="size-4 text-zinc-500" /> : <Link2 className="size-4 text-zinc-500" />}
            <p className="text-sm font-semibold text-white">
              {mode === "api_key" ? `APIs ${providerLabels[provider]}` : `Contas ${providerLabels[provider]}`}
            </p>
            {mode === "account_gateway" ? (
              <Badge className="border-amber-400/20 bg-amber-500/10 text-[10px] text-amber-200" variant="outline">
                Experimental
              </Badge>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">
            {mode === "api_key"
              ? "Adicione uma ou várias chaves. O Bunker alterna as conexões saudáveis e usa fallback automático quando uma delas falha."
              : "Conecte uma ou várias contas. O gateway renova o login, enquanto o Bunker escolhe e registra exatamente qual conta respondeu."}
          </p>
        </div>
        <Button
          className="h-9 rounded-[8px] bg-white px-3 text-xs text-black hover:bg-zinc-200"
          disabled={mode === "account_gateway" && (!gateway.configured || !gateway.reachable)}
          onClick={mode === "api_key" ? openCreateEditor : () => setAccountStartOpen(true)}
          type="button"
        >
          <Plus className="size-3.5" />
          {mode === "api_key" ? "Adicionar API" : "Conectar conta"}
        </Button>
      </div>

      {mode === "account_gateway" ? (
        <div className={`flex items-start gap-2.5 rounded-[8px] border px-3 py-2.5 ${gateway.reachable ? "border-emerald-400/15 bg-emerald-500/[0.055]" : "border-amber-400/20 bg-amber-500/[0.07]"}`}>
          {gateway.reachable ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />}
          <p className={`text-xs leading-5 ${gateway.reachable ? "text-emerald-100/75" : "text-amber-100/75"}`}>{gateway.message}</p>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-[8px] border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-zinc-500" />
          <p className="text-xs leading-5 text-zinc-500">A chave é criptografada no cofre da plataforma e nunca volta para o navegador.</p>
        </div>
      )}

      {error ? <p className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200">{error}</p> : null}
      {message ? <p className="rounded-[8px] border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200">{message}</p> : null}
      {!loading && visibleConnections.length > 0 && !policyConfigured ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2.5">
          <p className="text-xs leading-5 text-amber-100/75">A conexão foi salva, mas ainda falta escolher e salvar o modelo deste provedor para o Tutor poder usá-la.</p>
          <Button className="h-8 text-xs" onClick={onConfigurePolicy} type="button" variant="outline">Configurar modelo</Button>
        </div>
      ) : policyModel && visibleConnections.length > 0 ? (
        <p className="text-[11px] text-zinc-600">Modelo compartilhado por estas conexões: <span className="font-mono text-zinc-500">{policyModel}</span></p>
      ) : null}

      {loading ? (
        <div className="grid min-h-40 place-items-center rounded-[8px] border border-white/[0.07] bg-black/15 text-xs text-zinc-600">
          <span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" /> Carregando conexões...</span>
        </div>
      ) : visibleConnections.length ? (
        <div className="space-y-2">
          {visibleConnections.map((connection) => {
            const state = connectionState(connection);
            const busy = busyId === connection.id;

            return (
              <div className="rounded-[8px] border border-white/[0.075] bg-black/15 px-3.5 py-3" key={connection.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-100">{connection.label}</p>
                      <Badge className={state.className} variant="outline">{state.label}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      {connection.credentialHint || (mode === "api_key" ? "Chave protegida" : "Conta conectada")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button aria-label="Testar conexão" className="text-zinc-500 hover:text-zinc-100" disabled={busy || connection.status === "paused" || !policyConfigured} onClick={() => void testConnection(connection)} size="icon-sm" title={policyConfigured ? "Testar conexão" : "Configure o modelo antes de testar"} type="button" variant="ghost">
                      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <TestTube2 className="size-3.5" />}
                    </Button>
                    <Button aria-label="Editar conexão" className="text-zinc-500 hover:text-zinc-100" disabled={busy} onClick={() => openEditEditor(connection)} size="icon-sm" type="button" variant="ghost">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      aria-label={connection.status === "paused" ? "Retomar conexão" : "Pausar conexão"}
                      className="text-zinc-500 hover:text-zinc-100"
                      disabled={busy}
                      onClick={() => void patchConnection(connection, { paused: connection.status !== "paused" }, connection.status === "paused" ? "Conexão retomada." : "Conexão pausada.")}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      {connection.status === "paused" ? <CirclePlay className="size-3.5" /> : <CirclePause className="size-3.5" />}
                    </Button>
                    <Button aria-label="Remover conexão" className="text-zinc-600 hover:text-red-300" disabled={busy} onClick={() => setDeleteTarget(connection)} size="icon-sm" type="button" variant="ghost">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 border-t border-white/[0.055] pt-3 text-[11px] text-zinc-600 sm:grid-cols-3">
                  <span className="flex items-center gap-1.5"><Activity className="size-3" /> Prioridade {connection.priority}</span>
                  <span className="flex items-center gap-1.5"><Clock3 className="size-3" /> Uso: {formatDate(connection.lastUsedAt)}</span>
                  <span className="flex items-center gap-1.5"><TestTube2 className="size-3" /> Teste: {formatDate(connection.lastTestedAt)}</span>
                </div>
                {connection.lastErrorMessage ? (
                  <p className="mt-2 truncate text-[11px] text-red-300/70" title={connection.lastErrorMessage}>{connection.lastErrorMessage}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid min-h-40 place-items-center rounded-[8px] border border-dashed border-white/10 bg-black/10 px-5 text-center">
          <div>
            {mode === "api_key" ? <KeyRound className="mx-auto size-5 text-zinc-700" /> : <Link2 className="mx-auto size-5 text-zinc-700" />}
            <p className="mt-3 text-xs font-semibold text-zinc-400">Nenhuma {mode === "api_key" ? "API" : "conta"} conectada</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-600">Adicione a primeira conexão para este provedor participar do Tutor IA.</p>
          </div>
        </div>
      )}

      <Dialog onOpenChange={setEditorOpen} open={editorOpen}>
        <DialogContent className="border-white/10 bg-[#17181d] text-white">
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 pr-14">
            <DialogTitle className="text-white">{editor.connectionId ? "Editar conexão" : "Adicionar API"}</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-zinc-500">
              {mode === "account_gateway"
                ? "Atualize o nome e a prioridade desta conta no pool."
                : editor.connectionId
                  ? "Deixe a chave vazia para manter o segredo atual."
                  : `Cadastre uma chave de ${providerLabels[provider]} no pool.`}
            </DialogDescription>
          </DialogHeader>
          <form className="overflow-y-auto" onSubmit={saveConnection}>
            <div className="grid gap-4 px-5 py-5">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Nome da conexão</span>
                <Input autoFocus className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm text-white" maxLength={120} onChange={(event) => setEditor((current) => ({ ...current, label: event.target.value }))} required value={editor.label} />
              </label>
              {mode === "api_key" ? (
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-zinc-500">{editor.connectionId ? "Nova chave (opcional)" : "Chave de API"}</span>
                  <Input autoComplete="off" className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] font-mono text-xs text-white" onChange={(event) => setEditor((current) => ({ ...current, apiKey: event.target.value }))} required={!editor.connectionId} type="password" value={editor.apiKey} />
                </label>
              ) : null}
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Prioridade</span>
                <Input className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm text-white" max="1000" min="-1000" onChange={(event) => setEditor((current) => ({ ...current, priority: event.target.value }))} required type="number" value={editor.priority} />
                <span className="text-[10px] leading-4 text-zinc-600">Valores maiores são tentados primeiro. Empates alternam pela conexão menos usada recentemente.</span>
              </label>
            </div>
            <DialogFooter className="border-t border-white/[0.07] px-5 py-4">
              <Button onClick={() => setEditorOpen(false)} type="button" variant="ghost">Cancelar</Button>
              <Button className="bg-white text-black hover:bg-zinc-200" disabled={busyId === "create" || busyId === editor.connectionId} type="submit">
                {busyId === "create" || busyId === editor.connectionId ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                Salvar conexão
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => void closeAccountDialog(open)} open={accountStartOpen}>
        <DialogContent className="max-w-xl border-white/10 bg-[#17181d] text-white">
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 pr-14">
            <DialogTitle className="text-white">Conectar {providerLabels[provider]}</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-zinc-500">O login acontece no site do provedor. Sua senha não passa pela Bunker707.</DialogDescription>
          </DialogHeader>
          {!accountLink ? (
            <form onSubmit={startAccountLink}>
              <div className="grid gap-4 px-5 py-5">
                <div className="rounded-[8px] border border-amber-400/15 bg-amber-500/[0.06] px-3 py-2.5 text-xs leading-5 text-amber-100/75">
                  Integração experimental por conta. Mudanças do provedor podem exigir novo login; para operação crítica, mantenha também uma API como fallback.
                </div>
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-zinc-500">Nome desta conta</span>
                  <Input autoFocus className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm text-white" maxLength={120} onChange={(event) => setAccountLabel(event.target.value)} required value={accountLabel} />
                </label>
              </div>
              <DialogFooter className="border-t border-white/[0.07] px-5 py-4">
                <Button onClick={() => void closeAccountDialog(false)} type="button" variant="ghost">Cancelar</Button>
                <Button className="bg-white text-black hover:bg-zinc-200" disabled={busyId === "account-start"} type="submit">
                  {busyId === "account-start" ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  Continuar
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form onSubmit={submitAccountCallback}>
              <div className="grid gap-4 px-5 py-5">
                <div className="flex items-start gap-2.5 rounded-[8px] border border-sky-400/15 bg-sky-500/[0.055] px-3 py-2.5 text-xs leading-5 text-sky-100/75">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-300" />
                  <span><strong className="font-semibold text-sky-100">A tela de erro do localhost no final é esperada.</strong> Não recarregue nem compartilhe a URL; apenas copie a barra completa e volte para este modal.</span>
                </div>
                <ol className="grid gap-2 text-xs leading-5 text-zinc-400">
                  <li><span className="mr-2 text-zinc-600">1.</span>Abra o login abaixo ou copie o link para usar em outra janela ou perfil.</li>
                  <li><span className="mr-2 text-zinc-600">2.</span>Conclua o login no site do provedor.</li>
                  <li><span className="mr-2 text-zinc-600">3.</span>Quando aparecer “Esta página não está funcionando” ou `ERR_EMPTY_RESPONSE`, copie a URL completa da barra.</li>
                  <li><span className="mr-2 text-zinc-600">4.</span>Cole essa URL abaixo para finalizar.</li>
                </ol>
                <div className="flex flex-wrap items-center gap-2">
                  <Button className="w-fit text-xs text-zinc-300" onClick={() => window.open(accountLink.url, "_blank", "noopener,noreferrer")} type="button" variant="outline">
                    <ExternalLink className="size-3.5" /> Abrir login
                  </Button>
                  <Button
                    aria-live="polite"
                    className="w-fit text-xs text-zinc-300"
                    onClick={() => void copyAccountLoginLink()}
                    type="button"
                    variant="outline"
                  >
                    {accountLoginCopyState === "copied" ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
                    {accountLoginCopyState === "copied" ? "Link copiado" : accountLoginCopyState === "error" ? "Tentar copiar novamente" : "Copiar link de login"}
                  </Button>
                </div>
                <p className="text-[10px] leading-4 text-zinc-600">
                  Link temporário desta tentativa. Use em outra janela ou perfil seu, mas não compartilhe.
                </p>
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-zinc-500">URL local de retorno</span>
                  <textarea
                    autoFocus
                    className="min-h-24 resize-y rounded-[8px] border border-[#2a2d35] bg-[#111217] px-3 py-2 font-mono text-xs leading-5 text-white outline-none focus:border-white/25"
                    onChange={(event) => setAccountLink((current) => current ? { ...current, redirectUrl: event.target.value } : current)}
                    placeholder="http://localhost:.../?code=...&state=..."
                    required
                    value={accountLink.redirectUrl}
                  />
                </label>
                {accountLink.status === "processing" ? (
                  <p className="flex items-center gap-2 rounded-[8px] border border-sky-400/15 bg-sky-500/[0.06] px-3 py-2.5 text-xs text-sky-100/75">
                    <LoaderCircle className="size-4 animate-spin" /> Validando a conta no gateway...
                  </p>
                ) : null}
                <p className="text-[10px] text-zinc-600">Esta tentativa expira às {formatDate(accountLink.expiresAt)}.</p>
              </div>
              <DialogFooter className="border-t border-white/[0.07] px-5 py-4">
                <Button onClick={() => void closeAccountDialog(false)} type="button" variant="ghost">Cancelar</Button>
                <Button className="bg-white text-black hover:bg-zinc-200" disabled={busyId === "account-callback" || accountLink.status === "processing"} type="submit">
                  {busyId === "account-callback" || accountLink.status === "processing" ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                  Copiei a URL, concluir conexão
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { if (!open) setDeleteTarget(null); }} open={Boolean(deleteTarget)}>
        <DialogContent className="border-white/10 bg-[#17181d] text-white">
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 pr-14">
            <DialogTitle className="text-white">Remover conexão?</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-zinc-500">
              {deleteTarget?.authMode === "account_gateway"
                ? "A conta será removida também do gateway e precisará de um novo login para ser usada novamente."
                : "A chave protegida será apagada do cofre da plataforma. O histórico de consumo continuará preservado."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-5 py-4">
            <Button onClick={() => setDeleteTarget(null)} type="button" variant="ghost">Cancelar</Button>
            <Button disabled={busyId === deleteTarget?.id} onClick={() => void removeConnection()} type="button" variant="destructive">
              {busyId === deleteTarget?.id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
