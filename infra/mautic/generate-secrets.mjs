// Gerador do .env do stack do Mautic (chamado por generate-secrets.sh; nao use direto).

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
  sh infra/mautic/generate-secrets.sh --local [--force]
  sh infra/mautic/generate-secrets.sh --domain <host> --email <acme e admin> [--admin-ips "<cidr> <cidr>"] [--force]`);
  process.exit(message ? 2 : 0);
}

const args = process.argv.slice(2);
const options = { force: false, local: false, adminIps: "" };
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
    case "--admin-ips": options.adminIps = next(); break;
    case "--help": case "-h": usage(); break;
    default: usage(`opcao desconhecida: ${arg}`);
  }
}

const hostPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
if (!options.local) {
  if (!options.domain) usage("em producao --domain e obrigatorio (ou use --local).");
  if (!hostPattern.test(options.domain)) usage(`--domain deve ser um hostname, sem https:// nem barra: ${options.domain}`);
  if (!options.email || !options.email.includes("@")) usage("--email e obrigatorio em producao (Let's Encrypt e conta do administrador).");
}

if (existsSync(envPath) && !options.force) {
  console.error(`Ja existe ${envPath}. Para gerar tudo de novo use --force.`);
  console.error("Atencao: --force troca TODAS as senhas. Num stack ja iniciado, a senha nova do MySQL nao bate com o banco existente.");
  process.exit(1);
}

const hex = (bytes) => randomBytes(bytes).toString("hex");
const secrets = {
  MAUTIC_DB_PASSWORD: hex(24),
  MAUTIC_DB_ROOT_PASSWORD: hex(24),
  MAUTIC_ADMIN_PASSWORD: hex(16),
  RESTIC_PASSWORD: randomBytes(32).toString("base64")
};

const addresses = options.local
  ? {
      MAUTIC_SITE_ADDRESS: "http://mautic.127.0.0.1.sslip.io",
      MAUTIC_PUBLIC_URL: "http://mautic.127.0.0.1.sslip.io:3080",
      MAUTIC_ADMIN_IPS: "127.0.0.1/32 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16",
      MAUTIC_ADMIN_EMAIL: "local@example.invalid",
      ACME_EMAIL: "local@example.invalid",
      CADDY_BIND: "127.0.0.1",
      CADDY_HTTP_PORT: "3080",
      CADDY_HTTPS_PORT: "3443",
      RESTIC_REPOSITORY: "/tmp/bunker707-mautic-restic-local",
      BACKUP_KEEP_DAILY: "3"
    }
  : {
      MAUTIC_SITE_ADDRESS: options.domain,
      MAUTIC_PUBLIC_URL: `https://${options.domain}`,
      MAUTIC_ADMIN_IPS: options.adminIps || "127.0.0.1/32",
      MAUTIC_ADMIN_EMAIL: options.email,
      ACME_EMAIL: options.email
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
  if (/[$#]/.test(value)) {
    console.error("Valor gerado com caractere que o compose nao aceita sem aspas; rode de novo.");
    process.exit(1);
  }
}
writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(`Gravado ${envPath} (chmod 600), modo ${options.local ? "ensaio local" : "producao"}.`);
if (options.local) {
  console.log(`Mautic: ${addresses.MAUTIC_PUBLIC_URL} (usuario bunker707, senha MAUTIC_ADMIN_PASSWORD do .env, depois de scripts/install.sh)`);
} else {
  console.log("Ainda precisa preencher no .env, a mao: MAUTIC_MAILER_DSN (chave de envio do Resend), STORAGE_BOX_USER e STORAGE_BOX_HOST.");
  console.log("Guarde RESTIC_PASSWORD e MAUTIC_ADMIN_PASSWORD tambem fora do servidor.");
}
