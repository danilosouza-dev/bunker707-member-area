import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { listNotifications } from "@/server/communications/inbox";
import { decodeCursor } from "@/server/communications/notification-model";
import { noStore } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";

// Sino do aluno (docs/22 §2): pagina das notificacoes do proprio aluno, ultimos 90 dias, mais novas
// primeiro. ?filter=unread so as nao lidas; ?cursor= continua de onde a pagina anterior parou.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const params = new URL(request.url).searchParams;
  const filter = params.get("filter") ?? "all";
  const cursor = params.get("cursor")?.trim() || null;

  if (filter !== "all" && filter !== "unread") {
    return noStore(NextResponse.json({ error: "Filtro invalido." }, { status: 400 }));
  }

  if (cursor && !decodeCursor(cursor)) {
    return noStore(NextResponse.json({ error: "Pagina invalida." }, { status: 400 }));
  }

  try {
    const data = await listNotifications({ cursor, filter, userId: auth.user.id });

    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar as notificacoes."));
  }
}
