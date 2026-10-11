import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import { invalidateCatalog } from "@/server/catalog/cache";
import { updatePlatformAppearance } from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import type { PlatformAppearanceInput } from "@/server/db/platform-store";

function isValidHeroInput(hero: PlatformAppearanceInput["hero"]) {
  return (
    typeof hero === "object" &&
    hero !== null &&
    typeof hero.enabled === "boolean" &&
    (hero.image === undefined || typeof hero.image === "string")
  );
}

function isValidLogoInput(logo: PlatformAppearanceInput["logo"]) {
  return (
    typeof logo === "object" &&
    logo !== null &&
    (logo.image === null || typeof logo.image === "string")
  );
}

export async function PUT(request: Request) {
  const auth = await requireApiRole("storefront.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    // Capa + logo podem ir juntas como data URLs base64 (ate 8 MB cada antes do encode).
    const payload = await readBoundedJson<Partial<PlatformAppearanceInput>>(request, 24_000_000);

    if (payload.hero === undefined && payload.logo === undefined) {
      return NextResponse.json({ error: "Informe a capa da home ou a logo." }, { status: 400 });
    }

    if (payload.hero !== undefined && !isValidHeroInput(payload.hero)) {
      return NextResponse.json({ error: "Configuracao de capa invalida." }, { status: 400 });
    }

    if (payload.logo !== undefined && !isValidLogoInput(payload.logo)) {
      return NextResponse.json({ error: "Configuracao de logo invalida." }, { status: 400 });
    }

    const data = await updatePlatformAppearance({
      hero: payload.hero,
      logo: payload.logo
    });
    invalidateCatalog({ from: "route" });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar a aparencia da plataforma.");
  }
}
