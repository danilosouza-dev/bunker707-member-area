const requiredNames = [
  "BUNKER_AI_GATEWAY_URL",
  "BUNKER_AI_GATEWAY_API_KEY",
  "BUNKER_AI_GATEWAY_MANAGEMENT_KEY"
];

for (const name of requiredNames) {
  if (!process.env[name]?.trim()) {
    throw new Error(name + " nao foi configurada.");
  }
}

let baseUrl;

try {
  baseUrl = new URL(process.env.BUNKER_AI_GATEWAY_URL.trim());
} catch {
  throw new Error("BUNKER_AI_GATEWAY_URL e invalida.");
}

const local = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1" || baseUrl.hostname === "::1";

if ((baseUrl.protocol !== "https:" && !(local && baseUrl.protocol === "http:"))
  || baseUrl.username
  || baseUrl.password
  || baseUrl.search
  || baseUrl.hash) {
  throw new Error("BUNKER_AI_GATEWAY_URL nao atende aos requisitos de seguranca.");
}

baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");
const apiKey = process.env.BUNKER_AI_GATEWAY_API_KEY.trim();
const managementKey = process.env.BUNKER_AI_GATEWAY_MANAGEMENT_KEY.trim();

if (apiKey === managementKey) {
  throw new Error("As credenciais de runtime e gestao precisam ser diferentes.");
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const normalizedPath = path.startsWith("/") ? path : "/" + path;
  const targetUrl = new URL(baseUrl.toString().replace(/\/$/, "") + normalizedPath);

  try {
    return await fetch(targetUrl, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function expectStatus(label, response, allowedStatuses) {
  if (allowedStatuses.includes(response.status)) return;
  const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
  throw new Error(label + " respondeu HTTP " + response.status + (detail ? ": " + detail : ""));
}

const models = await request("/v1/models", {
  headers: { Authorization: "Bearer " + apiKey }
});
await expectStatus("Runtime autenticado", models, [200]);

const runtimeWithoutCredential = await request("/v1/models");
await expectStatus("Runtime sem credencial", runtimeWithoutCredential, [401, 403]);

const runtimeWithManagementKey = await request("/v1/models", {
  headers: { Authorization: "Bearer " + managementKey }
});
await expectStatus("Runtime com chave de gestao", runtimeWithManagementKey, [401, 403]);

const management = await request("/v0/management/auth-files", {
  headers: { Authorization: "Bearer " + managementKey }
});
await expectStatus("Gestao autenticada", management, [200]);

const unauthorized = await request("/v0/management/auth-files");
await expectStatus("Gestao sem credencial", unauthorized, [401, 403]);

const managementWithRuntimeKey = await request("/v0/management/auth-files", {
  headers: { Authorization: "Bearer " + apiKey }
});
await expectStatus("Gestao com chave de runtime", managementWithRuntimeKey, [401, 403]);

console.log("Bunker AI Gateway operacional: runtime e gestao autenticados, anonimos bloqueados e chaves isoladas.");
