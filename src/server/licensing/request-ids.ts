// Os numeros que a Instalacao sorteia para falar com o Emissor (docs/protocolo.md do bunker-licensing). Puro, sem
// "server-only" e sem "@/": a tarefa do tick, a tela Licenca e os testes carregam direto.

import { randomBytes } from "node:crypto";

/**
 * O nonce de cada pedido (ativar, conferir, desativar): 32 bytes aleatorios em base64url (43 caracteres), como o
 * protocolo pede. Volta dentro da licenca assinada; a resposta so vale com o mesmo numero (client.ts).
 */
export function newRequestNonce(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * O identificador sorteado na hora da ativacao (docs/32 §2.1; `instanceId`, 16 a 64 caracteres base64url): o Painel de
 * licencas ve quando outro servidor ativou no mesmo endereco. A conferencia inicial e a ativacao levam o mesmo.
 */
export function newInstanceId(): string {
  return randomBytes(24).toString("base64url");
}
