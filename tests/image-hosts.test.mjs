import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const { canOptimizeImageSrc, imageRemotePatterns } = await import("../src/lib/image-hosts.ts");
const nextConfigSource = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

test("next.config.ts consome a lista única de hosts de imagem", () => {
  assert.match(nextConfigSource, /import \{ imageRemotePatterns \} from "\.\/src\/lib\/image-hosts";/);
  assert.match(nextConfigSource, /remotePatterns: imageRemotePatterns/);
  assert.doesNotMatch(nextConfigSource, /i\.ytimg\.com|getSupabaseStorageImagePattern/);
});

test("imageRemotePatterns cobre o Storage do projeto configurado e as thumbnails do YouTube", () => {
  assert.deepEqual(imageRemotePatterns, [
    {
      hostname: "projeto.supabase.co",
      pathname: "/storage/v1/object/public/**",
      port: "",
      protocol: "https",
      search: ""
    },
    { hostname: "i.ytimg.com", pathname: "/**", port: "", protocol: "https", search: "" }
  ]);
});

test("canOptimizeImageSrc aceita só as origens publicadas em remotePatterns", () => {
  assert.equal(canOptimizeImageSrc("https://projeto.supabase.co/storage/v1/object/public/capas/a.webp"), true);
  assert.equal(canOptimizeImageSrc("https://i.ytimg.com/vi/abc123/hqdefault.jpg"), true);
  assert.equal(canOptimizeImageSrc("/hero.png"), true);

  assert.equal(canOptimizeImageSrc("https://outro.supabase.co/storage/v1/object/public/capas/a.webp"), false);
  assert.equal(canOptimizeImageSrc("https://projeto.supabase.co/storage/v1/object/sign/capas/a.webp"), false);
  assert.equal(canOptimizeImageSrc("https://projeto.supabase.co:8443/storage/v1/object/public/capas/a.webp"), false);
  assert.equal(canOptimizeImageSrc("http://i.ytimg.com/vi/abc123/hqdefault.jpg"), false);
  assert.equal(canOptimizeImageSrc("https://i.ytimg.com/vi/abc123/hqdefault.jpg?sqp=1"), false);
  assert.equal(canOptimizeImageSrc("https://i.ytimg.com/vi/abc123/hqdefault.jpg#x"), false);
  assert.equal(canOptimizeImageSrc("https://i.ytimg.com/vi/abc123/logo.svg"), false);
  assert.equal(canOptimizeImageSrc("https://cdn.exemplo.com/a.jpg"), false);
  assert.equal(canOptimizeImageSrc("/hero.png?v=2"), false);
  assert.equal(canOptimizeImageSrc("/logo.svg"), false);
  assert.equal(canOptimizeImageSrc("//cdn.exemplo.com/a.jpg"), false);
  assert.equal(canOptimizeImageSrc(""), false);
  assert.equal(canOptimizeImageSrc(null), false);
  assert.equal(canOptimizeImageSrc(undefined), false);
});

test("sem URL do Supabase configurada, qualquer projeto hospedado é aceito", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;

  const fallback = await import("../src/lib/image-hosts.ts?fallback");

  assert.equal(fallback.imageRemotePatterns[0].hostname, "**.supabase.co");
  assert.equal(fallback.canOptimizeImageSrc("https://outro.supabase.co/storage/v1/object/public/capas/a.webp"), true);
  assert.equal(fallback.canOptimizeImageSrc("https://a.b.supabase.co/storage/v1/object/public/capas/a.webp"), true);
  assert.equal(fallback.canOptimizeImageSrc("https://supabase.co/storage/v1/object/public/capas/a.webp"), false);
  assert.equal(fallback.canOptimizeImageSrc("https://outro.supabase.co:8443/storage/v1/object/public/capas/a.webp"), false);
});

// O app do servidor proprio chega ao Storage pelo host-gateway do compose (IP privado) e o otimizador do Next 16
// recusa imagem de IP privado sem dangerouslyAllowLocalIP: em 30/10/2026 toda capa do Storage sumia na producao.
test("next.config: o otimizador aceita o Storage em IP privado so no build da imagem Docker (standalone)", async () => {
  const { spawnSync } = await import("node:child_process");
  const configUrl = new URL("../next.config.ts", import.meta.url).href;
  const script = `
    import { registerHooks } from "node:module";
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (context.parentURL === ${JSON.stringify(configUrl)} && /^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
          return nextResolve(specifier + ".ts", context);
        }
        return nextResolve(specifier, context);
      }
    });
    const { default: config } = await import(${JSON.stringify(configUrl)});
    process.stdout.write(JSON.stringify({ allow: config.images.dangerouslyAllowLocalIP, output: config.output ?? null }));
  `;
  const run = (env) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, NEXT_OUTPUT: "", ...env },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(run({ NEXT_OUTPUT: "standalone" }), { allow: true, output: "standalone" });
  assert.deepEqual(run({}), { allow: false, output: null });
});
