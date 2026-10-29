import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { badRequest, guardRoomRequest, loadCachedRoomContext, ok, roomErrorResponse, tooMany, type RouteContext } from "@/server/webinars/room-route";
import { readRoomTranslations, takeTranslationRequest } from "@/server/webinars/translation";
import { TRANSLATIONS_OFF } from "@/server/webinars/translation-model";
import { translationsQuerySchema } from "@/server/webinars/translation-schemas";
import { webinarTranslationEnabled } from "@/server/webinars/v4-env";

// A traducao do chat e do roteiro na Sala (docs/30 §1.6, fase 4f). GET ?sessao=&lang=pt|en|es&ids=a,b,c (ate 100
// ids, as mensagens que a sala esta mostrando) devolve { translations: [{ id, body }], pending: [ids], enabled }: as
// traducoes ja guardadas (uma por texto e idioma, nunca feitas na hora para cada aluno), os ids que ainda vao ser
// traduzidos (o lote roda depois desta resposta, com teto de tempo; a sala pede de novo na consulta seguinte) e as
// demais passam como foram escritas (mesmo idioma, sem letras, ou fora do que o aluno pode ver nesta sessao, sem dizer
// se existem). Sessao obrigatoria (401); id do webinario (400); ?sessao=, ?lang= e ?ids= validos (400); fora do acesso
// ou sessao de outro webinario: 404 sem dizer se existe (o acesso conferido fica 10 min na memoria, como os sinais da
// sala); ate TRANSLATION_REQUESTS_PER_MINUTE pedidos por aluno por minuto (429 com Retry-After). Sem
// WEBINAR_TRANSLATION_ENABLED=on ou sem a 202610300006: { enabled: false } e o chat como foi escrito. Nunca grava em
// student_events (e uma leitura).

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }

  const parsed = translationsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message);
  }
  if (!webinarTranslationEnabled()) {
    return ok(TRANSLATIONS_OFF);
  }

  const take = takeTranslationRequest(guarded.userId);
  if (!take.ok) {
    return tooMany(WEBINAR_COPY.traducao.muitosPedidos, take.retryAfterSeconds);
  }

  const query = parsed.data;
  try {
    const room = await loadCachedRoomContext(guarded.userId, guarded.webinarId, query.sessao.toLowerCase());
    const data = await readRoomTranslations({ context: room, ids: query.ids, language: query.lang, userId: guarded.userId });
    return ok(data);
  } catch (error) {
    return roomErrorResponse(error, WEBINAR_COPY.traducao.erroLer);
  }
}
