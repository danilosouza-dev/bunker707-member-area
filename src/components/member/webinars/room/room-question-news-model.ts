// As respostas novas nas perguntas do proprio aluno (rodada v11, teste do produtor de 12/11/2026; docs/30 D100; docs/31
// §16.2), a parte pura: o que conta como "a equipe falou na minha pergunta" e quantas dessas falas o aluno ainda nao
// viu. A sala guarda as marcas vistas e conta as novas enquanto a aba Perguntas nao esta na tela; a aba na tela ve
// tudo. Sem banco: as marcas saem da lista de perguntas que a sala ja le. Nenhuma frase de tela aqui.

/** O que a conta precisa de cada pergunta (o que a sala recebe do servidor). */
export type QuestionNewsQuestion = {
  answerText?: string | null;
  answeredAt?: string | null;
  answeredLive?: boolean;
  id: string;
  mine: boolean;
  replies?: readonly { id: string; mine: boolean }[] | null;
  status: string;
};

/** A acao "Ver" do aviso da sala (abre a aba Perguntas). */
export const QUESTION_NEWS_SNACK_ACTION = "question_news_open";

/** De quanto em quanto a sala rele as perguntas so para o aviso, com a aba Perguntas fora da tela. */
export const QUESTION_NEWS_REFRESH_MS = 20_000;
/** A primeira leitura, logo depois de a sala abrir (so para saber se o aluno ja perguntou algo nesta sessao). */
export const QUESTION_NEWS_FIRST_MS = 3_000;

/**
 * As marcas do que a equipe ja disse nas MINHAS perguntas: a resposta (escrita ou ao vivo), pela hora dela (responder de
 * novo depois do Reabrir e outra marca), e cada resposta do fio que nao e minha. A pergunta de outro aluno nunca entra.
 */
export function questionNewsMarks(questions: readonly QuestionNewsQuestion[]): string[] {
  const marks: string[] = [];
  for (const question of questions) {
    if (!question.mine) {
      continue;
    }
    if (question.status === "answered" && (question.answerText?.trim() || question.answeredLive)) {
      marks.push(`${question.id}:a:${question.answeredAt ?? ""}`);
    }
    for (const reply of question.replies ?? []) {
      if (!reply.mine) {
        marks.push(`${question.id}:r:${reply.id}`);
      }
    }
  }
  return marks;
}

/** O aluno tem pergunta propria na lista (so entao a sala continua relendo com a aba fora da tela). */
export function hasOwnQuestion(questions: readonly QuestionNewsQuestion[]): boolean {
  return questions.some((question) => question.mine);
}

/** Quantas marcas o aluno ainda nao viu. Antes da primeira leitura (`seen` nulo) nada e novo. */
export function questionNewsCount(seen: ReadonlySet<string> | null, marks: readonly string[]): number {
  if (!seen) {
    return 0;
  }
  let count = 0;
  for (const mark of marks) {
    if (!seen.has(mark)) {
      count += 1;
    }
  }
  return count;
}

/**
 * As marcas vistas depois de uma leitura: a primeira leitura e a aba Perguntas na tela veem tudo; fora disso, o que ja
 * estava visto continua (o mesmo conjunto quando nada muda, para a sala nao redesenhar).
 */
export function questionNewsSeen(seen: ReadonlySet<string> | null, marks: readonly string[], shown: boolean): ReadonlySet<string> | null {
  if (seen && !shown) {
    return seen;
  }
  if (seen && marks.every((mark) => seen.has(mark))) {
    return seen;
  }
  return new Set([...(seen ?? []), ...marks]);
}

/** A sala rele as perguntas por conta propria: so com a aba fora da tela e (depois da primeira leitura) com pergunta do aluno. */
export function questionNewsPolls(input: { enabled: boolean; loaded: boolean; own: boolean; tabMounted: boolean }): boolean {
  return input.enabled && !input.tabMounted && (!input.loaded || input.own);
}
