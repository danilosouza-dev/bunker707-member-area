import { z } from "zod";

// Link direto de arquivo de video (https, terminando em .mp4, .webm ou .mov antes de ? ou #), usado pelo
// Destaque da home e pelo video de destaque do produto. Modulo puro (zod, sem "server-only"): os schemas
// do catalogo e os da area de membros importam daqui sem criar ciclo entre eles.

const VIDEO_FILE_EXTENSION = /\.(?:mp4|webm|mov)$/i;

/** Motivo para um link de video nao servir; null quando serve. */
export function describeVideoFileLinkProblem(raw: string): string | null {
  const value = raw.trim();

  if (!value) {
    return "Cole o link do vídeo.";
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return "Use um link que comece com https://.";
  }

  if (url.protocol !== "https:" || /\s/.test(value) || url.username || url.password) {
    return "Use um link que comece com https://.";
  }

  if (value.length > 2_048) {
    return "Link longo demais.";
  }

  return VIDEO_FILE_EXTENSION.test(url.pathname) ? null : "Use um link direto do arquivo de vídeo, terminado em .mp4, .webm ou .mov.";
}

/** Link direto de video valido (ver describeVideoFileLinkProblem). */
export const videoFileLinkSchema = z.string({ error: "Cole o link do vídeo." }).trim().superRefine((value, context) => {
  const problem = describeVideoFileLinkProblem(value);

  if (problem) {
    context.addIssue({ code: "custom", message: problem });
  }
});
