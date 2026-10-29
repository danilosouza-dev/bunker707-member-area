import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Infra dos Webinarios, fase 3a (docs/30 §6 e §7; docs/20 §8B): o Jitsi proprio do servidor C (infra/jitsi), o
// gravador por hora (infra/jitsi/jibri e infra/cloud/jibri.sh) e as etapas novas do workflow. Nada aqui fala com a
// Hetzner, a Cloudflare, a Bunny ou um servidor. O que se prova sem servidor: o compose fixa uma tag stable e nao
// publica porta fora do desenho, o site fica sem a marca do Jitsi (os custom-*.js avaliados de verdade), o gerador
// de segredos faz o que promete sem imprimir nada, o finalize.sh envia o MP4 e assina o webhook como o app confere
// (rodado contra um curl e um ffprobe de mentira), as regras de firewall do servidor C e as travas CONFIRMADO=sim,
// e o workflow e o run.sh listam as mesmas etapas.

const jitsiDir = fileURLToPath(new URL("../infra/jitsi/", import.meta.url));
const cloudDir = fileURLToPath(new URL("../infra/cloud/", import.meta.url));
const read = (path) => readFileSync(path, "utf8");
const composePath = join(jitsiDir, "docker-compose.yml");
const composeSource = read(composePath);
const envExample = read(join(jitsiDir, ".env.example"));
const jibriCompose = read(join(jitsiDir, "jibri", "docker-compose.yml"));
const jibriEnvExample = read(join(jitsiDir, "jibri", ".env.example"));
const caddyfile = read(join(jitsiDir, "caddy", "Caddyfile"));
const customConfig = read(join(jitsiDir, "web", "custom-config.js"));
const customInterface = read(join(jitsiDir, "web", "custom-interface_config.js"));
const finalizePath = join(jitsiDir, "jibri", "finalize.sh");
const finalizeSource = read(finalizePath);
const cloudInit = read(join(jitsiDir, "jibri", "cloud-init.yaml"));
const libSource = read(join(cloudDir, "lib.sh"));
const runSource = read(join(cloudDir, "run.sh"));
const jibriSource = read(join(cloudDir, "jibri.sh"));
const deploySource = read(join(cloudDir, "deploy.sh"));
const provisionSource = read(join(cloudDir, "provision.sh"));
const secretsSource = read(join(cloudDir, "secrets.sh"));
const statusSource = read(join(cloudDir, "status.sh"));
const workflowSource = read(fileURLToPath(new URL("../.github/workflows/infra.yml", import.meta.url)));
const mauticCompose = read(fileURLToPath(new URL("../infra/mautic/docker-compose.yml", import.meta.url)));
const docs20 = read(fileURLToPath(new URL("../docs/20-runbook-hetzner.md", import.meta.url)));
const docs30 = read(fileURLToPath(new URL("../docs/30-webinarios.md", import.meta.url)));
const scriptFiles = readdirSync(join(jitsiDir, "scripts")).filter((name) => name.endsWith(".sh")).sort();
const secretNames = ["BUNNY_API_KEY", "WEBINAR_RECORDER_WEBHOOK_SECRET", "JIBRI_XMPP_PASSWORD", "JIBRI_RECORDER_PASSWORD", "JWT_APP_SECRET", "JICOFO_AUTH_PASSWORD", "JVB_AUTH_PASSWORD", "TURN_CREDENTIALS"];

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

// Ambiente limpo para os scripts de infra/cloud: sem token, sem variaveis do Actions, TMPDIR proprio (lib.sh
// cria a pasta de trabalho ali) e nenhuma das opcoes das etapas.
function cleanEnv(overrides = {}) {
  const env = { ...process.env, TMPDIR: tempDir("bunker707-jitsi-work-") };
  for (const name of ["HCLOUD_TOKEN", "CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN", "JIBRI_SECRETS", "GITHUB_OUTPUT", "GITHUB_ACTIONS", "RUNNER_TEMP", "OPCOES", "PAYLOAD", "COMANDO", "CONFIRMADO", "SESSAO", "FORCAR", "FORCE", "SEM_LIVE_2H"]) delete env[name];
  return { ...env, ...overrides };
}

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

// Servicos de um compose por texto (sem biblioteca de YAML): o bloco de cada servico entre `services:` e a
// proxima chave de primeiro nivel (networks, volumes ou um comentario na coluna zero).
function composeServices(source) {
  const start = source.indexOf("\nservices:\n");
  assert.ok(start >= 0, "compose precisa ter services: no primeiro nivel");
  const rest = source.slice(start + "\nservices:\n".length);
  const next = rest.search(/^[a-z#]/m);
  const block = next >= 0 ? rest.slice(0, next) : rest;
  const headers = [...block.matchAll(/^  ([a-z0-9-]+):\s*$/gm)];
  const services = new Map();
  headers.forEach((header, index) => {
    const from = header.index + header[0].length;
    const to = index + 1 < headers.length ? headers[index + 1].index : block.length;
    services.set(header[1], block.slice(from, to));
  });
  return services;
}

const declaredKeys = (example) => new Set([...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]));
const referencedKeys = (source) => new Set([...source.matchAll(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g)].map((match) => match[1]));
const pinnedTag = (example) => /^JITSI_IMAGE_VERSION=(\S+)$/m.exec(example)?.[1];

// Copia .env.example e generate-secrets.mjs para uma pasta temporaria: o gerador grava o .env ao lado dele.
function prepareGenerator() {
  const dir = tempDir("bunker707-jitsi-env-");
  copyFileSync(join(jitsiDir, ".env.example"), join(dir, ".env.example"));
  copyFileSync(join(jitsiDir, "generate-secrets.mjs"), join(dir, "generate-secrets.mjs"));
  const generate = (args) => run(process.execPath, [join(dir, "generate-secrets.mjs"), ...args]);
  return { dir, envPath: join(dir, ".env"), generate };
}

const jitsiServices = ["web", "prosody", "jicofo", "jvb"];

test("compose do Jitsi: web, prosody, jicofo e jvb na tag stable fixada, saude em todos, portas so as do desenho, caddy no perfil borda", () => {
  const services = composeServices(composeSource);
  assert.deepEqual([...services.keys()].sort(), ["caddy", "jicofo", "jvb", "prosody", "web"]);
  for (const name of jitsiServices) {
    const block = services.get(name);
    assert.equal(/^\s+image:\s*(\S+)\s*$/m.exec(block)?.[1], `\${JITSI_IMAGE_REPO:-ghcr.io/jitsi}/${name}:\${JITSI_IMAGE_VERSION}`, `${name}: imagem oficial na tag fixada`);
    assert.match(block, /^\s+restart: unless-stopped\s*$/m, `${name}: volta sozinho`);
    assert.match(block, /^\s+read_only: true\s*$/m, `${name}: raiz somente leitura, como no compose oficial`);
    assert.match(block, /^\s+healthcheck:\s*$/m, `${name}: healthcheck no compose (as imagens trazem o script, nao a diretiva)`);
    assert.doesNotMatch(block, /^\s+profiles:/m, `${name} sobe sempre, sem perfil`);
    assert.match(block, /<<: \*common-env/, `${name}: os dominios, o TZ e a autenticacao vem da ancora comum`);
  }
  assert.doesNotMatch(composeSource, /:(latest|stable|unstable)\b/, "nenhuma imagem em latest/stable/unstable flutuante");
  const tag = pinnedTag(envExample);
  assert.match(tag, /^stable-\d{4,6}(-\d+)?$/, "JITSI_IMAGE_VERSION e uma tag stable-NNNNN");
  assert.equal(pinnedTag(jibriEnvExample), tag, "o Jibri roda a MESMA tag do stack");
  assert.ok(docs30.includes(`JITSI_IMAGE_VERSION=${tag}`), "docs/30 §6.2 cita a tag fixada; update.sh --apply pede para atualizar junto");

  // web: HTTP em 8000 atras do Caddy, sem Let's Encrypt, sem porta publicada, com os nossos arquivos no fim do config.
  const web = services.get("web");
  assert.doesNotMatch(web, /^\s+ports:/m, "o web nao publica porta: so o Caddy chega nele");
  assert.match(web, /DISABLE_HTTPS: "1"/);
  assert.match(web, /ENABLE_LETSENCRYPT: "0"/);
  assert.match(web, /ENABLE_HTTP_REDIRECT: "0"/);
  assert.match(web, /http:\/\/127\.0\.0\.1:8000\//, "o healthcheck bate na porta 8000 (usuario sem privilegio da imagem)");
  assert.match(web, /- \.\/web\/custom-config\.js:\/config\/custom-config\.js:ro/);
  assert.match(web, /- \.\/web\/custom-interface_config\.js:\/config\/custom-interface_config\.js:ro/);
  for (const key of ["ENABLE_P2P", "ENABLE_PREJOIN_PAGE", "ENABLE_WELCOME_PAGE", "ENABLE_CLOSE_PAGE", "ENABLE_BREAKOUT_ROOMS", "ENABLE_THIRD_PARTY_REQUESTS"]) {
    assert.match(web, new RegExp(`${key}: "\\$\\{${key}:-0\\}"`), `${key} desligado por padrao`);
  }
  for (const key of ["DISABLE_DEEP_LINKING", "DISABLE_POLLS", "DISABLE_REACTIONS", "DISABLE_PRIVATE_CHAT", "DISABLE_REMOTE_VIDEO_MENU", "START_WITH_AUDIO_MUTED", "START_WITH_VIDEO_MUTED"]) {
    assert.match(web, new RegExp(`${key}: "\\$\\{${key}:-1\\}"`), `${key} ligado por padrao`);
  }
  assert.match(web, /RESOLUTION: "\$\{RESOLUTION:-1080\}"/, "teto de captura 1080p (D26)");
  assert.match(web, /DESKTOP_SHARING_FRAMERATE_MAX: "\$\{DESKTOP_SHARING_FRAMERATE_MAX:-30\}"/, "tela compartilhada a 30 quadros");
  for (const codec of ["VP8", "VP9", "AV1"]) {
    assert.match(web, new RegExp(`VIDEOQUALITY_BITRATE_${codec}_FULL: "\\$\\{VIDEOQUALITY_BITRATE_FULL:-4000000\\}"`), `${codec}: 1080p em ~4 Mbit/s`);
  }
  assert.doesNotMatch(web, /VIDEOQUALITY_MIN_HEIGHT_FOR_QUALITY_LVL/, "o objeto de niveis fica no custom-config.js (chaves com { } nao cabem na interpolacao do compose)");

  // prosody: JWT, sem convidado, host moderador pelo token; a 5222 sai so na interface escolhida.
  const prosody = services.get("prosody");
  assert.match(prosody, /JWT_APP_SECRET: "\$\{JWT_APP_SECRET\}"/);
  assert.match(prosody, /JWT_ALLOW_EMPTY: "0"/);
  assert.match(prosody, /XMPP_MUC_MODULES: "\$\{XMPP_MUC_MODULES:-token_affiliation,bunker_room_guard\}"/, "o modulo que barra quem foi removido ou banido");
  assert.match(prosody, /ROOM_GUARD_URL: "\$\{ROOM_GUARD_URL:-\}"/);
  assert.match(prosody, /- \.\/prosody\/plugins:\/prosody-plugins-custom:ro/, "a copia versionada do token_affiliation entra no caminho dos plugins");
  assert.match(prosody, /\/usr\/local\/bin\/healthcheck\.sh/);
  const prosodyPorts = [...prosody.matchAll(/^\s+- "([^"]+)"\s*$/gm)].map((m) => m[1]).filter((p) => /:\d+$/.test(p));
  assert.deepEqual(prosodyPorts, ["${XMPP_PUBLIC_BIND:-0.0.0.0}:${XMPP_PORT:-5222}:5222"], "so a 5222 (XMPP do Jibri) sai do prosody");
  assert.match(prosody, /aliases:\s*\n\s+- \$\{XMPP_SERVER:-xmpp\.meet\.jitsi\}/, "o prosody atende pelo nome que jicofo, jvb e web usam");

  // jicofo e jvb: tetos da JVM para o cx23, auto-owner desligado, saude em 127.0.0.1, midia em UDP 10000.
  const jicofo = services.get("jicofo");
  assert.match(jicofo, /ENABLE_AUTO_OWNER: "\$\{ENABLE_AUTO_OWNER:-0\}"/, "o primeiro que entra nao vira moderador (D14)");
  assert.match(jicofo, /JICOFO_MAX_MEMORY: "\$\{JICOFO_MAX_MEMORY:-512m\}"/);
  assert.match(jicofo, /JICOFO_ENABLE_HEALTH_CHECKS: "\$\{JICOFO_ENABLE_HEALTH_CHECKS:-1\}"/, "sem a saude ligada /about/health responde 404 e o healthcheck nunca passa");
  assert.match(jicofo, /JICOFO_ENABLE_REST: "\$\{JICOFO_ENABLE_REST:-1\}"/, "sem a REST ligada o jicofo ouve so no loopback do container e o smoke.sh (127.0.0.1:8888 do servidor) ve 000");
  assert.match(jicofo, /- "127\.0\.0\.1:\$\{JICOFO_REST_PORT:-8888\}:8888"/);
  assert.doesNotMatch(jicofo, /^\s+- "(?!127\.0\.0\.1:)[^"]*:\d+"\s*$/m, "o jicofo nao publica porta fora de 127.0.0.1");
  const jvb = services.get("jvb");
  assert.match(jvb, /- "\$\{JVB_PORT:-10000\}:\$\{JVB_PORT:-10000\}\/udp"/, "a midia entra por UDP 10000");
  assert.match(jvb, /- "127\.0\.0\.1:\$\{JVB_COLIBRI_PORT:-8080\}:8080"/);
  assert.match(jvb, /VIDEOBRIDGE_MAX_MEMORY: "\$\{VIDEOBRIDGE_MAX_MEMORY:-1536m\}"/);
  assert.match(jvb, /JVB_ADVERTISE_IPS: "\$\{JVB_ADVERTISE_IPS:-\}"/, "o IPv4 publico anunciado vem do .env (deploy-meet grava)");

  // Ancora comum: so JWT, sem convidado, gravacao ligada, UTC.
  const anchor = composeSource.slice(composeSource.indexOf("x-common-env:"), composeSource.indexOf("\nservices:"));
  assert.match(anchor, /ENABLE_AUTH: "\$\{ENABLE_AUTH:-1\}"/);
  assert.match(anchor, /AUTH_TYPE: "\$\{AUTH_TYPE:-jwt\}"/);
  assert.match(anchor, /ENABLE_GUESTS: "\$\{ENABLE_GUESTS:-0\}"/);
  assert.match(anchor, /ENABLE_RECORDING: "\$\{ENABLE_RECORDING:-1\}"/);
  assert.match(anchor, /TZ: "\$\{TZ:-UTC\}"/);

  // Caddy: o mesmo do Mautic, atras do perfil borda, unica porta publica alem do UDP 10000.
  const caddy = services.get("caddy");
  assert.match(caddy, /^\s+profiles:\s*\[\s*"borda"\s*\]\s*$/m);
  const mauticCaddyImage = /image:\s*(caddy:\S+)/.exec(mauticCompose)?.[1];
  assert.equal(/image:\s*(caddy:\S+)/.exec(caddy)?.[1], mauticCaddyImage, "a mesma imagem do Caddy dos outros servidores (um jeito so de operar TLS)");
  assert.match(caddy, /- \.\/caddy\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
  assert.equal((caddy.match(/\$\{CADDY_BIND:-0\.0\.0\.0\}/g) ?? []).length, 3, "80, 443 e 443/udp presos a CADDY_BIND");
});

test("toda variavel que os composes e os scripts do Jitsi leem existe nos .env.example, comentada; segredos do exemplo ficam vazios", () => {
  const declared = declaredKeys(envExample);
  for (const name of referencedKeys(composeSource)) assert.ok(declared.has(name), `${name} e usada no compose do Jitsi mas falta em infra/jitsi/.env.example`);
  for (const name of ["PUBLIC_URL", "MEET_SITE_ADDRESS", "MEET_FRAME_ANCESTORS", "JWT_APP_SECRET", "JITSI_IMAGE_VERSION", "JVB_ADVERTISE_IPS", "VIDEOBRIDGE_MAX_MEMORY", "JICOFO_MAX_MEMORY"]) {
    assert.ok(referencedKeys(composeSource).has(name), `${name} precisa ser lida pelo compose`);
  }
  const declaredJibri = declaredKeys(jibriEnvExample);
  for (const name of referencedKeys(jibriCompose)) assert.ok(declaredJibri.has(name), `${name} e usada no compose do Jibri mas falta em jibri/.env.example`);
  for (const file of scriptFiles) {
    const source = read(join(jitsiDir, "scripts", file));
    for (const match of source.matchAll(/(?:require_)?env_value ([A-Z0-9_]+)/g)) {
      assert.ok(declared.has(match[1]), `scripts/${file} le ${match[1]}, que falta no .env.example`);
    }
  }
  for (const name of ["JICOFO_AUTH_PASSWORD", "JVB_AUTH_PASSWORD", "JIBRI_XMPP_PASSWORD", "JIBRI_RECORDER_PASSWORD", "JWT_APP_SECRET", "TURN_CREDENTIALS"]) {
    assert.match(envExample, new RegExp(`^${name}=$`, "m"), `${name} no exemplo precisa ficar vazio`);
  }
  for (const name of ["JIBRI_XMPP_PASSWORD", "JIBRI_RECORDER_PASSWORD", "WEBINAR_RECORDER_WEBHOOK_SECRET", "BUNNY_API_KEY", "SESSAO", "XMPP_SERVER"]) {
    assert.match(jibriEnvExample, new RegExp(`^${name}=$`, "m"), `${name} no exemplo do Jibri fica vazio (o jibri-up preenche)`);
  }
  // Os dominios XMPP internos sao os mesmos nos dois exemplos: o gravador fala com o prosody do servidor C.
  for (const name of ["XMPP_DOMAIN", "XMPP_AUTH_DOMAIN", "XMPP_MUC_DOMAIN", "XMPP_INTERNAL_MUC_DOMAIN", "XMPP_HIDDEN_DOMAIN"]) {
    assert.equal(parseEnv(jibriEnvExample).get(name), parseEnv(envExample).get(name), `${name} igual nos dois .env.example`);
  }
  // Cada chave vem explicada (comentario em portugues nas linhas logo acima) nos dois exemplos.
  for (const [label, example] of [["infra/jitsi/.env.example", envExample], ["jibri/.env.example", jibriEnvExample]]) {
    const lines = example.split("\n");
    lines.forEach((line, index) => {
      if (!/^[A-Z0-9_]+=/.test(line)) return;
      const above = lines.slice(Math.max(0, index - 6), index);
      assert.ok(above.some((l) => /^# \S/.test(l)), `${label}: ${line.split("=")[0]} sem comentario explicando`);
    });
  }
});

test("Caddyfile do meet: HTTPS automatico, proxy para web:8000, sem Server, sem Cloudflare, iframe so para a nossa origem, CA interna so no ensaio", () => {
  assert.match(caddyfile, /^\{\$MEET_SITE_ADDRESS\} \{/m);
  assert.match(caddyfile, /reverse_proxy web:8000 \{/, "o site da imagem escuta em 8000, nao em 80");
  assert.match(caddyfile, /header -Server/);
  assert.match(caddyfile, /header Content-Security-Policy "frame-ancestors \{\$MEET_FRAME_ANCESTORS\}"/);
  assert.match(caddyfile, /email \{\$ACME_EMAIL\}/);
  assert.match(caddyfile, /^\s+\{\$CADDY_LOCAL_CERTS\}\s*$/m, "local_certs entra pelo .env so no ensaio local");
  assert.doesNotMatch(caddyfile, /cloudflare-trusted-proxies/, "meet.<dominio> e DNS puro: nenhuma lista de proxies da Cloudflare");
  assert.doesNotMatch(caddyfile, /tls internal/, "nada de CA interna fixa no arquivo (producao e Let's Encrypt)");
  assert.doesNotMatch(caddyfile, /X-Frame-Options/i, "o site precisa abrir dentro do iframe da area de membros");
});

test("custom-config.js e custom-interface_config.js, avaliados como o navegador faria: sem marca nem nome do Jitsi, chat/enquetes/reacoes desligados, qualidade da D26", () => {
  const interfaceConfig = { SHOW_JITSI_WATERMARK: true, SHOW_BRAND_WATERMARK: false, SHOW_POWERED_BY: false, APP_NAME: "Jitsi Meet", NATIVE_APP_NAME: "Jitsi Meet", PROVIDER_NAME: "Jitsi", JITSI_WATERMARK_LINK: "https://jitsi.org", DEFAULT_WELCOME_PAGE_LOGO_URL: "images/watermark.svg", MOBILE_APP_PROMO: true, SHOW_CHROME_EXTENSION_BANNER: false, DISPLAY_WELCOME_FOOTER: true };
  vm.runInNewContext(customInterface, { interfaceConfig });
  assert.equal(interfaceConfig.SHOW_JITSI_WATERMARK, false);
  assert.equal(interfaceConfig.SHOW_BRAND_WATERMARK, false);
  assert.equal(interfaceConfig.SHOW_POWERED_BY, false);
  assert.equal(interfaceConfig.APP_NAME, "Bunker707");
  assert.equal(interfaceConfig.PROVIDER_NAME, "Bunker707");
  assert.equal(interfaceConfig.JITSI_WATERMARK_LINK, "");
  assert.equal(interfaceConfig.DEFAULT_WELCOME_PAGE_LOGO_URL, "");
  assert.equal(interfaceConfig.DEFAULT_LOGO_URL, "");
  assert.equal(interfaceConfig.MOBILE_APP_PROMO, false);
  assert.equal(interfaceConfig.SHOW_CHROME_EXTENSION_BANNER, false);
  for (const [key, value] of Object.entries(interfaceConfig)) {
    if (typeof value === "string") assert.doesNotMatch(value, /jitsi/i, `${key} ainda mostra o nome do Jitsi`);
  }

  const config = { videoQuality: { codecPreferenceOrder: ["AV1", "VP9", "VP8"] }, defaultLogoUrl: "images/watermark.svg" };
  vm.runInNewContext(customConfig, { config });
  assert.equal(config.defaultLogoUrl, "");
  assert.equal(config.readOnlyName, true);
  assert.equal(config.disableSelfView, true);
  assert.equal(config.hideConferenceSubject, true);
  assert.equal(config.hideConferenceTimer, true);
  assert.equal(config.disableRemoteMute, true);
  assert.equal(config.disableChat, true);
  assert.equal(config.disablePolls, true);
  assert.equal(config.disableReactions, true);
  assert.equal(config.disableDeepLinking, true);
  assert.equal(config.disableThirdPartyRequests, true);
  assert.equal(config.channelLastN, 9, "palco + 8 miniaturas");
  // Objetos criados dentro do vm tem o prototipo de outro "realm": compara-se o valor, nao a referencia.
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(config.videoQuality.minHeightForQualityLvl), { 360: "standard", 720: "high" });
  assert.deepEqual(plain(config.videoQuality.codecPreferenceOrder), ["AV1", "VP9", "VP8"], "o custom-config completa o videoQuality gerado, nao o substitui");
  assert.deepEqual(plain(config.desktopSharingFrameRate), { min: 5, max: 30 });
  // A barra padrao e a minima (seguranca-02): quem abre a sala direto com o token nao compartilha a tela, nao grava e nao
  // ve a lista de alunos; o host e o co-apresentador recebem a barra deles pelo configOverwrite.
  assert.deepEqual(plain(config.toolbarButtons), ["camera", "raisehand", "fullscreen", "hangup"]);
  for (const button of ["chat", "polls", "reactions", "invite", "embedmeeting", "livestreaming", "desktop", "recording", "security", "participants-pane"]) {
    assert.ok(!config.toolbarButtons.includes(button), `botao ${button} fora da barra padrao`);
  }
  // O smoke.sh confere a barra servida: a ultima config.toolbarButtons do config.js sem 'desktop' (rodado de verdade num
  // bash com o config.js gerado + o nosso no fim, e com a barra antiga do host).
  const smokeSource = read(join(jitsiDir, "scripts", "smoke.sh"));
  const start = smokeSource.indexOf("toolbar=$(");
  const end = smokeSource.indexOf("done\n", start) + "done\n".length;
  assert.ok(start > 0 && end > start, "o smoke.sh confere a barra padrao");
  const toolbarCheck = (cfg) =>
    spawnSync("bash", ["-c", `cfg_ok=1; falha() { echo "FALHA $*"; }\n${smokeSource.slice(start, end)}echo "cfg_ok=$cfg_ok"`], { encoding: "utf8", env: { ...process.env, cfg } }).stdout;
  const generated = "config.toolbarButtons = ['microphone', 'desktop', 'recording'];\n";
  assert.match(toolbarCheck(`${generated}${customConfig}`), /cfg_ok=1/, "a nossa barra minima no fim passa");
  assert.match(toolbarCheck(generated), /FALHA config\.js barra padrao com 'desktop'/, "a barra do host no config.js servido falha");
  // Os dois arquivos so atribuem: nada de fetch, script ou acesso a window.
  for (const source of [customConfig, customInterface]) assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|document|window|import|require)\b/);
});

test("generate-secrets --local: .env 0600 com senhas e JWT gerados, enderecos locais com CA interna, nada impresso, e nao repete sem --force", () => {
  const { envPath, generate } = prepareGenerator();
  const first = generate(["--local"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  const env = parseEnv(read(envPath));
  for (const key of ["JICOFO_AUTH_PASSWORD", "JVB_AUTH_PASSWORD", "JIBRI_XMPP_PASSWORD", "JIBRI_RECORDER_PASSWORD", "TURN_CREDENTIALS", "JWT_APP_SECRET"]) {
    const value = env.get(key) ?? "";
    assert.match(value, /^[0-9a-f]{48,64}$/, `${key} precisa sair preenchido (hex)`);
    assert.ok(!first.stdout.includes(value) && !first.stderr.includes(value), `${key} nao pode ser impresso`);
  }
  assert.equal(new Set(["JICOFO_AUTH_PASSWORD", "JVB_AUTH_PASSWORD", "JIBRI_XMPP_PASSWORD", "JIBRI_RECORDER_PASSWORD"].map((k) => env.get(k))).size, 4, "senhas diferentes entre si");
  assert.equal(env.get("JWT_APP_SECRET").length, 64, "JWT_APP_SECRET com 32 bytes (o app exige >= 32 caracteres)");
  assert.equal(env.get("PUBLIC_URL"), "https://meet.127.0.0.1.sslip.io:3443");
  assert.equal(env.get("MEET_SITE_ADDRESS"), "meet.127.0.0.1.sslip.io");
  assert.equal(env.get("CADDY_BIND"), "127.0.0.1");
  assert.equal(env.get("CADDY_HTTPS_PORT"), "3443");
  assert.equal(env.get("CADDY_LOCAL_CERTS"), "local_certs");
  assert.equal(env.get("XMPP_PUBLIC_BIND"), "127.0.0.1", "no ensaio a 5222 nao sai da maquina");
  assert.match(env.get("MEET_FRAME_ANCESTORS"), /localhost/);
  assert.equal(env.get("ENABLE_GUESTS"), "0");
  assert.equal(env.get("ENABLE_AUTO_OWNER"), "0");
  assert.equal(env.get("JITSI_IMAGE_VERSION"), pinnedTag(envExample));
  assert.equal(read(envPath).split("\n").length, envExample.split("\n").length, "o gerador so troca valores; comentarios e ordem ficam");
  assert.match(first.stdout, /WEBINAR_JWT_SECRET/, "lembra que o app precisa do mesmo segredo");

  const second = generate(["--local"]);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /--force/);
  assert.equal(parseEnv(read(envPath)).get("JWT_APP_SECRET"), env.get("JWT_APP_SECRET"), "o .env fica como estava");
  const forced = generate(["--local", "--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.notEqual(parseEnv(read(envPath)).get("JWT_APP_SECRET"), env.get("JWT_APP_SECRET"));
});

test("generate-secrets em producao: --domain e --email obrigatorios, --jwt-secret validado e reaproveitado, iframe liberado para membros.<dominio>", () => {
  const { envPath, generate } = prepareGenerator();
  assert.notEqual(generate(["--domain", "meet.exemplo.com.br"]).status, 0, "sem --email");
  assert.notEqual(generate(["--email", "equipe@exemplo.com.br"]).status, 0, "sem --domain");
  assert.notEqual(generate(["--domain", "https://meet.exemplo.com.br", "--email", "equipe@exemplo.com.br"]).status, 0, "--domain e hostname");
  const shortSecret = generate(["--domain", "meet.exemplo.com.br", "--email", "equipe@exemplo.com.br", "--jwt-secret", "curto"]);
  assert.notEqual(shortSecret.status, 0);
  assert.match(shortSecret.stderr, /--jwt-secret/);
  assert.notEqual(generate(["--domain", "meet.exemplo.com.br", "--email", "equipe@exemplo.com.br", "--app-origin", "membros.exemplo.com.br/x"]).status, 0, "--app-origin e uma origem");
  assert.ok(!existsSync(envPath), "sem os dados nao grava nada");

  const jwt = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
  const ok = generate(["--domain", "meet.exemplo.com.br", "--email", "equipe@exemplo.com.br", "--jwt-secret", jwt]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = parseEnv(read(envPath));
  assert.equal(env.get("PUBLIC_URL"), "https://meet.exemplo.com.br");
  assert.equal(env.get("MEET_SITE_ADDRESS"), "meet.exemplo.com.br");
  assert.equal(env.get("MEET_FRAME_ANCESTORS"), "https://membros.exemplo.com.br", "a area de membros e membros.<mesmo dominio> por convencao");
  assert.equal(env.get("ROOM_GUARD_URL"), "https://membros.exemplo.com.br/api/webhooks/room-guard", "a lista de barrados do app");
  assert.equal(env.get("XMPP_MUC_MODULES"), "token_affiliation,bunker_room_guard");
  assert.equal(env.get("ACME_EMAIL"), "equipe@exemplo.com.br");
  assert.equal(env.get("CADDY_BIND"), "0.0.0.0");
  assert.equal(env.get("CADDY_LOCAL_CERTS"), "");
  assert.equal(env.get("XMPP_PUBLIC_BIND"), "0.0.0.0");
  assert.equal(env.get("JWT_APP_SECRET"), jwt);
  assert.ok(!ok.stdout.includes(jwt), "o segredo informado tambem nao e impresso");
  assert.match(ok.stdout, /JVB_ADVERTISE_IPS/, "lembra o que o deploy-meet ainda preenche");

  const origin = generate(["--domain", "meet.exemplo.com.br", "--email", "equipe@exemplo.com.br", "--app-origin", "https://app.exemplo.com", "--force"]);
  assert.equal(origin.status, 0, origin.stderr);
  assert.equal(parseEnv(read(envPath)).get("MEET_FRAME_ANCESTORS"), "https://app.exemplo.com");
  assert.equal(parseEnv(read(envPath)).get("ROOM_GUARD_URL"), "https://app.exemplo.com/api/webhooks/room-guard");
});

test("mod_bunker_room_guard: recusa na entrada (antes do token_affiliation) a conta do token removida ou banida, pela lista do app com o GET assinado pela chave derivada do JWT", async () => {
  const plugin = read(join(jitsiDir, "prosody", "plugins", "mod_bunker_room_guard.lua"));
  const hook = /module:hook\("muc-occupant-pre-join", function\(event\)([\s\S]*?)end, (-?[\d.]+)\);/.exec(plugin);
  assert.ok(hook, "um gancho na entrada da sala");
  assert.ok(Number(hook[2]) > -3.5, "antes do token_affiliation (-3.5), do lobby (-4) e do members_only (-5)");
  assert.match(hook[1], /session\.jitsi_meet_context_user/, "pela conta do token, nunca pelo JID");
  assert.match(hook[1], /context_user\.id/);
  assert.match(hook[1], /jid\.node\(room\.jid\)/, "pelo nome da sala");
  assert.match(hook[1], /banned\[user_id\] or \(in_room and in_room\[user_id\]\)/, "removido desta sala ou banido de todas");
  assert.match(hook[1], /st\.error_reply\(stanza, "cancel", "not-allowed"/);
  assert.match(hook[1], /return true;/, "a entrada para aqui");
  assert.doesNotMatch(hook[1], /http\.request|async/, "o gancho nunca espera a rede: a lista ja esta na memoria");
  assert.match(plugin, /os\.getenv\("ROOM_GUARD_URL"\)/);
  assert.match(plugin, /os\.getenv\("JWT_APP_SECRET"\)/);
  assert.match(plugin, /local GUARD_LABEL = "bunker707-room-guard";/);
  assert.match(plugin, /\["X-Bunker-Signature"\] = hmac_hex\(guard_key, timestamp \.\. "\."\)/, "o HMAC de \"<timestamp>.\" (sem corpo)");
  assert.match(plugin, /module:add_timer\(/, "a lista e buscada de tempos em tempos");
  // A chave e a assinatura do Lua sao as mesmas que o app confere (roomGuardKey + verifyRecorderSignature).
  const { roomGuardKey, verifyRecorderSignature, ROOM_GUARD_LABEL } = await import("../src/server/webinars/recorder-signature.ts");
  const jwt = "j".repeat(48);
  const chave = createHmac("sha256", jwt).update("bunker707-room-guard").digest("hex");
  assert.equal(ROOM_GUARD_LABEL, "bunker707-room-guard");
  assert.equal(roomGuardKey(jwt), chave);
  const ts = String(Math.floor(Date.now() / 1000));
  const assinatura = createHmac("sha256", chave).update(`${ts}.`).digest("hex");
  assert.deepEqual(verifyRecorderSignature({ body: "", now: Date.now(), secret: roomGuardKey(jwt), signature: assinatura, timestamp: ts }), { ok: true });
});

test("licenca e atribuicao ficam no repositorio, nao na tela: LICENSE-jitsi (Apache 2.0), NOTICE e a copia do mod_token_affiliation", () => {
  const license = read(join(jitsiDir, "LICENSE-jitsi"));
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0, January 2004/);
  const notice = read(join(jitsiDir, "NOTICE"));
  assert.match(notice, /8x8/);
  assert.match(notice, /Apache License, Version 2\.0/);
  assert.match(notice, /mod_token_affiliation\.lua/);
  assert.match(notice, /marca registrada/);
  const plugin = read(join(jitsiDir, "prosody", "plugins", "mod_token_affiliation.lua"));
  assert.match(plugin, /module:hook\("muc-occupant-pre-join"/, "o modulo age antes de o participante entrar");
  assert.match(plugin, /context_user\["moderator"\] == true/, "le o claim context.user.moderator do nosso JWT");
  assert.match(plugin, /room:set_affiliation\(true, occupant\.bare_jid, affiliation\)/);
  assert.match(plugin, /^-- Copia versionada de resources\/prosody-plugins\/mod_token_affiliation\.lua do Jitsi Meet/m);
});

test("compose do Jibri: um container, mesma tag, 2 GB de shm, 1080p a 30 quadros, finalize.sh montado e saude so em 127.0.0.1", () => {
  const services = composeServices(jibriCompose);
  assert.deepEqual([...services.keys()], ["jibri"]);
  const jibri = services.get("jibri");
  assert.equal(/^\s+image:\s*(\S+)\s*$/m.exec(jibri)?.[1], "${JITSI_IMAGE_REPO:-ghcr.io/jitsi}/jibri:${JITSI_IMAGE_VERSION}");
  assert.match(jibri, /^\s+shm_size: "2gb"\s*$/m, "o Chrome do gravador exige 2 GB em /dev/shm");
  assert.match(jibri, /^\s+read_only: true\s*$/m);
  assert.match(jibri, /- \.\/finalize\.sh:\/config\/finalize\.sh:ro/);
  assert.match(jibri, /JIBRI_FINALIZE_RECORDING_SCRIPT_PATH: "\/config\/finalize\.sh"/);
  assert.match(jibri, /JIBRI_RECORDING_DIR: "\/storage\/recordings"/);
  assert.match(jibri, /JIBRI_RECORDING_RESOLUTION: "\$\{JIBRI_RECORDING_RESOLUTION:-1920x1080\}"/, "gravacao em 1080p (D26)");
  assert.match(jibri, /JIBRI_RECORDING_FRAMERATE: "\$\{JIBRI_RECORDING_FRAMERATE:-30\}"/);
  assert.match(jibri, /JIBRI_SINGLE_USE_MODE: "\$\{JIBRI_SINGLE_USE_MODE:-0\}"/, "o host pode parar e gravar de novo na mesma live");
  assert.match(jibri, /XMPP_SERVER: "\$\{XMPP_SERVER\}"/, "o servidor C entra pelo .env (IPv4 publico)");
  const ports = [...jibri.matchAll(/^\s+- "([^"]+)"\s*$/gm)].map((m) => m[1]).filter((p) => /:\d+\}?"?$/.test(p) || /\}:\$\{/.test(p));
  assert.deepEqual(ports, ["${JIBRI_HEALTH_BIND:-127.0.0.1}:${JIBRI_HTTP_API_EXTERNAL_PORT:-2222}:${JIBRI_HTTP_API_EXTERNAL_PORT:-2222}"], "so a API de saude, em 127.0.0.1");
  for (const key of ["SESSAO", "WEBINAR_RECORDER_WEBHOOK_URL", "WEBINAR_RECORDER_WEBHOOK_SECRET", "BUNNY_LIBRARY_ID", "BUNNY_API_KEY"]) {
    assert.match(jibri, new RegExp(`${key}: "\\$\\{${key}\\}"`), `${key} chega ao finalize.sh pelo ambiente do container`);
  }
  assert.match(jibriEnvExample, /nao gere o \.env a mao/, "o exemplo do Jibri avisa que o jibri-up preenche");
  // cloud-init do gravador: Docker, a imagem e as pastas do uid 1000; nenhum segredo, nenhuma senha.
  assert.ok(cloudInit.startsWith("#cloud-config\n"));
  for (const marker of ["__DEPLOY_USER__", "__SSH_PUBLIC_KEY__", "__JITSI_IMAGE_REPO__", "__JITSI_IMAGE_VERSION__"]) assert.ok(cloudInit.includes(marker), `${marker} no cloud-init`);
  assert.match(cloudInit, /docker pull __JITSI_IMAGE_REPO__\/jibri:__JITSI_IMAGE_VERSION__/);
  assert.match(cloudInit, /install -d -o 1000 -g 1000 \/opt\/jibri\/volumes\/jibri \/opt\/jibri\/volumes\/storage\/jibri/);
  assert.match(cloudInit, /ssh_pwauth: false/);
  assert.doesNotMatch(cloudInit, /PASSWORD|SECRET|API_KEY|BUNNY/, "nenhum segredo no user-data (a Hetzner guarda)");
  for (const marker of jibriSource.matchAll(/s\|(__[A-Z_]+__)\|/g)) assert.ok(cloudInit.includes(marker[1]), `jibri.sh troca ${marker[1]}, que precisa existir no cloud-init`);
});

test("finalize.sh: POSIX sh executavel, assina com HMAC-SHA256 de timestamp.corpo, estados uploaded/upload_failed, sem imprimir segredo", () => {
  assert.ok(finalizeSource.startsWith("#!/bin/sh\n"), "POSIX sh: a imagem do Jibri nao garante bash para o script");
  assert.ok((statSync(finalizePath).mode & 0o111) !== 0, "o Jibri executa o script direto: precisa do bit de execucao");
  assert.equal(run("sh", ["-n", finalizePath]).status, 0);
  if (hasBinary("dash", ["-c", "true"])) assert.equal(run("dash", ["-n", finalizePath]).status, 0);
  assert.doesNotMatch(finalizeSource, /^\s*set\s+-[a-zA-Z]*x/m, "set -x levaria os segredos para o log");
  assert.match(finalizeSource, /openssl dgst -sha256 -hmac "\$WEBINAR_RECORDER_WEBHOOK_SECRET" -r/);
  assert.match(finalizeSource, /printf '%s\.%s' "\$1" "\$2" \| openssl dgst/, "assina timestamp \".\" corpo, como src/server/webinars/recorder-signature.ts confere");
  assert.match(finalizeSource, /X-Bunker-Timestamp: \$ts/);
  assert.match(finalizeSource, /X-Bunker-Signature: \$sig/);
  assert.match(finalizeSource, /state=uploaded/);
  assert.match(finalizeSource, /state=upload_failed/);
  assert.match(finalizeSource, /-K "\$bunny_cfg"/, "a chave da Bunny vai ao curl por arquivo 0600, nao na linha de comando");
  assert.doesNotMatch(finalizeSource, /\brm\b[^\n]*\.mp4/, "o MP4 nunca e apagado pelo script");
  for (const line of finalizeSource.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    if (/\$\{?(BUNNY_API_KEY|WEBINAR_RECORDER_WEBHOOK_SECRET)\b/.test(line)) {
      assert.doesNotMatch(line, /\b(log|echo)\b/, `segredo numa linha de log: ${line.trim()}`);
      if (/\bprintf\b/.test(line)) assert.match(line, /> "\$bunny_cfg"|\| openssl/, `printf com segredo precisa ir para o arquivo de configuracao ou para o openssl: ${line.trim()}`);
    }
  }
});

// O finalize.sh de verdade, contra um curl e um ffprobe de mentira: o curl anota cada chamada (metodo, URL,
// cabecalhos, corpo ou tamanho do arquivo enviado) e responde como a Bunny e o app responderiam.
function prepareFinalizeRun({ uploadCode = "200", webhookCode = "200" } = {}) {
  const dir = tempDir("bunker707-finalize-");
  const shims = join(dir, "shims");
  mkdirSync(shims);
  const shimJs = join(dir, "curl-shim.cjs");
  writeFileSync(shimJs, String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
const takesValue = new Set(["-o", "-w", "-X", "-H", "--data-binary", "--upload-file", "-K", "--max-time", "--speed-time", "--speed-limit"]);
let out = null, method = null, data = null, upload = null, url = null; const headers = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (takesValue.has(a)) {
    const v = args[i + 1]; i += 1;
    if (a === "-o") out = v; else if (a === "-X") method = v; else if (a === "-H") headers.push(v);
    else if (a === "--data-binary") data = v; else if (a === "--upload-file") upload = v;
    else if (a === "-K") headers.push(...fs.readFileSync(v, "utf8").split("\n").filter(Boolean).map((l) => l.replace(/^header = "(.*)"$/, "$1")));
  } else if (/^https?:/.test(a)) url = a;
}
if (!method) method = upload ? "PUT" : data ? "POST" : "GET";
let code = "200", body = "{}";
if (/\/videos\/[^/]+$/.test(url) && method === "PUT") { code = process.env.CURL_SHIM_UPLOAD_CODE || "200"; body = '{"success":true}'; }
else if (/\/videos$/.test(url) && method === "POST") { body = '{"videoLibraryId":42,"guid":"0b6d8e1e-aaaa-bbbb-cccc-1234567890ab","title":"x"}'; }
else if (url === process.env.CURL_SHIM_WEBHOOK_URL) { code = process.env.CURL_SHIM_WEBHOOK_CODE || "200"; body = '{"ok":true}'; }
fs.appendFileSync(process.env.CURL_SHIM_LOG, JSON.stringify({ method, url, headers, data, uploadSize: upload ? fs.statSync(upload).size : null }) + "\n");
if (out) fs.writeFileSync(out, body);
process.stdout.write(code);
`);
  writeFileSync(join(shims, "curl"), `#!/bin/sh\nexec "${process.execPath}" "${shimJs}" "$@"\n`);
  writeFileSync(join(shims, "ffprobe"), "#!/bin/sh\necho 754.9\n");
  chmodSync(join(shims, "curl"), 0o755);
  chmodSync(join(shims, "ffprobe"), 0o755);
  const recordings = join(dir, "recordings");
  const session = join(recordings, "sessao-de-teste");
  mkdirSync(session, { recursive: true });
  const mp4 = join(session, "w-abc12345-xyz_2026-10-29-20-00-00.mp4");
  const bytes = Buffer.from("nao e um mp4 de verdade, mas tem bytes suficientes para somar e enviar\n".repeat(40));
  writeFileSync(mp4, bytes);
  const log = join(dir, "curl.log");
  const secret = "segredo-do-gravador-com-mais-de-32-caracteres-0001";
  const webhookUrl = "https://membros.exemplo.com.br/api/webhooks/recorder";
  const env = {
    ...process.env,
    PATH: `${shims}:${process.env.PATH}`,
    CURL_SHIM_LOG: log, CURL_SHIM_UPLOAD_CODE: uploadCode, CURL_SHIM_WEBHOOK_CODE: webhookCode, CURL_SHIM_WEBHOOK_URL: webhookUrl,
    JIBRI_RECORDING_DIR: recordings, FINALIZE_FAST: "1",
    SESSAO: "sessao-de-teste", WEBINAR_RECORDER_WEBHOOK_URL: webhookUrl, WEBINAR_RECORDER_WEBHOOK_SECRET: secret,
    BUNNY_LIBRARY_ID: "42", BUNNY_API_KEY: "bunny-chave-secreta-de-teste"
  };
  const calls = () => (existsSync(log) ? read(log).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { dir, session, mp4, bytes, env, secret, webhookUrl, calls, recordings };
}

test("finalize.sh envia o MP4 para a Bunny (criar + enviar) e avisa o app com o corpo e a assinatura que o webhook confere; marca .uploaded e nao repete", (t) => {
  if (!hasBinary("openssl", ["version"])) {
    t.skip("openssl nao esta nesta maquina");
    return;
  }
  const { session, mp4, bytes, env, secret, webhookUrl, calls, recordings } = prepareFinalizeRun();
  const result = run("sh", [finalizePath, session], { env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const log = calls();
  assert.equal(log.length, 3, `tres chamadas: criar o video, enviar o arquivo, avisar o app (veio ${JSON.stringify(log)})`);
  const [create, upload, webhook] = log;
  assert.equal(create.method, "POST");
  assert.equal(create.url, "https://video.bunnycdn.com/library/42/videos");
  assert.ok(create.headers.includes("AccessKey: bunny-chave-secreta-de-teste"), "a chave da Bunny vai no cabecalho AccessKey (pelo arquivo -K)");
  assert.deepEqual(JSON.parse(create.data), { title: "w-abc12345-xyz 2026-10-29T20:00:00Z" });
  assert.equal(upload.method, "PUT");
  assert.equal(upload.url, "https://video.bunnycdn.com/library/42/videos/0b6d8e1e-aaaa-bbbb-cccc-1234567890ab");
  assert.equal(upload.uploadSize, bytes.length, "o arquivo inteiro vai no PUT");
  assert.equal(webhook.method, "POST");
  assert.equal(webhook.url, webhookUrl);
  const timestamp = webhook.headers.find((h) => h.startsWith("X-Bunker-Timestamp: "))?.slice("X-Bunker-Timestamp: ".length);
  const signature = webhook.headers.find((h) => h.startsWith("X-Bunker-Signature: "))?.slice("X-Bunker-Signature: ".length);
  assert.match(timestamp, /^\d{10}$/, "timestamp em segundos Unix");
  assert.ok(Math.abs(Number(timestamp) - Math.floor(Date.now() / 1000)) < 300);
  assert.equal(signature, createHmac("sha256", secret).update(`${timestamp}.${webhook.data}`, "utf8").digest("hex"), "assinatura = HMAC-SHA256(timestamp.corpo), como recorder-signature.ts");
  assert.ok(webhook.headers.includes("Content-Type: application/json"));
  const body = JSON.parse(webhook.data);
  assert.deepEqual(body, {
    sessionId: "sessao-de-teste",
    state: "uploaded",
    room: "w-abc12345-xyz",
    fileName: "w-abc12345-xyz_2026-10-29-20-00-00.mp4",
    startedAt: "2026-10-29T20:00:00Z",
    durationSeconds: 754,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bunnyLibraryId: "42",
    bunnyVideoId: "0b6d8e1e-aaaa-bbbb-cccc-1234567890ab"
  });
  assert.ok(existsSync(mp4), "o MP4 fica na maquina ate o jibri-down");
  assert.equal(read(`${mp4}.uploaded`).trim(), "0b6d8e1e-aaaa-bbbb-cccc-1234567890ab");
  assert.ok(!existsSync(`${mp4}.failed`));
  const everything = result.stdout + result.stderr + read(join(recordings, "finalize.log"));
  assert.ok(!everything.includes(secret) && !everything.includes("bunny-chave-secreta-de-teste"), "nem o segredo nem a chave aparecem no log");
  assert.match(everything, /enviado para a Bunny/);
  // Rodar de novo (o Jibri pode chamar duas vezes): nada e reenviado.
  const again = run("sh", [finalizePath, session], { env });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(calls().length, 3, "nenhuma chamada nova");
  assert.match(again.stdout, /ja foi enviado/);
});

test("finalize.sh com a Bunny fora do ar: tenta 3 vezes, guarda o MP4 com a marca .failed e avisa o app com upload_failed e o erro", (t) => {
  if (!hasBinary("openssl", ["version"])) {
    t.skip("openssl nao esta nesta maquina");
    return;
  }
  const { session, mp4, env, secret, calls } = prepareFinalizeRun({ uploadCode: "500" });
  const result = run("sh", [finalizePath, session], { env });
  assert.notEqual(result.status, 0, "falha de envio sai com erro (o log do Jibri mostra)");
  const log = calls();
  assert.equal(log.filter((c) => c.method === "POST" && /\/videos$/.test(c.url)).length, 1, "o video e criado uma vez e o mesmo id e reaproveitado");
  assert.equal(log.filter((c) => c.method === "PUT").length, 3, "tres tentativas de envio");
  const webhook = log.at(-1);
  assert.equal(webhook.method, "POST");
  const body = JSON.parse(webhook.data);
  assert.equal(body.state, "upload_failed");
  assert.equal(body.error, "bunny_upload_failed_attempt_3");
  assert.equal(body.bunnyVideoId, "0b6d8e1e-aaaa-bbbb-cccc-1234567890ab");
  assert.equal(body.sessionId, "sessao-de-teste");
  const timestamp = webhook.headers.find((h) => h.startsWith("X-Bunker-Timestamp: ")).slice("X-Bunker-Timestamp: ".length);
  const signature = webhook.headers.find((h) => h.startsWith("X-Bunker-Signature: ")).slice("X-Bunker-Signature: ".length);
  assert.equal(signature, createHmac("sha256", secret).update(`${timestamp}.${webhook.data}`, "utf8").digest("hex"));
  assert.ok(existsSync(mp4), "o arquivo fica para o envio manual");
  assert.ok(existsSync(`${mp4}.failed`));
  assert.ok(!existsSync(`${mp4}.uploaded`));
  assert.match(result.stdout, /envio manual pelo admin/);
});

test("finalize.sh sem webhook configurado ou com o app fora: nao perde o aviso (guarda o corpo ao lado do MP4) e retenta 5 vezes", (t) => {
  if (!hasBinary("openssl", ["version"])) {
    t.skip("openssl nao esta nesta maquina");
    return;
  }
  const { session, mp4, env, calls } = prepareFinalizeRun({ webhookCode: "503" });
  const result = run("sh", [finalizePath, session], { env });
  assert.notEqual(result.status, 0);
  assert.equal(calls().filter((c) => c.url === env.WEBINAR_RECORDER_WEBHOOK_URL).length, 5, "cinco tentativas de avisar o app");
  assert.ok(existsSync(`${mp4}.uploaded`), "o envio para a Bunny valeu mesmo sem o app responder");
  const saved = JSON.parse(read(`${mp4}.notify-failed.json`));
  assert.equal(saved.state, "uploaded");
  assert.match(result.stdout, /webhook respondeu HTTP 503 na tentativa 5/);
});

// Bloco Python de uma funcao de lib.sh (entre <<'PY' e a linha PY), para rodar aqui sem token nem hcloud.
function pythonBlockOf(functionName) {
  const start = libSource.indexOf(`${functionName}() {`);
  assert.ok(start >= 0, `${functionName} precisa existir em lib.sh`);
  const marker = "<<'PY'\n";
  const heredoc = libSource.indexOf(marker, start);
  const end = libSource.indexOf("\nPY\n", heredoc);
  assert.ok(heredoc > start && end > heredoc, `${functionName} precisa do heredoc PY`);
  return libSource.slice(heredoc + marker.length, end + 1);
}

test("firewall do servidor C (fw_rules_meet): 80/443 de qualquer lugar (DNS puro), UDP 10000, TURN reservado, 5222 so dos gravadores vivos, 22 so durante a etapa", (t) => {
  if (!hasBinary("python3", ["--version"])) {
    t.skip("python3 nao esta nesta maquina");
    return;
  }
  const rulesFor = (jibri, ...ssh) => {
    const result = run("python3", ["-I", "-", jibri, ...ssh], { input: pythonBlockOf("fw_rules_meet") });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const byPort = (rules, protocol, port) => rules.filter((r) => r.protocol === protocol && r.port === port);
  const anywhere = ["0.0.0.0/0", "::/0"];
  const rules = rulesFor("198.51.100.7/32 2a01:db8:1::/64", "203.0.113.10/32");
  assert.deepEqual(byPort(rules, "tcp", "22")[0].source_ips, ["203.0.113.10/32"], "22 so de quem abriu");
  assert.deepEqual(byPort(rules, "tcp", "80")[0].source_ips, anywhere, "80 de qualquer lugar: sem Cloudflare na frente");
  assert.deepEqual(byPort(rules, "tcp", "443")[0].source_ips, anywhere);
  assert.deepEqual(byPort(rules, "udp", "443")[0].source_ips, anywhere, "HTTP/3");
  assert.deepEqual(byPort(rules, "udp", "10000")[0].source_ips, anywhere, "midia do JVB");
  assert.equal(byPort(rules, "udp", "3478").length, 1);
  assert.equal(byPort(rules, "tcp", "3478").length, 1);
  assert.equal(byPort(rules, "tcp", "5349").length, 1);
  assert.deepEqual(byPort(rules, "tcp", "5222")[0].source_ips, ["198.51.100.7/32", "2a01:db8:1::/64"], "XMPP so do gravador vivo (IPv4 e o /64 dele)");
  assert.ok(rules.some((r) => r.protocol === "icmp"));
  for (const rule of rules) assert.ok(!rule.source_ips.some((ip) => /^(103\.21|104\.16|173\.245|2400:cb00)/.test(ip)), "nenhuma faixa da Cloudflare no servidor C");
  const closed = rulesFor("");
  assert.equal(byPort(closed, "tcp", "22").length, 0, "sem CIDR, a 22 nao existe");
  assert.equal(byPort(closed, "tcp", "5222").length, 0, "sem gravador vivo, a 5222 nao existe");
  // O gravador nao recebe nada de fora.
  const jibriRules = run("python3", ["-I", "-", "203.0.113.10/32"], { input: pythonBlockOf("fw_rules_jibri") });
  assert.equal(jibriRules.status, 0, jibriRules.stderr);
  assert.deepEqual(JSON.parse(jibriRules.stdout).map((r) => `${r.protocol}:${r.port ?? ""}`), ["tcp:22", "icmp:"]);
  // Os tres pontos que reescrevem regras passam pelo despacho por nome do servidor.
  assert.match(libSource, /fw_rules_for "\$1" "\$\(cidr_or_empty "\$PRODUCER_IP"\)" > "\$WORK_DIR\/rules-\$name\.json"/, "fw_ensure");
  assert.match(libSource, /fw_rules_for "\$1" "\$\(cidr_or_empty "\$me"\)" "\$\(cidr_or_empty "\$PRODUCER_IP"\)"/, "fw_open_ssh");
  assert.match(libSource, /fw_rules_for "\$s" "\$\(cidr_or_empty "\$PRODUCER_IP"\)"/, "fw_close_all");
  assert.match(libSource, /"\$MEET_NAME"\) fw_rules_meet "\$@" ;;/);
  assert.match(libSource, /"\$JIBRI_NAME_PREFIX"\*\) fw_rules_jibri "\$@" ;;/);
  assert.match(libSource, /\*\) fw_rules "\$@" ;;/, "membros e marketing continuam com as regras de sempre (so Cloudflare)");
  assert.match(libSource, /hzj server list --selector papel=jibri/, "a lista de gravadores vem das labels, sem arquivo de estado");
  // DNS do meet sem proxy.
  assert.match(libSource, /cf_dns_upsert "\$sub" A "\$ip4" false/);
  assert.match(libSource, /cf_dns_upsert "\$sub" AAAA "\$ip6" false/);
});

test("recorder_request (lib.sh) assina como o app confere: HMAC-SHA256 de timestamp.corpo, segredo so por variavel de ambiente", (t) => {
  if (!hasBinary("python3", ["--version"])) {
    t.skip("python3 nao esta nesta maquina");
    return;
  }
  const match = /sig=\$\(RECORDER_SECRET="\$secret" python3 -I -c '([^']+)' "\$ts" "\$body"\)/.exec(libSource);
  assert.ok(match, "o segredo entra no python por RECORDER_SECRET e os argumentos sao so timestamp e corpo");
  const secret = "segredo-de-teste-com-mais-de-32-caracteres-xyz";
  for (const [ts, body] of [["1761768000", '{"sessionId":"s1","state":"ready"}'], ["1761768001", ""]]) {
    const result = run("python3", ["-I", "-c", match[1], ts, body], { env: { ...process.env, RECORDER_SECRET: secret } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex"));
  }
  assert.match(libSource, /-H "X-Bunker-Timestamp: \$ts" -H "X-Bunker-Signature: \$sig"/);
  assert.match(libSource, /RECORDER_WEBHOOK_URL="\$\{WEBINAR_RECORDER_WEBHOOK_URL:-https:\/\/\$APP_DOMAIN\/api\/webhooks\/recorder\}"/);
  // O segredo nunca vai para log, echo ou printf em jibri.sh e lib.sh.
  for (const [file, source] of [["lib.sh", libSource], ["jibri.sh", jibriSource]]) {
    for (const line of source.split("\n")) {
      if (/^\s*#/.test(line)) continue;
      if (/\$\{?(webhook_secret|bunny_key|xmpp_pw|rec_pw|secret|JIBRI_SECRETS)\b/.test(line)) {
        assert.doesNotMatch(line, /\b(log|echo|warn|die)\b/, `${file}: segredo numa linha de saida: ${line.trim()}`);
        if (/\bprintf\b/.test(line)) assert.match(line, /\|/, `${file}: printf com segredo precisa alimentar outro processo: ${line.trim()}`);
      }
    }
    assert.doesNotMatch(source, /^\s*set\s+-[a-zA-Z]*x/m, `${file}: set -x levaria segredos ao log`);
  }
  assert.match(jibriSource, /mask "\$webhook_secret"/);
  assert.match(jibriSource, /mask "\$bunny_key"/);
  assert.match(jibriSource, /mask "\$xmpp_pw"/);
});

test("jibri-down com a maquina ja apagada avisa o app de novo: POST assinado { sessionId: <id sem o prefixo>, state: gone } e sai com 0 (o app nao fica preso em uploaded/ready)", () => {
  const dir = tempDir("bunker707-jibri-down-");
  const shims = join(dir, "bin");
  mkdirSync(shims, { recursive: true });
  const log = join(dir, "curl.log");
  // hcloud: so a versao fixada (sem download) e o servidor que nao existe mais.
  writeFileSync(join(shims, "hcloud"), `#!/bin/sh\ncase "$*" in *version*) echo "hcloud 1.70.1"; exit 0 ;; *"server describe"*) exit 1 ;; esac\necho "inesperado: $*" >&2; exit 2\n`);
  const shimJs = join(dir, "curl-shim.mjs");
  writeFileSync(shimJs, `import fs from "node:fs";
const args = process.argv.slice(2);
const headers = {};
let method = "GET", url = "", data = null, out = null;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "-X") method = args[++i];
  else if (arg === "-H") { const [k, ...v] = args[++i].split(":"); headers[k.trim().toLowerCase()] = v.join(":").trim(); }
  else if (arg === "--data-binary") data = args[++i];
  else if (arg === "-o") out = args[++i];
  else if (arg === "-w" || arg === "--max-time") i += 1;
  else if (/^https?:/.test(arg)) url = arg;
}
fs.appendFileSync(process.env.CURL_SHIM_LOG, JSON.stringify({ data, headers, method, url }) + "\\n");
if (out) fs.writeFileSync(out, "{}");
process.stdout.write("200");
`);
  writeFileSync(join(shims, "curl"), `#!/bin/sh\nexec "${process.execPath}" "${shimJs}" "$@"\n`);
  chmodSync(join(shims, "hcloud"), 0o755);
  chmodSync(join(shims, "curl"), 0o755);
  const sessao = "abababab-0000-4000-8000-000000000002";
  const secret = "segredo-do-gravador-com-mais-de-32-caracteres-0001";
  const result = run("bash", [join(cloudDir, "jibri.sh"), "down"], {
    env: cleanEnv({
      CONFIRMADO: "sim",
      CURL_SHIM_LOG: log,
      HCLOUD_TOKEN: "t".repeat(64),
      JIBRI_SECRETS: `WEBINAR_RECORDER_WEBHOOK_SECRET=${secret}\nWEBINAR_RECORDER_WEBHOOK_URL=https://membros.exemplo.com.br/api/webhooks/recorder`,
      PATH: `${shims}:${process.env.PATH}`,
      SESSAO: sessao
    })
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /nao existe; nada a apagar/);
  const calls = read(log).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(calls.length, 1, "uma chamada so: o aviso");
  const [aviso] = calls;
  assert.equal(aviso.method, "POST");
  assert.equal(aviso.url, "https://membros.exemplo.com.br/api/webhooks/recorder");
  assert.deepEqual(JSON.parse(aviso.data), { sessionId: sessao, state: "gone" }, "o id da sessao, sem o prefixo bunker707-jibri- (o schema do webhook recusaria)");
  const ts = aviso.headers["x-bunker-timestamp"];
  assert.equal(aviso.headers["x-bunker-signature"], createHmac("sha256", secret).update(`${ts}.${aviso.data}`).digest("hex"), "assinado como o app confere");
});

test("jibri.sh e provision-meet recusam sem CONFIRMADO=sim antes de tocar na Hetzner; SESSAO e validada; o gravador so e apagado com a gravacao na Bunny", () => {
  const jibriPath = join(cloudDir, "jibri.sh");
  const up = run("bash", [jibriPath, "up"], { env: cleanEnv({ HCLOUD_TOKEN: "x", JIBRI_SECRETS: "x", SESSAO: "sessao-1" }) });
  assert.equal(up.status, 1);
  assert.match(up.stderr, /CONFIRMADO=sim/);
  assert.doesNotMatch(up.stdout + up.stderr, /hcloud\.tgz|curl/, "nada baixado antes da confirmacao");
  const down = run("bash", [jibriPath, "down"], { env: cleanEnv({ HCLOUD_TOKEN: "x", JIBRI_SECRETS: "x" }) });
  assert.equal(down.status, 1);
  assert.match(down.stderr, /CONFIRMADO=sim/);
  const badSession = run("bash", [jibriPath, "up"], { env: cleanEnv({ CONFIRMADO: "sim", HCLOUD_TOKEN: "x", JIBRI_SECRETS: "x", SESSAO: "Sessao Invalida!" }) });
  assert.equal(badSession.status, 1);
  assert.match(badSession.stderr, /SESSAO invalida/);
  const noSecretLine = run("bash", [jibriPath, "up"], { env: cleanEnv({ CONFIRMADO: "sim", HCLOUD_TOKEN: "x", JIBRI_SECRETS: "OUTRA=1", SESSAO: "sessao-1" }) });
  assert.equal(noSecretLine.status, 1);
  assert.match(noSecretLine.stderr, /JIBRI_SECRETS sem a linha WEBINAR_RECORDER_WEBHOOK_SECRET/);
  const noSession = run("bash", [jibriPath, "up"], { env: cleanEnv({ CONFIRMADO: "sim", HCLOUD_TOKEN: "x", JIBRI_SECRETS: "x" }) });
  assert.equal(noSession.status, 1);
  assert.match(noSession.stderr, /Variavel SESSAO ausente/);
  assert.equal(run("bash", [jibriPath, "nada"], { env: cleanEnv() }).status, 1);

  const provisionMeet = run("bash", [join(cloudDir, "provision.sh"), "meet"], { env: cleanEnv({ HCLOUD_TOKEN: "x", CLOUDFLARE_API_TOKEN: "x" }) });
  assert.equal(provisionMeet.status, 1);
  assert.match(provisionMeet.stderr, /CONFIRMADO=sim/);
  const viaRun = run("bash", [join(cloudDir, "run.sh"), "jibri-up"], { env: cleanEnv({ OPCOES: "SESSAO=sessao-1", HCLOUD_TOKEN: "x", JIBRI_SECRETS: "x" }) });
  assert.equal(viaRun.status, 1);
  assert.match(viaRun.stderr, /CONFIRMADO=sim/);

  // down: so com uploaded (ou sem gravacao), MP4 sem marca .uploaded segura, FORCAR=1 passa por cima e avisa.
  assert.match(jibriSource, /case "\$rs" in uploaded\|ready\|unavailable\|gone\) ok_to_delete=1 ;; esac/);
  assert.match(jibriSource, /\[ -f \\"\\\$f\.uploaded\\" \] \|\| echo/, "procura MP4 sem a marca .uploaded na maquina");
  assert.match(jibriSource, /case "\$\{FORCAR:-\$\{FORCE:-\}\}" in 1\|sim\|true\) forced=1 ;; esac/);
  assert.match(jibriSource, /\[ -z "\$ok_to_delete" \] && \[ -z "\$forced" \]/);
  assert.match(jibriSource, /"state\\":\\"gone\\"/);
  assert.match(jibriSource, /"state\\":\\"ready\\"/);
  assert.match(jibriSource, /"state\\":\\"unavailable\\"/);
  assert.match(jibriSource, /hz server delete "\$name"/);
  assert.ok(jibriSource.indexOf("fw_close_all\n        log \"Apagando $name\"") < jibriSource.indexOf('hz server delete "$name"'), "a 22 e fechada antes de o servidor sumir (o trap nao acharia o IP)");
  assert.match(jibriSource, /print_cost/, "o custo por hora e impresso");
  assert.match(jibriSource, /--label papel=jibri --label sessao="\$SESSAO"/, "o servidor leva a sessao na label");
  assert.match(jibriSource, /JIBRI_FALLBACK_TYPES:-ccx23 cpx32/);
  assert.match(jibriSource, /resolution="1280x720"/, "cpx32 grava em 720p");
  assert.match(jibriSource, /\/jibri\/api\/v1\.0\/health/, "espera a API de saude do Jibri");
  assert.match(jibriSource, /set_env "\$target" "\$envj" WEBINAR_RECORDER_WEBHOOK_SECRET "\$webhook_secret"/, "o .env do gravador e gravado por SSH com set_env (0600)");
});

test("workflow e run.sh: as oito etapas novas, JIBRI_SECRETS so nos passos dos scripts, Cloudflare exigida no provision-meet, deploy-meet so da main", () => {
  const inputStart = workflowSource.indexOf("      etapa:");
  const inputBlock = workflowSource.slice(inputStart, workflowSource.indexOf("      opcoes:", inputStart));
  const options = [...inputBlock.matchAll(/^\s+- ([a-z][a-z-]*)\s*$/gm)].map((m) => m[1]);
  const novas = ["provision-meet", "deploy-meet", "secrets-meet", "exec-meet", "status-meet", "jibri-up", "jibri-down", "exec-jibri"];
  for (const etapa of novas) assert.ok(options.includes(etapa), `${etapa} falta nas opcoes do workflow`);
  for (const [etapa, call] of [["provision-meet", 'bash "$here/provision.sh" meet'], ["deploy-meet", 'bash "$here/deploy.sh" meet'], ["secrets-meet", 'bash "$here/secrets.sh" meet'], ["exec-meet", "exec_remote meet"], ["status-meet", 'bash "$here/status.sh" meet'], ["jibri-up", 'bash "$here/jibri.sh" up'], ["jibri-down", 'bash "$here/jibri.sh" down'], ["exec-jibri", 'bash "$here/jibri.sh" exec']]) {
    assert.ok(runSource.includes(`${etapa}) ${call} ;;`), `run.sh: ${etapa} -> ${call}`);
  }
  assert.match(runSource, /meet\) server="\$MEET_NAME" ;;/, "exec-meet cai no servidor C");
  const infraJob = workflowSource.slice(workflowSource.indexOf("  infra:"));
  assert.match(infraJob, /JIBRI_SECRETS: \$\{\{ secrets\.JIBRI_SECRETS \}\}/);
  const jobEnv = infraJob.slice(infraJob.indexOf("\n    env:"), infraJob.indexOf("\n    steps:"));
  assert.doesNotMatch(jobEnv, /JIBRI_SECRETS/, "o segredo do gravador nao fica no env do job inteiro");
  assert.match(infraJob, /case "\$ETAPA" in provision\|provision-meet\|snapshot\|restaurar\)/, "provision-meet mexe no DNS: exige o token da Cloudflare");
  assert.match(infraJob, /case "\$ETAPA" in jibri-up\|jibri-down\) \[ -n "\$JIBRI_SECRETS" \]/);
  assert.match(infraJob, /if: startsWith\(inputs\.etapa, 'deploy-'\)/, "deploy-meet herda a trava da main");
  assert.match(workflowSource, /CONFIRMADO=sim SESSAO=<id>/, "a descricao das opcoes ensina as novas");
  // As outras pontas das etapas: deploy, secrets e status com o papel meet.
  assert.match(deploySource, /elif \[ "\$role" = "meet" \]; then/);
  assert.match(deploySource, /generate-secrets\.sh --domain '\$MEET_DOMAIN' --email '\$PRODUCER_EMAIL' --app-origin 'https:\/\/\$APP_DOMAIN'/);
  assert.match(deploySource, /set_env "\$target" "\$envf" JVB_ADVERTISE_IPS "\$ip"/, "o JVB anuncia o IPv4 publico");
  assert.match(deploySource, /ufw route allow proto udp from any to any port \$jvb_port/, "o DOCKER-USER do bootstrap so deixa passar o que tiver ufw route allow");
  assert.match(deploySource, /ufw route allow proto tcp from any to any port 5222/);
  assert.match(deploySource, /\[ "\$\{SEM_LIVE_2H:-\}" = "sim" \] \|\| die/, "redeploy com o stack no ar so com SEM_LIVE_2H=sim");
  assert.match(deploySource, /docker compose -f infra\/jitsi\/docker-compose\.yml --profile borda/);
  assert.match(secretsSource, /meet\) server="\$MEET_NAME"; envf="\$REMOTE_DIR\/infra\/jitsi\/\.env" ;;/);
  assert.match(statusSource, /select\(\.name \| test\("\^\(membros\|api\|studio\|marketing\|meet\)"\)\)/);
  assert.match(statusSource, /mais de 6 h ligado: gravador esquecido/);
  assert.match(provisionSource, /create_server "\$MEET_NAME" "\$MEET_TYPE" "\$LOCATION" meet/);
  assert.match(provisionSource, /cf_apply_dns_meet/);
  const meetStart = provisionSource.indexOf('if [ "$role" = "meet" ]; then\n    log "1/5');
  const meetBranch = provisionSource.slice(meetStart, provisionSource.indexOf("# ====== servidores A e B", meetStart));
  assert.ok(meetStart > 0 && /\n    exit 0\nfi\n/.test(meetBranch), "o ramo do servidor C termina antes dos passos de A e B");
  assert.doesNotMatch(meetBranch, /storage-box create/, "o servidor C nao cria Storage Box");
});

test("scripts do Jitsi e o jibri.sh passam na conferencia de sintaxe; os de bash voltam do dash; o gerador e POSIX sh e o .mjs compila", () => {
  assert.deepEqual(scriptFiles, ["_env.sh", "jibri-status.sh", "logs.sh", "smoke.sh", "update.sh", "volumes.sh"]);
  for (const file of scriptFiles) {
    const path = join(jitsiDir, "scripts", file);
    assert.equal(run("bash", ["-n", path]).status, 0, file);
    if (file === "_env.sh") continue;
    const source = read(path);
    assert.match(source, /^#!\/usr\/bin\/env bash\n/, `${file}: shebang bash`);
    assert.ok(source.includes('[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"'), `${file}: sem a guarda do dash`);
    assert.ok((statSync(path).mode & 0o111) !== 0, `${file}: executavel`);
  }
  assert.equal(run("bash", ["-n", join(cloudDir, "jibri.sh")]).status, 0);
  assert.equal(run("sh", ["-n", join(jitsiDir, "generate-secrets.sh")]).status, 0);
  assert.equal(run(process.execPath, ["--check", join(jitsiDir, "generate-secrets.mjs")]).status, 0);
  // logs.sh e update.sh explicam o uso sem precisar de .env nem de Docker.
  const logsHelp = run("bash", [join(jitsiDir, "scripts", "logs.sh"), "--help"]);
  assert.equal(logsHelp.status, 0, logsHelp.stderr);
  assert.match(logsHelp.stdout, /exec-meet/);
  const updateHelp = run("bash", [join(jitsiDir, "scripts", "update.sh"), "--help"]);
  assert.equal(updateHelp.status, 0, updateHelp.stderr);
  assert.match(updateHelp.stdout, /--sem-live/);
  const updateNoMode = run("bash", [join(jitsiDir, "scripts", "update.sh")]);
  assert.equal(updateNoMode.status, 1);
  assert.match(updateNoMode.stderr, /--check, --apply ou --server/);
  // update.sh --server recusa trocar a imagem sem --sem-live (o .env de teste roda uma tag diferente da fixada).
  const dir = tempDir("bunker707-jitsi-update-");
  writeFileSync(join(dir, ".env"), "JITSI_IMAGE_VERSION=stable-10000\nPUBLIC_URL=https://meet.exemplo.com.br\n");
  const server = run("bash", [join(jitsiDir, "scripts", "update.sh"), "--server"], { env: { ...process.env, BUNKER707_ENV_FILE: join(dir, ".env"), SEM_LIVE_2H: "" } });
  assert.equal(server.status, 1);
  assert.match(server.stderr, /derruba a sala/);
  assert.match(server.stderr, /--sem-live/);
});

test("runbook e desenho em dia: docs/20 traz a secao 8B com as etapas, as travas e o JIBRI_SECRETS; docs/30 §6.2 fala em web:8000 e nas variaveis reais", () => {
  assert.match(docs20, /^## 8B\. /m, "a secao 8B do runbook (servidores C e D)");
  for (const text of ["provision-meet", "deploy-meet", "secrets-meet", "status-meet", "jibri-up", "jibri-down", "exec-jibri", "CONFIRMADO=sim", "SEM_LIVE_2H=sim", "FORCAR=1", "JIBRI_SECRETS", "Live gravada do dia"]) {
    assert.ok(docs20.includes(text), `docs/20 precisa citar ${text}`);
  }
  assert.doesNotMatch(docs20, /servidor (C|D)[^\n]{0,40}\b(foi criado|esta criado|ja existe na Hetzner)\b/i, "o runbook nao pode dizer que o servidor existe");
  const section62 = docs30.slice(docs30.indexOf("### 6.2"), docs30.indexOf("### 6.3"));
  assert.match(section62, /web:8000/, "o site da imagem escuta em 8000, nao em 80");
  for (const key of ["VIDEOBRIDGE_MAX_MEMORY", "JICOFO_MAX_MEMORY", "START_WITH_AUDIO_MUTED", "JVB_ADVERTISE_IPS", "ENABLE_THIRD_PARTY_REQUESTS", "DISABLE_DEEP_LINKING"]) {
    assert.ok(section62.includes(key), `docs/30 §6.2 precisa citar ${key}`);
  }
  assert.doesNotMatch(section62, /a conferir ao criar infra\/jitsi/, "as variaveis da JVM ja estao conferidas");
});

test("nenhum segredo no repositorio: as chaves de segredo dos dois .env.example ficam vazias", () => {
  for (const file of ["../infra/jitsi/.env.example", "../infra/jitsi/jibri/.env.example"]) {
    const env = parseEnv(read(fileURLToPath(new URL(file, import.meta.url))));
    for (const name of secretNames) {
      if (env.has(name)) assert.equal(env.get(name), "", `${file}: ${name} precisa ficar vazio no repositorio`);
    }
  }
});
