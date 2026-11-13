import "server-only";

// Quem pode apontar o replay de um webinario para um produto (docs/30 §6.8, D112). A aula do replay nasce dentro de um
// produto, entao escolher o produto pede catalog.content nele (o escopo por curso vale), alem da permissao da
// Comunicacao que a acao ja pediu. Usado pelo Salvar do editor (actions.ts) e pelas acoes do replay
// (replay-lesson-actions.ts). Fica fora dos arquivos "use server": la, todo export vira uma acao chamavel do navegador.

import { requireScope } from "@/server/auth/permissions";
import { can, describeForbidden, type AdminAccess } from "@/server/auth/roles";
import { WebinarError, WebinarFieldError } from "./db";
import type { ReplayLessonTarget } from "./model";

export const REPLAY_TARGET_FORBIDDEN = "Você não pode mexer no conteúdo deste produto. Escolha outro, ou peça a quem cuida dele.";

/** A pessoa mexe no conteudo deste produto? (a acao catalog.content, e o produto dentro dos cursos dela) */
export async function canEditProductContent(access: AdminAccess, productId: string): Promise<boolean> {
  if (!can(access, "catalog.content")) {
    return false;
  }

  try {
    await requireScope(access, "catalog.content", { productIds: [productId] });
    return true;
  } catch {
    return false;
  }
}

/** Publicar replay e ler os modulos: 403 com a frase de quem tenta mexer no conteudo sem poder. */
export async function assertProductContent(access: AdminAccess, productId: string): Promise<void> {
  if (!can(access, "catalog.content")) {
    throw new WebinarError(describeForbidden("catalog.content"), 403);
  }

  await requireScope(access, "catalog.content", { productIds: [productId] });
}

/**
 * O destino do card Publicar replay como aula: so confere quando o produto do destino muda. Quem so edita o resto do
 * webinario nao e barrado pelo destino que outra pessoa escolheu. A recusa vai no campo do produto.
 */
export async function assertReplayTargetAllowed(access: AdminAccess, target: ReplayLessonTarget | null, current: ReplayLessonTarget | null): Promise<void> {
  if (!target?.productId || target.productId === current?.productId) {
    return;
  }

  if (!(await canEditProductContent(access, target.productId))) {
    throw new WebinarFieldError("replayLessonTarget.productId", REPLAY_TARGET_FORBIDDEN);
  }
}
