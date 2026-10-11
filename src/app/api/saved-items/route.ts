import { NextResponse } from "next/server";
import { savedItemCollectionLabel } from "@/lib/saved-items";
import { requireApiUser } from "@/server/auth/guards";
import { setSavedItem } from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
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

  let payload: {
    collectionLabel?: unknown;
    saved?: boolean;
    targetId?: string;
    targetType?: string;
  };

  try {
    payload = await readBoundedJson<typeof payload>(request, 16_000);
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ler o favorito enviado.", 400);
  }

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
    return jsonRouteError(error, "Nao foi possivel atualizar o favorito.");
  }
}
