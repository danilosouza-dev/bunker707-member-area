import {
  bootcamps,
  courses,
  courseModules,
  formationInternalCourses,
  formations,
  homeRows,
  type CommerceScope,
  type ContentItem,
  type ContentKind,
  type ContentStatus,
  type RowVisibility
} from "@/lib/mock-data";

export type AdminContentAccess = "Liberado" | "Bloqueado" | "Drip" | "Em breve";
export type AdminView = "overview" | "catalog" | "structure" | "release" | "access";
export type ReleaseRuleMode =
  | "immediate"
  | "after_purchase"
  | "after_previous_lesson"
  | "fixed_date"
  | "activity_required";

export type AdminContentRecord = {
  access: AdminContentAccess;
  commerceScope: CommerceScope;
  content: ContentItem;
  kind: ContentKind;
  lessonsCount: number;
  modulesCount: number;
  owner: string;
  releaseSummary: string;
  status: ContentStatus;
  updatedAt: string;
  visibility: RowVisibility;
};

export type AdminMetric = {
  delta: string;
  label: string;
  tone: "red" | "green" | "amber" | "neutral";
  value: string;
};

export type AdminChartPoint = {
  access: number;
  label: string;
  progress: number;
  revenueEvents: number;
};

export type AdminReleaseRule = {
  affectedStudents: number;
  condition: string;
  delay?: string;
  id: string;
  mode: ReleaseRuleMode;
  scope: "Produto" | "Curso" | "Modulo" | "Aula" | "Material";
  status: "Ativa" | "Rascunho" | "Pausada";
  target: string;
  title: string;
};

export type AdminEntitlement = {
  email: string;
  endsAt: string;
  id: string;
  product: string;
  sourceProvider: "Hotmart" | "Ticto" | "TikTok" | "Manual";
  status: "active" | "suspended" | "revoked" | "expired";
  target: string;
  user: string;
};

export type AdminWebhookEvent = {
  id: string;
  provider: "Hotmart" | "Ticto" | "TikTok" | "Manual";
  receivedAt: string;
  retries: number;
  status: "processed" | "pending" | "failed";
  type: string;
};

function getAccess(item: ContentItem): AdminContentAccess {
  if (item.status === "Em breve") {
    return "Em breve";
  }

  if (item.isLocked) {
    return "Bloqueado";
  }

  if (item.progress === 0 || item.status === "Novo") {
    return "Drip";
  }

  return "Liberado";
}

function getReleaseSummary(item: ContentItem) {
  if (item.status === "Em breve") {
    return "Data fixa futura";
  }

  if (item.isLocked) {
    return "Bloqueado sem entitlement";
  }

  if (item.kind === "Formacao") {
    return "Cursos internos por ordem";
  }

  if (item.kind === "Curso") {
    return item.commerceScope === "included_content" ? "Incluso na formacao" : "Apos compra";
  }

  return "Liberacao imediata";
}

function getModulesCount(item: ContentItem) {
  if (item.kind === "Formacao") {
    return formationInternalCourses.length;
  }

  if (item.kind === "Aula" || item.kind === "Material") {
    return 0;
  }

  return courseModules.length;
}

function getLessonsCount(item: ContentItem) {
  if (item.kind === "Formacao") {
    return formationInternalCourses.length * 14;
  }

  if (item.kind === "Aula") {
    return 1;
  }

  if (item.kind === "Material") {
    return 0;
  }

  return courseModules.reduce((total, module) => total + module.lessons.length, 0);
}

function toAdminRecord(item: ContentItem, index: number): AdminContentRecord {
  return {
    access: getAccess(item),
    commerceScope: item.commerceScope ?? "learning_content",
    content: item,
    kind: item.kind,
    lessonsCount: getLessonsCount(item),
    modulesCount: getModulesCount(item),
    owner: index % 3 === 0 ? "Bruno Bunker" : "Danilo Souza",
    releaseSummary: getReleaseSummary(item),
    status: item.status,
    updatedAt: index % 2 === 0 ? "Hoje, 14:20" : "Ontem, 18:45",
    visibility: item.isLocked ? "all" : "students"
  };
}

export const adminContentRecords = [
  ...formations,
  ...courses,
  ...bootcamps,
  ...formationInternalCourses
].map(toAdminRecord);

export const adminMetrics: AdminMetric[] = [
  {
    delta: "+3 nesta semana",
    label: "Produtos publicados",
    tone: "red",
    value: "12"
  },
  {
    delta: "116 aulas mapeadas",
    label: "Aulas no CMS",
    tone: "neutral",
    value: "214"
  },
  {
    delta: "9 regras ativas",
    label: "Liberações agendadas",
    tone: "amber",
    value: "27"
  },
  {
    delta: "+18% vs. semana passada",
    label: "Eventos de consumo",
    tone: "green",
    value: "8.4k"
  }
];

export const adminChartPoints: AdminChartPoint[] = [
  { access: 46, label: "Seg", progress: 32, revenueEvents: 18 },
  { access: 62, label: "Ter", progress: 45, revenueEvents: 24 },
  { access: 58, label: "Qua", progress: 54, revenueEvents: 28 },
  { access: 74, label: "Qui", progress: 67, revenueEvents: 35 },
  { access: 68, label: "Sex", progress: 73, revenueEvents: 41 },
  { access: 82, label: "Sab", progress: 61, revenueEvents: 32 },
  { access: 91, label: "Dom", progress: 77, revenueEvents: 48 }
];

export const adminReleaseRules: AdminReleaseRule[] = [
  {
    affectedStudents: 438,
    condition: "Modulo anterior concluido",
    delay: "0 horas",
    id: "rule-1",
    mode: "after_previous_lesson",
    scope: "Modulo",
    status: "Ativa",
    target: "Clone Perfeito 2.0 / Modulo 02",
    title: "Liberar modulo apos conclusao"
  },
  {
    affectedStudents: 128,
    condition: "Compra confirmada por entitlement ativo",
    delay: "7 dias",
    id: "rule-2",
    mode: "after_purchase",
    scope: "Aula",
    status: "Ativa",
    target: "Agentes de IA aplicados / Aula 05",
    title: "Drip semanal da formacao"
  },
  {
    affectedStudents: 76,
    condition: "Avaliacao da aula registrada",
    delay: "30 minutos assistidos",
    id: "rule-3",
    mode: "activity_required",
    scope: "Material",
    status: "Rascunho",
    target: "Resumo estrategico da aula",
    title: "Material bonus condicionado"
  },
  {
    affectedStudents: 0,
    condition: "Data de lancamento",
    delay: "24/06/2026 09:00",
    id: "rule-4",
    mode: "fixed_date",
    scope: "Produto",
    status: "Pausada",
    target: "IA para Produtos Visuais",
    title: "Produto em breve"
  }
];

export const adminEntitlements: AdminEntitlement[] = [
  {
    email: "ana@example.com",
    endsAt: "Vitalicio",
    id: "ent-1",
    product: "Fundamentos de IA Aplicada",
    sourceProvider: "Hotmart",
    status: "active",
    target: "formation-1",
    user: "Ana Beatriz"
  },
  {
    email: "rafael@example.com",
    endsAt: "14/12/2026",
    id: "ent-2",
    product: "Clone Perfeito 2.0",
    sourceProvider: "Ticto",
    status: "active",
    target: "course-1",
    user: "Rafael Leme"
  },
  {
    email: "marina@example.com",
    endsAt: "Reembolso",
    id: "ent-3",
    product: "Bootcamp Agentes na Pratica",
    sourceProvider: "Manual",
    status: "revoked",
    target: "bootcamp-1",
    user: "Marina Costa"
  },
  {
    email: "joao@example.com",
    endsAt: "Pendente",
    id: "ent-4",
    product: "No-code, APIs e automacoes",
    sourceProvider: "TikTok",
    status: "suspended",
    target: "course-2",
    user: "Joao Pedro"
  }
];

export const adminWebhookEvents: AdminWebhookEvent[] = [
  {
    id: "wh-9251",
    provider: "Hotmart",
    receivedAt: "14/06/2026 10:22",
    retries: 0,
    status: "processed",
    type: "purchase_approved"
  },
  {
    id: "wh-9250",
    provider: "Ticto",
    receivedAt: "14/06/2026 09:48",
    retries: 1,
    status: "processed",
    type: "subscription_renewed"
  },
  {
    id: "wh-9249",
    provider: "TikTok",
    receivedAt: "14/06/2026 08:11",
    retries: 2,
    status: "pending",
    type: "payment_pending"
  },
  {
    id: "wh-9248",
    provider: "Hotmart",
    receivedAt: "13/06/2026 23:58",
    retries: 3,
    status: "failed",
    type: "refund"
  }
];

export const adminHomeSections = homeRows.map((row, index) => ({
  contentCount: row.items.length,
  id: row.id,
  order: index + 1,
  source:
    row.variant === "continue"
      ? "Progresso do aluno"
      : row.visibility === "students"
        ? "Entitlements ativos"
        : "Curadoria manual",
  title: row.title,
  visibility: row.visibility
}));

export const adminPipeline = [
  {
    count: 6,
    label: "Rascunho",
    tone: "bg-zinc-500"
  },
  {
    count: 4,
    label: "Revisao",
    tone: "bg-amber-500"
  },
  {
    count: 9,
    label: "Agendado",
    tone: "bg-sky-500"
  },
  {
    count: 12,
    label: "Publicado",
    tone: "bg-emerald-500"
  }
];
