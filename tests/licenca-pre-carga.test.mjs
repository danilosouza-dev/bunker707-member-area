import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import "./support/resolve-extensionless-ts.mjs";
import { CONTEXTO_CERTIFICADO, CONTEXTO_LICENCA, assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// O arquivo carregado antes do produto (docs/32 §7.1, medida 7; o cenário forge.mjs da revisão de 11/11/2026): o
// comprador é dono do compose e manda o Node carregar, pelo NODE_OPTIONS, um arquivo que troca o crypto.verify por um
// que sempre aceita. Aqui o mesmo arquivo roda dentro deste processo de teste (cada arquivo de teste roda no próprio
// processo), e a licença forjada tem de ser recusada pela conferência embutida no produto. E o produto vendido não sobe
// com essas opções: a conferência da subida, contra processos de verdade abertos com elas.

const raiz = novaRaiz("raiz-2026");
const RAIZES = [raiz.confiavel];
const legitima = assinarLicenca(novaChaveDeEmissao(raiz), licencaBase());

// ---- O arquivo da revisão (scripts/preload-patch.cjs), dentro deste processo --------------------------------

const require = createRequire(import.meta.url);
const nodeCrypto = require("node:crypto");
const verifyDeVerdade = nodeCrypto.verify;
nodeCrypto.verify = function verifyTrocado(algorithm, ...resto) {
  if (algorithm === null) {
    return true;
  }
  return verifyDeVerdade.call(this, algorithm, ...resto);
};
// O que o Node faz sozinho quando o arquivo roda antes de tudo: o import { verify } from "node:crypto" vê o trocado.
syncBuiltinESMExports();

const { verifyLicenseToken } = await import("../src/server/licensing/artifact.ts");
const { EMPTY_LICENSE_SNAPSHOT, computeLicenseState } = await import("../src/server/licensing/state.ts");
const { forbiddenNodeOption, nodeStartProblems, readNodeStartCheck, refuseUnsafeNodeStart, splitNodeOptions } = await import(
  "../src/server/licensing/node-start.ts"
);

const segmento = (objeto) => Buffer.from(JSON.stringify(objeto), "utf8").toString("base64url");

/** A licença que quem pirateia monta: o nome da nossa raiz no certificado, mas a chave e as assinaturas são dele. */
function forjada(sobrescrever = {}) {
  const pirata = generateKeyPairSync("ed25519");
  const certificado = segmento({
    v: 1,
    use: "license",
    kid: "k",
    rid: "raiz-2026",
    publicKey: pirata.publicKey.export({ format: "jwk" }).x,
    notBefore: "2026-01-01T00:00:00Z",
    notAfter: "2028-12-01T00:00:00Z"
  });
  const licenca = segmento(
    licencaBase({
      kid: "k",
      licenseId: "lic_pirata",
      holder: { name: "Qualquer Um" },
      installation: { id: "inst_x", host: "pirata.example.com" },
      plan: { kind: "lifetime", steps: [] },
      ...sobrescrever
    })
  );
  const assinar = (contexto, parte) => sign(null, Buffer.from(`${contexto}${parte}`, "utf8"), pirata.privateKey).toString("base64url");
  return ["BKL1", certificado, assinar(CONTEXTO_CERTIFICADO, certificado), licenca, assinar(CONTEXTO_LICENCA, licenca)].join(".");
}

test("com o crypto.verify trocado por um arquivo carregado antes, a licença forjada é recusada pela conferência embutida (revisão: forge)", () => {
  // O cenário está montado: o verify do node:crypto aceita qualquer assinatura Ed25519.
  assert.equal(nodeCrypto.verify(null, Buffer.from("x"), generateKeyPairSync("ed25519").publicKey, Buffer.alloc(64)), true);

  // Antes da correção: ok: true, vitalícia com os Webinários, sem falar com o Emissor.
  assert.deepEqual(verifyLicenseToken(forjada(), RAIZES), { ok: false, error: "assinatura_do_certificado" });

  const estado = computeLicenseState({
    mode: "enforce",
    roots: RAIZES,
    snapshot: { ...EMPTY_LICENSE_SNAPSHOT, token: forjada() },
    systemNow: new Date("2026-11-11T12:00:00.000Z"),
    configuredHost: "https://pirata.example.com"
  });
  assert.equal(estado.evaluation.degree, "nao_ativada");
  assert.deepEqual(estado.evaluation.features, []);

  // A licença nossa continua conferindo: as duas conferências aceitam.
  assert.equal(verifyLicenseToken(legitima, RAIZES).ok, true);
});

test("a licença com o certificado nosso e só a assinatura da licença trocada também é recusada pela conferência embutida", () => {
  const partes = legitima.split(".");
  const conteudo = segmento({ ...licencaBase(), features: [{ key: "webinars" }, { key: "pago" }] });
  partes[3] = conteudo;
  partes[4] = Buffer.alloc(64, 7).toString("base64url");
  assert.deepEqual(verifyLicenseToken(partes.join("."), RAIZES), { ok: false, error: "assinatura_da_licenca" });
});

// ---- A subida do produto vendido -------------------------------------------------------------------------

test("as opções que carregam código, executam texto ou abrem o depurador são proibidas; as de memória, não", () => {
  for (const opcao of ["-r", "--require", "--require=/x/p.cjs", "--import", "--import=data:,x", "--loader", "--experimental-loader=./l.mjs", "--inspect", "--inspect=0.0.0.0:9229", "--inspect-brk", "--inspect-port=0", "--inspect-wait", "--debug-port=1", "-e", "--eval", "-p", "--print", "--env-file=.env", "--env-file-if-exists=.env", "--experimental-config-file=n.json", "--experimental-default-config-file", "--snapshot-blob", "--build-snapshot"]) {
    assert.notEqual(forbiddenNodeOption(opcao), null, opcao);
  }

  for (const opcao of ["--max-old-space-size=512", "--max-semi-space-size=64", "--stack-size=2000", "--enable-source-maps", "--dns-result-order=ipv4first", "server.js", "--title=escola", "--experimental-require-module"]) {
    assert.equal(forbiddenNodeOption(opcao), null, opcao);
  }

  assert.deepEqual(splitNodeOptions(' --max-old-space-size=512  --require "/x/um arquivo.cjs" --x=a\\ b '), ["--max-old-space-size=512", "--require", "/x/um arquivo.cjs", "--x=a b"]);
});

test("a linha de comando e o NODE_OPTIONS de nascença, como o /proc os guarda: cada opção proibida uma vez, sem o valor", () => {
  const cmdline = ["node", "--max-old-space-size=512", "-r", "/x/p.cjs", "--require=/y.cjs", "server.js", ""].join("\0");
  const environ = ["PATH=/usr/bin", "NODE_OPTIONS=--import /x/p.mjs --max-old-space-size=256", "HOME=/app", ""].join("\0");

  assert.deepEqual(nodeStartProblems(cmdline, environ), [
    { where: "linha_de_comando", option: "-r" },
    { where: "linha_de_comando", option: "--require" },
    { where: "NODE_OPTIONS", option: "--import" }
  ]);
  assert.deepEqual(nodeStartProblems(["node", "server.js", ""].join("\0"), ["NODE_OPTIONS=--max-old-space-size=512", ""].join("\0")), []);
  assert.deepEqual(readNodeStartCheck(() => ""), { ok: false, unreadable: true, problems: [] }, "sem /proc legível, fecha");
  assert.deepEqual(
    readNodeStartCheck(() => {
      throw new Error("ENOENT");
    }),
    { ok: false, unreadable: true, problems: [] }
  );
});

test("modo enforce: a subida com opção proibida escreve o motivo e sai; modo off nem lê o /proc", () => {
  const lidos = [];
  const logs = [];
  const saidas = [];
  const ler = (caminho) => {
    lidos.push(caminho);
    return caminho.endsWith("cmdline") ? "node\0--require\0/x/p.cjs\0server.js\0" : "NODE_OPTIONS=\0";
  };

  refuseUnsafeNodeStart({ mode: "off", read: ler, exit: (codigo) => saidas.push(codigo), log: (linha) => logs.push(linha) });
  assert.deepEqual([lidos, logs, saidas], [[], [], []], "no modo off nada é lido nem recusado");

  assert.throws(
    () => refuseUnsafeNodeStart({ mode: "enforce", read: ler, exit: (codigo) => saidas.push(codigo), log: (linha) => logs.push(linha) }),
    /nao sobe com o Node carregando arquivo antes do produto/
  );
  assert.deepEqual(saidas, [1]);
  assert.match(logs[0], /--require/);
  assert.doesNotMatch(logs[0], /\/x\/p\.cjs/, "o caminho do arquivo não vai para o log");

  refuseUnsafeNodeStart({ mode: "enforce", read: () => "node\0server.js\0", exit: () => assert.fail("subida limpa não sai") });
});

// ---- Processos de verdade --------------------------------------------------------------------------------

const pasta = mkdtempSync(join(tmpdir(), "licenca-pre-carga-"));
after(() => rmSync(pasta, { force: true, recursive: true }));

const raizDoRepositorio = fileURLToPath(new URL("../", import.meta.url));
const ganchos = pathToFileURL(join(raizDoRepositorio, "tests/support/resolve-extensionless-ts.mjs")).href;
const modulo = pathToFileURL(join(raizDoRepositorio, "src/server/licensing/node-start.ts")).href;

// O arquivo da revisão: troca o verify e limpa o próprio rastro, para quem confere no mesmo processo não ver nada.
const arquivoDaRevisao = join(pasta, "preload-patch.cjs");
writeFileSync(
  arquivoDaRevisao,
  `const crypto = require("node:crypto");
const real = crypto.verify;
crypto.verify = function (algorithm) { return algorithm === null ? true : real.apply(this, arguments); };
process.env.NODE_OPTIONS = "";
process.execArgv.length = 0;
`
);
const importado = join(pasta, "preload.mjs");
writeFileSync(importado, "export {};\n");

// O "servidor": confere a subida do jeito do instrumentation.ts (modo enforce) e diz o que viu.
const servidor = join(pasta, "servidor.mjs");
writeFileSync(
  servidor,
  `await import(${JSON.stringify(ganchos)});
const { readNodeStartCheck, refuseUnsafeNodeStart } = await import(${JSON.stringify(modulo)});
console.log(JSON.stringify({ check: readNodeStartCheck(), nodeOptions: process.env.NODE_OPTIONS ?? null, execArgv: process.execArgv }));
refuseUnsafeNodeStart({ mode: "enforce" });
console.log("subiu");
`
);

function subir(opcoesDoNode = [], nodeOptions) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  if (nodeOptions !== undefined) {
    env.NODE_OPTIONS = nodeOptions;
  }
  const resultado = spawnSync(process.execPath, [...opcoesDoNode, servidor], { cwd: pasta, encoding: "utf8", env, timeout: 30_000 });
  const [primeira] = resultado.stdout.split("\n");
  return { code: resultado.status, visto: primeira ? JSON.parse(primeira) : null, stdout: resultado.stdout, stderr: resultado.stderr };
}

test("processo de verdade: sem opção nenhuma (e com opção de memória), o produto sobe", { skip: process.platform !== "linux" && "o /proc é do Linux" }, () => {
  const limpo = subir();
  assert.equal(limpo.code, 0, limpo.stderr);
  assert.match(limpo.stdout, /subiu/);

  const memoria = subir(["--max-old-space-size=256"], "--max-semi-space-size=16");
  assert.equal(memoria.code, 0, memoria.stderr);
  assert.match(memoria.stdout, /subiu/);
});

test("processo de verdade: o NODE_OPTIONS=--require da revisão não sobe, mesmo com o arquivo limpando o process.env e o execArgv", { skip: process.platform !== "linux" && "o /proc é do Linux" }, () => {
  const pirata = subir([], `--require ${arquivoDaRevisao}`);

  assert.deepEqual([pirata.visto.nodeOptions, pirata.visto.execArgv], ["", []], "o arquivo apagou o rastro de dentro do processo");
  assert.deepEqual(pirata.visto.check, { ok: false, unreadable: false, problems: [{ where: "NODE_OPTIONS", option: "--require" }] });
  assert.equal(pirata.code, 1);
  assert.doesNotMatch(pirata.stdout, /subiu/);
  assert.match(pirata.stderr, /nao sobe com o Node carregando arquivo antes do produto[^:]*: --require \(no NODE_OPTIONS\)\./);
});

test("processo de verdade: --require, --import e o depurador na linha de comando também não sobem", { skip: process.platform !== "linux" && "o /proc é do Linux" }, () => {
  for (const [opcoes, esperado] of [
    [["--require", arquivoDaRevisao], "--require"],
    [["-r", arquivoDaRevisao], "-r"],
    [["--import", pathToFileURL(importado).href], "--import"],
    [["--inspect-port=0"], "--inspect"]
  ]) {
    const resultado = subir(opcoes);
    assert.equal(resultado.code, 1, `${opcoes.join(" ")}: ${resultado.stderr}`);
    assert.deepEqual(resultado.visto.check.problems, [{ where: "linha_de_comando", option: esperado }], opcoes.join(" "));
  }
});

test("a conferência da subida fica ligada no instrumentation.ts e na situação de cada pedido, só no Node e só no modo enforce", () => {
  const ler = (caminho) => readFileSync(join(raizDoRepositorio, caminho), "utf8");
  const instrumentacao = ler("src/instrumentation.ts");
  const doPedido = ler("src/server/licensing/current-state.ts");

  // Na subida, antes de tudo (antes até do Sentry, que sai cedo quando não está configurado).
  const subida = instrumentacao.indexOf('if (process.env.NEXT_RUNTIME === "nodejs" && licensingMode() === "enforce") {');
  assert.ok(subida >= 0);
  assert.ok(subida < instrumentacao.indexOf("if (!sentryDsn)"), "antes do retorno do Sentry");
  assert.match(
    instrumentacao.slice(subida),
    /^if \(process\.env\.NEXT_RUNTIME === "nodejs" && licensingMode\(\) === "enforce"\) \{\s*const \{ refuseUnsafeNodeStart \} = await import\("\.\/server\/licensing\/node-start"\);\s*refuseUnsafeNodeStart\(\);\s*\}/
  );

  // E no pedido: o NEXT_PHASE de build no compose pula o register() do Next.
  assert.match(doPedido, /if \(mode === "enforce" && process\.env\.NEXT_RUNTIME === "nodejs"\) \{\s*refuseUnsafeNodeStart\(\{ mode \}\);/);
});
