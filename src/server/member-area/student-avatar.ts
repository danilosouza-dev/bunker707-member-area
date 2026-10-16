import "server-only";

// Foto do perfil do aluno: grava a imagem recortada no bucket publico content-assets
// (avatars/{id}/{hash}.webp, .jpg ou .png, com a chave de servico, so no servidor) e o endereco na linha
// do proprio aluno em profiles (com a sessao dele: a RLS so deixa cada pessoa mudar a propria linha). Ao
// trocar ou remover, os comentarios do aluno passam a apontar para a foto nova e a antiga e apagada do
// bucket.

import { AVATAR_STORAGE_FOLDER } from "@/lib/avatar-image";
import { redactSecrets } from "@/lib/env-value";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { persistImageAsset } from "@/server/db/media-assets";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { avatarObjectPathFromUrl, decodeAvatarDataUrl, describeAvatarImageProblem, isPublicAvatarUrl } from "./student-avatar-model";

// Campo declarado (e nao "readonly" no parametro do construtor) para o Node carregar o arquivo nos
// testes de integracao so tirando os tipos, sem transformar codigo (docs/18 §2.5).
export class StudentAvatarError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "StudentAvatarError";
    this.status = status;
  }
}

function describeError(error: unknown) {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

async function readCurrentAvatarUrl(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();

  if (error) {
    throw new Error(`Leitura do perfil: ${redactSecrets(error.message)}`);
  }

  return (data as { avatar_url: string | null } | null)?.avatar_url ?? null;
}

async function writeAvatarUrl(userId: string, avatarUrl: string | null) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("id", userId).select("id");

  if (error) {
    throw new Error(`Gravacao do perfil: ${redactSecrets(error.message)}`);
  }

  if (!data || data.length === 0) {
    // Conta sem linha em profiles (criada antes do gatilho): cria a propria linha.
    const inserted = await supabase.from("profiles").insert({ avatar_url: avatarUrl, id: userId });

    if (inserted.error) {
      throw new Error(`Criacao do perfil: ${redactSecrets(inserted.error.message)}`);
    }
  }
}

/**
 * Cada comentario guarda a foto do autor na publicacao (lesson_comments.author_avatar_url). Ao trocar
 * ou remover, os comentarios deste aluno passam a apontar para a foto nova (ou nenhuma); senao ficariam
 * com um endereco apagado do bucket. Chave de servico porque a RLS nao abre a tabela para o aluno, e
 * so nas linhas deste autor. Falha aqui nao desfaz a troca: vai para o log.
 */
async function syncCommentAuthorAvatar(userId: string, avatarUrl: string | null) {
  try {
    const { error } = await getSupabaseAdminClient().from("lesson_comments").update({ author_avatar_url: avatarUrl }).eq("author_id", userId);

    if (error) {
      console.error("[perfil] foto nos comentarios", redactSecrets(error.message));
    }
  } catch (error) {
    console.error("[perfil] foto nos comentarios", describeError(error));
  }
}

async function removeOldAvatar(previousUrl: string | null, nextUrl: string | null, userId: string) {
  const objectPath = avatarObjectPathFromUrl(previousUrl, userId);

  if (!objectPath || previousUrl === nextUrl) {
    return;
  }

  // Limpeza e cortesia: a foto nova ja esta gravada, entao erro aqui so vai para o log.
  try {
    const { error } = await getSupabaseAdminClient().storage.from("content-assets").remove([objectPath]);

    if (error) {
      console.error("[perfil] limpeza da foto antiga", redactSecrets(error.message));
    }
  } catch (error) {
    console.error("[perfil] limpeza da foto antiga", describeError(error));
  }
}

/** Grava a foto recortada (data URL quadrado em WebP, JPEG ou PNG) e devolve o endereco publico. */
export async function saveStudentAvatar(userId: string, dataUrl: unknown): Promise<string> {
  const image = decodeAvatarDataUrl(dataUrl);
  const problem = describeAvatarImageProblem(image);

  if (problem) {
    throw new StudentAvatarError(problem);
  }

  const previousUrl = await readCurrentAvatarUrl(userId);
  // Extensao no bucket conforme o tipo do data URL (webp, jpg ou png).
  const avatarUrl = await persistImageAsset(dataUrl as string, `${AVATAR_STORAGE_FOLDER}/${userId}`);

  if (!isPublicAvatarUrl(avatarUrl)) {
    throw new Error("Upload da foto nao devolveu um endereco publico.");
  }

  await writeAvatarUrl(userId, avatarUrl);
  await syncCommentAuthorAvatar(userId, avatarUrl);
  await removeOldAvatar(previousUrl, avatarUrl, userId);

  return avatarUrl;
}

/** Tira a foto do perfil (volta para as iniciais, no Perfil, no menu e nos comentarios). */
export async function removeStudentAvatar(userId: string): Promise<void> {
  const previousUrl = await readCurrentAvatarUrl(userId);

  await writeAvatarUrl(userId, null);
  await syncCommentAuthorAvatar(userId, null);
  await removeOldAvatar(previousUrl, null, userId);
}
