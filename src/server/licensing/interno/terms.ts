// Os termos de uso da Licenca do Bunker Members que o comprador aceita em Minhas licencas antes da primeira Chave (docs/32
// §1.3, §1.4 passo 3, §2.4 e §9). RASCUNHO: o texto definitivo e do advogado (A16); o produtor o edita aqui, e a cada
// texto novo a versao muda, o Emissor guarda a versao aceita e Minhas licencas pede o aceite de novo antes da proxima
// Chave. Nada aqui e o contrato: e o lugar dele.
//
// Modulo puro: a pagina mostra e a Server Action manda ao Emissor a versao daqui (nunca a que o navegador enviar).

export const LICENSE_TERMS_VERSION = "rascunho-2026-11-11";

export const LICENSE_TERMS_TITLE = "Termos de uso da Licença do Bunker Members";

/** Os paragrafos do texto. O primeiro avisa que e rascunho enquanto o advogado nao entrega o definitivo. */
export const LICENSE_TERMS_PARAGRAPHS: readonly string[] = [
  "Versão de rascunho. O texto definitivo destes termos está sendo preparado e substituirá este antes da venda aberta.",
  "Cada Licença vale para uma área de membros, num endereço. Ela é do titular informado acima e não pode ser revendida, emprestada nem usada para hospedar a área de outra pessoa ou empresa.",
  "A Licença anual vale 12 meses e pode ser renovada pelo botão Renovar. A Licença vitalícia não tem data de fim.",
  "A área instalada confere a Licença com o nosso serviço uma vez por dia. Quem já é aluno da sua escola nunca perde o acesso por causa da Licença.",
  "A Chave de ativação é de uso único e aparece uma vez só. Ao gerar uma chave nova, a anterior para de funcionar.",
  "Reembolso e chargeback da compra desfazem a Licença."
];
