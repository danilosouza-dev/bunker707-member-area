// Gerador do .env do stack Bunker707 (chamado por generate-secrets.sh; nao use direto).
// Mesmo formato de chaves do Supabase self-hosted oficial (docker/utils/generate-keys.sh e
// add-new-auth-keys.sh): JWTs HS256 legados, par EC P-256 com JWKS e chaves opacas sb_ com checksum.

import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = join(here, ".env.example");
const envPath = join(here, ".env");

function usage(message) {
  if (message) console.error(`Erro: ${message}\n`);
  console.error(`Uso:
  sh infra/compose/generate-secrets.sh --local [--force]
  sh infra/compose/generate-secrets.sh --domain <app> --api-domain <api> --studio-domain <studio> \\
      --email <acme> [--studio-ips "<cidr> <cidr>"] [--force]`);
  process.exit(message ? 2 : 0);
}

const args = process.argv.slice(2);
const options = { force: false, local: false, studioIps: "" };

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
    case "--api-domain": options.apiDomain = next(); break;
    case "--studio-domain": options.studioDomain = next(); break;
    case "--email": options.email = next(); break;
    case "--studio-ips": options.studioIps = next(); break;
    case "--help": case "-h": usage(); break;
    default: usage(`opcao desconhecida: ${arg}`);
  }
}

const hostPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

if (!options.local) {
  for (const [name, value] of [["--domain", options.domain], ["--api-domain", options.apiDomain], ["--studio-domain", options.studioDomain]]) {
    if (!value) usage(`em producao ${name} e obrigatorio (ou use --local).`);
    if (!hostPattern.test(value)) usage(`${name} deve ser um hostname, sem https:// nem barra: ${value}`);
  }
  if (!options.email || !options.email.includes("@")) usage("--email e obrigatorio em producao (avisos do Let's Encrypt).");
}

if (existsSync(envPath) && !options.force) {
  console.error(`Ja existe ${envPath}. Para gerar tudo de novo use --force.`);
  console.error("Atencao: --force troca TODOS os segredos. Num stack ja iniciado, a senha nova do Postgres nao bate com o banco");
  console.error("existente e os tokens dos alunos deixam de valer. Rotacao de chave individual: docs/20-runbook-hetzner.md.");
  process.exit(1);
}

// ---- segredos ---------------------------------------------------------------------------------

const hex = (bytes) => randomBytes(bytes).toString("hex");
const base64 = (bytes) => randomBytes(bytes).toString("base64");
const base64url = (input) => Buffer.from(input).toString("base64url");

const jwtSecret = base64(40); // >= 32 caracteres, como exige o GoTrue
const issuedAt = Math.floor(Date.now() / 1000);
const expiresAt = issuedAt + 5 * 365 * 24 * 3600; // 5 anos, como o utilitario oficial

function signHs256(payload) {
  const data = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", jwtSecret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwkPrivate = privateKey.export({ format: "jwk" });
const kid = randomUUID();
const octKey = { kty: "oct", k: base64url(jwtSecret), alg: "HS256" };
const jwtKeys = [
  { kty: "EC", kid, use: "sig", key_ops: ["sign", "verify"], alg: "ES256", ext: true, crv: jwkPrivate.crv, x: jwkPrivate.x, y: jwkPrivate.y, d: jwkPrivate.d },
  octKey
];
const jwtJwks = {
  keys: [
    { kty: "EC", kid, use: "sig", key_ops: ["verify"], alg: "ES256", ext: true, crv: jwkPrivate.crv, x: jwkPrivate.x, y: jwkPrivate.y },
    octKey
  ]
};

function signEs256(payload) {
  const data = `${base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign("SHA256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${data}.${signature}`;
}

// Chaves opacas com checksum, no formato que o Envoy do self-hosted reconhece.
const PROJECT_REF = "supabase-self-hosted";

function opaqueKey(prefix) {
  const intermediate = prefix + randomBytes(17).toString("base64url").slice(0, 22);
  const checksum = createHash("sha256").update(`${PROJECT_REF}|${intermediate}`).digest("base64url").slice(0, 8);
  return `${intermediate}_${checksum}`;
}

const secrets = {
  POSTGRES_PASSWORD: hex(24),
  JWT_SECRET: jwtSecret,
  ANON_KEY: signHs256({ role: "anon", iss: "supabase", iat: issuedAt, exp: expiresAt }),
  SERVICE_ROLE_KEY: signHs256({ role: "service_role", iss: "supabase", iat: issuedAt, exp: expiresAt }),
  SUPABASE_PUBLISHABLE_KEY: opaqueKey("sb_publishable_"),
  SUPABASE_SECRET_KEY: opaqueKey("sb_secret_"),
  JWT_KEYS: JSON.stringify(jwtKeys),
  JWT_JWKS: JSON.stringify(jwtJwks),
  ANON_KEY_ASYMMETRIC: signEs256({ role: "anon", iss: "supabase", iat: issuedAt, exp: expiresAt }),
  SERVICE_ROLE_KEY_ASYMMETRIC: signEs256({ role: "service_role", iss: "supabase", iat: issuedAt, exp: expiresAt }),
  DASHBOARD_PASSWORD: hex(16),
  SECRET_KEY_BASE: base64(48),
  REALTIME_DB_ENC_KEY: hex(8),
  VAULT_ENC_KEY: hex(16),
  PG_META_CRYPTO_KEY: base64(24),
  S3_PROTOCOL_ACCESS_KEY_ID: hex(16),
  S3_PROTOCOL_ACCESS_KEY_SECRET: hex(32),
  JOBS_TICK_TOKEN: hex(32),
  RESTIC_PASSWORD: base64(32)
};

// ---- enderecos --------------------------------------------------------------------------------

const addresses = options.local
  ? {
      APP_PUBLIC_URL: "http://localhost:3080",
      SUPABASE_PUBLIC_URL: "http://127.0.0.1.sslip.io:8000",
      SUPABASE_PUBLIC_HOST: "127.0.0.1.sslip.io",
      API_EXTERNAL_URL: "http://127.0.0.1.sslip.io:8000/auth/v1",
      SITE_URL: "http://localhost:3080",
      ADDITIONAL_REDIRECT_URLS: "http://localhost:3080/auth/callback",
      APP_SITE_ADDRESS: "http://localhost",
      SUPABASE_SITE_ADDRESS: "http://supabase.localhost",
      STUDIO_SITE_ADDRESS: "http://studio.localhost",
      STUDIO_ALLOWED_IPS: "127.0.0.1/32 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16",
      ACME_EMAIL: "local@example.invalid",
      CADDY_BIND: "127.0.0.1",
      CADDY_HTTP_PORT: "3080",
      CADDY_HTTPS_PORT: "3443",
      ENABLE_EMAIL_AUTOCONFIRM: "true",
      SMTP_ADMIN_EMAIL: "local@example.invalid",
      SMTP_HOST: "localhost",
      SMTP_PORT: "2500",
      SMTP_USER: "local",
      SMTP_PASS: "local",
      SENTRY_ENVIRONMENT: "local",
      RESTIC_REPOSITORY: "/tmp/bunker707-restic-local",
      BACKUP_KEEP_DAILY: "3"
    }
  : {
      APP_PUBLIC_URL: `https://${options.domain}`,
      SUPABASE_PUBLIC_URL: `https://${options.apiDomain}`,
      SUPABASE_PUBLIC_HOST: options.apiDomain,
      API_EXTERNAL_URL: `https://${options.apiDomain}/auth/v1`,
      SITE_URL: `https://${options.domain}`,
      ADDITIONAL_REDIRECT_URLS: `https://${options.domain}/auth/callback`,
      APP_SITE_ADDRESS: options.domain,
      SUPABASE_SITE_ADDRESS: options.apiDomain,
      STUDIO_SITE_ADDRESS: options.studioDomain,
      // Sem IP informado ninguem abre o Studio (403): melhor fechado do que aberto por engano.
      STUDIO_ALLOWED_IPS: options.studioIps || "127.0.0.1/32",
      ACME_EMAIL: options.email
    };

// ---- escrita ----------------------------------------------------------------------------------

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
  // O compose interpola $ e trata " #" como comentario: nenhum valor gerado pode ter isso.
  if (/[$#]/.test(value)) {
    console.error("Valor gerado com caractere que o compose nao aceita sem aspas; rode de novo.");
    process.exit(1);
  }
}

writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
chmodSync(envPath, 0o600);

console.log(`Gravado ${envPath} (chmod 600), modo ${options.local ? "ensaio local" : "producao"}.`);
console.log(`Gerados: ${Object.keys(secrets).length} segredos e ${Object.keys(addresses).length} enderecos.`);

if (options.local) {
  console.log(`App: ${addresses.APP_PUBLIC_URL}  Supabase: ${addresses.SUPABASE_PUBLIC_URL}  Studio: http://127.0.0.1:8000/ (usuario bunker707, senha DASHBOARD_PASSWORD do .env)`);
} else {
  console.log("Ainda precisa preencher no .env, a mao: SMTP_PASS (chave de envio do Resend), STORAGE_BOX_USER e STORAGE_BOX_HOST,");
  console.log(`APP_IMAGE (imagem do ghcr.io)${options.studioIps ? "" : " e STUDIO_ALLOWED_IPS (hoje 127.0.0.1/32: Studio fechado para todos)"}.`);
  console.log("Guarde RESTIC_PASSWORD tambem fora do servidor: sem ela o backup nao abre.");
}
