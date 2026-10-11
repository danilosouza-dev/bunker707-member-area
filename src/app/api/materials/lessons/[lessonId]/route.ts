import { NextResponse } from "next/server";

import { redactSecrets } from "@/lib/env-value";
import type { LessonMaterialLearnerState } from "@/lib/lesson-materials";
import { requireLessonAccess } from "@/server/access/lesson-access";
import { requireApiUser } from "@/server/auth/guards";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { jsonRouteError } from "@/server/http/route-errors";
import { listStudentLessonMaterials } from "@/server/member-area/lesson-materials";

// Aba Materiais da aula: materiais publicados da aula que o aluno pode abrir.
// Ordem obrigatoria: sessao (requireApiUser) -> acesso e liberacao da aula (requireLessonAccess: 403
// sem compra ou aula ainda nao liberada, 404 aula de outro conteudo) -> progresso do proprio aluno ->
// materiais. Material bloqueado pela regra dele (avaliar a aula, assistir X%) nunca leva o endereco.

type RouteContext = { params: Promise<{ lessonId: string }> };

type LessonProgressRow = {
  completed_lesson_ids: unknown;
  lesson_reactions: unknown;
  lesson_watch_states: unknown;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const lessonReactions = new Set(["not-for-me", "liked", "loved"]);

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

function readPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** O que o aluno ja fez nesta aula (avaliou? quanto assistiu?), a partir da linha dele em lesson_progress. */
function toLearnerState(row: LessonProgressRow | null, lessonId: string): LessonMaterialLearnerState {
  const reaction = readRecord(row?.lesson_reactions)[lessonId];
  const watchState = readRecord(readRecord(row?.lesson_watch_states)[lessonId]);
  const completed = Array.isArray(row?.completed_lesson_ids) && row.completed_lesson_ids.includes(lessonId);

  return {
    maxProgressPercent: completed || watchState.status === "completed"
      ? 100
      : Math.max(readPercent(watchState.maxProgressPercent), readPercent(watchState.progressPercent)),
    rated: typeof reaction === "string" && lessonReactions.has(reaction)
  };
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { lessonId: rawLessonId } = await context.params;
  const lessonId = rawLessonId?.trim() ?? "";
  const contentId = new URL(request.url).searchParams.get("contentId")?.trim() ?? "";

  if (!contentId || !lessonId) {
    return noStore(NextResponse.json({ error: "Aula e conteúdo são obrigatórios." }, { status: 400 }));
  }

  try {
    await requireLessonAccess({ contentId, lessonId, userId: auth.user.id });

    const progressResult = await getSupabaseAdminClient()
      .from("lesson_progress")
      .select("completed_lesson_ids,lesson_reactions,lesson_watch_states")
      .eq("user_id", auth.user.id)
      .eq("content_id", contentId)
      .maybeSingle();

    if (progressResult.error) {
      throw new Error(`Nao foi possivel ler o progresso do aluno: ${redactSecrets(progressResult.error.message)}`);
    }

    const learner = toLearnerState(progressResult.data as LessonProgressRow | null, lessonId);
    const result = await listStudentLessonMaterials({
      learnerByLessonId: new Map([[lessonId, learner]]),
      lessonIds: [lessonId]
    });

    return noStore(NextResponse.json({ data: result }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Não foi possível carregar os materiais da aula."));
  }
}
