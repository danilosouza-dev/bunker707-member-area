import "server-only";

import type {
  AdminEntitlementStatus,
  AdminSourceProvider,
  AdminStudent,
  AdminStudentAccessLog,
  AdminStudentCourse
} from "@/lib/platform-types";

const MAX_STUDENTS = 20_000;
const MAX_COURSES_PER_STUDENT = 500;
const MAX_ACCESS_LOGS_PER_STUDENT = 2_000;

const ENTITLEMENT_STATUSES = new Set<AdminEntitlementStatus>(["active", "suspended", "revoked", "expired"]);
const SOURCE_PROVIDERS = new Set<AdminSourceProvider>(["Hotmart", "Ticto", "TikTok", "Kiwify", "Manual"]);
const TARGET_TYPES = new Set<AdminStudentCourse["targetType"]>([
  "formation",
  "standalone_course",
  "mentorship",
  "webinar",
  "product",
  "bootcamp"
]);
const ACCESS_LOG_ACTIONS = new Set<AdminStudentAccessLog["action"]>([
  "login",
  "lesson_started",
  "lesson_completed",
  "material_downloaded",
  "access_email_sent"
]);

export class AdminStudentsPayloadError extends Error {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = "AdminStudentsPayloadError";
  }
}

function fail(path: string, reason: string): never {
  throw new AdminStudentsPayloadError(`Payload de alunos invalido em ${path}: ${reason}.`);
}

function requireString(value: unknown, path: string, { allowEmpty = true } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    fail(path, allowEmpty ? "esperado texto" : "esperado texto nao vazio");
  }

  return value as string;
}

function optionalString(value: unknown, path: string) {
  if (value === undefined) return undefined;
  return requireString(value, path);
}

function requireStringArray(value: unknown, path: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(path, "esperada lista de textos");
  }

  return value as string[];
}

function validateCourse(value: unknown, path: string): AdminStudentCourse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "esperado objeto de curso");
  }

  const course = value as Record<string, unknown>;

  requireString(course.id, `${path}.id`, { allowEmpty: false });
  requireString(course.product, `${path}.product`);
  requireString(course.targetId, `${path}.targetId`);
  requireString(course.startsAt, `${path}.startsAt`);
  requireString(course.endsAt, `${path}.endsAt`);
  requireString(course.externalOrderId, `${path}.externalOrderId`);
  requireString(course.lastActivityAt, `${path}.lastActivityAt`);

  if (!TARGET_TYPES.has(course.targetType as AdminStudentCourse["targetType"])) {
    fail(`${path}.targetType`, "tipo de alvo desconhecido");
  }

  if (!ENTITLEMENT_STATUSES.has(course.status as AdminEntitlementStatus)) {
    fail(`${path}.status`, "status desconhecido");
  }

  if (!SOURCE_PROVIDERS.has(course.sourceProvider as AdminSourceProvider)) {
    fail(`${path}.sourceProvider`, "provedor desconhecido");
  }

  if (typeof course.progressPercent !== "number" || !Number.isFinite(course.progressPercent)) {
    fail(`${path}.progressPercent`, "esperado numero");
  }

  return course as unknown as AdminStudentCourse;
}

function validateAccessLog(value: unknown, path: string): AdminStudentAccessLog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "esperado objeto de historico");
  }

  const log = value as Record<string, unknown>;

  requireString(log.id, `${path}.id`, { allowEmpty: false });
  requireString(log.device, `${path}.device`);
  requireString(log.location, `${path}.location`);
  requireString(log.occurredAt, `${path}.occurredAt`);

  if (!ACCESS_LOG_ACTIONS.has(log.action as AdminStudentAccessLog["action"])) {
    fail(`${path}.action`, "acao desconhecida");
  }

  return log as unknown as AdminStudentAccessLog;
}

function validateStudent(value: unknown, path: string): AdminStudent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "esperado objeto de aluno");
  }

  const student = value as Record<string, unknown>;

  requireString(student.id, `${path}.id`, { allowEmpty: false });
  const email = requireString(student.email, `${path}.email`, { allowEmpty: false });

  if (!email.includes("@")) {
    fail(`${path}.email`, "email invalido");
  }

  requireString(student.fullName, `${path}.fullName`, { allowEmpty: false });
  requireString(student.city, `${path}.city`);
  requireString(student.state, `${path}.state`);
  requireString(student.document, `${path}.document`);
  requireString(student.phone, `${path}.phone`);
  requireString(student.notes, `${path}.notes`);
  requireString(student.externalCustomerId, `${path}.externalCustomerId`);
  requireString(student.joinedAt, `${path}.joinedAt`);
  requireString(student.lastActivityAt, `${path}.lastActivityAt`);
  optionalString(student.firstAccessAt, `${path}.firstAccessAt`);
  optionalString(student.avatarUrl, `${path}.avatarUrl`);
  requireStringArray(student.tags, `${path}.tags`);

  if (!ENTITLEMENT_STATUSES.has(student.status as AdminEntitlementStatus)) {
    fail(`${path}.status`, "status desconhecido");
  }

  if (!SOURCE_PROVIDERS.has(student.sourceProvider as AdminSourceProvider)) {
    fail(`${path}.sourceProvider`, "provedor desconhecido");
  }

  if (!Array.isArray(student.courses) || student.courses.length > MAX_COURSES_PER_STUDENT) {
    fail(`${path}.courses`, "esperada lista de cursos dentro do limite");
  }

  student.courses.forEach((course, index) => validateCourse(course, `${path}.courses[${index}]`));

  if (student.accessHistory !== undefined) {
    if (!Array.isArray(student.accessHistory) || student.accessHistory.length > MAX_ACCESS_LOGS_PER_STUDENT) {
      fail(`${path}.accessHistory`, "esperada lista de historicos dentro do limite");
    }

    student.accessHistory.forEach((log, index) => validateAccessLog(log, `${path}.accessHistory[${index}]`));
  }

  return student as unknown as AdminStudent;
}

export function validateAdminStudentsPayload(payload: unknown): AdminStudent[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AdminStudentsPayloadError("Payload de alunos invalido: esperado objeto com a lista de alunos.");
  }

  const students = (payload as { students?: unknown }).students;

  if (!Array.isArray(students)) {
    throw new AdminStudentsPayloadError("Lista de alunos invalida.");
  }

  if (students.length > MAX_STUDENTS) {
    throw new AdminStudentsPayloadError("Lista de alunos excede o limite suportado.");
  }

  const seenIds = new Set<string>();

  return students.map((student, index) => {
    const validated = validateStudent(student, `students[${index}]`);

    if (seenIds.has(validated.id)) {
      fail(`students[${index}].id`, "id duplicado na lista");
    }

    seenIds.add(validated.id);
    return validated;
  });
}
