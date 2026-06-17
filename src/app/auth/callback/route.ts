import { NextResponse, type NextRequest } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getPostAuthRedirectPath } from "@/server/auth/redirect";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const provider = requestUrl.searchParams.get("provider") ?? "oauth";
  const redirectPath = getSafeRedirectPath(requestUrl.searchParams.get("next"));
  const redirectUrl = new URL(redirectPath, requestUrl.origin);

  if (!code) {
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", redirectPath);
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", redirectPath);
    return NextResponse.redirect(redirectUrl);
  }

  const { data } = await supabase.auth.getUser();

  if (data.user) {
    await supabase.from("student_events").insert({
      entity_type: "auth",
      event_type: "user_signed_in",
      metadata: {
        method: provider,
        source: "oauth_callback"
      },
      user_id: data.user.id
    });

    return NextResponse.redirect(new URL(await getPostAuthRedirectPath(data.user, redirectPath), requestUrl.origin));
  }

  return NextResponse.redirect(redirectUrl);
}
