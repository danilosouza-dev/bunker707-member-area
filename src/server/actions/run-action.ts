import "server-only";

import type { User } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import type { ZodType } from "zod";
import { actionOk, toActionError, type ActionResult } from "@/lib/action-result";
import { requireRole, type AdminAction } from "@/server/auth/permissions";
import type { AdminRole } from "@/server/auth/roles";

export type AdminActionContext<Input> = {
  input: Input;
  role: AdminRole;
  user: User;
};

/**
 * Esqueleto unico das Server Actions do admin:
 * 1. requireRole(action) (401/403 viram ActionFailure);
 * 2. schema.parse(rawInput) (erros viram 400 com fieldErrors);
 * 3. handler; qualquer erro vira ActionFailure via toActionError (nunca lanca para o cliente).
 *
 * Invalidacao de cache e responsabilidade do handler (ex.: invalidateCatalog({ from: "action" })),
 * chamada depois da escrita e antes de devolver os dados.
 *
 * Uso, num arquivo com "use server":
 *   export async function renameProduct(raw: unknown) {
 *     return runAdminAction("catalog.write", renameProductSchema, raw, async ({ input }) => { ... });
 *   }
 */
export async function runAdminAction<Input, Output>(
  action: AdminAction,
  schema: ZodType<Input>,
  rawInput: unknown,
  handler: (context: AdminActionContext<Input>) => Promise<Output>
): Promise<ActionResult<Output>> {
  try {
    const { role, user } = await requireRole(action);
    const input = schema.parse(rawInput);

    return actionOk(await handler({ input, role, user }));
  } catch (error) {
    // redirect()/notFound() do handler seguem o fluxo normal do Next.
    unstable_rethrow(error);

    const failure = toActionError(error);

    if (failure.status === 500) {
      console.error(`[admin-action:${action}]`, error);
    }

    return failure;
  }
}
