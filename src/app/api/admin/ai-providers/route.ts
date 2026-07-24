import { NextResponse } from "next/server";

import { requireApiAdmin } from "@/server/auth/guards";
import {
  listAIProviderConfigs,
  removeAIProviderConfig,
  saveAIProviderConfig
} from "@/server/ai/provider-config";
import { jsonRouteError } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET() {
  const auth = await requireApiAdmin();

  if (auth.response) return noStore(auth.response);

  try {
    return noStore(NextResponse.json({ data: await listAIProviderConfigs() }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar os provedores de IA."));
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const payload = await request.json() as Record<string, unknown>;
    const data = await saveAIProviderConfig({
      actorId: auth.user.id,
      contextMaxCharacters: payload.contextMaxCharacters,
      dailyQuestionLimit: payload.dailyQuestionLimit,
      defaultModel: payload.defaultModel,
      enabled: payload.enabled,
      isDefault: payload.isDefault,
      maxOutputTokens: payload.maxOutputTokens,
      monthlyQuestionLimit: payload.monthlyQuestionLimit,
      priority: payload.priority,
      provider: payload.provider,
      temperature: payload.temperature
    });
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel salvar o provedor de IA."));
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const payload = await request.json() as { provider?: unknown };
    const data = await removeAIProviderConfig(payload.provider, auth.user.id);
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel remover o provedor de IA."));
  }
}
