import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { upsertLesson } from "@/server/db/platform-store";
import type { LessonWriteInput } from "@/server/db/platform-store";
import type { AdminReleaseRule } from "@/lib/platform-types";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as Partial<LessonWriteInput> & {
    releaseFixedDate?: string;
    releaseDelayUnit?: "horas" | "dias";
    releaseDelayValue?: string;
    releaseMode?: AdminReleaseRule["mode"];
    releaseRequirement?: string;
  };

  if (!payload.moduleId || !payload.title) {
    return NextResponse.json({ error: "Modulo e titulo da aula sao obrigatorios." }, { status: 400 });
  }

  const data = await upsertLesson({
    ...payload,
    releaseRule: payload.releaseMode
      ? {
          delayUnit: payload.releaseDelayUnit,
          delayValue: payload.releaseDelayValue,
          fixedDate: payload.releaseFixedDate,
          mode: payload.releaseMode,
          requirement: payload.releaseRequirement
        }
      : payload.releaseRule
  } as LessonWriteInput);

  return NextResponse.json({ data });
}
