// Minhas licencas como o comprador le (docs/32 §1.2, §1.4 e §2.4): a situacao de cada Licenca em portugues simples, a
// validade, a Instalacao (o endereco e o ultimo contato), os modulos, o Renovar, a Chave de ativacao e o que da para
// fazer; o titular e o aceite dos termos que faltam; e a frase de cada erro do Emissor. Modulo puro: as datas no horario
// de Brasilia (src/lib/member-format.ts), o "hoje" passado por quem chama.

import { formatMemberDateTime, getMemberDayKey } from "../../../lib/member-format";
import type { CustomerLicense, CustomerLicenses, Holder } from "./contract";
import { maskedDocument } from "./holder";
import { LICENSE_TERMS_VERSION } from "./terms";

export type LicenseTone = "success" | "warning" | "error" | "neutral";

export type LicenseCardView = {
  id: string;
  title: string;
  situation: { label: string; tone: LicenseTone; text: string };
  /** "Vale até 11/12/2027", "Sem data de fim" ou o dia em que o prazo comeca. */
  validity: string;
  installation: { address: string; lastContact: string; version: string | null } | null;
  modules: string[];
  key: { text: string; state: "aguardando_uso" | "em_uso" | "nenhuma" };
  /** Gerar a primeira chave (sem Chave esperando nem Instalacao). */
  canGenerate: boolean;
  /** Trocar a chave (ha Chave esperando ou Instalacao no ar: a de agora para de funcionar). */
  canReplace: boolean;
  /** Revogar sem gerar outra. */
  canRevoke: boolean;
  /** Por que os botoes da chave nao aparecem (a Licenca desfeita ou suspensa). */
  blockedReason: string | null;
  /** O que a troca vai cortar, para o aviso antes de confirmar. */
  replaceWarning: string;
  renewUrl: string | null;
};

export type HolderView = {
  name: string;
  document: string;
  email2: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string;
};

export type LicensesView = {
  licenses: LicenseCardView[];
  holder: HolderView | null;
  /** Falta o titular (o primeiro acesso) ou o aceite da versao atual dos termos: o formulario vem antes das Licencas. */
  needsHolder: boolean;
  needsTerms: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Os dias de carencia depois da validade da Licenca anual (docs/32 §2.2), em que tudo continua funcionando. */
export const GRACE_DAYS = 15;
/** A partir de quantos dias antes do fim a Licenca anual aparece como "Vence em breve". */
const SOON_DAYS = 30;

/** "2027-12-11" vira "11/12/2027". */
export function formatCalendarDate(day: string | null | undefined): string {
  const match = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const toTime = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };

  return Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

function situationOf(license: CustomerLicense, today: string): LicenseCardView["situation"] {
  if (license.situacao === "revogada") {
    return { label: "Desfeita", text: "Esta Licença foi desfeita (reembolso, chargeback ou cancelamento). A chave e a instalação dela não funcionam mais.", tone: "error" };
  }

  if (license.situacao === "suspensa") {
    return { label: "Em análise", text: "Esta Licença está em análise pela nossa equipe. Fale com o suporte para saber mais.", tone: "warning" };
  }

  if (license.situacao !== "ativa") {
    return { label: "Em atualização", text: "Não conseguimos mostrar a situação desta Licença agora. Fale com o suporte se precisar.", tone: "neutral" };
  }

  if (license.tipo === "vitalicia") {
    return { label: "Em dia", text: "Licença vitalícia: não tem data de fim.", tone: "success" };
  }

  if (license.prazoComecaEm) {
    return {
      label: "Em dia",
      text: `O prazo de 12 meses começa em ${formatCalendarDate(license.prazoComecaEm)} ou quando você ativar, o que vier primeiro.`,
      tone: "success"
    };
  }

  if (!license.validade) {
    return { label: "Em dia", text: "Licença em dia.", tone: "success" };
  }

  const until = formatCalendarDate(license.validade);
  const left = daysBetween(today, license.validade);

  if (left >= 0) {
    return left <= SOON_DAYS
      ? { label: "Vence em breve", text: `Vale até ${until}. Renove para continuar recebendo versões novas e suporte sem interrupção.`, tone: "warning" }
      : { label: "Em dia", text: `Vale até ${until}.`, tone: "success" };
  }

  const graceEnd = addDays(license.validade, GRACE_DAYS);

  if (daysBetween(today, graceEnd) >= 0) {
    return {
      label: "Na carência",
      text: `Venceu em ${until}. Até ${formatCalendarDate(graceEnd)} tudo continua funcionando; renove antes disso.`,
      tone: "warning"
    };
  }

  return {
    label: "Vencida",
    text: `Venceu em ${until}. A equipe da escola não cria nada novo até a renovação; quem já é aluno continua com acesso.`,
    tone: "error"
  };
}

function keyOf(license: CustomerLicense): LicenseCardView["key"] {
  const final = license.chave.final ? `, terminada em ${license.chave.final}` : "";

  if (license.chave.estado === "aguardando_uso") {
    const until = formatMemberDateTime(license.chave.validaAte);
    const reserved = license.chave.reservadaPara ? ` Reservada para ${license.chave.reservadaPara}.` : "";
    return {
      state: "aguardando_uso",
      text: `Chave gerada em ${formatMemberDateTime(license.chave.geradaEm) || "data desconhecida"}${final}, esperando a instalação${until ? ` (vale até ${until} para começar)` : ""}.${reserved}`
    };
  }

  if (license.chave.estado === "em_uso" || license.instalacao) {
    return { state: "em_uso", text: `A chave${license.chave.final ? ` terminada em ${license.chave.final}` : ""} ativou a instalação abaixo.` };
  }

  return { state: "nenhuma", text: "Nenhuma chave gerada ainda." };
}

function replaceWarningOf(license: CustomerLicense): string {
  const parts: string[] = [];

  if (license.chave.estado === "aguardando_uso") {
    parts.push(`a chave${license.chave.final ? ` terminada em ${license.chave.final}` : ""} que ainda não foi usada deixa de valer`);
  }

  if (license.instalacao) {
    parts.push(
      `a escola em ${license.instalacao.endereco} sai da Licença e fica congelada na próxima conferência (até 24 horas): ninguém ganha acesso novo e a equipe não cria nada; quem já é aluno continua com acesso`
    );
  }

  return parts.length > 0 ? `Ao continuar, ${parts.join(", e ")}.` : "A chave de agora deixa de valer.";
}

export function licenseCardOf(license: CustomerLicense, today: string): LicenseCardView {
  const active = license.situacao === "ativa";
  const key = keyOf(license);
  const hasSomething = license.chave.estado === "aguardando_uso" || license.instalacao !== null;

  return {
    blockedReason: active ? null : license.situacao === "revogada" ? "Esta Licença foi desfeita e não gera chave." : "Esta Licença está em análise e não gera chave agora.",
    canGenerate: active && !hasSomething,
    canReplace: active && hasSomething,
    canRevoke: hasSomething,
    id: license.id,
    installation: license.instalacao
      ? {
          address: license.instalacao.endereco,
          lastContact: license.instalacao.ultimoContato ? formatMemberDateTime(license.instalacao.ultimoContato) : "ainda não conferiu",
          version: license.instalacao.versao
        }
      : null,
    key,
    modules: license.modulos.map((module) => module.nome ?? module.chave),
    renewUrl: license.tipo === "anual" && license.situacao !== "revogada" ? (license.links.renovar ?? null) : null,
    replaceWarning: replaceWarningOf(license),
    situation: situationOf(license, today),
    title: license.tipo === "vitalicia" ? "Licença vitalícia" : "Licença anual",
    validity:
      license.tipo === "vitalicia"
        ? "Sem data de fim"
        : license.prazoComecaEm
          ? `O prazo começa em ${formatCalendarDate(license.prazoComecaEm)} ou quando você ativar`
          : license.validade
            ? `Vale até ${formatCalendarDate(license.validade)}`
            : "Validade em atualização"
  };
}

function holderViewOf(holder: Holder | null, terms: CustomerLicenses["termosAceitos"]): HolderView | null {
  if (!holder) {
    return null;
  }

  return {
    document: maskedDocument(holder.documento),
    email2: holder.email2,
    name: holder.nome,
    termsAcceptedAt: terms?.em ? formatMemberDateTime(terms.em) : "",
    termsVersion: terms?.versao ?? null
  };
}

/** A pagina inteira a partir da resposta do Emissor. `now` decide o "hoje" no horario de Brasilia. */
export function licensesViewOf(data: CustomerLicenses, now: Date): LicensesView {
  const today = getMemberDayKey(now);

  return {
    holder: holderViewOf(data.titular, data.termosAceitos),
    licenses: data.licencas.map((license) => licenseCardOf(license, today)),
    needsHolder: data.titular === null,
    needsTerms: data.termosAceitos?.versao !== LICENSE_TERMS_VERSION
  };
}

/** As frases do comprador para cada erro do Emissor (nunca o codigo nem a frase de la). */
export const STUDENT_LICENSE_MESSAGES = Object.freeze({
  confirmar: "Confirme a troca: a chave de agora vai parar de funcionar.",
  conta: "Sua compra ainda está chegando ao serviço de licenças. Tente de novo em alguns minutos.",
  generico: "Não foi possível concluir agora. Tente de novo em instantes.",
  indisponivel: "Não conseguimos falar com o serviço de licenças agora. Tente de novo em alguns minutos.",
  licencaIndisponivel: "Esta Licença está em análise ou foi desfeita e não gera chave. Fale com o suporte.",
  limite: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
  naoEncontrada: "Não encontramos esta Licença na sua conta. Recarregue a página.",
  titular: "Antes da chave, informe o titular e aceite os termos."
});

export function studentLicenseErrorMessage(code: string): string {
  switch (code) {
    case "licenca_nao_encontrada":
    case "nao_encontrado":
      return STUDENT_LICENSE_MESSAGES.naoEncontrada;
    case "licenca_indisponivel":
      return STUDENT_LICENSE_MESSAGES.licencaIndisponivel;
    case "titular_pendente":
      return STUDENT_LICENSE_MESSAGES.titular;
    case "troca_nao_confirmada":
      return STUDENT_LICENSE_MESSAGES.confirmar;
    case "cliente_desconhecido":
      return STUDENT_LICENSE_MESSAGES.conta;
    case "limite_de_pedidos":
      return STUDENT_LICENSE_MESSAGES.limite;
    case "sem_resposta":
    case "indisponivel":
    case "erro_interno":
    case "resposta_invalida":
    case "credencial_invalida":
    case "nao_configurado":
    case "erro_inesperado":
      return STUDENT_LICENSE_MESSAGES.indisponivel;
    default:
      return STUDENT_LICENSE_MESSAGES.generico;
  }
}
