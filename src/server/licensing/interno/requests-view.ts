// A fila dos pedidos ao Emissor como a equipe le em Configuracoes > Vendas (docs/32 §11.10): o que cada pedido e, a
// situacao em palavras, a tentativa, o erro em portugues e o que da para fazer (Tentar agora, Dispensar). Modulo puro.

import { formatMemberDateTime } from "../../../lib/member-format";
import { LICENSE_REQUEST_STATUS_LABELS, UNDO_REASON_LABELS, type LicenseRequestRow, type LicenseRequestStatus } from "./requests-model";

const PROVIDER_LABELS: Record<LicenseRequestRow["provider"], string> = { hotmart: "Hotmart", kiwify: "Kiwify", ticto: "Ticto" };

export type LicenseRequestTone = "success" | "warning" | "error" | "neutral" | "muted";

export type LicenseRequestListItem = {
  id: string;
  /** "Venda" ou "Reembolso", "Chargeback", "Cancelamento". */
  title: string;
  /** "Produto 4567890 na Hotmart · compra HP17123456789". */
  subtitle: string;
  createdAt: string;
  status: LicenseRequestStatus;
  statusLabel: string;
  tone: LicenseRequestTone;
  attempts: number;
  /** A frase do ultimo erro (so enquanto nao saiu). */
  error: string | null;
  /** Quando tenta de novo (so na fila, com uma tentativa ja feita). */
  nextAttempt: string | null;
  /** O que aconteceu (enviado ou dispensado). */
  resolution: string | null;
  canRetry: boolean;
  canDismiss: boolean;
};

const TONES: Record<LicenseRequestStatus, LicenseRequestTone> = {
  dispensado: "muted",
  enviado: "success",
  enviando: "neutral",
  parado: "error",
  pendente: "warning"
};

export function requestListItemOf(row: LicenseRequestRow, now: number): LicenseRequestListItem {
  const reason = row.reason ? UNDO_REASON_LABELS[row.reason] : null;
  const title = row.kind === "venda" ? "Venda" : `${reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : "Desfazer"}`;
  const open = row.status === "pendente" || row.status === "parado";
  const nextAttempt = row.status === "pendente" && row.attempts > 0 && Date.parse(row.next_attempt_at) > now ? formatMemberDateTime(row.next_attempt_at) : null;

  return {
    attempts: row.attempts,
    canDismiss: open,
    canRetry: row.status === "parado" || (row.status === "pendente" && row.attempts > 0),
    createdAt: formatMemberDateTime(row.created_at ?? null),
    error: open || row.status === "enviando" ? row.last_error : null,
    id: row.id,
    nextAttempt,
    resolution: row.status === "enviado" || row.status === "dispensado" ? row.resolution : null,
    status: row.status,
    statusLabel: LICENSE_REQUEST_STATUS_LABELS[row.status],
    subtitle: `Produto ${row.external_product_id} na ${PROVIDER_LABELS[row.provider]} · compra ${row.transaction_id}`,
    title,
    tone: TONES[row.status]
  };
}
