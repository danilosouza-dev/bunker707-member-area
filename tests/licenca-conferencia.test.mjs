import assert from "node:assert/strict";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { bancoDaLicenca } from "./support/licenca-banco-em-memoria.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// A tarefa de minuto da licença (docs/32 §11.3, `licenca-conferencia`): src/server/licensing/tick.ts com um banco em
// memória e Emissores de teste, o cliente de hoje ("não configurado") e as duas peças do servidor que só ligam as
// coisas: o job do tick e a situação de cada pedido. A guarda principal: no modo "off" (a nossa escola hoje, a dev, a
// Vercel e os testes) nada disso cria o banco, lê a tabela ou chama o Emissor.

const store = await import("../src/server/licensing/store.ts");
const { CHECK_IN_TIMEOUT_MS, runLicenseTick } = await import("../src/server/licensing/tick.ts");
const { EMISSOR_ERROR_CODES, emissorClient, notConfiguredEmissorClient } = await import("../src/server/licensing/client.ts");
const { getCurrentLicenseState } = await import("../src/server/licensing/current-state.ts");
const { licenseStateDbOf } = await import("../src/server/licensing/store-db.ts");
const { LICENSE_CHECK_IN_JOB_NAME, licenseCheckInJob } = await import("../src/server/jobs/license-check-in-job.ts");

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const AGORA = new Date("2026-11-11T12:00:00.000Z");
const ENDERECO = "https://alunos.escola.test";
const VAZIO = store.EMPTY_LICENSE_RECORD;
const SEGREDO = "segredo-de-teste-da-instalacao-0001";
const depois = (ms) => new Date(AGORA.getTime() + ms);

/** Uma Instalação ativada, conferida pela última vez ontem: a conferência diária venceu. */
function vencida(extra = {}) {
  const licenca = licencaBase();
  const ontem = new Date(AGORA.getTime() - 30 * HORA);
  return {
    ...VAZIO,
    version: 1,
    token: assinarLicenca(emissao, licenca),
    everActivated: true,
    lastSeenAt: AGORA,
    lastCheckIn: { emissorTime: ontem, localTime: ontem },
    newestIssuedAt: new Date(licenca.issuedAt),
    installationId: "inst_0001",
    installationSecret: SEGREDO,
    checkInSequence: "seq-1",
    checkInAttemptedAt: ontem,
    checkInResult: "ok",
    ...extra
  };
}

/** Um Emissor de teste: anota cada pedido e responde o que `responder` devolver. */
function emissorDeTeste(responder) {
  const pedidos = [];
  return {
    pedidos,
    client: {
      async activate() {
        throw new Error("a tarefa do tick nunca ativa");
      },
      async checkIn(pedido) {
        pedidos.push(pedido);
        return responder(pedido);
      }
    }
  };
}

/** A licença nova que um Emissor de verdade devolveria agora. */
const novaDoEmissor = (extra = {}) =>
  assinarLicenca(emissao, licencaBase({ issuedAt: "2026-11-11T12:00:00.000Z", expiresAt: "2027-02-09T12:00:00.000Z", ...extra }));

function rodar(banco, client, extra = {}) {
  return runLicenseTick({
    mode: "enforce",
    db: () => banco,
    client: () => client,
    roots: () => RAIZES,
    configuredHost: () => ENDERECO,
    now: () => AGORA,
    ...extra
  });
}

const proibido = (nome) => () => {
  throw new Error(`${nome}: não podia ser criado aqui`);
};

// ---- Modo off ------------------------------------------------------------------------------------------

test("modo off: a tarefa não cria o banco nem o cliente e não lê relógio, raízes nem endereço", async () => {
  const resultado = await runLicenseTick({
    mode: "off",
    db: proibido("banco"),
    client: proibido("cliente do Emissor"),
    roots: proibido("raízes"),
    configuredHost: proibido("endereço"),
    now: proibido("relógio"),
    nonce: proibido("nonce")
  });

  assert.deepEqual(resultado, { mode: "off" });
});

test("o job licenca-conferencia sem o modo enforce no build não toca no banco do tick", async () => {
  const antes = process.env.BUNKER_LICENSING_MODE;
  const tocado = [];
  const supabase = new Proxy({}, { get: (_alvo, chave) => tocado.push(String(chave)) && undefined });

  try {
    for (const valor of [undefined, "", "on", "ENFORCE"]) {
      if (valor === undefined) delete process.env.BUNKER_LICENSING_MODE;
      else process.env.BUNKER_LICENSING_MODE = valor;
      await licenseCheckInJob.run({ runId: "r", signal: AbortSignal.timeout(1_000), supabase, tickRunId: "t", tickStartedAt: AGORA });
    }
  } finally {
    if (antes === undefined) delete process.env.BUNKER_LICENSING_MODE;
    else process.env.BUNKER_LICENSING_MODE = antes;
  }

  assert.deepEqual(tocado, []);
  assert.equal(LICENSE_CHECK_IN_JOB_NAME, "licenca-conferencia");
  assert.equal(licenseCheckInJob.name, LICENSE_CHECK_IN_JOB_NAME);
  assert.match(licenseCheckInJob.name, /^[a-z0-9][a-z0-9-]{0,119}$/);
});

test("a situação do pedido no modo off não cria o cliente do banco; no enforce lê a linha e não grava", async () => {
  const antes = process.env.BUNKER_LICENSING_MODE;
  const chamadas = [];
  const supabaseSemLinha = {
    from(tabela) {
      chamadas.push(tabela);
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: () => assert.fail("a situação do pedido nunca grava"),
        update: () => assert.fail("a situação do pedido nunca grava")
      };
      return consulta;
    }
  };
  let criado = 0;
  Object.defineProperty(actionStubs, "db", {
    configurable: true,
    get() {
      criado += 1;
      return supabaseSemLinha;
    }
  });

  try {
    delete process.env.BUNKER_LICENSING_MODE;
    assert.deepEqual(await getCurrentLicenseState(), { mode: "off" });
    assert.equal(criado, 0, "o cliente do banco nem é criado no modo off");

    process.env.BUNKER_LICENSING_MODE = "enforce";
    const situacao = await getCurrentLicenseState();
    assert.equal(situacao.mode, "enforce");
    assert.equal(situacao.evaluation.degree, "nao_ativada");
    assert.equal(criado, 1);
    assert.deepEqual(chamadas, ["license_state"]);
  } finally {
    if (antes === undefined) delete process.env.BUNKER_LICENSING_MODE;
    else process.env.BUNKER_LICENSING_MODE = antes;
    delete actionStubs.db;
    actionStubs.db = null;
  }
});

// ---- O adaptador do Supabase ---------------------------------------------------------------------------

/**
 * Um Supabase de uma tabela e uma linha, com as regras do PostgREST que o adaptador usa: insert com a chave repetida
 * responde 23505; update e select filtram por igualdade; update devolve as linhas mudadas. O banco de verdade fica em
 * tests/integration/licenca-guardada.test.mjs.
 */
function supabaseDeUmaLinha({ erro = null } = {}) {
  let linha = null;
  const pedidos = [];

  return {
    pedidos,
    get linha() {
      return linha;
    },
    set linha(valor) {
      linha = valor;
    },
    from(tabela) {
      const pedido = { tabela, op: "select", filtros: [], valores: null };
      const executar = async (umaSo) => {
        pedidos.push(structuredClone(pedido));

        if (erro) return { data: null, error: erro };

        const casa = linha !== null && pedido.filtros.every(([coluna, valor]) => linha[coluna] === valor);

        if (pedido.op === "insert") {
          if (linha) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          linha = { ...pedido.valores };
          return { data: umaSo ? { ...linha } : [{ ...linha }], error: null };
        }

        if (pedido.op === "update") {
          if (!casa) return { data: [], error: null };
          linha = { ...linha, ...pedido.valores };
          return { data: [{ ...linha }], error: null };
        }

        return { data: umaSo ? (casa ? { ...linha } : null) : casa ? [{ ...linha }] : [], error: null };
      };
      const consulta = {
        select: (colunas) => ((pedido.colunas = colunas), consulta),
        insert: (valores) => ((pedido.op = "insert"), (pedido.valores = valores), consulta),
        update: (valores) => ((pedido.op = "update"), (pedido.valores = valores), consulta),
        eq: (coluna, valor) => (pedido.filtros.push([coluna, valor]), consulta),
        maybeSingle: () => executar(true),
        then: (resolve, reject) => executar(false).then(resolve, reject)
      };
      return consulta;
    }
  };
}

test("o adaptador cria a linha 1 uma vez só, grava só com a versão lida e só as colunas do patch", async () => {
  const supabase = supabaseDeUmaLinha();
  const adaptador = licenseStateDbOf(supabase);

  assert.equal(await adaptador.read(), null);
  const criada = await adaptador.write({ installationId: "inst_0001", lastSeenAt: AGORA }, null);
  assert.equal(criada.version, 1);
  assert.equal(criada.installationId, "inst_0001");
  assert.equal(supabase.linha.id, 1);
  assert.equal(await adaptador.write({ installationId: "inst_9999" }, null), null, "a segunda criação perde (23505)");

  const gravada = await adaptador.write({ checkInResult: "ok", lastCheckIn: { emissorTime: AGORA, localTime: depois(1_000) } }, 1);
  assert.equal(gravada.version, 2);
  assert.deepEqual(supabase.pedidos.at(-1).filtros, [["id", 1], ["version", 1]]);
  assert.deepEqual(supabase.pedidos.at(-1).valores, {
    check_in_result: "ok",
    last_check_in_emissor_at: AGORA.toISOString(),
    last_check_in_local_at: depois(1_000).toISOString(),
    version: 2
  });
  assert.equal(await adaptador.write({ checkInResult: "sem_resposta" }, 1), null, "versão velha: nada gravado");
  assert.equal(supabase.linha.check_in_result, "ok");
  assert.equal((await adaptador.read()).lastSeenAt.toISOString(), AGORA.toISOString(), "o que o patch não trouxe ficou");
});

test("o adaptador lê data inválida do banco (infinity) como data inválida, nunca como null, e se recusa a gravar data inválida", async () => {
  const supabase = supabaseDeUmaLinha();
  const adaptador = licenseStateDbOf(supabase);
  await adaptador.write({}, null);
  supabase.linha = { ...supabase.linha, last_seen_at: "infinity", unreadable_since: "-infinity", host_mismatch_since: null };

  const lida = await adaptador.read();
  assert.ok(lida.lastSeenAt instanceof Date && Number.isNaN(lida.lastSeenAt.getTime()));
  assert.ok(Number.isNaN(lida.unreadableSince.getTime()));
  assert.equal(lida.hostMismatchSince, null);

  await assert.rejects(adaptador.write({ lastSeenAt: new Date("infinity") }, lida.version), /data invalida para gravar em last_seen_at/);
});

test("erro do banco no adaptador: tabela que falta vira migração pendente; outro erro não leva os valores da linha", async () => {
  const semTabela = licenseStateDbOf(supabaseDeUmaLinha({ erro: { code: "42P01", message: 'relation "public.license_state" does not exist' } }));
  await assert.rejects(semTabela.read(), (erro) => erro.name === "PendingMigrationError");

  const checagem = {
    code: "23514",
    message: 'new row for relation "license_state" violates check constraint "license_state_token_size"',
    details: `Failing row contains (1, ${SEGREDO}).`
  };
  await assert.rejects(licenseStateDbOf(supabaseDeUmaLinha({ erro: checagem })).write({ token: "x" }, 1), (erro) => {
    assert.match(erro.message, /license_state_token_size/);
    assert.doesNotMatch(erro.message, new RegExp(SEGREDO));
    return true;
  });
});

// ---- O cliente de hoje ---------------------------------------------------------------------------------

test("sem o endereço do Emissor no build, o cliente é o 'nao_configurado': responde isso a tudo, sem lançar e sem abrir conexão", async () => {
  assert.equal(emissorClient(), notConfiguredEmissorClient);
  assert.deepEqual(await notConfiguredEmissorClient.preflight({ activationKey: "x", host: "alunos.escola.test" }), { ok: false, error: "nao_configurado" });
  assert.deepEqual(await notConfiguredEmissorClient.activate({ activationKey: "x", host: "alunos.escola.test", instanceId: "i", nonce: "n" }), {
    ok: false,
    error: "nao_configurado"
  });
  assert.deepEqual(
    await notConfiguredEmissorClient.checkIn({ host: null, installationId: "i", installationSecret: SEGREDO, nonce: "n", sequence: null }),
    { ok: false, error: "nao_configurado" }
  );
  assert.deepEqual(await notConfiguredEmissorClient.deactivate({ installationId: "i", installationSecret: SEGREDO, nonce: "n" }), {
    ok: false,
    error: "nao_configurado"
  });

  for (const codigo of EMISSOR_ERROR_CODES) {
    assert.match(codigo, store.CHECK_IN_RESULT_PATTERN, `${codigo} cabe na coluna check_in_result`);
  }
});

test("conferência vencida com o cliente de hoje: a tentativa fica gravada com o motivo, a licença continua valendo e a seguinte espera 1 hora", async () => {
  const banco = bancoDaLicenca(VAZIO, vencida());
  let chamadas = 0;
  const contado = {
    activate: notConfiguredEmissorClient.activate,
    checkIn: (pedido) => {
      chamadas += 1;
      return notConfiguredEmissorClient.checkIn(pedido);
    }
  };

  const { state: situacaoDaRodada, ...primeira } = await rodar(banco, contado);
  assert.deepEqual(primeira, { mode: "enforce", contended: false, checkIn: { due: true, reason: "diaria" }, result: "nao_configurado" });
  assert.equal(situacaoDaRodada.evaluation.degree, "ok", "a rodada devolve a situação (a dos e-mails de degrau)");
  assert.equal(chamadas, 1);
  assert.equal(banco.linha.checkInResult, "nao_configurado");
  assert.equal(banco.linha.checkInAttemptedAt.toISOString(), AGORA.toISOString());
  assert.equal(banco.linha.token, vencida().token, "a licença guardada continua a mesma");
  assert.equal(banco.linha.checkInSequence, "seq-1");

  const situacao = await store.loadLicenseState({ mode: "enforce", db: () => banco, roots: () => RAIZES, configuredHost: () => ENDERECO, systemNow: () => AGORA });
  assert.equal(situacao.evaluation.degree, "ok", "uma conferência que falha não limita ninguém");

  assert.deepEqual((await rodar(banco, contado, { now: () => depois(MINUTO) })).checkIn, { due: false, reason: "aguardando_nova_tentativa" });
  assert.equal((await rodar(banco, contado, { now: () => depois(HORA) })).result, "nao_configurado");
  assert.equal(chamadas, 2);
});

// ---- Com um Emissor de teste ---------------------------------------------------------------------------

test("conferência boa: o pedido leva o identificador, o segredo, a sequência, um nonce novo, o endereço, a licença guardada e as versões; a licença nova e a sequência são gravadas", async () => {
  const banco = bancoDaLicenca(VAZIO, vencida());
  const emissor = emissorDeTeste(() => ({ ok: true, token: novaDoEmissor(), sequence: "seq-2" }));

  const resultado = await rodar(banco, emissor.client, { now: () => depois(1_000), versions: () => ({ product: "1.4.0" }) });
  assert.equal(resultado.result, "ok");

  const [pedido] = emissor.pedidos;
  assert.equal(pedido.installationId, "inst_0001");
  assert.equal(pedido.installationSecret, SEGREDO);
  assert.equal(pedido.sequence, "seq-1");
  assert.equal(pedido.host, "alunos.escola.test");
  assert.match(pedido.nonce, /^[A-Za-z0-9_-]{43}$/, "32 bytes sorteados, como o protocolo pede");
  assert.equal(pedido.storedLicense, vencida().token, "a licença guardada vai junto, para a readoção");
  assert.equal(pedido.licenseId, "lic_0001", "o número da Licença da licença guardada");
  assert.equal(pedido.newestIssuedAt.toISOString(), "2026-11-10T12:00:00.000Z", "o cliente confere que a resposta não é mais antiga");
  assert.deepEqual(pedido.versions, { product: "1.4.0" });
  assert.ok(pedido.signal instanceof AbortSignal, "o tempo limite vai junto");

  const linha = banco.linha;
  assert.equal(linha.token, novaDoEmissor());
  assert.equal(linha.checkInSequence, "seq-2");
  assert.equal(linha.checkInResult, "ok");
  assert.equal(linha.lastSeenAt.toISOString(), "2026-11-11T12:00:00.000Z", "realinhada com a hora assinada");
  assert.deepEqual(linha.lastCheckIn, { emissorTime: new Date("2026-11-11T12:00:00.000Z"), localTime: depois(1_000) });

  banco.mexer({ checkInRequestedAt: depois(2_000) });
  await rodar(banco, emissor.client, { now: () => depois(3_000) });
  assert.equal(emissor.pedidos.length, 2);
  assert.notEqual(emissor.pedidos[1].nonce, pedido.nonce, "um nonce novo a cada conferência");
  assert.equal(emissor.pedidos[1].sequence, "seq-2", "apresenta a sequência devolvida pela anterior");
});

test("a licença guardada adulterada pede a conferência na hora: sai na mesma rodada, mesmo com a diária em dia", async () => {
  const partes = vencida().token.split(".");
  partes[3] = Buffer.from(JSON.stringify(licencaBase({ features: [{ key: "pago" }] }))).toString("base64url");
  const banco = bancoDaLicenca(VAZIO, vencida({ token: partes.join("."), lastCheckIn: { emissorTime: AGORA, localTime: AGORA } }));
  const emissor = emissorDeTeste(() => ({ ok: false, error: "indisponivel" }));

  const resultado = await rodar(banco, emissor.client, { now: () => depois(MINUTO) });

  assert.deepEqual(resultado.checkIn, { due: true, reason: "pedida" });
  assert.equal(emissor.pedidos.length, 1);
  assert.equal(banco.linha.unreadableSince.toISOString(), depois(MINUTO).toISOString());
  assert.equal(banco.linha.checkInRequestedAt, null, "a tentativa atendeu o pedido");
  assert.equal(banco.linha.checkInResult, "indisponivel");
});

test("o Emissor que não responde vira 'sem_resposta' no prazo, sem segurar o tick", async () => {
  const banco = bancoDaLicenca(VAZIO, vencida());
  const emissor = emissorDeTeste(() => new Promise(() => {}));
  const inicio = Date.now();
  // O timer do AbortSignal.timeout nao segura o processo: sem um timer comum, o runner ve o laco de eventos vazio
  // (a promessa do Emissor nunca resolve) e cancela este teste e os seguintes.
  const prazo = new AbortController();
  const timer = setTimeout(() => prazo.abort(new DOMException("prazo do teste", "TimeoutError")), 50);

  const resultado = await rodar(banco, emissor.client, { signal: prazo.signal }).finally(() => clearTimeout(timer));

  assert.equal(resultado.result, "sem_resposta");
  assert.ok(Date.now() - inicio < 2_000, "não espera além do prazo");
  assert.equal(banco.linha.checkInResult, "sem_resposta");
  assert.ok(CHECK_IN_TIMEOUT_MS <= 10_000, "tempo limite curto");
});

test("cliente que lança vira 'erro_inesperado' e resposta fora do formato vira 'resposta_invalida'; nenhum dos dois lança", async () => {
  const casos = [
    [() => Promise.reject(new Error("bug")), "erro_inesperado"],
    [() => ({ ok: true, token: novaDoEmissor() }), "resposta_invalida"],
    [() => ({ ok: true, token: 42, sequence: "s" }), "resposta_invalida"],
    [() => ({ ok: true, token: novaDoEmissor(), sequence: "x".repeat(129) }), "resposta_invalida"],
    [() => ({ ok: false, error: "Erro 500: <html>" }), "resposta_invalida"],
    [() => null, "resposta_invalida"]
  ];

  for (const [responder, esperado] of casos) {
    const banco = bancoDaLicenca(VAZIO, vencida());
    const resultado = await rodar(banco, emissorDeTeste(responder).client);
    assert.equal(resultado.result, esperado, String(responder));
    assert.equal(banco.linha.checkInResult, esperado);
    assert.equal(banco.linha.token, vencida().token);
  }
});

test("licença devolvida que o store recusa grava o motivo e não troca a licença nem a sequência", async () => {
  const banco = bancoDaLicenca(VAZIO, vencida());
  const outra = novaDoEmissor({ installation: { id: "inst_9999", host: "alunos.escola.test" } });
  const resultado = await rodar(banco, emissorDeTeste(() => ({ ok: true, token: outra, sequence: "seq-9" })).client);

  assert.equal(resultado.result, "outra_instalacao");
  assert.equal(banco.linha.token, vencida().token);
  assert.equal(banco.linha.checkInSequence, "seq-1");
});

test("Instalação ainda sem identificador e segredo: a rodada só anda a hora vista e não chama o Emissor", async () => {
  const banco = bancoDaLicenca(VAZIO, vencida({ installationId: null, installationSecret: null, checkInSequence: null }));
  const { state, ...resultado } = await rodar(banco, null, { client: proibido("cliente do Emissor sem Instalação") });

  assert.deepEqual(resultado, { mode: "enforce", contended: false, checkIn: { due: false, reason: "sem_instalacao" }, result: null });
  assert.equal(state.mode, "enforce");
  assert.equal(banco.linha.lastSeenAt.toISOString(), "2026-11-11T12:01:00.000Z");
});

test("duas rodadas no mesmo minuto: só uma fala com o Emissor", async () => {
  const banco = bancoDaLicenca(VAZIO, vencida());
  const emissor = emissorDeTeste(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true, token: novaDoEmissor(), sequence: "seq-2" }), 20)));

  const [a, b] = await Promise.all([rodar(banco, emissor.client), rodar(banco, emissor.client)]);

  assert.equal(emissor.pedidos.length, 1);
  assert.deepEqual([a.result, b.result].sort(), ["ok", null].sort());
  assert.equal(banco.linha.checkInSequence, "seq-2");
});
