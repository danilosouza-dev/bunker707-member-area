import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import { addCohort } from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

export async function POST(request: Request) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<{ name?: string }>(request, 64_000);

    if (!payload.name) {
      return NextResponse.json({ error: "Nome da turma e obrigatorio." }, { status: 400 });
    }

    const data = await addCohort(payload.name);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar a turma.");
  }
}
