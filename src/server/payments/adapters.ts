// Registro dos adaptadores das plataformas de venda. Modulo puro. A Kiwify entra aqui quando existir;
// ate la, a tela mostra a Kiwify como "Em configuracao" (docs/17 §1.10).

import { hotmartAdapter } from "./hotmart";
import { tictoAdapter } from "./ticto";
import type { PaymentProviderAdapter, SalesProvider } from "./types";

const ADAPTERS: Partial<Record<SalesProvider, PaymentProviderAdapter>> = {
  hotmart: hotmartAdapter,
  ticto: tictoAdapter
};

export function getPaymentAdapter(provider: SalesProvider): PaymentProviderAdapter | null {
  return ADAPTERS[provider] ?? null;
}

/** Plataformas que ja recebem vendas de verdade. */
export function isSalesProviderSupported(provider: SalesProvider) {
  return Boolean(ADAPTERS[provider]);
}
