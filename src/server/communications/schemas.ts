// Schemas zod dos avisos (Comunicacao > Avisos e pop-ups, docs/22). O mesmo schema valida o editor no
// navegador do admin e as Server Actions (docs/17 §2.3). Modulo puro: sem "server-only", imports
// relativos; tests/comunicacao-segmentos.test.mjs e tests/comunicacao-avisos-modelo.test.mjs carregam
// direto pelo Node. Mensagens no portugues do produtor.

import { z } from "zod";
import { isHttpsOrLoopbackUrl } from "../../lib/loopback-url";
import { catalogIdSchema, expectedUpdatedAtSchema } from "../catalog/schemas";
import { describeHeroCtaHrefProblem, isSafeHeroCtaHref } from "../member-area/home-hero-links";
import { STUDENT_PACES } from "../students/model";
import {
  AUDIENCE_LIMITS,
  EVERYONE,
  audienceDepth,
  countAudienceRules,
  type AudienceDefinition,
  type AudienceGroup,
  type AudienceNode
} from "./audience-model";
import { AUDIO_LIMITS, CAMPAIGN_KINDS, NOTICE_LIMITS, type CampaignKind, type PopupRepeat } from "./campaign-model";

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
    })
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

// discriminatedUnion (e nao union): o erro de dentro do grupo (ex.: mais de 20 regras) chega ao
// produtor com a propria mensagem, em vez de "Escolha para quem vai o aviso.".
export const audienceDefinitionSchema: z.ZodType<AudienceDefinition> = z
  .discriminatedUnion("kind", [z.object({ kind: z.literal("everyone") }), z.object({ kind: z.literal("rules"), root: groupSchema })], {
    error: "Escolha para quem vai o aviso."
  })
  .superRefine((definition, context) => {
    if (countAudienceRules(definition) > AUDIENCE_LIMITS.maxRules) {
      context.addIssue({ code: "custom", message: `Use no máximo ${AUDIENCE_LIMITS.maxRules} regras.` });
    }

    if (audienceDepth(definition) > AUDIENCE_LIMITS.maxDepth) {
      context.addIssue({ code: "custom", message: "Grupos dentro de grupos vão só até um nível." });
    }

    if (definition.kind === "rules" && countAudienceRules(definition) === 0) {
      context.addIssue({ code: "custom", message: "Adicione pelo menos uma regra ou escolha todos os alunos." });
    }
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

const ctaSchema = z.object({
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

const scheduleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now") }),
  z.object({ mode: z.literal("at"), sendAt: isoSchema })
]);

const windowSchema = z.object({ endsAt: isoSchema.nullable(), startsAt: isoSchema.nullable() });

export type NoticeDraft = {
  allowSnooze: boolean;
  audience: AudienceDefinition;
  audio: { durationSeconds: number; mimeType: string | null; peaks: number[]; url: string } | null;
  body: string;
  cta: { href: string; label: string; target: "new_tab" | "same_tab" } | null;
  image: { alt: string; url: string } | null;
  kind: CampaignKind;
  repeat: PopupRepeat;
  response: { acceptLabel: string; declineLabel: string } | null;
  schedule: { mode: "now" } | { mode: "at"; sendAt: string };
  title: string;
  window: { endsAt: string | null; startsAt: string | null };
};

export const noticeDraftSchema: z.ZodType<NoticeDraft> = z
  .object({
    allowSnooze: z.boolean(),
    audience: audienceDefinitionSchema,
    audio: audioSchema.nullable(),
    body: z.string({ error: "Escreva o texto." }).trim(),
    cta: ctaSchema.nullable(),
    image: imageSchema.nullable(),
    kind: z.enum(CAMPAIGN_KINDS, { error: "Escolha o tipo do aviso." }),
    repeat: z.enum(["once", "until_action"]),
    response: responseSchema.nullable(),
    schedule: scheduleSchema,
    title: z.string({ error: "Escreva um título." }).trim().min(1, "Escreva um título."),
    window: windowSchema
  })
  .superRefine((draft, context) => {
    const limits = NOTICE_LIMITS[draft.kind];

    if (draft.title.length > limits.title) {
      context.addIssue({ code: "custom", message: `Use até ${limits.title} caracteres.`, path: ["title"] });
    }

    if (draft.body.length > limits.body) {
      context.addIssue({ code: "custom", message: `Use até ${limits.body} caracteres.`, path: ["body"] });
    }

    if (draft.kind === "popup" && draft.response) {
      context.addIssue({ code: "custom", message: "Pedir resposta vale só para notificações.", path: ["response"] });
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

  return problems;
}

/** Rascunho vazio de cada tipo (o editor abre assim). */
export function emptyNoticeDraft(kind: CampaignKind): NoticeDraft {
  return {
    allowSnooze: true,
    audience: EVERYONE,
    audio: null,
    body: "",
    cta: null,
    image: null,
    kind,
    repeat: "once",
    response: null,
    schedule: { mode: "now" },
    title: "",
    window: { endsAt: null, startsAt: null }
  };
}

/* ------------------------------------------------------------------------------------------------
 * Entradas das Server Actions
 * ---------------------------------------------------------------------------------------------- */

const campaignIdSchema = z.uuid({ error: "Aviso inválido." });

export const saveNoticeSchema = z.object({
  draft: noticeDraftSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  id: campaignIdSchema.optional()
});
export type SaveNoticeInput = z.infer<typeof saveNoticeSchema>;

export const noticeIdSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  id: campaignIdSchema
});
export type NoticeIdInput = z.infer<typeof noticeIdSchema>;

export const previewAudienceSchema = z.object({ audience: audienceDefinitionSchema });

/** Imagem 16:9 recortada no navegador (slot "notice", src/server/catalog/webp.ts). */
export const uploadNoticeImageSchema = z.object({
  image: z
    .string({ error: "Envie a imagem recortada (WebP)." })
    .max(560_000, "A imagem ficou grande demais. Recorte de novo.")
    .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/, "Envie a imagem recortada (WebP).")
});
