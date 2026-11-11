"use server";

// As Server Actions de Minhas licencas (docs/32 §2.4; o contrato em docs/api-interna.md do bunker-licensing): informar o
// titular com o aceite dos termos, gerar a Chave de ativacao (e trocar, com a confirmacao) e revogar. Classe atendimento
// (o comprador usando o que ja comprou; docs/32 §11.3), pela sessao conferida no Auth (runStudentAction).
// - So o comprador: as paginas de vendedor ligadas e acesso aberto a um produto marcado como Bunker Members; senao, 404.
// - So o dono: o areaUserId de todo pedido e a conta da sessao; a Licenca precisa estar na lista dessa conta (o Emissor
//   confere de novo).
// - A Chave de ativacao so existe na resposta desta acao, que o navegador mostra uma vez: nunca vai para o banco, para o
//   HTML da pagina, para log nem para cache.
// - O erro do Emissor vira uma frase simples (student-model.ts); o do titular volta no campo.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runStudentAction } from "@/server/actions/run-student-action";
import { HOLDER_MESSAGES, validateHolderForm } from "./holder";
import { LICENSE_ID_PATTERN, type InternalFailure } from "./contract";
import { licenseBuyerContext } from "./student";
import { STUDENT_LICENSE_MESSAGES, studentLicenseErrorMessage } from "./student-model";
import { LICENSE_TERMS_VERSION } from "./terms";

const PAGE_PATH = "/minhas-licencas";

class StudentLicenseError extends Error {
  readonly status: 400 | 404 | 409 | 429 | 422;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(status: 400 | 404 | 409 | 429 | 422, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "StudentLicenseError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** A falha do Emissor como o comprador le, com o status que a tela usa. */
function emissorError(failure: InternalFailure): StudentLicenseError {
  const status = failure.error === "limite_de_pedidos" ? 429 : failure.error === "licenca_nao_encontrada" ? 404 : 409;
  return new StudentLicenseError(status, studentLicenseErrorMessage(failure.error));
}

async function requireBuyer(userId: string) {
  const buyer = await licenseBuyerContext(userId);

  if (!buyer) {
    throw new StudentLicenseError(404, "Não encontrado.");
  }

  return buyer;
}

/** A Licenca precisa estar na lista da conta da sessao (o dono), antes de qualquer pedido que a mude. */
async function requireOwnLicense(userId: string, licenseId: string) {
  const buyer = await requireBuyer(userId);
  const listed = await buyer.client.listLicenses(userId, { requestId: crypto.randomUUID() });

  if (!listed.ok) {
    throw emissorError(listed);
  }

  if (!listed.data.licencas.some((license) => license.id === licenseId)) {
    throw new StudentLicenseError(404, STUDENT_LICENSE_MESSAGES.naoEncontrada);
  }

  return buyer;
}

const holderInputSchema = z.object({
  documento: z.string().max(60).optional().default(""),
  email2: z.string().max(400).optional().default(""),
  nome: z.string().max(400).optional().default(""),
  /** O titular ja existe e so a versao dos termos mudou: o servidor reaproveita o titular que o Emissor tem. */
  somenteTermos: z.boolean().optional().default(false),
  termos: z.boolean()
});

/**
 * Informa o titular e aceita a versao atual dos termos (a versao vem daqui, nunca do navegador). Com `somenteTermos`, so
 * o aceite: o nome, o documento e o segundo e-mail sao os que o Emissor ja tem (o documento nunca volta ao navegador).
 */
export async function saveLicenseHolder(raw: unknown): Promise<ActionResult<{ saved: true }>> {
  return runStudentAction("licenses.holder", "atendimento", holderInputSchema, raw, async ({ input, user }) => {
    const buyer = await requireBuyer(user.id);
    let form: unknown = input;

    if (input.somenteTermos) {
      const listed = await buyer.client.listLicenses(user.id, { requestId: crypto.randomUUID() });

      if (!listed.ok) {
        throw emissorError(listed);
      }

      const holder = listed.data.titular;

      if (!holder) {
        throw new StudentLicenseError(409, "Informe o titular antes de aceitar os termos. Recarregue a página.");
      }

      form = { documento: holder.documento, email2: holder.email2 ?? "", nome: holder.nome, termos: input.termos };
    }

    const checked = validateHolderForm(form, user.email);

    if (!checked.ok) {
      throw new StudentLicenseError(400, Object.values(checked.fieldErrors)[0]?.[0] ?? "Revise os campos destacados.", checked.fieldErrors);
    }

    const saved = await buyer.client.saveHolder(
      user.id,
      { aceiteTermos: { versao: LICENSE_TERMS_VERSION }, documento: checked.data.documento, email2: checked.data.email2, nome: checked.data.nome },
      { requestId: crypto.randomUUID() }
    );

    if (!saved.ok) {
      const field = saved.error === "pedido_invalido" ? saved.details?.campos?.[0] : undefined;

      if (field === "documento" || field === "email2" || field === "nome") {
        const message = field === "documento" ? HOLDER_MESSAGES.documento : field === "email2" ? HOLDER_MESSAGES.email2Igual : HOLDER_MESSAGES.nome;
        throw new StudentLicenseError(400, message, { [field]: [message] });
      }

      throw emissorError(saved);
    }

    revalidatePath(PAGE_PATH);
    return { saved: true };
  });
}

const keyInputSchema = z.object({ confirmReplace: z.boolean().optional(), licenseId: z.string().regex(LICENSE_ID_PATTERN) });

export type GenerateKeyOutcome =
  /** A Chave nova, uma vez so. */
  | { kind: "chave"; key: string; validUntil: string | null; cutAddress: string | null; canceledKeys: number }
  /** A troca precisa da confirmacao: o que vai deixar de valer. */
  | { kind: "confirmar"; address: string | null; pendingKeyFinal: string | null };

/** Gera a Chave de ativacao. Com Chave esperando ou Instalacao no ar, so com `confirmReplace` (a de agora para de valer). */
export async function generateLicenseKey(raw: unknown): Promise<ActionResult<GenerateKeyOutcome>> {
  return runStudentAction("licenses.key", "atendimento", keyInputSchema, raw, async ({ input, user }) => {
    const buyer = await requireOwnLicense(user.id, input.licenseId);
    const issued = await buyer.client.issueKey(
      input.licenseId,
      { areaUserId: user.id, ...(input.confirmReplace ? { confirmarTroca: true } : {}) },
      { requestId: crypto.randomUUID() }
    );

    if (!issued.ok) {
      if (issued.error === "troca_nao_confirmada") {
        return {
          address: issued.details?.instalacao?.endereco ?? null,
          kind: "confirmar",
          pendingKeyFinal: issued.details?.chaveAguardandoUso?.final ?? null
        } satisfies GenerateKeyOutcome;
      }

      throw emissorError(issued);
    }

    // A lista da pagina muda (a chave esperando, a Instalacao cortada); a Chave nao entra em cache nenhum: so volta aqui.
    revalidatePath(PAGE_PATH);

    return {
      canceledKeys: issued.data.chavesCanceladas,
      cutAddress: issued.data.instalacaoDesligada?.endereco ?? null,
      key: issued.data.chave,
      kind: "chave",
      validUntil: issued.data.validaAte
    } satisfies GenerateKeyOutcome;
  });
}

const revokeInputSchema = z.object({ licenseId: z.string().regex(LICENSE_ID_PATTERN) });

/** Revoga sem gerar outra: a Chave esperando deixa de valer e a Instalacao no ar sai da Licenca. */
export async function revokeLicenseKey(raw: unknown): Promise<ActionResult<{ canceledKeys: number; cutAddress: string | null }>> {
  return runStudentAction("licenses.revoke", "atendimento", revokeInputSchema, raw, async ({ input, user }) => {
    const buyer = await requireOwnLicense(user.id, input.licenseId);
    const revoked = await buyer.client.revokeKey(input.licenseId, { areaUserId: user.id }, { requestId: crypto.randomUUID() });

    if (!revoked.ok) {
      throw emissorError(revoked);
    }

    revalidatePath(PAGE_PATH);
    return { canceledKeys: revoked.data.chavesCanceladas, cutAddress: revoked.data.instalacaoDesligada?.endereco ?? null };
  });
}
