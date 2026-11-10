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
  /** Desde quando os pedidos do admin chegam, repetidamente, por outro endereco. */
  hostMismatchSince: Date | null;
};

export const EMPTY_LICENSE_SNAPSHOT: LicenseStoreSnapshot = Object.freeze({
  token: null,
  everActivated: false,
  unreadableSince: null,
  lastSeenAt: null,
  lastCheckIn: null,
  hostMismatchSince: null
});

export type LicenseState =
  | { mode: "off" }
  | {
      mode: "enforce";
      evaluation: LicenseEvaluation;
      clock: TrustedClock;
      license: LicensePayload | null;
      /** Por que a licenca guardada nao conferiu; null quando conferiu ou quando nao ha licenca. */
      verificationError: LicenseVerificationError | null;
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
  let verificationError: LicenseVerificationError | null = null;

  if (snapshot.token) {
    const verification = verifyLicenseToken(snapshot.token, input.roots);

    if (verification.ok) {
      license = verification.license;
    } else {
      verificationError = verification.error;
    }
  }

  const evaluation = evaluateLicense({
    license,
    // Uma licenca que confere agora conta como ativada, mesmo que o store ainda nao tenha gravado a marca.
    everActivated: snapshot.everActivated || license !== null,
    unreadableSince: license ? null : snapshot.unreadableSince,
    now: clock.now,
    // A ultima conferencia boa vale na hora do Emissor, que e a hora em que os prazos foram assinados.
    lastGoodCheckInAt: snapshot.lastCheckIn ? snapshot.lastCheckIn.emissorTime : null,
    configuredHost: input.configuredHost,
    hostMismatchSince: snapshot.hostMismatchSince
  });

  return { mode: "enforce", evaluation, clock, license, verificationError };
}
