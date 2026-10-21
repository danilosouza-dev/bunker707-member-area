// Reacoes e enquete das notificacoes do sino (Comunicacao v3a, docs/24 §1.4, §1.6 e §4.1): catalogo fixo
// de reacoes, o schema da enquete (editor e Server Actions), a leitura tolerante do jsonb campaigns.poll,
// o voto valido, o que o aluno recebe (resultado so quando pode ver) e o teto de eventos por linha. Modulo
// puro: sem "server-only", imports relativos; tests/comunicacao-v3-interacoes.test.mjs carrega direto pelo
// Node, e a v3b usa a mesma enquete nos pop-ups (cada superficie guarda o voto na propria linha do aluno).

import { z } from "zod";

/* ------------------------------------------------------------------------------------------------
 * Reacoes (uma por aluno por notificacao; o aluno ve so a propria)
 * ---------------------------------------------------------------------------------------------- */

export const REACTION_IDS = ["like", "love", "fire", "clap", "laugh", "wow"] as const;
export type ReactionId = (typeof REACTION_IDS)[number];

/** Emoji do sistema (sem imagem). */
export const REACTION_EMOJI: Record<ReactionId, string> = { clap: "👏", fire: "🔥", laugh: "😂", like: "👍", love: "❤️", wow: "😮" };

/** Nome de cada reacao (rotulo acessivel, relatorio e regras). */
export const REACTION_LABELS: Record<ReactionId, string> = { clap: "Aplausos", fire: "Incrível", laugh: "Haha", like: "Gostei", love: "Amei", wow: "Uau" };

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === "string" && (REACTION_IDS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------------------------------------
 * Enquete
 * ---------------------------------------------------------------------------------------------- */

export const POLL_LIMITS = { maxOptions: 6, minOptions: 2, option: 60, question: 120 } as const;

/** Id de cada opcao (o editor gera 8 caracteres hexadecimais); o banco confere o mesmo formato no voto. */
export const POLL_OPTION_ID = /^[a-z0-9]{1,12}$/;

export type PollOption = { id: string; label: string };

export type PollDefinition = {
  /** Fim da votacao em ISO UTC com milissegundos (toISOString); null = enquanto a notificacao estiver no sino. */
  closesAt: string | null;
  /** Permitir marcar mais de uma. */
  multiple: boolean;
  options: PollOption[];
  question: string;
  /** Mostrar o resultado para quem votar (e para todos depois de encerrada). */
  showResults: boolean;
};

const PICK_DATE_MESSAGE = "Escolha data e hora.";

/** Chave para comparar opcoes: sem espacos nas pontas e sem diferenca de maiusculas. */
function labelKey(label: string) {
  return label.trim().toLocaleLowerCase("pt-BR");
}

const pollOptionSchema = z.object(
  {
    id: z.string({ error: "Opção inválida." }).regex(POLL_OPTION_ID, "Opção inválida."),
    label: z
      .string({ error: "Escreva a opção." })
      .trim()
      .min(1, "Escreva a opção.")
      .max(POLL_LIMITS.option, `Use até ${POLL_LIMITS.option} caracteres.`)
  },
  { error: "Escreva a opção." }
);

/** O ISO que o check campaigns_poll_v3 aceita (ano com 4 digitos, UTC, milissegundos). */
const CANONICAL_ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

// Qualquer data que o Date entende; sai sempre no ISO canonico, o formato que o check campaigns_poll_v3
// exige e que o sino compara como texto. Ano fora de 0000-9999 (o toISOString escreve "+010000-...")
// e recusado aqui, nunca pelo erro generico do check.
const closesAtSchema = z
  .string({ error: PICK_DATE_MESSAGE })
  .trim()
  .transform((value, context) => {
    const time = Date.parse(value);
    const canonical = value && Number.isFinite(time) ? new Date(time).toISOString() : "";

    if (!CANONICAL_ISO.test(canonical)) {
      context.addIssue({ code: "custom", message: PICK_DATE_MESSAGE });

      return z.NEVER;
    }

    return canonical;
  });

/** Zod da enquete (editor e Server Actions): as mensagens de docs/24 §2.5. */
export const pollSchema: z.ZodType<PollDefinition> = z
  .object(
    {
      closesAt: closesAtSchema.nullable().default(null),
      multiple: z.boolean().default(false),
      options: z
        .array(pollOptionSchema, { error: `Use pelo menos ${POLL_LIMITS.minOptions} opções.` })
        .min(POLL_LIMITS.minOptions, `Use pelo menos ${POLL_LIMITS.minOptions} opções.`)
        .max(POLL_LIMITS.maxOptions, `Use no máximo ${POLL_LIMITS.maxOptions} opções.`),
      question: z
        .string({ error: "Escreva a pergunta." })
        .trim()
        .min(1, "Escreva a pergunta.")
        .max(POLL_LIMITS.question, `Use até ${POLL_LIMITS.question} caracteres.`),
      showResults: z.boolean().default(true)
    },
    { error: "Escreva a pergunta." }
  )
  .superRefine((poll, context) => {
    const ids = new Set<string>();
    const labels = new Set<string>();

    poll.options.forEach((option, index) => {
      if (ids.has(option.id)) {
        context.addIssue({ code: "custom", message: "Opção inválida.", path: ["options", index, "id"] });
      }

      ids.add(option.id);

      const key = labelKey(option.label);

      if (key && labels.has(key)) {
        context.addIssue({ code: "custom", message: "As opções precisam ser diferentes.", path: ["options", index, "label"] });
      }

      labels.add(key);
    });
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Leitura tolerante do jsonb (campaigns.poll): fora do formato = null (sem enquete). */
export function parsePoll(value: unknown): PollDefinition | null {
  if (!isRecord(value) || typeof value.question !== "string" || !value.question.trim()) {
    return null;
  }

  if (typeof value.multiple !== "boolean" || typeof value.showResults !== "boolean" || !Array.isArray(value.options)) {
    return null;
  }

  const { closesAt } = value;

  if (closesAt !== null && closesAt !== undefined && (typeof closesAt !== "string" || !Number.isFinite(Date.parse(closesAt)))) {
    return null;
  }

  if (value.options.length < POLL_LIMITS.minOptions || value.options.length > POLL_LIMITS.maxOptions) {
    return null;
  }

  const options: PollOption[] = [];

  for (const option of value.options) {
    if (!isRecord(option) || typeof option.id !== "string" || !POLL_OPTION_ID.test(option.id) || typeof option.label !== "string" || !option.label.trim()) {
      return null;
    }

    if (options.some((item) => item.id === option.id)) {
      return null;
    }

    options.push({ id: option.id, label: option.label });
  }

  return { closesAt: typeof closesAt === "string" ? closesAt : null, multiple: value.multiple, options, question: value.question, showResults: value.showResults };
}

/** closesAt <= now. Sem closesAt, a enquete vale enquanto a notificacao estiver no sino. */
export function isPollClosed(poll: PollDefinition, now: number): boolean {
  if (poll.closesAt === null) {
    return false;
  }

  const time = Date.parse(poll.closesAt);

  return Number.isFinite(time) && time <= now;
}

const INVALID_VOTE = "Voto invalido.";

/**
 * Ids pedidos -> voto valido (sem repeticao, so ids da enquete; uma opcao quando !multiple), em ordem de id
 * como o banco grava (communication_vote_notification_poll). [] = tirar o voto. Mensagem da API, sem acento.
 */
export function normalizePollChoice(
  poll: PollDefinition,
  optionIds: readonly unknown[]
): { choice: string[]; ok: true } | { message: string; ok: false } {
  const known = new Set(poll.options.map((option) => option.id));
  const choice = new Set<string>();

  for (const id of optionIds) {
    if (typeof id !== "string" || !known.has(id)) {
      return { message: INVALID_VOTE, ok: false };
    }

    choice.add(id);
  }

  if (!poll.multiple && choice.size > 1) {
    return { message: INVALID_VOTE, ok: false };
  }

  return { choice: [...choice].sort(), ok: true };
}

export type PollTally = { counts: Record<string, number>; voters: number };

/** O que o aluno recebe da enquete de uma notificacao. */
export type NotificationPoll = {
  /** Voto deste aluno (ids); [] = nao votou. */
  choice: string[];
  closed: boolean;
  closesAt: string | null;
  multiple: boolean;
  options: PollOption[];
  question: string;
  /** Contagem sem os testes da equipe; null = o aluno ainda nao ve o resultado. */
  results: PollTally | null;
  showResults: boolean;
};

const countOf = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

/** Contagem que veio do banco (jsonb {voters, counts}) lida sem confiar no formato; fora dele, null. */
export function pollTallyOf(value: unknown): PollTally | null {
  if (!isRecord(value) || !isRecord(value.counts)) {
    return null;
  }

  const counts: Record<string, number> = {};

  for (const [id, total] of Object.entries(value.counts)) {
    if (POLL_OPTION_ID.test(id)) {
      counts[id] = countOf(total);
    }
  }

  return { counts, voters: countOf(value.voters) };
}

/** O que o aluno recebe: resultado so com showResults e (votou ou encerrou), e so com a contagem em maos. */
export function notificationPollOf(
  poll: PollDefinition,
  input: { choice: readonly string[] | null; closed: boolean; tally: PollTally | null }
): NotificationPoll {
  const known = new Set(poll.options.map((option) => option.id));
  const choice = [...new Set((input.choice ?? []).filter((id) => typeof id === "string" && known.has(id)))];
  const tally = input.tally ? pollTallyOf(input.tally) : null;
  const visible = poll.showResults && (choice.length > 0 || input.closed) && tally !== null;

  return {
    choice,
    closed: input.closed,
    closesAt: poll.closesAt,
    multiple: poll.multiple,
    options: poll.options.map((option) => ({ id: option.id, label: option.label })),
    question: poll.question,
    results:
      visible && tally
        ? { counts: Object.fromEntries(poll.options.map((option) => [option.id, tally.counts[option.id] ?? 0])), voters: tally.voters }
        : null,
    showResults: poll.showResults
  };
}

/** round(votes * 100 / voters); 0 sem votos. */
export function pollPercent(votes: number, voters: number): number {
  if (!Number.isFinite(votes) || !Number.isFinite(voters) || voters <= 0 || votes <= 0) {
    return 0;
  }

  return Math.round((votes * 100) / voters);
}

/* ------------------------------------------------------------------------------------------------
 * Escritas do aluno
 * ---------------------------------------------------------------------------------------------- */

/** Eventos de reagir, votar, excluir/desfazer e responder param depois disto por linha (notifications.interaction_writes). */
export const INTERACTION_EVENTS_PER_ROW = 20;

/** Grava o evento? So quando a escrita mudou algo e a linha ainda nao passou do teto (o valor de antes). */
export function shouldRecordInteraction(writesBefore: number, changed: boolean): boolean {
  return changed && writesBefore < INTERACTION_EVENTS_PER_ROW;
}
