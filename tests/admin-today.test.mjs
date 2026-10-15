import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Tela Hoje do admin (docs/17 §1.5; rodada "Layout do protótipo"): o modelo puro
// (src/components/admin/v2/today/today-model.ts), a migracao 202610120001 e as regras de honestidade
// das partes que ainda nao tem dado. today-model.ts importa "../filters", "../format" e "../period" sem
// extensao, entao o hook de resolucao entra antes e o modulo e carregado com import() dinamico.
await import("./support/resolve-extensionless-ts.mjs");
const model = await import("../src/components/admin/v2/today/today-model.ts");
const period = await import("../src/components/admin/v2/period.ts");

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

// Domingo, 11/10/2026, 15:37 em Sao Paulo.
const NOW = new Date("2026-10-11T18:37:12.345Z");
const resolve = (value, now = NOW) => period.resolveAdminPeriod(period.parseAdminPeriodParam(value, now), now);
const NB = " ";

const product = (id, overrides = {}) => ({
  accent: "lima",
  coverUrl: null,
  formatLabel: "Curso",
  id,
  lessonsPublished: 3,
  studentsWithAccess: 10,
  title: `Produto ${id}`,
  ...overrides
});

/* ------------------------------------------------------------------------------------------------
 * Cartoes de atencao
 * ---------------------------------------------------------------------------------------------- */

test("cartoes de atencao: ordem por urgencia, tom, rotulo de prioridade e destino", () => {
  const cards = model.buildAttentionCards({
    expiringAccesses: 5,
    overdueQuestions: 7,
    productId: null,
    productsWithoutLessons: [{ id: "p1", title: "Prompts" }]
  });

  assert.deepEqual(
    cards.map((card) => [card.id, card.count, card.tone, card.priorityLabel, card.action.label, card.action.href]),
    [
      ["perguntas", 7, "critical", `Passou de 24${NB}h`, "Responder", "/admin/comunidade"],
      ["acessos-expirando", 5, "warning", `Próximos 7${NB}dias`, "Ver alunos", "/admin/alunos"],
      ["produtos-sem-aula", 1, "neutral", "Catálogo", "Corrigir", "/admin/produtos/p1"]
    ]
  );
  assert.equal(cards[0].text, `perguntas de alunos sem resposta há mais de 24${NB}h`);
  assert.equal(cards[0].shortText, `perguntas sem resposta há +24${NB}h`);
  assert.equal(cards[1].text, `acessos terminam nos próximos 7${NB}dias`);
  assert.equal(cards[2].text, "produto publicado sem nenhuma aula publicada");
});

test("cartoes de atencao: singular e plural", () => {
  const single = model.buildAttentionCards({
    expiringAccesses: 1,
    overdueQuestions: 1,
    productId: null,
    productsWithoutLessons: [{ id: "a", title: "A" }]
  });

  assert.equal(single[0].text, `pergunta de aluno sem resposta há mais de 24${NB}h`);
  assert.equal(single[0].shortText, `pergunta sem resposta há +24${NB}h`);
  assert.equal(single[1].text, `acesso termina nos próximos 7${NB}dias`);
  assert.equal(single[1].shortText, `acesso termina em 7${NB}dias`);
  assert.equal(single[2].shortText, "produto publicado sem aulas");

  const many = model.buildAttentionCards({
    expiringAccesses: 2,
    overdueQuestions: 2,
    productId: null,
    productsWithoutLessons: [
      { id: "a", title: "A" },
      { id: "b", title: "B" }
    ]
  });

  assert.equal(many[1].shortText, `acessos terminam em 7${NB}dias`);
  assert.equal(many[2].text, "produtos publicados sem nenhuma aula publicada");
  assert.equal(many[2].action.href, "/admin/produtos?situacao=published", "varios produtos: a lista filtrada");
});

test("cartoes de atencao: so existem com regra calculavel e numero maior que zero", () => {
  assert.deepEqual(
    model.buildAttentionCards({ expiringAccesses: 0, overdueQuestions: 0, productId: null, productsWithoutLessons: [] }),
    []
  );
  assert.deepEqual(
    model.buildAttentionCards({ expiringAccesses: null, overdueQuestions: null, productId: null, productsWithoutLessons: null }),
    []
  );
  assert.deepEqual(
    model
      .buildAttentionCards({ expiringAccesses: Number.NaN, overdueQuestions: -3, productId: null, productsWithoutLessons: null })
      .map((card) => card.id),
    []
  );

  const complete = { expiringAccesses: 0, overdueQuestions: 0, productId: null, productsWithoutLessons: [] };
  assert.equal(model.isAttentionComplete(complete), true, "Tudo em dia so com todas as regras calculadas");
  assert.equal(model.isAttentionComplete({ ...complete, expiringAccesses: null }), false);
  assert.equal(model.isAttentionComplete({ ...complete, productsWithoutLessons: null }), false);
  assert.equal(model.isAttentionComplete({ ...complete, overdueQuestions: null }), false);
});

test("cartoes de atencao respeitam o produto da barra superior", () => {
  const cards = model.buildAttentionCards({
    expiringAccesses: 3,
    overdueQuestions: 4,
    productId: "formacao-ia",
    productsWithoutLessons: [
      { id: "outro", title: "Outro" },
      { id: "formacao-ia", title: "Formação IA" }
    ]
  });

  assert.equal(cards[0].action.href, "/admin/comunidade?produto=formacao-ia");
  assert.equal(cards[2].count, 1, "so o produto escolhido conta no catalogo");
  assert.equal(cards[2].action.href, "/admin/produtos/formacao-ia");

  const otherProduct = model.buildAttentionCards({
    expiringAccesses: 0,
    overdueQuestions: 0,
    productId: "sem-problema",
    productsWithoutLessons: [{ id: "outro", title: "Outro" }]
  });
  assert.deepEqual(otherProduct, []);
});

test("no maximo quatro cartoes", () => {
  assert.equal(model.MAX_ATTENTION_CARDS, 4);
  assert.ok(
    model.buildAttentionCards({ expiringAccesses: 9, overdueQuestions: 9, productId: null, productsWithoutLessons: [{ id: "a", title: "A" }] })
      .length <= 4
  );
});

/* ------------------------------------------------------------------------------------------------
 * Secao de numeros
 * ---------------------------------------------------------------------------------------------- */

test("titulo e frase de apoio da secao de numeros seguem o periodo", () => {
  const cases = [
    [undefined, "Números dos últimos 30 dias", "comparados aos 30 dias anteriores"],
    ["30d", "Números dos últimos 30 dias", "comparados aos 30 dias anteriores"],
    ["7d", "Números dos últimos 7 dias", "comparados aos 7 dias anteriores"],
    ["3d", "Números dos últimos 3 dias", "comparados aos 3 dias anteriores"],
    ["1d", "Números das últimas 24 horas", "comparados às 24 horas anteriores"],
    ["hoje", "Números de hoje", "comparados com ontem até a mesma hora"],
    ["2026-10-01..2026-10-10", "Números de 1 a 10 de out. de 2026", "comparados aos 10 dias anteriores"],
    ["2026-10-05", "Números de 5 de out. de 2026", "comparados ao dia anterior"],
    ["2025-12-28..2026-01-03", "Números de 28 de dez. de 2025 a 3 de jan. de 2026", "comparados aos 7 dias anteriores"],
    ["90", "Números de 14 de jul. a 11 de out. de 2026", "comparados aos 90 dias anteriores"]
  ];

  for (const [value, title, meta] of cases) {
    assert.deepEqual(model.getTodayNumbersHeading(resolve(value)), { meta, title }, String(value));
  }
});

test("atividade: por hora ate 3 dias, por dia acima; Por produto com o periodo em minusculas", () => {
  assert.equal(model.getActivityMeta(resolve("hoje")), "por hora");
  assert.equal(model.getActivityMeta(resolve("1d")), "por hora");
  assert.equal(model.getActivityMeta(resolve("3d")), "por hora");
  assert.equal(model.getActivityMeta(resolve("7d")), "por dia");
  assert.equal(model.getActivityMeta(resolve("30d")), "por dia");
  assert.equal(model.getActivityMeta(resolve("2026-10-01..2026-10-10")), "por dia");

  assert.equal(model.getByProductMeta(resolve("30d")), "últimos 30 dias");
  assert.equal(model.getByProductMeta(resolve("hoje")), "hoje");
  assert.equal(model.getByProductMeta(resolve("1d")), "últimas 24 horas");
  assert.equal(model.getByProductMeta(resolve("2026-10-01..2026-10-10")), "1 a 10 de out. de 2026");
});

test("delta: percentual com uma casa, pontos, e sem delta quando o anterior e zero ou falta", () => {
  assert.equal(model.computePercentDelta(37, 33), 12.1);
  assert.equal(model.computePercentDelta(30, 40), -25);
  assert.equal(model.computePercentDelta(10, 10), 0);
  assert.equal(model.computePercentDelta(5, 0), null, "de 0 para 5 nao e +infinito");
  assert.equal(model.computePercentDelta(0, 0), null);
  assert.equal(model.computePercentDelta(null, 10), null);
  assert.equal(model.computePercentDelta(10, undefined), null);
  assert.equal(model.computePercentDelta(Number.NaN, 10), null);

  assert.equal(model.computePointsDelta(41, 39), 2);
  assert.equal(model.computePointsDelta(38.5, 40), -1.5);
  assert.equal(model.computePointsDelta(0, 0), 0);
  assert.equal(model.computePointsDelta(null, 3), null);
});

test("serie do mini-grafico: baldes do periodo por dia, buracos = 0, linhas de fora ignoradas", () => {
  const resolved = resolve("7d");
  const buckets = period.listAdminPeriodBuckets(resolved);

  assert.deepEqual(
    buckets.map((bucket) => bucket.key),
    ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]
  );
  assert.deepEqual(
    model.fillBucketSeries(buckets, [
      { bucket: "2026-10-05", total: 2 },
      { bucket: "2026-10-08", total: "4" },
      { bucket: "2026-10-11", total: 1 },
      { bucket: "2026-10-11", total: 1 },
      { bucket: "2026-09-30", total: 99 },
      { bucket: null, total: 5 },
      { bucket: "2026-10-06", total: "x" }
    ]),
    [2, 0, 0, 4, 0, 0, 2]
  );
  assert.deepEqual(model.fillBucketSeries(buckets, []), [0, 0, 0, 0, 0, 0, 0]);
});

test("serie do mini-grafico: baldes por hora com a chave do banco ('AAAA-MM-DDTHH', fuso da escola)", () => {
  const resolved = resolve("hoje");
  const buckets = period.listAdminPeriodBuckets(resolved);

  assert.equal(buckets.length, 16, "de 0h ate a hora em curso (15h)");
  assert.equal(buckets[0].key, "2026-10-11T00");
  assert.equal(buckets.at(-1).key, "2026-10-11T15");

  const series = model.fillBucketSeries(buckets, [
    { bucket: "2026-10-11T00", total: 1 },
    { bucket: "2026-10-11T09", total: 3 },
    { bucket: "2026-10-11T15", total: 2 }
  ]);
  assert.equal(series.length, 16);
  assert.equal(series[0], 1);
  assert.equal(series[9], 3);
  assert.equal(series[15], 2);
  assert.equal(model.sumSeries(series), 6);

  // A chave do grafico e a mesma que o banco escreve (to_char ... 'YYYY-MM-DD"T"HH24').
  assert.equal(period.getAdminBucketKey(new Date("2026-10-11T12:05:00Z"), "hour"), "2026-10-11T09");
  assert.equal(period.getAdminBucketKey(new Date("2026-10-11T02:30:00Z"), "day"), "2026-10-10", "23h30 de sabado ainda e sabado");
});

test("serie longa fica com no maximo 60 pontos e o mesmo total", () => {
  const values = Array.from({ length: 366 }, (_, index) => index % 5);
  const compressed = model.compressSeries(values);

  assert.ok(compressed.length <= 60);
  assert.equal(model.sumSeries(compressed), model.sumSeries(values));
  assert.deepEqual(model.compressSeries([1, 2, 3]), [1, 2, 3]);
});

/* ------------------------------------------------------------------------------------------------
 * Criar e Por produto
 * ---------------------------------------------------------------------------------------------- */

test("Criar: so destinos reais, o resto desativado com 'Em breve' e nunca 'fase'", async () => {
  const items = model.TODAY_CREATE_ITEMS;

  assert.deepEqual(
    items.map((item) => [item.label, item.href, item.meta ?? null]),
    [
      ["Produto", "/admin/produtos/novo", null],
      ["Produto a partir de uma playlist", "/admin/produtos/importar", null],
      ["Pacote", "/admin/produtos/pacotes", null],
      ["Aluno", "/admin/alunos/novo", null],
      ["Aviso", null, "Em breve"],
      ["Webinário", null, "Em breve"],
      ["Promoção", null, "Em breve"]
    ]
  );

  for (const item of items) {
    assert.doesNotMatch(`${item.label} ${item.meta ?? ""}`, /fase/i);
  }

  // Cada destino ativo tem uma pagina no admin.
  const { existsSync } = await import("node:fs");
  const pages = {
    "/admin/produtos/importar": "src/app/admin/(v2)/produtos/importar/page.tsx",
    "/admin/produtos/novo": "src/app/admin/(v2)/produtos/novo/page.tsx",
    "/admin/produtos/pacotes": "src/app/admin/(v2)/produtos/pacotes/page.tsx",
    "/admin/alunos/novo": "src/app/admin/(v2)/alunos/novo/page.tsx"
  };
  for (const [href, file] of Object.entries(pages)) {
    assert.ok(items.some((item) => item.href === href), href);
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  }
});

test("Criar segue a tabela de papeis; sem nenhum destino ativo, sem botao", async () => {
  const roles = await import("../src/server/auth/roles.ts");
  const labelsFor = (role) => model.getTodayCreateItems((action) => roles.canRole(role, action)).map((item) => item.label);

  assert.deepEqual(labelsFor("owner"), model.TODAY_CREATE_ITEMS.map((item) => item.label));
  assert.deepEqual(labelsFor("editor"), [
    "Produto",
    "Produto a partir de uma playlist",
    "Pacote",
    "Aviso",
    "Webinário",
    "Promoção"
  ]);
  assert.deepEqual(labelsFor("support"), ["Aluno"]);
  assert.deepEqual(labelsFor("analyst"), [], "analista so le: nada para criar");
});

test("Por produto: publicados com aula, mais alunos com acesso primeiro, ate 6, linha abre o Desempenho", () => {
  const products = [
    product("a", { studentsWithAccess: 5 }),
    product("b", { studentsWithAccess: 50 }),
    product("sem-aula", { lessonsPublished: 0, studentsWithAccess: 999 }),
    product("c", { studentsWithAccess: 20 }),
    product("d", { studentsWithAccess: 20, title: "A primeiro no empate" }),
    product("e", { studentsWithAccess: 1 }),
    product("f", { studentsWithAccess: 0 }),
    product("g", { studentsWithAccess: 3 })
  ];
  const rows = model.selectByProductRows(products, null);

  assert.deepEqual(
    rows.map((row) => row.id),
    ["b", "d", "c", "a", "g", "e"]
  );
  assert.ok(rows.every((row) => row.emphasis === "none"));
  assert.equal(rows[0].href, "/admin/produtos/b/desempenho");
  assert.equal(model.selectByProductRows(products, null, { periodParam: "7d" })[0].href, "/admin/produtos/b/desempenho?periodo=7d");
  assert.deepEqual(model.selectByProductRows([], null), []);
});

test("Por produto: com produto escolhido, a linha dele destacada e as outras apagadas, mesmo fora dos 6", () => {
  const products = ["a", "b", "c", "d", "e", "f", "g"].map((id, index) => product(id, { studentsWithAccess: 100 - index }));
  const rows = model.selectByProductRows(products, "g");

  assert.equal(rows.length, 6);
  assert.deepEqual(
    rows.map((row) => [row.id, row.emphasis]),
    [
      ["a", "dim"],
      ["b", "dim"],
      ["c", "dim"],
      ["d", "dim"],
      ["e", "dim"],
      ["g", "highlight"]
    ]
  );

  const unknown = model.selectByProductRows(products, "nao-existe");
  assert.ok(unknown.every((row) => row.emphasis === "dim"));
});

test("produtos publicados sem aula publicada", () => {
  assert.deepEqual(
    model.listProductsWithoutLessons([product("a"), product("b", { lessonsPublished: 0, title: "Vazio" })]),
    [{ id: "b", title: "Vazio" }]
  );
});

test("cabecalho: data longa e hora da verificacao no fuso da escola", () => {
  assert.equal(model.formatTodayDate(NOW), "domingo, 11 de outubro");
  assert.equal(model.formatTodayDate(new Date("2026-10-11T02:30:00Z")), "sábado, 10 de outubro", "23h30 em Sao Paulo");
  assert.equal(model.formatCheckTime(NOW), "15:37");
  assert.equal(model.getFirstName("  Danilo Souza "), "Danilo");
});

/* ------------------------------------------------------------------------------------------------
 * Migracao 202610120001
 * ---------------------------------------------------------------------------------------------- */

test("migracao 202610120001: idempotente, security invoker, so service_role, fuso da escola e sem a equipe", async () => {
  const sql = await read("supabase/migrations/202610120001_admin_today.sql");
  const code = stripComments(sql);

  for (const fn of ["admin_today_alerts", "admin_access_buckets"]) {
    assert.match(code, new RegExp(`create or replace function public\\.${fn}\\(`), fn);
  }

  assert.doesNotMatch(code, /create function |create table |drop table|delete from|update public\.|insert into/i);
  assert.equal((code.match(/security invoker/g) ?? []).length, 2);
  assert.doesNotMatch(code, /security definer/);
  assert.equal((code.match(/set search_path = public/g) ?? []).length, 2);

  assert.match(code, /revoke all on function public\.admin_today_alerts\(text\) from public, anon, authenticated;/);
  assert.match(
    code,
    /revoke all on function public\.admin_access_buckets\(timestamptz, timestamptz, text, text\) from public, anon, authenticated;/
  );
  assert.match(code, /grant execute on function public\.admin_today_alerts\(text\) to service_role;/);
  assert.match(code, /grant execute on function public\.admin_access_buckets\(timestamptz, timestamptz, text, text\) to service_role;/);
  assert.doesNotMatch(code, /grant [^;]* to (anon|authenticated|public)\b/);

  // Fuso e formato da chave iguais a getAdminBucketKey.
  assert.match(code, /at time zone 'America\/Sao_Paulo', 'YYYY-MM-DD"T"HH24'/);
  assert.match(code, /at time zone 'America\/Sao_Paulo', 'YYYY-MM-DD'\)/);
  assert.match(code, /p_granularity not in \('hour', 'day'\)/);
  assert.match(code, /raise exception 'invalid_granularity'/);

  // A equipe nunca entra nas contas (nos acessos expirando e nos novos acessos).
  assert.equal((code.match(/not exists \(select 1 from public\.admin_roles staff where staff\.user_id = e\.user_id\)/g) ?? []).length, 2);

  // Pergunta sem resposta: a mesma definicao da Comunidade.
  assert.match(code, /from public\.community_open_questions q\s+join public\.community_lesson_scope\(p_content_id\)/);
  assert.match(code, /q\.created_at < now\(\) - interval '24 hours'/);
  assert.match(code, /e\.ends_at > now\(\)\s+and e\.ends_at <= now\(\) \+ interval '7 days'/);

  // Indices novos so com if not exists.
  for (const index of code.match(/create index[^;]*/g) ?? []) {
    assert.match(index, /create index if not exists/);
  }
});

test("o servidor do Hoje usa as funcoes novas e cai para o aviso sem a migracao", async () => {
  const server = await read("src/server/admin/today.ts");

  assert.match(server, /^import "server-only";/);
  assert.match(server, /rpc\("admin_today_alerts"/);
  assert.match(server, /rpc\("admin_access_buckets"/);
  assert.match(server, /rpc\("admin_product_list"/);
  assert.match(server, /p_status: "published"/);
  assert.match(server, /isPendingMigrationError/);
  assert.match(server, /countOverdueQuestions/, "sem a migracao, o contador da Comunidade continua");
  assert.match(server, /export async function readTodayAlertSummary\(\): Promise<TodayAlertSummary \| null>/);
});

/* ------------------------------------------------------------------------------------------------
 * Honestidade da tela
 * ---------------------------------------------------------------------------------------------- */

test("a tela nao inventa numero: estudo em '—', sem 'Exemplo', sem 'fase' no texto", async () => {
  const files = [
    "src/app/admin/(v2)/page.tsx",
    "src/components/admin/v2/today/today-view.tsx",
    "src/components/admin/v2/today/today-kpis.tsx",
    "src/components/admin/v2/today/today-activity-card.tsx",
    "src/components/admin/v2/today/today-by-product.tsx",
    "src/components/admin/v2/today/today-attention.tsx",
    "src/components/admin/v2/today/create-menu.tsx",
    "src/components/admin/v2/attention-card.tsx"
  ];

  for (const file of files) {
    const code = stripComments(await read(file));

    assert.doesNotMatch(code, /\bfase \d|Simular dados|"Exemplo"|Math\.random/i, file);
  }

  const kpis = stripComments(await read("src/components/admin/v2/today/today-kpis.tsx"));
  for (const label of ["Alunos estudando", "Aulas concluídas", "Conclusão em 90 dias"]) {
    assert.match(kpis, new RegExp(`label="${label}"[^>]*value=\\{null\\}`), label);
  }
  assert.match(kpis, /label="Novos acessos"/);

  const activity = stripComments(await read("src/components/admin/v2/today/today-activity-card.tsx"));
  // Sem pontos (sem registro de aulas e sem ADMIN_DEMO_DATA) o card fica vazio.
  assert.match(activity, /state=\{hasPoints \? "ready" : "empty"\}/);

  const view = await read("src/components/admin/v2/today/today-view.tsx");
  assert.match(view, /O registro de aulas assistidas ainda está sendo construído/);

  const page = await read("src/app/admin/(v2)/page.tsx");
  assert.match(page, /requirePageArea\("hoje"\)/, "Visao geral so para quem ve os numeros (reports.read)");
  assert.doesNotMatch(page, /from "@\/components\/admin\/v2\/filters";\s*import \{ describeAdminPeriod/);
  assert.doesNotMatch(page, /parseAdminPeriod\(|describeAdminPeriod|describePreviousPeriod/, "o Hoje usa o modelo novo de periodo");
});
