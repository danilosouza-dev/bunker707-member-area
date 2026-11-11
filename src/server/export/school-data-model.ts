// Exportar dados (docs/32 §2.2 e §4): o que vai no ZIP, em que colunas e com que texto. A escola leva, em arquivos que
// abrem em qualquer planilha, no minimo alunos, acessos, progresso, cursos e vendas; aqui tambem a equipe, os modulos e as
// aulas, os pacotes, as turmas e, no produto vendido, as vendas guardadas, com um LEIA-ME que explica cada arquivo.
//
// O que nunca entra: senha, token, chave, segredo de integracao, o hash do token das plataformas, a licenca assinada e o
// segredo da Instalacao, e o payload bruto das vendas (o que importa dele ja esta nas colunas). Os videos e os arquivos
// enviados ficam no provedor de video e no Storage (o backup os leva).
//
// Puro, sem "server-only" e sem "@/": os testes carregam direto. Quem le o banco e school-data.ts.

import { ADMIN_ROLE_LABELS, isAdminRole } from "../auth/roles";
import type { CsvCell } from "../../lib/csv";
import { ACCESS_STATE_LABELS, accessStateOf } from "../students/model";

/** O download (a rota GET de src/app/api/admin/dados/exportar) e a tela que explica o que vem nele. */
export const EXPORT_DATA_HREF = "/api/admin/dados/exportar";
export const EXPORT_DATA_PAGE_HREF = "/admin/configuracoes/dados";

/** O fuso das datas da exportacao (o mesmo do admin). */
export const EXPORT_TIME_ZONE = "America/Sao_Paulo";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: EXPORT_TIME_ZONE,
  year: "numeric"
});

/** "11/11/2026 14:30", no horario de Brasilia (as planilhas em portugues leem como data); vazio sem data valida. */
export function exportDateTime(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date).replace(",", "") : "";
}

/** "1500,00": centavos em reais com virgula, como a planilha em portugues le numero. */
export function exportMoney(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) {
    return "";
  }

  const negative = cents < 0;
  const absolute = Math.abs(Math.trunc(cents));
  return `${negative ? "-" : ""}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

/** O nome do ZIP: dados-da-escola-AAAA-MM-DD.zip (o dia de Brasilia). */
export function schoolExportFileName(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: EXPORT_TIME_ZONE, year: "numeric" }).format(now);
  return `dados-da-escola-${day}.zip`;
}

/* ------------------------------------------------------------------------------------------------
 * Os arquivos e as colunas
 * ---------------------------------------------------------------------------------------------- */

export type SchoolExportFile = {
  name: string;
  /** Uma frase do LEIA-ME: o que o arquivo tem, uma linha por que. */
  description: string;
  headers: readonly string[];
};

export const EXPORT_FILES = {
  alunos: {
    description: "Uma linha por conta de aluno (a equipe fica em equipe.csv), com nome, e-mail, telefone, quando a conta foi criada e o último acesso.",
    headers: ["ID do aluno", "Nome", "E-mail", "Telefone", "Cadastro em", "Último acesso"],
    name: "alunos.csv"
  },
  equipe: {
    description: "Uma linha por pessoa da equipe, com o papel dela no admin.",
    headers: ["ID", "Nome", "E-mail", "Papel", "Na equipe desde"],
    name: "equipe.csv"
  },
  cursos: {
    description: "Uma linha por produto do catálogo (curso, formação, mentoria...), com o tipo, a situação e se aparece na vitrine.",
    headers: ["ID do produto", "Nome", "Tipo", "Situação", "Vitrine", "Criado em"],
    name: "cursos.csv"
  },
  aulas: {
    description: "Uma linha por aula, com o produto e o módulo de que ela faz parte, a situação, a duração e a ordem. As aulas apagadas (na lixeira) não entram.",
    headers: ["ID do produto", "Produto", "ID do módulo", "Módulo", "Ordem do módulo", "ID da aula", "Aula", "Ordem da aula", "Situação", "Duração"],
    name: "modulos-e-aulas.csv"
  },
  pacotes: {
    description: "Uma linha por pacote, com a situação e os produtos que ele libera.",
    headers: ["ID do pacote", "Nome", "Situação", "Produtos (IDs)", "Produtos"],
    name: "pacotes.csv"
  },
  acessos: {
    description:
      "Uma linha por acesso de aluno a um produto, com a situação de hoje (ativo, expira em breve, expirado, suspenso, revogado ou agendado), o início, o fim (vazio é sem prazo) e de onde veio (a plataforma da venda ou a equipe).",
    headers: ["ID do acesso", "ID do aluno", "E-mail", "ID do produto", "Produto", "Situação", "Início", "Fim", "Origem", "Venda (compra)", "Criado em"],
    name: "acessos.csv"
  },
  progresso: {
    description:
      "Uma linha por aluno e produto estudado: quantas aulas publicadas o aluno concluiu, quantas o produto tem, o percentual e, no fim, os IDs das aulas concluídas (separados por espaço).",
    headers: ["ID do aluno", "E-mail", "ID do produto", "Produto", "Aulas concluídas", "Aulas publicadas", "Progresso (%)", "Atualizado em", "Aulas concluídas (IDs)"],
    name: "progresso.csv"
  },
  turmas: {
    description: "Uma linha por aluno em uma turma de um produto.",
    headers: ["ID do aluno", "E-mail", "ID do produto", "Produto", "Turma", "Na turma desde"],
    name: "turmas.csv"
  },
  vendas: {
    description:
      "Uma linha por aviso das plataformas de venda (compra, reembolso, chargeback, assinatura cancelada e os outros eventos), com o comprador, o produto, o valor quando a plataforma informou, a compra (o código da transação na plataforma) e o que aconteceu com o acesso. Depois de 12 meses o e-mail do comprador é apagado, como manda a política de dados.",
    headers: [
      "ID da venda",
      "Plataforma",
      "Evento",
      "Tipo",
      "Recebida em",
      "E-mail do comprador",
      "Código do produto na plataforma",
      "Produto na plataforma",
      "ID do produto da escola",
      "ID do pacote da escola",
      "Compra (transação)",
      "Resultado",
      "Detalhe",
      "Valor",
      "Moeda",
      "ID do aluno",
      "Dados apagados em"
    ],
    name: "vendas.csv"
  },
  vendasGuardadas: {
    description:
      "Uma linha por venda guardada: a compra que chegou quando a Licença não permitia acesso novo, com os produtos que ficaram sem acesso, o motivo e se ela ainda está guardada, já foi liberada ou foi descartada (reembolso antes da liberação).",
    headers: ["ID", "ID da venda", "Plataforma", "Compra (transação)", "Produtos (IDs)", "Motivo", "Situação", "Guardada em", "Resolvida em", "Resultado"],
    name: "vendas-guardadas.csv"
  }
} as const satisfies Record<string, SchoolExportFile>;

export type ExportFileKey = keyof typeof EXPORT_FILES;

/** A ordem dos arquivos no ZIP (o LEIA-ME vem antes de todos). As vendas guardadas so no produto vendido. */
export function exportFileKeys(options: { heldSales: boolean }): ExportFileKey[] {
  const keys: ExportFileKey[] = ["alunos", "acessos", "progresso", "cursos", "aulas", "pacotes", "turmas", "vendas", "equipe"];
  return options.heldSales ? [...keys.slice(0, 8), "vendasGuardadas", ...keys.slice(8)] : keys;
}

export const README_NAME = "LEIA-ME.txt";

/** O LEIA-ME do ZIP: o que e cada arquivo, como abrir, como ligar um arquivo ao outro e o que nao vem. */
export function schoolExportReadme(input: { generatedAt: Date; keys: readonly ExportFileKey[] }): string {
  const files = input.keys.map((key) => EXPORT_FILES[key]);
  const lines = [
    "DADOS DA ESCOLA",
    "",
    `Exportados em ${exportDateTime(input.generatedAt.toISOString())} (horário de Brasília).`,
    "",
    "Como abrir",
    "- Cada arquivo .csv abre no Excel, no Google Planilhas, no LibreOffice ou no Numbers. As colunas são separadas por ponto e vírgula, e o texto está em UTF-8 (os acentos aparecem certos).",
    "- As datas estão no horário de Brasília, no formato dia/mês/ano hora:minuto.",
    "- Um texto que começaria com =, +, - ou @ ganha um apóstrofo na frente, para a planilha não o tratar como fórmula.",
    "",
    "Os arquivos",
    ...files.flatMap((file) => [`- ${file.name}: ${file.description}`, `  Colunas: ${file.headers.join("; ")}.`]),
    "",
    "Como ligar um arquivo ao outro",
    "- O \"ID do aluno\" é o mesmo em alunos.csv, acessos.csv, progresso.csv e turmas.csv; o \"ID do produto\" é o mesmo em cursos.csv, modulos-e-aulas.csv, acessos.csv, progresso.csv, turmas.csv e pacotes.csv. Na planilha, use PROCV (ou PROCX) para trazer o nome de um arquivo para o outro.",
    "- O \"ID da venda\" de vendas-guardadas.csv é o de vendas.csv, e a \"Venda (compra)\" de acessos.csv é a \"Compra (transação)\" de vendas.csv.",
    "",
    "O que não vem aqui",
    "- Senhas, tokens, chaves, os segredos das integrações e a licença desta área de membros: nunca saem do servidor.",
    "- Os vídeos e os arquivos enviados (capas, materiais, fotos): ficam no provedor de vídeo e no armazenamento, e o backup do servidor os leva.",
    "- Comentários, avisos, conversas com o Tutor IA e os dados dos webinários: ficam no banco e no backup.",
    "",
    "Este arquivo tem dados pessoais de alunos. Guarde-o com cuidado e apague as cópias que não precisar mais (LGPD)."
  ];

  return `${lines.join("\r\n")}\r\n`;
}

/* ------------------------------------------------------------------------------------------------
 * As linhas
 * ---------------------------------------------------------------------------------------------- */

export type ExportProfileRow = { created_at: string | null; email: string | null; full_name: string | null; id: string; last_sign_in_at?: string | null; phone: string | null };

export function studentCells(row: ExportProfileRow): CsvCell[] {
  return [row.id, row.full_name ?? "", row.email ?? "", row.phone ?? "", exportDateTime(row.created_at), exportDateTime(row.last_sign_in_at ?? null)];
}

export function teamCells(row: { created_at: string | null; role: string; user_id: string }, profile: { email: string | null; full_name: string | null } | undefined): CsvCell[] {
  return [row.user_id, profile?.full_name ?? "", profile?.email ?? "", isAdminRole(row.role) ? ADMIN_ROLE_LABELS[row.role] : row.role, exportDateTime(row.created_at)];
}

const PUBLICATION_LABELS: Readonly<Record<string, string>> = Object.freeze({ archived: "Arquivado", draft: "Rascunho", published: "Publicado" });
const LISTING_LABELS: Readonly<Record<string, string>> = Object.freeze({ hidden: "Oculto", listed: "Na vitrine" });

export function productCells(row: { created_at: string | null; id: string; kind: string | null; listing?: string | null; publication_status?: string | null; title: string | null }): CsvCell[] {
  const situation = row.publication_status ?? "";
  const listing = row.listing ?? "";

  return [row.id, row.title ?? "", row.kind ?? "", PUBLICATION_LABELS[situation] ?? situation, LISTING_LABELS[listing] ?? listing, exportDateTime(row.created_at)];
}

const LESSON_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({ draft: "Rascunho", published: "Publicada", scheduled: "Agendada" });

export function lessonCells(
  lesson: { duration: string | null; id: string; sort_order: number | null; status: string | null; title: string | null },
  module: { id: string; owner_id: string | null; sort_order: number | null; title: string | null } | undefined,
  productTitle: string | undefined
): CsvCell[] {
  const status = lesson.status ?? "";

  return [
    module?.owner_id ?? "",
    productTitle ?? "",
    module?.id ?? "",
    module?.title ?? "",
    module?.sort_order ?? "",
    lesson.id,
    lesson.title ?? "",
    lesson.sort_order ?? "",
    LESSON_STATUS_LABELS[status] ?? status,
    lesson.duration ?? ""
  ];
}

const COMBO_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({ active: "Ativo", draft: "Rascunho", paused: "Pausado" });

export function comboCells(row: { id: string; name: string | null; status: string | null }, productIds: readonly string[], titles: ReadonlyMap<string, string>): CsvCell[] {
  const status = row.status ?? "";

  return [row.id, row.name ?? "", COMBO_STATUS_LABELS[status] ?? status, productIds.join(" "), productIds.map((id) => titles.get(id) ?? id).join(" | ")];
}

const ORIGIN_LABELS: Readonly<Record<string, string>> = Object.freeze({ hotmart: "Hotmart", kiwify: "Kiwify", manual: "Equipe", ticto: "Ticto" });

export function originLabel(provider: string | null | undefined): string {
  return provider ? (ORIGIN_LABELS[provider] ?? provider) : "";
}

export type ExportEntitlementRow = {
  created_at: string | null;
  ends_at: string | null;
  id: string;
  source_event_id: string | null;
  source_provider: string | null;
  starts_at: string;
  status: "active" | "suspended" | "revoked" | "expired";
  target_id: string;
  user_id: string;
};

export function accessCells(row: ExportEntitlementRow, email: string | undefined, productTitle: string | undefined, now: number): CsvCell[] {
  const state = accessStateOf({ endsAt: row.ends_at, now, startsAt: row.starts_at, status: row.status });
  // A venda so quando o acesso veio de uma plataforma (a equipe grava admin:<produto>).
  const sale = row.source_provider && row.source_provider !== "manual" ? (row.source_event_id ?? "") : "";

  return [
    row.id,
    row.user_id,
    email ?? "",
    row.target_id,
    productTitle ?? "",
    ACCESS_STATE_LABELS[state],
    exportDateTime(row.starts_at),
    exportDateTime(row.ends_at),
    originLabel(row.source_provider),
    sale,
    exportDateTime(row.created_at)
  ];
}

export function progressCells(
  row: { completed_lesson_ids: string[] | null; content_id: string; updated_at: string | null; user_id: string },
  email: string | undefined,
  productTitle: string | undefined,
  published: ReadonlySet<string> | undefined
): CsvCell[] {
  const completed = Array.from(new Set(row.completed_lesson_ids ?? []));
  const total = published?.size ?? 0;
  const done = published ? completed.filter((id) => published.has(id)).length : 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return [row.user_id, email ?? "", row.content_id, productTitle ?? "", done, total, percent, exportDateTime(row.updated_at), completed.join(" ")];
}

export function cohortCells(
  row: { cohort_id: string; created_at: string | null; product_id: string; user_id: string },
  email: string | undefined,
  productTitle: string | undefined,
  cohortName: string | undefined
): CsvCell[] {
  return [row.user_id, email ?? "", row.product_id, productTitle ?? "", cohortName ?? "", exportDateTime(row.created_at)];
}

const OUTCOME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  access_granted: "Acesso liberado",
  access_restored: "Prazo devolvido",
  access_revoked: "Acesso revogado",
  access_suspended: "Acesso suspenso",
  failed: "Erro",
  held: "Venda guardada",
  ignored: "Ignorado"
});

const SALE_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  chargeback: "Chargeback",
  other: "Outro evento",
  purchase_approved: "Compra aprovada",
  refund: "Reembolso",
  subscription_canceled: "Assinatura cancelada"
});

export type ExportSaleRow = {
  amount_cents?: number | null;
  anonymized_at: string | null;
  buyer_email: string | null;
  combo_id: string | null;
  currency?: string | null;
  event_type: string;
  external_product_id: string | null;
  external_product_name: string | null;
  id: string;
  normalized_type: string | null;
  outcome: string | null;
  outcome_detail: string | null;
  processing_status: string;
  product_id: string | null;
  provider: string;
  received_at: string;
  transaction_id: string | null;
  user_id: string | null;
};

export function saleCells(row: ExportSaleRow): CsvCell[] {
  const outcome = row.outcome ?? (row.processing_status === "failed" ? "failed" : "");

  return [
    row.id,
    originLabel(row.provider),
    row.event_type,
    row.normalized_type ? (SALE_TYPE_LABELS[row.normalized_type] ?? row.normalized_type) : "",
    exportDateTime(row.received_at),
    row.buyer_email ?? "",
    row.external_product_id ?? "",
    row.external_product_name ?? "",
    row.product_id ?? "",
    row.combo_id ?? "",
    row.transaction_id ?? "",
    outcome ? (OUTCOME_LABELS[outcome] ?? outcome) : "Recebido",
    row.outcome_detail ?? "",
    exportMoney(row.amount_cents ?? null),
    row.currency ?? "",
    row.user_id ?? "",
    exportDateTime(row.anonymized_at)
  ];
}

const HELD_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({ discarded: "Descartada", granted: "Liberada", held: "Guardada" });

export function heldSaleCells(
  row: {
    held_at: string;
    id: string;
    product_ids: string[];
    provider: string;
    reason: string;
    resolution: string | null;
    resolved_at: string | null;
    status: string;
    transaction_id: string;
    webhook_event_id: string;
  },
  reasonLabel: string
): CsvCell[] {
  return [
    row.id,
    row.webhook_event_id,
    originLabel(row.provider),
    row.transaction_id,
    row.product_ids.join(" "),
    reasonLabel,
    HELD_STATUS_LABELS[row.status] ?? row.status,
    exportDateTime(row.held_at),
    exportDateTime(row.resolved_at),
    row.resolution ?? ""
  ];
}
