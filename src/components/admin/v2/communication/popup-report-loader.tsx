import { getPopupReport } from "@/server/communications/queries";
import { PopupReportSection } from "./popup-report-section";

// Relatorio do pop-up (v3b-2, docs/29 §6.5): Server Component da pagina do pop-up que ja foi ao ar, dentro de um
// Suspense (o funil e o resto da pagina nao esperam). Duas leituras com cache de 60 s (getPopupReport: a RPC e
// os nomes dos produtos citados); sem a migracao ou com falha, a secao diz por que nao ha numeros.

export async function PopupReportLoader({ campaignId }: { campaignId: string }) {
  const result = await getPopupReport(campaignId);

  return <PopupReportSection result={result} />;
}
