import { NextResponse, type NextRequest } from "next/server";
import { getPostAuthRedirectPath } from "@/server/auth/redirect";
import { getAuthenticatedUser } from "@/server/auth/session";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });
  }

  return NextResponse.json({
    redirectTo: await getPostAuthRedirectPath(user, request.nextUrl.searchParams.get("next"), {
      skipPasswordChangeCheck: request.nextUrl.searchParams.get("passwordChanged") === "true"
    })
  });
}
