"use server";

// Server Actions do design do pop-up (docs/26): o envio do video direto ao Storage (endereco assinado + conferencia
// dos primeiros bytes) e a biblioteca de fontes (listar, renomear, excluir). O envio da fonte e a rota
// POST /api/admin/communications/popup-fonts (multipart: o arquivo passa do 1 MB das acoes).
// Todas pedem messaging.write (quem cria avisos). Auditoria so com ids, formato e tamanho (nunca nome nem texto).
// Renomear e excluir nao mudam o que o aluno ve: a familia bf_... e o arquivo continuam, e pop-up gravado
// resolve a fonte mesmo excluida (popup-fonts.loadPopupFontFaces), entao nao ha cache para invalidar.

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { assertNoDbError, communicationsDb, CommunicationError } from "./db";
import { mayRemoveRefusedVideo } from "./design-checks";
import { isMissingTemplatesTable } from "./media-cleanup";
import {
  POPUP_FONT_LIMITS,
  POPUP_VIDEO_BUCKET,
  POPUP_VIDEO_LIMITS,
  POPUP_VIDEO_MIME_TYPES,
  POPUP_VIDEO_PATH_PATTERN,
  type PopupFontOption,
  type PopupVideo,
  type PopupVideoUploadTicket
} from "./popup-design-model";
import { listPopupFontLibrary, POPUP_FONT_COLUMNS, type PopupFontRow } from "./popup-fonts";
import {
  cleanPopupFontName,
  fontRowToOption,
  inspectPopupVideo,
  newPopupVideoPath,
  POPUP_FONT_GONE_MESSAGE,
  POPUP_FONT_NAME_MESSAGE,
  POPUP_VIDEO_AGAIN_MESSAGE,
  POPUP_VIDEO_FORMAT_MESSAGE,
  POPUP_VIDEO_SIZE_MESSAGE
} from "./popup-media";
import { TEMPLATE_MESSAGES, TEMPLATES_TABLE } from "./template-model";

const startVideoSchema = z.object({
  mimeType: z.enum(POPUP_VIDEO_MIME_TYPES, { error: POPUP_VIDEO_FORMAT_MESSAGE }),
  sizeBytes: z
    .number({ error: POPUP_VIDEO_SIZE_MESSAGE })
    .int(POPUP_VIDEO_SIZE_MESSAGE)
    .min(1, POPUP_VIDEO_SIZE_MESSAGE)
    .max(POPUP_VIDEO_LIMITS.maxBytes, POPUP_VIDEO_SIZE_MESSAGE)
});

const finishVideoSchema = z.object({
  path: z.string({ error: POPUP_VIDEO_AGAIN_MESSAGE }).regex(POPUP_VIDEO_PATH_PATTERN, POPUP_VIDEO_AGAIN_MESSAGE)
});

const fontIdSchema = z.uuid({ error: POPUP_FONT_GONE_MESSAGE }).transform((id) => id.toLowerCase());

const renameFontSchema = z.object({
  id: fontIdSchema,
  name: z
    .string({ error: POPUP_FONT_NAME_MESSAGE })
    .transform(cleanPopupFontName)
    .pipe(z.string().min(1, POPUP_FONT_NAME_MESSAGE).max(POPUP_FONT_LIMITS.name, POPUP_FONT_NAME_MESSAGE))
});

const deleteFontSchema = z.object({ id: fontIdSchema });

const noInputSchema = z.undefined().or(z.object({}));

/** "Esta fonte está em uso em 1 pop-up. ..." / "... em N pop-ups. ..." */
function fontInUseMessage(count: number) {
  return count === 1
    ? "Esta fonte está em uso em 1 pop-up. Troque a fonte nele antes de excluir."
    : `Esta fonte está em uso em ${count} pop-ups. Troque a fonte neles antes de excluir.`;
}

/** [messaging.write] Endereco assinado para o navegador enviar o video (mp4 ou webm, ate 15 MB) ao bucket. */
export async function startPopupVideoUpload(input: { mimeType: string; sizeBytes: number }): Promise<ActionResult<PopupVideoUploadTicket>> {
  return runAdminAction("messaging.write", startVideoSchema, input, async ({ input: data }) => {
    const path = newPopupVideoPath(data.mimeType);
    const ticket = await communicationsDb().storage.from(POPUP_VIDEO_BUCKET).createSignedUploadUrl(path);

    if (ticket.error || !ticket.data) {
      throw new Error(`Comunicacao: endereco de envio do video nao criado: ${ticket.error?.message ?? "sem resposta"}`);
    }

    return { path, signedUrl: ticket.data.signedUrl, token: ticket.data.token };
  });
}

/**
 * [messaging.write] Confere o video enviado (tamanho e primeiros bytes) e devolve o PopupVideo. O invalido (413/422)
 * so e apagado quando e o envio novo de verdade (docs/28 D16): o objeto foi criado ha menos de 1 hora e nenhum
 * aviso ou modelo nao excluido cita o caminho (o de um "Tentar de novo" ou de uma chamada repetida pode ja estar num
 * modelo). O resto fica para a limpeza de 30 dias. E o unico lugar que pede para apagar o recusado.
 */
export async function finishPopupVideoUpload(input: { path: string }): Promise<ActionResult<PopupVideo>> {
  return runAdminAction("messaging.write", finishVideoSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const { sizeBytes, video } = await inspectPopupVideo(db, data.path, {
      removeRefused: ({ createdAt }) => mayRemoveRefusedVideo(db, data.path, createdAt, new Date())
    });

    await recordAudit(db, {
      action: "communication.video_uploaded",
      actorId: user.id,
      entityId: null,
      entityType: "campaign_media",
      metadata: { mime_type: video.mimeType, size_bytes: sizeBytes }
    });

    return video;
  });
}

/** [messaging.write] A biblioteca de fontes (nao excluidas, por nome). */
export async function listPopupFonts(): Promise<ActionResult<PopupFontOption[]>> {
  return runAdminAction("messaging.write", noInputSchema, undefined, async () => listPopupFontLibrary(communicationsDb()));
}

/** [messaging.write] Novo nome da fonte (1 a 60 caracteres). */
export async function renamePopupFont(input: { id: string; name: string }): Promise<ActionResult<PopupFontOption>> {
  return runAdminAction("messaging.write", renameFontSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const { data: rows, error } = await db
      .from("communication_fonts")
      .update({ name: data.name })
      .eq("id", data.id)
      .is("deleted_at", null)
      .select(POPUP_FONT_COLUMNS);
    assertNoDbError(error, "Comunicacao: renomeando a fonte");

    const row = ((rows ?? []) as PopupFontRow[])[0];
    const option = row ? fontRowToOption(db, row) : null;

    if (!option) {
      throw new CommunicationError(POPUP_FONT_GONE_MESSAGE, 404);
    }

    await recordAudit(db, { action: "communication.font_renamed", actorId: user.id, entityId: option.id, entityType: "communication_font" });

    return option;
  });
}

/** [messaging.write] Exclui a fonte da biblioteca (deleted_at); recusa (409) quando um pop-up ou um modelo nao excluido usa. */
export async function deletePopupFont(input: { id: string }): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("messaging.write", deleteFontSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const { data: found, error: findError } = await db.from("communication_fonts").select("id").eq("id", data.id).is("deleted_at", null).limit(1);
    assertNoDbError(findError, "Comunicacao: fonte a excluir");

    if ((found ?? []).length === 0) {
      throw new CommunicationError(POPUP_FONT_GONE_MESSAGE, 404);
    }

    // design.fonts e derivado dos blocos e canonico (ids minusculos, ordenados): o @> acha todo pop-up que usa.
    const { count, error: useError } = await db
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .contains("popup_design", { fonts: [data.id] })
      .is("deleted_at", null);
    assertNoDbError(useError, "Comunicacao: pop-ups que usam a fonte");

    if ((count ?? 0) > 0) {
      throw new CommunicationError(fontInUseMessage(count ?? 0), 409);
    }

    // Modelos (docs/28 D18): um modelo salvo segura a fonte dele. Tabela de modelos ausente = nenhum modelo.
    const templates = await db
      .from(TEMPLATES_TABLE)
      .select("id", { count: "exact", head: true })
      .contains("payload", { design: { fonts: [data.id] } })
      .is("deleted_at", null);

    if (templates.error && !isMissingTemplatesTable(templates.error)) {
      assertNoDbError(templates.error, "Comunicacao: modelos que usam a fonte");
    }

    const inTemplates = templates.error ? 0 : (templates.count ?? 0);

    if (inTemplates > 0) {
      throw new CommunicationError(TEMPLATE_MESSAGES.fontInTemplates(inTemplates), 409);
    }

    const { data: removed, error } = await db
      .from("communication_fonts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("deleted_at", null)
      .select("id");
    assertNoDbError(error, "Comunicacao: excluindo a fonte");

    if ((removed ?? []).length === 0) {
      throw new CommunicationError(POPUP_FONT_GONE_MESSAGE, 404);
    }

    await recordAudit(db, { action: "communication.font_deleted", actorId: user.id, entityId: data.id, entityType: "communication_font" });

    return { id: data.id };
  });
}
