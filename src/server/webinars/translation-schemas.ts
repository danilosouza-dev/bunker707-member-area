// Schemas zod da traducao do chat e do roteiro (fase 4f; docs/30 §1.6). Modulo puro (sem "server-only", imports
// relativos; zod v4). As mensagens passam pela lista PROIBIDAS_WEBINARIO.

import { z } from "zod";
import { CHAT_LANGUAGES, TRANSLATION_LIMITS } from "./model";

export const TRANSLATION_MESSAGES = { invalid: "Pedido inválido.", language: "Escolha português, inglês ou espanhol." } as const;

export const chatLanguageSchema = z.enum(CHAT_LANGUAGES, { error: TRANSLATION_MESSAGES.language });

/** PUT /api/webinars/preferences { chatLanguage } (Perfil › Privacidade e a sala): nulo = como foi escrito. */
export const viewerPrefsBodySchema = z.object({ chatLanguage: chatLanguageSchema.nullable() });

/** GET /api/webinars/[id]/translations?sessao=&lang=&ids=a,b,c: as traducoes das mensagens que a sala mostra. */
export const translationsQuerySchema = z.object({
  ids: z
    .string()
    .trim()
    .transform((value) => [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))])
    .pipe(z.array(z.uuid({ error: TRANSLATION_MESSAGES.invalid })).min(1).max(TRANSLATION_LIMITS.idsPerRequest)),
  lang: chatLanguageSchema,
  sessao: z.uuid({ error: TRANSLATION_MESSAGES.invalid })
});
