import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, createPublicKey } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { conferirImagem } from "../infra/kit/conferir-imagem.mjs";
import { arquivosDaLista } from "../infra/kit/montar-pacote.mjs";
import { chavePublicavelDaEscola, EMISSOR_URL } from "../infra/kit/pacote-escola.mjs";

// O pacote de uma escola do lote fundador (docs/32 §11.5; docs/20 §9D.6): os valores publicos que o workflow
// pacote-escola.yml grava na imagem (infra/kit/pacote-escola.mjs), a chave publicavel que o instalador poe no arquivo de
// segredos (generate-secrets.mjs --publishable-key), as guardas da imagem (infra/kit/conferir-imagem.mjs) e o proprio
// workflow. O instalador com o pacote de um fundador esta em tests/kit-instalar.test.mjs.

const raiz = fileURLToPath(new URL("..", import.meta.url));
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const pasta = () => {
  const d = mkdtempSync(join(tmpdir(), "pacote-escola-"));
  dirs.push(d);
  return d;
};
const publica = () => createPublicKey(generateKeyPairSync("ed25519").privateKey).export({ format: "jwk" }).x;
const RAIZES = [{ rid: "raiz-2026-11", publicKey: publica() }, { rid: "raiz-reserva-2026-11", publicKey: publica() }];
const ESCOLA = "escola-teste.bunker707.com.br";

function valores(args, raizes = RAIZES) {
  const d = pasta();
  const arquivo = join(d, "raizes.json");
  if (raizes !== null) writeFileSync(arquivo, typeof raizes === "string" ? raizes : JSON.stringify(raizes, null, 2));
  const r = spawnSync(process.execPath, [join(raiz, "infra/kit/pacote-escola.mjs"), ...args, "--raizes", arquivo], { encoding: "utf8" });
  return { ...r, valores: Object.fromEntries(r.stdout.trim().split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) };
}

test("pacote-escola.mjs: os valores publicos da escola, a chave publicavel derivada do endereco e as raizes da cerimonia", () => {
  const r = valores(["--endereco", "https://Escola-Teste.Bunker707.com.br/", "--versao", "1.0.0-ensaio.1"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.valores, {
    endereco: ESCOLA,
    endereco_api: `api.${ESCOLA}`,
    site_url: `https://${ESCOLA}`,
    supabase_url: `https://api.${ESCOLA}`,
    chave_publicavel: chavePublicavelDaEscola(ESCOLA),
    raizes: JSON.stringify(RAIZES),
    emissor_url: "https://licencas-api.bunker707.com.br",
    versao: "1.0.0-ensaio.1",
    tag: "membros/app:1.0.0-ensaio.1",
    artefato: `pacote-${ESCOLA}-1.0.0-ensaio.1`
  });
  assert.equal(EMISSOR_URL, "https://licencas-api.bunker707.com.br");
  // A chave: o formato das chaves opacas do Supabase self-hosted, com o resumo certo; a mesma em toda versao da escola,
  // outra para outra escola.
  const chave = r.valores.chave_publicavel;
  const [, meio, resumo] = /^(sb_publishable_[A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{8})$/.exec(chave);
  assert.equal(createHash("sha256").update(`supabase-self-hosted|${meio}`).digest("base64url").slice(0, 8), resumo);
  assert.equal(valores(["--endereco", ESCOLA, "--versao", "2.0.0"]).valores.chave_publicavel, chave);
  assert.notEqual(chavePublicavelDaEscola("alunos.outra.com.br"), chave);
  assert.equal(valores(["--endereco", ESCOLA, "--endereco-api", "api2.escola.com.br", "--versao", "1.0.0"]).valores.supabase_url, "https://api2.escola.com.br");

  for (const [args, raizes, mensagem] of [
    [["--endereco", "escola", "--versao", "1.0.0"], RAIZES, /--endereco precisa ser o endereco da escola/],
    [["--endereco", "a b.com.br", "--versao", "1.0.0"], RAIZES, /--endereco precisa ser/],
    [["--endereco", ESCOLA, "--versao", "1.0"], RAIZES, /--versao precisa ser como 1\.0\.0/],
    [["--endereco", ESCOLA, "--endereco-api", ESCOLA, "--versao", "1.0.0"], RAIZES, /--endereco-api precisa ser outro nome/],
    [["--endereco", ESCOLA, "--versao", "1.0.0"], null, /rode a etapa cerimonia-licencas e grave, num commit, as raizes publicas/],
    [["--endereco", ESCOLA, "--versao", "1.0.0"], "[]", /lista de 1 a 4 raizes publicas/],
    [["--endereco", ESCOLA, "--versao", "1.0.0"], [{ rid: "raiz", publicKey: "curta" }], /lista de 1 a 4 raizes publicas/],
    [["--endereco", ESCOLA, "--versao", "1.0.0"], [{ ...RAIZES[0], pem: "x" }], /so com rid e publicKey/]
  ]) {
    const recusa = valores(args, raizes);
    assert.equal(recusa.status, 1, args.join(" "));
    assert.match(recusa.stderr, mensagem);
  }
});

test("generate-secrets.mjs --publishable-key: o arquivo de segredos usa a chave da imagem; a chave com o resumo errado e recusada", () => {
  const d = pasta();
  for (const f of ["generate-secrets.mjs", ".env.example"]) copyFileSync(join(raiz, "infra/compose", f), join(d, f));
  const gerar = (...extra) => spawnSync(process.execPath, [join(d, "generate-secrets.mjs"), "--kit", "--domain", ESCOLA, "--api-domain", `api.${ESCOLA}`, "--email", "dono@escola.test", ...extra], { encoding: "utf8" });
  const chave = chavePublicavelDaEscola(ESCOLA);
  const ok = gerar("--publishable-key", chave);
  assert.equal(ok.status, 0, ok.stderr);
  const env = readFileSync(join(d, ".env"), "utf8");
  assert.match(env, new RegExp(`^SUPABASE_PUBLISHABLE_KEY=${chave}$`, "m"));
  assert.match(env, /^JWT_SECRET=.{40,}$/m, "o segredo JWT nasce aqui");
  rmSync(join(d, ".env"));
  const sem = gerar();
  assert.equal(sem.status, 0);
  assert.doesNotMatch(readFileSync(join(d, ".env"), "utf8"), new RegExp(chave), "sem a opcao, uma chave sorteada");
  rmSync(join(d, ".env"));
  const errada = gerar("--publishable-key", `${chave.slice(0, -1)}${chave.endsWith("A") ? "B" : "A"}`);
  assert.equal(errada.status, 2);
  assert.match(errada.stderr, /--publishable-key nao e uma chave publicavel valida/);
  const semKit = spawnSync(process.execPath, [join(d, "generate-secrets.mjs"), "--local", "--publishable-key", chave], { encoding: "utf8" });
  assert.equal(semKit.status, 2);
  assert.match(semKit.stderr, /--publishable-key so vale com --kit/);
});

test("montar-pacote.mjs: o manifesto do fundador traz os dois enderecos e a chave publicavel; o que e so do CI fica fora do pacote", () => {
  const d = pasta();
  const imagem = join(d, "app.tar");
  const config = "a".repeat(64);
  mkdirSync(join(d, "img"));
  writeFileSync(join(d, "img", "manifest.json"), JSON.stringify([{ Config: `blobs/sha256/${config}`, RepoTags: ["membros/app:1.0.0"], Layers: [] }]));
  spawnSync("tar", ["-cf", imagem, "-C", join(d, "img"), "manifest.json"]);
  const montar = (...extra) => spawnSync(process.execPath, [join(raiz, "infra/kit/montar-pacote.mjs"), "--versao", "1.0.0", "--app", imagem, "--saida", join(d, `p-${Math.random()}`), "--commit", "teste", ...extra], { encoding: "utf8" });
  const chave = chavePublicavelDaEscola(ESCOLA);
  const saida = join(d, "fundador");
  const ok = spawnSync(process.execPath, [join(raiz, "infra/kit/montar-pacote.mjs"), "--versao", "1.0.0", "--app", imagem, "--saida", saida, "--commit", "teste", "--instalacao", ESCOLA, "--instalacao-api", `api.${ESCOLA}`, "--chave-publicavel", chave], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const manifesto = JSON.parse(readFileSync(join(saida, "MANIFESTO.json"), "utf8"));
  assert.equal(manifesto.instalacao, ESCOLA);
  assert.equal(manifesto.instalacao_api, `api.${ESCOLA}`);
  assert.equal(manifesto.chave_publicavel, chave);
  assert.deepEqual(manifesto.imagens.map((i) => i.tags), [["membros/app:1.0.0"]]);
  assert.match(montar("--chave-publicavel", chave).stderr, /junto com --instalacao/);
  assert.match(montar("--instalacao", ESCOLA, "--chave-publicavel", "sb_publishable_curta").stderr, /--chave-publicavel e a chave publicavel/);
  const lista = arquivosDaLista();
  for (const soDoCi of ["infra/kit/pacote-escola.mjs", "infra/kit/conferir-imagem.mjs", "infra/kit/montar-pacote.mjs"]) assert.ok(!lista.includes(soDoCi), `${soDoCi} nao vai ao comprador`);
});

// Uma pasta /app de mentira, como o standalone do Next: o servidor, o navegador e o public.
function appDeMentira({ servidor = "", navegador = "", extra = {} } = {}) {
  const d = pasta();
  const app = join(d, "app");
  for (const p of [".next/server/app", ".next/static/chunks", "public"]) mkdirSync(join(app, p), { recursive: true });
  writeFileSync(join(app, "server.js"), "require('next')\n");
  writeFileSync(join(app, ".next/server/app/licenca.js"), servidor);
  writeFileSync(join(app, ".next/static/chunks/main.js"), navegador);
  for (const [caminho, conteudo] of Object.entries(extra)) {
    mkdirSync(join(app, caminho, ".."), { recursive: true });
    writeFileSync(join(app, caminho), conteudo);
  }
  return app;
}
const SITE = `https://${ESCOLA}`;
const API = `https://api.${ESCOLA}`;
const CHAVE = chavePublicavelDaEscola(ESCOLA);
const BOA = {
  servidor: `const m="enforce",r=${JSON.stringify(JSON.stringify(RAIZES))},e="${EMISSOR_URL}",s="${SITE}";`,
  navegador: `const u="${API}",k="${CHAVE}";`
};
const conferir = (app, proibidos = []) => conferirImagem({ pasta: app, raizes: RAIZES, emissor: EMISSOR_URL, site: SITE, api: API, chave: CHAVE, proibidos });

test("conferir-imagem.mjs: a imagem com a licenca e os valores da escola gravados passa; cada falta ou chave nossa para o pacote", () => {
  const boa = conferir(appDeMentira(BOA), ["phc_nossachavedoposthogdeproducao1234"]);
  assert.deepEqual(boa.problemas, []);
  assert.deepEqual(boa.avisos, [], "o endereco do Emissor e os da escola do ensaio (na nossa zona) sao esperados");

  const casos = [
    [{ ...BOA, servidor: "process.env.BUNKER_LICENSING_MODE" + BOA.servidor }, [], /ainda le process\.env\.BUNKER_LICENSING_\*/],
    [{ ...BOA, servidor: BOA.servidor.replace(RAIZES[1].publicKey, "") }, [], /a raiz raiz-reserva-2026-11 nao esta gravada/],
    [{ ...BOA, servidor: BOA.servidor.replace(EMISSOR_URL, "") }, [], /o endereco do Emissor .* nao esta gravado/],
    [{ ...BOA, servidor: BOA.servidor.replace(SITE, "") }, [], /o endereco da escola .* nao esta gravado no codigo do servidor/],
    [{ ...BOA, navegador: BOA.navegador.replace(API, "") }, [], /o endereco da API .* nao esta no codigo do navegador/],
    [{ ...BOA, navegador: BOA.navegador.replace(CHAVE, "") }, [], /a chave publicavel da escola nao esta no codigo do navegador/],
    [{ ...BOA, navegador: BOA.navegador + 'posthog.init("phc_nossachavedoposthogdeproducao1234")' }, ["phc_nossachavedoposthogdeproducao1234"], /uma chave nossa de analise ou de erros esta na imagem \(\.next\/static\/chunks\/main\.js\)/],
    [{ ...BOA, navegador: BOA.navegador + 'k="phc_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"' }, [], /uma chave do PostHog \(phc_\.\.\.\) na imagem/],
    [{ ...BOA, extra: { ".next/server/sentry.js": 'dsn:"https://0123456789abcdef0123456789abcdef@o123456.ingest.us.sentry.io/4505"' } }, [], /um DSN do Sentry na imagem/],
    [{ ...BOA, extra: { "src/app/page.tsx": "export default 1" } }, [], /a imagem leva a pasta src\//],
    [{ ...BOA, extra: { ".next/static/chunks/main.js.map": '{"version":3,"sourcesContent":["codigo"]}' } }, [], /mapa de fonte com o codigo original/]
  ];
  for (const [app, proibidos, mensagem] of casos) {
    const { problemas } = conferir(appDeMentira(app), proibidos);
    assert.ok(problemas.some((p) => mensagem.test(p)), `${mensagem}: ${problemas.join(" | ")}`);
  }
  assert.match(conferir(pasta()).problemas[0], /nao e a pasta \/app de uma imagem do app/);

  // O que ainda cita o nosso dominio: so um aviso, com os arquivos.
  const marca = conferir(appDeMentira({ ...BOA, extra: { "public/termos.html": "contato@bunker707.com.br e https://meet.bunker707.com.br" } }));
  assert.deepEqual(marca.problemas, []);
  assert.match(marca.avisos[0], /ainda citam bunker707\.com\.br \(fora o Emissor, licencas-api\.bunker707\.com\.br, e a propria escola\): 1 arquivo\(s\): public\/termos\.html \(2\)/);

  // Pela linha de comando, como o workflow chama: sai 0 com a imagem boa e 1 com a ruim.
  const cli = (app) => spawnSync(process.execPath, [join(raiz, "infra/kit/conferir-imagem.mjs"), "--pasta", app, "--raizes", JSON.stringify(RAIZES), "--emissor", EMISSOR_URL, "--site", SITE, "--api", API, "--chave", CHAVE, "--proibido", "", "--proibido", "curta"], { encoding: "utf8" });
  const ok = cli(appDeMentira(BOA));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Imagem conferida: licenca gravada \(enforce, 2 raizes/);
  const ruim = cli(appDeMentira({ ...BOA, servidor: "" }));
  assert.equal(ruim.status, 1);
  assert.match(ruim.stderr, /a imagem nao serve para a escola/);
});

test("o workflow pacote-escola: so da main, as entradas so por ambiente, a imagem com a licenca exigida e sem as nossas chaves, as guardas e o artefato privado", () => {
  const wf = readFileSync(join(raiz, ".github/workflows/pacote-escola.yml"), "utf8");
  assert.match(wf, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}endereco:/m);
  assert.match(wf, /^permissions: \{\}$/m, "nada no nivel do workflow");
  assert.match(wf, /^ {4}permissions:\n {6}contents: read$/m, "o job so le o repositorio");
  const trava = wf.match(/- name: Pacote so da main\n\s+run: \|\n\s+(.+)\n/)[1];
  assert.equal(spawnSync("bash", ["-e", "-c", trava], { env: { ...process.env, GITHUB_REF: "refs/heads/main" } }).status, 0);
  const dev = spawnSync("bash", ["-e", "-c", trava], { encoding: "utf8", env: { ...process.env, GITHUB_REF: "refs/heads/dev" } });
  assert.equal(dev.status, 1);
  assert.match(dev.stdout, /::error::O pacote da escola so sai da main/);
  // As entradas nunca interpoladas num script: so em env.
  for (const linha of wf.split("\n").filter((l) => l.includes("${{ inputs."))) {
    assert.match(linha, /^\s+(ENDERECO|ENDERECO_API|VERSAO): \$\{\{ inputs\.[a-z_]+ \}\}$|^\s+name: Pacote de/, `entrada fora do env: ${linha.trim()}`);
  }
  const build = wf.slice(wf.indexOf("- name: Imagem da escola"), wf.indexOf("- name: Guardas da imagem"));
  for (const arg of ["BUNKER_LICENSING_MODE=enforce", 'BUNKER_LICENSING_ROOTS="$RAIZES"', 'BUNKER_LICENSING_EMISSOR_URL="$EMISSOR_URL"', 'NEXT_PUBLIC_SITE_URL="$SITE_URL"', 'NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL"', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$CHAVE_PUBLICAVEL"']) {
    assert.ok(build.includes(`--build-arg ${arg}`), arg);
  }
  assert.doesNotMatch(build, /POSTHOG|SENTRY/, "a imagem do comprador sai sem as nossas chaves");
  const guardas = wf.slice(wf.indexOf("- name: Guardas da imagem"), wf.indexOf("- name: Pacote da versao"));
  assert.match(guardas, /node infra\/kit\/conferir-imagem\.mjs --pasta "\$d\/app"/);
  assert.match(guardas, /--proibido "\$NOSSO_POSTHOG" --proibido "\$NOSSO_SENTRY"/);
  assert.ok(wf.indexOf("- name: Guardas da imagem") < wf.indexOf("- name: Pacote da versao"), "as guardas antes do pacote");
  assert.match(wf, /node infra\/kit\/montar-pacote\.mjs .*\n\s+--instalacao "\$ESCOLA" --instalacao-api "\$API" --chave-publicavel "\$CHAVE_PUBLICAVEL"/);
  const upload = wf.slice(wf.indexOf("- name: Guardar o pacote"));
  assert.match(upload, /uses: actions\/upload-artifact@/);
  assert.match(upload, /retention-days: 7/);
  assert.doesNotMatch(wf, /secrets\./, "nenhum segredo neste workflow");
});
