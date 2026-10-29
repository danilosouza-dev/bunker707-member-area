// Gerador do .env do Jitsi proprio (chamado por generate-secrets.sh; nao use direto).

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = join(here, ".env.example");
const envPath = join(here, ".env");

function usage(message) {
  if (message) console.error(`Erro: ${message}\n`);
  console.error(`Uso:
  sh infra/jitsi/generate-secrets.sh --local [--force]
  sh infra/jitsi/generate-secrets.sh --domain <host do Jitsi> --email <Let's Encrypt> [--app-origin <https://membros...>]
      [--jwt-secret <64 hex, o mesmo WEBINAR_JWT_SECRET do app>] [--force]`);
  process.exit(message ? 2 : 0);
}

const args = process.argv.slice(2);
const options = { force: false, local: false, appOrigin: "", jwtSecret: "" };
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const next = () => {
    index += 1;
    if (index >= args.length) usage(`${arg} precisa de um valor.`);
    return args[index];
  };
  switch (arg) {
    case "--local": options.local = true; break;
    case "--force": options.force = true; break;
    case "--domain": options.domain = next(); break;
    case "--email": options.email = next(); break;
    case "--app-origin": options.appOrigin = next(); break;
    case "--jwt-secret": options.jwtSecret = next(); break;
    case "--help": case "-h": usage(); break;
    default: usage(`opcao desconhecida: ${arg}`);
  }
}

const hostPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const originPattern = /^https?:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{2,5})?$/i;
if (!options.local) {
  if (!options.domain) usage("em producao --domain e obrigatorio (ou use --local).");
  if (!hostPattern.test(options.domain)) usage(`--domain deve ser um hostname, sem https:// nem barra: ${options.domain}`);
  if (!options.email || !options.email.includes("@")) usage("--email e obrigatorio em producao (avisos do Let's Encrypt).");
}
if (options.appOrigin && !originPattern.test(options.appOrigin)) {
  usage(`--app-origin deve ser uma origem (https://host, sem caminho): ${options.appOrigin}`);
}
// O app exige pelo menos 32 caracteres sem espaco (src/server/webinars); aqui tambem nada de $ ou # (o compose).
if (options.jwtSecret && !/^[A-Za-z0-9_-]{32,128}$/.test(options.jwtSecret)) {
  usage("--jwt-secret precisa ter de 32 a 128 caracteres, so letras, numeros, _ ou - (ex.: openssl rand -hex 32).");
}

if (existsSync(envPath) && !options.force) {
  console.error(`Ja existe ${envPath}. Para gerar tudo de novo use --force.`);
  console.error("Atencao: --force troca TODAS as senhas, inclusive JWT_APP_SECRET (o app precisa receber o novo valor) e as do Jibri (refazer o jibri-up).");
  process.exit(1);
}

const hex = (bytes) => randomBytes(bytes).toString("hex");
const secrets = {
  JICOFO_AUTH_PASSWORD: hex(24),
  JVB_AUTH_PASSWORD: hex(24),
  JIBRI_XMPP_PASSWORD: hex(24),
  JIBRI_RECORDER_PASSWORD: hex(24),
  TURN_CREDENTIALS: hex(24),
  JWT_APP_SECRET: options.jwtSecret || hex(32)
};

// A area de membros mora em membros.<mesmo dominio> por convencao (infra/cloud/lib.sh); --app-origin troca.
function defaultAppOrigin(meetHost) {
  const parent = meetHost.split(".").slice(1).join(".");
  return `https://membros.${parent}`;
}

const addresses = options.local
  ? {
      PUBLIC_URL: "https://meet.127.0.0.1.sslip.io:3443",
      MEET_SITE_ADDRESS: "meet.127.0.0.1.sslip.io",
      MEET_FRAME_ANCESTORS: options.appOrigin || "http://localhost:3000 http://127.0.0.1:3000",
      ACME_EMAIL: "local@example.invalid",
      CADDY_BIND: "127.0.0.1",
      CADDY_HTTP_PORT: "3080",
      CADDY_HTTPS_PORT: "3443",
      CADDY_LOCAL_CERTS: "local_certs",
      XMPP_PUBLIC_BIND: "127.0.0.1"
    }
  : {
      PUBLIC_URL: `https://${options.domain}`,
      MEET_SITE_ADDRESS: options.domain,
      MEET_FRAME_ANCESTORS: options.appOrigin || defaultAppOrigin(options.domain),
      ACME_EMAIL: options.email,
      CADDY_LOCAL_CERTS: ""
    };

const values = { ...secrets, ...addresses };
const example = readFileSync(examplePath, "utf8");
const pending = new Set(Object.keys(values));
const lines = example.split("\n").map((line) => {
  const match = /^([A-Z0-9_]+)=/.exec(line);
  if (!match || !(match[1] in values)) return line;
  pending.delete(match[1]);
  return `${match[1]}=${values[match[1]]}`;
});
if (pending.size > 0) {
  console.error(`O .env.example nao tem as linhas: ${[...pending].join(", ")}. Atualize o exemplo antes.`);
  process.exit(1);
}
for (const value of Object.values(values)) {
  if (/[$#"'\\]/.test(value)) {
    console.error("Valor gerado com caractere que o compose nao aceita sem aspas; rode de novo.");
    process.exit(1);
  }
}
writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(`Gravado ${envPath} (chmod 600), modo ${options.local ? "ensaio local" : "producao"}.`);
console.log(`Sala em ${addresses.PUBLIC_URL}; iframe permitido para: ${addresses.MEET_FRAME_ANCESTORS}.`);
if (options.jwtSecret) {
  console.log("JWT_APP_SECRET: o valor informado em --jwt-secret (o app ja tem o mesmo em WEBINAR_JWT_SECRET).");
} else {
  console.log("JWT_APP_SECRET gerado aqui: o app precisa receber o MESMO valor em WEBINAR_JWT_SECRET (envelope para os dois servidores, docs/20 §8B.3); ate la ninguem entra na sala.");
}
if (!options.local) {
  console.log("Ainda falta, pela etapa deploy-meet: JVB_ADVERTISE_IPS (o IPv4 publico do servidor).");
  console.log("As senhas do Jibri (JIBRI_XMPP_PASSWORD e JIBRI_RECORDER_PASSWORD) vao para o servidor do gravador pela etapa jibri-up; nao copie a mao.");
}
