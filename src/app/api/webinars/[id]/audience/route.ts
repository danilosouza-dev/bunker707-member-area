import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { loadAudienceTiles } from "@/server/webinars/audience-tiles-store";
import { webinarsDb } from "@/server/webinars/db";
import { guardRoomRequest, loadCachedRoomContext, ok, roomErrorResponse, sessionIdOf, type RouteContext } from "@/server/webinars/room-route";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import { licenseRouteRefusal } from "@/server/licensing/guards";

// Os participantes simulados nas miniaturas da Live ao vivo (docs/30 D117; pedido do produtor de 13/11/2026): GET
// ?sessao= devolve { data: { enabled, people } }, a lista ordenada de quem pode aparecer como miniatura simulada (as
// pessoas que comentam com foto, as sem foto e nomes genericos, ate 300), cada uma com o id no nosso formato, o nome e
// a foto do nosso bucket ou nula. Quantas aparecem em cada instante a sala decide pelo numero de participantes
// simulados daquele segundo (a janela de GET .../simulation), e manda a lista ao iframe: quem desenha e o proprio
// motor, sem conexao nenhuma por simulado. A sala pede ao entrar e quando a decisao da Simulacao muda (a chave que a
// consulta de 5 s do chat ja traz). Nunca a semente nem as regras. Sessao gravada, replay, cancelada, encerrada, sem a
// decisao registrada (§8.6), sem participantes simulados ou banco sem as colunas: { enabled: false, people: [] }.
// Sessao obrigatoria (401), id do webinario (400), ?sessao= invalida (400), fora do acesso ou sessao de outro
// webinario (404), sem a vaga obrigatoria (403). Leitura: o acesso conferido fica guardado (loadCachedRoomContext),
// fora do teto de escritas do aluno, e a lista de cada sessao fica 30 s na memoria do processo. Nada vai para
// student_events (§6.6): numero e pessoa simulados nunca entram numa metrica real.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: RouteContext) {
  const licenseRefusal = await licenseRouteRefusal({ feature: WEBINARS_FEATURE });
  if (licenseRefusal) return licenseRefusal;

  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }
  const session = sessionIdOf(request);
  if ("response" in session) {
    return session.response;
  }

  try {
    const room = await loadCachedRoomContext(guarded.userId, guarded.webinarId, session.sessionId);
    return ok(await loadAudienceTiles(webinarsDb(), { session: room.session, webinarId: guarded.webinarId }));
  } catch (error) {
    return roomErrorResponse(error, WEBINAR_COPY.simulacao.card.erroCarregar);
  }
}
