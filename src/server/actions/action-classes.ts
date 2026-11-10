// As acoes do admin que fazem duas coisas diferentes e dizem, pela propria entrada, qual delas e esta chamada (docs/32
// §11.3). A classe sai da entrada ja validada, e runAdminAction a confere antes do handler. Toda outra acao declara uma
// classe fixa. Modulo puro (sem "server-only" e sem "@/"): os testes carregam direto.
//
// A regra do §2.2: o que so tira, corrige ou protege fica liberado; o que acrescenta ou promove fica barrado.

import type { ActionClass } from "../licensing/model";

/** Aulas em lote: Publicar e conteudo; Despublicar so tira, e o que a lei pede nunca e barrado. */
export function actionClassOfLessonsStatus(input: { status: "draft" | "published" }): ActionClass {
  return input.status === "published" ? "conteudo" : "dever_legal";
}

/**
 * Aluno novo pelo admin: com produto e matricula (acesso novo: so a Escola congelada barra); sem produto e conta sem
 * produto, conteudo (o Admin limitado ja barra: uma lista de contas criadas antes furaria o congelamento).
 */
export function actionClassOfNewStudent(input: { productIds: readonly string[] }): ActionClass {
  return input.productIds.length > 0 ? "matricula" : "conteudo";
}

/**
 * Acao em lote na lista de alunos: Liberar acesso e matricula; Reenviar o e-mail de acesso (criar ou trocar a senha) e
 * seguranca; estender, mudar o fim, encerrar e trocar a turma mexem no que o aluno ja tinha (atendimento).
 */
export function actionClassOfBulkStudentAction(input: { action: string }): ActionClass {
  if (input.action === "grant") {
    return "matricula";
  }

  return input.action === "resend_access_email" ? "dever_legal" : "atendimento";
}
