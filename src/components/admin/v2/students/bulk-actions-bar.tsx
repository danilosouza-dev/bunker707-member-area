"use client";

import { CalendarClock, Download, Mail, Plus, Trash2, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { exportStudentsCsv, runBulkStudentAction, undoBulkStudentAction } from "@/server/students/actions";
import {
  BULK_ACTION_LABELS,
  BULK_BATCH_SIZE,
  BULK_EMAIL_BATCH_SIZE,
  BULK_MAX_TOTAL,
  BULK_SKIP_REASON_LABELS,
  type BulkAction,
  type BulkItemResult,
  type EntitlementSnapshot,
  type StudentCohort
} from "@/server/students/model";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../form";
import { ProductDialog } from "../products/dialog-frame";
import { adminTransition } from "../styles";
import { adminToast } from "../toast";
import { CohortSelect, withCohort } from "./cohort-select";
import { downloadTextFile } from "./export-button";
import type { PickerProduct } from "./product-picker";
import { useStudentSelection } from "./student-selection";

// Barra fixa "N selecionados" (docs/17 §1.7.1). Cada acao roda em lotes de 25 com progresso, teto de
// 200 por rodada; a equipe e sempre recusada no servidor. Remover/estender tem "Desfazer" por 10 s, que
// restaura exatamente o que cada acesso tinha. Falhas parciais ficam num resumo persistente com
// "Baixar lista" (nunca em toast).

type BulkActionsBarProps = {
  canExport: boolean;
  cohorts: readonly StudentCohort[];
  /** Nomes dos alunos desta pagina (para o resumo); quem ficou de outra pagina aparece pelo e-mail/id. */
  labels: Readonly<Record<string, string>>;
  products: readonly PickerProduct[];
  today: string;
};

type DialogKind = Exclude<BulkAction, "extend_30" | "extend_90" | "set_end"> | "extend" | null;
type ExtendMode = "extend_30" | "extend_90" | "set_end";

type RunSummary = {
  action: BulkAction;
  done: number;
  emailLimitHit: boolean;
  failed: { label: string; error: string }[];
  /** Erro que interrompeu a rodada no meio: o que veio antes continua valendo (e desfazível). */
  interrupted: { error: string; remaining: number } | null;
  skipped: Record<string, number>;
  snapshots: EntitlementSnapshot[];
  total: number;
};

function chunk<T>(items: readonly T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

const selectTrigger = cn(
  "w-full rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-3 text-sm text-[var(--text-primary)] hover:border-[var(--border-stronger)] data-[size=default]:h-10",
  adminTransition
);

function ProductField({ disabled, onChange, products, value }: { disabled: boolean; onChange: (id: string | null) => void; products: readonly PickerProduct[]; value: string | null }) {
  const items = products.map((product) => ({ label: product.title, value: product.id }));

  return (
    <AdminField id="massa-produto" label="Produto">
      <Select disabled={disabled} items={items} onValueChange={(next) => onChange((next as string | null) ?? null)} value={value}>
        <SelectTrigger className={selectTrigger} id="massa-produto">
          <SelectValue className="min-w-0 truncate" placeholder="Escolha o produto" />
        </SelectTrigger>
        <SelectContent className="max-h-72 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </AdminField>
  );
}

export function BulkActionsBar({ canExport, cohorts: initialCohorts, labels, products, today }: BulkActionsBarProps) {
  const router = useRouter();
  const { clear, selected, tooMany } = useStudentSelection();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [productId, setProductId] = useState<string | null>(products[0]?.id ?? null);
  const [endsAt, setEndsAt] = useState("");
  const [extendMode, setExtendMode] = useState<ExtendMode>("extend_30");
  /** undefined = ainda nao escolheu; null = "Tirar da turma". */
  const [cohortId, setCohortId] = useState<string | null | undefined>(undefined);
  const [cohorts, setCohorts] = useState(initialCohorts);
  const [error, setError] = useState<string | null>(null);
  const [barError, setBarError] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [exporting, setExporting] = useState(false);
  const ids = Array.from(selected);
  const count = ids.length;
  const busy = progress !== null;

  if (count === 0 && !undoError) {
    return null;
  }

  if (count === 0 && undoError) {
    // A selecao ja foi limpa, mas o Desfazer falhou: o erro fica visivel ate ser fechado.
    return (
      <div className="sticky bottom-0 z-30 mt-4" role="region" aria-label="Erro ao desfazer">
        <ErrorBanner action={<Button className="px-3" onClick={() => setUndoError(null)} type="button" variant="ghost">Fechar</Button>}>
          {undoError}
        </ErrorBanner>
      </div>
    );
  }

  const productTitle = products.find((product) => product.id === productId)?.title ?? "produto";

  function close() {
    if (busy) {
      return;
    }

    setDialog(null);
    setError(null);
    setSummary(null);
  }

  function labelFor(id: string) {
    return labels[id] ?? id.slice(0, 8);
  }

  async function run(action: BulkAction) {
    if (tooMany) {
      setError(`Marque no máximo ${BULK_MAX_TOTAL} alunos por vez. Use os filtros para dividir.`);
      return;
    }

    const needsProduct = action !== "resend_access_email";

    if (needsProduct && !productId) {
      setError("Escolha o produto.");
      return;
    }

    if (action === "set_end" && !endsAt) {
      setError("Escolha a nova data de término.");
      return;
    }

    if (action === "set_cohort" && cohortId === undefined) {
      setError("Escolha a turma.");
      return;
    }

    setError(null);
    setSummary(null);
    const batchId = crypto.randomUUID();
    const batches = chunk(ids, action === "resend_access_email" ? BULK_EMAIL_BATCH_SIZE : BULK_BATCH_SIZE);
    const items: BulkItemResult[] = [];
    let emailLimitHit = false;
    let interrupted: RunSummary["interrupted"] = null;
    setProgress({ done: 0, total: ids.length });

    for (const batch of batches) {
      const result = await runBulkStudentAction({
        action,
        batchId,
        cohortId: action === "set_cohort" ? (cohortId ?? null) : undefined,
        endsAt: action === "grant" || action === "set_end" ? endsAt || null : null,
        productId: needsProduct ? productId : undefined,
        userIds: batch
      });

      if (!result.ok) {
        // O que ja foi aplicado nos lotes anteriores continua valendo: entra no resumo e no Desfazer.
        interrupted = { error: result.error, remaining: ids.length - items.length };
        break;
      }

      items.push(...result.data.items);
      emailLimitHit = emailLimitHit || result.data.emailLimitHit;
      setProgress({ done: items.length, total: ids.length });

      if (emailLimitHit) {
        break;
      }
    }

    const skipped: Record<string, number> = {};
    const failed: { label: string; error: string }[] = [];
    const snapshots: EntitlementSnapshot[] = [];
    let done = 0;

    for (const item of items) {
      if (item.status === "done") {
        done += 1;

        if (item.snapshot) {
          snapshots.push(item.snapshot);
        }
      } else if (item.status === "skipped") {
        skipped[item.reason] = (skipped[item.reason] ?? 0) + 1;
      } else {
        failed.push({ error: item.error, label: labelFor(item.userId) });
      }
    }

    setProgress(null);
    setSummary({ action, done, emailLimitHit, failed, interrupted, skipped, snapshots, total: ids.length });
    router.refresh();

    if (done > 0 && snapshots.length > 0) {
      let undoing = false;
      adminToast.success(`${BULK_ACTION_LABELS[action]}: ${done} ${done === 1 ? "aluno" : "alunos"}`, {
        onUndo: () => {
          if (undoing) {
            return;
          }

          undoing = true;
          void (async () => {
            for (const part of chunk(snapshots, BULK_BATCH_SIZE * 8)) {
              const undone = await undoBulkStudentAction({ batchId, snapshots: part });

              if (!undone.ok) {
                setUndoError(`Não foi possível desfazer “${BULK_ACTION_LABELS[action]}”: ${undone.error}`);
                router.refresh();
                return;
              }
            }

            adminToast.success("Ação desfeita");
            router.refresh();
          })();
        }
      });
    } else if (done > 0) {
      adminToast.success(`${BULK_ACTION_LABELS[action]}: ${done} ${done === 1 ? "aluno" : "alunos"}`);
    }

    if (!interrupted && failed.length === 0 && Object.keys(skipped).length === 0 && !emailLimitHit) {
      setDialog(null);
      clear();
    }
  }

  async function exportSelected() {
    if (tooMany) {
      setBarError(`Exportar pela seleção aceita no máximo ${BULK_MAX_TOTAL} alunos. Use os filtros e “Exportar CSV” do topo para a lista inteira.`);
      return;
    }

    setBarError(null);
    setExporting(true);
    const result = await exportStudentsCsv({ ids, params: {} });
    setExporting(false);

    if (!result.ok) {
      setBarError(result.error);
      return;
    }

    downloadTextFile(result.data.fileName, result.data.csv);
    adminToast.success(`${result.data.rows} ${result.data.rows === 1 ? "aluno exportado" : "alunos exportados"}`);
  }

  function downloadFailures() {
    if (!summary) {
      return;
    }

    downloadTextFile(`falhas-${summary.action}.csv`, toCsv(["Aluno", "Erro"], summary.failed.map((item) => [item.label, item.error])));
  }

  const summaryBlock = summary ? (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
      <p className="text-[var(--text-primary)]">
        {summary.done} de {summary.total} {summary.total === 1 ? "aluno" : "alunos"}: feito.
      </p>
      {Object.entries(summary.skipped).map(([reason, total]) => (
        <p key={reason}>
          {total} {total === 1 ? "pulado" : "pulados"}: {BULK_SKIP_REASON_LABELS[reason as keyof typeof BULK_SKIP_REASON_LABELS] ?? reason}.
        </p>
      ))}
      {summary.emailLimitHit ? <p className="text-[var(--warning)]">Limite de e-mail da plataforma atingido: os envios pararam. Tente de novo em 1 hora.</p> : null}
      {summary.interrupted ? (
        <p className="text-[var(--error)]">
          {summary.interrupted.remaining} {summary.interrupted.remaining === 1 ? "aluno não foi processado" : "alunos não foram processados"}: {summary.interrupted.error}
        </p>
      ) : null}
      {summary.failed.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--error)]">{summary.failed.length} com erro.</span>
          <Button className="h-8! gap-1.5 px-2.5" onClick={downloadFailures} type="button" variant="ghost">
            <Download aria-hidden="true" className="size-4" />
            Baixar lista
          </Button>
        </div>
      ) : null}
    </div>
  ) : null;

  const progressBlock = progress ? (
    <div aria-live="polite" className="flex flex-col gap-1.5">
      <p className="text-[13px] text-[var(--text-secondary)] tabular-nums">
        {progress.done} de {progress.total}…
      </p>
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full bg-[var(--text-primary)] transition-[width]" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
      </div>
    </div>
  ) : null;

  function dialogShell(input: { confirmLabel: string; description: string; destructive?: boolean; onConfirm: () => void; title: string; children?: ReactNode }) {
    return (
      <ProductDialog
        description={input.description}
        footer={
          <>
            <Button className="px-4" disabled={busy} onClick={close} type="button" variant="ghost">
              {summary ? "Fechar" : "Cancelar"}
            </Button>
            {summary ? null : (
              <Button className="px-4" disabled={busy} onClick={input.onConfirm} type="button" variant={input.destructive ? "destructive" : "default"}>
                {busy ? "Aplicando…" : input.confirmLabel}
              </Button>
            )}
          </>
        }
        onOpenChange={(next) => {
          if (!next) {
            close();
          }
        }}
        open
        title={input.title}
      >
        <div className="flex flex-col gap-4">
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          {summaryBlock ?? progressBlock ?? input.children}
        </div>
      </ProductDialog>
    );
  }

  const plural = count === 1 ? "1 aluno" : `${count} alunos`;

  return (
    <>
      <div
        className="sticky bottom-0 z-30 -mx-4 mt-2 border-t border-[var(--border-strong)] bg-[var(--surface-2)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--surface-2)]/80 md:-mx-6 md:px-6"
        role="region"
        aria-label="Ações para os alunos selecionados"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] tabular-nums">
            <Users aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
            {plural} {count === 1 ? "selecionado" : "selecionados"}
            {tooMany ? <span className="text-[var(--warning)]">(máximo {BULK_MAX_TOTAL})</span> : null}
          </p>
          <Button aria-label="Liberar acesso" className="gap-1.5 px-3" onClick={() => setDialog("grant")} type="button" variant="secondary">
            <Plus aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">Liberar acesso</span>
          </Button>
          <Button aria-label="Estender acesso" className="gap-1.5 px-3" onClick={() => setDialog("extend")} type="button" variant="secondary">
            <CalendarClock aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">Estender</span>
          </Button>
          <Button className="gap-1.5 px-3" onClick={() => setDialog("set_cohort")} type="button" variant="secondary">
            <Users aria-hidden="true" className="size-4 md:hidden" />
            <span className="max-md:sr-only">Mudar turma</span>
          </Button>
          <Button aria-label="Reenviar convite" className="gap-1.5 px-3" onClick={() => setDialog("resend_access_email")} type="button" variant="secondary">
            <Mail aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">Reenviar convite</span>
          </Button>
          <Button aria-label="Remover acesso" className="gap-1.5 px-3 text-[var(--error)]" onClick={() => setDialog("revoke")} type="button" variant="ghost">
            <Trash2 aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">Remover acesso</span>
          </Button>
          {canExport ? (
            <Button aria-label="Exportar CSV dos selecionados" className="gap-1.5 px-3" disabled={exporting} onClick={() => void exportSelected()} type="button" variant="ghost">
              <Download aria-hidden="true" className="size-4" />
              <span className="max-md:sr-only">{exporting ? "Gerando…" : "Exportar CSV"}</span>
            </Button>
          ) : null}
          <Button aria-label="Limpar seleção" className="ml-auto gap-1.5 px-3" onClick={clear} type="button" variant="ghost">
            <X aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">Limpar</span>
          </Button>
        </div>
        {barError ? <p className="mt-2 text-[13px] text-[var(--error)]">{barError}</p> : null}
        {undoError ? (
          <div className="mt-2">
            <ErrorBanner action={<Button className="px-3" onClick={() => setUndoError(null)} type="button" variant="ghost">Fechar</Button>}>{undoError}</ErrorBanner>
          </div>
        ) : null}
      </div>

      {dialog === "grant"
        ? dialogShell({
            children: (
              <>
                <ProductField disabled={busy} onChange={setProductId} products={products} value={productId} />
                <AdminField hint="Quem já tem acesso aberto não muda (nunca encurtamos um acesso). Em branco, sem prazo." id="massa-prazo" label="Acesso até" optional>
                  <Input aria-describedby={fieldDescribedBy("massa-prazo", { hint: true })} className={cn(adminInputClass, "max-w-[220px] [color-scheme:dark]")} disabled={busy} id="massa-prazo" min={today} onChange={(event) => setEndsAt(event.target.value)} type="date" value={endsAt} />
                </AdminField>
              </>
            ),
            confirmLabel: `Liberar para ${plural}`,
            description: `Libera ${productTitle} para ${plural}.`,
            onConfirm: () => void run("grant"),
            title: "Liberar acesso"
          })
        : null}

      {dialog === "extend"
        ? dialogShell({
            children: (
              <>
                <ProductField disabled={busy} onChange={setProductId} products={products} value={productId} />
                <PillGroup
                  ariaLabel="Como estender"
                  disabled={busy}
                  name="massa-estender"
                  onChange={setExtendMode}
                  options={[
                    { label: "30 dias", value: "extend_30" },
                    { label: "90 dias", value: "extend_90" },
                    { label: "Até uma data", value: "set_end" }
                  ]}
                  value={extendMode}
                />
                {extendMode === "set_end" ? (
                  <AdminField id="massa-data" label="Acesso até">
                    <Input className={cn(adminInputClass, "max-w-[220px] [color-scheme:dark]")} disabled={busy} id="massa-data" min={today} onChange={(event) => setEndsAt(event.target.value)} type="date" value={endsAt} />
                  </AdminField>
                ) : null}
              </>
            ),
            confirmLabel: "Estender",
            description: `Só quem tem acesso aberto a ${productTitle} é alterado; os demais são pulados.`,
            onConfirm: () => void run(extendMode),
            title: "Estender acesso"
          })
        : null}

      {dialog === "revoke"
        ? dialogShell({
            children: <ProductField disabled={busy} onChange={setProductId} products={products} value={productId} />,
            confirmLabel: `Remover de ${plural}`,
            description: `Remove o acesso de ${plural} a ${productTitle}. Dá para desfazer em 10 segundos.`,
            destructive: true,
            onConfirm: () => void run("revoke"),
            title: `Remover acesso de ${plural}?`
          })
        : null}

      {dialog === "set_cohort"
        ? dialogShell({
            children: (
              <>
                <ProductField disabled={busy} onChange={setProductId} products={products} value={productId} />
                <AdminField id="massa-turma" label="Turma">
                  <CohortSelect
                    cohorts={cohorts}
                    disabled={busy}
                    id="massa-turma"
                    noneLabel="Tirar da turma"
                    onChange={setCohortId}
                    onCreated={(cohort) => setCohorts((current) => withCohort(current, cohort))}
                    placeholder="Escolha a turma"
                    value={cohortId === undefined ? null : cohortId}
                  />
                </AdminField>
              </>
            ),
            confirmLabel: cohortId === null ? `Tirar ${plural} da turma` : `Mudar turma de ${plural}`,
            description: cohortId === null ? `Tira ${plural} da turma em ${productTitle}. Quem não tem acesso aberto a ele é pulado.` : `A turma vale para ${productTitle}. Quem não tem acesso aberto a ele é pulado.`,
            onConfirm: () => void run("set_cohort"),
            title: "Mudar turma"
          })
        : null}

      {dialog === "resend_access_email"
        ? dialogShell({
            children: (
              <p className="text-sm leading-5 text-[var(--text-secondary)]">
                Cada aluno recebe um e-mail com link para criar ou redefinir a senha. O envio depende do limite de e-mail da plataforma: se ele
                for atingido, os envios param e o resto fica para depois.
              </p>
            ),
            confirmLabel: `Enviar para ${plural}`,
            description: `Reenvia o e-mail de acesso para ${plural}.`,
            onConfirm: () => void run("resend_access_email"),
            title: "Reenviar convite"
          })
        : null}
    </>
  );
}
