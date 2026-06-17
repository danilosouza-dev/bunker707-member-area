import { NextResponse } from "next/server";
import {
  isLocalAuthEnabled,
  localAuthCookieName,
  localAuthCookieValue
} from "@/lib/auth/local";
import { hasSupabaseAuthConfig } from "@/server/auth/config";

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname;

  if (!isLocalAuthEnabled(hasSupabaseAuthConfig(), hostname)) {
    return NextResponse.json({ error: "Login local indisponivel." }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(localAuthCookieName, localAuthCookieValue, {
    httpOnly: true,
    maxAge: 60 * 60 * 8,
    path: "/",
    sameSite: "lax",
    secure: false
  });

  return response;
}
