import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Foto do perfil do aluno: o que o servidor aceita, qual arquivo antigo pode ser apagado e o contrato da rota.

const model = await import("../src/server/member-area/student-avatar-model.ts");
const limits = await import("../src/lib/avatar-image.ts");

/** Cabecalho WebP VP8X (32 bytes) com o canvas pedido: o leitor do servidor so olha o cabecalho. */
function vp8xHeader(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x38, 0x0a, 0x00, 0x00], 4);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
}

function webpDataUrl(width, height) {
  return `data:image/webp;base64,${Buffer.from(vp8xHeader(width, height)).toString("base64")}`;
}

test("foto do perfil: so aceita WebP quadrado entre o minimo e 512 px, dentro do teto de tamanho", () => {
  const ok = (width, height) => model.describeAvatarImageProblem(model.decodeAvatarDataUrl(webpDataUrl(width, height)));

  assert.equal(ok(512, 512), null);
  assert.equal(ok(limits.AVATAR_MIN_SOURCE_SIZE, limits.AVATAR_MIN_SOURCE_SIZE), null);
  assert.equal(ok(300, 301), null, "um pixel de diferenca do arredondamento do recorte passa");
  assert.match(ok(512, 400), /quadrada/);
  assert.match(ok(600, 600), /entre/);
  assert.match(ok(100, 100), /entre/);

  assert.equal(model.decodeAvatarDataUrl("data:image/png;base64,iVBORw0KGgo="), null, "PNG nao entra");
  assert.equal(model.decodeAvatarDataUrl("https://cdn/foto.webp"), null, "link externo nao entra");
  assert.equal(model.decodeAvatarDataUrl(`data:image/webp;base64,${"A".repeat(limits.AVATAR_MAX_DATA_URL_LENGTH)}`), null);
  assert.match(model.describeAvatarImageProblem(null), /recortada/);
  assert.match(model.describeAvatarImageProblem(new Uint8Array([1, 2, 3, 4])), /ler/);

  const big = new Uint8Array(limits.AVATAR_MAX_BYTES + 1);
  big.set(vp8xHeader(512, 512), 0);
  assert.match(model.describeAvatarImageProblem(big), /grande demais/);
});

test("foto do perfil: so apaga arquivo antigo da propria pasta do aluno", () => {
  const base = "https://abc.supabase.co/storage/v1/object/public/content-assets";
  const user = "11111111-2222-3333-4444-555555555555";

  assert.equal(model.avatarObjectPathFromUrl(`${base}/avatars/${user}/aa11.webp`, user), `avatars/${user}/aa11.webp`);
  assert.equal(model.avatarObjectPathFromUrl(`${base}/avatars/outro-aluno/aa11.webp`, user), null, "pasta de outro aluno");
  assert.equal(model.avatarObjectPathFromUrl(`${base}/content/curso-1/cover/aa11.webp`, user), null, "capa de produto");
  assert.equal(model.avatarObjectPathFromUrl(`${base}/avatars/${user}/sub/aa11.webp`, user), null, "subpasta");
  assert.equal(model.avatarObjectPathFromUrl(`${base}/avatars/${user}/..%2F..%2Fcontent%2Fx.webp`, user), null, "volta de pasta");
  assert.equal(model.avatarObjectPathFromUrl("https://lh3.googleusercontent.com/a/foto", user), null, "foto do Google");
  assert.equal(model.avatarObjectPathFromUrl(null, user), null);
  assert.equal(model.avatarObjectPathFromUrl("nao e link", user), null);
});

test("rota da foto: so para quem esta logado, grava e remove a foto do proprio aluno", () => {
  const route = readFileSync(new URL("../src/app/api/profile/avatar/route.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/server/member-area/student-avatar.ts", import.meta.url), "utf8");

  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function DELETE/);
  assert.equal((route.match(/requireApiUser\(\)/g) ?? []).length, 2, "as duas rotas exigem sessao");
  assert.match(route, /saveStudentAvatar\(auth\.user\.id/);
  assert.match(route, /removeStudentAvatar\(auth\.user\.id\)/);
  // O endereco vai para profiles com a sessao do aluno (RLS), nunca com a chave de servico.
  assert.match(store, /createSupabaseServerClient\(\)[\s\S]*from\("profiles"\)\.update/);
  assert.match(store, /`\$\{AVATAR_STORAGE_FOLDER\}\/\$\{userId\}`/);
});
