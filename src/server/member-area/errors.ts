// Erros da Area de membros (login, destaque da home, modulos). Modulo puro: o `status` numerico vira
// ActionFailure em toActionError (src/lib/action-result.ts) e resposta JSON em jsonRouteError.
// Mensagens no vocabulario do produtor, sem termos tecnicos.

export const MEMBER_AREA_CONFLICT_MESSAGE =
  "Esta configuração mudou em outra tela há instantes. Recarregue a página para ver a versão atual.";

/** 409: a configuracao mudou depois que a tela a leu (outra aba, o admin antigo ou outra pessoa). */
export class MemberAreaConflictError extends Error {
  status = 409 as const;

  constructor(message = MEMBER_AREA_CONFLICT_MESSAGE) {
    super(message);
    this.name = "MemberAreaConflictError";
  }
}

/**
 * Erro preso a um campo do formulario (imagem fora da medida, link invalido). Mesmo formato do
 * CatalogFieldError: toActionError reconhece `name === "ZodError"` + `issues` e devolve fieldErrors.
 */
export class MemberAreaFieldError extends Error {
  issues: { message: string; path: string[] }[];
  status = 400 as const;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ZodError";
    this.issues = [{ message, path: field.split(".") }];
  }
}
