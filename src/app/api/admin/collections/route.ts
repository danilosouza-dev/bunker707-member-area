import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import {
  updateAdminDashboardCollections,
  type AdminDashboardCollectionsInput
} from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

export async function POST(request: Request) {
  const auth = await requireApiRole("settings.ai");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<AdminDashboardCollectionsInput>(request, 64_000);
    const data = await updateAdminDashboardCollections(payload);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar a configuracao.");
  }
}
