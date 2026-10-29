// O token da sala ao vivo (docs/30 §5.4 e §8.1): HS256 assinado so no servidor, com `room` = o nome da sala da
// sessao (nunca "*"), validade curta (15 min: o token que vazou do navegador de quem foi removido ou banido morre
// logo; a pagina pede outro 5 min antes e o Prosody ainda recusa quem esta barrado, mod_bunker_room_guard) e o papel
// que o admin decidiu (host, co-apresentador, Equipe ou aluno). Todo papel leva `context.features` (o aluno e a Equipe
// sem tela, gravacao, transmissao nem ligacao: sem a claim o Jitsi deixa tudo). O navegador recebe o token pronto e
// monta o iframe; nada aqui e NEXT_PUBLIC_*. Modulo puro sobre node:crypto (tests/webinarios-sala-ao-vivo-modelo.test.mjs);
// quem le o segredo do ambiente e a rota join-token.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WebinarPresenter } from "./model";

export const ROOM_ROLES = ["host", "co_host", "team", "student"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

/** O que a regra unica do documento decide para quem entra (docs/30 §5.4 "Matriz de papeis"). */
export type RoomGrant = {
  /** Pode gravar (so o host) e compartilhar a tela (host e co-apresentador). */
  features: { recording: boolean; screenSharing: boolean };
  moderator: boolean;
  role: RoomRole;
};

export const TOKEN_RULES = {
  /** nbf = agora − 60 s (relogios desalinhados). */
  notBeforeSkewSeconds: 60,
  /**
   * exp = min(fim previsto + 30 min, agora + 15 min). Curto de proposito: o Remover e o Banir nao revogam o token que o
   * navegador do aluno ja tem (o Jitsi so confere o token na entrada); a pagina pede outro 5 min antes do exp.
   */
  afterEndSeconds: 30 * 60,
  maxLifetimeSeconds: 15 * 60,
  /** `w-<id do webinario>-<16 caracteres aleatorios>` (§8.1). */
  roomSuffixChars: 16
} as const;

export function roomRoleFor(input: {
  hostUserId: string | null;
  nowMs: number;
  presenters: readonly WebinarPresenter[];
  /** A pessoa tem messaging.write (Equipe): modera so quando marcada no editor. */
  staff: boolean;
  userId: string;
  validUntilByUser?: ReadonlyMap<string, string | null>;
}): RoomGrant {
  if (input.hostUserId && input.hostUserId === input.userId) {
    return { features: { recording: true, screenSharing: true }, moderator: true, role: "host" };
  }
  const presenter = input.presenters.find((entry) => entry.userId === input.userId);
  const validUntil = input.validUntilByUser?.get(input.userId) ?? null;
  const stillValid = !validUntil || new Date(validUntil).getTime() > input.nowMs;
  if (presenter && stillValid && presenter.role === "co_host") {
    return { features: { recording: false, screenSharing: true }, moderator: true, role: "co_host" };
  }
  if (presenter && stillValid && presenter.role === "team") {
    return { features: { recording: false, screenSharing: false }, moderator: presenter.canModerateRoom, role: "team" };
  }
  if (input.staff) {
    return { features: { recording: false, screenSharing: false }, moderator: false, role: "team" };
  }
  return { features: { recording: false, screenSharing: false }, moderator: false, role: "student" };
}

/** O nome da sala, gerado ao publicar e guardado em webinar_sessions.room_name; nunca vai na URL do aluno. */
export function newRoomName(webinarId: string, random: (size: number) => Buffer = (size) => randomBytes(size)): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = random(TOKEN_RULES.roomSuffixChars);
  let suffix = "";
  for (let index = 0; index < TOKEN_RULES.roomSuffixChars; index += 1) {
    suffix += alphabet[bytes[index % bytes.length] % alphabet.length];
  }
  return `w-${webinarId}-${suffix}`;
}

export function isRoomName(value: unknown): value is string {
  return typeof value === "string" && /^w-[0-9a-f-]{36}-[a-z2-9]{16}$/.test(value);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export type JitsiTokenInput = {
  appId: string;
  /** O hostname do Jitsi proprio (`meet.<dominio>`): vai em `sub`. */
  domain: string;
  /** O fim previsto da sessao, em ms; o token nao passa de 30 min depois dele. */
  endsAtMs: number;
  grant: RoomGrant;
  nowMs: number;
  room: string;
  secret: string;
  user: { avatarUrl?: string | null; id: string; name: string };
};

/** As claims do token (sem assinatura), para a rota e os testes verem o que vai ser assinado. */
export function jitsiTokenClaims(input: JitsiTokenInput): Record<string, unknown> {
  if (!isRoomName(input.room)) {
    throw new Error("Sala inválida para o token.");
  }
  const now = Math.floor(input.nowMs / 1000);
  const byEnd = Math.floor(input.endsAtMs / 1000) + TOKEN_RULES.afterEndSeconds;
  const byLifetime = now + TOKEN_RULES.maxLifetimeSeconds;
  const exp = Math.max(now + 60, Math.min(byEnd, byLifetime));
  const user: Record<string, unknown> = { id: input.user.id, name: input.user.name.slice(0, 80) };
  if (input.user.avatarUrl) {
    user.avatar = input.user.avatarUrl;
  }
  if (input.grant.moderator) {
    user.moderator = true;
    user.affiliation = "owner";
  }
  // Todo papel leva as features (o aluno tambem): sem a claim, o Jitsi da tag fixada deixa compartilhar a tela e gravar.
  const context: Record<string, unknown> = {
    features: {
      livestreaming: false,
      "outbound-call": false,
      recording: input.grant.features.recording,
      "screen-sharing": input.grant.features.screenSharing
    },
    user
  };
  return {
    aud: input.appId,
    context,
    exp,
    iat: now,
    iss: input.appId,
    nbf: now - TOKEN_RULES.notBeforeSkewSeconds,
    room: input.room,
    sub: input.domain
  };
}

/** O JWT HS256 pronto para o iframe. */
export function signJitsiToken(input: JitsiTokenInput): string {
  if (!input.secret || input.secret.length < 32) {
    throw new Error("Segredo do token da sala inválido.");
  }
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(jitsiTokenClaims(input)));
  const signature = base64url(createHmac("sha256", input.secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

/** Le e confere um token (so para testes e para a conferencia manual): claims ou nulo. */
export function verifyJitsiToken(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const expected = base64url(createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest());
  const given = Buffer.from(parts[2]);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
