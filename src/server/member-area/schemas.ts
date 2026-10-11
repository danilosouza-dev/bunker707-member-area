// Blocos de validacao compartilhados pela Area de membros (login, destaque da home, modulos). Modulo
// puro: o editor do cliente reaproveita para validar ao sair do campo e os testes carregam direto pelo
// Node. Mensagens no portugues do produtor.

import { z } from "zod";
import { expectedUpdatedAtSchema, imageLinkSchema } from "../catalog/schemas";
import type { ImageUploadSlot } from "../catalog/webp";

/** Chaves de public.platform_settings que a Area de membros le e grava. */
export const MEMBER_AREA_SETTING_KEYS = ["loginPage", "hero", "homeSections", "branding"] as const;
export type MemberAreaSettingKey = (typeof MEMBER_AREA_SETTING_KEYS)[number];

/**
 * `updated_at` da configuracao lido pela tela; `null` = a configuracao ainda nao existia quando a tela
 * abriu (a gravacao cria a linha e falha com 409 se alguem criou antes).
 */
export const settingVersionSchema = expectedUpdatedAtSchema.nullable();

/** Imagens que ja vem com o app (public/hero, public/login, public/brand) e que o legado pode ter gravado. */
const LOCAL_DEFAULT_IMAGE_PATTERN = /^\/(?:hero|login|brand)\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|avif|svg)$/;

export function isLocalDefaultImage(value: string) {
  return LOCAL_DEFAULT_IMAGE_PATTERN.test(value);
}

/**
 * Referencia de imagem gravada no banco: link https (Storage do Supabase depois do upload, ou link
 * colado) ou uma das imagens padrao do app. Nunca data URL: o upload acontece antes, em
 * uploadMemberAreaImage, e so a URL publica chega aqui.
 */
export const memberAreaImageRefSchema = z
  .string({ error: "Escolha uma imagem." })
  .trim()
  .max(2_048, "Link longo demais.")
  .refine((value) => isLocalDefaultImage(value) || imageLinkSchema.safeParse(value).success, "Use uma imagem enviada aqui ou um link que comece com https://, sem espaços, aspas nem parênteses.");

/** Slots que passam por uploadMemberAreaImage (a capa de modulo grava direto em course_modules). */
export const MEMBER_AREA_UPLOAD_SLOTS = ["hero", "loginSide", "loginBackground"] as const satisfies readonly ImageUploadSlot[];
export type MemberAreaUploadSlot = (typeof MEMBER_AREA_UPLOAD_SLOTS)[number];

/** Pasta do Storage (bucket content-assets) de cada slot. O nome do arquivo e o hash do conteudo. */
export const MEMBER_AREA_UPLOAD_FOLDERS: Record<MemberAreaUploadSlot, string> = {
  hero: "platform/home-hero",
  loginBackground: "platform/login-background",
  loginSide: "platform/login-side"
};

const webpDataUrlPattern = /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/;

/**
 * Teto de texto do data URL de cada slot. E o mesmo `maxDataUrlLength` de IMAGE_SPECS no recorte do
 * cliente (cover-crop.ts); tests/member-area-foundation.test.mjs confere que os dois batem.
 */
export const MEMBER_AREA_UPLOAD_MAX_LENGTH: Record<MemberAreaUploadSlot, number> = {
  hero: 300_000,
  loginBackground: 560_000,
  loginSide: 560_000
};

export function maxDataUrlLengthFor(slot: MemberAreaUploadSlot) {
  return MEMBER_AREA_UPLOAD_MAX_LENGTH[slot];
}

export const uploadMemberAreaImageSchema = z
  .object({
    image: z.string({ error: "Envie a imagem recortada (WebP)." }).regex(webpDataUrlPattern, "Envie a imagem recortada (WebP)."),
    slot: z.enum(MEMBER_AREA_UPLOAD_SLOTS, { error: "Tipo de imagem inválido." })
  })
  .superRefine((value, context) => {
    if (value.image.length > maxDataUrlLengthFor(value.slot)) {
      context.addIssue({ code: "custom", message: "A imagem ficou grande demais. Recorte de novo.", path: ["image"] });
    }
  });

export type UploadMemberAreaImageInput = z.input<typeof uploadMemberAreaImageSchema>;
export type MemberAreaImageUploaded = { slot: MemberAreaUploadSlot; url: string };
