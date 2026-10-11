"use client";

import { SpeedInsights as VercelSpeedInsights } from "@vercel/speed-insights/next";

type SpeedInsightsEvent = {
  type: "vital";
  url: string;
  route?: string;
};

// A metrica so precisa da pagina: query string e fragmento podem carregar codigos de login
// (/auth/callback?code=...) ou tokens de convite (#access_token=...), entao nunca saem do navegador.
function stripQueryAndHash(event: SpeedInsightsEvent): SpeedInsightsEvent {
  const end = event.url.search(/[?#]/);

  return end === -1 ? event : { ...event, url: event.url.slice(0, end) };
}

// Web Vitals reais (LCP, INP, CLS, TTFB) por rota. Na Vercel o script e servido pelo proprio dominio
// (/_vercel/speed-insights); fora dela a requisicao do script falha sem afetar a pagina.
export function SpeedInsights() {
  return <VercelSpeedInsights beforeSend={stripQueryAndHash} />;
}
