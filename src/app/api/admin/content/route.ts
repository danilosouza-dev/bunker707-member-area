import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import { invalidateCatalog } from "@/server/catalog/cache";
import { deleteContentItem, reorderContentItems, upsertContentItem } from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import type { ContentOrderInput, ContentWriteInput } from "@/server/db/platform-store";

export async function POST(request: Request) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<Partial<ContentWriteInput>>(request, 10_000_000);

    if (!payload.title || !payload.kind) {
      return NextResponse.json({ error: "Titulo e tipo sao obrigatorios." }, { status: 400 });
    }

    const data = await upsertContentItem(payload as ContentWriteInput);
    invalidateCatalog({ from: "route" });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar o conteudo.");
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiRole("catalog.delete");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<{ id?: string }>(request, 10_000_000);

    if (!payload.id) {
      return NextResponse.json({ error: "Conteudo invalido." }, { status: 400 });
    }

    const data = await deleteContentItem(payload.id);
    invalidateCatalog({ from: "route" });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel excluir o conteudo.");
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<Partial<ContentOrderInput>>(request, 10_000_000);

    if (!Array.isArray(payload.orderedIds) || payload.orderedIds.length === 0) {
      return NextResponse.json({ error: "Ordem de conteudos invalida." }, { status: 400 });
    }

    const data = await reorderContentItems({ orderedIds: payload.orderedIds });
    invalidateCatalog({ from: "route" });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ordenar os conteudos.");
  }
}
