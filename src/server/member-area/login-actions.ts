"use server";

// Publicar a pagina de entrar (/login). As imagens chegam ja como URL (uploadMemberAreaImage envia ao
// Storage logo depois do recorte); aqui so grava a chave platform_settings.loginPage, com a versao que
// a tela leu, e invalida o cache do /login. Nao ha acao de "restaurar": o botao "Restaurar padrao" poe
// o padrao no rascunho e o produtor publica depois de ver a previa.

import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateMemberArea } from "@/server/member-area/cache";
import { saveLoginPageSchema, type LoginPageSettings, type SaveLoginPageInput } from "./login-model";
import { writePlatformSettingGuarded } from "./settings-store";

/** [storefront.write] Grava platform_settings.loginPage se ninguem mudou desde expectedUpdatedAt (senao, 409). */
export async function saveLoginPage(input: SaveLoginPageInput): Promise<ActionResult<{ settings: LoginPageSettings; updatedAt: string }>> {
  return runAdminAction("storefront.write", saveLoginPageSchema, input, async ({ input: data }) => {
    const { updatedAt } = await writePlatformSettingGuarded("loginPage", data.settings, data.expectedUpdatedAt);

    invalidateMemberArea("login", { from: "action" });

    return { settings: data.settings, updatedAt };
  });
}
