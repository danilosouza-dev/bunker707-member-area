import { NextResponse } from "next/server";
import { AVATAR_MAX_DATA_URL_LENGTH } from "@/lib/avatar-image";
import { requireApiUser } from "@/server/auth/guards";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import { removeStudentAvatar, saveStudentAvatar } from "@/server/member-area/student-avatar";

// Foto do perfil do proprio aluno (Perfil > foto). PUT grava a foto recortada; DELETE volta para as iniciais.

export async function PUT(request: Request) {
  const auth = await requireApiUser();

  if (auth.response) {
    return auth.response;
  }

  if (!auth.user) {
    return NextResponse.json({ error: "Sessão obrigatória." }, { status: 401 });
  }

  let payload: { image?: unknown };

  try {
    payload = await readBoundedJson<typeof payload>(request, AVATAR_MAX_DATA_URL_LENGTH + 2_000);
  } catch (error) {
    return jsonRouteError(error, "Não foi possível ler a foto enviada.", 400);
  }

  try {
    const avatarUrl = await saveStudentAvatar(auth.user.id, payload.image);

    return NextResponse.json({ data: { avatarUrl } });
  } catch (error) {
    return jsonRouteError(error, "Não foi possível salvar a foto. Tente de novo em instantes.");
  }
}

export async function DELETE() {
  const auth = await requireApiUser();

  if (auth.response) {
    return auth.response;
  }

  if (!auth.user) {
    return NextResponse.json({ error: "Sessão obrigatória." }, { status: 401 });
  }

  try {
    await removeStudentAvatar(auth.user.id);

    return NextResponse.json({ data: { avatarUrl: null } });
  } catch (error) {
    return jsonRouteError(error, "Não foi possível remover a foto. Tente de novo em instantes.");
  }
}
