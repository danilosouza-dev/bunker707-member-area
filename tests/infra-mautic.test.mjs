import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// Infra do Mautic (infra/mautic): o servidor de marketing proprio (docs/19 secao 5 e docs/20, "Mautic").
// O que da para provar sem servidor: o compose e o .env.example combinam, nenhuma porta sai fora do Caddy,
// o instalador web fica fechado, o gerador de segredos faz o que promete e o crontab tem as tarefas certas.
// Com o Docker na maquina, o compose e renderizado de verdade (docker compose config) e a configuracao do
// Mautic (MAUTIC_CONFIG_PARAMETERS) e conferida como JSON. Sem Docker, esse teste pula e diz o motivo.

const mauticDir = fileURLToPath(new URL("../infra/mautic/", import.meta.url));
const composePath = join(mauticDir, "docker-compose.yml");
const mauticCompose = readFileSync(composePath, "utf8");
const envExample = readFileSync(join(mauticDir, ".env.example"), "utf8");
const mauticCaddyfile = readFileSync(join(mauticDir, "caddy", "Caddyfile"), "utf8");
const cronSource = readFileSync(join(mauticDir, "cron", "mautic"), "utf8");
const mainCaddyfile = readFileSync(new URL("../infra/compose/caddy/Caddyfile", import.meta.url), "utf8");
const mainCompose = readFileSync(new URL("../infra/compose/docker-compose.yml", import.meta.url), "utf8");
const mainEnvExample = readFileSync(new URL("../infra/compose/.env.example", import.meta.url), "utf8");
const scriptFiles = readdirSync(join(mauticDir, "scripts")).filter((name) => name.endsWith(".sh")).sort();

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function hasBinary(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

// Copia .env.example e generate-secrets.mjs para uma pasta temporaria: o gerador grava o .env ao lado dele.
function prepareGenerator() {
  const dir = tempDir("bunker707-mautic-env-");
  copyFileSync(join(mauticDir, ".env.example"), join(dir, ".env.example"));
  copyFileSync(join(mauticDir, "generate-secrets.mjs"), join(dir, "generate-secrets.mjs"));
  const generate = (args) => run(process.execPath, [join(dir, "generate-secrets.mjs"), ...args]);
  return { dir, envPath: join(dir, ".env"), generate };
}

// Servicos do compose por texto (sem biblioteca de YAML): bloco de cada servico entre `services:` e o
// `volumes:` de primeiro nivel.
function composeServices(source) {
  const start = source.indexOf("\nservices:\n");
  const end = source.indexOf("\nvolumes:\n", start);
  assert.ok(start >= 0 && end > start, "compose precisa ter services: e volumes: no primeiro nivel");
  const block = source.slice(start + "\nservices:\n".length, end);
  const headers = [...block.matchAll(/^  ([a-z0-9-]+):\s*$/gm)];
  const services = new Map();
  headers.forEach((header, index) => {
    const from = header.index + header[0].length;
    const to = index + 1 < headers.length ? headers[index + 1].index : block.length;
    services.set(header[1], block.slice(from, to));
  });
  return services;
}

const expectedImages = {
  "mautic-db": "mysql:8.4.11",
  mautic: "mautic/mautic:7.2.1-apache",
  "mautic-cron": "mautic/mautic:7.2.1-apache",
  "mautic-worker": "mautic/mautic:7.2.1-apache",
  caddy: "caddy:2.11.7-alpine"
};

test("compose do Mautic: cinco servicos com imagem pinada, porta publicada so no caddy e caddy no perfil borda", () => {
  const services = composeServices(mauticCompose);
  assert.deepEqual([...services.keys()].sort(), Object.keys(expectedImages).sort());
  for (const [name, block] of services) {
    const image = /^\s+image:\s*(\S+)\s*$/m.exec(block)?.[1];
    assert.equal(image, expectedImages[name], `${name} precisa da imagem com a tag exata`);
    assert.match(image, /:\d+\.\d+\.\d+/, `${name}: a tag precisa ser uma versao completa (nada de latest ou 8.4)`);
    if (name === "caddy") {
      assert.match(block, /^\s+ports:\s*$/m, "o caddy e o unico que publica porta");
      assert.match(block, /^\s+profiles:\s*\[\s*"borda"\s*\]\s*$/m, "o caddy fica atras do perfil borda");
    } else {
      assert.doesNotMatch(block, /^\s+ports:/m, `${name} nao pode publicar porta no servidor`);
      assert.doesNotMatch(block, /^\s+profiles:/m, `${name} sobe sempre, sem perfil`);
    }
  }
  // Os tres papeis do Mautic compartilham o mesmo ambiente (ancora) e o banco so e alcancado pela rede do compose.
  assert.equal((mauticCompose.match(/<<: \*mautic-env/g) ?? []).length, 3);
  assert.match(services.get("mautic-db"), /MYSQL_PASSWORD: \$\{MAUTIC_DB_PASSWORD\}/);
  assert.doesNotMatch(services.get("mautic-db"), /3306:3306/);
});

test("toda variavel que o compose e os scripts do Mautic leem existe no .env.example", () => {
  const declared = new Set([...envExample.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]));
  const referenced = new Set([...mauticCompose.matchAll(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g)].map((match) => match[1]));
  const relevant = [...referenced].filter((name) => /^(MAUTIC_|CADDY_|ACME_EMAIL$|STORAGE_BOX_|RESTIC_)/.test(name));
  assert.ok(relevant.length >= 12, `esperava mais variaveis no compose, achei ${relevant.length}`);
  for (const name of relevant) assert.ok(declared.has(name), `${name} e usada no compose mas falta no .env.example`);
  for (const name of ["MAUTIC_PUBLIC_URL", "MAUTIC_MAILER_DSN", "MAUTIC_MAILER_FROM_EMAIL", "MAUTIC_TRUSTED_PROXIES", "CADDY_BIND"]) {
    assert.ok(referenced.has(name), `${name} precisa ser lida pelo compose`);
  }
  // O que os scripts leem do .env (env_value / require_env_value) tambem precisa estar no exemplo.
  for (const file of scriptFiles) {
    const source = readFileSync(join(mauticDir, "scripts", file), "utf8");
    for (const match of source.matchAll(/(?:require_)?env_value ([A-Z0-9_]+)/g)) {
      assert.ok(declared.has(match[1]), `${file} le ${match[1]}, que falta no .env.example`);
    }
  }
  // Segredos do exemplo ficam vazios: o .env real e sempre gerado.
  for (const name of ["MAUTIC_DB_PASSWORD", "MAUTIC_DB_ROOT_PASSWORD", "MAUTIC_ADMIN_PASSWORD", "RESTIC_PASSWORD"]) {
    assert.match(envExample, new RegExp(`^${name}=$`, "m"), `${name} no exemplo precisa ficar vazio`);
  }
});

test("o instalador web do Mautic responde 403 fora da allowlist nos dois Caddyfiles, e o compose principal usa mautic.invalid sem Mautic", () => {
  // Caddyfile do servidor de marketing: /installer so para MAUTIC_ADMIN_IPS; o handle permitido vem antes do 403.
  assert.match(mauticCaddyfile, /@instalador_permitido \{\s*path \/installer \/installer\/\*\s*client_ip \{\$MAUTIC_ADMIN_IPS\}\s*\}/);
  assert.match(mauticCaddyfile, /@instalador path \/installer \/installer\/\*/);
  assert.match(mauticCaddyfile, /handle @instalador \{\s*respond 403\s*\}/);
  assert.ok(
    mauticCaddyfile.indexOf("handle @instalador_permitido {") < mauticCaddyfile.indexOf("handle @instalador {"),
    "o handle da allowlist precisa vir antes do 403 (o Caddy aplica o primeiro handle que casa)"
  );
  assert.match(mauticCaddyfile, /reverse_proxy mautic:80 \{\s*header_up X-Forwarded-For \{client_ip\}/);
  assert.match(mauticCaddyfile, /^\{\$MAUTIC_SITE_ADDRESS\} \{/m);

  // Caddyfile principal (colocacao): o site do Mautic com a mesma regra, allowlist = STUDIO_ALLOWED_IPS.
  const siteStart = mainCaddyfile.indexOf("{$MAUTIC_SITE_ADDRESS} {");
  assert.ok(siteStart >= 0, "o Caddyfile principal precisa do site opcional do Mautic");
  const site = mainCaddyfile.slice(siteStart);
  assert.match(site, /@instalador_permitido \{\s*path \/installer \/installer\/\*\s*client_ip \{\$STUDIO_ALLOWED_IPS\}\s*\}/);
  assert.match(site, /handle @instalador \{\s*respond 403\s*\}/);
  assert.ok(site.indexOf("handle @instalador_permitido {") < site.indexOf("handle @instalador {"));
  assert.equal((site.match(/reverse_proxy mautic:80/g) ?? []).length, 2);

  // Sem Mautic no servidor principal o site nunca casa com pedido algum: hostname invalido por padrao.
  assert.match(mainCompose, /MAUTIC_SITE_ADDRESS:\s*\$\{MAUTIC_SITE_ADDRESS:-http:\/\/mautic\.invalid\}/);
  assert.match(mainEnvExample, /^MAUTIC_SITE_ADDRESS=$/m);
});

test("generate-secrets --local grava um .env 0600 com senhas geradas e enderecos locais, e nao repete sem --force", () => {
  const { envPath, generate } = prepareGenerator();
  const first = generate(["--local"]);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(existsSync(envPath));
  assert.equal(statSync(envPath).mode & 0o777, 0o600, "o .env precisa ficar so para o dono");

  const env = parseEnv(readFileSync(envPath, "utf8"));
  for (const key of ["MAUTIC_DB_PASSWORD", "MAUTIC_DB_ROOT_PASSWORD", "MAUTIC_ADMIN_PASSWORD", "RESTIC_PASSWORD"]) {
    const value = env.get(key) ?? "";
    assert.ok(value.length >= 16, `${key} precisa sair preenchido`);
    assert.doesNotMatch(value, /[$#]/, `${key} nao pode ter $ ou # (o compose leria errado sem aspas)`);
    assert.doesNotMatch(value, /\s/, `${key} sem espaco`);
    assert.ok(!first.stdout.includes(value) && !first.stderr.includes(value), `${key} nao pode ser impresso no terminal`);
  }
  assert.notEqual(env.get("MAUTIC_DB_PASSWORD"), env.get("MAUTIC_DB_ROOT_PASSWORD"));
  assert.equal(env.get("MAUTIC_PUBLIC_URL"), "http://mautic.127.0.0.1.sslip.io:3080");
  assert.equal(env.get("MAUTIC_SITE_ADDRESS"), "http://mautic.127.0.0.1.sslip.io");
  assert.equal(env.get("CADDY_BIND"), "127.0.0.1");
  assert.equal(env.get("CADDY_HTTP_PORT"), "3080");
  assert.equal(env.get("MAUTIC_MAILER_DSN"), "null://null", "ensaio local nao envia e-mail");
  assert.equal(env.get("MAUTIC_ADMIN_USERNAME"), "bunker707");
  // O gerador so troca valores: as linhas de comentario e a ordem do exemplo continuam iguais.
  assert.equal(readFileSync(envPath, "utf8").split("\n").length, envExample.split("\n").length);

  const second = generate(["--local"]);
  assert.notEqual(second.status, 0, "rodar de novo sem --force tem que falhar");
  assert.match(second.stderr, /--force/);
  assert.equal(parseEnv(readFileSync(envPath, "utf8")).get("MAUTIC_DB_PASSWORD"), env.get("MAUTIC_DB_PASSWORD"), "o .env fica como estava");

  const forced = generate(["--local", "--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.notEqual(parseEnv(readFileSync(envPath, "utf8")).get("MAUTIC_DB_PASSWORD"), env.get("MAUTIC_DB_PASSWORD"), "--force gera senhas novas");
});

test("generate-secrets em producao exige --domain e --email e deriva os enderecos do dominio", () => {
  const { envPath, generate } = prepareGenerator();
  const semEmail = generate(["--domain", "marketing.exemplo.com.br"]);
  assert.notEqual(semEmail.status, 0);
  assert.match(semEmail.stderr, /--email/);
  assert.ok(!existsSync(envPath), "sem os dados nao grava nada");

  const semDomain = generate(["--email", "equipe@exemplo.com.br"]);
  assert.notEqual(semDomain.status, 0);
  assert.match(semDomain.stderr, /--domain/);

  const comEsquema = generate(["--domain", "https://marketing.exemplo.com.br", "--email", "equipe@exemplo.com.br"]);
  assert.notEqual(comEsquema.status, 0, "--domain e um hostname, sem https://");

  const ok = generate(["--domain", "marketing.exemplo.com.br", "--email", "equipe@exemplo.com.br", "--admin-ips", "203.0.113.10/32"]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = parseEnv(readFileSync(envPath, "utf8"));
  assert.equal(env.get("MAUTIC_SITE_ADDRESS"), "marketing.exemplo.com.br");
  assert.equal(env.get("MAUTIC_PUBLIC_URL"), "https://marketing.exemplo.com.br");
  assert.equal(env.get("ACME_EMAIL"), "equipe@exemplo.com.br");
  assert.equal(env.get("MAUTIC_ADMIN_EMAIL"), "equipe@exemplo.com.br");
  assert.equal(env.get("MAUTIC_ADMIN_IPS"), "203.0.113.10/32");
  assert.equal(env.get("CADDY_BIND"), "0.0.0.0");
  assert.equal(env.get("RESTIC_REPOSITORY"), "sftp:storagebox:/bunker707/restic-mautic");
  assert.ok((env.get("MAUTIC_ADMIN_PASSWORD") ?? "").length >= 16);
  assert.match(ok.stdout, /MAUTIC_MAILER_DSN/, "lembra o que ainda precisa ser preenchido a mao");
});

test("docker compose config renderiza o stack: MAUTIC_CONFIG_PARAMETERS e JSON com site_url, mailer_dsn e trusted_proxies, e o caddy so entra com o perfil borda", (t) => {
  if (!hasBinary("docker", ["compose", "version"])) {
    t.skip("docker compose nao esta nesta maquina");
    return;
  }
  const { envPath, generate } = prepareGenerator();
  const generated = generate(["--local"]);
  assert.equal(generated.status, 0, generated.stderr);
  const env = parseEnv(readFileSync(envPath, "utf8"));
  const compose = (extra) => run("docker", ["compose", "-f", composePath, "--env-file", envPath, ...extra, "config", "--format", "json"]);

  const comBorda = compose(["--profile", "borda"]);
  assert.equal(comBorda.status, 0, comBorda.stderr);
  const config = JSON.parse(comBorda.stdout);
  assert.deepEqual(Object.keys(config.services).sort(), Object.keys(expectedImages).sort());
  for (const [name, image] of Object.entries(expectedImages)) assert.equal(config.services[name].image, image);

  const web = config.services.mautic.environment;
  const parameters = JSON.parse(web.MAUTIC_CONFIG_PARAMETERS);
  assert.equal(parameters.site_url, env.get("MAUTIC_PUBLIC_URL"));
  assert.equal(parameters.mailer_dsn, "null://null");
  assert.equal(parameters.mailer_from_email, env.get("MAUTIC_MAILER_FROM_EMAIL"));
  assert.ok(Array.isArray(parameters.trusted_proxies) && parameters.trusted_proxies.length >= 1, "trusted_proxies precisa ser uma lista");
  for (const cidr of parameters.trusted_proxies) assert.match(cidr, /^\d+\.\d+\.\d+\.\d+\/\d+$/);
  assert.equal(parameters.default_timezone, "America/Sao_Paulo");
  // Os tres papeis recebem a mesma configuracao e a senha do banco bate com a do MySQL.
  assert.equal(config.services["mautic-cron"].environment.MAUTIC_CONFIG_PARAMETERS, web.MAUTIC_CONFIG_PARAMETERS);
  assert.equal(config.services["mautic-worker"].environment.MAUTIC_CONFIG_PARAMETERS, web.MAUTIC_CONFIG_PARAMETERS);
  assert.equal(web.DOCKER_MAUTIC_ROLE, "mautic_web");
  assert.equal(config.services["mautic-cron"].environment.DOCKER_MAUTIC_ROLE, "mautic_cron");
  assert.equal(config.services["mautic-worker"].environment.DOCKER_MAUTIC_ROLE, "mautic_worker");
  assert.equal(web.MAUTIC_DB_PASSWORD, env.get("MAUTIC_DB_PASSWORD"));
  assert.equal(config.services["mautic-db"].environment.MYSQL_PASSWORD, env.get("MAUTIC_DB_PASSWORD"));
  assert.equal(config.services["mautic-db"].environment.MYSQL_ROOT_PASSWORD, env.get("MAUTIC_DB_ROOT_PASSWORD"));
  // Porta publicada so no caddy, e presa a CADDY_BIND (127.0.0.1 no ensaio local).
  for (const [name, service] of Object.entries(config.services)) {
    if (name === "caddy") {
      assert.ok(service.ports.length >= 2);
      for (const port of service.ports) assert.equal(port.host_ip, env.get("CADDY_BIND"));
    } else {
      assert.equal(service.ports, undefined, `${name} nao pode publicar porta`);
    }
  }

  const semBorda = compose([]);
  assert.equal(semBorda.status, 0, semBorda.stderr);
  const servicesSemBorda = Object.keys(JSON.parse(semBorda.stdout).services).sort();
  assert.deepEqual(servicesSemBorda, ["mautic", "mautic-cron", "mautic-db", "mautic-worker"], "sem o perfil borda o caddy fica de fora (colocacao)");
});

test("crontab do Mautic roda segmentos, campanhas, broadcasts e importacao, e deixa a limpeza desligada", () => {
  const activeLines = cronSource
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#") && !/^[A-Z_]+=/.test(line));
  assert.ok(activeLines.length >= 5);
  for (const line of activeLines) {
    assert.match(line, /^(\S+\s+){5}php \/var\/www\/html\/bin\/console mautic:[a-z:]+/, `linha do cron fora do formato: ${line}`);
  }
  for (const command of ["mautic:segments:update", "mautic:campaigns:update", "mautic:campaigns:trigger", "mautic:broadcasts:send", "mautic:import"]) {
    assert.ok(activeLines.some((line) => line.includes(`console ${command} `)), `${command} precisa estar ligado`);
  }
  assert.ok(!activeLines.some((line) => line.includes("maintenance:cleanup")), "a limpeza de dados antigos fica desligada ate ser decidida");
  assert.match(cronSource, /^#.*mautic:maintenance:cleanup/m, "a linha da limpeza existe comentada, pronta para ligar");
  // Campanhas depois dos segmentos: update 5 minutos depois, trigger 10 minutos depois.
  assert.match(cronSource, /^0,15,30,45 .* mautic:segments:update/m);
  assert.match(cronSource, /^5,20,35,50 .* mautic:campaigns:update/m);
  assert.match(cronSource, /^10,25,40,55 .* mautic:campaigns:trigger/m);
});

test("scripts do Mautic passam na conferencia de sintaxe do bash", () => {
  assert.deepEqual(scriptFiles, ["_env.sh", "backup.sh", "install.sh", "restore.sh", "smoke.sh"]);
  for (const file of [...scriptFiles.map((name) => join("scripts", name)), "generate-secrets.sh"]) {
    const result = run("bash", ["-n", join(mauticDir, file)]);
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
  // generate-secrets.sh e POSIX sh (roda no servidor sem bash): tambem passa no sh.
  const posix = run("sh", ["-n", join(mauticDir, "generate-secrets.sh")]);
  assert.equal(posix.status, 0, posix.stderr);
});
