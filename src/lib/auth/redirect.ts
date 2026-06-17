export function getSafeRedirectPath(value?: string | null) {
  if (!value) {
    return "/";
  }

  try {
    const decodedValue = decodeURIComponent(value);

    if (!decodedValue.startsWith("/") || decodedValue.startsWith("//")) {
      return "/";
    }

    if (decodedValue.startsWith("/login") || decodedValue.startsWith("/auth/callback")) {
      return "/";
    }

    return decodedValue;
  } catch {
    return "/";
  }
}
