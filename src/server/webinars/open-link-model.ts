// O link aberto do webinario (docs/30 §14, D127 a D134; pedido do produtor de 23/11/2026): quem nao e aluno entra
// por /webinarios/<slug>/entrar com o que a equipe escolheu pedir (nome, e-mail e telefone, cada um Nao pedir,
// Opcional ou Obrigatorio; nada pedido = so o Entrar) e ganha uma conta de convidado presa aquele webinario. Modulo
// puro (sem server-only): o editor, a pagina do formulario, a rota que cria o convidado, o proxy e as guardas usam as
// mesmas regras.
//
// - A chave mora em webinars.room_settings.openLink (sem coluna nova, como o showPresentCount, D102); a leitura
//   ignora o que nao conhece e cai no padrao (desligado).
// - O convidado e marcado no app_metadata da conta (so o servidor grava): `webinar_guest: { webinar_id, slug }`. As
//   guardas negam o convidado em toda pagina e rota, menos nas do proprio webinario (guestAllowedPath e allowGuest).
// - Com o link aberto, o webinario fica fora da area de membros (docs/30 §8.6, CDC art. 37): o selo "Ao vivo" da
//   gravada, o contador, as entradas, os avisos de venda e os participantes simulados nao aparecem para ninguem
//   (simulationHidden).

import type { Metadata } from "next";
import { z } from "zod";

export const OPEN_LINK_FIELD_MODES = ["off", "optional", "required"] as const;
export type OpenLinkFieldMode = (typeof OPEN_LINK_FIELD_MODES)[number];

export const OPEN_LINK_FIELDS = ["name", "email", "phone"] as const;
export type OpenLinkField = (typeof OPEN_LINK_FIELDS)[number];

export type OpenLinkSettings = {
  email: OpenLinkFieldMode;
  enabled: boolean;
  name: OpenLinkFieldMode;
  phone: OpenLinkFieldMode;
};

export const GUEST_LIMITS = {
  email: 254,
  name: 80,
  phoneMax: 20,
  phoneMin: 8,
  source: 120
} as const;

// O convidado na conta (o app_metadata, as paginas que ele abre): no nucleo, em src/lib/auth/guest-account.ts, porque o
// proxy e a sessao leem sem depender do codigo dos Webinarios (o modulo vendido a parte, docs/32 §11.8).
export { GUEST_APP_METADATA_KEY, guestAllowedPath, guestIdentityOf, isGuestUser, openLinkAnonymousPath, type GuestIdentity } from "../../lib/auth/guest-account";

/** O nome no chat de quem entrou sem dar o nome. */
export const GUEST_DEFAULT_NAME = "Convidado";

export function defaultOpenLink(): OpenLinkSettings {
  return { email: "off", enabled: false, name: "required", phone: "off" };
}

function modeOf(value: unknown, fallback: OpenLinkFieldMode): OpenLinkFieldMode {
  return (OPEN_LINK_FIELD_MODES as readonly unknown[]).includes(value) ? (value as OpenLinkFieldMode) : fallback;
}

/** O link aberto gravado em room_settings.openLink; ausente ou estranho, o padrao (desligado). */
export function openLinkOfRoomSettings(roomSettings: unknown): OpenLinkSettings {
  const base = defaultOpenLink();
  const raw = roomSettings && typeof roomSettings === "object" && !Array.isArray(roomSettings) ? (roomSettings as Record<string, unknown>).openLink : null;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return base;
  }

  const value = raw as Record<string, unknown>;

  return {
    email: modeOf(value.email, base.email),
    enabled: value.enabled === true,
    name: modeOf(value.name, base.name),
    phone: modeOf(value.phone, base.phone)
  };
}

export const openLinkSchema: z.ZodType<OpenLinkSettings> = z.object({
  email: z.enum(OPEN_LINK_FIELD_MODES),
  enabled: z.boolean(),
  name: z.enum(OPEN_LINK_FIELD_MODES),
  phone: z.enum(OPEN_LINK_FIELD_MODES)
});

/** O link aberto esta ligado neste webinario? (Webinario de antes, sem a chave: nao.) */
export function openLinkEnabled(target: { openLink?: Pick<OpenLinkSettings, "enabled"> | null }): boolean {
  return target.openLink?.enabled === true;
}

/**
 * Com o link aberto o webinario e anunciado fora da area de membros: nada de simulado para ninguem (docs/30 §8.6, CDC
 * art. 37). Vale para todos que assistem (o aluno tambem), para a sala ser a mesma.
 */
export function simulationHidden(target: { openLink?: Pick<OpenLinkSettings, "enabled"> | null }): boolean {
  return openLinkEnabled(target);
}

/** Pede e-mail ou telefone: o formulario mostra o aceite e a entrada so passa com ele marcado. */
export function openLinkAsksContact(settings: Pick<OpenLinkSettings, "email" | "phone">): boolean {
  return settings.email !== "off" || settings.phone !== "off";
}

/** O endereco do formulario (o link que a equipe manda). */
export function webinarEntryPath(slug: string): string {
  return `/webinarios/${slug}/entrar`;
}

/** Ate onde vai a descricao no cartao de quem recebe o link (os mensageiros cortam perto disso). */
const SHARE_DESCRIPTION_LIMIT = 200;

/**
 * O cartao do link nos mensageiros e nas redes (D136): a capa, o titulo e a descricao do webinario. Sem capa, sem imagem;
 * sem descricao, a frase de `fallback`. A capa e sempre um endereco https (httpsOrNull).
 */
export function openLinkShareMetadata(webinar: { coverUrl: string | null; description: string | null; title: string }, fallback: string): Metadata {
  const title = webinar.title.trim();
  const text = (webinar.description ?? "").replace(/\s+/g, " ").trim() || fallback;
  const description = text.length > SHARE_DESCRIPTION_LIMIT ? `${text.slice(0, SHARE_DESCRIPTION_LIMIT - 1).trimEnd()}…` : text;
  const images = webinar.coverUrl ? [{ alt: title, url: webinar.coverUrl }] : [];

  return {
    description,
    openGraph: { description, images, locale: "pt_BR", title, type: "website" },
    title,
    twitter: { card: images.length > 0 ? "summary_large_image" : "summary", description, images, title }
  };
}

/** A frase do aceite que fica gravada com a entrada (LGPD: para que, por quem e como sair). */
export function guestConsentText(webinarTitle: string): string {
  const title = webinarTitle.trim().slice(0, 160) || "esta live";

  return `Autorizo a Bunker707 a usar meus dados para me avisar sobre "${title}" e enviar conteúdos da escola. Posso pedir para sair a qualquer momento pelo suporte.`;
}

/** Só os dígitos, com o "+" do começo quando veio; fora do tamanho, nulo. */
export function normalizeGuestPhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < GUEST_LIMITS.phoneMin || digits.length > GUEST_LIMITS.phoneMax - 1) {
    return null;
  }

  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export const GUEST_MESSAGES = {
  consent: "Marque a autorização para entrar.",
  email: "Confira o e-mail.",
  emailRequired: "Informe o seu e-mail.",
  name: "Use até 80 caracteres no nome.",
  nameRequired: "Informe o seu nome.",
  phone: "Confira o telefone, com o DDD.",
  phoneRequired: "Informe o seu telefone."
} as const;

/** O que o formulario manda (antes das regras do webinario). */
export const guestEntryBodySchema = z.object({
  consent: z.boolean().optional().default(false),
  email: z.string().max(GUEST_LIMITS.email * 2).optional().default(""),
  // Campo escondido contra robos: gente de verdade nunca preenche.
  website: z.string().max(200).optional().default(""),
  name: z.string().max(GUEST_LIMITS.name * 2).optional().default(""),
  phone: z.string().max(GUEST_LIMITS.phoneMax * 3).optional().default(""),
  source: z.string().max(GUEST_LIMITS.source * 2).optional().default("")
});

export type GuestEntryBody = z.input<typeof guestEntryBodySchema>;

export type GuestEntry = {
  consentText: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  source: string | null;
};

export type GuestEntryResult = { entry: GuestEntry; ok: true } | { errors: Partial<Record<OpenLinkField | "consent", string>>; ok: false };

const emailSchema = z.email();

/**
 * Confere o formulario contra o que a equipe pediu: o campo Nao pedir e ignorado (nem gravado); o Opcional vazio fica
 * nulo; o Obrigatorio vazio recusa. Com e-mail ou telefone preenchido, o aceite e obrigatorio.
 */
export function validateGuestEntry(settings: OpenLinkSettings, body: z.output<typeof guestEntryBodySchema>, webinarTitle: string): GuestEntryResult {
  const errors: Partial<Record<OpenLinkField | "consent", string>> = {};
  const name = settings.name === "off" ? "" : body.name.trim().replace(/\s+/g, " ");
  const email = settings.email === "off" ? "" : body.email.trim().toLowerCase();
  const phoneRaw = settings.phone === "off" ? "" : body.phone.trim();
  let phone: string | null = null;

  if (settings.name === "required" && !name) {
    errors.name = GUEST_MESSAGES.nameRequired;
  } else if (name.length > GUEST_LIMITS.name) {
    errors.name = GUEST_MESSAGES.name;
  }

  if (settings.email === "required" && !email) {
    errors.email = GUEST_MESSAGES.emailRequired;
  } else if (email && (email.length > GUEST_LIMITS.email || !emailSchema.safeParse(email).success)) {
    errors.email = GUEST_MESSAGES.email;
  }

  if (settings.phone === "required" && !phoneRaw) {
    errors.phone = GUEST_MESSAGES.phoneRequired;
  } else if (phoneRaw) {
    phone = normalizeGuestPhone(phoneRaw);
    if (!phone) {
      errors.phone = GUEST_MESSAGES.phone;
    }
  }

  const givesContact = Boolean(email) || Boolean(phoneRaw);

  if (givesContact && body.consent !== true) {
    errors.consent = GUEST_MESSAGES.consent;
  }

  if (Object.keys(errors).length > 0) {
    return { errors, ok: false };
  }

  const source = body.source.trim().slice(0, GUEST_LIMITS.source);

  return {
    entry: {
      consentText: givesContact ? guestConsentText(webinarTitle) : null,
      email: email || null,
      name: name || null,
      phone,
      source: source || null
    },
    ok: true
  };
}

/** Uma linha de quem entrou pelo link, como a lista e o CSV da equipe leem (webinar_guests). */
export type GuestListRow = {
  consentAt: string | null;
  consentText: string | null;
  createdAt: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  source: string | null;
};

/**
 * As linhas do CSV de quem entrou pelo link (Entrada, Nome, E-mail, Telefone, Autorização, Autorizado em, Origem), a
 * hora no fuso de Sao Paulo pelo `formatWhen` de quem chama. Sem nome, "Convidado"; o que nao foi pedido fica vazio.
 */
export function guestCsvRows(rows: readonly GuestListRow[], formatWhen: (iso: string | null) => string): string[][] {
  return rows.map((row) => [
    formatWhen(row.createdAt),
    row.name ?? GUEST_DEFAULT_NAME,
    row.email ?? "",
    row.phone ?? "",
    row.consentText ? "sim" : "não",
    row.consentAt ? formatWhen(row.consentAt) : "",
    row.source ?? ""
  ]);
}
