// Curso concluido (Comunicacao v3b-2, docs/29 §4.3): a mesma conta da regra "Progresso 100 %" do segmento
// (audience-model.ts, audience-facts.ts): todas as aulas publicadas dos modulos publicados concluidas, e pelo
// menos uma aula publicada. Usada pela rota de progresso (a resposta que fecha o curso leva courseCompleted),
// pelo show do pop-up "Ao concluir um curso" (confere de novo no banco) e pela pagina da aula (le a resposta).
// Modulo puro e isomorfico: sem "server-only", sem imports; os testes carregam direto pelo Node.

/** Todas as aulas publicadas concluidas (e pelo menos uma aula publicada). */
export function isCourseComplete(publishedLessonIds: readonly string[], completedLessonIds: Iterable<string>): boolean {
  if (publishedLessonIds.length === 0) {
    return false;
  }

  const completed = new Set(completedLessonIds);

  return publishedLessonIds.every((lessonId) => completed.has(lessonId));
}

/**
 * Este pedido virou o curso de incompleto para completo? `before` sao as concluidas lidas pela gravacao que
 * venceu (o "antes" verdadeiro desta gravacao); `after`, as gravadas.
 */
export function courseJustCompleted(input: { after: Iterable<string>; before: Iterable<string>; published: readonly string[] }): boolean {
  return !isCourseComplete(input.published, input.before) && isCourseComplete(input.published, input.after);
}

/**
 * A resposta do PUT /api/progress/lessons disse que esta conclusao fechou o curso? So `courseCompleted === true`
 * num objeto; qualquer outro valor ou corpo ilegivel = nao.
 */
export function courseCompletedOf(body: unknown): boolean {
  return typeof body === "object" && body !== null && !Array.isArray(body) && (body as { courseCompleted?: unknown }).courseCompleted === true;
}
