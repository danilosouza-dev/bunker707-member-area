// O adaptador que pede e devolve a maquina do gravador por hora (docs/30 §5.2 requestRecorder/releaseRecorder, §6.7 e
// I3): o app dispara o workflow "Infra (Hetzner)" (.github/workflows/infra.yml) nas etapas jibri-up / jibri-down pela
// API do GitHub, com um token so de "Actions: write" deste repositorio (GITHUB_INFRA_TOKEN). O app nunca segura o
// HCLOUD_TOKEN e cada subida e descida fica no historico do workflow. Sem o token, o adaptador responde o motivo
// (`not_configured`) e o console mostra a reserva (Gravar no navegador / Enviar gravação, D3). Fora da producao,
// WEBINAR_RECORDER_DISPATCH=fake troca o GitHub por um duble que so anota os pedidos (docs/30 §10.1; testes de ponta a
// ponta). Sem "server-only": tests/*.test.mjs carregam direto, com `fetch` e o ambiente pelo parametro.

export const INFRA_REPOSITORY = "danilosouza-dev/bunker707-member-area";
export const INFRA_WORKFLOW = "infra.yml";
export const INFRA_REF = "main";

export type RecorderStep = "jibri-down" | "jibri-up";

export type DispatchOutcome =
  | { ok: true; step: RecorderStep }
  | { ok: false; reason: "github_error" | "invalid_session" | "not_configured"; status?: number; step: RecorderStep };

export type RecorderDispatcher = {
  kind: "fake" | "github";
  /** jibri-down da sessao (com `force`, FORCAR=1: apaga mesmo sem a confirmacao do envio). */
  release(sessionId: string, options?: { force?: boolean }): Promise<DispatchOutcome>;
  /** jibri-up da sessao (cria a maquina; ela chama o webhook com `ready` ou `unavailable`). */
  request(sessionId: string): Promise<DispatchOutcome>;
};

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_]{20,255}$/;

/** As OPCOES da etapa (infra/cloud/jibri.sh): CONFIRMADO=sim e a sessao; FORCAR=1 so na devolucao forcada. */
export function recorderStepOptions(step: RecorderStep, sessionId: string, options: { force?: boolean } = {}): string {
  return ["CONFIRMADO=sim", `SESSAO=${sessionId}`, ...(step === "jibri-down" && options.force ? ["FORCAR=1"] : [])].join(" ");
}

/** O pedido de workflow_dispatch pronto (para o adaptador e para os testes conferirem sem rede). */
export function recorderDispatchRequest(input: { force?: boolean; sessionId: string; step: RecorderStep; token: string }): { body: string; headers: Record<string, string>; method: "POST"; url: string } {
  return {
    body: JSON.stringify({ inputs: { etapa: input.step, opcoes: recorderStepOptions(input.step, input.sessionId, { force: input.force }) }, ref: INFRA_REF }),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28"
    },
    method: "POST",
    url: `https://api.github.com/repos/${INFRA_REPOSITORY}/actions/workflows/${INFRA_WORKFLOW}/dispatches`
  };
}

type FetchLike = (url: string, init: { body: string; headers: Record<string, string>; method: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** O adaptador de verdade: um workflow_dispatch por pedido (204 = aceito; o resto vira `github_error` com o status). */
export function githubRecorderDispatcher(token: string, fetchImpl: FetchLike): RecorderDispatcher {
  async function dispatch(step: RecorderStep, sessionId: string, force?: boolean): Promise<DispatchOutcome> {
    if (!SESSION_ID.test(sessionId)) {
      return { ok: false, reason: "invalid_session", step };
    }
    const request = recorderDispatchRequest({ force, sessionId, step, token });
    try {
      const response = await fetchImpl(request.url, { body: request.body, headers: request.headers, method: request.method, signal: AbortSignal.timeout(15_000) });
      return response.ok ? { ok: true, step } : { ok: false, reason: "github_error", status: response.status, step };
    } catch {
      return { ok: false, reason: "github_error", step };
    }
  }
  return {
    kind: "github",
    release: (sessionId, options) => dispatch("jibri-down", sessionId, options?.force),
    request: (sessionId) => dispatch("jibri-up", sessionId)
  };
}

export type FakeDispatch = { force: boolean; sessionId: string; step: RecorderStep };

/** O duble: anota os pedidos (jibri-up / jibri-down) e responde ok; nada sai para a rede. */
export function fakeRecorderDispatcher(log: FakeDispatch[] = []): RecorderDispatcher & { log: FakeDispatch[] } {
  return {
    kind: "fake",
    log,
    release: async (sessionId, options) => {
      log.push({ force: options?.force === true, sessionId, step: "jibri-down" });
      return { ok: true, step: "jibri-down" };
    },
    request: async (sessionId) => {
      log.push({ force: false, sessionId, step: "jibri-up" });
      return { ok: true, step: "jibri-up" };
    }
  };
}

const fakeLog: FakeDispatch[] = [];

/**
 * O adaptador deste ambiente: o duble com WEBINAR_RECORDER_DISPATCH=fake fora da producao; o GitHub com um
 * GITHUB_INFRA_TOKEN valido; senao nulo (quem chama responde `not_configured` e mostra a reserva).
 */
export function recorderDispatcherFrom(env: Record<string, string | undefined>, fetchImpl: FetchLike = fetch as unknown as FetchLike): RecorderDispatcher | null {
  if (env.WEBINAR_RECORDER_DISPATCH === "fake" && env.NODE_ENV !== "production") {
    return fakeRecorderDispatcher(fakeLog);
  }
  const token = (env.GITHUB_INFRA_TOKEN ?? "").trim();
  return TOKEN.test(token) ? githubRecorderDispatcher(token, fetchImpl) : null;
}

/** Os pedidos anotados pelo duble deste processo (so para conferencia em desenvolvimento e testes). */
export function fakeRecorderDispatches(): readonly FakeDispatch[] {
  return fakeLog;
}

/** O resultado quando nao ha adaptador (sem GITHUB_INFRA_TOKEN): o motivo vai para a tela. */
export function notConfigured(step: RecorderStep): DispatchOutcome {
  return { ok: false, reason: "not_configured", step };
}
