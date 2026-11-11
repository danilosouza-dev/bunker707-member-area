import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// O build da imagem vendida (docs/32 §11.3, "O produto vendido sempre exige licença"; revisão de 11/11/2026): o modo, as
// raízes e o endereço do Emissor entram no código gerado pela chave `env` do next.config.ts. Antes, o build falhava
// aberto: o Dockerfile não passava as variáveis para o estágio do build (a imagem saía "off" em silêncio), um erro de
// digitação no modo virava "off", e "enforce" sem raízes ou sem o Emissor gerava uma imagem que nunca ativa. Aqui o
// next.config.ts de verdade é carregado num processo com as variáveis de cada caso.

const raizDoRepositorio = fileURLToPath(new URL("../", import.meta.url));
const pasta = mkdtempSync(join(tmpdir(), "licenca-build-"));
after(() => rmSync(pasta, { force: true, recursive: true }));

// O next.config.ts e os arquivos que ele importa sem extensão, como o Next os carrega.
const carregador = join(pasta, "carregar-config.mjs");
writeFileSync(
  carregador,
  `import { registerHooks } from "node:module";
const raiz = ${JSON.stringify(pathToFileURL(raizDoRepositorio).href)};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((context.parentURL ?? "").startsWith(raiz) && /^\\.{1,2}\\//.test(specifier) && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  }
});
const { default: config } = await import(${JSON.stringify(pathToFileURL(join(raizDoRepositorio, "next.config.ts")).href)});
console.log(JSON.stringify(config.env));
`
);

/** O `env` do next.config.ts com estas variáveis no build; ou o erro, quando o build tem de parar. */
function configDoBuild(variaveis) {
  const env = { ...process.env };
  for (const nome of ["BUNKER_LICENSING_MODE", "BUNKER_LICENSING_ROOTS", "BUNKER_LICENSING_EMISSOR_URL"]) {
    delete env[nome];
  }
  const resultado = spawnSync(process.execPath, [carregador], { cwd: raizDoRepositorio, encoding: "utf8", env: { ...env, ...variaveis }, timeout: 60_000 });
  return resultado.status === 0 ? { env: JSON.parse(resultado.stdout.trim().split("\n").at(-1)) } : { erro: resultado.stderr };
}

const chave = () => generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x;
const RAIZES = JSON.stringify([
  { rid: "raiz-2026", publicKey: chave() },
  { rid: "raiz-reserva", publicKey: chave() }
]);
const EMISSOR = "https://licencas-api.bunker707.com.br";

test("sem as variáveis (a nossa escola, a dev, a Vercel e os testes), o build sai como antes: off, sem raízes e sem Emissor", () => {
  assert.deepEqual(configDoBuild({}).env, { BUNKER_LICENSING_MODE: "off", BUNKER_LICENSING_ROOTS: "", BUNKER_LICENSING_EMISSOR_URL: "" });
  // O Dockerfile declara as variáveis vazias quando o build não as recebe: vazio também é off.
  assert.deepEqual(configDoBuild({ BUNKER_LICENSING_MODE: "", BUNKER_LICENSING_ROOTS: "", BUNKER_LICENSING_EMISSOR_URL: "" }).env, {
    BUNKER_LICENSING_MODE: "off",
    BUNKER_LICENSING_ROOTS: "",
    BUNKER_LICENSING_EMISSOR_URL: ""
  });
  assert.equal(configDoBuild({ BUNKER_LICENSING_MODE: "off" }).env.BUNKER_LICENSING_MODE, "off");
});

test("o build com enforce grava no código o modo, as raízes e o endereço do Emissor recebidos", () => {
  assert.deepEqual(configDoBuild({ BUNKER_LICENSING_MODE: "enforce", BUNKER_LICENSING_ROOTS: RAIZES, BUNKER_LICENSING_EMISSOR_URL: EMISSOR }).env, {
    BUNKER_LICENSING_MODE: "enforce",
    BUNKER_LICENSING_ROOTS: RAIZES,
    BUNKER_LICENSING_EMISSOR_URL: EMISSOR
  });
});

test("o build para (em vez de sair off em silêncio) com o modo digitado errado (revisão: build que falha aberto)", () => {
  for (const modo of ["Enforce", "enforced", "on", "true", "1", " enforce", "enforce "]) {
    const { erro } = configDoBuild({ BUNKER_LICENSING_MODE: modo, BUNKER_LICENSING_ROOTS: RAIZES, BUNKER_LICENSING_EMISSOR_URL: EMISSOR });
    assert.match(erro ?? "", /BUNKER_LICENSING_MODE/, JSON.stringify(modo));
  }
});

test("o build com enforce para sem raízes válidas ou sem o Emissor em https", () => {
  const casos = [
    [{ BUNKER_LICENSING_EMISSOR_URL: EMISSOR }, /BUNKER_LICENSING_ROOTS/],
    [{ BUNKER_LICENSING_ROOTS: "", BUNKER_LICENSING_EMISSOR_URL: EMISSOR }, /BUNKER_LICENSING_ROOTS/],
    [{ BUNKER_LICENSING_ROOTS: "[]", BUNKER_LICENSING_EMISSOR_URL: EMISSOR }, /BUNKER_LICENSING_ROOTS/],
    [{ BUNKER_LICENSING_ROOTS: "raiz-2026", BUNKER_LICENSING_EMISSOR_URL: EMISSOR }, /BUNKER_LICENSING_ROOTS/],
    // Uma raiz boa e uma estragada: a estragada não pode sumir em silêncio (a de reserva não serviria na hora de usar).
    [{ BUNKER_LICENSING_ROOTS: JSON.stringify([{ rid: "raiz-2026", publicKey: chave() }, { rid: "raiz-reserva", publicKey: "curta" }]), BUNKER_LICENSING_EMISSOR_URL: EMISSOR }, /BUNKER_LICENSING_ROOTS/],
    [{ BUNKER_LICENSING_ROOTS: RAIZES }, /BUNKER_LICENSING_EMISSOR_URL/],
    [{ BUNKER_LICENSING_ROOTS: RAIZES, BUNKER_LICENSING_EMISSOR_URL: "http://licencas-api.bunker707.com.br" }, /BUNKER_LICENSING_EMISSOR_URL/],
    [{ BUNKER_LICENSING_ROOTS: RAIZES, BUNKER_LICENSING_EMISSOR_URL: "http://127.0.0.1:8080" }, /BUNKER_LICENSING_EMISSOR_URL/]
  ];

  for (const [variaveis, esperado] of casos) {
    const { erro } = configDoBuild({ BUNKER_LICENSING_MODE: "enforce", ...variaveis });
    assert.match(erro ?? "", esperado, JSON.stringify(variaveis));
  }
});

test("o estágio do build do Dockerfile recebe as três variáveis da licença (ARG e ENV), sem levá-las à imagem que roda", () => {
  const dockerfile = readFileSync(join(raizDoRepositorio, "Dockerfile"), "utf8");
  const estagio = (nome) => dockerfile.slice(dockerfile.indexOf(`AS ${nome}`)).split(/\nFROM /)[0];
  const build = estagio("build");
  const runner = estagio("runner");

  for (const nome of ["BUNKER_LICENSING_MODE", "BUNKER_LICENSING_ROOTS", "BUNKER_LICENSING_EMISSOR_URL"]) {
    assert.match(build, new RegExp(`^ARG ${nome}$`, "m"), `ARG ${nome}`);
    assert.match(build, new RegExp(`\\b${nome}="\\$\\{${nome}\\}"`), `ENV ${nome}`);
    assert.doesNotMatch(runner, new RegExp(nome), `${nome} não vai para a imagem que roda`);
  }

  assert.ok(build.indexOf("ARG BUNKER_LICENSING_MODE") < build.indexOf("RUN npm run build"), "antes do build");
});
