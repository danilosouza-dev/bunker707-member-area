// Regras puras da venda guardada (docs/32 §2.2 e §11.3, "Onde o congelamento barra" e "Venda guardada"): quando a
// situacao da licenca nao permite acesso novo (Escola congelada, copia nunca ativada, Aviso de endereco diferente ou de
// licenca ilegivel, ou a licenca que nao pode ser lida), a compra de um produto que a pessoa ainda nao tinha fica
// guardada, tenha ela conta ou nao; o que ela ja tinha renova, retoma e estende na hora. A tarefa do tick libera as
// guardadas, em ordem, quando a licenca volta a permitir a matricula; o reembolso, o chargeback e o cancelamento da
// assinatura descartam a guardada antes disso (nunca liberam).
//
// Puro, sem "server-only" e sem "@/": os testes carregam direto. Quem le e grava e held-sales-store.ts; quem decide na
// venda e process-sale.ts; quem libera e held-sales-release.ts. No modo "off" a matricula sempre passa e nada daqui
// guarda venda nenhuma.

import { licenseDegreeChangeOf } from "../licensing/degree-notice";
import { LICENSE_TIME_ZONE, type LicenseBannerModel } from "../licensing/copy";
import { isActionClassAllowed } from "../licensing/require-feature";
import type { LicenseState } from "../licensing/state";

/** Os motivos de uma venda guardada (o codigo vai para held_sales.reason). */
export const HELD_SALE_REASONS = ["escola_congelada", "nao_ativada", "endereco_diferente", "licenca_ilegivel", "leitura_falhou", "acesso_novo_barrado"] as const;
export type HeldSaleReason = (typeof HELD_SALE_REASONS)[number];

/** A venda pode dar acesso novo agora? Se nao, por que (a lista e o e-mail da equipe dizem o motivo). */
export type NewAccessDecision = { allowed: true } | { allowed: false; reason: HeldSaleReason };

export const NEW_ACCESS_ALLOWED: NewAccessDecision = Object.freeze({ allowed: true }) as NewAccessDecision;

/** O motivo pela situacao: a copia nunca ativada, a Escola congelada, o endereco diferente ou a licenca ilegivel. */
export function heldSaleReasonOf(state: LicenseState | null): HeldSaleReason {
  if (state === null) {
    return "leitura_falhou";
  }

  if (state.mode !== "enforce") {
    return "acesso_novo_barrado";
  }

  const { evaluation } = state;

  if (evaluation.restrictions.activationOnly || evaluation.enforcedDegree === "nao_ativada") {
    return "nao_ativada";
  }

  if (evaluation.enforcedDegree === "escola_congelada") {
    return "escola_congelada";
  }

  const codes = new Set(evaluation.reasons.map((item) => item.reason));

  if (codes.has("endereco_diferente")) {
    return "endereco_diferente";
  }

  if (codes.has("licenca_ilegivel")) {
    return "licenca_ilegivel";
  }

  return "acesso_novo_barrado";
}

/**
 * A pergunta da venda: a classe matricula passa no degrau de agora (require-feature.ts, a fonte unica)? No modo "off",
 * sempre; sem leitura da licenca, nunca (fecha, como toda classe que nao e dever legal).
 */
export function newAccessDecisionOf(state: LicenseState | null): NewAccessDecision {
  return isActionClassAllowed(state, "matricula") ? NEW_ACCESS_ALLOWED : { allowed: false, reason: heldSaleReasonOf(state) };
}

/**
 * Separa os produtos da compra: os que a pessoa ja tinha (algum acesso, aberto ou fechado: renova, retoma ou estende
 * na hora) e os novos (ficam guardados). Ter conta nao basta: conta sem o produto e acesso novo.
 */
export function splitHeldProducts(productIds: readonly string[], hadBefore: (productId: string) => boolean): { now: string[]; held: string[] } {
  const now: string[] = [];
  const held: string[] = [];

  for (const productId of productIds) {
    (hadBefore(productId) ? now : held).push(productId);
  }

  return { held, now };
}

/** O motivo em palavras, para a lista, o detalhe da venda e o e-mail da equipe (so a equipe le: pode falar da Licenca). */
export const HELD_SALE_REASON_LABELS: Readonly<Record<HeldSaleReason, string>> = Object.freeze({
  escola_congelada: "Escola congelada",
  nao_ativada: "escola ainda não ativada",
  endereco_diferente: "escola fora do endereço da Licença",
  licenca_ilegivel: "licença guardada ilegível",
  leitura_falhou: "a Licença não pôde ser lida",
  acesso_novo_barrado: "a Licença não permite acesso novo"
});

/** O motivo gravado em palavras; codigo desconhecido (de uma versao mais nova) vira a frase geral. */
export function heldSaleReasonLabel(reason: string): string {
  return Object.hasOwn(HELD_SALE_REASON_LABELS, reason) ? HELD_SALE_REASON_LABELS[reason as HeldSaleReason] : HELD_SALE_REASON_LABELS.acesso_novo_barrado;
}

/** O motivo com a primeira letra maiuscula, para a coluna da lista. */
export function heldSaleReasonTitle(reason: string): string {
  const label = heldSaleReasonLabel(reason);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;
}

/** A frase de "liberacao automatica", a mesma no detalhe da venda e na lista. */
export const HELD_SALE_AUTOMATIC_RELEASE =
  "É liberada sozinha quando a Licença voltar a permitir acesso novo; se a compra for reembolsada ou contestada antes, a venda é descartada.";

/**
 * O detalhe da venda na lista Vendas recebidas (webhook_events.outcome_detail, ate 500 caracteres). Venda guardada
 * inteira: o que ficou guardado e por que. Venda em parte (a pessoa ja tinha um dos produtos): o que foi liberado na
 * hora e o que ficou guardado.
 */
export function heldSaleDetail(input: { reason: string; heldCount: number; grantedDetail?: string | null; what?: string | null }): string {
  const reason = heldSaleReasonLabel(input.reason);

  if (input.grantedDetail) {
    return `${input.grantedDetail} ${plural(input.heldCount, "produto ficou guardado", "produtos ficaram guardados")} (${reason}). ${HELD_SALE_AUTOMATIC_RELEASE}`;
  }

  const what = input.what ?? plural(input.heldCount, "produto", "produtos");

  return `Venda guardada (${reason}): ${what} sem acesso por enquanto. ${HELD_SALE_AUTOMATIC_RELEASE}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: LICENSE_TIME_ZONE,
  year: "numeric"
});

/** "12/11/2026 14:30", no horario de Brasilia; "" sem data valida. */
export function formatHeldSaleDateTime(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date).replace(",", "") : "";
}

/** O detalhe da venda depois da liberacao pela tarefa do tick. */
export function heldSaleReleasedDetail(input: { detail: string; releasedAt: Date }): string {
  const when = formatHeldSaleDateTime(input.releasedAt);
  return `Venda guardada liberada${when ? ` em ${when}` : ""}: ${input.detail}`;
}

/** O que desfez a venda guardada antes da liberacao (o tipo do evento). */
export type HeldSaleUndoKind = "refund" | "chargeback" | "subscription_canceled";

const UNDO_LABELS: Readonly<Record<HeldSaleUndoKind, string>> = Object.freeze({
  chargeback: "chargeback registrado",
  refund: "reembolso registrado",
  subscription_canceled: "assinatura cancelada"
});

/**
 * O detalhe da compra guardada que foi descartada (a venda nunca deu acesso). No cancelamento da assinatura, a venda
 * guardada sai inteira, com os produtos vendidos junto (cobranca unica, que o cancelamento nao suspenderia): a frase
 * pede para a equipe libera-los a mao quando a Licenca permitir.
 */
export function heldSaleDiscardedDetail(kind: HeldSaleUndoKind): string {
  const base = `Venda guardada descartada: ${UNDO_LABELS[kind]} antes da liberação; o acesso nunca foi liberado.`;

  return kind === "subscription_canceled" ? `${base} Se a compra trouxe produtos vendidos junto, libere-os à mão em Alunos quando a Licença permitir.` : base;
}

/** A frase do evento de reembolso, chargeback ou cancelamento que descartou vendas guardadas. */
export function heldSaleDiscardNote(count: number): string {
  return count === 1
    ? "Venda guardada descartada: o acesso desta compra nunca foi liberado."
    : `${count} vendas guardadas descartadas: o acesso dessas compras nunca foi liberado.`;
}

/** O detalhe da liberacao que nao deu acesso (o resultado da regra de acesso, com o aviso de que a venda saiu da lista). */
export function heldSaleNotReleasedDetail(detail: string): string {
  return `Venda guardada não liberada: ${detail}`;
}

/* ------------------------------------------------------------------------------------------------
 * A liberacao pela tarefa do tick
 * ---------------------------------------------------------------------------------------------- */

/** Quantas vendas guardadas cada rodada do tick tenta liberar, no maximo. */
export const HELD_SALES_PER_ROUND = 25;
/** Quanto tempo de cada rodada a liberacao usa, no maximo (o tick inteiro tem 45 s para todas as tarefas). */
export const HELD_SALES_ROUND_BUDGET_MS = 20_000;
/**
 * Depois de quanto tempo a reivindicacao de uma rodada vale como abandonada (a rodada morreu no meio) e outra rodada
 * retoma a venda. Bem acima do que uma liberacao leva (segundos) e do orcamento do tick.
 */
export const HELD_SALE_CLAIM_STALE_MS = 3 * 60_000;
/**
 * Depois de quantas liberacoes com erro (uma por rodada, uma rodada por minuto) a venda sai da lista e vai para a lista
 * Vendas recebidas como erro, com Reprocessar: o caminho de sempre da venda que falhou.
 */
export const HELD_SALE_MAX_ATTEMPTS = 10;

/** A frase da venda guardada que a liberacao desistiu de liberar. */
export function heldSaleGaveUpDetail(input: { attempts: number; error: string }): string {
  return `A liberação desta venda guardada falhou ${input.attempts} vezes (${input.error}). Ela foi para a lista Vendas recebidas com o erro: corrija e use Reprocessar.`;
}

/* ------------------------------------------------------------------------------------------------
 * O e-mail da equipe: um por episodio
 * ---------------------------------------------------------------------------------------------- */

const dayFormatter = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: LICENSE_TIME_ZONE, year: "numeric" });

/**
 * O episodio da venda guardada: o degrau que barra o acesso novo e o dia (Brasilia) em que ele comecou, o mesmo
 * marcador dos e-mails de degrau (degree-notice.ts). A copia nunca ativada e um episodio so; a licenca que nao pode
 * ser lida, um por dia. O dono e os administradores recebem um e-mail quando a primeira venda e guardada no episodio.
 */
export function heldSalesEpisodeOf(state: LicenseState | null, now: Date): { marker: string; since: Date | null } {
  const change = licenseDegreeChangeOf(state);

  if (change) {
    return { marker: change.marker, since: new Date(change.since) };
  }

  if (state === null) {
    if (!Number.isFinite(now.getTime())) {
      return { marker: "leitura_falhou:sem-data", since: null };
    }

    const day = dayFormatter.format(now);
    // Brasilia sem horario de verao desde 2019: o dia comeca as 03:00 UTC.
    return { marker: `leitura_falhou:${day}`, since: new Date(`${day}T00:00:00-03:00`) };
  }

  return { marker: "nao_ativada", since: null };
}

/** A venda guardada (a mais nova) chegou neste episodio? Sem o comeco do episodio (a copia nunca ativada), sim. */
export function heldInEpisode(heldAt: string | null, episode: { since: Date | null }): boolean {
  if (!heldAt) {
    return false;
  }

  const heldMs = Date.parse(heldAt);
  const sinceMs = episode.since ? episode.since.getTime() : Number.NaN;

  return !Number.isFinite(sinceMs) || (Number.isFinite(heldMs) && heldMs >= sinceMs);
}

/* ------------------------------------------------------------------------------------------------
 * A faixa da Licenca no admin
 * ---------------------------------------------------------------------------------------------- */

/** A frase das vendas guardadas na faixa: esperando a Licenca, ou sendo liberadas (a Licenca ja permite). */
export function heldSalesBannerText(count: number, releasing: boolean): string {
  if (releasing) {
    return count === 1
      ? "1 venda guardada está sendo liberada agora, com as boas-vindas de sempre."
      : `${count} vendas guardadas estão sendo liberadas agora, na ordem em que chegaram, com as boas-vindas de sempre.`;
  }

  return count === 1
    ? "1 venda está guardada: quem comprou ainda não tem o acesso. Ela é liberada sozinha quando a Licença voltar a permitir acesso novo."
    : `${count} vendas estão guardadas: quem comprou ainda não tem o acesso. Elas são liberadas sozinhas, na ordem em que chegaram, quando a Licença voltar a permitir acesso novo.`;
}

/**
 * A faixa com as vendas guardadas (docs/32 §2.2): a contagem entra na faixa do degrau; sem faixa (a Licenca ja em dia) e
 * com venda guardada, uma faixa so delas, ate a tarefa do tick terminar de liberar. Sem venda guardada, a faixa como
 * veio. `releasing`: a Licenca ja permite acesso novo (a matricula passa).
 */
export function withHeldSalesBanner(banner: LicenseBannerModel | null, count: number, releasing: boolean): LicenseBannerModel | null {
  if (!Number.isFinite(count) || count <= 0) {
    return banner;
  }

  const heldSales = { count, text: heldSalesBannerText(count, releasing) };

  if (banner) {
    return { ...banner, heldSales };
  }

  return { degree: "ok", heldSales, lines: [], needsActivation: false, renewUrl: null, title: "Vendas guardadas", tone: "warning" };
}
