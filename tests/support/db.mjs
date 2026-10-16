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
const command = process.argv[2];
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

  const lines = [
    "# Gerado por `npm run db:start` a partir de `supabase status`: Supabase LOCAL, so para testes.",
    "# Nao commitar (o .gitignore ja ignora). Nunca copie valores de .env.local para ca.",
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    values.DB_URL ? `SUPABASE_DB_URL=${values.DB_URL}` : null,
    values.MAILPIT_URL ?? values.INBUCKET_URL ? `SUPABASE_MAIL_URL=${values.MAILPIT_URL ?? values.INBUCKET_URL}` : null,
    "AUTH_SESSION_STRATEGY=user",
    "YOUTUBE_UNOFFICIAL_STREAMS=off",
    "ADMIN_DEMO_DATA=off"
  ].filter(Boolean);

  writeFileSync(envFile, `${lines.join("\n")}\n`);
  console.log(`Escrito ${envFile} apontando para ${url}.`);
}

function loadEnvFile() {
  if (!existsSync(envFile)) {
    throw new Error("Nao achei .env.test.local. Rode `npm run db:start` primeiro.");
  }

  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
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
  default:
    console.error("Uso: node tests/support/db.mjs start|reset|seed|env|stop");
    process.exit(1);
}
