// E-mail "Live cancelada" (docs/30 §2.3 e §2.7): assunto "Live cancelada: {título}", saudacao pelo primeiro nome e o
// motivo escrito pela equipe (quando ela escreveu um). Sem botao: nao ha para onde ir. Modulo puro:
// tests/email-templates.test.mjs chama `renderWebinarCancelledEmail` direto; quem enfileira e
// src/server/webinars/notify.ts.

import { WEBINAR_COPY } from "../../../lib/webinar-copy";
import { firstNameOf, renderEmailHtml, renderEmailText, type EmailBlock, type EmailContent } from "./layout";

export type WebinarCancelledEmailInput = {
  fullName: string | null;
  /** O motivo do Cancelar (webinars.cancel_reason); vazio = sem a linha do motivo. */
  reason: string | null;
  title: string;
};

export function webinarCancelledEmailContent(input: WebinarCancelledEmailInput): EmailContent {
  const blocks: EmailBlock[] = [{ text: WEBINAR_COPY.email.canceladaCorpo(firstNameOf(input.fullName), input.title), type: "paragraph" }];
  const reason = input.reason?.trim() ?? "";

  if (reason) {
    blocks.push({ text: WEBINAR_COPY.email.canceladaMotivo(reason), type: "paragraph" });
  }

  return { blocks, footer: WEBINAR_COPY.email.rodapeCancelada, heading: WEBINAR_COPY.sino.tituloCancelada };
}

export function renderWebinarCancelledEmail(input: WebinarCancelledEmailInput) {
  const content = webinarCancelledEmailContent(input);

  return { html: renderEmailHtml(content), subject: WEBINAR_COPY.email.canceladaAssunto(input.title), text: renderEmailText(content) };
}
