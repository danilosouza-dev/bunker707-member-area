// Suporte do aluno (/suporte): canais de atendimento e perguntas frequentes.
//
// Modulo puro (sem React e sem alias "@/"): roda no servidor e nos testes (node --test).
//
// De onde vem cada canal:
// - o link de ajuda que a escola ja configura em Admin › Área de membros › Entrar
//   (platform_settings.loginPage.supportHref: https:// ou mailto:), lido pela pagina /suporte;
// - MEMBER_SUPPORT_CHANNELS: canais fixos da escola escritos aqui no codigo, vazio por padrao.
//   Exemplo: ["https://wa.me/5511999998888", "mailto:suporte@escola.com.br"].
//
// So entram links aceitos por isAllowedLoginSupportHref (https sem usuario/senha no endereco ou
// mailto com um e-mail valido). Qualquer outro (javascript:, http:, data:...) e ignorado.
//
// Formulario de suporte fica para depois: hoje nao existe caixa de entrada no admin para responder.

import { isAllowedLoginSupportHref } from "./login-config";

export type MemberSupportChannelKind = "email" | "help_center" | "whatsapp";

export type MemberSupportChannel = {
  /** Texto do botao: "Enviar e-mail", "Abrir WhatsApp", "Abrir central de ajuda". */
  actionLabel: string;
  description: string;
  /** O que o aluno reconhece: o e-mail, o numero ou o endereco do site. */
  display: string;
  href: string;
  kind: MemberSupportChannelKind;
  label: string;
  /** https abre em nova aba; mailto abre o aplicativo de e-mail. */
  opensNewTab: boolean;
};

/** Canais fixos da escola (alem do link de ajuda da tela de entrar). Vazio por padrao. */
export const MEMBER_SUPPORT_CHANNELS: readonly string[] = [];

const WHATSAPP_HOSTS = new Set(["wa.me", "api.whatsapp.com"]);

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** "5511999998888" -> "+55 11 99999-8888". Outros formatos: "+" e os digitos. */
export function formatMemberSupportPhone(digits: string) {
  const clean = digits.replace(/\D/g, "");

  if (!clean) {
    return "";
  }

  if (clean.startsWith("55") && (clean.length === 12 || clean.length === 13)) {
    const area = clean.slice(2, 4);
    const local = clean.slice(4);
    const split = local.length - 4;

    return `+55 ${area} ${local.slice(0, split)}-${local.slice(split)}`;
  }

  return `+${clean}`;
}

function getWhatsAppDigits(url: URL) {
  if (url.hostname === "wa.me") {
    return url.pathname.replace(/^\/+/, "").split("/")[0]?.replace(/\D/g, "") ?? "";
  }

  return (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
}

/** Link configurado -> canal mostrado ao aluno, ou null quando o link nao e aceito. */
export function parseMemberSupportChannel(href: string | null | undefined): MemberSupportChannel | null {
  const value = href?.trim();

  if (!value || !isAllowedLoginSupportHref(value)) {
    return null;
  }

  if (/^mailto:/i.test(value)) {
    const address = safeDecode(value.slice("mailto:".length));

    return {
      actionLabel: "Enviar e-mail",
      description: "Escreva para a equipe da escola contando o que aconteceu.",
      display: address,
      href: value,
      kind: "email",
      label: "E-mail",
      opensNewTab: false
    };
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (WHATSAPP_HOSTS.has(host)) {
    const phone = formatMemberSupportPhone(getWhatsAppDigits(url));

    return {
      actionLabel: "Abrir WhatsApp",
      description: "Converse com a equipe da escola pelo WhatsApp.",
      display: phone || "WhatsApp da escola",
      href: url.href,
      kind: "whatsapp",
      label: "WhatsApp",
      opensNewTab: true
    };
  }

  return {
    actionLabel: "Abrir central de ajuda",
    description: "Página de atendimento da escola, com respostas e contato.",
    display: host,
    href: url.href,
    kind: "help_center",
    label: "Central de ajuda",
    opensNewTab: true
  };
}

/**
 * Canais validos, sem repeticao, na ordem recebida (link da tela de entrar primeiro, depois os
 * canais fixos de MEMBER_SUPPORT_CHANNELS).
 */
export function getMemberSupportChannels(
  configuredHrefs: ReadonlyArray<string | null | undefined>,
  fixedHrefs: ReadonlyArray<string | null | undefined> = MEMBER_SUPPORT_CHANNELS
): MemberSupportChannel[] {
  const seen = new Set<string>();
  const channels: MemberSupportChannel[] = [];

  for (const href of [...configuredHrefs, ...fixedHrefs]) {
    const channel = parseMemberSupportChannel(href);
    const key = channel?.href.toLowerCase();

    if (!channel || !key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    channels.push(channel);
  }

  return channels;
}

export type MemberSupportFaqItem = {
  answer: string;
  id: string;
  /** Proximo passo dentro da area do aluno (rota interna). */
  link?: { href: string; label: string };
  question: string;
};

/** Perguntas frequentes da pagina /suporte (texto revisado; nada de promessa de prazo). */
export const MEMBER_SUPPORT_FAQ: readonly MemberSupportFaqItem[] = [
  {
    answer:
      "O acesso é liberado depois que o pagamento é confirmado. Entre com o mesmo e-mail usado na compra e confira em Minhas compras. Se o curso não aparecer, fale com a equipe informando o e-mail da compra e o nome do produto.",
    id: "acesso-apos-compra",
    link: { href: "/minhas-compras", label: "Ver minhas compras" },
    question: "Comprei e o curso não apareceu. O que faço?"
  },
  {
    answer:
      "Algumas aulas e módulos são liberados alguns dias depois da compra, por exemplo ao fim do prazo de garantia de 7 dias. A data aparece na lista de aulas e sobre o vídeo, contada a partir da data da sua compra. Outras aulas abrem quando você conclui a aula anterior.",
    id: "liberacao",
    question: "Por que algumas aulas mostram “Liberação em”?"
  },
  {
    answer:
      "Na tela de entrar, use “Esqueci minha senha” para receber no seu e-mail um link de troca. Se você já está dentro da plataforma, pode trocar a senha em Perfil › Segurança.",
    id: "senha",
    link: { href: "/perfil?aba=seguranca", label: "Ir para Segurança" },
    question: "Esqueci minha senha. Como entro?"
  },
  {
    answer:
      "Os arquivos de apoio ficam na aba Materiais de cada aula e, todos juntos, na página Materiais do menu. Alguns materiais pedem que você avalie a aula ou assista uma parte dela antes de liberar.",
    id: "materiais",
    link: { href: "/materiais", label: "Ver materiais" },
    question: "Onde encontro os materiais das aulas?"
  },
  {
    answer:
      "Uma aula conta como concluída quando você assiste o vídeo até o fim ou toca em “Concluir” abaixo do vídeo. O progresso de cada curso é a parte das aulas que você já concluiu.",
    id: "progresso",
    link: { href: "/minha-jornada", label: "Ver minha jornada" },
    question: "Como meu progresso é contado?"
  },
  {
    answer:
      "Em Perfil › Acessos você vê desde quando tem cada acesso e até quando ele vale. Se algo estiver diferente do que você comprou, fale com a equipe da escola.",
    id: "acesso-expirado",
    link: { href: "/perfil?aba=acessos", label: "Ver meus acessos" },
    question: "Meu acesso sumiu ou expirou. E agora?"
  }
];
