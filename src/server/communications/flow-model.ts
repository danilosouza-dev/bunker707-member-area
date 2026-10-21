// Fluxos da Comunicacao v2 (docs/23): um motor so para as notificacoes seguintes de um aviso e para os
// fluxos do construtor. Um fluxo e uma arvore de passos (entrada -> notificacao | condicao Sim/Nao); o
// "quando" e propriedade de cada passo e o trabalho e uma tarefa por (passo, aluno), aplicada pelo RPC
// communication_apply_flow_results (migracao 202610200002).
//
// Modulo puro: sem "server-only", imports relativos, sem enums nem parameter properties (o Node carrega
// direto, com type-stripping, em tests/comunicacao-fluxos-modelo.test.mjs). Aqui ficam os tipos, os
// limites fixos e as assinaturas das decisoes; a decisao e recalculavel: o horario de verdade sempre sai
// do anchor_at gravado e da configuracao atual do passo (uma tarefa acordada cedo so e reagendada).

import type { AudienceContext, AudienceDefinition, AudienceStudentFacts } from "./audience-model";

/** Limites fixos (aparecem no editor como texto, nunca como campo; docs/23 e docs/17 §1.8.1). */
export const FLOW_LIMITS = {
  /** Notificacoes de fluxos e seguintes por aluno por dia de Sao Paulo, com 1 h entre elas. */
  dailyCap: 3,
  minGapMinutes: 60,
  /** Envio que passou do limite do dia sai as 8h (Sao Paulo) do dia seguinte. */
  deferHourSaoPaulo: 8,
  /** Adiado mais que isto pelo limite do dia: nao sai ("limite do dia"). */
  maxDeferrals: 7,
  maxNodes: 20,
  maxDepth: 8,
  /** Esperas em minutos: de 5 minutos a 60 dias, de 5 em 5; "antes de vencer" a partir de 15. */
  offsetStep: 5,
  minOffset: 5,
  maxOffset: 86_400,
  minExpiresOffset: 15,
  /** "Esperar ate ser Sim": de 15 minutos a 30 dias, conferido a cada 15 minutos. */
  minWait: 15,
  maxWait: 43_200,
  pollMinutes: 15,
  /** Notificacao que venceria em menos disto nem sai. */
  bornExpiredMinutes: 15,
  followUpsPerNotice: 5,
  /** Niveis contando a notificacao principal (principal, seguinte, seguinte da seguinte). */
  followUpDepth: 3,
  /** Fluxos do construtor ativos ao mesmo tempo (os de aviso nao contam). */
  activeFlows: 20,
  batchSize: 150,
  maxBatchesPerTick: 20,
  phaseBudgetMs: 25_000,
  staleClaimMs: 120_000,
  maxAttempts: 5,
  retryMinutes: [1, 5],
  entryPerTick: 5_000,
  goalSweepPerSlot: 1_000,
  /** O RPC de aplicacao para de pegar tarefas depois disto (o SQL tem os mesmos 10 s). */
  applyStatementMs: 10_000,
  /** Folga de inbox.ts wasVisibleAt para linhas de fluxo (maior que applyStatementMs). */
  flowRowSettleMs: 15_000
} as const;

/* ------------------------------------------------------------------------------------------------
 * Fluxo, passos e tarefas
 * ---------------------------------------------------------------------------------------------- */

export type FlowOrigin = "builder" | "notice";
export type FlowStatus = "active" | "draft" | "ended" | "paused" | "pending_approval";
/** current = quem esta no segmento ao ativar; current_and_new = e quem entrar depois; new_only = so quem entrar depois. */
export type FlowEntryMode = "current" | "current_and_new" | "new_only";
export type FlowEndedReason = "finished" | "source_deleted" | "source_withdrawn" | "team";

/** De onde conta o "quando": o fim do passo anterior, o envio de uma notificacao do caminho ou o fim dela. */
export type FlowAnchor = "previous" | "sent" | "expires";
export type FlowNodeKind = "condition" | "entry" | "message";
export type FlowBranch = "no" | "yes";

export type FlowNode = {
  anchor: FlowAnchor;
  /** Notificacao de referencia de "sent"/"expires" (um passo acima; num fluxo de aviso, a entrada). */
  anchorNodeId: string | null;
  /** Lado da condicao-pai; null quando o pai e a entrada ou uma notificacao. */
  branch: FlowBranch | null;
  /** Versao atual do conteudo (so notificacao). */
  campaignId: string | null;
  /** Regras da condicao (so condicao). */
  condition: AudienceDefinition | null;
  /** "Ate a notificacao principal sumir": fica no sino ate a notificacao de referencia sumir. */
  expireWithAnchor: boolean;
  /** "So para quem..." da notificacao; null = todos que chegam. */
  filter: AudienceDefinition | null;
  id: string;
  kind: FlowNodeKind;
  /** "Esperar ate ser Sim", no maximo isto (so condicao). */
  maxWaitMinutes: number | null;
  offsetMinutes: number;
  parentId: string | null;
  position: number;
  waitUntilTrue: boolean;
};

export type FlowTree = { nodes: FlowNode[]; origin: FlowOrigin };

/** Versao atual do conteudo de um passo de notificacao (ou o aviso de origem, para a entrada). */
export type FlowMessageMeta = {
  campaignId: string;
  ctaHref: string | null;
  hasAudio: boolean;
  hasCta: boolean;
  hasResponse: boolean;
  title: string;
  validUntil: string | null;
  validityMinutes: number | null;
};

/** Tarefa reservada pelo tick (communication_claim_flow_tasks), com os tempos em ms. */
export type FlowTaskInput = {
  anchorAt: number;
  attempts: number;
  /** Carimbo exato da reserva (texto com microssegundos): a aplicacao confere este valor. */
  claimedAt: string;
  deadlineAt: number | null;
  nodeId: string;
  /** Gravado pelo RPC de aplicacao quando o limite do dia ou o intervalo de 1 h empurrou o envio. */
  notBefore: number | null;
  userId: string;
};

/** Tarefa de um passo filho criada junto com o envio ou a decisao do passo. */
export type ChildTask = { anchorAt: number; deadlineAt: number | null; dueAt: number; nodeId: string };

/** Base de tempo dos filhos para um aluno (ver childTasksOf). */
export type ChildAnchorInput = {
  completedAt: number;
  expiresAt(nodeId: string): number | null;
  sentAt(nodeId: string): number | null;
};

export type FlowDecision =
  | { action: "send"; campaignId: string; children: ChildTask[]; deadlineAt: number | null; expiresAt: number }
  | { action: "finish"; children: ChildTask[]; error?: string; result: "expired" | "failed" | "filtered" | "no" | "yes" }
  | { action: "defer"; deadlineAt: number | null; dueAt: number }
  | { action: "retry"; dueAt: number; error: string }
  | { action: "exit_goal" };

/** Tudo o que a decisao de uma tarefa precisa, ja carregado (sem I/O). */
export type DecideInput = {
  context: AudienceContext;
  /**
   * Fatos do aluno. `messages["node:<passo>"]` traz a notificacao de cada passo que ele recebeu (num fluxo
   * de aviso, a entrada = o aviso de origem): o visible_at e o expires_at dela sao as bases de "sent" e
   * "expires". `flow.enteredAt` vem da passagem.
   */
  facts: AudienceStudentFacts;
  /** Objetivo do fluxo; null = sem objetivo. */
  goal: AudienceDefinition | null;
  /** Conteudo atual do passo (notificacao); null para condicao. */
  message: FlowMessageMeta | null;
  node: FlowNode;
  now: number;
  /** A pessoa esta na equipe agora (fatos do lote: staff). */
  staff: boolean;
  task: FlowTaskInput;
  tree: FlowTree;
};

/** Problema de um fluxo: bloqueia salvar, bloqueia ativar ou so avisa. `field` e o campo do passo. */
export type FlowIssue = {
  field: string | null;
  level: "activation" | "save" | "warning";
  message: string;
  nodeId: string | null;
};

/**
 * Notificacao seguinte como o editor do aviso desenha (um fluxo de aviso linear visto do aviso): sai X
 * minutos depois do envio da anterior ou antes de ela vencer, para quem combina com `who`.
 */
export type FollowUp = {
  campaignId: string;
  children: FollowUp[];
  /** "Ate a notificacao principal (ou anterior) sumir". */
  expireWithAnchor: boolean;
  /** Id do passo (uuid gerado no navegador). */
  id: string;
  when: { anchor: "expires" | "sent"; minutes: number };
  /** "Para quem"; todos que receberam = { kind: "everyone" }. */
  who: AudienceDefinition;
};

/* ------------------------------------------------------------------------------------------------
 * Decisoes (implementadas pelo pacote do motor)
 * ---------------------------------------------------------------------------------------------- */

function notImplemented(inputs: unknown[]): never {
  void inputs;
  throw new Error("Não implementado.");
}

/**
 * previous|sent: due = anchor + offset; expires: due = anchor - offset, deadline = anchor;
 * condicao com "esperar ate ser Sim": deadline = due + maxWait.
 */
export function dueFromAnchor(node: FlowNode, anchorAt: number): { deadlineAt: number | null; dueAt: number } {
  return notImplemented([node, anchorAt]);
}

/**
 * Tarefas dos filhos vivos (todos, ou um lado da condicao), com a base de tempo deste aluno:
 * previous -> completedAt; sent/expires neste mesmo passo -> agora / o fim recem-calculado;
 * numa notificacao acima -> o visible_at / expires_at dela nos fatos do aluno.
 */
export function childTasksOf(node: FlowNode, side: FlowBranch | null, tree: FlowTree, input: ChildAnchorInput): ChildTask[] {
  return notImplemented([node, side, tree, input]);
}

/** A decisao de uma tarefa (a primeira regra que vale ganha; docs/23). */
export function decideFlowTask(input: DecideInput): FlowDecision {
  return notImplemented([input]);
}

/** Problemas da arvore (uma entrada, Sim/Nao so sob condicao, referencias acima no caminho, limites...). */
export function validateFlowTree(tree: FlowTree, messages: Record<string, FlowMessageMeta>): FlowIssue[] {
  return notImplemented([tree, messages]);
}

/** A arvore como notificacoes seguintes; null = so o construtor consegue desenhar (condicao, outra base...). */
export function followUpsFromTree(tree: FlowTree): FollowUp[] | null {
  return notImplemented([tree]);
}

/** Notificacoes seguintes -> passos (a entrada primeiro, em pre-ordem: pai antes do filho). */
export function treeFromFollowUps(entryId: string, followUps: FollowUp[]): FlowNode[] {
  return notImplemented([entryId, followUps]);
}

/** Chaves de pagina que o fluxo usa: regras de visita (filtros, condicoes, objetivo) e paginas dos botoes. */
export function watchedPageKeysOf(
  tree: FlowTree,
  goal: AudienceDefinition | null,
  messages: Record<string, FlowMessageMeta>,
  sourceCtaHref: string | null
): string[] {
  return notImplemented([tree, goal, messages, sourceCtaHref]);
}

/** Proxima faixa de 15 minutos alinhada (:00, :15, :30, :45). */
export function nextPollAt(now: number): number {
  return notImplemented([now]);
}

/** Comeco do dia de Sao Paulo (UTC-3 fixo, como campaign-model.ts) e do dia seguinte. */
export function saoPauloDayBounds(now: number): { nextStart: number; start: number } {
  return notImplemented([now]);
}
