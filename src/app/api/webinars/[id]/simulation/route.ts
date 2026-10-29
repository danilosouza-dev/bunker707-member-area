import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { isMissingWebinarSchema, webinarsDb } from "@/server/webinars/db";
import type { SessionSimulation } from "@/server/webinars/model";
import { badRequest, guardRoomRequest, loadCachedRoomContext, ok, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { emptySimulationFeed, simulationDecisionRecorded, simulationEndOffsetMs, simulationFeed } from "@/server/webinars/simulation-model";
import { simulationFeedQuerySchema } from "@/server/webinars/simulation-schemas";
import { fetchSessionSimulation } from "@/server/webinars/simulation-store";

// A Simulacao da sala da Live gravada (docs/30 §1.6, §4.3, §6.6 e §8.6; D6, D10): GET ?sessao=&from=&to= (ms do relogio
// do video, no maximo 120 s) devolve { data: SimulationFeed }: a parte simulada do contador a cada 15 s, as entradas e
// saidas ("Ana M. entrou", nomes genericos) e os avisos de venda da janela, calculados no servidor com a semente da
// sessao (simulation-model.ts): todos veem o mesmo numero no mesmo segundo. Nunca a semente nem as regras. A sala pede
// uma janela a cada 90 s, como o chat. A live, o replay, a cancelada, a sessao sem regra e o banco sem a 202610300003
// devolvem { enabled: false } com listas vazias; a sessao sem a decisao registrada (§8.6, D10: a frase marcada e a hora)
// tambem, mesmo com regra gravada. Nada vai para student_events (§6.6). Sessao obrigatoria (401), id do
// webinario (400), consulta invalida ou janela maior que 120 s (400), fora do acesso ou sessao de outro webinario (404),
// sem a vaga obrigatoria (403). Leitura: o acesso conferido fica guardado (loadCachedRoomContext), fora do teto de
// escritas do aluno.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }

  const parsed = simulationFeedQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message);
  }
  const { from, sessao, to } = parsed.data;

  try {
    const room = await loadCachedRoomContext(guarded.userId, guarded.webinarId, sessao.toLowerCase());
    const { session } = room;
    if (session.kind !== "simulated" || session.status === "cancelled" || !simulationDecisionRecorded(session)) {
      return ok(emptySimulationFeed(from, to));
    }

    let simulation: SessionSimulation | null;
    try {
      simulation = await fetchSessionSimulation(webinarsDb(), session.id);
    } catch (error) {
      if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
        return ok(emptySimulationFeed(from, to));
      }
      throw error;
    }

    return ok(
      simulationFeed({
        // A forma do contador e a do video inteiro antes e depois do Encerrar; o fim real so corta.
        durationMs: room.durationMs,
        endMs: simulationEndOffsetMs(session, room.durationMs),
        fromMs: from,
        kind: session.kind,
        simulation,
        status: session.status,
        toMs: to
      })
    );
  } catch (error) {
    return roomErrorResponse(error, WEBINAR_COPY.simulacao.card.erroCarregar);
  }
}
