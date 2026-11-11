import "server-only";

import type { User } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import type { ZodType } from "zod";
import { actionError, actionOk, toActionError, type ActionResult } from "@/lib/action-result";
import { getAuthenticatedUser } from "@/server/auth/session";
import { readCurrentLicenseState } from "@/server/licensing/current-state";
import type { ActionClass } from "@/server/licensing/model";
import { requireLicensed } from "@/server/licensing/require-feature";

export type StudentActionContext<Input> = { input: Input; user: User };

export const STUDENT_SESSION_EXPIRED = "Sua sessão terminou. Entre de novo para continuar.";

/**
 * Esqueleto das Server Actions da area do aluno (as primeiras: Minhas licencas, docs/32 §2.4). O mesmo contrato de
 * runAdminAction, para a pessoa logada em vez da equipe:
 * 1. a sessao conferida no Auth (getAuthenticatedUser, nunca so os claims): sem ela, 401;
 * 2. a classe da acao no degrau de agora da licenca desta Instalacao (docs/32 §11.3; no modo "off" nada e lido nem
 *    barrado), antes de validar a entrada;
 * 3. schema.parse(rawInput) (erros viram 400 com fieldErrors);
 * 4. handler, que confere o dono do que mexe; qualquer erro vira ActionFailure (nunca lanca para o navegador).
 * O pedido cruzado de outro site ja para no proprio Next: a Server Action so aceita o Origin igual ao Host.
 *
 * O `action` (ex.: "licenses.key") so nomeia a acao no log de erro, que nunca leva a entrada nem o resultado.
 */
export async function runStudentAction<Input, Output>(
  action: string,
  actionClass: ActionClass,
  schema: ZodType<Input>,
  rawInput: unknown,
  handler: (context: StudentActionContext<Input>) => Promise<Output>
): Promise<ActionResult<Output>> {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return actionError(401, STUDENT_SESSION_EXPIRED);
    }

    requireLicensed(await readCurrentLicenseState(), { actionClass });

    const input = schema.parse(rawInput);

    return actionOk(await handler({ input, user }));
  } catch (error) {
    unstable_rethrow(error);

    // O erro do handler com os campos (o titular conferido aqui ou recusado pelo Emissor) volta com eles, como o zod.
    const fieldErrors = (error as { fieldErrors?: unknown } | null)?.fieldErrors;
    const base = toActionError(error);
    const failure =
      base.status === 400 && fieldErrors && typeof fieldErrors === "object" ? actionError(400, base.error, fieldErrors as Record<string, string[]>) : base;

    if (failure.status === 500) {
      console.error(`[student-action:${action}]`, error instanceof Error ? error.name : "erro");
    }

    return failure;
  }
}
