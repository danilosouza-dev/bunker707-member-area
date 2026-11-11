// A foto de quem comenta e o roteiro na Live ao vivo, a parte pura (adendo de 10/11/2026, R8 e R9; docs/30 §2.7 e
// docs/31 §5.2). "Quem comenta" e o nome da tela para as pessoas dos comentarios prontos do roteiro (o nome interno
// continua `persona`): o Nome, a Foto (opcional) e o papel (Aparece como: Aluno ou Equipe).
//
// - A foto: so o caminho webinars/personas/<24 hex>.webp no bucket content-assets (o mesmo envio da imagem do banner da
//   Na tela, screen-actions.ts, com a pasta e os limites proprios: ate 512 px de lado, 100.000 bytes, sem animacao); o
//   endereco e montado aqui pela origem conferida do nosso Supabase (screenStorageOriginOf), nunca um endereco de fora.
//   A mensagem `scripted` guarda a copia do caminho (webinar_chat_messages.persona_avatar_path): o que a turma viu nao
//   muda quando a equipe troca a foto do item depois.
// - "Usar esta foto em todos os comentários de {nome}" (ligada por padrao): a mesma foto nos outros itens com o mesmo
//   nome no webinario, pelo nome sem espacos nas pontas e sem diferenca de caixa (samePersonaName).
// - O roteiro na Live ao vivo (R8): o zero e o started_at (o "Começar para todos"); o tick solta os itens "Num minuto da
//   live" que venceram e ainda nao entraram (liveScriptDue), no maximo 5 min atrasados (o tick que ficou fora do ar);
//   o que passou disso fica para o "Soltar agora". "Quando o apresentador diz" nao existe na live (sem transcricao
//   durante a transmissao).
//
// Sem "server-only", imports relativos: tests/webinarios-roteiro-ao-vivo.test.mjs carrega direto pelo Node.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { toTime, type ScriptItem, type ScriptTrigger, type WebinarKind } from "./model";
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

/** Os dois nomes sao da mesma pessoa que comenta (o "Usar esta foto em todos os comentários de {nome}"). */
export function samePersonaName(a: string, b: string): boolean {
  const key = personaNameKey(a);
  return key.length > 0 && key === personaNameKey(b);
}

/**
 * A foto aplicada aos itens com o mesmo nome (o "Usar esta foto em todos os comentários de {nome}" do card Roteiro):
 * cada item com o nome recebe `path` (nulo tira a foto); os outros ficam como estao.
 */
export function withPersonaAvatarForName<T extends { personaAvatarPath?: string | null; personaName: string }>(items: readonly T[], name: string, path: string | null): T[] {
  return items.map((item) => (samePersonaName(item.personaName, name) ? { ...item, personaAvatarPath: path } : item));
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
