import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";

import { cloudDir, criarInfraDeMentira as setup, faltamBinarios, limparInfraDeMentira, serverFixture } from "./fixtures/infra-de-mentira.mjs";

// A cerimonia das chaves pelo fluxo de infra (docs/32 D41; docs/20 §8C.8): a etapa de verdade
// (infra/cloud/licencas.sh cerimonia) contra a Hetzner, o servidor, o docker do runner (a imagem do Emissor roda a
// cerimonia com um duble do codigo das chaves, tests/fixtures/emissor-chaves) e o Storage Box (uma pasta) de mentira.
// O driver de verdade (infra/cloud/cerimonia-licencas.mjs) roda dentro do docker de mentira, com o Node daqui.

after(limparInfraDeMentira);

const skip = faltamBinarios.length ? `faltam ${faltamBinarios.join(", ")}` : false;
const LICENCAS = "bunker707-licencas";
const TOKEN = "ghs_token_efemero_do_job_0001";
const PASTA = "bunker707/licencas-raizes";
const BOX = { name: "bunker707-backups", username: "u100", server: "u100.your-storagebox.de" };
const CERT_CONTEXT = "bunker-licensing/certificate/v1\n";
const mes = new Date().toISOString().slice(0, 7);

const conta = (extra = {}) => setup({ servers: [serverFixture(LICENCAS, "licencas", 7)], firewalls: [{ name: `${LICENCAS}-fw`, applied_to: [], rules: [] }], storageBox: BOX, ...extra });
const sshCmds = (calls) => calls.filter((c) => c.tool === "ssh" && !c.control);
const gravacoes = (calls) => sshCmds(calls).filter((c) => /mv -f "\$t" "\/opt\/bunker707\/emissor\/segredos\/[^"]+"/.test(c.command));
const arquivoGravado = (c) => c.command.match(/mv -f "\$t" "\/opt\/bunker707\/emissor\/segredos\/([^"]+)"/)[1];
// A senha das raizes: a mesma derivacao do HCLOUD_TOKEN que a etapa usa (deploy-key.mjs --secret).
function senhaDerivada(c) {
  const arquivo = join(c.work, "senha-derivada");
  const r = spawnSync(process.execPath, [join(cloudDir, "deploy-key.mjs"), "--secret", "--info", "bunker707-licencas-raizes-v1", "--out", arquivo], { env: c.envFor() });
  assert.equal(r.status, 0);
  return readFileSync(arquivo, "utf8").trim();
}
const rodar = (c, extra = {}) => c.runScript("licencas.sh", { CONFIRMAR: "cerimonia", GITHUB_TOKEN: TOKEN, GITHUB_ACTOR: "danilosouza-dev", ...extra }, ["cerimonia"]);
function raizesDoLog(stdout) {
  const inicio = stdout.lastIndexOf("[\n");
  return JSON.parse(stdout.slice(inicio));
}

test("cerimonia-licencas sem CONFIRMAR=cerimonia, ou com outra rotacao, recusa antes de qualquer chamada", { skip }, () => {
  const c = conta();
  const sem = c.runScript("licencas.sh", { GITHUB_TOKEN: TOKEN }, ["cerimonia"]);
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /Confirme com CONFIRMAR=cerimonia nas opcoes/);
  const raizes = rodar(c, { ROTACIONAR: "raizes" });
  assert.equal(raizes.status, 1);
  assert.match(raizes.stderr, /ROTACIONAR so aceita emissao\. Trocar as raizes e uma versao nova do produto/);
  assert.match(rodar(c, { LICENCAS_DIAS: "2000" }).stderr, /LICENCAS_DIAS precisa ser um numero de 1 a 1100/);
  assert.deepEqual(c.calls(), [], "nada chamado sem a confirmacao certa");
});

test("cerimonia-licencas: as raizes so cifradas no Storage Box, a emissao em segredos/ (1000:1000, 0400) e so as raizes publicas no log", { skip }, () => {
  const c = conta();
  const r = rodar(c);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = c.calls();

  // O log: as raizes publicas, para o infra/licencas/raizes.json, e nada privado.
  const publicas = raizesDoLog(r.stdout);
  assert.deepEqual(publicas.map((x) => x.rid), [`raiz-${mes}`, `raiz-reserva-${mes}`]);
  assert.ok(publicas.every((x) => /^[A-Za-z0-9_-]{43}$/.test(x.publicKey) && Object.keys(x).join() === "rid,publicKey"));
  assert.match(r.stdout, /Grave exatamente isto em infra\/licencas\/raizes\.json/);
  const senhaRaiz = senhaDerivada(c);
  const emissaoSenha = gravacoes(calls).find((g) => arquivoGravado(g) === "emissao-senha").stdin;
  assert.match(emissaoSenha, /^[0-9a-f]{64}$/, "a senha da emissao, sorteada, sem quebra de linha");
  const log = r.stdout + r.stderr;
  for (const segredo of ["PRIVATE KEY", senhaRaiz, emissaoSenha, TOKEN]) assert.ok(!log.includes(segredo), `nada privado no log: ${segredo.slice(0, 12)}`);

  // O Storage Box: as duas raizes, cifradas, e elas abrem com a senha derivada do token e batem com as publicas.
  const pasta = join(c.box, PASTA);
  assert.deepEqual(readdirSync(pasta).sort(), ["LEIA-ME.txt", `raiz-${mes}.pem`, `raiz-reserva-${mes}.pem`, "raizes.json"]);
  for (const { rid, publicKey } of publicas) {
    const pem = readFileSync(join(pasta, `${rid}.pem`), "utf8");
    assert.match(pem, /^-----BEGIN ENCRYPTED PRIVATE KEY-----/, `${rid} so cifrada em repouso`);
    assert.throws(() => createPrivateKey({ key: pem, format: "pem", passphrase: "outra-senha-qualquer-0001" }), `${rid} nao abre com outra senha`);
    const chave = createPrivateKey({ key: pem, format: "pem", passphrase: senhaRaiz });
    assert.equal(createPublicKey(chave).export({ format: "jwk" }).x, publicKey);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(pasta, "raizes.json"), "utf8")), publicas);
  assert.match(readFileSync(join(pasta, "LEIA-ME.txt"), "utf8"), /--secret --info bunker707-licencas-raizes-v1/);
  const sftp = calls.filter((x) => x.tool === "sftp");
  assert.ok(sftp.every((x) => x.target === "u100@u100.your-storagebox.de" && x.args.includes("-P") && x.args.includes("23")), "direto do runner para o box, na porta 23");
  assert.ok(sftp.some((x) => x.cmd === `mkdir ${PASTA}`), "a pasta e criada sem o '-': se ja existisse, o sftp pararia");
  assert.ok(sftp.some((x) => x.cmd?.startsWith(`get ${PASTA}/raiz-${mes}.pem`)), "as raizes sao lidas de volta e conferidas");

  // O servidor do Emissor: so a chave de emissao, a senha e o certificado; as raizes nunca passam por ele.
  const gravados = gravacoes(calls);
  assert.deepEqual(gravados.map(arquivoGravado), ["emissao.pem", "emissao-senha", "emissao-certificado.json"]);
  for (const g of gravados) assert.match(g.command, /umask 077; .*chown 1000:1000 "\$t" && chmod 400 "\$t" && mv -f/);
  assert.match(gravados[0].stdin, /^-----BEGIN ENCRYPTED PRIVATE KEY-----/, "a emissao vai cifrada");
  assert.equal(sshCmds(calls).filter((x) => x.stdin.includes("PRIVATE KEY")).length, 1, "so uma chave privada (a de emissao, cifrada) vai ao servidor");
  assert.ok(!sshCmds(calls).some((x) => x.command.includes(senhaRaiz) || x.command.includes(emissaoSenha) || x.stdin.includes(senhaRaiz)), "nenhuma senha em linha de comando, e a das raizes nunca vai ao servidor");

  // A imagem do Emissor roda a cerimonia sem rede, so leitura e sem privilegio; as senhas so pelo ambiente (-e NOME).
  const docker = calls.filter((x) => x.tool === "docker");
  assert.deepEqual(docker.slice(0, 3).map((x) => x.args[0]), ["login", "pull", "run"]);
  assert.ok(docker.length > 3 && docker.slice(3).every((x) => x.args[0] === "logout"), "sai do GHCR no fim");
  assert.equal(docker[0].stdin, TOKEN, "o token do job pelo stdin");
  assert.deepEqual(docker[1].args, ["pull", "--quiet", "ghcr.io/danilosouza-dev/bunker-licensing:main"]);
  const run = docker.find((x) => x.args[0] === "run").args.join(" ");
  for (const flag of ["--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--user node", "-e BUNKER_SENHA_RAIZ", "-e BUNKER_SENHA_EMISSAO"]) assert.ok(run.includes(flag), flag);
  assert.ok(!run.includes(senhaRaiz) && !run.includes(emissaoSenha) && !/BUNKER_SENHA_[A-Z]+=/.test(run), "nenhuma senha nos argumentos do docker");
  assert.match(run, /:\/cerimonia\/cerimonia\.mjs:ro ghcr\.io\/danilosouza-dev\/bunker-licensing:main node \/cerimonia\/cerimonia\.mjs$/);

  // A pasta da cerimonia no runner some no fim; a 22 fecha.
  assert.equal(existsSync(join(c.work, "bunker707-cloud", "cerimonia")), false, "nada das chaves fica no runner");
  assert.ok(!c.hz().firewalls[0].rules.some((x) => x.port === "22"), "a 22 termina fechada");
});

test("cerimonia-licencas: o certificado da emissao e assinado pela raiz principal, serve para licenca e passa na conferencia do secrets-licencas", { skip }, () => {
  const c = conta();
  const r = rodar(c);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const publicas = raizesDoLog(r.stdout);
  // A etapa so grava no servidor depois da conferencia do licencas-chave.mjs (a mesma do secrets-licencas), que recusa
  // certificado de outra raiz, de outra chave, vencido ou uma raiz no lugar da emissao.
  assert.match(r.stdout, /4\/6 Conferencia fora da imagem.*\n {2}conferidas\./);
  const ordem = c.calls().map((x) => (x.tool === "sftp" && x.cmd?.startsWith("put") ? "box" : x.tool === "ssh" && /mv -f "\$t" "[^"]*segredos\/emissao\.pem"/.test(x.command) ? "servidor" : null)).filter(Boolean);
  assert.equal(ordem[0], "box", "as raizes ficam guardadas antes de a emissao ir ao servidor");
  assert.equal(ordem.at(-1), "servidor");
  assert.equal(publicas.length, 2);
  // A raiz principal guardada no box assina um certificado que confere com a chave publica impressa no log (o ssh de
  // mentira so guarda os 80 primeiros caracteres da entrada, entao o certificado e refeito aqui com o mesmo driver).
  const driver = spawnSync(process.execPath, [join(cloudDir, "cerimonia-licencas.mjs")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, CERIMONIA_MODULOS: join(cloudDir, "../../tests/fixtures/emissor-chaves"), CERIMONIA_EXTENSAO: ".mjs", CERIMONIA_ACAO: "emissao", CERIMONIA_RID: publicas[0].rid, CERIMONIA_KID: "emissao-teste", CERIMONIA_DIAS: "400", BUNKER_SENHA_RAIZ: senhaDerivada(c), BUNKER_SENHA_EMISSAO: "senha-de-teste-0123456789" },
    input: readFileSync(join(c.box, PASTA, `${publicas[0].rid}.pem`))
  });
  assert.equal(driver.status, 0, driver.stderr);
  const { certificado } = JSON.parse(driver.stdout).emissao;
  const payload = JSON.parse(Buffer.from(certificado.certificate.segment, "base64url").toString());
  assert.equal(payload.use, "license");
  assert.equal(payload.rid, publicas[0].rid);
  const raiz = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicas[0].publicKey }, format: "jwk" });
  assert.ok(verify(null, Buffer.from(CERT_CONTEXT + certificado.certificate.segment), raiz, Buffer.from(certificado.certificate.signature, "base64url")));
});

test("cerimonia-licencas recusa rodar de novo por cima: as raizes no Storage Box, a chave no servidor ou o raizes.json no repositorio", { skip }, () => {
  const c = conta();
  assert.equal(rodar(c).status, 0);
  const antes = c.calls().length;
  const denovo = rodar(c);
  assert.equal(denovo.status, 1);
  assert.match(denovo.stderr, /As chaves ja existem: o Storage Box ja guarda raizes cifradas em bunker707\/licencas-raizes;.*ROTACIONAR=emissao/);
  const depois = c.calls().slice(antes);
  assert.ok(!depois.some((x) => x.tool === "docker" && x.args[0] === "run"), "nenhuma chave nova");
  assert.ok(!depois.some((x) => x.tool === "sftp" && /^(put|mkdir)/.test(x.cmd ?? "")), "nada muda no Storage Box");
  assert.equal(gravacoes(depois).length, 0, "nada muda no servidor");
  assert.ok(!c.hz().firewalls[0].rules.some((x) => x.port === "22"), "a 22 fecha mesmo com a recusa");

  const servidor = conta();
  const comChave = rodar(servidor, { SSH_SHIM_REPLIES: JSON.stringify([{ contem: 'emissao.pem" && echo sim', saida: "sim\n" }]) });
  assert.equal(comChave.status, 1);
  assert.match(comChave.stderr, /o servidor do Emissor ja tem a chave de emissao;/);

  const repo = conta();
  writeFileSync(repo.raizesArquivo, JSON.stringify([{ rid: "raiz-2026-11", publicKey: "A".repeat(43) }]));
  const comArquivo = rodar(repo);
  assert.equal(comArquivo.status, 1);
  assert.match(comArquivo.stderr, /infra\/licencas\/raizes\.json ja traz raizes publicas;/);
  assert.equal(readdirSync(repo.box).length, 0, "o box fica vazio");
});

test("cerimonia-licencas com ROTACIONAR=emissao: so uma chave de emissao nova, assinada pela raiz do Storage Box, que fica igual", { skip }, () => {
  const c = conta();
  const primeira = rodar(c);
  assert.equal(primeira.status, 0, primeira.stderr);
  const pasta = join(c.box, PASTA);
  const antes = Object.fromEntries(readdirSync(pasta).map((f) => [f, readFileSync(join(pasta, f), "utf8")]));
  const n = c.calls().length;
  const atual = JSON.stringify({ kid: `emissao-${mes}`, rid: `raiz-${mes}`, certificate: { segment: "x", signature: "y" } });
  const troca = rodar(c, { ROTACIONAR: "emissao", SSH_SHIM_REPLIES: JSON.stringify([{ contem: 'emissao.pem" && echo sim', saida: "sim\n" }, { contem: "emissao-certificado.json' 2>/dev/null", saida: atual }]) });
  assert.equal(troca.status, 0, troca.stdout + troca.stderr);
  const depois = c.calls().slice(n);
  assert.deepEqual(Object.fromEntries(readdirSync(pasta).map((f) => [f, readFileSync(join(pasta, f), "utf8")])), antes, "as raizes no box nao mudam");
  assert.ok(!depois.some((x) => x.tool === "sftp" && /^(put|mkdir)/.test(x.cmd ?? "")));
  assert.ok(depois.some((x) => x.tool === "sftp" && x.cmd?.startsWith(`get ${PASTA}/raiz-${mes}.pem`)), "a raiz principal e baixada, cifrada");
  assert.deepEqual(gravacoes(depois).map(arquivoGravado), ["emissao.pem", "emissao-senha", "emissao-certificado.json"]);
  const kid = `emissao-${new Date().toISOString().slice(0, 10)}`;
  assert.match(troca.stdout, new RegExp(`Chave de emissao trocada: ${kid} \\(a anterior era emissao-${mes}\\)`));
  assert.match(troca.stdout, new RegExp(`LICENCAS_EMISSOR_KIDS_ANTERIORES=emissao-${mes}`));
  assert.doesNotMatch(troca.stdout, /Grave exatamente isto/, "a troca nao imprime raiz nenhuma");
  assert.ok(!(troca.stdout + troca.stderr).includes("PRIVATE KEY"));

  // Sem as raizes no box nao ha como assinar: nada e criado.
  const vazio = conta();
  const semRaiz = rodar(vazio, { ROTACIONAR: "emissao" });
  assert.equal(semRaiz.status, 1);
  assert.match(semRaiz.stderr, /ROTACIONAR=emissao assina a chave nova com a raiz guardada no Storage Box .* e ela nao esta la/);
  assert.ok(!vazio.calls().some((x) => x.tool === "docker" && x.args[0] !== "logout"), "a imagem nem e puxada");

  // O token trocado desde a cerimonia: a senha derivada nao abre a raiz, e nada muda no servidor.
  const n2 = c.calls().length;
  const outroToken = rodar(c, { ROTACIONAR: "emissao", HCLOUD_TOKEN: "outro-token-de-teste-com-mais-de-32-caracteres", SSH_SHIM_REPLIES: JSON.stringify([{ contem: "emissao-certificado.json' 2>/dev/null", saida: atual }]) });
  assert.equal(outroToken.status, 1);
  assert.match(outroToken.stderr, /nao abre com a senha derivada do HCLOUD_TOKEN/);
  assert.equal(gravacoes(c.calls().slice(n2)).length, 0);
});

test("cerimonia-licencas: o Storage Box que nao responde e a imagem que nao vem param antes de qualquer chave", { skip }, () => {
  const semBox = conta();
  const r = rodar(semBox, { SHIM_SFTP_FALHA: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /O Storage Box bunker707-backups nao respondeu ao SFTP do runner/);
  assert.ok(!semBox.calls().some((x) => (x.tool === "docker" && x.args[0] !== "logout") || (x.tool === "ssh" && !x.control)), "nem imagem, nem servidor");

  const semImagem = conta();
  const g = rodar(semImagem, { SHIM_DOCKER_PULL_FALHA: "1" });
  assert.equal(g.status, 1);
  assert.match(g.stderr, /Nao consegui puxar ghcr\.io\/danilosouza-dev\/bunker-licensing:main\. .*Manage Actions access/);
  assert.equal(readdirSync(semImagem.box).length, 0);
  assert.equal(gravacoes(semImagem.calls()).length, 0);
  assert.ok(!semImagem.hz().firewalls[0].rules.some((x) => x.port === "22"));
});
