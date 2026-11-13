// Schemas zod da fase 2 (docs/30 §5.1 e §5.2): os corpos das rotas do aluno na sala (chat, presenca, reacoes,
// perguntas, enquetes, Remover minhas mensagens) e as entradas das Server Actions da equipe (roteiro, transcricao,
// console da sessao, moderacao, enquetes, perguntas, Simulacao, sessoes). Modulo puro: sem "server-only", imports
// relativos; tests/webinarios-*.test.mjs carregam direto pelo Node. Mensagens no portugues do produtor (zod v4).

import { z } from "zod";
import {
  CHAT_LIMITS,
  CHAT_MODES,
  PERSONA_ROLES,
  POLL_KINDS,
  PRESENCE_STATES,
  QUESTION_REPLY_LIMITS,
  QUESTION_STATUSES,
  REACTIONS,
  SCRIPT_STATUSES,
  SCRIPT_TRIGGERS,
  SLOW_MODE_SECONDS,
  TRANSCRIPT_FORMATS,
  type PollDraft,
  type ScriptItemDraft
} from "./model";
import { NA_TELA_COPY } from "../../lib/webinar-copy-v4/na-tela";
import { PESSOAS_COPY as PESSOAS } from "../../lib/webinar-copy-v4/pessoas";
import { ANSWER_AUTHOR_LIMITS, ANSWER_AUTHOR_MODES, answerAuthorCustomName } from "./answer-author-model";
import { PERSONA_AVATAR_LIMITS, PERSONA_AVATAR_PATH_PATTERN, personaCleanName, personaNameFits } from "./persona-model";

export const CHAT_MESSAGES = {
  answer: "A resposta pode ter até 1.000 caracteres.",
  /** Rodada v9 (docs/30 D88): o nome de "Responder como › Outro nome". */
  authorName: `Escreva o nome que aparece na resposta (de ${ANSWER_AUTHOR_LIMITS.nameMin} a ${ANSWER_AUTHOR_LIMITS.nameMax} caracteres).`,
  body: "Escreva a mensagem.",
  bodyTooLong: "A mensagem pode ter até 1.000 caracteres.",
  consent: "Para participar do chat, aceite as regras uma vez.",
  csvTooLong: "O arquivo passa de 1 MB.",
  /** D64: o navegador com a pagina antiga ainda pede anonimo ou apelido; o servidor recusa e nada e gravado. */
  identity: "A participação anônima ou com apelido não está mais disponível. Atualize a página para continuar.",
  invalid: "Pedido inválido.",
  offset: "Minuto do vídeo inválido.",
  options: "A enquete precisa de 2 a 20 opções.",
  option: "Escreva cada opção (até 120 caracteres).",
  personaName: "Dê um nome a quem fala (até 60 caracteres).",
  phrase: "A frase tem de 2 a 300 caracteres.",
  pollAnswer: "Escolha ao menos uma opção.",
  pollQuestion: "Escreva a pergunta da enquete (até 300 caracteres).",
  question: "Escreva a pergunta.",
  reply: "Escreva a resposta.",
  replyTooLong: "A resposta pode ter até 500 caracteres.",
  questionTooLong: "A pergunta pode ter até 500 caracteres.",
  session: "Sessão inválida.",
  simulationAck: "Marque a confirmação para ligar o selo.",
  tooManyItems: "O roteiro aceita até 5.000 mensagens.",
  tooManyPolls: `Até ${CHAT_LIMITS.pollTemplatesMax} enquetes por webinário.`,
  transcriptTooLong: "A transcrição passa de 2 MB.",
  window: "Janela inválida."
} as const;

const uuidSchema = z.uuid({ error: CHAT_MESSAGES.invalid });
const sessionIdSchema = z.uuid({ error: CHAT_MESSAGES.session });
const offsetSchema = z.number({ error: CHAT_MESSAGES.offset }).int(CHAT_MESSAGES.offset).min(CHAT_LIMITS.offsetMinMs, CHAT_MESSAGES.offset).max(CHAT_LIMITS.offsetMaxMs, CHAT_MESSAGES.offset);
const bodySchema = z.string({ error: CHAT_MESSAGES.body }).trim().min(1, CHAT_MESSAGES.body).max(CHAT_LIMITS.body, CHAT_MESSAGES.bodyTooLong);
/** So no Replay livre: o segundo do video em que o aluno estava (docs/30 §1.6); na gravada e na live o servidor ignora e usa o relogio. */
const replayOffsetSchema = offsetSchema.optional();

/* ------------------------------------------------------------------------------------------------
 * Rotas do aluno (src/app/api/webinars/[id]/...)
 * ---------------------------------------------------------------------------------------------- */

/**
 * GET /chat?sessao=&from=&to= (a janela por offset, em ms: a linha mestre + as linhas da sessao) ou
 * ?sessao=&since=<ISO>&after=<id> (so as mensagens novas da sessao desde o instante; o id desempata o mesmo instante).
 * Na consulta de mensagens novas, `tela` e o carimbo da Na tela que o navegador tem (o updated_at da sessao): a
 * resposta leva o estado so quando ele mudou (docs/30 §5.1).
 */
export const chatWindowQuerySchema = z.object({
  after: uuidSchema.optional(),
  from: z.coerce.number().int().min(CHAT_LIMITS.offsetMinMs).max(CHAT_LIMITS.offsetMaxMs).optional(),
  sessao: sessionIdSchema,
  since: z.iso.datetime({ offset: true }).optional(),
  tela: z.string().max(40).optional(),
  to: z.coerce.number().int().min(CHAT_LIMITS.offsetMinMs).max(CHAT_LIMITS.offsetMaxMs).optional()
});

/**
 * O que o navegador com a pagina de antes de 10/11/2026 ainda pode mandar (D64): `anonymous`, `displayMode` e
 * `nickname`. Ninguem mais participa como anonimo nem com apelido, entao o pedido que pede isso e RECUSADO (400 com
 * CHAT_MESSAGES.identity, "atualize a pagina") antes de qualquer escrita: publicar o nome de quem pediu anonimato sem
 * avisar seria pior do que recusar. `anonymous: false` e `displayMode: "first_name_initial"` passam e sao ignorados (o
 * nome e sempre o primeiro nome com a inicial). `refusesLegacyIdentity` e a mesma regra para quem chama as escritas
 * sem passar pelo schema (room-writes.ts confere de novo antes de gravar). O alcance (docs/30 §8.5 e A34): so da para
 * recusar o que chega no pedido. A pilula Anonima da pagina antiga dependia do `anonymousQuestions` da sessao, que
 * saiu: depois da primeira releitura da sessao ela some dessa pagina e a pergunta chega sem `anonymous`, como uma nova.
 */
export function refusesLegacyIdentity(body: { anonymous?: unknown; displayMode?: unknown; nickname?: unknown }): boolean {
  return (
    (body.anonymous !== undefined && body.anonymous !== false) ||
    (body.displayMode !== undefined && body.displayMode !== "first_name_initial") ||
    (body.nickname !== undefined && body.nickname !== null)
  );
}

const legacyIdentityFields = {
  anonymous: z.literal(false, { error: CHAT_MESSAGES.identity }).optional(),
  displayMode: z.literal("first_name_initial", { error: CHAT_MESSAGES.identity }).optional(),
  nickname: z.null({ error: CHAT_MESSAGES.identity }).optional()
};

/**
 * O aceite do chat (D10), que vem junto da primeira mensagem, da primeira pergunta ou da primeira resposta no fio:
 * consent + versao. Os campos antigos entram so para a recusa acima.
 */
const consentFields = {
  ...legacyIdentityFields,
  consent: z.boolean().optional(),
  consentVersion: z.number().int().min(1).max(100).optional()
};

/** POST /chat: a primeira mensagem traz o aceite. */
export const chatPostBodySchema = z.object({
  ...consentFields,
  body: bodySchema,
  kind: z.enum(["message", "question"]).default("message"),
  offsetMs: replayOffsetSchema,
  replyToId: uuidSchema.nullable().optional(),
  sessionId: sessionIdSchema
});
export type ChatPostInput = z.infer<typeof chatPostBodySchema>;

/** DELETE /chat { all: true }: Remover minhas mensagens (D10). */
export const chatDeleteBodySchema = z.object({ all: z.literal(true, { error: CHAT_MESSAGES.invalid }) });

/** POST /heartbeat a cada 15 s; `leave: true` pelo sendBeacon ao sair. */
export const heartbeatBodySchema = z.object({
  leave: z.boolean().optional(),
  offsetSeconds: z.number({ error: CHAT_MESSAGES.invalid }).int().min(-86_400).max(172_800),
  sessionId: sessionIdSchema,
  state: z.enum(PRESENCE_STATES).default("playing"),
  visible: z.boolean().default(true)
});
export type HeartbeatInput = z.infer<typeof heartbeatBodySchema>;

export const reactionBodySchema = z.object({ offsetMs: replayOffsetSchema, reaction: z.enum(REACTIONS, { error: CHAT_MESSAGES.invalid }), sessionId: sessionIdSchema });

/** GET /reactions?sessao=&since= (ISO): as contagens dos ultimos segundos para a animacao. */
export const reactionsQuerySchema = z.object({ sessao: sessionIdSchema, since: z.iso.datetime({ offset: true }).optional() });

/** POST /questions: sem o aceite gravado, a pergunta traz o aceite como a primeira mensagem do chat. */
export const questionBodySchema = z.object({
  ...consentFields,
  body: z.string({ error: CHAT_MESSAGES.question }).trim().min(1, CHAT_MESSAGES.question).max(CHAT_LIMITS.question, CHAT_MESSAGES.questionTooLong),
  offsetMs: replayOffsetSchema,
  sessionId: sessionIdSchema
});
export type QuestionPostInput = z.infer<typeof questionBodySchema>;

export const questionVoteBodySchema = z.object({ sessionId: sessionIdSchema });

/**
 * POST /questions/[qid]/like (docs/30 D101): curtir ou tirar a curtida da resposta escrita da pergunta (`replyId` nulo
 * ou ausente) ou de uma resposta do fio.
 */
export const questionLikeBodySchema = z.object({ replyId: uuidSchema.nullable().optional(), sessionId: sessionIdSchema });

/**
 * A curtida da equipe no console (docs/30 D101): a propria pergunta, a resposta escrita ou uma resposta do fio (so
 * esta leva o `replyId`).
 */
export const likeQuestionItemSchema = z
  .object({ questionId: uuidSchema, replyId: uuidSchema.nullable().optional(), target: z.enum(["answer", "question", "reply"]) })
  .refine((value) => (value.target === "reply") === Boolean(value.replyId), { message: "Resposta inválida.", path: ["replyId"] });

/** POST /questions/[qid]/replies: a resposta do aluno no fio da propria pergunta (com o aceite, se ele mudou de versao). */
export const questionReplyBodySchema = z.object({
  ...consentFields,
  body: z.string().trim().min(1, CHAT_MESSAGES.reply).max(QUESTION_REPLY_LIMITS.studentBody, CHAT_MESSAGES.replyTooLong),
  sessionId: sessionIdSchema
});
export type QuestionReplyPostInput = z.infer<typeof questionReplyBodySchema>;

/** GET /questions?sessao=&ordem=votadas|recentes */
export const questionsQuerySchema = z.object({ ordem: z.enum(["votadas", "recentes"]).default("votadas"), sessao: sessionIdSchema });

export const pollAnswerBodySchema = z.object({
  offsetMs: replayOffsetSchema,
  optionIds: z.array(uuidSchema).min(1, CHAT_MESSAGES.pollAnswer).max(CHAT_LIMITS.pollOptionsMax, CHAT_MESSAGES.pollAnswer),
  pollId: uuidSchema,
  sessionId: sessionIdSchema
});

export const sessionQuerySchema = z.object({ sessao: sessionIdSchema.optional() });

/* ------------------------------------------------------------------------------------------------
 * Server Actions da equipe (src/server/webinars/script-actions.ts e room-actions.ts)
 * ---------------------------------------------------------------------------------------------- */

const COMENTARIOS = NA_TELA_COPY.comentarios;

/** A foto de quem comenta (R9): so o caminho webinars/personas/<24 hex>.webp do nosso bucket, nunca um endereco. */
const personaAvatarPathSchema = z.string({ error: COMENTARIOS.erros.fotoSumiu }).regex(PERSONA_AVATAR_PATH_PATTERN, COMENTARIOS.erros.fotoSumiu);

export const scriptItemDraftSchema: z.ZodType<ScriptItemDraft> = z
  .object({
    body: bodySchema,
    id: uuidSchema.nullable().optional(),
    kind: z.enum(["message", "question"]).default("message"),
    offsetMs: offsetSchema.nullable(),
    personaName: z.string({ error: CHAT_MESSAGES.personaName }).trim().min(1, CHAT_MESSAGES.personaName).max(CHAT_LIMITS.personaName, CHAT_MESSAGES.personaName),
    personaRole: z.enum(PERSONA_ROLES).default("student"),
    phrase: z.string().trim().min(CHAT_LIMITS.phraseMin, CHAT_MESSAGES.phrase).max(CHAT_LIMITS.phraseMax, CHAT_MESSAGES.phrase).nullable(),
    phraseDelayMs: z.number().int().min(CHAT_LIMITS.phraseDelayMinMs).max(CHAT_LIMITS.phraseDelayMaxMs).default(0),
    // R9: a foto de quem comenta, so o caminho da nossa pasta; ausente, a do item fica como esta.
    personaAvatarPath: personaAvatarPathSchema.nullable().optional(),
    // 11/11/2026 (D75): a pessoa da lista; com ela, o servidor grava a copia dela no item.
    personaId: uuidSchema.nullable().optional(),
    status: z.enum(SCRIPT_STATUSES).default("draft"),
    triggerKind: z.enum(SCRIPT_TRIGGERS, { error: CHAT_MESSAGES.invalid })
  })
  .superRefine((item, context) => {
    // A Pergunta (D77) entra na aba Perguntas: o texto cabe na pergunta do aluno.
    if (item.kind === "question" && Array.from(item.body).length > CHAT_LIMITS.question) {
      context.addIssue({ code: "custom", message: PESSOAS.erros.pergunta, path: ["body"] });
    }
    if (item.triggerKind === "at_offset" && item.offsetMs == null) {
      context.addIssue({ code: "custom", message: CHAT_MESSAGES.offset, path: ["offsetMs"] });
    }
    if (item.triggerKind === "on_phrase" && !item.phrase) {
      context.addIssue({ code: "custom", message: CHAT_MESSAGES.phrase, path: ["phrase"] });
    }
  });

export const saveScriptItemsSchema = z.object({
  items: z.array(scriptItemDraftSchema).max(CHAT_LIMITS.scriptItemsMax, CHAT_MESSAGES.tooManyItems),
  /**
   * Os ids que o editor carregou (o roteiro que ele tinha na tela): so esses podem sair quando faltam na lista nova. Um
   * item que o console guardou depois ("Guardar na lista") nunca e apagado por um Salvar com a pagina velha. Ausente:
   * nada sai.
   */
  loadedIds: z.array(uuidSchema).max(CHAT_LIMITS.scriptItemsMax, CHAT_MESSAGES.tooManyItems).default([]),
  webinarId: uuidSchema
});
export type SaveScriptItemsInput = z.infer<typeof saveScriptItemsSchema>;

export const importScriptCsvSchema = z.object({
  csv: z.string().max(CHAT_LIMITS.scriptCsvBytes * 2, CHAT_MESSAGES.csvTooLong),
  /** true = o roteiro vira o do arquivo; false = as linhas entram no fim do roteiro atual. */
  replace: z.boolean().default(false),
  webinarId: uuidSchema
});

export const saveTranscriptSchema = z.object({
  format: z.enum(TRANSCRIPT_FORMATS).default("vtt"),
  language: z.string().trim().min(2).max(35).default("pt-BR"),
  recordingId: uuidSchema.optional(),
  text: z.string().min(1).max(CHAT_LIMITS.transcriptBytes, CHAT_MESSAGES.transcriptTooLong),
  webinarId: uuidSchema
});

export const resolveScriptPhrasesSchema = z.object({ webinarId: uuidSchema });

/** "Soltar agora": um item do roteiro (manual ou nao) entra na sessao no minuto atual. */
export const fireScriptItemSchema = z.object({ itemId: uuidSchema, sessionId: sessionIdSchema });

/**
 * O "Novo comentário" do console (adendo de 10/11/2026, R8 e R9): quem comenta (Nome, Foto (opcional), Aparece como) e
 * o Comentário, para "Enviar agora" (sendScriptedComment) ou "Guardar na lista" (saveScriptComment). O `applyToName` de
 * 10/11/2026 (o "Usar esta foto em todos os comentários de {nome}") saiu em 11/11/2026: a pagina antiga que ainda manda
 * a chave e atendida, e a chave e ignorada (a pessoa da lista e a unidade, D75). Desde 11/11/2026 (D75 a D78):
 * `personaId`, a pessoa da lista (o servidor usa o nome, o papel e a foto dela; o Nome, a Foto e o Aparece como que
 * vierem junto ficam de fora); sem ela, a pessoa nova (Nome, Foto, Aparece como), que entra na lista ao enviar ou
 * guardar; e `kind`, o Tipo: "message" (o comentario no chat) ou "question" (a pergunta simulada na aba Perguntas, ate
 * 500 caracteres, como a pergunta do aluno).
 */
export const scriptCommentSchema = z
  .object({
    body: z.string({ error: COMENTARIOS.erros.comentario }).trim().min(1, COMENTARIOS.erros.comentario).max(CHAT_LIMITS.body, COMENTARIOS.erros.comentario),
    kind: z.enum(["message", "question"]).default("message"),
    personaAvatarPath: personaAvatarPathSchema.nullable().default(null),
    personaId: uuidSchema.nullable().default(null),
    personaName: z.string({ error: COMENTARIOS.erros.nome }).trim().min(1, COMENTARIOS.erros.nome).max(CHAT_LIMITS.personaName, COMENTARIOS.erros.nome),
    personaRole: z.enum(PERSONA_ROLES).default("student"),
    sessionId: sessionIdSchema
  })
  .superRefine((input, context) => {
    if (input.kind === "question" && Array.from(input.body).length > CHAT_LIMITS.question) {
      context.addIssue({ code: "custom", message: PESSOAS.erros.pergunta, path: ["body"] });
    }
  });
export type ScriptCommentInput = z.input<typeof scriptCommentSchema>;

/**
 * Uma pessoa da lista "Pessoas que comentam" (11/11/2026, D75): o Nome (1 a 60, sem espacos sobrando), a Foto (so o
 * caminho da nossa pasta) e o Aparece como; com `id`, a edicao. O nome repetido na escola (a lista e uma so desde
 * 13/11/2026, D117) e conferido no servidor; `webinarId` e o webinario de onde a equipe mexe (a origem da pessoa nova).
 */
export const savePersonaSchema = z.object({
  avatarPath: personaAvatarPathSchema.nullable().default(null),
  id: uuidSchema.nullable().default(null),
  name: z
    .string({ error: PESSOAS.erros.nome })
    .refine((value) => personaNameFits(value), PESSOAS.erros.nome)
    .transform((value) => personaCleanName(value)),
  role: z.enum(PERSONA_ROLES).default("student"),
  webinarId: uuidSchema
});
export type SavePersonaInput = z.input<typeof savePersonaSchema>;

/**
 * Remover uma pessoa da lista da escola (os comentarios do roteiro dela ficam com a copia); `webinarId` e o webinario de
 * onde a equipe remove (D117).
 */
export const deletePersonaSchema = z.object({ id: uuidSchema, webinarId: uuidSchema });

/**
 * A foto de quem comenta como o navegador manda (data URL WebP ja reduzido a 512 px e ate 100 KB): o teto do texto e o
 * do base64 de 100 KB com folga para o cabecalho; o servidor confere de novo os bytes, as medidas e a animacao.
 */
export const PERSONA_AVATAR_DATA_URL_MAX = Math.ceil(PERSONA_AVATAR_LIMITS.bytes / 3) * 4 + 64;

export const uploadPersonaPhotoSchema = z.object({
  image: z.string({ error: COMENTARIOS.erros.fotoFormato }).min(1, COMENTARIOS.erros.fotoFormato).max(PERSONA_AVATAR_DATA_URL_MAX, COMENTARIOS.erros.fotoPesada)
});

/**
 * A mensagem da equipe no chat da sessao (role team, source team). `pin`: o "Fixar ao enviar" do console (a Na tela,
 * docs/30 §2.4): publica e fixa num passo, trocando a fixada de antes.
 */
export const teamChatSchema = z.object({
  body: bodySchema,
  kind: z.enum(["message", "answer", "system"]).default("message"),
  pin: z.boolean().default(false),
  replyToId: uuidSchema.nullable().optional(),
  sessionId: sessionIdSchema
});

/** "question" (docs/31 V2-15): Virar pergunta, so mensagem da turma com autor (a pendente tambem e liberada). */
export const MODERATION_ACTIONS = ["approve", "delete", "pin", "unpin", "promote", "question"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const moderateMessageSchema = z.object({
  action: z.enum(MODERATION_ACTIONS, { error: CHAT_MESSAGES.invalid }),
  messageId: uuidSchema,
  reason: z.string().trim().max(200).optional()
});

/**
 * Mostrar ou esconder dos alunos quantas pessoas estao na sala, pelo console (rodada v12, docs/30 D107): a chave
 * `showPresentCount` do room_settings do webinario, pela sessao que o console tem aberta.
 */
export const showPresentCountSchema = z.object({ sessionId: sessionIdSchema, shown: z.boolean() });

export const sessionChatModeSchema = z.object({
  chatMode: z.enum(CHAT_MODES, { error: CHAT_MESSAGES.invalid }),
  sessionId: sessionIdSchema,
  slowModeSeconds: z.union([z.literal(SLOW_MODE_SECONDS[0]), z.literal(SLOW_MODE_SECONDS[1]), z.literal(SLOW_MODE_SECONDS[2]), z.literal(SLOW_MODE_SECONDS[3])]).nullable()
});

/**
 * Os campos de uma enquete, os mesmos no card Enquetes do editor e na "Nova enquete" do console (D83): o tipo, a
 * pergunta e de 2 a 20 opcoes de ate 120 caracteres (o id da opcao so vale no editor, que atualiza o modelo).
 */
const pollDraftFields = {
  kind: z.enum(POLL_KINDS).default("single"),
  options: z
    .array(z.object({ id: uuidSchema.nullable().optional(), label: z.string().trim().min(1, CHAT_MESSAGES.option).max(CHAT_LIMITS.pollOption, CHAT_MESSAGES.option) }))
    .min(CHAT_LIMITS.pollOptionsMin, CHAT_MESSAGES.options)
    .max(CHAT_LIMITS.pollOptionsMax, CHAT_MESSAGES.options),
  question: z.string({ error: CHAT_MESSAGES.pollQuestion }).trim().min(1, CHAT_MESSAGES.pollQuestion).max(CHAT_LIMITS.pollQuestion, CHAT_MESSAGES.pollQuestion)
};

/** Um editor aberto com a pagina antiga ainda manda `anonymous`: o objeto descarta a chave, e a enquete e gravada com falso (D64). */
export const pollDraftSchema: z.ZodType<PollDraft> = z.object({ id: uuidSchema.nullable().optional(), ...pollDraftFields });

/**
 * Os modelos de enquete do webinario (sem sessao); as copias lancadas nascem em launchPoll. `loadedIds` (D83): os
 * modelos que o card carregou; o servidor so apaga desses, entao a enquete que o console criou depois fica. A folga de
 * 100 nunca recusa o salvar de um banco que passou do teto.
 */
export const savePollsSchema = z.object({
  loadedIds: z.array(uuidSchema).max(100, CHAT_MESSAGES.invalid).default([]),
  polls: z.array(pollDraftSchema).max(CHAT_LIMITS.pollTemplatesMax, CHAT_MESSAGES.tooManyPolls),
  webinarId: uuidSchema
});

/** O que a "Nova enquete" do console faz depois de guardar nas prontas (D83): nada, Abrir agora ou Abrir e fixar. */
export const CONSOLE_POLL_LAUNCHES = ["save", "open", "pin"] as const;
export type ConsolePollLaunch = (typeof CONSOLE_POLL_LAUNCHES)[number];

/**
 * A enquete criada no console (D83): os mesmos campos do editor (pollDraftFields, os erros pelo mesmo caminho do campo),
 * a sessao do console e o que fazer depois de guardar nas prontas do webinario.
 */
export const createConsolePollSchema = z.object({ ...pollDraftFields, launch: z.enum(CONSOLE_POLL_LAUNCHES, { error: CHAT_MESSAGES.invalid }).default("save"), sessionId: sessionIdSchema });

/** Abrir uma enquete pronta na sessao; `pin`: o "Abrir e fixar" do console (a Na tela, R2). */
export const launchPollSchema = z.object({ pin: z.boolean().default(false), pollId: uuidSchema, sessionId: sessionIdSchema });
export const closePollSchema = z.object({ pollId: uuidSchema, sessionId: sessionIdSchema, shareResults: z.boolean().default(false) });

/**
 * "Responder como" (rodada v9, docs/30 D88): o modo e, em "Outro nome", o nome. Ausente (a pagina de antes): quem chama
 * usa o padrao de sempre (a primeira resposta como "Equipe"; a do fio com o nome de quem escreve).
 */
const answerAuthorChoiceSchema = z
  .object({
    as: z.enum(ANSWER_AUTHOR_MODES, { error: CHAT_MESSAGES.invalid }),
    name: z.string().trim().max(ANSWER_AUTHOR_LIMITS.nameMax, CHAT_MESSAGES.authorName).nullish()
  })
  .superRefine((value, context) => {
    if (value.as === "custom" && !answerAuthorCustomName(value.name)) {
      context.addIssue({ code: "custom", message: CHAT_MESSAGES.authorName, path: ["name"] });
    }
  })
  .optional();

export const answerQuestionSchema = z.object({
  answerText: z.string().trim().max(CHAT_LIMITS.answer, CHAT_MESSAGES.answer).optional(),
  answeredLive: z.boolean().default(false),
  author: answerAuthorChoiceSchema,
  questionId: uuidSchema
});

export const questionStatusSchema = z.object({ questionId: uuidSchema, status: z.enum(QUESTION_STATUSES, { error: CHAT_MESSAGES.invalid }) });

/** Marcar o fio de uma pergunta como visto pela equipe (console; rodada v10, docs/30 D94). */
export const markQuestionSeenSchema = z.object({ questionId: uuidSchema });

/** A resposta da equipe no fio de uma pergunta ja respondida (console). */
export const replyQuestionSchema = z.object({
  author: answerAuthorChoiceSchema,
  body: z.string().trim().min(1, CHAT_MESSAGES.reply).max(QUESTION_REPLY_LIMITS.teamBody, CHAT_MESSAGES.answer),
  questionId: uuidSchema
});

export const deleteQuestionReplySchema = z.object({ replyId: uuidSchema });

/** A decisao do selo "Ao vivo" (D10, §8.6): ligar exige a frase marcada; desligar grava a decisao tambem. */
export const saveSimulationSchema = z
  .object({
    ackText: z.string().trim().max(CHAT_LIMITS.simulationAck).optional(),
    acknowledged: z.boolean().default(false),
    sessionId: sessionIdSchema,
    showLiveBadge: z.boolean()
  })
  .superRefine((input, context) => {
    if (input.showLiveBadge && (!input.acknowledged || !input.ackText)) {
      context.addIssue({ code: "custom", message: CHAT_MESSAGES.simulationAck, path: ["acknowledged"] });
    }
  });

export const sessionIdInputSchema = z.object({ sessionId: sessionIdSchema });

export const createReplaySessionSchema = z.object({ webinarId: uuidSchema });

export const removeStudentMessagesSchema = z.object({ reason: z.string().trim().min(1).max(200), userId: uuidSchema });

/** Os cortes do CSV de exportacao do roteiro e do chat de uma sessao (webinar ou sessao). */
export const exportChatSchema = z.object({ sessionId: sessionIdSchema.optional(), webinarId: uuidSchema });
