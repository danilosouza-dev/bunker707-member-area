// A chave "Mostrar quantas pessoas estão na sala" guardada por webinario na memoria do processo (docs/30 D102 e D107).
// Modulo puro, sem banco e sem o Next: quem le o banco e room-route.loadPresentCountShown (o sinal de 15 s dos alunos);
// quem esquece e a acao do console (room-actions.setShowPresentCount), para o proximo sinal ja ler a chave nova. Fica a
// parte para a acao nao carregar o modulo das rotas da sala.

/** Quanto a chave lida vale: depois disto, o proximo sinal le o banco de novo (uma leitura por webinario, nao por aluno). */
export const PRESENT_COUNT_REFRESH_MS = 15_000;

const memory = new Map<string, { checkedAt: number; shown: boolean }>();

/** A chave guardada que ainda vale agora; nulo sem ela ou com ela vencida. */
export function rememberedPresentCount(webinarId: string, now: number): boolean | null {
  const cached = memory.get(webinarId);
  return cached && now - cached.checkedAt < PRESENT_COUNT_REFRESH_MS ? cached.shown : null;
}

export function rememberPresentCount(webinarId: string, shown: boolean, now: number) {
  memory.set(webinarId, { checkedAt: now, shown });
}

/** A chave acabou de mudar neste processo: o proximo sinal le o banco, sem esperar os 15 s. */
export function forgetPresentCount(webinarId: string) {
  memory.delete(webinarId);
}

/** Zera a memoria (testes). */
export function resetPresentCountMemory() {
  memory.clear();
}
