import { NextResponse } from "next/server";
import { recordAudit } from "@/server/audit/log";
import { requireApiAdmin } from "@/server/auth/guards";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { schoolExportEntries } from "@/server/export/school-data";
import { EXPORT_FILES, README_NAME, exportFileKeys, schoolExportFileName } from "@/server/export/school-data-model";
import { zipStream } from "@/server/export/zip";
import { isLicenseManager } from "@/server/licensing/admin-access";
import { licensingMode } from "@/server/licensing/build-config";
import { licenseRouteRefusal } from "@/server/licensing/guards";

// Exportar dados (docs/32 §2.2 e §4): GET /api/admin/dados/exportar devolve um ZIP com o LEIA-ME e os CSVs da escola
// (alunos, acessos, progresso, cursos, modulos e aulas, pacotes, turmas, vendas, no produto vendido as vendas guardadas,
// e a equipe), em fluxo: cada arquivo e lido do banco pagina a pagina enquanto o download anda (src/server/export).
// - Dever legal: passa em todo degrau da Licenca, inclusive na copia nunca ativada e com a licenca que nao pode ser lida
//   (a guarda nem le a licenca); no modo "off", igual.
// - So o dono e os administradores (admin-access.ts, o mesmo criterio da tela Licenca); o resto da equipe recebe 403.
// - Auditoria: o pedido (quem, quando, quais arquivos) antes de mandar o primeiro byte, e as linhas de cada arquivo no fim.
// - Nunca sai segredo: nem token, nem hash, nem a licenca, nem o payload das vendas.
// - Sem cache. Um erro no meio interrompe o download (o navegador mostra a falha): nunca sai um ZIP pela metade como
//   se estivesse inteiro.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = "private, no-store";

function noStore(response: Response) {
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}

export async function GET() {
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "dever_legal" });
  if (licenseRefusal) return licenseRefusal;

  const auth = await requireApiAdmin();

  if (auth.response) {
    return noStore(auth.response);
  }

  if (!("access" in auth) || !isLicenseManager(auth.access)) {
    return noStore(NextResponse.json({ error: "Só o dono e os administradores exportam os dados da escola." }, { status: 403 }));
  }

  const db = getSupabaseAdminClient();
  const now = new Date();
  const keys = exportFileKeys({ heldSales: licensingMode() === "enforce" });
  const files = [README_NAME, ...keys.map((key) => EXPORT_FILES[key].name)];
  const actorId = auth.user.id;
  const rows = new Map<string, number>();

  await recordAudit(db, { action: "data.export", actorId, entityType: "school", metadata: { arquivos: files } });

  const zip = zipStream(schoolExportEntries(db, { keys, now, rows }), { modifiedAt: now });
  const body = new ReadableStream<Uint8Array>({
    async cancel() {
      await zip.return(undefined);
    },
    async pull(controller) {
      try {
        const next = await zip.next();

        if (!next.done) {
          controller.enqueue(next.value);
          return;
        }

        controller.close();
        const linhas = Object.fromEntries(rows);
        await recordAudit(db, {
          action: "data.export_finished",
          actorId,
          count: Object.values(linhas).reduce((total, value) => total + value, 0),
          entityType: "school",
          metadata: { linhas }
        });
      } catch (error) {
        console.error(`[exportar] exportacao interrompida: ${error instanceof Error ? error.message : "erro desconhecido"}`);
        controller.error(error);
      }
    }
  });

  return new Response(body, {
    headers: {
      "Cache-Control": NO_STORE,
      "Content-Disposition": `attachment; filename="${schoolExportFileName(now)}"`,
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff"
    },
    status: 200
  });
}
