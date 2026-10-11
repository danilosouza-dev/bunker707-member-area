"use client";

import { CirclePause, CirclePlay, Link2, LoaderCircle, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { AdminSheet, AdminSheetSection } from "../sheet";
import { StatusChip } from "../status-chip";
import { adminToast } from "../toast";
import { AiAccountLinkSheet } from "./ai-account-link-sheet";
import { AiProviderPicker } from "./ai-provider-picker";
import {
  AI_PROVIDER_PARAM,
  buildAiProviderEntries,
  describeAiConnectionState,
  formatAiDateTime,
  getAiProviderMeta,
  validateAiPolicyNumber,
  type AiConnectionAuthMode,
  type AiConnectionSummary,
  type AiPolicyConfig,
  type AiProviderId
} from "./ai-settings-model";
import { ConfirmDialog, RowMenu, SectionCard } from "./kit";

const BASE_PATH = "/admin/configuracoes/ia/conexoes";
const KEY_HINT = "Opcional: só preencha para trocar a chave.";
const PRIORITY_HINT = "Números maiores são tentados primeiro; empates alternam pela conexão menos usada.";

type GatewayState = { configured: boolean; reachable: boolean | null };

type AiConnectionsManagerProps = {
  canEdit: boolean;
  configs: AiPolicyConfig[];
  connections: AiConnectionSummary[];
  gatewayConfigured: boolean;
  provider: AiProviderId;
};

type EditorState = {
  apiKey: string;
  connectionId: string | null;
  errors: { apiKey?: string; label?: string; priority?: string };
  label: string;
  mode: AiConnectionAuthMode;
  priority: string;
};

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error || fallback);
  }

  return payload.data;
}

function gatewayCopy(gateway: GatewayState) {
  if (!gateway.configured) {
    return { label: "Indisponível", text: "O serviço de contas não está configurado neste ambiente. Use chaves de API.", tone: "muted" as const };
  }

  if (gateway.reachable === null) {
    return { label: "Verificando", text: "Verificando o serviço de contas…", tone: "neutral" as const };
  }

  return gateway.reachable
    ? { label: "Pronto", text: "O serviço de contas está no ar e pronto para conectar.", tone: "success" as const }
    : { label: "Fora do ar", text: "O serviço de contas não respondeu. Tente de novo em alguns minutos.", tone: "warning" as const };
}

/** Chaves de API e contas de um provedor (mesmas rotas /api/admin/ai-connections do admin antigo). */
export function AiConnectionsManager({ canEdit, configs, connections: initialConnections, gatewayConfigured, provider }: AiConnectionsManagerProps) {
  const router = useRouter();
  const meta = getAiProviderMeta(provider);
  const [connections, setConnections] = useState(initialConnections);
  const [gateway, setGateway] = useState<GatewayState>({ configured: gatewayConfigured, reachable: gatewayConfigured ? null : false });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiConnectionSummary | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const policy = configs.find((config) => config.provider === provider) ?? null;
  const entries = useMemo(() => buildAiProviderEntries("connections", configs, connections), [configs, connections]);
  const own = connections.filter((connection) => connection.provider === provider);
  const apiKeys = own.filter((connection) => connection.authMode === "api_key");
  const accounts = own.filter((connection) => connection.authMode === "account_gateway");

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/ai-connections", { cache: "no-store", credentials: "same-origin" });
      const data = await readJson<{ connections: AiConnectionSummary[]; gateway: { configured: boolean; reachable: boolean } }>(
        response,
        "Não foi possível carregar as conexões."
      );
      setConnections(data.connections);
      setGateway({ configured: data.gateway.configured, reachable: data.gateway.reachable });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as conexões.");
    }
  }, []);

  // O servidor so diz se o servico de contas esta configurado; se ele responde, o navegador pergunta
  // depois que a tela ja apareceu (a checagem pode levar alguns segundos).
  useEffect(() => {
    const timeout = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timeout);
  }, [reload]);

  function openCreate(mode: AiConnectionAuthMode) {
    setEditorError(null);
    setEditor({ apiKey: "", connectionId: null, errors: {}, label: `Chave ${meta.shortLabel}`, mode, priority: "0" });
  }

  function openEdit(connection: AiConnectionSummary) {
    setEditorError(null);
    setEditor({
      apiKey: "",
      connectionId: connection.id,
      errors: {},
      label: connection.label,
      mode: connection.authMode,
      priority: String(connection.priority)
    });
  }

  function validateEditor(state: EditorState) {
    const errors: EditorState["errors"] = {};

    if (!state.label.trim()) {
      errors.label = "Dê um nome a esta conexão.";
    } else if (state.label.trim().length > 120) {
      errors.label = "Use no máximo 120 caracteres.";
    }

    if (state.mode === "api_key" && !state.connectionId && !state.apiKey.trim()) {
      errors.apiKey = "Cole a chave de API.";
    }

    const priorityError = validateAiPolicyNumber("priority", state.priority);

    if (priorityError) {
      errors.priority = priorityError;
    }

    return errors;
  }

  async function saveEditor(event: FormEvent) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    const errors = validateEditor(editor);

    if (Object.keys(errors).length > 0) {
      setEditor({ ...editor, errors });
      return;
    }

    const id = editor.connectionId;
    setBusyId(id ?? "create");
    setEditorError(null);

    try {
      const response = await fetch(id ? `/api/admin/ai-connections/${id}` : "/api/admin/ai-connections", {
        body: JSON.stringify({
          ...(editor.mode === "api_key" && editor.apiKey.trim() ? { apiKey: editor.apiKey.trim() } : {}),
          label: editor.label.trim(),
          priority: Number(editor.priority.trim()),
          provider
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: id ? "PATCH" : "POST"
      });
      await readJson(response, "Não foi possível salvar a conexão.");
      setEditor(null);
      adminToast.success(id ? "Conexão atualizada" : `Chave do ${meta.shortLabel} adicionada`);
      await reload();
      router.refresh();
    } catch (saveError) {
      setEditorError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a conexão.");
    } finally {
      setBusyId(null);
    }
  }

  async function togglePause(connection: AiConnectionSummary) {
    const pausing = connection.status !== "paused";
    setBusyId(connection.id);
    setError(null);

    try {
      const response = await fetch(`/api/admin/ai-connections/${connection.id}`, {
        body: JSON.stringify({ paused: pausing }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      await readJson(response, "Não foi possível atualizar a conexão.");
      adminToast.success(pausing ? "Conexão pausada" : "Conexão retomada");
      await reload();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Não foi possível atualizar a conexão.");
    } finally {
      setBusyId(null);
    }
  }

  async function testConnection(connection: AiConnectionSummary) {
    setBusyId(connection.id);
    setError(null);

    try {
      const response = await fetch(`/api/admin/ai-connections/${connection.id}/test`, {
        credentials: "same-origin",
        method: "POST"
      });
      await readJson(response, "Não foi possível testar a conexão.");
      adminToast.success(`“${connection.label}” respondeu ao teste`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Não foi possível testar a conexão.");
    } finally {
      setBusyId(null);
      await reload();
    }
  }

  async function removeConnection() {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;
    setBusyId(target.id);
    setError(null);

    try {
      const response = await fetch(`/api/admin/ai-connections/${target.id}`, { credentials: "same-origin", method: "DELETE" });
      await readJson(response, "Não foi possível remover a conexão.");
      setDeleteTarget(null);
      adminToast.success("Conexão removida");
      await reload();
      router.refresh();
    } catch (removeError) {
      setDeleteTarget(null);
      setError(removeError instanceof Error ? removeError.message : "Não foi possível remover a conexão.");
    } finally {
      setBusyId(null);
    }
  }

  function renderRow(connection: AiConnectionSummary) {
    const state = describeAiConnectionState(connection);
    const busy = busyId === connection.id;
    const paused = connection.status === "paused";
    const canTest = canEdit && !paused && Boolean(policy);

    return (
      <li className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center" key={connection.id}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{connection.label}</p>
            <StatusChip tone={state.tone}>{state.label}</StatusChip>
          </div>
          <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs leading-5 text-[var(--text-secondary)]">
            <span className="font-mono">{connection.credentialHint || (connection.authMode === "api_key" ? "Chave protegida" : "Conta conectada")}</span>
            <span>Prioridade {connection.priority}</span>
            <span>Último uso: {formatAiDateTime(connection.lastUsedAt)}</span>
            <span>Último teste: {formatAiDateTime(connection.lastTestedAt)}</span>
          </p>
          {connection.lastErrorMessage ? (
            <p className="truncate text-xs leading-5 text-[var(--error)]" title={connection.lastErrorMessage}>
              {connection.lastErrorMessage}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              className="px-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              disabled={busy || !canTest}
              onClick={() => void testConnection(connection)}
              title={policy ? undefined : "Escolha o modelo do provedor antes de testar"}
              type="button"
              variant="ghost"
            >
              {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              Testar
            </Button>
            <RowMenu
              actions={[
                { icon: <Pencil className="size-4" />, label: "Editar", onSelect: () => openEdit(connection) },
                {
                  icon: paused ? <CirclePlay className="size-4" /> : <CirclePause className="size-4" />,
                  label: paused ? "Retomar" : "Pausar",
                  onSelect: () => void togglePause(connection)
                },
                {
                  destructive: true,
                  icon: <Trash2 className="size-4" />,
                  label: "Remover",
                  onSelect: () => setDeleteTarget(connection),
                  separated: true
                }
              ]}
              label={`Ações de ${connection.label}`}
            />
          </div>
        ) : null}
      </li>
    );
  }

  function renderList(items: AiConnectionSummary[], emptyText: string) {
    if (items.length === 0) {
      return <p className="px-4 pb-5 text-sm leading-5 text-[var(--text-secondary)]">{emptyText}</p>;
    }

    return <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">{items.map(renderRow)}</ul>;
  }

  const gatewayState = gatewayCopy(gateway);
  const editorTitle = editor?.connectionId ? "Editar conexão" : `Adicionar chave do ${meta.shortLabel}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AiProviderPicker basePath={BASE_PATH} entries={entries} selected={provider} />

      {error ? (
        <ErrorBanner
          action={
            <Button className="px-3" onClick={() => setError(null)} type="button" variant="ghost">
              Fechar
            </Button>
          }
        >
          {error}
        </ErrorBanner>
      ) : null}

      {own.length > 0 && !policy ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm leading-5 text-[var(--text-primary)]">
          <span>As conexões estão salvas, mas falta escolher o modelo do {meta.shortLabel} para o Tutor poder usá-las.</span>
          <Link
            className="font-medium underline underline-offset-4 hover:text-[var(--text-secondary)]"
            data-navigation-feedback="false"
            href={`/admin/configuracoes/ia?${AI_PROVIDER_PARAM}=${provider}`}
          >
            Escolher o modelo
          </Link>
        </p>
      ) : policy && own.length > 0 ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
          Todas as conexões do {meta.shortLabel} usam o modelo <span className="font-mono text-[var(--text-primary)]">{policy.defaultModel}</span>.
        </p>
      ) : null}

      <SectionCard
        actions={
          canEdit ? (
            <Button className="px-3" onClick={() => openCreate("api_key")} type="button" variant="secondary">
              <Plus aria-hidden="true" className="size-4" />
              Adicionar chave
            </Button>
          ) : null
        }
        bodyClassName="px-0 pt-4 pb-0 md:px-0 md:pb-0"
        description="Uma ou várias. O Tutor alterna entre as que estão funcionando e passa para a próxima quando uma falha."
        title="Chaves de API"
      >
        {renderList(apiKeys, `Nenhuma chave do ${meta.shortLabel} ainda.`)}
        <p className="flex items-start gap-2 border-t border-[var(--border-subtle)] px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          A chave fica guardada no cofre da plataforma e nunca volta para o navegador; aqui aparecem só os últimos caracteres.
        </p>
      </SectionCard>

      <SectionCard
        actions={
          canEdit ? (
            <Button
              className="px-3"
              disabled={!gateway.configured || gateway.reachable !== true}
              onClick={() => setAccountOpen(true)}
              type="button"
              variant="secondary"
            >
              <Link2 aria-hidden="true" className="size-4" />
              Conectar conta
            </Button>
          ) : null
        }
        bodyClassName="px-0 pt-4 pb-0 md:px-0 md:pb-0"
        description="Usa o login de uma conta do provedor em vez de chave de API."
        meta={<StatusChip tone="warning">Experimental</StatusChip>}
        title="Contas conectadas"
      >
        <p className="flex flex-wrap items-center gap-2 px-4 pb-4 text-[13px] leading-5 text-[var(--text-secondary)]">
          <StatusChip tone={gatewayState.tone}>{gatewayState.label}</StatusChip>
          {gatewayState.text}
        </p>
        {renderList(accounts, `Nenhuma conta do ${meta.shortLabel} conectada.`)}
      </SectionCard>

      <AdminSheet
        description={
          editor?.mode === "account_gateway"
            ? "Nome e prioridade desta conta."
            : editor?.connectionId
              ? "Deixe a chave em branco para manter a atual."
              : `A chave de API é criada no painel do ${meta.shortLabel}.`
        }
        footer={
          <>
            <Button className="px-4 text-[var(--text-secondary)]" onClick={() => setEditor(null)} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button className="px-4" disabled={busyId === "create" || (editor?.connectionId ? busyId === editor.connectionId : false)} form="ia-connection-form" type="submit">
              {busyId === "create" || (editor?.connectionId && busyId === editor.connectionId) ? "Salvando…" : "Salvar conexão"}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open) {
            setEditor(null);
          }
        }}
        open={editor !== null}
        title={editorTitle}
      >
        {editor ? (
          <form className="flex flex-col" id="ia-connection-form" noValidate onSubmit={(event) => void saveEditor(event)}>
            {editorError ? <ErrorBanner className="mt-4">{editorError}</ErrorBanner> : null}
            <AdminSheetSection title="Conexão">
              <AdminField error={editor.errors.label} id="ia-connection-label" label="Nome da conexão">
                <Input
                  aria-describedby={fieldDescribedBy("ia-connection-label", { error: editor.errors.label })}
                  aria-invalid={editor.errors.label ? true : undefined}
                  autoFocus
                  className={adminInputClass}
                  id="ia-connection-label"
                  maxLength={120}
                  onChange={(event) => setEditor({ ...editor, errors: { ...editor.errors, label: undefined }, label: event.target.value })}
                  value={editor.label}
                />
              </AdminField>
              {editor.mode === "api_key" ? (
                <AdminField
                  error={editor.errors.apiKey}
                  hint={editor.connectionId ? KEY_HINT : undefined}
                  id="ia-connection-key"
                  label={editor.connectionId ? "Nova chave de API" : "Chave de API"}
                  optional={Boolean(editor.connectionId)}
                >
                  <Input
                    aria-describedby={fieldDescribedBy("ia-connection-key", {
                      error: editor.errors.apiKey,
                      hint: editor.connectionId ? KEY_HINT : undefined
                    })}
                    aria-invalid={editor.errors.apiKey ? true : undefined}
                    autoComplete="off"
                    className={cn(adminInputClass, "font-mono text-[13px]")}
                    id="ia-connection-key"
                    onChange={(event) => setEditor({ ...editor, apiKey: event.target.value, errors: { ...editor.errors, apiKey: undefined } })}
                    spellCheck={false}
                    type="password"
                    value={editor.apiKey}
                  />
                </AdminField>
              ) : null}
              <AdminField
                error={editor.errors.priority}
                hint={PRIORITY_HINT}
                id="ia-connection-priority"
                label="Prioridade"
              >
                <Input
                  aria-describedby={fieldDescribedBy("ia-connection-priority", {
                    error: editor.errors.priority,
                    hint: PRIORITY_HINT
                  })}
                  aria-invalid={editor.errors.priority ? true : undefined}
                  className={cn(adminInputClass, "max-w-40 tabular-nums")}
                  id="ia-connection-priority"
                  inputMode="numeric"
                  onChange={(event) => setEditor({ ...editor, errors: { ...editor.errors, priority: undefined }, priority: event.target.value })}
                  value={editor.priority}
                />
              </AdminField>
            </AdminSheetSection>
          </form>
        ) : null}
      </AdminSheet>

      <AiAccountLinkSheet
        onConnected={() => {
          setAccountOpen(false);
          adminToast.success(`Conta do ${meta.shortLabel} conectada`);
          void reload();
          router.refresh();
        }}
        onOpenChange={setAccountOpen}
        open={accountOpen}
        provider={provider}
      />

      <ConfirmDialog
        busy={Boolean(deleteTarget && busyId === deleteTarget.id)}
        confirmLabel="Remover conexão"
        description={
          deleteTarget?.authMode === "account_gateway"
            ? "A conta sai também do serviço de contas e vai precisar de um novo login para voltar."
            : "A chave é apagada do cofre da plataforma. O histórico de consumo continua."
        }
        destructive
        onConfirm={() => void removeConnection()}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
        title={deleteTarget ? `Remover “${deleteTarget.label}”?` : "Remover conexão?"}
      />
    </div>
  );
}
