import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";

import { chavePublicaDoKit, montarPacote } from "../infra/kit/montar-pacote.mjs";
import { chavePublicavelDaEscola } from "../infra/kit/pacote-escola.mjs";
import {
  API,
  AWS_SEGREDO,
  CHAVE_CERTA,
  ENDERECO,
  faltam,
  imagemDeMentira,
  IP,
  limparInstaladorDeMentira,
  RESEND_CHAVE,
  respostasCompletas,
  servidorDoInstalador
} from "./fixtures/instalador-de-mentira.mjs";

// O instalador do kit (infra/kit/instalar; docs/32 §3.2 e §11.7; docs/20 §9D), de ponta a ponta, num servidor de
// mentira (tests/fixtures/instalador-de-mentira.mjs): o pacote de verdade, montado por infra/kit/montar-pacote.mjs, o
// instalador e as ferramentas dele de verdade (instalar, instalador.py, licenca.sh), e o docker, o curl, o DNS e a rede
// de mentira. Os modos (guiado, com respostas, --conferir, --simular, --restauracao), retomar depois de uma falha em cada
// passo, rodar de novo sem mudar nada, os segredos que nunca aparecem e o arquivo de segredos 0600, o pacote alterado
// ou sem assinatura recusado, e o arquivo de respostas conferido.

after(limparInstaladorDeMentira);
const skip = faltam.length ? `faltam ${faltam.join(", ")}` : false;
const kitDir = new URL("../infra/kit/", import.meta.url).pathname;

const BACKUP_LOCAL = { BACKUP_DESTINO: undefined, BACKUP_AWS_ACCESS_KEY_ID: undefined, BACKUP_AWS_SECRET_ACCESS_KEY: undefined, BACKUP_SO_NESTE_SERVIDOR: "ACEITO O BACKUP SO NESTE SERVIDOR" };
const PASSOS = ["conferencia", "pacote", "preparar", "imagens", "segredos", "servicos", "migracoes", "agendador", "conta_do_dono", "email", "backup", "endereco", "conferencia_final", "ativacao"];

/** As chamadas que mudam o servidor (o --conferir e o --simular nunca chamam nenhuma). */
function mudam(chamadas) {
  return chamadas.filter((c) => {
    if (["preparar", "migrar", "membros", "systemctl"].includes(c.tool)) return true;
    if (c.tool !== "docker") return false;
    const a = c.args;
    if (["load", "run"].includes(a[0])) return true;
    if (a[0] !== "compose") return false;
    const sub = a.find((x, i) => i > 0 && !x.startsWith("-") && a[i - 1] !== "-f");
    return ["up", "restart", "exec", "down", "rm"].includes(sub);
  });
}
const contar = (chamadas, filtro) => chamadas.filter(filtro).length;
const docker = (sub) => (c) => c.tool === "docker" && c.args[0] === sub;
const composeUp = (c) => c.tool === "docker" && c.args[0] === "compose" && c.args.includes("up");

/** Os segredos do arquivo de segredos (senhas, chaves, tokens) e das respostas: nenhum pode sair na tela. */
function segredosDe(s) {
  const env = s.lerSegredos();
  const doEnv = Object.entries(env).filter(([k, v]) => /PASSWORD|SECRET|_KEY$|KEYS$|TOKEN|PASS$|ENC_KEY|ASYMMETRIC/.test(k) && v.length >= 8).map(([, v]) => v);
  return [...new Set([...doEnv, CHAVE_CERTA, RESEND_CHAVE, AWS_SEGREDO])];
}
function semSegredoNaSaida(s, saida) {
  for (const segredo of segredosDe(s)) assert.ok(!saida.includes(segredo), `um segredo saiu na tela: ${segredo.slice(0, 6)}...`);
}
function semSegredoNaLinhaDeComando(s) {
  const segredos = segredosDe(s);
  for (const c of s.chamadas()) {
    const texto = JSON.stringify(c.args ?? []);
    for (const segredo of segredos) assert.ok(!texto.includes(segredo), `um segredo foi para a linha de comando de ${c.tool}: ${segredo.slice(0, 6)}...`);
  }
}

/** Uma instalacao completa sem terminal (backup so neste servidor: o kit de recuperacao pede uma pessoa). */
function instalado(opcoes = {}, respostasExtra = BACKUP_LOCAL, extra = {}) {
  const s = servidorDoInstalador(opcoes);
  const arquivo = s.respostas(respostasCompletas(respostasExtra));
  const r = s.rodar(["--respostas", arquivo], extra);
  assert.equal(r.status, 0, r.saida);
  return { s, arquivo, r };
}

test("os scripts do instalador: sintaxe, a guarda do dash, a ajuda e o membros despacha os subcomandos novos", { skip }, () => {
  for (const nome of ["instalar", "licenca.sh", "dono.sh", "diagnostico.sh"]) {
    const r = spawnSync("bash", ["-n", join(kitDir, nome)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${nome}: ${r.stderr}`);
    const fonte = readFileSync(join(kitDir, nome), "utf8");
    assert.match(fonte, /^#!\/usr\/bin\/env bash\n/, nome);
    assert.ok(fonte.includes('[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"'), `${nome}: sem a guarda do dash`);
  }
  for (const nome of ["no-app.mjs", "montar-pacote.mjs"]) {
    const r = spawnSync(process.execPath, ["--check", join(kitDir, nome)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${nome}: ${r.stderr}`);
  }
  const py = spawnSync("python3", ["-I", "-c", "import ast, sys; ast.parse(open(sys.argv[1]).read())", join(kitDir, "instalador.py")], { encoding: "utf8" });
  assert.equal(py.status, 0, py.stderr);
  const ajuda = spawnSync("bash", [join(kitDir, "instalar"), "--help"], { encoding: "utf8" });
  assert.equal(ajuda.status, 0);
  for (const texto of ["--respostas", "--conferir", "--simular", "--restauracao", "--ativacao-arquivo"]) assert.ok(ajuda.stdout.includes(texto), texto);
  const membros = spawnSync("bash", [join(kitDir, "membros"), "ajuda"], { encoding: "utf8" });
  for (const sub of ["diagnostico", "instalar", "licenca", "link-do-dono"]) assert.ok(membros.stdout.includes(`membros ${sub}`), sub);
  // Os codigos documentados (docs/20 §9D) sao os do catalogo: cada um com o que fazer e de quem e.
  const codigos = JSON.parse(spawnSync("python3", ["-I", join(kitDir, "instalador.py"), "codigos", "--json"], { encoding: "utf8" }).stdout);
  for (const codigo of [1, 7, 10, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55]) {
    assert.ok(codigos[codigo], `codigo ${codigo}`);
    assert.ok(["comprador", "produto"].includes(codigos[codigo].de_quem), `de quem e o ${codigo}`);
  }
  const doc = readFileSync(new URL("../docs/20-runbook-hetzner.md", import.meta.url), "utf8");
  const secao = doc.slice(doc.indexOf("## 9D."), doc.indexOf("## 10."));
  for (const codigo of Object.keys(codigos)) assert.match(secao, new RegExp(`^\\| ${codigo} \\|`, "m"), `o codigo ${codigo} esta na tabela do docs/20 §9D`);
});

test("--conferir: o servidor que serve sai 0, sem Licenca, sem pacote, sem sudo e sem mudar nada", { skip }, () => {
  const s = servidorDoInstalador();
  const r = s.rodar(["--conferir", "--endereco", `https://${ENDERECO}/`]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /ok {4}Ubuntu 24\.04\.3 LTS/);
  assert.match(r.stdout, /2 vCPU/);
  assert.match(r.stdout, /3,8 GB de memoria \(8 GB recomendados\)/);
  assert.match(r.stdout, new RegExp(`${ENDERECO.replace(/\./g, "\\.")} aponta para este servidor \\(${IP.replace(/\./g, "\\.")}\\)`));
  assert.match(r.stdout, new RegExp(`${API.replace(/\./g, "\\.")} aponta para este servidor`), "o endereco da API sai do da escola");
  assert.match(r.stdout, /o envio de e-mail sai pela porta 587/);
  assert.match(r.stdout, /Este servidor serve para a escola/);
  assert.deepEqual(mudam(s.chamadas()), []);
  assert.ok(!existsSync(s.arquivoDoInstalador), "a conferencia nao anota nada");
  // Sem a chave do Emissor nem pacote: a conferencia so le. Em JSON, para a IA.
  const j = s.rodar(["--conferir", "--endereco", ENDERECO, "--json"]);
  assert.equal(j.status, 0, j.saida);
  const relatorio = JSON.parse(j.stdout);
  assert.equal(relatorio.resultado, "ok");
  assert.deepEqual(relatorio.itens.map((i) => i.id), ["sistema", "processador", "virtualizacao", "vcpu", "memoria", "disco", "portas", "ipv4", "dns", "dns_api", "emissor", "email_api", "email_smtp", "relogio"]);
  // A 587 bloqueada no provedor: a 2587 serve.
  const outra = s.rodar(["--conferir"], { SHIM_SMTP_BLOQUEADAS: "587" });
  assert.equal(outra.status, 0, outra.saida);
  assert.match(outra.stdout, /sai pela porta 2587/);
});

test("--conferir: cada problema do servidor tem o seu codigo, a frase do que fazer e de quem e", { skip }, () => {
  const casos = [
    [{ sistema: "rocky-9" }, {}, 10, /Rocky Linux 9\.4 .*o kit roda em Ubuntu 22\.04 ou 24\.04 e Debian 12 ou 13/],
    [{}, { SHIM_ARQ: "aarch64" }, 10, /processador aarch64: o kit roda em x86-64/],
    [{}, { SHIM_CONTAINER: "lxc" }, 21, /container \(lxc\)/],
    [{}, { SHIM_NPROC: "1" }, 22, /1 vCPU; o minimo e 2/],
    [{ memoriaKb: 1995000 }, {}, 23, /1,9 GB de memoria; o minimo e 4 GB/],
    [{}, { SHIM_DF: "20971520,15728640" }, 24, /disco de 20 GB; o minimo e 40 GB/],
    [{}, { SHIM_DF: "41943040,5242880" }, 24, /5 GB livres no disco/],
    [{}, { SHIM_SS: "LISTEN 0 511 0.0.0.0:80 0.0.0.0:*;LISTEN 0 511 [::]:443 [::]:*" }, 25, /a porta 80 e a 443 ja esta em uso/],
    [{}, { SHIM_DNS: JSON.stringify({ [ENDERECO]: { a: ["9.9.9.9"] }, [API]: { a: [IP] } }) }, 26, /aponta para 9\.9\.9\.9, e este servidor e 5\.75\.100\.20/],
    [{}, { SHIM_DNS: JSON.stringify({ [API]: { a: [IP] } }) }, 26, /ainda nao aponta para nenhum servidor \(sem registro A\)/],
    [{}, { SHIM_DNS: JSON.stringify({ [ENDERECO]: { a: [IP], aaaa: ["2001:db8::1"] }, [API]: { a: [IP] } }) }, 27, /registro AAAA em alunos\.escola\.test apontando para outro servidor \(2001:db8::1\)/],
    [{}, { SHIM_DNS: JSON.stringify({ [ENDERECO]: { a: ["104.16.1.1"] }, [API]: { a: [IP] } }) }, 28, /proxy da Cloudflare esta ligado em alunos\.escola\.test/],
    [{}, { SHIM_SEM_INTERNET: "1" }, 29, /nao sai para a internet por HTTPS/],
    [{}, { SHIM_SMTP_BLOQUEADAS: "587,2587,465" }, 30, /nenhuma porta de envio de e-mail sai deste servidor \(587, 2587, 465\)/],
    [{}, { SHIM_DATA: "Mon, 09 Nov 2026 10:00:00 GMT" }, 38, /o relogio deste servidor esta \d+ minutos fora da hora certa/]
  ];
  for (const [opcoes, extra, codigo, frase] of casos) {
    const s = servidorDoInstalador(opcoes);
    const r = s.rodar(["--conferir", "--endereco", ENDERECO], extra);
    assert.equal(r.status, codigo, `${JSON.stringify(extra)}: ${r.saida}`);
    assert.match(r.saida, frase);
    assert.match(r.stderr, new RegExp(`ERRO \\(codigo ${codigo}, [a-z_]+\\):`));
    assert.match(r.stderr, /O que fazer: /);
    assert.match(r.stderr, /De quem e: do servidor ou das contas do comprador/);
    assert.deepEqual(mudam(s.chamadas()), []);
  }
  // O Emissor fora com o resto saindo: so um aviso (pode ser do nosso lado); a conferencia passa.
  const s = servidorDoInstalador();
  const r = s.rodar(["--conferir"], { SHIM_EMISSOR_FORA: "1" });
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /AVISO o Emissor de licencas nao respondeu agora/);
});

test("--simular: mostra o plano com o que falta responder e nao muda nada (nem o arquivo do instalador)", { skip }, () => {
  const s = servidorDoInstalador();
  const r = s.rodar(["--simular", "--respostas", s.respostas({ ENDERECO })]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /Plano do Bunker Members \(instalacao\):/);
  assert.match(r.stdout, /Escola: https:\/\/alunos\.escola\.test {3}API: https:\/\/api\.alunos\.escola\.test/);
  assert.match(r.stdout, /Pacote: versao 1\.0\.0 .*assinatura: nao/);
  assert.match(r.stdout, /Falta responder: EMAIL_DONO NOME_DA_ESCOLA RESEND_API_KEY BACKUP_DESTINO \(ou BACKUP_SO_NESTE_SERVIDOR\) CHAVE_ATIVACAO/);
  for (const n of PASSOS.keys()) assert.match(r.stdout, new RegExp(`^ +${n + 1}\\. .+ falta$`, "m"));
  assert.match(r.stdout, /Nada foi mudado \(--simular\)/);
  assert.deepEqual(mudam(s.chamadas()), []);
  assert.ok(!existsSync(s.arquivoDoInstalador));
  assert.ok(!existsSync(s.envFile));
  // No modo de restauracao, o plano diz o que pula.
  const rest = s.rodar(["--simular", "--restauracao", "--respostas", s.respostas({ ENDERECO, EMAIL_DONO: "dono@escola.test", BACKUP_DESTINO: "/mnt/disco-antigo/backup" })]);
  assert.equal(rest.status, 0, rest.saida);
  assert.match(rest.stdout, /modo de restauracao/);
  assert.match(rest.stdout, /Ativar a Licenca +pula neste modo/);
});

test("instalacao completa com o arquivo de respostas, no terminal: S3, kit de recuperacao confirmado, e-mail de teste e o link do dono uma vez so", { skip }, () => {
  const s = servidorDoInstalador();
  const arquivo = s.respostas(respostasCompletas());
  const r = s.pessoa(["--respostas", arquivo], [
    { espera: "Digite s \\(chegou\\) ou n", responde: "s" },
    { espera: "Confirme digitando o grupo 2:", responde: "EFGH" }
  ]);
  assert.equal(r.status, 0, r.saida);
  const passos = s.passos();
  for (const passo of PASSOS) assert.equal(passos[passo]?.situacao, "ok", `${passo}: ${JSON.stringify(passos[passo])}`);
  const instalacao = s.lerJson(s.arquivoDoInstalador);
  assert.equal(instalacao.versao, "1.0.0");
  assert.equal(instalacao.endereco, ENDERECO);
  assert.ok(instalacao.terminou_em);
  // O arquivo do instalador nao tem segredo (0644: membros status e diagnostico leem sem sudo).
  assert.equal(statSync(s.arquivoDoInstalador).mode & 0o777, 0o644);
  for (const segredo of segredosDe(s)) assert.ok(!readFileSync(s.arquivoDoInstalador, "utf8").includes(segredo));
  // O arquivo de segredos: 0600, gerado dentro da imagem do app, com o kit por cima e nada da nossa producao.
  assert.equal(statSync(s.envFile).mode & 0o777, 0o600);
  const env = s.lerSegredos();
  assert.equal(env.APP_PUBLIC_URL, `https://${ENDERECO}`);
  assert.equal(env.SUPABASE_PUBLIC_URL, `https://${API}`);
  assert.equal(env.APP_IMAGE, "area-de-membros/app:1.0.0");
  assert.equal(env.APP_VERSION, "1.0.0");
  assert.equal(env.ACME_EMAIL, "dono@escola.test");
  assert.equal(env.STUDIO_SITE_ADDRESS, "");
  assert.equal(env.SMTP_PASS, RESEND_CHAVE);
  assert.equal(env.SMTP_PORT, "587");
  assert.equal(env.SMTP_SENDER_NAME, "Escola de Teste");
  assert.equal(env.EMAIL_FROM, "Escola de Teste <escola@mail.escola.test>");
  assert.equal(env.EMAIL_PROVIDER, "resend");
  assert.equal(env.RESTIC_REPOSITORY, "s3:https://s3.us-east-005.backblazeb2.com/escola-backup/membros");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, AWS_SEGREDO);
  assert.deepEqual([env.BACKUP_KEEP_DAILY, env.BACKUP_KEEP_WEEKLY, env.BACKUP_KEEP_MONTHLY], ["7", "4", "6"]);
  assert.equal(env.STORAGE_BOX_USER, "");
  assert.ok(!Object.values(env).some((v) => /mail\.bunker707|storagebox/.test(v)), "nada da nossa producao no servidor do comprador");
  assert.match(env.JOBS_TICK_TOKEN, /^[0-9a-f]{64}$/);
  // Os passos, na ordem, com o que cada um chamou.
  const chamadas = s.chamadas();
  assert.equal(contar(chamadas, (c) => c.tool === "preparar"), 1);
  assert.equal(contar(chamadas, docker("load")), 1);
  const gerador = chamadas.find(docker("run"));
  assert.deepEqual(gerador.args.slice(gerador.args.indexOf("--entrypoint"), gerador.args.indexOf("--entrypoint") + 5), ["--entrypoint", "node", "area-de-membros/app:1.0.0", "generate-secrets.mjs", "--kit"]);
  assert.equal(gerador.args[gerador.args.indexOf("--network") + 1], "none", "o gerador roda sem rede");
  const subidas = chamadas.filter(composeUp).map((c) => c.args.slice(c.args.indexOf("-d") + 1));
  assert.deepEqual(subidas[0], ["db", "auth", "rest", "storage", "imgproxy", "api-gw", "app"], "sem o Caddy antes do DNS");
  assert.deepEqual(subidas.at(-1), ["caddy"], "o Caddy (e o certificado) so no passo do endereco");
  assert.equal(contar(chamadas, (c) => c.tool === "migrar"), 1);
  assert.equal(s.shim().vault, "com-token", "o tick no Vault, com o token pela entrada do psql");
  assert.ok(chamadas.some((c) => c.tool === "docker" && c.sql?.includes("from cron.job")));
  assert.deepEqual(Object.values(s.shim().papeis), ["owner"]);
  assert.deepEqual(s.shim().emails, [{ porta: "587", de: "escola@mail.escola.test", para: "dono@escola.test", assunto: "Teste do e-mail da escola" }]);
  assert.deepEqual(
    chamadas.filter((c) => c.tool === "membros").map((c) => c.args.join(" ")),
    ["backup --iniciar", "backup --instalar-agendamento", "backup", "kit-de-recuperacao --conferir", "kit-de-recuperacao", "kit-de-recuperacao --conferir", "licenca estado --json", "licenca ativar --da-entrada --json", "licenca estado --json"]
  );
  assert.equal(s.shim().licenca.ativacoes, 1);
  // A Chave so pela entrada do app; nenhum segredo na tela nem em linha de comando.
  assert.ok(chamadas.some((c) => c.acao === "licenca-ativar" && c.chaveNaEntrada));
  semSegredoNaSaida(s, r.saida);
  semSegredoNaLinhaDeComando(s);
  for (const c of chamadas.filter((c) => c.tool === "curl" && c.comChaveNoConfig)) assert.ok(c.args.includes("-K"), "a chave do Resend vai pelo -K - (a entrada)");
  // O resumo: o endereco, o link de entrada do dono (uso unico, so no terminal) e a folha de recuperacao.
  assert.match(r.saida, /A escola esta instalada \(Bunker Members, versao 1\.0\.0\)/);
  assert.match(r.saida, /https:\/\/alunos\.escola\.test\/auth\/confirm\?token_hash=f00dfeed[0-9a-f]+&type=recovery&next=%2Fadmin/);
  assert.match(r.saida, /Licenca: ativada/);
  assert.match(r.saida, /sudo membros diagnostico/);
  // O comando de operacao no PATH.
  assert.equal(readlinkSync(s.link), join(s.pacote, "infra", "kit", "membros"));
});

test("sem terminal (a IA): o link do dono nunca aparece, o kit de recuperacao para com o codigo 49, e a instalacao continua de onde parou", { skip }, () => {
  const s = servidorDoInstalador();
  const arquivo = s.respostas(respostasCompletas());
  const r = s.rodar(["--respostas", arquivo]);
  assert.equal(r.status, 49, r.saida);
  assert.match(r.stderr, /ERRO \(codigo 49, kit_de_recuperacao\)/);
  assert.match(r.stderr, /A instalacao parou em "Ligar o backup e o kit de recuperacao"/);
  assert.equal(s.passos().backup.situacao, "falhou");
  assert.equal(s.passos().backup.codigo, 49);
  assert.equal(s.passos().email.situacao, "ok");
  // A pessoa confirma o kit no terminal; o instalador continua sem refazer nada.
  const kit = s.pessoa(["kit-de-recuperacao"], [{ espera: "Confirme digitando o grupo 2:", responde: "EFGH" }], {}, s.ambiente().KIT_SCRIPT_MEMBROS);
  assert.equal(kit.status, 0, kit.saida);
  s.limparLog();
  const de_novo = s.rodar(["--respostas", arquivo]);
  assert.equal(de_novo.status, 0, de_novo.saida);
  const chamadas = s.chamadas();
  assert.equal(contar(chamadas, (c) => ["preparar", "migrar"].includes(c.tool)), 0);
  assert.equal(contar(chamadas, docker("load")) + contar(chamadas, docker("run")), 0);
  assert.equal(s.shim().emails.length, 1, "o e-mail de teste nao sai de novo");
  assert.doesNotMatch(de_novo.saida, /token_hash=/, "sem terminal, nada de link");
  assert.match(de_novo.saida, /Para entrar como dono, rode no terminal do servidor: sudo membros link-do-dono/);
  semSegredoNaSaida(s, r.saida + de_novo.saida);
});

test("retomar depois de uma falha em cada passo: para com o codigo do passo, anota, e na volta continua dali sem refazer o que ja foi feito", { skip }, async () => {
  const casos = [
    ["conferencia", { SHIM_NPROC: "1" }, 22],
    ["preparar", { SHIM_PREPARAR_RC: "3" }, 39],
    ["imagens", { SHIM_FALHA: "load" }, 34],
    ["segredos", { SHIM_FALHA: "gerador" }, 40],
    ["servicos", { SHIM_FALHA: "up" }, 41],
    ["migracoes", { SHIM_MIGRAR_RC: "3" }, 42],
    ["agendador", { SHIM_FALHA: "vault" }, 43],
    ["conta_do_dono", { SHIM_FALHA: "auth" }, 44],
    ["email", { SHIM_SMTP_RECUSA: "1" }, 47],
    ["backup", { SHIM_BACKUP_RC: "3" }, 48],
    ["endereco", { SHIM_CERTIFICADO: "nunca" }, 50],
    ["conferencia_final", { SHIM_FUMACA_RC: "1" }, 51],
    ["ativacao", { SHIM_FALHA: "emissor" }, 54]
  ];
  // Os passos que, feitos, nunca rodam de novo (o que cada um chama).
  const marcas = {
    preparar: (c) => c.tool === "preparar",
    imagens: docker("load"),
    segredos: docker("run"),
    migracoes: (c) => c.tool === "migrar",
    conta_do_dono: (c) => c.acao === "dono-criar",
    email: (c) => c.tool === "curl" && c.url?.startsWith("smtp://") && c.args.includes("--mail-from"),
    ativacao: (c) => c.acao === "licenca-ativar"
  };
  const cenarios = casos.map(async ([passo, falha, codigo]) => {
    const s = servidorDoInstalador();
    const arquivo = s.respostas(respostasCompletas(BACKUP_LOCAL));
    const primeira = await s.rodarAsync(["--respostas", arquivo], falha);
    assert.equal(primeira.status, codigo, `${passo}: ${primeira.saida}`);
    assert.match(primeira.stderr, new RegExp(`ERRO \\(codigo ${codigo}, `), passo);
    const anotado = s.passos();
    assert.equal(anotado[passo]?.situacao, "falhou", `${passo}: ${JSON.stringify(anotado)}`);
    assert.equal(anotado[passo].codigo, codigo, passo);
    const antes = PASSOS.slice(0, PASSOS.indexOf(passo));
    for (const p of antes) assert.equal(anotado[p]?.situacao, "ok", `${passo}: ${p} antes dele`);
    for (const p of PASSOS.slice(PASSOS.indexOf(passo) + 1)) assert.equal(anotado[p], undefined, `${passo}: ${p} depois dele nao rodou`);
    const chamadasAntes = s.chamadas();
    s.limparLog();
    const segunda = await s.rodarAsync(["--respostas", arquivo], passo === "conferencia" || passo === "preparar" || passo === "email" || passo === "endereco" ? {} : falha);
    assert.equal(segunda.status, 0, `${passo}, na volta: ${segunda.saida}`);
    for (const p of PASSOS) assert.equal(s.passos()[p]?.situacao, "ok", `${passo}, na volta: ${p}`);
    const chamadasDepois = s.chamadas();
    for (const [p, marca] of Object.entries(marcas)) {
      if (PASSOS.indexOf(p) < PASSOS.indexOf(passo)) {
        assert.equal(contar(chamadasDepois, marca), 0, `${passo}: o passo ${p}, ja feito, rodou de novo`);
        assert.ok(contar(chamadasAntes, marca) >= 1, `${passo}: o passo ${p} rodou da primeira vez`);
      }
    }
    assert.equal(s.shim().licenca.ativacoes, 1, `${passo}: uma ativacao so`);
    semSegredoNaSaida(s, primeira.saida + segunda.saida);
  });
  for (let i = 0; i < cenarios.length; i += 1) await cenarios[i];
});

test("rodar de novo depois de pronto: nada muda, nada e gerado de novo e o resumo volta", { skip }, () => {
  const { s, arquivo } = instalado();
  const env = readFileSync(s.envFile, "utf8");
  s.limparLog();
  const r = s.rodar(["--respostas", arquivo]);
  assert.equal(r.status, 0, r.saida);
  assert.equal(readFileSync(s.envFile, "utf8"), env, "o arquivo de segredos nao muda");
  const chamadas = s.chamadas();
  assert.equal(contar(chamadas, (c) => ["preparar", "migrar", "fumaca"].includes(c.tool)), 0);
  assert.equal(contar(chamadas, (c) => c.tool === "membros" && c.args[0] === "backup"), 0);
  assert.equal(contar(chamadas, docker("load")) + contar(chamadas, docker("run")) + contar(chamadas, composeUp), 0);
  assert.equal(s.shim().licenca.ativacoes, 1);
  assert.match(r.saida, /feito: Ativar a Licenca/);
  assert.match(r.saida, /A escola esta instalada/);
  // Rodar de novo sem o arquivo de respostas e sem terminal: o que falta (nada) sai do arquivo de segredos.
  const semRespostas = s.rodar([]);
  assert.equal(semRespostas.status, 0, semRespostas.saida);
  // Um pacote de outra versao numa escola pronta: o instalador recusa (atualizar e outro comando).
  const manifesto = join(s.pacote, "MANIFESTO.json");
  writeFileSync(manifesto, readFileSync(manifesto, "utf8").replace('"versao": "1.0.0"', '"versao": "1.1.0"'));
  const outra = s.rodar(["--respostas", arquivo]);
  assert.equal(outra.status, 36, outra.saida);
  assert.match(outra.stderr, /ja esta instalada com a versao 1\.0\.0/);
});

test("o pacote: arquivo alterado ou faltando (32), sem assinatura ou assinado por outra chave (33), a chave gravada no servidor vale e a imagem de outra Instalacao (35)", { skip }, () => {
  // Alterado e faltando: so o sha256 (sem chave no kit).
  const s = servidorDoInstalador();
  const arquivo = s.respostas(respostasCompletas(BACKUP_LOCAL));
  appendFileSync(join(s.pacote, "infra", "kit", "backup.sh"), "\nrm -rf /\n");
  let r = s.rodar(["--respostas", arquivo]);
  assert.equal(r.status, 32, r.saida);
  assert.match(r.stderr, /ERRO \(codigo 32, pacote_corrompido\): o pacote nao confere com o manifesto: infra\/kit\/backup\.sh nao confere/);
  assert.match(r.stderr, /De quem e: do produto/);
  assert.equal(s.passos().pacote.situacao, "falhou");
  assert.equal(contar(s.chamadas(), (c) => c.tool === "preparar"), 0, "nada muda no servidor com o pacote que nao confere");
  const s2 = servidorDoInstalador();
  spawnSync("rm", [join(s2.pacote, "supabase", "migrations", readFileSync(join(s2.pacote, "MANIFESTO.json"), "utf8").match(/supabase\/migrations\/(\d+_[^"]+\.sql)/)[1])]);
  r = s2.rodar(["--simular", "--respostas", s2.respostas(respostasCompletas(BACKUP_LOCAL))]);
  assert.equal(r.status, 32, r.saida);
  assert.match(r.stderr, /falta supabase\/migrations\//);

  // Com chave: sem assinatura, assinatura de outra chave e assinatura certa.
  const assinado = servidorDoInstalador({ assinar: true });
  const respostas = assinado.respostas(respostasCompletas(BACKUP_LOCAL));
  r = assinado.rodar(["--simular", "--respostas", respostas]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /assinatura: sim/);
  const outra = chavePublicaDoKit(generateKeyPairSync("ed25519").publicKey);
  r = assinado.rodar(["--simular", "--respostas", respostas], { KIT_CHAVE_DO_PACOTE: outra });
  assert.equal(r.status, 33, r.saida);
  assert.match(r.stderr, /a assinatura do manifesto nao confere com a chave do pacote/);
  const semAssinatura = servidorDoInstalador();
  r = semAssinatura.rodar(["--simular", "--respostas", semAssinatura.respostas(respostasCompletas(BACKUP_LOCAL))], { KIT_CHAVE_DO_PACOTE: assinado.chavePublica });
  assert.equal(r.status, 33, r.saida);
  assert.match(r.stderr, /o pacote nao tem assinatura/);
  // A primeira instalacao com pacote assinado grava a chave no servidor; dali em diante ela vale, mesmo sem a do kit.conf.
  r = assinado.rodar(["--respostas", respostas]);
  assert.equal(r.status, 0, r.saida);
  const gravada = join(assinado.estado, "chaves-do-pacote");
  assert.equal(readFileSync(gravada, "utf8").trim(), assinado.chavePublica);
  const ambienteSemChave = { KIT_CHAVE_DO_PACOTE: "" };
  r = assinado.rodar(["--simular", "--respostas", respostas], ambienteSemChave);
  assert.equal(r.status, 0, r.saida);
  writeFileSync(gravada, `${outra}\n`);
  r = assinado.rodar(["--simular", "--respostas", respostas], ambienteSemChave);
  assert.equal(r.status, 33, "a chave que o servidor guardou vale por cima do pacote que chega");

  // A imagem por Instalacao do lote fundador: o pacote de outro endereco e recusado antes de mudar o servidor.
  const deOutra = servidorDoInstalador({ instalacao: "membros.outra-escola.test" });
  r = deOutra.rodar(["--respostas", deOutra.respostas(respostasCompletas(BACKUP_LOCAL))]);
  assert.equal(r.status, 35, r.saida);
  assert.match(r.stderr, /este pacote foi gerado para membros\.outra-escola\.test, e esta escola e alunos\.escola\.test/);
  assert.equal(contar(deOutra.chamadas(), (c) => c.tool === "preparar"), 0);

  // O pacote aberto fora da pasta da instalacao: o instalador diz onde abrir.
  const fora = servidorDoInstalador();
  r = fora.rodar(["--simular"], { KIT_PASTA_INSTALACAO: join(fora.dir, "opt", "outra") });
  assert.equal(r.status, 20, r.saida);
  assert.match(r.stderr, /Abra o pacote la/);
});

test("o pacote de um fundador: a chave publicavel da imagem vai para o arquivo de segredos, e o pacote de outra API e recusado (35)", { skip }, () => {
  // A chave publicavel que o workflow pacote-escola gravou na imagem (publica, derivada do endereco).
  const chave = chavePublicavelDaEscola(ENDERECO);
  const { s } = instalado({ instalacao: ENDERECO, instalacaoApi: API, chavePublicavel: chave });
  const env = s.lerSegredos();
  assert.equal(env.SUPABASE_PUBLISHABLE_KEY, chave, "o gateway aceita o que o navegador da imagem manda");
  const gerador = s.chamadas().find(docker("run"));
  assert.deepEqual(gerador.args.slice(gerador.args.indexOf("--publishable-key"), gerador.args.indexOf("--publishable-key") + 2), ["--publishable-key", chave]);
  // O segredo JWT e as chaves de servico nasceram aqui, no servidor: nenhum deles esta no pacote.
  const pacote = readFileSync(join(s.dir, "opt", "escola", "MANIFESTO.json"), "utf8");
  for (const nome of ["JWT_SECRET", "SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "POSTGRES_PASSWORD"]) {
    assert.match(env[nome], /.{16,}/, nome);
    assert.ok(!pacote.includes(env[nome]), `${nome} nunca no pacote`);
  }
  assert.equal(JSON.parse(pacote).chave_publicavel, chave);

  const outraApi = servidorDoInstalador({ instalacao: ENDERECO, instalacaoApi: "api2.escola.test", chavePublicavel: chave });
  const r = outraApi.rodar(["--respostas", outraApi.respostas(respostasCompletas(BACKUP_LOCAL))]);
  assert.equal(r.status, 35, r.saida);
  assert.match(r.stderr, /gerado com a API em api2\.escola\.test, e esta escola usa api\.alunos\.escola\.test/);
  assert.equal(contar(outraApi.chamadas(), (c) => c.tool === "preparar"), 0, "nada muda no servidor");
});

test("a imagem que chegou direto (docker save | ssh docker load) vale pelo id, sem o arquivo no pacote", { skip }, () => {
  const s = servidorDoInstalador();
  const shimArquivo = s.ambiente().SHIM_ESTADO;
  const estado = JSON.parse(readFileSync(shimArquivo, "utf8"));
  estado.imagens["area-de-membros/app:1.0.0"] = s.idDoApp;
  writeFileSync(shimArquivo, JSON.stringify(estado));
  spawnSync("rm", [join(s.pacote, "imagens", "app.tar")]);
  const r = s.rodar(["--respostas", s.respostas(respostasCompletas(BACKUP_LOCAL))]);
  assert.equal(r.status, 0, r.saida);
  assert.equal(contar(s.chamadas(), docker("load")), 0);
  assert.match(r.saida, /area-de-membros\/app:1\.0\.0 ja esta carregada/);
  // O id diferente (outra imagem com a mesma tag) nao vale.
  const s2 = servidorDoInstalador();
  const e2 = JSON.parse(readFileSync(s2.ambiente().SHIM_ESTADO, "utf8"));
  e2.imagens["area-de-membros/app:1.0.0"] = `sha256:${"1".repeat(64)}`;
  writeFileSync(s2.ambiente().SHIM_ESTADO, JSON.stringify(e2));
  spawnSync("rm", [join(s2.pacote, "imagens", "app.tar")]);
  const r2 = s2.rodar(["--simular"]);
  assert.equal(r2.status, 32, r2.saida);
  // O docker load que traz outra imagem com a tag certa: codigo 34.
  const s3 = servidorDoInstalador();
  const r3 = s3.rodar(["--respostas", s3.respostas(respostasCompletas(BACKUP_LOCAL))], { SHIM_ID_ERRADO: "1" });
  assert.equal(r3.status, 34, r3.saida);
  assert.match(r3.stderr, /carregou com o id sha256:0+, e o manifesto diz sha256:/);
});

test("modo de restauracao: instala sem Chave, so o banco no ar, o destino do backup gravado e o backup diario parado ate o membros restaurar", { skip }, () => {
  const s = servidorDoInstalador();
  const respostas = s.respostas({
    ENDERECO,
    EMAIL_DONO: "dono@escola.test",
    BACKUP_DESTINO: "s3:https://s3.us-east-005.backblazeb2.com/escola-backup/membros",
    BACKUP_AWS_ACCESS_KEY_ID: "005chaveDeAcessoId",
    BACKUP_AWS_SECRET_ACCESS_KEY: AWS_SEGREDO
  });
  const r = s.rodar(["--restauracao", "--respostas", respostas]);
  assert.equal(r.status, 0, r.saida);
  const passos = s.passos();
  for (const p of ["migracoes", "agendador", "conta_do_dono", "email", "conferencia_final", "ativacao"]) assert.equal(passos[p].situacao, "pulado", p);
  for (const p of ["conferencia", "pacote", "preparar", "imagens", "segredos", "servicos", "backup", "endereco"]) assert.equal(passos[p].situacao, "ok", p);
  const chamadas = s.chamadas();
  assert.deepEqual(chamadas.filter(composeUp).map((c) => c.args.slice(c.args.indexOf("-d") + 1)), [["db"], ["caddy"]]);
  assert.equal(contar(chamadas, (c) => c.acao), 0, "nada no app: nem conta, nem Licenca");
  assert.equal(contar(chamadas, (c) => c.tool === "migrar"), 0);
  assert.deepEqual(chamadas.filter((c) => c.tool === "membros").map((c) => c.args.join(" ")), ["backup --conferir-destino", "backup --instalar-agendamento"]);
  assert.ok(existsSync(join(s.estado, "restauracao-pendente")), "a marca que para o backup diario ate a restauracao");
  assert.ok(JSON.parse(readFileSync(join(s.estado, "situacao.json"), "utf8")).restauracao.pendente_desde);
  assert.equal(s.lerSegredos().RESTIC_REPOSITORY, "s3:https://s3.us-east-005.backblazeb2.com/escola-backup/membros");
  assert.match(r.stdout, /pronto para receber o backup/);
  assert.match(r.stdout, /sudo membros restaurar/);
  semSegredoNaSaida(s, r.saida);
  // O endereco que ainda aponta para o servidor antigo so avisa (o membros restaurar confere no fim).
  const s2 = servidorDoInstalador();
  const r2 = s2.rodar(["--restauracao", "--respostas", s2.respostas({ ENDERECO, EMAIL_DONO: "dono@escola.test", BACKUP_DESTINO: "/mnt/disco/backup" })], {
    SHIM_DNS: JSON.stringify({ [ENDERECO]: { a: ["9.9.9.9"] }, [API]: { a: ["9.9.9.9"] } })
  });
  assert.equal(r2.status, 0, r2.saida);
  assert.equal(s2.passos().endereco.situacao, "pulado");
  assert.match(r2.stderr, /o endereco ainda nao aponta para este servidor/);
  // Rodar no outro modo na mesma instalacao: recusado.
  const r3 = s.rodar(["--respostas", s.respostas(respostasCompletas(BACKUP_LOCAL))]);
  assert.equal(r3.status, 36, r3.saida);
  assert.match(r3.stderr, /comecou no modo restauracao/);
});

test("o arquivo de respostas e conferido antes de mudar qualquer coisa", { skip }, () => {
  const casos = [
    [{ ENDERECCO: "x" }, /chaves que o instalador nao conhece: ENDERECCO/],
    [{ ENDERECO: "escola.com.br" }, /ENDERECO precisa ser um subdominio, por exemplo alunos\.escola\.com\.br/],
    [{ ENDERECO: "meucurso.com" }, /precisa ser um subdominio/],
    [{ ENDERECO: "alunos_escola.test" }, /ENDERECO nao e um endereco valido/],
    [{ EMAIL_DONO: "dono-sem-arroba" }, /EMAIL_DONO nao e um e-mail valido/],
    [{ NOME_DA_ESCOLA: "Escola #1" }, /NOME_DA_ESCOLA precisa ter de 2 a 80 letras/],
    [{ CHAVE_ATIVACAO: "XYZ-123" }, /a Chave de ativacao nao esta inteira: ela comeca com BKA-/],
    [{ RESEND_API_KEY: "sk_live_123456789" }, /RESEND_API_KEY nao parece uma chave do Resend/],
    [{ BACKUP_SO_NESTE_SERVIDOR: "ACEITO O BACKUP SO NESTE SERVIDOR" }, /nao os dois/],
    [{ BACKUP_DESTINO: "/mnt/backup/escola", BACKUP_AWS_ACCESS_KEY_ID: undefined, BACKUP_AWS_SECRET_ACCESS_KEY: undefined }, /pede o aceite escrito: BACKUP_SO_NESTE_SERVIDOR=ACEITO O BACKUP SO NESTE SERVIDOR/],
    [{ ...BACKUP_LOCAL, BACKUP_SO_NESTE_SERVIDOR: "sim" }, /BACKUP_SO_NESTE_SERVIDOR precisa ser exatamente: ACEITO O BACKUP SO NESTE SERVIDOR/],
    [{ BACKUP_DESTINO: "b2:escola:membros" }, /usa o tipo b2:/],
    [{ BACKUP_AWS_SECRET_ACCESS_KEY: undefined }, /faltam: BACKUP_AWS_SECRET_ACCESS_KEY/],
    [{ IP_DO_SERVIDOR: "10.0.0.5" }, /IP_DO_SERVIDOR precisa ser um IPv4 publico/],
    [{ CHAVE_SSH: "nao-e-uma-chave" }, /CHAVE_SSH nao parece uma chave publica SSH/],
    [{ ENDERECO: undefined, NOME_DA_ESCOLA: undefined }, /faltam: ENDERECO, NOME_DA_ESCOLA/]
  ];
  for (const [mudanca, frase] of casos) {
    const s = servidorDoInstalador();
    const r = s.rodar(["--respostas", s.respostas(respostasCompletas(mudanca))]);
    assert.equal(r.status, 1, `${JSON.stringify(mudanca)}: ${r.saida}`);
    assert.match(r.stderr, frase, JSON.stringify(mudanca));
    assert.deepEqual(mudam(s.chamadas()), [], JSON.stringify(mudanca));
    assert.ok(!existsSync(s.arquivoDoInstalador), JSON.stringify(mudanca));
    semSegredoNaSaida(s, r.saida.replace(/sk_live_123456789/, ""));
  }
  // O arquivo com segredo que outros usuarios leem.
  const s = servidorDoInstalador();
  const r = s.rodar(["--respostas", s.respostas(respostasCompletas(), 0o644)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tem segredos e pode ser lido por outros usuarios: deixe so o administrador ler \(chmod 600\)/);
  // A Chave num arquivo a parte, so do administrador.
  const chave = join(s.dir, "chave.txt");
  writeFileSync(chave, `  ${CHAVE_CERTA.toLowerCase()}\n`, { mode: 0o644 });
  const r2 = s.rodar(["--respostas", s.respostas(respostasCompletas({ CHAVE_ATIVACAO: undefined })), "--ativacao-arquivo", chave]);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /chave\.txt pode ser lido por outros usuarios/);
  // O endereco de uma instalacao que ja comecou nao muda pelas respostas.
  const { s: pronta } = instalado();
  const r3 = pronta.rodar(["--respostas", pronta.respostas(respostasCompletas({ ...BACKUP_LOCAL, ENDERECO: "membros.escola.test" }))]);
  assert.equal(r3.status, 36, r3.saida);
  assert.match(r3.stderr, /esta instalacao e de alunos\.escola\.test, e as respostas dizem membros\.escola\.test em ENDERECO/);
});

test("guiado: pergunta so o que falta, os segredos sem eco, e a Chave em arquivo a parte vale", { skip }, () => {
  const s = servidorDoInstalador();
  const chave = join(s.dir, "chave.txt");
  writeFileSync(chave, `${CHAVE_CERTA}\n`, { mode: 0o600 });
  const parcial = s.respostas({ ENDERECO: `https://${ENDERECO.toUpperCase()}/`, EMAIL_DONO: "dono@escola.test" });
  const r = s.pessoa(["--respostas", parcial, "--ativacao-arquivo", chave], [
    { espera: "Nome da escola \\(o remetente dos e-mails\\): ", responde: "Escola Guiada" },
    { espera: "Chave da API do Resend \\(comeca com re_; nao aparece na tela\\): ", responde: RESEND_CHAVE },
    { espera: "E-mail que envia os e-mails da escola .*\\[escola@mail\\.escola\\.test\\]: ", responde: "" },
    { espera: "Escolha 1, 2 ou 3: ", responde: "3" },
    { espera: "Para confirmar, digite: ACEITO O BACKUP SO NESTE SERVIDOR: ", responde: "aceito o backup so neste servidor" },
    { espera: "Digite s \\(chegou\\) ou n", responde: "s" }
  ]);
  assert.equal(r.status, 0, r.saida);
  assert.doesNotMatch(r.saida, /Endereco da escola \(/, "o endereco veio do arquivo");
  assert.doesNotMatch(r.saida, /Chave de ativacao \(comeca/, "a Chave veio do arquivo");
  assert.ok(!r.saida.includes(RESEND_CHAVE), "a chave do Resend digitada nao aparece (sem eco)");
  semSegredoNaSaida(s, r.saida);
  const env = s.lerSegredos();
  assert.equal(env.SMTP_SENDER_NAME, "Escola Guiada");
  assert.equal(env.APP_PUBLIC_URL, `https://${ENDERECO}`, "https://, maiusculas e a barra saem do endereco");
  assert.equal(s.passos().backup.motivo, "backup so neste servidor, aceito por escrito");
  assert.ok(s.lerJson(s.arquivoDoInstalador).backup_so_neste_servidor.aceito_em);
  // Rodar de novo no terminal: nada e perguntado (as respostas estao no arquivo de segredos e no do instalador).
  const de_novo = s.pessoa([], []);
  assert.equal(de_novo.status, 0, de_novo.saida);
  assert.doesNotMatch(de_novo.saida, /\]: |\): $/m);
});

test("a ativacao: Chave recusada (52), vaga em uso (53), Emissor fora (54), e a imagem sem licenca pula o passo", { skip }, () => {
  const s = servidorDoInstalador();
  const arquivo = s.respostas(respostasCompletas(BACKUP_LOCAL));
  const casos = [
    [{ SHIM_ATIVACAO_ERRO: "chave_usada" }, 52, /Recusado pelo Emissor de mentira: chave_usada/],
    [{ SHIM_ATIVACAO_ERRO: "vaga_em_uso" }, 53, /vaga_em_uso/],
    [{ SHIM_FALHA: "emissor" }, 54, /Sem resposta do Emissor de licencas/]
  ];
  for (const [extra, codigo, frase] of casos) {
    const r = s.rodar(["--respostas", arquivo], extra);
    assert.equal(r.status, codigo, r.saida);
    assert.match(r.saida, frase);
    assert.match(r.stderr, /ou ative pela tela: Configuracoes > Licenca/i);
    assert.equal(s.passos().ativacao.situacao, "falhou");
    assert.equal(s.passos().conferencia_final.situacao, "ok", "a Chave so e gasta no fim");
  }
  const r = s.rodar(["--respostas", arquivo]);
  assert.equal(r.status, 0, r.saida);
  assert.equal(s.shim().licenca.ativacoes, 1);
  // A imagem sem a exigencia de licenca (a nossa escola hoje): o passo pula, e a Chave nem e lida.
  const off = servidorDoInstalador();
  const r2 = off.rodar(["--respostas", off.respostas(respostasCompletas(BACKUP_LOCAL))], { SHIM_LICENCA_MODO: "off" });
  assert.equal(r2.status, 0, r2.saida);
  assert.equal(off.passos().ativacao.situacao, "pulado");
  assert.match(r2.stdout, /Esta imagem nao pede licenca \(modo off\)/);
  assert.equal(contar(off.chamadas(), (c) => c.acao === "licenca-ativar"), 0);
});

test("membros licenca, link-do-dono e diagnostico depois de instalar: sem terminal, nada de Chave nem de link; sem segredo no diagnostico", { skip }, () => {
  const { s } = instalado();
  let r = s.comando("licenca.sh", ["estado"]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /Licenca: ativada/);
  r = s.comando("licenca.sh", ["ativar"]);
  assert.equal(r.status, 7, r.saida);
  assert.match(r.saida, /digitada por uma pessoa no terminal/);
  const chave = join(s.dir, "chave-aberta.txt");
  writeFileSync(chave, CHAVE_CERTA, { mode: 0o644 });
  r = s.comando("licenca.sh", ["ativar", "--chave-arquivo", chave]);
  assert.equal(r.status, 1);
  r = s.comando("dono.sh", []);
  assert.equal(r.status, 7, r.saida);
  assert.doesNotMatch(r.saida, /token_hash/);
  const link = s.pessoa([], [], {}, join(s.pacote, "infra", "kit", "dono.sh"));
  assert.equal(link.status, 0, link.saida);
  assert.match(link.saida, /Link de entrada de dono@escola\.test .*\n\n {2}https:\/\/alunos\.escola\.test\/auth\/confirm\?token_hash=f00dfeed[0-9a-f]+&type=recovery&next=%2Fadmin/);
  // O diagnostico em JSON: a conferencia, os servicos, o backup, a Licenca e o disco, sem segredo nenhum.
  r = s.comando("diagnostico.sh", ["--json"]);
  assert.equal(r.status, 0, r.saida);
  const d = JSON.parse(r.stdout);
  assert.equal(d.versao, "1.0.0");
  assert.equal(d.endereco, ENDERECO);
  assert.equal(d.servicos.length, 8);
  assert.ok(d.servicos.every((c) => c.estado === "running"));
  assert.equal(d.licenca.ativada, true);
  assert.equal(d.instalacao.passos.ativacao.situacao, "ok");
  assert.ok(d.servidor.some((i) => i.id === "dns" && i.situacao === "ok"));
  assert.ok(d.disco.length >= 1);
  assert.ok(d.atencao.includes("nenhum backup feito ainda"), "o backup de mentira nao grava a situacao");
  semSegredoNaSaida(s, r.saida);
  const texto = s.comando("diagnostico.sh", []);
  assert.equal(texto.status, 0, texto.saida);
  assert.match(texto.stdout, /Escola: https:\/\/alunos\.escola\.test \(versao 1\.0\.0\)/);
  assert.match(texto.stdout, /Atencao:/);
});

test("o arquivo do instalador nunca guarda segredo, e o comando do --simular nao cria a pasta do estado", { skip }, () => {
  const s = servidorDoInstalador();
  mkdirSync(join(s.dir, "vazio"));
  const r = s.rodar(["--simular", "--respostas", s.respostas(respostasCompletas())]);
  assert.equal(r.status, 0, r.saida);
  assert.ok(!existsSync(s.estado) || !lstatSync(s.estado).isDirectory() || !existsSync(s.arquivoDoInstalador));
  semSegredoNaSaida({ lerSegredos: () => ({}) }, r.saida);
  assert.ok(!r.saida.includes(CHAVE_CERTA) && !r.saida.includes(RESEND_CHAVE) && !r.saida.includes(AWS_SEGREDO));
});

test("montar o pacote: so a lista fechada, nada de src, tests, docs, infra/cloud ou segredo, e o id da imagem do docker save", { skip }, async () => {
  const { caminhoProibido, arquivosDaLista, imagensDoArquivo } = await import("../infra/kit/montar-pacote.mjs");
  for (const caminho of ["src/server/licensing/artifact.ts", "tests/kit-instalar.test.mjs", "docs/32-produto-licenciado.md", "infra/cloud/deploy.sh", "infra/compose/.env", "infra/compose/.env.local", "chave.pem", "infra/kit/__pycache__/kit.cpython-313.pyc", "infra/licencas/compose.yml"]) {
    assert.ok(caminhoProibido(caminho), caminho);
  }
  for (const caminho of ["infra/kit/instalar", "infra/compose/.env.example", "supabase/migrations/202611100003_license_state.sql"]) assert.ok(!caminhoProibido(caminho), caminho);
  const lista = arquivosDaLista();
  for (const necessario of ["infra/kit/instalar", "infra/kit/instalador.py", "infra/kit/no-app.mjs", "infra/kit/licenca.sh", "infra/kit/kit.conf", "infra/compose/docker-compose.kit.yml", "infra/compose/generate-secrets.mjs", "infra/compose/caddy/Caddyfile.kit", "infra/scripts/smoke.sh", "infra/scripts/restore.sh", "infra/scripts/bootstrap.sh", "infra/compose/volumes/api/envoy/envoy.yaml", "infra/compose/volumes/auth-templates/recovery.html"]) {
    assert.ok(lista.includes(necessario), necessario);
  }
  assert.ok(!lista.some((c) => c.endsWith("montar-pacote.mjs") || c.endsWith("fixar-imagens.mjs") || c.includes("realtime.sql") || c.includes("README")), "so o que o servidor usa");
  const migracoes = lista.filter((c) => c.startsWith("supabase/migrations/"));
  assert.ok(migracoes.length >= 65);
  // O manifesto lista o sha256 de cada arquivo copiado, e o id da imagem sai do docker save.
  const s = servidorDoInstalador();
  const manifesto = JSON.parse(readFileSync(join(s.pacote, "MANIFESTO.json"), "utf8"));
  assert.equal(manifesto.formato, 1);
  assert.equal(manifesto.arquivos.length, lista.length);
  for (const item of manifesto.arquivos.slice(0, 20)) {
    const hash = spawnSync("sha256sum", [join(s.pacote, item.caminho)], { encoding: "utf8" }).stdout.split(" ")[0];
    assert.equal(hash, item.sha256, item.caminho);
  }
  assert.equal(manifesto.arquivos.find((a) => a.caminho === "infra/kit/instalar").modo, "755");
  assert.equal(manifesto.imagens[0].id, s.idDoApp);
  assert.ok(manifesto.imagens_de_terceiros.every((i) => /@sha256:[0-9a-f]{64}$/.test(i)) && manifesto.imagens_de_terceiros.length === 7);
  const outra = imagemDeMentira(s.dir, "escola/terceiros:1", "terceiros");
  assert.deepEqual(imagensDoArquivo(outra.tar), [{ id: outra.id, tags: ["escola/terceiros:1"] }]);
  // A pasta de saida que ja tem coisa: recusada.
  const r = spawnSync(process.execPath, [join(kitDir, "montar-pacote.mjs"), "--versao", "1.0.0", "--app", outra.tar, "--saida", s.pacote], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nao esta vazia/);
  // A assinatura do montar-pacote confere com o openssl de verdade (o mesmo comando do instalador).
  const par = generateKeyPairSync("ed25519");
  const saida = join(s.dir, "assinado");
  montarPacote({ saida, versao: "2.0.0", app: outra.tar, chavePrivada: par.privateKey });
  const pem = join(s.dir, "pub.pem");
  writeFileSync(pem, par.publicKey.export({ type: "spki", format: "pem" }));
  const sig = join(s.dir, "sig.bin");
  writeFileSync(sig, Buffer.from(readFileSync(join(saida, "MANIFESTO.json.assinatura"), "utf8").trim(), "base64"));
  const v = spawnSync("openssl", ["pkeyutl", "-verify", "-pubin", "-inkey", pem, "-rawin", "-in", join(saida, "MANIFESTO.json"), "-sigfile", sig], { encoding: "utf8" });
  assert.equal(v.status, 0, v.stderr);
});
