export const ACCESS_PREVIEW_PARAM = "accessPreview";
export const ACCESS_PREVIEW_COOKIE = "bunker707_access_preview";

export type AccessPreviewMode = "producer" | "student_with_access" | "student_without_access";

const accessPreviewModes = ["producer", "student_with_access", "student_without_access"] satisfies AccessPreviewMode[];

export function normalizeAccessPreviewMode(value?: string | string[] | null): AccessPreviewMode | undefined {
  const mode = Array.isArray(value) ? value[0] : value;

  if (!mode) {
    return undefined;
  }

  return accessPreviewModes.includes(mode as AccessPreviewMode) ? (mode as AccessPreviewMode) : undefined;
}

export function withAccessPreviewParam(href: string, mode?: AccessPreviewMode) {
  if (!mode) {
    return href;
  }

  const [pathWithQuery, hash] = href.split("#");
  const separator = pathWithQuery.includes("?") ? "&" : "?";
  const nextHref = `${pathWithQuery}${separator}${ACCESS_PREVIEW_PARAM}=${encodeURIComponent(mode)}`;

  return hash ? `${nextHref}#${hash}` : nextHref;
}
