import "server-only";

import type { User } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import type { ZodType } from "zod";
import { actionOk, toActionError, type ActionResult } from "@/lib/action-result";
import { requireRole, requireScope, type AdminAction, type ScopeTarget } from "@/server/auth/permissions";
import type { AdminAccess, AdminRole } from "@/server/auth/roles";

export type AdminActionContext<Input> = {
  /** Permissoes efetivas de quem chamou (ex.: filtrar resultados pelos cursos do Professor). */
  access: AdminAccess;
  input: Input;
  role: AdminRole;
  user: User;
};

export type AdminActionOptions<Input> = {
  /**
   * Em que curso a acao mexe (produto, modulo, aula ou comentario), conferido para quem tem a acao so
   * nos cursos dela; "any" = a acao nao toca curso existente. Sem `target`, essa pessoa e recusada.
   */
  target?: (input: Input) => ScopeTarget;
};

/**
 * Esqueleto unico das Server Actions do admin:
 * 1. requireRole(action) (401/403 viram ActionFailure);
 * 2. schema.parse(rawInput) (erros viram 400 com fieldErrors);
 * 3. requireScope(access, action, options.target(input)) quando a pessoa tem a acao so nos cursos dela;
 * 4. handler; qualquer erro vira ActionFailure via toActionError (nunca lanca para o cliente).
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
  handler: (context: AdminActionContext<Input>) => Promise<Output>,
  options: AdminActionOptions<Input> = {}
): Promise<ActionResult<Output>> {
  try {
    const { access, role, user } = await requireRole(action);
    const input = schema.parse(rawInput);

    await requireScope(access, action, options.target?.(input));

    return actionOk(await handler({ access, input, role, user }));
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
