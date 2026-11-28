import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Vencimento do acesso na Comunicacao (docs/22 §3, 28/11/2026): as regras "O acesso vence em até N dias"
// (access_ending) e "O acesso venceu há até N dias" (access_expired), no segmento e nos fluxos.
// - quem entra e quem nao entra em cada uma, a partir das linhas de acesso como o banco guarda (sem prazo, vencendo
//   dentro e fora da janela, ja vencido, removido por reembolso, suspenso, renovado, plataforma inteira);
// - a validacao dos campos (zod) e a normalizacao;
// - as frases e as pecas do construtor;
// - nos fluxos: a entrada pelo "Quem entra" so com quem ainda nao passou (ninguem recebe de novo a cada tick), o
//   "Só para quem…" e a Condição sobre os fatos do lote do motor.

const model = await import("../src/server/communications/audience-model.ts");
const facts = await import("../src/server/communications/audience-facts.ts");
const { audienceDefinitionSchema, flowRuleDefinitionSchema } = await import("../src/server/communications/schemas.ts");
const builder = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const { processFlows } = await import("../src/server/communications/flow-engine.ts");
const { loadFlowBatchContext } = await import("../src/server/communications/flow-facts.ts");
const { decideFlowTask } = await import("../src/server/communications/flow-model.ts");

const DAY = 86_400_000;
// 28/11/2026 12:15 em Sao Paulo: o primeiro minuto de uma faixa de 15 minutos dos fluxos.
const AGORA = new Date("2026-11-28T15:15:20.000Z");
const now = AGORA.getTime();
const iso = (ms) => new Date(ms).toISOString();
const daysAgo = (days) => now - days * DAY;
const inDays = (days) => now + days * DAY;
const uid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const todas = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const vence = (days, productId = null) => todas({ days, productId, type: "access_ending" });
const venceu = (days, productId = null) => todas({ days, productId, type: "access_expired" });

/** Uma linha de `entitlements` como o banco guarda. */
function linha(userId, extra = {}) {
  return {
    created_at: iso(daysAgo(400)),
    ends_at: null,
    starts_at: iso(daysAgo(400)),
    status: "active",
    target_id: "curso-a",
    target_type: "formation",
    user_id: userId,
    ...extra
  };
}

// Um aluno por caso. A ordem e o numero do id.
const ALUNOS = {
  semPrazo: uid(1),
  vence20: uid(2),
  vence200: uid(3),
  venceu5: uid(4),
  venceu400: uid(5),
  reembolso: uid(6),
  suspenso: uid(7),
  renovou: uid(8),
  plataformaAberta: uid(9),
  marcadoExpirado: uid(10),
  expiradoSemData: uid(11),
  outroProduto: uid(12),
  plataformaVenceu: uid(13),
  semAcesso: uid(14),
  equipe: uid(15)
};

const ACESSOS = [
  linha(ALUNOS.semPrazo),
  linha(ALUNOS.vence20, { ends_at: iso(inDays(20)) }),
  linha(ALUNOS.vence200, { ends_at: iso(inDays(200)) }),
  linha(ALUNOS.venceu5, { ends_at: iso(daysAgo(5)) }),
  linha(ALUNOS.venceu400, { ends_at: iso(daysAgo(400)), starts_at: iso(daysAgo(800)) }),
  // Reembolso: a venda fecha o acesso como revogado (process-sale.ts); a data de termino pode ate estar no passado.
  linha(ALUNOS.reembolso, { ends_at: iso(daysAgo(5)), status: "revoked" }),
  // Assinatura cancelada: suspenso.
  linha(ALUNOS.suspenso, { ends_at: iso(daysAgo(3)), status: "suspended" }),
  // Renovou: o acesso antigo venceu ha 5 dias e outro, aberto, vale por mais um ano.
  linha(ALUNOS.renovou, { ends_at: iso(daysAgo(5)) }),
  linha(ALUNOS.renovou, { ends_at: iso(inDays(360)), starts_at: iso(daysAgo(4)) }),
  // O curso vence em 10 dias, mas a plataforma inteira, sem prazo, continua cobrindo.
  linha(ALUNOS.plataformaAberta, { ends_at: iso(inDays(10)) }),
  linha(ALUNOS.plataformaAberta, { target_id: "platform", target_type: "platform" }),
  linha(ALUNOS.marcadoExpirado, { ends_at: iso(daysAgo(2)), status: "expired" }),
  linha(ALUNOS.expiradoSemData, { status: "expired" }),
  linha(ALUNOS.outroProduto, { ends_at: iso(inDays(10)), target_id: "curso-b" }),
  linha(ALUNOS.plataformaVenceu, { ends_at: iso(daysAgo(4)), target_id: "platform", target_type: "platform" }),
  linha(ALUNOS.equipe, { ends_at: iso(inDays(5)) })
];

const PERFIS = Object.values(ALUNOS).map((id, index) => ({
  avatar_url: null,
  created_at: iso(daysAgo(500)),
  email: null,
  full_name: `Aluno ${index + 1}`,
  id,
  is_guest: false,
  last_sign_in_at: null,
  phone: null
}));

const nomeDe = (id) => Object.entries(ALUNOS).find(([, value]) => value === id)?.[0] ?? id;

/** Os fatos de todos, montados como o carregador monta (buildStudentFacts), sem a equipe. */
function escola() {
  const built = facts.buildStudentFacts({
    comments: new Map(),
    entitlements: ACESSOS,
    lessonIndex: new Map(),
    memberships: [],
    now,
    profiles: PERFIS,
    progressRows: [],
    staff: new Set([ALUNOS.equipe])
  });

  return { context: { commentRanks: model.buildCommentRanks([]), lessonTotals: {}, now }, facts: built.facts };
}

/** Quem esta no segmento agora, pelo nome do caso, em ordem. */
function quemEntra(definition) {
  const loaded = escola();

  return loaded.facts
    .filter((aluno) => model.evaluateAudience(definition, aluno, loaded.context))
    .map((aluno) => nomeDe(aluno.userId))
    .sort();
}

/* ------------------------------------------------------------------------------------------------
 * Quem entra e quem nao entra
 * ---------------------------------------------------------------------------------------------- */

test("o acesso vence em até N dias: so quem tem data de termino dentro da janela; sem prazo, vencido, removido e a equipe ficam de fora", () => {
  assert.deepEqual(quemEntra(vence(30)), ["outroProduto", "vence20"]);
  assert.deepEqual(quemEntra(vence(30, "curso-a")), ["vence20"], "um produto escolhido");
  assert.deepEqual(quemEntra(vence(30, "curso-b")), ["outroProduto"]);
  assert.deepEqual(quemEntra(vence(19, "curso-a")), [], "20 dias nao cabe em 19");
  assert.deepEqual(quemEntra(vence(20, "curso-a")), ["vence20"], "o ultimo dia da janela conta");
  assert.deepEqual(quemEntra(vence(365)), ["outroProduto", "renovou", "vence20", "vence200"], "a janela maior alcanca os mais distantes");

  const entram = quemEntra(vence(3650));

  for (const fora of ["semPrazo", "venceu5", "reembolso", "suspenso", "plataformaAberta", "semAcesso", "equipe"]) {
    assert.equal(entram.includes(fora), false, `${fora} nunca entra`);
  }
});

test("o acesso vence em até N dias: com mais de um acesso ao produto vale o que termina por ultimo; a plataforma inteira sem prazo cobre o produto", () => {
  const contexto = { commentRanks: model.buildCommentRanks([]), lessonTotals: {}, now };
  const aluno = (accesses) => ({
    accesses,
    cohortIds: [],
    comments: { d7: 0, d30: 0, d90: 0, total: 0 },
    completedByContent: {},
    completedLessons: 0,
    lastSignInAt: null,
    lastStudiedAt: null,
    pace: "never_started",
    totalLessons: 0,
    userId: "a"
  });
  const acesso = (productId, endsAt) => ({ endsAt, productId, startsAt: daysAgo(100) });
  const entra = (definition, accesses) => model.evaluateAudience(definition, aluno(accesses), contexto);

  assert.equal(entra(vence(30, "curso-a"), [acesso("curso-a", inDays(5)), acesso("curso-a", inDays(300))]), false, "renovado: vale o que termina por ultimo");
  assert.equal(entra(vence(30, "curso-a"), [acesso("curso-a", inDays(5)), acesso("curso-a", inDays(12))]), true, "os dois dentro da janela");
  assert.equal(entra(vence(30, "curso-a"), [acesso("curso-a", inDays(5)), acesso("curso-a", null)]), false, "um deles sem prazo");
  assert.equal(entra(vence(30, "curso-a"), [acesso("curso-a", inDays(5)), acesso("platform", null)]), false, "a plataforma sem prazo cobre");
  assert.equal(entra(vence(30), [acesso("curso-a", inDays(5)), acesso("platform", null)]), false, "qualquer produto: nada vence de verdade");
  assert.equal(entra(vence(30, "curso-a"), [acesso("platform", inDays(5))]), true, "so a plataforma, com prazo: o produto vence com ela");
  assert.equal(entra(vence(30), [acesso("curso-a", inDays(5)), acesso("curso-b", null)]), true, "qualquer produto: o curso A vence, o B nao");
  assert.equal(entra(vence(30, "curso-a"), []), false, "sem acesso nenhum");
});

test("o acesso venceu há até N dias: acabou pelo prazo dentro da janela e o aluno continua sem acesso; reembolso, suspensao e renovacao nao contam", () => {
  assert.deepEqual(quemEntra(venceu(30)), ["marcadoExpirado", "plataformaVenceu", "venceu5"]);
  assert.deepEqual(quemEntra(venceu(30, "curso-a")), ["marcadoExpirado", "plataformaVenceu", "venceu5"], "a plataforma vencida valia para o produto");
  assert.deepEqual(quemEntra(venceu(30, "curso-b")), ["plataformaVenceu"], "ninguem tinha so o curso B vencido");
  assert.deepEqual(quemEntra(venceu(4, "curso-a")), ["marcadoExpirado", "plataformaVenceu"], "5 dias nao cabe em 4");
  assert.deepEqual(quemEntra(venceu(5, "curso-a")), ["marcadoExpirado", "plataformaVenceu", "venceu5"], "o ultimo dia da janela conta");
  assert.deepEqual(quemEntra(venceu(3650)), ["marcadoExpirado", "plataformaVenceu", "venceu400", "venceu5"], "a janela maior alcanca o vencido ha mais de um ano");

  const entram = quemEntra(venceu(3650));

  for (const fora of ["semPrazo", "vence20", "vence200", "reembolso", "suspenso", "renovou", "plataformaAberta", "expiradoSemData", "outroProduto", "semAcesso", "equipe"]) {
    assert.equal(entram.includes(fora), false, `${fora} nunca entra`);
  }
});

test("as duas regras nunca pegam o mesmo aluno para o mesmo produto, e juntas (qualquer regra) somam os dois grupos", () => {
  const vencendo = quemEntra(vence(30, "curso-a"));
  const vencidos = quemEntra(venceu(30, "curso-a"));

  assert.deepEqual(vencendo.filter((nome) => vencidos.includes(nome)), []);
  assert.deepEqual(
    quemEntra({ kind: "rules", root: { items: [vence(30, "curso-a").root.items[0], venceu(30, "curso-a").root.items[0]], match: "any" } }),
    [...vencendo, ...vencidos].sort()
  );
});

test("acessos que acabaram pelo prazo: so ativo ou expirado com a data no passado; revogado, suspenso, sem data e data futura ficam de fora", () => {
  const de = (extra) => facts.endedAccessFactsOf([linha("u", extra)], now);

  assert.deepEqual(de({ ends_at: iso(daysAgo(5)) }), [{ endedAt: daysAgo(5), productId: "curso-a" }]);
  assert.deepEqual(de({ ends_at: iso(daysAgo(5)), status: "expired" }), [{ endedAt: daysAgo(5), productId: "curso-a" }]);
  assert.deepEqual(de({ ends_at: iso(daysAgo(5)), target_id: "qualquer", target_type: "platform" }), [{ endedAt: daysAgo(5), productId: "platform" }]);
  assert.deepEqual(de({ ends_at: iso(now) }), [{ endedAt: now, productId: "curso-a" }], "terminou agora");
  assert.deepEqual(de({ ends_at: iso(daysAgo(5)), status: "revoked" }), [], "reembolso");
  assert.deepEqual(de({ ends_at: iso(daysAgo(5)), status: "suspended" }), [], "suspenso");
  assert.deepEqual(de({ ends_at: null }), [], "sem prazo");
  assert.deepEqual(de({ ends_at: null, status: "expired" }), [], "expirado sem data: nao ha quando contar");
  assert.deepEqual(de({ ends_at: iso(inDays(1)) }), [], "ainda nao venceu");
  assert.deepEqual(de({ ends_at: "nao e data" }), []);

  // Os fatos so de acesso (lote do motor dos fluxos, Quem pode da live) levam os dois grupos das mesmas linhas.
  const soAcessos = facts.accessOnlyFacts(ALUNOS.renovou, ACESSOS.filter((row) => row.user_id === ALUNOS.renovou), now);
  assert.deepEqual(soAcessos.accesses.map((access) => access.endsAt), [inDays(360)]);
  assert.deepEqual(soAcessos.endedAccesses, [{ endedAt: daysAgo(5), productId: "curso-a" }]);
});

test("fatos sem a lista dos vencidos (montados por quem so le os abertos): 'venceu' nao combina, sem erro", () => {
  const contexto = { commentRanks: model.buildCommentRanks([]), lessonTotals: {}, now };
  const aluno = { accesses: [], cohortIds: [], comments: { d7: 0, d30: 0, d90: 0, total: 0 }, completedByContent: {}, completedLessons: 0, lastSignInAt: null, lastStudiedAt: null, pace: "never_started", totalLessons: 0, userId: "a" };

  assert.equal(model.evaluateAudience(venceu(30), aluno, contexto), false);
  // A ancora do Quem pode da live: quem venceu esta sem o produto, entao nada de acesso e exigido de novo.
  assert.equal(model.evaluateAnchoredAudience(venceu(30, "curso-a"), { accesses: [], cohortIds: [] }), true);
  assert.equal(model.evaluateAnchoredAudience(vence(30, "curso-a"), { accesses: [], cohortIds: [] }), false, "'vence' continua exigindo o acesso aberto");
});

/* ------------------------------------------------------------------------------------------------
 * Validacao dos campos e normalizacao
 * ---------------------------------------------------------------------------------------------- */

test("validacao: dias inteiros de 1 a 3650 e produto escolhido ou qualquer um, no segmento e dentro dos fluxos", () => {
  const erroDe = (schema, rule) => {
    const parsed = schema.safeParse(todas(rule));

    if (parsed.success) {
      return null;
    }

    // Erro de tipo num campo (texto ou numero quebrado no lugar do inteiro): o zod devolve o erro da uniao "regra ou
    // grupo" com a mensagem do campo dentro, no lado da regra.
    const [issue] = parsed.error.issues;

    return issue.code === "invalid_union" ? issue.errors[0][0].message : issue.message;
  };

  for (const schema of [audienceDefinitionSchema, flowRuleDefinitionSchema]) {
    for (const type of ["access_ending", "access_expired"]) {
      assert.equal(erroDe(schema, { days: 30, productId: null, type }), null, `${type}: qualquer produto`);
      assert.equal(erroDe(schema, { days: 1, productId: "formacao-gestor-de-clone", type }), null, `${type}: um produto`);
      assert.equal(erroDe(schema, { days: 3650, productId: null, type }), null);
      assert.equal(erroDe(schema, { days: 0, productId: null, type }), "Use pelo menos 1 dia.");
      assert.equal(erroDe(schema, { days: 3651, productId: null, type }), "Use no máximo 3.650 dias.");
      assert.equal(erroDe(schema, { days: 7.5, productId: null, type }), "Use um número inteiro de dias.");
      assert.equal(erroDe(schema, { days: "30", productId: null, type }), "Informe um número de dias.");
      assert.equal(erroDe(schema, { productId: null, type }), "Informe um número de dias.", "sem os dias");
      assert.notEqual(erroDe(schema, { days: 30, type }), null, "sem dizer o produto (nem qualquer um)");
      assert.notEqual(erroDe(schema, { days: 30, productId: 12, type }), null, "produto que nao e texto");
    }
  }

  assert.equal(erroDe(audienceDefinitionSchema, { days: 30, productId: null, type: "access_expirado" }), "Escolha o tipo da regra.");
});

test("normalizacao: dias para dentro dos limites e produto vazio vira qualquer produto, nas duas regras", () => {
  const normal = model.normalizeAudience(
    todas(
      { days: 0, productId: "  ", type: "access_expired" },
      { days: 99_999, productId: " curso-a ", type: "access_expired" },
      { days: 29.6, productId: null, type: "access_ending" }
    )
  );

  assert.deepEqual(normal.root.items, [
    { days: 1, productId: null, type: "access_expired" },
    { days: 3650, productId: "curso-a", type: "access_expired" },
    { days: 30, productId: null, type: "access_ending" }
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * Frases e construtor
 * ---------------------------------------------------------------------------------------------- */

test("frases: 'têm acesso … que vence em até' e 'estão com o acesso … vencido há até', com e sem produto", () => {
  const nomes = { cohorts: {}, products: { "gestor-de-clone": "Formação Gestor de Clone" } };
  const frase = (definition) => model.describeAudience(definition, nomes);

  assert.equal(frase(vence(30)), "Alunos que têm acesso que vence em até 30 dias");
  assert.equal(frase(vence(7, "gestor-de-clone")), "Alunos que têm acesso a Formação Gestor de Clone que vence em até 7 dias");
  assert.equal(frase(vence(1)), "Alunos que têm acesso que vence em até 1 dia");
  assert.equal(frase(venceu(30)), "Alunos que estão com o acesso vencido há até 30 dias");
  assert.equal(frase(venceu(90, "gestor-de-clone")), "Alunos que estão com o acesso a Formação Gestor de Clone vencido há até 90 dias");
  assert.equal(frase(venceu(7, "sumiu")), "Alunos que estão com o acesso a um produto removido vencido há até 7 dias");
});

test("construtor: as duas regras estao no seletor do segmento e do fluxo, nascem validas com 30 dias e tem os atalhos 7, 30 e 90", () => {
  assert.equal(builder.AUDIENCE_RULE_LABELS.access_ending, "Acesso perto de vencer");
  assert.equal(builder.AUDIENCE_RULE_LABELS.access_expired, "Acesso vencido");
  assert.deepEqual([...builder.ACCESS_DEADLINE_SHORTCUTS], [7, 30, 90]);

  for (const mode of ["segment", "flow"]) {
    const tipos = builder.audienceRuleTypesFor(mode);

    assert.ok(tipos.includes("access_ending") && tipos.includes("access_expired"), mode);
    assert.equal(tipos.indexOf("access_expired"), tipos.indexOf("access_ending") + 1, "uma logo depois da outra");
    assert.equal(builder.isAudienceRuleTypeAllowed("access_expired", mode), true);
  }

  for (const type of ["access_ending", "access_expired"]) {
    const regra = builder.defaultAudienceRule(type);

    assert.deepEqual(regra, { days: 30, productId: null, type });
    assert.equal(audienceDefinitionSchema.safeParse(todas(regra)).success, true);
    assert.equal(flowRuleDefinitionSchema.safeParse(todas(regra)).success, true);
  }

  // Nenhuma leitura a mais: as duas so usam os acessos, que vem sempre.
  assert.deepEqual(model.audienceFactNeeds([vence(30), venceu(30)]), { comments: "none", lessons: false, students: false, webinars: false });
  assert.deepEqual(model.audienceFactsRequest(venceu(30)), { messageCampaignIds: [], webinarFollowUpIds: [], webinars: false });
});

test("a copia das regras de vencimento passa pela lista proibida da Comunicacao", () => {
  const PROIBIDAS = /campanha|público|audiência|evento|oferta|gatilho|trigger|sessão|impressão|automaç|lembrete|layout|template|\bhome\b/i;
  const nomes = { cohorts: {}, products: { "curso-a": "Curso" } };
  const textos = [
    builder.AUDIENCE_RULE_LABELS.access_ending,
    builder.AUDIENCE_RULE_LABELS.access_expired,
    builder.ACCESS_ENDING_HINT,
    builder.ACCESS_EXPIRED_HINT,
    model.describeAudience(vence(30, "curso-a"), nomes),
    model.describeAudience(venceu(30), nomes)
  ];

  for (const texto of textos) {
    assert.ok(texto.length > 0);
    assert.doesNotMatch(texto, PROIBIDAS, texto);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Fluxos
 * ---------------------------------------------------------------------------------------------- */

const FLUXO = "1c2d3e4f-3b1a-4c55-9d7e-2a6b8c9d0e1f";
const ENTRADA = "4e5f6071-3b1a-4c55-9d7e-2a6b8c9d0e01";
const PASSO = "4e5f6071-3b1a-4c55-9d7e-2a6b8c9d0e02";
const CONTEUDO = "7b2e8d1c-3b1a-4c55-9d7e-2a6b8c9d0e1f";

/** Banco com roteiro (como em tests/comunicacao-job.test.mjs): anota cada consulta e responde por `respond`. */
function scriptedDb(respond) {
  const queries = [];

  function chain(query) {
    return new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (resolve, reject) => Promise.resolve(respond(query)).then(resolve, reject);
          }

          return (...args) => {
            if (["delete", "insert", "select", "update", "upsert"].includes(property) && !query.op) {
              query.op = property;
              query.payload = args[0];
            } else {
              query.filters.push([property, ...args]);
            }

            return chain(query);
          };
        }
      }
    );
  }

  return {
    queries,
    from(table) {
      const query = { filters: [], op: null, payload: undefined, table };
      queries.push(query);
      return chain(query);
    },
    rpc(name, args) {
      const query = { args, filters: [], op: "rpc", payload: undefined, table: name };
      queries.push(query);
      return chain(query);
    }
  };
}

const temFiltro = (query, method, column, value) => query.filters.some(([name, col, val]) => name === method && col === column && (value === undefined || val === value));

const passo = (extra = {}) => ({
  anchor: "previous",
  anchor_node_id: null,
  branch: null,
  campaign_id: null,
  condition: null,
  expire_with_anchor: false,
  filter: null,
  flow_id: FLUXO,
  id: ENTRADA,
  kind: "entry",
  max_wait_minutes: null,
  offset_minutes: 0,
  parent_id: null,
  position: 0,
  wait_until_true: false,
  ...extra
});

function fluxo(extra = {}) {
  return {
    entry_audience: vence(30, "curso-a"),
    entry_mode: "current_and_new",
    // Entrada continua: a faixa anterior ja foi conferida, esta ainda nao.
    entry_refreshed_at: "2026-11-28T15:00:05.000000+00:00",
    goal: null,
    id: FLUXO,
    origin: "builder",
    revision: 3,
    source_campaign_id: null,
    status: "active",
    updated_at: "2026-11-28T10:00:00.000000+00:00",
    watched_page_keys: [],
    ...extra
  };
}

/** A escola no banco do tick, com as passagens que o fluxo ja tem. */
function bancoDoTick({ entrada, passagens }) {
  return scriptedDb((query) => {
    if (query.table === "communication_flows" && query.op === "select") {
      return { data: temFiltro(query, "eq", "origin", "builder") ? [fluxo({ entry_audience: entrada })] : [], error: null };
    }

    if (query.table === "communication_flows" && query.op === "update") {
      return { data: [{ id: FLUXO }], error: null };
    }

    if (query.table === "profiles") {
      return { count: PERFIS.length, data: PERFIS, error: null };
    }

    if (query.table === "admin_roles") {
      return { count: 1, data: [{ user_id: ALUNOS.equipe }], error: null };
    }

    if (query.table === "entitlements") {
      return { count: ACESSOS.length, data: ACESSOS, error: null };
    }

    if (query.table === "communication_flow_runs") {
      return { data: passagens.map((user_id) => ({ user_id })), error: null };
    }

    if (query.table === "communication_flow_nodes") {
      return { data: [passo(), passo({ campaign_id: CONTEUDO, id: PASSO, kind: "message", parent_id: ENTRADA })], error: null };
    }

    if (query.op === "rpc" && query.table === "communication_enroll_flow") {
      return { data: query.args.p_entries.length, error: null };
    }

    return { count: 0, data: [], error: null };
  });
}

const entradasDe = (db) => db.queries.filter((query) => query.table === "communication_enroll_flow").flatMap((query) => query.args.p_entries);

test("fluxo com 'Quem entra: acesso vence em até 30 dias': na faixa entra so quem esta na janela e ainda nao passou pelo fluxo", async () => {
  const db = bancoDoTick({ entrada: vence(30, "curso-a"), passagens: [] });
  const resultado = await processFlows({ db, now: AGORA });
  const entradas = entradasDe(db);

  assert.deepEqual(entradas.map((entry) => nomeDe(entry.user_id)), ["vence20"]);
  assert.equal(resultado.entered, 1);
  assert.equal(entradas[0].baseline, false);
  assert.equal(entradas[0].revision, 3, "a entrada leva a versao do fluxo lida");
  assert.deepEqual(entradas[0].tasks.map((task) => task.node_id), [PASSO], "o primeiro passo fica marcado para ele");

  const gravou = db.queries.find((query) => query.table === "communication_flows" && query.op === "update");
  assert.equal(gravou.payload.entry_count, 1, "a contagem de quem esta no segmento agora");
});

test("fluxo de vencimento nao repete: quem ja tem passagem nao entra de novo no tick seguinte, e nada e gravado para ele", async () => {
  const db = bancoDoTick({ entrada: vence(30, "curso-a"), passagens: [ALUNOS.vence20] });
  const resultado = await processFlows({ db, now: AGORA });

  assert.deepEqual(entradasDe(db), [], "nenhuma entrada nova");
  assert.equal(resultado.entered, 0);
  assert.equal(db.queries.some((query) => query.table === "communication_enroll_flow"), false, "a RPC de entrada nem e chamada");

  // A faixa fica conferida e a contagem continua sendo a de quem esta no segmento.
  const gravou = db.queries.find((query) => query.table === "communication_flows" && query.op === "update");
  assert.equal(gravou.payload.entry_count, 1);
  assert.equal(gravou.payload.entry_refreshed_at, AGORA.toISOString());
});

test("fluxo com 'Quem entra: acesso venceu há até 30 dias': entram os vencidos que seguem sem acesso; reembolso, suspenso e renovado nao", async () => {
  const db = bancoDoTick({ entrada: venceu(30, "curso-a"), passagens: [ALUNOS.venceu5] });
  await processFlows({ db, now: AGORA });

  assert.deepEqual(
    entradasDe(db).map((entry) => nomeDe(entry.user_id)).sort(),
    ["marcadoExpirado", "plataformaVenceu"],
    "o venceu5 ja tinha passado pelo fluxo"
  );
});

test("'Só quem entrar no segmento a partir de agora': quem ja esta na janela ao ativar fica marcado e nunca recebe; o fluxo so pega quem cruzar depois", async () => {
  const db = scriptedDb((query) => {
    if (query.table === "communication_flows" && query.op === "select") {
      return { data: temFiltro(query, "eq", "origin", "builder") ? [fluxo({ entry_mode: "new_only", entry_refreshed_at: null })] : [], error: null };
    }

    if (query.table === "profiles") {
      return { count: PERFIS.length, data: PERFIS, error: null };
    }

    if (query.table === "entitlements") {
      return { count: ACESSOS.length, data: ACESSOS, error: null };
    }

    if (query.table === "communication_flow_nodes") {
      return { data: [passo(), passo({ campaign_id: CONTEUDO, id: PASSO, kind: "message", parent_id: ENTRADA })], error: null };
    }

    if (query.table === "communication_flows" && query.op === "update") {
      return { data: [{ id: FLUXO }], error: null };
    }

    return { count: 0, data: [], error: null };
  });

  await processFlows({ db, now: AGORA });

  const entradas = entradasDe(db);
  // Sem a equipe marcada neste banco, o acesso dela (5 dias) tambem conta; o que importa e a marca e nenhum passo.
  assert.ok(entradas.some((entry) => entry.user_id === ALUNOS.vence20));
  assert.ok(entradas.every((entry) => entry.baseline === true && entry.tasks.length === 0), "marcados, sem nenhum passo");
});

const tarefa = (userId, nodeId = PASSO) => ({
  anchor_at: "2026-11-28T14:00:00.000+00:00",
  attempts: 1,
  claimed_at: "2026-11-28T15:15:00.000123+00:00",
  deadline_at: null,
  deferrals: 0,
  due_at: "2026-11-28T15:00:00+00:00",
  flow_active: true,
  flow_id: FLUXO,
  node_id: nodeId,
  not_before: null,
  status: "running",
  user_id: userId
});

/** O banco de um lote do motor: o fluxo, os passos e os acessos pela RPC de fatos do lote (abertos ou nao). */
function bancoDoLote(nodes) {
  return scriptedDb((query) => {
    if (query.table === "communication_flows") {
      return { data: [fluxo({ entry_audience: vence(90, "curso-a") })], error: null };
    }

    if (query.table === "communication_flow_nodes") {
      return { data: nodes, error: null };
    }

    if (query.op === "rpc" && query.table === "communication_flow_batch_facts") {
      return {
        data: {
          accesses: ACESSOS.filter((row) => query.args.p_user_ids.includes(row.user_id)).map(({ user_id, ...row }) => ({ ...row, u: user_id })),
          messages: [],
          runs: query.args.p_user_ids.map((u) => ({ entered_at: iso(daysAgo(60)), f: FLUXO, u })),
          staff: [],
          visits: []
        },
        error: null
      };
    }

    return { count: 0, data: [], error: null };
  });
}

test("lote do motor, 'Só para quem o acesso vence em até 30 dias': quem renovou, quem ficou sem prazo e quem ja venceu param ali; quem segue na janela recebe", async () => {
  const filtro = vence(30, "curso-a");
  const db = bancoDoLote([passo(), passo({ campaign_id: CONTEUDO, filter: filtro, id: PASSO, kind: "message", parent_id: ENTRADA })]);
  const alunos = [ALUNOS.vence20, ALUNOS.renovou, ALUNOS.semPrazo, ALUNOS.venceu5, ALUNOS.plataformaAberta];
  const itens = await loadFlowBatchContext(db, alunos.map((id) => tarefa(id)), AGORA);
  const combina = Object.fromEntries(itens.map((item) => [nomeDe(item.task.user_id), model.evaluateAudience(filtro, item.input.facts, item.input.context)]));

  assert.deepEqual(combina, { plataformaAberta: false, renovou: false, semPrazo: false, vence20: true, venceu5: false });

  // Quem nao combina termina como "fora do filtro" e nao recebe a notificacao.
  for (const item of itens.filter((entry) => !combina[nomeDe(entry.task.user_id)])) {
    const decisao = decideFlowTask(item.input);

    assert.deepEqual([decisao.action, decisao.result], ["finish", "filtered"], nomeDe(item.task.user_id));
  }

  assert.equal(db.queries.filter((query) => query.table === "communication_flow_batch_facts").length, 1, "uma leitura para o lote");
  assert.equal(db.queries.some((query) => query.table === "profiles" || query.table === "entitlements"), false, "so os acessos do lote, sem ler a escola");
});

test("lote do motor, Condição 'o acesso venceu há até 30 dias': Sim para o vencido sem acesso, Não para quem renovou ou teve o acesso removido", async () => {
  const CONDICAO = "4e5f6071-3b1a-4c55-9d7e-2a6b8c9d0e03";
  const db = bancoDoLote([passo(), passo({ condition: venceu(30, "curso-a"), id: CONDICAO, kind: "condition", parent_id: ENTRADA })]);
  const alunos = [ALUNOS.venceu5, ALUNOS.renovou, ALUNOS.reembolso, ALUNOS.vence20];
  const itens = await loadFlowBatchContext(db, alunos.map((id) => tarefa(id, CONDICAO)), AGORA);
  const lado = Object.fromEntries(itens.map((item) => [nomeDe(item.task.user_id), decideFlowTask(item.input).result]));

  assert.deepEqual(lado, { reembolso: "no", renovou: "no", vence20: "no", venceu5: "yes" });
});
