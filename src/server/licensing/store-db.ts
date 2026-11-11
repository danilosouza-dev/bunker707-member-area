import "server-only";

// O adaptador do Supabase para a tabela license_state (migracoes 202611100002 e 202611110001; regras em store.ts). Uma linha so
// (id = 1), lida e gravada pelo cliente com a service role: anon e authenticated nao tem nenhum privilegio nela.
//
// - Data guardada que nao e data para o JavaScript (o `infinity` do Postgres, ano fora do alcance) volta como
//   Invalid Date, nunca como null: as regras a tratam como invalida (nunca libera nada), e null quer dizer "nunca".
// - Gravar Invalid Date e erro de programa: lanca, em vez de gravar null no lugar.
// - Toda gravacao confere a versao lida e soma 1 (update ... where version = lida); a criacao da linha que perde
//   para outra (23505) devolve null, como a versao que mudou.
// - O segredo da Instalacao sai do banco so por aqui. Nenhuma mensagem de erro leva os valores da linha: so a
//   mensagem do banco, sem o `details` do Postgres (que repetiria a linha inteira).

import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "../db/pending-migration";
import type { LicenseStateDb, LicenseStatePatch, LicenseStateRecord } from "./store";

export const LICENSE_STATE_TABLE = "license_state";
/** A migracao mais nova que o adaptador precisa (o endereco dos pedidos do dono e dos administradores). */
export const LICENSE_STATE_MIGRATION = "202611110001";
const ROW_ID = 1;

const COLUMNS =
  "token, ever_activated, unreadable_since, last_seen_at, last_check_in_emissor_at, last_check_in_local_at, host_mismatch_since, request_host, request_host_since, newest_issued_at, installation_id, installation_secret, check_in_sequence, check_in_attempted_at, check_in_result, check_in_requested_at, version";

type LicenseStateRow = {
  token: string | null;
  ever_activated: boolean;
  unreadable_since: string | null;
  last_seen_at: string | null;
  last_check_in_emissor_at: string | null;
  last_check_in_local_at: string | null;
  host_mismatch_since: string | null;
  request_host: string | null;
  request_host_since: string | null;
  newest_issued_at: string | null;
  installation_id: string | null;
  installation_secret: string | null;
  check_in_sequence: string | null;
  check_in_attempted_at: string | null;
  check_in_result: string | null;
  check_in_requested_at: string | null;
  version: number;
};

/** null fica null; qualquer outro valor vira Date, invalida quando nao e uma data (nunca null). */
function dateOf(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  return new Date(typeof value === "string" ? value : Number.NaN);
}

function isoOf(value: Date | null | undefined, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`license_state: data invalida para gravar em ${field}.`);
  }

  return value.toISOString();
}

export function licenseRecordOfRow(row: LicenseStateRow): LicenseStateRecord {
  const emissorTime = dateOf(row.last_check_in_emissor_at);
  const localTime = dateOf(row.last_check_in_local_at);

  return {
    token: row.token,
    everActivated: row.ever_activated === true,
    unreadableSince: dateOf(row.unreadable_since),
    lastSeenAt: dateOf(row.last_seen_at),
    lastCheckIn: emissorTime && localTime ? { emissorTime, localTime } : null,
    hostMismatchSince: dateOf(row.host_mismatch_since),
    requestHost: row.request_host && row.request_host_since !== null ? { host: row.request_host, since: dateOf(row.request_host_since) as Date } : null,
    newestIssuedAt: dateOf(row.newest_issued_at),
    installationId: row.installation_id,
    installationSecret: row.installation_secret,
    checkInSequence: row.check_in_sequence,
    checkInAttemptedAt: dateOf(row.check_in_attempted_at),
    checkInResult: row.check_in_result,
    checkInRequestedAt: dateOf(row.check_in_requested_at),
    version: Number(row.version)
  };
}

/** So as colunas que o patch traz. */
export function licenseColumnsOfPatch(patch: LicenseStatePatch): Record<string, string | boolean | null> {
  const columns: Record<string, string | boolean | null> = {};

  if ("token" in patch) columns.token = patch.token ?? null;
  if ("everActivated" in patch) columns.ever_activated = patch.everActivated === true;
  if ("unreadableSince" in patch) columns.unreadable_since = isoOf(patch.unreadableSince, "unreadable_since");
  if ("lastSeenAt" in patch) columns.last_seen_at = isoOf(patch.lastSeenAt, "last_seen_at");
  if ("lastCheckIn" in patch) {
    columns.last_check_in_emissor_at = isoOf(patch.lastCheckIn?.emissorTime, "last_check_in_emissor_at");
    columns.last_check_in_local_at = isoOf(patch.lastCheckIn?.localTime, "last_check_in_local_at");
  }
  if ("hostMismatchSince" in patch) columns.host_mismatch_since = isoOf(patch.hostMismatchSince, "host_mismatch_since");
  if ("requestHost" in patch) {
    // O endereco e o "desde quando" andam juntos (o check license_state_request_host_pair).
    columns.request_host = patch.requestHost?.host ?? null;
    columns.request_host_since = isoOf(patch.requestHost?.since, "request_host_since");
  }
  if ("newestIssuedAt" in patch) columns.newest_issued_at = isoOf(patch.newestIssuedAt, "newest_issued_at");
  if ("installationId" in patch) columns.installation_id = patch.installationId ?? null;
  if ("installationSecret" in patch) columns.installation_secret = patch.installationSecret ?? null;
  if ("checkInSequence" in patch) columns.check_in_sequence = patch.checkInSequence ?? null;
  if ("checkInAttemptedAt" in patch) columns.check_in_attempted_at = isoOf(patch.checkInAttemptedAt, "check_in_attempted_at");
  if ("checkInResult" in patch) columns.check_in_result = patch.checkInResult ?? null;
  if ("checkInRequestedAt" in patch) columns.check_in_requested_at = isoOf(patch.checkInRequestedAt, "check_in_requested_at");

  return columns;
}

export function licenseStateDbOf(supabase: SupabaseClient): LicenseStateDb {
  return {
    async read() {
      const { data, error } = await supabase.from(LICENSE_STATE_TABLE).select(COLUMNS).eq("id", ROW_ID).maybeSingle();

      if (error) {
        throw toDbError(error, "Lendo a licenca guardada (license_state)");
      }

      return data ? licenseRecordOfRow(data as LicenseStateRow) : null;
    },

    async write(patch, expectedVersion) {
      const columns = licenseColumnsOfPatch(patch);

      if (expectedVersion === null) {
        const { data, error } = await supabase
          .from(LICENSE_STATE_TABLE)
          .insert({ ...columns, id: ROW_ID, version: 1 })
          .select(COLUMNS)
          .maybeSingle();

        if (error?.code === "23505") {
          return null;
        }

        if (error) {
          throw toDbError(error, "Criando a linha da licenca guardada (license_state)");
        }

        return data ? licenseRecordOfRow(data as LicenseStateRow) : null;
      }

      const { data, error } = await supabase
        .from(LICENSE_STATE_TABLE)
        .update({ ...columns, version: expectedVersion + 1 })
        .eq("id", ROW_ID)
        .eq("version", expectedVersion)
        .select(COLUMNS);

      if (error) {
        throw toDbError(error, "Gravando a licenca guardada (license_state)");
      }

      const rows = (data ?? []) as LicenseStateRow[];
      return rows.length === 1 ? licenseRecordOfRow(rows[0]) : null;
    }
  };
}
