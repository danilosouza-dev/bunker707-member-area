import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { deleteContentItem, reorderContentItems, upsertContentItem } from "@/server/db/platform-store";
import { jsonRouteError } from "@/server/http/route-errors";
import type { ContentOrderInput, ContentWriteInput } from "@/server/db/platform-store";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as Partial<ContentWriteInput>;

  if (!payload.title || !payload.kind) {
    return NextResponse.json({ error: "Titulo e tipo sao obrigatorios." }, { status: 400 });
  }

  try {
    const data = await upsertContentItem(payload as ContentWriteInput);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar o conteudo.");
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as { id?: string };

  if (!payload.id) {
    return NextResponse.json({ error: "Conteudo invalido." }, { status: 400 });
  }

  try {
    const data = await deleteContentItem(payload.id);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel excluir o conteudo.");
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as Partial<ContentOrderInput>;

  if (!Array.isArray(payload.orderedIds) || payload.orderedIds.length === 0) {
    return NextResponse.json({ error: "Ordem de conteudos invalida." }, { status: 400 });
  }

  try {
    const data = await reorderContentItems({ orderedIds: payload.orderedIds });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ordenar os conteudos.");
  }
}
