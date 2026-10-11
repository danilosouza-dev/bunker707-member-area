import { NextResponse } from "next/server";
import { getSupabaseAdminClient, hasSupabaseConfig } from "@/server/db/supabase/client";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import { jobRegistry } from "@/server/jobs/registry";
import { runJobsTick } from "@/server/jobs/run-tick";
import { authorizeJobsTickRequest } from "@/server/jobs/tick-auth";
import { MAX_TICK_PAYLOAD_BYTES, parseTickMetadata, shouldReadTickBody } from "@/server/jobs/tick-metadata";

// Chamada a cada minuto por pg_cron + pg_net (`public.enqueue_jobs_tick()`), com
// `Authorization: Bearer <JOBS_TICK_TOKEN>`. Ver docs/04-arquitetura-tecnica.md, secao Jobs.
export const runtime = "nodejs";
export const maxDuration = 60;

const noStoreHeaders = { "Cache-Control": "no-store" };

async function readTickMetadata(request: Request): Promise<Record<string, string>> {
  if (!shouldReadTickBody(request)) {
    return {};
  }

  return parseTickMetadata(await readBoundedJson<unknown>(request, MAX_TICK_PAYLOAD_BYTES));
}

export async function POST(request: Request) {
  const authorization = authorizeJobsTickRequest(
    request.headers.get("authorization"),
    process.env.JOBS_TICK_TOKEN
  );

  if (!authorization.ok) {
    if (authorization.status === 503) {
      console.error("JOBS_TICK_TOKEN ausente ou curto demais; tick de jobs recusado.");
    }

    return NextResponse.json(
      { error: authorization.message, ok: false },
      {
        headers: authorization.status === 401
          ? { ...noStoreHeaders, "WWW-Authenticate": "Bearer" }
          : noStoreHeaders,
        status: authorization.status
      }
    );
  }

  if (!hasSupabaseConfig()) {
    console.error("Banco de dados não configurado; tick de jobs recusado.");

    return NextResponse.json(
      { error: "Execução de jobs indisponível: banco de dados não configurado.", ok: false },
      { headers: noStoreHeaders, status: 503 }
    );
  }

  let metadata: Record<string, string>;

  try {
    metadata = await readTickMetadata(request);
  } catch (error) {
    return jsonRouteError(error, "Não foi possível ler o corpo do tick.", 400);
  }

  try {
    const result = await runJobsTick({
      jobs: jobRegistry,
      metadata,
      supabase: getSupabaseAdminClient()
    });

    return NextResponse.json(
      {
        ok: result.ok,
        ran: result.ran,
        ...(result.failed.length ? { failed: result.failed } : {}),
        ...(result.skipped.length ? { skipped: result.skipped } : {})
      },
      { headers: noStoreHeaders, status: result.ok ? 200 : 500 }
    );
  } catch (error) {
    return jsonRouteError(error, "Não foi possível executar o tick de jobs.");
  }
}
