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

/** O nome da conexao como o servidor grava (provider-connections.ts, validateLabel): espacos juntados e aparados. */
function connectionLabelOf(value: unknown): string | null {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : null;
}

/**
 * A mudanca numa conexao de IA ja conectada (PATCH /api/admin/ai-connections/[id]). Trocar a chave (com o nome e a
 * prioridade como estao, que o editor manda junto) e pausar sao dever legal: trocar o segredo de uma integracao ja
 * conectada, ou desliga-la (docs/32 §2.2). Retomar a pausada, renomear e mudar a prioridade sao configuracao (conteudo).
 * Antes o PATCH inteiro era dever legal, e no Admin limitado ele tambem retomava a conexao pausada (revisao de 11/11/2026).
 */
export function actionClassOfAIConnectionChange(
  change: { apiKey?: unknown; label?: unknown; paused?: unknown; priority?: unknown },
  current: { label: string; priority: number }
): ActionClass {
  if (change.paused !== undefined && change.paused !== true) {
    return "conteudo";
  }

  const sameLabel = change.label === undefined || connectionLabelOf(change.label) === current.label;
  const samePriority = change.priority === undefined || (typeof change.priority === "number" ? change.priority : Number(change.priority)) === current.priority;

  return sameLabel && samePriority ? "dever_legal" : "conteudo";
}

/**
 * A marca Bunker Members num produto (Produtos > Acesso e venda; docs/32 §11.10): marcar acrescenta (a venda do produto
 * passa a virar Licenca), e conteudo; desmarcar so tira, e dever legal.
 */
export function actionClassOfLicenseProductChange(input: { enabled: boolean }): ActionClass {
  return input.enabled ? "conteudo" : "dever_legal";
}
