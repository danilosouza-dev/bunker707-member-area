// E-mail de boas-vindas: a conta do aluno acabou de ser criada (venda por webhook, Adicionar aluno ou
// importacao). Diz com qual e-mail entrar e como criar a senha. Texto curto, sem jargao (docs/12).
// Modulo puro: tests/email-templates.test.mjs chama `renderWelcomeEmail` direto.

import { firstNameOf, renderEmailHtml, renderEmailText, type EmailBlock, type EmailContent } from "./layout";

/** Como o aluno vai criar a senha: segue a forma de entrega escolhida em Alunos (docs/17 §1.7.2). */
export type WelcomePasswordHint = "invite" | "temporary_password" | "none";

export type WelcomeEmailInput = {
  email: string;
  fullName: string | null;
  /** Pagina de entrar (origem publica do site + /login). */
  loginUrl: string;
  passwordHint: WelcomePasswordHint;
};

export const WELCOME_EMAIL_SUBJECT = "Seu acesso à Bunker707 está pronto";

/**
 * Assunto do convite que o Supabase Auth envia (modelo "Invite user" no painel; docs/19, secao 2.4).
 * O convite sai na hora e estas boas-vindas saem no proximo tick, entao o convite chega antes:
 * o texto cita o assunto dele em vez de prometer que "ainda vai chegar".
 */
export const INVITE_EMAIL_SUBJECT = "Crie sua senha da Bunker707";

const FOOTER = "Você recebeu este e-mail porque uma conta foi criada para você na área de membros da Bunker707. Precisa de ajuda? Responda esta mensagem.";

function passwordParagraph(hint: WelcomePasswordHint) {
  switch (hint) {
    case "invite":
      return `Para criar a sua senha, abra o e-mail “${INVITE_EMAIL_SUBJECT}”, enviado junto com este, e clique no link. Se não encontrar, confira o spam ou use “Esqueci minha senha” na página de entrar.`;
    case "temporary_password":
      return "A equipe vai te passar uma senha temporária. No primeiro acesso, a plataforma pede para você criar a sua.";
    case "none":
      return "Para criar a sua senha, abra a página de entrar e clique em “Esqueci minha senha”. O link chega neste e-mail.";
  }
}

export function welcomeEmailContent(input: WelcomeEmailInput): EmailContent {
  const blocks: EmailBlock[] = [
    { text: `Olá, ${firstNameOf(input.fullName)}! Sua conta na área de membros da Bunker707 foi criada com o e-mail ${input.email}.`, type: "paragraph" },
    { text: passwordParagraph(input.passwordHint), type: "paragraph" },
    { label: "Entrar na área de membros", type: "button", url: input.loginUrl },
    { text: "Guarde este e-mail: ele tem o endereço da plataforma e o e-mail da sua conta.", type: "note" }
  ];

  return { blocks, footer: FOOTER, heading: "Bem-vindo à Bunker707" };
}

export function renderWelcomeEmail(input: WelcomeEmailInput) {
  const content = welcomeEmailContent(input);

  return { html: renderEmailHtml(content), subject: WELCOME_EMAIL_SUBJECT, text: renderEmailText(content) };
}
