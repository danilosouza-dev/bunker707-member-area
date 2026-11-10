// Avaliacao pura da situacao da licenca (docs/32 §2.2 e §11.3): recebe a licenca ja conferida e o que
// a Instalacao sabe sozinha (a hora confiavel, a ultima conferencia boa, o endereco), e devolve o degrau,
// o que ele barra, os modulos ligados e o proximo passo para a faixa do admin.
//
// Regras que valem aqui, todas do §2.2:
// - tres degraus (Aviso, Admin limitado, Escola congelada), e nada abaixo da Escola congelada para uma
//   Instalacao que ja foi ativada; "nao_ativada" so para a que nunca teve licenca;
// - os prazos chegam datados pelo Emissor: os da validade no plano (a compra na garantia troca o plano
//   ate a data dela) e os de situacao (pagamento desfeito, suspensao, desativacao) a parte, valendo sempre;
// - o que a Instalacao conta sozinha: sem contato (Aviso do 8o dia; Admin limitado quando o arquivo vence;
//   Escola congelada 30 dias depois), endereco diferente e licenca ilegivel (Aviso, 7 e 30 dias). Nos dois
//   ultimos, nenhum acesso novo ja no Aviso: nada prova o direito de dar acesso;
// - os modulos nao dependem do degrau: quem ja e aluno nao perde o que tem;
// - modo de observacao: calcula e avisa, mas nao limita nada.
//
// Toda data de entrada pode ter vindo do banco, que o comprador controla. Data invalida nunca libera nada:
// "desde quando" invalido conta como ha muito tempo; hora atual invalida fecha a escola.

import {
  ANNUAL_RESERVE_FROZEN_AFTER_MS,
  ANNUAL_RESERVE_LIMITED_AFTER_MS,
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
  type LicenseStep,
  type StepDegree
} from "./model";

// ---- Datas ---------------------------------------------------------------------------------------

/** O instante em ms, ou null se nao e uma data valida. */
function validMs(value: Date | null | undefined): number | null {
  if (!(value instanceof Date)) {
    return null;
  }

  const ms = value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

// ---- Endereco ------------------------------------------------------------------------------------

/**
 * Normaliza um endereco para comparar com o da licenca: aceita o nome (cabecalho Host ou X-Forwarded-Host,
 * so o primeiro de uma lista) ou o endereco completo (https://...). Devolve o nome em minusculas, em
 * punycode, sem ponto final e sem a porta 443; qualquer outra porta fica no texto e nunca bate com a licenca.
 * `www` e outro endereco. Devolve null para o que nao e um nome de host.
 */
export function normalizeHost(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  let text = value.split(",")[0].trim();

  if (text.length === 0 || text.length > 300) {
    return null;
  }

  if (!/^https?:\/\//i.test(text)) {
    if (/[\s/@?#\\]/.test(text)) {
      return null;
    }

    text = `https://${text}`;
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.username || url.password || url.protocol !== "https:" || url.hostname.startsWith("[")) {
    return null;
  }

  const host = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;

  if (host.length === 0) {
    return null;
  }

  return url.port && url.port !== "443" ? `${host}:${url.port}` : host;
}

export function sameHost(licenseHost: string, candidate: string | null | undefined): boolean {
  return normalizeHost(candidate) === licenseHost;
}

// ---- Relogio -------------------------------------------------------------------------------------

export type TrustedClockInput = {
  /** O relogio do servidor agora. */
  systemNow: Date;
  /**
   * A ultima hora vista, guardada. Contrato do store: so avanca pelo agendador (um minuto por rodada) e e
   * realinhada com a hora do Emissor a cada conferencia boa; nunca e copiada do relogio do servidor.
   */
  lastSeenAt: Date | null;
  /** A ultima conferencia boa: a hora assinada pelo Emissor e a hora local naquele momento. */
  lastCheckIn: { emissorTime: Date; localTime: Date } | null;
};

export type TrustedClock = {
  /** A hora que vale; Invalid Date so se nenhuma entrada for uma data valida. */
  now: Date;
  source: "emissor" | "relogio" | "ultima_hora_vista";
  /** Hora local menos a hora do Emissor na ultima conferencia; null sem conferencia. */
  clockSkewMs: number | null;
  /** Diferenca maior que 48 h: vira erro no diagnostico e faixa, nunca degrau. */
  clockWrong: boolean;
};

/**
 * A hora que vale para a licenca (docs/32 §11.3, Relogio).
 * - Conferencia boa nas ultimas 48 h: a hora do Emissor mais o tempo corrido desde ela.
 * - Conferencia mais antiga: o menor entre o relogio e a hora do Emissor mais o tempo corrido. Um relogio
 *   adiantado de forma constante continua certo; um relogio que pula para a frente nao adianta o prazo.
 * - Sem conferencia (ou relogio voltado para antes dela): o relogio.
 * - Nos tres casos, nunca menos que a ultima hora vista: relogio parado ou atrasado nao segura um prazo.
 */
export function resolveTrustedNow(input: TrustedClockInput): TrustedClock {
  const systemMs = validMs(input.systemNow);
  const lastSeenMs = validMs(input.lastSeenAt);
  const emissorMs = validMs(input.lastCheckIn?.emissorTime);
  const localMs = validMs(input.lastCheckIn?.localTime);
  const checkIn = emissorMs !== null && localMs !== null ? { emissorMs, localMs } : null;
  let candidateMs: number | null = systemMs;
  let source: TrustedClock["source"] = "relogio";

  if (checkIn && systemMs !== null) {
    const elapsedMs = systemMs - checkIn.localMs;

    if (elapsedMs >= 0) {
      const emissorNowMs = checkIn.emissorMs + elapsedMs;

      if (elapsedMs <= CLOCK_TRUST_WINDOW_MS) {
        candidateMs = emissorNowMs;
        source = "emissor";
      } else {
        candidateMs = Math.min(systemMs, emissorNowMs);
      }
    }
  }

  let nowMs = candidateMs;

  if (lastSeenMs !== null && (nowMs === null || lastSeenMs > nowMs)) {
    nowMs = lastSeenMs;
    source = "ultima_hora_vista";
  }

  const clockSkewMs = checkIn ? checkIn.localMs - checkIn.emissorMs : null;

  return {
    now: new Date(nowMs ?? Number.NaN),
    source,
    clockSkewMs,
    clockWrong: clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_TRUST_WINDOW_MS
  };
}

// ---- Avaliacao -----------------------------------------------------------------------------------

export type LicenseReason = {
  degree: StepDegree;
  /** Motivo: um dos datados pelo Emissor, ou sem_contato, arquivo_vencido, endereco_diferente, licenca_ilegivel. */
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
  /** A licenca guardada, ja conferida por verifyLicenseToken; null se nao ha, se nao conferiu ou se e antiga. */
  license: LicensePayload | null;
  /** A Instalacao ja teve uma licenca valida alguma vez. */
  everActivated: boolean;
  /**
   * Desde quando a licenca guardada esta ilegivel, numa Instalacao ja ativada. O store grava na primeira vez;
   * null ou no futuro contam como agora, invalido conta como ha muito tempo.
   */
  unreadableSince: Date | null;
  /** A hora confiavel (resolveTrustedNow). */
  now: Date;
  /** O endereco configurado da Instalacao, o mesmo que monta os links dos e-mails. */
  configuredHost: string | null;
  /**
   * Desde quando a Instalacao esta fora do endereco da licenca: o configurado diferente, ou os pedidos do admin
   * chegando repetidamente por outro endereco. O store grava na primeira vez; null ou no futuro contam como
   * agora, invalido conta como ha muito tempo.
   */
  hostMismatchSince: Date | null;
};

/** O menor instante que uma Date aceita: "ha muito tempo" sem quebrar toISOString. */
const EARLIEST_DATE_MS = -8.64e15;

/** "Desde quando", seguro: ausente ou no futuro conta como agora; data invalida conta como ha muito tempo. */
function sinceMs(value: Date | null, nowMs: number): number {
  if (value === null) {
    return nowMs;
  }

  const ms = validMs(value);
  return ms === null ? EARLIEST_DATE_MS : Math.min(ms, nowMs);
}

/** Escada contada pela Instalacao a partir de um momento: Aviso, 7 dias, 30 dias. */
function localAnomalyReasons(reason: string, fromMs: number, nowMs: number): LicenseReason[] {
  const safeIso = (ms: number) => isoOf(Math.max(ms, EARLIEST_DATE_MS));
  const reasons: LicenseReason[] = [{ degree: "aviso", reason, since: safeIso(fromMs) }];

  if (nowMs >= fromMs + LOCAL_ANOMALY_LIMITED_AFTER_MS) {
    reasons.push({ degree: "admin_limitado", reason, since: safeIso(fromMs + LOCAL_ANOMALY_LIMITED_AFTER_MS) });
  }

  if (nowMs >= fromMs + LOCAL_ANOMALY_FROZEN_AFTER_MS) {
    reasons.push({ degree: "escola_congelada", reason, since: safeIso(fromMs + LOCAL_ANOMALY_FROZEN_AFTER_MS) });
  }

  return reasons;
}

function localAnomalyNextStep(reason: string, fromMs: number, nowMs: number): LicenseNextStep | null {
  if (nowMs < fromMs + LOCAL_ANOMALY_LIMITED_AFTER_MS) {
    return { degree: "admin_limitado", at: isoOf(fromMs + LOCAL_ANOMALY_LIMITED_AFTER_MS), reason };
  }

  if (nowMs < fromMs + LOCAL_ANOMALY_FROZEN_AFTER_MS) {
    return { degree: "escola_congelada", at: isoOf(fromMs + LOCAL_ANOMALY_FROZEN_AFTER_MS), reason };
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

function restrictionsFor(degree: LicenseDegree, newAccessBlocked: boolean): LicenseRestrictions {
  return {
    activationOnly: false,
    content: degreeRank(degree) >= degreeRank("admin_limitado"),
    newAccess: degree === "escola_congelada" || newAccessBlocked
  };
}

/** O plano que vale agora: o provisorio enquanto a compra estiver na garantia, depois o confirmado. */
function effectivePlan(license: LicensePayload, nowMs: number): { plan: LicensePlan; provisional: boolean } {
  if (license.provisional && nowMs < Date.parse(license.provisional.until)) {
    return { plan: license.provisional, provisional: true };
  }

  return { plan: license.plan, provisional: false };
}

/**
 * Os passos da validade de um plano: os assinados mais a rede de seguranca da anual (model.ts), que so
 * pega o Emissor que esqueceu os passos.
 */
function validitySteps(plan: LicensePlan): LicenseStep[] {
  if (plan.kind !== "annual" || !plan.validUntil) {
    return plan.steps;
  }

  const endMs = Date.parse(plan.validUntil);
  return [
    ...plan.steps,
    { degree: "admin_limitado", from: isoOf(endMs + ANNUAL_RESERVE_LIMITED_AFTER_MS), reason: "anual_vencida" },
    { degree: "escola_congelada", from: isoOf(endMs + ANNUAL_RESERVE_FROZEN_AFTER_MS), reason: "anual_vencida" }
  ];
}

/** O maior degrau que os passos dao num instante. */
function degreeOfSteps(steps: LicenseStep[], atMs: number): LicenseDegree {
  return steps.reduce<LicenseDegree>((current, step) => (Date.parse(step.from) <= atMs ? maxDegree(current, step.degree) : current), "ok");
}

const FROZEN_CLOCK_INVALID: LicenseReason[] = [{ degree: "escola_congelada", reason: "relogio_invalido", since: new Date(0).toISOString() }];

export function evaluateLicense(input: LicenseEvaluationInput): LicenseEvaluation {
  const inputNowMs = validMs(input.now);

  if (!input.license && !input.everActivated) {
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

  const base = {
    kind: input.license ? input.license.plan.kind : null,
    validUntil: null,
    provisional: false,
    licensedTo: input.license ? input.license.holder.name : null,
    features: [] as string[],
    grants: [] as string[],
    notice: LICENSE_NOTICE
  };

  // Sem uma hora valida nao da para comparar nenhum prazo: fecha, em vez de liberar. So acontece com o banco
  // mexido; o relogio do servidor sozinho sempre da uma hora valida.
  if (inputNowMs === null) {
    return {
      ...base,
      degree: "escola_congelada",
      enforcedDegree: "escola_congelada",
      observing: false,
      restrictions: restrictionsFor("escola_congelada", true),
      reasons: FROZEN_CLOCK_INVALID,
      nextStep: null
    };
  }

  if (!input.license) {
    // Ja ativada e sem licenca legivel: o banco foi mexido ou a linha se perdeu. A conferencia seguinte traz a
    // licenca de volta. Ate la, nenhum acesso novo (nada prova o direito de dar acesso) e a escada local.
    const fromMs = sinceMs(input.unreadableSince, inputNowMs);
    const reasons = localAnomalyReasons("licenca_ilegivel", fromMs, inputNowMs);
    const degree = highestDegree(reasons);

    return {
      ...base,
      degree,
      enforcedDegree: degree,
      observing: false,
      restrictions: restrictionsFor(degree, true),
      reasons,
      nextStep: localAnomalyNextStep("licenca_ilegivel", fromMs, inputNowMs)
    };
  }

  const license = input.license;
  // A hora nunca fica antes do instante mais novo que o Emissor assinou: relogio voltado para antes da propria
  // licenca nao a deixa nova de novo.
  const nowMs = Math.max(inputNowMs, Date.parse(license.issuedAt));
  const { plan, provisional } = effectivePlan(license, nowMs);
  const reasons: LicenseReason[] = [];
  const nextCandidates: Array<LicenseNextStep | null> = [];

  // 1. Os passos datados pelo Emissor: os da validade do plano que vale agora e os de situacao, sempre.
  for (const step of [...validitySteps(plan), ...license.statusSteps]) {
    if (Date.parse(step.from) <= nowMs) {
      reasons.push({ degree: step.degree, reason: step.reason, since: step.from });
    } else {
      nextCandidates.push({ degree: step.degree, at: step.from, reason: step.reason });
    }
  }

  // A compra na garantia vence numa data: a faixa mostra o que volta a valer nesse dia, se for pior.
  if (provisional && license.provisional) {
    const untilMs = Date.parse(license.provisional.until);
    const degreeAfter = maxDegree(degreeOfSteps(validitySteps(license.plan), untilMs), degreeOfSteps(license.statusSteps, untilMs));

    if (degreeAfter !== "ok") {
      nextCandidates.push({ degree: degreeAfter, at: license.provisional.until, reason: "compra_na_garantia" });
    }
  }

  // 2. Sem contato com o Emissor. Toda conferencia boa troca a licenca por uma nova, entao o ultimo contato e a
  // data de emissao da licenca guardada: assinada, ninguem a adianta pelo banco. A licenca por arquivo nao
  // conversa todo dia: nao recebe o Aviso do 8o dia, mas vence do mesmo jeito.
  const expiresMs = Date.parse(license.expiresAt);
  const lastContactMs = Date.parse(license.issuedAt);

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
    const fromMs = sinceMs(input.hostMismatchSince, nowMs);
    reasons.push(...localAnomalyReasons("endereco_diferente", fromMs, nowMs));
    nextCandidates.push(localAnomalyNextStep("endereco_diferente", fromMs, nowMs));
  }

  const degree = highestDegree(reasons);
  const observing = license.observeUntil !== undefined && nowMs < Date.parse(license.observeUntil);
  const enforcedDegree: LicenseDegree = observing && degreeRank(degree) > degreeRank("aviso") ? "aviso" : degree;

  return {
    ...base,
    degree,
    enforcedDegree,
    observing,
    // Fora do endereco da licenca, nenhum acesso novo ja no Aviso (docs/32 §2.2).
    restrictions: observing ? { ...NO_RESTRICTIONS } : restrictionsFor(enforcedDegree, hostMismatch),
    reasons,
    nextStep: earliestNextStep(nextCandidates, degree),
    kind: plan.kind,
    validUntil: plan.validUntil ?? null,
    provisional,
    features: license.features
      .filter((feature) => feature.until === undefined || nowMs < Date.parse(feature.until))
      .map((feature) => feature.key),
    grants: [...license.grants]
  };
}

/** Atalho para quem so precisa saber se um modulo esta ligado. */
export function isFeatureOn(evaluation: LicenseEvaluation, key: string): boolean {
  return evaluation.features.includes(key);
}

/** Para a faixa: quantos dias faltam para o proximo passo, arredondado para cima. */
export function daysUntil(at: string, now: Date): number {
  const ms = Date.parse(at) - now.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / DAY_MS)) : 0;
}
