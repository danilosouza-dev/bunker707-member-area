import { receiveSaleWebhook } from "@/server/payments/webhook-handler";

// Webhook 2.0 da Hotmart (compra aprovada, reembolso, chargeback, assinatura cancelada). O token
// (hottok) vem no cabecalho X-HOTMART-HOTTOK e e conferido em tempo constante contra o segredo salvo em
// Configuracoes > Vendas; sem plataforma conectada a rota responde 503 e nao grava nada. Fluxo completo
// em src/server/payments/webhook-handler.ts e docs/04, secao Webhooks externos.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  return receiveSaleWebhook("hotmart", request);
}
