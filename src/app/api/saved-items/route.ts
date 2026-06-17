import { NextResponse } from "next/server";
import { savedItemCollectionLabel } from "@/lib/saved-items";
import { requireApiUser } from "@/server/auth/guards";
import { setSavedItem } from "@/server/db/platform-store";
import type { SavedItemTargetType } from "@/lib/platform-types";

const savedTargetTypes = new Set<SavedItemTargetType>([
  "formation",
  "standalone_course",
  "mentorship",
  "webinar",
  "product",
  "bootcamp",
  "module",
  "lesson",
  "material"
]);

export async function PUT(request: Request) {
  const auth = await requireApiUser();

  if (auth.response) {
    return auth.response;
  }

  if (!auth.user) {
    return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });
  }

  const payload = await request.json() as {
    collectionLabel?: unknown;
    saved?: boolean;
    targetId?: string;
    targetType?: string;
  };

  const targetType = payload.targetType as SavedItemTargetType | undefined;
  const targetId = payload.targetId?.trim();
  const collectionLabel = typeof payload.collectionLabel === "string"
    ? payload.collectionLabel
    : savedItemCollectionLabel;

  if (!targetType || !savedTargetTypes.has(targetType) || !targetId || typeof payload.saved !== "boolean") {
    return NextResponse.json({ error: "Favorito invalido." }, { status: 400 });
  }

  try {
    const data = await setSavedItem({
      collectionLabel,
      saved: payload.saved,
      targetId,
      targetType,
      userId: auth.user.id
    });

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel atualizar o favorito.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
