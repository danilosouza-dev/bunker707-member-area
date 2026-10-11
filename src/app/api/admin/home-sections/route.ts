import { NextResponse } from "next/server";
import type { HomeSectionConfig } from "@/lib/platform-types";
import { requireApiRole } from "@/server/auth/permissions";
import { invalidateCatalog } from "@/server/catalog/cache";
import { publishHomeSections } from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import { settingVersionSchema } from "@/server/member-area/schemas";

// Publicar a vitrine (lista inteira de fileiras). A Vitrine nova e a do admin antigo mandam
// `expectedUpdatedAt` (a versao da chave homeSections que leram; null = nunca publicada): a gravacao e
// condicional no proprio UPDATE (publishHomeSections -> writePlatformSettingGuarded). Se a tela Modulos,
// a outra Vitrine ou outra pessoa gravou depois da leitura, responde 409 sem gravar, em vez de apagar a
// mudanca. A resposta traz a versao exata desta gravacao (`sectionsUpdatedAt`), nunca uma releitura:
// uma gravacao de outra tela no meio-tempo continua valendo como "mais nova" no proximo Publicar.
// Sem o campo (chamada antiga) grava sem conferir, como sempre.
export async function PUT(request: Request) {
  const auth = await requireApiRole("storefront.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<{ expectedUpdatedAt?: unknown; sections?: HomeSectionConfig[] }>(request, 10_000_000);

    if (!Array.isArray(payload.sections)) {
      return NextResponse.json({ error: "Secoes invalidas." }, { status: 400 });
    }

    let expectedUpdatedAt: string | null | undefined;

    if (payload.expectedUpdatedAt !== undefined) {
      const version = settingVersionSchema.safeParse(payload.expectedUpdatedAt);

      if (!version.success) {
        return NextResponse.json({ error: "Recarregue a página e tente de novo." }, { status: 400 });
      }

      expectedUpdatedAt = version.data;
    }

    const data = await publishHomeSections(payload.sections, { expectedUpdatedAt });
    invalidateCatalog({ from: "route" });
    return NextResponse.json({ data, sectionsUpdatedAt: data.homeSectionsUpdatedAt ?? null });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel publicar a Home.");
  }
}
