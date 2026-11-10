import "server-only";

// O cliente do Emissor (docs/32 §2.1, §11.2 e §11.3): a interface por onde a Instalacao fala com o Emissor.
// Hoje so existe a implementacao "nao configurado", que responde uma falha tipada sem abrir conexao. O cliente
// HTTP de verdade (POST /v1/activate e /v1/check-in, com tempo limite e erros tipados, no molde de
// src/server/ai/account-gateway.ts) vem numa peca seguinte, escrito a partir do documento do protocolo do Emissor,
// junto com o endereco dele gravado no build (como o modo e as raizes, build-config.ts).
//
// Regras que toda implementacao segue:
// - nunca lanca: toda falha volta como { ok: false, error } com um dos codigos abaixo. Falha de rede nunca vira erro
//   do agendador, e a licenca guardada continua valendo (docs/32 §11.3);
// - respeita o `signal`: quem chama poe o tempo limite curto (tick.ts);
// - o `nonce` e sorteado por quem chama, a cada pedido, e volta DENTRO da licenca assinada da resposta. A
//   implementacao so devolve `ok: true` quando a licenca devolvida traz o mesmo nonce: assim uma resposta velha
//   repetida (ou guardada por alguem no meio do caminho) nao volta o relogio da Instalacao (docs/32 §16). O formato
//   BKL1 de hoje ainda nao tem esse campo: ele entra junto com o cliente de verdade, nos dois repositorios, com o
//   vetor tests/fixtures/licenca-vetor.json trocado nos dois;
// - o segredo da Instalacao so vai no pedido ao Emissor: nunca em log, erro ou resposta;
// - a licenca devolvida ainda passa pelo store (store.ts): so e aceita se confere com as raizes, se e desta
//   Instalacao e se nao e mais antiga que a mais nova ja aceita. O cliente nao grava nada.

/**
 * Por que o Emissor nao deu uma licenca nova:
 * - nao_configurado: este build nao fala com o Emissor (hoje, sempre);
 * - sem_resposta: sem rede, DNS, certificado ou tempo esgotado (o servidor do comprador sem saida);
 * - indisponivel: o Emissor respondeu que esta fora (5xx) ou pediu para esperar (429);
 * - recusado: o Emissor respondeu e recusou (Instalacao desconhecida, segredo errado, Chave de ativacao gasta);
 * - resposta_invalida: respondeu fora do formato, ou sem o nonce do pedido dentro da licenca.
 */
export type EmissorErrorCode = "nao_configurado" | "sem_resposta" | "indisponivel" | "recusado" | "resposta_invalida";

export const EMISSOR_ERROR_CODES: readonly EmissorErrorCode[] = Object.freeze([
  "nao_configurado",
  "sem_resposta",
  "indisponivel",
  "recusado",
  "resposta_invalida"
]);

export type EmissorFailure = { ok: false; error: EmissorErrorCode };

export type EmissorActivateRequest = {
  /** A Chave de ativacao, de uso unico (docs/32 §11.4). */
  activationKey: string;
  /** O endereco da Instalacao (o nome do host, como a licenca o guarda). */
  host: string;
  /** Sorteado na hora; volta dentro da licenca assinada. */
  nonce: string;
  signal?: AbortSignal;
};

export type EmissorActivateResult =
  | {
      ok: true;
      /** A licenca assinada (texto BKL1), com o nonce do pedido dentro. */
      token: string;
      installationId: string;
      /** O segredo desta Instalacao: o Emissor guarda so o hash (docs/32 §11.4). */
      installationSecret: string;
      /** O numero que a Instalacao apresenta na primeira conferencia (docs/32 §11.2, A sequencia). */
      sequence: string;
    }
  | EmissorFailure;

export type EmissorCheckInRequest = {
  installationId: string;
  installationSecret: string;
  /** O numero devolvido pela conferencia anterior (ou pela ativacao); null se nunca houve. */
  sequence: string | null;
  /** Sorteado a cada conferencia; volta dentro da licenca assinada. */
  nonce: string;
  /** O endereco configurado da Instalacao (o nome do host), para o Emissor registrar onde ela roda. */
  host: string | null;
  signal?: AbortSignal;
};

export type EmissorCheckInResult =
  | {
      ok: true;
      /** A licenca assinada nova (texto BKL1), com o nonce do pedido dentro. */
      token: string;
      /** O numero para apresentar na proxima conferencia. */
      sequence: string;
    }
  | EmissorFailure;

/** O que a Instalacao pede ao Emissor. Desativar e baixar versoes entram com as pecas deles. */
export type EmissorClient = {
  activate(request: EmissorActivateRequest): Promise<EmissorActivateResult>;
  checkIn(request: EmissorCheckInRequest): Promise<EmissorCheckInResult>;
};

const NOT_CONFIGURED: EmissorFailure = Object.freeze({ ok: false, error: "nao_configurado" });

/** O unico cliente de hoje: nenhum pedido sai, toda chamada responde "nao_configurado". */
export const notConfiguredEmissorClient: EmissorClient = Object.freeze({
  async activate(): Promise<EmissorActivateResult> {
    return NOT_CONFIGURED;
  },
  async checkIn(): Promise<EmissorCheckInResult> {
    return NOT_CONFIGURED;
  }
});

/** O cliente que a tarefa de conferencia usa. A peca do cliente HTTP troca o que esta funcao devolve. */
export function emissorClient(): EmissorClient {
  return notConfiguredEmissorClient;
}
