// Avaliacao pura da situacao da licenca (docs/32 §2.2 e §11.3): recebe a licenca ja conferida e o que
// a Instalacao sabe sozinha (a hora confiavel, a ultima conferencia boa, o endereco), e devolve o degrau,
// o que ele barra, os modulos ligados e o proximo passo para a faixa do admin.
//
// Regras que valem aqui, todas do §2.2:
// - tres degraus (Aviso, Admin limitado, Escola congelada), e nada abaixo da Escola congelada para uma
//   Instalacao que ja foi ativada; "nao_ativada" so para a que nunca teve licenca;
// - os prazos da Licenca anual, do pagamento desfeito, da suspensao e da desativacao chegam datados pelo
//   Emissor (os passos da licenca); o Verificador compara datas, nao soma dias;
// - o que a Instalacao conta sozinha: sem contato (Aviso do 8o dia; Admin limitado quando o arquivo vence;
//   Escola congelada 30 dias depois), endereco diferente e licenca ilegivel (Aviso, 7 e 30 dias);
// - os modulos nao dependem do degrau: quem ja e aluno nao perde o que tem;
// - modo de observacao: calcula e avisa, mas nao limita nada.

import {
  CLOCK_TRUST_WINDOW_MS,
  DAY_MS,
  EXPIRED_FILE_FROZEN_AFTER_MS,
  LICENSE_NOTICE,
  LOCAL_ANOMALY_FROZEN_AFTER_MS,
  LOCAL_ANOMALY_LIMITED_AFTER_MS,
  NO_CONTACT_NOTICE_AFTER_MS,
  NO_RESTRICTIONS,
  degreeRank,
  maxDegree,
  type LicenseDegree,
  type LicensePayload,
  type LicensePlan,
  type LicenseRestrictions,
  type StepDegree
} from "./model";

// ---- Endereco ------------------------------------------------------------------------------------

/**
 * Normaliza o endereco de um pedido (cabecalho Host) ou da configuracao para comparar com a licenca:
 * minusculas, sem ponto final, sem a porta 443. Qualquer outra porta fica no texto, e por isso nunca
 * bate com o nome da licenca. `www` e outro endereco. Devolve null para o que nao e um nome de host.
 */
export function normalizeHost(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  let host = value.trim().toLowerCase();

  if (host.length === 0 || host.length > 300 || /[\s/@?#\\]/.test(host)) {
    return null;
  }

  if (host.endsWith(":443")) {
    host = host.slice(0, -4);
  }

  if (host.endsWith(".")) {
    host = host.slice(0, -1);
  }

  return host.length > 0 ? host : null;
}

export function sameHost(licenseHost: string, candidate: string | null | undefined): boolean {
  return normalizeHost(candidate) === licenseHost;
}

// ---- Relogio -------------------------------------------------------------------------------------

export type TrustedClockInput = {
  /** O relogio do servidor agora. */
  systemNow: Date;
  /** A ultima hora vista, guardada; avanca a cada rodada do agendador e e realinhada a cada conferencia. */
  lastSeenAt: Date | null;
  /** A ultima conferencia boa: a hora assinada pelo Emissor e a hora local naquele momento. */
  lastCheckIn: { emissorTime: Date; localTime: Date } | null;
};

export type TrustedClock = {
  now: Date;
  source: "emissor" | "relogio";
  /** Hora local menos a hora do Emissor na ultima conferencia; null sem conferencia. */
  clockSkewMs: number | null;
  /** Diferenca maior que 48 h: vira erro no diagnostico e faixa, nunca degrau. */
  clockWrong: boolean;
};

/**
 * A hora que vale para a licenca (docs/32 §11.3, Relogio). Com uma conferencia boa nas ultimas 48 h,
 * vale a hora do Emissor mais o tempo corrido desde ela. Sem isso, vale o relogio do servidor. Nos dois
 * casos, nunca menos que a ultima hora vista: relogio parado ou atrasado nao segura um prazo.
 */
export function resolveTrustedNow(input: TrustedClockInput): TrustedClock {
  const lastSeenMs = input.lastSeenAt ? input.lastSeenAt.getTime() : Number.NEGATIVE_INFINITY;
  const systemMs = input.systemNow.getTime();
  let candidateMs = systemMs;
  let source: TrustedClock["source"] = "relogio";
  let clockSkewMs: number | null = null;

  if (input.lastCheckIn) {
    const elapsedMs = systemMs - input.lastCheckIn.localTime.getTime();
    clockSkewMs = input.lastCheckIn.localTime.getTime() - input.lastCheckIn.emissorTime.getTime();

    if (elapsedMs >= 0 && elapsedMs <= CLOCK_TRUST_WINDOW_MS) {
      candidateMs = input.lastCheckIn.emissorTime.getTime() + elapsedMs;
      source = "emissor";
    }
  }

  return {
    now: new Date(Math.max(candidateMs, lastSeenMs)),
    source,
    clockSkewMs,
    clockWrong: clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_TRUST_WINDOW_MS
  };
}

// ---- Avaliacao -----------------------------------------------------------------------------------

export type LicenseReason = {
  degree: StepDegree;
  /** Motivo: um dos datados pelo Emissor, ou sem_contato, endereco_diferente, licenca_ilegivel. */
  reason: string;
  /** Desde quando este motivo vale. */
  since: string;
};

export type LicenseNextStep = { degree: StepDegree; at: string; reason: string };

export type LicenseEvaluation = {
  /** O degrau calculado. "nao_ativada" so para a Instalacao que nunca teve licenca. */
  degree: LicenseDegree | "nao_ativada";
  /** O degrau que vale de fato: no modo de observacao, nunca passa do Aviso. */
  enforcedDegree: LicenseDegree | "nao_ativada";
  observing: boolean;
  restrictions: LicenseRestrictions;
  reasons: LicenseReason[];
  /** O proximo passo datado que ainda nao chegou, para a faixa dizer a data. */
  nextStep: LicenseNextStep | null;
  kind: "annual" | "lifetime" | null;
  validUntil: string | null;
  /** O tipo e a validade vieram de uma compra ainda na garantia. */
  provisional: boolean;
  licensedTo: string | null;
  /** Modulos ligados agora. */
  features: string[];
  /** Chaves internas (paginas de vendedor da nossa escola). */
  grants: string[];
  notice: string;
};

export type LicenseEvaluationInput = {
  /** A licenca guardada, ja conferida por verifyLicenseToken; null se nao ha ou se nao conferiu. */
  license: LicensePayload | null;
  /** A Instalacao ja teve uma licenca valida alguma vez. */
  everActivated: boolean;
  /** Desde quando a licenca guardada esta ilegivel (faltando ou sem conferir), numa Instalacao ja ativada. */
  unreadableSince: Date | null;
  /** A hora confiavel (resolveTrustedNow). */
  now: Date;
  /** Hora confiavel da ultima conferencia boa com o Emissor; null se nunca houve. */
  lastGoodCheckInAt: Date | null;
  /** O endereco configurado da Instalacao, o mesmo que monta os links dos e-mails. */
  configuredHost: string | null;
  /** Desde quando os pedidos do admin chegam, repetidamente, por outro endereco; null se nao chegam. */
  hostMismatchSince: Date | null;
};

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** Escada contada pela Instalacao a partir de um momento: Aviso, 7 dias, 30 dias. */
function localAnomalyReasons(reason: string, sinceMs: number, nowMs: number): LicenseReason[] {
  const reasons: LicenseReason[] = [{ degree: "aviso", reason, since: isoOf(sinceMs) }];

  if (nowMs >= sinceMs + LOCAL_ANOMALY_LIMITED_AFTER_MS) {
    reasons.push({ degree: "admin_limitado", reason, since: isoOf(sinceMs + LOCAL_ANOMALY_LIMITED_AFTER_MS) });
  }

  if (nowMs >= sinceMs + LOCAL_ANOMALY_FROZEN_AFTER_MS) {
    reasons.push({ degree: "escola_congelada", reason, since: isoOf(sinceMs + LOCAL_ANOMALY_FROZEN_AFTER_MS) });
  }

  return reasons;
}

function localAnomalyNextStep(reason: string, sinceMs: number, nowMs: number): LicenseNextStep | null {
  if (nowMs < sinceMs + LOCAL_ANOMALY_LIMITED_AFTER_MS) {
    return { degree: "admin_limitado", at: isoOf(sinceMs + LOCAL_ANOMALY_LIMITED_AFTER_MS), reason };
  }

  if (nowMs < sinceMs + LOCAL_ANOMALY_FROZEN_AFTER_MS) {
    return { degree: "escola_congelada", at: isoOf(sinceMs + LOCAL_ANOMALY_FROZEN_AFTER_MS), reason };
  }

  return null;
}

function highestDegree(reasons: LicenseReason[]): LicenseDegree {
  return reasons.reduce<LicenseDegree>((current, item) => maxDegree(current, item.degree), "ok");
}

function earliestNextStep(candidates: Array<LicenseNextStep | null>, currentDegree: LicenseDegree): LicenseNextStep | null {
  const later = candidates.filter(
    (step): step is LicenseNextStep => step !== null && degreeRank(step.degree) > degreeRank(currentDegree)
  );

  later.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return later[0] ?? null;
}

function restrictionsFor(degree: LicenseDegree, hostMismatch: boolean): LicenseRestrictions {
  return {
    activationOnly: false,
    content: degreeRank(degree) >= degreeRank("admin_limitado"),
    // A Instalacao fora do endereco da licenca para de dar acesso novo ja no Aviso (docs/32 §2.2).
    newAccess: degree === "escola_congelada" || (hostMismatch && degree !== "ok")
  };
}

/** O plano que vale agora: o provisorio enquanto a compra estiver na garantia, depois o confirmado. */
function effectivePlan(license: LicensePayload, nowMs: number): { plan: LicensePlan; provisional: boolean } {
  if (license.provisional && nowMs < Date.parse(license.provisional.until)) {
    return { plan: license.provisional, provisional: true };
  }

  return { plan: license.plan, provisional: false };
}

export function evaluateLicense(input: LicenseEvaluationInput): LicenseEvaluation {
  const nowMs = input.now.getTime();

  if (!input.license) {
    if (!input.everActivated) {
      return {
        degree: "nao_ativada",
        enforcedDegree: "nao_ativada",
        observing: false,
        restrictions: { activationOnly: true, content: true, newAccess: true },
        reasons: [],
        nextStep: null,
        kind: null,
        validUntil: null,
        provisional: false,
        licensedTo: null,
        features: [],
        grants: [],
        notice: LICENSE_NOTICE
      };
    }

    // Ja ativada e sem licenca legivel: o banco foi mexido ou a linha se perdeu. A conferencia diaria ou o
    // "Verificar agora" trazem a licenca de volta; ate la, a escada local, sem degrau de uma hora para a outra.
    const sinceMs = Math.min(input.unreadableSince ? input.unreadableSince.getTime() : nowMs, nowMs);
    const reasons = localAnomalyReasons("licenca_ilegivel", sinceMs, nowMs);
    const degree = highestDegree(reasons);

    return {
      degree,
      enforcedDegree: degree,
      observing: false,
      restrictions: restrictionsFor(degree, false),
      reasons,
      nextStep: localAnomalyNextStep("licenca_ilegivel", sinceMs, nowMs),
      kind: null,
      validUntil: null,
      provisional: false,
      licensedTo: null,
      features: [],
      grants: [],
      notice: LICENSE_NOTICE
    };
  }

  const license = input.license;
  const { plan, provisional } = effectivePlan(license, nowMs);
  const reasons: LicenseReason[] = [];
  const nextCandidates: Array<LicenseNextStep | null> = [];

  // 1. Os passos datados pelo Emissor.
  for (const step of plan.steps) {
    const fromMs = Date.parse(step.from);

    if (fromMs <= nowMs) {
      reasons.push({ degree: step.degree, reason: step.reason, since: step.from });
    } else {
      nextCandidates.push({ degree: step.degree, at: step.from, reason: step.reason });
    }
  }

  // 2. Sem contato com o Emissor. A licenca por arquivo nao conversa todo dia: nao recebe o Aviso do 8o dia,
  // mas vence do mesmo jeito.
  const expiresMs = Date.parse(license.expiresAt);
  const lastContactMs = input.lastGoodCheckInAt ? input.lastGoodCheckInAt.getTime() : Date.parse(license.issuedAt);

  if (license.delivery === "online") {
    if (nowMs >= lastContactMs + NO_CONTACT_NOTICE_AFTER_MS) {
      reasons.push({ degree: "aviso", reason: "sem_contato", since: isoOf(lastContactMs + NO_CONTACT_NOTICE_AFTER_MS) });
    } else {
      nextCandidates.push({ degree: "aviso", at: isoOf(lastContactMs + NO_CONTACT_NOTICE_AFTER_MS), reason: "sem_contato" });
    }
  }

  if (nowMs >= expiresMs) {
    reasons.push({ degree: "admin_limitado", reason: "arquivo_vencido", since: license.expiresAt });
  } else {
    nextCandidates.push({ degree: "admin_limitado", at: license.expiresAt, reason: "arquivo_vencido" });
  }

  if (nowMs >= expiresMs + EXPIRED_FILE_FROZEN_AFTER_MS) {
    reasons.push({ degree: "escola_congelada", reason: "arquivo_vencido", since: isoOf(expiresMs + EXPIRED_FILE_FROZEN_AFTER_MS) });
  } else {
    nextCandidates.push({ degree: "escola_congelada", at: isoOf(expiresMs + EXPIRED_FILE_FROZEN_AFTER_MS), reason: "arquivo_vencido" });
  }

  // 3. Endereco: o configurado tem de ser o da licenca, e os pedidos do admin tambem.
  const configuredMismatch = !sameHost(license.installation.host, input.configuredHost);
  const hostMismatch = configuredMismatch || input.hostMismatchSince !== null;

  if (hostMismatch) {
    const sinceMs = Math.min(input.hostMismatchSince ? input.hostMismatchSince.getTime() : nowMs, nowMs);
    reasons.push(...localAnomalyReasons("endereco_diferente", sinceMs, nowMs));
    nextCandidates.push(localAnomalyNextStep("endereco_diferente", sinceMs, nowMs));
  }

  const degree = highestDegree(reasons);
  const observing = license.observeUntil !== undefined && nowMs < Date.parse(license.observeUntil);
  const enforcedDegree: LicenseDegree = observing && degreeRank(degree) > degreeRank("aviso") ? "aviso" : degree;

  return {
    degree,
    enforcedDegree,
    observing,
    restrictions: observing ? { ...NO_RESTRICTIONS } : restrictionsFor(enforcedDegree, hostMismatch),
    reasons,
    nextStep: earliestNextStep(nextCandidates, degree),
    kind: plan.kind,
    validUntil: plan.validUntil ?? null,
    provisional,
    licensedTo: license.holder.name,
    features: license.features
      .filter((feature) => feature.until === undefined || nowMs < Date.parse(feature.until))
      .map((feature) => feature.key),
    grants: [...license.grants],
    notice: LICENSE_NOTICE
  };
}

/** Atalho para quem so precisa saber se um modulo esta ligado (require-feature, depois). */
export function isFeatureOn(evaluation: LicenseEvaluation, key: string): boolean {
  return evaluation.features.includes(key);
}

/** Para a faixa: quantos dias faltam para o proximo passo, arredondado para cima. */
export function daysUntil(at: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(at) - now.getTime()) / DAY_MS));
}
