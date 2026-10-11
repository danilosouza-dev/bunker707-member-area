import { NextResponse } from "next/server";

import { generateAITextWithFallback, getAIProviderRuntimeCandidateForConnection } from "@/server/ai/provider-pool";
import { requireApiRole } from "@/server/auth/permissions";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ connectionId: string }> };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const revalidate = 0;

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireApiRole("settings.ai");

  if (auth.response || !auth.user) return auth.response;

  try {
    const { connectionId } = await context.params;
    const runtime = await getAIProviderRuntimeCandidateForConnection(connectionId);
    const result = await generateAITextWithFallback({
      actorId: auth.user.id,
      candidates: [{ ...runtime, maxOutputTokens: Math.min(runtime.maxOutputTokens, 32), temperature: 0 }],
      messages: [{ content: "Responda somente com a palavra OK.", role: "user" }],
      system: "Este e um teste tecnico de conectividade.",
      tested: true
    });
    const success = /^ok[.!]?$/i.test(result.generation.text.trim());

    if (!success) {
      return NextResponse.json({ error: "A conexao respondeu, mas o modelo nao concluiu o teste esperado." }, { status: 422 });
    }

    return NextResponse.json({ data: { message: "Conexao validada com sucesso." } });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel validar esta conexao de IA.", 422);
  }
}
