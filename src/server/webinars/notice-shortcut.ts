// Avisar › Aviso no sino e Pop-up (docs/30 §2.2; docs/28 D5): a leitura do servidor por tras de
// /admin/comunicacao/avisos/novo?webinario=<id>&tipo=. Le o webinario SALVO (linha e sessoes) pela service role e monta o
// aviso novo com webinarNoticeStart (notice-shortcut-model.ts); nada e gravado. Quem chama (a pagina do "Novo aviso")
// ja conferiu messaging.write, a mesma permissao do editor do aviso.

import "server-only";

import type { AudienceDefinition } from "@/server/communications/audience-model";
import type { CampaignKind } from "@/server/communications/campaign-model";
import type { NoticeStart } from "@/server/communications/template-model";
import { webinarsDb, type WebinarsDb } from "./db";
import { webinarSituation } from "./model";
import { webinarNoticeStart } from "./notice-shortcut-model";
import { sessionFromRow, webinarFromRow } from "./rows";
import { fetchWebinarRow, listSessionRows } from "./store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WebinarNoticeStartLoad =
  | { audiences: AudienceDefinition[]; ok: true; start: NoticeStart }
  /** missing = id invalido, inexistente ou excluido; blocked = o atalho estaria desligado (o motivo esta no card). */
  | { ok: false; reason: "blocked" | "missing" };

/** `db` so nos testes (o banco falso); na pagina, a service role. */
export async function prepareWebinarNoticeStart(webinarId: string, kind: CampaignKind, now = Date.now(), injected?: WebinarsDb): Promise<WebinarNoticeStartLoad> {
  if (!UUID.test(webinarId)) {
    return { ok: false, reason: "missing" };
  }

  const db = injected ?? webinarsDb();
  const row = await fetchWebinarRow(db, webinarId);

  if (!row) {
    return { ok: false, reason: "missing" };
  }

  const webinar = webinarFromRow(row);
  const sessions = (await listSessionRows(db, [row.id])).map(sessionFromRow);
  const built = webinarNoticeStart({ ...webinar, sessions, situation: webinarSituation(webinar, sessions, now) }, kind, now);

  // As regras do segmento ganham nome nas opcoes do editor (loadNoticeEditorOptions({ audiences })).
  return built.ok ? { audiences: [built.start.draft.audience], ok: true, start: built.start } : { ok: false, reason: "blocked" };
}
