import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { cloudDir, criarInfraDeMentira as setup, faltamBinarios, hzCall, limparInfraDeMentira, record, serverFixture } from "./fixtures/infra-de-mentira.mjs";

// O ensaio de comprador real (docs/32 item 13; docs/20 §9E): as etapas de verdade (infra/cloud/teste.sh, pelo run.sh e
// pelo workflow) contra a Hetzner, a Cloudflare, o GitHub (os artefatos) e os servidores de mentira de
// tests/fixtures/infra-de-mentira.mjs. Nada fala com a rede. O instalador que roda no servidor tem os testes dele
// (tests/kit-instalar.test.mjs).

const dirs = [];
after(() => {
  limparInfraDeMentira();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const skip = faltamBinarios.length ? `faltam ${faltamBinarios.join(", ")}` : false;
const root = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(join(root, ".github/workflows/infra.yml"), "utf8");
const TESTE = "bunker707-teste";
const ESCOLA = "escola-teste.bunker707.com.br";
const API = `api.${ESCOLA}`;
const CHAVE = "BKA1-chave-de-ativacao-de-teste-0001";
const preco = (location, net) => ({ location, price_monthly: { net: String(net) }, price_hourly: { net: (net / 720).toFixed(4) } });
const TIPOS = {
  // O mais barato de todos tem 2 GB e e ARM: nao serve ao kit (4 GB, x86).
  cax11: { cores: 2, memory: 4, disk: 40, cpu_type: "shared", architecture: "arm", deprecated: false, prices: [preco("fsn1", 3.49)], locations: [{ name: "fsn1", available: true }] },
  cpx12: { cores: 1, memory: 2, disk: 40, cpu_type: "shared", architecture: "x86", deprecated: false, prices: [preco("fsn1", 3.29)], locations: [{ name: "fsn1", available: true }] },
  cx23: { cores: 2, memory: 4, disk: 40, cpu_type: "shared", architecture: "x86", deprecated: false, prices: [preco("fsn1", 3.79), preco("nbg1", 3.79)], locations: [{ name: "fsn1", available: true }, { name: "nbg1", available: true }] },
  cx33: { cores: 4, memory: 8, disk: 80, cpu_type: "shared", architecture: "x86", deprecated: false, prices: [preco("fsn1", 6.49)], locations: [{ name: "fsn1", available: true }] }
};
const servidorTeste = (labels = { app: "bunker707", papel: "teste" }) => serverFixture(TESTE, "teste", 9, { labels });
const sshCmds = (calls) => calls.filter((c) => c.tool === "ssh" && !c.control);
const comando = (calls, trecho) => sshCmds(calls).find((c) => c.command.includes(trecho));

test("teste-plano: o mais barato que serve ao kit (x86, 2 vCPU, 4 GB, 40 GB), com o preco por hora; nada criado", { skip }, () => {
  const conta = setup({ tipos: TIPOS });
  const r = conta.runScript("teste.sh", {}, ["plano"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Tipos que servem para a escola do ensaio \(o minimo do kit, so x86\) \(minimo 4 GB de memoria, 40 GB de disco e 2 vCPU; x86\)/);
  assert.match(r.stdout, /teste: cx23 em fsn1 \(2 vCPU x86, 4 GB, 40 GB disco\) por EUR 3\.79\/mes sem IVA/);
  assert.match(r.stdout, /Por hora: EUR 0\.0053 sem IVA \(a Hetzner cobra por hora, ate o teto do mes/);
  assert.match(r.stdout, /Fora \(abaixo do minimo ou de outra arquitetura\): cax11, cpx12/);
  assert.equal(conta.hz().servers.length, 0);
});

test("teste-criar: sem CONFIRMADO=sim recusa; com ele, Ubuntu 24.04 vazio, sem cloud-init nosso, marca papel=teste e firewall proprio", { skip }, () => {
  const sem = setup({ tipos: TIPOS });
  const recusa = sem.runScript("teste.sh", {}, ["criar"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /teste-criar cria o servidor do ensaio, bunker707-teste \(cobrado por hora enquanto existir/);
  assert.deepEqual(sem.calls(), []);

  const caro = setup({ tipos: TIPOS });
  const passou = caro.runScript("teste.sh", { CONFIRMADO: "sim", TESTE_PRECO_MAX: "3.00" }, ["criar"]);
  assert.equal(passou.status, 1);
  assert.match(passou.stderr, /passa do TESTE_PRECO_MAX=3\.00 aprovado pelo produtor\. Nada foi criado/);
  assert.equal(hzCall(caro.calls(), "server create"), -1);

  const conta = setup({ tipos: TIPOS, unavailable: ["cx23@fsn1"] });
  const r = conta.runScript("teste.sh", { CONFIRMADO: "sim", TESTE_PRECO_MAX: "3.79" }, ["criar"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const criado = conta.hz().servers.find((s) => s.name === TESTE);
  assert.ok(criado);
  assert.deepEqual([criado.server_type.name, criado.location.name, criado.image], ["cx23", "nbg1", "ubuntu-24.04"], "sem estoque em fsn1, o mesmo tipo e preco em nbg1");
  assert.deepEqual(criado.labels, { app: "bunker707", papel: "teste" });
  const create = conta.calls().filter((c) => c.tool === "hcloud" && c.args[0] === "server" && c.args[1] === "create").at(-1).args;
  assert.ok(!create.some((a) => a.includes("user-data")), "sem cloud-init nosso: o servidor nasce como o de um comprador");
  assert.equal(create[create.indexOf("--ssh-key") + 1], "bunker707-deploy");
  const fw = conta.hz().firewalls.find((f) => f.name === `${TESTE}-fw`);
  assert.ok(fw.applied_to.some((a) => a.server.id === criado.id));
  assert.deepEqual(fw.rules.map((x) => `${x.protocol}/${x.port ?? "-"}`), ["tcp/80", "tcp/443", "udp/443", "icmp/-"], "a 22 termina fechada");
  assert.ok(sshCmds(conta.calls()).some((c) => c.target === `root@${criado.public_net.ipv4.ip}` && c.command.includes("cloud-init status --wait")), "o root responde");
  assert.match(r.stdout, /Servidor do ensaio no ar: bunker707-teste, 198\.51\.100\.\d+ \(EUR 0\.0053\/hora, teto de EUR 3\.79\/mes/);
});

test("teste-dns: escola-teste e api.escola-teste so com registro A, sem proxy; AAAA sai; o resto da zona fica", { skip }, () => {
  const conta = setup({ servers: [servidorTeste()], firewalls: [], records: [record(ESCOLA, "AAAA", "2001:db8::1", false), record("membros.bunker707.com.br", "A", "192.0.2.1", true)] });
  const r = conta.runScript("teste.sh", {}, ["dns"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const de = (name) => conta.cf().records.filter((x) => x.name === name).map((x) => [x.type, x.content, x.proxied]);
  assert.deepEqual(de(ESCOLA), [["A", "192.0.2.9", false]]);
  assert.deepEqual(de(API), [["A", "192.0.2.9", false]]);
  assert.deepEqual(de("membros.bunker707.com.br"), [["A", "192.0.2.1", true]]);
});

// O artefato do workflow pacote-escola: o zip com o pacote e o sha256, como o GitHub entrega.
function artefato({ versao = "1.0.0-ensaio.1", corromper = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), "artefato-"));
  dirs.push(d);
  const nome = `pacote-${ESCOLA}-${versao}`;
  const tgz = Buffer.from(`pacote de mentira ${versao}`);
  mkdirSync(join(d, "dentro"));
  writeFileSync(join(d, "dentro", `${nome}.tgz`), tgz);
  writeFileSync(join(d, "dentro", `${nome}.tgz.sha256`), `${corromper ? "0".repeat(64) : createHash("sha256").update(tgz).digest("hex")}  ${nome}.tgz\n`);
  const zip = join(d, "artefato.zip");
  const r = spawnSync("python3", ["-I", "-c", "import os, sys, zipfile\nz = zipfile.ZipFile(sys.argv[1], 'w')\nfor f in sorted(os.listdir(sys.argv[2])): z.write(os.path.join(sys.argv[2], f), f)\nz.close()", zip, join(d, "dentro")]);
  assert.equal(r.status, 0);
  const lista = { artifacts: [
    { id: 11, name: `pacote-${ESCOLA}-0.9.0`, expired: false, created_at: "2026-11-10T10:00:00Z" },
    { id: 12, name: nome, expired: false, created_at: "2026-11-11T10:00:00Z" },
    { id: 13, name: `pacote-${ESCOLA}-2.0.0`, expired: true, created_at: "2026-11-11T11:00:00Z" },
    { id: 14, name: "pacote-outra.escola.com.br-3.0.0", expired: false, created_at: "2026-11-11T12:00:00Z" }
  ] };
  return { zip, nome, SHIM_GH_ARTEFATOS: JSON.stringify(lista), SHIM_GH_ZIP: zip };
}
function evento(payload) {
  const d = mkdtempSync(join(tmpdir(), "evento-"));
  dirs.push(d);
  const arquivo = join(d, "evento.json");
  writeFileSync(arquivo, JSON.stringify({ inputs: { etapa: "teste-instalar", opcoes: "", payload } }));
  return arquivo;
}
const servidores = () => [servidorTeste(), serverFixture("bunker707-licencas", "licencas", 7)];
const instalar = (conta, extra = {}) => {
  const a = artefato();
  return conta.runScript("teste.sh", { GITHUB_TOKEN: "ghs_x", GITHUB_REPOSITORY: "dono/bunker707-member-area", GITHUB_EVENT_PATH: evento(CHAVE), SHIM_GH_ARTEFATOS: a.SHIM_GH_ARTEFATOS, SHIM_GH_ZIP: a.SHIM_GH_ZIP, ...extra }, ["instalar"]);
};

test("teste-instalar: o pacote mais novo da escola, conferido pelo sha256; as respostas, a chave do Resend do Emissor e a Chave de ativacao so pela entrada do SSH", { skip }, () => {
  const conta = setup({ servers: servidores(), firewalls: [{ name: `${TESTE}-fw`, applied_to: [], rules: [] }, { name: "bunker707-licencas-fw", applied_to: [], rules: [] }] });
  const r = instalar(conta, {
    PRODUCER_EMAIL: "Produtor@Exemplo.com.br",
    SSH_SHIM_REPLIES: JSON.stringify([{ contem: "segredos/resend-chave'", saida: "re_chave_do_emissor_0001" }])
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = conta.calls();
  // O artefato: o mais novo, vencido nunca, so o desta escola.
  const gh = calls.filter((c) => c.tool === "gh");
  assert.match(gh[0].args.join(" "), /api -H Accept: application\/vnd\.github\+json repos\/dono\/bunker707-member-area\/actions\/artifacts\?per_page=100/);
  assert.equal(gh[1].args.at(-1), "repos/dono/bunker707-member-area/actions/artifacts/12/zip");
  assert.match(r.stdout, /pacote-escola-teste\.bunker707\.com\.br-1\.0\.0-ensaio\.1 \(.*\), sha256 conferido/);
  // O pacote no servidor do ensaio, como root, aberto na pasta da instalacao do kit.
  assert.ok(calls.some((c) => c.tool === "scp" && c.args[1] === "root@192.0.2.9:/root/pacote-escola.tgz"));
  assert.ok(comando(calls, "tar -xzf /root/pacote-escola.tgz -C '/opt/membros'"));
  // As respostas, 0600, com a escola na nossa zona e o remetente no dominio de envio ja verificado.
  const respostas = comando(calls, "cat > /root/respostas-ensaio.conf");
  assert.match(respostas.command, /^umask 077; /);
  // (o ssh de mentira guarda os 80 primeiros caracteres da entrada)
  assert.equal(respostas.stdin, `ENDERECO=${ESCOLA}\nENDERECO_API=${API}\nEMAIL_DONO=Produtor@Exemplo.com.br\nNOME_DA_ESCOLA=Escola de Ensaio\nEMAIL_REMETENTE=escola-teste@mail.bunker707.com.br\n`.slice(0, 80));
  // A chave do Resend: a do Emissor, de um servidor para o outro pela entrada do SSH.
  const resend = sshCmds(calls).find((c) => c.command.includes("RESEND_API_KEY=%s"));
  assert.equal(resend.stdin, "re_chave_do_emissor_0001");
  assert.ok(comando(calls, "sudo cat '/opt/bunker707/emissor/segredos/resend-chave'").target.startsWith("deploy@192.0.2.7"));
  // A Chave de ativacao: do arquivo do evento para o servidor, so pela entrada.
  const chave = comando(calls, "cat > /root/chave-ensaio.txt");
  assert.equal(chave.stdin, CHAVE);
  const instalador = comando(calls, "bash '/opt/membros/infra/kit/instalar'");
  assert.match(instalador.command, /a\+=\(--ativacao-arquivo \/root\/chave-ensaio\.txt\)/);
  assert.match(instalador.command, /rm -f \/root\/respostas-ensaio\.conf \/root\/chave-ensaio\.txt; exit \$rc/, "as respostas e a Chave saem do servidor no fim");
  assert.match(instalador.command, /<e-mail do dono>/, "o e-mail do dono sai do que vai ao log");
  // Nada secreto em linha de comando nem no log; as duas portas 22 fecham.
  const tudo = sshCmds(calls).map((c) => c.command).join("\n") + JSON.stringify(calls.filter((c) => c.tool !== "ssh")) + r.stdout + r.stderr;
  for (const segredo of [CHAVE, "re_chave_do_emissor_0001", "produtor@exemplo.com.br"]) assert.ok(!tudo.toLowerCase().includes(segredo.toLowerCase()), segredo);
  for (const fw of conta.hz().firewalls) assert.ok(!fw.rules.some((x) => x.port === "22"), fw.name);
  assert.match(r.stdout, /A escola do ensaio esta no ar: https:\/\/escola-teste\.bunker707\.com\.br/);
});

test("teste-instalar no Actions: a Chave e mascarada antes de tudo e so aparece na linha do ::add-mask::; o segredo LICENCAS_RESEND_CHAVE vale por cima do Emissor", { skip }, () => {
  const conta = setup({ servers: [servidorTeste()], firewalls: [{ name: `${TESTE}-fw`, applied_to: [], rules: [] }] });
  const r = instalar(conta, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main", LICENCAS_RESEND_CHAVE: "re_segredo_do_github_0001" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const linhas = (r.stdout + r.stderr).split("\n").filter((l) => l.includes(CHAVE));
  assert.deepEqual(linhas, [`::add-mask::${CHAVE}`]);
  assert.equal(sshCmds(conta.calls()).find((c) => c.command.includes("RESEND_API_KEY=%s")).stdin, "re_segredo_do_github_0001");
  assert.ok(!conta.calls().some((c) => c.tool === "ssh" && !c.control && c.target?.startsWith("deploy@")), "sem pedir a chave ao Emissor");

  // O passo do workflow que mascara antes de qualquer outro: le do arquivo do evento, nunca de uma variavel.
  const passo = workflow.match(/- name: Mascarar a Chave de ativacao\n\s+if: (.+)\n\s+run: \|\n((?:\s{10}.+\n)+)/);
  assert.equal(passo[1], "inputs.etapa == 'teste-instalar'");
  const job = workflow.slice(workflow.indexOf("\n  infra:\n"));
  assert.ok(job.indexOf("Mascarar a Chave de ativacao") < job.indexOf("- name: Checkout"), "antes de qualquer outro passo");
  const saida = spawnSync("bash", ["-e", "-c", passo[2]], { encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_EVENT_PATH: evento(` ${CHAVE}\n`) } });
  assert.equal(saida.stdout, `::add-mask::${CHAVE}\n`);
  assert.doesNotMatch(workflow, /\$\{\{ inputs\.payload \}\}/, "o payload nunca e interpolado direto");
  assert.match(workflow, /PAYLOAD: \$\{\{ \(startsWith\(inputs\.etapa, 'secrets-'\) && inputs\.payload\) \|\| '' \}\}/, "o payload so vira PAYLOAD nas secrets-*");
});

test("teste-instalar: sem o pacote, com o sha256 errado ou sem Chave; o codigo do instalador volta e diz o que fazer", { skip }, () => {
  const base = () => setup({ servers: [servidorTeste()], firewalls: [{ name: `${TESTE}-fw`, applied_to: [], rules: [] }] });
  const semPacote = base();
  const nenhum = semPacote.runScript("teste.sh", { GITHUB_TOKEN: "ghs_x", GITHUB_REPOSITORY: "dono/repo", SHIM_GH_ARTEFATOS: '{"artifacts":[]}' }, ["instalar"]);
  assert.equal(nenhum.status, 1);
  assert.match(nenhum.stderr, /Nao achei o pacote de escola-teste\.bunker707\.com\.br entre os artefatos: rode o workflow Pacote da escola, da main/);
  assert.ok(!semPacote.calls().some((c) => c.tool === "ssh" && !c.control), "nada no servidor");

  const errado = base();
  const a = artefato({ corromper: true });
  const sha = errado.runScript("teste.sh", { GITHUB_TOKEN: "ghs_x", GITHUB_REPOSITORY: "dono/repo", SHIM_GH_ARTEFATOS: a.SHIM_GH_ARTEFATOS, SHIM_GH_ZIP: a.SHIM_GH_ZIP }, ["instalar"]);
  assert.equal(sha.status, 1);
  assert.match(sha.stderr, /O pacote baixado nao confere com o sha256 do artefato/);

  const versao = base();
  const pedida = versao.runScript("teste.sh", { GITHUB_TOKEN: "ghs_x", GITHUB_REPOSITORY: "dono/repo", PACOTE_VERSAO: "0.9.0", LICENCAS_RESEND_CHAVE: "re_x_00000001", SHIM_GH_ARTEFATOS: a.SHIM_GH_ARTEFATOS, SHIM_GH_ZIP: a.SHIM_GH_ZIP }, ["instalar"]);
  assert.equal(versao.calls().filter((c) => c.tool === "gh")[1].args.at(-1), "repos/dono/repo/actions/artifacts/11/zip", "PACOTE_VERSAO escolhe a versao");
  assert.equal(pedida.status, 1, "o artefato 0.9.0 de mentira e o zip da 1.0.0: o nome nao bate e para");

  const semChave = base();
  const b = artefato();
  const r = semChave.runScript("teste.sh", { GITHUB_TOKEN: "ghs_x", GITHUB_REPOSITORY: "dono/repo", LICENCAS_RESEND_CHAVE: "re_x_00000001", SHIM_GH_ARTEFATOS: b.SHIM_GH_ARTEFATOS, SHIM_GH_ZIP: b.SHIM_GH_ZIP, SSH_SHIM_REPLIES: JSON.stringify([{ contem: "infra/kit/instalar", codigo: 52 }]) }, ["instalar"]);
  assert.equal(r.status, 52, "o codigo do instalador volta para a etapa");
  assert.match(r.stderr, /Sem a Chave de ativacao no payload: o instalador para no ultimo passo \(codigo 52\)/);
  assert.match(r.stdout, /A escola esta instalada, mas a Licenca nao ativou \(codigo 52/);
  assert.ok(!sshCmds(semChave.calls()).some((c) => c.command.includes("cat > /root/chave-ensaio.txt")));
  assert.ok(!semChave.hz().firewalls[0].rules.some((x) => x.port === "22"));

  const ruim = base();
  const recusa = ruim.runScript("teste.sh", { GITHUB_TOKEN: "ghs_x", GITHUB_REPOSITORY: "dono/repo", GITHUB_EVENT_PATH: evento("chave com espaco; rm -rf /") }, ["instalar"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /O payload nao parece uma Chave de ativacao .* O valor nao foi mostrado/);
  assert.doesNotMatch(recusa.stdout + recusa.stderr, /rm -rf/);
});

test("teste-apagar: so com CONFIRMAR=apagar e so o servidor com a marca papel=teste; apaga o servidor, o firewall e o DNS", { skip }, () => {
  const registros = [record(ESCOLA, "A", "192.0.2.9", false), record(API, "A", "192.0.2.9", false), record("membros.bunker707.com.br", "A", "192.0.2.1", true)];
  const sem = setup({ servers: [servidorTeste()], records: registros });
  const recusa = sem.runScript("teste.sh", {}, ["apagar"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /Confirme com CONFIRMAR=apagar/);
  assert.deepEqual(sem.calls(), []);

  const outro = setup({ servers: [servidorTeste({ app: "bunker707", papel: "membros" })], records: registros });
  const marca = outro.runScript("teste.sh", { CONFIRMAR: "apagar" }, ["apagar"]);
  assert.equal(marca.status, 1);
  assert.match(marca.stderr, /nao tem a marca papel=teste: nao e o do ensaio, e nada foi apagado/);
  assert.equal(outro.hz().servers.length, 1);

  const conta = setup({ servers: [servidorTeste()], firewalls: [{ name: `${TESTE}-fw`, applied_to: [], rules: [] }, { name: "bunker707-membros-fw", applied_to: [], rules: [] }], records: registros });
  const r = conta.runScript("teste.sh", { CONFIRMAR: "apagar" }, ["apagar"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(conta.hz().servers, []);
  assert.deepEqual(conta.hz().firewalls.map((f) => f.name), ["bunker707-membros-fw"]);
  assert.deepEqual(conta.cf().records.map((x) => x.name), ["membros.bunker707.com.br"]);
  assert.match(r.stdout, /O ensaio foi apagado: nada dele fica cobrando/);
  // De novo: nada a apagar, sem erro.
  const denovo = conta.runScript("teste.sh", { CONFIRMAR: "apagar" }, ["apagar"]);
  assert.equal(denovo.status, 0, denovo.stderr);
});

test("as etapas do ensaio so rodam da main: a trava do workflow e a do script; o run.sh e o workflow conhecem as cinco", { skip }, () => {
  const step = workflow.match(/- name: Ensaio so da main\n\s+if: (.+)\n\s+run: \|\n\s+(.+)\n/);
  assert.equal(step[1], "startsWith(inputs.etapa, 'teste-')");
  const run = (ref) => spawnSync("bash", ["-e", "-c", step[2]], { encoding: "utf8", env: { ...process.env, ETAPA: "teste-criar", GITHUB_REF: ref } });
  assert.equal(run("refs/heads/main").status, 0);
  const dev = run("refs/heads/dev");
  assert.equal(dev.status, 1);
  assert.match(dev.stdout, /::error::teste-criar e do ensaio de comprador e so roda na main/);
  const etapas = ["teste-plano", "teste-criar", "teste-dns", "teste-instalar", "teste-apagar"];
  const runSh = readFileSync(join(cloudDir, "run.sh"), "utf8");
  for (const etapa of etapas) {
    assert.match(workflow, new RegExp(`^ {10}- ${etapa}$`, "m"), `${etapa} no workflow`);
    assert.match(runSh, new RegExp(`^ {4}${etapa}\\) bash "\\$here/teste\\.sh" ${etapa.replace("teste-", "")} ;;$`, "m"), `${etapa} no run.sh`);
  }
  assert.match(workflow, /^ {6}actions: read$/m, "o job le os artefatos (o pacote da escola)");
  const conta = setup({ tipos: TIPOS });
  for (const acao of ["plano", "criar", "dns", "instalar", "apagar"]) {
    const r = conta.runScript("teste.sh", { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev", CONFIRMADO: "sim", CONFIRMAR: "apagar" }, [acao]);
    assert.equal(r.status, 1, acao);
    assert.match(r.stderr, /As etapas do ensaio de comprador so rodam da main \(recebido: refs\/heads\/dev\)/);
  }
  assert.deepEqual(conta.calls(), []);
});
