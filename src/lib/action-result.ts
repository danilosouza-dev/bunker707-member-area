// Contrato de retorno das Server Actions do admin (docs/17 §2.3, "Mutacoes").
// Modulo puro (sem "server-only"): a UI importa os tipos e o teste carrega direto pelo Node.
//
// Server Action nunca lanca erro para o cliente: em producao o Next troca a mensagem por um texto
// generico. Toda acao devolve ActionResult e a UI mostra `error` em banner persistente (nunca toast)
// e `fieldErrors` abaixo de cada campo.

export type ActionErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500;

export type ActionFailure = {
  /** Erros por campo, com o caminho do zod unido por ponto ("modules.0.title"). */
  fieldErrors?: Record<string, string[]>;
  error: string;
  ok: false;
  status: ActionErrorStatus;
};

export type ActionSuccess<T> = {
  data: T;
  ok: true;
};

export type ActionResult<T> = ActionFailure | ActionSuccess<T>;

export const GENERIC_ACTION_ERROR = "Não foi possível concluir agora. Tente de novo em instantes.";

const knownStatuses = new Set<number>([400, 401, 403, 404, 409, 413, 422, 429, 500]);

type IssueLike = { message?: unknown; path?: unknown };

function isZodLikeError(error: unknown): error is { issues: IssueLike[] } {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "ZodError" &&
      Array.isArray((error as { issues?: unknown }).issues)
  );
}

function issuePath(path: unknown) {
  return Array.isArray(path) ? path.map((segment) => String(segment)).join(".") : "";
}

export function actionOk<T>(data: T): ActionSuccess<T> {
  return { data, ok: true };
}

export function actionError(
  status: ActionErrorStatus,
  error: string,
  fieldErrors?: Record<string, string[]>
): ActionFailure {
  return fieldErrors && Object.keys(fieldErrors).length > 0
    ? { error, fieldErrors, ok: false, status }
    : { error, ok: false, status };
}

/**
 * Converte qualquer erro em ActionFailure:
 * - erro de validacao do zod -> 400 com fieldErrors (a primeira mensagem vira o texto do banner);
 * - erro com `status` numerico conhecido (AdminPermissionError, CatalogConflictError,
 *   LessonCommentStoreError, erros de mutacao do platform-store) -> esse status e a mensagem dele;
 * - qualquer outro -> 500 com texto generico (a mensagem original nao vaza para o navegador).
 */
export function toActionError(error: unknown): ActionFailure {
  if (isZodLikeError(error)) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of error.issues) {
      const key = issuePath(issue.path) || "_";
      const message = typeof issue.message === "string" && issue.message ? issue.message : "Valor inválido.";
      (fieldErrors[key] ??= []).push(message);
    }

    const firstMessage = Object.values(fieldErrors)[0]?.[0] ?? "Revise os campos destacados.";

    return actionError(400, firstMessage, fieldErrors);
  }

  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    const message = (error as { message?: unknown }).message;

    if (typeof status === "number" && knownStatuses.has(status) && status !== 500) {
      return actionError(
        status as ActionErrorStatus,
        typeof message === "string" && message.trim() ? message : GENERIC_ACTION_ERROR
      );
    }
  }

  return actionError(500, GENERIC_ACTION_ERROR);
}
