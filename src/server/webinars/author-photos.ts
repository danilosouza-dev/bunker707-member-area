// A foto do perfil de quem escreve na sala (docs/30 §8.5; decisao do produtor de 10/11/2026): para cada autor, a foto
// (profiles.avatar_url, so https) e se o aceite do chat esta em dia (webinar_chat_consents na versao de agora, sem
// revogacao e com o modo de agora: um aceite antigo com apelido ou anonimo nao vale, D64). Quem decide se a foto aparece e a regra pura room-model.authorPhotoUrl; aqui so a leitura.
//
// A sala relê o chat a cada 5 s e o console a cada 5 s com a sessao inteira: a leitura fica guardada por pessoa durante
// 60 s neste processo, entao uma sala cheia nao vira uma consulta a `profiles` por pedido. O que muda no meio (a foto
// nova, o aceite) aparece em ate 1 min; o que protege quem quer sair nao depende desta memoria: retirar o aceite apaga
// as mensagens na hora, e o que foi escrito como anonimo (legado: linhas de antes de 10/11/2026) nunca leva foto (a
// regra olha o nome gravado na mensagem).

import "server-only";

import { sanitizeProfileAvatarUrl } from "../member-area/student-pages-model";
import { assertNoDbError, type WebinarsDb } from "./db";
import { chatConsentIsCurrent } from "./model";
import type { AuthorPhoto } from "./room-model";

/** Quanto a leitura de uma pessoa vale neste processo. */
export const AUTHOR_PHOTO_TTL_MS = 60_000;
/** Teto da memoria: passou disso, ela e esvaziada (uma live grande tem centenas de autores, nunca dezenas de milhares). */
const CACHE_MAX = 5_000;
const CHUNK = 200;

type Entry = AuthorPhoto & { at: number };

const cache = new Map<string, Entry>();

/** Esvazia a memoria (os testes). */
export function clearAuthorPhotoCache() {
  cache.clear();
}

/** Esquece uma pessoa (ela acabou de aceitar ou de retirar o aceite): a proxima leitura vai ao banco. */
export function forgetAuthorPhoto(userId: string) {
  cache.delete(userId);
}

type ProfileRow = { avatar_url: string | null; id: string };
type ConsentFlagRow = { consent_version: number; display_mode: string | null; revoked_at: string | null; user_id: string };

/**
 * A foto e o aceite de cada autor (os ids repetidos e os nulos saem). Nunca lanca: a foto e um detalhe, e na falha da
 * leitura a sala segue com as iniciais (o erro vai para o log).
 */
export async function loadAuthorPhotos(db: WebinarsDb, userIds: readonly (string | null | undefined)[], nowMs: number = Date.now()): Promise<Map<string, AuthorPhoto>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  const found = new Map<string, AuthorPhoto>();
  const missing: string[] = [];

  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && nowMs - hit.at < AUTHOR_PHOTO_TTL_MS) {
      found.set(id, { avatarUrl: hit.avatarUrl, consentCurrent: hit.consentCurrent });
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) {
    return found;
  }

  try {
    const avatars = new Map<string, string | null>();
    const consented = new Set<string>();

    for (let start = 0; start < missing.length; start += CHUNK) {
      const chunk = missing.slice(start, start + CHUNK);
      const [profiles, consents] = await Promise.all([
        db.from("profiles").select("id, avatar_url").in("id", chunk),
        db.from("webinar_chat_consents").select("user_id, consent_version, display_mode, revoked_at").in("user_id", chunk)
      ]);
      assertNoDbError(profiles.error, "Webinarios: fotos de quem escreve");
      assertNoDbError(consents.error, "Webinarios: aceite de quem escreve");
      for (const row of (profiles.data ?? []) as ProfileRow[]) {
        avatars.set(row.id, sanitizeProfileAvatarUrl(row.avatar_url));
      }
      for (const row of (consents.data ?? []) as ConsentFlagRow[]) {
        if (chatConsentIsCurrent(row)) {
          consented.add(row.user_id);
        }
      }
    }

    if (cache.size + missing.length > CACHE_MAX) {
      cache.clear();
    }
    for (const id of missing) {
      const entry: Entry = { at: nowMs, avatarUrl: avatars.get(id) ?? null, consentCurrent: consented.has(id) };
      cache.set(id, entry);
      found.set(id, { avatarUrl: entry.avatarUrl, consentCurrent: entry.consentCurrent });
    }
  } catch (error) {
    console.error(`[webinarios] fotos de quem escreve nao lidas: ${error instanceof Error ? error.message : String(error)}`);
  }

  return found;
}

/** A foto do proprio perfil (o campo de escrever da sala e do console), ou nulo. Nunca lanca. */
export async function loadOwnPhoto(db: WebinarsDb, userId: string, nowMs: number = Date.now()): Promise<string | null> {
  return (await loadAuthorPhotos(db, [userId], nowMs)).get(userId)?.avatarUrl ?? null;
}
