import { NextResponse } from "next/server";

const legacyLocalAuthCookieName = "bunker707_local_session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(legacyLocalAuthCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });

  return response;
}
