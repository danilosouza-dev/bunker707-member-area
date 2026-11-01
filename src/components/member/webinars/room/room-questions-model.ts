// As regras puras das Perguntas na sala no estilo do YouTube (docs/31; spec §7.3): o filtro dos chips (Todas, Sem
// resposta, Respondidas, Minhas) sobre a lista lida, a frase do vazio que diz o filtro, e a linha de chips que rola de
// lado (as setas so do lado que esconde chip, e o passo do clique). Sem "use client" e com imports relativos: os testes
// de modelo carregam este arquivo direto no Node.
import { WEBINAR_COPY } from "../../../../lib/webinar-copy";
import type { StudentQuestion } from "../../../../server/webinars/room-rules";

/** O filtro dos chips: todas, so as sem resposta (abertas), so as respondidas, so as minhas. */
export type QuestionsFilter = "all" | "answered" | "mine" | "open";
/** A ordem do menu de ordenar do cabecalho. */
export type QuestionsOrder = "recentes" | "votadas";

export const QUESTIONS_FILTERS: readonly QuestionsFilter[] = ["all", "open", "answered", "mine"];
export const QUESTIONS_ORDERS: readonly QuestionsOrder[] = ["votadas", "recentes"];

/**
 * A lista que o aluno ve com o filtro de agora, na ordem que veio. "Sem resposta" e so a aberta (a dispensada nao entra);
 * "Minhas" e toda pergunta minha, inclusive a minha dispensada (a dispensada so chega ao autor).
 */
export function questionsShown<T extends Pick<StudentQuestion, "mine" | "status">>(questions: readonly T[], filter: QuestionsFilter): T[] {
  switch (filter) {
    case "open":
      return questions.filter((question) => question.status === "open");
    case "answered":
      return questions.filter((question) => question.status === "answered");
    case "mine":
      return questions.filter((question) => question.mine);
    case "all":
      return [...questions];
  }
}

/** O nome do chip de cada filtro. */
export function questionsFilterLabel(filter: QuestionsFilter): string {
  const sala = WEBINAR_COPY.sala.filtros;
  const novas = WEBINAR_COPY.salaV2.perguntas;
  switch (filter) {
    case "all":
      return sala.todas;
    case "open":
      return novas.semResposta;
    case "answered":
      return sala.respondidas;
    case "mine":
      return novas.minhas;
  }
}

/** O nome de cada ordem no menu de ordenar. */
export function questionsOrderLabel(order: QuestionsOrder): string {
  const ordem = WEBINAR_COPY.sala.ordem;
  return order === "votadas" ? ordem.maisVotadas : ordem.maisRecentes;
}

/** O vazio da lista diz o filtro de agora. */
export function questionsEmptyPhrase(filter: QuestionsFilter): string {
  const novas = WEBINAR_COPY.salaV2.perguntas;
  switch (filter) {
    case "all":
      return WEBINAR_COPY.sala.semPerguntas;
    case "open":
      return novas.vazioSemResposta;
    case "answered":
      return novas.vazioRespondidas;
    case "mine":
      return novas.vazioMinhas;
  }
}

/**
 * As setas da linha de chips (a barra de chips do YouTube): a da esquerda so com chip escondido a esquerda, a da
 * direita so com chip escondido a direita. A folga de 1 px absorve o arredondamento do scrollLeft fracionado.
 */
export function chipArrows(input: { clientWidth: number; scrollLeft: number; scrollWidth: number }): { left: boolean; right: boolean } {
  const { clientWidth, scrollLeft, scrollWidth } = input;
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 };
}

/** O passo do clique numa seta: 80 % da largura visivel, para o lado da seta (inferido: o YouTube nao da o passo). */
export function chipScrollBy(input: { clientWidth: number; direction: -1 | 1 }): number {
  return Math.round(input.clientWidth * 0.8) * input.direction;
}
