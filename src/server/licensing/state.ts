// A situacao da licenca da Instalacao, montada a partir do que esta guardado (docs/32 §11.3).
//
// Junta as tres pecas puras: a conferencia da licenca guardada (artifact.ts), a hora confiavel e a avaliacao
// (evaluate.ts). Recebe o retrato do que a Instalacao guarda; ler e gravar esse retrato e trabalho do store
// (tabela license_state, numa peca seguinte). Sem banco e sem "server-only": os testes carregam direto.

import { verifyLicenseToken, type LicenseVerificationError } from "./artifact";
import type { LicensingMode } from "./build-config";
import { evaluateLicense, resolveTrustedNow, type LicenseEvaluation, type TrustedClock } from "./evaluate";
import type { LicensePayload, TrustedRoot } from "./model";

/** O que a Instalacao guarda sobre a propria licenca (uma linha da tabela license_state). */
export type LicenseStoreSnapshot = {
  /** O texto BKL1 da ultima licenca recebida; null se nunca recebeu. */
  token: string | null;
  /** Ja teve uma licenca valida alguma vez. */
  everActivated: boolean;
  /** Desde quando a licenca guardada esta ilegivel; o store grava na primeira vez que percebe. */
  unreadableSince: Date | null;
  /** A ultima hora vista (avanca a cada rodada do agendador e e realinhada a cada conferencia boa). */
  lastSeenAt: Date | null;
  /** A ultima conferencia boa: a hora assinada pelo Emissor e a hora local naquele momento. */
  lastCheckIn: { emissorTime: Date; localTime: Date } | null;
  /** Desde quando a Instalacao esta fora do endereco da licenca (configurado ou pedidos repetidos). */
  hostMismatchSince: Date | null;
  /**
   * A data de emissao da licenca mais nova ja aceita. Contrato do store: sobe a cada licenca aceita e nunca
   * desce. Uma licenca mais antiga que ela nao vale: devolver a licenca de ontem, de antes de uma desativacao,
   * nao desfaz a desativacao (inclusive pela licenca por arquivo).
   */
  newestIssuedAt: Date | null;
};

export const EMPTY_LICENSE_SNAPSHOT: LicenseStoreSnapshot = Object.freeze({
  token: null,
  everActivated: false,
  unreadableSince: null,
  lastSeenAt: null,
  lastCheckIn: null,
  hostMismatchSince: null,
  newestIssuedAt: null
});

export type LicenseState =
  | { mode: "off" }
  | {
      mode: "enforce";
      evaluation: LicenseEvaluation;
      clock: TrustedClock;
      license: LicensePayload | null;
      /** Por que a licenca guardada nao vale; null quando vale ou quando nao ha licenca. */
      verificationError: LicenseVerificationError | "licenca_antiga" | null;
    };

export type ComputeLicenseStateInput = {
  mode: LicensingMode;
  roots: readonly TrustedRoot[];
  snapshot: LicenseStoreSnapshot;
  systemNow: Date;
  /** O endereco configurado da Instalacao (o mesmo que monta os links dos e-mails). */
  configuredHost: string | null;
};

export function computeLicenseState(input: ComputeLicenseStateInput): LicenseState {
  if (input.mode !== "enforce") {
    return { mode: "off" };
  }

  const { snapshot } = input;
  const clock = resolveTrustedNow({
    systemNow: input.systemNow,
    lastSeenAt: snapshot.lastSeenAt,
    lastCheckIn: snapshot.lastCheckIn
  });

  let license: LicensePayload | null = null;
  let verificationError: LicenseVerificationError | "licenca_antiga" | null = null;

  if (snapshot.token) {
    const verification = verifyLicenseToken(snapshot.token, input.roots);
    const newestMs = snapshot.newestIssuedAt instanceof Date ? snapshot.newestIssuedAt.getTime() : null;

    if (!verification.ok) {
      verificationError = verification.error;
    } else if (newestMs !== null && (!Number.isFinite(newestMs) || Date.parse(verification.license.issuedAt) < newestMs)) {
      verificationError = "licenca_antiga";
    } else {
      license = verification.license;
    }
  }

  const evaluation = evaluateLicense({
    license,
    // Uma licenca que confere agora conta como ativada, mesmo que o store ainda nao tenha gravado a marca.
    everActivated: snapshot.everActivated || license !== null,
    unreadableSince: license ? null : snapshot.unreadableSince,
    now: clock.now,
    configuredHost: input.configuredHost,
    hostMismatchSince: snapshot.hostMismatchSince
  });

  return { mode: "enforce", evaluation, clock, license, verificationError };
}
