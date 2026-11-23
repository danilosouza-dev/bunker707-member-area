import "server-only";

// A entrada pelo link aberto (docs/30 §14, D127 a D134): POST /api/webinars/entrar/[slug] confere o webinario (publicado,
// nao apagado, nao cancelado e com o link ligado), o formulario contra o que a equipe pediu (validateGuestEntry), o
// teto de entradas por endereco (30 por minuto, o mesmo teto das escritas do aluno) e por webinario
// (GUEST_ENTRY_LIMITS.perWebinar), cria a conta de convidado e devolve o e-mail e a senha de uso unico que o navegador
// usa para entrar. O login acontece no navegador de cada pessoa (como o login do aluno, login-experience.tsx): o
// limite de logins por endereco do Auth conta por pessoa, e nao pelo servidor do app, entao 100 ou mais entram juntas.
//
// A conta de convidado: e-mail inventado e unico (convidado-<id>@convidados.invalid, que nunca recebe nada), senha
// aleatoria, app_metadata.webinar_guest = { webinar_id, slug } (so o servidor grava; vem no JWT e as guardas leem), e o
// perfil com a marca is_guest, o nome do chat ("Convidado" sem nome) e o e-mail que a pessoa deu como contato. Se a
// marca ou a linha falharem, a conta sai (nada de conta sem marca).

import { randomBytes, randomUUID } from "node:crypto";
import { formatWebinarWhen } from "../../lib/webinar-time";
import { takeStudentWrite } from "../communications/student-write-limit";
import { WebinarError, webinarsDb, type WebinarsDb } from "./db";
import { countGuestRows, insertGuestRow, markGuestProfile } from "./guest-store";
import { nextSession, type Webinar } from "./model";
import { sessionFromRow, webinarFromRow } from "./rows";
import { fetchWebinarRowBySlug, listSessionRows } from "./store";
import {
  GUEST_APP_METADATA_KEY,
  GUEST_DEFAULT_NAME,
  guestEntryBodySchema,
  openLinkEnabled,
  validateGuestEntry,
  type GuestEntryResult
} from "./open-link-model";

export const GUEST_ENTRY_LIMITS = {
  /** Entradas pelo link de um webinario (contra robo; uma live grande cabe com folga). */
  perWebinar: 20_000
} as const;

export const GUEST_ENTRY_MESSAGES = {
  closed: "Esta live não está aberta pelo link.",
  full: "As entradas pelo link desta live acabaram.",
  invalid: "Confira os dados e tente de novo.",
  tooMany: "Muitas tentativas deste endereço. Espere um minuto e tente de novo."
} as const;

export type GuestCredentials = { email: string; password: string; slug: string };

export type GuestEntryOutcome = { credentials: GuestCredentials; ok: true } | { errors: Extract<GuestEntryResult, { ok: false }>["errors"]; ok: false };

/** O endereco de quem pediu, pelo cabecalho que o proxy da frente poe (Vercel, Cloudflare, Caddy). */
export function requestAddress(headers: Headers): string {
  const candidates = [headers.get("x-vercel-forwarded-for"), headers.get("cf-connecting-ip"), headers.get("x-real-ip"), headers.get("x-forwarded-for")];

  for (const value of candidates) {
    const first = value?.split(",")[0]?.trim();
    if (first) {
      return first.slice(0, 64);
    }
  }

  return "sem-endereco";
}

/** O webinario aberto pelo link (publicado, nao apagado, nao cancelado e com o link ligado); senao, nulo. */
export async function loadOpenLinkWebinar(db: WebinarsDb, slug: string): Promise<Webinar | null> {
  const row = await fetchWebinarRowBySlug(db, slug);

  if (!row || row.deleted_at || row.status !== "published" || row.cancelled_at) {
    return null;
  }

  const webinar = webinarFromRow(row);

  return openLinkEnabled(webinar) ? webinar : null;
}

/** A proxima data do webinario para o formulario ("Quinta, 26/11 às 20:00"); sem sessao aberta, nulo. */
export async function openLinkNextWhen(db: WebinarsDb, webinar: Webinar, now = Date.now()): Promise<string | null> {
  const upcoming = nextSession((await listSessionRows(db, [webinar.id])).map(sessionFromRow), webinar.durationMinutes, now);

  return upcoming ? formatWebinarWhen(upcoming.scheduledAt) || null : null;
}

function guestEmail() {
  return `convidado-${randomUUID()}@convidados.invalid`;
}

function guestPassword() {
  return randomBytes(24).toString("base64url");
}

/** Cria a conta de convidado e grava a entrada; devolve o que o navegador usa para entrar. */
export async function enterByOpenLink(input: { address: string; body: unknown; now?: Date; slug: string }, db: WebinarsDb = webinarsDb()): Promise<GuestEntryOutcome> {
  const now = input.now ?? new Date();
  const parsed = guestEntryBodySchema.safeParse(input.body);

  if (!parsed.success) {
    throw new WebinarError(GUEST_ENTRY_MESSAGES.invalid, 400);
  }

  if (!takeStudentWrite(`open-link:${input.address}`, now.getTime())) {
    throw new WebinarError(GUEST_ENTRY_MESSAGES.tooMany, 429);
  }

  const webinar = await loadOpenLinkWebinar(db, input.slug);

  if (!webinar) {
    throw new WebinarError(GUEST_ENTRY_MESSAGES.closed, 404);
  }

  // O campo escondido preenchido e robo: a resposta parece a de sempre, sem criar nada.
  if (parsed.data.website.trim()) {
    throw new WebinarError(GUEST_ENTRY_MESSAGES.invalid, 400);
  }

  const checked = validateGuestEntry(webinar.openLink, parsed.data, webinar.title);

  if (!checked.ok) {
    return { errors: checked.errors, ok: false };
  }

  if ((await countGuestRows(db, webinar.id)) >= GUEST_ENTRY_LIMITS.perWebinar) {
    throw new WebinarError(GUEST_ENTRY_MESSAGES.full, 409);
  }

  const email = guestEmail();
  const password = guestPassword();
  const fullName = checked.entry.name ?? GUEST_DEFAULT_NAME;
  const { data, error } = await db.auth.admin.createUser({
    app_metadata: { [GUEST_APP_METADATA_KEY]: { slug: webinar.slug, webinar_id: webinar.id } },
    email,
    email_confirm: true,
    password,
    user_metadata: { full_name: fullName }
  });

  if (error || !data.user) {
    throw new Error(`Webinarios: conta de convidado: ${error?.message ?? "resposta vazia do Auth"}`);
  }

  const userId = data.user.id;

  try {
    await markGuestProfile(db, { email: checked.entry.email, fullName, phone: checked.entry.phone, userId });
    await insertGuestRow(
      db,
      {
        consentText: checked.entry.consentText,
        email: checked.entry.email,
        fullName: checked.entry.name,
        phone: checked.entry.phone,
        source: checked.entry.source,
        userId,
        webinarId: webinar.id
      },
      now
    );
  } catch (failure) {
    // Sem a marca, a conta seria um aluno a mais: sai.
    await db.auth.admin.deleteUser(userId).catch((cleanup: unknown) => {
      console.error(`[webinarios] conta de convidado sem marca nao saiu (${userId}): ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`);
    });
    throw failure;
  }

  return { credentials: { email, password, slug: webinar.slug }, ok: true };
}
