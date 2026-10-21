// Camada aberta por cima da pagina (hoje, o pop-up dos avisos da home; docs/22 §1.3). Quem toca midia
// que o pop-up nao alcanca direto (o video do YouTube do destaque, num iframe) escuta este evento da
// window: pausa ao abrir e volta ao fechar, so se foi ele quem pausou.

export const OVERLAY_EVENT = "bunker707:overlay";

export type OverlayEventDetail = { open: boolean };

export function announceOverlay(open: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<OverlayEventDetail>(OVERLAY_EVENT, { detail: { open } }));
}

/** Le o detalhe do evento sem confiar no formato (qualquer script da pagina pode disparar o mesmo nome). */
export function overlayEventOpen(event: Event) {
  const detail = (event as CustomEvent<Partial<OverlayEventDetail> | null>).detail;

  return Boolean(detail && detail.open === true);
}
