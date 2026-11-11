import { NextResponse } from "next/server";
import { getSupabaseAdminClient, hasSupabaseConfig } from "@/server/db/supabase/client";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import { jobRegistry } from "@/server/jobs/registry";
import { runJobsTick } from "@/server/jobs/run-tick";
import { authorizeJobsTickRequest } from "@/server/jobs/tick-auth";
import { MAX_TICK_PAYLOAD_BYTES, parseTickMetadata, shouldReadTickBody } from "@/server/jobs/tick-metadata";
import { readCurrentLicenseState } from "@/server/licensing/current-state";
import { licenseRouteRefusal } from "@/server/licensing/guards";
import { isFeatureEnabled } from "@/server/licensing/require-feature";

// Chamada a cada minuto por pg_cron + pg_net (`public.enqueue_jobs_tick()`), com
// `Authorization: Bearer <JOBS_TICK_TOKEN>`. Ver docs/04-arquitetura-tecnica.md, secao Jobs.
// A licenca (docs/32 §11.3 e §11.8): o tick e dever legal (o que foi agendado antes roda em todo degrau, e a propria
// conferencia da licenca roda aqui), e as tarefas de um modulo desligado ficam de fora. A situacao e lida uma vez, so
// depois do token; no modo "off" nada e lido e toda tarefa roda, como antes.
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
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "dever_legal" });
  if (licenseRefusal) return licenseRefusal;

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
    // A leitura da licenca que falha nao para o tick: as tarefas dos modulos ficam de fora (fecha) e o resto roda.
    const license = await readCurrentLicenseState();
    const result = await runJobsTick({
      isFeatureEnabled: (feature) => isFeatureEnabled(license, feature),
      jobs: jobRegistry,
      metadata,
      supabase: getSupabaseAdminClient()
    });

    return NextResponse.json(
      {
        ok: result.ok,
        ran: result.ran,
        ...(result.failed.length ? { failed: result.failed } : {}),
        ...(result.skipped.length ? { skipped: result.skipped } : {}),
        ...(result.featureOff.length ? { featureOff: result.featureOff } : {})
      },
      { headers: noStoreHeaders, status: result.ok ? 200 : 500 }
    );
  } catch (error) {
    return jsonRouteError(error, "Não foi possível executar o tick de jobs.");
  }
}
