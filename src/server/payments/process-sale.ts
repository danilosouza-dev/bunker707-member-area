import "server-only";

// Regra de acesso de uma venda ja normalizada (docs/04, secao Webhooks externos; docs/17 §1.6.8).
// Separada do parser da plataforma de proposito: aqui so existe o evento normalizado, o codigo do produto
// ligado em sales_product_links e a rotina de acesso de Alunos (src/server/students/access.ts), a mesma
// do admin. Nada do payload libera conteudo por si.
//
// Resultados:
// - compra aprovada: conta criada ou encontrada pelo e-mail e produto(s) liberados sem prazo
//   (pacote = todos os produtos dele, de uma vez, num e-mail so; produtos vendidos junto no mesmo
//   pedido, os order bumps da Ticto, entram na mesma liberacao quando o codigo deles esta ligado, e o
//   que nao esta ligado fica escrito no detalhe sem bloquear o resto);
// - reembolso e chargeback: acesso revogado em cada produto; assinatura cancelada: suspenso;
// - o que nao da para fazer (evento que nao muda acesso, produto sem codigo ligado, pacote em rascunho,
//   aluno sem conta) e IGNORADO com o motivo escrito, nunca erro;
// - erro de verdade (payload sem e-mail, falha do banco) sobe para quem chamou marcar `failed`.

import { findAccountByEmail, normalizeEmail } from "@/server/students/accounts";
import { applyAccessAction, provisionStudentAccess } from "@/server/students/access";
import { targetTypeForContentKind } from "@/server/students/model";
import { fetchContentKinds, fetchProfileByEmail, findEntitlementForTarget, type StudentsDb } from "@/server/students/store";
import { SALES_PROVIDER_LABELS, type SaleOutcome } from "./model";
import { fetchSalesLinkByExternalId, type SalesDb } from "./store";
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
};

type ResolvedTarget =
  | { comboId: null; kind: "product"; productId: string; productIds: string[] }
  | { comboId: string; kind: "combo"; productId: null; productIds: string[]; status: string; name: string };

function ignored(detail: string, extra: Partial<SaleProcessingResult> = {}): SaleProcessingResult {
  return { comboId: null, detail, outcome: "ignored", productId: null, productIds: [], userId: null, ...extra };
}

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;
}

async function resolveTarget(db: SalesDb, provider: SalesProvider, externalProductId: string): Promise<ResolvedTarget | null> {
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

export type ProcessSaleInput = {
  event: NormalizedSaleEvent;
  /** Origem publica do site (`https://host`) para os links dos e-mails. */
  siteOrigin: string | null;
};

/** Um codigo vendido no evento: o produto principal ou um produto vendido junto (order bump). */
type SaleLine = { externalProductId: string; externalProductName: string | null; extra: boolean };

type SaleTargetBase = { comboId: string | null; productId: string | null };

type LineResolution =
  | { contents: { id: string; kind: string }[]; ok: true; productIds: string[]; target: ResolvedTarget }
  /** `reason`: o motivo quando nada foi liberado; `note`: a frase quando outro produto do pedido foi. */
  | { base: SaleTargetBase | null; note: string; ok: false; reason: string };

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

function skippedLine(base: SaleTargetBase | null, reason: string, note = reason): LineResolution {
  return { base, note, ok: false, reason };
}

/** Resolve um codigo vendido em sales_product_links e confere que o alvo libera algum produto do catalogo. */
async function resolveLine(db: SalesDb, event: NormalizedSaleEvent, line: SaleLine): Promise<LineResolution> {
  const providerLabel = SALES_PROVIDER_LABELS[event.provider];
  const code = `${line.externalProductId}${line.externalProductName ? ` (${line.externalProductName})` : ""}`;
  const target = await resolveTarget(db, event.provider, line.externalProductId);

  if (!target) {
    return line.extra
      ? skippedLine(null, `O produto vendido junto ${code} da ${providerLabel} não está ligado a nenhum produto ou pacote da escola e não foi liberado.`)
      : skippedLine(
          null,
          `O produto ${code} da ${providerLabel} não está ligado a nenhum produto ou pacote da escola. Informe o código em Produtos › Acesso e venda ou em Pacotes e use Reprocessar.`,
          `O produto principal ${code} da ${providerLabel} não está ligado a nenhum produto ou pacote da escola e não foi liberado.`
        );
  }

  const base = { comboId: target.comboId, productId: target.productId };

  if (target.kind === "combo" && target.status !== "active") {
    const situation = target.status === "paused" ? "pausado" : "em rascunho";

    return line.extra
      ? skippedLine(base, `O pacote ${target.name}, vendido junto, está ${situation} e não foi liberado.`)
      : skippedLine(base, `O pacote ${target.name} está ${situation}: vendas dele não mudam acesso até ser ativado.`);
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

  return { contents, ok: true, productIds, target };
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

export async function processSaleEvent(db: SalesDb, input: ProcessSaleInput): Promise<SaleProcessingResult> {
  const { event } = input;

  if (event.type === "other") {
    return ignored(`Evento ${event.rawType} não muda o acesso de ninguém.`);
  }

  const lines = saleLines(event);

  if (lines.length === 0) {
    return ignored("O evento não informa qual produto foi vendido.");
  }

  // Cada codigo do pedido (o principal e os vendidos junto) libera o proprio alvo; o que nao esta ligado
  // fica escrito no detalhe e nao bloqueia o resto.
  const resolutions: LineResolution[] = [];

  for (const line of lines) {
    resolutions.push(await resolveLine(db, event, line));
  }

  const released = resolutions.filter((item): item is Extract<LineResolution, { ok: true }> => item.ok);
  const skipped = resolutions.filter((item): item is Extract<LineResolution, { ok: false }> => !item.ok);

  if (released.length === 0) {
    return ignored(skipped.map((item) => item.reason).join(" "), skipped[0]?.base ?? {});
  }

  const target = released[0].target;
  const base = { comboId: target.comboId, productId: target.productId };
  const productIds = Array.from(new Set(released.flatMap((item) => item.productIds)));
  const contents = Array.from(new Map(released.flatMap((item) => item.contents).map((content) => [content.id, content])).values());
  const notes = { notes: skipped.map((item) => item.note), released: released.length };

  if (!event.buyer.email) {
    throw new SaleProcessingError(`O evento ${event.rawType} veio sem um e-mail válido do comprador.`, base);
  }

  const email = normalizeEmail(event.buyer.email);

  if (event.type === "purchase_approved") {
    return withSaleNotes(await grantPurchase(db, { ...input, email, productIds, target }), notes);
  }

  return withSaleNotes(
    await removeAccess(db, { action: event.type === "subscription_canceled" ? "suspend" : "revoke", contents, email, event, productIds, target }),
    notes
  );
}

async function grantPurchase(
  db: SalesDb,
  input: ProcessSaleInput & { email: string; productIds: string[]; target: ResolvedTarget }
): Promise<SaleProcessingResult> {
  const { event, target } = input;
  const studentsDb = db as StudentsDb;
  // Conta que ja existe: nome e telefone so preenchem o que estiver vazio (a venda nao apaga o cadastro).
  const profile = await fetchProfileByEmail(studentsDb, input.email);
  const fullName = profile?.full_name?.trim() || event.buyer.name?.trim() || input.email.split("@")[0];
  const phone = profile?.phone?.trim() || event.buyer.phone || null;
  const siteOrigin = input.siteOrigin ?? "http://localhost:3000";

  const result = await provisionStudentAccess(
    {
      actorId: null,
      delivery: "none",
      email: input.email,
      endsAt: null,
      fullName,
      phone,
      productIds: input.productIds,
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
  const account = result.existingAccount ? "conta que já existia" : "conta nova";

  return {
    comboId: target.comboId,
    detail: `${what}; ${account}.`,
    outcome: "access_granted",
    productId: target.productId,
    productIds: result.grantedProductIds,
    userId: result.id
  };
}

async function removeAccess(
  db: SalesDb,
  input: {
    action: "revoke" | "suspend";
    contents: { id: string; kind: string }[];
    email: string;
    event: NormalizedSaleEvent;
    productIds: string[];
    target: ResolvedTarget;
  }
): Promise<SaleProcessingResult> {
  const { event, target } = input;
  const studentsDb = db as StudentsDb;
  const base = { comboId: target.comboId, productId: target.productId };
  const account = await findAccountByEmail(studentsDb, input.email);

  if (!account) {
    return ignored("Nenhum aluno com o e-mail da compra; nada a revogar.", base);
  }

  const wantedStatus = input.action === "revoke" ? "revoked" : "suspended";
  const changed: string[] = [];

  for (const productId of input.productIds) {
    const content = input.contents.find((item) => item.id === productId);

    if (!content) {
      continue;
    }

    const entitlement = await findEntitlementForTarget(studentsDb, account.id, targetTypeForContentKind(content.kind), productId);

    if (!entitlement || entitlement.status === wantedStatus) {
      continue;
    }

    await applyAccessAction(
      {
        action: input.action,
        actorId: null,
        entitlementId: entitlement.id,
        source: "webhook",
        sourceEventId: saleSourceEventId(event),
        sourceProvider: event.provider,
        userId: account.id
      },
      studentsDb
    );
    changed.push(productId);
  }

  if (changed.length === 0) {
    return ignored("O aluno não tinha acesso aberto a esse produto; nada mudou.", { ...base, userId: account.id });
  }

  const verb = input.action === "revoke" ? "revogado" : "suspenso";
  const what = target.kind === "combo" ? `pacote ${target.name}: acesso ${verb} em ${plural(changed.length, "produto", "produtos")}` : `acesso ${verb}`;

  return {
    comboId: target.comboId,
    detail: `${what}.`,
    outcome: input.action === "revoke" ? "access_revoked" : "access_suspended",
    productId: target.productId,
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
