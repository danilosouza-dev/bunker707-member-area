import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { markClicked } from "@/server/communications/inbox";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";

// O aluno seguiu o link da notificacao ou o botao do aviso: vista, lida e clicada. Sem corpo, para o
// navegador poder mandar com sendBeacon na hora de sair da pagina.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return noStore(NextResponse.json({ error: "Notificacao invalida." }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const clicked = await markClicked(userId, id.toLowerCase());

    await recordCommunicationEvents([
      {
        entity_id: id.toLowerCase(),
        entity_type: "notification",
        event_type: "notification_clicked",
        metadata: { campaign_id: clicked.campaignId, kind: clicked.kind },
        user_id: userId
      }
    ]);

    return noStore(NextResponse.json({ data: { ok: true } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel registrar o clique."));
  }
}
