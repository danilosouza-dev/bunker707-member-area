import "server-only";

// Leitura da pagina de entrar:
// - getLoginEditorData: a tela /admin/area-de-membros/login (sem cache, sempre o que esta no banco);
// - getLoginPageConfigForRequest: o /login publico, em unstable_cache com a tag "member-area-login"
//   (saveLoginPage invalida) e a do catalogo (a logo vem da Marca, cuja rota invalida o catalogo).
//   O loader lanca em erro de banco para nao guardar o padrao em cache; quem chama cai no padrao.

import { unstable_cache } from "next/cache";
import type { LoginPageConfig } from "@/lib/login-config";
import { DEFAULT_LOGO_IMAGE, normalizeLogo } from "@/server/storefront/model";
import { LOGIN_PAGE_CACHE_KEY, LOGIN_PAGE_CACHE_TAGS, LOGIN_PAGE_REVALIDATE_SECONDS } from "./cache-tags";
import { DEFAULT_LOGIN_PAGE_SETTINGS, parseStoredLoginPage, resolveLoginPageConfig, type LoginPageSettings } from "./login-model";
import { readPlatformSettings } from "./settings-store";

export type LoginEditorData = {
  /** Logo da Marca, para a previa (null = nome da escola em texto). */
  logoImage: string | null;
  /** O que esta publicado, ou o padrao quando nunca foi publicado (ou o salvo estava invalido). */
  settings: LoginPageSettings;
  /** Havia uma configuracao salva que nao passou na validacao: a tela avisa e o produtor publica por cima. */
  storedWasInvalid: boolean;
  /** Versao da chave loginPage (coluna updated_at); null = nunca publicado. */
  updatedAt: string | null;
};

export async function getLoginEditorData(): Promise<LoginEditorData> {
  const rows = await readPlatformSettings(["loginPage", "branding"]);
  const stored = parseStoredLoginPage(rows.loginPage.value);

  return {
    logoImage: normalizeLogo(rows.branding.value, rows.branding.exists),
    settings: stored.settings,
    storedWasInvalid: rows.loginPage.exists && !stored.valid,
    updatedAt: rows.loginPage.exists ? rows.loginPage.updatedAt : null
  };
}

type CachedLoginRows = {
  branding: { exists: boolean; value: unknown };
  loginPage: { exists: boolean; value: unknown };
};

/** So JSON serializavel sai daqui (o unstable_cache guarda o resultado). Erro de banco: lanca. */
async function loadLoginRows(): Promise<CachedLoginRows> {
  const rows = await readPlatformSettings(["loginPage", "branding"]);

  return {
    branding: { exists: rows.branding.exists, value: rows.branding.value ?? null },
    loginPage: { exists: rows.loginPage.exists, value: rows.loginPage.value ?? null }
  };
}

const loadLoginRowsCached = unstable_cache(loadLoginRows, [...LOGIN_PAGE_CACHE_KEY], {
  revalidate: LOGIN_PAGE_REVALIDATE_SECONDS,
  tags: [...LOGIN_PAGE_CACHE_TAGS]
});

let warnedInvalidLoginPage = false;

/** O /login como o aluno ve hoje, quando nada foi publicado ou a leitura falhou. */
export function defaultLoginPageConfig(): LoginPageConfig {
  return resolveLoginPageConfig(DEFAULT_LOGIN_PAGE_SETTINGS, { logoImage: DEFAULT_LOGO_IMAGE });
}

/** Configuracao publicada do /login (em cache); nunca lanca. */
export async function getLoginPageConfigForRequest(): Promise<LoginPageConfig> {
  try {
    const rows = await loadLoginRowsCached();
    const stored = parseStoredLoginPage(rows.loginPage.value);

    if (rows.loginPage.exists && !stored.valid && !warnedInvalidLoginPage) {
      warnedInvalidLoginPage = true;
      console.warn("[login] platform_settings.loginPage nao passou na validacao; usando o padrao.");
    }

    return resolveLoginPageConfig(stored.settings, { logoImage: normalizeLogo(rows.branding.value, rows.branding.exists) });
  } catch (error) {
    console.error("[login] configuracao da pagina de entrar", error);
    return defaultLoginPageConfig();
  }
}
