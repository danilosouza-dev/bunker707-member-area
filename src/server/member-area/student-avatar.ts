import "server-only";

// Foto do perfil do aluno: grava a imagem recortada no bucket publico content-assets
// (avatars/{id}/{hash}.webp, com a chave de servico, so no servidor) e o endereco na linha do proprio
// aluno em profiles (com a sessao dele: a RLS so deixa cada pessoa mudar a propria linha). Ao trocar
// ou remover, a foto antiga deste aluno e apagada do bucket. Comentarios novos passam a sair com a foto.

import { AVATAR_STORAGE_FOLDER } from "@/lib/avatar-image";
import { redactSecrets } from "@/lib/env-value";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { persistImageAsset } from "@/server/db/media-assets";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { avatarObjectPathFromUrl, decodeAvatarDataUrl, describeAvatarImageProblem } from "./student-avatar-model";

export class StudentAvatarError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "StudentAvatarError";
  }
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

async function removeOldAvatar(previousUrl: string | null, nextUrl: string | null, userId: string) {
  const objectPath = avatarObjectPathFromUrl(previousUrl, userId);

  if (!objectPath || previousUrl === nextUrl) {
    return;
  }

  try {
    await getSupabaseAdminClient().storage.from("content-assets").remove([objectPath]);
  } catch (error) {
    // Limpeza e cortesia: a foto nova ja esta gravada.
    console.error("[perfil] limpeza da foto antiga", redactSecrets(error instanceof Error ? error.message : String(error)));
  }
}

/** Grava a foto recortada (data URL WebP quadrado) e devolve o endereco publico. */
export async function saveStudentAvatar(userId: string, dataUrl: unknown): Promise<string> {
  const bytes = decodeAvatarDataUrl(dataUrl);
  const problem = describeAvatarImageProblem(bytes);

  if (problem) {
    throw new StudentAvatarError(problem);
  }

  const previousUrl = await readCurrentAvatarUrl(userId);
  const avatarUrl = await persistImageAsset(dataUrl as string, `${AVATAR_STORAGE_FOLDER}/${userId}`);

  if (!/^https:\/\//.test(avatarUrl)) {
    throw new Error("Upload da foto nao devolveu um endereco publico.");
  }

  await writeAvatarUrl(userId, avatarUrl);
  await removeOldAvatar(previousUrl, avatarUrl, userId);

  return avatarUrl;
}

/** Tira a foto do perfil (volta para as iniciais). */
export async function removeStudentAvatar(userId: string): Promise<void> {
  const previousUrl = await readCurrentAvatarUrl(userId);

  await writeAvatarUrl(userId, null);
  await removeOldAvatar(previousUrl, null, userId);
}
