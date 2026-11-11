// E-mail "Uma venda ficou guardada" (docs/32 §2.2 e §11.3, "Avisos por e-mail"): para os donos e os administradores,
// uma vez por episodio (o degrau que barra o acesso novo e o dia em que ele comecou), quando a primeira venda e guardada.
// Diz o que aconteceu, que a liberacao e automatica e em ordem, que o reembolso antes dela descarta a venda, e onde fica
// a lista. Nunca traz o nome nem o e-mail de quem comprou: a lista no admin traz. Modulo puro: quem enfileira e
// src/server/payments/held-sales-notice.ts; tests/vendas-guardadas.test.mjs chama o render direto.

import { renderEmailHtml, renderEmailText, type EmailBlock, type EmailContent } from "./layout";

export type HeldSalesEmailInput = {
  /** O motivo em palavras (held-sales-model.ts, heldSaleReasonLabel). */
  reasonLabel: string;
  /** A tela Licenca desta escola (a lista das vendas guardadas fica nela); null sem endereco configurado. */
  licenseScreenUrl: string | null;
};

export const HELD_SALES_EMAIL_SUBJECT = "Uma venda ficou guardada";
export const HELD_SALES_EMAIL_FOOTER = "Você recebe este e-mail porque é dono ou administrador desta área de membros.";

export function heldSalesEmailContent(input: HeldSalesEmailInput): EmailContent {
  const blocks: EmailBlock[] = [
    {
      text: `Uma compra chegou pela plataforma de vendas, mas a situação da Licença desta escola não permite acesso novo agora (${input.reasonLabel}). A venda ficou guardada: quem comprou ainda não recebeu o acesso.`,
      type: "paragraph"
    },
    {
      text: "Quando a Licença voltar a permitir acesso novo, as vendas guardadas são liberadas sozinhas, na ordem em que chegaram, com o e-mail de boas-vindas de sempre. A compra reembolsada ou contestada antes disso é descartada e nunca é liberada.",
      type: "paragraph"
    },
    { text: "Pause as ofertas da escola enquanto a Licença não for regularizada.", type: "paragraph" }
  ];

  if (input.licenseScreenUrl) {
    blocks.push({ label: "Ver as vendas guardadas", type: "button", url: input.licenseScreenUrl });
  }

  blocks.push({
    text: "Este é o único e-mail sobre vendas guardadas enquanto a escola estiver nesta situação. Quem já é aluno continua com o acesso que tem.",
    type: "note"
  });

  return { blocks, footer: HELD_SALES_EMAIL_FOOTER, heading: HELD_SALES_EMAIL_SUBJECT };
}

export function renderHeldSalesEmail(input: HeldSalesEmailInput) {
  const content = heldSalesEmailContent(input);

  return { html: renderEmailHtml(content), subject: HELD_SALES_EMAIL_SUBJECT, text: renderEmailText(content) };
}
