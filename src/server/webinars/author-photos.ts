// A foto do perfil de quem escreve na sala (docs/30 §8.5; D62 de 10/11/2026, mudado pelo D115 de 13/11/2026): para cada
// autor, a foto (profiles.avatar_url, so o arquivo enviado pelo Perfil, remontado pela origem do nosso Supabase em
// roomPhotoUrl). Desde o D115 a foto nao depende do aceite do chat, entao o aceite nao e mais lido aqui. Quem decide se
// a foto aparece e a regra pura room-model.authorPhotoUrl; aqui so a leitura.
//
// A sala relê o chat a cada 5 s e o console a cada 5 s com a sessao inteira: a leitura fica guardada por pessoa durante
// 60 s neste processo, entao uma sala cheia nao vira uma consulta a `profiles` por pedido. A foto nova aparece em ate
// 1 min; o que foi escrito como anonimo (legado: linhas de antes de 10/11/2026) nunca leva foto (a regra olha o nome
// gravado na mensagem).

import "server-only";

import { cleanEnvValue } from "../../lib/env-value";
import { ownAvatarPublicUrl } from "../member-area/student-avatar-model";
import { assertNoDbError, type WebinarsDb } from "./db";
import type { AuthorPhoto } from "./room-model";

/** Quanto a leitura de uma pessoa vale neste processo. */
export const AUTHOR_PHOTO_TTL_MS = 60_000;
/** Teto da memoria: passou disso, ela e esvaziada (uma live grande tem centenas de autores, nunca dezenas de milhares). */
const CACHE_MAX = 5_000;
const CHUNK = 200;

type Entry = AuthorPhoto & { at: number };

/**
 * A foto do perfil como a sala e o console mostram: so o arquivo que o aluno enviou pelo Perfil
 * (avatars/{id}/arquivo no bucket content-assets), com o endereco montado pela origem do nosso Supabase. Um endereco
 * gravado direto no perfil (outro site, a foto do Google) vira null: nenhum navegador da sala busca imagem fora.
 */
export function roomPhotoUrl(userId: string, stored: string | null | undefined): string | null {
  return ownAvatarPublicUrl(stored, userId, cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? cleanEnvValue(process.env.SUPABASE_URL));
}

const cache = new Map<string, Entry>();

/** Esvazia a memoria (os testes). */
export function clearAuthorPhotoCache() {
  cache.clear();
}

/** Esquece uma pessoa (ela acabou de mexer no aceite do chat): a proxima leitura vai ao banco. */
export function forgetAuthorPhoto(userId: string) {
  cache.delete(userId);
}

type ProfileRow = { avatar_url: string | null; id: string };

/**
 * A foto de cada autor (os ids repetidos e os nulos saem). Nunca lanca: a foto e um detalhe, e na falha da leitura a
 * sala segue com as iniciais (o erro vai para o log).
 */
export async function loadAuthorPhotos(db: WebinarsDb, userIds: readonly (string | null | undefined)[], nowMs: number = Date.now()): Promise<Map<string, AuthorPhoto>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  const found = new Map<string, AuthorPhoto>();
  const missing: string[] = [];

  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && nowMs - hit.at < AUTHOR_PHOTO_TTL_MS) {
      found.set(id, { avatarUrl: hit.avatarUrl });
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) {
    return found;
  }

  try {
    const avatars = new Map<string, string | null>();

    for (let start = 0; start < missing.length; start += CHUNK) {
      const chunk = missing.slice(start, start + CHUNK);
      const profiles = await db.from("profiles").select("id, avatar_url").in("id", chunk);
      assertNoDbError(profiles.error, "Webinarios: fotos de quem escreve");
      for (const row of (profiles.data ?? []) as ProfileRow[]) {
        avatars.set(row.id, roomPhotoUrl(row.id, row.avatar_url));
      }
    }

    if (cache.size + missing.length > CACHE_MAX) {
      cache.clear();
    }
    for (const id of missing) {
      const entry: Entry = { at: nowMs, avatarUrl: avatars.get(id) ?? null };
      cache.set(id, entry);
      found.set(id, { avatarUrl: entry.avatarUrl });
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
