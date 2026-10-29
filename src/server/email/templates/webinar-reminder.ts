// E-mail dos lembretes da live (docs/30 §2.7): 24 h antes ("Amanhã às {hora}: {título}"), o de 24 h que so saiu no
// proprio dia ("Hoje às {hora}: {título}", a regra do atraso do tick) e 1 h antes ("Começa em 1 hora: {título}"). O
// texto principal e o padrao de src/lib/webinar-copy.ts ou o que a equipe escreveu no card Vaga e lembretes (vazio =
// padrao); o botao leva a pagina da live. Modulo puro: tests/email-templates.test.mjs chama
// `renderWebinarReminderEmail` direto; quem enfileira e src/server/webinars/reminders.ts.

import { WEBINAR_COPY } from "../../../lib/webinar-copy";
import { firstNameOf, renderEmailHtml, renderEmailText, type EmailBlock, type EmailContent } from "./layout";

export type WebinarReminderVariant = "one_hour" | "today" | "tomorrow";

export type WebinarReminderEmailInput = {
  /** Texto escolhido pela equipe (card Vaga e lembretes); vazio = o padrao de webinar-copy.ts. */
  customText?: string | null;
  /** "05/11/2026", em Sao Paulo (saoPauloDate). */
  dateLabel: string;
  fullName: string | null;
  /** Endereco completo da pagina da live (origem publica + /webinarios/<slug>). */
  link: string;
  /** "20:00", em Sao Paulo (saoPauloTime). */
  timeLabel: string;
  title: string;
  variant: WebinarReminderVariant;
};

export function webinarReminderSubject(input: Pick<WebinarReminderEmailInput, "timeLabel" | "title" | "variant">) {
  switch (input.variant) {
    case "tomorrow":
      return WEBINAR_COPY.email.h24Assunto(input.timeLabel, input.title);
    case "today":
      return WEBINAR_COPY.email.hojeAssunto(input.timeLabel, input.title);
    case "one_hour":
      return WEBINAR_COPY.email.h1Assunto(input.title);
  }
}

function defaultParagraph(input: WebinarReminderEmailInput, name: string) {
  switch (input.variant) {
    case "tomorrow":
      return WEBINAR_COPY.email.h24Corpo(name, input.title, input.dateLabel, input.timeLabel);
    case "today":
      return WEBINAR_COPY.email.hojeCorpo(name, input.title, input.timeLabel);
    case "one_hour":
      return WEBINAR_COPY.email.h1Corpo(name, input.title, input.timeLabel);
  }
}

export function webinarReminderEmailContent(input: WebinarReminderEmailInput): EmailContent {
  const name = firstNameOf(input.fullName);
  const custom = input.customText?.trim() ?? "";
  // O texto da equipe entra inteiro, depois da saudacao; o padrao ja traz a saudacao.
  const blocks: EmailBlock[] = custom
    ? [
        { text: `Olá, ${name}.`, type: "paragraph" },
        { text: custom, type: "paragraph" }
      ]
    : [{ text: defaultParagraph(input, name), type: "paragraph" }];

  blocks.push({ label: WEBINAR_COPY.email.botaoEntrar, type: "button", url: input.link });

  return { blocks, footer: WEBINAR_COPY.email.rodapeLembrete, heading: WEBINAR_COPY.email.tituloLembrete };
}

export function renderWebinarReminderEmail(input: WebinarReminderEmailInput) {
  const content = webinarReminderEmailContent(input);

  return { html: renderEmailHtml(content), subject: webinarReminderSubject(input), text: renderEmailText(content) };
}
