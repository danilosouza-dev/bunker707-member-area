import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";
import { bancoDaLicenca } from "./support/licenca-banco-em-memoria.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// O endereço por onde o dono e os administradores abrem o admin (docs/32 §2.2 e §11.3; revisão de 11/11/2026), pela
// peça que o layout do admin chama (src/server/licensing/request-host.ts): decide pela situação do pedido, só grava
// quando algo muda, no máximo uma tentativa por minuto por mudança, depois da resposta, e nunca derruba a página. No
// modo "off", nada.

const store = await import("../src/server/licensing/store.ts");
const { computeLicenseState } = await import("../src/server/licensing/state.ts");
const { REQUEST_HOST_WRITE_INTERVAL_MS, observeAdminRequestHost } = await import("../src/server/licensing/request-host.ts");

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
const T0 = Date.parse("2026-11-11T12:00:00.000Z");
const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const LICENCIADO = "https://alunos.escola.test";

function cenario() {
  const linha = {
    ...store.EMPTY_LICENSE_RECORD,
    token: assinarLicenca(emissao, licencaBase({ issuedAt: new Date(T0 - MINUTO).toISOString(), expiresAt: new Date(T0 + 60 * DIA).toISOString() })),
    everActivated: true,
    lastSeenAt: new Date(T0),
    lastCheckIn: { emissorTime: new Date(T0), localTime: new Date(T0) },
    newestIssuedAt: new Date(T0 - MINUTO)
  };
  const banco = bancoDaLicenca(store.EMPTY_LICENSE_RECORD, linha);
  const agendadas = [];
  const registro = { esquecida: 0, logs: [], leituras: 0 };
  let relogio = T0;

  const deps = (pedido, extra = {}) => ({
    mode: () => "enforce",
    requestHost: async () => pedido,
    state: async () => {
      registro.leituras += 1;
      return computeLicenseState({ mode: "enforce", roots: RAIZES, snapshot: store.snapshotOf(banco.linha), systemNow: new Date(relogio), configuredHost: LICENCIADO });
    },
    db: () => banco,
    roots: () => RAIZES,
    configuredHost: () => LICENCIADO,
    now: () => new Date(relogio),
    schedule: (tarefa) => agendadas.push(tarefa),
    forget: () => {
      registro.esquecida += 1;
    },
    log: (texto) => registro.logs.push(texto),
    ...extra
  });

  return {
    banco,
    registro,
    deps,
    avancar: (ms) => {
      relogio += ms;
    },
    async rodarAgendadas() {
      for (const tarefa of agendadas.splice(0)) {
        await tarefa();
      }
    },
    get agendadas() {
      return agendadas.length;
    },
    gravacoes: () => banco.chamadas.filter((chamada) => chamada === "write").length
  };
}

test("modo off: nada é lido nem gravado", async () => {
  const proibido = () => {
    throw new Error("o modo off não lê nada");
  };
  assert.equal(await observeAdminRequestHost({ mode: () => "off", requestHost: proibido, state: proibido, db: proibido }), "desligado");
});

test("o dono no endereço da licença: nada a gravar, pedido após pedido (nenhuma gravação por pedido)", async () => {
  const c = cenario();

  for (let pedido = 0; pedido < 5; pedido += 1) {
    assert.equal(await observeAdminRequestHost(c.deps("alunos.escola.test")), "no_endereco");
    c.avancar(MINUTO);
  }

  assert.equal(c.agendadas, 0);
  assert.equal(c.gravacoes(), 0);
});

test("a cópia aberta por outro endereço: grava a primeira vez depois da resposta; os pedidos seguintes não gravam", async () => {
  const c = cenario();

  assert.equal(await observeAdminRequestHost(c.deps("pirata.example.com")), "registrado");
  assert.equal(c.gravacoes(), 0, "a gravação vai para depois da resposta");

  // Outro pedido antes da gravação rodar (a situação do pedido ainda não a vê): a trava de um minuto segura.
  assert.equal(await observeAdminRequestHost(c.deps("pirata.example.com")), "segurado");

  await c.rodarAgendadas();
  assert.equal(c.gravacoes(), 1);
  assert.deepEqual(c.banco.linha.requestHost, { host: "pirata.example.com", since: new Date(T0) });
  assert.equal(c.registro.esquecida, 1, "a memória da linha é esquecida: o próximo pedido vê a marca");

  for (let pedido = 0; pedido < 5; pedido += 1) {
    c.avancar(REQUEST_HOST_WRITE_INTERVAL_MS + 1);
    assert.equal(await observeAdminRequestHost(c.deps("pirata.example.com")), "ja_registrado");
  }
  assert.equal(c.agendadas, 0);
  assert.equal(c.gravacoes(), 1);

  // A situação do pedido já está na escada do endereço diferente.
  const situacao = await c.deps(null).state();
  assert.equal(situacao.evaluation.degree, "aviso");
  assert.equal(situacao.evaluation.restrictions.newAccess, true);
  assert.equal(situacao.requestHost, "pirata.example.com");
});

test("de volta ao endereço da licença: apaga a marca; pedido interno, por IP ou sem licença não conta; falha nunca derruba", async () => {
  const c = cenario();
  // Outro endereço que o do teste anterior: a trava de um minuto é deste processo, e vale entre os testes também.
  assert.equal(await observeAdminRequestHost(c.deps("copia.example.com")), "registrado");
  await c.rodarAgendadas();
  assert.equal(c.banco.linha.requestHost.host, "copia.example.com");

  c.avancar(REQUEST_HOST_WRITE_INTERVAL_MS + 1);
  assert.equal(await observeAdminRequestHost(c.deps("alunos.escola.test")), "voltou");
  await c.rodarAgendadas();
  assert.equal(c.banco.linha.requestHost, null);
  assert.equal((await c.deps(null).state()).evaluation.degree, "ok");

  for (const interno of ["localhost:3000", "app:3000", "172.18.0.4:3000", null]) {
    assert.equal(await observeAdminRequestHost(c.deps(interno)), "fora_do_proxy", String(interno));
  }

  assert.equal(await observeAdminRequestHost(c.deps("pirata.example.com", { state: async () => null })), "sem_licenca", "a leitura que falhou não grava nada");
  const quebrada = await observeAdminRequestHost(
    c.deps("pirata.example.com", {
      state: async () => {
        throw new Error("banco fora");
      }
    })
  );
  assert.equal(quebrada, "falhou");
  assert.match(c.registro.logs.at(-1), /^\[licenca\] endereco do pedido do admin/);
  assert.equal(c.agendadas, 0);
});

test("o layout do admin observa só os pedidos do dono e dos administradores", () => {
  const layout = readFileSync(new URL("../src/app/admin/(v2)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /if \(isLicenseManager\(access\)\) \{\s*await observeAdminRequestHost\(\);\s*\}/);
});
