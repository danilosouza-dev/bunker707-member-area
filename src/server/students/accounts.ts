import "server-only";

// Contas dos alunos no Supabase Auth (API admin). Toda escrita em auth.users passa por aqui.
// O e-mail sai pelo provedor SMTP configurado no Supabase (em producao, Amazon SES); sem SMTP
// proprio, o Supabase hospedado so entrega para membros da equipe e limita a poucos por hora.

import { randomInt } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { AccessDeliveryMethod, StudentAccount } from "./model";
import { fetchProfileByEmail, type StudentsDb } from "./store";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 10;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function generateTemporaryPassword(length = 14) {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");
}

function authError(context: string, message: string | undefined) {
  return new Error(`${context}: ${message ?? "resposta vazia do Supabase Auth"}`);
}

export async function getAccountById(db: StudentsDb, userId: string): Promise<User | null> {
  const { data, error } = await db.auth.admin.getUserById(userId);

  if (error) {
    // Conta apagada direto no painel: o perfil pode ter sobrado; a tela mostra "sem conta".
    if (error.status === 404) {
      return null;
    }

    throw authError("Conta do aluno", error.message);
  }

  return data.user ?? null;
}

/** Procura pelo perfil (indice por e-mail) e, se nao houver, varre a lista do Auth. */
export async function findAccountByEmail(db: StudentsDb, email: string): Promise<User | null> {
  const normalized = normalizeEmail(email);
  const profile = await fetchProfileByEmail(db, normalized);

  if (profile) {
    const account = await getAccountById(db, profile.id);

    if (account && normalizeEmail(account.email ?? "") === normalized) {
      return account;
    }
  }

  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });

    if (error) {
      throw authError("Consulta de contas", error.message);
    }

    const found = data.users.find((user) => normalizeEmail(user.email ?? "") === normalized);

    if (found || data.users.length < LIST_PAGE_SIZE) {
      return found ?? null;
    }
  }

  return null;
}

export function accountSummaryOf(user: User): StudentAccount {
  const metadata = (user.user_metadata ?? {}) as { must_change_password?: unknown };

  return {
    createdAt: user.created_at,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    invitePending: !user.last_sign_in_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    mustChangePassword: metadata.must_change_password === true
  };
}

function metadataFor(user: User | null, fullName: string | null, delivery: AccessDeliveryMethod) {
  const current = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const next: Record<string, unknown> = {
    ...current,
    full_name: fullName?.trim() || current.full_name,
    must_change_password: delivery !== "none" ? true : current.must_change_password === true
  };

  if (delivery !== "none") {
    next.access_delivery_method = delivery;
  }

  if (delivery === "temporary_password") {
    next.temporary_password_created_at = new Date().toISOString();
  }

  return next;
}

/** Conta nova + e-mail de convite (link cria a senha). */
export async function inviteAccount(db: StudentsDb, input: { email: string; fullName: string | null; redirectTo: string }) {
  const { data, error } = await db.auth.admin.inviteUserByEmail(normalizeEmail(input.email), {
    data: metadataFor(null, input.fullName, "invite"),
    redirectTo: input.redirectTo
  });

  if (error || !data.user) {
    throw authError("Convite por e-mail", error?.message);
  }

  return data.user;
}

/** Conta existente: e-mail para criar/redefinir a senha (mesmo link do convite). */
export async function sendAccessEmail(db: StudentsDb, user: User, input: { fullName: string | null; redirectTo: string }) {
  const email = normalizeEmail(user.email ?? "");

  if (!email) {
    throw new Error("E-mail de acesso: a conta não tem e-mail.");
  }

  const update = await db.auth.admin.updateUserById(user.id, { user_metadata: metadataFor(user, input.fullName, "invite") });

  if (update.error) {
    throw authError("E-mail de acesso", update.error.message);
  }

  const reset = await db.auth.resetPasswordForEmail(email, { redirectTo: input.redirectTo });

  if (reset.error) {
    throw authError("E-mail de acesso", reset.error.message);
  }
}

export async function createAccountWithPassword(
  db: StudentsDb,
  input: { email: string; fullName: string | null; password: string }
) {
  const { data, error } = await db.auth.admin.createUser({
    email: normalizeEmail(input.email),
    email_confirm: true,
    password: input.password,
    user_metadata: metadataFor(null, input.fullName, "temporary_password")
  });

  if (error || !data.user) {
    throw authError("Conta com senha temporária", error?.message);
  }

  return data.user;
}

export async function setTemporaryPassword(db: StudentsDb, user: User, input: { fullName: string | null; password: string }) {
  const { data, error } = await db.auth.admin.updateUserById(user.id, {
    email_confirm: true,
    password: input.password,
    user_metadata: metadataFor(user, input.fullName, "temporary_password")
  });

  if (error || !data.user) {
    throw authError("Senha temporária", error?.message);
  }

  return data.user;
}

/** "Não enviar agora": a conta existe (sem senha) e o aluno entra quando receber o e-mail de acesso. */
export async function createAccountWithoutEmail(db: StudentsDb, input: { email: string; fullName: string | null }) {
  const { data, error } = await db.auth.admin.createUser({
    email: normalizeEmail(input.email),
    email_confirm: true,
    user_metadata: metadataFor(null, input.fullName, "none")
  });

  if (error || !data.user) {
    throw authError("Criar conta", error?.message);
  }

  return data.user;
}

export async function updateAccountName(db: StudentsDb, user: User, fullName: string) {
  const current = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const { error } = await db.auth.admin.updateUserById(user.id, { user_metadata: { ...current, full_name: fullName } });

  if (error) {
    throw authError("Nome do aluno", error.message);
  }
}

/** Apaga a conta; profiles, entitlements e student_events somem em cascata. */
export async function deleteAccount(db: StudentsDb, userId: string) {
  const { error } = await db.auth.admin.deleteUser(userId);

  if (error && error.status !== 404) {
    throw authError("Excluir conta", error.message);
  }
}
