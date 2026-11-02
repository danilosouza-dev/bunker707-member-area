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

/* ------------------------------------------------------------------------------------------------
 * Y10: a pergunta como o comentario do YouTube, com o fio "1 resposta" (spec §8.4)
 * ---------------------------------------------------------------------------------------------- */

type ThreadQuestion = Pick<StudentQuestion, "answerText" | "mine" | "status">;

/** A pergunta tem fio: a resposta escrita da Equipe ou do Assistente (a respondida so ao vivo nao tem texto). */
export function questionHasThread(question: ThreadQuestion): boolean {
  return question.status === "answered" && Boolean(question.answerText?.trim());
}

/** O fio nasce aberto na minha pergunta respondida por escrito e fechado nas outras. */
export function questionThreadOpenByDefault(question: ThreadQuestion): boolean {
  return question.mine && questionHasThread(question);
}

/**
 * O fio esta aberto: o padrao (aberto na minha) trocado pelo clique do aluno (`toggled`, os ids que ele abriu ou
 * fechou). Assim a minha pergunta respondida depois abre sozinha, e o clique continua valendo nas releituras.
 */
export function questionThreadOpen(question: ThreadQuestion & Pick<StudentQuestion, "id">, toggled: ReadonlySet<string>): boolean {
  return questionHasThread(question) && questionThreadOpenByDefault(question) !== toggled.has(question.id);
}

/**
 * A situacao na linha de acoes, logo depois do numero: "Respondida ao vivo" ou "Dispensada" (so o autor ve a
 * dispensada); a respondida por escrito nao precisa, o fio ja diz.
 */
export function questionStatusOf(question: Pick<StudentQuestion, "answeredLive" | "status">): "dismissed" | "live" | null {
  if (question.status === "dismissed") {
    return "dismissed";
  }
  return question.status === "answered" && question.answeredLive ? "live" : null;
}
