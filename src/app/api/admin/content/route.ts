import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { deleteContentItem, upsertContentItem } from "@/server/db/platform-store";
import type { ContentWriteInput } from "@/server/db/platform-store";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as Partial<ContentWriteInput>;

  if (!payload.title || !payload.kind) {
    return NextResponse.json({ error: "Titulo e tipo sao obrigatorios." }, { status: 400 });
  }

  const data = await upsertContentItem(payload as ContentWriteInput);

  return NextResponse.json({ data });
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

  const data = await deleteContentItem(payload.id);

  return NextResponse.json({ data });
}
