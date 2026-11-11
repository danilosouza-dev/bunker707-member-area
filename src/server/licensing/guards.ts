import "server-only";

// As guardas da licenca para as paginas e as rotas (docs/32 §11.3 e §11.8). A regra mora em require-feature.ts; aqui
// so a situacao deste pedido (readCurrentLicenseState) e a resposta do Next. No modo "off" (a nossa escola hoje, a
// `dev`, a Vercel e os testes) nada aqui le o banco e nada e recusado: as paginas e as rotas respondem como antes.
//
// - Pagina de um modulo: requireFeaturePage(WEBINARS_FEATURE) antes de tudo, inclusive da sessao. Sem o modulo, a
//   pagina de nao encontrado da raiz (404), nunca o login nem uma pagina de erro que diga que o modulo existe.
// - Rota (route.ts): `const refused = await licenseRouteRefusal({ ... }); if (refused) return refused;` como primeira
//   coisa do handler. Modulo desligado: 404; classe barrada pelo degrau: 403. Toda rota que muda algo (POST, PUT,
//   PATCH, DELETE) diz a classe; toda rota de um modulo diz o modulo (guarda em tests/licenca-modulos.guard.test.mjs
//   e tests/licenca-classes.guard.test.mjs).
// - Leitura da licenca que falha (modo "enforce"): nada aqui lanca por ela. Os modulos somem e respondem 404, a classe
//   que nao e dever legal responde 403, e a pagina continua abrindo (readCurrentLicenseState).

import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { readCurrentLicenseState } from "./current-state";
import { NO_DISABLED_FEATURES, type FeatureKey } from "./features";
import { disabledFeaturesOf, isFeatureEnabled, licenseRefusalOf, needsLicenseState, type LicenseCheck } from "./require-feature";

/** Pagina de um modulo: sem o modulo, 404. Chame antes de ler a sessao ou o banco. */
export async function requireFeaturePage(feature: FeatureKey): Promise<void> {
  if (!isFeatureEnabled(await readCurrentLicenseState(), feature)) {
    notFound();
  }
}

/** O modulo esta ligado neste pedido? (a fileira da pagina inicial, o atalho de um modulo dentro de outra tela). */
export async function isFeatureEnabledNow(feature: FeatureKey): Promise<boolean> {
  return isFeatureEnabled(await readCurrentLicenseState(), feature);
}

/** Os modulos desligados neste pedido, para os menus esconderem. No modo "off", nenhum; sem leitura, todos. */
export async function getDisabledFeatures(): Promise<readonly FeatureKey[]> {
  const disabled = disabledFeaturesOf(await readCurrentLicenseState());

  return disabled.length === 0 ? NO_DISABLED_FEATURES : disabled;
}

/**
 * A guarda de licenca de uma rota: devolve a resposta de recusa (404 sem o modulo, 403 com a classe barrada), sem
 * cache, ou null quando passa. Dever legal sem modulo nunca e barrado e nem le a licenca (needsLicenseState).
 */
export async function licenseRouteRefusal(check: LicenseCheck): Promise<NextResponse | null> {
  if (!needsLicenseState(check)) {
    return null;
  }

  const refusal = licenseRefusalOf(await readCurrentLicenseState(), check);

  if (!refusal) {
    return null;
  }

  return NextResponse.json({ error: refusal.message }, { headers: { "Cache-Control": "private, no-store" }, status: refusal.status });
}
