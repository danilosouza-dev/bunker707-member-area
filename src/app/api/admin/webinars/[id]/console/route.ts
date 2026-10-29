import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import { isUuid, noStore } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";
import { getConsoleSnapshot } from "@/server/webinars/console-queries";

// O retrato do console da sessao (docs/30 §2.4), que a tela busca a cada 5 s: chat com os pendentes, roteiro com
// o que ja entrou, enquetes com as contagens, perguntas por voto e os presentes agora. So a equipe com
// messaging.write (a mesma guarda das rotas de /api/admin/communications), sem cache: cada resposta e de agora.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiRole("messaging.write");

  if (auth.response) {
    return noStore(auth.response);
  }

  try {
    const { id } = await context.params;
    const sessionId = new URL(request.url).searchParams.get("sessao");

    if (!isUuid(id) || !isUuid(sessionId)) {
      return noStore(NextResponse.json({ error: "Sessão inválida." }, { status: 400 }));
    }

    const snapshot = await getConsoleSnapshot(id, sessionId, new Date());

    if (!snapshot) {
      return noStore(NextResponse.json({ error: "Essa sessão não existe mais." }, { status: 404 }));
    }

    return noStore(NextResponse.json({ data: snapshot }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Não foi possível carregar o console agora."));
  }
}
