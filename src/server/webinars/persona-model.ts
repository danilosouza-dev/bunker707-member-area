// A foto de quem comenta e o roteiro na Live ao vivo, a parte pura (adendo de 10/11/2026, R8 e R9; docs/30 §2.7 e
// docs/31 §5.2). "Quem comenta" e o nome da tela para as pessoas dos comentarios prontos do roteiro (o nome interno
// continua `persona`): o Nome, a Foto (opcional) e o papel (Aparece como: Aluno ou Equipe).
//
// - A foto: so o caminho webinars/personas/<24 hex>.webp no bucket content-assets (o mesmo envio da imagem do banner da
//   Na tela, screen-actions.ts, com a pasta e os limites proprios: ate 512 px de lado, 100.000 bytes, sem animacao); o
//   endereco e montado aqui pela origem conferida do nosso Supabase (screenStorageOriginOf), nunca um endereco de fora.
//   A mensagem `scripted` guarda a copia do caminho (webinar_chat_messages.persona_avatar_path): o que a turma viu nao
//   muda quando a equipe troca a foto do item depois.
// - "Usar esta foto em todos os comentários de {nome}" (ligada por padrao, 10/11/2026): a mesma foto nos outros itens com
//   o mesmo nome no webinario, pelo nome sem espacos nas pontas e sem diferenca de caixa (samePersonaName). Saiu da tela
//   em 11/11/2026: a pessoa da lista virou a unidade (abaixo), e editar a pessoa troca a foto de todos os itens dela.
// - O roteiro na Live ao vivo (R8): o zero e o started_at (o "Começar para todos"); o tick solta os itens "Num minuto da
//   live" que venceram e ainda nao entraram (liveScriptDue), no maximo 5 min atrasados (o tick que ficou fora do ar);
//   o que passou disso fica para o "Soltar agora". "Quando o apresentador diz" nao existe na live (sem transcricao
//   durante a transmissao).
// - As pessoas que comentam (pedido do produtor de 11/11/2026; docs/30 D75 a D78; migracao 202611140001): a lista de
//   cada webinario (webinar_personas), que o editor e o console leem e gravam. A pessoa e a unidade: o item do roteiro
//   ligado a ela (personaId) guarda a copia do nome, do papel e da foto, e editar a pessoa troca a copia de todos os
//   itens dela (withPersonaCopy; no banco, persona-store.syncPersonaCopies). O nome e unico no webinario pelo
//   personaNameKey, o mesmo texto que a funcao webinar_persona_name_key do banco gera (NFC, espacos repetidos viram um,
//   sem espacos nas pontas, sem caixa); o nome repetido volta como erro no campo Nome (personaDraftErrors). A parte pura
//   do Novo comentário do console tambem mora aqui: a pessoa escolhida ou nova, o Tipo (Comentário ou Pergunta, a
//   pergunta simulada que entra na aba Perguntas) e o repetir, que mantem a pessoa e limpa o texto (commentFormAfterSend).
//
// Sem "server-only", imports relativos: tests/webinarios-roteiro-ao-vivo.test.mjs e tests/webinarios-pessoas.test.mjs
// carregam direto pelo Node.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { CHAT_LIMITS, toTime, type PersonaRole, type ScriptItem, type ScriptTrigger, type WebinarKind } from "./model";
import { screenStorageOriginOf } from "./screen-model";

export const PERSONA_AVATAR_BUCKET = "content-assets";
/** A pasta do envio (persistImageAsset; fora da limpeza de arquivos da Comunicacao, como webinars/screen). */
export const PERSONA_AVATAR_FOLDER = "webinars/personas";
/** O nome pelo conteudo que persistImageAsset grava: 24 hex do sha256 + .webp (o check do banco e o mesmo). */
export const PERSONA_AVATAR_PATH_PATTERN = /^webinars\/personas\/[a-f0-9]{24}\.webp$/;

/** Os limites da foto (o navegador reduz antes; o servidor confere de novo). */
export const PERSONA_AVATAR_LIMITS = {
  /** 100 KB. */
  bytes: 100_000,
  sideMax: 512,
  sideMin: 16
} as const;

/** O caminho de uma foto de quem comenta (so o da nossa pasta). */
export function isPersonaAvatarPath(value: unknown): value is string {
  return typeof value === "string" && PERSONA_AVATAR_PATH_PATTERN.test(value);
}

/**
 * O endereco publico da foto: a origem conferida do nosso Supabase + o caminho publico do bucket, so quando o caminho e
 * um dos nossos. Senao null (a tela desenha as iniciais).
 */
export function personaAvatarUrl(path: string | null | undefined, origin: string | null | undefined): string | null {
  if (!isPersonaAvatarPath(path)) {
    return null;
  }
  const safeOrigin = screenStorageOriginOf(origin);
  return safeOrigin ? `${safeOrigin}/storage/v1/object/public/${PERSONA_AVATAR_BUCKET}/${path}` : null;
}

/** O nome comparavel: sem espacos nas pontas nem repetidos, sem diferenca de caixa. */
export function personaNameKey(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

/** Os dois nomes sao da mesma pessoa que comenta (sem caixa nem espacos sobrando; sem nome, nunca). */
export function samePersonaName(a: string, b: string): boolean {
  const key = personaNameKey(a);
  return key.length > 0 && key === personaNameKey(b);
}

/* ------------------------------------------------------------------------------------------------
 * As pessoas que comentam (11/11/2026, D75 a D78)
 * ---------------------------------------------------------------------------------------------- */

/** Uma pessoa da lista do webinario (webinar_personas). */
export type WebinarPersona = {
  /** A foto: so o caminho da nossa pasta (isPersonaAvatarPath); nula, as iniciais. */
  avatarPath: string | null;
  createdAt: string;
  id: string;
  name: string;
  role: PersonaRole;
  updatedAt: string;
  webinarId: string;
};

/**
 * A migracao da lista, para o aviso da tela no banco sem ela (a mesma de db.WEBINARS_PERSONAS_MIGRATION, que e
 * "server-only"; a guarda tests/webinarios-v8.guard.test.mjs confere as duas).
 */
export const PERSONAS_MIGRATION_ID = "202611140001";

/** A lista lida: `available` falso no banco sem a 202611140001 (nenhuma pessoa, e nada pode ser gravado nela). */
export type PersonaList = { available: boolean; personas: WebinarPersona[] };

export const NO_PERSONA_LIST: PersonaList = { available: false, personas: [] };

/** O que o formulario da pessoa manda (Nome, Foto (opcional), Aparece como); com `id`, a edicao. */
export type PersonaDraft = { avatarPath: string | null; id?: string | null; name: string; role: PersonaRole };

/** O nome como a lista guarda: sem espacos nas pontas nem repetidos (a caixa fica como a equipe escreveu). */
export function personaCleanName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** O nome cabe na lista: de 1 a 60 caracteres depois de limpo (o check char_length do banco conta por caractere). */
export function personaNameFits(name: string): boolean {
  const length = Array.from(personaCleanName(name)).length;
  return length >= 1 && length <= CHAT_LIMITS.personaName;
}

/** O nome ja esta na lista (sem caixa nem espacos), fora a propria pessoa (`exceptId`, na edicao). */
export function personaNameTaken(personas: readonly Pick<WebinarPersona, "id" | "name">[], name: string, exceptId: string | null = null): boolean {
  const key = personaNameKey(name);
  return key.length > 0 && personas.some((persona) => persona.id !== exceptId && personaNameKey(persona.name) === key);
}

/**
 * Os erros do formulario da pessoa antes de enviar (o servidor confere de novo, e o indice unico do banco por ultimo):
 * o nome de 1 a 60 caracteres e unico na lista.
 */
export function personaDraftErrors(
  draft: Pick<PersonaDraft, "id" | "name">,
  personas: readonly Pick<WebinarPersona, "id" | "name">[],
  messages: { nome: string; nomeRepetido: string }
): Record<string, string> {
  if (!personaNameFits(draft.name)) {
    return { name: messages.nome };
  }
  if (personaNameTaken(personas, draft.name, draft.id ?? null)) {
    return { name: messages.nomeRepetido };
  }
  return {};
}

/** A copia da pessoa que o item do roteiro (e a mensagem, e a pergunta simulada) guarda. */
export function personaCopyOf(persona: Pick<WebinarPersona, "avatarPath" | "id" | "name" | "role">): {
  personaAvatarPath: string | null;
  personaId: string;
  personaName: string;
  personaRole: PersonaRole;
} {
  return { personaAvatarPath: isPersonaAvatarPath(persona.avatarPath) ? persona.avatarPath : null, personaId: persona.id, personaName: persona.name, personaRole: persona.role };
}

/** Os itens com a copia nova da pessoa (editar a pessoa troca todos os itens ligados a ela); os outros ficam. */
export function withPersonaCopy<T extends { personaAvatarPath?: string | null; personaId?: string | null; personaName: string; personaRole: PersonaRole }>(
  items: readonly T[],
  persona: Pick<WebinarPersona, "avatarPath" | "id" | "name" | "role">
): T[] {
  const copy = personaCopyOf(persona);
  return items.map((item) => (item.personaId === persona.id ? { ...item, ...copy } : item));
}

/** Quantos itens do roteiro usam a pessoa (a linha da lista e a confirmacao do Remover). */
export function personaUsage(items: readonly { personaId?: string | null }[], personaId: string): number {
  return items.reduce((total, item) => (item.personaId === personaId ? total + 1 : total), 0);
}

/** A lista na ordem da tela: pelo nome, sem caixa (pt-BR). */
export function sortPersonas<T extends Pick<WebinarPersona, "name">>(personas: readonly T[]): T[] {
  return [...personas].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

/* ------------------------------------------------------------------------------------------------
 * O Novo comentário do console: a pessoa, o Tipo e o repetir (D76 e D78)
 * ---------------------------------------------------------------------------------------------- */

/** O Tipo do comentario: no chat ou, como a pergunta de um aluno, na aba Perguntas (a pergunta simulada, D77). */
export const COMMENT_KINDS = ["message", "question"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

/**
 * O estado do Novo comentário: a pessoa da lista (`personaId`) ou uma nova (`personaId` nulo, com o Nome, a Foto e o
 * Aparece como, que entra na lista ao enviar ou guardar), o Tipo e o texto.
 */
export type CommentFormState = {
  body: string;
  kind: CommentKind;
  personaAvatarPath: string | null;
  personaId: string | null;
  personaName: string;
  personaRole: PersonaRole;
};

/** O formulario vazio; com a pessoa (o "Comentar como {nome}" ou a ultima usada), ela ja escolhida. */
export function commentFormFor(persona: Pick<WebinarPersona, "avatarPath" | "id" | "name" | "role"> | null, kind: CommentKind = "message"): CommentFormState {
  if (!persona) {
    return { body: "", kind, personaAvatarPath: null, personaId: null, personaName: "", personaRole: "student" };
  }
  return { body: "", kind, ...personaCopyOf(persona) };
}

/**
 * O formulario depois do "Enviar agora" (o repetir, D78): a mesma pessoa (a nova vira a da lista, pelo id que o servidor
 * devolveu) e o mesmo Tipo, com o texto limpo para o proximo.
 */
export function commentFormAfterSend(state: CommentFormState, personaId: string | null): CommentFormState {
  return { ...state, body: "", personaId: personaId ?? state.personaId };
}

/** O limite do texto pelo Tipo: o do chat no comentario, o da pergunta da aba na pergunta. */
export function commentBodyMax(kind: CommentKind): number {
  return kind === "question" ? CHAT_LIMITS.question : CHAT_LIMITS.body;
}

export type CommentFormMessages = { comentario: string; nome: string; nomeRepetido: string; pergunta: string; sumiu: string };

/**
 * Os erros do Novo comentário antes de enviar (o servidor confere de novo): a pessoa (escolhida da lista, ou o nome da
 * nova, unico na lista quando a lista existe) e o texto pelo Tipo.
 */
export function commentFormErrors(
  state: CommentFormState,
  personas: readonly Pick<WebinarPersona, "id" | "name">[],
  messages: CommentFormMessages,
  options: { listAvailable?: boolean } = {}
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (state.personaId) {
    if (!personas.some((persona) => persona.id === state.personaId)) {
      errors.personaId = messages.sumiu;
    }
  } else if (!personaNameFits(state.personaName)) {
    errors.personaName = messages.nome;
  } else if (options.listAvailable !== false && personaNameTaken(personas, state.personaName)) {
    errors.personaName = messages.nomeRepetido;
  }
  const body = Array.from(state.body.trim()).length;
  if (body < 1 || body > commentBodyMax(state.kind)) {
    errors.body = state.kind === "question" ? messages.pergunta : messages.comentario;
  }
  return errors;
}

/* ------------------------------------------------------------------------------------------------
 * O roteiro na Live ao vivo (R8)
 * ---------------------------------------------------------------------------------------------- */

/** Quanto atraso o tick ainda solta (o tick que ficou fora do ar); depois disso, so o "Soltar agora". */
export const LIVE_SCRIPT_LATE_MAX_MS = 5 * 60_000;
/** Quantos itens o tick solta por sessao numa volta (os mais antigos primeiro; o resto entra no minuto seguinte). */
export const LIVE_SCRIPT_BATCH = 50;

/** Os gatilhos que o roteiro aceita por tipo: na live, sem "Quando o apresentador diz" (sem transcricao na transmissao). */
export function scriptTriggersFor(kind: WebinarKind): ScriptTrigger[] {
  return kind === "live" ? ["at_offset", "manual"] : ["at_offset", "on_phrase", "manual"];
}

/** Os rotulos dos gatilhos na Live ao vivo ("Num minuto da live", "Pelo botão da equipe"). */
export const LIVE_SCRIPT_TRIGGER_LABELS: Record<"at_offset" | "manual", string> = WEBINAR_COPY.naTela.comentarios.gatilhosLive;

/** "Aos 12 minutos da live", "Aos 12:30 da live", "No começo da live": quando o item entra na live. */
export function liveScriptDueLabel(offsetMs: number): string {
  const total = Math.max(0, Math.round(offsetMs / 1000));
  return WEBINAR_COPY.naTela.comentarios.aosMinutos(Math.floor(total / 60), total % 60);
}

/**
 * Os itens da Live ao vivo que o tick solta agora (R8): prontos, "Num minuto da live", ainda nao entraram nesta sessao,
 * com started_at + minuto ja vencido e no maximo LIVE_SCRIPT_LATE_MAX_MS atrasados; na ordem do minuto (a posicao
 * desempata), ate LIVE_SCRIPT_BATCH. Sem started_at (a espera), nenhum: nunca antes do "Começar para todos".
 */
export function liveScriptDue<T extends Pick<ScriptItem, "id" | "offsetMs" | "position" | "status" | "triggerKind">>(input: {
  fired: ReadonlySet<string>;
  items: readonly T[];
  nowMs: number;
  startedAt: string | null;
}): T[] {
  const started = toTime(input.startedAt);
  if (!Number.isFinite(started)) {
    return [];
  }
  return input.items
    .filter((item) => {
      if (item.status !== "ready" || item.triggerKind !== "at_offset" || item.offsetMs == null || input.fired.has(item.id)) {
        return false;
      }
      const due = started + item.offsetMs;
      return due <= input.nowMs && input.nowMs - due <= LIVE_SCRIPT_LATE_MAX_MS;
    })
    .sort((a, b) => (a.offsetMs ?? 0) - (b.offsetMs ?? 0) || a.position - b.position)
    .slice(0, LIVE_SCRIPT_BATCH);
}
