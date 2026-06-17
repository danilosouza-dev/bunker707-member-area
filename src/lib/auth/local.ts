export const localAuthCookieName = "bunker707_local_session";
export const localAuthCookieValue = "local-dev-session";

export function isLocalhost(hostname?: string | null) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isLocalAuthEnabled(authConfigured: boolean, hostname?: string | null) {
  return !authConfigured && (process.env.NODE_ENV !== "production" || isLocalhost(hostname));
}
