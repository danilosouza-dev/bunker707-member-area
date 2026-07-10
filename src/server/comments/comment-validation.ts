export const lessonCommentBodyMaxLength = 2000;
export const lessonCommentBurstLimit = 5;
export const lessonCommentBurstWindowMs = 60_000;

export function normalizeCommentForModeration(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function containsBlockedTerm(body: string, term: string) {
  const normalizedBody = normalizeCommentForModeration(body);
  const normalizedTerm = normalizeCommentForModeration(term);

  if (!normalizedBody || !normalizedTerm) {
    return false;
  }

  return ` ${normalizedBody} `.includes(` ${normalizedTerm} `);
}

export function sanitizeLessonCommentBody(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

export function validateLessonCommentBody(value: string) {
  const body = sanitizeLessonCommentBody(value);

  if (!body) {
    return { error: "Escreva um comentario antes de enviar.", value: body };
  }

  if (body.length > lessonCommentBodyMaxLength) {
    return {
      error: `O comentario pode ter no maximo ${lessonCommentBodyMaxLength} caracteres.`,
      value: body
    };
  }

  return { error: null, value: body };
}
