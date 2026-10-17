"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { disconnectSalesProvider, saveSalesSecret } from "@/server/payments/actions";
import { describeSecretState, saleEventLabel, salesProviderChip } from "@/server/payments/model";
import type { SalesProviderCard } from "@/server/payments/queries";
import { salesSecretSchema } from "@/server/payments/schemas";
import type { SalesProvider } from "@/server/payments/types";
import { ErrorBanner } from "../../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../../form";
import { AdminLinkButton } from "../../link-button";
import { StatusChip } from "../../status-chip";
import { formatDateTime, formatRelativeDate } from "../../students/format";
import { adminTransition } from "../../styles";
import { adminToast } from "../../toast";
import { ConfirmDialog, SectionCard } from "../kit";

// Cartao de uma plataforma conectavel (Hotmart, Ticto) em Configuracoes > Vendas (docs/17 §1.10): o
// endereco para colar na plataforma, os eventos para marcar la, o token (guardado so no servidor: depois
// de salvo a tela mostra apenas a data e o botao Trocar), Desconectar e o estado da ultima venda. O que
// muda de uma plataforma para a outra e so o texto (PROVIDER_COPY). "webhook" so aqui.

type ProviderCopy = {
  /** Frase do cabecalho do cartao. */
  description: string;
  /** O que cada evento faz com o acesso (abaixo da lista de eventos). */
  eventsHint: string;
  /** Onde cadastrar o webhook e pegar o token, na linguagem da plataforma. */
  steps: string;
  tokenLabel: string;
  tokenPlaceholder: string;
};

const PROVIDER_COPY: Partial<Record<SalesProvider, ProviderCopy>> = {
  hotmart: {
    description: "A Hotmart avisa cada compra, reembolso e chargeback; o acesso do aluno muda sozinho.",
    eventsHint: "Compra aprovada libera o acesso; reembolso e chargeback tiram; assinatura cancelada suspende. Outros eventos chegam, ficam guardados e não mudam nada.",
    steps:
      "Na Hotmart, abra Ferramentas › Webhook › Cadastrar webhook. Cole o endereço abaixo, escolha a versão 2.0.0 e marque os eventos listados. O token (Hottok) fica na aba Autenticação da mesma tela.",
    tokenLabel: "Token da Hotmart (Hottok)",
    tokenPlaceholder: "Cole o token da aba Autenticação"
  },
  ticto: {
    description: "A Ticto avisa cada compra, reembolso e chargeback; o acesso do aluno muda sozinho.",
    eventsHint:
      "Compra aprovada e assinatura reativada liberam o acesso; reembolso e chargeback tiram; assinatura cancelada suspende. Produto vendido junto (order bump) entra na mesma compra quando também tem o código da Ticto. Outros eventos chegam, ficam guardados e não mudam nada.",
    steps:
      "Na Ticto, abra Tictools › Webhooks e adicione um webhook. Cole o endereço abaixo, escolha a versão 2.0 e o formato JSON, marque os eventos listados e copie o token que a Ticto gera nessa tela.",
    tokenLabel: "Token da Ticto",
    tokenPlaceholder: "Cole o token gerado pela Ticto"
  }
};

function copyFor(card: SalesProviderCard): ProviderCopy {
  return (
    PROVIDER_COPY[card.provider] ?? {
      description: `A ${card.label} avisa cada compra, reembolso e chargeback; o acesso do aluno muda sozinho.`,
      eventsHint: "Compra aprovada libera o acesso; reembolso e chargeback tiram; assinatura cancelada suspende. Outros eventos chegam, ficam guardados e não mudam nada.",
      steps: `Na ${card.label}, cadastre um webhook com o endereço abaixo, marque os eventos listados e copie o token gerado.`,
      tokenLabel: `Token da ${card.label}`,
      tokenPlaceholder: "Cole o token da plataforma"
    }
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const resetRef = useRef<number | null>(null);

  async function copy() {
    if (resetRef.current !== null) {
      window.clearTimeout(resetRef.current);
    }

    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("error");
    }

    resetRef.current = window.setTimeout(() => {
      setState("idle");
      resetRef.current = null;
    }, 1_800);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <Input aria-label={label} className={cn(adminInputClass, "font-mono text-[13px]")} onFocus={(event) => event.currentTarget.select()} readOnly value={value} />
        <Button aria-live="polite" className="shrink-0 gap-1.5 px-3" onClick={() => void copy()} type="button" variant="secondary">
          {state === "copied" ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          {state === "copied" ? "Copiado" : state === "error" ? "Copie à mão" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}

/** `now`: instante lido no servidor (a pagina), para o "ha 2 h" da ultima venda. */
export function ProviderConnectCard({ card, now }: { card: SalesProviderCard; now: number }) {
  const router = useRouter();
  const copy = copyFor(card);
  const tokenFieldId = `${card.provider}-token`;
  const connected = card.status !== "not_configured";
  const [editing, setEditing] = useState(!connected);
  const [secret, setSecret] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  /** Data gravada agora ha pouco, ate o servidor devolver a pagina atualizada. */
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const chip = salesProviderChip({ status: card.status, supported: card.supported });
  const secretUpdatedAt = card.secretUpdatedAt ?? savedAt;
  const secretStatus = card.status === "not_configured" && savedAt ? "configured" : card.status;

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (saving) {
      return;
    }

    const parsed = salesSecretSchema.safeParse(secret);

    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Token inválido.");
      return;
    }

    setSaving(true);
    setFormError(null);
    const result = await saveSalesSecret({ provider: card.provider, secret: parsed.data });
    setSaving(false);

    if (!result.ok) {
      const message = result.fieldErrors?.secret?.[0];

      if (message) {
        setFieldError(message);
      } else {
        setFormError(result.error);
      }

      return;
    }

    setSecret("");
    setSavedAt(result.data.secretUpdatedAt);
    setEditing(false);
    adminToast.success(connected ? "Token trocado" : `${card.label} conectada`);
    router.refresh();
  }

  async function disconnect() {
    setDisconnecting(true);
    const result = await disconnectSalesProvider({ provider: card.provider });
    setDisconnecting(false);
    setConfirmDisconnect(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    setSavedAt(null);
    setEditing(true);
    adminToast.success(`${card.label} desconectada`);
    router.refresh();
  }

  return (
    <SectionCard actions={<StatusChip tone={chip.tone}>{chip.label}</StatusChip>} description={copy.description} title={card.label}>
      <div className="flex min-w-0 flex-col gap-5">
        {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}

        {card.status === "needs_attention" && card.lastError ? (
          <ErrorBanner title="A última venda recebida deu erro">
            {card.lastError} O evento ficou guardado: veja a lista abaixo e use Reprocessar.
          </ErrorBanner>
        ) : null}

        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.steps}</p>

        <CopyField label={`Endereço para colar na ${card.label}`} value={card.webhookUrl} />

        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Eventos para marcar na {card.label}</span>
          <ul aria-label={`Eventos para marcar na ${card.label}`} className="flex min-w-0 flex-wrap gap-1.5">
            {card.events.map((event) => (
              <li key={event}>
                <StatusChip tone="neutral">{saleEventLabel(event)}</StatusChip>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.eventsHint}</p>
        </div>

        {editing ? (
          <form className="flex min-w-0 flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
            <AdminField
              error={fieldError}
              hint="Fica guardado só no servidor. Depois de salvar, ninguém vê o token de novo; dá para trocar quando quiser."
              id={tokenFieldId}
              label={copy.tokenLabel}
            >
              <Input
                aria-describedby={fieldDescribedBy(tokenFieldId, { error: fieldError, hint: true })}
                aria-invalid={fieldError ? true : undefined}
                autoComplete="off"
                className={cn(adminInputClass, "max-w-[520px] font-mono text-[13px]")}
                disabled={saving}
                id={tokenFieldId}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setFieldError(null);
                }}
                placeholder={copy.tokenPlaceholder}
                spellCheck={false}
                type="password"
                value={secret}
              />
            </AdminField>
            <div className="flex flex-wrap items-center gap-2">
              <Button className="gap-1.5 px-4" disabled={saving} type="submit">
                <KeyRound aria-hidden="true" className="size-4" />
                {saving ? "Salvando…" : connected ? "Salvar novo token" : "Salvar token"}
              </Button>
              {connected ? (
                <Button className="px-4" disabled={saving} onClick={() => setEditing(false)} type="button" variant="ghost">
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm leading-5 text-[var(--text-primary)]">
              {describeSecretState({ secretUpdatedAt, status: secretStatus }, formatDateTime)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button className="px-4" onClick={() => setEditing(true)} type="button" variant="secondary">
                Trocar token
              </Button>
              <Button
                className={cn("px-4 text-[var(--text-secondary)] hover:text-[var(--error)]", adminTransition)}
                onClick={() => setConfirmDisconnect(true)}
                type="button"
                variant="ghost"
              >
                Desconectar
              </Button>
            </div>
          </div>
        )}

        <dl className="grid gap-3 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-[var(--text-tertiary)]">Última venda recebida</dt>
            <dd className="text-sm text-[var(--text-primary)]">{card.lastSyncAt ? formatRelativeDate(card.lastSyncAt, now, "Nenhuma ainda") : "Nenhuma ainda"}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-[var(--text-tertiary)]">Produtos e pacotes com código da {card.label}</dt>
            <dd className="text-sm text-[var(--text-primary)]">{card.linkedTargets === 1 ? "1 ligado" : `${card.linkedTargets} ligados`}</dd>
          </div>
        </dl>

        {card.linkedTargets === 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-3 text-[13px] leading-5 text-[var(--text-secondary)]">
            <p>
              <span className="font-medium text-[var(--warning)]">Falta ligar os produtos.</span> Sem o código da {card.label} em cada produto ou pacote, a venda chega e fica
              como “Ignorado”. Informe o código em Produtos › Acesso e venda ou em Pacotes.
            </p>
            <div className="flex flex-wrap gap-2">
              <AdminLinkButton href="/admin/produtos" variant="secondary">
                Abrir Produtos
              </AdminLinkButton>
              <AdminLinkButton href="/admin/produtos/pacotes" variant="ghost">
                Abrir Pacotes
              </AdminLinkButton>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        busy={disconnecting}
        confirmLabel="Desconectar"
        description={`O token é apagado e as vendas novas da ${card.label} deixam de chegar até você colar um token de novo. Os acessos já liberados continuam.`}
        destructive
        onConfirm={() => void disconnect()}
        onOpenChange={setConfirmDisconnect}
        open={confirmDisconnect}
        title={`Desconectar a ${card.label}?`}
      />
    </SectionCard>
  );
}
