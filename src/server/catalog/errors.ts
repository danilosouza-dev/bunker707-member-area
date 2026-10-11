// Erros de dominio de Produtos (docs/17 §2.3, "Edicao concorrente"). Modulo puro: o `status` numerico
// vira ActionFailure em toActionError (src/lib/action-result.ts) e resposta JSON em jsonRouteError.
// Mensagens no vocabulario do produtor, sem termos tecnicos.

export const CONFLICT_MESSAGE = "Alterado em outro lugar há instantes. Recarregue para ver a versão atual.";
export const NOT_FOUND_MESSAGE = "Não encontramos este item. Ele pode ter sido excluído.";

export class CatalogError extends Error {
  status: 404 | 409 | 413 | 422;

  constructor(message: string, status: 404 | 409 | 413 | 422) {
    super(message);
    this.name = "CatalogError";
    this.status = status;
  }
}

/** 404: produto, modulo ou aula inexistente (ou excluido). */
export class CatalogNotFoundError extends CatalogError {
  constructor(message = NOT_FOUND_MESSAGE) {
    super(message, 404);
    this.name = "CatalogNotFoundError";
  }
}

/** 409: o registro mudou depois que a tela o leu, ou a regra depende de algo que ja aconteceu (alunos). */
export class CatalogConflictError extends CatalogError {
  constructor(message = CONFLICT_MESSAGE) {
    super(message, 409);
    this.name = "CatalogConflictError";
  }
}

/** 422: pedido valido no formato, mas recusado por regra (limite, confirmacao errada, formacao invalida). */
export class CatalogRuleError extends CatalogError {
  constructor(message: string) {
    super(message, 422);
    this.name = "CatalogRuleError";
  }
}

/**
 * Erro preso a um campo do formulario (ex.: imagem fora da medida, link de video nao reconhecido).
 * toActionError so devolve `fieldErrors` para erros de validacao do zod, que reconhece pelo nome
 * "ZodError" e pela lista `issues`; este erro usa o mesmo formato para a mensagem cair embaixo do
 * campo (400), sem mexer no contrato congelado de action-result.ts.
 */
export class CatalogFieldError extends Error {
  issues: { message: string; path: string[] }[];
  status = 400 as const;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ZodError";
    this.issues = [{ message, path: field.split(".") }];
  }
}
