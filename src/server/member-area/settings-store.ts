import "server-only";

// Leitura e gravacao de public.platform_settings (key/value jsonb, RLS fechado, so a chave de servico)
// para a Area de membros. Escrita sempre de UMA chave por vez (docs/13: nada de regravar o snapshot da
// plataforma) e com checagem de versao pela coluna updated_at:
// - quem le guarda `updatedAt`; quem grava manda esse valor de volta e o UPDATE so acontece se a
//   coluna continua igual (senao, 409 "mudou em outra tela");
// - `null` = a chave nao existia quando a tela abriu: a gravacao faz INSERT e falha com 409 se alguem
//   criou a linha antes.
// A tabela nao tem gatilho de updated_at: toda gravacao daqui carimba a coluna, e as gravacoes do
// platform-store (vitrine, marca, colecoes do legado) tambem carimbam desde esta rodada, entao uma
// mudanca feita no admin antigo tambem vira 409 aqui em vez de ser apagada em silencio.

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { MemberAreaConflictError } from "./errors";
import type { MemberAreaSettingKey } from "./schemas";

export type PlatformSettingSnapshot = {
  exists: boolean;
  /** Coluna updated_at (ISO) ou null quando a chave nao existe. */
  updatedAt: string | null;
  value: unknown;
};

type SettingRow = { key: string; updated_at: string | null; value: unknown };
type DbError = { code?: string; message: string } | null;

/** Postgres: violacao de chave unica (alguem criou a linha entre a leitura e a gravacao). */
const UNIQUE_VIOLATION = "23505";

const EMPTY_SNAPSHOT: PlatformSettingSnapshot = { exists: false, updatedAt: null, value: null };

function failOnError(error: DbError, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function toSnapshot(row: SettingRow | null | undefined): PlatformSettingSnapshot {
  if (!row) {
    return EMPTY_SNAPSHOT;
  }

  return { exists: true, updatedAt: row.updated_at ?? null, value: row.value ?? null };
}

/** Uma chave com a versao (updated_at). Chave ausente = { exists: false, updatedAt: null, value: null }. */
export async function readPlatformSetting(key: MemberAreaSettingKey): Promise<PlatformSettingSnapshot> {
  const { data, error } = await getSupabaseAdminClient()
    .from("platform_settings")
    .select("key,value,updated_at")
    .eq("key", key)
    .maybeSingle();
  failOnError(error, `Configuração ${key}`);

  return toSnapshot(data as SettingRow | null);
}

/** Varias chaves de uma vez (uma consulta). Toda chave pedida aparece no resultado. */
export async function readPlatformSettings<Key extends MemberAreaSettingKey>(
  keys: readonly Key[]
): Promise<Record<Key, PlatformSettingSnapshot>> {
  const result = Object.fromEntries(keys.map((key) => [key, EMPTY_SNAPSHOT])) as Record<Key, PlatformSettingSnapshot>;

  if (keys.length === 0) {
    return result;
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("platform_settings")
    .select("key,value,updated_at")
    .in("key", [...keys]);
  failOnError(error, "Configurações da área de membros");

  for (const row of (data ?? []) as SettingRow[]) {
    if ((keys as readonly string[]).includes(row.key)) {
      result[row.key as Key] = toSnapshot(row);
    }
  }

  return result;
}

/**
 * Grava UMA chave se ninguem mudou desde `expectedUpdatedAt` (null = a chave nao pode existir ainda).
 * Devolve a nova versao. Mudou no meio do caminho: MemberAreaConflictError (409).
 */
export async function writePlatformSettingGuarded(
  key: MemberAreaSettingKey,
  value: unknown,
  expectedUpdatedAt: string | null,
  now: Date = new Date()
): Promise<{ updatedAt: string }> {
  const db = getSupabaseAdminClient();
  const updatedAt = now.toISOString();

  if (expectedUpdatedAt === null) {
    const { data, error } = await db
      .from("platform_settings")
      .insert({ key, updated_at: updatedAt, value })
      .select("key,updated_at");

    if (error?.code === UNIQUE_VIOLATION) {
      throw new MemberAreaConflictError();
    }

    failOnError(error, `Salvando ${key}`);

    const inserted = (data ?? []) as Pick<SettingRow, "key" | "updated_at">[];

    return { updatedAt: inserted[0]?.updated_at ?? updatedAt };
  }

  const { data, error } = await db
    .from("platform_settings")
    .update({ updated_at: updatedAt, value })
    .eq("key", key)
    .eq("updated_at", expectedUpdatedAt)
    .select("key,updated_at");
  failOnError(error, `Salvando ${key}`);

  const rows = (data ?? []) as Pick<SettingRow, "key" | "updated_at">[];

  if (rows.length === 0) {
    // A linha mudou (outra versao) ou foi apagada depois da leitura: em ambos os casos a tela esta velha.
    throw new MemberAreaConflictError();
  }

  return { updatedAt: rows[0].updated_at ?? updatedAt };
}

/**
 * "Estado desejado" sobre UMA chave: rele o valor gravado agora, aplica `change` e grava com a versao
 * que acabou de ler (UPDATE condicional). Se alguem gravou no meio, rele e tenta mais uma vez; na
 * segunda, 409. Serve para quem muda so uma parte da chave sem apagar o resto que outra tela acabou de
 * publicar (ex.: a aparencia do admin antigo troca so a imagem do destaque, depois de enviar a imagem,
 * e preserva textos, botao e capa do video gravados pela tela Destaque nesse meio-tempo).
 * `change` pode lancar (validacao): nada e gravado.
 */
export async function updatePlatformSettingLatest<Value>(
  key: MemberAreaSettingKey,
  change: (current: PlatformSettingSnapshot) => Value,
  now: () => Date = () => new Date()
): Promise<{ updatedAt: string; value: Value }> {
  for (let attempt = 0; ; attempt += 1) {
    const current = await readPlatformSetting(key);
    const value = change(current);

    try {
      const saved = await writePlatformSettingGuarded(key, value, current.exists ? current.updatedAt : null, now());

      return { updatedAt: saved.updatedAt, value };
    } catch (error) {
      if (!(error instanceof MemberAreaConflictError) || attempt >= 1) {
        throw error;
      }
    }
  }
}

/**
 * Confere a versao sem gravar. A gravacao de verdade deve usar writePlatformSettingGuarded (confere e
 * grava no mesmo UPDATE); isto so serve para falhar cedo antes de um trabalho caro.
 */
export async function assertPlatformSettingVersion(key: MemberAreaSettingKey, expectedUpdatedAt: string | null) {
  const current = await readPlatformSetting(key);

  if (!isSameSettingVersion(current, expectedUpdatedAt)) {
    throw new MemberAreaConflictError();
  }

  return current;
}

/** Mesma versao? Compara o instante (o banco devolve "+00:00", o JavaScript grava "Z"). */
export function isSameSettingVersion(current: Pick<PlatformSettingSnapshot, "exists" | "updatedAt">, expectedUpdatedAt: string | null) {
  if (expectedUpdatedAt === null) {
    return !current.exists;
  }

  if (!current.exists || current.updatedAt === null) {
    return false;
  }

  if (current.updatedAt === expectedUpdatedAt) {
    return true;
  }

  const left = Date.parse(current.updatedAt);
  const right = Date.parse(expectedUpdatedAt);

  return Number.isFinite(left) && left === right;
}
