import "server-only";

// Os dois e-mails transacionais do app (docs/04, secao E-mail): boas-vindas quando a conta do aluno
// nasce e acesso liberado quando uma venda concede acesso novo. Cada funcao monta o texto pelo
// template, define a chave de idempotencia e enfileira; nunca envia na hora. Falha ao enfileirar vira
// log: o acesso ja foi dado e e o que importa.

import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueEmail } from "./outbox";
import { purchaseIdempotencyKey, welcomeIdempotencyKey } from "./outbox-rules";
import { renderPurchaseEmail } from "./templates/purchase";
import { renderWelcomeEmail, type WelcomePasswordHint } from "./templates/welcome";

const LOCAL_FALLBACK_ORIGIN = "http://localhost:3000";

/** Origem (`https://host`) de uma URL completa, ou null. */
export function originOfUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Origem publica dos links dos e-mails: NEXT_PUBLIC_SITE_URL primeiro; sem ela, a origem que o
 * caminho de disparo conhece (request do admin ou do webhook); por ultimo, o localhost de desenvolvimento.
 */
export function resolveEmailSiteOrigin(fallbackOrigin: string | null | undefined) {
  const configured = originOfUrl(process.env.NEXT_PUBLIC_SITE_URL?.trim());

  return configured ?? originOfUrl(fallbackOrigin) ?? LOCAL_FALLBACK_ORIGIN;
}

export function loginUrlOf(siteOrigin: string) {
  return `${siteOrigin}/login`;
}

export function contentUrlOf(siteOrigin: string, contentId: string) {
  return `${siteOrigin}/conteudo/${encodeURIComponent(contentId)}`;
}

export type EnqueueWelcomeEmailInput = {
  email: string;
  fullName: string | null;
  passwordHint: WelcomePasswordHint;
  /** Origem do request que criou a conta (vira fallback de NEXT_PUBLIC_SITE_URL). */
  siteOrigin: string | null | undefined;
  userId: string;
};

export async function enqueueWelcomeEmail(db: SupabaseClient, input: EnqueueWelcomeEmailInput) {
  try {
    const origin = resolveEmailSiteOrigin(input.siteOrigin);
    const rendered = renderWelcomeEmail({ email: input.email, fullName: input.fullName, loginUrl: loginUrlOf(origin), passwordHint: input.passwordHint });

    return await enqueueEmail(db, {
      html: rendered.html,
      idempotencyKey: welcomeIdempotencyKey(input.userId),
      kind: "welcome",
      metadata: { password_hint: input.passwordHint },
      subject: rendered.subject,
      text: rendered.text,
      to: input.email,
      userId: input.userId
    });
  } catch (error) {
    console.error("[e-mail] boas-vindas não enfileirado.", error);

    return null;
  }
}

export type EnqueuePurchaseEmailInput = {
  email: string;
  fullName: string | null;
  products: { id: string; title: string }[];
  entitlementIds: string[];
  siteOrigin: string | null | undefined;
  sourceEventId: string | null | undefined;
  sourceProvider: string;
  userId: string;
};

export async function enqueuePurchaseEmail(db: SupabaseClient, input: EnqueuePurchaseEmailInput) {
  if (input.products.length === 0) {
    return null;
  }

  try {
    const origin = resolveEmailSiteOrigin(input.siteOrigin);
    const rendered = renderPurchaseEmail({
      email: input.email,
      fullName: input.fullName,
      loginUrl: loginUrlOf(origin),
      products: input.products.map((product) => ({ title: product.title, url: contentUrlOf(origin, product.id) }))
    });

    return await enqueueEmail(db, {
      html: rendered.html,
      idempotencyKey: purchaseIdempotencyKey({
        entitlementIds: input.entitlementIds,
        sourceEventId: input.sourceEventId,
        sourceProvider: input.sourceProvider,
        userId: input.userId
      }),
      kind: "purchase",
      metadata: {
        product_ids: input.products.map((product) => product.id),
        source_event_id: input.sourceEventId ?? null,
        source_provider: input.sourceProvider
      },
      subject: rendered.subject,
      text: rendered.text,
      to: input.email,
      userId: input.userId
    });
  } catch (error) {
    console.error("[e-mail] acesso liberado não enfileirado.", error);

    return null;
  }
}
