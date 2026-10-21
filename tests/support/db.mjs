import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Supabase LOCAL para os testes (docs/18 §2.4 e §2.5):
//   node tests/support/db.mjs start [--ci]   sobe o Supabase local (Docker), aplica as migracoes,
//                                            escreve .env.test.local e cria a escola de teste
//   node tests/support/db.mjs reset          recria o banco local do zero (migracoes + escola de teste)
//   node tests/support/db.mjs seed           so recria a escola de teste
//   node tests/support/db.mjs env            so reescreve .env.test.local a partir de `supabase status`
//   node tests/support/db.mjs stop           para o Supabase local
// Usa o binario `supabase` se estiver no PATH (CI); senao, `npx supabase` (baixa o CLI na primeira vez).

const root = fileURLToPath(new URL("../../", import.meta.url));
const envFile = `${root}.env.test.local`;
export const envFilePath = envFile;
/**
 * Token do tick de jobs do app de teste (so na maquina, nunca em servidor de verdade): os testes de ponta a
 * ponta chamam POST /api/jobs/tick com ele para rodar a Comunicacao na hora (tests/e2e/fixtures.ts, rodarTick).
 */
export const LOCAL_JOBS_TICK_TOKEN = "bunker707-tick-local-dos-testes-e2e-0001";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const command = isMain ? process.argv[2] : null;
const ci = process.argv.includes("--ci");
// Servicos que os testes nao usam: fora no CI para subir mais rapido.
const CI_EXCLUDED_SERVICES = "studio,imgproxy,logflare,vector,postgres-meta,edge-runtime";

function supabaseBinary() {
  const probe = spawnSync("supabase", ["--version"], { stdio: "ignore" });

  return probe.status === 0 ? ["supabase"] : ["npx", "--yes", "supabase"];
}

function supabase(args, { capture = false } = {}) {
  const [binary, ...prefix] = supabaseBinary();
  const result = spawnSync(binary, [...prefix, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });

  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stderr ?? "");
    }

    throw new Error(`"supabase ${args.join(" ")}" falhou (codigo ${result.status ?? "desconhecido"}).`);
  }

  return result.stdout ?? "";
}

function parseEnvOutput(output) {
  const values = {};

  for (const line of output.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());

    if (match) {
      values[match[1]] = match[2];
    }
  }

  return values;
}

function writeEnvFile() {
  const values = parseEnvOutput(supabase(["status", "-o", "env"], { capture: true }));
  const url = values.API_URL;
  const anonKey = values.ANON_KEY ?? values.PUBLISHABLE_KEY;
  const serviceKey = values.SERVICE_ROLE_KEY ?? values.SECRET_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error("`supabase status -o env` nao devolveu API_URL, ANON_KEY e SERVICE_ROLE_KEY. O Supabase local esta no ar?");
  }

  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`O endereco devolvido por \`supabase status\` nao e local: ${url}. Nada foi escrito.`);
  }

  const testValues = {
    ADMIN_DEMO_DATA: "off",
    AUTH_SESSION_STRATEGY: "user",
    JOBS_TICK_TOKEN: LOCAL_JOBS_TICK_TOKEN,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    YOUTUBE_UNOFFICIAL_STREAMS: "off"
  };
  const lines = [
    "# Gerado por `npm run db:start` a partir de `supabase status`: Supabase LOCAL, so para testes.",
    "# Nao commitar (o .gitignore ja ignora). Nunca copie valores de .env.local para ca.",
    ...Object.entries(testValues).map(([key, value]) => `${key}=${value}`),
    values.DB_URL ? `SUPABASE_DB_URL=${values.DB_URL}` : null,
    values.MAILPIT_URL ?? values.INBUCKET_URL ? `SUPABASE_MAIL_URL=${values.MAILPIT_URL ?? values.INBUCKET_URL}` : null,
    "# Todas as outras variaveis do .env.example ficam vazias de proposito: o app de teste nao fala com",
    "# PostHog, Sentry, gateway de IA nem nada fora da maquina, mesmo que .env.local as tenha.",
    ...exampleEnvKeys().filter((key) => !(key in testValues)).map((key) => `${key}=`)
  ].filter(Boolean);

  writeFileSync(envFile, `${lines.join("\n")}\n`);
  console.log(`Escrito ${envFile} apontando para ${url}.`);
}

/** Nomes das variaveis que o app conhece (inventario em .env.example). */
function exampleEnvKeys() {
  const example = readFileSync(`${root}.env.example`, "utf8");

  return [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]);
}

/**
 * Carrega .env.test.local em process.env para os scripts e para o servidor de teste. Variavel ja
 * exportada no terminal tem prioridade; as travas em local-db.mjs e no servidor de teste conferem o
 * resultado antes de usar.
 */
export function loadEnvFile() {
  if (!existsSync(envFile)) {
    throw new Error("Nao achei .env.test.local. Rode `npm run db:start` primeiro.");
  }

  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }

  // .env.test.local escrito antes do token: o app de teste e o Playwright usam o mesmo token local.
  if (!process.env.JOBS_TICK_TOKEN) {
    process.env.JOBS_TICK_TOKEN = LOCAL_JOBS_TICK_TOKEN;
  }
}

async function seed() {
  loadEnvFile();
  const { createLocalAdminClient } = await import("./local-db.mjs");
  const { seedEscolaDeTeste } = await import("../fixtures/escola-de-teste.mjs");
  const contas = await seedEscolaDeTeste(createLocalAdminClient());

  console.log(`Escola de teste pronta: ${Object.values(contas).map((conta) => conta.email).join(", ")}.`);
}

function start() {
  try {
    supabase(["start", ...(ci ? ["-x", CI_EXCLUDED_SERVICES] : [])]);
  } catch (error) {
    // "supabase start" devolve erro quando ja esta no ar; se o status responde, seguimos.
    try {
      supabase(["status"], { capture: true });
      console.log("Supabase local ja estava no ar.");
    } catch {
      throw error;
    }
  }
}

switch (command) {
  case "start":
    start();
    writeEnvFile();
    await seed();
    break;
  case "reset":
    supabase(["db", "reset"]);
    writeEnvFile();
    await seed();
    break;
  case "seed":
    await seed();
    break;
  case "env":
    writeEnvFile();
    break;
  case "stop":
    supabase(["stop"]);
    break;
  case null:
    // Importado como modulo (loadEnvFile/envFilePath): nada a executar.
    break;
  default:
    console.error("Uso: node tests/support/db.mjs start|reset|seed|env|stop");
    process.exit(1);
}
