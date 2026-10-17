import "server-only";

// Regra de acesso de uma venda ja normalizada (docs/04, secao Webhooks externos; docs/17 §1.6.8).
// Separada do parser da plataforma de proposito: aqui so existe o evento normalizado, o codigo do produto
// ligado em sales_product_links e a rotina de acesso de Alunos (src/server/students/access.ts), a mesma
// do admin. Nada do payload libera conteudo por si.
//
// Resultados:
// - compra aprovada: conta criada ou encontrada pelo e-mail e produto(s) liberados sem prazo
//   (pacote = todos os produtos dele, de uma vez, num e-mail so). Compra que ja tem reembolso ou
//   chargeback registrado nao libera (reprocesso ou reenvio fora de ordem). Confirmacao de compra
//   anterior (Hotmart: fim da garantia) so libera para quem nunca teve acesso ao produto: nunca reabre
//   acesso suspenso ou revogado;
// - reembolso e chargeback: revogam SO os acessos que nasceram desta compra (mesma plataforma e mesma
//   transacao), qualquer que seja a situacao atual do pacote; acesso que veio da equipe ou de outra
//   compra fica como esta, com o motivo escrito para a equipe decidir. Assinatura cancelada suspende
//   os acessos dessa plataforma nos produtos da assinatura;
// - o que nao da para fazer (evento que nao muda acesso, produto sem codigo ligado, pacote em rascunho
//   na compra, aluno sem conta) e IGNORADO com o motivo escrito, nunca erro;
// - erro de verdade (payload sem e-mail, falha do banco) sobe para quem chamou marcar `failed`.

import { findAccountByEmail, normalizeEmail } from "@/server/students/accounts";
import { applyAccessAction, provisionStudentAccess } from "@/server/students/access";
import { accessStateOf, isAccessOpen, targetTypeForContentKind } from "@/server/students/model";
import {
  fetchContentKinds,
  fetchEntitlements,
  fetchProfileByEmail,
  findEntitlementForTarget,
  type EntitlementRow,
  type StudentsDb
} from "@/server/students/store";
import { SALES_PROVIDER_LABELS, type SaleOutcome } from "./model";
import { fetchSalesLinkByExternalId, hasClosingEventForTransaction, type SalesDb } from "./store";
import type { NormalizedSaleEvent } from "./types";

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

async function resolveTarget(db: SalesDb, event: NormalizedSaleEvent): Promise<ResolvedTarget | null> {
  if (!event.externalProductId) {
    return null;
  }

  const link = await fetchSalesLinkByExternalId(db, event.provider, event.externalProductId);

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
};

export async function processSaleEvent(db: SalesDb, input: ProcessSaleInput): Promise<SaleProcessingResult> {
  const { event } = input;

  if (event.type === "other") {
    return ignored(`Evento ${event.rawType} não muda o acesso de ninguém.`);
  }

  if (!event.externalProductId) {
    return ignored("O evento não informa qual produto foi vendido.");
  }

  const target = await resolveTarget(db, event);

  if (event.type === "purchase_approved") {
    return target ? grantPurchase(db, { ...input, target }) : ignored(unlinkedMessage(event));
  }

  return removeAccess(db, { ...input, target });
}

/* ------------------------------------------------------------------------------------------------
 * Compra aprovada
 * ---------------------------------------------------------------------------------------------- */

async function grantPurchase(db: SalesDb, input: ProcessSaleInput & { target: ResolvedTarget }): Promise<SaleProcessingResult> {
  const { event, target } = input;
  const studentsDb = db as StudentsDb;
  const base: TargetRef = { comboId: target.comboId, productId: target.productId };

  // So a compra e barrada pela situacao do pacote: reembolso e chargeback passam sempre (removeAccess).
  if (target.kind === "combo" && target.status !== "active") {
    const situation = target.status === "paused" ? "pausado" : "em rascunho";

    return ignored(`O pacote ${target.name} está ${situation}: vendas dele não liberam acesso até ser ativado.`, base);
  }

  if (target.productIds.length === 0) {
    return ignored(`O pacote ${target.kind === "combo" ? target.name : ""} não tem produtos.`, base);
  }

  const contents = await fetchContentKinds(studentsDb, target.productIds);
  let productIds = target.productIds.filter((id) => contents.some((content) => content.id === id));

  if (productIds.length === 0) {
    return ignored("O produto ligado a esse código não existe mais no catálogo.", base);
  }

  if (!event.buyer.email) {
    throw new SaleProcessingError(`O evento ${event.rawType} veio sem um e-mail válido do comprador.`, base);
  }

  const email = normalizeEmail(event.buyer.email);
  const providerLabel = SALES_PROVIDER_LABELS[event.provider];

  // Reprocesso ou reenvio fora de ordem: a compra ja foi desfeita na plataforma.
  if (event.transactionId && (await hasClosingEventForTransaction(db, event.provider, event.transactionId))) {
    return ignored(`A compra ${event.transactionId} já tem reembolso ou chargeback registrado na ${providerLabel}; acesso não liberado.`, base);
  }

  const account = await findAccountByEmail(studentsDb, email);

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
      sourceProvider: event.provider
    },
    studentsDb
  );

  const granted = result.grantedProductIds.length;
  const what = target.kind === "combo" ? `pacote ${target.name} (${plural(granted, "produto", "produtos")})` : plural(granted, "produto liberado", "produtos liberados");
  const accountNote = result.existingAccount ? "conta que já existia" : "conta nova";

  return {
    comboId: target.comboId,
    detail: `${what}; ${accountNote}.`,
    outcome: "access_granted",
    productId: target.productId,
    productIds: result.grantedProductIds,
    userId: result.id
  };
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

async function removeAccess(db: SalesDb, input: ProcessSaleInput & { target: ResolvedTarget | null }): Promise<SaleProcessingResult> {
  const { event, target } = input;
  const studentsDb = db as StudentsDb;
  const base: TargetRef = { comboId: target?.comboId ?? null, productId: target?.productId ?? null };
  const action = event.type === "subscription_canceled" ? "suspend" : "revoke";

  // Reembolso e chargeback acham o acesso pela transacao: nao precisam do pacote estar ativo, nem de o
  // codigo continuar ligado. So a assinatura cancelada (sem transacao) depende do produto ligado.
  if (!event.transactionId && !target) {
    return ignored(unlinkedMessage(event), base);
  }

  if (!event.buyer.email) {
    throw new SaleProcessingError(`O evento ${event.rawType} veio sem um e-mail válido do comprador.`, base);
  }

  const email = normalizeEmail(event.buyer.email);
  const account = await findAccountByEmail(studentsDb, email);

  if (!account) {
    return ignored("Nenhum aluno com o e-mail da compra; nada a revogar.", base);
  }

  const rows = await fetchEntitlements(studentsDb, { userId: account.id });
  const now = Date.now();
  const targetIds = new Set(target?.productIds ?? []);
  const fromThisSale = event.transactionId
    ? rows.filter((row) => entitlementBelongsToSale(row, event))
    : rows.filter((row) => row.source_provider === event.provider && targetIds.has(row.target_id));
  const wantedStatus = action === "revoke" ? "revoked" : "suspended";
  const changed: string[] = [];

  for (const row of fromThisSale) {
    if (row.status === wantedStatus) {
      continue;
    }

    await applyAccessAction(
      {
        action,
        actorId: null,
        entitlementId: row.id,
        source: "webhook",
        sourceEventId: saleSourceEventId(event),
        sourceProvider: event.provider,
        userId: account.id
      },
      studentsDb
    );
    changed.push(row.target_id);
  }

  if (changed.length === 0) {
    const otherOriginOpen = rows.some(
      (row) =>
        !fromThisSale.includes(row) &&
        (targetIds.size === 0 || targetIds.has(row.target_id)) &&
        isAccessOpen(accessStateOf({ endsAt: row.ends_at, now, startsAt: row.starts_at, status: row.status }))
    );
    const detail = otherOriginOpen
      ? "O acesso desse aluno veio de outra origem (equipe ou outra compra), não desta venda; nada mudou. Revise em Alunos se for o caso."
      : fromThisSale.length > 0
        ? "O acesso desta compra já estava fechado; nada mudou."
        : "O aluno não tinha acesso desta compra; nada mudou.";

    return ignored(detail, { ...base, userId: account.id });
  }

  const verb = action === "revoke" ? "revogado" : "suspenso";
  const what =
    target?.kind === "combo"
      ? `pacote ${target.name}: acesso ${verb} em ${plural(changed.length, "produto", "produtos")}`
      : changed.length > 1
        ? `acesso ${verb} em ${plural(changed.length, "produto", "produtos")}`
        : `acesso ${verb}`;

  return {
    comboId: target?.comboId ?? null,
    detail: `${what}.`,
    outcome: action === "revoke" ? "access_revoked" : "access_suspended",
    productId: target?.productId ?? (changed.length === 1 ? changed[0] : null),
    productIds: changed,
    userId: account.id
  };
}

/**
 * Id que vai para entitlements.source_event_id e para a chave do e-mail de compra (que ja leva o nome
 * da plataforma): a compra (transaction), estavel entre os eventos da mesma venda; sem ela, o id do
 * evento. A origem fica em source_provider.
 */
export function saleSourceEventId(event: NormalizedSaleEvent) {
  return event.transactionId ?? event.eventId;
}
