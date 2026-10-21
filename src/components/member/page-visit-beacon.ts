"use client";

import { sendBeaconPost } from "@/components/member/notifications/notifications-client";
import { checkoutPageKey, contentPageKey, PAGE_VISIT_THROTTLE_MS } from "@/server/member-area/page-visit-model";

// Beacon das visitas que nao sao navegacao (Comunicacao v2, docs/23 §5.2): abrir os detalhes de um
// produto (o modal) e clicar em Comprar. As paginas gravam a propria visita no servidor; aqui sai so um
// POST /api/page-visits por navigator.sendBeacon (sobrevive a saida da pagina, inclusive quando o Comprar
// navega na mesma aba), com fetch keepalive de reserva. O servidor ignora o que nenhum fluxo acompanha,
// a equipe e a repeticao dentro de PAGE_VISIT_THROTTLE_MS; aqui nada e lido de volta e nada lanca.
//
// Todo botao que abre o purchaseUrl chama trackCheckoutClick antes do window.open ou da navegacao
// (tests/visitas-de-pagina.guard.test.mjs confere): sem isso "não clicaram em Comprar" ficaria errado.

const PAGE_VISITS_ENDPOINT = "/api/page-visits";

/**
 * Quando cada produto teve os detalhes registrados (ms). O modulo vive enquanto a aba navega pelo App
 * Router: sem prazo, a segunda abertura (depois de uma notificacao, ou de um fluxo que passou a acompanhar
 * o produto) nunca seria gravada. Repete depois da mesma trava do servidor.
 */
const detailsSentAt = new Map<string, number>();

function sendPageKey(key: string | null) {
  if (key) {
    sendBeaconPost(PAGE_VISITS_ENDPOINT, JSON.stringify({ key }));
  }
}

/** Abriu os detalhes do produto: "content:<id>", de novo so depois de PAGE_VISIT_THROTTLE_MS. */
export function trackProductDetails(productId: string) {
  const key = contentPageKey(productId);

  if (!key) {
    return;
  }

  const now = Date.now();
  const last = detailsSentAt.get(key);

  if (last !== undefined && now - last >= 0 && now - last < PAGE_VISIT_THROTTLE_MS) {
    return;
  }

  detailsSentAt.set(key, now);
  sendPageKey(key);
}

/** Clicou em Comprar: "checkout:<id>". Chamar antes do window.open ou da navegacao para o purchaseUrl. */
export function trackCheckoutClick(productId: string) {
  sendPageKey(checkoutPageKey(productId));
}
