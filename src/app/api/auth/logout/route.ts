import { NextResponse } from "next/server";
import { localAuthCookieName } from "@/lib/auth/local";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(localAuthCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });

  return response;
}
