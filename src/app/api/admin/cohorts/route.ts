import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { addCohort } from "@/server/db/platform-store";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as { name?: string };

  if (!payload.name) {
    return NextResponse.json({ error: "Nome da turma e obrigatorio." }, { status: 400 });
  }

  const data = await addCohort(payload.name);

  return NextResponse.json({ data });
}
