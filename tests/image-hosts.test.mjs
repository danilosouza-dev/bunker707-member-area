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
