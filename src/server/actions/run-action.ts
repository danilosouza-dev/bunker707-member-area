import "server-only";

import type { User } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import type { ZodType } from "zod";
import { actionOk, toActionError, type ActionResult } from "@/lib/action-result";
import { requireRole, requireScope, type AdminAction, type ScopeTarget } from "@/server/auth/permissions";
import type { AdminAccess, AdminRole } from "@/server/auth/roles";
import { readCurrentLicenseState } from "@/server/licensing/current-state";
import type { FeatureKey } from "@/server/licensing/features";
import type { ActionClass } from "@/server/licensing/model";
import { requireActionClass, requireLicensed } from "@/server/licensing/require-feature";

export type AdminActionContext<Input> = {
  /** Permissoes efetivas de quem chamou (ex.: filtrar resultados pelos cursos do Professor). */
  access: AdminAccess;
  input: Input;
  role: AdminRole;
  user: User;
};

/**
 * A classe da acao (docs/32 §11.3): leitura, atendimento, dever_legal, matricula ou conteudo. Fixa na quase toda
 * acao; as poucas que fazem duas coisas dizem pela entrada validada qual delas e (src/server/actions/action-classes.ts).
 */
export type AdminActionClass<Input> = ActionClass | ((input: Input) => ActionClass);

export type AdminActionOptions<Input> = {
  /**
   * Modulo (feature) de que a acao depende: desligado na licenca, a acao responde 404 antes de ler a entrada (docs/32
   * §11.8). As dos Webinarios passam por runWebinarAction (src/server/webinars/run-webinar-action.ts), que o preenche.
   */
  feature?: FeatureKey;
  /**
   * Em que curso a acao mexe (produto, modulo, aula ou comentario), conferido para quem tem a acao so
   * nos cursos dela; "any" = a acao nao toca curso existente. Sem `target`, essa pessoa e recusada.
   */
  target?: (input: Input) => ScopeTarget;
};

/**
 * Esqueleto unico das Server Actions do admin:
 * 1. requireRole(action) (401/403 viram ActionFailure);
 * 2. a licenca (docs/32 §11.3 e §11.8): o modulo da acao (404) e a classe dela no degrau de agora (403). Uma leitura
 *    da situacao por pedido (readCurrentLicenseState); no modo "off" nada e lido e nada e barrado; com a leitura que
 *    falha, fecha: so o dever legal passa (a tela Licenca, despublicar, apagar). A classe que depende da entrada e
 *    conferida logo depois de validar, ainda antes do handler;
 * 3. schema.parse(rawInput) (erros viram 400 com fieldErrors);
 * 4. requireScope(access, action, options.target(input)) quando a pessoa tem a acao so nos cursos dela;
 * 5. handler; qualquer erro vira ActionFailure via toActionError (nunca lanca para o cliente).
 *
 * Invalidacao de cache e responsabilidade do handler (ex.: invalidateCatalog({ from: "action" })),
 * chamada depois da escrita e antes de devolver os dados.
 *
 * Uso, num arquivo com "use server":
 *   export async function renameProduct(raw: unknown) {
 *     return runAdminAction("catalog.write", "conteudo", renameProductSchema, raw, async ({ input }) => { ... });
 *   }
 */
export async function runAdminAction<Input, Output>(
  action: AdminAction,
  actionClass: AdminActionClass<Input>,
  schema: ZodType<Input>,
  rawInput: unknown,
  handler: (context: AdminActionContext<Input>) => Promise<Output>,
  options: AdminActionOptions<Input> = {}
): Promise<ActionResult<Output>> {
  try {
    const { access, role, user } = await requireRole(action);
    const license = await readCurrentLicenseState();

    requireLicensed(license, { actionClass: typeof actionClass === "function" ? undefined : actionClass, feature: options.feature });

    const input = schema.parse(rawInput);

    if (typeof actionClass === "function") {
      requireActionClass(license, actionClass(input));
    }

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
