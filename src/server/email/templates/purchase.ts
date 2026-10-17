// E-mail de acesso liberado por compra: nome do produto (ou dos produtos de um combo) e por onde
// entrar. Sai quando a venda chega por webhook e um acesso novo e concedido. Modulo puro.

import { firstNameOf, renderEmailHtml, renderEmailText, type EmailBlock, type EmailContent } from "./layout";

export type PurchaseEmailProduct = {
  title: string;
  /** Pagina do produto na area de membros (origem publica + /conteudo/<id>); null = sem link. */
  url: string | null;
};

export type PurchaseEmailInput = {
  email: string;
  fullName: string | null;
  loginUrl: string;
  products: PurchaseEmailProduct[];
};

const FOOTER = "Você recebeu este e-mail porque uma compra liberou acesso na área de membros da Bunker707. Precisa de ajuda? Responda esta mensagem.";

export function purchaseEmailSubject(products: PurchaseEmailProduct[]) {
  if (products.length === 1) {
    return `Seu acesso a ${products[0].title} foi liberado`;
  }

  return "Seus novos acessos na Bunker707 foram liberados";
}

export function purchaseEmailContent(input: PurchaseEmailInput): EmailContent {
  const single = input.products.length === 1 ? input.products[0] : null;
  const firstUrl = input.products.find((product) => product.url)?.url ?? input.loginUrl;
  const blocks: EmailBlock[] = [
    {
      text: single
        ? `Olá, ${firstNameOf(input.fullName)}! Seu acesso a ${single.title} já está liberado.`
        : `Olá, ${firstNameOf(input.fullName)}! Seus acessos já estão liberados:`,
      type: "paragraph"
    },
    ...(single ? [] : [{ items: input.products.map((product) => ({ label: product.title, url: product.url })), type: "list" as const }]),
    { text: `Entre com o e-mail ${input.email}.`, type: "paragraph" },
    { label: single ? "Começar agora" : "Ver meus cursos", type: "button", url: firstUrl },
    { text: "Ainda não tem senha? Na página de entrar, clique em “Esqueci minha senha” para criar a sua.", type: "note" }
  ];

  return { blocks, footer: FOOTER, heading: single ? "Acesso liberado" : "Acessos liberados" };
}

export function renderPurchaseEmail(input: PurchaseEmailInput) {
  if (input.products.length === 0) {
    throw new Error("E-mail de compra sem produto.");
  }

  const content = purchaseEmailContent(input);

  return { html: renderEmailHtml(content), subject: purchaseEmailSubject(input.products), text: renderEmailText(content) };
}
