import "server-only";

// Exportar dados (docs/32 §2.2 e §4), o lado do banco: os arquivos do ZIP, cada um gerado pagina a pagina so quando o ZIP
// chega nele (zip.ts). Cada tabela e lida em paginas de EXPORT_PAGE_SIZE linhas pela chave (id > ultimo, em ordem), nunca
// inteira; o e-mail do aluno de cada pagina vem numa consulta por lote de LOOKUP_CHUNK ids. O que fica na memoria a
// exportacao toda e so o que tem o tamanho do catalogo (os nomes dos produtos, os modulos, as aulas publicadas, as turmas)
// e a lista da equipe. Assim um servidor de 4 GB exporta uma escola de qualquer tamanho.
//
// Quem chama ja conferiu o dono ou o administrador (a rota GET /api/admin/dados/exportar). Sempre com a chave de servico,
// so leitura, e so colunas sem segredo: nada de integration_settings, license_state, payload de venda ou tokens.

import { CSV_BOM, toCsvLine, type CsvCell } from "@/lib/csv";
import { isMissingSchemaObjectError, toDbError } from "@/server/db/pending-migration";
import { heldSaleReasonTitle } from "@/server/payments/held-sales-model";
import type { SalesDb } from "@/server/payments/store";
import {
  EXPORT_FILES,
  README_NAME,
  accessCells,
  cohortCells,
  comboCells,
  heldSaleCells,
  lessonCells,
  productCells,
  progressCells,
  saleCells,
  schoolExportReadme,
  studentCells,
  teamCells,
  type ExportEntitlementRow,
  type ExportFileKey,
  type ExportProfileRow,
  type ExportSaleRow
} from "./school-data-model";
import type { ZipEntry } from "./zip";

/** Linhas por pagina (o teto do PostgREST). */
export const EXPORT_PAGE_SIZE = 1000;
/** Ids por consulta de e-mail (a lista vai no endereco do pedido; 100 uuids ficam longe do limite dos proxies). */
export const LOOKUP_CHUNK = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown> & { id: string };

function fail(error: { code?: string | null; message: string }, context: string): never {
  throw toDbError(error, `Exportar dados (${context})`);
}

/** As paginas de uma tabela pela chave: id maior que o ultimo da pagina anterior, em ordem, EXPORT_PAGE_SIZE por vez. */
async function* keysetPages<T extends Row>(db: SalesDb, table: string, columns: string, pageSize: number): AsyncGenerator<T[]> {
  let last: string | null = null;

  for (;;) {
    let query = db.from(table).select(columns);

    if (last !== null) {
      query = query.gt("id", last);
    }

    const { data, error } = await query.order("id", { ascending: true }).limit(pageSize);

    if (error) {
      fail(error, table);
    }

    const rows = (data ?? []) as unknown as T[];

    if (rows.length === 0) {
      return;
    }

    yield rows;

    if (rows.length < pageSize) {
      return;
    }

    last = rows[rows.length - 1].id;
  }
}

/** Uma tabela pequena inteira (a equipe, os pacotes, as turmas), ainda assim pela chave, pagina a pagina. */
async function readAll<T extends Row>(db: SalesDb, table: string, columns: string, pageSize: number): Promise<T[]> {
  const rows: T[] = [];

  for await (const page of keysetPages<T>(db, table, columns, pageSize)) {
    rows.push(...page);
  }

  return rows;
}

/** Os e-mails dos alunos de uma pagina, em lotes de LOOKUP_CHUNK ids (so ids no formato de conta). */
async function emailsOf(db: SalesDb, userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id) => UUID_PATTERN.test(id))));
  const emails = new Map<string, string>();

  for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
    const { data, error } = await db
      .from("profiles")
      .select("id,email")
      .in("id", ids.slice(start, start + LOOKUP_CHUNK));

    if (error) {
      fail(error, "e-mails dos alunos");
    }

    for (const row of (data ?? []) as { email: string | null; id: string }[]) {
      if (row.email) {
        emails.set(row.id, row.email);
      }
    }
  }

  return emails;
}

type ModuleRow = { deleted_at: string | null; id: string; owner_id: string | null; sort_order: number | null; status: string | null; title: string | null };

/** O que tem o tamanho do catalogo e da equipe, lido uma vez so, quando o primeiro arquivo precisa. */
type Catalog = {
  cohorts: Map<string, string>;
  lessonsByProduct: Map<string, Set<string>>;
  modules: Map<string, ModuleRow>;
  products: Row[];
  staff: Row[];
  staffIds: Set<string>;
  titles: Map<string, string>;
};

function memo<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => (promise ??= load());
}

/** As linhas de um arquivo: o BOM e o cabecalho, depois uma pagina por vez (cada pagina vira um pedaco do ZIP). */
async function* csvFile(headers: readonly string[], pages: AsyncIterable<CsvCell[][]>, count: (rows: number) => void): AsyncGenerator<string> {
  yield `${CSV_BOM}${toCsvLine(headers)}\r\n`;

  for await (const page of pages) {
    if (page.length === 0) {
      continue;
    }

    count(page.length);
    yield `${page.map((cells) => toCsvLine(cells)).join("\r\n")}\r\n`;
  }
}

export type SchoolExportOptions = {
  keys: readonly ExportFileKey[];
  now: Date;
  /** As linhas de cada arquivo, contadas enquanto o ZIP sai (a auditoria do fim). */
  rows: Map<string, number>;
  pageSize?: number;
};

/** O LEIA-ME e os arquivos da exportacao, na ordem de `keys`, cada um gerado so quando o ZIP chega nele. */
export function schoolExportEntries(db: SalesDb, options: SchoolExportOptions): ZipEntry[] {
  const pageSize = options.pageSize ?? EXPORT_PAGE_SIZE;
  const nowMs = options.now.getTime();
  const counter = (name: string) => (rows: number) => options.rows.set(name, (options.rows.get(name) ?? 0) + rows);

  const catalog = memo(async (): Promise<Catalog> => {
    const [products, modules, lessons, cohorts, staff] = await Promise.all([
      readAll(db, "content_items", "id,title,kind,publication_status,listing,created_at", pageSize),
      readAll<Row & ModuleRow>(db, "course_modules", "id,title,owner_id,sort_order,status,deleted_at", pageSize),
      readAll<Row & { deleted_at: string | null; module_id: string; status: string | null }>(db, "lessons", "id,module_id,status,deleted_at", pageSize),
      readAll(db, "cohorts", "id,name", pageSize),
      readAll(db, "admin_roles", "id,user_id,role,created_at", pageSize)
    ]);
    const moduleMap = new Map<string, ModuleRow>(modules.filter((row) => row.deleted_at == null).map((row) => [row.id, row]));
    const lessonsByProduct = new Map<string, Set<string>>();

    // As aulas publicadas em modulos publicados, por produto: o mesmo total do progresso no admin.
    for (const lesson of lessons) {
      const owner = moduleMap.get(lesson.module_id);

      if (!owner || owner.status !== "published" || lesson.status !== "published" || lesson.deleted_at != null || typeof owner.owner_id !== "string") {
        continue;
      }

      const set = lessonsByProduct.get(owner.owner_id) ?? new Set<string>();
      set.add(lesson.id);
      lessonsByProduct.set(owner.owner_id, set);
    }

    return {
      cohorts: new Map(cohorts.map((row) => [row.id, String(row.name ?? "")])),
      lessonsByProduct,
      modules: moduleMap,
      products,
      staff,
      staffIds: new Set(staff.map((row) => String(row.user_id))),
      titles: new Map(products.map((row) => [row.id, String(row.title ?? "")]))
    };
  });

  async function* mapPages<T extends Row>(table: string, columns: string, toCells: (rows: T[], context: Catalog) => Promise<CsvCell[][]>): AsyncGenerator<CsvCell[][]> {
    const context = await catalog();

    for await (const page of keysetPages<T>(db, table, columns, pageSize)) {
      yield toCells(page, context);
    }
  }

  const sources: Record<ExportFileKey, () => AsyncIterable<CsvCell[][]>> = {
    acessos: () =>
      mapPages<Row & ExportEntitlementRow>("entitlements", "id,user_id,target_id,status,starts_at,ends_at,source_provider,source_event_id,created_at", async (rows, context) => {
        const emails = await emailsOf(db, rows.map((row) => row.user_id));
        return rows.map((row) => accessCells(row, emails.get(row.user_id), context.titles.get(row.target_id), nowMs));
      }),
    alunos: () =>
      mapPages<Row & ExportProfileRow>("profiles", "id,email,full_name,phone,created_at,last_sign_in_at", async (rows, context) =>
        rows.filter((row) => !context.staffIds.has(row.id)).map(studentCells)
      ),
    aulas: () =>
      mapPages<Row & { duration: string | null; module_id: string; sort_order: number | null; status: string | null; title: string | null; deleted_at: string | null }>(
        "lessons",
        "id,module_id,title,status,duration,sort_order,deleted_at",
        async (rows, context) =>
          rows
            .filter((row) => row.deleted_at == null && context.modules.has(row.module_id))
            .map((row) => {
              const owner = context.modules.get(row.module_id);
              return lessonCells(row, owner, owner?.owner_id ? context.titles.get(owner.owner_id) : undefined);
            })
      ),
    cursos: async function* () {
      const context = await catalog();

      for (let start = 0; start < context.products.length; start += pageSize) {
        yield context.products.slice(start, start + pageSize).map((row) => productCells(row as Parameters<typeof productCells>[0]));
      }
    },
    equipe: async function* () {
      const context = await catalog();

      for (let start = 0; start < context.staff.length; start += LOOKUP_CHUNK) {
        const page = context.staff.slice(start, start + LOOKUP_CHUNK);
        const ids = page.map((row) => String(row.user_id)).filter((id) => UUID_PATTERN.test(id));
        const { data, error } = ids.length > 0 ? await db.from("profiles").select("id,email,full_name").in("id", ids) : { data: [], error: null };

        if (error) {
          fail(error, "equipe");
        }

        const profiles = new Map(((data ?? []) as { email: string | null; full_name: string | null; id: string }[]).map((row) => [row.id, row]));
        yield page.map((row) => teamCells(row as unknown as Parameters<typeof teamCells>[0], profiles.get(String(row.user_id))));
      }
    },
    pacotes: async function* () {
      const context = await catalog();
      const combos = await readAll(db, "product_combos", "id,name,status", pageSize);
      const { data, error } = await db.from("product_combo_items").select("combo_id,product_id,sort_order").order("combo_id").order("sort_order").order("product_id");

      if (error) {
        fail(error, "itens dos pacotes");
      }

      const items = new Map<string, string[]>();

      for (const item of (data ?? []) as { combo_id: string; product_id: string }[]) {
        items.set(item.combo_id, [...(items.get(item.combo_id) ?? []), item.product_id]);
      }

      yield combos.map((row) => comboCells(row as unknown as Parameters<typeof comboCells>[0], items.get(row.id) ?? [], context.titles));
    },
    progresso: () =>
      mapPages<Row & { completed_lesson_ids: string[] | null; content_id: string; updated_at: string | null; user_id: string }>(
        "lesson_progress",
        "id,user_id,content_id,completed_lesson_ids,updated_at",
        async (rows, context) => {
          const emails = await emailsOf(db, rows.map((row) => row.user_id));
          return rows.map((row) => progressCells(row, emails.get(row.user_id), context.titles.get(row.content_id), context.lessonsByProduct.get(row.content_id)));
        }
      ),
    turmas: () =>
      mapPages<Row & { cohort_id: string; created_at: string | null; product_id: string; user_id: string }>(
        "cohort_memberships",
        "id,user_id,product_id,cohort_id,created_at",
        async (rows, context) => {
          const emails = await emailsOf(db, rows.map((row) => row.user_id));
          return rows.map((row) => cohortCells(row, emails.get(row.user_id), context.titles.get(row.product_id), context.cohorts.get(row.cohort_id)));
        }
      ),
    vendas: () => salePages(db, pageSize),
    vendasGuardadas: async function* () {
      try {
        for await (const page of keysetPages<Row & Parameters<typeof heldSaleCells>[0]>(
          db,
          "held_sales",
          "id,webhook_event_id,provider,transaction_id,product_ids,reason,status,held_at,resolved_at,resolution",
          pageSize
        )) {
          yield page.map((row) => heldSaleCells(row, heldSaleReasonTitle(row.reason)));
        }
      } catch (error) {
        // Banco sem a migracao 202611110002: nenhuma venda guardada, o arquivo sai so com o cabecalho.
        if (!(error instanceof Error && error.name === "PendingMigrationError")) {
          throw error;
        }
      }
    }
  };

  return [
    { content: () => [schoolExportReadme({ generatedAt: options.now, keys: options.keys })], name: README_NAME },
    ...options.keys.map((key): ZipEntry => {
      const file = EXPORT_FILES[key];
      return { content: () => csvFile(file.headers, sources[key](), counter(file.name)), name: file.name };
    })
  ];
}

const SALE_COLUMNS =
  "id,provider,event_type,normalized_type,received_at,buyer_email,external_product_id,external_product_name,product_id,combo_id,transaction_id,outcome,outcome_detail,processing_status,user_id,anonymized_at";

/** As vendas, com o valor quando o banco tem as colunas (migracao 202610300003); sem elas, sem o valor. */
async function* salePages(db: SalesDb, pageSize: number): AsyncGenerator<CsvCell[][]> {
  let columns = `${SALE_COLUMNS},amount_cents,currency`;
  let last: string | null = null;

  for (;;) {
    let query = db.from("webhook_events").select(columns);

    if (last !== null) {
      query = query.gt("id", last);
    }

    const { data, error } = await query.order("id", { ascending: true }).limit(pageSize);

    if (error && columns !== SALE_COLUMNS && isMissingSchemaObjectError(error)) {
      columns = SALE_COLUMNS;
      continue;
    }

    if (error) {
      fail(error, "vendas");
    }

    const rows = (data ?? []) as unknown as (ExportSaleRow & { id: string })[];

    if (rows.length === 0) {
      return;
    }

    yield rows.map(saleCells);

    if (rows.length < pageSize) {
      return;
    }

    last = rows[rows.length - 1].id;
  }
}
