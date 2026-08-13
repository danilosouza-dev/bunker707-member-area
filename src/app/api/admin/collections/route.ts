import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import {
  updateAdminDashboardCollections,
  type AdminDashboardCollectionsInput
} from "@/server/db/platform-store";
import { jsonRouteError } from "@/server/http/route-errors";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as AdminDashboardCollectionsInput;
  try {
    const data = await updateAdminDashboardCollections(payload);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar a configuracao.");
  }
}
