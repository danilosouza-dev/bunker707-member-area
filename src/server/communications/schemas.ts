// Schemas zod dos avisos (Comunicacao > Avisos e pop-ups, docs/22; v2 em docs/23). O mesmo schema valida o
// editor no navegador do admin e as Server Actions (docs/17 §2.3). Modulo puro: sem "server-only", imports
// relativos; tests/comunicacao-segmentos.test.mjs, tests/comunicacao-avisos-modelo.test.mjs e
// tests/comunicacao-v2-mensagem.test.mjs carregam direto pelo Node. Mensagens no portugues do produtor.
//
// v2: quem envia, icone ao lado do titulo e quanto tempo fica no sino entram no conteudo
// (noticeContentSchema, o mesmo das mensagens dos fluxos em flow-schemas.ts), e as regras novas do
// segmento ("message" no segmento; "page_visit" e "access_gained" so em flowRuleDefinitionSchema).
//
// v3a (docs/24 §5.3): como o aluno chega ao destino (cta.display), reacoes e enquete no conteudo; o que
// trava depois do envio (sentNoticeLockedProblems); excluir com as seguintes; e os corpos das rotas novas
// do sino (reagir, votar, excluir do sino).

import { z } from "zod";
import { isHttpsOrLoopbackUrl } from "../../lib/loopback-url";
import { catalogIdSchema, expectedUpdatedAtSchema } from "../catalog/schemas";
import { describeHeroCtaHrefProblem, isSafeHeroCtaHref } from "../member-area/home-hero-links";
import { FIXED_PAGE_KEYS } from "../member-area/page-visit-model";
import { STUDENT_PACES } from "../students/model";
import {
  AUDIENCE_LIMITS,
  EVERYONE,
  MESSAGE_ACTIONS,
  audienceDepth,
  countAudienceRules,
  isAudienceGroup,
  normalizeAudience,
  type AudienceDefinition,
  type AudienceGroup,
  type AudienceNode
} from "./audience-model";
import { AUDIO_LIMITS, CAMPAIGN_KINDS, INBOX_HISTORY_DAYS, NOTICE_LIMITS, type CampaignKind, type PopupRepeat } from "./campaign-model";
import { isReactionId, POLL_LIMITS, POLL_OPTION_ID, pollSchema, REACTION_IDS, type PollDefinition } from "./interactions-model";
import {
  NOTICE_ICON_COLORS,
  NOTICE_ICON_IDS,
  VALIDITY_LIMITS,
  type FlowValidity,
  type NoticeIconColor,
  type NoticeIconId,
  type Validity
} from "./message-meta";
import { CTA_DISPLAYS, type CtaDisplay } from "./notification-model";

/* ------------------------------------------------------------------------------------------------
 * Segmento
 * ---------------------------------------------------------------------------------------------- */

const daysSchema = z
  .number({ error: "Informe um número de dias." })
  .int("Use um número inteiro de dias.")
  .min(1, "Use pelo menos 1 dia.")
  .max(AUDIENCE_LIMITS.maxDays, "Use no máximo 3.650 dias.");

const optionalProductSchema = catalogIdSchema.nullable();

const idListSchema = (label: string) =>
  z
    .array(catalogIdSchema)
    .min(1, `Escolha pelo menos ${label}.`)
    .max(AUDIENCE_LIMITS.maxIds, `Escolha no máximo ${AUDIENCE_LIMITS.maxIds}.`);

const pickNotificationMessage = "Escolha a notificação.";

const messageRefSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("node"), nodeId: z.uuid({ error: pickNotificationMessage }) }),
    z.object({ campaignId: z.uuid({ error: pickNotificationMessage }), kind: z.literal("campaign") })
  ],
  { error: pickNotificationMessage }
);

const flowSinceSchema = z.discriminatedUnion(
  "kind",
  [z.object({ kind: z.literal("entered") }), z.object({ kind: z.literal("message"), nodeId: z.uuid({ error: pickNotificationMessage }) })],
  { error: "Escolha desde quando conta." }
);

const pageTargetSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("content"), productId: catalogIdSchema }),
    z.object({ kind: z.literal("checkout"), productId: catalogIdSchema }),
    z.object({ key: z.enum(FIXED_PAGE_KEYS, { error: "Escolha a página." }), kind: z.literal("fixed") }),
    z.object({ kind: z.literal("message_cta"), nodeId: z.uuid({ error: pickNotificationMessage }) })
  ],
  { error: "Escolha a página." }
);

const negateSchema = z.boolean({ error: "Escolha se fez ou não fez." }).default(false);

const ruleSchema = z.discriminatedUnion(
  "type",
  [
    z.object({ op: z.enum(["has", "has_not"]), productIds: idListSchema("um produto"), type: z.literal("product") }),
    z.object({
      op: z.enum(["gte", "lte"]),
      percent: z.number({ error: "Informe a porcentagem." }).int("Use um número inteiro.").min(0, "Use de 0 a 100.").max(100, "Use de 0 a 100."),
      productId: optionalProductSchema,
      type: z.literal("progress")
    }),
    z.object({
      count: z.number({ error: "Informe a quantidade." }).int("Use um número inteiro.").min(0, "Use 0 ou mais.").max(AUDIENCE_LIMITS.maxCount, "Número alto demais."),
      days: z.union([z.literal(7), z.literal(30), z.literal(90), z.null()], { error: "Escolha o período." }),
      op: z.enum(["gte", "lte", "none", "top"]),
      type: z.literal("comments")
    }),
    z.object({ days: daysSchema, op: z.enum(["lt", "gt"]), productId: optionalProductSchema, type: z.literal("access_age") }),
    z.object({ days: daysSchema, productId: optionalProductSchema, type: z.literal("access_ending") }),
    z.object({ days: daysSchema, op: z.enum(["within", "not_within"]), type: z.literal("last_study") }),
    z.object({ days: daysSchema, op: z.enum(["never", "within", "not_within"]), type: z.literal("sign_in") }),
    z.object({
      paces: z.array(z.enum(STUDENT_PACES)).min(1, "Escolha pelo menos um ritmo.").max(STUDENT_PACES.length),
      type: z.literal("pace")
    }),
    z.object({
      cohortIds: z.array(z.uuid({ error: "Turma inválida." })).min(1, "Escolha pelo menos uma turma.").max(AUDIENCE_LIMITS.maxIds),
      type: z.literal("cohort")
    }),
    z
      .object({
        action: z.enum(MESSAGE_ACTIONS, { error: "Escolha o que o aluno fez com a notificação." }),
        // v3a: a reacao (reacted) ou o id da opcao da enquete (voted); ausente = qualquer uma.
        choice: z.string({ error: "Escolha uma opção." }).regex(/^[a-z0-9_]{1,16}$/, { error: "Escolha uma opção." }).optional(),
        negate: negateSchema,
        ref: messageRefSchema,
        type: z.literal("message")
      })
      .superRefine((rule, context) => {
        if (rule.action === "reacted" && rule.choice !== undefined && !isReactionId(rule.choice)) {
          context.addIssue({ code: "custom", message: "Escolha uma reação da lista.", path: ["choice"] });
        }
      }),
    z.object({ negate: negateSchema, page: pageTargetSchema, since: flowSinceSchema, type: z.literal("page_visit") }),
    z.object({ negate: negateSchema, productIds: idListSchema("um produto"), since: flowSinceSchema, type: z.literal("access_gained") })
  ],
  { error: "Escolha o tipo da regra." }
);

const nodeSchema: z.ZodType<AudienceNode> = z.lazy(() => z.union([ruleSchema, groupSchema]));

const groupSchema: z.ZodType<AudienceGroup> = z.lazy(() =>
  z.object({
    items: z.array(nodeSchema).max(AUDIENCE_LIMITS.maxRules, `Use no máximo ${AUDIENCE_LIMITS.maxRules} regras.`),
    match: z.enum(["all", "any"], { error: "Escolha como juntar as regras." })
  })
);

function addDefinitionLimitIssues(definition: AudienceDefinition, context: z.RefinementCtx) {
  if (countAudienceRules(definition) > AUDIENCE_LIMITS.maxRules) {
    context.addIssue({ code: "custom", message: `Use no máximo ${AUDIENCE_LIMITS.maxRules} regras.` });
  }

  if (audienceDepth(definition) > AUDIENCE_LIMITS.maxDepth) {
    context.addIssue({ code: "custom", message: "Grupos dentro de grupos vão só até um nível." });
  }

  if (definition.kind === "rules" && countAudienceRules(definition) === 0) {
    context.addIssue({ code: "custom", message: "Adicione pelo menos uma regra ou escolha todos os alunos." });
  }
}

export const FLOW_ONLY_RULE_MESSAGE = "Esta regra só vale dentro de um fluxo.";

/** Regras que so existem dentro de um fluxo: visita, acesso ganho desde um marco e passo do fluxo. */
function isFlowOnlyRule(node: AudienceNode) {
  if (isAudienceGroup(node)) {
    return false;
  }

  return node.type === "page_visit" || node.type === "access_gained" || (node.type === "message" && node.ref.kind === "node");
}

function addFlowOnlyIssues(group: AudienceGroup, path: (number | string)[], context: z.RefinementCtx) {
  group.items.forEach((item, index) => {
    const itemPath = [...path, "items", index];

    if (isAudienceGroup(item)) {
      addFlowOnlyIssues(item, itemPath, context);
    } else if (isFlowOnlyRule(item)) {
      context.addIssue({ code: "custom", message: FLOW_ONLY_RULE_MESSAGE, path: itemPath });
    }
  });
}

// discriminatedUnion (e nao union): o erro de dentro do grupo (ex.: mais de 20 regras) chega ao
// produtor com a propria mensagem, em vez de "Escolha para quem vai o aviso.".
const definitionBaseSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("everyone") }), z.object({ kind: z.literal("rules"), root: groupSchema })], {
  error: "Escolha para quem vai o aviso."
});

/**
 * Segmento comum (Avisos, pop-ups, "Quem entra" de um fluxo): aceita "o que fez com a notificacao X"
 * de um aviso enviado e recusa as regras que so valem dentro de um fluxo.
 */
export const audienceDefinitionSchema: z.ZodType<AudienceDefinition> = definitionBaseSchema.superRefine((definition, context) => {
  addDefinitionLimitIssues(definition, context);

  if (definition.kind === "rules") {
    addFlowOnlyIssues(definition.root, ["root"], context);
  }
});

/** Regras dentro de um fluxo (condicao, "So para quem...", Objetivo, "Para quem" da seguinte): tudo vale. */
export const flowRuleDefinitionSchema: z.ZodType<AudienceDefinition> = definitionBaseSchema.superRefine((definition, context) => {
  addDefinitionLimitIssues(definition, context);
});

/* ------------------------------------------------------------------------------------------------
 * Conteudo do aviso
 * ---------------------------------------------------------------------------------------------- */

function isMediaUrl(value: string) {
  try {
    return isHttpsOrLoopbackUrl(new URL(value));
  } catch {
    return false;
  }
}

/** Imagem e audio vem do Storage da escola (https; http so no Supabase local dos testes). */
const mediaUrlSchema = z
  .string({ error: "Envie o arquivo de novo." })
  .trim()
  .max(2_048, "Link longo demais.")
  .refine((value) => !/\s/.test(value) && isMediaUrl(value), "Envie o arquivo de novo.");

const imageSchema = z.object({
  alt: z.string().trim().max(NOTICE_LIMITS.imageAlt, `Use até ${NOTICE_LIMITS.imageAlt} caracteres.`),
  url: mediaUrlSchema
});

const audioSchema = z.object({
  durationSeconds: z
    .number({ error: "Envie o áudio de novo." })
    .int()
    .min(1, "O áudio precisa ter pelo menos 1 segundo.")
    .max(AUDIO_LIMITS.maxSeconds, "Use um áudio de até 5 minutos."),
  mimeType: z.string().trim().max(80).nullable(),
  peaks: z.array(z.number().int().min(0).max(100)).max(96),
  url: mediaUrlSchema
});

// cta: o destino e como o aluno chega la (v3a). Rascunho antigo sem `display` = "button".
const ctaSchema = z.object({
  display: z.enum(CTA_DISPLAYS, { error: "Escolha como o aluno chega lá." }).default("button"),
  href: z
    .string({ error: "Escolha para onde o botão leva." })
    .trim()
    .superRefine((value, context) => {
      const problem = describeHeroCtaHrefProblem(value);

      if (problem || !isSafeHeroCtaHref(value)) {
        context.addIssue({ code: "custom", message: problem ?? "Escolha para onde o botão leva." });
      }
    }),
  label: z
    .string({ error: "Escreva o texto do botão." })
    .trim()
    .min(1, "Escreva o texto do botão.")
    .max(NOTICE_LIMITS.ctaLabel, `Use até ${NOTICE_LIMITS.ctaLabel} caracteres.`),
  target: z.enum(["same_tab", "new_tab"], { error: "Escolha onde o link abre." })
});

const responseLabelSchema = (empty: string) =>
  z.string().trim().min(1, empty).max(NOTICE_LIMITS.responseLabel, `Use até ${NOTICE_LIMITS.responseLabel} caracteres.`);

const responseSchema = z.object({
  acceptLabel: responseLabelSchema("Escreva o texto do botão de aceitar."),
  declineLabel: responseLabelSchema("Escreva o texto do botão de recusar.")
});

const isoSchema = z.iso.datetime({ error: "Escolha data e hora.", offset: true });

/* ------------------------------------------------------------------------------------------------
 * Quem envia, icone ao lado do titulo e quanto tempo fica no sino (v2)
 * ---------------------------------------------------------------------------------------------- */

/** Pessoa da equipe (admin_roles, conferido no servidor ao salvar e publicar); null = a escola. */
export const senderSchema = z.object({ userId: z.uuid({ error: "Escolha alguém da equipe." }) }, { error: "Escolha alguém da equipe." }).nullable();

/** Icone do catalogo (message-meta.ts) com uma cor da paleta; null = sem icone. */
export const iconSchema = z
  .object(
    {
      color: z.enum(NOTICE_ICON_COLORS, { error: "Escolha uma cor da lista." }),
      id: z.enum(NOTICE_ICON_IDS, { error: "Escolha um ícone da lista." })
    },
    { error: "Escolha um ícone da lista." }
  )
  .nullable();

/**
 * "Por um tempo" a partir de 5 minutos (ajustes da v3a, check campaigns_validity_v3 da 202610220002); o teto
 * continua 90 dias. Os dois numeros vem de VALIDITY_LIMITS (message-meta.ts), que segue o banco.
 */
export const VALIDITY_MIN_MINUTES = VALIDITY_LIMITS.minMinutes;
export const VALIDITY_MIN_MESSAGE = "No mínimo 5 minutos.";
const VALIDITY_MAX_MESSAGE = "No máximo 90 dias.";
const VALIDITY_RANGE_MESSAGE = "Use de 5 minutos a 90 dias.";

const validityOptions = [
  // 90 dias (o padrao: nada gravado).
  z.object({ mode: z.literal("default") }),
  z.object({
    minutes: z
      .number({ error: VALIDITY_RANGE_MESSAGE })
      .int(VALIDITY_RANGE_MESSAGE)
      .min(VALIDITY_MIN_MINUTES, VALIDITY_MIN_MESSAGE)
      .max(VALIDITY_LIMITS.maxMinutes, VALIDITY_MAX_MESSAGE),
    mode: z.literal("duration")
  }),
  z.object({ endsAt: isoSchema, mode: z.literal("until") })
] as const;

const VALIDITY_PICK_MESSAGE = "Escolha quanto tempo fica no sino.";

export const validitySchema: z.ZodType<Validity> = z.discriminatedUnion("mode", [...validityOptions], { error: VALIDITY_PICK_MESSAGE });

/**
 * Conteudo de passo de fluxo (notificacao seguinte e mensagem do construtor): tambem "Ate a notificacao
 * principal sumir". Nao e coluna do aviso: vira communication_flow_nodes.expire_with_anchor (as colunas
 * de validade do aviso ficam nulas, entao 90 dias continua sendo o teto). So vale quando o passo conta a
 * partir de uma notificacao (anchor sent | expires), conferido por flow-schemas.ts; o rascunho do aviso
 * recusa.
 */
export const flowValiditySchema: z.ZodType<FlowValidity> = z.discriminatedUnion(
  "mode",
  [...validityOptions, z.object({ mode: z.literal("with_anchor") })],
  { error: VALIDITY_PICK_MESSAGE }
);

/** "Quem envia e o tempo no sino valem só para notificações." (o pop-up so ganha o icone). */
export const POPUP_SENDER_VALIDITY_MESSAGE = "Quem envia e o tempo no sino valem só para notificações.";

const scheduleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now") }),
  z.object({ mode: z.literal("at"), sendAt: isoSchema })
]);

const windowSchema = z.object({ endsAt: isoSchema.nullable(), startsAt: isoSchema.nullable() });

export type NoticeSender = { userId: string } | null;
export type NoticeIconChoice = { color: NoticeIconColor; id: NoticeIconId } | null;

export type NoticeDraft = {
  /**
   * "Permitir que o aluno exclua do sino" (ajustes da v3a, campaigns.allow_hide; so notificacao, o pop-up
   * ignora); ausente = true (a lixeira de sempre).
   */
  allowHide?: boolean;
  allowSnooze: boolean;
  audience: AudienceDefinition;
  audio: { durationSeconds: number; mimeType: string | null; peaks: number[]; url: string } | null;
  body: string;
  /** Destino; `display` (v3a, so notificacao) ausente = "button". */
  cta: { display?: CtaDisplay; href: string; label: string; target: "new_tab" | "same_tab" } | null;
  /** Icone ao lado do titulo (notificacao e pop-up); null = sem icone. */
  icon: NoticeIconChoice;
  image: { alt: string; url: string } | null;
  kind: CampaignKind;
  /** Enquete (v3a, so notificacao); ausente = sem enquete. */
  poll?: PollDefinition | null;
  /** Permitir reacoes (v3a, so notificacao); ausente = nao. */
  reactions?: boolean;
  repeat: PopupRepeat;
  response: { acceptLabel: string; declineLabel: string } | null;
  schedule: { mode: "now" } | { mode: "at"; sendAt: string };
  /** Quem envia (so notificacao); null = a escola. */
  sender: NoticeSender;
  title: string;
  /** Quanto tempo fica no sino (so notificacao). */
  validity: Validity;
  window: { endsAt: string | null; startsAt: string | null };
};

/** O conteudo de uma notificacao (titulo ate a validade): o mesmo do aviso e das mensagens dos fluxos. */
export type NoticeContent = Pick<
  NoticeDraft,
  "allowHide" | "audio" | "body" | "cta" | "icon" | "image" | "poll" | "reactions" | "response" | "sender" | "title" | "validity"
>;

/**
 * Campos do conteudo. Os tres da v2 tem padrao (escola, sem icone, 90 dias): um rascunho da v1 sem eles
 * continua valendo exatamente como antes. Os da v3a tambem (sem reacoes, sem enquete, pelo botao, com a
 * lixeira).
 */
export const NOTICE_CONTENT_FIELDS = {
  // Rascunho antigo = o aluno pode excluir (a coluna nasce true para tudo o que ja existe).
  allowHide: z.boolean({ error: "Escolha se o aluno pode excluir do sino." }).default(true),
  audio: audioSchema.nullable(),
  body: z.string({ error: "Escreva o texto." }).trim(),
  cta: ctaSchema.nullable(),
  icon: iconSchema.default(null),
  image: imageSchema.nullable(),
  poll: pollSchema.nullable().default(null),
  // Rascunho antigo = sem reacoes; os editores comecam a notificacao nova com true.
  reactions: z.boolean({ error: "Escolha se permite reações." }).default(false),
  response: responseSchema.nullable(),
  sender: senderSchema.default(null),
  title: z.string({ error: "Escreva um título." }).trim().min(1, "Escreva um título."),
  validity: validitySchema.default((): Validity => ({ mode: "default" }))
};

/**
 * Limites de titulo e texto do tipo (a mensagem de fluxo e sempre notificacao) e, da v3a, o que nao
 * convive: enquete com Aceitar/Recusar, e enquete, reacoes ou cartao clicavel no pop-up. Vale para o
 * rascunho do aviso, para noticeContentSchema e para flowNoticeContentSchema (erro no campo, nunca o erro
 * generico do check campaigns_poll_v3).
 */
export function addNoticeContentIssues(
  content: {
    body: string;
    cta?: { display?: CtaDisplay } | null;
    poll?: PollDefinition | null;
    reactions?: boolean;
    response?: unknown;
    title: string;
  },
  kind: CampaignKind,
  context: z.RefinementCtx
) {
  const limits = NOTICE_LIMITS[kind];

  if (content.title.length > limits.title) {
    context.addIssue({ code: "custom", message: `Use até ${limits.title} caracteres.`, path: ["title"] });
  }

  if (content.body.length > limits.body) {
    context.addIssue({ code: "custom", message: `Use até ${limits.body} caracteres.`, path: ["body"] });
  }

  if (content.poll && content.response) {
    context.addIssue({ code: "custom", message: "Use a resposta ou a enquete, não as duas.", path: ["poll"] });
  }

  if (kind === "popup" && content.poll) {
    context.addIssue({ code: "custom", message: "A enquete vale só para notificações por enquanto.", path: ["poll"] });
  }

  if (kind === "popup" && content.reactions) {
    context.addIssue({ code: "custom", message: "Reações valem só para notificações.", path: ["reactions"] });
  }

  if (kind === "popup" && content.cta && (content.cta.display ?? "button") !== "button") {
    context.addIssue({ code: "custom", message: "No pop-up, o destino abre pelo botão.", path: ["cta", "display"] });
  }
}

/** Conteudo de uma notificacao do sino, sem segmento nem agenda (mensagens dos fluxos usam a mesma base). */
export const noticeContentSchema: z.ZodType<NoticeContent> = z
  .object(NOTICE_CONTENT_FIELDS)
  .superRefine((content, context) => addNoticeContentIssues(content, "inbox", context));

export const noticeDraftSchema: z.ZodType<NoticeDraft> = z
  .object({
    ...NOTICE_CONTENT_FIELDS,
    allowSnooze: z.boolean(),
    audience: audienceDefinitionSchema,
    kind: z.enum(CAMPAIGN_KINDS, { error: "Escolha o tipo do aviso." }),
    repeat: z.enum(["once", "until_action"]),
    schedule: scheduleSchema,
    window: windowSchema
  })
  .superRefine((draft, context) => {
    addNoticeContentIssues(draft, draft.kind, context);

    if (draft.kind === "popup" && draft.response) {
      context.addIssue({ code: "custom", message: "Pedir resposta vale só para notificações.", path: ["response"] });
    }

    if (draft.kind === "popup" && draft.sender) {
      context.addIssue({ code: "custom", message: POPUP_SENDER_VALIDITY_MESSAGE, path: ["sender"] });
    }

    if (draft.kind === "popup" && draft.validity.mode !== "default") {
      context.addIssue({ code: "custom", message: POPUP_SENDER_VALIDITY_MESSAGE, path: ["validity"] });
    }

    const { endsAt, startsAt } = draft.window;

    if (draft.kind === "popup" && endsAt && startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      context.addIssue({ code: "custom", message: "O fim precisa vir depois do início.", path: ["window", "endsAt"] });
    }
  });

/** Regras que so valem na hora de publicar (rascunho pode guardar uma data que ja passou). */
export function publishProblems(draft: NoticeDraft, now: number): { message: string; path: string }[] {
  const problems: { message: string; path: string }[] = [];

  if (draft.kind === "inbox" && draft.schedule.mode === "at" && Date.parse(draft.schedule.sendAt) <= now) {
    problems.push({ message: "Escolha uma data no futuro.", path: "schedule.sendAt" });
  }

  if (draft.kind === "popup" && draft.window.endsAt && Date.parse(draft.window.endsAt) <= now) {
    problems.push({ message: "Escolha um fim no futuro.", path: "window.endsAt" });
  }

  if (draft.kind === "inbox" && draft.validity.mode === "until") {
    const problem = validityUntilProblem(draft.validity.endsAt, draft.schedule.mode === "at" ? Date.parse(draft.schedule.sendAt) : now);

    if (problem) {
      problems.push({ message: problem, path: "validity.endsAt" });
    }
  }

  // v3a: a enquete com fim marcado precisa terminar no futuro e depois do envio agendado.
  const closesAt = draft.kind === "inbox" && draft.poll?.closesAt ? Date.parse(draft.poll.closesAt) : Number.NaN;

  if (Number.isFinite(closesAt)) {
    if (closesAt <= now) {
      problems.push({ message: "Escolha um fim no futuro.", path: "poll.closesAt" });
    } else if (draft.schedule.mode === "at" && closesAt <= Date.parse(draft.schedule.sendAt)) {
      problems.push({ message: "A enquete encerraria antes de a notificação sair.", path: "poll.closesAt" });
    }
  }

  return problems;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * "Ate uma data" na hora do envio: pelo menos 1 hora depois e no maximo 90 dias depois (a janela do
 * sino). `sendAt` invalido = agora nao se sabe; a agenda ja acusa o problema dela.
 */
export function validityUntilProblem(endsAt: string, sendAt: number): string | null {
  const end = Date.parse(endsAt);

  if (!Number.isFinite(end) || !Number.isFinite(sendAt)) {
    return null;
  }

  if (end <= sendAt + HOUR_MS) {
    return "A notificação venceria antes de sair. Escolha um fim pelo menos 1 hora depois do envio.";
  }

  return end > sendAt + INBOX_HISTORY_DAYS * DAY_MS ? "O fim pode ser no máximo 90 dias depois do envio." : null;
}

/** Rascunho vazio de cada tipo (o editor abre assim): a notificacao nova ja permite reacoes (v3a). */
export function emptyNoticeDraft(kind: CampaignKind): NoticeDraft {
  return {
    allowHide: true,
    allowSnooze: true,
    audience: EVERYONE,
    audio: null,
    body: "",
    cta: null,
    icon: null,
    image: null,
    kind,
    poll: null,
    reactions: kind === "inbox",
    repeat: "once",
    response: null,
    schedule: { mode: "now" },
    sender: null,
    title: "",
    validity: { mode: "default" },
    window: { endsAt: null, startsAt: null }
  };
}

/* ------------------------------------------------------------------------------------------------
 * Notificacao enviada: o que muda e o que trava (v3a, docs/24 §2.2 e §4.7)
 * ---------------------------------------------------------------------------------------------- */

/** JSON com as chaves em ordem (comparacao estavel). */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value ?? null);
}

/** O mesmo instante escrito de dois jeitos ("Z" ou "+00:00", com ou sem milissegundos) e igual. */
function sameInstant(left: string | null | undefined, right: string | null | undefined) {
  if ((left ?? null) === null || (right ?? null) === null) {
    return (left ?? null) === (right ?? null);
  }

  const leftTime = Date.parse(left as string);
  const rightTime = Date.parse(right as string);

  return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? leftTime === rightTime : left === right;
}

function sameSchedule(left: NoticeDraft["schedule"], right: NoticeDraft["schedule"]) {
  if (left.mode !== right.mode) {
    return false;
  }

  return left.mode === "now" || (right.mode === "at" && sameInstant(left.sendAt, right.sendAt));
}

function sameValidity(left: Validity, right: Validity) {
  if (left.mode !== right.mode) {
    return false;
  }

  if (left.mode === "duration") {
    return right.mode === "duration" && left.minutes === right.minutes;
  }

  return left.mode === "default" || (right.mode === "until" && sameInstant(left.endsAt, right.endsAt));
}

/** Enquete comparavel: textos aparados e o fim pelo instante. */
function pollKey(poll: PollDefinition | null | undefined) {
  if (!poll) {
    return "null";
  }

  const closesAt = poll.closesAt === null ? null : Date.parse(poll.closesAt);

  return stableJson({
    closesAt: closesAt !== null && Number.isFinite(closesAt) ? closesAt : poll.closesAt,
    multiple: poll.multiple,
    options: poll.options.map((option) => ({ id: option.id, label: option.label.trim() })),
    question: poll.question.trim(),
    showResults: poll.showResults
  });
}

export const SENT_LOCKED_MESSAGES = {
  audience: "O segmento não muda depois do envio.",
  audio: "O áudio não muda depois do envio: quem já ouviu ficaria marcado como tendo ouvido o novo. Para trocar, duplique a notificação.",
  poll: "A enquete não muda depois do envio.",
  response: "Pedir uma resposta não muda depois do envio.",
  schedule: "O envio e o tempo no sino não mudam depois do envio."
} as const;

/**
 * Notificacao enviada: o que mudou e nao pode mudar (segmento, envio, tempo no sino, audio, ligar ou
 * desligar a resposta, enquete). Titulo, texto, imagem, icone, quem envia, destino, textos da resposta,
 * reacoes e a lixeira do aluno (allowHide) podem. Datas comparadas pelo instante. Vazio = pode salvar.
 */
export function sentNoticeLockedProblems(saved: NoticeDraft, next: NoticeDraft): { message: string; path: string }[] {
  const problems: { message: string; path: string }[] = [];

  if (stableJson(normalizeAudience(saved.audience)) !== stableJson(normalizeAudience(next.audience))) {
    problems.push({ message: SENT_LOCKED_MESSAGES.audience, path: "audience" });
  }

  if (!sameSchedule(saved.schedule, next.schedule)) {
    problems.push({ message: SENT_LOCKED_MESSAGES.schedule, path: "schedule.sendAt" });
  }

  if (!sameValidity(saved.validity, next.validity)) {
    problems.push({ message: SENT_LOCKED_MESSAGES.schedule, path: "validity" });
  }

  if ((saved.audio?.url ?? null) !== (next.audio?.url ?? null) || (saved.audio?.durationSeconds ?? null) !== (next.audio?.durationSeconds ?? null)) {
    problems.push({ message: SENT_LOCKED_MESSAGES.audio, path: "audio" });
  }

  if (((saved.response ?? null) === null) !== ((next.response ?? null) === null)) {
    problems.push({ message: SENT_LOCKED_MESSAGES.response, path: "response" });
  }

  if (pollKey(saved.poll) !== pollKey(next.poll)) {
    problems.push({ message: SENT_LOCKED_MESSAGES.poll, path: "poll" });
  }

  return problems;
}

/* ------------------------------------------------------------------------------------------------
 * Entradas das Server Actions
 * ---------------------------------------------------------------------------------------------- */

const campaignIdSchema = z.uuid({ error: "Aviso inválido." });

export const saveNoticeSchema = z.object({
  draft: noticeDraftSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  id: campaignIdSchema.optional(),
  /** v3a: "Mostrar de novo para quem já viu" junto com o salvar de um pop-up no ar ou pausado em "Uma vez". */
  reshow: z.boolean().optional()
});
export type SaveNoticeInput = z.infer<typeof saveNoticeSchema>;

export const noticeIdSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  id: campaignIdSchema
});
export type NoticeIdInput = z.infer<typeof noticeIdSchema>;

/** "Retirar do sino" (v2): com as notificacoes seguintes que ja sairam, marcado por padrao. */
export const withdrawNoticeSchema = noticeIdSchema.extend({ alsoFollowUps: z.boolean().default(true) });
export type WithdrawNoticeInput = z.input<typeof withdrawNoticeSchema>;

/** "Excluir" (v3a) em qualquer situacao: a enviada sai do sino com as seguintes que ja sairam, por padrao. */
export const deleteNoticeSchema = noticeIdSchema.extend({ alsoFollowUps: z.boolean().default(true) });
export type DeleteNoticeInput = z.input<typeof deleteNoticeSchema>;

export const previewAudienceSchema = z.object({ audience: audienceDefinitionSchema });

/**
 * Audio do aviso no sino (POST /api/notifications/[id]/audio): "started" no primeiro play e "progress"
 * com os 48 trechos ouvidos ("0"/"1"). Mensagens da API sem acento, como as outras rotas do sino.
 */
export const audioEventSchema = z.discriminatedUnion(
  "event",
  [
    z.object({ event: z.literal("started") }),
    z.object({ event: z.literal("progress"), heard: z.string({ error: "Evento invalido." }).regex(/^[01]{48}$/, "Evento invalido.") })
  ],
  { error: "Evento invalido." }
);
export type AudioEventInput = z.infer<typeof audioEventSchema>;

/**
 * Rotas novas do sino (v3a, docs/24 §5.1): reagir (null tira a reacao), votar ([] tira o voto) e excluir
 * do proprio sino (false = Desfazer). Mensagens da API sem acento.
 */
const INVALID_REACTION = "Reacao invalida.";
const INVALID_VOTE = "Voto invalido.";
const INVALID_HIDE = "Pedido invalido.";

export const reactionBodySchema = z.object({ reaction: z.enum(REACTION_IDS, { error: INVALID_REACTION }).nullable() }, { error: INVALID_REACTION });
export type ReactionBody = z.infer<typeof reactionBodySchema>;

export const pollVoteBodySchema = z.object(
  {
    optionIds: z
      .array(z.string({ error: INVALID_VOTE }).regex(POLL_OPTION_ID, { error: INVALID_VOTE }), { error: INVALID_VOTE })
      .max(POLL_LIMITS.maxOptions, { error: INVALID_VOTE })
  },
  { error: INVALID_VOTE }
);
export type PollVoteBody = z.infer<typeof pollVoteBodySchema>;

export const hideBodySchema = z.object({ hidden: z.boolean({ error: INVALID_HIDE }) }, { error: INVALID_HIDE });
export type HideBody = z.infer<typeof hideBodySchema>;

/** Imagem 16:9 recortada no navegador (slot "notice", src/server/catalog/webp.ts). */
export const uploadNoticeImageSchema = z.object({
  image: z
    .string({ error: "Envie a imagem recortada (WebP)." })
    .max(560_000, "A imagem ficou grande demais. Recorte de novo.")
    .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/, "Envie a imagem recortada (WebP).")
});
