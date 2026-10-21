"use client";

import { sendBeaconPost } from "@/components/member/notifications/notifications-client";
import { checkoutPageKey, contentPageKey } from "@/server/member-area/page-visit-model";

// Beacon das visitas que nao sao navegacao (Comunicacao v2, docs/23 §5.2): abrir os detalhes de um
// produto (o modal) e clicar em Comprar. As paginas gravam a propria visita no servidor; aqui sai so um
// POST /api/page-visits por navigator.sendBeacon (sobrevive a saida da pagina, inclusive quando o Comprar
// navega na mesma aba), com fetch keepalive de reserva. O servidor ignora o que nenhum fluxo acompanha,
// a equipe e a repeticao dentro de 1 minuto; aqui nada e lido de volta e nada lanca.
//
// Todo botao que abre o purchaseUrl chama trackCheckoutClick antes do window.open ou da navegacao
// (tests/visitas-de-pagina.guard.test.mjs confere): sem isso "não clicaram em Comprar" ficaria errado.

const PAGE_VISITS_ENDPOINT = "/api/page-visits";

/** Detalhes ja registrados nesta carga da pagina (um beacon por produto). */
const detailsSent = new Set<string>();

function sendPageKey(key: string | null) {
  if (key) {
    sendBeaconPost(PAGE_VISITS_ENDPOINT, JSON.stringify({ key }));
  }
}

/** Abriu os detalhes do produto: "content:<id>", uma vez por produto a cada carga da pagina. */
export function trackProductDetails(productId: string) {
  const key = contentPageKey(productId);

  if (!key || detailsSent.has(key)) {
    return;
  }

  detailsSent.add(key);
  sendPageKey(key);
}

/** Clicou em Comprar: "checkout:<id>". Chamar antes do window.open ou da navegacao para o purchaseUrl. */
export function trackCheckoutClick(productId: string) {
  sendPageKey(checkoutPageKey(productId));
}
