// Quando as paginas e tarefas de vendedor existem (docs/32 §2.4 e §11.3, "As paginas de vendedor"). Modulo puro.
//
// A regra, nas duas pontas:
// - sem a API interna configurada (config.ts), nada de vendedor existe: nem Minhas licencas, nem o item do menu, nem a
//   marca Bunker Members no produto, nem a fila da venda ao Emissor (a tarefa nem le o banco). E o caso da copia do
//   comprador: ela nunca tem uma credencial valida, porque so o Emissor a cria, e so para a nossa escola;
// - no modo "enforce" (a copia do comprador e, depois, a nossa escola como Instalacao numero 1), alem da configuracao, a
//   licenca assinada precisa trazer a chave interna `seller-pages`, que so a nossa licenca traz (isGrantEnabled). As duas
//   travas juntas: quem copiasse a configuracao para outra escola continuaria sem a chave, e quem forjasse a chave
//   continuaria sem a credencial;
// - no modo "off" (a nossa escola hoje, a `dev`, a Vercel e os testes) a chave interna nao existe, e vale so a
//   configuracao (ou o simulador, fora da producao).

import type { InternalEmissorConfig } from "./config";

/** A chave interna da nossa licenca que liga as paginas de vendedor no modo "enforce" (nunca um modulo da loja). */
export const SELLER_PAGES_GRANT = "seller-pages";

export type SellerAccess =
  | { enabled: true; via: "http" | "simulador" }
  | { enabled: false; reason: "sem_configuracao" | "configuracao_invalida" | "sem_chave_interna" };

export function sellerAccessOf(input: { config: InternalEmissorConfig; licensingMode: "off" | "enforce"; grantEnabled: boolean }): SellerAccess {
  if (input.config.mode === "desligado") {
    return { enabled: false, reason: input.config.reason };
  }

  if (input.licensingMode === "enforce" && !input.grantEnabled) {
    return { enabled: false, reason: "sem_chave_interna" };
  }

  return { enabled: true, via: input.config.mode };
}
