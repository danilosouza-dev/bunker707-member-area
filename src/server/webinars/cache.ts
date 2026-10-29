import "server-only";

import { revalidateTag, updateTag } from "next/cache";

// Cache dos Webinarios (docs/30 §3.1 e §4.6): a tag "webinars" cobre o relatorio de cada sessao (getWebinarReport,
// unstable_cache de 60 s com o minuto do relogio na chave, src/server/webinars/report-queries.ts). Nenhuma acao
// do aluno invalida; as acoes da equipe invalidam pela tag. Mesmo desenho de src/server/communications/cache.ts:
// updateTag dentro de Server Action; revalidateTag(tag, "max") em rota, job ou webhook (updateTag lanca erro
// fora de Server Action no Next 16.4).

export const WEBINARS_TAG = "webinars";

export function invalidateWebinars({ from }: { from: "action" | "route" }) {
  if (from === "action") {
    updateTag(WEBINARS_TAG);
    return;
  }

  revalidateTag(WEBINARS_TAG, "max");
}
