import "server-only";

import { revalidateTag, updateTag } from "next/cache";

// Cache da lista curta de pop-ups no ar (src/server/communications/popups.ts, unstable_cache com esta
// tag e 60 s de rede de seguranca). Toda mudanca de pop-up (publicar, editar, pausar, retomar, encerrar,
// excluir) chama invalidateLivePopups depois de gravar. Mesmo padrao de src/server/member-area/cache.ts:
// updateTag dentro de Server Action; revalidateTag(tag, "max") em rota, job ou webhook (updateTag lanca
// erro fora de Server Action no Next 16.4).

export const COMMUNICATIONS_TAG = "communications";
// v3b-1: a chave ganhou "v3b1" porque a entrada mudou de formato (configuracao de cada pop-up junto) e o
// Data Cache da Vercel sobrevive ao deploy: uma entrada do formato da v3a nunca e lida.
// Design do pop-up (docs/26): "design1" pelo mesmo motivo (cada entrada leva o design e as fontes resolvidas).
export const LIVE_POPUPS_CACHE_KEY = ["communications-live-popups", "design1"] as const;

export function invalidateLivePopups({ from }: { from: "action" | "route" }) {
  if (from === "action") {
    updateTag(COMMUNICATIONS_TAG);
    return;
  }

  revalidateTag(COMMUNICATIONS_TAG, "max");
}
