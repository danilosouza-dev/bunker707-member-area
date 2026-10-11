// Leitura do corpo opcional do POST /api/jobs/tick.
//
// Modulo puro (sem "server-only" nem aliases) para que os testes em
// tests/jobs-tick.test.mjs possam importa-lo diretamente pelo Node.

export const MAX_TICK_PAYLOAD_BYTES = 4_096;

const MAX_TICK_SOURCE_LENGTH = 40;
const MAX_TICK_SCHEDULED_AT_LENGTH = 64;

type TickRequestHead = Pick<Request, "body" | "headers">;

// O corpo e opcional: so e lido quando enviado como JSON (o pg_net sempre envia).
export function shouldReadTickBody(request: TickRequestHead) {
  const contentType = request.headers.get("content-type") ?? "";

  return Boolean(request.body) &&
    request.headers.get("content-length") !== "0" &&
    contentType.includes("application/json");
}

function readShortString(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength ? value : undefined;
}

// Guarda em `job_runs.metadata` so `source` e `scheduled_at`, curtos e em texto; o resto e descartado.
export function parseTickMetadata(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const { scheduled_at: rawScheduledAt, source: rawSource } = payload as Record<string, unknown>;
  const source = readShortString(rawSource, MAX_TICK_SOURCE_LENGTH);
  const scheduledAt = readShortString(rawScheduledAt, MAX_TICK_SCHEDULED_AT_LENGTH);

  return {
    ...(source ? { source } : {}),
    ...(scheduledAt ? { scheduled_at: scheduledAt } : {})
  };
}
