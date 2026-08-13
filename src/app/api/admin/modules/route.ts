import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { deleteCourseModule, reorderCourseModules, upsertCourseModule } from "@/server/db/platform-store";
import { jsonRouteError } from "@/server/http/route-errors";
import type { ModuleOrderInput, ModuleWriteInput } from "@/server/db/platform-store";
import type { AdminReleaseRule } from "@/lib/platform-types";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as Partial<ModuleWriteInput> & {
    releaseFixedDate?: string;
    releaseDelayUnit?: "horas" | "dias";
    releaseDelayValue?: string;
    releaseMode?: AdminReleaseRule["mode"];
    releaseRequirement?: string;
  };

  if (!payload.title || !payload.ownerId) {
    return NextResponse.json({ error: "Nome do modulo e conteudo pai sao obrigatorios." }, { status: 400 });
  }

  try {
    const data = await upsertCourseModule({
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
    } as ModuleWriteInput);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar o modulo.");
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as { id?: string };

  if (!payload.id) {
    return NextResponse.json({ error: "Modulo invalido." }, { status: 400 });
  }

  try {
    const data = await deleteCourseModule(payload.id);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel excluir o modulo.");
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as Partial<ModuleOrderInput>;

  if (!Array.isArray(payload.orderedIds) || payload.orderedIds.length === 0) {
    return NextResponse.json({ error: "Ordem de modulos invalida." }, { status: 400 });
  }

  try {
    const data = await reorderCourseModules({
      orderedIds: payload.orderedIds,
      ownerId: payload.ownerId
    });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ordenar os modulos.");
  }
}
