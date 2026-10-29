import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { requireApiUser } from "@/server/auth/guards";
import { noStore } from "@/server/communications/route-support";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { ok, parseRoomBody, recordAfterReply, roomErrorResponse, tooMany } from "@/server/webinars/room-route";
import { readViewerPreferences, saveViewerPreferences } from "@/server/webinars/translation";
import { viewerPrefsBodySchema } from "@/server/webinars/translation-schemas";

// O idioma do chat das lives do aluno (docs/30 §1.6, fase 4f; Perfil › Privacidade e a sala). GET devolve
// { chatLanguage, enabled } (nulo = como foi escrito); PUT { chatLanguage: "pt" | "en" | "es" | null } grava a escolha
// (uma linha por aluno em webinar_viewer_prefs) e o historico webinar_chat_language_set { language }, e devolve o mesmo
// formato. Sessao obrigatoria (401); o PUT conta no teto de 30 escritas por minuto do aluno (429 com Retry-After),
// corpo em JSON de ate 4 KB (413/400) e idioma fora da lista: 400. Sem WEBINAR_TRANSLATION_ENABLED=on ou sem a
// 202610290009: { chatLanguage: null, enabled: false } e nada e gravado.

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function user() {
  const auth = await requireApiUser();
  if (auth.response || !auth.user) {
    return { response: noStore(auth.response!) };
  }
  return { userId: auth.user.id };
}

export async function GET() {
  const guarded = await user();
  if ("response" in guarded) {
    return guarded.response;
  }
  try {
    return ok(await readViewerPreferences(guarded.userId));
  } catch (error) {
    return roomErrorResponse(error, WEBINAR_COPY.traducao.erro);
  }
}

export async function PUT(request: Request) {
  const guarded = await user();
  if ("response" in guarded) {
    return guarded.response;
  }
  if (!takeStudentWrite(`webinar:${guarded.userId}`)) {
    return tooMany(STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS);
  }

  const body = await parseRoomBody(request, viewerPrefsBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const result = await saveViewerPreferences(guarded.userId, body.data.chatLanguage);
    await recordAfterReply(result.events);
    return ok(result.reply);
  } catch (error) {
    return roomErrorResponse(error, WEBINAR_COPY.traducao.erro);
  }
}

