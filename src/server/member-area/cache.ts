import "server-only";

import { revalidateTag, updateTag } from "next/cache";
import { invalidateCatalog } from "@/server/catalog/cache";
import {
  planMemberAreaInvalidation,
  type MemberAreaCacheTarget,
  type MemberAreaInvalidationSource
} from "./cache-tags";

export { LOGIN_PAGE_CACHE_KEY, LOGIN_PAGE_CACHE_TAGS, LOGIN_PAGE_REVALIDATE_SECONDS, MEMBER_AREA_LOGIN_TAG } from "./cache-tags";

/**
 * Unica forma de invalidar o que a Area de membros grava. Chame depois de gravar, nunca dentro de uma
 * funcao em cache.
 * - invalidateMemberArea("login", { from: "action" }) -> updateTag("member-area-login");
 * - invalidateMemberArea("home", { from: "action" })  -> invalidateCatalog({ from: "action" }).
 * Em rota REST, job ou webhook use { from: "route" }.
 */
export function invalidateMemberArea(target: MemberAreaCacheTarget, { from }: { from: MemberAreaInvalidationSource }) {
  const plan = planMemberAreaInvalidation(target, from);

  if (plan.api === "catalog") {
    invalidateCatalog({ from: plan.from });
    return;
  }

  if (plan.api === "updateTag") {
    updateTag(plan.tag);
    return;
  }

  revalidateTag(plan.tag, plan.profile);
}
