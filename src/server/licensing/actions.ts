"use server";

// Server Actions da tela Licenca (docs/32 §2.1, §2.3 e §2.4; Configuracoes > Licenca) e do botao Verificar agora das
// faixas do admin: ativar com a Chave de ativacao, Verificar agora, desativar e carregar a licenca por arquivo. Cada uma
// e o `action` de um <form> montado no servidor (nenhum JavaScript novo no navegador) e termina mandando para a tela com
// o codigo do resultado no endereco (screen-result.ts).
//
// - Classe dever_legal: o que so corrige ou protege nunca e barrado, e estas acoes sao o caminho para sair de qualquer
//   degrau. Valem em todo degrau, inclusive na Instalacao nunca ativada, que barra todas as outras classes
//   (allowsActionClass, model.ts: activationOnly).
// - So o dono e os administradores (admin-access.ts), e so no modo "enforce": no "off" a tela nao existe e as acoes
//   respondem como nao encontradas. A permissao "admin.read" (toda a equipe) e o primeiro portao; o papel, o segundo.
// - Toda acao esquece a linha guardada na memoria do processo, refaz a moldura do admin (a faixa) e grava na auditoria
//   so o codigo do resultado: nunca a Chave, o segredo, a sequencia ou a licenca.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { AdminPermissionError } from "@/server/auth/permissions";
import type { AdminAccess } from "@/server/auth/roles";
import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { isLicenseManager } from "./admin-access";
import { licensingMode, trustedRoots } from "./build-config";
import { emissorClient, installationVersions } from "./client";
import { forgetLicenseStateMemory } from "./current-state";
import { MAX_LICENSE_FILE_BYTES, activateWithKey, deactivateInstallation, loadLicenseFile, type LicenseOperationDeps } from "./operations";
import { licenseActionHref, type LicenseActionOutcome } from "./screen-result";
import { licenseStateDbOf } from "./store-db";
import { runLicenseCheckInNow } from "./tick";

/** No modo "off" a tela Licenca nao existe: as acoes dela respondem como nao encontradas. */
class LicenseScreenOffError extends Error {
  readonly status = 404 as const;

  constructor() {
    super("Não encontrado.");
    this.name = "LicenseScreenOffError";
  }
}

function assertLicenseScreen(access: AdminAccess) {
  if (licensingMode() !== "enforce") {
    throw new LicenseScreenOffError();
  }

  if (!isLicenseManager(access)) {
    throw new AdminPermissionError("Só o dono e os administradores da escola mexem na Licença.", 403);
  }
}

function operationDeps(): LicenseOperationDeps {
  const db = licenseStateDbOf(getSupabaseAdminClient());

  return {
    client: emissorClient,
    configuredHost: getConfiguredSiteOrigin,
    db: () => db,
    now: () => new Date(),
    roots: trustedRoots,
    versions: installationVersions
  };
}

/** Depois de toda acao: a proxima leitura vai ao banco, a faixa e refeita e a auditoria leva so o codigo. */
async function afterLicenseAction(actorId: string, action: string, outcome: LicenseActionOutcome) {
  forgetLicenseStateMemory();
  revalidatePath("/admin", "layout");
  await recordAudit(getSupabaseAdminClient(), { action, actorId, entityType: "license", metadata: { resultado: outcome.code } });
}

const activationSchema = z.object({
  chave: z
    .string({ error: "Cole a Chave de ativação." })
    .transform((value) => value.replace(/\s+/g, ""))
    .pipe(
      z
        .string()
        .min(1, "Cole a Chave de ativação.")
        .max(80, "Cole a Chave de ativação inteira. Ela começa com BKA-.")
        .regex(/^[A-Za-z0-9-]+$/, "Cole a Chave de ativação inteira. Ela começa com BKA-.")
    )
});

/** [dono e administrador] Ativa esta Instalacao com a Chave de ativacao: conferencia inicial e ativacao (operations.ts). */
export async function activateLicense(formData: FormData): Promise<void> {
  const result = await runAdminAction("admin.read", "dever_legal", activationSchema, { chave: formData.get("chave") }, async ({ access, input, user }) => {
    assertLicenseScreen(access);
    const outcome = await activateWithKey(operationDeps(), input.chave);
    const back: LicenseActionOutcome = outcome.ok
      ? { code: "ativada", ...(outcome.ports === "ok" ? {} : { note: outcome.ports }) }
      : { code: outcome.error, host: outcome.host, retryAfterSeconds: outcome.retryAfterSeconds };

    await afterLicenseAction(user.id, "license.activate", back);
    return back;
  });

  redirect(licenseActionHref(result, "chave_mal_formada"));
}

const noInput = z.object({});

/** [dono e administrador] Verificar agora: a conferencia com o Emissor na hora, em qualquer degrau (tick.ts). */
export async function checkLicenseNow(): Promise<void> {
  const result = await runAdminAction("admin.read", "dever_legal", noInput, {}, async ({ access, user }) => {
    assertLicenseScreen(access);
    const answer = await runLicenseCheckInNow(operationDeps());
    const back: LicenseActionOutcome = answer.done ? { code: answer.result === "ok" ? "verificada" : answer.result } : { code: answer.reason };

    await afterLicenseAction(user.id, "license.check_now", back);
    return back;
  });

  redirect(licenseActionHref(result, "falhou"));
}

const deactivationSchema = z.object({ confirmar: z.literal("desativar", { error: "Para desativar, marque a confirmação." }) });

/** [dono e administrador] Desativa esta Instalacao: Escola congelada na hora e a vaga da Licenca livre (docs/32 §2.3). */
export async function deactivateLicense(formData: FormData): Promise<void> {
  const result = await runAdminAction("admin.read", "dever_legal", deactivationSchema, { confirmar: formData.get("confirmar") }, async ({ access, user }) => {
    assertLicenseScreen(access);
    const outcome = await deactivateInstallation(operationDeps());
    const back: LicenseActionOutcome = outcome.ok ? { code: "desativada" } : { code: outcome.error, retryAfterSeconds: outcome.retryAfterSeconds };

    await afterLicenseAction(user.id, "license.deactivate", back);
    return back;
  });

  redirect(licenseActionHref(result, "confirmacao_pendente"));
}

const licenseFileSchema = z.object({
  arquivo: z.unknown(),
  texto: z.string().max(MAX_LICENSE_FILE_BYTES, "Este texto é grande demais para ser uma licença.").nullable()
});

/** O texto da licenca: o arquivo escolhido ou, sem ele, o texto colado. */
async function licenseFileText(file: unknown, pasted: string | null): Promise<{ ok: true; text: string } | { ok: false; code: string }> {
  if (file instanceof Blob && file.size > 0) {
    return file.size > MAX_LICENSE_FILE_BYTES ? { ok: false, code: "arquivo_grande" } : { ok: true, text: await file.text() };
  }

  return pasted && pasted.trim().length > 0 ? { ok: true, text: pasted } : { ok: false, code: "arquivo_vazio" };
}

/** [dono e administrador] Carrega a licenca por arquivo, conferida aqui com as raizes do produto (docs/32 §2.3). */
export async function uploadLicenseFile(formData: FormData): Promise<void> {
  const result = await runAdminAction(
    "admin.read",
    "dever_legal",
    licenseFileSchema,
    { arquivo: formData.get("arquivo"), texto: formData.get("texto") },
    async ({ access, input, user }) => {
      assertLicenseScreen(access);
      const text = await licenseFileText(input.arquivo, input.texto);
      const outcome = text.ok ? await loadLicenseFile(operationDeps(), text.text) : { ok: false as const, error: text.code };
      const back: LicenseActionOutcome = outcome.ok ? { code: "arquivo_carregado" } : { code: outcome.error };

      await afterLicenseAction(user.id, "license.file_loaded", back);
      return back;
    }
  );

  redirect(licenseActionHref(result, "arquivo_grande"));
}
