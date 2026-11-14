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

/**
 * O pedido saiu do navegador e nenhuma resposta voltou: a rede caiu, o app reiniciou no meio do pedido, ou a pagina e
 * de uma versao do app anterior a que esta no servidor.
 */
export const UNREACHABLE_ACTION_ERROR = "O servidor não respondeu. Confira a conexão e tente de novo; se continuar, recarregue a página.";

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

/** Os sinais do proprio Next (redirect, notFound e afins) viajam como erro com `digest`: nao sao falha do pedido. */
function isNextNavigationSignal(error: unknown) {
  const digest = error && typeof error === "object" ? (error as { digest?: unknown }).digest : null;
  return typeof digest === "string" && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest);
}

/**
 * Chama uma Server Action pelo navegador sem deixar a tela presa. A acao em si nunca lanca (devolve ActionResult), mas
 * a CHAMADA lanca quando nenhuma resposta volta (a rede caiu, o app reiniciou no meio, a pagina e de uma versao
 * anterior a do servidor). Sem isto, a tela que marcou "ocupada" antes do `await` nunca desmarcava: os botoes ficavam
 * desligados ate recarregar a pagina (o console da live em 14/11/2026, no reinicio do servidor: "Aplicando…" preso e o
 * Encerrar desligado). Aqui a falha da chamada vira um ActionFailure comum (500), para quem chamou mostrar o aviso e
 * soltar os botoes. Os sinais de navegacao do Next passam adiante.
 */
export async function settleAction<T>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const result = await action();
    // Uma resposta fora do contrato (o servidor de outra versao devolveu outra coisa) tambem e pedido sem resposta.
    return result && typeof result === "object" && typeof (result as { ok?: unknown }).ok === "boolean" ? result : actionError(500, UNREACHABLE_ACTION_ERROR);
  } catch (error) {
    if (isNextNavigationSignal(error)) {
      throw error;
    }
    return actionError(500, UNREACHABLE_ACTION_ERROR);
  }
}
