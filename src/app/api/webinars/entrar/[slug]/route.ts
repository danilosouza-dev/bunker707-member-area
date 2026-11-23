import { NextResponse } from "next/server";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { noStore } from "@/server/communications/route-support";
import { readBoundedJson } from "@/server/http/bounded-json";
import { roomErrorResponse } from "@/server/webinars/room-route";
import { enterByOpenLink, requestAddress } from "@/server/webinars/guests";
import { isWebinarSlug } from "@/server/webinars/student-model";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import { licenseRouteRefusal } from "@/server/licensing/guards";

// A entrada pelo link aberto (docs/30 §14, D127 a D134): POST /api/webinars/entrar/[slug] com { name, email, phone,
// consent, source, website } (o website e o campo escondido contra robos). Sem sessao: e a porta de quem nao e aluno.
// 200 { data: { email, password, slug } } com a conta de convidado criada (o navegador entra com ela, como o login do
// aluno); 422 { errors } com o campo que falta ou esta errado; 404 com o link desligado, o webinario fora do ar ou que
// nao existe (sem dizer qual); 429 com Retry-After passando de 30 entradas por minuto do mesmo endereco; 409 com o teto
// de entradas do webinario. Corpo em JSON de ate 4 KB (413/400). Resposta sem cache.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ slug: string }> };

const BODY_BYTES = 4_000;

export async function POST(request: Request, context: RouteContext) {
  // Dar acesso novo (a conta de convidado): a Escola congelada barra, como toda matricula (docs/32).
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "matricula", feature: WEBINARS_FEATURE });
  if (licenseRefusal) return licenseRefusal;

  const { slug } = await context.params;

  if (!isWebinarSlug(slug)) {
    return noStore(NextResponse.json({ error: WEBINAR_COPY.linkAberto.entrar.naoAberta }, { status: 404 }));
  }

  try {
    const body = await readBoundedJson<unknown>(request, BODY_BYTES);
    const outcome = await enterByOpenLink({ address: requestAddress(request.headers), body, slug });

    if (!outcome.ok) {
      return noStore(NextResponse.json({ errors: outcome.errors }, { status: 422 }));
    }

    return noStore(NextResponse.json({ data: outcome.credentials }, { status: 200 }));
  } catch (error) {
    const response = roomErrorResponse(error, WEBINAR_COPY.linkAberto.entrar.erro);

    if (response.status === 429) {
      response.headers.set("Retry-After", "60");
    }

    return response;
  }
}
