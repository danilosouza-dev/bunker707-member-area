import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// A conferencia final (infra/scripts/smoke.sh; docs/20 §9 e §9C; docs/32 §3.2 passo 11), com docker e curl de mentira.
// A nossa producao tem o Realtime e continua exigindo o healthcheck dele e o /api/tenants fechado (403). O kit nao leva o
// Realtime (docs/32 §11.6): ali o caminho tem de estar fechado na borda (404). Nos dois, os modelos de e-mail do Auth
// sao baixados pelo caminho que o Auth usa: no kit, de dentro do container do Auth, pela rede interna.

const smoke = fileURLToPath(new URL("../infra/scripts/smoke.sh", import.meta.url));
const APP = "https://alunos.escola.test";
const API = "https://api.escola.test";
const MODELOS = ["confirmation", "email_change", "invite", "magic_link", "reauthentication", "recovery"];
const pastas = [];
after(() => pastas.forEach((p) => rmSync(p, { recursive: true, force: true })));

// docker de mentira: so o `docker compose` que o smoke usa (config, ps, exec auth wget).
const DOCKER = String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "docker", args }) + "\n");
let i = 1;
while (args[i] === "-f") i += 2;
const sub = args[i], resto = args.slice(i + 1);
const servicos = (process.env.SHIM_SERVICOS ?? "").split(",").filter(Boolean);
if (sub === "config") {
  if (process.env.SHIM_CONFIG_FALHA) { process.stderr.write("erro ao ler o compose\n"); process.exit(1); }
  if (resto.includes("--services")) { console.log(servicos.join("\n")); process.exit(0); }
  const modelos = JSON.parse(process.env.SHIM_MODELOS);
  const env = { GOTRUE_SMTP_PASS: "segredo-do-smtp" };
  for (const [nome, url] of Object.entries(modelos)) env["GOTRUE_MAILER_TEMPLATES_" + nome.toUpperCase()] = url;
  console.log(JSON.stringify({ name: "escola", services: { auth: { environment: env } } }));
  process.exit(0);
}
if (sub === "ps") { console.log(process.env.SHIM_REALTIME ?? ""); process.exit(0); }
if (sub === "exec") {
  const url = resto.at(-1);
  if (!resto.includes("auth") || !resto.includes("wget")) process.exit(1);
  const fora = (process.env.SHIM_MODELO_FORA ?? "").split(",");
  if (fora.some((n) => n && url.endsWith("/" + n + ".html"))) { process.stderr.write("wget: can't connect to remote host\n"); process.exit(1); }
  process.stdout.write("<p>Ola</p><a href=\"{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}\">entrar</a>");
  process.exit(0);
}
process.exit(0);
`;

// curl de mentira: o codigo de cada endereco vem de SHIM_CODIGOS (JSON, "url" -> codigo); o corpo do /api/health e o
// dos modelos pelo endereco publico.
const CURL = String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
const url = args.filter((a) => /^https?:\/\//.test(a)).at(-1);
const headers = [];
for (let i = 0; i < args.length; i++) if (args[i] === "-H") headers.push(args[++i]);
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "curl", url, headers }) + "\n");
const codigos = JSON.parse(process.env.SHIM_CODIGOS);
const chave = Object.keys(codigos).find((k) => url === k || (k.endsWith("*") && url.startsWith(k.slice(0, -1))));
const codigo = chave ? codigos[chave] : 404;
if (args.includes("-w")) { process.stdout.write(String(codigo)); process.exit(0); }
if (url.endsWith("/api/health")) { process.stdout.write(JSON.stringify({ ok: true, version: "1.2.3" })); process.exit(0); }
if (url.includes("/auth-templates/") && codigo === 200) { process.stdout.write("<a href=\"{{ .ConfirmationURL }}\">confirmar</a>"); process.exit(0); }
process.stdout.write("<html>404</html>");
process.exit(0);
`;

/** Os codigos que a nossa producao (ou o kit) responde quando esta tudo certo. */
function codigosBons({ kit }) {
  const c = {
    [`${APP}/api/health`]: 200,
    [`${APP}/`]: 307,
    [`${API}/rest/v1/job_runs?select=id&limit=1`]: "rls",
    [`${API}/storage/v1/status`]: 200,
    [`${API}/`]: 404
  };
  if (!kit) {
    c[`${API}/realtime/v1/*`] = 403;
    for (const m of MODELOS) c[`${API}/auth-templates/${m}.html`] = 200;
  }
  return c;
}

function rodar({ kit, codigos = {}, extra = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "smoke-"));
  pastas.push(dir);
  const shims = join(dir, "shims");
  mkdirSync(shims);
  for (const [nome, fonte] of [["docker", DOCKER], ["curl", CURL]]) {
    writeFileSync(join(dir, `${nome}.cjs`), fonte);
    writeFileSync(join(shims, nome), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, `${nome}.cjs`)}" "$@"\n`);
    chmodSync(join(shims, nome), 0o755);
  }
  writeFileSync(join(shims, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(shims, "sleep"), 0o755);
  const composeFile = join(dir, "docker-compose.yml");
  writeFileSync(composeFile, "name: escola\nservices: {}\n");
  const envFile = join(dir, ".env");
  writeFileSync(envFile, `APP_PUBLIC_URL=${APP}\nSUPABASE_PUBLIC_URL=${API}\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_teste\nSUPABASE_SECRET_KEY=sb_secret_teste\n`);
  const tabela = { ...codigosBons({ kit }), ...codigos };
  // A RLS: a chave publica recebe 401 e a do servidor 200 na mesma tabela interna.
  const rls = `${API}/rest/v1/job_runs?select=id&limit=1`;
  const comChave = Object.fromEntries(Object.entries(tabela).filter(([, v]) => v !== "rls"));
  const log = join(dir, "chamadas.log");
  const ambiente = {
    PATH: `${shims}:${process.env.PATH}`,
    HOME: dir,
    BUNKER707_COMPOSE_FILE: composeFile,
    BUNKER707_ENV_FILE: envFile,
    SHIM_LOG: log,
    SHIM_SERVICOS: kit ? "db,auth,rest,storage,imgproxy,api-gw,app,caddy" : "db,auth,rest,storage,imgproxy,api-gw,app,caddy,realtime,supavisor,functions",
    SHIM_REALTIME: "healthy",
    SHIM_MODELOS: JSON.stringify(Object.fromEntries(MODELOS.map((m) => [m, kit ? `http://caddy:8088/auth-templates/${m}.html` : `${API}/auth-templates/${m}.html`]))),
    SHIM_CODIGOS: JSON.stringify(comChave),
    ...extra
  };
  // O shim do curl decide a RLS pelo cabecalho: reescrevemos a tabela com as duas respostas.
  const curlComRls = CURL.replace("const codigo = chave ? codigos[chave] : 404;", `let codigo = chave ? codigos[chave] : 404;
if (url === ${JSON.stringify(rls)}) codigo = headers.some((h) => h.includes("sb_secret_teste")) ? 200 : 401;
if (url.endsWith("/auth/v1/health")) codigo = headers.some((h) => h.startsWith("apikey:")) ? 200 : 401;
if (url.endsWith("/rest/v1/")) codigo = 401;`);
  writeFileSync(join(dir, "curl.cjs"), curlComRls);
  const r = spawnSync("bash", [smoke], { encoding: "utf8", env: ambiente });
  const chamadas = () => readLog(log);
  return { status: r.status, saida: (r.stdout ?? "") + (r.stderr ?? ""), chamadas };
}

function readLog(log) {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

test("producao: o Realtime continua exigido (healthcheck e /api/tenants fechado) e os modelos vem pelo endereco publico", () => {
  const r = rodar({ kit: false });
  assert.equal(r.status, 0, r.saida);
  assert.match(r.saida, /ok {3}realtime \(healthcheck\) +healthy/);
  assert.match(r.saida, /ok {3}realtime fechado em \/api\/tenants +403/);
  for (const m of MODELOS) assert.match(r.saida, new RegExp(`ok {3}modelo ${m}\\.html +pelo endereco publico`));
  assert.match(r.saida, /Tudo respondendo/);
  // Os modelos da producao nao passam pelo container do Auth.
  assert.equal(r.chamadas().filter((c) => c.tool === "docker" && c.args.includes("exec")).length, 0);

  const doente = rodar({ kit: false, extra: { SHIM_REALTIME: "unhealthy" } });
  assert.equal(doente.status, 1);
  assert.match(doente.saida, /FALHA realtime \(healthcheck\) +unhealthy/);
  const aberto = rodar({ kit: false, codigos: { [`${API}/realtime/v1/*`]: 200 } });
  assert.equal(aberto.status, 1);
  assert.match(aberto.saida, /FALHA realtime fechado em \/api\/tenants +esperado 403, veio 200/);
});

test("producao sem resposta do compose nunca pula o Realtime por engano: cai no ramo fechado e falha", () => {
  const r = rodar({ kit: false, extra: { SHIM_CONFIG_FALHA: "1" } });
  assert.equal(r.status, 1);
  assert.match(r.saida, /FALHA realtime fora do compose +esperado 404, veio 403/);
  assert.match(r.saida, /FALHA modelos de e-mail +nenhum GOTRUE_MAILER_TEMPLATES_\*/);
});

test("kit: sem Realtime no compose, o caminho dele tem de estar fechado na borda, e os modelos saem de dentro do Auth", () => {
  const r = rodar({ kit: true });
  assert.equal(r.status, 0, r.saida);
  assert.doesNotMatch(r.saida, /healthcheck/);
  assert.match(r.saida, /ok {3}realtime fora do compose +404/);
  for (const m of MODELOS) assert.match(r.saida, new RegExp(`ok {3}modelo ${m}\\.html +de dentro do Auth`));
  const execs = r.chamadas().filter((c) => c.tool === "docker" && c.args.includes("exec"));
  assert.equal(execs.length, 6);
  for (const c of execs) assert.deepEqual(c.args.slice(c.args.indexOf("exec"), c.args.indexOf("exec") + 7).slice(0, 6), ["exec", "-T", "auth", "wget", "-q", "-T"]);
  // Nenhuma chamada ao Realtime pelo container (nao existe) e nenhum segredo do compose na tela.
  assert.equal(r.chamadas().filter((c) => c.tool === "docker" && c.args.includes("ps")).length, 0);
  assert.doesNotMatch(r.saida, /segredo-do-smtp|sb_secret_teste/);

  const vazado = rodar({ kit: true, codigos: { [`${API}/realtime/v1/*`]: 403 } });
  assert.equal(vazado.status, 1, "o kit que ainda encaminha o Realtime ao gateway falha");
  assert.match(vazado.saida, /FALHA realtime fora do compose +esperado 404, veio 403/);
});

test("kit: um modelo que o Auth nao consegue baixar derruba a conferencia (o e-mail sairia em ingles)", () => {
  const r = rodar({ kit: true, extra: { SHIM_MODELO_FORA: "invite,recovery" } });
  assert.equal(r.status, 1);
  assert.match(r.saida, /FALHA modelo invite\.html +nao baixou de dentro do Auth \(http:\/\/caddy:8088\/auth-templates\/invite\.html\)/);
  assert.match(r.saida, /FALHA modelo recovery\.html/);
  assert.match(r.saida, /ok {3}modelo magic_link\.html/);
  assert.match(r.saida, /2 verificacao\(oes\) falharam/);
});
