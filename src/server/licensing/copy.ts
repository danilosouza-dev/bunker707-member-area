// O que a equipe da escola le sobre a Licenca (docs/32 §2.2 e §2.4): os nomes dos degraus, os motivos, o proximo
// passo, as faixas do admin, a tela Licenca e os e-mails. Portugues simples, datas no horario de Brasilia. A regra do
// §2.2: dizer "a sua Licenca termina em 10/11/2027", nunca que a escola "sera bloqueada"; quem ja e aluno nunca perde o
// acesso, e o texto diz isso. Puro, sem "server-only" e sem "@/": os testes carregam direto. Nada daqui vai para o aluno:
// o aluno nunca ve aviso sobre a Licenca da escola.

import type { LicenseEvaluation, LicenseNextStep, LicenseReason } from "./evaluate";
import { normalizeHost } from "./evaluate";
import type { LicenseDegree } from "./model";
import type { LicenseState } from "./state";

/** O fuso das datas da Licenca (o Emissor assina os passos a meia-noite de Brasilia). */
export const LICENSE_TIME_ZONE = "America/Sao_Paulo";

export type LicenseDegreeName = LicenseDegree | "nao_ativada";

export const LICENSE_DEGREE_LABELS: Readonly<Record<LicenseDegreeName, string>> = Object.freeze({
  ok: "Em dia",
  aviso: "Aviso",
  admin_limitado: "Admin limitado",
  escola_congelada: "Escola congelada",
  nao_ativada: "Não ativada"
});

/** O que cada degrau quer dizer para a equipe, em uma frase. */
export const LICENSE_DEGREE_MEANINGS: Readonly<Record<LicenseDegreeName, string>> = Object.freeze({
  ok: "Tudo funciona normalmente.",
  aviso: "Por enquanto, tudo continua funcionando.",
  admin_limitado:
    "A equipe não cria, não edita e não publica nada novo. Os alunos seguem normalmente, e o que a lei e a segurança pedem continua liberado.",
  escola_congelada:
    "Ninguém ganha acesso novo, e a equipe não cria nem publica nada novo. Quem já é aluno continua com tudo o que tem.",
  nao_ativada: "Esta escola ainda não foi ativada. Até ativar, só funciona o que a lei e a segurança pedem."
});

/** No Aviso de endereco diferente ou de licenca ilegivel, o acesso novo ja para (docs/32 §2.2). */
export const LICENSE_NEW_ACCESS_STOPPED = "Por enquanto, a equipe continua trabalhando, mas ninguém ganha acesso novo.";

export const LICENSE_PAUSE_OFFERS = "Pause as ofertas da escola enquanto a Licença não for regularizada.";

/** Os modulos que esta versao conhece, pelo nome da tela. Chave desconhecida aparece como veio. */
const FEATURE_LABELS: Readonly<Record<string, string>> = Object.freeze({ webinars: "Webinários" });

export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key;
}

export const LICENSE_KIND_LABELS = Object.freeze({ annual: "Anual", lifetime: "Vitalícia" });

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: LICENSE_TIME_ZONE, year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: LICENSE_TIME_ZONE,
  year: "numeric"
});

function dateOf(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** "10/11/2027", no horario de Brasilia; "" sem data valida. */
export function formatLicenseDate(value: string | Date | null | undefined): string {
  const date = dateOf(value);
  return date ? dateFormatter.format(date) : "";
}

/** "10/11/2027 09:00", no horario de Brasilia; "" sem data valida. */
export function formatLicenseDateTime(value: string | Date | null | undefined): string {
  const date = dateOf(value);
  return date ? dateTimeFormatter.format(date).replace(",", "") : "";
}

/** O que a frase de um motivo precisa saber alem do motivo. */
export type ReasonContext = {
  /** O fim da validade da Licenca anual (a do plano que vale agora). */
  validUntil: string | null;
  /** A emissao assinada da licenca guardada: o ultimo contato com o Emissor. */
  lastContactAt: string | null;
  /** Ate quando o arquivo guardado vale sem contato. */
  fileExpiresAt: string | null;
  /** O endereco da licenca e o configurado da Instalacao. */
  licenseHost: string | null;
  configuredHost: string | null;
};

/** A frase de um motivo (os do Emissor e os que a Instalacao conta sozinha). Motivo novo do Emissor: a frase geral. */
export function licenseReasonSentence(reason: Pick<LicenseReason, "reason" | "since">, context: ReasonContext): string {
  const until = formatLicenseDate(context.validUntil);
  const since = formatLicenseDate(reason.since);

  switch (reason.reason) {
    case "anual_vencendo":
      return until ? `A sua Licença termina em ${until}.` : "A sua Licença está perto do fim.";
    case "anual_carencia":
      return until
        ? `A sua Licença terminou em ${until}. Nos 15 dias de carência, tudo continua funcionando.`
        : "A sua Licença terminou. Nos 15 dias de carência, tudo continua funcionando.";
    case "anual_vencida":
      return until ? `A sua Licença terminou em ${until}.` : "A sua Licença terminou.";
    case "revogada":
    case "pagamento_desfeito":
      return "O pagamento da Licença foi desfeito (reembolso ou contestação).";
    case "suspensa":
    case "licenca_suspensa":
      return "A Licença está suspensa enquanto uma análise é feita.";
    case "desativada":
      return "Esta Instalação foi desativada.";
    case "vaga_liberada":
      return "A vaga desta Licença foi liberada para outra Instalação.";
    case "descumprimento":
      return "A Licença recebeu uma notificação de descumprimento do contrato.";
    case "sem_contato": {
      const last = formatLicenseDate(context.lastContactAt);
      return last ? `Esta escola está sem contato com o Emissor de licenças desde ${last}.` : "Esta escola está sem contato com o Emissor de licenças.";
    }
    case "arquivo_vencido": {
      const expired = formatLicenseDate(context.fileExpiresAt);
      return expired ? `A licença guardada venceu em ${expired}, sem uma conferência nova.` : "A licença guardada venceu, sem uma conferência nova.";
    }
    case "endereco_diferente": {
      const configured = normalizeHost(context.configuredHost);
      return configured && context.licenseHost && configured !== context.licenseHost
        ? `Esta escola está no endereço ${configured}, e a Licença é do endereço ${context.licenseHost}.`
        : "Esta escola está num endereço diferente do endereço da Licença.";
    }
    case "licenca_ilegivel":
      return since ? `A licença guardada não pôde ser conferida (desde ${since}).` : "A licença guardada não pôde ser conferida.";
    case "relogio_invalido":
      return "A hora guardada nesta escola está inválida.";
    default:
      return "A situação da Licença mudou.";
  }
}

const DEGREE_ORDER: readonly LicenseDegreeName[] = ["nao_ativada", "ok", "aviso", "admin_limitado", "escola_congelada"];

/**
 * Os motivos para mostrar: um por codigo, do mais grave para o mais leve, e so o passo mais adiantado da Licenca anual
 * (quem esta na carencia nao precisa ler tambem que a Licenca "termina em").
 */
export function visibleReasons(reasons: readonly LicenseReason[]): LicenseReason[] {
  const codes = new Set(reasons.map((item) => item.reason));
  const hidden = new Set<string>();

  if (codes.has("anual_carencia") || codes.has("anual_vencida")) {
    hidden.add("anual_vencendo");
  }

  if (codes.has("anual_vencida")) {
    hidden.add("anual_carencia");
  }

  const byCode = new Map<string, LicenseReason>();

  for (const item of reasons) {
    const kept = byCode.get(item.reason);

    if (!hidden.has(item.reason) && (!kept || DEGREE_ORDER.indexOf(item.degree) > DEGREE_ORDER.indexOf(kept.degree))) {
      byCode.set(item.reason, item);
    }
  }

  return [...byCode.values()].sort((a, b) => DEGREE_ORDER.indexOf(b.degree) - DEGREE_ORDER.indexOf(a.degree));
}

/** "A partir de 26/11/2027: Admin limitado (a equipe para de criar e publicar)." */
export function nextStepSentence(step: LicenseNextStep | null): string | null {
  const at = step ? formatLicenseDate(step.at) : "";

  if (!step || !at) {
    return null;
  }

  const hint: Record<string, string> = {
    aviso: "um aviso, e tudo continua funcionando",
    admin_limitado: "a equipe para de criar e publicar; os alunos seguem normalmente",
    escola_congelada: "ninguém ganha acesso novo; quem já é aluno continua com o que tem"
  };

  return `A partir de ${at}: ${LICENSE_DEGREE_LABELS[step.degree]} (${hint[step.degree]}).`;
}

/** O contexto das frases a partir da situacao. */
export function reasonContextOf(state: Extract<LicenseState, { mode: "enforce" }>, configuredHost: string | null): ReasonContext {
  const license = state.license;

  return {
    validUntil: state.evaluation.validUntil,
    lastContactAt: license && license.delivery === "online" ? license.issuedAt : null,
    fileExpiresAt: license ? license.expiresAt : null,
    licenseHost: license ? license.installation.host : null,
    configuredHost
  };
}

/** Os motivos que pedem para pausar as ofertas: o que nao e so a Licenca anual chegando ao fim. */
const IRREGULAR_REASONS = new Set(["revogada", "pagamento_desfeito", "suspensa", "licenca_suspensa", "desativada", "vaga_liberada", "descumprimento", "endereco_diferente", "licenca_ilegivel"]);

function asksToPauseOffers(evaluation: LicenseEvaluation): boolean {
  return evaluation.degree === "admin_limitado" || evaluation.degree === "escola_congelada" || evaluation.reasons.some((item) => IRREGULAR_REASONS.has(item.reason));
}

// ---- A faixa do admin ----------------------------------------------------------------------------------

export type LicenseBannerModel = {
  /** O degrau que a faixa conta (no modo de observacao, o calculado). */
  degree: LicenseDegreeName;
  tone: "warning" | "error";
  title: string;
  lines: string[];
  /** O endereco do Renovar, que chega dentro da licenca assinada; null sem licenca legivel ou sem o endereco. */
  renewUrl: string | null;
  /** A Instalacao nunca ativada: a faixa leva a ativar, nao a conferir. */
  needsActivation: boolean;
};

/**
 * A faixa do admin (docs/32 §2.2): o que houve, o que vale agora, a data do proximo passo e o que fazer, com Renovar e
 * Verificar agora (a moldura poe os botoes). Uma faixa para: a Instalacao nunca ativada, cada degrau (Aviso, Admin
 * limitado, Escola congelada, com os motivos: Licenca anual, pagamento desfeito, suspensa, desativada, sem contato,
 * endereco diferente, licenca ilegivel), o modo de observacao e o relogio do servidor errado. Licenca em dia: nenhuma.
 * No modo "off": nenhuma, nunca.
 */
export function licenseBannerOf(state: LicenseState, options: { configuredHost: string | null }): LicenseBannerModel | null {
  if (state.mode !== "enforce") {
    return null;
  }

  const evaluation = state.evaluation;
  const renewUrl = state.license?.links?.renew ?? null;

  if (evaluation.degree === "nao_ativada") {
    return {
      degree: "nao_ativada",
      tone: "error",
      title: "Esta escola ainda não foi ativada",
      lines: ["Ative com a Chave de ativação, na tela Licença. Até ativar, só funciona o que a lei e a segurança pedem."],
      renewUrl: null,
      needsActivation: true
    };
  }

  const context = reasonContextOf(state, options.configuredHost);
  const reasonLines = visibleReasons(evaluation.reasons).map((item) => licenseReasonSentence(item, context));
  const next = nextStepSentence(evaluation.nextStep);

  if (evaluation.degree === "ok") {
    if (!state.clock.clockWrong) {
      return null;
    }

    return {
      degree: "ok",
      tone: "warning",
      title: "O relógio deste servidor está errado",
      lines: [
        "A hora do servidor está mais de 48 horas diferente da hora do Emissor de licenças. Acerte o relógio (NTP). Nada foi limitado por isso, mas um relógio adiantado mais de 48 horas adianta os prazos da Licença."
      ],
      renewUrl,
      needsActivation: false
    };
  }

  const degree = evaluation.degree;
  const lines = [...reasonLines];

  if (evaluation.observing && evaluation.enforcedDegree !== degree) {
    const until = formatLicenseDate(state.license?.observeUntil ?? null);
    lines.push(
      `Modo de observação${until ? ` até ${until}` : ""}: a situação é calculada e avisada, mas nada foi limitado. Fora dele, a escola estaria em ${LICENSE_DEGREE_LABELS[degree]}.`
    );

    if (next) {
      lines.push(next);
    }

    return { degree, tone: "warning", title: "Modo de observação da Licença", lines, renewUrl, needsActivation: false };
  }

  lines.push(degree === "aviso" && evaluation.restrictions.newAccess ? LICENSE_NEW_ACCESS_STOPPED : LICENSE_DEGREE_MEANINGS[degree]);

  if (next) {
    lines.push(next);
  }

  if (asksToPauseOffers(evaluation)) {
    lines.push(LICENSE_PAUSE_OFFERS);
  }

  if (state.clock.clockWrong) {
    lines.push("A hora deste servidor também está mais de 48 horas diferente da hora do Emissor: acerte o relógio (NTP). Adiantado mais de 48 horas, ele adianta os prazos da Licença.");
  }

  const titles: Record<Exclude<LicenseDegree, "ok">, string> = {
    aviso: "Aviso sobre a Licença",
    admin_limitado: "Licença: Admin limitado",
    escola_congelada: "Licença: Escola congelada"
  };

  return { degree, tone: degree === "aviso" ? "warning" : "error", title: titles[degree], lines, renewUrl, needsActivation: false };
}

// ---- Os resultados das acoes da tela Licenca ---------------------------------------------------------

export type LicenseResultTone = "success" | "warning" | "error";
export type LicenseResultMessage = { tone: LicenseResultTone; text: string };

/** Detalhes que alguns resultados trazem (validados antes de chegar aqui). */
export type LicenseResultDetails = { host?: string | null; retryAfterSeconds?: number | null; changes?: number | null };

const SUPPORT = "Fale com o suporte.";
const CLIENT_DEFECT = `O pedido ao Emissor saiu fora do formato (defeito desta versão). ${SUPPORT}`;

/**
 * As frases de cada resultado: sucesso de cada acao, cada codigo de erro do protocolo do Emissor (docs/protocolo.md,
 * "Erros"), os do cliente (client.ts), os do store (store.ts) e os desta tela.
 */
const RESULT_MESSAGES: Readonly<Record<string, LicenseResultMessage>> = Object.freeze({
  // Sucesso.
  ativada: { tone: "success", text: "Pronto: esta escola está ativada." },
  verificada: { tone: "success", text: "Pronto: a Licença foi conferida agora com o Emissor de licenças." },
  desativada: {
    tone: "success",
    text: "Esta Instalação foi desativada. Ela ficou em Escola congelada, e a vaga da Licença está livre para outra Instalação."
  },
  arquivo_carregado: { tone: "success", text: "Pronto: a licença por arquivo foi conferida e guardada." },
  // A conferencia inicial que nao passou inteira (a ativacao seguiu).
  portas_fechadas: {
    tone: "warning",
    text: "O Emissor de licenças não conseguiu abrir as portas 80 e 443 deste servidor de fora. A ativação seguiu, mas confira o firewall do provedor e do servidor."
  },
  sem_ipv4_publico: {
    tone: "warning",
    text: "Este servidor não saiu para a internet por um endereço IPv4 público, e o Emissor não conseguiu conferir as portas 80 e 443. A ativação seguiu, mas confira a rede do servidor."
  },
  // Erros do protocolo.
  pedido_invalido: { tone: "error", text: CLIENT_DEFECT },
  tipo_de_conteudo: { tone: "error", text: CLIENT_DEFECT },
  pedido_grande_demais: { tone: "error", text: CLIENT_DEFECT },
  nao_encontrado: { tone: "error", text: `O Emissor de licenças não reconheceu o pedido (endereço errado nesta versão). ${SUPPORT}` },
  metodo_nao_permitido: { tone: "error", text: CLIENT_DEFECT },
  chave_invalida: {
    tone: "error",
    text: "Esta Chave de ativação não vale. Confira se ela foi copiada inteira (começa com BKA-), ou peça uma Chave nova."
  },
  chave_vencida: { tone: "error", text: "Esta Chave de ativação venceu. Peça uma Chave nova." },
  chave_usada: { tone: "error", text: "Esta Chave de ativação já foi usada. Para ativar de novo, peça uma Chave nova." },
  chave_de_outro_endereco: {
    tone: "error",
    text: "Esta Chave de ativação está reservada para outro endereço. Confira o endereço desta escola, ou peça uma Chave nova."
  },
  licenca_indisponivel: { tone: "error", text: `A Licença desta Chave não está ativa (suspensa ou revogada). ${SUPPORT}` },
  vaga_em_uso: {
    tone: "error",
    text: "A Licença já está em uso em outra Instalação. Desative a Instalação antiga, ou compre outra Licença."
  },
  endereco_em_uso: { tone: "error", text: `Outra Licença já está ativa neste endereço. ${SUPPORT}` },
  endereco_ja_largado: { tone: "error", text: `Esta Licença já saiu deste endereço antes. Voltar para ele é só pelo suporte. ${SUPPORT}` },
  limite_de_mudancas: {
    tone: "error",
    text: `A Licença já teve duas mudanças em 12 meses (troca de endereço, desativar, liberar vaga). A próxima é pelo suporte. ${SUPPORT}`
  },
  credencial_invalida: {
    tone: "error",
    text: "O Emissor de licenças não reconheceu esta Instalação. Se ela foi ativada de novo em outro servidor, esta cópia não confere mais; se não, ative de novo com uma Chave nova."
  },
  limite_de_pedidos: { tone: "error", text: "Pedidos demais ao Emissor de licenças. Espere um pouco e tente de novo." },
  indisponivel: { tone: "error", text: "O Emissor de licenças está fora do ar agora. Tente de novo mais tarde; a licença guardada continua valendo." },
  erro_interno: { tone: "error", text: "O Emissor de licenças teve um erro. Tente de novo mais tarde; a licença guardada continua valendo." },
  // Erros do cliente.
  nao_configurado: { tone: "error", text: `Esta versão não tem o endereço do Emissor de licenças. ${SUPPORT}` },
  sem_endereco: {
    tone: "error",
    text: "O endereço desta escola não está configurado (NEXT_PUBLIC_SITE_URL). Sem ele, não há como falar com o Emissor de licenças."
  },
  sem_resposta: {
    tone: "error",
    text: "Sem resposta do Emissor de licenças: confira se este servidor sai para a internet. A licença guardada continua valendo."
  },
  recusado: { tone: "error", text: `O Emissor de licenças recusou o pedido. ${SUPPORT}` },
  resposta_invalida: { tone: "error", text: "O Emissor de licenças respondeu fora do formato. Tente de novo mais tarde." },
  licenca_invalida: { tone: "error", text: "A licença recebida não confere com a assinatura gravada nesta versão. Nada foi trocado." },
  nonce_diferente: {
    tone: "error",
    text: "A resposta recebida não era deste pedido (pode ser uma resposta antiga repetida). Nada foi trocado. Tente de novo."
  },
  licenca_antiga: { tone: "error", text: "A licença recebida é mais antiga que a que esta escola já tem. Nada foi trocado." },
  outra_instalacao: { tone: "error", text: "A licença recebida é de outra Instalação. Nada foi trocado." },
  erro_inesperado: { tone: "error", text: "Algo deu errado deste lado. Tente de novo; se repetir, fale com o suporte." },
  // Erros desta tela e do store.
  em_andamento: { tone: "warning", text: "Uma conversa com o Emissor de licenças já está em andamento. Tente de novo em um minuto." },
  disputada: { tone: "warning", text: "Outra gravação chegou ao mesmo tempo. Tente de novo." },
  tentativa_substituida: { tone: "warning", text: "Outra conversa com o Emissor de licenças começou no meio desta. Confira a situação abaixo." },
  relogio_invalido: { tone: "error", text: "A hora deste servidor está inválida. Acerte o relógio (NTP) e tente de novo." },
  sem_instalacao: {
    tone: "error",
    text: "Esta escola ainda não tem a conferência pela internet. Ative com a Chave de ativação."
  },
  chave_mal_formada: { tone: "error", text: "Cole a Chave de ativação inteira. Ela começa com BKA-." },
  confirmacao_pendente: { tone: "error", text: "Para desativar, marque a confirmação." },
  arquivo_vazio: { tone: "error", text: "Escolha o arquivo da licença (ou cole o texto dela)." },
  arquivo_grande: { tone: "error", text: "Este arquivo é grande demais para ser uma licença." },
  nao_e_arquivo: { tone: "error", text: "Este texto não é uma licença por arquivo. Use o arquivo da licença que o suporte enviou." },
  endereco_diferente: { tone: "error", text: "Esta licença por arquivo é de outro endereço. Nada foi trocado." },
  sem_permissao: { tone: "error", text: "Só o dono e os administradores da escola mexem na Licença." },
  falhou: { tone: "error", text: "Não foi possível concluir agora. Tente de novo em instantes." }
});

/** Os codigos que a tela aceita na volta (o resto vira a frase geral, nunca texto vindo do endereco). */
export function isLicenseResultCode(code: string | null | undefined): code is string {
  return typeof code === "string" && Object.hasOwn(RESULT_MESSAGES, code);
}

/** A frase de um resultado, com os detalhes (onde a vaga esta em uso, quanto esperar, quantas mudancas). */
export function licenseResultMessage(code: string, details: LicenseResultDetails = {}): LicenseResultMessage {
  const message = isLicenseResultCode(code) ? RESULT_MESSAGES[code] : RESULT_MESSAGES.falhou;

  if (code === "vaga_em_uso" && details.host) {
    return { ...message, text: `A Licença já está em uso no endereço ${details.host}. Desative a Instalação de lá, ou compre outra Licença.` };
  }

  if (code === "limite_de_pedidos" && details.retryAfterSeconds) {
    const minutes = Math.max(1, Math.ceil(details.retryAfterSeconds / 60));
    return { ...message, text: `Pedidos demais ao Emissor de licenças. Espere ${minutes === 1 ? "1 minuto" : `${minutes} minutos`} e tente de novo.` };
  }

  return message;
}
