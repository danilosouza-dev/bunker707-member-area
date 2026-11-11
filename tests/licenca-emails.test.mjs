import assert from "node:assert/strict";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz, passosDaAnual } from "./support/licenca-de-teste.mjs";

// Os e-mails da Instalação a cada degrau da Licença (docs/32 §2.2 e §11.3, "Avisos por e-mail"): para todas as contas da
// equipe com papel de dono ou de administrador, pela fila email_outbox, um por mudança de degrau, só no modo "enforce".
// O planejador puro (src/server/licensing/degree-notice.ts), a ligação com o banco (degree-email.ts) e a tarefa do tick
// de ponta a ponta, com um Supabase falso de license_state, admin_roles, profiles e email_outbox.

const { computeLicenseState, EMPTY_LICENSE_SNAPSHOT } = await import("../src/server/licensing/state.ts");
const { LICENSE_DEGREE_EMAIL_KIND, licenseDegreeChangeOf, licenseScreenUrlOf, notifyLicenseDegree } = await import("../src/server/licensing/degree-notice.ts");
const { notifyLicenseDegreeChange } = await import("../src/server/licensing/degree-email.ts");
const { licenseCheckInJob } = await import("../src/server/jobs/license-check-in-job.ts");
const { EMAIL_KINDS } = await import("../src/server/email/outbox-rules.ts");

const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const ENDERECO = "https://alunos.escola.test";
const VALIDADE = "2027-11-10T23:59:59-03:00";
const LINKS = { renew: "https://www.bunker707.test/minhas-licencas/lic_0001/renovar" };
const DIA = 24 * 60 * 60 * 1000;

function situacao(agora, sobrescrever = {}) {
  const emitida = new Date(Date.parse(agora) - 60 * 60 * 1000).toISOString();
  const licenca = licencaBase({
    issuedAt: emitida,
    expiresAt: new Date(Date.parse(emitida) + 90 * DIA).toISOString(),
    plan: { kind: "annual", validUntil: VALIDADE, steps: passosDaAnual(VALIDADE) },
    links: LINKS,
    ...sobrescrever
  });
  return computeLicenseState({
    mode: "enforce",
    roots: RAIZES,
    snapshot: { ...EMPTY_LICENSE_SNAPSHOT, everActivated: true, token: assinarLicenca(emissao, licenca), lastSeenAt: new Date(agora) },
    systemNow: new Date(agora),
    configuredHost: ENDERECO
  });
}

const AVISO = "2027-10-20T12:00:00.000Z";
const LIMITADO = "2027-12-01T12:00:00.000Z";
const EQUIPE = [
  { userId: "dono", email: "dona@escola.test" },
  { userId: "admin", email: "admin@escola.test" },
  { userId: "admin-de-novo", email: " ADMIN@escola.test " }
];

/** As dependências do planejador, com a fila e a leitura da equipe anotadas. */
function dependencias(estado, memoria = { lastMarker: null }, extra = {}) {
  const fila = [];
  const leituras = { equipe: 0 };
  return {
    fila,
    leituras,
    deps: {
      state: estado,
      configuredHost: ENDERECO,
      memory: memoria,
      listRecipients: async () => {
        leituras.equipe += 1;
        return EQUIPE;
      },
      enqueue: async (email) => {
        fila.push(email);
      },
      ...extra
    }
  };
}

// ---- O planejador --------------------------------------------------------------------------------------

test("a mudança de degrau: o degrau e desde quando (o motivo mais antigo dele); em dia, nunca ativada e modo off não têm", () => {
  assert.equal(licenseDegreeChangeOf(situacao("2026-11-11T12:00:00.000Z")), null);
  assert.equal(licenseDegreeChangeOf({ mode: "off" }), null);
  assert.equal(licenseDegreeChangeOf(null), null);
  assert.equal(
    licenseDegreeChangeOf(computeLicenseState({ mode: "enforce", roots: RAIZES, snapshot: EMPTY_LICENSE_SNAPSHOT, systemNow: new Date(AVISO), configuredHost: ENDERECO })),
    null
  );

  assert.deepEqual(licenseDegreeChangeOf(situacao(AVISO)), { degree: "aviso", since: "2027-10-12T03:00:00.000Z", marker: "aviso:2027-10-12" });
  assert.deepEqual(licenseDegreeChangeOf(situacao(LIMITADO)), {
    degree: "admin_limitado",
    since: "2027-11-26T03:00:00.000Z",
    marker: "admin_limitado:2027-11-26"
  });
  assert.equal(licenseDegreeChangeOf(situacao("2027-10-25T12:00:00.000Z")).marker, "aviso:2027-10-12", "o mesmo degrau dias depois: a mesma mudança");
});

test("o e-mail da mudança: um por dono e administrador (e-mail repetido vai uma vez), com a faixa, o Renovar e o link da tela Licença", async () => {
  const { deps, fila } = dependencias(situacao(AVISO));
  const resultado = await notifyLicenseDegree(deps);

  assert.deepEqual(resultado, { marker: "aviso:2027-10-12", queued: 2, skipped: null });
  assert.deepEqual(fila.map((email) => [email.userId, email.to]), [["dono", "dona@escola.test"], ["admin", "admin@escola.test"]]);

  const [email] = fila;
  assert.equal(email.kind, LICENSE_DEGREE_EMAIL_KIND);
  assert.ok(EMAIL_KINDS.includes(email.kind), "um tipo que a fila conhece");
  assert.equal(email.subject, "Aviso sobre a Licença");
  assert.equal(email.idempotencyKey, "license-degree:aviso:2027-10-12:dono");
  assert.deepEqual(email.metadata, { degree: "aviso", since: "2027-10-12T03:00:00.000Z" });
  assert.match(email.text, /A sua Licença termina em 10\/11\/2027\./);
  assert.match(email.text, /A partir de 26\/11\/2027: Admin limitado/);
  assert.match(email.html, new RegExp(`href="${LINKS.renew}"[^>]*>Renovar<`));
  assert.match(email.html, /href="https:\/\/alunos\.escola\.test\/admin\/configuracoes\/licenca"[^>]*>Abrir a Licença</);
  assert.match(email.text, /Quem já é aluno continua com o acesso que tem/);
  assert.doesNotMatch(`${email.subject} ${email.text}`, /bloquead/i, "nunca 'a sua escola será bloqueada' (docs/32 §2.2)");
});

test("deduplicado por mudança de degrau: o mesmo degrau não lê a equipe nem toca na fila; o degrau novo manda de novo; a volta ao normal não manda", async () => {
  const memoria = { lastMarker: null };
  const aviso = dependencias(situacao(AVISO), memoria);
  await notifyLicenseDegree(aviso.deps);

  for (const agora of [AVISO, "2027-10-21T12:00:00.000Z", "2027-11-15T12:00:00.000Z"]) {
    const repetida = dependencias(situacao(agora), memoria);
    const resultado = await notifyLicenseDegree(repetida.deps);
    assert.equal(resultado.skipped, "ja_avisado", agora);
    assert.deepEqual(repetida.fila, []);
    assert.equal(repetida.leituras.equipe, 0, "nem lê a equipe");
  }

  const limitado = dependencias(situacao(LIMITADO), memoria);
  assert.equal((await notifyLicenseDegree(limitado.deps)).queued, 2);
  assert.equal(limitado.fila[0].subject, "Licença: Admin limitado");
  assert.equal(limitado.fila[0].idempotencyKey, "license-degree:admin_limitado:2027-11-26:dono");

  const renovada = dependencias(situacao("2027-12-02T12:00:00.000Z", { plan: { kind: "annual", validUntil: "2028-11-10T23:59:59-03:00", steps: passosDaAnual("2028-11-10T23:59:59-03:00") } }), memoria);
  assert.deepEqual(await notifyLicenseDegree(renovada.deps), { marker: null, queued: 0, skipped: "sem_degrau" });
  assert.equal(memoria.lastMarker, null);
});

test("a segunda camada: o mesmo degrau não manda dois e-mails em menos de 24 h no mesmo processo, mesmo com o marcador mudando", async () => {
  const memoria = { lastMarker: null };
  const agora = Date.parse("2027-10-20T12:00:00.000Z");
  const primeiro = dependencias(situacao(AVISO), memoria, { now: () => agora });
  assert.equal((await notifyLicenseDegree(primeiro.deps)).queued, 2);

  // O mesmo degrau com outro marcador (outro dia de início) 23 horas depois: espera; a memória do marcador não anda.
  memoria.lastMarker = "aviso:2027-10-01";
  const cedo = dependencias(situacao(AVISO), memoria, { now: () => agora + 23 * 60 * 60 * 1000 });
  assert.deepEqual(await notifyLicenseDegree(cedo.deps), { marker: "aviso:2027-10-12", queued: 0, skipped: "intervalo" });
  assert.deepEqual(cedo.fila, []);
  assert.equal(cedo.leituras.equipe, 0, "nem lê a equipe");
  assert.equal(memoria.lastMarker, "aviso:2027-10-01");

  // Passadas 24 horas, sai (e a fila ainda ignora a chave repetida do mesmo dia).
  const depois = dependencias(situacao(AVISO), memoria, { now: () => agora + 24 * 60 * 60 * 1000 });
  assert.equal((await notifyLicenseDegree(depois.deps)).queued, 2);

  // Outro degrau não espera o intervalo do primeiro.
  const limitado = dependencias(situacao(LIMITADO), memoria, { now: () => agora + 24 * 60 * 60 * 1000 + 1 });
  assert.equal((await notifyLicenseDegree(limitado.deps)).queued, 2);
});

test("o processo que reinicia tenta de novo com as mesmas chaves (a fila ignora a repetida); a fila que falha não anda a memória", async () => {
  const primeiro = dependencias(situacao(AVISO));
  await notifyLicenseDegree(primeiro.deps);
  const reiniciado = dependencias(situacao(AVISO), { lastMarker: null });
  await notifyLicenseDegree(reiniciado.deps);
  assert.deepEqual(reiniciado.fila.map((email) => email.idempotencyKey), primeiro.fila.map((email) => email.idempotencyKey));

  const memoria = { lastMarker: null };
  const falha = dependencias(situacao(AVISO), memoria, {
    enqueue: async () => {
      throw new Error("fila fora");
    }
  });
  await assert.rejects(notifyLicenseDegree(falha.deps), /fila fora/);
  assert.equal(memoria.lastMarker, null, "a rodada seguinte tenta de novo");
});

test("modo de observação: o e-mail diz o degrau calculado e que nada foi limitado; nunca ativada: nenhum e-mail", async () => {
  const observando = situacao("2026-11-11T12:00:00.000Z", {
    observeUntil: "2027-01-01T00:00:00-03:00",
    statusSteps: [{ degree: "admin_limitado", from: "2026-11-01T00:00:00-03:00", reason: "revogada" }]
  });
  const { deps, fila } = dependencias(observando);
  await notifyLicenseDegree(deps);

  assert.equal(fila[0].subject, "Modo de observação da Licença");
  assert.match(fila[0].text, /nada foi limitado/);
  assert.match(fila[0].text, /estaria em Admin limitado/);

  const nunca = computeLicenseState({ mode: "enforce", roots: RAIZES, snapshot: EMPTY_LICENSE_SNAPSHOT, systemNow: new Date(AVISO), configuredHost: ENDERECO });
  const semEmail = dependencias(nunca);
  assert.equal((await notifyLicenseDegree(semEmail.deps)).queued, 0);
  assert.equal(licenseScreenUrlOf(null), null);
  assert.equal(licenseScreenUrlOf("alunos.escola.test"), "https://alunos.escola.test/admin/configuracoes/licenca");
});

// ---- O banco: a equipe e a fila ------------------------------------------------------------------------

/**
 * Um Supabase falso com as tabelas que a tarefa da licença usa: license_state (uma linha, gravada só com a versão lida),
 * admin_roles, profiles e email_outbox (única pela chave de idempotência, como o índice da migração 202610170002).
 */
function supabaseFalso({ linha = null, equipe = [], perfis = [] } = {}) {
  const tabelas = { license_state: linha ? [linha] : [], admin_roles: equipe, profiles: perfis, email_outbox: [] };
  const lidas = [];

  return {
    tabelas,
    lidas,
    from(tabela) {
      lidas.push(tabela);
      const pedido = { op: "select", filtros: [], dentro: null, valores: null };
      const casa = (row) => pedido.filtros.every(([coluna, valor]) => row[coluna] === valor) && (!pedido.dentro || pedido.dentro[1].includes(row[pedido.dentro[0]]));
      const executar = async (umaSo) => {
        const linhas = tabelas[tabela];

        if (pedido.op === "insert") {
          linhas.push({ ...pedido.valores });
          return { data: umaSo ? { ...pedido.valores } : [{ ...pedido.valores }], error: null };
        }

        if (pedido.op === "update") {
          const alvo = linhas.filter(casa);
          alvo.forEach((row) => Object.assign(row, pedido.valores));
          return { data: alvo.map((row) => ({ ...row })), error: null };
        }

        if (pedido.op === "upsert") {
          if (linhas.some((row) => row.idempotency_key === pedido.valores.idempotency_key)) {
            return { data: [], error: null };
          }

          const nova = { id: `email-${linhas.length + 1}`, status: "queued", ...pedido.valores };
          linhas.push(nova);
          return { data: [{ id: nova.id }], error: null };
        }

        const achadas = linhas.filter(casa).map((row) => ({ ...row }));
        return { data: umaSo ? (achadas[0] ?? null) : achadas, error: null };
      };
      const consulta = {
        select: () => consulta,
        insert: (valores) => ((pedido.op = "insert"), (pedido.valores = valores), consulta),
        update: (valores) => ((pedido.op = "update"), (pedido.valores = valores), consulta),
        upsert: (valores) => ((pedido.op = "upsert"), (pedido.valores = valores), consulta),
        eq: (coluna, valor) => (pedido.filtros.push([coluna, valor]), consulta),
        in: (coluna, valores) => ((pedido.dentro = [coluna, valores]), consulta),
        limit: () => consulta,
        order: () => consulta,
        maybeSingle: () => executar(true),
        then: (resolve, reject) => executar(false).then(resolve, reject)
      };
      return consulta;
    }
  };
}

const EQUIPE_NO_BANCO = [
  { user_id: "u-dono", role: "owner", permissions: {} },
  { user_id: "u-admin", role: "admin", permissions: {} },
  { user_id: "u-admin-combinado", role: "custom", permissions: { functions: ["admin", "editor"] } },
  { user_id: "u-editor", role: "editor", permissions: {} },
  { user_id: "u-suporte", role: "support", permissions: {} },
  { user_id: "u-tudo-menos-admin", role: "custom", permissions: { functions: ["editor", "support", "analyst"], actions: ["settings.ai"] } },
  { user_id: "u-sem-email", role: "admin", permissions: {} }
];
const PERFIS = [
  { id: "u-dono", email: "dona@escola.test" },
  { id: "u-admin", email: "admin@escola.test" },
  { id: "u-admin-combinado", email: "combinado@escola.test" },
  { id: "u-editor", email: "editor@escola.test" },
  { id: "u-suporte", email: "suporte@escola.test" },
  { id: "u-tudo-menos-admin", email: "quase@escola.test" },
  { id: "u-sem-email", email: null }
];

test("no banco: só os donos e administradores (inclusive a função Administrador combinada) recebem, pela fila com a chave da mudança", async () => {
  const banco = supabaseFalso({ equipe: EQUIPE_NO_BANCO, perfis: PERFIS });
  // A memória deste teste (a do processo fica para a tarefa do tick, no teste seguinte).
  const memoria = { lastMarker: null };
  const resultado = await notifyLicenseDegreeChange(banco, situacao(LIMITADO), ENDERECO, memoria);

  assert.equal(resultado.queued, 3);
  assert.deepEqual(
    banco.tabelas.email_outbox.map((row) => [row.to_email, row.kind, row.user_id]),
    [
      ["dona@escola.test", "license_degree", "u-dono"],
      ["admin@escola.test", "license_degree", "u-admin"],
      ["combinado@escola.test", "license_degree", "u-admin-combinado"]
    ]
  );
  assert.ok(banco.tabelas.email_outbox.every((row) => row.idempotency_key.startsWith("license-degree:admin_limitado:")));

  // O mesmo processo, a mesma mudança: nem lê a equipe.
  const lidasAntes = banco.lidas.length;
  assert.equal((await notifyLicenseDegreeChange(banco, situacao(LIMITADO), ENDERECO, memoria)).skipped, "ja_avisado");
  assert.equal(banco.lidas.length, lidasAntes);
});

// ---- A tarefa do tick, de ponta a ponta --------------------------------------------------------------

/** A linha de license_state com uma licença assinada (colunas do banco), conferida há uma hora. */
function linhaDoBanco(licenca, agora) {
  return {
    id: 1,
    token: assinarLicenca(emissao, licenca),
    ever_activated: true,
    unreadable_since: null,
    last_seen_at: new Date(agora - 60_000).toISOString(),
    last_check_in_emissor_at: null,
    last_check_in_local_at: null,
    host_mismatch_since: null,
    newest_issued_at: licenca.issuedAt,
    installation_id: null,
    installation_secret: null,
    check_in_sequence: null,
    check_in_attempted_at: null,
    check_in_result: null,
    check_in_requested_at: null,
    version: 1
  };
}

const diaDe = (ms) => new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

test("a tarefa do tick no modo enforce: um e-mail por mudança de degrau para os donos e administradores; no modo off, nada", async () => {
  const antes = { modo: process.env.BUNKER_LICENSING_MODE, raizes: process.env.BUNKER_LICENSING_ROOTS, site: process.env.NEXT_PUBLIC_SITE_URL };
  const agora = Date.now();
  // A Licença anual que termina daqui a 10 dias: Aviso (nos últimos 30 dias), com a data do fim.
  const validade = `${diaDe(agora + 10 * DIA)}T23:59:59-03:00`;
  const licenca = licencaBase({
    issuedAt: new Date(agora - 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(agora + 30 * DIA).toISOString(),
    plan: { kind: "annual", validUntil: validade, steps: passosDaAnual(validade) },
    links: LINKS
  });
  const banco = supabaseFalso({ linha: linhaDoBanco(licenca, agora), equipe: EQUIPE_NO_BANCO, perfis: PERFIS });
  const rodar = (supabase) => licenseCheckInJob.run({ runId: "r", signal: AbortSignal.timeout(5_000), supabase, tickRunId: "t", tickStartedAt: new Date() });
  const logs = [];
  const info = console.info;
  console.info = (...args) => logs.push(args.join(" "));
  actionStubs.db = null;

  try {
    process.env.BUNKER_LICENSING_ROOTS = JSON.stringify(RAIZES);
    process.env.NEXT_PUBLIC_SITE_URL = ENDERECO;

    delete process.env.BUNKER_LICENSING_MODE;
    const desligado = supabaseFalso({ linha: linhaDoBanco(licenca, agora), equipe: EQUIPE_NO_BANCO, perfis: PERFIS });
    await rodar(desligado);
    assert.deepEqual(desligado.lidas, [], "modo off: nem lê o banco");

    process.env.BUNKER_LICENSING_MODE = "enforce";
    await rodar(banco);
    const primeiros = banco.tabelas.email_outbox.length;
    assert.equal(primeiros, 3, "os três donos e administradores (o editor, o suporte e a conta sem e-mail, não)");
    assert.ok(banco.tabelas.email_outbox.every((row) => row.subject === "Aviso sobre a Licença" && row.kind === "license_degree"));

    await rodar(banco);
    await rodar(banco);
    assert.equal(banco.tabelas.email_outbox.length, primeiros, "a mesma mudança não manda de novo");
    assert.equal(banco.tabelas.license_state[0].version > 1, true, "a rodada gravou (a última hora vista)");

    // A Licença revogada: o degrau muda para Admin limitado, e o e-mail sai de novo, com outra chave.
    const revogada = { ...licenca, issuedAt: new Date(agora - 30 * 60 * 1000).toISOString(), statusSteps: [{ degree: "admin_limitado", from: new Date(agora - 2 * DIA).toISOString(), reason: "revogada" }] };
    Object.assign(banco.tabelas.license_state[0], { token: assinarLicenca(emissao, revogada), newest_issued_at: revogada.issuedAt });
    await rodar(banco);
    const novos = banco.tabelas.email_outbox.slice(primeiros);
    assert.deepEqual(novos.map((row) => row.to_email), ["dona@escola.test", "admin@escola.test", "combinado@escola.test"]);
    assert.ok(novos.every((row) => row.subject === "Licença: Admin limitado" && row.idempotency_key.startsWith("license-degree:admin_limitado:")));
    assert.ok(logs.some((linha) => /e-mail de degrau para 3 pessoa\(s\) da equipe/.test(linha)));
  } finally {
    console.info = info;
    for (const [nome, valor] of [["BUNKER_LICENSING_MODE", antes.modo], ["BUNKER_LICENSING_ROOTS", antes.raizes], ["NEXT_PUBLIC_SITE_URL", antes.site]]) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
});
