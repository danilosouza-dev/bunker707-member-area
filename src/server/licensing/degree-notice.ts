// Os e-mails da Instalacao a cada degrau da Licenca (docs/32 §2.2 e §11.3, "Avisos por e-mail"): para todas as contas da
// equipe com papel de dono ou de administrador, pela fila de e-mail que ja existe (email_outbox), so no modo "enforce".
// Puro, sem "server-only" e sem "@/": quem le o banco e enfileira e degree-email.ts; os testes carregam direto.
//
// Um e-mail por mudanca de degrau. A mudanca e o par "degrau e o instante em que ele comecou" (o motivo mais antigo do
// degrau calculado): enquanto a escola fica no mesmo degrau pelo mesmo motivo, o par nao muda; um degrau novo, ou o
// mesmo degrau de volta noutro dia, muda. Duas travas contra o e-mail repetido: a memoria do processo (o ultimo par
// avisado, para nao tocar na fila a cada minuto) e a chave de idempotencia da fila, unica por par e pessoa (o processo
// que reinicia tenta de novo e a fila ignora). Licenca em dia e Instalacao nunca ativada: nenhum e-mail. No modo de
// observacao, o degrau calculado, com o aviso de que nada foi limitado (o texto da faixa).

import { idempotencyKeyOf } from "../email/outbox-rules";
import { renderLicenseDegreeEmail } from "../email/templates/license-degree";
import { licenseBannerOf } from "./copy";
import type { LicenseDegree } from "./model";
import type { LicenseState } from "./state";

/** O tipo do e-mail na fila (outbox-rules.EMAIL_KINDS). */
export const LICENSE_DEGREE_EMAIL_KIND = "license_degree";

export type LicenseDegreeChange = {
  degree: Exclude<LicenseDegree, "ok">;
  /** Desde quando a escola esta neste degrau (o motivo mais antigo dele), em ISO. */
  since: string;
  /** "aviso:2027-10-12T03:00:00.000Z": o que identifica a mudanca na memoria e na chave da fila. */
  marker: string;
};

/** A mudanca de degrau que vale agora; null com a Licenca em dia, nunca ativada ou no modo "off". */
export function licenseDegreeChangeOf(state: LicenseState | null): LicenseDegreeChange | null {
  if (!state || state.mode !== "enforce") {
    return null;
  }

  const degree = state.evaluation.degree;

  if (degree === "ok" || degree === "nao_ativada") {
    return null;
  }

  const starts = state.evaluation.reasons
    .filter((item) => item.degree === degree)
    .map((item) => Date.parse(item.since))
    .filter((ms) => Number.isFinite(ms));
  const since = new Date(starts.length > 0 ? Math.min(...starts) : 0).toISOString();

  return { degree, since, marker: `${degree}:${since}` };
}

export type LicenseNoticeRecipient = { userId: string; email: string };

export type LicenseNoticeEmail = {
  kind: typeof LICENSE_DEGREE_EMAIL_KIND;
  userId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
};

export type LicenseNoticeMemory = { lastMarker: string | null };

export type LicenseNoticeDeps = {
  state: LicenseState | null;
  /** O endereco configurado da Instalacao: monta o link da tela Licenca e as frases. */
  configuredHost: string | null;
  memory: LicenseNoticeMemory;
  listRecipients: () => Promise<LicenseNoticeRecipient[]>;
  enqueue: (email: LicenseNoticeEmail) => Promise<void>;
};

export type LicenseNoticeResult = { marker: string | null; queued: number; skipped: "sem_degrau" | "ja_avisado" | null };

/** A tela Licenca desta escola, pelo endereco configurado (so http e https). */
export function licenseScreenUrlOf(configuredHost: string | null): string | null {
  if (!configuredHost) {
    return null;
  }

  try {
    const url = new URL(/^https?:\/\//i.test(configuredHost) ? configuredHost : `https://${configuredHost}`);
    return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}/admin/configuracoes/licenca` : null;
  } catch {
    return null;
  }
}

/**
 * Enfileira o e-mail da mudanca de degrau para cada dono e administrador, uma vez por mudanca. Lanca so se a fila ou a
 * leitura das contas lancar (a memoria nao anda: a rodada seguinte tenta de novo, e a chave da fila segura a repeticao).
 */
export async function notifyLicenseDegree(deps: LicenseNoticeDeps): Promise<LicenseNoticeResult> {
  const change = licenseDegreeChangeOf(deps.state);

  if (!change || !deps.state) {
    deps.memory.lastMarker = null;
    return { marker: null, queued: 0, skipped: "sem_degrau" };
  }

  if (deps.memory.lastMarker === change.marker) {
    return { marker: change.marker, queued: 0, skipped: "ja_avisado" };
  }

  const banner = licenseBannerOf(deps.state, { configuredHost: deps.configuredHost });

  if (!banner) {
    return { marker: change.marker, queued: 0, skipped: "sem_degrau" };
  }

  const email = renderLicenseDegreeEmail({ banner, licenseScreenUrl: licenseScreenUrlOf(deps.configuredHost) });
  const recipients = await deps.listRecipients();
  const seen = new Set<string>();
  let queued = 0;

  for (const recipient of recipients) {
    const to = recipient.email.trim();
    const key = to.toLowerCase();

    if (!to || seen.has(key)) {
      continue;
    }

    seen.add(key);
    await deps.enqueue({
      kind: LICENSE_DEGREE_EMAIL_KIND,
      userId: recipient.userId,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: idempotencyKeyOf("license-degree", change.marker, recipient.userId),
      metadata: { degree: change.degree, since: change.since }
    });
    queued += 1;
  }

  deps.memory.lastMarker = change.marker;
  return { marker: change.marker, queued, skipped: null };
}
