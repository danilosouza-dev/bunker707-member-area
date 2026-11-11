import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";

import { arquivosDaLista } from "../infra/kit/montar-pacote.mjs";
import { arquivoDaChave, confirmarKit, faltam, kitDir, limparKitDeMentira, SEGREDOS, servidorDoKit } from "./fixtures/kit-de-mentira.mjs";

// O comando de operacao do kit (infra/kit/membros; docs/32 §3.2 e §4; docs/20 §9B): backup para um destino generico,
// kit de recuperacao, ensaio de restauracao isolado, restauracao de verdade e a situacao sem segredo. Os scripts de
// verdade rodam com docker, restic, systemctl e df de mentira (tests/fixtures/kit-de-mentira.mjs) e, quando o passo
// mostra ou pede uma chave, com uma pessoa num pseudo-terminal. O restic de verdade roda em
// tests/kit-membros-restic.test.mjs.

after(limparKitDeMentira);
const skip = faltam.length ? `faltam ${faltam.join(", ")}` : false;
const docker = (chamadas) => chamadas.filter((c) => c.tool === "docker");
const restic = (chamadas, sub) => chamadas.filter((c) => c.tool === "restic" && c.args[0] === sub);
const todosOsArquivos = (pasta) => {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta, { recursive: true }).map((n) => join(pasta, n)).filter((p) => statSync(p).isFile());
};

/** Um servidor com o repositorio criado e um backup feito (destino S3 de mentira). */
function servidorComBackup(opcoes) {
  const s = servidorDoKit(opcoes);
  assert.equal(s.rodar(["backup", "--iniciar"]).status, 0);
  const r = s.rodar(["backup"]);
  assert.equal(r.status, 0, r.saida);
  return s;
}

test("os scripts do kit: sintaxe do bash, a guarda do dash, o kit.py compila e o membros despacha", { skip }, () => {
  for (const nome of ["membros", "backup.sh", "ensaio.sh", "restaurar.sh", "recuperacao.sh", "status.sh", "lib-kit.sh"]) {
    const r = spawnSync("bash", ["-n", join(kitDir, nome)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${nome}: ${r.stderr}`);
    if (nome === "lib-kit.sh") continue;
    const fonte = readFileSync(join(kitDir, nome), "utf8");
    assert.match(fonte, /^#!\/usr\/bin\/env bash\n/, nome);
    assert.ok(fonte.includes('[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"'), `${nome}: sem a guarda do dash`);
  }
  const py = spawnSync("python3", ["-I", "-c", "import ast, sys; ast.parse(open(sys.argv[1]).read())", join(kitDir, "kit.py")], { encoding: "utf8" });
  assert.equal(py.status, 0, py.stderr);
  const s = servidorDoKit();
  const ajuda = s.rodar(["ajuda"]);
  assert.equal(ajuda.status, 0);
  for (const sub of ["status", "backup", "restaurar --ensaio", "kit-de-recuperacao", "migrar"]) assert.ok(ajuda.stdout.includes(`membros ${sub}`), sub);
  const errado = s.rodar(["apagar-tudo"]);
  assert.equal(errado.status, 1);
  assert.match(errado.stderr, /subcomando desconhecido: apagar-tudo/);
  for (const [sub, texto] of [["backup", /--conferir-destino/], ["restaurar", /--snapshot ID/], ["kit-de-recuperacao", /--nova/], ["status", /--json/]]) {
    const r = s.rodar([sub, "--help"]);
    assert.equal(r.status, 0, sub);
    assert.match(r.stdout, texto, sub);
  }
  assert.match(s.rodar(["restaurar", "--ensaio", "--help"]).stdout, /Postgres temporario e isolado/);
});

test("os nomes tecnicos (projeto, containers, volumes, pastas) so existem no kit.conf (A10)", () => {
  // O que vai ao comprador (a lista do pacote). As ferramentas so nossas, que ficam fora do pacote (montar-pacote,
  // pacote-escola, conferir-imagem, fixar-imagens), podem citar o nosso dominio (o Emissor, a guarda da imagem).
  const doPacote = new Set(arquivosDaLista().filter((c) => c.startsWith("infra/kit/")).map((c) => c.slice("infra/kit/".length)));
  assert.ok(doPacote.has("instalar") && doPacote.has("membros") && doPacote.has("kit.conf"));
  for (const nome of readdirSync(kitDir)) {
    if (nome === "kit.conf" || !doPacote.has(nome)) continue;
    const fonte = readFileSync(join(kitDir, nome), "utf8");
    // BUNKER707_* sao as variaveis do infra/scripts/lib.sh, nao nomes que o comprador ve.
    assert.doesNotMatch(fonte, /bunker707/, `${nome} escreve o nome; ele vem de kit.conf`);
  }
  for (const soNosso of readdirSync(kitDir).filter((nome) => !doPacote.has(nome) && !nome.endsWith(".pyc") && nome !== "__pycache__")) {
    assert.ok(["fixar-imagens.mjs", "montar-pacote.mjs", "pacote-escola.mjs", "conferir-imagem.mjs"].includes(soNosso), `${soNosso} fica fora do pacote sem estar na lista do que e so nosso`);
  }
  const conf = readFileSync(join(kitDir, "kit.conf"), "utf8");
  for (const variavel of ["KIT_NOME", "KIT_PROJETO_COMPOSE", "KIT_CONTAINERS_DA_ESCOLA", "KIT_VOLUMES_DA_ESCOLA", "KIT_PASTA_ESTADO", "KIT_PASTA_BACKUP", "KIT_UNIDADE_BACKUP", "KIT_BACKUP_TAG", "KIT_ENSAIO_PREFIXO"]) {
    assert.match(conf, new RegExp(`^${variavel}="\\$\\{${variavel}:-`, "m"), variavel);
  }
  assert.match(conf, /^KIT_NOME="\$\{KIT_NOME:-membros\}"$/m, "o padrao e o nome neutro (docs/32 item 17)");
});

test("destino: S3 (B2, R2, Wasabi), SFTP e pasta; recusa o que nao serve, pede a chave de acesso e nunca repete segredo", { skip }, () => {
  const casos = [
    ["s3:https://s3.us-east-005.backblazeb2.com/escola-backup/membros", 0, /armazenamento S3 em s3\.us-east-005\.backblazeb2\.com/],
    ["s3:https://0123abc.r2.cloudflarestorage.com/backup-escola", 0, /armazenamento S3 em 0123abc\.r2\.cloudflarestorage\.com/],
    ["s3:s3.wasabisys.com/escola", 0, /armazenamento S3 em s3\.wasabisys\.com/],
    ["sftp:backup@cofre.exemplo.com:/srv/escola", 0, /servidor SFTP cofre\.exemplo\.com/],
    ["sftp://backup@cofre.exemplo.com:2222//srv/escola", 0, /servidor SFTP cofre\.exemplo\.com/],
    ["/mnt/backup/escola", 2, /A pasta do backup \(\/mnt\/backup\/escola\) nao existe/],
    ["s3:https://s3.us-east-005.backblazeb2.com", 1, /precisa do nome do bucket/],
    ["s3:http://s3.wasabisys.com/escola", 1, /precisa de https/],
    ["b2:escola-backup:membros", 1, /não usa o tipo b2:[\s\S]*use o endereço S3 do bucket/],
    ["rest:https://cofre.exemplo.com/", 1, /não usa o tipo rest:/],
    ["backups/escola", 1, /que o kit não reconhece/],
    ["/", 1, /Escolha uma pasta própria/],
    ["", 1, /Sem destino do backup/]
  ];
  for (const [repo, status, mensagem] of casos) {
    const s = servidorDoKit({ segredos: { RESTIC_REPOSITORY: repo } });
    const r = s.rodar(["backup", "--conferir-destino"]);
    assert.equal(r.status, status, `${repo}: ${r.saida}`);
    assert.match(r.saida, mensagem, repo);
  }
  // A chave de acesso no endereco e recusada sem ser repetida.
  const comChave = servidorDoKit({ segredos: { RESTIC_REPOSITORY: "s3:https://AKIA:segredo-no-endereco@s3.wasabisys.com/escola" } });
  const r1 = comChave.rodar(["backup", "--conferir-destino"]);
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /Nunca ponha a chave de acesso no endereço/);
  assert.doesNotMatch(r1.saida, /segredo-no-endereco/);
  // S3 sem a chave de acesso no arquivo de segredos.
  const semChave = servidorDoKit({ segredos: { AWS_SECRET_ACCESS_KEY: undefined } });
  const r2 = semChave.rodar(["backup", "--conferir-destino"]);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY/);
  // Pasta local que existe: aceita, com o aviso de que morre junto.
  const local = servidorDoKit();
  mkdirSync(join(local.dir, "disco"));
  local.escreverSegredos({ ...local.valores, RESTIC_REPOSITORY: join(local.dir, "disco", "escola") });
  const r3 = local.rodar(["backup", "--conferir-destino"]);
  assert.equal(r3.status, 0, r3.saida);
  assert.match(r3.stdout, /pasta deste servidor .*se o servidor morrer, o backup morre junto/);
  assert.match(r3.stdout, /Ainda nao ha backup nesse destino/);
  // O destino que recusa a chave de acesso (2), o repositorio de outro servidor (5) e o que abre (0).
  const s = servidorDoKit();
  assert.equal(s.rodar(["backup", "--iniciar"]).status, 0);
  const fora = s.rodar(["backup", "--conferir-destino"], { SHIM_RESTIC_DESTINO_FORA: "1" });
  assert.equal(fora.status, 2);
  assert.match(fora.stderr, /recusou a chave de acesso: Fatal: unable to open config file: Stat: Access Denied/);
  assert.match(s.rodar(["backup", "--conferir-destino"]).stdout, /O backup abre com a senha deste servidor/);
  s.escreverSegredos({ ...s.valores, RESTIC_PASSWORD: "senha-de-outro-servidor-9999" });
  const outro = s.rodar(["backup", "--conferir-destino"]);
  assert.equal(outro.status, 5);
  assert.match(outro.stderr, /nao abre/);
  // O restic sempre recebe a chave de acesso pelo ambiente (nunca pela linha de comando).
  for (const c of s.chamadas().filter((c) => c.tool === "restic")) {
    assert.equal(c.aws, "com-chave");
    assert.doesNotMatch(JSON.stringify(c.args), /segredo-da-chave|senha-/);
  }
  // O restic velho (o 0.14 do apt do Debian 12, sem --retry-lock): para com a frase do que fazer, sem chamar o destino.
  s.limparLog();
  const velho = s.rodar(["backup"], { SHIM_RESTIC_VERSAO: "restic 0.14.0 compiled with go1.19.8 on linux/amd64" });
  assert.equal(velho.status, 1, velho.saida);
  assert.match(velho.stderr, /O restic deste servidor e o 0\.14\.0, e o backup do kit pede o 0\.16 ou mais novo: rode sudo restic self-update/);
  assert.equal(s.chamadas().filter((c) => c.tool === "restic").length, 0);
});

test("backup: exporta de dentro do container do banco, envia com as marcas, retencao por host e marcas, e grava a situacao", { skip }, () => {
  const s = servidorDoKit();
  const init = s.rodar(["backup", "--iniciar"]);
  assert.equal(init.status, 0, init.saida);
  assert.match(init.stdout, /Criando o repositorio do backup em armazenamento S3 em s3\.us-east-005\.backblazeb2\.com/);
  assert.equal(restic(s.chamadas(), "init").length, 1);
  assert.equal(s.rodar(["backup", "--iniciar"]).status, 0, "--iniciar de novo nao cria outro");
  assert.equal(restic(s.chamadas(), "init").length, 1);
  s.limparLog();

  const r = s.rodar(["backup"]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /Backup [0-9a-f]{8} concluido \(com-dados;/);
  const chamadas = s.chamadas();
  const exec = docker(chamadas).filter((c) => c.args.includes("exec")).map((c) => c.args.slice(c.args.indexOf("db") + 1).join(" "));
  assert.deepEqual(exec, [
    "pg_dumpall -U supabase_admin -h 127.0.0.1 --roles-only",
    "pg_dump -U supabase_admin -h 127.0.0.1 -d postgres -Fc",
    "cat /etc/postgresql-custom/pgsodium_root.key",
    "psql -U supabase_admin -h 127.0.0.1 -d postgres -X -At -c select count(*) from auth.users"
  ]);
  const etapa = join(s.backups, "atual");
  const [envio] = restic(chamadas, "backup");
  assert.deepEqual(envio.args, ["backup", "--host", "membros", "--tag", "membros", "--tag", "com-dados", etapa, s.storage]);
  assert.equal(envio.senhaNoAmbiente, true, "o backup diario usa a senha do servidor");
  const [esquece] = restic(chamadas, "forget");
  assert.deepEqual(esquece.args, ["forget", "--host", "membros", "--tag", "membros", "--group-by", "host,tags", "--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "6", "--prune"]);
  // O que foi para o backup: o dump, os papeis, a chave do Vault, o arquivo de segredos e os arquivos do Storage.
  const [snap] = s.resticEstado().repos[s.valores.RESTIC_REPOSITORY].snapshots;
  const caminhos = Object.keys(snap.arquivos).sort();
  for (const nome of ["env", "pgsodium_root.key", "postgres.dump", "roles.sql"]) assert.ok(caminhos.includes(join(etapa, nome)), nome);
  assert.equal(caminhos.filter((p) => p.startsWith(s.storage)).length, 3);
  assert.equal(existsSync(etapa), false, "a exportacao em texto claro sai do disco depois do envio");
  const b = s.situacao().backup;
  assert.equal(b.ultimo_resultado, "ok");
  assert.equal(b.em_andamento, false);
  assert.equal(b.estado, "com-dados");
  assert.equal(b.destino_tipo, "s3");
  assert.equal(b.destino_servidor, "s3.us-east-005.backblazeb2.com");
  assert.equal(b.snapshot, snap.id.slice(0, 8));
  assert.equal(b.storage_arquivos, 3);
  assert.deepEqual(b.retencao, { diarios: 7, semanais: 4, mensais: 6 });
  assert.match(b.ultimo_sucesso, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(statSync(join(s.estado, "situacao.json")).mode & 0o777, 0o644, "a situacao e lida sem sudo");

  // Instalacao vazia (sem conta): marcada `vazio`; retencao do arquivo de segredos; retencao invalida ou toda zero.
  s.limparLog();
  assert.equal(s.rodar(["backup"], { SHIM_CONTAS: "0" }).status, 0);
  assert.deepEqual(restic(s.chamadas(), "backup")[0].args.slice(3, 7), ["--tag", "membros", "--tag", "vazio"]);
  s.escreverSegredos({ ...s.valores, BACKUP_KEEP_DAILY: "14", BACKUP_KEEP_WEEKLY: "8", BACKUP_KEEP_MONTHLY: "12" });
  s.limparLog();
  assert.equal(s.rodar(["backup"]).status, 0);
  assert.deepEqual(restic(s.chamadas(), "forget")[0].args.slice(7, 13), ["--keep-daily", "14", "--keep-weekly", "8", "--keep-monthly", "12"]);
  s.escreverSegredos({ ...s.valores, BACKUP_KEEP_DAILY: "sete" });
  assert.match(s.rodar(["backup"]).stderr, /BACKUP_KEEP_DAILY precisa ser um numero/);
  s.escreverSegredos({ ...s.valores, BACKUP_KEEP_DAILY: "0", BACKUP_KEEP_WEEKLY: "0", BACKUP_KEEP_MONTHLY: "0" });
  const zero = s.rodar(["backup"]);
  assert.equal(zero.status, 1);
  assert.match(zero.stderr, /A retencao nao pode ser zero em tudo/);
});

test("backup que falha: a situacao diz o motivo, o ultimo bom continua e a exportacao sai do disco", { skip }, () => {
  const s = servidorComBackup();
  const bom = s.situacao().backup.ultimo_sucesso;
  s.limparLog();
  const r = s.rodar(["backup"], { SHIM_PG_DUMP_FALHA: "1" });
  assert.equal(r.status, 3, r.saida);
  assert.equal(restic(s.chamadas(), "backup").length, 0, "nada vai para o destino");
  const b = s.situacao().backup;
  assert.equal(b.ultimo_resultado, "falhou");
  assert.equal(b.ultimo_erro, "a exportacao do banco falhou");
  assert.equal(b.ultimo_sucesso, bom);
  assert.equal(b.em_andamento, false);
  assert.equal(existsSync(join(s.backups, "atual")), false);
  assert.match(s.rodar(["status"]).stdout, /A última tentativa .* falhou: a exportacao do banco falhou/);
  // Destino fora do ar: codigo 2, sem exportar nada.
  s.limparLog();
  const fora = s.rodar(["backup"], { SHIM_RESTIC_DESTINO_FORA: "1" });
  assert.equal(fora.status, 2);
  assert.equal(docker(s.chamadas()).filter((c) => c.args.includes("exec")).length, 0);
  assert.equal(s.situacao().backup.ultimo_erro, "o destino nao abriu");
});

test("trava: um backup, ensaio ou kit por vez; o agendado espera e desiste com 4", { skip }, async () => {
  const s = servidorComBackup();
  writeFileSync(s.trava, "");
  // -o: o sleep nao herda a trava, e matar o flock solta.
  const segura = spawn("flock", ["-o", s.trava, "sleep", "30"], { stdio: "ignore" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    s.limparLog();
    const r = s.rodar(["backup"]);
    assert.equal(r.status, 4, r.saida);
    assert.match(r.stderr, /Outra operacao do backup esta rodando neste servidor agora/);
    assert.equal(s.chamadas().filter((c) => c.tool === "restic" || (c.tool === "docker" && c.args.includes("exec"))).length, 0);
    const agendado = s.rodar(["backup", "--agendado"], { KIT_TRAVA_ESPERA: "1" });
    assert.equal(agendado.status, 4);
    const chave = arquivoDaChave(s, "QUALQUER-COISA");
    assert.equal(s.rodar(["restaurar", "--ensaio", "--chave-arquivo", chave]).status, 4);
    assert.equal(s.pessoa(["kit-de-recuperacao"], []).status, 4);
    assert.equal(restic(s.chamadas(), "key").length, 0);
  } finally {
    segura.kill();
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(s.rodar(["backup"]).status, 0, "solta a trava, volta a rodar");
});

test("backup parado enquanto a instalacao espera a restauracao (modo de restauracao)", { skip }, () => {
  const s = servidorComBackup();
  writeFileSync(join(s.estado, "restauracao-pendente"), "2026-11-11T10:00:00Z\n");
  s.limparLog();
  const r = s.rodar(["backup", "--agendado"]);
  assert.equal(r.status, 9);
  assert.match(r.stderr, /espera a restauracao de um backup/);
  assert.equal(restic(s.chamadas(), "backup").length, 0);
});

test("backup --agendado confere 10% dos dados uma vez por semana; --conferir na hora; problema na conferencia da 3", { skip }, () => {
  const s = servidorComBackup();
  s.limparLog();
  assert.equal(s.rodar(["backup", "--agendado"]).status, 0);
  assert.deepEqual(restic(s.chamadas(), "check")[0].args, ["check", "--read-data-subset=10%"]);
  assert.equal(s.situacao().backup.ultima_conferencia_resultado, "ok");
  s.limparLog();
  assert.equal(s.rodar(["backup", "--agendado"]).status, 0);
  assert.equal(restic(s.chamadas(), "check").length, 0, "a conferencia desta semana ja foi feita");
  const situacao = JSON.parse(readFileSync(join(s.estado, "situacao.json"), "utf8"));
  situacao.backup.ultima_conferencia = new Date(Date.now() - 8 * 86400e3).toISOString().replace(/\.\d+Z$/, "Z");
  writeFileSync(join(s.estado, "situacao.json"), JSON.stringify(situacao));
  s.limparLog();
  assert.equal(s.rodar(["backup", "--agendado"]).status, 0);
  assert.equal(restic(s.chamadas(), "check").length, 1, "oito dias depois, confere de novo");
  const ruim = s.rodar(["backup", "--conferir"], { SHIM_RESTIC_CHECK_FALHA: "1" });
  assert.equal(ruim.status, 3);
  assert.match(ruim.stderr, /a conferencia do repositorio \(restic check\) achou problema/);
  assert.equal(s.situacao().backup.ultimo_resultado, "ok", "o backup em si foi feito");
  assert.equal(s.situacao().backup.ultima_conferencia_resultado, "falhou");
  assert.match(s.rodar(["status"]).stdout, /achou problema: sudo membros backup --conferir/);
});

test("backup --instalar-agendamento: servico e timer com os nomes do kit.conf, no horario de Brasilia", { skip }, () => {
  const s = servidorDoKit();
  const r = s.rodar(["backup", "--instalar-agendamento"]);
  assert.equal(r.status, 0, r.saida);
  const servico = readFileSync(join(s.systemd, "membros-backup.service"), "utf8");
  const timer = readFileSync(join(s.systemd, "membros-backup.timer"), "utf8");
  assert.match(servico, new RegExp(`ExecStart=/usr/bin/env bash ${kitDir.replace(/\/$/, "")}/membros backup --agendado`));
  assert.match(servico, /Nice=10/);
  assert.match(timer, /OnCalendar=\*-\*-\* 03:30:00 America\/Sao_Paulo/);
  assert.match(timer, /Persistent=true/);
  assert.deepEqual(s.chamadas().filter((c) => c.tool === "systemctl").map((c) => c.args.join(" ")), ["daemon-reload", "enable --now membros-backup.timer"]);
  const outro = servidorDoKit();
  assert.equal(outro.rodar(["backup", "--instalar-agendamento"], { KIT_NOME: "escola", KIT_HORA_DO_BACKUP: "02:15" }).status, 0);
  assert.match(readFileSync(join(outro.systemd, "escola-backup.timer"), "utf8"), /02:15:00 America\/Sao_Paulo/);
  assert.equal(outro.rodar(["backup", "--instalar-agendamento"], { KIT_HORA_DO_BACKUP: "3h" }).status, 1);
});

test("kit de recuperacao sem terminal (a IA rodando o comando): para com 7 e nao cria chave nenhuma", { skip }, () => {
  const s = servidorComBackup();
  s.limparLog();
  const r = s.rodar(["kit-de-recuperacao"]);
  assert.equal(r.status, 7);
  assert.match(r.stderr, /so a pessoa pode ver: rode no terminal do servidor/);
  assert.equal(s.chamadas().filter((c) => c.tool === "restic" && c.args[0] === "key").length, 0);
  assert.equal(s.resticEstado().repos[s.valores.RESTIC_REPOSITORY].chaves.length, 1);
});

test("kit de recuperacao: a folha com o destino e a chave, a confirmacao digitada e a chave fora do servidor depois", { skip }, () => {
  const s = servidorComBackup();
  s.limparLog();
  const r = confirmarKit(s);
  assert.equal(r.status, 0, r.saida);
  const { chave } = r;
  assert.match(chave, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/, "8 grupos de 4, sem I, L, O e U");
  // A folha: a escola, o destino, a identificacao da chave de acesso (nunca o segredo dela), a chave e o que fazer.
  assert.match(r.saida, /FOLHA DE RECUPERAÇÃO DA ESCOLA alunos\.escola\.test/);
  assert.match(r.saida, /Destino: {2}s3:https:\/\/s3\.us-east-005\.backblazeb2\.com\/escola-backup\/membros/);
  assert.match(r.saida, /a chave de acesso 005chaveDeAcessoId do armazenamento/);
  assert.match(r.saida, /3\. SE O SERVIDOR MORRER[\s\S]*sudo membros restaurar[\s\S]*4\. TESTE ANTES DE PRECISAR[\s\S]*sudo membros restaurar --ensaio/);
  assert.doesNotMatch(r.saida, new RegExp(SEGREDOS.AWS_SECRET_ACCESS_KEY));
  assert.doesNotMatch(r.saida, new RegExp(SEGREDOS.RESTIC_PASSWORD));
  const folha = r.saida.slice(r.saida.indexOf("FOLHA DE RECUPERAÇÃO"), r.saida.indexOf("5. SE PERDER ESTA FOLHA") + 200);
  assert.ok(folha.split("\n").length <= 60, "cabe numa pagina");
  assert.match(r.saida, /Kit de recuperacao confirmado\. A chave saiu deste servidor/);
  // A chave entrou no repositorio por arquivo (na pasta da memoria), e abre o backup.
  const [adicao] = restic(s.chamadas(), "key").filter((c) => c.args[1] === "add");
  assert.ok(adicao.args[3].startsWith(s.temporaria), adicao.args[3]);
  const repo = s.resticEstado().repos[s.valores.RESTIC_REPOSITORY];
  assert.equal(repo.chaves.length, 2);
  assert.equal(repo.chaves[1].senha, chave);
  // Depois da confirmacao: so o identificador fica; nenhum arquivo do servidor tem a chave.
  const rec = s.situacao().recuperacao;
  assert.equal(rec.chave_id, repo.chaves[1].id.slice(0, 8));
  assert.equal(rec.pendente_id, undefined);
  for (const arquivo of [...todosOsArquivos(s.estado), ...todosOsArquivos(s.backups), ...todosOsArquivos(s.temporaria), s.envFile]) {
    assert.doesNotMatch(readFileSync(arquivo, "utf8"), new RegExp(chave), arquivo);
  }
  assert.deepEqual(readdirSync(s.temporaria), [], "a pasta da memoria fica vazia");
  // De novo, sem --nova: nao gera outra.
  const deNovo = s.pessoa(["kit-de-recuperacao"], []);
  assert.equal(deNovo.status, 0);
  assert.match(deNovo.saida, /Ja ha um kit de recuperacao confirmado/);
  assert.equal(s.resticEstado().repos[s.valores.RESTIC_REPOSITORY].chaves.length, 2);
});

test("kit de recuperacao: resposta errada deixa a folha pendente (0600) e a mesma folha volta na vez seguinte", { skip }, () => {
  const s = servidorComBackup();
  const errado = s.pessoa(["kit-de-recuperacao"], [1, 2, 3].map(() => ({ espera: "digite o grupo (\\d) e o grupo (\\d)", responde: "ZZZZZZZZ" })));
  assert.equal(errado.status, 6, errado.saida);
  assert.match(errado.saida, /Nao confere\.[\s\S]*Nao confere\.[\s\S]*Nao confere\./);
  assert.match(errado.saida, /continua pendente/);
  const chave = /^\s+([0-9A-Z]{4}(?:-[0-9A-Z]{4}){7})\s*$/m.exec(errado.saida)[1];
  const pendente = join(s.estado, "recuperacao", "folha-pendente.txt");
  assert.equal(statSync(pendente).mode & 0o777, 0o600);
  assert.equal(statSync(join(s.estado, "recuperacao")).mode & 0o777, 0o700);
  assert.ok(s.situacao().recuperacao.pendente_id);
  assert.match(s.rodar(["status"]).stdout, /PENDENTE desde/);
  assert.equal(s.rodar(["kit-de-recuperacao", "--conferir"]).status, 6);
  s.limparLog();
  const certo = confirmarKit(s);
  assert.equal(certo.status, 0, certo.saida);
  assert.equal(certo.chave, chave, "a mesma folha");
  assert.match(certo.saida, /ainda nao foi confirmada: e ela de novo/);
  assert.equal(restic(s.chamadas(), "key").filter((c) => c.args[1] === "add").length, 0, "nenhuma chave nova");
  assert.equal(existsSync(pendente), false);
  assert.equal(s.rodar(["kit-de-recuperacao", "--conferir"]).status, 0);
});

test("kit de recuperacao --nova: a chave antiga so sai do backup quando a nova e confirmada; --conferir ve a chave no backup", { skip }, () => {
  const s = servidorComBackup();
  const primeira = confirmarKit(s);
  const repo = () => s.resticEstado().repos[s.valores.RESTIC_REPOSITORY];
  const idAntiga = repo().chaves[1].id;
  const pendente = s.pessoa(["kit-de-recuperacao", "--nova"], [1, 2, 3].map(() => ({ espera: "digite o grupo (\\d) e o grupo (\\d)", responde: "errado" })));
  assert.equal(pendente.status, 6);
  assert.deepEqual(repo().chaves.map((c) => c.senha).slice(1, 2), [primeira.chave], "a antiga continua valendo");
  assert.equal(repo().chaves.length, 3);
  const nova = confirmarKit(s);
  assert.equal(nova.status, 0, nova.saida);
  assert.notEqual(nova.chave, primeira.chave);
  assert.match(nova.saida, new RegExp(`A chave da folha antiga \\(${idAntiga.slice(0, 8)}\\) saiu do backup`));
  assert.deepEqual(repo().chaves.map((c) => c.senha), [SEGREDOS.RESTIC_PASSWORD, nova.chave]);
  assert.equal(s.rodar(["kit-de-recuperacao", "--conferir"]).status, 0);
  // Alguem tirou a chave do backup: --conferir avisa.
  const estado = s.resticEstado();
  estado.repos[s.valores.RESTIC_REPOSITORY].chaves.pop();
  s.gravarResticEstado(estado);
  const sumiu = s.rodar(["kit-de-recuperacao", "--conferir"]);
  assert.equal(sumiu.status, 6);
  assert.match(sumiu.stderr, /nao esta mais no backup: gere outra/);
});

/** Um servidor com backup e kit confirmado, e o arquivo com a chave da folha (para o ensaio sem terminal). */
function servidorProntoParaEnsaio(opcoes) {
  const s = servidorComBackup(opcoes);
  const { chave } = confirmarKit(s);
  return { s, chave, arquivo: arquivoDaChave(s, chave) };
}

test("ensaio: abre com a chave de recuperacao num banco sem rede, sem porta e com teto, confere a escola e apaga tudo", { skip }, () => {
  const { s, chave, arquivo } = servidorProntoParaEnsaio();
  s.limparLog();
  const r = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /Ensaio de restauração: DEU CERTO/);
  assert.match(r.stdout, /abriu com a chave de recuperação/);
  assert.match(r.stdout, /Dentro dele: 40 contas; 30 alunos com acesso; 2 conteúdos do catálogo; 12 aulas; 30 acessos; 7 registros de progresso; a licença da escola \(ativada\); 3 de 3 arquivos do Storage\./);
  assert.match(r.stdout, /A escola nao foi tocada/);
  const chamadas = s.chamadas();

  // O restic do ensaio so usa a chave de recuperacao, por arquivo, e baixa so o dump, os papeis e a chave do Vault.
  const doEnsaio = chamadas.filter((c) => c.tool === "restic");
  const idRecuperacao = s.resticEstado().repos[s.valores.RESTIC_REPOSITORY].chaves.find((c) => c.senha === chave).id;
  for (const c of doEnsaio) {
    assert.equal(c.chave, idRecuperacao, `${c.args[0]} com a chave de recuperacao`);
    assert.equal(c.porArquivo, true);
    assert.equal(c.senhaNoAmbiente, false, "a senha do servidor fica fora do ensaio");
  }
  const [restauracao] = restic(chamadas, "restore");
  const incluidos = restauracao.args.filter((_, i, l) => l[i - 1] === "--include").map((p) => p.split("/").pop());
  assert.deepEqual(incluidos.sort(), ["pgsodium_root.key", "postgres.dump", "roles.sql"], "nem o arquivo de segredos nem o Storage");

  // O container do ensaio: sem rede, sem porta, sem privilegio, com teto, e so as pastas do proprio ensaio.
  const d = docker(chamadas);
  const criar = d.find((c) => c.args[0] === "create").args;
  const opcao = (nome) => criar[criar.indexOf(nome) + 1];
  assert.match(opcao("--name"), /^membros-ensaio-\d{14}-\d+$/);
  const id = opcao("--name").replace("membros-ensaio-", "");
  assert.equal(opcao("--label"), `membros.ensaio=${id}`);
  assert.equal(opcao("--network"), "none");
  assert.equal(opcao("--memory"), "512m");
  assert.equal(opcao("--memory-swap"), "512m");
  assert.equal(opcao("--cpus"), "1");
  assert.equal(opcao("--pids-limit"), "512");
  assert.equal(opcao("--restart"), "no");
  for (const proibido of ["-p", "--publish", "-P", "--publish-all", "--privileged", "--volumes-from", "--pid", "--ipc", "--cap-add", "--network=host", "--net"]) {
    assert.equal(criar.includes(proibido), false, `sem ${proibido}`);
  }
  const pastaDoEnsaio = join(s.backups, "ensaio", id);
  const volumes = criar.filter((_, i, l) => l[i - 1] === "-v");
  assert.equal(volumes.length, 2);
  for (const v of volumes) assert.ok(v.startsWith(pastaDoEnsaio + "/"), v);
  assert.deepEqual(volumes.map((v) => v.split(":").slice(1).join(":")), ["/var/lib/postgresql/data", "/ensaio:ro"]);
  assert.ok(opcao("--env-file").startsWith(pastaDoEnsaio + "/"), "a senha do banco temporario nunca vai na linha de comando");
  const imagem = criar.indexOf("supabase/postgres:17.6.1.136");
  assert.ok(imagem > 0, "a imagem do banco da escola, ja no servidor");
  assert.deepEqual(criar.slice(imagem + 1).filter((a) => a.startsWith("cron.") || a.startsWith("shared_buffers")), ["shared_buffers=64MB", "cron.launch_active_jobs=off"]);
  const textoCriar = criar.join(" ");
  for (const daEscola of ["membros-db", "membros_db-config", "volumes/db/data", s.storage, "docker.sock"]) assert.ok(!textoCriar.includes(daEscola), daEscola);

  // Nada da escola e tocado: o compose so e lido; todo exec, cp, start e rm e no container do ensaio.
  assert.deepEqual(d.filter((c) => c.args[0] === "compose").map((c) => c.args.at(-2) === "config" || c.args.includes("config")), [true]);
  for (const c of d.filter((c) => ["exec", "cp", "start", "logs", "inspect"].includes(c.args[0]))) {
    assert.ok(c.args.some((a) => a === opcao("--name") || a.startsWith(opcao("--name") + ":")), c.args.join(" "));
  }
  const ordem = ["create", "inspect", "cp", "start"].map((sub) => d.findIndex((c) => c.args[0] === sub));
  assert.ok(ordem.every((i, n) => i >= 0 && (n === 0 || i > ordem[n - 1])), `isolamento conferido antes de ligar: ${ordem}`);
  const sql = d.filter((c) => c.args[0] === "exec" && c.args[1] === "-i").map((c) => c.stdin).join("\n");
  assert.match(sql, /revoke all on tables from postgres, anon, authenticated, service_role/);
  assert.match(sql, /grant all on tables to postgres, anon, authenticated, service_role/);
  assert.ok(d.some((c) => c.args[0] === "exec" && c.args.includes("pg_restore") && c.args.includes("--clean")));
  // Os papeis do backup trazem a senha que o supabase_admin tem na escola (o docker de mentira so deixa entrar com a
  // senha que o papel tem agora): na mesma sessao, a senha sorteada do banco temporario volta, pela entrada do psql.
  const papeis = d.find((c) => c.args[0] === "exec" && c.args[1] === "-i" && c.stdin.includes("CREATE ROLE anon"));
  assert.ok(papeis, "os papeis do backup foram aplicados");
  assert.match(papeis.stdin, /PASSWORD 'SCRAM-SHA-256\$[\s\S]*\nALTER ROLE supabase_admin WITH PASSWORD '[0-9a-f]{48}';\n$/);
  assert.ok(!papeis.args.join(" ").match(/[0-9a-f]{48}/), "a senha nunca na linha de comando");
  // Toda conexao ao banco do ensaio e pelo 127.0.0.1 de dentro do container, como no restore.sh.
  for (const c of d.filter((c) => c.args[0] === "exec" && (c.args.includes("psql") || (c.args.includes("pg_restore") && !c.args.includes("--list"))))) {
    assert.equal(c.args[c.args.indexOf("-h") + 1], "127.0.0.1", c.args.join(" "));
  }

  // Tudo apagado: o container, a pasta do ensaio e a chave digitada; e a situacao sem as contas pessoais.
  assert.deepEqual(d.filter((c) => c.args[0] === "rm").map((c) => c.args.at(-1)), [opcao("--name"), opcao("--name")]);
  assert.equal(existsSync(join(s.backups, "ensaio")), false);
  assert.deepEqual(readdirSync(s.temporaria), []);
  const e = s.situacao().ensaio;
  assert.equal(e.resultado, "ok");
  assert.equal(e.contagens.contas, 40);
  assert.match(s.rodar(["status"]).stdout, /Ensaio de restauração\n {2}.*: deu certo, com o backup de/);
});

test("ensaio: o container que nao ficou isolado e apagado sem ligar", { skip }, () => {
  const { s, arquivo } = servidorProntoParaEnsaio();
  s.limparLog();
  const r = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], { SHIM_INSPECT_REDE: "membros_default" });
  assert.equal(r.status, 3, r.saida);
  assert.match(r.stderr, /rede 'membros_default' \(o ensaio roda sem rede\)/);
  assert.match(r.stderr, /nao ficou isolado da escola/);
  const d = docker(s.chamadas());
  assert.equal(d.filter((c) => c.args[0] === "start").length, 0);
  assert.ok(d.some((c) => c.args[0] === "rm"));
  assert.equal(s.situacao().ensaio.resultado, "falhou");
  // Um volume com nome (o da configuracao do banco da escola) no lugar do volume que a imagem declara: recusado.
  s.limparLog();
  const nomeado = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], { SHIM_VOLUME_DA_IMAGEM: "/etc/postgresql-custom", SHIM_VOLUME_NOMEADO: "membros_db-config" });
  assert.equal(nomeado.status, 3, nomeado.saida);
  assert.match(nomeado.stderr, /montagem fora da pasta do ensaio: volume membros_db-config em \/etc\/postgresql-custom/);
  assert.equal(docker(s.chamadas()).filter((c) => c.args[0] === "start").length, 0);
  // O volume anonimo que a propria imagem declara (VOLUME no Dockerfile) nasce so para este container e sai com o rm -v.
  s.limparLog();
  const anonimo = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], { SHIM_VOLUME_DA_IMAGEM: "/etc/postgresql-custom" });
  assert.equal(anonimo.status, 0, anonimo.saida);
  assert.match(anonimo.stdout, /DEU CERTO/);
  assert.ok(docker(s.chamadas()).filter((c) => c.args[0] === "rm").every((c) => c.args.includes("-v")), "o rm apaga os volumes anonimos");
});

test("ensaio: falha, banco que nao sobe, dump ilegivel e interrupcao tambem apagam tudo", { skip }, () => {
  const casos = [
    { nome: "sem contas", extra: { SHIM_CONTAGENS: JSON.stringify({ contas: 0 }) }, status: 3, textos: [/Ensaio de restauração: FALHOU/, /PROBLEMA: o banco restaurado não tem nenhuma conta/] },
    { nome: "nunca sobe", extra: { SHIM_PRONTO: "nunca", KIT_ENSAIO_ESPERA: "4" }, status: 3, textos: [/nao subiu em 4s/, /log do banco do ensaio/, /FALHOU \(o banco do ensaio nao subiu\)/] },
    { nome: "sem memoria", extra: { SHIM_PRONTO: "morreu", SHIM_OOM: "true" }, status: 3, textos: [/passou do teto de memoria \(512m\)/] },
    { nome: "dump ilegivel", extra: { SHIM_DUMP_ILEGIVEL: "1" }, status: 3, textos: [/nao e um arquivo do pg_dump legivel/] },
    { nome: "interrompido", extra: { SHIM_INTERROMPER: "pg_restore" }, status: 143, textos: [/INTERROMPIDO \(interrompido no meio\)\. Tudo o que o ensaio criou foi apagado; a escola nao foi tocada/] }
  ];
  // Um servidor so: cada ensaio apaga o que criou, e o seguinte comeca do zero.
  const { s, arquivo } = servidorProntoParaEnsaio();
  for (const caso of casos) {
    s.limparLog();
    const r = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], caso.extra);
    assert.equal(r.status, caso.status, `${caso.nome}: ${r.saida}`);
    for (const texto of caso.textos) assert.match(r.saida, texto, caso.nome);
    const nome = docker(s.chamadas()).find((c) => c.args[0] === "create").args[2];
    assert.ok(docker(s.chamadas()).some((c) => c.args[0] === "rm" && c.args.includes(nome)), `${caso.nome}: container apagado`);
    assert.equal(existsSync(join(s.backups, "ensaio")), false, `${caso.nome}: pasta apagada`);
    assert.deepEqual(readdirSync(s.temporaria), [], `${caso.nome}: chave apagada`);
    assert.equal(s.situacao().ensaio.resultado, caso.nome === "interrompido" ? "interrompido" : "falhou", caso.nome);
    // O veredito que falhou guarda as contagens dele; o ensaio que parou antes nao deixa contagem de um ensaio velho.
    if (caso.nome === "sem contas") assert.equal(s.situacao().ensaio.contagens.contas, 0);
    else assert.equal(s.situacao().ensaio.contagens, undefined, `${caso.nome}: sem contagem velha`);
  }
});

test("ensaio: chave errada para com 5 antes de criar qualquer container; sem terminal nem arquivo, 7; arquivo aberto a todos, 1", { skip }, () => {
  const { s } = servidorProntoParaEnsaio();
  s.limparLog();
  const errada = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivoDaChave(s, "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", "errada.txt")]);
  assert.equal(errada.status, 5, errada.saida);
  assert.match(errada.stderr, /A chave de recuperacao digitada nao abre o backup/);
  assert.equal(docker(s.chamadas()).filter((c) => c.args[0] === "create").length, 0);
  assert.equal(s.situacao().ensaio.resultado, "falhou");
  assert.equal(s.situacao().ensaio.motivo, "a chave de recuperacao nao abriu o backup");
  const semTerminal = s.rodar(["restaurar", "--ensaio"]);
  assert.equal(semTerminal.status, 7);
  const aberto = arquivoDaChave(s, "X", "aberto.txt");
  spawnSync("chmod", ["644", aberto]);
  const r = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", aberto]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pode ser lido por outros usuarios/);
});

test("ensaio pela pessoa no terminal: digita a chave da folha (com minusculas, sem hifens e com O no lugar de 0)", { skip }, () => {
  const { s, chave } = servidorProntoParaEnsaio();
  const digitada = chave.replaceAll("-", "").toLowerCase().replaceAll("0", "o");
  const r = s.pessoa(["restaurar", "--ensaio"], [{ espera: "Digite a chave de recuperacao da folha", responde: digitada }]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.saida, /DEU CERTO/);
  assert.doesNotMatch(r.saida.split("Digite a chave")[1].split("\n").slice(1).join("\n"), new RegExp(chave), "a chave nao volta para a tela");
});

test("ensaio: sobras de um ensaio anterior saem antes; sem disco, para com 8 antes de criar o banco", { skip }, () => {
  const { s, arquivo } = servidorProntoParaEnsaio();
  mkdirSync(join(s.backups, "ensaio", "20261101000000-1"), { recursive: true });
  writeFileSync(join(s.backups, "ensaio", "20261101000000-1", "postgres.dump"), "sobra");
  s.limparLog();
  assert.equal(s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], { SHIM_SOBRAS: "membros-ensaio-20261101000000-1" }).status, 0);
  const d = docker(s.chamadas());
  const sobra = d.findIndex((c) => c.args[0] === "rm" && c.args.includes("membros-ensaio-20261101000000-1"));
  assert.ok(sobra >= 0 && sobra < d.findIndex((c) => c.args[0] === "create"), "a sobra sai antes");
  assert.deepEqual(d.find((c) => c.args[0] === "ps").args, ["ps", "-aq", "--filter", "label=membros.ensaio"]);
  assert.equal(existsSync(join(s.backups, "ensaio")), false);
  s.limparLog();
  const disco = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], { SHIM_DF_LIVRE_KB: "500000" });
  assert.equal(disco.status, 8, disco.saida);
  assert.match(disco.stderr, /O ensaio precisa de cerca de \d+ MB livres no disco e ha 488 MB/);
  assert.equal(docker(s.chamadas()).filter((c) => c.args[0] === "create").length, 0);
  // Memoria: o teto do banco do ensaio (512m) mais a folga da escola (256m) precisam estar livres no servidor.
  writeFileSync(s.meminfo, "MemTotal:        4015048 kB\nMemAvailable:     600000 kB\n");
  s.limparLog();
  const memoria = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo]);
  assert.equal(memoria.status, 8, memoria.saida);
  assert.match(memoria.stderr, /O ensaio precisa de cerca de 768 MB de memoria livre e ha 585 MB: a escola nao pode ficar sem memoria/);
  assert.equal(docker(s.chamadas()).filter((c) => c.args[0] === "create").length, 0);
  assert.equal(s.situacao().ensaio.motivo, "falta memoria livre");
  // Com um teto menor (num servidor apertado), cabe; um teto que nao e tamanho para antes de tudo, com 1.
  const menor = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], { KIT_ENSAIO_MEMORIA: "256m" });
  assert.equal(menor.status, 0, menor.saida);
  assert.match(docker(s.chamadas()).filter((c) => c.args[0] === "create").at(-1).args.join(" "), /--memory 256m --memory-swap 256m/);
  s.limparLog();
  const errado = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], { KIT_ENSAIO_MEMORIA: "meio-giga" });
  assert.equal(errado.status, 1, errado.saida);
  assert.match(errado.stderr, /KIT_ENSAIO_MEMORIA precisa ser um tamanho como 512m/);
  assert.equal(s.chamadas().length, 0, "nada roda");
});

test("backup diario apaga as sobras de um ensaio que parou sem limpar (queda de luz): o container e a pasta", { skip }, () => {
  const s = servidorComBackup();
  const sobra = join(s.backups, "ensaio", "20261101000000-77");
  mkdirSync(join(sobra, "banco"), { recursive: true });
  writeFileSync(join(sobra, "banco", "PG_VERSION"), "17");
  s.limparLog();
  const r = s.rodar(["backup", "--agendado"], { SHIM_SOBRAS: "membros-ensaio-20261101000000-77" });
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /Apagando o que sobrou de um ensaio de restauracao que parou no meio/);
  assert.equal(existsSync(join(s.backups, "ensaio")), false);
  const d = docker(s.chamadas());
  assert.deepEqual(d.find((c) => c.args[0] === "ps").args, ["ps", "-aq", "--filter", "label=membros.ensaio"]);
  assert.deepEqual(d.find((c) => c.args[0] === "rm").args, ["rm", "-f", "-v", "membros-ensaio-20261101000000-77"]);
  // So o que tem o rotulo do ensaio: nada da escola sai; e sem sobra, nada e dito.
  assert.equal(d.filter((c) => c.args[0] === "rm").length, 1);
  s.limparLog();
  const limpo = s.rodar(["backup"]);
  assert.equal(limpo.status, 0);
  assert.doesNotMatch(limpo.stdout, /Apagando o que sobrou/);
  assert.equal(docker(s.chamadas()).filter((c) => c.args[0] === "rm").length, 0);
});

test("ensaio: licenca e Storage conferidos; escolhe o backup mais novo com dados", { skip }, () => {
  const casos = [
    { extra: { SHIM_CONTAGENS: JSON.stringify({ licenca: 0 }) }, status: 3, texto: /PROBLEMA: a licença da escola não está no backup/ },
    { extra: { SHIM_CONTAGENS: JSON.stringify({ licenca: null }) }, status: 3, texto: /PROBLEMA: a tabela da licença \(license_state\) não está no backup/ },
    { extra: { SHIM_ANON: "true" }, status: 3, texto: /PROBLEMA: as permissões restauradas não são as do backup/ },
    {
      extra: { SHIM_OBJETOS: JSON.stringify([["avatars", "aluno1/foto.webp", "v-1111"], ["avatars", "aluno9/sumiu.webp", "v-9999"]]) },
      status: 0,
      texto: /DEU CERTO, com avisos[\s\S]*1 de 2 arquivos do Storage[\s\S]*Aviso: faltam 1 de 2 arquivos do Storage no backup \(avatars\/aluno9\/sumiu\.webp\)/
    },
    { extra: { SHIM_OBJETOS: JSON.stringify([["avatars", "outro/a.webp", "v-1"], ["avatars", "outro/b.webp", "v-2"]]) }, status: 3, texto: /PROBLEMA: nenhum dos 2 arquivos do Storage está no backup/ }
  ];
  const { s, arquivo } = servidorProntoParaEnsaio();
  for (const caso of casos) {
    const r = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo], caso.extra);
    assert.equal(r.status, caso.status, r.saida);
    assert.match(r.stdout, caso.texto);
  }
  // Um backup vazio (servidor recem-criado) depois do bom: o ensaio usa o bom.
  const bom = s.situacao().backup.snapshot;
  assert.equal(s.rodar(["backup"], { SHIM_CONTAS: "0" }).status, 0);
  const r = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, new RegExp(`Backup ${bom} de .*com-dados`));
  assert.equal(s.situacao().ensaio.snapshot, bom);
});

test("restaurar: pede terminal, confirma o endereco, roda o restore.sh com a chave por arquivo e sai do modo de restauracao", { skip }, () => {
  const { s, chave } = servidorProntoParaEnsaio();
  // O restore.sh e o migrar.sh de mentira: anotam como foram chamados e poem no lugar o arquivo de segredos do backup.
  const anotacoes = join(s.dir, "restore.txt");
  const restoreFalso = join(s.dir, "restore.sh");
  writeFileSync(
    restoreFalso,
    [
      "#!/usr/bin/env bash",
      "set -eu",
      `{ printf 'args=%s\\n' "$*"; printf 'arquivo=%s\\n' "\${RESTIC_PASSWORD_FILE:-}"; printf 'chave=%s\\n' "$(cat "$RESTIC_PASSWORD_FILE")";`,
      `  printf 'senha_no_ambiente=%s\\n' "\${RESTIC_PASSWORD+sim}"; printf 'tag=%s\\n' "\${BUNKER707_BACKUP_TAG:-}"; printf 'pasta=%s\\n' "\${BUNKER707_BACKUP_DIR:-}"; } > "${anotacoes}"`,
      `printf 'AWS_SECRET_ACCESS_KEY=segredo-velho-do-backup\\nRESTIC_PASSWORD=${SEGREDOS.RESTIC_PASSWORD}\\nAPP_PUBLIC_URL=https://alunos.escola.test\\n' > "${s.envFile}"`,
      `mkdir -p "$BUNKER707_BACKUP_DIR/restore/20261111T000000Z" && echo dump > "$BUNKER707_BACKUP_DIR/restore/20261111T000000Z/postgres.dump"`,
      ""
    ].join("\n")
  );
  const migrarFalso = join(s.dir, "migrar.sh");
  writeFileSync(migrarFalso, `#!/usr/bin/env bash\necho migrado > "${join(s.dir, "migrado")}"\n`);
  // O teste de fumaca de mentira: anota e falha, como pelo endereco publico que ainda aponta para o servidor antigo.
  const fumacaFalsa = join(s.dir, "smoke.sh");
  writeFileSync(fumacaFalsa, `#!/usr/bin/env bash\necho fumaca >> "${join(s.dir, "fumaca")}"\nexit "\${FUMACA_STATUS:-1}"\n`);
  const extra = { KIT_SCRIPT_RESTORE: restoreFalso, KIT_SCRIPT_MIGRAR: migrarFalso, KIT_SCRIPT_FUMACA: fumacaFalsa };

  assert.equal(s.rodar(["restaurar"], extra).status, 7, "sem terminal, nada");
  // Confirmacao diferente: nada e restaurado, e a instalacao fica esperando (o backup diario parado).
  const errado = s.pessoa(["restaurar"], [{ espera: "Digite a chave", responde: chave }, { espera: "Para confirmar, digite: ([^\\r\\n]+)\\r?\\n", responde: "sim" }], { ...extra, SHIM_CONTAS: "0" });
  assert.equal(errado.status, 1, errado.saida);
  assert.match(errado.saida, /Confirmacao diferente de "alunos\.escola\.test": nada foi feito/);
  assert.equal(existsSync(anotacoes), false);
  assert.equal(s.rodar(["backup"]).status, 9);
  // Esta instalacao ja tem contas: a frase e APAGAR <endereco>.
  const certo = s.pessoa(["restaurar"], [{ espera: "Digite a chave", responde: chave }, { espera: "Para confirmar, digite: ([^\\r\\n]+)\\r?\\n", responde: "{ACHADO}" }], extra);
  assert.equal(certo.status, 0, certo.saida);
  assert.match(certo.saida, /Restaurar o backup [0-9a-f]{8}, de .* \(horario de Brasilia\), da escola alunos\.escola\.test/);
  assert.match(certo.saida, /ATENCAO: esta instalacao ja tem uma escola com 40 conta\(s\)\. Ela sera APAGADA\./);
  assert.match(certo.saida, /Para confirmar, digite: APAGAR alunos\.escola\.test/);
  const chamada = Object.fromEntries(readFileSync(anotacoes, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  assert.equal(chamada.args, `--snapshot ${s.resticEstado().repos[s.valores.RESTIC_REPOSITORY].snapshots[0].id} --yes --sem-fumaca`, "o smoke do restore.sh fica para depois");
  assert.match(certo.saida, /Use quando o servidor antigo morreu ou ja foi desligado: com os dois no ar sobre a mesma escola, os alunos\s+recebem os e-mails em dobro/);
  assert.equal(chamada.chave, chave, "a chave de recuperacao, por arquivo");
  assert.ok(chamada.arquivo.startsWith(s.temporaria));
  assert.equal(chamada.senha_no_ambiente, "", "nunca no ambiente");
  assert.equal(chamada.tag, "membros");
  assert.equal(chamada.pasta, s.backups);
  // Depois: o acesso que abriu o backup volta ao arquivo de segredos, as migracoes rodam, o baixado sai e o backup volta.
  const segredos = s.lerSegredos();
  assert.equal(segredos.AWS_SECRET_ACCESS_KEY, SEGREDOS.AWS_SECRET_ACCESS_KEY);
  assert.equal(segredos.RESTIC_REPOSITORY, s.valores.RESTIC_REPOSITORY);
  assert.equal(statSync(s.envFile).mode & 0o777, 0o600);
  assert.ok(existsSync(join(s.dir, "migrado")));
  assert.equal(existsSync(join(s.backups, "restore")), false);
  assert.equal(existsSync(join(s.estado, "restauracao-pendente")), false);
  assert.ok(s.situacao().restauracao.ultima);
  // O teste de fumaca roda depois de tudo, pelo endereco publico; falhar (o DNS ainda no servidor antigo) nao desfaz nada.
  assert.equal(readFileSync(join(s.dir, "fumaca"), "utf8"), "fumaca\n");
  assert.match(certo.saida, /O teste pelo endereco publico nao passou: e o esperado enquanto alunos\.escola\.test nao aponta para este servidor/);
  assert.match(certo.saida, /Falta: apontar alunos\.escola\.test para o IP deste servidor/);
  assert.match(certo.saida, new RegExp(`Depois de apontar, confira: sudo bash ${fumacaFalsa}`));
  assert.equal(s.situacao().restauracao.fumaca, "falhou");
  assert.deepEqual(readdirSync(s.temporaria), []);
  assert.equal(s.rodar(["backup"]).status, 0, "o backup diario volta");
});

test("restaurar: a senha do servidor que veio no backup ja nao abre (foi trocada): cadastra uma nova pela chave de recuperacao", { skip }, () => {
  const { s, chave } = servidorProntoParaEnsaio();
  const restoreFalso = join(s.dir, "restore.sh");
  writeFileSync(restoreFalso, `#!/usr/bin/env bash\nprintf 'RESTIC_PASSWORD=senha-velha-que-saiu-do-backup\\nAPP_PUBLIC_URL=https://alunos.escola.test\\n' > "${s.envFile}"\n`);
  // O endereco ja aponta para o servidor novo: o teste de fumaca passa e nao ha o que apontar.
  const fumacaQuePassa = join(s.dir, "smoke.sh");
  writeFileSync(fumacaQuePassa, "#!/usr/bin/env bash\nexit 0\n");
  const r = s.pessoa(["restaurar"], [{ espera: "Digite a chave", responde: chave }, { espera: "Para confirmar, digite: ([^\\r\\n]+)\\r?\\n", responde: "{ACHADO}" }], { KIT_SCRIPT_RESTORE: restoreFalso, KIT_SCRIPT_MIGRAR: "/nao/existe", KIT_SCRIPT_FUMACA: fumacaQuePassa, SHIM_CONTAS: "0" });
  assert.equal(r.status, 0, r.saida);
  assert.match(r.saida, /cadastrando uma nova com a chave de recuperacao/);
  const nova = s.lerSegredos().RESTIC_PASSWORD;
  assert.notEqual(nova, "senha-velha-que-saiu-do-backup");
  assert.ok(s.resticEstado().repos[s.valores.RESTIC_REPOSITORY].chaves.some((c) => c.senha === nova));
  assert.ok(!r.saida.includes(nova), "a senha nova nao aparece na tela");
  assert.match(r.saida, /A escola responde em alunos\.escola\.test: o endereco ja aponta para este servidor/);
  assert.doesNotMatch(r.saida, /Falta: apontar/);
  assert.equal(s.situacao().restauracao.fumaca, "ok");
});

test("situacao e status: nenhum segredo (nem a chave de recuperacao) e o kit.py recusa gravar valor que contenha um", { skip }, () => {
  const { s, chave, arquivo } = servidorProntoParaEnsaio();
  assert.equal(s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo]).status, 0);
  const textos = [readFileSync(join(s.estado, "situacao.json"), "utf8"), s.rodar(["status"]).stdout, s.rodar(["status", "--json"]).stdout];
  for (const texto of textos) {
    for (const [nome, valor] of Object.entries(SEGREDOS)) assert.ok(!texto.includes(valor), nome);
    assert.ok(!texto.includes(chave) && !texto.includes(chave.replaceAll("-", "")), "a chave de recuperacao");
    assert.ok(!texto.includes("escola-backup/membros"), "nem o endereco inteiro do destino");
  }
  const status = textos[1];
  assert.match(status, /Último backup bom: .* \(horário de Brasília\), há \d+ minutos?/);
  assert.match(status, /Destino: armazenamento compatível com S3 \(s3\.us-east-005\.backblazeb2\.com\)/);
  assert.match(status, /Retenção: 7 diários, 4 semanais e 6 mensais/);
  assert.match(status, /Kit de recuperação\n {2}Confirmado em/);
  assert.doesNotMatch(status, /Atenção:/);
  // O status nao precisa de sudo: roda sem o arquivo de segredos legivel.
  spawnSync("chmod", ["000", s.envFile]);
  const semSegredos = s.rodar(["status", "--json"]);
  spawnSync("chmod", ["600", s.envFile]);
  if (process.getuid?.() !== 0) assert.equal(semSegredos.status, 0, semSegredos.saida);
  // A guarda do kit.py: valor com um segredo do arquivo de segredos nao e gravado.
  const guarda = spawnSync("python3", ["-I", join(kitDir, "kit.py"), "situacao-gravar", join(s.estado, "situacao.json"), "--segredos", s.envFile, `backup.ultimo_erro=falhou com ${SEGREDOS.AWS_SECRET_ACCESS_KEY}`], { encoding: "utf8" });
  assert.equal(guarda.status, 3);
  assert.doesNotMatch(readFileSync(join(s.estado, "situacao.json"), "utf8"), new RegExp(SEGREDOS.AWS_SECRET_ACCESS_KEY));
  const chaveRuim = spawnSync("python3", ["-I", join(kitDir, "kit.py"), "situacao-gravar", join(s.estado, "situacao.json"), "segredo.qualquer=1"], { encoding: "utf8" });
  assert.equal(chaveRuim.status, 1, "so as secoes conhecidas");
});

test("status de uma instalacao nova lista o que falta, na ordem", { skip }, () => {
  const s = servidorDoKit();
  const r = s.rodar(["status"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Backup\n {2}Nenhum backup feito ainda\.\nKit de recuperação\n {2}Ainda não foi feito\.\nEnsaio de restauração\n {2}Nunca feito\./);
  assert.match(r.stdout, /Atenção:\n {2}- nenhum backup feito ainda[\s\S]*- sem kit de recuperação, o backup não abre se o servidor morrer[\s\S]*- faça um ensaio de restauração/);
  assert.deepEqual(JSON.parse(s.rodar(["status", "--json"]).stdout), {});
});

test("infra/scripts/backup.sh e o backup do Mautic: retencao agrupada pelo host (antes, o caminho com a hora deixava tudo)", { skip }, () => {
  const s = servidorDoKit({ segredos: { RESTIC_REPOSITORY: "sftp:storagebox:bunker707/restic", BACKUP_KEEP_DAILY: "30", STORAGE_BOX_USER: "", STORAGE_BOX_HOST: "" } });
  const fonte = readFileSync(join(kitDir, "..", "scripts", "backup.sh"), "utf8");
  assert.match(fonte, /restic_bin forget --tag bunker707 --host bunker707 --group-by host --keep-daily "\$keep_daily" --prune --quiet/);
  const mautic = readFileSync(join(kitDir, "..", "mautic", "scripts", "backup.sh"), "utf8");
  assert.match(mautic, /restic_bin forget --tag bunker707-mautic --host bunker707-mautic --group-by host --keep-daily "\$keep_daily" --prune --quiet/);
  // Com o repositorio criado, o backup.sh de verdade chama o forget agrupado pelo host.
  const estado = { repos: { "sftp:storagebox:bunker707/restic": { chaves: [{ id: "a".repeat(64), senha: SEGREDOS.RESTIC_PASSWORD }], snapshots: [] } } };
  writeFileSync(join(s.dir, "restic.json"), JSON.stringify(estado));
  s.limparLog();
  const ok = spawnSync("bash", [join(kitDir, "..", "scripts", "backup.sh")], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(s.dir, "shims")}:${process.env.PATH}`, BUNKER707_COMPOSE_FILE: join(s.compose, "docker-compose.yml"), BUNKER707_ENV_FILE: s.envFile, BUNKER707_BACKUP_DIR: join(s.dir, "producao"), SHIM_LOG: join(s.dir, "chamadas.log"), SHIM_DOCKER_ESTADO: join(s.dir, "docker.json"), SHIM_RESTIC_ESTADO: join(s.dir, "restic.json"), HOME: s.dir }
  });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.deepEqual(restic(s.chamadas(), "forget")[0].args, ["forget", "--tag", "bunker707", "--host", "bunker707", "--group-by", "host", "--keep-daily", "30", "--prune"]);
});

test("infra/scripts/restore.sh aceita a senha por arquivo e a marca do kit", { skip }, () => {
  const s = servidorComBackup();
  const chave = arquivoDaChave(s, SEGREDOS.RESTIC_PASSWORD, "senha.txt");
  s.limparLog();
  // --sem-fumaca: o smoke (pelos enderecos publicos) fica para quem chamou; sem ele este teste iria a rede.
  const r = spawnSync("bash", [join(kitDir, "..", "scripts", "restore.sh"), "--snapshot", "latest", "--yes", "--sem-fumaca"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(s.dir, "shims")}:${process.env.PATH}`, BUNKER707_COMPOSE_FILE: join(s.compose, "docker-compose.yml"), BUNKER707_ENV_FILE: join(s.dir, "nao-existe.env"), BUNKER707_BACKUP_DIR: join(s.dir, "restauracao"), RESTIC_REPOSITORY: s.valores.RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE: chave, BUNKER707_BACKUP_TAG: "escola", AWS_ACCESS_KEY_ID: "x", AWS_SECRET_ACCESS_KEY: "y", SHIM_LOG: join(s.dir, "chamadas.log"), SHIM_DOCKER_ESTADO: join(s.dir, "docker.json"), SHIM_RESTIC_ESTADO: join(s.dir, "restic.json") }
  });
  const [restauracao] = restic(s.chamadas(), "restore");
  assert.ok(restauracao, r.stderr);
  assert.deepEqual(restauracao.args.slice(-2), ["--tag", "escola"]);
  assert.equal(restauracao.porArquivo, true);
  assert.equal(restauracao.chave !== null, true, "a senha do arquivo abriu");
  // Vai ate o fim: papeis, pg_restore, conferencia do anon, Storage e o stack inteiro de pe, sem o smoke.
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Teste de fumaca pulado \(--sem-fumaca\): quem chamou roda depois, pelo endereco publico/);
  assert.doesNotMatch(r.stdout, /==> Teste de fumaca\.\.\./);
  const compose = docker(s.chamadas()).filter((c) => c.args[0] === "compose").map((c) => c.args.slice(3).join(" "));
  assert.ok(compose.includes("up -d db") && compose.includes("up -d"), compose.join(" | "));
  assert.match(r.stdout, /Restauracao concluida/);
  const semSenha = spawnSync("bash", [join(kitDir, "..", "scripts", "restore.sh"), "--yes"], { encoding: "utf8", env: { ...process.env, PATH: `${join(s.dir, "shims")}:${process.env.PATH}`, BUNKER707_ENV_FILE: join(s.dir, "nao-existe.env"), RESTIC_REPOSITORY: "x" } });
  assert.match(semSenha.stderr, /RESTIC_PASSWORD \(ou RESTIC_PASSWORD_FILE\)/);
});
