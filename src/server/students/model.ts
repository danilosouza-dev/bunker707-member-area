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
  /** Turmas dos produtos com acesso aberto. */
  cohorts: StudentCohortMembership[];
  completedLessons: number;
  createdAt: string;
  email: string;
  fullName: string;
  id: string;
  /** Faz parte da equipe (admin_roles). Nunca entra nas metricas; na lista ganha o chip "Equipe". */
  isStaff: boolean;
  /** Copiado de auth.users pelo gatilho; null = nunca entrou. */
  lastSignInAt: string | null;
  lastStudiedAt: string | null;
  pace: StudentPace;
  /** Produtos com acesso aberto agora, em ordem alfabetica. */
  products: StudentProductChip[];
  totalLessons: number;
};

export type StudentListQuery = StudentListParams & {
  page: number;
  pageSize: number;
};

export type StudentListPage = {
  items: StudentListItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type StudentAccessItem = {
  /** Turma do aluno neste produto, se houver. */
  cohort: StudentCohort | null;
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

/* ------------------------------------------------------------------------------------------------
 * Filtros da lista (entrega 2): alem de busca, produto e ritmo, a lista aceita turma, "expira em 30
 * dias", "nunca entrou", "comprou e nao comecou", "top comentadores" e um grupo do ciclo de vida.
 * Os mesmos parametros vivem no endereco (?busca=&produto=&ritmo=&turma=&expira=30&conta=nunca&
 * comecou=nao&comentadores=top&semana=&grupo=) e nos segmentos salvos (forma canonica abaixo).
 * ---------------------------------------------------------------------------------------------- */

export const LIFECYCLE_GROUPS = ["new", "retained", "recovered", "inactive"] as const;
export type LifecycleGroup = (typeof LIFECYCLE_GROUPS)[number];

export const LIFECYCLE_GROUP_LABELS: Record<LifecycleGroup, string> = {
  inactive: "Inativos",
  new: "Novos",
  recovered: "Recuperados",
  retained: "Retidos"
};

/** Formula de cada grupo, visivel no cartao (docs/17 §1.11: nenhuma metrica sem formula). */
export const LIFECYCLE_GROUP_FORMULAS: Record<LifecycleGroup, string> = {
  inactive: "Acesso aberto há pelo menos 4 semanas e nenhuma semana ativa nas últimas 4",
  new: "Primeira semana ativa de toda a história do aluno",
  recovered: "Ativo nesta semana, parado na anterior, com atividade antes",
  retained: "Ativo nesta semana e na anterior"
};

export const LIFECYCLE_ACTIVE_SECONDS = 600;
export const LIFECYCLE_WEEKS = 12;
export const LIFECYCLE_ACTIVE_RULE = "Semana ativa = 10 minutos assistidos ou 1 aula concluída. A equipe não entra.";

export function isLifecycleGroup(value: unknown): value is LifecycleGroup {
  return typeof value === "string" && (LIFECYCLE_GROUPS as readonly string[]).includes(value);
}

export type LifecycleWeek = {
  inactiveCount: number;
  newCount: number;
  recoveredCount: number;
  retainedCount: number;
  /** Segunda-feira da semana, "AAAA-MM-DD". */
  weekStart: string;
};

/** Forma canonica dos filtros (o que fica no endereco e no segmento salvo). */
export type StudentListParams = {
  account?: "never";
  cohortId?: string;
  commenters?: "top";
  expiring?: boolean;
  group?: LifecycleGroup;
  notStarted?: boolean;
  pace?: StudentPace;
  productId?: string;
  q?: string;
  /** Segunda-feira "AAAA-MM-DD" do ciclo de vida; so vale junto com `group`. */
  week?: string;
};

export const STUDENT_LIST_PARAM_NAMES = {
  account: "conta",
  cohortId: "turma",
  commenters: "comentadores",
  expiring: "expira",
  group: "grupo",
  notStarted: "comecou",
  pace: "ritmo",
  page: "pagina",
  productId: "produto",
  q: "busca",
  week: "semana"
} as const;

/** Parametros do endereco a partir dos filtros canonicos (ordem fixa; vazio nao entra). */
export function studentListParamsToSearch(params: StudentListParams, page?: number) {
  const search = new URLSearchParams();
  const n = STUDENT_LIST_PARAM_NAMES;

  if (params.productId) search.set(n.productId, params.productId);
  if (params.pace) search.set(n.pace, params.pace);
  if (params.cohortId) search.set(n.cohortId, params.cohortId);
  if (params.expiring) search.set(n.expiring, "30");
  if (params.account) search.set(n.account, "nunca");
  if (params.notStarted) search.set(n.notStarted, "nao");
  if (params.commenters) search.set(n.commenters, "top");
  if (params.week && params.group) {
    search.set(n.week, params.week);
    search.set(n.group, params.group);
  }
  if (params.q?.trim()) search.set(n.q, params.q.trim());
  if (page && page > 1) search.set(n.page, String(page));

  return search;
}

export function hasStudentListFilters(params: StudentListParams) {
  return Boolean(
    params.productId || params.pace || params.cohortId || params.expiring || params.account || params.notStarted || params.commenters || (params.week && params.group) || params.q?.trim()
  );
}

/**
 * Filtros da lista em duas partes: a BASE (produto, turma, busca) continua quando o produtor troca de
 * segmento; o SEGMENTO (ritmo, prazo, login, comecou, comentadores, semana do ciclo de vida) e o que
 * cada pilula define. Assim as contagens das pilulas valem para o produto, a turma e a busca atuais.
 */
const BASE_PARAM_KEYS = ["productId", "cohortId", "q"] as const;
const SEGMENT_PARAM_KEYS = ["pace", "expiring", "account", "notStarted", "commenters", "week", "group"] as const;

function isFilled(value: unknown) {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

/** So as chaves conhecidas dos filtros, sem vazios (descarta pagina, tamanho da pagina e o que vier a mais). */
export function pickStudentListParams(value: Readonly<Record<string, unknown>>): StudentListParams {
  const params: Record<string, unknown> = {};

  for (const key of [...BASE_PARAM_KEYS, ...SEGMENT_PARAM_KEYS]) {
    const raw = value[key];
    const normalized = typeof raw === "string" ? raw.trim() : raw;

    if (isFilled(normalized)) {
      params[key] = normalized;
    }
  }

  return params as StudentListParams;
}

export function splitStudentListParams(params: StudentListParams): { base: StudentListParams; segment: StudentListParams } {
  const picked = pickStudentListParams(params);
  const base: Record<string, unknown> = {};
  const segment: Record<string, unknown> = {};

  for (const key of BASE_PARAM_KEYS) {
    if (isFilled(picked[key])) base[key] = picked[key];
  }

  for (const key of SEGMENT_PARAM_KEYS) {
    if (isFilled(picked[key])) segment[key] = picked[key];
  }

  return { base: base as StudentListParams, segment: segment as StudentListParams };
}

/** Mesmos filtros, sem depender da ordem das chaves nem de valores vazios. */
export function sameStudentListParams(left: StudentListParams, right: StudentListParams) {
  const canonical = (params: StudentListParams) => {
    const picked = pickStudentListParams(params);

    return JSON.stringify(Object.keys(picked).sort().map((key) => [key, picked[key as keyof StudentListParams]]));
  };

  return canonical(left) === canonical(right);
}

/** Filtros sem a semana do ciclo de vida (uma semana fixa nao vira segmento salvo). */
export function withoutLifecycle(params: StudentListParams): StudentListParams {
  const picked = pickStudentListParams(params);
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(picked)) {
    if (key !== "week" && key !== "group") next[key] = value;
  }

  return next as StudentListParams;
}

/* ------------------------------------------------------------------------------------------------
 * Segmentos prontos (docs/17 §1.7.1), cada um com a regra escrita para o produtor.
 * ---------------------------------------------------------------------------------------------- */

export type StudentSegmentPreset = {
  formula: string;
  id: string;
  label: string;
  params: StudentListParams;
  /** "main" = pilula na linha de cima; "more" = menu "Mais segmentos". */
  placement: "main" | "more";
};

export const STUDENT_SEGMENT_PRESETS: readonly StudentSegmentPreset[] = [
  { formula: "Todos os alunos com os filtros atuais.", id: "todos", label: "Todos", params: {}, placement: "main" },
  { formula: "Progresso gravado em aula há menos de 14 dias.", id: "estudando", label: "Estudando", params: { pace: "studying" }, placement: "main" },
  { formula: "Entre 14 e 29 dias sem progresso em aula.", id: "em-risco", label: "Em risco", params: { pace: "at_risk" }, placement: "main" },
  { formula: "30 dias ou mais sem progresso em aula.", id: "inativos", label: "Inativos", params: { pace: "inactive" }, placement: "main" },
  { formula: "Nenhum progresso gravado em aula.", id: "nunca-comecaram", label: "Nunca começaram", params: { pace: "never_started" }, placement: "main" },
  { formula: "Todas as aulas publicadas dos produtos com acesso concluídas.", id: "concluiram", label: "Concluíram", params: { pace: "completed" }, placement: "main" },
  { formula: "Acesso ativo que termina em até 30 dias.", id: "expiram-30", label: "Expiram em 30 dias", params: { expiring: true }, placement: "more" },
  { formula: "Conta criada e nenhum login até agora.", id: "nunca-entraram", label: "Nunca entraram", params: { account: "never" }, placement: "more" },
  { formula: "Acesso liberado há 2 a 7 dias e nenhum progresso em aula.", id: "compraram-nao-comecaram", label: "Compraram e não começaram", params: { notStarted: true }, placement: "more" },
  { formula: "Mesma régua de Comunidade › Top alunos (os 100 primeiros por pontuação): comentários aprovados, respostas a colegas e reações recebidas em 28 dias.", id: "top-comentadores", label: "Top comentadores", params: { commenters: "top" }, placement: "more" }
];

export const NOT_STARTED_MIN_DAYS = 2;
export const NOT_STARTED_MAX_DAYS = 7;

export type StudentSavedSegment = {
  createdAt: string;
  id: string;
  name: string;
  params: StudentListParams;
};

/* ------------------------------------------------------------------------------------------------
 * Liberar acesso nunca encurta (decisao da revisao de 2026-10-15): quem ja tem acesso aberto fica
 * com o maior prazo, e "sem prazo" vence qualquer data. Quem nao tem acesso aberto recebe o prazo pedido.
 * ---------------------------------------------------------------------------------------------- */

export function nextAccessEndOnGrant(input: { existingEndsAt: string | null; requestedEndsAt: string | null; wasOpen: boolean }) {
  if (!input.wasOpen) {
    return input.requestedEndsAt;
  }

  if (input.existingEndsAt === null || input.requestedEndsAt === null) {
    return null;
  }

  return Date.parse(input.existingEndsAt) >= Date.parse(input.requestedEndsAt) ? input.existingEndsAt : input.requestedEndsAt;
}

/* ------------------------------------------------------------------------------------------------
 * Turmas, acoes em massa e importacao
 * ---------------------------------------------------------------------------------------------- */

export type StudentCohort = { id: string; name: string };

export type StudentCohortMembership = { cohortId: string; cohortName: string; productId: string };

export const BULK_ACTIONS = ["grant", "revoke", "extend_30", "extend_90", "set_end", "set_cohort", "resend_access_email"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export const BULK_ACTION_LABELS: Record<BulkAction, string> = {
  extend_30: "Estender 30 dias",
  extend_90: "Estender 90 dias",
  grant: "Liberar acesso",
  resend_access_email: "Reenviar convite",
  revoke: "Remover acesso",
  set_cohort: "Mudar turma",
  set_end: "Mudar data de término"
};

/** Lote por chamada (progresso no cliente) e teto por rodada (acima disso, filtrar melhor). */
export const BULK_BATCH_SIZE = 25;
/** Com e-mail no meio (convite), o lote e menor: cada envio passa pelo SMTP antes de responder. */
export const BULK_EMAIL_BATCH_SIZE = 8;
export const BULK_MAX_TOTAL = 200;

export type BulkSkipReason = "staff" | "already_has_access" | "no_access" | "email_limit" | "no_account";

export const BULK_SKIP_REASON_LABELS: Record<BulkSkipReason, string> = {
  already_has_access: "já tinha acesso",
  email_limit: "limite de e-mail da plataforma",
  no_access: "não tinha acesso a este produto",
  no_account: "sem conta de acesso",
  staff: "faz parte da equipe"
};

export type EntitlementSnapshot = {
  endsAt: string | null;
  id: string;
  startsAt: string;
  status: EntitlementStatus;
};

export type BulkItemResult =
  | { status: "done"; userId: string; snapshot?: EntitlementSnapshot }
  | { status: "skipped"; userId: string; reason: BulkSkipReason }
  | { status: "failed"; userId: string; error: string };

export type BulkBatchResult = {
  batchId: string;
  /** Interrompeu os envios por limite de e-mail: o resto do lote ficou como "skipped: email_limit". */
  emailLimitHit: boolean;
  items: BulkItemResult[];
};

export const IMPORT_BATCH_SIZE = 25;
export const IMPORT_EMAIL_BATCH_SIZE = 8;
export const IMPORT_MAX_ROWS = 2_000;
export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Teto por pessoa da equipe por hora (somado no audit log). */
export const IMPORT_HOURLY_LIMIT = 2_000;

export const IMPORT_DELIVERY_METHODS = ["invite", "none"] as const;
export type ImportDeliveryMethod = (typeof IMPORT_DELIVERY_METHODS)[number];

export type ImportRowResult =
  | { emailSent: boolean; index: number; status: "created" | "existing"; userId: string }
  | { index: number; status: "failed"; error: string };

export type ImportBatchResult = {
  batchId: string;
  emailLimitHit: boolean;
  rows: ImportRowResult[];
};
