// A enquete no palco da sala do aluno (docs/31 V2-10), a parte pura: qual enquete abre no meio do palco (para responder
// ou para ver o resultado compartilhado), o card "Enquete aberta · você deixou para depois" do chat, o que o "Responder
// depois", o "Responder agora" e o "Fechar" do resultado guardam no navegador e a fusao das enquetes que chegam pela
// releitura da sessao (60 s) e pela leitura das enquetes (15 s, so com uma aberta). Sem "use client" e com imports
// relativos: tests/webinarios-sala-v2-modelo.test.mjs carrega direto pelo Node. Nada aqui le o relogio, a tela ou o
// navegador: tudo chega por parametro.

import type { DeferredPolls } from "../../../../lib/webinar-room-prefs";
import type { StudentPoll } from "../../../../server/webinars/room-rules";

/** A enquete que o palco mostra: `answer` (aberta, para responder) ou `result` (o resultado que a equipe compartilhou). */
export type StagePoll = { mode: "answer" | "result"; poll: StudentPoll };

/** Uma enquete aberta que o aluno ainda nao respondeu. */
function waitingAnswer(poll: StudentPoll): boolean {
  return poll.status === "open" && poll.myOptionIds === null;
}

/**
 * O que abre no meio do palco (V2-10): primeiro a enquete aberta sem resposta que o aluno nao deixou para depois (a
 * primeira da lista, na ordem da equipe); sem ela, o resultado compartilhado que ele ainda nao fechou, so quando a
 * enquete ja nao espera a resposta dele (respondida, ou encerrada): o resultado nunca toma o lugar de uma resposta que
 * ficou para depois. Respondida e sem resultado, nada.
 */
export function stagePollFor(input: { deferredIds: readonly string[]; polls: readonly StudentPoll[]; seenResultIds: readonly string[] }): StagePoll | null {
  const later = new Set(input.deferredIds);
  const toAnswer = input.polls.find((poll) => waitingAnswer(poll) && !later.has(poll.id));
  if (toAnswer) {
    return { mode: "answer", poll: toAnswer };
  }
  const seen = new Set(input.seenResultIds);
  const result = input.polls.find((poll) => poll.results !== null && !seen.has(poll.id) && !waitingAnswer(poll));
  return result ? { mode: "result", poll: result } : null;
}

/**
 * O card do topo do chat (V2-10): a primeira enquete aberta, sem resposta, que o aluno deixou para depois; o "Responder
 * agora" dele a traz de volta ao palco. Respondida, encerrada ou fora do "depois", nenhum card.
 */
export function deferredPollCard(input: { deferredIds: readonly string[]; polls: readonly StudentPoll[] }): StudentPoll | null {
  const later = new Set(input.deferredIds);
  return input.polls.find((poll) => waitingAnswer(poll) && later.has(poll.id)) ?? null;
}

/**
 * A enquete que o atalho E abre no palco: a primeira aberta sem resposta, deixada para depois ou nao. Nula, o atalho
 * abre a aba Enquetes como antes (a enquete aberta ja respondida).
 */
export function pollToReopen(polls: readonly StudentPoll[]): StudentPoll | null {
  return polls.find(waitingAnswer) ?? null;
}

const withId = (ids: readonly string[], id: string) => (ids.includes(id) ? [...ids] : [...ids, id]);

/** "Responder depois" (ou o Esc no palco): a enquete vai para o card do chat e fica la ao recarregar. */
export function deferPoll(polls: DeferredPolls, pollId: string): DeferredPolls {
  return { later: withId(polls.later, pollId), seen: [...polls.seen] };
}

/** "Responder agora" (ou o atalho E): a enquete sai do "depois" e volta ao palco. */
export function resumePoll(polls: DeferredPolls, pollId: string): DeferredPolls {
  return { later: polls.later.filter((id) => id !== pollId), seen: [...polls.seen] };
}

/** O "Fechar" do resultado no palco: ele nao volta a abrir (o resultado continua na aba Enquetes). */
export function markPollResultSeen(polls: DeferredPolls, pollId: string): DeferredPolls {
  return { later: [...polls.later], seen: withId(polls.seen, pollId) };
}

/**
 * Funde as enquetes que chegaram (a releitura da sessao ou a leitura das enquetes) com as da sala: quem chegou diz quais
 * existem e como estao (a enquete encerrada sem resultado sai da lista, e sai da sala), menos a resposta que o aluno
 * acabou de mandar: uma leitura que saiu antes dela traz a enquete ainda sem resposta, e o palco abriria de novo.
 */
export function mergeStudentPolls(previous: readonly StudentPoll[], incoming: readonly StudentPoll[]): StudentPoll[] {
  const known = new Map(previous.map((poll) => [poll.id, poll]));
  return incoming.map((poll) => {
    const before = known.get(poll.id);
    return before && before.myOptionIds !== null && poll.myOptionIds === null ? { ...poll, myOptionIds: before.myOptionIds } : poll;
  });
}

/** A porcentagem de uma opcao no resultado compartilhado (inteira; sem respostas, 0). */
export function pollOptionPercent(poll: Pick<StudentPoll, "results">, optionId: string): number {
  const total = poll.results?.total ?? 0;
  if (total <= 0) {
    return 0;
  }
  return Math.round(((poll.results?.counts[optionId] ?? 0) / total) * 100);
}
