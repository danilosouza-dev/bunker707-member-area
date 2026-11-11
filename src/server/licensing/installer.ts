// A Licenca pelo terminal do servidor (docs/32 §2.1 e §3.2; docs/20 §9D): o que a rota interna
// POST /api/licenca/instalador faz para o `membros licenca` e para o instalador do kit (infra/kit/no-app.mjs, que roda
// dentro do container do app). Duas acoes: "estado" (a situacao, sem segredo) e "ativar" (a conferencia inicial e depois
// a ativacao, as mesmas operacoes da tela Licenca, operations.ts). Puro, sem "server-only" e sem "@/": a rota entrega as
// dependencias e os testes carregam direto.
//
// - So pedido de dentro do servidor: o pedido que traz um cabecalho de proxy (o Caddy sempre poe X-Forwarded-For; a
//   Vercel tambem) responde como rota que nao existe, antes do token. E so com o token do tick (JOBS_TICK_TOKEN), que so
//   o servidor tem: no arquivo de segredos e no ambiente do container.
// - So no modo "enforce" a ativacao existe; o "estado" diz o modo nos dois (o instalador pula a ativacao no "off").
// - A Chave de ativacao so passa por aqui: nunca volta na resposta, nunca vai para o log, e a auditoria leva so o codigo
//   do resultado (como a tela). A resposta nunca traz a licenca, o segredo nem a sequencia da Instalacao.
// - Classe dever_legal (a rota): o caminho para sair de qualquer degrau, inclusive da Instalacao nunca ativada.

import type { LicensingMode } from "./build-config";
import { licenseResultMessage } from "./copy";
import type { ActivationOutcome } from "./operations";
import type { LicenseState } from "./state";

/** O que a rota precisa saber para responder. */
export type InstallerLicenseDeps = {
  mode: () => LicensingMode;
  /** O token do tick configurado no servidor (JOBS_TICK_TOKEN). */
  tickToken: () => string | undefined;
  /** O token Bearer valido? (a comparacao em tempo constante de src/server/jobs/tick-auth.ts). */
  isValidToken: (authorizationHeader: string | null, configured: string | undefined) => "ok" | "sem_token" | "recusado";
  /** O corpo, com teto de tamanho; lanca se nao e JSON ou se e grande demais. */
  readBody: () => Promise<unknown>;
  headers: { get(name: string): string | null };
  /** A situacao da licenca e o que a tela mostra (null quando a leitura falha). */
  overview: () => Promise<InstallerOverview | null>;
  activate: (activationKey: string) => Promise<ActivationOutcome>;
  /** Depois da ativacao: esquecer a linha guardada na memoria do processo e gravar a auditoria (so o codigo). */
  afterActivation: (code: string) => Promise<void>;
};

export type InstallerOverview = {
  state: LicenseState;
  hasInstallationCredentials: boolean;
  lastCheckIn: { emissorTime: Date; localTime: Date } | null;
};

export type InstallerAnswer = { status: number; body: Record<string, unknown> };

/** Os cabecalhos que um proxy poe: um pedido com eles veio de fora do servidor. */
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "cf-connecting-ip"] as const;

const MAX_KEY_LENGTH = 80;

function notFound(): InstallerAnswer {
  return { status: 404, body: { ok: false, codigo: "nao_encontrado" } };
}

function cameThroughProxy(headers: InstallerLicenseDeps["headers"]): boolean {
  return PROXY_HEADERS.some((name) => {
    const value = headers.get(name);
    return typeof value === "string" && value.length > 0;
  });
}

/** A Chave como a tela aceita: sem espacos, so letras, numeros e hifen, ate 80 caracteres. */
export function normalizeActivationKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.replace(/\s+/g, "");
  return key.length > 0 && key.length <= MAX_KEY_LENGTH && /^[A-Za-z0-9-]+$/.test(key) ? key : null;
}

function isoOf(value: Date | null | undefined): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

/** A situacao para o terminal: o que o instalador e o diagnostico precisam, sem segredo e sem o nome do titular. */
function stateBody(overview: InstallerOverview): Record<string, unknown> {
  const { state } = overview;

  if (state.mode === "off") {
    return { ok: true, modo: "off" };
  }

  const evaluation = state.evaluation;
  return {
    ok: true,
    modo: "enforce",
    // Ativada = a Instalacao tem identificador e segredo do Emissor (so o fato). A desativada continua ativada aqui: o
    // instalador nunca ativa de novo por cima de uma ordem do Emissor.
    ativada: overview.hasInstallationCredentials,
    degrau: evaluation.degree,
    degrau_efetivo: evaluation.enforcedDegree,
    observando: evaluation.observing,
    tipo: evaluation.kind,
    validade: evaluation.validUntil,
    provisorio: evaluation.provisional,
    modulos: evaluation.features,
    motivos: evaluation.reasons.map((reason) => reason.reason),
    endereco: state.license?.installation.host ?? null,
    ultima_conferencia: isoOf(overview.lastCheckIn?.emissorTime)
  };
}

export async function handleInstallerLicenseRequest(deps: InstallerLicenseDeps): Promise<InstallerAnswer> {
  if (cameThroughProxy(deps.headers)) {
    return notFound();
  }

  const authorization = deps.isValidToken(deps.headers.get("authorization"), deps.tickToken());

  if (authorization === "sem_token") {
    return { status: 503, body: { ok: false, codigo: "sem_token", mensagem: "O servidor esta sem JOBS_TICK_TOKEN." } };
  }

  if (authorization !== "ok") {
    return { status: 401, body: { ok: false, codigo: "nao_autorizado" } };
  }

  let body: unknown;

  try {
    body = await deps.readBody();
  } catch {
    return { status: 400, body: { ok: false, codigo: "pedido_invalido" } };
  }

  const action = body && typeof body === "object" ? (body as { acao?: unknown }).acao : undefined;

  if (action === "estado") {
    if (deps.mode() === "off") {
      return { status: 200, body: { ok: true, modo: "off" } };
    }

    const overview = await deps.overview();

    if (!overview) {
      return { status: 200, body: { ok: false, codigo: "leitura_falhou", mensagem: "Nao consegui ler a Licenca no banco (a migracao rodou?)." } };
    }

    return { status: 200, body: stateBody(overview) };
  }

  if (action !== "ativar") {
    return { status: 400, body: { ok: false, codigo: "pedido_invalido" } };
  }

  // No modo "off" nao ha Licenca para ativar: a rota responde como a tela, que nao existe.
  if (deps.mode() !== "enforce") {
    return notFound();
  }

  const key = normalizeActivationKey((body as { chave?: unknown }).chave);

  if (!key) {
    return { status: 400, body: { ok: false, codigo: "chave_mal_formada", mensagem: licenseResultMessage("chave_mal_formada").text } };
  }

  const outcome = await deps.activate(key);
  const code = outcome.ok ? "ativada" : outcome.error;
  await deps.afterActivation(code);

  if (outcome.ok) {
    const note = outcome.ports === "ok" ? null : outcome.ports;
    return {
      status: 200,
      body: {
        ok: true,
        codigo: "ativada",
        mensagem: licenseResultMessage("ativada").text,
        vaga: outcome.slot,
        ...(note ? { aviso: note, mensagem_aviso: licenseResultMessage(note).text } : {})
      }
    };
  }

  return {
    status: 200,
    body: {
      ok: false,
      codigo: outcome.error,
      mensagem: licenseResultMessage(outcome.error, { host: outcome.host ?? null, retryAfterSeconds: outcome.retryAfterSeconds ?? null }).text,
      ...(outcome.host ? { endereco: outcome.host } : {})
    }
  };
}
