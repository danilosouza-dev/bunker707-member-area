import { NextResponse } from "next/server";

import { generateAITextWithFallback } from "@/server/ai/provider-pool";
import {
  getAIProviderRuntimeConfig,
  recordAIProviderTest
} from "@/server/ai/provider-config";
import { isAIProvider } from "@/server/ai/types";
import { requireApiRole } from "@/server/auth/permissions";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ provider: string }> };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const revalidate = 0;

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireApiRole("settings.ai");

  if (auth.response || !auth.user) return auth.response;
  const { provider } = await context.params;

  if (!isAIProvider(provider)) {
    return NextResponse.json({ error: "Provedor de IA invalido." }, { status: 400 });
  }

  try {
    const runtime = await getAIProviderRuntimeConfig(provider, true);
    const result = await generateAITextWithFallback({
      actorId: auth.user.id,
      candidates: [{ ...runtime, maxOutputTokens: Math.min(runtime.maxOutputTokens, 32), temperature: 0 }],
      messages: [{ content: "Responda somente com a palavra OK.", role: "user" }],
      system: "Este e um teste tecnico de conectividade.",
      tested: true
    });
    const success = /^ok[.!]?$/i.test(result.generation.text.trim());
    await recordAIProviderTest(provider, auth.user.id, success);

    if (!success) {
      return NextResponse.json({ error: "O provedor respondeu, mas o modelo nao concluiu o teste esperado." }, { status: 422 });
    }

    return NextResponse.json({ data: { message: "Conexao validada com sucesso." } });
  } catch (error) {
    try {
      await recordAIProviderTest(provider, auth.user.id, false);
    } catch {
      // Preserve the provider failure as the main response.
    }

    return jsonRouteError(error, "Nao foi possivel validar este provedor de IA.", 422);
  }
}
