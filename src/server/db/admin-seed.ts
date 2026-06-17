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
} from "@/server/db/platform-seed";

export type AdminContentAccess = "Liberado" | "Bloqueado" | "Drip" | "Em breve";
export type AdminView = "overview" | "students" | "catalog" | "structure" | "release" | "access";
export type ReleaseRuleMode =
  | "immediate"
  | "after_enrollment"
  | "after_purchase"
  | "after_previous_lesson"
  | "fixed_date"
  | "activity_required";
export type AdminSourceProvider = "Hotmart" | "Ticto" | "TikTok" | "Kiwify" | "Manual";
export type AdminEntitlementStatus = "active" | "suspended" | "revoked" | "expired";
export type AdminStudentRole = "Estudante" | "Professor" | "Mentor";
export type AdminStudentCategory = "Aluno" | "Professor" | "Cortesia" | "Importado" | "VIP";
export type AdminStudentAcquisition = "Compra" | "Importado" | "Manual" | "Cortesia";

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
  sourceProvider: AdminSourceProvider;
  status: AdminEntitlementStatus;
  target: string;
  user: string;
};

export type AdminWebhookEvent = {
  id: string;
  provider: AdminSourceProvider;
  receivedAt: string;
  retries: number;
  status: "processed" | "pending" | "failed";
  type: string;
};

export type AdminStudentCourse = {
  acquisition?: AdminStudentAcquisition;
  category?: AdminStudentCategory;
  cohort?: string;
  endsAt: string;
  externalOrderId: string;
  id: string;
  lastActivityAt: string;
  product: string;
  progressPercent: number;
  role?: AdminStudentRole;
  sourceProvider: AdminSourceProvider;
  startsAt: string;
  status: AdminEntitlementStatus;
  targetId: string;
  targetType: "formation" | "standalone_course" | "mentorship" | "webinar" | "product" | "bootcamp";
};

export type AdminStudentAccessLog = {
  action: "login" | "lesson_started" | "lesson_completed" | "material_downloaded" | "access_email_sent";
  device: string;
  id: string;
  location: string;
  occurredAt: string;
};

export type AdminStudent = {
  accessCount?: number;
  accessHistory?: AdminStudentAccessLog[];
  avatarUrl?: string;
  city: string;
  document: string;
  email: string;
  externalCustomerId: string;
  firstAccessAt?: string;
  fullName: string;
  id: string;
  joinedAt: string;
  lastActivityAt: string;
  notes: string;
  phone: string;
  sourceProvider: AdminSourceProvider;
  state: string;
  status: AdminEntitlementStatus;
  tags: string[];
  courses: AdminStudentCourse[];
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

function getTargetType(kind: ContentKind): AdminStudentCourse["targetType"] {
  if (kind === "Formacao") {
    return "formation";
  }

  if (kind === "Mentoria") {
    return "mentorship";
  }

  if (kind === "Webinario") {
    return "webinar";
  }

  if (kind === "Produto") {
    return "product";
  }

  if (kind === "Bootcamp") {
    return "bootcamp";
  }

  return "standalone_course";
}

export const adminSellableProducts = [...formations, ...courses, ...bootcamps]
  .filter((item) => item.commerceScope === "sellable_product")
  .map((item) => ({
    id: item.id,
    image: item.image,
    kind: item.kind,
    targetType: getTargetType(item.kind),
    title: item.title
  }));

export const adminStudents: AdminStudent[] = [
  {
    accessCount: 37,
    accessHistory: [
      {
        action: "lesson_completed",
        device: "Chrome / desktop",
        id: "access-ana-1",
        location: "Sao Paulo, SP",
        occurredAt: "Hoje, 10:48"
      },
      {
        action: "lesson_started",
        device: "iPhone",
        id: "access-ana-2",
        location: "Sao Paulo, SP",
        occurredAt: "Ontem, 19:12"
      },
      {
        action: "material_downloaded",
        device: "Chrome / desktop",
        id: "access-ana-3",
        location: "Sao Paulo, SP",
        occurredAt: "12/06/2026 21:04"
      }
    ],
    city: "Sao Paulo",
    courses: [
      {
        acquisition: "Compra",
        category: "VIP",
        cohort: "Turma IA Aplicada 2026.1",
        endsAt: "Vitalicio",
        externalOrderId: "hm-2026-88421",
        id: "student-course-1",
        lastActivityAt: "Hoje, 10:48",
        product: "Fundamentos de IA Aplicada",
        progressPercent: 34,
        role: "Estudante",
        sourceProvider: "Hotmart",
        startsAt: "02/04/2026",
        status: "active",
        targetId: "formation-1",
        targetType: "formation"
      },
      {
        acquisition: "Compra",
        category: "Aluno",
        cohort: "Turma Dashboards 2026.2",
        endsAt: "Vitalicio",
        externalOrderId: "hm-2026-88422",
        id: "student-course-2",
        lastActivityAt: "Ontem, 19:12",
        product: "Dashboards inteligentes",
        progressPercent: 22,
        role: "Estudante",
        sourceProvider: "Hotmart",
        startsAt: "09/05/2026",
        status: "active",
        targetId: "course-3",
        targetType: "standalone_course"
      }
    ],
    document: "123.456.789-10",
    email: "ana@example.com",
    externalCustomerId: "hotmart-cus-8421",
    firstAccessAt: "02/04/2026 20:14",
    fullName: "Ana Beatriz",
    id: "student-1",
    joinedAt: "02/04/2026",
    lastActivityAt: "Hoje, 10:48",
    notes: "Aluno ativo, alto consumo de aulas praticas.",
    phone: "+55 11 98888-0101",
    sourceProvider: "Hotmart",
    state: "SP",
    status: "active",
    tags: ["alta atividade", "formacao"]
  },
  {
    accessCount: 8,
    accessHistory: [
      {
        action: "lesson_started",
        device: "Chrome / desktop",
        id: "access-rafael-1",
        location: "Rio de Janeiro, RJ",
        occurredAt: "Hoje, 08:20"
      },
      {
        action: "login",
        device: "Chrome / desktop",
        id: "access-rafael-2",
        location: "Rio de Janeiro, RJ",
        occurredAt: "13/06/2026 22:16"
      }
    ],
    city: "Rio de Janeiro",
    courses: [
      {
        acquisition: "Compra",
        category: "Aluno",
        cohort: "Turma Clone 2026.2",
        endsAt: "14/12/2026",
        externalOrderId: "ticto-72881",
        id: "student-course-3",
        lastActivityAt: "Hoje, 08:20",
        product: "Clone Perfeito 2.0",
        progressPercent: 16,
        role: "Estudante",
        sourceProvider: "Ticto",
        startsAt: "14/06/2026",
        status: "active",
        targetId: "course-1",
        targetType: "standalone_course"
      }
    ],
    document: "234.567.891-00",
    email: "rafael@example.com",
    externalCustomerId: "ticto-cus-3317",
    firstAccessAt: "14/06/2026 08:20",
    fullName: "Rafael Leme",
    id: "student-2",
    joinedAt: "14/06/2026",
    lastActivityAt: "Hoje, 08:20",
    notes: "Compra recente. Acompanhar primeira semana.",
    phone: "+55 21 97777-0202",
    sourceProvider: "Ticto",
    state: "RJ",
    status: "active",
    tags: ["novo aluno", "curso avulso"]
  },
  {
    accessCount: 3,
    accessHistory: [
      {
        action: "login",
        device: "Android",
        id: "access-marina-1",
        location: "Belo Horizonte, MG",
        occurredAt: "12/06/2026 09:10"
      }
    ],
    city: "Belo Horizonte",
    courses: [
      {
        acquisition: "Manual",
        category: "Importado",
        cohort: "Turma Agentes Pratica 2026.1",
        endsAt: "Reembolso",
        externalOrderId: "manual-refund-182",
        id: "student-course-4",
        lastActivityAt: "12/06/2026",
        product: "Bootcamp Agentes na Pratica",
        progressPercent: 0,
        role: "Estudante",
        sourceProvider: "Manual",
        startsAt: "27/05/2026",
        status: "revoked",
        targetId: "bootcamp-1",
        targetType: "bootcamp"
      }
    ],
    document: "345.678.912-00",
    email: "marina@example.com",
    externalCustomerId: "manual-cus-9182",
    firstAccessAt: "27/05/2026 14:02",
    fullName: "Marina Costa",
    id: "student-3",
    joinedAt: "27/05/2026",
    lastActivityAt: "12/06/2026",
    notes: "Acesso revogado por reembolso. Manter historico para auditoria.",
    phone: "+55 31 96666-0303",
    sourceProvider: "Manual",
    state: "MG",
    status: "revoked",
    tags: ["reembolso"]
  },
  {
    accessCount: 0,
    accessHistory: [],
    city: "Curitiba",
    courses: [
      {
        acquisition: "Compra",
        category: "Aluno",
        cohort: "Turma Automacoes 2026.2",
        endsAt: "Pendente",
        externalOrderId: "tiktok-99231",
        id: "student-course-5",
        lastActivityAt: "Nunca acessou",
        product: "No-code, APIs e automacoes",
        progressPercent: 0,
        role: "Estudante",
        sourceProvider: "TikTok",
        startsAt: "11/06/2026",
        status: "suspended",
        targetId: "course-2",
        targetType: "standalone_course"
      }
    ],
    document: "456.789.123-00",
    email: "joao@example.com",
    externalCustomerId: "tiktok-cus-1180",
    firstAccessAt: "Sem acesso",
    fullName: "Joao Pedro",
    id: "student-4",
    joinedAt: "11/06/2026",
    lastActivityAt: "Nunca acessou",
    notes: "Pagamento pendente. Acesso suspenso ate confirmacao.",
    phone: "+55 41 95555-0404",
    sourceProvider: "TikTok",
    state: "PR",
    status: "suspended",
    tags: ["pendente"]
  },
  {
    accessCount: 19,
    accessHistory: [
      {
        action: "lesson_started",
        device: "Safari / desktop",
        id: "access-luisa-1",
        location: "Florianopolis, SC",
        occurredAt: "Hoje, 12:05"
      },
      {
        action: "login",
        device: "Safari / desktop",
        id: "access-luisa-2",
        location: "Florianopolis, SC",
        occurredAt: "13/06/2026 16:45"
      }
    ],
    city: "Florianopolis",
    courses: [
      {
        acquisition: "Compra",
        category: "VIP",
        cohort: "Turma Agentes 2026.2",
        endsAt: "Vitalicio",
        externalOrderId: "kw-44019",
        id: "student-course-6",
        lastActivityAt: "Hoje, 12:05",
        product: "Automacoes com Agentes",
        progressPercent: 0,
        role: "Estudante",
        sourceProvider: "Kiwify",
        startsAt: "05/06/2026",
        status: "active",
        targetId: "formation-2",
        targetType: "formation"
      },
      {
        acquisition: "Compra",
        category: "VIP",
        cohort: "Turma Conteudo 2026.1",
        endsAt: "Vitalicio",
        externalOrderId: "kw-44020",
        id: "student-course-7",
        lastActivityAt: "Hoje, 12:05",
        product: "Bootcamp IA para Conteudo",
        progressPercent: 9,
        role: "Estudante",
        sourceProvider: "Kiwify",
        startsAt: "07/06/2026",
        status: "active",
        targetId: "bootcamp-2",
        targetType: "bootcamp"
      }
    ],
    document: "567.891.234-00",
    email: "luisa@example.com",
    externalCustomerId: "kiwify-cus-44019",
    firstAccessAt: "05/06/2026 18:22",
    fullName: "Luisa Andrade",
    id: "student-5",
    joinedAt: "05/06/2026",
    lastActivityAt: "Hoje, 12:05",
    notes: "Comprou dois produtos na mesma semana.",
    phone: "+55 48 94444-0505",
    sourceProvider: "Kiwify",
    state: "SC",
    status: "active",
    tags: ["multi-compra", "bootcamp"]
  },
  {
    accessCount: 54,
    accessHistory: [
      {
        action: "lesson_completed",
        device: "Edge / desktop",
        id: "access-camila-1",
        location: "Recife, PE",
        occurredAt: "Ontem, 21:33"
      },
      {
        action: "access_email_sent",
        device: "Sistema",
        id: "access-camila-2",
        location: "Bunker707",
        occurredAt: "18/05/2026 11:40"
      }
    ],
    city: "Recife",
    courses: [
      {
        acquisition: "Cortesia",
        category: "Cortesia",
        cohort: "Turma Conteudo 2026.1",
        endsAt: "Vitalicio",
        externalOrderId: "manual-grant-2026-41",
        id: "student-course-8",
        lastActivityAt: "Ontem, 21:33",
        product: "IA para criacao de conteudo",
        progressPercent: 100,
        role: "Mentor",
        sourceProvider: "Manual",
        startsAt: "18/05/2026",
        status: "active",
        targetId: "course-4",
        targetType: "standalone_course"
      }
    ],
    document: "678.912.345-00",
    email: "camila@example.com",
    externalCustomerId: "manual-cus-2041",
    firstAccessAt: "18/05/2026 11:46",
    fullName: "Camila Rocha",
    id: "student-6",
    joinedAt: "18/05/2026",
    lastActivityAt: "Ontem, 21:33",
    notes: "Acesso manual concedido para parceria.",
    phone: "+55 81 93333-0606",
    sourceProvider: "Manual",
    state: "PE",
    status: "active",
    tags: ["cortesia", "concluido"]
  }
];

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
