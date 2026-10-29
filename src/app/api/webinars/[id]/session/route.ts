import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { isUuid, noStore } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";
import { getStudentSessionPayload } from "@/server/webinars/student-queries";

// A sessao do Webinario para o aluno (docs/30 §5.1, o subconjunto da fase 1): GET ?sessao= devolve { serverTime,
// session: { id, kind, status, scheduledAt, startedAt, endedAt, lateJoinMinutes, phase }, webinar: { id, slug, title,
// kind, durationMinutes }, me: { registered, registeredAt, calendarUrl }, registeredCount } (o total so quando a equipe
// mostra; senao null), mais o que a Sala precisa (fase 2: relogio, entrada, video, fixada, enquetes, presentes, aceite;
// fase 3, so na live: o bloco `live` sem o nome da sala nem o token, `me.ban` e a entrada recusada para removido e
// banido). Sem ?sessao=, a sessao da Live ao vivo. Sessao obrigatoria (requireApiUser, 401); fora do acesso, nao
// publicado ou inexistente: 404 sem dizer se existe (docs/30 §8.2); sessao de outro webinario: 404.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return noStore(NextResponse.json({ error: "Webinário inválido." }, { status: 400 }));
  }

  const sessao = new URL(request.url).searchParams.get("sessao");

  if (sessao !== null && !isUuid(sessao)) {
    return noStore(NextResponse.json({ error: "Sessão inválida." }, { status: 400 }));
  }

  try {
    const data = await getStudentSessionPayload(auth.user.id, id.toLowerCase(), sessao ? sessao.toLowerCase() : null);

    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Não foi possível ler a sessão."));
  }
}
