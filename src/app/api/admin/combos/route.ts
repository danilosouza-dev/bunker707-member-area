import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import { invalidateCatalog } from "@/server/catalog/cache";
import {
  deleteProductCombo,
  upsertProductCombo,
  type ProductComboWriteInput
} from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

export async function POST(request: Request) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<Partial<ProductComboWriteInput>>(request, 64_000);

    if (!payload.name || !Array.isArray(payload.productIds)) {
      return NextResponse.json({ error: "Nome e produtos do combo sao obrigatorios." }, { status: 400 });
    }

    const data = await upsertProductCombo(payload as ProductComboWriteInput);
    invalidateCatalog({ from: "route" });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar o combo.");
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<{ id?: string }>(request, 64_000);

    if (!payload.id) {
      return NextResponse.json({ error: "Combo invalido." }, { status: 400 });
    }

    const data = await deleteProductCombo(payload.id);
    invalidateCatalog({ from: "route" });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel excluir o combo.");
  }
}
