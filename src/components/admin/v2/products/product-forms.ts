// Regras puras dos formularios do produto (abas Detalhes, Acesso e venda e Alunos).
// Sem React e so imports de tipo: tests/admin-products-ui.test.mjs carrega direto.
// Os formularios enviam so os campos que mudaram (escrita granular) e o servidor confere o resto.

import type { ProductAccess, ProductDetails } from "@/server/catalog/types";
import type { ProductAccent, ProductAudience, ProductFormat, ReleasePhrase } from "@/server/catalog/model";

/* ------------------------------------------------------------------------------------------------
 * Detalhes
 * ---------------------------------------------------------------------------------------------- */

export type DetailsDraft = {
  accent: ProductAccent;
  coursePresentationMode: "module_cards" | "lesson_playlist";
  format: ProductFormat;
  instructorName: string;
  /** "" = sem nivel informado. */
  level: string;
  lockedActionMode: "details_modal" | "external_link";
  shortDescription: string;
};

export function detailsDraftFrom(details: Pick<
  ProductDetails,
  "accent" | "coursePresentationMode" | "instructorName" | "level" | "lockedActionMode" | "shortDescription"
> & { header: { format: ProductFormat } }): DetailsDraft {
  return {
    accent: details.accent,
    coursePresentationMode: details.coursePresentationMode,
    format: details.header.format,
    instructorName: details.instructorName ?? "",
    level: details.level ?? "",
    lockedActionMode: details.lockedActionMode,
    shortDescription: details.shortDescription ?? ""
  };
}

export type DetailsPatch = {
  accent?: ProductAccent;
  coursePresentationMode?: "module_cards" | "lesson_playlist";
  format?: ProductFormat;
  instructorName?: string | null;
  level?: string | null;
  lockedActionMode?: "details_modal" | "external_link";
  shortDescription?: string;
};

function emptyToNull(value: string) {
  const trimmed = value.trim();

  return trimmed ? trimmed : null;
}

/** So o que mudou; textos comparados sem espacos nas pontas; vazio limpa (null). */
export function buildDetailsPatch(initial: DetailsDraft, draft: DetailsDraft): DetailsPatch {
  const patch: DetailsPatch = {};

  if (draft.accent !== initial.accent) patch.accent = draft.accent;
  if (draft.coursePresentationMode !== initial.coursePresentationMode) patch.coursePresentationMode = draft.coursePresentationMode;
  if (draft.format !== initial.format) patch.format = draft.format;
  if (draft.instructorName.trim() !== initial.instructorName.trim()) patch.instructorName = emptyToNull(draft.instructorName);
  if (draft.level.trim() !== initial.level.trim()) patch.level = emptyToNull(draft.level);
  if (draft.lockedActionMode !== initial.lockedActionMode) patch.lockedActionMode = draft.lockedActionMode;
  if (draft.shortDescription.trim() !== initial.shortDescription.trim()) patch.shortDescription = draft.shortDescription.trim();

  return patch;
}

export const LEVEL_PRESETS = ["Iniciante", "Intermediário", "Avançado"] as const;

/** Pilulas de Nivel: os tres niveis, o valor antigo quando for outro texto, e "Não informar". */
export function levelOptions(current: string) {
  const trimmed = current.trim();
  const presets: { label: string; value: string }[] = LEVEL_PRESETS.map((level) => ({ label: level, value: level }));
  const custom = trimmed && !LEVEL_PRESETS.some((level) => level.toLocaleLowerCase("pt-BR") === trimmed.toLocaleLowerCase("pt-BR"))
    ? [{ label: trimmed, value: trimmed }]
    : [];

  return [...presets, ...custom, { label: "Não informar", value: "" }];
}

/** Valor de nivel normalizado para casar com a pilula ("iniciante" -> "Iniciante"). */
export function normalizeLevel(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  const preset = LEVEL_PRESETS.find((level) => level.toLocaleLowerCase("pt-BR") === trimmed.toLocaleLowerCase("pt-BR"));

  return preset ?? trimmed;
}

/**
 * Formatos oferecidos na aba Detalhes: nunca de/para Formação (o acesso gravado depende do formato);
 * "Gravação de live" so aparece para o item antigo que ja e desse formato.
 */
export function editableFormats(current: ProductFormat): ProductFormat[] {
  if (current === "formacao") {
    return ["formacao"];
  }

  const base: ProductFormat[] = ["curso", "mentoria", "bootcamp", "material"];

  return current === "gravacao_live" ? [...base, "gravacao_live"] : base;
}

/** "Como abre" so vale para quem tem modulos e aulas proprios (Formação abre nos cursos). */
export function supportsPresentationMode(format: ProductFormat) {
  return format !== "formacao";
}

export const PRESENTATION_MODE_OPTIONS = [
  { label: "Mostrar módulos", value: "module_cards" },
  { label: "Abrir direto nas aulas", value: "lesson_playlist" }
] as const satisfies readonly { label: string; value: DetailsDraft["coursePresentationMode"] }[];

export const PRESENTATION_MODE_HINTS: Record<DetailsDraft["coursePresentationMode"], string> = {
  lesson_playlist: "O aluno cai direto na primeira aula, com a lista de aulas ao lado.",
  module_cards: "O aluno vê os módulos em cards e escolhe por onde começar."
};

export const LOCKED_ACTION_OPTIONS = [
  { label: "Abrir detalhes", value: "details_modal" },
  { label: "Ir ao link de compra", value: "external_link" }
] as const satisfies readonly { label: string; value: DetailsDraft["lockedActionMode"] }[];

export const LOCKED_ACTION_HINTS: Record<DetailsDraft["lockedActionMode"], string> = {
  details_modal: "Quem não tem acesso vê a descrição e o botão de compra antes de sair da área do aluno.",
  external_link: "Quem não tem acesso vai direto para o link de compra (sem link, abre os detalhes)."
};

/** "3 h 20 min · calculada pelas aulas publicadas" ou a frase de quando ainda nao ha duracao. */
export function describeDurationTotal(label: string | null) {
  return label ? `${label} · calculada pelas aulas publicadas` : "Aparece quando as aulas publicadas tiverem duração.";
}

/* ------------------------------------------------------------------------------------------------
 * Acesso e venda
 * ---------------------------------------------------------------------------------------------- */

export type AccessDraft = {
  audience: ProductAudience;
  /** Codigo do produto na Hotmart; "" = sem ligacao. */
  hotmartProductId: string;
  /** Texto do campo; "" = sem limite. */
  maxStudents: string;
  purchaseLabel: string;
  purchaseTarget: "same_tab" | "new_tab";
  purchaseUrl: string;
  release: ReleasePhrase;
  /** Codigo do produto na Ticto; "" = sem ligacao. */
  tictoProductId: string;
};

export function accessDraftFrom(access: Pick<
  ProductAccess,
  "audience" | "maxStudents" | "purchaseLabel" | "purchaseTarget" | "purchaseUrl" | "release"
> & Partial<Pick<ProductAccess, "hotmartProductId" | "tictoProductId">>): AccessDraft {
  return {
    audience: access.audience,
    hotmartProductId: access.hotmartProductId ?? "",
    maxStudents: access.maxStudents ? String(access.maxStudents) : "",
    purchaseLabel: access.purchaseLabel ?? "",
    purchaseTarget: access.purchaseTarget,
    purchaseUrl: access.purchaseUrl ?? "",
    release: access.release,
    tictoProductId: access.tictoProductId ?? ""
  };
}

/** Mesma frase de liberacao? (compara so os campos que o modo usa). */
export function sameReleasePhrase(left: ReleasePhrase, right: ReleasePhrase) {
  if (left.mode !== right.mode) {
    return false;
  }

  switch (left.mode) {
    case "after_access":
      return right.mode === "after_access" && left.amount === right.amount && left.unit === right.unit;
    case "fixed_date":
      return right.mode === "fixed_date" && new Date(left.date).getTime() === new Date(right.date).getTime();
    default:
      return true;
  }
}

/** "" -> null (sem limite); inteiro positivo -> numero; resto -> NaN (o schema recusa com a frase certa). */
export function parseMaxStudents(text: string): number | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Frase do erro do limite de alunos; null quando serve (vazio = sem limite). */
export function maxStudentsProblem(text: string): string | null {
  const value = parseMaxStudents(text);

  if (value === null) {
    return null;
  }

  if (Number.isNaN(value)) {
    return "Use só números, ou deixe vazio para não limitar.";
  }

  if (value < 1) {
    return "Use pelo menos 1.";
  }

  return value > 1_000_000 ? "Use no máximo 1.000.000." : null;
}

export type AccessPatch = {
  audience?: ProductAudience;
  hotmartProductId?: string | null;
  maxStudents?: number | null;
  purchaseLabel?: string | null;
  purchaseTarget?: "same_tab" | "new_tab";
  purchaseUrl?: string | null;
  release?: ReleasePhrase;
  tictoProductId?: string | null;
};

export function buildAccessPatch(initial: AccessDraft, draft: AccessDraft): AccessPatch {
  const patch: AccessPatch = {};

  if (draft.audience !== initial.audience) patch.audience = draft.audience;
  if (draft.hotmartProductId.trim() !== initial.hotmartProductId.trim()) patch.hotmartProductId = emptyToNull(draft.hotmartProductId);
  if (draft.tictoProductId.trim() !== initial.tictoProductId.trim()) patch.tictoProductId = emptyToNull(draft.tictoProductId);
  if (draft.maxStudents.trim() !== initial.maxStudents.trim()) patch.maxStudents = parseMaxStudents(draft.maxStudents);
  if (draft.purchaseLabel.trim() !== initial.purchaseLabel.trim()) patch.purchaseLabel = emptyToNull(draft.purchaseLabel);
  if (draft.purchaseTarget !== initial.purchaseTarget) patch.purchaseTarget = draft.purchaseTarget;
  if (draft.purchaseUrl.trim() !== initial.purchaseUrl.trim()) patch.purchaseUrl = emptyToNull(draft.purchaseUrl);
  if (!sameReleasePhrase(draft.release, initial.release)) patch.release = draft.release;

  return patch;
}

export function isEmptyPatch(patch: object) {
  return Object.keys(patch).length === 0;
}

function sameDraftValue(left: unknown, right: unknown) {
  return typeof left === "object" || typeof right === "object" ? JSON.stringify(left) === JSON.stringify(right) : Object.is(left, right);
}

/**
 * O servidor mandou uma versao nova (Recarregar, publicar, voltar para rascunho): os campos que o
 * produtor nao mexeu passam a mostrar o servidor; os que ele mexeu continuam como ele deixou.
 */
export function rebaseDraft<Draft extends Record<string, unknown>>(previousBaseline: Draft, draft: Draft, nextBaseline: Draft): Draft {
  const next = { ...nextBaseline };

  for (const key of Object.keys(draft) as (keyof Draft)[]) {
    if (!sameDraftValue(draft[key], previousBaseline[key])) {
      next[key] = draft[key];
    }
  }

  return next;
}

export const PURCHASE_TARGET_OPTIONS = [
  { label: "Na mesma aba", value: "same_tab" },
  { label: "Em uma nova aba", value: "new_tab" }
] as const satisfies readonly { label: string; value: AccessDraft["purchaseTarget"] }[];

export const COMBO_STATUS_LABELS: Record<"active" | "draft" | "paused", string> = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado"
};

/** "1 aluno" / "1.200 alunos". */
export function describeStudentCount(count: number) {
  return count === 1 ? "1 aluno" : `${new Intl.NumberFormat("pt-BR").format(Math.max(0, count))} alunos`;
}

/** O link de compra so aparece para quem ve o produto sem ter acesso. */
export function showsPurchaseFields(audience: ProductAudience) {
  return audience === "with_access";
}

/** Explica o efeito de cada "Quem pode ver" logo abaixo das pilulas. */
export const AUDIENCE_HINTS: Record<ProductAudience, string> = {
  all_students: "Aberto para todo aluno da escola, sem precisar comprar.",
  hidden: "Fora da vitrine. Só quem já tem acesso vê, dentro de Minhas compras.",
  with_access: "Aparece na vitrine para todos; só quem tem acesso assiste."
};

/* ------------------------------------------------------------------------------------------------
 * Erros de validacao
 * ---------------------------------------------------------------------------------------------- */

type IssueLike = { message: string; path: readonly PropertyKey[] };

/**
 * Primeira mensagem de cada campo, pela raiz do caminho do zod (release.amount -> release).
 * Serve tanto para o safeParse do cliente quanto para o fieldErrors devolvido pela Server Action.
 */
export function firstErrorsByField(issues: readonly IssueLike[]): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of issues) {
    const field = issue.path[0];

    if (typeof field === "string" && !(field in errors)) {
      errors[field] = issue.message;
    }
  }

  return errors;
}

/** fieldErrors de ActionResult ({ campo: [mensagens] }) -> { campo: primeira mensagem }. */
export function firstServerFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [path, messages] of Object.entries(fieldErrors ?? {})) {
    const field = path.split(".")[0];
    const message = messages?.[0];

    if (field && message && !(field in errors)) {
      errors[field] = message;
    }
  }

  return errors;
}

/* ------------------------------------------------------------------------------------------------
 * Alunos e Desempenho
 * ---------------------------------------------------------------------------------------------- */

/** "1 aluno com acesso" / "312 alunos com acesso" / "Ninguém com acesso ainda". */
export function describeStudentsWithAccess(count: number) {
  if (count <= 0) {
    return "Ninguém com acesso ainda";
  }

  return count === 1 ? "1 aluno com acesso" : `${new Intl.NumberFormat("pt-BR").format(count)} alunos com acesso`;
}
