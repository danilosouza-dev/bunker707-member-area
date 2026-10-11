// Aba Desempenho do produto (docs/17 §1.6.5) na disposicao do prototipo aprovado: Funil por modulo,
// Progresso de quem tem acesso e Por aula. Os numeros de estudo dependem do registro de aulas
// assistidas, que ainda nao existe: aqui so entra o que e real (modulos, aulas, situacao de cada aula
// e quantos alunos tem acesso). Todo numero de estudo e `null`, e a tela mostra "—". Nada simulado.
//
// Modulo puro (so imports de tipo): tests/admin-product-performance.test.mjs carrega direto pelo Node.

import type { ProductAudience } from "@/server/catalog/model";
import type { FormationCourseItem, ModuleNode } from "@/server/catalog/types";

/** Frase do topo da aba, no estilo de faixa do prototipo. */
export const PERFORMANCE_NOTICE = "Os números de aulas assistidas aparecem quando os alunos assistirem aulas. Nada aqui é simulado.";

/** Nota do rodape da tabela Por aula (regra que vale quando os numeros existirem). */
export const LESSON_DROP_NOTE = "Queda acima de 12 % aparece em amarelo: vale rever a aula ou a anterior.";

/** Faixas de "Progresso de quem tem acesso", na ordem do prototipo. */
export const PROGRESS_BANDS: readonly { id: string; label: string }[] = [
  { id: "0-25", label: "0–25 % do curso" },
  { id: "26-50", label: "26–50 % do curso" },
  { id: "51-75", label: "51–75 % do curso" },
  { id: "76-100", label: "76–100 % do curso" }
];

/** Colunas da tabela Por aula, na ordem do prototipo (a primeira e o nome da aula). */
export const LESSON_METRIC_COLUMNS = [
  { id: "started", label: "Iniciaram", mobile: true },
  { id: "completed", label: "Concluíram", mobile: false },
  { id: "completionRate", label: "% concl.", mobile: true },
  { id: "drop", label: "Queda", mobile: true },
  { id: "rating", label: "Avaliação", mobile: false },
  { id: "comments", label: "Comentários", mobile: false },
  { id: "questionsPer100Views", label: "Perguntas / 100 visualizações", mobile: false }
] as const;

export type LessonMetricId = (typeof LESSON_METRIC_COLUMNS)[number]["id"];

export type FunnelRow = {
  completed: number | null;
  id: string;
  /** "Módulo 1 · Comece por aqui" ou, numa Formação, "Curso 1 · Fundamentos". */
  label: string;
  /** Frase no lugar dos numeros quando o modulo nao tem o que medir ("sem aulas publicadas"). */
  note: string | null;
  started: number | null;
};

export type LessonPerformanceRow = {
  id: string;
  metrics: Record<LessonMetricId, number | null>;
  /** "1.1", "2.3": modulo.aula, como no prototipo. */
  number: string;
  /** Aula fora do ar para o aluno (rascunho): a linha fica apagada e ganha o chip. */
  off: boolean;
  /** Chip da aula que o aluno ainda nao ve; null para a aula publicada. */
  statusLabel: string | null;
  title: string;
};

const LESSON_STATUS_CHIP: Record<string, string> = { draft: "Rascunho" };

function emptyMetrics(): Record<LessonMetricId, number | null> {
  return {
    comments: null,
    completed: null,
    completionRate: null,
    drop: null,
    questionsPer100Views: null,
    rating: null,
    started: null
  };
}

function byPosition<Item extends { position: number }>(items: readonly Item[]) {
  return [...items].sort((left, right) => left.position - right.position);
}

/** Uma linha por modulo, na ordem da arvore. Sem aula publicada: nada a medir, so a frase. */
export function buildModuleFunnelRows(modules: readonly ModuleNode[]): FunnelRow[] {
  return byPosition(modules).map((module, index) => {
    const hasPublished = module.lessons.some((lesson) => lesson.status === "published");

    return {
      completed: null,
      id: module.id,
      label: `Módulo ${index + 1} · ${module.title}`,
      note: hasPublished ? null : module.lessons.length === 0 ? "sem aulas" : "sem aulas publicadas",
      started: null
    };
  });
}

/** Formação: o funil passa pelos cursos dela (cada curso mantem o proprio Desempenho). */
export function buildCourseFunnelRows(courses: readonly FormationCourseItem[]): FunnelRow[] {
  return byPosition(courses).map((course, index) => ({
    completed: null,
    id: course.id,
    label: `Curso ${index + 1} · ${course.title}`,
    note: course.lessonsPublished > 0 ? null : "sem aulas publicadas",
    started: null
  }));
}

/** Todas as aulas, na ordem da arvore, numeradas "modulo.aula"; as que o aluno nao ve ficam apagadas. */
export function buildLessonPerformanceRows(modules: readonly ModuleNode[]): LessonPerformanceRow[] {
  return byPosition(modules).flatMap((module, moduleIndex) =>
    byPosition(module.lessons).map((lesson, lessonIndex) => {
      const published = lesson.status === "published";

      return {
        id: lesson.id,
        metrics: emptyMetrics(),
        number: `${moduleIndex + 1}.${lessonIndex + 1}`,
        off: !published,
        statusLabel: published ? null : (LESSON_STATUS_CHIP[lesson.status] ?? "Rascunho"),
        title: lesson.title
      };
    })
  );
}

/** Base dos percentuais: "de 312 com acesso"; produto aberto a todos nao tem lista de acesso. */
export function describePerformanceBase(audience: ProductAudience, studentsWithAccess: number) {
  if (audience === "all_students") {
    return "aberto para todos os alunos";
  }

  const count = Math.max(0, Math.trunc(studentsWithAccess));

  return `de ${new Intl.NumberFormat("pt-BR").format(count)} com acesso`;
}

/**
 * Meta do cartao Por aula: o periodo em minuscula + a regra da queda.
 * "Últimos 30 dias" -> "últimos 30 dias · queda contra a aula anterior"; intervalo fica como esta.
 */
export function describeLessonTableMeta(periodLabel: string) {
  const label = periodLabel.trim();
  const lowered = /^[A-ZÀ-Ú]/.test(label) ? label.charAt(0).toLocaleLowerCase("pt-BR") + label.slice(1) : label;

  return lowered ? `${lowered} · queda contra a aula anterior` : "queda contra a aula anterior";
}

/** "Iniciaram — · Concluíram —" (ou os numeros, quando existirem). */
export function describeFunnelValue(row: FunnelRow, emptyValue = "—") {
  if (row.note) {
    return row.note;
  }

  const format = (value: number | null) => (value === null ? emptyValue : new Intl.NumberFormat("pt-BR").format(value));

  return `Iniciaram ${format(row.started)} · Concluíram ${format(row.completed)}`;
}
