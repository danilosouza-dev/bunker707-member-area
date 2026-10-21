// Schemas zod dos fluxos e das notificacoes seguintes (Comunicacao v2, docs/23). O mesmo schema valida o
// construtor e o cartao "Depois desta notificacao" no navegador e as Server Actions. Modulo puro: sem
// "server-only", imports relativos; os testes carregam direto pelo Node. Mensagens no portugues do produtor.
//
// O conteudo de cada notificacao de fluxo e o mesmo do aviso (NOTICE_CONTENT_FIELDS), com mais uma opcao
// de tempo no sino: "Ate a notificacao principal sumir" (vira communication_flow_nodes.expire_with_anchor).
// A arvore inteira e conferida por validateFlowTree (flow-model.ts), a mesma regra do servidor.

import { z } from "zod";
import { expectedUpdatedAtSchema } from "../catalog/schemas";
import { countAudienceRules, type AudienceDefinition } from "./audience-model";
import { FLOW_LIMITS, validateFlowTree, type FlowBranch, type FlowEntryMode, type FlowMessageMeta, type FlowNode, type FlowOrigin, type FlowTree } from "./flow-model";
import { validityToColumns, type FlowValidity } from "./message-meta";
import {
  addNoticeContentIssues,
  audienceDefinitionSchema,
  flowRuleDefinitionSchema,
  flowValiditySchema,
  NOTICE_CONTENT_FIELDS,
  type NoticeContent
} from "./schemas";

/* ------------------------------------------------------------------------------------------------
 * Conteudo de uma notificacao do fluxo
 * ---------------------------------------------------------------------------------------------- */

export type FlowNoticeContent = Omit<NoticeContent, "validity"> & { validity: FlowValidity };

/** Enquete de seguinte ou de passo de fluxo: o envio e relativo, entao a data fixa poderia cair antes dele (v3a). */
export const FLOW_POLL_CLOSES_AT_MESSAGE = "Numa notificação seguinte ou num passo de fluxo, a enquete encerra quando a notificação sair do sino.";

/**
 * O conteudo do aviso com `validity` aceitando "Ate a notificacao principal sumir". Sempre notificacao. A
 * enquete (v3a) so encerra quando a notificacao sai do sino.
 */
export const flowNoticeContentSchema: z.ZodType<FlowNoticeContent> = z
  .object({ ...NOTICE_CONTENT_FIELDS, validity: flowValiditySchema.default((): FlowValidity => ({ mode: "default" })) })
  .superRefine((content, context) => {
    addNoticeContentIssues(content, "inbox", context);

    if (content.poll && content.poll.closesAt !== null) {
      context.addIssue({ code: "custom", message: FLOW_POLL_CLOSES_AT_MESSAGE, path: ["poll", "closesAt"] });
    }
  });

export const WITH_ANCHOR_NEEDS_NOTIFICATION_MESSAGE = "Escolha quando ela sai em relação a uma notificação.";

/* ------------------------------------------------------------------------------------------------
 * Passos
 * ---------------------------------------------------------------------------------------------- */

const nodeIdSchema = z.uuid({ error: "Passo inválido." });

const WAIT_MESSAGE = "Escolha de 5 minutos a 60 dias.";
const EXPIRES_WAIT_MESSAGE = "Escolha de 15 minutos a 60 dias.";
const MAX_WAIT_MESSAGE = "Escolha de 15 minutos a 30 dias.";
const PICK_NOTIFICATION_MESSAGE = "Escolha a notificação.";
const CONDITION_RULES_MESSAGE = "A condição precisa de pelo menos uma regra.";

/** Minutos de espera: 0 ("Logo depois") ou de 5 minutos a 60 dias, de 5 em 5. */
const offsetSchema = z
  .number({ error: WAIT_MESSAGE })
  .int(WAIT_MESSAGE)
  .min(0, WAIT_MESSAGE)
  .max(FLOW_LIMITS.maxOffset, WAIT_MESSAGE)
  .refine((value) => value % FLOW_LIMITS.offsetStep === 0, WAIT_MESSAGE);

const positionSchema = z.number().int().min(0).max(100).default(0);
const branchSchema = z.enum(["yes", "no"], { error: "Escolha o caminho Sim ou Não." }).nullable().default(null);
const anchorSchema = z.enum(["previous", "sent", "expires"], { error: "Escolha quando ele acontece." }).default("previous");

type TimingFields = { anchor: "expires" | "previous" | "sent"; anchorNodeId: string | null; offsetMinutes: number; parentId: string | null };

/** "Quando": base, notificacao de referencia e minutos; o passo que nao e a entrada tem pai. */
function addTimingIssues(node: TimingFields, context: z.RefinementCtx) {
  if (!node.parentId) {
    context.addIssue({ code: "custom", message: "Passo inválido.", path: ["parentId"] });
  }

  if (node.anchor !== "previous" && !node.anchorNodeId) {
    context.addIssue({ code: "custom", message: PICK_NOTIFICATION_MESSAGE, path: ["anchorNodeId"] });
  }

  if (node.anchor === "previous" && node.anchorNodeId) {
    context.addIssue({ code: "custom", message: "Passo inválido.", path: ["anchorNodeId"] });
  }

  if (node.anchor === "expires" && node.offsetMinutes < FLOW_LIMITS.minExpiresOffset) {
    context.addIssue({ code: "custom", message: EXPIRES_WAIT_MESSAGE, path: ["offsetMinutes"] });
  }

  if (node.anchor !== "expires" && node.offsetMinutes > 0 && node.offsetMinutes < FLOW_LIMITS.minOffset) {
    context.addIssue({ code: "custom", message: WAIT_MESSAGE, path: ["offsetMinutes"] });
  }
}

const timingFields = {
  anchor: anchorSchema,
  anchorNodeId: nodeIdSchema.nullable().default(null),
  branch: branchSchema,
  id: nodeIdSchema,
  offsetMinutes: offsetSchema.default(0),
  parentId: nodeIdSchema.nullable(),
  position: positionSchema
};

const entryNodeSchema = z
  .object({ branch: branchSchema, id: nodeIdSchema, kind: z.literal("entry"), parentId: z.null().default(null), position: positionSchema })
  .superRefine((node, context) => {
    if (node.branch) {
      context.addIssue({ code: "custom", message: "Passo inválido.", path: ["branch"] });
    }
  });

const messageNodeSchema = z
  .object({ ...timingFields, filter: flowRuleDefinitionSchema.nullable().default(null), kind: z.literal("message") })
  .superRefine((node, context) => addTimingIssues(node, context));

const conditionNodeSchema = z
  .object({
    ...timingFields,
    condition: flowRuleDefinitionSchema,
    kind: z.literal("condition"),
    maxWaitMinutes: z
      .number({ error: MAX_WAIT_MESSAGE })
      .int(MAX_WAIT_MESSAGE)
      .min(FLOW_LIMITS.minWait, MAX_WAIT_MESSAGE)
      .max(FLOW_LIMITS.maxWait, MAX_WAIT_MESSAGE)
      .nullable()
      .default(null),
    waitUntilTrue: z.boolean().default(false)
  })
  .superRefine((node, context) => {
    addTimingIssues(node, context);

    if (countAudienceRules(node.condition) === 0) {
      context.addIssue({ code: "custom", message: CONDITION_RULES_MESSAGE, path: ["condition"] });
    }

    if (node.waitUntilTrue && node.maxWaitMinutes === null) {
      context.addIssue({ code: "custom", message: MAX_WAIT_MESSAGE, path: ["maxWaitMinutes"] });
    }
  });

/** Passo como o construtor manda (ids gerados no navegador). O conteudo de cada notificacao vem em `messages`. */
export type FlowNodeDraft =
  | { branch: FlowBranch | null; id: string; kind: "entry"; parentId: null; position: number }
  | {
      anchor: "expires" | "previous" | "sent";
      anchorNodeId: string | null;
      branch: FlowBranch | null;
      filter: AudienceDefinition | null;
      id: string;
      kind: "message";
      offsetMinutes: number;
      parentId: string | null;
      position: number;
    }
  | {
      anchor: "expires" | "previous" | "sent";
      anchorNodeId: string | null;
      branch: FlowBranch | null;
      condition: AudienceDefinition;
      id: string;
      kind: "condition";
      maxWaitMinutes: number | null;
      offsetMinutes: number;
      parentId: string | null;
      position: number;
      waitUntilTrue: boolean;
    };

export const flowNodeSchema: z.ZodType<FlowNodeDraft> = z.discriminatedUnion("kind", [entryNodeSchema, messageNodeSchema, conditionNodeSchema], {
  error: "Escolha o tipo do passo."
});

/* ------------------------------------------------------------------------------------------------
 * Fluxo inteiro
 * ---------------------------------------------------------------------------------------------- */

export const FLOW_ENTRY_MODES = ["current", "current_and_new", "new_only"] as const satisfies readonly FlowEntryMode[];

export type FlowDraft = {
  entry: { audience: AudienceDefinition; mode: FlowEntryMode };
  /** Objetivo: o aluno sai do fluxo quando combinar; null = sem objetivo. */
  goal: AudienceDefinition | null;
  /** Conteudo de cada passo de notificacao, pelo id do passo. */
  messages: Record<string, FlowNoticeContent>;
  name: string;
  /** Todos os passos vivos, a entrada primeiro (pai antes do filho). */
  nodes: FlowNodeDraft[];
  /** builder = Comunicacao > Fluxos; notice = as notificacoes seguintes de um aviso. */
  origin: FlowOrigin;
};

/** Rascunho -> a arvore e o conteudo que validateFlowTree confere (o rascunho ainda nao tem versao gravada). */
export function flowTreeOfDraft(draft: Pick<FlowDraft, "messages" | "nodes" | "origin">): { messages: Record<string, FlowMessageMeta>; tree: FlowTree } {
  const messages: Record<string, FlowMessageMeta> = {};
  const nodes: FlowNode[] = draft.nodes.map((node) => {
    const content = node.kind === "message" ? draft.messages[node.id] : undefined;

    if (content) {
      const validity = validityToColumns(content.validity);

      messages[node.id] = {
        allowsReactions: content.reactions ?? false,
        campaignId: "",
        ctaHref: content.cta?.href ?? null,
        hasAudio: Boolean(content.audio),
        hasCta: Boolean(content.cta),
        hasPoll: Boolean(content.poll),
        hasResponse: Boolean(content.response),
        pollOptionIds: content.poll?.options.map((option) => option.id) ?? [],
        title: content.title,
        validUntil: validity.valid_until,
        validityMinutes: validity.validity_minutes
      };
    }

    return {
      anchor: node.kind === "entry" ? "previous" : node.anchor,
      anchorNodeId: node.kind === "entry" ? null : node.anchorNodeId,
      branch: node.branch,
      campaignId: null,
      condition: node.kind === "condition" ? node.condition : null,
      expireWithAnchor: content?.validity.mode === "with_anchor",
      filter: node.kind === "message" ? node.filter : null,
      id: node.id,
      kind: node.kind,
      maxWaitMinutes: node.kind === "condition" && node.waitUntilTrue ? node.maxWaitMinutes : null,
      offsetMinutes: node.kind === "entry" ? 0 : node.offsetMinutes,
      parentId: node.parentId,
      position: node.position,
      waitUntilTrue: node.kind === "condition" ? node.waitUntilTrue : false
    };
  });

  return { messages, tree: { nodes, origin: draft.origin } };
}

export const flowDraftSchema: z.ZodType<FlowDraft> = z
  .object({
    entry: z.object({
      audience: audienceDefinitionSchema,
      mode: z.enum(FLOW_ENTRY_MODES, { error: "Escolha quem entra." })
    }),
    goal: flowRuleDefinitionSchema.nullable().default(null),
    messages: z.record(nodeIdSchema, flowNoticeContentSchema),
    name: z.string({ error: "Dê um nome ao fluxo." }).trim().min(1, "Dê um nome ao fluxo.").max(80, "Use até 80 caracteres."),
    nodes: z
      .array(flowNodeSchema)
      .min(1, "Passo inválido.")
      .max(FLOW_LIMITS.maxNodes + 1, `Use no máximo ${FLOW_LIMITS.maxNodes} passos (notificações e condições).`),
    origin: z.enum(["builder", "notice"]).default("builder")
  })
  .superRefine((draft, context) => {
    if (draft.goal && countAudienceRules(draft.goal) === 0) {
      context.addIssue({ code: "custom", message: "O objetivo precisa de pelo menos uma regra.", path: ["goal"] });
    }

    for (const node of draft.nodes) {
      const content = node.kind === "message" ? draft.messages[node.id] : undefined;

      if (node.kind === "message" && !content) {
        context.addIssue({ code: "custom", message: "Escreva um título.", path: ["messages", node.id, "title"] });
      }

      if (node.kind === "message" && content?.validity.mode === "with_anchor" && node.anchor === "previous") {
        context.addIssue({ code: "custom", message: WITH_ANCHOR_NEEDS_NOTIFICATION_MESSAGE, path: ["messages", node.id, "validity"] });
      }
    }

    const { messages, tree } = flowTreeOfDraft(draft);

    for (const issue of validateFlowTree(tree, messages)) {
      if (issue.level === "save") {
        const path = issue.nodeId ? ["nodes", issue.nodeId, ...(issue.field ? [issue.field] : [])] : issue.field ? [issue.field] : [];

        context.addIssue({ code: "custom", message: issue.message, path });
      }
    }
  });

/* ------------------------------------------------------------------------------------------------
 * Notificacoes seguintes de um aviso ("Depois desta notificacao")
 * ---------------------------------------------------------------------------------------------- */

export type FollowUpDraft = {
  children: FollowUpDraft[];
  content: FlowNoticeContent;
  /** Id do passo (uuid gerado no navegador). */
  id: string;
  /** "Quando sai": minutos depois do envio da anterior, ou antes de ela vencer. */
  when: { anchor: "expires" | "sent"; minutes: number };
  /** "Para quem" (quem recebeu a anterior e...); todos = { kind: "everyone" }. */
  who: AudienceDefinition;
};

const FOLLOW_UPS_PER_LEVEL_MESSAGE = `Use no máximo ${FLOW_LIMITS.followUpsPerNotice} notificações seguintes por notificação.`;
const FOLLOW_UP_DEPTH_MESSAGE = "As notificações seguintes vão até 3 níveis, contando a notificação principal.";

const followUpWhenSchema = z
  .object({
    anchor: z.enum(["sent", "expires"], { error: "Escolha quando ela sai." }),
    minutes: z.number({ error: WAIT_MESSAGE }).int(WAIT_MESSAGE).max(FLOW_LIMITS.maxOffset, WAIT_MESSAGE)
  })
  .superRefine((when, context) => {
    const min = when.anchor === "expires" ? FLOW_LIMITS.minExpiresOffset : FLOW_LIMITS.minOffset;

    if (when.minutes < min || when.minutes % FLOW_LIMITS.offsetStep !== 0) {
      context.addIssue({ code: "custom", message: when.anchor === "expires" ? EXPIRES_WAIT_MESSAGE : WAIT_MESSAGE, path: ["minutes"] });
    }
  });

export const followUpDraftSchema: z.ZodType<FollowUpDraft> = z.lazy(() =>
  z.object({
    children: z.array(followUpDraftSchema).max(FLOW_LIMITS.followUpsPerNotice, FOLLOW_UPS_PER_LEVEL_MESSAGE).default([]),
    content: flowNoticeContentSchema,
    id: nodeIdSchema,
    when: followUpWhenSchema,
    who: flowRuleDefinitionSchema
  })
);

function addFollowUpTreeIssues(followUps: readonly FollowUpDraft[], context: z.RefinementCtx) {
  const seen = new Set<string>();
  let total = 0;

  // Nivel 1 = a notificacao principal; as seguintes dela sao o nivel 2 e as seguintes delas, o 3.
  const walk = (items: readonly FollowUpDraft[], level: number, path: (number | string)[]) => {
    items.forEach((item, index) => {
      const itemPath = [...path, index];
      total += 1;

      if (seen.has(item.id)) {
        context.addIssue({ code: "custom", message: "Passo inválido.", path: [...itemPath, "id"] });
      }

      seen.add(item.id);

      if (item.children.length > 0 && level + 1 >= FLOW_LIMITS.followUpDepth) {
        context.addIssue({ code: "custom", message: FOLLOW_UP_DEPTH_MESSAGE, path: [...itemPath, "children"] });
      }

      walk(item.children, level + 1, [...itemPath, "children"]);
    });
  };

  walk(followUps, 1, ["followUps"]);

  if (total > FLOW_LIMITS.maxNodes) {
    context.addIssue({ code: "custom", message: `Use no máximo ${FLOW_LIMITS.maxNodes} notificações seguintes.`, path: ["followUps"] });
  }
}

const campaignIdSchema = z.uuid({ error: "Aviso inválido." });
const flowIdSchema = z.uuid({ error: "Fluxo inválido." });

export const saveNoticeFollowUpsSchema = z
  .object({
    /** Versao do fluxo lida pela tela; null = a tela nao viu fluxo nenhum (outra que criou um no meio da 409). */
    expectedFlowUpdatedAt: expectedUpdatedAtSchema.nullable().optional(),
    expectedNoticeUpdatedAt: expectedUpdatedAtSchema,
    followUps: z.array(followUpDraftSchema).max(FLOW_LIMITS.followUpsPerNotice, FOLLOW_UPS_PER_LEVEL_MESSAGE),
    /** "Parar as notificacoes seguintes para quem tiver acesso a [produto]" (o Objetivo do fluxo do aviso). */
    goal: z
      .object({
        productId: z
          .string({ error: "Escolha o produto." })
          .trim()
          .regex(/^[A-Za-z0-9_-]{1,240}$/, "Escolha o produto.")
      })
      .nullable(),
    noticeId: campaignIdSchema
  })
  .superRefine((input, context) => addFollowUpTreeIssues(input.followUps, context));
export type SaveNoticeFollowUpsInput = z.input<typeof saveNoticeFollowUpsSchema>;

/** Contagem ao vivo da seguinte: quem recebeu a anterior (null = o proprio aviso) e combina agora. */
export const previewFollowUpAudienceSchema = z.object({
  filter: flowRuleDefinitionSchema,
  noticeId: campaignIdSchema,
  parentNodeId: nodeIdSchema.nullable()
});
export type PreviewFollowUpAudienceInput = z.input<typeof previewFollowUpAudienceSchema>;

/* ------------------------------------------------------------------------------------------------
 * Entradas das Server Actions dos fluxos (flow-actions.ts)
 * ---------------------------------------------------------------------------------------------- */

export const saveFlowSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  flow: flowDraftSchema,
  id: flowIdSchema.optional()
});
export type SaveFlowInput = z.input<typeof saveFlowSchema>;

/** Ativar, aprovar, recusar, pausar, retomar e encerrar: sempre com a versao lida pela tela. */
export const flowStateSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema, id: flowIdSchema });
export type FlowStateInput = z.infer<typeof flowStateSchema>;

/** Duplicar e excluir. */
export const flowIdInputSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema.optional(), id: flowIdSchema });
export type FlowIdInput = z.infer<typeof flowIdInputSchema>;

/** Retirar do sino um passo de notificacao (todas as versoes). */
export const withdrawFlowMessageSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema, id: flowIdSchema, nodeId: nodeIdSchema });
export type WithdrawFlowMessageInput = z.infer<typeof withdrawFlowMessageSchema>;

/** "Enviar teste para mim" de um passo (a versao atual). */
export const flowMessageTestSchema = z.object({ id: flowIdSchema, nodeId: nodeIdSchema });
export type FlowMessageTestInput = z.infer<typeof flowMessageTestSchema>;
