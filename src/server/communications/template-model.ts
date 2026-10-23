// Modelos da Comunicacao (docs/28; migracao 202610250001): a configuracao pronta de uma notificacao, de um pop-up
// ou so do design (Personalizado ou Livre) que a equipe guarda para comecar avisos novos. Aqui ficam os tipos do
// payload (versao 1), os limites, os textos, os schemas (o rascunho afrouxado que os editores mandam e o payload
// estrito por partes, para a leitura), os construtores (rascunho -> payload, design -> payload), a leitura do banco
// parte por parte (parse-on-read: parte que nao passa vira o padrao com uma nota), o que o editor abre a partir de
// um modelo (noticeStartOfTemplate), a aplicacao de um modelo de Design num rascunho, o resumo da lista, os nomes e
// o mapa de erros da Server Action para os campos do editor.
//
// Modulo puro (servidor e navegador): imports relativos, sem "server-only", sem React, nunca de src/components
// (tests/comunicacao-modelos.guard.test.mjs). A limpeza dos arquivos le o jsonb cru (media-refs.templateMediaUse),
// nunca esta leitura: um modelo que deixasse de passar no schema perderia os arquivos.
//
// Nunca vao para o payload (docs/28 §3.6): data e hora de envio, janela do pop-up, "ate uma data", fim marcado da
// enquete, `repeat` (derivado), "mostrar de novo", situacao, aprovacao, ids de aviso ou de fluxo, numeros e a versao
// da linha; nem o destino do botao no apoio do design, nem a URL de video do Livre (so o caminho).

import { z } from "zod";
import { expectedUpdatedAtSchema } from "../catalog/schemas";
import { describeHeroCtaHrefProblem, isSafeHeroCtaHref } from "../member-area/home-hero-links";
import { EVERYONE, normalizeAudience, remapNodeRefs, type AudienceDefinition } from "./audience-model";
import { CAMPAIGN_KINDS, NOTICE_LIMITS, type CampaignKind } from "./campaign-model";
import { FLOW_LIMITS } from "./flow-model";
import { addFollowUpTreeIssues, followUpDraftSchema, type FlowNoticeContent, type FollowUpDraft } from "./flow-schemas";
import { POLL_LIMITS, POLL_OPTION_ID } from "./interactions-model";
import { VALIDITY_LIMITS } from "./message-meta";
import { CTA_DISPLAYS, type CtaDisplay } from "./notification-model";
import { syncPopupDesignBlocks, type PopupDesign } from "./popup-design-model";
import { popupDesignSchema } from "./popup-design-schema";
import { canonicalPopupSettings, defaultPopupSettings, popupFrequencyToSave, repeatOfFrequency, type PopupSettings } from "./popup-display-model";
import { canonicalPopupFreeDesign, jsonbBytesUpperBound, walkFreeNodes, type PopupFreeDesign } from "./popup-free-model";
import { POPUP_FREE_MESSAGES, popupFreeDesignSchema } from "./popup-free-schema";
import { syncFreeDesignWithContent } from "./popup-free-starters";
import {
  addNoticeContentIssues,
  audienceDefinitionSchema,
  emptyNoticeDraft,
  iconSchema,
  NOTICE_CONTENT_FIELDS,
  popupSettingsSchema,
  POPUP_SENDER_VALIDITY_MESSAGE,
  senderSchema,
  VALIDITY_MIN_MESSAGE,
  VALIDITY_MIN_MINUTES,
  validitySchema,
  withoutInboxPopup,
  type NoticeDraft,
  type NoticeIconChoice,
  type NoticeSender
} from "./schemas";

/* ------------------------------------------------------------------------------------------------
 * Tipos, limites e enderecos
 * ---------------------------------------------------------------------------------------------- */

export const TEMPLATE_VERSION = 1 as const;
export const TEMPLATE_KINDS = ["inbox", "popup", "design"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type TemplateDesignMode = "custom" | "free";
export const TEMPLATES_TABLE = "communication_templates";

export const TEMPLATE_LIMITS = {
  maxTemplates: 200,
  name: 80,
  /** Estimativa por cima (jsonbBytesUpperBound); o check do banco e 1048576. Pior aviso valido ~650 KB (D14). */
  payloadBytes: 786_432,
  /** "Meus modelos" no card Design e no editor Livre. */
  pickerItems: 50,
  listPageSize: 20,
  /** Menu do "Novo aviso". */
  recentForNewNotice: 5,
  /** O que o navegador guarda e manda em fromTemplates / sourceTemplateIds (sem repetidos; o de inicio sempre fica). */
  sourcesPerSave: 5,
  /** O que o servidor aceita por pedido (tira os repetidos; nunca recusa o uso normal). Igual ao .max de saveNoticeSchema.fromTemplates. */
  sourcesAccepted: 20,
  /** Modelo ou aviso excluido ha menos que isto ainda conta como "arquivo ja conferido" (D16 b). */
  deletedKnownDays: 29
} as const;

/** A aba Modelos (o unico lugar do endereco; a tela e o servidor importam daqui). */
export const TEMPLATES_HREF = "/admin/comunicacao/modelos";

/**
 * O ?tipo= da lista e de /modelos/novo: um parser so (as frentes da tela importam daqui).
 * Valor desconhecido -> null (a lista mostra "Todos"; /modelos/novo mostra a escolha do tipo).
 */
export const TEMPLATE_TYPE_PARAMS = { design_custom: "design-personalizado", design_free: "design-livre", inbox: "notificacao", popup: "popup" } as const;
export type TemplateType = keyof typeof TEMPLATE_TYPE_PARAMS;

const TEMPLATE_TYPES = Object.keys(TEMPLATE_TYPE_PARAMS) as TemplateType[];

export function parseTemplateTypeParam(value: unknown): TemplateType | null {
  if (typeof value !== "string") {
    return null;
  }

  return TEMPLATE_TYPES.find((type) => TEMPLATE_TYPE_PARAMS[type] === value) ?? null;
}

export function templateTypeOf(kind: TemplateKind, designMode: TemplateDesignMode | null): TemplateType {
  if (kind === "design") {
    return designMode === "free" ? "design_free" : "design_custom";
  }

  return kind;
}

export function kindOfTemplateType(type: TemplateType): { kind: TemplateKind; mode: TemplateDesignMode | null } {
  switch (type) {
    case "design_custom":
      return { kind: "design", mode: "custom" };
    case "design_free":
      return { kind: "design", mode: "free" };
    default:
      return { kind: type, mode: null };
  }
}

/** Rotulos do tipo (lista, seletores e cabecalhos). */
export const TEMPLATE_KIND_LABELS = { design_custom: "Design Personalizado", design_free: "Design Livre", inbox: "Notificação", popup: "Pop-up" } as const;

export function templateTypeLabel(kind: TemplateKind, designMode: TemplateDesignMode | null): string {
  return TEMPLATE_KIND_LABELS[templateTypeOf(kind, designMode)];
}

/** Tempo no sino sem data fixa. */
export type TemplateValidity = { mode: "default" } | { minutes: number; mode: "duration" };

/** O card Conteudo do aviso. Pode estar incompleto (D8): os textos obrigatorios podem vir vazios. */
export type TemplateContent = {
  audio: { durationSeconds: number; mimeType: string | null; peaks: number[]; url: string } | null;
  body: string;
  /** href e label podem ser "" (o destino e escolhido no aviso). */
  cta: { display: CtaDisplay; href: string; label: string; target: "new_tab" | "same_tab" } | null;
  image: { alt: string; url: string } | null;
  /** Sem fim marcado (closesAt sempre null); pergunta e opcoes podem ser "". */
  poll: { closesAt: null; multiple: boolean; options: { id: string; label: string }[]; question: string; showResults: boolean } | null;
  reactions: boolean;
  /** Textos podem ser "". */
  response: { acceptLabel: string; declineLabel: string } | null;
  /** Pode ser "". No pop-up com design, e o "Nome do pop-up". */
  title: string;
};

/** Apoio do design quando o conteudo nao vai junto (D3, D4). */
export type TemplateDesignSupport = {
  /** Texto do botao principal quando o design tem o botao (Personalizado: bloco "button"; Livre: no com action cta). */
  ctaLabel: string | null;
  /** Personalizado com midia imagem ou video: a imagem do aviso (midia ou capa). Livre: sempre null. */
  image: { alt: string; url: string } | null;
};

/** As notificacoes seguintes (D7): ids do modelo, trocados por novos ao usar. */
export type TemplateFollowUps = {
  /** O id que as regras das seguintes usam para a notificacao principal. */
  entryId: string;
  goal: { productId: string } | null;
  /** FollowUpDraft de flow-schemas.ts, sem "ate uma data" (vira 90 dias) e com enquete sem fim marcado. */
  items: FollowUpDraft[];
};

export type InboxTemplatePayload = {
  /** null = "Levar o segmento" desligado. */
  audience: AudienceDefinition | null;
  /** null = "Levar o conteudo" desligado. */
  content: TemplateContent | null;
  /** null = sem seguintes ou chave desligada. */
  followUps: TemplateFollowUps | null;
  kind: "inbox";
  settings: { allowHide: boolean; icon: NoticeIconChoice; sender: NoticeSender; validity: TemplateValidity };
  version: 1;
};

export type PopupTemplatePayload = {
  audience: AudienceDefinition | null;
  content: TemplateContent | null;
  /** null = Padrao; Personalizado (sem "mode") ou Livre ("mode": "free"), na mesma forma gravada no aviso. */
  design: PopupDesign | PopupFreeDesign | null;
  /** So quando ha design e content e null; senao null. */
  designSupport: TemplateDesignSupport | null;
  kind: "popup";
  settings: { allowSnooze: boolean; icon: NoticeIconChoice; popup: PopupSettings };
  version: 1;
};

export type DesignTemplatePayload = {
  design: PopupDesign | PopupFreeDesign;
  designSupport: TemplateDesignSupport;
  kind: "design";
  version: 1;
};

export type TemplatePayload = DesignTemplatePayload | InboxTemplatePayload | PopupTemplatePayload;
export type TemplateInclude = { audience: boolean; content: boolean; followUps: boolean };

/** As chaves de um modelo gravado (D31): parte diferente de null = ligada; Design e null = tudo desligado; modelo novo = tudo ligado. */
export function templateIncludeOf(payload: TemplatePayload | null): TemplateInclude {
  if (!payload || payload.kind === "design") {
    return { audience: false, content: false, followUps: false };
  }

  return {
    audience: payload.audience !== null,
    content: payload.content !== null,
    followUps: payload.kind === "inbox" && payload.followUps !== null
  };
}

/* ------------------------------------------------------------------------------------------------
 * Textos (servidor e notas, todos exatos; docs/28 §3.4)
 * ---------------------------------------------------------------------------------------------- */

export const TEMPLATE_MESSAGES = {
  applyCta: (label: string) => `O botão principal ganhou o texto “${label}”. Escolha para onde ele leva.`,
  applyNeedsImage: "Este design usa uma imagem. Envie a imagem na Mídia.",
  applySnooze: "“Lembrar depois” foi ligado: o design tem esse botão.",
  changed: "Este modelo mudou em outra tela há instantes. Recarregue a página para ver a versão atual.",
  changedTitle: "Este modelo mudou em outra tela",
  designUnreadable:
    "O design deste pop-up não pôde ser lido e não iria para o modelo. Abra o pop-up, confira o design e salve antes de guardar como modelo.",
  flowStep: "Este aviso é um passo de fluxo. Ele muda pelo fluxo.",
  followUpSenderGone: "Alguém que enviava uma notificação seguinte não está mais na equipe: ela vai em nome da escola.",
  fontInTemplates: (count: number) =>
    count === 1
      ? "Esta fonte está em 1 modelo. Troque a fonte nesse modelo ou exclua o modelo antes."
      : `Esta fonte está em ${count} modelos. Troque a fonte nesses modelos ou exclua os modelos antes.`,
  kindFixed: "O tipo do modelo não muda.",
  limit: "Você chegou a 200 modelos. Exclua um que não usa mais para criar outro.",
  missing: "Este modelo não existe mais. Ele pode ter sido excluído em outra tela.",
  noteBuilderOnly: "As notificações seguintes deste aviso só abrem no construtor de fluxos e não foram para o modelo.",
  noteFollowUpUntil: "As notificações seguintes com “até uma data” ficam com 90 dias no modelo.",
  noteOtherGoal: "O objetivo das notificações seguintes foi mudado no construtor de fluxos e não vai para o modelo.",
  notePollEnd: "O fim marcado da enquete não vai para o modelo: ela encerra quando a notificação sair do sino.",
  noteUntil: "“Fica no sino até uma data” não vai para o modelo: ele fica com 90 dias.",
  pickDesign: "Escolha um design para guardar.",
  readAudience: "O segmento guardado neste modelo não pôde ser lido: ficou “Todos os alunos”.",
  readContent: "O conteúdo guardado neste modelo não pôde ser lido e ficou de fora.",
  readDesign: "O design guardado neste modelo não pôde ser lido e ficou no Padrão.",
  readFollowUps: "As notificações seguintes guardadas neste modelo não puderam ser lidas e ficaram de fora.",
  readSettings: "A configuração guardada neste modelo não pôde ser lida e voltou ao padrão.",
  senderGone: (name: string) => `Quem envia no modelo (${name}) não está mais na equipe: a notificação vai em nome da escola. Troque em “Quem envia” se quiser.`,
  startFrom: (name: string) => `Você começou do modelo “${name}”. Nada foi salvo ainda.`,
  startMissing: "Este modelo não existe mais. Você está começando em branco.",
  startUnreadable: "Este modelo não pode ser aberto. Você está começando em branco.",
  tooBig: "Este modelo ficou grande demais para guardar. Tire algumas regras de “Para quem” ou notificações seguintes e tente de novo.",
  unreadable: "Este modelo não pode ser aberto: ele foi guardado num formato que não vale mais. Você pode excluí-lo."
} as const;

const READ_NOTES: readonly string[] = [
  TEMPLATE_MESSAGES.readAudience,
  TEMPLATE_MESSAGES.readContent,
  TEMPLATE_MESSAGES.readDesign,
  TEMPLATE_MESSAGES.readFollowUps,
  TEMPLATE_MESSAGES.readSettings
];

/** As notas de leitura (read*) entre as notas: o editor pede confirmacao no primeiro "Salvar modelo" (D29). */
export function hasReadNotes(notes: readonly string[]): boolean {
  return notes.some((note) => READ_NOTES.includes(note));
}

/* ------------------------------------------------------------------------------------------------
 * Pecas afrouxadas (D8)
 * ---------------------------------------------------------------------------------------------- */

const looseText = (max: number) => z.string({ error: "Texto inválido." }).trim().max(max, `Use até ${max} caracteres.`);

/** Destino pode ficar vazio; preenchido, segue a mesma regra do aviso. */
export const templateCtaSchema = z.object({
  display: z.enum(CTA_DISPLAYS, { error: "Escolha como o aluno chega lá." }).default("button"),
  href: z
    .string({ error: "Escolha para onde o botão leva." })
    .trim()
    .max(2_048, "Link longo demais.")
    .superRefine((value, context) => {
      if (value && (describeHeroCtaHrefProblem(value) || !isSafeHeroCtaHref(value))) {
        context.addIssue({ code: "custom", message: describeHeroCtaHrefProblem(value) ?? "Escolha para onde o botão leva." });
      }
    }),
  label: looseText(NOTICE_LIMITS.ctaLabel),
  target: z.enum(["same_tab", "new_tab"], { error: "Escolha onde o link abre." })
});

export const templateResponseSchema = z.object({
  acceptLabel: looseText(NOTICE_LIMITS.responseLabel),
  declineLabel: looseText(NOTICE_LIMITS.responseLabel)
});

const pollFields = {
  multiple: z.boolean().default(false),
  options: z
    .array(z.object({ id: z.string().regex(POLL_OPTION_ID, "Opção inválida."), label: looseText(POLL_LIMITS.option) }))
    .min(POLL_LIMITS.minOptions, `Use pelo menos ${POLL_LIMITS.minOptions} opções.`)
    .max(POLL_LIMITS.maxOptions, `Use no máximo ${POLL_LIMITS.maxOptions} opções.`),
  question: looseText(POLL_LIMITS.question),
  showResults: z.boolean().default(true)
};

/** Sem fim marcado: closesAt vira null (o construtor do payload anota). */
export const templatePollSchema = z.object({
  closesAt: z
    .unknown()
    .optional()
    .transform((): null => null),
  ...pollFields
});

/**
 * A enquete do rascunho que os editores mandam: igual a templatePollSchema, mas o fim marcado ainda chega ao
 * construtor (templatePayloadOfDraft), que o tira e anota notePollEnd. Nunca e gravado.
 */
const templatePollInputSchema = z.object({
  closesAt: z
    .unknown()
    .optional()
    .transform((value): string | null => (typeof value === "string" && value.trim() ? value : null)),
  ...pollFields
});

export const templateValiditySchema = z.discriminatedUnion(
  "mode",
  [
    z.object({ mode: z.literal("default") }),
    z.object({
      minutes: z.number().int().min(VALIDITY_MIN_MINUTES, VALIDITY_MIN_MESSAGE).max(VALIDITY_LIMITS.maxMinutes, "No máximo 90 dias."),
      mode: z.literal("duration")
    })
  ],
  { error: "Escolha quanto tempo fica no sino." }
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFreeDesign(design: PopupDesign | PopupFreeDesign): design is PopupFreeDesign {
  return (design as { mode?: unknown }).mode === "free";
}

/** O design pelo roteador: mode "free" -> schema do Livre; o resto -> Personalizado (os dois estritos). */
export const templateDesignValueSchema: z.ZodType<PopupDesign | PopupFreeDesign> = z.unknown().transform((value, context) => {
  const parsed = isRecord(value) && value.mode === "free" ? popupFreeDesignSchema.safeParse(value) : popupDesignSchema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  for (const issue of parsed.error.issues) {
    context.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  }

  return z.NEVER;
});

export const templateDesignSupportSchema = z.strictObject({
  ctaLabel: looseText(NOTICE_LIMITS.ctaLabel)
    .nullable()
    .transform((value) => (value ? value : null)),
  image: NOTICE_CONTENT_FIELDS.image
});

/* ------------------------------------------------------------------------------------------------
 * Entrada dos editores (formato do rascunho, para os erros cairem nos mesmos campos)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O rascunho que os editores mandam: as chaves de NoticeDraft, afrouxadas (D8). Chaves de envio (schedule, window)
 * sao aceitas e descartadas (z.object comum, nao estrito). `repeat` (a regra da v1, derivada) so concilia "Quantas
 * vezes" quando `popup` nao vem (popupFrequencyToSave) e nunca e gravado. Na notificacao, popup/design/freeDesign
 * saem antes pelo mesmo withoutInboxPopup do rascunho.
 */
export const templateDraftInputSchema = z.preprocess(
  withoutInboxPopup,
  z
    .object({
      allowHide: z.boolean().default(true),
      allowSnooze: z.boolean().default(true),
      audience: audienceDefinitionSchema,
      audio: NOTICE_CONTENT_FIELDS.audio,
      body: NOTICE_CONTENT_FIELDS.body,
      cta: templateCtaSchema.nullable(),
      design: popupDesignSchema.nullable().optional(),
      freeDesign: popupFreeDesignSchema.nullable().optional(),
      icon: iconSchema.default(null),
      image: NOTICE_CONTENT_FIELDS.image,
      kind: z.enum(CAMPAIGN_KINDS, { error: "Escolha o tipo do aviso." }),
      poll: templatePollInputSchema.nullable().default(null),
      popup: popupSettingsSchema.optional(),
      reactions: z.boolean().default(false),
      repeat: z.enum(["once", "until_action"]).optional(),
      response: templateResponseSchema.nullable(),
      sender: senderSchema.default(null),
      title: z.string({ error: "Escreva um título." }).trim(),
      // "until" e aceito aqui e vira "default" no construtor, com nota (D9).
      validity: validitySchema.default({ mode: "default" })
    })
    .superRefine((draft, context) => {
      // limites por tipo, enquete x resposta, pop-up sem enquete/reacoes/cartao
      addNoticeContentIssues(draft, draft.kind, context);

      if (draft.kind === "popup" && draft.design && draft.freeDesign) {
        context.addIssue({ code: "custom", message: POPUP_FREE_MESSAGES.bothDesigns, path: ["freeDesign"] });
      }

      // As tres regras do pop-up do noticeDraftObjectSchema (schemas.ts), com as mesmas frases.
      if (draft.kind === "popup" && draft.response) {
        context.addIssue({ code: "custom", message: "Pedir resposta vale só para notificações.", path: ["response"] });
      }

      if (draft.kind === "popup" && draft.sender) {
        context.addIssue({ code: "custom", message: POPUP_SENDER_VALIDITY_MESSAGE, path: ["sender"] });
      }

      if (draft.kind === "popup" && draft.validity.mode !== "default") {
        context.addIssue({ code: "custom", message: POPUP_SENDER_VALIDITY_MESSAGE, path: ["validity"] });
      }
    })
);
export type TemplateDraftInput = z.output<typeof templateDraftInputSchema>;

const productGoalSchema = z.object({ productId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,240}$/, "Escolha o produto.") }).nullable();

export const templateFollowUpsInputSchema = z
  .object({
    entryId: z.uuid({ error: "Passo inválido." }),
    goal: productGoalSchema,
    items: z
      .array(followUpDraftSchema)
      .max(FLOW_LIMITS.followUpsPerNotice, `Use no máximo ${FLOW_LIMITS.followUpsPerNotice} notificações seguintes por notificação.`)
  })
  .superRefine((value, context) => addFollowUpTreeIssues(value.items, context));

export const templateNameSchema = z
  .string({ error: "Dê um nome ao modelo." })
  .trim()
  .min(1, "Dê um nome ao modelo.")
  .max(TEMPLATE_LIMITS.name, "Use até 80 caracteres.");
export const templateIdSchema = z.uuid({ error: "Modelo inválido." });

/** Aceita ate 20 e tira os repetidos (o navegador manda no maximo 5; o servidor nunca recusa o uso normal). */
const sourceIdsSchema = z
  .array(templateIdSchema)
  .max(TEMPLATE_LIMITS.sourcesAccepted, "Modelo inválido.")
  .default([])
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/** free_editor = aba Modelos do editor Livre ("Salvar este design como modelo"). */
export const TEMPLATE_ORIGINS = ["notice_editor", "design_card", "free_editor", "template_editor"] as const;
export type TemplateOrigin = (typeof TEMPLATE_ORIGINS)[number];

const includeSchema = z.object({ audience: z.boolean(), content: z.boolean(), followUps: z.boolean() });

export const saveTemplateSchema = z
  .object({
    body: z.discriminatedUnion("source", [
      z.object({
        draft: templateDraftInputSchema,
        followUps: templateFollowUpsInputSchema.nullable(),
        include: includeSchema,
        source: z.literal("notice")
      }),
      z.object({
        design: popupDesignSchema.nullable(),
        freeDesign: popupFreeDesignSchema.nullable(),
        source: z.literal("design"),
        support: templateDesignSupportSchema
      })
    ]),
    expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
    id: templateIdSchema.optional(),
    name: templateNameSchema,
    origin: z.enum(TEMPLATE_ORIGINS),
    sourceNoticeId: z.uuid({ error: "Aviso inválido." }).nullable().optional(),
    sourceTemplateIds: sourceIdsSchema
  })
  .superRefine((input, context) => {
    if (input.body.source === "design") {
      if (input.body.design && input.body.freeDesign) {
        context.addIssue({ code: "custom", message: POPUP_FREE_MESSAGES.bothDesigns, path: ["body", "freeDesign"] });
      } else if (!input.body.design && !input.body.freeDesign) {
        context.addIssue({ code: "custom", message: TEMPLATE_MESSAGES.pickDesign, path: ["body", "design"] });
      }
    }

    if (input.id && !input.expectedUpdatedAt) {
      context.addIssue({ code: "custom", message: "Recarregue a página e tente de novo.", path: ["expectedUpdatedAt"] });
    }
  });
export type SaveTemplateInput = z.input<typeof saveTemplateSchema>;

export const saveTemplateFromNoticeSchema = z.object({
  include: includeSchema,
  name: templateNameSchema,
  noticeId: z.uuid({ error: "Aviso inválido." })
});
export const renameTemplateSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema, id: templateIdSchema, name: templateNameSchema });
export const templateIdInputSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema.optional(), id: templateIdSchema });
export const loadDesignTemplatesSchema = z.object({ mode: z.enum(["custom", "free"], { error: "Modo inválido." }) });

/* ------------------------------------------------------------------------------------------------
 * Payload gravado (estrito, por partes, para o parse-on-read)
 * ---------------------------------------------------------------------------------------------- */

export const templateContentSchema = z.strictObject({
  audio: NOTICE_CONTENT_FIELDS.audio,
  body: NOTICE_CONTENT_FIELDS.body,
  cta: templateCtaSchema.nullable(),
  image: NOTICE_CONTENT_FIELDS.image,
  poll: templatePollSchema.nullable(),
  reactions: z.boolean(),
  response: templateResponseSchema.nullable(),
  title: z.string().trim()
});
export const inboxTemplateSettingsSchema = z.strictObject({ allowHide: z.boolean(), icon: iconSchema, sender: senderSchema, validity: templateValiditySchema });
export const popupTemplateSettingsSchema = z.strictObject({ allowSnooze: z.boolean(), icon: iconSchema, popup: popupSettingsSchema });
/** A mesma regra ao salvar e ao ler. */
export const templateFollowUpsSchema = templateFollowUpsInputSchema;

const POPUP_RESPONSE_MESSAGE = "Pedir resposta vale só para notificações.";

/** Problemas do conteudo por tipo (limites, enquete x resposta, pop-up sem enquete/reacoes/resposta), sem o prefixo do caminho. */
function contentProblems(content: Pick<TemplateContent, "body" | "cta" | "poll" | "reactions" | "response" | "title">, kind: CampaignKind) {
  const problems: { message: string; path: PropertyKey[] }[] = [];
  const collector = {
    addIssue(issue: { message?: string; path?: PropertyKey[] }) {
      problems.push({ message: issue.message ?? "", path: issue.path ?? [] });
    }
  } as unknown as z.RefinementCtx;

  addNoticeContentIssues(content, kind, collector);

  if (kind === "popup" && content.response) {
    problems.push({ message: POPUP_RESPONSE_MESSAGE, path: ["response"] });
  }

  return problems;
}

export const templatePayloadSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      audience: audienceDefinitionSchema.nullable(),
      content: templateContentSchema.nullable(),
      followUps: templateFollowUpsSchema.nullable(),
      kind: z.literal("inbox"),
      settings: inboxTemplateSettingsSchema,
      version: z.literal(1)
    }),
    z.strictObject({
      audience: audienceDefinitionSchema.nullable(),
      content: templateContentSchema.nullable(),
      design: templateDesignValueSchema.nullable(),
      designSupport: templateDesignSupportSchema.nullable(),
      kind: z.literal("popup"),
      settings: popupTemplateSettingsSchema,
      version: z.literal(1)
    }),
    z.strictObject({ design: templateDesignValueSchema, designSupport: templateDesignSupportSchema, kind: z.literal("design"), version: z.literal(1) })
  ])
  .superRefine((payload, context) => {
    if (payload.kind !== "design" && payload.content) {
      for (const problem of contentProblems(payload.content, payload.kind)) {
        context.addIssue({ code: "custom", message: problem.message, path: ["content", ...problem.path] });
      }
    }

    if (jsonbBytesUpperBound(payload) > TEMPLATE_LIMITS.payloadBytes) {
      context.addIssue({ code: "custom", message: TEMPLATE_MESSAGES.tooBig, path: [] });
    }
  }) as unknown as z.ZodType<TemplatePayload>;

/* ------------------------------------------------------------------------------------------------
 * Construtores
 * ---------------------------------------------------------------------------------------------- */

/** O rascunho que os construtores leem: o do editor (TemplateDraftInput) ou o da linha gravada (NoticeDraft). */
type TemplateSourceDraft = Pick<NoticeDraft, "audience" | "audio" | "body" | "image" | "kind" | "title" | "validity"> & {
  allowHide?: boolean;
  allowSnooze: boolean;
  cta: { display?: CtaDisplay; href: string; label: string; target: "new_tab" | "same_tab" } | null;
  design?: PopupDesign | null;
  freeDesign?: PopupFreeDesign | null;
  icon?: NoticeIconChoice;
  poll?: { closesAt: string | null; multiple: boolean; options: { id: string; label: string }[]; question: string; showResults: boolean } | null;
  popup?: PopupSettings;
  reactions?: boolean;
  repeat?: NoticeDraft["repeat"];
  response: { acceptLabel: string; declineLabel: string } | null;
  sender?: NoticeSender;
};

function imageOf(image: { alt: string; url: string } | null | undefined) {
  return image ? { alt: image.alt, url: image.url } : null;
}

function contentOfDraft(draft: TemplateSourceDraft, notes: string[]): TemplateContent {
  const inbox = draft.kind === "inbox";
  const poll = inbox && draft.poll ? draft.poll : null;

  if (poll?.closesAt) {
    notes.push(TEMPLATE_MESSAGES.notePollEnd);
  }

  return {
    audio: draft.audio ? { durationSeconds: draft.audio.durationSeconds, mimeType: draft.audio.mimeType, peaks: [...draft.audio.peaks], url: draft.audio.url } : null,
    body: draft.body,
    cta: draft.cta ? { display: draft.cta.display ?? "button", href: draft.cta.href, label: draft.cta.label, target: draft.cta.target } : null,
    image: imageOf(draft.image),
    poll: poll
      ? {
          closesAt: null,
          multiple: poll.multiple,
          options: poll.options.map((option) => ({ id: option.id, label: option.label })),
          question: poll.question,
          showResults: poll.showResults
        }
      : null,
    reactions: inbox ? Boolean(draft.reactions) : false,
    response: inbox && draft.response ? { acceptLabel: draft.response.acceptLabel, declineLabel: draft.response.declineLabel } : null,
    title: draft.title
  };
}

/** Uma seguinte para o modelo: sem "ate uma data" (vira 90 dias), enquete sem fim marcado, nada alem do formato do cartao. */
function followUpForTemplate(item: FollowUpDraft, found: { until: boolean }): FollowUpDraft {
  const content: FlowNoticeContent = item.content;
  let validity = content.validity;

  if (validity.mode === "until") {
    validity = { mode: "default" };
    found.until = true;
  }

  return {
    children: (item.children ?? []).map((child) => followUpForTemplate(child, found)),
    content: {
      allowHide: content.allowHide ?? true,
      audio: content.audio,
      body: content.body,
      cta: content.cta,
      icon: content.icon,
      image: content.image,
      poll: content.poll ? { ...content.poll, closesAt: null } : null,
      reactions: content.reactions ?? false,
      response: content.response,
      sender: content.sender,
      title: content.title,
      validity
    },
    id: item.id,
    when: { anchor: item.when.anchor, minutes: item.when.minutes },
    who: normalizeAudience(item.who)
  };
}

/** O botao principal do design (Personalizado: bloco "button"; Livre: no com action cta). */
function designHasPrimaryButton(design: PopupDesign | PopupFreeDesign): boolean {
  if (isFreeDesign(design)) {
    let found = false;
    walkFreeNodes(design.children, (node) => {
      found ||= node.type === "button" && node.action.kind === "cta";
    });
    return found;
  }

  return design.blocks.some((block) => block.type === "button");
}

/** O botao "Lembrar depois" do design (Personalizado: segundo botao snooze; Livre: no button com action snooze). */
function designHasSnoozeButton(design: PopupDesign | PopupFreeDesign): boolean {
  if (isFreeDesign(design)) {
    let found = false;
    walkFreeNodes(design.children, (node) => {
      found ||= node.type === "button" && node.action.kind === "snooze";
    });
    return found;
  }

  return design.blocks.some((block) => block.type === "button2" && block.action.kind === "snooze");
}

/** Personalizado com a midia em imagem ou video (o video usa a imagem do aviso como capa). */
function designUsesNoticeImage(design: PopupDesign | PopupFreeDesign): boolean {
  return !isFreeDesign(design) && (design.media.kind === "image" || design.media.kind === "video");
}

/** O apoio do design a partir do rascunho (D3/D4): ctaLabel so se o design tem o botao; image so no Personalizado com midia. */
export function templateDesignSupportOf(draft: Pick<NoticeDraft, "cta" | "design" | "freeDesign" | "image">): TemplateDesignSupport {
  const design = draft.freeDesign ?? draft.design ?? null;

  if (!design) {
    return { ctaLabel: null, image: null };
  }

  const label = draft.cta?.label.trim() ?? "";

  return {
    ctaLabel: designHasPrimaryButton(design) && label ? label : null,
    image: designUsesNoticeImage(design) ? imageOf(draft.image) : null
  };
}

function designSupportFor(design: PopupDesign | PopupFreeDesign, support: TemplateDesignSupport): TemplateDesignSupport {
  const label = support.ctaLabel?.trim() ?? "";

  return {
    ctaLabel: designHasPrimaryButton(design) && label ? label : null,
    image: designUsesNoticeImage(design) ? imageOf(support.image) : null
  };
}

/** Rascunho (validado por templateDraftInputSchema, ou o da linha gravada) -> payload. Aplica as chaves, tira as datas, anota. */
export function templatePayloadOfDraft(input: {
  draft: TemplateSourceDraft;
  followUps: TemplateFollowUps | null;
  include: TemplateInclude;
}): { notes: string[]; payload: InboxTemplatePayload | PopupTemplatePayload } {
  const { draft, include } = input;
  const notes: string[] = [];
  const content = include.content ? contentOfDraft(draft, notes) : null;
  const audience = include.audience ? normalizeAudience(draft.audience) : null;

  if (draft.kind === "inbox") {
    let validity: TemplateValidity = { mode: "default" };

    if (draft.validity.mode === "until") {
      notes.push(TEMPLATE_MESSAGES.noteUntil);
    } else if (draft.validity.mode === "duration") {
      validity = { minutes: draft.validity.minutes, mode: "duration" };
    }

    let followUps: TemplateFollowUps | null = null;

    if (include.followUps && input.followUps && input.followUps.items.length > 0) {
      const found = { until: false };
      followUps = {
        entryId: input.followUps.entryId,
        goal: input.followUps.goal ? { productId: input.followUps.goal.productId } : null,
        items: input.followUps.items.map((item) => followUpForTemplate(item, found))
      };

      if (found.until) {
        notes.push(TEMPLATE_MESSAGES.noteFollowUpUntil);
      }
    }

    return {
      notes,
      payload: {
        audience,
        content,
        followUps,
        kind: "inbox",
        settings: { allowHide: draft.allowHide ?? true, icon: draft.icon ?? null, sender: draft.sender ?? null, validity },
        version: TEMPLATE_VERSION
      }
    };
  }

  const base = draft.popup ?? defaultPopupSettings();
  const frequency = popupFrequencyToSave({
    frequency: draft.popup?.frequency,
    hasCta: Boolean(draft.cta),
    repeat: draft.repeat ?? (draft.popup ? repeatOfFrequency(draft.popup.frequency) : "once"),
    stored: null
  });
  const design = draft.freeDesign ? canonicalPopupFreeDesign(draft.freeDesign) : (draft.design ?? null);
  const designSupport = design && content === null ? templateDesignSupportOf(draft) : null;

  return {
    notes,
    payload: {
      audience,
      content,
      design,
      designSupport,
      kind: "popup",
      settings: { allowSnooze: draft.allowSnooze, icon: draft.icon ?? null, popup: canonicalPopupSettings({ ...base, frequency }) },
      version: TEMPLATE_VERSION
    }
  };
}

/** Design (Personalizado ou Livre) + apoio -> payload de Design. */
export function templatePayloadOfDesign(input: { design: PopupDesign | null; freeDesign: PopupFreeDesign | null; support: TemplateDesignSupport }): DesignTemplatePayload {
  const design: PopupDesign | PopupFreeDesign | null = input.freeDesign ? canonicalPopupFreeDesign(input.freeDesign) : input.design;

  if (!design) {
    throw new Error("Comunicacao: modelo de design sem design.");
  }

  return { design, designSupport: designSupportFor(design, input.support), kind: "design", version: TEMPLATE_VERSION };
}

export function templateDesignModeOf(payload: TemplatePayload): TemplateDesignMode | null {
  if (payload.kind === "inbox" || !payload.design) {
    return null;
  }

  return isFreeDesign(payload.design) ? "free" : "custom";
}

/* ------------------------------------------------------------------------------------------------
 * Leitura do banco (parse-on-read)
 * ---------------------------------------------------------------------------------------------- */

export type ParsedTemplate = { notes: string[]; payload: TemplatePayload | null };

/**
 * Funcoes de atualizacao por versao (D15): TEMPLATE_UPGRADES[n] leva um payload da versao n para a n + 1. Vazia na v1.
 * Contrato: toda troca de TEMPLATE_VERSION acrescenta a funcao da versao anterior e um teste com um payload gravado nela.
 */
export const TEMPLATE_UPGRADES: Readonly<Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>> = {};

const UNREADABLE: ParsedTemplate = { notes: [], payload: null };

/** Uma parte pelo schema dela; nao passou = o padrao e a nota. */
function readPart<T>(schema: z.ZodType<T>, value: unknown, fallback: T, note: string, notes: string[], extra?: (parsed: T) => boolean): T {
  const parsed = schema.safeParse(value);

  if (parsed.success && (!extra || extra(parsed.data))) {
    return parsed.data;
  }

  notes.push(note);

  return fallback;
}

/**
 * Leitura do banco, pela versao: objeto com version inteiro de 1 ate TEMPLATE_VERSION (o menor passa pelas
 * TEMPLATE_UPGRADES em ordem; faltando uma funcao, nao abre) e kind igual a coluna. Senao payload null ("Este
 * modelo nao pode ser aberto"). Depois, parte por parte, cada uma no seu schema; parte que nao passa vira o padrao e
 * ganha uma nota (read*): settings -> padrao do tipo; design -> null (Padrao; no tipo design, o payload todo vira null);
 * designSupport -> { ctaLabel: null, image: null }; content -> null; audience -> null; followUps -> null.
 * Nunca lanca. Nunca usado pela limpeza (que le o jsonb cru). O terceiro argumento so existe para o teste da
 * atualizacao (uma tabela falsa e uma versao atual simulada); o app nunca o passa.
 */
export function parseTemplatePayload(kind: TemplateKind, raw: unknown, options: { upgrades?: typeof TEMPLATE_UPGRADES; version?: number } = {}): ParsedTemplate {
  try {
    const current = options.version ?? TEMPLATE_VERSION;
    const upgrades = options.upgrades ?? TEMPLATE_UPGRADES;

    if (!isRecord(raw) || typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > current) {
      return UNREADABLE;
    }

    let value: Record<string, unknown> = raw;

    for (let version = raw.version; version < current; version += 1) {
      const upgrade = upgrades[version];

      if (!upgrade) {
        return UNREADABLE;
      }

      const next = upgrade(value);

      if (!isRecord(next)) {
        return UNREADABLE;
      }

      value = next;
    }

    if (value.kind !== kind) {
      return UNREADABLE;
    }

    const notes: string[] = [];
    const contentOk = (content: TemplateContent | null) => content === null || contentProblems(content, kind === "popup" ? "popup" : "inbox").length === 0;

    if (kind === "design") {
      const design = templateDesignValueSchema.safeParse(value.design);

      if (!design.success) {
        return UNREADABLE;
      }

      const designSupport = readPart(templateDesignSupportSchema, value.designSupport, { ctaLabel: null, image: null }, TEMPLATE_MESSAGES.readDesign, notes);

      return { notes, payload: { design: design.data, designSupport, kind: "design", version: TEMPLATE_VERSION } };
    }

    const audience = readPart(audienceDefinitionSchema.nullable(), value.audience, null, TEMPLATE_MESSAGES.readAudience, notes);
    const content = readPart(templateContentSchema.nullable(), value.content, null, TEMPLATE_MESSAGES.readContent, notes, contentOk) as TemplateContent | null;

    if (kind === "inbox") {
      const settings = readPart(
        inboxTemplateSettingsSchema,
        value.settings,
        { allowHide: true, icon: null, sender: null, validity: { mode: "default" } },
        TEMPLATE_MESSAGES.readSettings,
        notes
      ) as InboxTemplatePayload["settings"];
      const followUps = readPart(templateFollowUpsSchema.nullable(), value.followUps, null, TEMPLATE_MESSAGES.readFollowUps, notes) as TemplateFollowUps | null;

      return { notes, payload: { audience, content, followUps, kind: "inbox", settings, version: TEMPLATE_VERSION } };
    }

    const settings = readPart(
      popupTemplateSettingsSchema,
      value.settings,
      { allowSnooze: true, icon: null, popup: defaultPopupSettings() },
      TEMPLATE_MESSAGES.readSettings,
      notes
    ) as PopupTemplatePayload["settings"];
    const design = readPart(templateDesignValueSchema.nullable(), value.design, null, TEMPLATE_MESSAGES.readDesign, notes);
    let designSupport: TemplateDesignSupport | null = null;

    if (design && content === null) {
      const fallback = { ctaLabel: null, image: null };
      const supportNotes: string[] = [];
      designSupport = readPart(templateDesignSupportSchema.nullable(), value.designSupport, fallback, TEMPLATE_MESSAGES.readDesign, supportNotes) ?? fallback;

      if (supportNotes.length > 0 && !notes.includes(TEMPLATE_MESSAGES.readDesign)) {
        notes.push(TEMPLATE_MESSAGES.readDesign);
      }
    }

    return { notes, payload: { audience, content, design, designSupport, kind: "popup", settings, version: TEMPLATE_VERSION } };
  } catch {
    return UNREADABLE;
  }
}

/* ------------------------------------------------------------------------------------------------
 * O que o editor abre
 * ---------------------------------------------------------------------------------------------- */

export type NoticeStart = {
  draft: NoticeDraft;
  followUps: { entryId: string; goal: { productId: string } | null; items: FollowUpDraft[] } | null;
  notes: string[];
  templateId: string | null;
  templateName: string | null;
};

/**
 * Aplicar um modelo de Design num rascunho (card Design, Usar na aba, noticeStartOfTemplate).
 * custom: design = syncPopupDesignBlocks(design, { hasAudio, hasCta }); freeDesign null; image = content.image ?? support.image
 *         (a imagem do modelo so preenche o aviso sem imagem; a do aviso fica, D4). applyNeedsImage so quando a midia
 *         do design e imagem ou video e nenhuma das duas existe.
 * free:   freeDesign = canonicalPopupFreeDesign(syncFreeDesignWithContent(design, { hasAudio, hasCta })); design null.
 * Os dois: sem cta no aviso e com botao principal no design -> cta { display: "button", href: "", label: support.ctaLabel ||
 * "Saiba mais", target: "same_tab" }; com botao "Lembrar depois" e allowSnooze false -> allowSnooze true.
 */
export function applyDesignTemplatePatch(
  content: Pick<NoticeDraft, "allowSnooze" | "audio" | "cta" | "image">,
  template: { design: PopupDesign | PopupFreeDesign; support: TemplateDesignSupport }
): { notes: string[]; patch: Partial<Pick<NoticeDraft, "allowSnooze" | "cta" | "design" | "freeDesign" | "image">> } {
  const { design, support } = template;
  const notes: string[] = [];
  const patch: Partial<Pick<NoticeDraft, "allowSnooze" | "cta" | "design" | "freeDesign" | "image">> = {};
  let cta = content.cta;

  if (!cta && designHasPrimaryButton(design)) {
    const label = support.ctaLabel?.trim() || "Saiba mais";
    cta = { display: "button", href: "", label, target: "same_tab" };
    patch.cta = cta;
    notes.push(TEMPLATE_MESSAGES.applyCta(label));
  }

  if (designHasSnoozeButton(design) && !content.allowSnooze) {
    patch.allowSnooze = true;
    notes.push(TEMPLATE_MESSAGES.applySnooze);
  }

  const sync = { hasAudio: Boolean(content.audio), hasCta: Boolean(cta) };

  if (isFreeDesign(design)) {
    patch.design = null;
    patch.freeDesign = canonicalPopupFreeDesign(syncFreeDesignWithContent(design, sync));

    return { notes, patch };
  }

  patch.design = syncPopupDesignBlocks(design, sync);
  patch.freeDesign = null;
  patch.image = content.image ?? imageOf(support.image);

  if (designUsesNoticeImage(design) && !patch.image) {
    notes.push(TEMPLATE_MESSAGES.applyNeedsImage);
  }

  return { notes, patch };
}

function draftContentOf(content: TemplateContent, kind: CampaignKind): Partial<NoticeDraft> {
  const popup = kind === "popup";

  return {
    audio: content.audio ? { ...content.audio, peaks: [...content.audio.peaks] } : null,
    body: content.body,
    cta: content.cta ? { display: content.cta.display, href: content.cta.href, label: content.cta.label, target: content.cta.target } : null,
    image: imageOf(content.image),
    poll: !popup && content.poll ? { ...content.poll, closesAt: null, options: content.poll.options.map((option) => ({ ...option })) } : null,
    reactions: popup ? false : content.reactions,
    response: !popup && content.response ? { ...content.response } : null,
    title: content.title
  };
}

/** Copia das seguintes; com newId, ids novos para toda seguinte e para a entrada, regras remapeadas. */
function followUpsOfTemplate(followUps: TemplateFollowUps, newId?: () => string): NonNullable<NoticeStart["followUps"]> {
  const ids = new Map<string, string>();
  const collect = (items: readonly FollowUpDraft[]) => {
    for (const item of items) {
      ids.set(item.id, newId ? newId() : item.id);
      collect(item.children);
    }
  };

  collect(followUps.items);

  const entryId = newId ? newId() : followUps.entryId;
  ids.set(followUps.entryId, entryId);

  const copy = (items: readonly FollowUpDraft[]): FollowUpDraft[] =>
    items.map((item) => ({
      children: copy(item.children),
      content: { ...item.content, poll: item.content.poll ? { ...item.content.poll, closesAt: null } : null },
      id: ids.get(item.id) ?? item.id,
      when: { ...item.when },
      who: newId ? remapNodeRefs(item.who, ids) : item.who
    }));

  return { entryId, goal: followUps.goal ? { productId: followUps.goal.productId } : null, items: copy(followUps.items) };
}

/**
 * Payload -> o que o editor abre. Com deps.newId (Usar, Novo aviso com modelo): ids novos para toda seguinte e para a
 * entrada, regras remapeadas por remapNodeRefs (mapa velho -> novo, com entryId -> novo entryId). Sem deps.newId (modo
 * modelo, D28): os ids gravados ficam como estao.
 * inbox: emptyNoticeDraft("inbox") + settings + content (se houver) + audience (ou EVERYONE).
 * popup: emptyNoticeDraft("popup") + settings (popup, repeat = repeatOfFrequency, allowSnooze, icon) + content (se
 * houver, com response sempre null) + design; sem content e com design: cta/image pelo designSupport e withSynced
 * (applyDesignTemplatePatch). sender null e validity "default" sempre (o pop-up nao tem).
 * design: emptyNoticeDraft("popup") + applyDesignTemplatePatch.
 * Sempre: schedule { mode: "now" }, window nula, poll.closesAt null.
 */
export function noticeStartOfTemplate(template: { id: string; name: string; payload: TemplatePayload }, deps: { newId?: () => string } = {}): NoticeStart {
  const { payload } = template;
  const always = { schedule: { mode: "now" } as const, window: { endsAt: null, startsAt: null } };
  const start = (draft: NoticeDraft, notes: string[], followUps: NoticeStart["followUps"] = null): NoticeStart => ({
    draft: { ...draft, ...always },
    followUps,
    notes,
    templateId: template.id,
    templateName: template.name
  });

  if (payload.kind === "design") {
    const base = emptyNoticeDraft("popup");
    const { notes, patch } = applyDesignTemplatePatch(base, { design: payload.design, support: payload.designSupport });

    return start({ ...base, ...patch }, notes);
  }

  if (payload.kind === "inbox") {
    const base = emptyNoticeDraft("inbox");
    const draft: NoticeDraft = {
      ...base,
      ...(payload.content ? draftContentOf(payload.content, "inbox") : {}),
      allowHide: payload.settings.allowHide,
      audience: payload.audience ?? EVERYONE,
      icon: payload.settings.icon,
      sender: payload.settings.sender,
      validity: payload.settings.validity
    };

    return start(draft, [], payload.followUps ? followUpsOfTemplate(payload.followUps, deps.newId) : null);
  }

  const base = emptyNoticeDraft("popup");
  let draft: NoticeDraft = {
    ...base,
    ...(payload.content ? draftContentOf(payload.content, "popup") : {}),
    allowSnooze: payload.settings.allowSnooze,
    audience: payload.audience ?? EVERYONE,
    design: null,
    freeDesign: null,
    icon: payload.settings.icon,
    popup: payload.settings.popup,
    repeat: repeatOfFrequency(payload.settings.popup.frequency),
    response: null,
    sender: null,
    validity: { mode: "default" }
  };
  const notes: string[] = [];

  if (payload.design && payload.content) {
    draft = isFreeDesign(payload.design) ? { ...draft, design: null, freeDesign: payload.design } : { ...draft, design: payload.design, freeDesign: null };
  } else if (payload.design) {
    const applied = applyDesignTemplatePatch(draft, { design: payload.design, support: payload.designSupport ?? { ctaLabel: null, image: null } });
    draft = { ...draft, ...applied.patch };
    notes.push(...applied.notes);
  }

  return start(draft, notes);
}

/** Modelo novo em branco (Novo modelo > Notificacao | Pop-up): emptyNoticeDraft(kind), sem seguintes. */
export function emptyTemplateStart(kind: "inbox" | "popup"): NoticeStart {
  return { draft: emptyNoticeDraft(kind), followUps: null, notes: [], templateId: null, templateName: null };
}

/**
 * O rascunho da pagina do modelo de Design: emptyNoticeDraft("popup") com o nome no titulo, "Lembrar depois" ligado,
 * sem audio e o design aplicado com o apoio. Sem payload (modelo novo), o design fica null no modo escolhido.
 */
export function designTemplateDraft(payload: DesignTemplatePayload | null, mode: TemplateDesignMode, name: string): NoticeDraft {
  const base: NoticeDraft = { ...emptyNoticeDraft("popup"), allowSnooze: true, audio: null, title: name };

  if (!payload) {
    return { ...base, design: null, freeDesign: null };
  }

  void mode;
  const { patch } = applyDesignTemplatePatch(base, { design: payload.design, support: payload.designSupport });

  return { ...base, ...patch };
}

/* ------------------------------------------------------------------------------------------------
 * Resumo, nomes, notas do dialogo e erros
 * ---------------------------------------------------------------------------------------------- */

function joinParts(parts: readonly string[]) {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

function countFollowUps(items: readonly FollowUpDraft[]): number {
  return items.reduce((sum, item) => sum + 1 + countFollowUps(item.children), 0);
}

/** "Leva conteúdo, segmento e 2 notificações seguintes" etc. (lista). */
export function templateSummary(payload: TemplatePayload | null): string {
  if (!payload) {
    return "Este modelo não pode ser aberto.";
  }

  if (payload.kind === "design") {
    return isFreeDesign(payload.design) ? "Só o visual do pop-up, montado no editor Livre" : "Só o visual do pop-up, montado por seções";
  }

  const parts = [payload.content ? "conteúdo" : null, payload.audience ? "segmento" : null].filter((part): part is string => part !== null);

  if (payload.kind === "inbox") {
    const followUps = payload.followUps ? countFollowUps(payload.followUps.items) : 0;

    if (followUps > 0) {
      parts.push(followUps === 1 ? "1 notificação seguinte" : `${followUps} notificações seguintes`);
    }

    return parts.length > 0 ? `Leva ${joinParts(parts)}` : "Só a configuração";
  }

  const design = !payload.design ? "Design Padrão" : isFreeDesign(payload.design) ? "Design Livre" : "Design Personalizado";

  return `${design} · ${parts.length > 0 ? `leva ${joinParts(parts)}` : "só a configuração"}`;
}

/**
 * Corta o nome em `max` unidades UTF-16 (`.length`, como o maxLength do campo e os contadores "{n}/80"), sempre num
 * caractere inteiro (Array.from anda por ponto de codigo): nunca sobra metade de um emoji, que o Postgres recusa. O zod
 * (.max) e o char_length do check do banco contam caracteres, nunca mais que `.length`: o que cabe aqui passa nos dois.
 */
function cut(value: string, max: number) {
  if (value.length <= max) {
    return value;
  }

  let kept = "";

  for (const char of Array.from(value)) {
    if (kept.length + char.length > max) {
      break;
    }

    kept += char;
  }

  return kept.trimEnd();
}

const COPY_SUFFIX = " (cópia)";

/** "<nome> (copia)" cabendo em 80 (o nome cortado num caractere inteiro). */
export function duplicateTemplateName(name: string): string {
  const clean = name.trim();

  return `${cut(clean, TEMPLATE_LIMITS.name - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

/**
 * Nome sugerido no dialogo. Sem forDesign: titulo aparado nao vazio -> o titulo cortado em 80; vazio -> "Modelo de
 * notificação" ou "Modelo de pop-up". Com forDesign: "Design de {título}" cortado em 80; titulo vazio -> "Design
 * Personalizado" ou "Design Livre" (pelo mode).
 */
export function defaultTemplateName(input: { forDesign?: boolean; kind: CampaignKind | TemplateKind; mode?: TemplateDesignMode | null; title: string }): string {
  const title = input.title.trim();

  if (input.forDesign || input.kind === "design") {
    return title ? cut(`Design de ${title}`, TEMPLATE_LIMITS.name) : input.mode === "free" ? "Design Livre" : "Design Personalizado";
  }

  if (title) {
    return cut(title, TEMPLATE_LIMITS.name);
  }

  return input.kind === "inbox" ? "Modelo de notificação" : "Modelo de pop-up";
}

function hasUntil(items: readonly FollowUpDraft[]): boolean {
  return items.some((item) => item.content.validity.mode === "until" || hasUntil(item.children));
}

/**
 * As notas que o dialogo do editor mostra antes de salvar (mesmas do construtor, sem gravar). flags.otherGoal (a
 * linha "Parar" do cartao com kind "other": o objetivo mudou no construtor) com a chave das seguintes ligada ->
 * noteOtherGoal. A arvore so do construtor nao vira nota aqui: a chave desabilitada ja mostra noteBuilderOnly.
 */
export function templateSaveNotes(
  draft: Pick<NoticeDraft, "kind" | "poll" | "validity">,
  include: TemplateInclude,
  followUps: TemplateFollowUps | null,
  flags: { otherGoal: boolean }
): string[] {
  const notes: string[] = [];

  if (draft.kind !== "inbox") {
    return notes;
  }

  if (draft.validity.mode === "until") {
    notes.push(TEMPLATE_MESSAGES.noteUntil);
  }

  if (include.content && draft.poll?.closesAt) {
    notes.push(TEMPLATE_MESSAGES.notePollEnd);
  }

  if (include.followUps && followUps && hasUntil(followUps.items)) {
    notes.push(TEMPLATE_MESSAGES.noteFollowUpUntil);
  }

  if (include.followUps && flags.otherGoal) {
    notes.push(TEMPLATE_MESSAGES.noteOtherGoal);
  }

  return notes;
}

/** O campo do editor de um caminho da Server Action (null = fica como veio). */
function editorPathOf(key: string): string {
  const parts = key.split(".");

  if (parts[0] !== "body") {
    return key;
  }

  const [, head, ...rest] = parts;

  if (head === "draft") {
    return rest.join(".") || "draft";
  }

  if (head === "followUps") {
    // "body.followUps.items.0.y" (zod) e "body.followUps.followUps.0.y" (a arvore) -> "followUps.0.y".
    if (rest[0] === "items" || rest[0] === "followUps") {
      return ["followUps", ...rest.slice(1)].join(".");
    }

    if (rest[0] === "goal") {
      return "goal";
    }

    return "followUps";
  }

  return [head, ...rest].join(".");
}

/** Erros da Server Action no formato do editor: "body.draft.title" -> "title"; "body.design.x" -> "design.x"; "body.freeDesign.x" -> "freeDesign.x"; "body.followUps.items.0.y" -> "followUps.0.y"; "name" -> "name". */
export function templateErrorsFromAction(fieldErrors: Record<string, string[]> | undefined): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    const path = editorPathOf(key);
    const [message] = messages ?? [];

    if (message && !errors[path]) {
      errors[path] = message;
    }
  }

  return errors;
}
