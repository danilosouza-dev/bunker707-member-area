// A fonte unica do que a licenca liga e barra (docs/32 §11.3 e §11.8). Todo ponto do app que depende de
// um modulo, ou de uma classe de acao, pergunta aqui, e so aqui. No modo "off" (a nossa escola hoje, a `dev`
// e os testes) tudo esta ligado e nada e barrado: e o comportamento de antes.
//
// Quem pergunta: runAdminAction (src/server/actions/run-action.ts, a classe de toda Server Action do admin e o modulo
// das dos Webinarios), as rotas e as paginas pelas guardas de src/server/licensing/guards.ts, o agendador
// (src/server/jobs/run-tick.ts, as tarefas de um modulo) e os menus, que recebem a lista dos modulos desligados.

import { KNOWN_FEATURES, type FeatureKey } from "./features";
import { allowsActionClass, type ActionClass } from "./model";
import type { LicenseState } from "./state";

/** Modulo (feature) ligado: no modo "off", todos; no "enforce", so os que a licenca traz agora. */
export function isFeatureEnabled(state: LicenseState, key: string): boolean {
  if (state.mode === "off") {
    return true;
  }

  return state.evaluation.features.includes(key);
}

/** Os modulos que esta versao conhece e que a licenca nao liga agora (os menus escondem). No modo "off", nenhum. */
export function disabledFeaturesOf(state: LicenseState): FeatureKey[] {
  return KNOWN_FEATURES.filter((key) => !isFeatureEnabled(state, key));
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

/**
 * As frases da recusa. O modulo desligado responde como pagina que nao existe (nada diz que o modulo existe); a acao
 * barrada fala da Licenca so para a equipe (runAdminAction confere o papel antes) e, nas rotas, que podem ser chamadas
 * por qualquer um, fica neutra: o aluno nunca ve aviso sobre a Licenca da escola (docs/32 §2.2).
 */
export const LICENSE_REFUSAL_MESSAGES = Object.freeze({
  actionClass: "A situação da Licença desta escola não permite esta ação agora.",
  feature: "Não encontrado.",
  route: "Esta ação não está disponível agora."
});

/** Erro tipado de quem chamou algo que a licenca barra. A rota responde 404 (modulo) ou 403 (classe). */
export class LicenseRestrictionError extends Error {
  readonly kind: LicenseRestrictionKind;
  readonly detail: string;
  readonly status: 403 | 404;

  constructor(kind: LicenseRestrictionKind, detail: string) {
    super(kind === "feature" ? LICENSE_REFUSAL_MESSAGES.feature : LICENSE_REFUSAL_MESSAGES.actionClass);
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

/** O que uma acao ou rota pergunta: o modulo de que depende (se depende de um) e a classe do que faz (se muda algo). */
export type LicenseCheck = { actionClass?: ActionClass; feature?: FeatureKey };

/** Confere o modulo (404) e depois a classe (403); lanca LicenseRestrictionError. */
export function requireLicensed(state: LicenseState, check: LicenseCheck): void {
  if (check.feature !== undefined) {
    requireFeature(state, check.feature);
  }

  if (check.actionClass !== undefined) {
    requireActionClass(state, check.actionClass);
  }
}

/** A recusa de uma rota, ou null quando passa: 404 com o modulo desligado, 403 com a classe barrada. */
export function licenseRefusalOf(state: LicenseState, check: LicenseCheck): { message: string; status: 403 | 404 } | null {
  if (check.feature !== undefined && !isFeatureEnabled(state, check.feature)) {
    return { message: LICENSE_REFUSAL_MESSAGES.feature, status: 404 };
  }

  if (check.actionClass !== undefined && !isActionClassAllowed(state, check.actionClass)) {
    return { message: LICENSE_REFUSAL_MESSAGES.route, status: 403 };
  }

  return null;
}

/**
 * A pergunta precisa da licenca? Dever legal sem modulo nunca e barrado, em nenhum degrau (allowsActionClass, model.ts):
 * as rotas que so fazem isso (webhooks de venda e de e-mail, o tick, sair da conta) nao leem a licenca a cada pedido.
 */
export function needsLicenseState(check: LicenseCheck): boolean {
  return check.feature !== undefined || (check.actionClass !== undefined && check.actionClass !== "dever_legal");
}
