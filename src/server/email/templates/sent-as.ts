// E-mail "enviada em seu nome" (docs/23; docs/19): a pessoa da equipe escolhida em "Quem envia" fica
// sabendo que uma notificacao (ou um fluxo) saiu com a foto e o nome dela. Vai para quem nao publicou;
// o sino nao serve, porque a equipe entra direto no /admin. Botao para o admin so para quem enxerga
// Comunicacao (messaging.write); para os outros (Professor, Suporte, Analista), sem link.
// Modulo puro: tests/comunicacao-avisos-modelo.test.mjs chama `renderSentAsEmail` direto.

import { renderEmailHtml, renderEmailText, type EmailBlock, type EmailContent } from "./layout";

export type SentAsEmailInput = {
  /** Alunos que receberam a notificacao (no fluxo, nao vale). */
  count?: number | null;
  /** Endereco do aviso ou do fluxo no admin; null = sem botao (a pessoa nao ve Comunicacao). */
  link: string | null;
  /** Notificacao avulsa ou fluxo (de notificacoes seguintes ou do construtor). */
  origin: "flow" | "notice";
  /** Quem publicou ou ativou (profiles.full_name); sem nome, "Alguém da equipe". */
  publisherName: string | null;
  /** Titulo da notificacao ou nome do fluxo. */
  title: string;
};

export const SENT_AS_NOTICE_SUBJECT = "Uma notificação saiu em seu nome";
export const SENT_AS_FLOW_SUBJECT = "Um fluxo de notificações usa o seu nome";
export const SENT_AS_UNKNOWN_PUBLISHER = "Alguém da equipe";

const FOOTER = "Você recebeu este e-mail porque faz parte da equipe da Bunker707 e foi escolhido para enviar notificações aos alunos.";

function studentsPhrase(count: number | null | undefined) {
  const value = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;

  return value === 1 ? "1 aluno" : `${new Intl.NumberFormat("pt-BR").format(value)} alunos`;
}

export function sentAsEmailContent(input: SentAsEmailInput): EmailContent {
  const publisher = input.publisherName?.trim() || SENT_AS_UNKNOWN_PUBLISHER;
  const title = input.title.trim();
  const flow = input.origin === "flow";
  const blocks: EmailBlock[] = [
    {
      text: flow
        ? `${publisher} ativou o fluxo “${title}”, que envia notificações em seu nome, com a sua foto e o seu nome.`
        : `${publisher} enviou a notificação “${title}” para ${studentsPhrase(input.count)} em seu nome, com a sua foto e o seu nome.`,
      type: "paragraph"
    },
    { text: `Se você não combinou isso, fale com ${publisher} ou com o dono da escola.`, type: "paragraph" }
  ];

  if (input.link) {
    blocks.push({ label: flow ? "Ver o fluxo" : "Ver a notificação", type: "button", url: input.link });
  }

  return { blocks, footer: FOOTER, heading: flow ? SENT_AS_FLOW_SUBJECT : SENT_AS_NOTICE_SUBJECT };
}

export function renderSentAsEmail(input: SentAsEmailInput) {
  const content = sentAsEmailContent(input);

  return {
    html: renderEmailHtml(content),
    subject: input.origin === "flow" ? SENT_AS_FLOW_SUBJECT : SENT_AS_NOTICE_SUBJECT,
    text: renderEmailText(content)
  };
}
