import { NextResponse } from "next/server";

import { jsonRouteError } from "@/server/http/route-errors";
import { connectTvReceiver } from "@/server/video/tv-sessions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Authorization, Cookie");
  return response;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { code?: unknown };
    const code = typeof payload.code === "string"
      ? payload.code.toUpperCase().replace(/[^A-Z0-9]/g, "")
      : "";

    if (!/^[A-Z0-9]{6}$/.test(code)) {
      return noStore(NextResponse.json({ error: "Digite o codigo de seis caracteres." }, { status: 400 }));
    }

    const data = await connectTvReceiver(code);
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel conectar esta TV."));
  }
}
