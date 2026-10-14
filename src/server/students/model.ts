// Alunos do admin (docs/17 §1.7): tipos e regras puras. Sem "server-only" e sem React: os testes
// carregam este arquivo direto pelo Node e os componentes do admin importam so os tipos e rotulos.
//
// Fonte dos dados: contas do Supabase Auth + `profiles` (nome, telefone, foto), `entitlements`
// (acessos; unica fonte de autorizacao) e `lesson_progress` (estudo). Nao existe mais a tabela
// `students` do admin antigo.

import type { ProductAccent, ProductFormat } from "@/server/catalog/model";

/* ------------------------------------------------------------------------------------------------
 * Ritmo (docs/17 §1.11): Estudando / Em risco (>= 14 dias sem estudar) / Inativo (>= 30 dias) /
 * Nunca começou / Concluiu. Enquanto nao ha medicao de minutos assistidos, "estudar" = qualquer
 * progresso gravado numa aula (rotulado "aproximado" na tela).
 * ---------------------------------------------------------------------------------------------- */

export const STUDENT_PACES = ["studying", "at_risk", "inactive", "never_started", "completed"] as const;
export type StudentPace = (typeof STUDENT_PACES)[number];

export const STUDENT_PACE_LABELS: Record<StudentPace, string> = {
  at_risk: "Em risco",
  completed: "Concluiu",
  inactive: "Inativo",
  never_started: "Nunca começou",
  studying: "Estudando"
};

export const PACE_AT_RISK_DAYS = 14;
export const PACE_INACTIVE_DAYS = 30;

const DAY_MS = 86_400_000;

export function isStudentPace(value: unknown): value is StudentPace {
  return typeof value === "string" && (STUDENT_PACES as readonly string[]).includes(value);
}

export function paceOf(input: {
  completedLessons: number;
  lastStudiedAt: string | null;
  now: number;
  totalLessons: number;
}): StudentPace {
  if (!input.lastStudiedAt) {
    return "never_started";
  }

  if (input.totalLessons > 0 && input.completedLessons >= input.totalLessons) {
    return "completed";
  }

  const studiedAt = Date.parse(input.lastStudiedAt);

  if (Number.isNaN(studiedAt)) {
    return "never_started";
  }

  const days = (input.now - studiedAt) / DAY_MS;

  if (days >= PACE_INACTIVE_DAYS) {
    return "inactive";
  }

  if (days >= PACE_AT_RISK_DAYS) {
    return "at_risk";
  }

  return "studying";
}

/* ------------------------------------------------------------------------------------------------
 * Acessos (entitlements)
 * ---------------------------------------------------------------------------------------------- */

export const ENTITLEMENT_STATUSES = ["active", "suspended", "revoked", "expired"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const ENTITLEMENT_TARGET_TYPES = [
  "platform",
  "formation",
  "standalone_course",
  "mentorship",
  "webinar",
  "product",
  "bootcamp"
] as const;
export type EntitlementTargetType = (typeof ENTITLEMENT_TARGET_TYPES)[number];

/** Mesma regra de src/server/access/*: o tipo do alvo do acesso vem do tipo do conteudo. */
export function targetTypeForContentKind(kind: string): EntitlementTargetType {
  if (kind === "Formacao") return "formation";
  if (kind === "Mentoria") return "mentorship";
  if (kind === "Webinario") return "webinar";
  if (kind === "Produto") return "product";
  if (kind === "Bootcamp") return "bootcamp";
  return "standalone_course";
}

/**
 * Situacao mostrada ao produtor, derivada do status gravado e das datas. "expiring" = ativo e termina
 * em ate 30 dias; "expired" vale tanto para status 'expired' quanto para ativo com ends_at no passado.
 */
export type AccessState = "active" | "expiring" | "scheduled" | "expired" | "suspended" | "revoked";

export const ACCESS_STATE_LABELS: Record<AccessState, string> = {
  active: "Ativo",
  expired: "Expirado",
  expiring: "Expira em breve",
  revoked: "Revogado",
  scheduled: "Agendado",
  suspended: "Suspenso"
};

export const ACCESS_EXPIRING_DAYS = 30;

export function accessStateOf(input: { endsAt: string | null; now: number; startsAt: string; status: EntitlementStatus }): AccessState {
  if (input.status === "revoked" || input.status === "suspended" || input.status === "expired") {
    return input.status;
  }

  const startsAt = Date.parse(input.startsAt);

  if (!Number.isNaN(startsAt) && startsAt > input.now) {
    return "scheduled";
  }

  if (input.endsAt) {
    const endsAt = Date.parse(input.endsAt);

    if (!Number.isNaN(endsAt)) {
      if (endsAt <= input.now) {
        return "expired";
      }

      if (endsAt - input.now <= ACCESS_EXPIRING_DAYS * DAY_MS) {
        return "expiring";
      }
    }
  }

  return "active";
}

/** Acesso que libera conteudo agora (mesma regra de isActiveEntitlement em src/server/access). */
export function isAccessOpen(state: AccessState) {
  return state === "active" || state === "expiring";
}

export const SOURCE_PROVIDER_LABELS: Record<string, string> = {
  hotmart: "Hotmart",
  kiwify: "Kiwify",
  manual: "Liberado pela equipe",
  ticto: "Ticto",
  tiktok: "TikTok"
};

export function sourceProviderLabel(provider: string) {
  return SOURCE_PROVIDER_LABELS[provider] ?? provider;
}

/* ------------------------------------------------------------------------------------------------
 * Entrega do acesso (docs/17 §1.7.2)
 * ---------------------------------------------------------------------------------------------- */

export const ACCESS_DELIVERY_METHODS = ["invite", "temporary_password", "none"] as const;
export type AccessDeliveryMethod = (typeof ACCESS_DELIVERY_METHODS)[number];

export const ACCESS_DELIVERY_LABELS: Record<AccessDeliveryMethod, string> = {
  invite: "Convite por e-mail",
  none: "Não enviar agora",
  temporary_password: "Senha temporária"
};

export const TEMPORARY_PASSWORD_MIN_LENGTH = 8;

/** Texto pronto para mandar ao aluno pelo WhatsApp ou e-mail com a senha temporaria. */
export function temporaryPasswordMessage(input: { email: string; fullName: string; password: string }) {
  const firstName = input.fullName.trim().split(/\s+/)[0] || "aluno";

  return [
    `Olá, ${firstName}! Seu acesso à área de membros foi liberado.`,
    `E-mail: ${input.email}`,
    `Senha temporária: ${input.password}`,
    "No primeiro login, a plataforma pede para você criar uma nova senha."
  ].join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * Tipos das telas
 * ---------------------------------------------------------------------------------------------- */

export type StudentProductChip = {
  accent: ProductAccent;
  coverUrl: string | null;
  format: ProductFormat;
  id: string;
  title: string;
};

export type StudentListItem = {
  avatarUrl: string | null;
  completedLessons: number;
  createdAt: string;
  email: string;
  fullName: string;
  id: string;
  /** Faz parte da equipe (admin_roles). Nunca entra nas metricas; na lista ganha o chip "Equipe". */
  isStaff: boolean;
  lastStudiedAt: string | null;
  pace: StudentPace;
  /** Produtos com acesso aberto agora, em ordem alfabetica. */
  products: StudentProductChip[];
  totalLessons: number;
};

export type StudentListQuery = {
  page: number;
  pace?: StudentPace;
  pageSize: number;
  productId?: string;
  q?: string;
};

export type StudentListPage = {
  items: StudentListItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type StudentAccessItem = {
  endsAt: string | null;
  id: string;
  /** null quando o produto foi excluido do catalogo. */
  product: StudentProductChip | null;
  sourceProvider: string;
  startsAt: string;
  state: AccessState;
  status: EntitlementStatus;
  targetId: string;
  targetType: EntitlementTargetType;
};

export type StudentProgressItem = {
  completedLessons: number;
  lastStudiedAt: string | null;
  product: StudentProductChip;
  totalLessons: number;
};

export type StudentTimelineEvent = {
  at: string;
  id: string;
  text: string;
};

export type StudentAccount = {
  createdAt: string;
  emailConfirmedAt: string | null;
  /** Convite enviado e ainda sem primeiro login. */
  invitePending: boolean;
  lastSignInAt: string | null;
  mustChangePassword: boolean;
};

export type StudentDetail = {
  accesses: StudentAccessItem[];
  account: StudentAccount | null;
  avatarUrl: string | null;
  createdAt: string;
  email: string;
  fullName: string;
  id: string;
  isStaff: boolean;
  lastStudiedAt: string | null;
  pace: StudentPace;
  phone: string | null;
  progress: StudentProgressItem[];
  timeline: StudentTimelineEvent[];
};

/** Opcao do seletor "Liberar acesso para..." na aba Alunos do produto. */
export type StudentOption = {
  avatarUrl: string | null;
  email: string;
  fullName: string;
  /** Ja tem acesso aberto ao produto em questao. */
  hasAccess: boolean;
  id: string;
};

export type CreatedStudentResult = {
  delivery: AccessDeliveryMethod;
  email: string;
  fullName: string;
  /** Conta ja existia (so o perfil e os acessos foram atualizados). */
  existingAccount: boolean;
  grantedProductIds: string[];
  id: string;
  /** So quando delivery = temporary_password. Nunca fica gravada. */
  temporaryPassword?: string;
};

export function describeStudentCount(count: number) {
  return count === 1 ? "1 aluno" : `${new Intl.NumberFormat("pt-BR").format(count)} alunos`;
}

export function lessonsProgressLabel(completed: number, total: number) {
  if (total <= 0) {
    return "Sem aulas publicadas";
  }

  return `${completed} de ${total} ${total === 1 ? "aula" : "aulas"}`;
}

export function progressPercentOf(completed: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

/* ------------------------------------------------------------------------------------------------
 * Datas
 * ---------------------------------------------------------------------------------------------- */

/** "AAAA-MM-DD" escolhido no formulario -> fim desse dia no fuso da escola (America/Sao_Paulo, sem horario de verao). */
export function accessEndDateToIso(date: string | null | undefined) {
  if (!date) {
    return null;
  }

  const parsed = new Date(`${date}T23:59:59.999-03:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Soma dias ao fim atual do acesso (ou a agora, se ja passou ou nao ha fim). */
export function extendAccessIso(currentEndsAt: string | null, days: number, now: number) {
  const current = currentEndsAt ? Date.parse(currentEndsAt) : Number.NaN;
  const base = Number.isNaN(current) || current < now ? now : current;

  return new Date(base + days * DAY_MS).toISOString();
}
