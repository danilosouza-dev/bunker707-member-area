import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requireApiAdmin } from "@/server/auth/guards";
import {
  getSupabaseAdminClient,
  hasSupabaseConfig
} from "@/server/db/supabase/client";

type StudentAccessMethod = "invite" | "temporary_password";

type StudentAccessCourseInput = {
  endsAt?: string;
  id?: string;
  sourceProvider?: string;
  startsAt?: string;
  status?: "active" | "suspended" | "revoked" | "expired";
  targetId?: string;
  targetType?: "formation" | "standalone_course" | "mentorship" | "webinar" | "product" | "bootcamp";
};

type StudentAccessInput = {
  courses?: StudentAccessCourseInput[];
  email?: string;
  fullName?: string;
  id?: string;
  phone?: string;
  sourceProvider?: string;
};

type StudentAccessPayload = {
  method?: StudentAccessMethod;
  student?: StudentAccessInput;
  temporaryPassword?: string;
};

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

const temporaryPasswordCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeSourceProvider(provider?: string) {
  const normalizedProvider = provider?.trim().toLowerCase();

  if (!normalizedProvider) {
    return "manual";
  }

  return normalizedProvider === "tiktok" ? "tiktok" : normalizedProvider;
}

function getRedirectTo(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const redirectUrl = new URL("/auth/callback", requestUrl.origin);
  redirectUrl.searchParams.set("next", "/alterar-senha");
  redirectUrl.searchParams.set("provider", "email");
  return redirectUrl.toString();
}

function generateTemporaryPassword() {
  return Array.from({ length: 14 }, () => (
    temporaryPasswordCharacters[randomInt(temporaryPasswordCharacters.length)]
  )).join("");
}

function parseDateLabelToIso(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue || /^vital[ií]cio$/i.test(trimmedValue) || /^bloqueado/i.test(trimmedValue)) {
    return null;
  }

  const brazilianDateMatch = trimmedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (brazilianDateMatch) {
    const [, day, month, year] = brazilianDateMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12)).toISOString();
  }

  const parsedDate = new Date(trimmedValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
}

function getUserMetadata(user: User | null, student: StudentAccessInput, deliveryMethod: StudentAccessMethod) {
  const currentMetadata =
    user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const nextMetadata = {
    ...currentMetadata,
    access_delivery_method: deliveryMethod,
    full_name: student.fullName?.trim() || user?.user_metadata?.full_name,
    must_change_password: true
  };

  if (deliveryMethod === "temporary_password") {
    return {
      ...nextMetadata,
      temporary_password_created_at: new Date().toISOString()
    };
  }

  return nextMetadata;
}

async function findAuthUserByEmail(supabase: SupabaseAdminClient, email: string) {
  const normalizedEmail = normalizeEmail(email);

  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000
    });

    if (error) {
      throw new Error(`Nao foi possivel consultar usuarios do Supabase Auth: ${error.message}`);
    }

    const foundUser = data.users.find((user) => normalizeEmail(user.email ?? "") === normalizedEmail);

    if (foundUser || data.users.length < 1000) {
      return foundUser ?? null;
    }
  }

  return null;
}

async function ensureUserForInvite(
  supabase: SupabaseAdminClient,
  request: NextRequest,
  student: StudentAccessInput
) {
  const email = normalizeEmail(student.email ?? "");
  const existingUser = await findAuthUserByEmail(supabase, email);
  const redirectTo = getRedirectTo(request);

  if (existingUser) {
    const updateResult = await supabase.auth.admin.updateUserById(existingUser.id, {
      user_metadata: getUserMetadata(existingUser, student, "invite")
    });

    if (updateResult.error || !updateResult.data.user) {
      throw new Error(updateResult.error?.message ?? "Nao foi possivel atualizar o usuario antes do envio.");
    }

    const resetResult = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo
    });

    if (resetResult.error) {
      throw new Error(`Nao foi possivel enviar o email de acesso: ${resetResult.error.message}`);
    }

    return updateResult.data.user;
  }

  const inviteResult = await supabase.auth.admin.inviteUserByEmail(email, {
    data: getUserMetadata(null, student, "invite"),
    redirectTo
  });

  if (inviteResult.error || !inviteResult.data.user) {
    throw new Error(inviteResult.error?.message ?? "Nao foi possivel enviar o convite.");
  }

  return inviteResult.data.user;
}

async function ensureUserWithTemporaryPassword(
  supabase: SupabaseAdminClient,
  student: StudentAccessInput,
  temporaryPassword: string
) {
  const email = normalizeEmail(student.email ?? "");
  const existingUser = await findAuthUserByEmail(supabase, email);

  if (existingUser) {
    const updateResult = await supabase.auth.admin.updateUserById(existingUser.id, {
      email_confirm: true,
      password: temporaryPassword,
      user_metadata: getUserMetadata(existingUser, student, "temporary_password")
    });

    if (updateResult.error || !updateResult.data.user) {
      throw new Error(updateResult.error?.message ?? "Nao foi possivel atualizar a senha temporaria.");
    }

    return updateResult.data.user;
  }

  const createResult = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password: temporaryPassword,
    user_metadata: getUserMetadata(null, student, "temporary_password")
  });

  if (createResult.error || !createResult.data.user) {
    throw new Error(createResult.error?.message ?? "Nao foi possivel criar o usuario com senha temporaria.");
  }

  return createResult.data.user;
}

async function upsertStudentProfile(
  supabase: SupabaseAdminClient,
  userId: string,
  student: StudentAccessInput
) {
  const { error } = await supabase.from("profiles").upsert({
    email: normalizeEmail(student.email ?? ""),
    full_name: student.fullName?.trim() || null,
    id: userId,
    phone: student.phone?.trim() || null
  }, {
    onConflict: "id"
  });

  if (error) {
    throw new Error(`Nao foi possivel salvar o perfil do aluno: ${error.message}`);
  }
}

async function upsertStudentEntitlements(
  supabase: SupabaseAdminClient,
  userId: string,
  student: StudentAccessInput
) {
  const courses = student.courses ?? [];

  for (const course of courses) {
    if (!course.targetId || !course.targetType) {
      continue;
    }

    const sourceProvider = normalizeSourceProvider(course.sourceProvider ?? student.sourceProvider);
    const entitlementRow = {
      ends_at: parseDateLabelToIso(course.endsAt),
      product_id: course.targetId,
      source_event_id: `admin-student:${student.id ?? userId}:${course.id ?? course.targetId}`,
      source_provider: sourceProvider,
      starts_at: parseDateLabelToIso(course.startsAt) ?? new Date().toISOString(),
      status: course.status ?? "active",
      target_id: course.targetId,
      target_type: course.targetType,
      user_id: userId
    };
    const existingResult = await supabase
      .from("entitlements")
      .select("id")
      .eq("user_id", userId)
      .eq("target_type", course.targetType)
      .eq("target_id", course.targetId)
      .limit(1)
      .maybeSingle();

    if (existingResult.error) {
      throw new Error(`Nao foi possivel consultar entitlement existente: ${existingResult.error.message}`);
    }

    const writeResult = existingResult.data?.id
      ? await supabase.from("entitlements").update(entitlementRow).eq("id", existingResult.data.id)
      : await supabase.from("entitlements").insert(entitlementRow);

    if (writeResult.error) {
      throw new Error(`Nao foi possivel salvar entitlement do aluno: ${writeResult.error.message}`);
    }
  }
}

async function recordAccessEvent(
  supabase: SupabaseAdminClient,
  userId: string,
  student: StudentAccessInput,
  method: StudentAccessMethod
) {
  const { error } = await supabase.from("student_events").insert({
    entity_id: student.id ?? userId,
    entity_type: "auth",
    event_type: method === "temporary_password" ? "temporary_password_created" : "access_email_sent",
    metadata: {
      delivery_method: method,
      source: "admin_crm"
    },
    user_id: userId
  });

  if (error) {
    throw new Error(`Nao foi possivel registrar o evento de acesso: ${error.message}`);
  }
}

function validatePayload(payload: StudentAccessPayload) {
  const method = payload.method;
  const student = payload.student;
  const email = normalizeEmail(student?.email ?? "");

  if (method !== "invite" && method !== "temporary_password") {
    return "Metodo de acesso invalido.";
  }

  if (!student || !email) {
    return "Informe o email do aluno.";
  }

  if (method === "temporary_password" && payload.temporaryPassword && payload.temporaryPassword.length < 8) {
    return "A senha temporaria precisa ter pelo menos 8 caracteres.";
  }

  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAdmin({ roles: ["owner", "admin"] });

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as StudentAccessPayload;
  const validationError = validatePayload(payload);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const method = payload.method as StudentAccessMethod;
  const student = payload.student as StudentAccessInput;
  const temporaryPassword =
    method === "temporary_password" ? payload.temporaryPassword?.trim() || generateTemporaryPassword() : undefined;

  if (!hasSupabaseConfig()) {
    return NextResponse.json({
      error: "Supabase nao configurado. Acesso de aluno so pode ser criado em dados reais."
    }, { status: 503 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const user = method === "invite"
      ? await ensureUserForInvite(supabase, request, student)
      : await ensureUserWithTemporaryPassword(supabase, student, temporaryPassword as string);

    await upsertStudentProfile(supabase, user.id, student);
    await upsertStudentEntitlements(supabase, user.id, student);
    await recordAccessEvent(supabase, user.id, student, method);

    return NextResponse.json({
      data: {
        authUserId: user.id,
        method,
        status: method === "invite" ? "sent" : "prepared",
        temporaryPassword
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Nao foi possivel preparar o acesso do aluno."
    }, { status: 500 });
  }
}
