import { NextResponse } from "next/server";
import type { HomeSectionConfig } from "@/lib/platform-types";
import { requireApiAdmin } from "@/server/auth/guards";
import { publishHomeSections } from "@/server/db/platform-store";
import { jsonRouteError } from "@/server/http/route-errors";

export async function PUT(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as { sections?: HomeSectionConfig[] };

  if (!Array.isArray(payload.sections)) {
    return NextResponse.json({ error: "Secoes invalidas." }, { status: 400 });
  }

  try {
    const data = await publishHomeSections(payload.sections);
    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel publicar a Home.");
  }
}
