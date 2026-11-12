// As curtidas da resposta e do fio de uma pergunta (rodada v11, terceiro teste do produtor de 12/11/2026; docs/30 D101,
// §4.2; docs/31 §16.3), a parte pura: a linha do banco (webinar_question_likes, migracao 202611170001), a contagem por
// alvo e o que quem le recebe. A curtida da propria pergunta continua em webinar_question_votes (upvotes e voted), como
// sempre; aqui ficam a resposta escrita (reply_id nulo) e cada resposta do fio. Qualquer pessoa que ve a pergunta
// curte: o aluno pela rota da sala, a equipe pela acao do console. Sem imports: os testes carregam direto.

/** A migracao das curtidas (o aviso de migracao pendente quando a tabela ainda nao existe). */
export const QUESTION_LIKES_MIGRATION = "202611170001";

/** As colunas que a leitura da sessao pede. */
export const QUESTION_LIKE_COLUMNS = "question_id, reply_id, user_id";

export type QuestionLikeRow = { question_id: string; reply_id: string | null; user_id: string };

/** O que quem le recebe de cada alvo: quantas curtidas e se a dele esta entre elas. */
export type LikeTally = { liked: boolean; likes: number };

export const NO_LIKES: LikeTally = Object.freeze({ liked: false, likes: 0 });

export type QuestionLikesTally = {
  /** A resposta escrita de cada pergunta (a chave e o id da pergunta). */
  answers: ReadonlyMap<string, LikeTally>;
  /** Cada resposta do fio (a chave e o id da resposta). */
  replies: ReadonlyMap<string, LikeTally>;
};

/** A contagem das curtidas de uma sessao, com a de quem le marcada (`viewerId` nulo: ninguem marcado). */
export function tallyQuestionLikes(rows: readonly QuestionLikeRow[], viewerId: string | null): QuestionLikesTally {
  const answers = new Map<string, LikeTally>();
  const replies = new Map<string, LikeTally>();
  for (const row of rows) {
    const target = row.reply_id ? replies : answers;
    const key = row.reply_id ?? row.question_id;
    const before = target.get(key) ?? NO_LIKES;
    target.set(key, { liked: before.liked || (viewerId !== null && row.user_id === viewerId), likes: before.likes + 1 });
  }
  return { answers, replies };
}

/** A curtida depois do toque, antes de o servidor responder (a tela muda na hora; a resposta confirma ou desfaz). */
export function toggledLike(current: Partial<LikeTally> | null | undefined): LikeTally {
  const liked = current?.liked === true;
  const likes = Math.max(0, Math.floor(current?.likes ?? 0));
  return { liked: !liked, likes: Math.max(0, likes + (liked ? -1 : 1)) };
}
