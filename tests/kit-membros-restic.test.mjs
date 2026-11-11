import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";

import { arquivoDaChave, confirmarKit, faltam, kitDir, limparKitDeMentira, SEGREDOS, servidorDoKit, temBinario } from "./fixtures/kit-de-mentira.mjs";

// O backup do kit (infra/kit/membros; docs/32 §4; docs/20 §9B) e o infra/scripts/backup.sh com o restic DE VERDADE (o
// da maquina) num repositorio em pasta: a retencao apaga mesmo (o comando antigo, sem --group-by, nao apagava nada), a
// chave de recuperacao entra, abre e sai do repositorio, e o ensaio abre o backup com ela. O docker continua de mentira
// (tests/fixtures/kit-de-mentira.mjs). Sem o restic na maquina, o teste pula com o motivo.

const cache = mkdtempSync(join(tmpdir(), "kit-restic-cache-"));
after(() => {
  limparKitDeMentira();
  rmSync(cache, { recursive: true, force: true });
});
// Os dias da retencao contam no fuso de quem roda o restic: o mesmo para os backups montados aqui e os do kit.
process.env.TZ = "UTC";
process.env.XDG_CACHE_HOME = cache;
const skip = faltam.length ? `faltam ${faltam.join(", ")}` : temBinario("restic", ["version"]) ? false : "sem o restic na maquina";

/** O restic de verdade, com a senha do servidor (ou outra) pelo ambiente. */
function restic(repo, args, { senha = SEGREDOS.RESTIC_PASSWORD, arquivoSenha } = {}) {
  const env = { ...process.env, RESTIC_REPOSITORY: repo };
  delete env.RESTIC_PASSWORD;
  delete env.RESTIC_PASSWORD_FILE;
  if (arquivoSenha) env.RESTIC_PASSWORD_FILE = arquivoSenha;
  else env.RESTIC_PASSWORD = senha;
  const r = spawnSync("restic", args, { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
const snapshots = (repo) => JSON.parse(restic(repo, ["snapshots", "--json"]).stdout);
const dia = (atras) => new Date(Date.now() - atras * 86400e3).toISOString().slice(0, 10);

/** Um servidor de mentira com o restic de verdade e o destino numa pasta. */
function servidorComRestic(segredos = {}) {
  const s = servidorDoKit({ restic: "de verdade" });
  mkdirSync(join(s.dir, "disco"));
  const repo = join(s.dir, "disco", "escola");
  s.escreverSegredos({ ...s.valores, RESTIC_REPOSITORY: repo, ...segredos });
  return { s, repo };
}

test("retencao do kit com o restic de verdade: os backups velhos saem, e os vazios nao empurram os com dados", { skip }, () => {
  const { s, repo } = servidorComRestic({ BACKUP_KEEP_DAILY: "3", BACKUP_KEEP_WEEKLY: "0", BACKUP_KEEP_MONTHLY: "0" });
  const ini = s.rodar(["backup", "--iniciar"]);
  assert.equal(ini.status, 0, ini.saida);
  // Dez noites de backups com dados e, nas cinco ultimas, um backup vazio depois (um servidor recem-instalado no mesmo
  // destino), montados com o host, as marcas e as pastas que o kit usa.
  const etapa = join(s.backups, "atual");
  mkdirSync(etapa, { recursive: true });
  writeFileSync(join(etapa, "postgres.dump"), "PGDMP");
  for (let atras = 10; atras >= 1; atras--) {
    const r = restic(repo, ["backup", "-q", "--time", `${dia(atras)} 03:30:00`, "--host", "bunker707", "--tag", "bunker707", "--tag", "com-dados", etapa, s.storage]);
    assert.equal(r.status, 0, r.stderr);
    if (atras <= 5) assert.equal(restic(repo, ["backup", "-q", "--time", `${dia(atras)} 04:00:00`, "--host", "bunker707", "--tag", "bunker707", "--tag", "vazio", etapa]).status, 0);
  }
  rmSync(etapa, { recursive: true });
  assert.equal(snapshots(repo).length, 15);

  const r = s.rodar(["backup"]);
  assert.equal(r.status, 0, r.saida);
  const sobram = snapshots(repo);
  const comDados = sobram.filter((x) => x.tags.includes("com-dados")).map((x) => x.time.slice(0, 10)).sort();
  const vazios = sobram.filter((x) => x.tags.includes("vazio")).map((x) => x.time.slice(0, 10)).sort();
  // 3 diarios em cada grupo (host e marcas): o de hoje e os dois dias antes; nos vazios, os tres mais novos.
  assert.deepEqual(comDados, [dia(2), dia(1), dia(0)]);
  assert.deepEqual(vazios, [dia(3), dia(2), dia(1)]);
  // O restic de verdade apagou os dados (--prune) e o repositorio confere.
  assert.equal(restic(repo, ["check"]).status, 0);
});

test("infra/scripts/backup.sh com o restic de verdade: a retencao apaga (sem --group-by, o caminho com a hora nao deixava)", { skip }, () => {
  const s = servidorDoKit({ restic: "de verdade" });
  const producao = join(s.dir, "producao");
  const repo = join(s.dir, "repo-producao");
  s.escreverSegredos({ ...s.valores, RESTIC_REPOSITORY: repo, BACKUP_KEEP_DAILY: "3", STORAGE_BOX_USER: "", STORAGE_BOX_HOST: "" });
  assert.equal(restic(repo, ["init", "-q"]).status, 0);
  // Seis noites como o backup.sh fazia: cada exportacao numa pasta com a hora no nome.
  for (let atras = 6; atras >= 1; atras--) {
    const stage = join(producao, "stage", `${dia(atras).replaceAll("-", "")}T033000Z`);
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "postgres.dump"), `PGDMP ${atras}`);
    assert.equal(restic(repo, ["backup", "-q", "--time", `${dia(atras)} 03:30:00`, "--tag", "bunker707", "--host", "bunker707", stage, s.storage]).status, 0);
  }
  rmSync(join(producao, "stage"), { recursive: true });
  // O comando de antes (agrupado pelo padrao do restic, host e caminhos): cada backup sozinho no grupo, nada sai.
  const copia = join(s.dir, "repo-antes");
  cpSync(repo, copia, { recursive: true });
  const antes = restic(copia, ["forget", "--tag", "bunker707", "--host", "bunker707", "--keep-daily", "3", "--prune"]);
  assert.equal(antes.status, 0, antes.stderr);
  assert.equal(snapshots(copia).length, 6, "o comando antigo nao apagava nenhum");

  // O backup.sh de verdade: exporta (docker de mentira), envia e aplica a retencao agrupada pelo host.
  const r = spawnSync("bash", [join(kitDir, "..", "scripts", "backup.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(s.dir, "shims")}:${process.env.PATH}`,
      BUNKER707_COMPOSE_FILE: join(s.compose, "docker-compose.yml"),
      BUNKER707_ENV_FILE: s.envFile,
      BUNKER707_BACKUP_DIR: producao,
      SHIM_LOG: join(s.dir, "chamadas.log"),
      SHIM_DOCKER_ESTADO: join(s.dir, "docker.json"),
      HOME: s.dir
    }
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dias = snapshots(repo).map((x) => x.time.slice(0, 10)).sort();
  assert.deepEqual(dias, [dia(2), dia(1), dia(0)], "3 diarios: o de hoje e os dois dias antes");
  assert.equal(restic(repo, ["check"]).status, 0);
});

test("kit de recuperacao e ensaio com o restic de verdade: a segunda chave abre o backup, e a troca tira a antiga", { skip }, () => {
  const { s, repo } = servidorComRestic();
  assert.equal(s.rodar(["backup", "--iniciar"]).status, 0);
  const b = s.rodar(["backup"]);
  assert.equal(b.status, 0, b.saida);

  const primeira = confirmarKit(s);
  assert.equal(primeira.status, 0, primeira.saida);
  const chaves = () => JSON.parse(restic(repo, ["key", "list", "--json"]).stdout);
  assert.equal(chaves().length, 2, "a senha do servidor e a chave de recuperacao");
  assert.ok(chaves().some((c) => c.id.startsWith(s.situacao().recuperacao.chave_id)), "o identificador guardado e o do restic");
  const arquivo = arquivoDaChave(s, primeira.chave);
  assert.equal(restic(repo, ["cat", "config"], { arquivoSenha: arquivo }).status, 0, "a chave da folha abre o backup sozinha");

  // O ensaio abre o backup de verdade com a chave da folha: a lista, o dump e os arquivos do Storage um a um.
  const ensaio = s.rodar(["restaurar", "--ensaio", "--chave-arquivo", arquivo]);
  assert.equal(ensaio.status, 0, ensaio.saida);
  assert.match(ensaio.stdout, /DEU CERTO/);
  assert.match(ensaio.stdout, /3 de 3 arquivos do Storage/);

  // --nova: a chave antiga so sai quando a nova e confirmada; depois, a folha antiga nao abre mais nada.
  const nova = s.pessoa(["kit-de-recuperacao", "--nova"], [{ espera: "digite o grupo (\\d) e o grupo (\\d)", responde: "{GRUPOS}" }]);
  assert.equal(nova.status, 0, nova.saida);
  assert.equal(chaves().length, 2);
  const velha = restic(repo, ["cat", "config"], { arquivoSenha: arquivo });
  assert.notEqual(velha.status, 0);
  assert.match(velha.stderr, /wrong password|no key found/);
  assert.equal(s.rodar(["kit-de-recuperacao", "--conferir"]).status, 0);
});
