import assert from "node:assert/strict";
import test from "node:test";

// O navegador roda src/instrumentation-client.ts antes de qualquer modulo do app. Ele precisa deixar o
// zod sem compilacao (`jitless`), senao o zod tenta `new Function("")`, a CSP sem 'unsafe-eval' bloqueia
// e a tentativa vira violacao no console e no Sentry. O arquivo grava a configuracao direto onde o zod a
// le (globalThis.__zod_globalConfig), sem importar o zod: se uma versao nova do zod mudar esse lugar,
// este teste quebra. A tela no navegador tem o proprio teste em tests/e2e/visitante-barrado-na-borda.

test("depois do instrumentation-client, o zod valida formularios sem tentar compilar codigo (new Function)", async () => {
  const FunctionOriginal = globalThis.Function;
  let tentativasDeCompilar = 0;
  globalThis.Function = new Proxy(FunctionOriginal, {
    construct(alvo, argumentos, novoAlvo) {
      tentativasDeCompilar += 1;
      return Reflect.construct(alvo, argumentos, novoAlvo);
    }
  });

  try {
    await import("../src/instrumentation-client.ts");
    const { z } = await import("zod");

    assert.equal(z.config().jitless, true);

    const formulario = z.object({ email: z.email(), token: z.string().trim().min(8) });
    assert.deepEqual(formulario.parse({ email: "produtor@bunker707.test", token: "  hottok-123  " }), {
      email: "produtor@bunker707.test",
      token: "hottok-123"
    });
    const invalido = formulario.safeParse({ email: "sem-arroba", token: "curto" });
    assert.equal(invalido.success, false);
    assert.deepEqual(invalido.error.issues.map((problema) => problema.path.join(".")), ["email", "token"]);

    assert.equal(tentativasDeCompilar, 0);
  } finally {
    globalThis.Function = FunctionOriginal;
  }
});
