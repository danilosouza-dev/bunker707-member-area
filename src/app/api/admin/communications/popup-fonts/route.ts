import { NextResponse } from "next/server";
import { recordAudit } from "@/server/audit/log";
import { requireApiRole } from "@/server/auth/permissions";
import { communicationsDb, CommunicationError } from "@/server/communications/db";
import { POPUP_FONT_LIMITS, POPUP_FONT_STYLES, type PopupFontStyle } from "@/server/communications/popup-design-model";
import {
  cleanPopupFontName,
  defaultPopupFontName,
  persistPopupFont,
  POPUP_FONT_FILE_MESSAGE,
  POPUP_FONT_NAME_MESSAGE,
  POPUP_FONT_SIZE_MESSAGE
} from "@/server/communications/popup-media";
import { jsonRouteError } from "@/server/http/route-errors";

// Envio de fonte para o design do pop-up (Comunicacao > Avisos e pop-ups > Pop-up > Design > Fontes; docs/26):
// arquivo WOFF2, WOFF, TTF ou OTF de ate 2 MB em multipart (campo "file", e "name", "weight" e "style"
// opcionais). Rota, e nao Server Action, porque a fonte passa do 1 MB das acoes. O servidor confere o formato
// pelos primeiros bytes (nunca pelo nome ou pelo tipo informado), guarda no bucket communication-fonts pelo
// hash do conteudo e devolve a opcao da biblioteca (o mesmo arquivo de novo devolve a mesma fonte).

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const revalidate = 0;

/** Arquivo de ate 2 MB mais a moldura do multipart. */
const MAX_REQUEST_BYTES = POPUP_FONT_LIMITS.maxBytes + 200 * 1024;
const WEIGHT_MESSAGE = "Escolha um peso da lista.";
const STYLE_MESSAGE = "Escolha o estilo da fonte.";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function textField(form: FormData, key: string) {
  const value = form.get(key);

  return typeof value === "string" ? value.trim() : "";
}

/** "name": vazio = o nome do arquivo sem extensao; preenchido = 1 a 60 caracteres. */
function fontName(form: FormData, file: File) {
  const typed = cleanPopupFontName(textField(form, "name"));

  if (!typed) {
    return defaultPopupFontName(file.name);
  }

  if (typed.length > POPUP_FONT_LIMITS.name) {
    throw new CommunicationError(POPUP_FONT_NAME_MESSAGE, 400);
  }

  return typed;
}

/** "weight": 100 a 900, de 100 em 100 (padrao 400). */
function fontWeight(form: FormData) {
  const value = textField(form, "weight");

  if (!value) {
    return 400;
  }

  if (!/^[1-9]00$/.test(value)) {
    throw new CommunicationError(WEIGHT_MESSAGE, 400);
  }

  return Number(value);
}

/** "style": normal ou italic (padrao normal). */
function fontStyle(form: FormData): PopupFontStyle {
  const value = textField(form, "style");

  if (!value) {
    return "normal";
  }

  if (!(POPUP_FONT_STYLES as readonly string[]).includes(value)) {
    throw new CommunicationError(STYLE_MESSAGE, 400);
  }

  return value as PopupFontStyle;
}

export async function POST(request: Request) {
  const auth = await requireApiRole("messaging.write");

  if (auth.response) {
    return noStore(auth.response);
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return noStore(NextResponse.json({ error: POPUP_FONT_SIZE_MESSAGE }, { status: 413 }));
  }

  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    return noStore(NextResponse.json({ error: "Envie a fonte como arquivo." }, { status: 400 }));
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return noStore(NextResponse.json({ error: "Envie a fonte como arquivo." }, { status: 400 }));
  }

  try {
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      throw new CommunicationError(POPUP_FONT_FILE_MESSAGE, 400);
    }

    if (file.size > POPUP_FONT_LIMITS.maxBytes) {
      throw new CommunicationError(POPUP_FONT_SIZE_MESSAGE, 413);
    }

    const input = { name: fontName(form, file), style: fontStyle(form), weight: fontWeight(form) };
    const db = communicationsDb();
    const { created, font } = await persistPopupFont(db, { ...input, bytes: new Uint8Array(await file.arrayBuffer()), userId: auth.user?.id ?? null });

    if (created) {
      await recordAudit(db, {
        action: "communication.font_uploaded",
        actorId: auth.user?.id ?? null,
        entityId: font.id,
        entityType: "communication_font",
        metadata: { format: font.format, size_bytes: font.sizeBytes }
      });
    }

    return noStore(NextResponse.json({ data: font }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Não foi possível enviar a fonte. Tente de novo em instantes."));
  }
}
