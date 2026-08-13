import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import {
  deleteProductCombo,
  upsertProductCombo,
  type ProductComboWriteInput
} from "@/server/db/platform-store";
import { jsonRouteError } from "@/server/http/route-errors";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as Partial<ProductComboWriteInput>;

  if (!payload.name || !Array.isArray(payload.productIds)) {
    return NextResponse.json({ error: "Nome e produtos do combo sao obrigatorios." }, { status: 400 });
  }

  try {
    const data = await upsertProductCombo(payload as ProductComboWriteInput);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar o combo.");
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as { id?: string };

  if (!payload.id) {
    return NextResponse.json({ error: "Combo invalido." }, { status: 400 });
  }

  try {
    const data = await deleteProductCombo(payload.id);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel excluir o combo.");
  }
}
