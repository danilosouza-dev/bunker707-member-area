// Substituto de "next/headers" nos testes de integracao: fora de um request do Next nao ha cabecalhos
// nem cookies. headers() devolve os de um request local (o app usa o host para montar links de e-mail);
// cookies() devolve um pote vazio. Quem precisa da sessao do aluno no banco usa actAsSignedIn.
// Um teste que precisa de um cabecalho a mais (o prefetch do Next nas visitas de pagina) usa
// definirCabecalhosDoPedido({ ... }) e volta ao normal com definirCabecalhosDoPedido(null).

const pedidoSimulado = (globalThis.__integrationRequestHeaders ??= { extras: null });

export function definirCabecalhosDoPedido(extras) {
  pedidoSimulado.extras = extras ?? null;
}

export async function headers() {
  return new Headers({ host: "127.0.0.1:3100", "x-forwarded-proto": "http", ...(pedidoSimulado.extras ?? {}) });
}

export async function cookies() {
  return {
    delete() {},
    get() {
      return undefined;
    },
    getAll() {
      return [];
    },
    has() {
      return false;
    },
    set() {}
  };
}

export async function draftMode() {
  return { disable() {}, enable() {}, isEnabled: false };
}
