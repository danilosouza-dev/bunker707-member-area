import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { cloudDir, criarInfraDeMentira as setup, faltamBinarios, limparInfraDeMentira, serverFixture } from "./fixtures/infra-de-mentira.mjs";

// O deploy-membros aplica as migracoes novas na producao (docs/20 §9; docs/21 §9.11 e §9.12; o achado de 11/11/2026 para
// o primeiro ensaio de comprador, docs/20 §9F): o runner manda as migracoes do commit inteiras (sync_repo apaga a pasta do
// servidor antes) e, com o banco no ar, o servidor roda o infra/scripts/deploy.sh --image, que aplica as pendentes
// (migrate.sh: `supabase db push`, a CLI 2.121.0 do servidor) antes de recriar o app. As desta leva (de 202611100001 a
// 202611130001) vem depois da ultima que a producao aplicou (202611010001, no deploy de b2966ea em 03/11/2026), entao a
// CLI as aplica na ordem.

after(limparInfraDeMentira);

const skip = faltamBinarios.length ? `faltam ${faltamBinarios.join(", ")}` : false;
const root = fileURLToPath(new URL("..", import.meta.url));
const ULTIMA_NA_PRODUCAO = "202611010001";
// As desta leva, pelo nome: a versao pode mudar ate o merge (quando a dev entrou no branch do produto licenciado, a
// license_state passou de 202611100002 para 202611100003 e a 202611100002 virou a webinars_v7_na_tela).
const NOMES = ["webinars_v6_respostas", "license_state", "license_state_request_host", "held_sales", "storage_paths_checks", "license_sales"];
const TODAS = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const NOVAS = NOMES.map((nome) => TODAS.find((f) => f.replace(/^\d+_/, "").replace(/\.sql$/, "") === nome) ?? `(falta ${nome})`);
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

test("as migracoes novas estao no repositorio, todas depois da ultima que a producao aplicou, cada versao uma vez so e nenhuma fora da transacao", () => {
  for (const nova of NOVAS) assert.ok(TODAS.includes(nova), nova);
  // A CLI (`db push`) aplica sem --include-all o que vem depois da ultima do banco, na ordem das versoes.
  const pendentes = TODAS.filter((f) => f.slice(0, 12) > ULTIMA_NA_PRODUCAO);
  for (const nova of NOVAS) assert.ok(pendentes.includes(nova), `${nova} vem depois da ${ULTIMA_NA_PRODUCAO}`);
  // Duas migracoes com a mesma versao: a CLI e o historico (schema_migrations, chave pela versao) so guardam uma.
  const versoes = TODAS.map((f) => f.split("_")[0]);
  assert.deepEqual(versoes.filter((v, i) => versoes.indexOf(v) !== i), [], "cada versao uma vez so");
  for (const pendente of pendentes) {
    assert.doesNotMatch(readFileSync(join(root, "supabase/migrations", pendente), "utf8"), /^-- pg-delta: transaction=false/m, `${pendente} roda numa transacao`);
  }
});

test("deploy-membros manda as migracoes do commit inteiras e, com o banco no ar, roda o deploy.sh do servidor sem --no-migrate; na primeira vez, o migrate.sh", { skip }, () => {
  // O que o sync_repo manda: o repositorio do commit, com a pasta das migracoes trocada inteira no servidor.
  const dir = mkdtempSync(join(tmpdir(), "bunker707-sync-membros-"));
  dirs.push(dir);
  const tarFile = join(dir, "envio.tar");
  const sync = spawnSync("bash", ["-c", `. "${join(cloudDir, "lib.sh")}"; rsh() { case "$2" in mkdir*) printf '%s' "$2" > "$CMD_OUT"; cat > "$TAR_OUT" ;; esac; }; sync_repo deploy@x`], { encoding: "utf8", env: { ...process.env, TAR_OUT: tarFile, CMD_OUT: join(dir, "cmd"), TMPDIR: dir } });
  assert.equal(sync.status, 0, sync.stderr);
  assert.equal(readFileSync(join(dir, "cmd"), "utf8"), "mkdir -p '/opt/bunker707' && rm -rf '/opt/bunker707/supabase/migrations' && tar -x -C '/opt/bunker707'");
  const enviados = spawnSync("tar", ["-tf", tarFile], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout.split("\n");
  for (const nova of NOVAS) assert.ok(enviados.includes(`supabase/migrations/${nova}`), `${nova} vai ao servidor`);
  for (const script of ["infra/scripts/deploy.sh", "infra/scripts/migrate.sh"]) assert.ok(enviados.includes(script));

  const comBanco = (extra = {}) => {
    const conta = setup({ servers: [serverFixture("bunker707-membros", "membros", 1)] });
    const r = conta.runScript("deploy.sh", {
      GITHUB_TOKEN: "ghs_token_do_job",
      GITHUB_REPOSITORY: "danilosouza-dev/bunker707-member-area",
      SSH_SHIM_ENV: JSON.stringify({ SUPABASE_PUBLIC_URL: "https://api.bunker707.com.br", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_teste", JOBS_TICK_TOKEN: "tick" }),
      ...extra
    }, ["membros"]);
    const ssh = conta.calls().filter((c) => c.tool === "ssh" && !c.control);
    return { r, ssh, conta };
  };
  const commit = spawnSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();

  const { r, ssh } = comBanco();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const envio = ssh.findIndex((c) => c.command.includes("rm -rf '/opt/bunker707/supabase/migrations' && tar -x -C '/opt/bunker707'"));
  const deploy = ssh.findIndex((c) => c.command.includes("bash infra/scripts/deploy.sh --image"));
  assert.ok(envio >= 0 && deploy > envio, "as migracoes do commit chegam antes do deploy do servidor");
  assert.equal(ssh[deploy].command, `cd '/opt/bunker707' && bash infra/scripts/deploy.sh --image 'ghcr.io/danilosouza-dev/bunker707-member-area:hetzner-sha-${commit}'`);
  assert.doesNotMatch(ssh[deploy].command, /--no-migrate/, "o deploy-membros nunca pula as migracoes");

  // Primeira subida (o banco ainda nao existe): o migrate.sh direto, depois do compose up e antes da saude.
  const primeira = comBanco({ SSH_SHIM_REPLIES: JSON.stringify([{ contem: "ps -q db | grep -q .", codigo: 1 }]) });
  assert.equal(primeira.r.status, 0, primeira.r.stdout + primeira.r.stderr);
  const up = primeira.ssh.findIndex((c) => c.command.includes("docker compose -f infra/compose/docker-compose.yml up -d"));
  const migrate = primeira.ssh.findIndex((c) => c.command === "cd '/opt/bunker707' && bash infra/scripts/migrate.sh");
  assert.ok(up >= 0 && migrate > up);
});

test("no servidor, o deploy.sh --image aplica as migracoes pendentes (supabase db push, na pasta do repositorio) antes de recriar o app; --no-migrate e so a volta", { skip }, () => {
  // Os scripts de verdade (deploy.sh, migrate.sh, lib.sh) numa copia do repositorio com as migracoes de verdade; docker e a
  // CLI do Supabase de mentira; o smoke e o do tests/infra-smoke.test.mjs, aqui so um que passa.
  const dir = mkdtempSync(join(tmpdir(), "bunker707-deploy-servidor-"));
  dirs.push(dir);
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "infra/scripts"), { recursive: true });
  mkdirSync(join(repo, "infra/compose"), { recursive: true });
  mkdirSync(join(repo, "supabase"), { recursive: true });
  for (const f of ["deploy.sh", "migrate.sh", "lib.sh"]) copyFileSync(join(root, "infra/scripts", f), join(repo, "infra/scripts", f));
  writeFileSync(join(repo, "infra/scripts/smoke.sh"), "#!/usr/bin/env bash\necho '  smoke ok'\n");
  symlinkSync(join(root, "supabase/migrations"), join(repo, "supabase/migrations"));
  writeFileSync(join(repo, "infra/compose/docker-compose.yml"), "name: bunker707\n");
  const envFile = join(repo, "infra/compose/.env");
  const shims = join(dir, "shims");
  mkdirSync(shims);
  const log = join(dir, "chamadas.log");
  const shim = (nome, corpo) => {
    writeFileSync(join(shims, nome), `#!/usr/bin/env bash\n${corpo}\n`);
    chmodSync(join(shims, nome), 0o755);
  };
  shim("docker", [
    `printf 'docker %s\\n' "$*" >> "${log}"`,
    'case "$*" in',
    '  "image inspect "*) exit 1 ;;',
    '  *" ps --format "*) echo "healthy|running" ;;',
    "esac",
    "exit 0"
  ].join("\n"));
  // A CLI: anota o pedido, a pasta em que roda e as migracoes que ela ve ali (o que o db push aplicaria).
  shim("supabase", `printf 'supabase %s | %s | %s\\n' "$*" "$PWD" "$(ls supabase/migrations | tr '\\n' ' ')" >> "${log}"`);
  const rodar = (args) => {
    writeFileSync(envFile, "POSTGRES_PASSWORD=senha-do-banco-de-teste\nPOSTGRES_DIRECT_PORT=5433\nAPP_IMAGE=ghcr.io/x/y:hetzner-sha-antiga\n");
    writeFileSync(log, "");
    const r = spawnSync("bash", [join(repo, "infra/scripts/deploy.sh"), ...args], { encoding: "utf8", env: { ...process.env, PATH: `${shims}:${process.env.PATH}` } });
    return { r, linhas: readFileSync(log, "utf8").trim().split("\n") };
  };
  const imagem = "ghcr.io/danilosouza-dev/bunker707-member-area:hetzner-sha-1a2b3c4";

  const { r, linhas } = rodar(["--image", imagem]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const push = linhas.findIndex((l) => l.startsWith("supabase --yes db push --db-url postgresql://postgres:"));
  const up = linhas.findIndex((l) => /^docker compose -f .* up -d$/.test(l));
  const pull = linhas.findIndex((l) => /^docker compose -f .* pull app$/.test(l));
  assert.ok(pull >= 0 && pull < push && push < up, `a imagem, as migracoes e so entao o app: ${linhas.join(" / ")}`);
  const [, pasta, vistas] = linhas[push].split(" | ");
  assert.equal(pasta, repo, "a CLI roda na pasta do repositorio enviado");
  for (const nova of NOVAS) assert.ok(vistas.split(" ").includes(nova), `${nova} entre as que a CLI aplica`);
  assert.match(linhas[push], /--db-url postgresql:\/\/postgres:[^@ ]+@127\.0\.0\.1:5433\/postgres\?sslmode=disable \|/, "direto no Postgres do servidor");
  assert.match(readFileSync(envFile, "utf8"), new RegExp(`^APP_IMAGE=${imagem.replace(/[.:/]/g, "\\$&")}$`, "m"));
  assert.match(r.stdout, /Migracoes em .*supabase\/migrations \(\d+ arquivos\)/);

  // A volta para a imagem anterior (docs/20 §9) e o unico caminho sem migracao.
  const volta = rodar(["--image", imagem, "--no-migrate"]);
  assert.equal(volta.r.status, 0, volta.r.stderr);
  assert.ok(!volta.linhas.some((l) => l.startsWith("supabase ")), "--no-migrate nao chama a CLI");
  assert.ok(existsSync(join(repo, "infra/compose/.deploy-history")));
});
