"use server";

// Importar playlist do YouTube (docs/17 §1.6.7, aba Playlist). Reaproveita a leitura da playlist e a
// RPC transacional do fluxo atual, sem devolver o banco inteiro (importYouTubePlaylistCourse).
// Aqui so se cria curso novo: playlist que ja virou curso e recusada (o admin antigo segue podendo
// sincronizar, e a RPC preserva situacao, capa e o que o produtor excluiu ou deixou em rascunho).

import type { ActionResult } from "@/lib/action-result";
import { extractYouTubePlaylistId } from "@/lib/youtube-course-import";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateCatalog } from "@/server/catalog/cache";
import { importYouTubePlaylistCourse, loadYouTubeCourseImportPreview } from "@/server/video/youtube-playlist-import";
import { CatalogConflictError, CatalogFieldError, CatalogRuleError } from "./errors";
import { productHrefFor } from "./mappers";
import { playlistAlreadyImportedMessage } from "./model";
import { importPlaylistSchema, previewPlaylistSchema } from "./schemas";
import { catalogDb, failOnError } from "./store";
import type {
  ImportedPlaylistCourse,
  ImportPlaylistActionInput,
  PlaylistImported,
  PlaylistPreview,
  PreviewPlaylistInput
} from "./types";
import { checkProductImage, decodeWebpDataUrl } from "./webp";

const PLAYLIST_UNREADABLE = "Não conseguimos ler esta playlist. Confira se ela é pública e tente de novo.";

/** Erros de leitura do YouTube viram uma frase do produtor; erros com status proprio seguem como estao. */
function toPlaylistError(error: unknown) {
  if (error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number") {
    return error;
  }

  console.error("[catalog] Leitura da playlist:", error);

  return new CatalogRuleError(PLAYLIST_UNREADABLE);
}

/** Curso que ja nasceu desta playlist (youtube_course_imports), ou null. */
async function findImportedCourse(playlistUrl: string): Promise<ImportedPlaylistCourse | null> {
  const playlistId = extractYouTubePlaylistId(playlistUrl);

  if (!playlistId) {
    return null;
  }

  const db = catalogDb();
  const { data, error } = await db.from("youtube_course_imports").select("course_id").eq("playlist_id", playlistId).maybeSingle();
  failOnError(error, "Playlist ja importada");

  const courseId = (data as { course_id?: string } | null)?.course_id;

  if (!courseId) {
    return null;
  }

  const { data: course, error: courseError } = await db.from("content_items").select("id,title").eq("id", courseId).maybeSingle();
  failOnError(courseError, "Curso da playlist");

  const row = course as { id: string; title: string | null } | null;

  return row ? { href: productHrefFor(row.id), id: row.id, title: row.title?.trim() || "Sem nome" } : null;
}

/** [catalog.write] "Ler playlist". Avisa quando a playlist ja virou um curso (a tela bloqueia importar). */
export async function previewPlaylist(input: PreviewPlaylistInput): Promise<ActionResult<PlaylistPreview>> {
  return runAdminAction("catalog.write", previewPlaylistSchema, input, async ({ input: data }) => {
    const existingCourse = await findImportedCourse(data.playlistUrl);

    try {
      return { ...(await loadYouTubeCourseImportPreview(data.playlistUrl)), existingCourse };
    } catch (error) {
      throw toPlaylistError(error);
    }
  });
}

/**
 * [catalog.write] "Importar como rascunho". Aceita `audience` (Quem pode ver) alem do `accessModel` do
 * contrato legado: "Oculto por enquanto" grava listing = 'hidden' depois da importacao.
 */
export async function importPlaylist(input: ImportPlaylistActionInput): Promise<ActionResult<PlaylistImported>> {
  return runAdminAction("catalog.write", importPlaylistSchema, input, async ({ input: data }) => {
    // Reimportar regravaria o curso existente por cima do que o produtor fez nele: recusa (409).
    const existingCourse = await findImportedCourse(data.playlistUrl);

    if (existingCourse) {
      throw new CatalogConflictError(playlistAlreadyImportedMessage(existingCourse.title));
    }

    if (data.image.startsWith("data:")) {
      const check = checkProductImage("cover", decodeWebpDataUrl(data.image));

      if (!check.ok) {
        throw new CatalogFieldError("image", check.message);
      }
    }

    const accessModel = data.audience ? (data.audience === "all_students" ? "free" : "closed") : data.accessModel;
    let imported: Awaited<ReturnType<typeof importYouTubePlaylistCourse>>;

    try {
      imported = await importYouTubePlaylistCourse({
        accessModel,
        coursePresentationMode: data.coursePresentationMode,
        description: data.description,
        image: data.image,
        moduleRanges: data.moduleRanges,
        organizationMode: data.organizationMode,
        playlistUrl: data.playlistUrl,
        title: data.title
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Nao foi possivel gravar o curso importado.") {
        throw error;
      }

      throw toPlaylistError(error);
    }

    const courseId = imported.importResult.courseId;

    if (data.audience) {
      const { error } = await catalogDb()
        .from("content_items")
        .update({ listing: data.audience === "hidden" ? "hidden" : "listed" })
        .eq("id", courseId);
      failOnError(error, "Quem pode ver do curso importado");
    }

    invalidateCatalog({ from: "action" });

    return {
      courseId,
      href: productHrefFor(courseId),
      lessonCount: Number(imported.importResult.lessonCount ?? 0),
      moduleCount: Number(imported.importResult.moduleCount ?? 0),
      warnings: imported.warnings
    };
  });
}
