import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";
import { crc32, inflateRawSync } from "node:zlib";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { bancoEmMemoria } from "./support/vendas-banco-em-memoria.mjs";

// Exportar dados (docs/32 §2.2 e §4), sem o Supabase local: a rota GET /api/admin/dados/exportar de verdade, sobre um banco
// em memoria (tests/support/vendas-banco-em-memoria.mjs), com a sessao trocada por um duble. Aqui:
// - o ZIP e valido (lido aqui pelo diretorio central, com o CRC-32 de cada arquivo conferido) e traz o LEIA-ME e os CSVs:
//   alunos (sem a equipe), acessos, progresso, cursos, modulos e aulas, pacotes, turmas, vendas, equipe e, no produto
//   vendido, as vendas guardadas, com o conteudo certo em cada coluna;
// - nada de segredo: nem o hash do token das plataformas, nem a licenca, nem o segredo da Instalacao, nem o payload das
//   vendas; as tabelas deles nem sao lidas;
// - so o dono e os administradores (inclusive a funcao Administrador combinada); o resto da equipe recebe 403 e quem nao
//   entrou, 401;
// - em todo degrau da Licenca (dever legal): congelada, nunca ativada e com a leitura que falha, sem nem ler a licenca;
// - em fluxo: a rota responde antes de ler as tabelas, e cada tabela e lida pagina a pagina pela chave;
// - a auditoria: o pedido antes do primeiro byte e as linhas de cada arquivo no fim.

const sessao = (globalThis.__exportarSessao ??= { access: null, user: null });
const licenca = (globalThis.__exportarLicenca ??= { leituras: 0, situacao: null });

function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }

  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }

  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);

    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiAdmin() {
          const sessao = globalThis.__exportarSessao;
          if (!sessao.user) return { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
          if (!sessao.access) return { response: Response.json({ error: "Permissao administrativa obrigatoria." }, { status: 403 }), user: sessao.user };
          return { access: sessao.access, response: null, role: sessao.access.role, user: sessao.user };
        }
        export const requireApiUser = requireApiAdmin;`);
    }

    if (modulo === "server/licensing/current-state") {
      return stub(`
        export async function getCurrentLicenseState() { globalThis.__exportarLicenca.leituras += 1; return globalThis.__exportarLicenca.situacao; }
        export const readCurrentLicenseState = getCurrentLicenseState;
        export function forgetLicenseStateMemory() {}`);
    }

    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }

    return nextResolve(specifier, context);
  }
});

const route = await import("../src/app/api/admin/dados/exportar/route.ts");
const { resolveAdminAccess } = await import("../src/server/auth/roles.ts");
const { parseCsv } = await import("../src/lib/csv.ts");
const { schoolExportEntries } = await import("../src/server/export/school-data.ts");
const { exportFileKeys, exportMoney, schoolExportFileName } = await import("../src/server/export/school-data-model.ts");
const { zipToBuffer } = await import("../src/server/export/zip.ts");

/* ------------------------------------------------------------------------------------------------
 * Um leitor de ZIP pequeno: o diretorio central, cada arquivo inflado e o CRC-32 conferido
 * ---------------------------------------------------------------------------------------------- */

function lerZip(zip) {
  const fim = zip.length - 22;
  assert.equal(zip.readUInt32LE(fim), 0x06054b50, "fim do diretorio central");
  const total = zip.readUInt16LE(fim + 10);
  let posicao = zip.readUInt32LE(fim + 16);
  const arquivos = new Map();

  for (let i = 0; i < total; i += 1) {
    assert.equal(zip.readUInt32LE(posicao), 0x02014b50, "cabecalho central");
    const metodo = zip.readUInt16LE(posicao + 10);
    const crc = zip.readUInt32LE(posicao + 16);
    const comprimido = zip.readUInt32LE(posicao + 20);
    const tamanho = zip.readUInt32LE(posicao + 24);
    const nomeTam = zip.readUInt16LE(posicao + 28);
    const extraTam = zip.readUInt16LE(posicao + 30);
    const comentarioTam = zip.readUInt16LE(posicao + 32);
    const local = zip.readUInt32LE(posicao + 42);
    const nome = zip.toString("utf8", posicao + 46, posicao + 46 + nomeTam);

    assert.equal(zip.readUInt32LE(local), 0x04034b50, `cabecalho local de ${nome}`);
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const dados = inflateRawSync(zip.subarray(inicio, inicio + comprimido));

    assert.equal(metodo, 8, `${nome}: deflate`);
    assert.equal(dados.length, tamanho, `${nome}: tamanho`);
    assert.equal(crc32(dados) >>> 0, crc, `${nome}: CRC-32`);
    arquivos.set(nome, dados.toString("utf8"));
    posicao += 46 + nomeTam + extraTam + comentarioTam;
  }

  return arquivos;
}

/** O CSV sem o BOM, como a planilha le: cabecalho e linhas. */
function csv(texto) {
  assert.ok(texto.startsWith("﻿"), "o BOM do Excel");
  return parseCsv(texto);
}

/* ------------------------------------------------------------------------------------------------
 * A escola de teste
 * ---------------------------------------------------------------------------------------------- */

const ID = {
  admin: "00000000-0000-4000-8000-0000000000a1",
  ana: "00000000-0000-4000-8000-00000000a001",
  bruno: "00000000-0000-4000-8000-00000000a002",
  dona: "00000000-0000-4000-8000-0000000000d1",
  esperto: "00000000-0000-4000-8000-00000000a003"
};
const SEGREDO_DA_PLATAFORMA = "f".repeat(64);
const LICENCA_GUARDADA = "BKL1.certificado.assinatura.licenca.assinatura";
const SEGREDO_DA_INSTALACAO = "segredo-da-instalacao-nunca-sai";
const CPF = "123.456.789-00";

function escola() {
  return bancoEmMemoria({
    tabelas: {
      admin_roles: [
        { created_at: "2026-01-02T12:00:00.000Z", id: "r1", permissions: {}, role: "owner", user_id: ID.dona },
        { created_at: "2026-02-03T12:00:00.000Z", id: "r2", permissions: {}, role: "admin", user_id: ID.admin }
      ],
      cohort_memberships: [{ cohort_id: "t1", created_at: "2026-03-01T12:00:00.000Z", id: "cm1", product_id: "curso-a", user_id: ID.ana }],
      cohorts: [{ id: "t1", name: "Turma A" }],
      content_items: [
        { created_at: "2026-01-10T12:00:00.000Z", id: "curso-a", kind: "Curso", listing: "listed", publication_status: "published", title: "Curso A" },
        { created_at: "2026-01-11T12:00:00.000Z", id: "curso-b", kind: "Formacao", listing: "hidden", publication_status: "draft", title: "Formação B" }
      ],
      course_modules: [
        { deleted_at: null, id: "m1", owner_id: "curso-a", sort_order: 1, status: "published", title: "Módulo 1" },
        { deleted_at: "2026-05-01T12:00:00.000Z", id: "m2", owner_id: "curso-a", sort_order: 2, status: "deleted", title: "Módulo apagado" }
      ],
      entitlements: [
        { created_at: "2026-03-01T12:00:00.000Z", ends_at: null, id: "e1", source_event_id: "HP-1", source_provider: "hotmart", starts_at: "2026-03-01T12:00:00.000Z", status: "active", target_id: "curso-a", user_id: ID.ana },
        { created_at: "2026-03-02T12:00:00.000Z", ends_at: null, id: "e2", source_event_id: "admin:curso-a", source_provider: "manual", starts_at: "2026-03-02T12:00:00.000Z", status: "revoked", target_id: "curso-a", user_id: ID.bruno }
      ],
      integration_settings: [{ provider: "hotmart", secret: SEGREDO_DA_PLATAFORMA, secret_status: "set", status: "configured" }],
      held_sales: [
        {
          held_at: "2026-11-10T12:00:00.000Z",
          id: "h1",
          product_ids: ["curso-b"],
          provider: "hotmart",
          reason: "escola_congelada",
          resolution: null,
          resolved_at: null,
          status: "held",
          transaction_id: "HP-2",
          webhook_event_id: "w2"
        }
      ],
      lesson_progress: [{ completed_lesson_ids: ["l1", "l3", "l1"], content_id: "curso-a", id: "p1", updated_at: "2026-04-01T12:00:00.000Z", user_id: ID.ana }],
      lessons: [
        { deleted_at: null, duration: "10 min", id: "l1", module_id: "m1", sort_order: 1, status: "published", title: "Aula 1" },
        { deleted_at: null, duration: "12 min", id: "l2", module_id: "m1", sort_order: 2, status: "published", title: "Aula 2" },
        { deleted_at: "2026-05-01T12:00:00.000Z", duration: "5 min", id: "l3", module_id: "m1", sort_order: 3, status: "deleted", title: "Aula apagada" },
        { deleted_at: null, duration: "7 min", id: "l4", module_id: "m2", sort_order: 1, status: "published", title: "Aula do módulo apagado" }
      ],
      license_state: [{ id: 1, installation_secret: SEGREDO_DA_INSTALACAO, token: LICENCA_GUARDADA }],
      product_combo_items: [
        { combo_id: "pacote-ab", product_id: "curso-a", sort_order: 0 },
        { combo_id: "pacote-ab", product_id: "curso-b", sort_order: 1 }
      ],
      product_combos: [{ id: "pacote-ab", name: "Pacote AB", status: "active" }],
      profiles: [
        { created_at: "2026-01-01T12:00:00.000Z", email: "dona@escola.test", full_name: "Dona da Escola", id: ID.dona, last_sign_in_at: null, phone: null },
        { created_at: "2026-01-01T12:00:00.000Z", email: "admin@escola.test", full_name: "Admin da Escola", id: ID.admin, last_sign_in_at: null, phone: null },
        { created_at: "2026-03-01T15:30:00.000Z", email: "ana@aluna.test", full_name: "Ana Aluna", id: ID.ana, last_sign_in_at: "2026-11-10T13:45:00.000Z", phone: "+55 11999990000" },
        { created_at: "2026-03-02T12:00:00.000Z", email: "bruno@aluno.test", full_name: "Bruno; \"Aluno\"", id: ID.bruno, last_sign_in_at: null, phone: null },
        { created_at: "2026-03-03T12:00:00.000Z", email: "esperto@aluno.test", full_name: "=HYPERLINK(\"http://x\")", id: ID.esperto, last_sign_in_at: null, phone: null }
      ],
      webhook_events: [
        {
          amount_cents: 150000,
          anonymized_at: null,
          buyer_email: "ana@aluna.test",
          combo_id: null,
          currency: "BRL",
          event_type: "PURCHASE_APPROVED",
          external_event_id: "ev-1",
          external_product_id: "7001",
          external_product_name: "Curso A na Hotmart",
          id: "w1",
          normalized_type: "purchase_approved",
          outcome: "access_granted",
          outcome_detail: "1 produto liberado; conta nova.",
          payload: { data: { buyer: { document: CPF, email: "ana@aluna.test" } }, hottok: SEGREDO_DA_PLATAFORMA },
          processing_status: "processed",
          product_id: "curso-a",
          provider: "hotmart",
          received_at: "2026-03-01T12:00:00.000Z",
          transaction_id: "HP-1",
          user_id: ID.ana
        },
        {
          amount_cents: null,
          anonymized_at: null,
          buyer_email: "carla@compradora.test",
          combo_id: null,
          currency: null,
          event_type: "PURCHASE_APPROVED",
          external_event_id: "ev-2",
          external_product_id: "7003",
          external_product_name: null,
          id: "w2",
          normalized_type: "purchase_approved",
          outcome: "held",
          outcome_detail: "Venda guardada (Escola congelada)",
          payload: { data: { buyer: { document: CPF } } },
          processing_status: "processed",
          product_id: "curso-b",
          provider: "hotmart",
          received_at: "2026-11-10T12:00:00.000Z",
          transaction_id: "HP-2",
          user_id: null
        }
      ]
    }
  });
}

function entrar(papel, permissoes = {}) {
  sessao.user = { id: papel === "owner" ? ID.dona : ID.admin };
  sessao.access = resolveAdminAccess(papel, permissoes);
}

async function baixar() {
  const resposta = await route.GET();
  const corpo = Buffer.from(await resposta.arrayBuffer());
  return { corpo, resposta };
}

beforeEach(() => {
  process.env.BUNKER_LICENSING_MODE = "enforce";
  licenca.leituras = 0;
  licenca.situacao = null;
  entrar("owner");
});

/* ------------------------------------------------------------------------------------------------
 * O conteudo
 * ---------------------------------------------------------------------------------------------- */

test("o ZIP: válido, com o LEIA-ME e um CSV por parte da escola, cada coluna no lugar", async () => {
  const db = escola();
  actionStubs.db = db;

  const { corpo, resposta } = await baixar();

  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("content-type"), "application/zip");
  assert.equal(resposta.headers.get("cache-control"), "private, no-store");
  assert.match(resposta.headers.get("content-disposition"), /^attachment; filename="dados-da-escola-\d{4}-\d{2}-\d{2}\.zip"$/);

  const arquivos = lerZip(corpo);
  assert.deepEqual(
    [...arquivos.keys()],
    ["LEIA-ME.txt", "alunos.csv", "acessos.csv", "progresso.csv", "cursos.csv", "modulos-e-aulas.csv", "pacotes.csv", "turmas.csv", "vendas.csv", "vendas-guardadas.csv", "equipe.csv"]
  );

  const leiaMe = arquivos.get("LEIA-ME.txt");
  for (const nome of [...arquivos.keys()].filter((nome) => nome.endsWith(".csv"))) {
    assert.match(leiaMe, new RegExp(`- ${nome.replace(".", "\\.")}: `), `o LEIA-ME explica ${nome}`);
  }
  assert.match(leiaMe, /Senhas, tokens, chaves, os segredos das integrações e a licença/);

  // Alunos: sem a equipe; a celula que viraria formula ganha o apostrofo; aspas e ponto e virgula voltam inteiros.
  const alunos = csv(arquivos.get("alunos.csv"));
  assert.deepEqual(alunos.headers, ["ID do aluno", "Nome", "E-mail", "Telefone", "Cadastro em", "Último acesso"]);
  assert.deepEqual(alunos.rows.map((linha) => linha[2]).sort(), ["ana@aluna.test", "bruno@aluno.test", "esperto@aluno.test"]);
  // O telefone com "+" tambem ganha o apostrofo (a regra de toda exportacao em CSV desta area, o LEIA-ME avisa).
  assert.deepEqual(alunos.rows.find((linha) => linha[0] === ID.ana), [ID.ana, "Ana Aluna", "ana@aluna.test", "'+55 11999990000", "01/03/2026 12:30", "10/11/2026 10:45"]);
  assert.equal(alunos.rows.find((linha) => linha[0] === ID.bruno)[1], 'Bruno; "Aluno"');
  assert.equal(alunos.rows.find((linha) => linha[0] === ID.esperto)[1], "'=HYPERLINK(\"http://x\")");

  // Acessos: com o e-mail, o nome do produto, a situacao de hoje e a origem.
  const acessos = csv(arquivos.get("acessos.csv"));
  assert.deepEqual(acessos.rows.find((linha) => linha[0] === "e1"), ["e1", ID.ana, "ana@aluna.test", "curso-a", "Curso A", "Ativo", "01/03/2026 09:00", "", "Hotmart", "HP-1", "01/03/2026 09:00"]);
  assert.deepEqual(acessos.rows.find((linha) => linha[0] === "e2").slice(5, 10), ["Revogado", "02/03/2026 09:00", "", "Equipe", ""]);

  // Progresso: so as aulas publicadas contam (a apagada e a do modulo apagado nao); repetida conta uma vez.
  const progresso = csv(arquivos.get("progresso.csv"));
  assert.deepEqual(progresso.rows, [[ID.ana, "ana@aluna.test", "curso-a", "Curso A", "1", "2", "50", "01/04/2026 09:00", "l1 l3"]]);

  // Cursos, modulos e aulas (sem as apagadas), pacotes e turmas.
  assert.deepEqual(csv(arquivos.get("cursos.csv")).rows, [
    ["curso-a", "Curso A", "Curso", "Publicado", "Na vitrine", "10/01/2026 09:00"],
    ["curso-b", "Formação B", "Formacao", "Rascunho", "Oculto", "11/01/2026 09:00"]
  ]);
  assert.deepEqual(csv(arquivos.get("modulos-e-aulas.csv")).rows, [
    ["curso-a", "Curso A", "m1", "Módulo 1", "1", "l1", "Aula 1", "1", "Publicada", "10 min"],
    ["curso-a", "Curso A", "m1", "Módulo 1", "1", "l2", "Aula 2", "2", "Publicada", "12 min"]
  ]);
  assert.deepEqual(csv(arquivos.get("pacotes.csv")).rows, [["pacote-ab", "Pacote AB", "Ativo", "curso-a curso-b", "Curso A | Formação B"]]);
  assert.deepEqual(csv(arquivos.get("turmas.csv")).rows, [[ID.ana, "ana@aluna.test", "curso-a", "Curso A", "Turma A", "01/03/2026 09:00"]]);

  // Vendas: o comprador, o valor em reais com virgula, o resultado; vendas guardadas com o motivo.
  const vendas = csv(arquivos.get("vendas.csv"));
  assert.deepEqual(vendas.rows.find((linha) => linha[0] === "w1").slice(1, 16), [
    "Hotmart",
    "PURCHASE_APPROVED",
    "Compra aprovada",
    "01/03/2026 09:00",
    "ana@aluna.test",
    "7001",
    "Curso A na Hotmart",
    "curso-a",
    "",
    "HP-1",
    "Acesso liberado",
    "1 produto liberado; conta nova.",
    "1500,00",
    "BRL",
    ID.ana
  ]);
  assert.equal(vendas.rows.find((linha) => linha[0] === "w2")[11], "Venda guardada");
  assert.deepEqual(csv(arquivos.get("vendas-guardadas.csv")).rows, [["h1", "w2", "Hotmart", "HP-2", "curso-b", "Escola congelada", "Guardada", "10/11/2026 09:00", "", ""]]);

  // A equipe, com o papel.
  assert.deepEqual(csv(arquivos.get("equipe.csv")).rows, [
    [ID.dona, "Dona da Escola", "dona@escola.test", "Dono", "02/01/2026 09:00"],
    [ID.admin, "Admin da Escola", "admin@escola.test", "Administrador", "03/02/2026 09:00"]
  ]);
});

test("nenhum segredo sai: nem o hash do token, nem a licença, nem o segredo da Instalação, nem o payload das vendas", async () => {
  const db = escola();
  actionStubs.db = db;

  const arquivos = lerZip((await baixar()).corpo);
  const tudo = [...arquivos.values()].join("\n");

  for (const segredo of [SEGREDO_DA_PLATAFORMA, LICENCA_GUARDADA, SEGREDO_DA_INSTALACAO, CPF, "BKL1"]) {
    assert.ok(!tudo.includes(segredo), `nao sai: ${segredo.slice(0, 12)}`);
  }

  const lidas = new Set(db.chamadas.map((chamada) => chamada.tabela));
  for (const tabela of ["integration_settings", "license_state", "email_outbox", "ai_provider_connections"]) {
    assert.equal(lidas.has(tabela), false, `${tabela} nem e lida`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Quem pode e em que degrau
 * ---------------------------------------------------------------------------------------------- */

test("só o dono e os administradores (também a função Administrador combinada) exportam", async () => {
  const casos = [
    ["owner", {}, 200],
    ["admin", {}, 200],
    ["custom", { functions: ["admin", "editor"] }, 200],
    ["editor", {}, 403],
    ["support", {}, 403],
    ["analyst", {}, 403],
    ["custom", { functions: ["editor", "support", "analyst"], actions: ["students.export", "settings.ai"] }, 403]
  ];

  for (const [papel, permissoes, esperado] of casos) {
    const db = escola();
    actionStubs.db = db;
    entrar(papel, permissoes);

    const { resposta } = await baixar();
    assert.equal(resposta.status, esperado, `${papel} ${JSON.stringify(permissoes)}`);

    if (esperado === 403) {
      assert.equal(resposta.headers.get("cache-control"), "private, no-store");
      assert.equal(db.chamadas.length, 0, `${papel}: nada e lido nem auditado`);
    }
  }

  const db = escola();
  actionStubs.db = db;
  sessao.user = null;
  sessao.access = null;
  assert.equal((await baixar()).resposta.status, 401, "sem sessao");
  assert.equal(db.chamadas.length, 0);
});

test("em todo degrau da Licença (dever legal), sem nem ler a licença; no modo off, sem as vendas guardadas", async () => {
  const situacoes = [
    { mode: "enforce", evaluation: { degree: "escola_congelada", restrictions: { activationOnly: false, content: true, newAccess: true } } },
    { mode: "enforce", evaluation: { degree: "nao_ativada", restrictions: { activationOnly: true, content: true, newAccess: true } } },
    null
  ];

  for (const situacao of situacoes) {
    const db = escola();
    actionStubs.db = db;
    licenca.situacao = situacao;

    const { corpo, resposta } = await baixar();
    assert.equal(resposta.status, 200, JSON.stringify(situacao?.evaluation?.degree ?? "leitura que falha"));
    assert.ok(lerZip(corpo).has("vendas-guardadas.csv"));
  }

  assert.equal(licenca.leituras, 0, "o dever legal nem le a licenca");

  delete process.env.BUNKER_LICENSING_MODE;
  const db = escola();
  actionStubs.db = db;
  const arquivos = lerZip((await baixar()).corpo);
  assert.equal(arquivos.has("vendas-guardadas.csv"), false, "no modo off nao ha venda guardada");
  assert.equal(db.chamadas.some((chamada) => chamada.tabela === "held_sales"), false);
});

/* ------------------------------------------------------------------------------------------------
 * Em fluxo, auditado
 * ---------------------------------------------------------------------------------------------- */

test("em fluxo: a rota responde antes de ler as tabelas, e a auditoria grava o pedido e, no fim, as linhas", async () => {
  const db = escola();
  actionStubs.db = db;

  const resposta = await route.GET();

  assert.equal(resposta.status, 200);
  assert.deepEqual(
    db.chamadas.map((chamada) => `${chamada.op} ${chamada.tabela}`),
    ["insert admin_audit_log"],
    "antes do download, so a auditoria do pedido"
  );
  const [pedido] = db.linhas("admin_audit_log");
  assert.equal(pedido.action, "data.export");
  assert.equal(pedido.actor_id, ID.dona);
  assert.ok(pedido.metadata.arquivos.includes("alunos.csv"));

  lerZip(Buffer.from(await resposta.arrayBuffer()));

  const fim = db.linhas("admin_audit_log").find((linha) => linha.action === "data.export_finished");
  assert.ok(fim, "a auditoria do fim");
  assert.equal(fim.metadata.linhas["alunos.csv"], 3);
  assert.equal(fim.metadata.linhas["acessos.csv"], 2);
  assert.equal(fim.count, Object.values(fim.metadata.linhas).reduce((total, valor) => total + valor, 0));
  assert.ok(!JSON.stringify(fim.metadata).includes("@"), "a auditoria leva so contagens, nunca e-mail");
});

test("cada tabela é lida página a página pela chave, e os e-mails em lotes: nada inteiro na memória", async () => {
  const db = escola();
  const muitos = Array.from({ length: 230 }, (_, i) => `00000000-0000-4000-8000-${String(100000000000 + i)}`);
  db.linhas("profiles").push(...muitos.map((id, i) => ({ created_at: "2026-06-01T12:00:00.000Z", email: `aluno${i}@escola.test`, full_name: `Aluno ${i}`, id, phone: null })));
  db.linhas("entitlements").push(
    ...muitos.map((id, i) => ({ created_at: "2026-06-01T12:00:00.000Z", ends_at: null, id: `e-${String(i).padStart(3, "0")}`, source_event_id: null, source_provider: "manual", starts_at: "2026-06-01T12:00:00.000Z", status: "active", target_id: "curso-a", user_id: id }))
  );

  const linhas = new Map();
  const zip = await zipToBuffer(schoolExportEntries(db, { keys: exportFileKeys({ heldSales: true }), now: new Date("2026-11-11T12:00:00.000Z"), pageSize: 50, rows: linhas }), {
    modifiedAt: new Date("2026-11-11T12:00:00.000Z")
  });
  const arquivos = lerZip(zip);

  assert.equal(csv(arquivos.get("alunos.csv")).rows.length, 233);
  assert.equal(csv(arquivos.get("acessos.csv")).rows.length, 232);
  assert.equal(csv(arquivos.get("acessos.csv")).rows.filter((linha) => linha[2].endsWith("@escola.test")).length, 230, "cada acesso com o e-mail");
  assert.equal(linhas.get("acessos.csv"), 232);

  const paginas = (tabela) => db.chamadas.filter((chamada) => chamada.tabela === tabela && chamada.op === "select").length;
  assert.ok(paginas("entitlements") >= 5, `acessos em paginas de 50: ${paginas("entitlements")}`);
  // Os perfis: as paginas de alunos.csv mais os lotes de e-mail (de ate 100 ids) de cada pagina de acessos e progresso.
  assert.ok(paginas("profiles") >= 10, `perfis: ${paginas("profiles")}`);
});

test("as pequenas regras: o nome do ZIP, o valor em reais e as datas de Brasília", () => {
  assert.equal(schoolExportFileName(new Date("2026-11-12T02:00:00.000Z")), "dados-da-escola-2026-11-11.zip", "o dia de Brasilia");
  assert.equal(exportMoney(150000), "1500,00");
  assert.equal(exportMoney(5), "0,05");
  assert.equal(exportMoney(-1999), "-19,99");
  assert.equal(exportMoney(null), "");
  assert.deepEqual(exportFileKeys({ heldSales: false }), ["alunos", "acessos", "progresso", "cursos", "aulas", "pacotes", "turmas", "vendas", "equipe"]);
});
