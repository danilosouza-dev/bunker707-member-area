// Provedor de e-mail falso para os testes de integracao (docs/18 §2.5). Entra no lugar de
// src/server/email/provider.ts pelos hooks: a fila (email_outbox), o limite diario, a retentativa e o
// job do tick continuam de verdade no banco local; so a chamada HTTP ao Resend e trocada por uma
// resposta combinada pelo teste. Nenhum e-mail real sai daqui.
//
// Uso: `provedorDeEmailFalso.responder = (mensagem) => ({ ok: true, providerMessageId: "..." })`
// (ou `{ ok: false, outcome: "retry" | "throttle" | "fail", error }`); cada envio fica em `enviados`;
// `provedorDeEmailFalso.ligado = false` simula "sem provedor configurado" (a fila espera).

export const provedorDeEmailFalso = {
  enviados: [],
  ligado: true,
  responder: () => ({ ok: true, providerMessageId: `fake-${Math.random().toString(36).slice(2, 10)}` }),
  zerar() {
    this.enviados = [];
    this.ligado = true;
    this.responder = () => ({ ok: true, providerMessageId: `fake-${Math.random().toString(36).slice(2, 10)}` });
  }
};

const provider = {
  name: "fake",
  async send(message) {
    provedorDeEmailFalso.enviados.push(message);

    return provedorDeEmailFalso.responder(message);
  }
};

export function getEmailProvider() {
  return provedorDeEmailFalso.ligado ? provider : null;
}
