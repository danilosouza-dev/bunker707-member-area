import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";

import { faltam, kitDir, limparKitDeMentira, servidorDoKit, temBinario } from "./fixtures/kit-de-mentira.mjs";

// A segunda copia do backup no Cloudflare R2 (docs/20 §8E): na Hetzner, cada backup vai para o Storage Box e tambem
// para o R2 (RESTIC_REPOSITORY_R2), um repositorio restic independente, com a mesma senha e a mesma senha de
// recuperacao. Aqui o restic e DE VERDADE e o "R2" e uma pasta (o restic trata igual); o docker e o de mentira do kit.

const cache = mkdtempSync(join(tmpdir(), "backup-r2-cache-"));
after(() => {
  limparKitDeMentira();
  rmSync(cache, { recursive: true, force: true });
});
process.env.TZ = "UTC";
process.env.XDG_CACHE_HOME = cache;
const skip = faltam.length ? `faltam ${faltam.join(", ")}` : temBinario("restic", ["version"]) ? false : "sem o restic na maquina";
const SENHA = "senha-do-restic-de-teste";
const scriptsDir = join(kitDir, "..", "scripts");

function restic(repo, args, { senha = SENHA, arquivoSenha } = {}) {
  const env = { ...process.env, RESTIC_REPOSITORY: repo };
  delete env.RESTIC_PASSWORD;
  delete env.RESTIC_PASSWORD_FILE;
  if (arquivoSenha) env.RESTIC_PASSWORD_FILE = arquivoSenha;
  else env.RESTIC_PASSWORD = senha;
  const r = spawnSync("restic", args, { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
const snapshots = (repo) => JSON.parse(restic(repo, ["snapshots", "--json"]).stdout || "[]");

/** Um servidor da area de membros de mentira, com o Storage Box e o R2 em pastas. */
function servidor({ r2 } = {}) {
  const s = servidorDoKit({ restic: "de verdade" });
  const principal = join(s.dir, "storage-box");
  const nuvem = r2 ?? join(s.dir, "r2", "hetzner", "restic");
  const pasta = join(s.dir, "backups");
  s.escreverSegredos({ ...s.valores, RESTIC_REPOSITORY: principal, RESTIC_REPOSITORY_R2: nuvem, RESTIC_PASSWORD: SENHA, BACKUP_KEEP_DAILY: "30", STORAGE_BOX_USER: "", STORAGE_BOX_HOST: "" });
  const rodar = (args = []) => {
    const r = spawnSync("bash", [join(scriptsDir, "backup.sh"), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(s.dir, "shims")}:${process.env.PATH}`,
        BUNKER707_COMPOSE_FILE: join(s.compose, "docker-compose.yml"),
        BUNKER707_ENV_FILE: s.envFile,
        BUNKER707_BACKUP_DIR: pasta,
        SHIM_LOG: join(s.dir, "chamadas.log"),
        SHIM_DOCKER_ESTADO: join(s.dir, "docker.json"),
        HOME: s.dir
      }
    });
    return { status: r.status, saida: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  return { s, principal, nuvem, pasta, rodar };
}

test("backup --init cria o repositorio do R2 com o historico do Storage Box, e cada backup vai para os dois", { skip }, () => {
  const { s, principal, nuvem, pasta, rodar } = servidor();
  assert.equal(restic(principal, ["init", "-q"]).status, 0);
  // Dois backups antigos no Storage Box, de antes de o R2 existir.
  const antigo = join(s.dir, "antigo");
  mkdirSync(antigo);
  for (const n of [1, 2]) {
    writeFileSync(join(antigo, "postgres.dump"), `PGDMP antigo ${n}`);
    // Em dias anteriores: a retencao guarda um backup por dia.
    const dia = new Date(Date.now() - (3 - n) * 86400e3).toISOString().slice(0, 10);
    assert.equal(restic(principal, ["backup", "-q", "--time", `${dia} 03:30:00`, "--tag", "bunker707", "--host", "bunker707", antigo]).status, 0);
  }

  const ini = rodar(["--init"]);
  assert.equal(ini.status, 0, ini.saida);
  assert.equal(snapshots(nuvem).length, 2, "o historico do Storage Box foi copiado para o R2");

  const b = rodar();
  assert.equal(b.status, 0, b.saida);
  assert.equal(snapshots(principal).length, 3, "o backup de hoje no Storage Box");
  assert.equal(snapshots(nuvem).length, 3, "e o mesmo backup no R2");
  const hoje = snapshots(nuvem).at(-1);
  assert.deepEqual(hoje.tags, ["bunker707"]);
  assert.equal(hoje.hostname, "bunker707");
  assert.ok(existsSync(join(pasta, "ultimo-sucesso")) && existsSync(join(pasta, "ultimo-sucesso-r2")), "as duas marcas de sucesso");
  assert.equal(restic(nuvem, ["check"]).status, 0);
});

test("o R2 com defeito nao desfaz o backup do Storage Box, mas o timer sai com erro e o R2 nao ganha marca de sucesso", { skip }, () => {
  // Um R2 que existe mas nao abre com a nossa senha (falha na hora; rede fora do ar o restic tenta de novo por minutos).
  const quebrado = join(mkdtempSync(join(tmpdir(), "r2-quebrado-")), "repo");
  assert.equal(restic(quebrado, ["init", "-q"], { senha: "outra-senha" }).status, 0);
  const { principal, pasta, rodar } = servidor({ r2: quebrado });
  assert.equal(restic(principal, ["init", "-q"]).status, 0);

  const b = rodar();
  assert.notEqual(b.status, 0, "falha alto para alguem ver");
  assert.match(b.saida, /backup do Storage Box entrou/);
  assert.equal(snapshots(principal).length, 1, "o backup do Storage Box entrou");
  assert.ok(existsSync(join(pasta, "ultimo-sucesso")));
  assert.ok(!existsSync(join(pasta, "ultimo-sucesso-r2")));
});

test("a senha de recuperacao entra nos dois repositorios e abre cada um sozinha", { skip }, () => {
  const { s, principal, nuvem, rodar } = servidor();
  assert.equal(restic(principal, ["init", "-q"]).status, 0);
  assert.equal(rodar(["--init"]).status, 0);
  const recuperacao = join(s.dir, "recuperacao");
  writeFileSync(recuperacao, "senha-de-recuperacao-derivada-do-token");
  const r = rodar([`--add-key=${recuperacao}`]);
  assert.equal(r.status, 0, r.saida);
  for (const repo of [principal, nuvem]) {
    assert.equal(restic(repo, ["cat", "config"], { arquivoSenha: recuperacao }).status, 0, repo);
  }
  assert.equal(rodar([`--add-key=${recuperacao}`]).status, 0, "de novo nao repete nem falha");
  assert.equal(JSON.parse(restic(nuvem, ["key", "list", "--json"]).stdout).length, 2);
});

test("sem RESTIC_REPOSITORY_R2 o backup e o de sempre: so o Storage Box", { skip }, () => {
  const { s, principal, pasta, rodar } = servidor();
  s.escreverSegredos({ ...s.valores, RESTIC_REPOSITORY: principal, RESTIC_REPOSITORY_R2: "", RESTIC_PASSWORD: SENHA, STORAGE_BOX_USER: "", STORAGE_BOX_HOST: "" });
  assert.equal(restic(principal, ["init", "-q"]).status, 0);
  const b = rodar();
  assert.equal(b.status, 0, b.saida);
  assert.doesNotMatch(b.saida, /R2/);
  assert.ok(!existsSync(join(pasta, "ultimo-sucesso-r2")));
});

test("backup-env.sh da sala: as chaves e a senha so pela entrada, o .env no R2, e sem elas nada acontece", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sala-env-"));
  const envFile = join(dir, ".env");
  writeFileSync(envFile, "JWT_APP_SECRET=segredo-da-sala\n");
  const repo = join(dir, "r2", "hetzner", "restic-meet");
  const script = join(kitDir, "..", "jitsi", "scripts", "backup-env.sh");
  const env = { ...process.env };
  delete env.RESTIC_PASSWORD;
  delete env.RESTIC_REPOSITORY;

  const r = spawnSync("bash", [script, repo, envFile], { encoding: "utf8", env, input: "chave-id\nchave-secreta\nsenha-recuperacao\n" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /configuracao da sala guardada no R2 \(1 copias\)/);
  const snaps = JSON.parse(restic(repo, ["snapshots", "--json"], { senha: "senha-recuperacao" }).stdout);
  assert.equal(snaps.length, 1);
  assert.deepEqual(snaps[0].tags, ["bunker707-meet"]);
  assert.ok(snaps[0].paths.some((p) => p.endsWith(".env")));

  const sem = spawnSync("bash", [script, repo, envFile], { encoding: "utf8", env, input: "" });
  assert.notEqual(sem.status, 0);
  assert.match(sem.stderr, /faltaram as chaves do R2 ou a senha/);
  rmSync(dir, { recursive: true, force: true });
});

test("deploy: na Hetzner com R2_ACCOUNT_ID o R2 vira a segunda copia (hetzner/...), sem ele nada muda, e na netcup e o unico", () => {
  const conta = "0123456789abcdef0123456789abcdef";
  const rodar = (env) => {
    const r = spawnSync("bash", ["-c", `. "${join(kitDir, "..", "cloud", "lib.sh")}"; set_env() { echo "SET $3=$4"; }; backup_r2_papel deploy@servidor /opt/bunker707/infra/compose/.env restic`], {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmpdir(), R2_ACCESS_KEY_ID: "id-de-teste", R2_SECRET_ACCESS_KEY: "segredo-de-teste", ...env }
    });
    return { status: r.status, saida: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  const hetzner = rodar({ PROVEDOR: "hetzner", R2_ACCOUNT_ID: conta });
  assert.equal(hetzner.status, 0, hetzner.saida);
  assert.match(hetzner.saida, new RegExp(`SET RESTIC_REPOSITORY_R2=s3:https://${conta}\\.r2\\.cloudflarestorage\\.com/bunker707-backups/hetzner/restic`));
  assert.doesNotMatch(hetzner.saida, /SET RESTIC_REPOSITORY=/, "o Storage Box continua o primeiro");
  assert.match(hetzner.saida, /SET AWS_ACCESS_KEY_ID=id-de-teste/);

  const semR2 = rodar({ PROVEDOR: "hetzner", R2_ACCOUNT_ID: "" });
  assert.equal(semR2.status, 0, semR2.saida);
  assert.doesNotMatch(semR2.saida, /SET /);

  const netcup = rodar({ PROVEDOR: "netcup", R2_ACCOUNT_ID: conta });
  assert.equal(netcup.status, 0, netcup.saida);
  assert.match(netcup.saida, /SET RESTIC_REPOSITORY=s3:https:\/\/[a-f0-9]+\.r2\.cloudflarestorage\.com\/bunker707-backups\/restic$/m);

  const invalida = rodar({ PROVEDOR: "hetzner", R2_ACCOUNT_ID: "conta; rm -rf /" });
  assert.notEqual(invalida.status, 0);
  assert.match(invalida.saida, /R2_ACCOUNT_ID invalido/);
});
