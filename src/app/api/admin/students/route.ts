import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { replaceAdminStudents } from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import { AdminStudentsPayloadError, validateAdminStudentsPayload } from "@/server/students/validate";

const MAX_STUDENTS_PAYLOAD_BYTES = 20_000_000;

export async function PUT(request: Request) {
  const auth = await requireApiAdmin({ roles: ["owner", "admin"] });

  if (auth.response) {
    return auth.response;
  }

  let payload: unknown;

  try {
    payload = await readBoundedJson<unknown>(request, MAX_STUDENTS_PAYLOAD_BYTES);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }

  try {
    const students = validateAdminStudentsPayload(payload);
    const data = await replaceAdminStudents(students);

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof AdminStudentsPayloadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return jsonRouteError(error, "Nao foi possivel salvar os alunos.");
  }
}
