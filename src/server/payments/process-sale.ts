import "server-only";

// Regra de acesso de uma venda ja normalizada (docs/04, secao Webhooks externos; docs/17 §1.6.8).
// Separada do parser da plataforma de proposito: aqui so existe o evento normalizado, o codigo do produto
// ligado em sales_product_links, o vinculo venda -> acesso (sale_grants) e a rotina de acesso de Alunos
// (src/server/students/access.ts), a mesma do admin. Nada do payload libera conteudo por si.
//
// Resultados:
// - compra aprovada: conta criada ou encontrada pelo e-mail e produto(s) liberados sem prazo (pacote =
//   todos os produtos dele, de uma vez, num e-mail so; produtos vendidos junto no mesmo pedido, os order
//   bumps da Ticto, entram na mesma liberacao quando o codigo deles esta ligado, e o que nao esta ligado
//   fica escrito no detalhe sem bloquear o resto). Cada (venda, acesso) vira um vinculo em
//   sale_grants dizendo se a venda ABRIU o acesso ou so ESTENDEU um acesso aberto (e que prazo ele
//   tinha). Sem a tabela de vinculos no banco nenhuma venda libera acesso (erro, nao liberacao sem
//   registro). Acesso que ja existia ganha o vinculo ANTES da liberacao; acesso novo, logo depois; o
//   reprocesso de uma falha no meio reconhece o acesso que a propria venda abriu (source_event_id) e
//   grava o vinculo certo. Compra que ja tem reembolso ou chargeback registrado nao libera (reprocesso
//   ou reenvio fora de ordem). Confirmacao de compra anterior (Hotmart: fim da garantia) so libera para
//   quem nunca teve acesso ao produto: nunca reabre acesso suspenso ou revogado. Reativacao de assinatura
//   com a mesma transacao (Ticto: uncanceled) reabre o vinculo que o cancelamento fechou, para ele voltar
//   a sustentar o acesso;
// - reembolso, chargeback e assinatura cancelada decidem cada acesso olhando o HISTORICO INTEIRO dos
//   vinculos dele (decideEntitlementAfterSale em model.ts), nao so o vinculo que esta sendo desfeito:
//   assim a ordem dos reembolsos nao muda o resultado. Outra compra paga sustenta -> fica; o vinculo
//   mais antigo abriu o acesso -> revoga (ou suspende, no cancelamento); so estendeu um acesso de outra
//   origem com prazo -> o prazo volta; sem prazo -> fica; a equipe ja revogou, suspendeu ou reabriu o
//   acesso depois (vinculos fechados por `admin`) -> fica com a equipe. Primeiro age, e so depois fecha
//   os vinculos da venda: uma falha no meio deixa tudo para o reprocesso refazer. O cancelamento com o
//   codigo da assinatura desfaz a assinatura inteira, mesmo quando tambem traz a transacao (Ticto);
// - o que nao da para fazer (evento que nao muda acesso, produto sem codigo ligado, pacote em rascunho
//   na compra, aluno sem conta, assinatura sem cobranca registrada) e IGNORADO com o motivo escrito;
// - erro de verdade (payload sem e-mail, falha do banco, banco sem a tabela de vinculos) sobe para quem
//   chamou marcar `failed`.
//
// Venda guardada (produto licenciado, docs/32 §2.2 e §11.3; so no modo "enforce"): quando a situacao da licenca nao
// permite acesso novo (a classe matricula barrada: Escola congelada, copia nunca ativada, Aviso de endereco diferente ou
// de licenca ilegivel, ou a licenca que nao pode ser lida), a compra de um produto que a pessoa ainda nao tinha fica
// GUARDADA (held_sales), tenha ela conta ou nao: nenhuma conta nasce, nenhum acesso abre e nenhum e-mail sai para quem
// comprou. O que a pessoa ja tinha (qualquer acesso, aberto ou fechado) renova, retoma e estende na hora, como sempre;
// na compra com os dois, so os produtos novos ficam guardados. A tarefa do tick `vendas-guardadas`
// (held-sales-release.ts) libera as guardadas pela mesma regra quando a licenca volta a permitir (`release`). O
// reembolso, o chargeback e a assinatura cancelada passam sempre e descartam a venda guardada da mesma compra antes de
// decidir o resto: ela nunca e liberada. No modo "off" nada disso le ou grava nada: o comportamento de sempre.

import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { licensingMode } from "@/server/licensing/build-config";
import { readCurrentLicenseState } from "@/server/licensing/current-state";
import type { LicenseState } from "@/server/licensing/state";
import { findAccountByEmail, normalizeEmail } from "@/server/students/accounts";
import { applyAccessAction, provisionStudentAccess, restoreEntitlements } from "@/server/students/access";
import { accessStateOf, isAccessOpen, targetTypeForContentKind } from "@/server/students/model";
import {
  fetchContentKinds,
  fetchEntitlements,
  fetchEntitlementsByIds,
  fetchProfileByEmail,
  findEntitlementForTarget,
  type EntitlementRow,
  type StudentsDb
} from "@/server/students/store";
import {
  heldSaleDetail,
  heldSaleDiscardNote,
  heldSaleDiscardedDetail,
  newAccessDecisionOf,
  splitHeldProducts,
  type HeldSaleReason,
  type HeldSaleUndoKind
} from "./held-sales-model";
import { notifyHeldSalesEpisodeSafely } from "./held-sales-notice";
import {
  HELD_SALES_MIGRATION,
  discardHeldSalesOf,
  findPendingHeldSaleOfTransaction,
  isHeldSalesSchemaMissing,
  recordHeldSale,
  resolveHeldSaleOfEvent
} from "./held-sales-store";
import { SALES_PROVIDER_LABELS, decideEntitlementAfterSale, type EntitlementAfterSaleDecision, type SaleGrantLike, type SaleOutcome } from "./model";
import {
  assertSaleGrantsAvailable,
  closeSaleGrants,
  fetchSaleGrantsBySubscription,
  fetchSaleGrantsByTransaction,
  fetchSaleGrantsForEntitlements,
  fetchSalesLinkByExternalId,
  hasClosingEventForTransaction,
  insertSaleGrants,
  reopenSubscriptionCanceledGrants,
  updateWebhookEventsOutcome,
  type SaleGrantInsert,
  type SaleGrantRow,
  type SalesDb
} from "./store";
import type { NormalizedSaleEvent, SalesProvider } from "./types";

export class SaleProcessingError extends Error {
  /** Alvo ja resolvido quando a regra falhou, para a lista mostrar o produto mesmo no erro. */
  readonly target: { comboId: string | null; productId: string | null } | null;

  constructor(message: string, target: { comboId: string | null; productId: string | null } | null = null) {
    super(message);
    this.name = "SaleProcessingError";
    this.target = target;
  }
}

export type SaleProcessingResult = {
  comboId: string | null;
  detail: string;
  outcome: Exclude<SaleOutcome, "failed">;
  productId: string | null;
  productIds: string[];
  userId: string | null;
  /** A parte da compra que ficou guardada (venda guardada inteira, outcome "held", ou em parte, junto do acesso liberado). */
  held?: { id: string; productIds: string[]; reason: HeldSaleReason };
  /** O reembolso, chargeback ou cancelamento nao achou nada registrado desta compra (nem vinculo, nem acesso). */
  nothingToUndo?: boolean;
};

type ResolvedTarget =
  | { comboId: null; kind: "product"; productId: string; productIds: string[] }
  | { comboId: string; kind: "combo"; productId: null; productIds: string[]; status: string; name: string };

type TargetRef = { comboId: string | null; productId: string | null };

function ignored(detail: string, extra: Partial<SaleProcessingResult> = {}): SaleProcessingResult {
  return { comboId: null, detail, outcome: "ignored", productId: null, productIds: [], userId: null, ...extra };
}

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;
}

function isOpenRow(row: EntitlementRow, now: number) {
  return isAccessOpen(accessStateOf({ endsAt: row.ends_at, now, startsAt: row.starts_at, status: row.status }));
}

async function resolveTarget(db: SalesDb, provider: SalesProvider, externalProductId: string | null): Promise<ResolvedTarget | null> {
  if (!externalProductId) {
    return null;
  }

  const link = await fetchSalesLinkByExternalId(db, provider, externalProductId);

  if (!link) {
    return null;
  }

  if (link.product_id) {
    return { comboId: null, kind: "product", productId: link.product_id, productIds: [link.product_id] };
  }

  const comboId = link.combo_id as string;
  const [{ data: combo, error: comboError }, { data: items, error: itemsError }] = await Promise.all([
    db.from("product_combos").select("id,name,status").eq("id", comboId).maybeSingle(),
    db.from("product_combo_items").select("product_id,sort_order").eq("combo_id", comboId).order("sort_order", { ascending: true })
  ]);

  if (comboError) {
    throw new Error(`Pacote da venda: ${comboError.message}`);
  }

  if (itemsError) {
    throw new Error(`Produtos do pacote da venda: ${itemsError.message}`);
  }

  const row = combo as { id: string; name: string; status: string | null } | null;

  if (!row) {
    return null;
  }

  return {
    comboId: row.id,
    kind: "combo",
    name: row.name,
    productId: null,
    productIds: Array.from(new Set(((items ?? []) as { product_id: string }[]).map((item) => item.product_id))),
    status: row.status ?? "draft"
  };
}

function unlinkedMessage(event: NormalizedSaleEvent) {
  const name = event.externalProductName ? ` (${event.externalProductName})` : "";

  return `O produto ${event.externalProductId}${name} da ${SALES_PROVIDER_LABELS[event.provider]} não está ligado a nenhum produto ou pacote da escola. Informe o código em Produtos › Acesso e venda ou em Pacotes e use Reprocessar.`;
}

export type ProcessSaleInput = {
  event: NormalizedSaleEvent;
  /** Origem publica do site (`https://host`) para os links dos e-mails. */
  siteOrigin: string | null;
  /** Linha de webhook_events que esta sendo processada (vai para o vinculo da venda e para a venda guardada). */
  webhookEventId?: string | null;
  /**
   * A situacao da licenca que decide se a compra pode dar acesso novo (venda guardada). Sem o campo, a deste pedido
   * (readCurrentLicenseState), lida so quando a compra traz produto que a pessoa ainda nao tinha.
   */
  license?: LicenseState | null;
  /**
   * A liberacao de uma venda guardada pela tarefa do tick (held-sales-release.ts): so estes produtos, sem perguntar de
   * novo a licenca (a tarefa ja perguntou), cada acesso com o sufixo do produto e o e-mail de compra com chave propria.
   */
  release?: { productIds: readonly string[] };
};

export async function processSaleEvent(db: SalesDb, input: ProcessSaleInput): Promise<SaleProcessingResult> {
  const { event } = input;

  if (event.type === "other") {
    return ignored(`Evento ${event.rawType} não muda o acesso de ninguém.`);
  }

  if (event.type !== "purchase_approved") {
    // Reembolso, chargeback e cancelamento passam sempre. A venda guardada da mesma compra (ou da mesma assinatura) sai
    // da lista antes, descartada: ela nunca deu acesso e nunca vai dar.
    const discarded = await discardHeldSalesUndoneBy(db, event);
    const result = await undoSale(db, input);

    return discarded > 0 ? withHeldSalesDiscarded(result, discarded) : result;
  }

  if (!event.externalProductId) {
    return ignored("O evento não informa qual produto foi vendido.");
  }

  return grantPurchase(db, { ...input, lines: saleLines(event) });
}

async function undoSale(db: SalesDb, input: ProcessSaleInput): Promise<SaleProcessingResult> {
  const { event } = input;

  if (!event.externalProductId) {
    return ignored("O evento não informa qual produto foi vendido.");
  }

  // Reembolso, chargeback e cancelamento decidem pelos vinculos da venda (sale_grants): os produtos
  // vendidos junto na mesma compra tem vinculo da mesma transacao e entram sozinhos.
  return removeAccess(db, { ...input, target: await resolveTarget(db, event.provider, event.externalProductId) });
}

/* ------------------------------------------------------------------------------------------------
 * Venda guardada (docs/32 §2.2 e §11.3; so no modo "enforce")
 * ---------------------------------------------------------------------------------------------- */

/**
 * O reembolso, o chargeback ou o cancelamento descartam as vendas guardadas da mesma compra (ou da mesma assinatura, no
 * cancelamento e no aviso sem a compra) e marcam o evento de compra delas como ignorado, com o motivo; o evento de
 * compra nao volta a ser reprocessavel (processed), para um clique nao liberar o que foi desfeito. Devolve quantas
 * foram descartadas. No modo "off" nao le nada.
 */
async function discardHeldSalesUndoneBy(db: SalesDb, event: NormalizedSaleEvent): Promise<number> {
  if (licensingMode() !== "enforce" || event.type === "purchase_approved" || event.type === "other") {
    return 0;
  }

  const kind: HeldSaleUndoKind = event.type;
  const bySubscription = event.subscriptionCode && (event.type === "subscription_canceled" || !event.transactionId) ? event.subscriptionCode : null;
  const resolution = heldSaleDiscardedDetail(kind);
  const discarded = await discardHeldSalesOf(db, {
    provider: event.provider,
    resolution,
    subscriptionCode: bySubscription,
    transactionId: event.transactionId
  });

  if (discarded.length > 0) {
    await updateWebhookEventsOutcome(db, {
      ids: discarded.map((row) => row.webhook_event_id),
      onlyOutcome: "held",
      outcome: "ignored",
      outcomeDetail: resolution
    });
  }

  return discarded.length;
}

/** O resultado do reembolso que tambem descartou vendas guardadas: a frase do descarte vem antes do resto. */
function withHeldSalesDiscarded(result: SaleProcessingResult, count: number): SaleProcessingResult {
  const note = heldSaleDiscardNote(count);

  return { ...result, detail: result.nothingToUndo ? note : `${note} ${result.detail}` };
}

/**
 * Guarda a parte nova da compra. A mesma compra ja guardada por outro aviso (a confirmacao do fim da garantia, um reenvio
 * com outro id), com os mesmos produtos, nao guarda de novo: `sameSale`. Banco sem a migracao 202611110002: a venda nao
 * pode ficar guardada nem liberar acesso novo; falha com a frase para o dono (a plataforma reenvia, e o Reprocessar
 * depois da migracao guarda).
 */
async function holdSale(
  db: SalesDb,
  input: { base: TargetRef; event: NormalizedSaleEvent; productIds: string[]; reason: HeldSaleReason; subscriptionCode: string | null; webhookEventId: string | null }
): Promise<{ created: boolean; id: string; sameSale: boolean }> {
  if (!input.webhookEventId) {
    throw new SaleProcessingError("A compra precisa ficar guardada (a Licença não permite acesso novo agora), mas chegou sem o evento gravado.", input.base);
  }

  const transactionId = saleSourceEventId(input.event);

  try {
    const sameSale = await findPendingHeldSaleOfTransaction(db, { provider: input.event.provider, transactionId, webhookEventId: input.webhookEventId });

    if (sameSale && input.productIds.every((productId) => sameSale.product_ids.includes(productId))) {
      return { created: false, id: sameSale.id, sameSale: true };
    }

    const recorded = await recordHeldSale(db, {
      productIds: input.productIds,
      provider: input.event.provider,
      reason: input.reason,
      subscriptionCode: input.subscriptionCode,
      transactionId,
      webhookEventId: input.webhookEventId
    });

    return { ...recorded, sameSale: false };
  } catch (error) {
    if (isHeldSalesSchemaMissing(error)) {
      throw new SaleProcessingError(
        `A compra precisa ficar guardada (a Licença não permite acesso novo agora), mas o banco ainda não tem a migração ${HELD_SALES_MIGRATION}. Nada foi liberado: rode a migração e use Reprocessar.`,
        input.base
      );
    }

    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Codigos do pedido: o produto principal e os vendidos junto (order bumps)
 * ---------------------------------------------------------------------------------------------- */

/** Um codigo vendido no evento: o produto principal ou um produto vendido junto (order bump). */
type SaleLine = { externalProductId: string; externalProductName: string | null; extra: boolean };

type LineResolution =
  | { contents: { id: string; kind: string }[]; extra: boolean; ok: true; productIds: string[]; target: ResolvedTarget }
  /** `reason`: o motivo quando nada foi liberado; `note`: a frase quando outro produto do pedido foi. */
  | { base: TargetRef | null; note: string; ok: false; reason: string };

function saleLines(event: NormalizedSaleEvent): SaleLine[] {
  const lines: SaleLine[] = event.externalProductId
    ? [{ externalProductId: event.externalProductId, externalProductName: event.externalProductName, extra: false }]
    : [];

  for (const extra of event.extraProducts ?? []) {
    if (!lines.some((line) => line.externalProductId === extra.externalProductId)) {
      lines.push({ ...extra, extra: true });
    }
  }

  return lines;
}

function skippedLine(base: TargetRef | null, reason: string, note = reason): LineResolution {
  return { base, note, ok: false, reason };
}

/**
 * Resolve um codigo vendido em sales_product_links e confere que o alvo libera algum produto do
 * catalogo (so na compra: pacote pausado ou em rascunho nao libera).
 */
async function resolveLine(db: SalesDb, event: NormalizedSaleEvent, line: SaleLine): Promise<LineResolution> {
  const providerLabel = SALES_PROVIDER_LABELS[event.provider];
  const code = `${line.externalProductId}${line.externalProductName ? ` (${line.externalProductName})` : ""}`;
  const target = await resolveTarget(db, event.provider, line.externalProductId);

  if (!target) {
    return line.extra
      ? skippedLine(null, `O produto vendido junto ${code} da ${providerLabel} não está ligado a nenhum produto ou pacote da escola e não foi liberado.`)
      : skippedLine(
          null,
          unlinkedMessage(event),
          `O produto principal ${code} da ${providerLabel} não está ligado a nenhum produto ou pacote da escola e não foi liberado. Esta venda já foi processada pelo produto vendido junto: depois de ligar o código, libere o principal à mão em Alunos.`
        );
  }

  const base: TargetRef = { comboId: target.comboId, productId: target.productId };

  if (target.kind === "combo" && target.status !== "active") {
    const situation = target.status === "paused" ? "pausado" : "em rascunho";

    return line.extra
      ? skippedLine(base, `O pacote ${target.name}, vendido junto, está ${situation} e não foi liberado.`)
      : skippedLine(base, `O pacote ${target.name} está ${situation}: vendas dele não liberam acesso até ser ativado.`);
  }

  if (target.productIds.length === 0) {
    return line.extra
      ? skippedLine(base, `O pacote ${target.kind === "combo" ? target.name : ""}, vendido junto, não tem produtos.`)
      : skippedLine(base, `O pacote ${target.kind === "combo" ? target.name : ""} não tem produtos.`);
  }

  const contents = await fetchContentKinds(db as StudentsDb, target.productIds);
  const productIds = target.productIds.filter((id) => contents.some((content) => content.id === id));

  if (productIds.length === 0) {
    return line.extra
      ? skippedLine(base, `O produto vendido junto ${code} está ligado a um produto que não existe mais no catálogo.`)
      : skippedLine(base, "O produto ligado a esse código não existe mais no catálogo.");
  }

  return { contents, extra: line.extra, ok: true, productIds, target };
}

/**
 * Pedido com produtos vendidos junto (order bumps): o detalhe diz quantos entraram e o que ficou de
 * fora. Pedido de um produto so fica igual (Hotmart e Ticto sem bump).
 */
function withSaleNotes(result: SaleProcessingResult, input: { notes: string[]; released: number }): SaleProcessingResult {
  if (input.notes.length === 0 && input.released <= 1) {
    return result;
  }

  const included = input.released > 1 ? ` Inclui ${plural(input.released - 1, "produto vendido junto", "produtos vendidos junto")}.` : "";
  const notes = input.notes.length > 0 ? ` ${input.notes.join(" ")}` : "";

  return { ...result, detail: `${result.detail}${included}${notes}` };
}

/* ------------------------------------------------------------------------------------------------
 * Compra aprovada
 * ---------------------------------------------------------------------------------------------- */

/**
 * O vinculo de UMA venda com UM acesso, a partir do acesso como estava antes dela (ou de nada, quando o
 * acesso nasce agora). Acesso fechado que a propria venda abriu numa tentativa anterior (reprocesso
 * depois de uma falha no meio) continua "aberto por ela", e nao "estendido".
 */
function saleGrantFor(
  event: NormalizedSaleEvent,
  input: { entitlementId: string; previous: EntitlementRow | null; now: number; productId: string; userId: string; webhookEventId: string | null }
): SaleGrantInsert {
  const wasOpen = input.previous ? isOpenRow(input.previous, input.now) : false;
  const ownedBySale = input.previous ? entitlementBelongsToSale(input.previous, event) : false;

  return {
    entitlementId: input.entitlementId,
    opened: !wasOpen || ownedBySale,
    previousEndsAt: wasOpen && !ownedBySale ? (input.previous?.ends_at ?? null) : null,
    productId: input.productId,
    provider: event.provider,
    subscriptionCode: event.subscriptionCode,
    transactionId: saleSourceEventId(event),
    userId: input.userId,
    webhookEventId: input.webhookEventId
  };
}

async function grantPurchase(db: SalesDb, input: ProcessSaleInput & { lines: SaleLine[] }): Promise<SaleProcessingResult> {
  const { event } = input;
  const studentsDb = db as StudentsDb;

  // Cada codigo do pedido (o principal e os vendidos junto) libera o proprio alvo; o que nao da para
  // liberar fica escrito no detalhe e nao bloqueia o resto. So a compra e barrada pela situacao do
  // pacote: reembolso e chargeback passam sempre (removeAccess).
  const resolutions: LineResolution[] = [];

  for (const line of input.lines) {
    resolutions.push(await resolveLine(db, event, line));
  }

  const released = resolutions.filter((item): item is Extract<LineResolution, { ok: true }> => item.ok);
  const skipped = resolutions.filter((item): item is Extract<LineResolution, { ok: false }> => !item.ok);

  if (released.length === 0) {
    return ignored(skipped.map((item) => item.reason).join(" "), skipped[0]?.base ?? {});
  }

  const target = released[0].target;
  const base: TargetRef = { comboId: target.comboId, productId: target.productId };
  const contents = Array.from(new Map(released.flatMap((item) => item.contents).map((content) => [content.id, content])).values());
  let productIds = Array.from(new Set(released.flatMap((item) => item.productIds)));
  const saleNotes = { notes: skipped.map((item) => item.note), released: released.length };
  // So os produtos do item principal herdam o codigo da assinatura; o vendido junto (order bump) e
  // cobranca unica: o cancelamento da assinatura nao o suspende (reembolso e chargeback da compra, sim).
  const subscriptionProductIds = new Set(released.filter((item) => !item.extra).flatMap((item) => item.productIds));
  const withLineSubscription = (grant: SaleGrantInsert): SaleGrantInsert =>
    subscriptionProductIds.has(grant.productId) ? grant : { ...grant, subscriptionCode: null };

  if (!event.buyer.email) {
    throw new SaleProcessingError(`O evento ${event.rawType} veio sem um e-mail válido do comprador.`, base);
  }

  const email = normalizeEmail(event.buyer.email);
  const providerLabel = SALES_PROVIDER_LABELS[event.provider];

  // Reprocesso ou reenvio fora de ordem: a compra ja foi desfeita na plataforma.
  if (event.transactionId && (await hasClosingEventForTransaction(db, event.provider, event.transactionId))) {
    return ignored(`A compra ${event.transactionId} já tem reembolso ou chargeback registrado na ${providerLabel}; acesso não liberado.`, base);
  }

  // Nenhuma venda libera acesso sem poder registrar o vinculo (banco sem a migracao 202610170008).
  await assertSaleGrantsAvailable(db);

  const account = await findAccountByEmail(studentsDb, email);
  const now = Date.now();
  // Retrato dos acessos ANTES da venda: diz se ela abriu ou so estendeu cada um (e que prazo havia).
  const before = account ? await fetchEntitlements(studentsDb, { userId: account.id }) : [];
  const beforeByTarget = new Map(before.map((row) => [row.target_id, row] as const));

  // Confirmacao de compra anterior (fim da garantia): libera so o que o aluno nunca teve; nunca reabre
  // acesso revogado pela equipe ou suspenso por assinatura cancelada.
  if (!event.reopenClosedAccess && account) {
    const withoutAccess: string[] = [];

    for (const productId of productIds) {
      const content = contents.find((item) => item.id === productId) as { id: string; kind: string };
      const existing = await findEntitlementForTarget(studentsDb, account.id, targetTypeForContentKind(content.kind), productId);

      if (!existing) {
        withoutAccess.push(productId);
      }
    }

    if (withoutAccess.length === 0) {
      return ignored("Fim da garantia: a compra já estava registrada e um acesso fechado não é reaberto por isso.", { ...base, userId: account.id });
    }

    productIds = withoutAccess;
  }

  // Reativacao de assinatura (Ticto: uncanceled) nao e compra nova: so reabre o que o cancelamento DESTA
  // transacao fechou. Acesso que a equipe revogou, suspendeu ou reabriu depois (vinculo fechado por
  // admin), ou sem cancelamento registrado aqui, fica como esta, com o motivo escrito.
  if (event.reactivatesSubscription) {
    // Assinatura com reembolso ou chargeback em qualquer cobranca (vinculo fechado por eles, ou o evento
    // registrado): a compra foi desfeita na plataforma e a reativacao nao a refaz.
    if (event.subscriptionCode) {
      const subscriptionGrants = await fetchSaleGrantsBySubscription(db, event.provider, event.subscriptionCode);
      const transactions = Array.from(new Set(subscriptionGrants.map((grant) => grant.transaction_id)));
      const undone =
        subscriptionGrants.some((grant) => grant.closed_by === "refund" || grant.closed_by === "chargeback") ||
        (await Promise.all(transactions.map((transactionId) => hasClosingEventForTransaction(db, event.provider, transactionId)))).some(Boolean);

      if (undone) {
        return ignored(
          `A assinatura ${event.subscriptionCode} já tem reembolso ou chargeback registrado na ${providerLabel}; a reativação não reabre o acesso. Revise em Alunos se for o caso.`,
          { ...base, userId: account?.id ?? null }
        );
      }
    }

    const grantsOfSale = await fetchSaleGrantsByTransaction(db, event.provider, saleSourceEventId(event));
    const reopenable: string[] = [];
    const reasons = new Set<string>();

    for (const productId of productIds) {
      const previous = beforeByTarget.get(productId);
      const grant = previous ? grantsOfSale.find((candidate) => candidate.entitlement_id === previous.id) : undefined;

      // Vinculo ja reaberto por uma tentativa anterior desta reativacao que falhou antes de liberar (o
      // acesso continua fechado): o reprocesso termina o que ela comecou.
      const reopenedBefore = grant !== undefined && grant.closed_at === null && previous !== undefined && !isOpenRow(previous, now);

      if (grant?.closed_by === "subscription_canceled" || reopenedBefore) {
        reopenable.push(productId);
        continue;
      }

      reasons.add(grant?.closed_by === "admin" ? "a equipe já decidiu sobre esse acesso depois do cancelamento" : "não há cancelamento desta assinatura registrado aqui para esse produto");
    }

    if (reopenable.length === 0) {
      return ignored(`A reativação da assinatura não reabre o acesso: ${[...reasons].join("; ")}. Revise em Alunos se for o caso.`, { ...base, userId: account?.id ?? null });
    }

    if (reopenable.length < productIds.length) {
      saleNotes.notes.push(`${plural(productIds.length - reopenable.length, "produto ficou", "produtos ficaram")} como estava: ${[...reasons].join("; ")}.`);
    }

    productIds = reopenable;
  }

  const webhookEventId = input.webhookEventId ?? null;
  let heldPart: SaleProcessingResult["held"] | undefined;

  if (input.release) {
    // Liberacao de uma venda guardada: so os produtos que ficaram guardados (os que a pessoa ja tinha renovaram na hora
    // da venda). A licenca ja foi perguntada pela tarefa do tick.
    const held = new Set(input.release.productIds);
    const releasing = productIds.filter((productId) => held.has(productId));

    if (releasing.length === 0) {
      return ignored("Os produtos guardados desta venda não fazem mais parte dela (o código ou o pacote mudou); nada foi liberado. Revise em Alunos se for o caso.", {
        ...base,
        userId: account?.id ?? null
      });
    }

    productIds = releasing;
  } else {
    // Venda guardada: acesso novo so com a matricula liberada pela licenca. O que a pessoa ja tinha passa na hora.
    const split = splitHeldProducts(productIds, (productId) => beforeByTarget.has(productId));

    if (split.held.length > 0) {
      const license = input.license !== undefined ? input.license : await readCurrentLicenseState();
      const decision = newAccessDecisionOf(license);

      if (!decision.allowed) {
        const heldSubscription = event.subscriptionCode && split.held.some((productId) => subscriptionProductIds.has(productId)) ? event.subscriptionCode : null;
        const recorded = await holdSale(db, { base, event, productIds: split.held, reason: decision.reason, subscriptionCode: heldSubscription, webhookEventId });

        if (recorded.created) {
          await notifyHeldSalesEpisodeSafely(db, { configuredHost: getConfiguredSiteOrigin(), now: new Date(), reason: decision.reason, state: license });
        }

        heldPart = { id: recorded.id, productIds: split.held, reason: decision.reason };

        if (split.now.length === 0 && recorded.sameSale) {
          return withSaleNotes(
            ignored("Esta compra já está guardada por outro aviso da mesma venda: ela é liberada uma vez só, quando a Licença permitir acesso novo.", {
              ...base,
              userId: account?.id ?? null
            }),
            saleNotes
          );
        }

        if (split.now.length === 0) {
          const what = target.kind === "combo" ? `pacote ${target.name} (${plural(split.held.length, "produto", "produtos")})` : plural(split.held.length, "produto", "produtos");

          return withSaleNotes(
            {
              comboId: target.comboId,
              detail: heldSaleDetail({ heldCount: split.held.length, reason: decision.reason, what }),
              held: heldPart,
              outcome: "held",
              productId: target.productId,
              productIds: [],
              userId: account?.id ?? null
            },
            saleNotes
          );
        }

        productIds = split.now;
      }
    }
  }

  // Acesso que ja existe (aberto ou fechado) ganha o vinculo ANTES da liberacao: se a liberacao falhar no
  // meio, o reprocesso encontra o vinculo com o prazo que havia (a mesma venda nao duplica o vinculo).
  if (account) {
    const existingGrants = productIds.flatMap((productId) => {
      const previous = beforeByTarget.get(productId);

      return previous ? [withLineSubscription(saleGrantFor(event, { entitlementId: previous.id, now, previous, productId, userId: account.id, webhookEventId }))] : [];
    });
    await insertSaleGrants(db, existingGrants);
    // Reativacao da assinatura com a mesma transacao (Ticto: uncanceled): o vinculo que o cancelamento
    // fechou volta a valer, para sustentar o acesso de novo (ex.: um reembolso de OUTRA compra depois
    // nao tira o acesso que a assinatura reativada paga). Fechado pela equipe (admin), por reembolso ou
    // por chargeback nao reabre.
    await reopenSubscriptionCanceledGrants(db, existingGrants);
  }

  // Conta que ja existe: nome e telefone so preenchem o que estiver vazio (a venda nao apaga o cadastro).
  const profile = await fetchProfileByEmail(studentsDb, email);
  const fullName = profile?.full_name?.trim() || event.buyer.name?.trim() || email.split("@")[0];
  const phone = profile?.phone?.trim() || event.buyer.phone || null;
  const siteOrigin = input.siteOrigin ?? "http://localhost:3000";

  const result = await provisionStudentAccess(
    {
      actorId: null,
      delivery: "none",
      email,
      endsAt: null,
      fullName,
      phone,
      productIds,
      redirectTo: `${siteOrigin}/auth/callback?next=%2Falterar-senha&provider=email`,
      siteOrigin,
      source: "webhook",
      sourceEventId: saleSourceEventId(event),
      sourceProvider: event.provider,
      // A liberacao de uma venda guardada: o acesso leva sempre o sufixo do produto (a parte renovada na hora da venda
      // pode ter ficado com a compra sem sufixo, e o par aluno + origem e unico) e o e-mail de compra tem chave propria
      // (o da parte renovada ja saiu com a chave da compra).
      ...(input.release ? { purchaseEmailKeyTag: "venda-guardada", sourceEventPerProduct: true } : {})
    },
    studentsDb
  );

  // Acessos que nasceram agora: o vinculo vem logo depois (a venda abriu cada um deles).
  const after = await fetchEntitlements(studentsDb, { userId: result.id });
  const newGrants = result.grantedProductIds.flatMap((productId) => {
    const row = after.find((candidate) => candidate.target_id === productId);

    return row && !beforeByTarget.has(productId)
      ? [withLineSubscription(saleGrantFor(event, { entitlementId: row.id, now, previous: null, productId, userId: result.id, webhookEventId }))]
      : [];
  });
  await insertSaleGrants(db, newGrants);

  // O mesmo evento ja tinha ficado guardado e agora passou pela regra de sempre (o reenvio ou o Reprocessar com a
  // licenca em dia): a venda guardada dele sai da lista como liberada. A liberacao pela tarefa do tick grava a dela.
  if (!input.release && !heldPart && webhookEventId && licensingMode() === "enforce") {
    await resolveHeldSaleOfEvent(db, { resolution: "Liberada pela regra de acesso de sempre, com a Licença já permitindo acesso novo.", webhookEventId });
  }

  const granted = result.grantedProductIds.length;
  const what = target.kind === "combo" ? `pacote ${target.name} (${plural(granted, "produto", "produtos")})` : plural(granted, "produto liberado", "produtos liberados");
  const accountNote = result.existingAccount ? "conta que já existia" : "conta nova";
  const grantedDetail = `${what}; ${accountNote}.`;

  return withSaleNotes(
    {
      comboId: target.comboId,
      detail: heldPart ? heldSaleDetail({ grantedDetail, heldCount: heldPart.productIds.length, reason: heldPart.reason }) : grantedDetail,
      ...(heldPart ? { held: heldPart } : {}),
      outcome: "access_granted",
      productId: target.productId,
      productIds: result.grantedProductIds,
      userId: result.id
    },
    saleNotes
  );
}

/* ------------------------------------------------------------------------------------------------
 * Reembolso, chargeback e assinatura cancelada
 * ---------------------------------------------------------------------------------------------- */

/** O acesso nasceu desta compra? (mesma plataforma; a transacao, ou a transacao com o sufixo do produto). */
export function entitlementBelongsToSale(row: Pick<EntitlementRow, "source_event_id" | "source_provider">, event: NormalizedSaleEvent) {
  if (row.source_provider !== event.provider) {
    return false;
  }

  const sourceId = saleSourceEventId(event);

  return row.source_event_id === sourceId || Boolean(row.source_event_id?.startsWith(`${sourceId}:`));
}

const CLOSED_BY_BY_TYPE = { chargeback: "chargeback", refund: "refund", subscription_canceled: "subscription_canceled" } as const;

const KEEP_REASONS: Record<Exclude<EntitlementAfterSaleDecision["kind"], "close" | "restore_deadline">, string> = {
  keep_other_origin: "o acesso veio de outra origem (equipe ou outra compra)",
  keep_sustained: "outra compra paga sustenta o acesso",
  keep_team: "a equipe já decidiu sobre esse acesso depois da venda"
};

/**
 * Vinculo "virtual" de um acesso que nasceu desta venda mas nao tem vinculo gravado (venda anterior ao
 * registro, ou cancelamento sem o codigo da assinatura): entra na decisao como se a venda o tivesse aberto.
 */
function legacyGrantFor(row: EntitlementRow, event: NormalizedSaleEvent): SaleGrantLike {
  return {
    closed_at: null,
    closed_by: null,
    created_at: row.created_at,
    opened: true,
    previous_ends_at: null,
    subscription_code: event.subscriptionCode,
    transaction_id: saleSourceEventId(event)
  };
}

async function removeAccess(db: SalesDb, input: ProcessSaleInput & { target: ResolvedTarget | null }): Promise<SaleProcessingResult> {
  const { event, target } = input;
  const studentsDb = db as StudentsDb;
  const base: TargetRef = { comboId: target?.comboId ?? null, productId: target?.productId ?? null };
  const action = event.type === "subscription_canceled" ? "suspend" : "revoke";
  const closedStatus = action === "revoke" ? "revoked" : "suspended";
  const closedBy = CLOSED_BY_BY_TYPE[event.type as keyof typeof CLOSED_BY_BY_TYPE];
  const context = { actorId: null, source: "webhook" as const, sourceEventId: saleSourceEventId(event), sourceProvider: event.provider };

  if (!event.buyer.email) {
    throw new SaleProcessingError(`O evento ${event.rawType} veio sem um e-mail válido do comprador.`, base);
  }

  const email = normalizeEmail(event.buyer.email);
  const account = await findAccountByEmail(studentsDb, email);

  // Vinculos desta venda: pela transacao (reembolso, chargeback) ou pela assinatura (cancelamento), em
  // qualquer situacao: um vinculo ja fechado numa tentativa que falhou no meio ainda manda no acesso. O
  // cancelamento da Ticto traz a transacao da ultima cobranca e o codigo da assinatura: vale a assinatura
  // inteira (todas as cobrancas); sem cobranca registrada com o codigo, a transacao.
  const bySubscription =
    event.subscriptionCode && (event.type === "subscription_canceled" || !event.transactionId)
      ? await fetchSaleGrantsBySubscription(db, event.provider, event.subscriptionCode)
      : [];
  const saleGrants: SaleGrantRow[] =
    bySubscription.length > 0 ? bySubscription : event.transactionId ? await fetchSaleGrantsByTransaction(db, event.provider, event.transactionId) : [];

  // Cancelamento com o codigo da assinatura e sem a transacao, mas nenhuma cobranca dela registrada: nao
  // adivinha pelo produto (poderia suspender um acesso pago a parte); quem sabe de qual venda se trata e a
  // plataforma. Com a transacao (Ticto), o acesso que nasceu dela ainda e achado (legacyRows).
  if (saleGrants.length === 0 && event.type === "subscription_canceled" && event.subscriptionCode && !event.transactionId) {
    return ignored(`Nenhuma cobrança da assinatura ${event.subscriptionCode} está registrada aqui; nada a suspender. Revise em Alunos se for o caso.`, {
      ...base,
      nothingToUndo: true,
      userId: account?.id ?? null
    });
  }

  if (saleGrants.length === 0 && !account) {
    return ignored(event.transactionId ? "Nenhuma venda registrada com essa compra e nenhum aluno com o e-mail dela; nada a revogar." : unlinkedMessage(event), {
      ...base,
      nothingToUndo: true
    });
  }

  const userId = saleGrants[0]?.user_id ?? account?.id ?? null;
  const userRows = userId ? await fetchEntitlements(studentsDb, { userId }) : [];
  const grantEntitlementIds = Array.from(new Set(saleGrants.map((grant) => grant.entitlement_id)));
  // Cancelamento pela assinatura que tambem traz a transacao (Ticto): os acessos com vinculo desta
  // transacao fora da assinatura (o order bump, cobranca unica) nao sao "acesso sem vinculo" e ficam.
  const transactionGrants = bySubscription.length > 0 && event.transactionId ? await fetchSaleGrantsByTransaction(db, event.provider, event.transactionId) : [];
  const knownEntitlementIds = new Set([...grantEntitlementIds, ...transactionGrants.map((grant) => grant.entitlement_id)]);

  // Acessos desta venda sem vinculo gravado: com a compra, o que nasceu dela (source_event_id); no
  // cancelamento sem codigo, os acessos desta plataforma nos produtos do pacote ou produto cancelado.
  const legacyRows = userRows.filter(
    (row) =>
      !knownEntitlementIds.has(row.id) &&
      (event.transactionId ? entitlementBelongsToSale(row, event) : row.source_provider === event.provider && (target?.productIds ?? []).includes(row.target_id))
  );

  // Os acessos em jogo vem pelos ids dos vinculos (mesmo que o aluno tenha trocado o e-mail), mais os sem vinculo.
  const rows = [...(await fetchEntitlementsByIds(studentsDb, grantEntitlementIds)), ...legacyRows];
  const allGrants = await fetchSaleGrantsForEntitlements(db, rows.map((row) => row.id));
  const closingTransactionIds = new Set([...saleGrants.map((grant) => grant.transaction_id), saleSourceEventId(event)]);
  const closingSubscriptionCodes = new Set(event.subscriptionCode ? [event.subscriptionCode] : []);
  const now = Date.now();
  const changed: string[] = [];
  const restored: string[] = [];
  const kept: string[] = [];
  const reasons = new Set<string>();

  // Decide tudo primeiro, depois age; os vinculos da venda so fecham no fim, quando tudo deu certo.
  for (const row of rows) {
    const history: SaleGrantLike[] = allGrants.filter((grant) => grant.entitlement_id === row.id);
    // Acesso desta venda sem vinculo dela (venda anterior ao registro), talvez com vinculos de outras
    // compras depois: a venda entra no historico como a que abriu o acesso, na data do acesso.
    const coversSale = history.some(
      (grant) => closingTransactionIds.has(grant.transaction_id) || (grant.subscription_code !== null && closingSubscriptionCodes.has(grant.subscription_code))
    );
    const decision = decideEntitlementAfterSale({
      closingSubscriptionCodes,
      closingTransactionIds,
      eventProvider: event.provider,
      grants: coversSale ? history : [legacyGrantFor(row, event), ...history],
      rowSourceProvider: row.source_provider
    });

    if (decision.kind === "restore_deadline") {
      const alreadyBack = row.status === "active" && row.ends_at !== null && Date.parse(row.ends_at) === Date.parse(decision.endsAt);

      if (alreadyBack) {
        kept.push(row.target_id);
        reasons.add("o prazo anterior já estava de volta");
        continue;
      }

      // A venda tinha estendido um acesso de outra origem: o prazo anterior volta, o acesso continua.
      await restoreEntitlements({ ...context, snapshots: [{ endsAt: decision.endsAt, id: row.id, startsAt: row.starts_at, status: row.status }] }, studentsDb);
      restored.push(row.target_id);
      continue;
    }

    if (decision.kind !== "close") {
      kept.push(row.target_id);
      reasons.add(KEEP_REASONS[decision.kind]);
      continue;
    }

    // Ja fechado do jeito pedido, ou revogado (reembolso, chargeback, equipe): um cancelamento de
    // assinatura depois nao rebaixa a revogacao para suspensao.
    if (row.status === closedStatus || (action === "suspend" && row.status === "revoked")) {
      continue;
    }

    await applyAccessAction({ ...context, action, entitlementId: row.id, userId: row.user_id }, studentsDb);
    changed.push(row.target_id);
  }

  const openGrantIds = saleGrants.filter((grant) => grant.closed_at === null).map((grant) => grant.id);

  if (openGrantIds.length > 0) {
    await closeSaleGrants(db, openGrantIds, closedBy);
  }

  if (changed.length === 0 && restored.length === 0) {
    if (kept.length > 0) {
      return ignored(`Nada mudou: ${[...reasons].join("; ")}. Revise em Alunos se for o caso.`, { ...base, userId });
    }

    const otherOriginOpen = userRows.some((row) => (target ? target.productIds.includes(row.target_id) : true) && isOpenRow(row, now));

    return ignored(
      otherOriginOpen && rows.length === 0
        ? "O acesso desse aluno veio de outra origem (equipe ou outra compra), não desta venda; nada mudou. Revise em Alunos se for o caso."
        : rows.length > 0
          ? "O acesso desta compra já estava fechado; nada mudou."
          : "O aluno não tinha acesso desta compra; nada mudou.",
      { ...base, nothingToUndo: !otherOriginOpen && rows.length === 0, userId }
    );
  }

  const verb = action === "revoke" ? "revogado" : "suspenso";
  const parts = [
    ...(changed.length > 0 ? [changed.length > 1 ? `acesso ${verb} em ${plural(changed.length, "produto", "produtos")}` : `acesso ${verb}`] : []),
    ...(restored.length > 0 ? [`prazo anterior devolvido em ${plural(restored.length, "produto", "produtos")} (a venda só tinha estendido um acesso de outra origem)`] : []),
    ...(kept.length > 0 ? [`${plural(kept.length, "produto mantido", "produtos mantidos")} (${[...reasons].join("; ")})`] : [])
  ];
  const what = target?.kind === "combo" ? `pacote ${target.name}: ${parts.join("; ")}` : parts.join("; ");
  const touched = [...changed, ...restored];

  return {
    comboId: target?.comboId ?? null,
    detail: `${what}.`,
    outcome: changed.length === 0 ? "access_restored" : action === "revoke" ? "access_revoked" : "access_suspended",
    productId: target?.productId ?? (touched.length === 1 ? touched[0] : null),
    productIds: touched,
    userId
  };
}

/**
 * Id que vai para entitlements.source_event_id, para sale_grants.transaction_id e para a chave do e-mail
 * de compra (que ja leva o nome da plataforma): a compra (transaction), estavel entre os eventos da mesma
 * venda; sem ela, o id do evento. A origem fica em source_provider.
 */
export function saleSourceEventId(event: NormalizedSaleEvent) {
  return event.transactionId ?? event.eventId;
}
