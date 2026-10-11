"use server";

// Publicar o destaque da home (Area de membros > Destaque). Grava SO a chave platform_settings.hero,
// com a versao lida pela tela (409 se mudou em outra tela, inclusive no admin antigo ou na Marca).
// As imagens chegam ja como URL: o recorte sobe antes por uploadMemberAreaImage (slot "hero").

import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateMemberArea } from "@/server/member-area/cache";
import { buildStoredHero, heroDraftFromStored, saveHomeHeroSchema, type HomeHeroDraft, type SaveHomeHeroInput } from "./home-hero-model";
import { readPlatformSetting, writePlatformSettingGuarded } from "./settings-store";

/** [storefront.write] Publica o destaque; devolve o rascunho como ficou gravado e a versao nova. */
export async function saveHomeHero(input: SaveHomeHeroInput): Promise<ActionResult<{ hero: HomeHeroDraft; updatedAt: string }>> {
  return runAdminAction("storefront.write", saveHomeHeroSchema, input, async ({ input: data }) => {
    // Le o atual so para preservar chaves que o editor nao conhece (ex.: `purpose`). Se alguem gravou
    // depois da versao da tela, a gravacao abaixo falha com 409 e nada muda.
    const current = await readPlatformSetting("hero");
    const stored = buildStoredHero(current.value, data.hero);
    const { updatedAt } = await writePlatformSettingGuarded("hero", stored, data.expectedUpdatedAt);

    invalidateMemberArea("home", { from: "action" });

    return { hero: heroDraftFromStored(stored), updatedAt };
  });
}
