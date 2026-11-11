import { NextResponse } from "next/server";
import { recordAudit } from "@/server/audit/log";
import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { readBoundedJson } from "@/server/http/bounded-json";
import { authorizeJobsTickRequest } from "@/server/jobs/tick-auth";
import { licensingMode, trustedRoots } from "@/server/licensing/build-config";
import { emissorClient, installationVersions } from "@/server/licensing/client";
import { forgetLicenseStateMemory, readLicenseOverview } from "@/server/licensing/current-state";
import { licenseRouteRefusal } from "@/server/licensing/guards";
import { handleInstallerLicenseRequest } from "@/server/licensing/installer";
import { activateWithKey } from "@/server/licensing/operations";
import { licenseStateDbOf } from "@/server/licensing/store-db";

// A Licenca pelo terminal do servidor (docs/32 §2.1 e §3.2; docs/20 §9D): o `membros licenca` e o instalador do kit
// chamam esta rota de dentro do container do app (infra/kit/no-app.mjs), com o token do tick. Pedido que passou por um
// proxy (o Caddy, a Vercel) responde 404: ela nao existe para quem esta fora do servidor. A regra mora em
// src/server/licensing/installer.ts; a ativacao e a mesma da tela Licenca (operations.ts). Dever legal: o caminho para
// sair de qualquer degrau, inclusive da Instalacao nunca ativada.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "dever_legal" });
  if (licenseRefusal) return licenseRefusal;

  const answer = await handleInstallerLicenseRequest({
    mode: licensingMode,
    tickToken: () => process.env.JOBS_TICK_TOKEN,
    isValidToken: (header, configured) => {
      const result = authorizeJobsTickRequest(header, configured);
      return result.ok ? "ok" : result.status === 503 ? "sem_token" : "recusado";
    },
    readBody: () => readBoundedJson<unknown>(request, MAX_BODY_BYTES),
    headers: request.headers,
    overview: readLicenseOverview,
    activate: (activationKey) => {
      const db = licenseStateDbOf(getSupabaseAdminClient());
      return activateWithKey(
        { client: emissorClient, configuredHost: getConfiguredSiteOrigin, db: () => db, now: () => new Date(), roots: trustedRoots, versions: installationVersions },
        activationKey
      );
    },
    afterActivation: async (code) => {
      forgetLicenseStateMemory();
      await recordAudit(getSupabaseAdminClient(), { action: "license.activate", actorId: null, entityType: "license", metadata: { resultado: code, origem: "terminal" } });
    }
  });

  return NextResponse.json(answer.body, { headers: noStoreHeaders, status: answer.status });
}
