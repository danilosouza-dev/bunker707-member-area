// "Responder como" (rodada v9, P8; docs/30 D88; 12/11/2026): quem assina a resposta da equipe a uma pergunta, a primeira
// resposta escrita (webinar_questions.answer_author) e as respostas do fio (webinar_question_replies.author_as), as
// colunas da 202611150001. O produtor: "Quando respondo uma pergunta so aparece que quem respondeu foi a equipe, mas
// nao tem como aparecer tambem o nome da pessoa que respondeu? ... seria bom ter a opcao de escolher se responde como a
// pessoa mesmo ou como equipe ou ate mesmo colocar um nome especifico como 'Equipe Bunker 707'". Modulo puro (sem
// "server-only", imports relativos): o servidor, a sala, o console e os testes usam o mesmo arquivo.
//
// As tres opcoes:
// - "self" (Meu nome): o nome com que a pessoa escreve para a turma (o primeiro nome com a inicial), o selo do papel
//   (Apresentador, Co-apresentador ou Equipe) e a foto do Perfil dela (a da equipe aparece sempre, D62);
// - "team" (Equipe): so "Equipe", sem nome e sem foto. E o que a primeira resposta sempre mostrou;
// - "custom" (Outro nome): o nome que a equipe escreveu (ex.: "Equipe Bunker 707"), sem foto e sem o selo do papel.
// Para a turma, "team" e "custom" nunca levam o nome nem a foto de quem escreveu.

import type { ChatRole } from "./model";

export const ANSWER_AUTHOR_MODES = ["self", "team", "custom"] as const;
export type AnswerAuthorMode = (typeof ANSWER_AUTHOR_MODES)[number];

/** Os papeis da equipe que assinam uma resposta. */
export const ANSWER_AUTHOR_ROLES = ["host", "co_host", "team"] as const;
export type AnswerAuthorRole = (typeof ANSWER_AUTHOR_ROLES)[number];

/** O nome personalizado: de 2 a 40 caracteres (cabe "Equipe Bunker 707" com folga e nao estoura a linha do comentario). */
export const ANSWER_AUTHOR_LIMITS = { nameMax: 40, nameMin: 2 } as const;

/** A migracao das colunas, para o aviso do console. */
export const ANSWER_AUTHOR_MIGRATION = "202611150001";

/** A escolha que o console manda com a resposta: o modo e, em "custom", o nome. */
export type AnswerAuthorChoice = { as: AnswerAuthorMode; name?: string | null };

/** Quem assina a primeira resposta, como fica gravado (versao 1). */
export type AnswerAuthor = { as: AnswerAuthorMode; name: string | null; role: AnswerAuthorRole };

/** O que o console guarda no navegador para a proxima resposta. */
export const ANSWER_AUTHOR_STORAGE_KEY = "bunker707:webinar-console-responder-como";

/** O padrao do seletor do console: o nome de quem responde (era isso que o produtor sentia falta). */
export const ANSWER_AUTHOR_DEFAULT: AnswerAuthorChoice = { as: "self", name: null };

function roleOf(value: unknown): AnswerAuthorRole {
  return (ANSWER_AUTHOR_ROLES as readonly unknown[]).includes(value) ? (value as AnswerAuthorRole) : "team";
}

/** O nome personalizado limpo (espacos repetidos viram um, sem espacos nas pontas) ou nulo quando nao cabe nos limites. */
export function answerAuthorCustomName(value: string | null | undefined): string | null {
  const name = (value ?? "").replace(/\s+/g, " ").trim();
  const length = Array.from(name).length;
  return length >= ANSWER_AUTHOR_LIMITS.nameMin && length <= ANSWER_AUTHOR_LIMITS.nameMax ? name : null;
}

/**
 * O que gravar a partir da escolha: em "self" o nome de exibicao de quem responde; em "custom" o nome escrito; em
 * "team" nenhum nome. Devolve nulo quando "custom" vem sem um nome valido (quem chama responde com o erro do campo).
 */
export function answerAuthorOf(input: { choice: AnswerAuthorChoice; displayName: string; role: ChatRole | null | undefined }): AnswerAuthor | null {
  const role = roleOf(input.role);
  if (input.choice.as === "team") {
    return { as: "team", name: null, role };
  }
  if (input.choice.as === "custom") {
    const name = answerAuthorCustomName(input.choice.name);
    return name ? { as: "custom", name, role } : null;
  }
  return { as: "self", name: input.displayName, role };
}

/** A coluna answer_author conferida na leitura: a que nao tem a forma da versao 1 vira nula (a sala mostra "Equipe"). */
export function parseAnswerAuthor(value: unknown): AnswerAuthor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as { as?: unknown; name?: unknown; role?: unknown; v?: unknown };
  if (raw.v !== 1 || !(ANSWER_AUTHOR_MODES as readonly unknown[]).includes(raw.as)) {
    return null;
  }
  const as = raw.as as AnswerAuthorMode;
  if (as === "team") {
    return { as, name: null, role: roleOf(raw.role) };
  }
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
  return name ? { as, name, role: roleOf(raw.role) } : null;
}

/** A linha gravada em answer_author. */
export function answerAuthorToRow(author: AnswerAuthor): { as: AnswerAuthorMode; name: string | null; role: AnswerAuthorRole; v: 1 } {
  return { as: author.as, name: author.name, role: author.role, v: 1 };
}

/** A coluna author_as do fio conferida na leitura: nula (a resposta de antes e a do aluno) ou um dos tres modos. */
export function parseAnswerAuthorMode(value: unknown): AnswerAuthorMode | null {
  return (ANSWER_AUTHOR_MODES as readonly unknown[]).includes(value) ? (value as AnswerAuthorMode) : null;
}

/** A escolha guardada no navegador conferida: fora da forma, o padrao. */
export function parseAnswerAuthorChoice(value: unknown): AnswerAuthorChoice {
  if (!value || typeof value !== "object") {
    return ANSWER_AUTHOR_DEFAULT;
  }
  const raw = value as { as?: unknown; name?: unknown };
  const as = parseAnswerAuthorMode(raw.as);
  if (!as) {
    return ANSWER_AUTHOR_DEFAULT;
  }
  return { as, name: typeof raw.name === "string" ? raw.name.slice(0, ANSWER_AUTHOR_LIMITS.nameMax) : null };
}

/**
 * O que a turma ve de quem assina: em "self", o nome, o papel e a foto; em "custom", so o nome; em "team" (e sem
 * assinatura: a resposta de antes), nada (a sala mostra o selo "Equipe"). O nome e a foto de quem escreveu nunca saem
 * daqui em "team" nem em "custom".
 */
export type StudentAnswerAuthor = { as: "custom" | "self"; avatarUrl: string | null; name: string; role: AnswerAuthorRole | null };

export function studentAnswerAuthor(author: AnswerAuthor | null | undefined, avatarUrl: string | null = null): StudentAnswerAuthor | null {
  if (!author || author.as === "team" || !author.name) {
    return null;
  }
  return author.as === "self" ? { as: "self", avatarUrl, name: author.name, role: author.role } : { as: "custom", avatarUrl: null, name: author.name, role: null };
}
