// Fluxos da Comunicacao v2 (docs/23): um motor so para as notificacoes seguintes de um aviso e para os
// fluxos do construtor. Um fluxo e uma arvore de passos (entrada -> notificacao | condicao Sim/Nao); o
// "quando" e propriedade de cada passo e o trabalho e uma tarefa por (passo, aluno), aplicada pelo RPC
// communication_apply_flow_results (migracao 202610200002).
//
// Modulo puro: sem "server-only", imports relativos, sem enums nem parameter properties (o Node carrega
// direto, com type-stripping, em tests/comunicacao-fluxos-modelo.test.mjs). Aqui ficam os tipos, os
// limites fixos, a decisao de cada tarefa (sem I/O), a conferencia da arvore e a conversa com o cartao
// "Depois desta notificacao". A decisao e recalculavel: o horario de verdade sempre sai do anchor_at
// gravado e da configuracao atual do passo (uma tarefa acordada cedo so e reagendada).

import {
  countAudienceRules,
  evaluateAudience,
  EVERYONE,
  isAudienceGroup,
  messageRefKey,
  type AudienceContext,
  type AudienceDefinition,
  type AudienceNode,
  type AudienceRule,
  type AudienceStudentFacts
} from "./audience-model";
import { pageKeyOfHref, pageKeyOfTarget } from "../member-area/page-visit-model";
import { computeExpiresAt, validityDurationLabel } from "./message-meta";

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
  /** v3a: a notificacao aceita reacoes. */
  allowsReactions: boolean;
  campaignId: string;
  ctaHref: string | null;
  hasAudio: boolean;
  hasCta: boolean;
  /** v3a: a notificacao tem enquete. */
  hasPoll: boolean;
  hasResponse: boolean;
  /** v3a: ids das opcoes da enquete (vazio sem enquete). */
  pollOptionIds: readonly string[];
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
 * Tempo: base de cada passo, faixas de 15 minutos e dia de Sao Paulo
 * ---------------------------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Sao Paulo em UTC-3 fixo, sem horario de verao (como campaign-model.ts). */
const SAO_PAULO_OFFSET_MS = 3 * 60 * MINUTE_MS;
const POLL_MS = FLOW_LIMITS.pollMinutes * MINUTE_MS;
/** "Ficar no sino" padrao (90 dias), quando o conteudo nao diz outra coisa. */
const DEFAULT_VALIDITY_MINUTES = 129_600;

/** Fim do "esperar ate ser Sim" (so condicao com a espera ligada). */
function waitDeadlineOf(node: FlowNode, dueAt: number) {
  return node.kind === "condition" && node.waitUntilTrue && node.maxWaitMinutes !== null ? dueAt + node.maxWaitMinutes * MINUTE_MS : null;
}

/**
 * previous|sent: due = anchor + offset; expires: due = anchor - offset, deadline = anchor;
 * condicao com "esperar ate ser Sim": deadline = due + maxWait (e nunca depois do fim da notificacao de
 * referencia, quando conta de "antes de vencer").
 */
export function dueFromAnchor(node: FlowNode, anchorAt: number): { deadlineAt: number | null; dueAt: number } {
  const offset = node.offsetMinutes * MINUTE_MS;

  if (node.anchor === "expires") {
    const dueAt = anchorAt - offset;
    const waitDeadline = waitDeadlineOf(node, dueAt);

    return { deadlineAt: waitDeadline === null ? anchorAt : Math.min(anchorAt, waitDeadline), dueAt };
  }

  const dueAt = anchorAt + offset;

  return { deadlineAt: waitDeadlineOf(node, dueAt), dueAt };
}

/** Proxima faixa de 15 minutos alinhada (:00, :15, :30, :45), sempre depois de `now`. */
export function nextPollAt(now: number): number {
  return Math.floor(now / POLL_MS) * POLL_MS + POLL_MS;
}

/** Comeco do dia de Sao Paulo (UTC-3 fixo, como campaign-model.ts) e do dia seguinte. */
export function saoPauloDayBounds(now: number): { nextStart: number; start: number } {
  const start = Math.floor((now - SAO_PAULO_OFFSET_MS) / DAY_MS) * DAY_MS + SAO_PAULO_OFFSET_MS;

  return { nextStart: start + DAY_MS, start };
}

/* ------------------------------------------------------------------------------------------------
 * Arvore: filhos, caminho e regras
 * ---------------------------------------------------------------------------------------------- */

function byPosition(left: FlowNode, right: FlowNode) {
  return left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/** Filhos vivos de um passo: todos (entrada, notificacao) ou um lado da condicao; em ordem. */
export function childrenOf(tree: FlowTree, nodeId: string, side: FlowBranch | null): FlowNode[] {
  return tree.nodes.filter((node) => node.parentId === nodeId && node.branch === side).sort(byPosition);
}

/** A entrada da arvore (a primeira, se a arvore tiver mais de uma: validateFlowTree recusa). */
export function entryOf(tree: FlowTree): FlowNode | null {
  return tree.nodes.find((node) => node.kind === "entry") ?? null;
}

/** As regras do fluxo: "So para quem..." de cada notificacao, cada condicao e o objetivo. */
export function flowDefinitionsOf(tree: FlowTree, goal: AudienceDefinition | null): AudienceDefinition[] {
  const definitions: AudienceDefinition[] = [];

  for (const node of tree.nodes) {
    if (node.filter) {
      definitions.push(node.filter);
    }

    if (node.condition) {
      definitions.push(node.condition);
    }
  }

  if (goal) {
    definitions.push(goal);
  }

  return definitions;
}

function rulesOf(definition: AudienceDefinition | null): AudienceRule[] {
  const rules: AudienceRule[] = [];
  const visit = (node: AudienceNode) => {
    if (isAudienceGroup(node)) {
      node.items.forEach(visit);
    } else {
      rules.push(node);
    }
  };

  if (definition && definition.kind === "rules" && definition.root) {
    visit(definition.root);
  }

  return rules;
}

/** Passos de notificacao que uma regra confere ("o que fez com", "desde que recebeu", "pagina do destino"). */
function nodeRefsOf(rule: AudienceRule): string[] {
  const refs: string[] = [];

  if (rule.type === "message" && rule.ref.kind === "node") {
    refs.push(rule.ref.nodeId);
  }

  if ((rule.type === "page_visit" || rule.type === "access_gained") && rule.since.kind === "message") {
    refs.push(rule.since.nodeId);
  }

  if (rule.type === "page_visit" && rule.page.kind === "message_cta") {
    refs.push(rule.page.nodeId);
  }

  return refs;
}

/* ------------------------------------------------------------------------------------------------
 * Decisao de uma tarefa
 * ---------------------------------------------------------------------------------------------- */

/**
 * Tarefas dos filhos vivos (todos, ou um lado da condicao), com a base de tempo deste aluno:
 * previous -> completedAt; sent/expires neste mesmo passo -> agora / o fim recem-calculado;
 * numa notificacao acima -> o visible_at / expires_at dela nos fatos do aluno. Filho cuja notificacao de
 * referencia o aluno nao tem (nao recebeu, retirada) nao ganha tarefa: o caminho para ali.
 */
export function childTasksOf(node: FlowNode, side: FlowBranch | null, tree: FlowTree, input: ChildAnchorInput): ChildTask[] {
  const tasks: ChildTask[] = [];

  for (const child of childrenOf(tree, node.id, node.kind === "condition" ? side : null)) {
    const anchorAt =
      child.anchor === "previous"
        ? input.completedAt
        : child.anchorNodeId === null
          ? null
          : child.anchor === "sent"
            ? input.sentAt(child.anchorNodeId)
            : input.expiresAt(child.anchorNodeId);

    if (typeof anchorAt !== "number" || !Number.isFinite(anchorAt)) {
      continue;
    }

    tasks.push({ anchorAt, ...dueFromAnchor(child, anchorAt), nodeId: child.id });
  }

  return tasks;
}

function messageFactOfNode(input: DecideInput, nodeId: string) {
  return input.facts.messages?.[messageRefKey({ kind: "node", nodeId })] ?? null;
}

/** Base de tempo dos filhos: as notificacoes acima pelos fatos do aluno; este passo pelo que acabou de ser decidido. */
function anchorsFor(input: DecideInput, own: { expiresAt: number; sentAt: number } | null): ChildAnchorInput {
  return {
    completedAt: input.now,
    expiresAt: (nodeId) => (own && nodeId === input.node.id ? own.expiresAt : (messageFactOfNode(input, nodeId)?.expiresAt ?? null)),
    sentAt: (nodeId) => (own && nodeId === input.node.id ? own.sentAt : (messageFactOfNode(input, nodeId)?.visibleAt ?? null))
  };
}

function errorMessageOf(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (message.trim() || "Erro sem mensagem.").slice(0, 2_000);
}

/** Regra ilegivel: tenta de novo em 1 e em 5 minutos; na terceira, falha. */
function retryOrFail(input: DecideInput, error: unknown): FlowDecision {
  const attempt = Math.max(1, input.task.attempts);
  const minutes = FLOW_LIMITS.retryMinutes[attempt - 1];
  const message = errorMessageOf(error);

  if (minutes !== undefined) {
    return { action: "retry", dueAt: input.now + minutes * MINUTE_MS, error: message };
  }

  return { action: "finish", children: [], error: message, result: "failed" };
}

function decideMessage(input: DecideInput, deadlineAt: number | null): FlowDecision {
  const { node, now } = input;

  if (deadlineAt !== null && now >= deadlineAt) {
    return { action: "finish", children: [], result: "expired" };
  }

  if (node.filter && !evaluateAudience(node.filter, input.facts, input.context)) {
    return { action: "finish", children: [], result: "filtered" };
  }

  if (!input.message) {
    throw new Error("Conteudo do passo nao encontrado.");
  }

  const anchorExpiresAt = node.expireWithAnchor && node.anchorNodeId ? (messageFactOfNode(input, node.anchorNodeId)?.expiresAt ?? null) : null;
  const expiresAt = computeExpiresAt(input.message, now, anchorExpiresAt);

  if (expiresAt - now < FLOW_LIMITS.bornExpiredMinutes * MINUTE_MS) {
    return { action: "finish", children: [], result: "expired" };
  }

  return {
    action: "send",
    campaignId: input.message.campaignId,
    children: childTasksOf(node, null, input.tree, anchorsFor(input, { expiresAt, sentAt: now })),
    deadlineAt,
    expiresAt
  };
}

function decideCondition(input: DecideInput, deadlineAt: number | null): FlowDecision {
  const { node, now } = input;

  if (!node.condition) {
    throw new Error("Condicao sem regras.");
  }

  if (evaluateAudience(node.condition, input.facts, input.context)) {
    return { action: "finish", children: childTasksOf(node, "yes", input.tree, anchorsFor(input, null)), result: "yes" };
  }

  if (node.waitUntilTrue && deadlineAt !== null && now < deadlineAt) {
    return { action: "defer", deadlineAt, dueAt: Math.min(nextPollAt(now), deadlineAt) };
  }

  return { action: "finish", children: childTasksOf(node, "no", input.tree, anchorsFor(input, null)), result: "no" };
}

/**
 * A decisao de uma tarefa (a primeira regra que vale ganha; docs/23):
 * 1. equipe agora -> filtered; 2. objetivo atingido -> exit_goal; 3. antes da hora de verdade
 * (max(dueFromAnchor, notBefore)) -> defer, e nada mais muda (acordada cedo, so reagenda);
 * 4. notificacao: prazo, filtro, fim em menos de 15 min, senao send com os filhos; 5. condicao: Sim,
 * espera ate a proxima faixa, ou Nao; 6. regra ilegivel: retry em 1 e 5 minutos, depois failed.
 */
export function decideFlowTask(input: DecideInput): FlowDecision {
  if (input.staff) {
    return { action: "finish", children: [], result: "filtered" };
  }

  try {
    if (input.goal && evaluateAudience(input.goal, input.facts, input.context)) {
      return { action: "exit_goal" };
    }

    const timing = dueFromAnchor(input.node, input.task.anchorAt);
    const dueAt = Math.max(timing.dueAt, input.task.notBefore ?? Number.NEGATIVE_INFINITY);

    if (input.now < dueAt) {
      return { action: "defer", deadlineAt: timing.deadlineAt, dueAt };
    }

    if (input.node.kind === "message") {
      return decideMessage(input, timing.deadlineAt);
    }

    if (input.node.kind === "condition") {
      return decideCondition(input, timing.deadlineAt);
    }

    throw new Error("A entrada do fluxo nao tem tarefa.");
  } catch (error) {
    return retryOrFail(input, error);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Conferencia da arvore (o construtor e o servidor usam a mesma)
 * ---------------------------------------------------------------------------------------------- */

const ISSUE_COPY = {
  anchorNotAbove: "Escolha uma notificação que vem antes deste passo no caminho.",
  branch: "Escolha o caminho Sim ou Não.",
  conditionRules: "A condição precisa de pelo menos uma regra.",
  ctaExternal: "Esta notificação leva para fora da área: use “foi para o destino”.",
  ctaUntracked: "Esta página não é acompanhada: use “foi para o destino”.",
  expiresWait: "Escolha de 15 minutos a 60 dias.",
  invalid: "Passo inválido.",
  maxDepth: `O fluxo vai até ${FLOW_LIMITS.maxDepth} passos em sequência.`,
  maxNodes: `Use no máximo ${FLOW_LIMITS.maxNodes} passos (notificações e condições).`,
  maxWait: "Escolha de 15 minutos a 30 dias.",
  messageNoAudio: "A notificação escolhida não tem áudio. Escolha outra regra.",
  messageNoCta: "A notificação escolhida não leva a lugar nenhum. Escolha outra regra.",
  messageNoPoll: "A notificação escolhida não tem enquete. Escolha outra regra.",
  messageNoReactions: "A notificação escolhida não aceita reações. Escolha outra regra.",
  messageNoResponse: "A notificação escolhida não pede resposta. Escolha outra regra.",
  pollOptionGone: "Esta opção não existe mais na enquete. Escolha outra.",
  noMessage: "Adicione pelo menos uma notificação.",
  pathWithoutMessage: "Este caminho termina sem nenhuma notificação.",
  pickNotification: "Escolha a notificação.",
  pickProduct: "Escolha o produto.",
  ruleNotAbove: "Esta regra confere uma notificação que não vem antes dela no caminho.",
  wait: "Escolha de 5 minutos a 60 dias."
} as const;

/** "A notificação “X” fica só 1 dia no sino. Escolha menos de 1 dia antes de vencer." */
function beforeExpiryMessage(title: string, minutes: number) {
  const label = validityDurationLabel(minutes);

  return `A notificação “${title}” fica só ${label} no sino. Escolha menos de ${label} antes de vencer.`;
}

function isInternalHref(href: string) {
  const value = href.trim();

  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

/** Espera de um passo: 0 ("Logo depois") ou de 5 minutos a 60 dias, de 5 em 5; "antes de vencer" a partir de 15. */
function offsetProblem(node: FlowNode): string | null {
  const minutes = node.offsetMinutes;
  const message = node.anchor === "expires" ? ISSUE_COPY.expiresWait : ISSUE_COPY.wait;

  if (!Number.isInteger(minutes) || minutes < 0 || minutes > FLOW_LIMITS.maxOffset || minutes % FLOW_LIMITS.offsetStep !== 0) {
    return message;
  }

  if (node.anchor === "expires" ? minutes < FLOW_LIMITS.minExpiresOffset : minutes > 0 && minutes < FLOW_LIMITS.minOffset) {
    return message;
  }

  return null;
}

type IssueSink = (level: FlowIssue["level"], nodeId: string | null, field: string | null, message: string) => void;

/**
 * Regra de mensagem que a notificacao citada nunca satisfaz (o audio, o destino, a resposta, as reacoes ou
 * a enquete sairam depois da escolha, ou a opcao escolhida saiu da enquete): sem isto, "não começou a
 * ouvir o áudio" valeria para todos. Abriu fica de fora (o conteudo daqui nao traz o texto para saber se
 * ha o que abrir); "excluiu do sino" vale para qualquer notificacao.
 */
function impossibleActionProblem(action: string, meta: FlowMessageMeta, choice?: string): string | null {
  switch (action) {
    case "audio_started":
    case "audio_completed":
      return meta.hasAudio ? null : ISSUE_COPY.messageNoAudio;
    case "clicked":
      return meta.hasCta ? null : ISSUE_COPY.messageNoCta;
    case "accepted":
    case "declined":
    case "responded":
      return meta.hasResponse ? null : ISSUE_COPY.messageNoResponse;
    case "reacted":
      return meta.allowsReactions ? null : ISSUE_COPY.messageNoReactions;
    case "voted":
      if (!meta.hasPoll) {
        return ISSUE_COPY.messageNoPoll;
      }

      return choice && !(meta.pollOptionIds ?? []).includes(choice) ? ISSUE_COPY.pollOptionGone : null;
    default:
      return null;
  }
}

/**
 * Regras de um filtro, condicao ou objetivo: referencias permitidas, a acao possivel na notificacao citada,
 * "pagina do destino" acompanhada, produto escolhido.
 */
function addRuleIssues(
  add: IssueSink,
  input: { allowed: ReadonlySet<string>; definition: AudienceDefinition | null; field: string; messages: Record<string, FlowMessageMeta>; nodeId: string | null }
) {
  for (const rule of rulesOf(input.definition)) {
    if (nodeRefsOf(rule).some((ref) => !input.allowed.has(ref))) {
      add("save", input.nodeId, input.field, ISSUE_COPY.ruleNotAbove);
      continue;
    }

    if (rule.type === "message" && rule.ref.kind === "node") {
      const meta = input.messages[rule.ref.nodeId];
      const problem = meta ? impossibleActionProblem(rule.action, meta, rule.choice) : null;

      if (problem) {
        add("save", input.nodeId, input.field, problem);
      }
    }

    if (rule.type === "page_visit" && rule.page.kind === "message_cta") {
      const href = input.messages[rule.page.nodeId]?.ctaHref ?? null;

      if (href && !isInternalHref(href)) {
        add("save", input.nodeId, input.field, ISSUE_COPY.ctaExternal);
      } else if (!pageKeyOfHref(href)) {
        add("save", input.nodeId, input.field, ISSUE_COPY.ctaUntracked);
      }
    }

    if ((rule.type === "product" || rule.type === "access_gained") && rule.productIds.length === 0) {
      add("activation", input.nodeId, input.field, ISSUE_COPY.pickProduct);
    }
  }
}

/** Passos que contam como notificacao numa referencia (num fluxo de aviso, a entrada e a notificacao principal). */
function countsAsMessage(node: FlowNode, origin: FlowOrigin) {
  return node.kind === "message" || (node.kind === "entry" && origin === "notice");
}

/**
 * Problemas da arvore: uma entrada; todo passo com pai na arvore; Sim/Nao so sob condicao; ate 20 passos e
 * 8 em sequencia; esperas nos limites; "quando" e regras so com notificacoes acima no caminho (num fluxo
 * de aviso, a entrada e a notificacao principal); "antes de vencer" menor que o tempo no sino da notificacao
 * de referencia; "pagina do destino" so de destino acompanhado. `save` bloqueia gravar, `activation` bloqueia
 * ativar e `warning` so avisa. O objetivo fica fora da arvore: validateFlowGoal.
 */
export function validateFlowTree(tree: FlowTree, messages: Record<string, FlowMessageMeta>): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const add: IssueSink = (level, nodeId, field, message) => {
    issues.push({ field, level, message, nodeId });
  };
  const byId = new Map<string, FlowNode>();

  for (const node of tree.nodes) {
    if (byId.has(node.id)) {
      add("save", node.id, null, ISSUE_COPY.invalid);
    }

    byId.set(node.id, node);
  }

  const entries = tree.nodes.filter((node) => node.kind === "entry");
  const entry = entries.length === 1 && entries[0].parentId === null ? entries[0] : null;

  if (!entry) {
    add("save", entries[0]?.id ?? null, null, ISSUE_COPY.invalid);
  }

  if (tree.nodes.length - entries.length > FLOW_LIMITS.maxNodes) {
    add("save", null, "nodes", ISSUE_COPY.maxNodes);
  }

  // Caminho de cada passo ate a entrada (os passos acima, da entrada para baixo); ciclo ou pai fora da arvore = null.
  const paths = new Map<string, FlowNode[] | null>();
  const pathOf = (node: FlowNode): FlowNode[] | null => {
    if (paths.has(node.id)) {
      return paths.get(node.id) ?? null;
    }

    const path: FlowNode[] = [];
    const seen = new Set<string>([node.id]);
    let current: FlowNode = node;
    let result: FlowNode[] | null = null;

    while (current.parentId !== null) {
      const parent = byId.get(current.parentId);

      if (!parent || seen.has(parent.id)) {
        break;
      }

      seen.add(parent.id);
      path.unshift(parent);
      current = parent;

      if (parent.kind === "entry") {
        result = path;
        break;
      }
    }

    paths.set(node.id, result);

    return result;
  };

  for (const node of tree.nodes) {
    if (node.kind === "entry") {
      continue;
    }

    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    const path = pathOf(node);

    if (!parent || !path) {
      add("save", node.id, "parentId", ISSUE_COPY.invalid);
      continue;
    }

    if (parent.kind === "condition" && node.branch === null) {
      add("save", node.id, "branch", ISSUE_COPY.branch);
    } else if (parent.kind !== "condition" && node.branch !== null) {
      add("save", node.id, "branch", ISSUE_COPY.invalid);
    }

    if (path.length > FLOW_LIMITS.maxDepth) {
      add("save", node.id, null, ISSUE_COPY.maxDepth);
    }

    const offset = offsetProblem(node);

    if (offset) {
      add("save", node.id, "offsetMinutes", offset);
    }

    if (node.kind === "condition" && node.waitUntilTrue) {
      const wait = node.maxWaitMinutes;

      if (wait === null || !Number.isInteger(wait) || wait < FLOW_LIMITS.minWait || wait > FLOW_LIMITS.maxWait) {
        add("save", node.id, "maxWaitMinutes", ISSUE_COPY.maxWait);
      }
    }

    const above = new Set(path.filter((item) => countsAsMessage(item, tree.origin)).map((item) => item.id));

    if (node.anchor !== "previous") {
      if (!node.anchorNodeId) {
        add("save", node.id, "anchorNodeId", ISSUE_COPY.pickNotification);
      } else if (!above.has(node.anchorNodeId)) {
        add("save", node.id, "anchorNodeId", ISSUE_COPY.anchorNotAbove);
      } else if (node.anchor === "expires" && !offset) {
        const anchor = messages[node.anchorNodeId];
        // Data fixa ("ate uma data") ou "ate a principal sumir": o tempo no sino depende de quando chega.
        const minutes =
          anchor && anchor.validUntil === null && !byId.get(node.anchorNodeId)?.expireWithAnchor
            ? (anchor.validityMinutes ?? DEFAULT_VALIDITY_MINUTES)
            : null;

        if (minutes !== null && node.offsetMinutes >= minutes) {
          add("save", node.id, "offsetMinutes", beforeExpiryMessage(anchor?.title ?? "", minutes));
        }
      }
    }

    if (node.kind === "condition") {
      if (!node.condition || countAudienceRules(node.condition) === 0) {
        add("save", node.id, "condition", ISSUE_COPY.conditionRules);
      }

      addRuleIssues(add, { allowed: above, definition: node.condition, field: "condition", messages, nodeId: node.id });
    }

    if (node.kind === "message") {
      addRuleIssues(add, { allowed: above, definition: node.filter, field: "filter", messages, nodeId: node.id });
    }
  }

  if (!tree.nodes.some((node) => node.kind === "message")) {
    add("activation", null, "nodes", ISSUE_COPY.noMessage);
  } else if (entry) {
    // Fim de caminho sem nenhuma notificacao: uma folha, ou o lado vazio de uma condicao.
    const walk = (node: FlowNode, reachedBefore: boolean) => {
      const reached = reachedBefore || countsAsMessage(node, tree.origin);

      for (const side of node.kind === "condition" ? (["yes", "no"] as const) : [null]) {
        const children = childrenOf(tree, node.id, side);

        if (children.length === 0 && !reached) {
          add("warning", node.id, null, ISSUE_COPY.pathWithoutMessage);
        }

        children.forEach((child) => walk(child, reached));
      }
    };

    walk(entry, false);
  }

  return issues;
}

/**
 * Problemas do objetivo: vale para o fluxo inteiro, entao pode conferir qualquer notificacao do fluxo (num
 * fluxo de aviso, tambem a principal); "pagina do destino" so de destino acompanhado; produto escolhido.
 */
export function validateFlowGoal(tree: FlowTree, goal: AudienceDefinition | null, messages: Record<string, FlowMessageMeta>): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const allowed = new Set(tree.nodes.filter((node) => countsAsMessage(node, tree.origin)).map((node) => node.id));

  addRuleIssues((level, nodeId, field, message) => issues.push({ field, level, message, nodeId }), {
    allowed,
    definition: goal,
    field: "goal",
    messages,
    nodeId: null
  });

  return issues;
}

/* ------------------------------------------------------------------------------------------------
 * Notificacoes seguintes <-> arvore (o cartao "Depois desta notificacao" e o construtor editam as mesmas linhas)
 * ---------------------------------------------------------------------------------------------- */

/**
 * A arvore como notificacoes seguintes; null = so o construtor consegue desenhar: condicao, passo que nao
 * conta do envio (ou do fim) da notificacao logo acima, "Logo depois", mais de 3 niveis contando a
 * principal ou mais de 5 por notificacao.
 */
export function followUpsFromTree(tree: FlowTree): FollowUp[] | null {
  const entry = entryOf(tree);

  if (!entry || tree.nodes.filter((node) => node.kind === "entry").length !== 1) {
    return null;
  }

  let drawable = true;
  let visited = 1;
  // Nivel 1 = a notificacao principal (a entrada); as seguintes dela, o 2; as seguintes delas, o 3.
  const build = (parent: FlowNode, level: number): FollowUp[] => {
    const children = childrenOf(tree, parent.id, null);

    if (children.length > 0 && (level >= FLOW_LIMITS.followUpDepth || children.length > FLOW_LIMITS.followUpsPerNotice)) {
      drawable = false;
    }

    return children.map((node) => {
      visited += 1;
      const minimum = node.anchor === "expires" ? FLOW_LIMITS.minExpiresOffset : FLOW_LIMITS.minOffset;

      if (node.kind !== "message" || node.anchor === "previous" || node.anchorNodeId !== parent.id || node.offsetMinutes < minimum) {
        drawable = false;
      }

      return {
        campaignId: node.campaignId ?? "",
        children: build(node, level + 1),
        expireWithAnchor: node.expireWithAnchor,
        id: node.id,
        when: { anchor: node.anchor === "expires" ? "expires" : "sent", minutes: node.offsetMinutes },
        who: node.filter ?? EVERYONE
      };
    });
  };
  const followUps = build(entry, 1);

  // Passo fora do caminho da entrada (lado de condicao, pai que nao existe): so o construtor.
  return drawable && visited === tree.nodes.length ? followUps : null;
}

/** Notificacoes seguintes -> passos (a entrada primeiro, em pre-ordem: pai antes do filho). */
export function treeFromFollowUps(entryId: string, followUps: FollowUp[]): FlowNode[] {
  const nodes: FlowNode[] = [
    {
      anchor: "previous",
      anchorNodeId: null,
      branch: null,
      campaignId: null,
      condition: null,
      expireWithAnchor: false,
      filter: null,
      id: entryId,
      kind: "entry",
      maxWaitMinutes: null,
      offsetMinutes: 0,
      parentId: null,
      position: 0,
      waitUntilTrue: false
    }
  ];
  const add = (parentId: string, items: readonly FollowUp[]) => {
    items.forEach((item, index) => {
      nodes.push({
        anchor: item.when.anchor,
        anchorNodeId: parentId,
        branch: null,
        campaignId: item.campaignId || null,
        condition: null,
        expireWithAnchor: item.expireWithAnchor,
        filter: item.who.kind === "everyone" ? null : item.who,
        id: item.id,
        kind: "message",
        maxWaitMinutes: null,
        offsetMinutes: item.when.minutes,
        parentId,
        position: index,
        waitUntilTrue: false
      });
      add(item.id, item.children);
    });
  };

  add(entryId, followUps);

  return nodes;
}

/* ------------------------------------------------------------------------------------------------
 * Paginas acompanhadas
 * ---------------------------------------------------------------------------------------------- */

/**
 * Chaves de pagina que o fluxo usa (gravadas em communication_flows.watched_page_keys a cada gravacao): as
 * regras de visita dos filtros, das condicoes e do objetivo ("pagina do destino" pelo destino do passo) e a
 * pagina do destino de cada notificacao e do aviso de origem, quando da para acompanhar (o relatorio conta
 * "Visitaram a página do destino"). Sem repeticao, em ordem, no maximo 50 (o check da tabela).
 */
export function watchedPageKeysOf(
  tree: FlowTree,
  goal: AudienceDefinition | null,
  messages: Record<string, FlowMessageMeta>,
  sourceCtaHref: string | null
): string[] {
  const keys = new Set<string>();
  const entry = entryOf(tree);
  const ctaHrefOf = (nodeId: string) => messages[nodeId]?.ctaHref ?? (tree.origin === "notice" && entry?.id === nodeId ? sourceCtaHref : null);
  const addKey = (key: string | null) => {
    if (key) {
      keys.add(key);
    }
  };

  for (const definition of flowDefinitionsOf(tree, goal)) {
    for (const rule of rulesOf(definition)) {
      if (rule.type === "page_visit") {
        addKey(rule.page.kind === "message_cta" ? pageKeyOfHref(ctaHrefOf(rule.page.nodeId)) : pageKeyOfTarget(rule.page));
      }
    }
  }

  for (const node of tree.nodes) {
    if (node.kind === "message") {
      addKey(pageKeyOfHref(messages[node.id]?.ctaHref ?? null));
    }
  }

  addKey(pageKeyOfHref(sourceCtaHref));

  return Array.from(keys).sort().slice(0, 50);
}
