import type { ContentKind, SavedItemTargetType } from "@/lib/platform-types";

export const savedItemCollectionLabel = "favoritos";

export function getSavedTargetTypeForContentKind(kind: ContentKind): SavedItemTargetType {
  if (kind === "Formacao") {
    return "formation";
  }

  if (kind === "Mentoria") {
    return "mentorship";
  }

  if (kind === "Webinario") {
    return "webinar";
  }

  if (kind === "Produto") {
    return "product";
  }

  if (kind === "Bootcamp") {
    return "bootcamp";
  }

  if (kind === "Aula") {
    return "lesson";
  }

  if (kind === "Material") {
    return "material";
  }

  return "standalone_course";
}

export function getSavedItemKey(targetType: SavedItemTargetType, targetId: string) {
  return `${targetType}:${targetId}`;
}
