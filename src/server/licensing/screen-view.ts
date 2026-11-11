// O que a tela Licenca do admin mostra (docs/32 §2.4, "Licenca, no admin do comprador, em Configuracoes"): a situacao
// em palavras simples, "Licenciado para", o tipo e a validade, o endereco, o ultimo contato com o Emissor, os modulos
// ligados e a versao, mais o que cada botao pode fazer agora. Puro, sem "server-only" e sem "@/": os testes carregam
// direto. Nada daqui leva o segredo, a sequencia ou a licenca inteira.

import {
  LICENSE_DEGREE_LABELS,
  LICENSE_DEGREE_MEANINGS,
  LICENSE_KIND_LABELS,
  LICENSE_NEW_ACCESS_STOPPED,
  featureLabel,
  formatLicenseDate,
  formatLicenseDateTime,
  licenseReasonSentence,
  licenseResultMessage,
  nextStepSentence,
  reasonContextOf,
  visibleReasons,
  type LicenseDegreeName,
  type LicenseResultMessage
} from "./copy";
import { normalizeHost } from "./evaluate";
import type { LicenseState } from "./state";

export type LicenseScreenTone = "success" | "warning" | "error" | "neutral";

export type LicenseScreenView = {
  degree: LicenseDegreeName;
  degreeLabel: string;
  /** O que o degrau quer dizer agora, em uma frase. */
  meaning: string;
  tone: LicenseScreenTone;
  /** O que houve: uma frase por motivo. */
  reasons: string[];
  nextStep: string | null;
  /** O aviso do modo de observacao do lote fundador, quando vale. */
  observation: string | null;
  clockWrong: boolean;
  holder: string | null;
  kind: string | null;
  /** "10/11/2027"; null na vitalicia ou sem licenca. */
  validUntil: string | null;
  /** O tipo e a validade vem de uma compra ainda na garantia. */
  provisional: boolean;
  licenseHost: string | null;
  configuredHost: string | null;
  hostMismatch: boolean;
  delivery: "online" | "file" | null;
  /** A emissao assinada da licenca guardada (o ultimo contato bom, na licenca da conversa). */
  lastContact: string | null;
  /** Ate quando a licenca guardada vale sem contato. */
  validWithoutContactUntil: string | null;
  /** A ultima tentativa que nao deu certo, com a frase do motivo; null quando a ultima deu certo ou nunca houve. */
  lastFailure: { at: string; message: LicenseResultMessage } | null;
  modules: string[];
  version: string;
  licenseId: string | null;
  installationId: string | null;
  renewUrl: string | null;
  storeUrl: string | null;
  /** Ha identificador e segredo da Instalacao: Verificar agora e Desativar falam com o Emissor. */
  canTalkToEmissor: boolean;
  /** A Instalacao ja recebeu a ordem de desativacao (ou a vaga foi liberada): Desativar nao aparece. */
  deactivated: boolean;
};

export type LicenseScreenInput = {
  state: LicenseState;
  installationId: string | null;
  hasInstallationCredentials: boolean;
  lastAttempt: { at: Date | null; result: string | null };
  /** O endereco configurado da Instalacao (NEXT_PUBLIC_SITE_URL). */
  configuredHost: string | null;
  /** A versao do produto que roda (APP_VERSION). */
  version: string | null;
};

const TONES: Readonly<Record<LicenseDegreeName, LicenseScreenTone>> = {
  ok: "success",
  aviso: "warning",
  admin_limitado: "error",
  escola_congelada: "error",
  nao_ativada: "error"
};

/** A tela Licenca no modo "enforce". No modo "off" a tela nao existe: null. */
export function licenseScreenView(input: LicenseScreenInput): LicenseScreenView | null {
  const state = input.state;

  if (state.mode !== "enforce") {
    return null;
  }

  const { evaluation, license } = state;
  const context = reasonContextOf(state, input.configuredHost);
  const degree: LicenseDegreeName = evaluation.degree;
  const configuredHost = normalizeHost(input.configuredHost);
  const statusReasons = new Set((license?.statusSteps ?? []).map((step) => step.reason));
  const failed = input.lastAttempt.result !== null && input.lastAttempt.result !== "ok" && input.lastAttempt.result !== "em_andamento";
  const observeUntil = license?.observeUntil ? formatLicenseDate(license.observeUntil) : "";

  return {
    degree,
    degreeLabel: LICENSE_DEGREE_LABELS[degree],
    meaning: degree === "aviso" && evaluation.restrictions.newAccess ? LICENSE_NEW_ACCESS_STOPPED : LICENSE_DEGREE_MEANINGS[degree],
    tone: TONES[degree],
    reasons: visibleReasons(evaluation.reasons).map((item) => licenseReasonSentence(item, context)),
    nextStep: nextStepSentence(evaluation.nextStep),
    observation: evaluation.observing
      ? `Modo de observação${observeUntil ? ` até ${observeUntil}` : ""}: a situação é calculada e avisada, mas nada é limitado.`
      : null,
    clockWrong: state.clock.clockWrong,
    holder: evaluation.licensedTo,
    kind: evaluation.kind ? LICENSE_KIND_LABELS[evaluation.kind] : null,
    validUntil: evaluation.validUntil ? formatLicenseDate(evaluation.validUntil) : null,
    provisional: evaluation.provisional,
    licenseHost: license?.installation.host ?? null,
    configuredHost,
    hostMismatch: Boolean(license && configuredHost !== license.installation.host),
    delivery: license?.delivery ?? null,
    lastContact: license && license.delivery === "online" ? formatLicenseDateTime(license.issuedAt) : null,
    validWithoutContactUntil: license ? formatLicenseDate(license.expiresAt) : null,
    lastFailure:
      failed && input.lastAttempt.at
        ? { at: formatLicenseDateTime(input.lastAttempt.at), message: licenseResultMessage(input.lastAttempt.result ?? "falhou") }
        : null,
    modules: evaluation.features.map(featureLabel),
    version: input.version?.trim() || "dev",
    licenseId: license?.licenseId ?? null,
    installationId: input.installationId,
    renewUrl: license?.links?.renew ?? null,
    storeUrl: license?.links?.store ?? null,
    canTalkToEmissor: input.hasInstallationCredentials,
    deactivated: statusReasons.has("desativada") || statusReasons.has("vaga_liberada")
  };
}

/** A linha da Licenca no hub de Configuracoes: o degrau quando nao esta em dia; em dia, a validade ou "Vitalícia". */
export function licenseHubStatusOf(state: LicenseState): { label: string; tone: LicenseScreenTone } | null {
  if (state.mode !== "enforce") {
    return null;
  }

  const { evaluation } = state;

  if (evaluation.degree !== "ok") {
    return { label: LICENSE_DEGREE_LABELS[evaluation.degree], tone: TONES[evaluation.degree] };
  }

  if (evaluation.kind === "annual" && evaluation.validUntil) {
    return { label: `Até ${formatLicenseDate(evaluation.validUntil)}`, tone: "success" };
  }

  return { label: evaluation.kind === "lifetime" ? LICENSE_KIND_LABELS.lifetime : LICENSE_DEGREE_LABELS.ok, tone: "success" };
}
