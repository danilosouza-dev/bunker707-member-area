import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { replaceAdminStudents } from "@/server/db/platform-store";
import type { AdminStudent } from "@/lib/platform-types";

export async function PUT(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as { students?: AdminStudent[] };

  if (!Array.isArray(payload.students)) {
    return NextResponse.json({ error: "Lista de alunos invalida." }, { status: 400 });
  }

  const data = await replaceAdminStudents(payload.students);

  return NextResponse.json({ data });
}
