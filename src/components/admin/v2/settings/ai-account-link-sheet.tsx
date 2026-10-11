"use client";

import { Check, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { AdminSheet, AdminSheetSection } from "../sheet";
import { formatAiDateTime, getAiProviderMeta, type AiProviderId } from "./ai-settings-model";

// Conectar uma conta do provedor (login no site dele, sem chave de API). Mesmo fluxo e mesmas rotas
// do admin antigo: start -> o produtor faz login -> cola o endereco de retorno -> acompanhamos ate
// concluir. O acompanhamento nunca sobrepoe pedidos (um por vez, a cada 2 s, cancelavel).

type AccountLink = {
  expiresAt: string;
  redirectUrl: string;
  sessionId: string;
  status: "pending" | "processing";
  url: string;
};

type AiAccountLinkSheetProps = {
  onConnected: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  provider: AiProviderId;
};

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error || fallback);
  }

  return payload.data;
}

export function AiAccountLinkSheet({ onConnected, onOpenChange, open, provider }: AiAccountLinkSheetProps) {
  const meta = getAiProviderMeta(provider);
  const [label, setLabel] = useState(`Conta ${meta.shortLabel}`);
  const [link, setLink] = useState<AccountLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyResetRef = useRef<number | null>(null);
  const sessionId = link?.sessionId ?? null;
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
    },
    []
  );

  // Acompanha a conexao depois que o produtor colou o endereco de retorno.
  useEffect(() => {
    if (!sessionId || link?.status !== "processing") {
      return;
    }

    let cancelled = false;
    let terminal = false;
    let nextPoll: number | null = null;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const response = await fetch(`/api/admin/ai-connections/account/${sessionId}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal
        });
        const data = await readJson<{ error?: string; status: "cancelled" | "completed" | "failed" | "pending" }>(
          response,
          "Não foi possível acompanhar a conexão da conta."
        );

        if (cancelled) {
          return;
        }

        if (data.status === "completed") {
          terminal = true;
          setLink(null);
          onConnectedRef.current();
        } else if (data.status === "failed" || data.status === "cancelled") {
          terminal = true;
          setLink(null);
          setError(data.error || "A conexão da conta não foi concluída. Comece de novo.");
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : "Não foi possível acompanhar a conexão da conta.");
        }
      } finally {
        if (!cancelled && !terminal) {
          nextPoll = window.setTimeout(() => void poll(), 2_000);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      controller.abort();

      if (nextPoll !== null) {
        window.clearTimeout(nextPoll);
      }
    };
  }, [link?.status, sessionId]);

  function reset() {
    setLink(null);
    setBusy(false);
    setError(null);
    setCopyState("idle");
    setLabel(`Conta ${meta.shortLabel}`);
  }

  function close() {
    const current = link;
    reset();
    onOpenChange(false);

    // Sessao aberta e nao concluida: cancela no servidor para nao deixar login pendurado.
    if (current) {
      void fetch(`/api/admin/ai-connections/account/${current.sessionId}`, {
        credentials: "same-origin",
        method: "DELETE"
      }).catch(() => undefined);
    }
  }

  async function start(event: FormEvent) {
    event.preventDefault();

    if (!label.trim()) {
      setError("Dê um nome a esta conta.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/ai-connections/account/start", {
        body: JSON.stringify({ label: label.trim(), provider }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = await readJson<{ expiresAt: string; sessionId: string; url: string }>(
        response,
        "Não foi possível iniciar o login da conta."
      );
      setLink({ ...data, redirectUrl: "", status: "pending" });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Não foi possível iniciar o login da conta.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCallback(event: FormEvent) {
    event.preventDefault();

    if (!link) {
      return;
    }

    if (!link.redirectUrl.trim()) {
      setError("Cole o endereço completo que apareceu no fim do login.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/ai-connections/account/${link.sessionId}`, {
        body: JSON.stringify({ redirectUrl: link.redirectUrl.trim() }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      await readJson<{ status: "processing" }>(response, "Não foi possível concluir o retorno da conta.");
      setLink((current) => (current ? { ...current, status: "processing" } : current));
    } catch (callbackError) {
      setError(callbackError instanceof Error ? callbackError.message : "Não foi possível concluir o retorno da conta.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLoginLink() {
    if (!link) {
      return;
    }

    if (copyResetRef.current !== null) {
      window.clearTimeout(copyResetRef.current);
    }

    try {
      await navigator.clipboard.writeText(link.url);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }

    copyResetRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetRef.current = null;
    }, 1_800);
  }

  const processing = link?.status === "processing";
  const formId = link ? "ia-account-callback" : "ia-account-start";

  return (
    <AdminSheet
      description="O login acontece no site do provedor. A senha não passa pela Bunker707."
      footer={
        <>
          <Button className="px-4 text-[var(--text-secondary)]" onClick={close} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={busy || processing} form={formId} type="submit">
            {busy || processing ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            {link ? (processing ? "Validando a conta…" : "Concluir conexão") : "Continuar"}
          </Button>
        </>
      }
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      open={open}
      title={`Conectar conta ${meta.shortLabel}`}
    >
      {error ? <ErrorBanner className="mt-4">{error}</ErrorBanner> : null}

      {!link ? (
        <form className="flex flex-col" id={formId} onSubmit={(event) => void start(event)}>
          <AdminSheetSection title="Antes de começar">
            <p className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2.5 text-[13px] leading-5 text-[var(--text-primary)]">
              Conexão por conta é experimental. Uma mudança do provedor pode pedir novo login; mantenha também uma chave de API
              como reserva.
            </p>
            <AdminField hint="Aparece só aqui, para você reconhecer a conta." id="ia-account-label" label="Nome desta conta">
              <Input
                aria-describedby={fieldDescribedBy("ia-account-label", { hint: "Aparece só aqui, para você reconhecer a conta." })}
                autoFocus
                className={adminInputClass}
                id="ia-account-label"
                maxLength={120}
                onChange={(event) => setLabel(event.target.value)}
                value={label}
              />
            </AdminField>
          </AdminSheetSection>
        </form>
      ) : (
        <form className="flex flex-col" id={formId} onSubmit={(event) => void submitCallback(event)}>
          <AdminSheetSection title="1. Faça o login no site do provedor">
            <div className="flex flex-wrap gap-2">
              <Button
                className="px-3"
                onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}
                type="button"
                variant="secondary"
              >
                <ExternalLink aria-hidden="true" className="size-4" />
                Abrir login
              </Button>
              <Button aria-live="polite" className="px-3" onClick={() => void copyLoginLink()} type="button" variant="ghost">
                {copyState === "copied" ? (
                  <Check aria-hidden="true" className="size-4 text-[var(--success)]" />
                ) : (
                  <Copy aria-hidden="true" className="size-4" />
                )}
                {copyState === "copied" ? "Link copiado" : copyState === "error" ? "Copiar de novo" : "Copiar link"}
              </Button>
            </div>
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
              Use outra janela ou outro perfil seu se preferir, mas não compartilhe o link. Ele vale até{" "}
              {formatAiDateTime(link.expiresAt, "—")}.
            </p>
          </AdminSheetSection>

          <AdminSheetSection title="2. Copie o endereço do fim do login">
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
              No fim, o navegador mostra uma página de erro (&ldquo;Esta página não está funcionando&rdquo;). É esperado: não recarregue;
              copie o endereço completo da barra e cole abaixo.
            </p>
            <AdminField id="ia-account-redirect" label="Endereço de retorno">
              <textarea
                autoFocus
                className={cn(adminTextareaClass, "font-mono text-xs leading-5")}
                disabled={processing}
                id="ia-account-redirect"
                onChange={(event) => setLink((current) => (current ? { ...current, redirectUrl: event.target.value } : current))}
                placeholder="http://localhost:…/?code=…&state=…"
                value={link.redirectUrl}
              />
            </AdminField>
            {processing ? (
              <p className="flex items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                Validando a conta. Isso leva alguns segundos.
              </p>
            ) : null}
          </AdminSheetSection>
        </form>
      )}
    </AdminSheet>
  );
}
