import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { countUnseen } from "@/server/communications/inbox";
import type { NotificationsSummary } from "@/server/communications/notification-model";
import { isPopupPageKey } from "@/server/communications/popup-display-model";
import { getEligiblePopup, getPopupsAnswer } from "@/server/communications/popups";
import { noStore } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";

// Resumo leve do sino, lido pela barra do topo depois de carregar a pagina (nunca no carregamento do
// servidor): o numero do sino e, com ?page=<chave da pagina> (v3b-1, docs/25 §4.4), os pop-ups: o mapa
// grosso das paginas onde algum pop-up no ar pode aparecer (do cache, sem ir ao banco) e, so na pagina
// coberta, o plano do aluno (sem conteudo). Chave invalida e ignorada (resposta sem `popups`); erro dos
// pop-ups vira `popups: null` e nunca derruba o numero. ?popup=1 (v1, abas abertas antes do deploy): o
// pop-up que o aluno deve ver agora no Inicio. Sessao pelas claims do JWT (v3a, docs/24); o numero e o
// plano em paralelo (communication_inbox_counts e uma leitura de campaign_deliveries).

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requireApiSessionUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const params = new URL(request.url).searchParams;
  const wantsPopup = params.get("popup") === "1";
  const pageParam = params.get("page");
  const page = isPopupPageKey(pageParam) ? pageParam : null;

  try {
    const [unseen, popup, popups] = await Promise.all([
      countUnseen(auth.user.id),
      wantsPopup ? getEligiblePopup(auth.user.id) : Promise.resolve(null),
      page ? getPopupsAnswer(auth.user.id, page) : Promise.resolve(null)
    ]);
    const data: NotificationsSummary = page ? { popup, popups, unseen } : { popup, unseen };

    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar o resumo das notificacoes."));
  }
}
