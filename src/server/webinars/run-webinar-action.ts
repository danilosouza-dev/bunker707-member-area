import "server-only";

// As Server Actions dos Webinarios (docs/32 §11.8): o mesmo esqueleto de runAdminAction com o modulo dos Webinarios.
// Sem o modulo na licenca, toda acao daqui responde 404 antes de ler a entrada; no modo "off" e runAdminAction como
// sempre. Todo arquivo "use server" de src/server/webinars passa por aqui, nunca por runAdminAction direto (guarda em
// tests/licenca-modulos.guard.test.mjs).

import type { ZodType } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction, type AdminActionClass, type AdminActionContext, type AdminActionOptions } from "@/server/actions/run-action";
import type { AdminAction } from "@/server/auth/permissions";
import { WEBINARS_FEATURE } from "@/server/licensing/features";

export function runWebinarAction<Input, Output>(
  action: AdminAction,
  actionClass: AdminActionClass<Input>,
  schema: ZodType<Input>,
  rawInput: unknown,
  handler: (context: AdminActionContext<Input>) => Promise<Output>,
  options: Omit<AdminActionOptions<Input>, "feature"> = {}
): Promise<ActionResult<Output>> {
  return runAdminAction(action, actionClass, schema, rawInput, handler, { ...options, feature: WEBINARS_FEATURE });
}
