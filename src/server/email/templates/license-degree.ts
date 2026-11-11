// E-mail "Licenca da escola" (docs/32 §2.2): a Instalacao avisa as contas da equipe com papel de dono ou de administrador
// a cada degrau (Aviso, Admin limitado, Escola congelada), alem da faixa no admin, porque uma faixa num admin que ninguem
// abre nao e aviso. O Emissor avisa o titular pelo lado dele. O texto e o mesmo da faixa (src/server/licensing/copy.ts):
// o que houve, o que vale agora, a data do proximo passo, e os botoes Renovar (o endereco que chega na licenca assinada) e
// Abrir a Licenca (a tela do admin). Nunca "a sua escola sera bloqueada". Modulo puro: quem enfileira e
// src/server/licensing/degree-email.ts; tests/licenca-emails.test.mjs chama o render direto.

import type { LicenseBannerModel } from "../../licensing/copy";
import { renderEmailHtml, renderEmailText, type EmailBlock, type EmailContent } from "./layout";

export type LicenseDegreeEmailInput = {
  /** O que a faixa do admin diz agora (licenseBannerOf). */
  banner: LicenseBannerModel;
  /** O endereco da tela Licenca desta escola; null sem endereco configurado. */
  licenseScreenUrl: string | null;
};

export const LICENSE_DEGREE_EMAIL_FOOTER = "Você recebe este e-mail porque é dono ou administrador desta área de membros.";

export function licenseDegreeEmailContent(input: LicenseDegreeEmailInput): EmailContent {
  const blocks: EmailBlock[] = input.banner.lines.map((text) => ({ text, type: "paragraph" as const }));

  if (input.banner.renewUrl) {
    blocks.push({ label: "Renovar", type: "button", url: input.banner.renewUrl });
  }

  if (input.licenseScreenUrl) {
    blocks.push({ label: "Abrir a Licença", type: "button", url: input.licenseScreenUrl });
  }

  blocks.push({ text: "Quem já é aluno continua com o acesso que tem. Os dados da escola nunca são apagados.", type: "note" });

  return { blocks, footer: LICENSE_DEGREE_EMAIL_FOOTER, heading: input.banner.title };
}

export function renderLicenseDegreeEmail(input: LicenseDegreeEmailInput) {
  const content = licenseDegreeEmailContent(input);

  return { html: renderEmailHtml(content), subject: input.banner.title, text: renderEmailText(content) };
}
