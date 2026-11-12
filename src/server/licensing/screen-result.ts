// A volta das acoes da tela Licenca (docs/32 §2.4): cada acao termina mandando para a propria tela com o codigo do
// resultado no endereco (?resultado=), e a tela mostra a frase dele (copy.ts). So o codigo e alguns detalhes validados
// vao no endereco: nunca a Chave, o segredo, a sequencia ou a licenca. Codigo desconhecido vira a frase geral, nunca
// texto vindo do endereco. Puro, sem "server-only" e sem "@/": os testes carregam direto.

import type { ActionResult } from "../../lib/action-result";
import { isLicenseResultCode, licenseResultMessage, type LicenseResultMessage } from "./copy";
import { hostSchema } from "./model";

export const LICENSE_SCREEN_HREF = "/admin/configuracoes/licenca";
export const LICENSE_SCREEN_LOGIN_HREF = `/login?next=${encodeURIComponent(LICENSE_SCREEN_HREF)}`;

/** O aviso da conferencia inicial que nao passou inteira (a ativacao seguiu). */
export type LicenseActivationNote = "portas_fechadas" | "sem_ipv4_publico";

/** O que uma acao da tela devolve para a volta. */
export type LicenseActionOutcome = {
  code: string;
  host?: string;
  retryAfterSeconds?: number;
  note?: LicenseActivationNote;
};

/** O endereco da volta: a tela, com o codigo e os detalhes que a frase usa. */
export function licenseResultHref(outcome: LicenseActionOutcome): string {
  const params = new URLSearchParams({ resultado: isLicenseResultCode(outcome.code) ? outcome.code : "falhou" });
  const host = outcome.host ? hostSchema.safeParse(outcome.host) : null;

  if (host?.success) {
    params.set("endereco", host.data);
  }

  if (outcome.retryAfterSeconds !== undefined && Number.isInteger(outcome.retryAfterSeconds) && outcome.retryAfterSeconds > 0) {
    params.set("espera", String(Math.min(outcome.retryAfterSeconds, 86_400)));
  }

  if (outcome.note) {
    params.set("aviso", outcome.note);
  }

  return `${LICENSE_SCREEN_HREF}?${params.toString()}`;
}

/**
 * Para onde a acao manda depois de rodar: o resultado da acao (ActionResult de runAdminAction). Entrada que nao passou
 * na validacao vira o codigo da frase do campo; sessao vencida vai para o login; sem permissao, a frase de quem pode;
 * qualquer outra falha, a frase geral.
 */
export function licenseActionHref(result: ActionResult<LicenseActionOutcome>, invalidInputCode: string): string {
  if (result.ok) {
    return licenseResultHref(result.data);
  }

  switch (result.status) {
    case 400:
      return licenseResultHref({ code: invalidInputCode });
    case 401:
      return LICENSE_SCREEN_LOGIN_HREF;
    case 403:
      return licenseResultHref({ code: "sem_permissao" });
    case 404:
      return LICENSE_SCREEN_HREF;
    default:
      return licenseResultHref({ code: "falhou" });
  }
}

export type LicenseScreenNotice = { result: LicenseResultMessage; note: LicenseResultMessage | null };

function first(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && text.length <= 120 ? text : null;
}

/** O resultado que a tela mostra, lido do endereco; null sem ?resultado=. */
export function parseLicenseScreenNotice(query: Record<string, string | string[] | undefined>): LicenseScreenNotice | null {
  const code = first(query.resultado);

  if (!code) {
    return null;
  }

  const host = hostSchema.safeParse(first(query.endereco));
  const wait = first(query.espera);
  const waitSeconds = wait && /^\d{1,5}$/.test(wait) ? Number(wait) : null;
  const note = first(query.aviso);

  return {
    result: licenseResultMessage(isLicenseResultCode(code) ? code : "falhou", { host: host.success ? host.data : null, retryAfterSeconds: waitSeconds }),
    note: note === "portas_fechadas" || note === "sem_ipv4_publico" ? licenseResultMessage(note) : null
  };
}
