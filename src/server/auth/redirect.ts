import "server-only";

import { getSafeRedirectPath } from "@/lib/auth/redirect";
import type { AuthenticatedUser } from "@/server/auth/session";
import { getAdminRoleForUser } from "@/server/auth/session";

export function userMustChangePassword(userMetadata: unknown) {
  const metadata = userMetadata as { must_change_password?: unknown } | null;

  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      metadata.must_change_password === true
  );
}

type PostAuthRedirectOptions = {
  skipPasswordChangeCheck?: boolean;
};

export async function getPostAuthRedirectPath(
  user: AuthenticatedUser,
  requestedPath?: string | null,
  options: PostAuthRedirectOptions = {}
) {
  const safeRedirectPath = getSafeRedirectPath(requestedPath);

  if (!options.skipPasswordChangeCheck && userMustChangePassword(user.user_metadata)) {
    const passwordChangePath = new URL("http://localhost/alterar-senha");
    passwordChangePath.searchParams.set("next", safeRedirectPath);
    return `${passwordChangePath.pathname}${passwordChangePath.search}`;
  }

  if (safeRedirectPath === "/alterar-senha") {
    return safeRedirectPath;
  }

  const adminRole = await getAdminRoleForUser(user.id);

  return adminRole ? "/admin" : safeRedirectPath;
}
