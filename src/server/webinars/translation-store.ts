// A traducao do chat e do roteiro no banco (docs/30 §1.6; migracao 202610290009), pela service role: o idioma do chat
// escolhido pelo aluno (webinar_viewer_prefs) e as traducoes guardadas por texto e idioma (webinar_text_translations,
// chave = translationSourceHash do texto). Quem decide o que traduzir, chama o provedor (o gateway de IA, atras de um
// adaptador com duble nos testes) e devolve para a sala e a frente da traducao (translation-model.ts /
// translation.ts); aqui so o acesso as linhas. Banco sem a 202610290009: PendingMigrationError
// (WEBINARS_TRANSLATION_MIGRATION); a sala trata como "sem traducao" e mostra o chat como foi escrito.

import "server-only";

import { assertNoDbError, type WebinarsDb } from "./db";
import type { ChatLanguage, SourceLanguage, TextTranslation, ViewerPrefs } from "./model";
import { TEXT_TRANSLATION_COLUMNS, VIEWER_PREFS_COLUMNS, textTranslationFromRow, viewerPrefsFromRow, type TextTranslationRow, type ViewerPrefsRow } from "./rows";

export async function fetchViewerPrefs(db: WebinarsDb, userId: string): Promise<ViewerPrefs> {
  const { data, error } = await db.from("webinar_viewer_prefs").select(VIEWER_PREFS_COLUMNS).eq("user_id", userId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler idioma do chat");
  const row = (data as ViewerPrefsRow | null) ?? null;
  return row ? viewerPrefsFromRow(row) : { chatLanguage: null, userId };
}

/** O idioma do chat das lives do aluno; nulo = como foi escrito. */
export async function saveViewerPrefs(db: WebinarsDb, input: { chatLanguage: ChatLanguage | null; userId: string }): Promise<ViewerPrefs> {
  const { data, error } = await db
    .from("webinar_viewer_prefs")
    .upsert({ chat_language: input.chatLanguage, user_id: input.userId }, { onConflict: "user_id" })
    .select(VIEWER_PREFS_COLUMNS)
    .single();
  assertNoDbError(error, "Webinarios: gravar idioma do chat");
  return viewerPrefsFromRow(data as ViewerPrefsRow);
}

/** As traducoes guardadas de varios textos num idioma (a sala pede as das mensagens que esta mostrando). */
export async function fetchTranslations(db: WebinarsDb, input: { hashes: readonly string[]; language: ChatLanguage }): Promise<Map<string, TextTranslation>> {
  const result = new Map<string, TextTranslation>();
  const hashes = [...new Set(input.hashes)];
  if (hashes.length === 0) {
    return result;
  }
  const { data, error } = await db.from("webinar_text_translations").select(TEXT_TRANSLATION_COLUMNS).eq("language", input.language).in("source_hash", hashes);
  assertNoDbError(error, "Webinarios: ler traducoes");
  for (const row of (data ?? []) as TextTranslationRow[]) {
    result.set(row.source_hash, textTranslationFromRow(row));
  }
  return result;
}

export type TranslationInsert = { body: string; language: ChatLanguage; provider: string; sourceHash: string; sourceLanguage: SourceLanguage | null };

/** Guarda as traducoes feitas (uma vez por texto e idioma: a repetida fica com a primeira). */
export async function insertTranslations(db: WebinarsDb, rows: readonly TranslationInsert[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const { data, error } = await db
    .from("webinar_text_translations")
    .upsert(
      rows.map((row) => ({ body: row.body, language: row.language, provider: row.provider, source_hash: row.sourceHash, source_language: row.sourceLanguage })),
      { ignoreDuplicates: true, onConflict: "source_hash,language" }
    )
    .select("source_hash");
  assertNoDbError(error, "Webinarios: gravar traducoes");
  return ((data ?? []) as { source_hash: string }[]).length;
}

/**
 * Apaga as traducoes guardadas de um texto (todos os idiomas), pela chave: a equipe refaz a traducao de uma mensagem
 * ou do roteiro que saiu errada (a primeira guardada vale para sempre; docs/30 §1.6). Devolve quantas linhas sairam.
 */
export async function deleteTranslationsByHash(db: WebinarsDb, sourceHash: string): Promise<number> {
  const { data, error } = await db.from("webinar_text_translations").delete().eq("source_hash", sourceHash).select("source_hash");
  assertNoDbError(error, "Webinarios: apagar traducoes do texto");
  return ((data ?? []) as unknown[]).length;
}
