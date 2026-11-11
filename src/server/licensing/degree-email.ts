import "server-only";

// Liga os e-mails de degrau (degree-notice.ts) ao banco: as contas da equipe com papel de dono ou de administrador
// (admin_roles e o e-mail de profiles) e a fila email_outbox (enqueueEmail, idempotente pela chave). Chamado pela tarefa
// do tick (src/server/jobs/license-check-in-job.ts) so no modo "enforce", depois da rodada. A memoria do ultimo degrau
// avisado fica no processo: a fila so e tocada quando o degrau muda (ou quando o processo reinicia, e a chave segura).

import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueEmail } from "@/server/email/outbox";
import { isLicenseManagerRow } from "./admin-access";
import { notifyLicenseDegree, type LicenseNoticeMemory, type LicenseNoticeRecipient, type LicenseNoticeResult } from "./degree-notice";
import type { LicenseState } from "./state";

const memory: LicenseNoticeMemory = { lastMarker: null, sentAt: {} };

/** Equipe pequena; o teto so protege de uma tabela inesperadamente grande (o mesmo da tela Equipe). */
const TEAM_LIMIT = 500;

type RoleRow = { permissions: unknown; role: unknown; user_id: string };
type ProfileRow = { email: string | null; id: string };

/** Os donos e administradores com e-mail. Sem a equipe legivel, lanca (a rodada seguinte tenta de novo). */
async function listLicenseManagers(db: SupabaseClient): Promise<LicenseNoticeRecipient[]> {
  const roles = await db.from("admin_roles").select("user_id, role, permissions").limit(TEAM_LIMIT);

  if (roles.error) {
    throw new Error(`Equipe da escola: ${roles.error.message}`);
  }

  const ids = ((roles.data ?? []) as RoleRow[]).filter((row) => isLicenseManagerRow(row.role, row.permissions)).map((row) => row.user_id);

  if (ids.length === 0) {
    return [];
  }

  const profiles = await db.from("profiles").select("id, email").in("id", ids);

  if (profiles.error) {
    throw new Error(`Perfis da equipe: ${profiles.error.message}`);
  }

  return ((profiles.data ?? []) as ProfileRow[]).flatMap((row) => (row.email?.trim() ? [{ email: row.email.trim(), userId: row.id }] : []));
}

/**
 * O e-mail da mudanca de degrau, se o degrau mudou desde o ultimo aviso deste processo. A memoria e a do processo; quem
 * testa passa a sua, para um teste nao herdar o intervalo minimo do anterior.
 */
export function notifyLicenseDegreeChange(
  db: SupabaseClient,
  state: LicenseState | null,
  configuredHost: string | null,
  notices: LicenseNoticeMemory = memory
): Promise<LicenseNoticeResult> {
  return notifyLicenseDegree({
    configuredHost,
    enqueue: async (email) => {
      await enqueueEmail(db, email);
    },
    listRecipients: () => listLicenseManagers(db),
    memory: notices,
    state
  });
}
