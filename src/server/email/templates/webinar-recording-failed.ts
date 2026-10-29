// E-mail "A gravação não subiu" (docs/30 §5.3 e §6.7, D3): o finalize.sh do gravador nao conseguiu enviar o MP4 da live
// para a Bunny (state = upload_failed). Vai para quem produz a live (o Apresentador; sem ele, quem criou o webinario)
// com o motivo que a maquina mandou e o botao para o console da live, onde fica o "Enviar gravação" (a reserva da D3).
// O arquivo continua na maquina ate a equipe copiar: o jibri-down recusa apagar. Modulo puro: quem enfileira e
// src/server/webinars/recorder-webhook.ts; tests/webinarios-gravador-webhook.test.mjs chama o render direto.

import { WEBINAR_COPY } from "../../../lib/webinar-copy";
import { renderEmailHtml, renderEmailText, type EmailContent } from "./layout";

export type WebinarRecordingFailedEmailInput = {
  /** O motivo que a maquina mandou (campo `error` do webhook; sem ele, o error_message gravado na gravacao). */
  error: string;
  /** Endereco completo do console da live (origem publica + /admin/comunicacao/webinarios/<id>/sala). */
  link: string;
  title: string;
};

/** O motivo entra numa frase: uma linha so e curto (o corpo do webhook tem ate 2000 caracteres). */
export function recordingFailureReason(error: string | null | undefined): string {
  const text = (error ?? "").replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

export function webinarRecordingFailedEmailContent(input: WebinarRecordingFailedEmailInput): EmailContent {
  return {
    blocks: [
      { text: WEBINAR_COPY.email.gravacaoFalhouCorpo(input.title, recordingFailureReason(input.error)), type: "paragraph" },
      { label: WEBINAR_COPY.email.gravacaoFalhouBotao, type: "button", url: input.link }
    ],
    footer: WEBINAR_COPY.email.gravacaoFalhouRodape,
    heading: WEBINAR_COPY.email.gravacaoFalhouAssunto(input.title)
  };
}

export function renderWebinarRecordingFailedEmail(input: WebinarRecordingFailedEmailInput) {
  const content = webinarRecordingFailedEmailContent(input);

  return { html: renderEmailHtml(content), subject: WEBINAR_COPY.email.gravacaoFalhouAssunto(input.title), text: renderEmailText(content) };
}
