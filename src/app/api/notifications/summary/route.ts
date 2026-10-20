import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { countUnseen } from "@/server/communications/inbox";
import type { NotificationsSummary } from "@/server/communications/notification-model";
import { getEligiblePopup } from "@/server/communications/popups";
import { noStore } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";

// Resumo leve do sino, lido pela barra do topo depois de carregar a pagina (nunca no carregamento do
// servidor): o numero do sino e, com ?popup=1 (so na home), o pop-up que o aluno deve ver agora.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const wantsPopup = new URL(request.url).searchParams.get("popup") === "1";

  try {
    const [unseen, popup] = await Promise.all([
      countUnseen(auth.user.id),
      wantsPopup ? getEligiblePopup(auth.user.id) : Promise.resolve(null)
    ]);
    const data: NotificationsSummary = { popup, unseen };

    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar o resumo das notificacoes."));
  }
}
