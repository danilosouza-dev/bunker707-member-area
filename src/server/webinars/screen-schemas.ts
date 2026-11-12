// Schemas zod da "Na tela" (docs/30 §2.4, §4.2 e §5.1; especificacao de 10/11/2026, §4, §5.3, §5.5 e §8): a entrada
// do item (salvar um banner ou um QR Code), a copia congelada da exibicao (versao 1, conferida ao gravar e de novo ao
// ler: a copia que nao passa nao e desenhada), as entradas das acoes do console e o corpo da rota das metricas. Modulo
// puro (sem "server-only", imports relativos; zod v4): os testes carregam pelo Node. Os limites sao os de
// screen-model.ts (SCREEN_LIMITS), os mesmos dos checks da 202611100002; as regras entre os campos sao as de
// screen-model.screenItemProblems; as mensagens sao as de WEBINAR_COPY.naTela.erros.

import { z } from "zod";
import { NA_TELA_COPY } from "../../lib/webinar-copy-v4/na-tela";
import { safeHttpsUrl } from "../../lib/webinar-links";
import { CHAT_LIMITS } from "./model";
import {
  SCREEN_DEFAULT_PLACE,
  SCREEN_DEFAULT_SIZE,
  SCREEN_EVENT_FORMS,
  SCREEN_EVENT_NAMES,
  SCREEN_EVENT_TARGETS,
  SCREEN_IMAGE_PATH_PATTERN,
  SCREEN_KINDS,
  SCREEN_LIMITS,
  SCREEN_LINK_TARGETS,
  SCREEN_PLACES,
  SCREEN_SIZES,
  screenItemProblems,
  screenLinkTargetOf,
  type PollPinSnapshot,
  type ScreenDisplayKind,
  type ScreenItemFields,
  type ScreenKind,
  type ScreenSnapshot
} from "./screen-model";

const ERROS = NA_TELA_COPY.erros;

const uuidSchema = z.uuid({ error: ERROS.invalido });

/** Um texto opcional do formulario: sem espacos nas pontas, vazio vira null, ate `max` caracteres. */
const optionalText = (max: number, message: string = ERROS.curto(max)) =>
  z
    .string({ error: ERROS.invalido })
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => (value ? value : null));

/* ------------------------------------------------------------------------------------------------
 * O item pronto (saveScreenItem)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O formulario do banner ou do QR Code. Sem `place`, o padrao do tipo (o banner embaixo a direita, o QR Code em cima a
 * direita). A descricao da imagem sem imagem e descartada (o check do banco a quer nula). As medidas da imagem nunca vem
 * do navegador: o servidor confere a imagem no bucket e rele as medidas. As regras entre os campos sao as de
 * screenItemProblems, cada uma no campo dela.
 */
export const screenItemInputSchema = z
  .object({
    body: optionalText(SCREEN_LIMITS.body),
    buttonLabel: optionalText(SCREEN_LIMITS.buttonLabel),
    closable: z.boolean({ error: ERROS.invalido }).default(true),
    id: uuidSchema.nullish().transform((value) => value ?? null),
    imageAlt: optionalText(SCREEN_LIMITS.imageAlt),
    imagePath: optionalText(160, ERROS.imagemSumiu),
    kind: z.enum(SCREEN_KINDS, { error: ERROS.invalido }),
    /** O que abre o link do banner (D87): ausente (a pagina de antes), o padrao. */
    linkTarget: z.enum(SCREEN_LINK_TARGETS, { error: ERROS.invalido }).nullish(),
    linkUrl: optionalText(SCREEN_LIMITS.link, ERROS.link),
    name: optionalText(SCREEN_LIMITS.name),
    place: z.enum(SCREEN_PLACES, { error: ERROS.invalido }).nullish(),
    size: z.enum(SCREEN_SIZES, { error: ERROS.invalido }).default(SCREEN_DEFAULT_SIZE),
    title: optionalText(SCREEN_LIMITS.title),
    webinarId: uuidSchema
  })
  .transform((value) => ({
    ...value,
    imageAlt: value.imagePath ? value.imageAlt : null,
    place: value.place ?? SCREEN_DEFAULT_PLACE[value.kind],
    // "Só a imagem" grava sem o texto do botao; fora do banner com link vale o padrao (screenLinkTargetOf).
    ...screenLinkTargetOf(value),
    /** O texto do botao como veio (antes de "Só a imagem" tirar): a regra de "Só o botão" olha este. */
    typedButtonLabel: value.buttonLabel
  }))
  .superRefine((value, context) => {
    for (const problem of screenItemProblems(value)) {
      context.addIssue({ code: "custom", message: problem.message, path: [problem.field] });
    }
    // "Só o botão" sem o texto do botao nao teria o que clicar.
    if (value.kind === "banner" && value.linkUrl && value.linkTarget === "button" && !value.typedButtonLabel) {
      context.addIssue({ code: "custom", message: ERROS.soBotaoSemTexto, path: ["buttonLabel"] });
    }
  });

export type ScreenItemInput = z.infer<typeof screenItemInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * A copia congelada da exibicao (snapshot, versao 1)
 * ---------------------------------------------------------------------------------------------- */

const snapshotText = (max: number) => z.string().min(1).max(max).nullable();
const imageSide = z.number().int().min(SCREEN_LIMITS.imageSideMin).max(SCREEN_LIMITS.imageSideMax);

const snapshotImageSchema = z.object({
  alt: snapshotText(SCREEN_LIMITS.imageAlt),
  height: imageSide,
  path: z.string().regex(SCREEN_IMAGE_PATH_PATTERN),
  width: imageSide
});

/** O banner ou o QR Code como foi mostrado: `{ v: 1, name, title, body, buttonLabel, linkUrl, image, place, size, closable }`. */
export const screenSnapshotSchema = z.object({
  body: snapshotText(SCREEN_LIMITS.body),
  buttonLabel: snapshotText(SCREEN_LIMITS.buttonLabel),
  closable: z.boolean(),
  image: snapshotImageSchema.nullable(),
  // Ausente na copia gravada antes da 202611150001 (a turma viu so o botao clicavel).
  linkTarget: z.enum(SCREEN_LINK_TARGETS).optional(),
  linkUrl: z
    .string()
    .max(SCREEN_LIMITS.link)
    .nullable()
    .refine((value) => value === null || safeHttpsUrl(value) === value),
  name: z.string().min(1).max(SCREEN_LIMITS.name),
  place: z.enum(SCREEN_PLACES),
  size: z.enum(SCREEN_SIZES),
  title: snapshotText(SCREEN_LIMITS.title),
  v: z.literal(1)
});

/** A enquete fixada: `{ v: 1, name: <pergunta> }`. */
export const pollPinSnapshotSchema = z.object({
  name: z.string().min(1).max(CHAT_LIMITS.pollQuestion),
  v: z.literal(1)
});

function snapshotFields(kind: ScreenKind, snapshot: ScreenSnapshot): ScreenItemFields {
  return {
    body: snapshot.body,
    buttonLabel: snapshot.buttonLabel,
    closable: snapshot.closable,
    imageAlt: snapshot.image?.alt ?? null,
    imagePath: snapshot.image?.path ?? null,
    kind,
    linkUrl: snapshot.linkUrl,
    place: snapshot.place,
    size: snapshot.size,
    title: snapshot.title
  };
}

/**
 * A copia de uma exibicao conferida (ao gravar e ao ler): a forma da versao 1 e, no banner e no QR Code, as mesmas
 * regras do item. Invalida: null (nada e desenhado; o console mostra so o nome que der).
 */
export function parseScreenSnapshot(kind: "poll", value: unknown): PollPinSnapshot | null;
export function parseScreenSnapshot(kind: ScreenKind, value: unknown): ScreenSnapshot | null;
export function parseScreenSnapshot(kind: ScreenDisplayKind, value: unknown): PollPinSnapshot | ScreenSnapshot | null;
export function parseScreenSnapshot(kind: ScreenDisplayKind, value: unknown): PollPinSnapshot | ScreenSnapshot | null {
  if (kind === "poll") {
    const parsed = pollPinSnapshotSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  const parsed = screenSnapshotSchema.safeParse(value);

  if (!parsed.success || screenItemProblems(snapshotFields(kind, parsed.data)).length > 0) {
    return null;
  }

  return parsed.data;
}

/* ------------------------------------------------------------------------------------------------
 * As acoes do console
 * ---------------------------------------------------------------------------------------------- */

export const screenItemIdSchema = z.object({ id: uuidSchema });

/** Mostrar um item pronto numa sessao (troca o do mesmo tipo que estiver na tela). */
export const showScreenItemSchema = z.object({ itemId: uuidSchema, sessionId: uuidSchema });

/** Tirar da tela uma exibicao. */
export const hideScreenItemSchema = z.object({ displayId: uuidSchema });

/**
 * Mostrar na tela uma mensagem do chat ou uma pergunta (rodada v9, P11; docs/30 D89): uma das duas, nunca as duas nem
 * nenhuma. O comentario que estava na tela sai (um por sessao).
 */
export const showScreenCommentSchema = z
  .object({ messageId: uuidSchema.optional(), questionId: uuidSchema.optional(), sessionId: uuidSchema })
  .refine((value) => Boolean(value.messageId) !== Boolean(value.questionId), { message: ERROS.invalido, path: ["messageId"] });

/** Tirar da tela o comentario que esta na frente da turma na sessao. */
export const hideScreenCommentSchema = z.object({ sessionId: uuidSchema });

/** Fixar uma enquete da sessao (aberta, ou encerrada com o resultado compartilhado). */
export const pinPollSchema = z.object({ pollId: uuidSchema, sessionId: uuidSchema });

/** Desafixar a enquete fixada da sessao. */
export const unpinPollSchema = z.object({ sessionId: uuidSchema });

/**
 * O envio da imagem do banner: a data URL do WebP que o navegador ja reduziu (prepareFreeImage com os limites da Na
 * tela). O teto da data URL e o de SCREEN_LIMITS.imageBytes em base64 com folga para o prefixo; o servidor confere de
 * novo os bytes, as medidas e a animacao.
 */
export const SCREEN_IMAGE_DATA_URL_MAX = Math.ceil(SCREEN_LIMITS.imageBytes / 3) * 4 + 64;

export const uploadScreenImageSchema = z.object({
  image: z.string({ error: ERROS.imagemFormato }).min(1, ERROS.imagemFormato).max(SCREEN_IMAGE_DATA_URL_MAX, ERROS.imagemPesada)
});

/* ------------------------------------------------------------------------------------------------
 * A rota das metricas: POST /api/webinars/[id]/screen-events
 * ---------------------------------------------------------------------------------------------- */

export const screenEventSchema = z.object({
  displayId: uuidSchema,
  form: z.enum(SCREEN_EVENT_FORMS, { error: ERROS.invalido }),
  name: z.enum(SCREEN_EVENT_NAMES, { error: ERROS.invalido }),
  target: z.enum(SCREEN_EVENT_TARGETS, { error: ERROS.invalido }).optional()
});

/** Ate 6 eventos por pedido (SCREEN_LIMITS.eventsPerBatch). */
export const screenEventsBodySchema = z.object({
  events: z.array(screenEventSchema).min(1, ERROS.invalido).max(SCREEN_LIMITS.eventsPerBatch, ERROS.invalido),
  sessionId: uuidSchema
});

export type ScreenEventsBody = z.infer<typeof screenEventsBodySchema>;
