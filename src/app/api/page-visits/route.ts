import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { noStore } from "@/server/communications/route-support";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import { BEACON_PAGE_KEY_PATTERN } from "@/server/member-area/page-visit-model";
import { trackMemberPageVisit } from "@/server/member-area/page-visits";

// Beacon das duas acoes do aluno que nao sao navegacao (docs/23 §5.2): { key: "content:<id>" } ao abrir
// os detalhes de um produto e { key: "checkout:<id>" } ao clicar em Comprar. Mesmo registro das paginas
// (trackMemberPageVisit): so grava para pagina que um fluxo acompanha, nunca para a equipe e no maximo
// uma vez por minuto; nos outros casos responde 204 do mesmo jeito, sem gravar. Escrita de telemetria,
// idempotente: sessao pelas claims do JWT (requireApiSessionUser, sem ida ao Auth). Aceita text/plain
// (navigator.sendBeacon manda assim).

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INVALID_PAGE = "Pagina invalida.";

export async function POST(request: Request) {
  const auth = await requireApiSessionUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  let payload: unknown;

  try {
    payload = await readBoundedJson<unknown>(request, 1_000);
  } catch (error) {
    // Corpo grande demais continua 413; sem corpo ou JSON quebrado e so uma pagina invalida.
    const tooLarge = typeof error === "object" && error !== null && "status" in error && error.status === 413;

    return noStore(tooLarge ? jsonRouteError(error, INVALID_PAGE, 400) : NextResponse.json({ error: INVALID_PAGE }, { status: 400 }));
  }

  const key = payload && typeof payload === "object" ? (payload as { key?: unknown }).key : undefined;

  if (typeof key !== "string" || !BEACON_PAGE_KEY_PATTERN.test(key)) {
    return noStore(NextResponse.json({ error: INVALID_PAGE }, { status: 400 }));
  }

  await trackMemberPageVisit({ pageKey: key, userId: auth.user.id });

  return noStore(new NextResponse(null, { status: 204 }));
}
