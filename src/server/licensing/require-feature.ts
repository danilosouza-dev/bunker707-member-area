// A fonte unica do que a licenca liga e barra (docs/32 §11.3 e §11.8). Todo ponto do app que depende de
// um modulo, ou de uma classe de acao, pergunta aqui, e so aqui. No modo "off" (a nossa escola hoje, a `dev`
// e os testes) tudo esta ligado e nada e barrado: e o comportamento de antes.

import { allowsActionClass, type ActionClass } from "./model";
import type { LicenseState } from "./state";

/** Modulo (feature) ligado: no modo "off", todos; no "enforce", so os que a licenca traz agora. */
export function isFeatureEnabled(state: LicenseState, key: string): boolean {
  if (state.mode === "off") {
    return true;
  }

  return state.evaluation.features.includes(key);
}

/**
 * Chave interna da nossa propria licenca (as paginas de vendedor, como Minhas licencas). Nunca liga no modo
 * "off": so a licenca assinada da nossa escola traz essas chaves.
 */
export function isGrantEnabled(state: LicenseState, key: string): boolean {
  return state.mode === "enforce" && state.evaluation.grants.includes(key);
}

/** A classe de acao passa no degrau de agora? No modo "off", sempre. */
export function isActionClassAllowed(state: LicenseState, actionClass: ActionClass): boolean {
  if (state.mode === "off") {
    return true;
  }

  return allowsActionClass(state.evaluation.restrictions, actionClass);
}

export type LicenseRestrictionKind = "feature" | "action_class";

/** Erro tipado de quem chamou algo que a licenca barra. A rota responde 404 (modulo) ou 403 (classe). */
export class LicenseRestrictionError extends Error {
  readonly kind: LicenseRestrictionKind;
  readonly detail: string;
  readonly status: 403 | 404;

  constructor(kind: LicenseRestrictionKind, detail: string) {
    super(kind === "feature" ? `Modulo desligado nesta Instalacao: ${detail}` : `Acao barrada pela situacao da licenca: ${detail}`);
    this.name = "LicenseRestrictionError";
    this.kind = kind;
    this.detail = detail;
    this.status = kind === "feature" ? 404 : 403;
  }
}

export function requireFeature(state: LicenseState, key: string): void {
  if (!isFeatureEnabled(state, key)) {
    throw new LicenseRestrictionError("feature", key);
  }
}

export function requireActionClass(state: LicenseState, actionClass: ActionClass): void {
  if (!isActionClassAllowed(state, actionClass)) {
    throw new LicenseRestrictionError("action_class", actionClass);
  }
}
