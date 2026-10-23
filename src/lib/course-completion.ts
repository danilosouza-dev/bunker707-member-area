// DUBLÊ: substituído pela frente S (spec §7)
//
// Conclusao de um curso (docs/29 §4.4), puro e isomorfico: a rota de progresso e o show usam as duas primeiras; a
// pagina da aula le a resposta do PUT /api/progress/lessons com courseCompletedOf. Este arquivo so existe aqui para
// a frente P compilar e testar com as exportacoes exatas da spec; a versao da frente S vale na integracao.

/** Todas as aulas publicadas concluidas (e pelo menos uma aula publicada). */
export function isCourseComplete(publishedLessonIds: readonly string[], completedLessonIds: Iterable<string>): boolean {
  if (publishedLessonIds.length === 0) {
    return false;
  }

  const completed = new Set(completedLessonIds);

  return publishedLessonIds.every((lessonId) => completed.has(lessonId));
}

/** Este pedido virou o curso de incompleto para completo? */
export function courseJustCompleted(input: { after: Iterable<string>; before: Iterable<string>; published: readonly string[] }): boolean {
  return !isCourseComplete(input.published, input.before) && isCourseComplete(input.published, input.after);
}

/** A resposta do PUT de progresso disse que esta gravacao fechou o curso (so `courseCompleted === true`). */
export function courseCompletedOf(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { courseCompleted?: unknown }).courseCompleted === true;
}
