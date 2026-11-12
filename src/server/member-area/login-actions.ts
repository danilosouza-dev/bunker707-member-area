"use server";

// Publicar a pagina de entrar (/login). As imagens chegam ja como URL (uploadMemberAreaImage envia ao
// Storage logo depois do recorte); aqui so grava a chave platform_settings.loginPage, com a versao que
// a tela leu, e invalida o cache do /login. Nao ha acao de "restaurar": o botao "Restaurar padrao" poe
// o padrao no rascunho e o produtor publica depois de ver a previa.

import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateMemberArea } from "@/server/member-area/cache";
import { MemberAreaConflictError } from "./errors";
import {
  loginPageSettingsSchema,
  parseStoredLoginPage,
  saveLoginContactSchema,
  saveLoginPageSchema,
  type LoginPageSettings,
  type SaveLoginContactInput,
  type SaveLoginPageInput
} from "./login-model";
import { isSameSettingVersion, readPlatformSetting, writePlatformSettingGuarded } from "./settings-store";

/**
 * [storefront.write] Grava platform_settings.loginPage se ninguem mudou desde expectedUpdatedAt (senao, 409). E a
 * aparencia da pagina de entrar: conteudo, barrado no Admin limitado (docs/32 §2.2). O contato da escola, que a lei pede
 * em todo degrau, sai pelo saveLoginContact.
 */
export async function saveLoginPage(input: SaveLoginPageInput): Promise<ActionResult<{ settings: LoginPageSettings; updatedAt: string }>> {
  return runAdminAction("storefront.write", "conteudo", saveLoginPageSchema, input, async ({ input: data }) => {
    const { updatedAt } = await writePlatformSettingGuarded("loginPage", data.settings, data.expectedUpdatedAt);

    invalidateMemberArea("login", { from: "action" });

    return { settings: data.settings, updatedAt };
  });
}

/**
 * [storefront.write] So o contato da escola na pagina de entrar (a linha de ajuda e o link dela), sobre a versao gravada:
 * o resto da pagina fica como esta. Dever legal (docs/32 §2.2: os dados de contato da escola), passa em todo degrau. Com a
 * versao velha, 409, como o saveLoginPage.
 */
export async function saveLoginContact(input: SaveLoginContactInput): Promise<ActionResult<{ settings: LoginPageSettings; updatedAt: string }>> {
  return runAdminAction("storefront.write", "dever_legal", saveLoginContactSchema, input, async ({ input: data }) => {
    const current = await readPlatformSetting("loginPage");

    if (!isSameSettingVersion(current, data.expectedUpdatedAt)) {
      throw new MemberAreaConflictError();
    }

    const settings = loginPageSettingsSchema.parse({ ...parseStoredLoginPage(current.value).settings, ...data.contact });
    const { updatedAt } = await writePlatformSettingGuarded("loginPage", settings, data.expectedUpdatedAt);

    invalidateMemberArea("login", { from: "action" });

    return { settings, updatedAt };
  });
}
