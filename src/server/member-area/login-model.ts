// Pagina de entrar (/login) da Area de membros: o que fica salvo em platform_settings.loginPage, a
// validacao e a montagem do LoginPageConfig que o LoginExperience desenha. Modulo puro (sem
// "server-only", sem React, sem aliases): o editor do cliente usa para validar e montar a previa,
// as queries do servidor para o /login, e tests/member-area-login.test.mjs carrega direto pelo Node.

import { z } from "zod";
import {
  DEFAULT_LOGIN_VISUAL_IMAGE,
  LOGIN_PANEL_TONES,
  LOGIN_TEMPLATE_IDS,
  defaultLoginPanelTone,
  getLoginPageConfig,
  isAllowedLoginSupportHref,
  isSplitLoginTemplate,
  loginTemplateOptions,
  type LoginPageConfig,
  type LoginPanelTone,
  type LoginTemplateId
} from "../../lib/login-config";
import { memberAreaImageRefSchema, settingVersionSchema } from "./schemas";

export const LOGIN_PAGE_SETTINGS_VERSION = 1;

/** Limites de texto (o campo da tela usa o mesmo numero em maxLength e no contador). */
export const LOGIN_TEXT_LIMITS = {
  formSubtitle: 200,
  formTitle: 80,
  imageAlt: 160,
  quote: 160,
  quoteDetail: 240,
  supportLabel: 60,
  supportLinkLabel: 40
} as const;

function limitedText(max: number) {
  return z.string({ error: "Texto inválido." }).trim().max(max, `Use no máximo ${max} caracteres.`);
}

/** Link da linha de ajuda: https:// ou mailto: com um e-mail valido. Nada mais (nem http://, nem //host). */
export const supportHrefSchema = z
  .string({ error: "Use um link que comece com https:// ou um e-mail." })
  .trim()
  .max(2_048, "Link longo demais.")
  .refine((value) => isAllowedLoginSupportHref(value), "Use um link que comece com https:// ou um e-mail.");

const loginImageSchema = z.object({
  alt: limitedText(LOGIN_TEXT_LIMITS.imageAlt),
  /** null = a imagem padrao do app (astronauta). */
  url: memberAreaImageRefSchema.nullable()
});

/** O que fica em platform_settings.loginPage (a versao para conflito e a coluna updated_at). */
export const loginPageSettingsSchema = z
  .object({
    version: z.literal(LOGIN_PAGE_SETTINGS_VERSION),
    template: z.enum(LOGIN_TEMPLATE_IDS, { error: "Escolha um modelo." }),
    panelTone: z.enum(LOGIN_PANEL_TONES, { error: "Escolha o tom do painel." }),
    /** Modelos com imagem ao lado do formulario. */
    sideImage: loginImageSchema,
    /** Modelos com a imagem ocupando a tela toda. */
    backgroundImage: loginImageSchema,
    /** "Frase da imagem" (so nos modelos com imagem ao lado). */
    quote: limitedText(LOGIN_TEXT_LIMITS.quote),
    quoteDetail: limitedText(LOGIN_TEXT_LIMITS.quoteDetail),
    formTitle: limitedText(LOGIN_TEXT_LIMITS.formTitle),
    formSubtitle: limitedText(LOGIN_TEXT_LIMITS.formSubtitle),
    supportLabel: limitedText(LOGIN_TEXT_LIMITS.supportLabel),
    supportLinkLabel: limitedText(LOGIN_TEXT_LIMITS.supportLinkLabel),
    supportHref: supportHrefSchema.nullable(),
    googleEnabled: z.boolean({ error: "Valor inválido." })
  })
  .superRefine((value, context) => {
    if (value.supportHref && !value.supportLinkLabel) {
      context.addIssue({ code: "custom", message: "Escreva o texto do link.", path: ["supportLinkLabel"] });
    }
  });

export type LoginPageSettings = z.output<typeof loginPageSettingsSchema>;
export type LoginPageSettingsInput = z.input<typeof loginPageSettingsSchema>;
export type LoginImageSettings = LoginPageSettings["sideImage"];

export const saveLoginPageSchema = z.object({
  expectedUpdatedAt: settingVersionSchema,
  settings: loginPageSettingsSchema
});

export type SaveLoginPageInput = z.input<typeof saveLoginPageSchema>;

/** O /login de hoje (antes de existir esta configuracao), com acentos. */
export const DEFAULT_LOGIN_PAGE_SETTINGS: LoginPageSettings = Object.freeze({
  backgroundImage: Object.freeze({ alt: "", url: null }),
  formSubtitle: "",
  formTitle: "",
  googleEnabled: true,
  panelTone: "dark",
  quote: "Na superfície, todos seguem no automático. No Bunker, a IA vira método.",
  quoteDetail: "",
  sideImage: Object.freeze({ alt: "", url: null }),
  supportHref: null,
  supportLabel: "Ainda não tem acesso?",
  supportLinkLabel: "Fale com o suporte",
  template: "split-visual-right",
  version: LOGIN_PAGE_SETTINGS_VERSION
}) as LoginPageSettings;

/** Copia editavel do padrao (o rascunho da tela nunca segura o objeto congelado). */
export function defaultLoginPageSettings(): LoginPageSettings {
  return {
    ...DEFAULT_LOGIN_PAGE_SETTINGS,
    backgroundImage: { ...DEFAULT_LOGIN_PAGE_SETTINGS.backgroundImage },
    sideImage: { ...DEFAULT_LOGIN_PAGE_SETTINGS.sideImage }
  };
}

/**
 * Le o JSON gravado. Ausente, de outra versao ou com qualquer campo invalido: volta o padrao com
 * `valid: false` (o /login nunca quebra; o editor avisa e o produtor publica por cima).
 */
export function parseStoredLoginPage(value: unknown): { settings: LoginPageSettings; valid: boolean } {
  const parsed = loginPageSettingsSchema.safeParse(value);

  return parsed.success ? { settings: parsed.data, valid: true } : { settings: defaultLoginPageSettings(), valid: false };
}

/** Qual imagem o modelo usa e em qual medida ela e recortada. */
export function loginImageSlotFor(template: LoginTemplateId): "loginSide" | "loginBackground" {
  return isSplitLoginTemplate(template) ? "loginSide" : "loginBackground";
}

export function loginImageKeyFor(template: LoginTemplateId): "sideImage" | "backgroundImage" {
  return isSplitLoginTemplate(template) ? "sideImage" : "backgroundImage";
}

/**
 * Monta o que o LoginExperience desenha. Os rotulos de e-mail, senha, "Entrar" e "Esqueci minha
 * senha" continuam os padroes; a logo vem da Marca (null = nome da escola em texto).
 */
export function resolveLoginPageConfig(settings: LoginPageSettings, brand: { logoImage: string | null }): LoginPageConfig {
  const base = getLoginPageConfig(settings.template);
  const split = isSplitLoginTemplate(settings.template);
  const image = settings[loginImageKeyFor(settings.template)];
  const uploaded = Boolean(image.url);

  return {
    ...base,
    footerLinks: [],
    form: {
      ...base.form,
      subtitle: settings.formSubtitle,
      supportCta: settings.supportLinkLabel,
      supportHref: isAllowedLoginSupportHref(settings.supportHref) ? settings.supportHref : null,
      supportLabel: settings.supportLabel,
      title: settings.formTitle
    },
    logo: { alt: base.brandName, src: brand.logoImage },
    panelTone: settings.panelTone,
    providers: settings.googleEnabled ? ["google"] : [],
    template: settings.template,
    visual: {
      ...base.visual,
      alt: image.alt || (uploaded ? "" : base.visual.alt),
      description: split ? settings.quoteDetail : "",
      imageSrc: image.url ?? DEFAULT_LOGIN_VISUAL_IMAGE,
      objectPosition: uploaded ? "center" : base.visual.objectPosition,
      title: split ? settings.quote : ""
    }
  };
}

export type LoginTemplateGalleryItem = {
  description: string;
  id: LoginTemplateId;
  imageSlot: "loginSide" | "loginBackground";
  name: string;
  showsQuote: boolean;
};

/** Os 4 modelos na ordem da galeria (mesmos nomes do admin antigo, em loginTemplateOptions). */
export const LOGIN_TEMPLATE_GALLERY: readonly LoginTemplateGalleryItem[] = loginTemplateOptions.map((option) => ({
  description: option.description,
  id: option.id,
  imageSlot: loginImageSlotFor(option.id),
  name: option.name,
  showsQuote: isSplitLoginTemplate(option.id)
}));

export function loginTemplateName(template: LoginTemplateId) {
  return LOGIN_TEMPLATE_GALLERY.find((item) => item.id === template)?.name ?? template;
}

export const LOGIN_TONE_OPTIONS: readonly { label: "Escuro" | "Translúcido" | "Claro"; value: LoginPanelTone }[] = [
  { label: "Escuro", value: "dark" },
  { label: "Translúcido", value: "glass" },
  { label: "Claro", value: "light" }
];

/** O efeito de cada tom, em uma frase (aparece abaixo das pilulas). Use loginToneHint, que olha o modelo. */
export const LOGIN_TONE_HINTS: Record<LoginPanelTone, string> = {
  dark: "Painel escuro e discreto, com a logo da Marca.",
  glass: "Painel translúcido: a imagem aparece por trás do formulário.",
  light: "Painel claro. A logo aparece como texto para continuar legível."
};

/**
 * Frase do tom para o modelo escolhido. Nos modelos com a imagem ao lado, no computador o formulario
 * fica sobre o fundo liso: a imagem so aparece por tras dele no celular.
 */
export function loginToneHint(tone: LoginPanelTone, template: LoginTemplateId) {
  if (tone === "glass" && isSplitLoginTemplate(template)) {
    return "Painel translúcido: no celular, a imagem aparece por trás do formulário.";
  }

  return LOGIN_TONE_HINTS[tone];
}

/**
 * Troca o modelo. O tom acompanha o modelo enquanto o produtor nao escolheu outro (dividido = escuro,
 * sobre a imagem = translucido); as duas imagens ficam guardadas, cada modelo usa a sua.
 */
export function applyLoginTemplate(settings: LoginPageSettings, template: LoginTemplateId): LoginPageSettings {
  if (settings.template === template) {
    return settings;
  }

  const followsTemplate = settings.panelTone === defaultLoginPanelTone(settings.template);

  return {
    ...settings,
    panelTone: followsTemplate ? defaultLoginPanelTone(template) : settings.panelTone,
    template
  };
}

const LOGIN_SETTINGS_KEYS = [
  "version",
  "template",
  "panelTone",
  "sideImage",
  "backgroundImage",
  "quote",
  "quoteDetail",
  "formTitle",
  "formSubtitle",
  "supportLabel",
  "supportLinkLabel",
  "supportHref",
  "googleEnabled"
] as const satisfies readonly (keyof LoginPageSettings)[];

type LoginSettingsKey = (typeof LOGIN_SETTINGS_KEYS)[number];

function sameValue(left: LoginPageSettings[LoginSettingsKey], right: LoginPageSettings[LoginSettingsKey]) {
  if (left && right && typeof left === "object" && typeof right === "object") {
    return left.url === right.url && left.alt === right.alt;
  }

  return left === right;
}

export function isLoginSettingsEqual(left: LoginPageSettings, right: LoginPageSettings) {
  return LOGIN_SETTINGS_KEYS.every((key) => sameValue(left[key], right[key]));
}

/**
 * Chegou uma versao nova do servidor (Recarregar depois de um 409): o que o produtor mudou no rascunho
 * continua; o resto segue o servidor.
 */
export function rebaseLoginDraft(previousPublished: LoginPageSettings, draft: LoginPageSettings, nextPublished: LoginPageSettings): LoginPageSettings {
  const result = { ...nextPublished } as Record<LoginSettingsKey, unknown>;

  for (const key of LOGIN_SETTINGS_KEYS) {
    if (!sameValue(previousPublished[key], draft[key])) {
      result[key] = draft[key];
    }
  }

  return result as LoginPageSettings;
}

/* ------------------------------------------------------------------------------------------------
 * Campo "Link" da ajuda: aceita https:// ou um e-mail (vira mailto:)
 * ---------------------------------------------------------------------------------------------- */

const BARE_EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"?#&/]+@[^\s@<>()[\]\\,;:"?#&/]+\.[A-Za-z]{2,}$/;

export type SupportLinkParse = { href: string | null; ok: true } | { message: string; ok: false };

/** Texto digitado no campo -> link gravado. Vazio = sem link (a linha some do login). */
export function parseSupportLinkInput(raw: string): SupportLinkParse {
  const value = raw.trim();

  if (!value) {
    return { href: null, ok: true };
  }

  const candidate = BARE_EMAIL_PATTERN.test(value) ? `mailto:${value}` : value;
  const parsed = supportHrefSchema.safeParse(candidate);

  return parsed.success
    ? { href: parsed.data, ok: true }
    : { message: parsed.error.issues[0]?.message ?? "Use um link que comece com https:// ou um e-mail.", ok: false };
}

/** Link gravado -> texto do campo (mailto: some, fica so o e-mail). */
export function supportLinkInputValue(href: string | null) {
  if (!href) {
    return "";
  }

  return /^mailto:/i.test(href) ? href.slice("mailto:".length) : href;
}

/** Erros do servidor ("settings.quote") -> erros por campo da tela ("quote"). */
export function loginFieldErrors(fieldErrors: Record<string, string[]> | undefined) {
  const result: Record<string, string> = {};

  for (const [path, messages] of Object.entries(fieldErrors ?? {})) {
    const key = path.replace(/^settings\./, "");

    if (messages[0] && !result[key]) {
      result[key] = messages[0];
    }
  }

  return result;
}
