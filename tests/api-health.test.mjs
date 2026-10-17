import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// GET /api/health: resposta do HEALTHCHECK do container e do monitor externo (docs/20). Precisa
// responder sem sessao, sem banco e sem cache, e dizer qual versao da imagem esta no ar.

const { GET } = await import("../src/app/api/health/route.ts");

test("responde 200 com ok e sem cache, sem exigir sessao nem banco", async () => {
  const response = GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(await response.clone().json()).sort(), ["ok", "version"]);
  assert.equal((await response.json()).ok, true);
});

test("informa a versao gravada na imagem (APP_VERSION) e 'dev' quando nao ha build", async () => {
  const previous = process.env.APP_VERSION;

  try {
    process.env.APP_VERSION = "sha-abc1234";
    assert.equal((await GET().json()).version, "sha-abc1234");

    delete process.env.APP_VERSION;
    assert.equal((await GET().json()).version, "dev");
  } finally {
    if (previous === undefined) {
      delete process.env.APP_VERSION;
    } else {
      process.env.APP_VERSION = previous;
    }
  }
});
