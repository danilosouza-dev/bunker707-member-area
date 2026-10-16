import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Foto do perfil do aluno: o que o servidor aceita (WebP, JPEG e PNG), o formato que o navegador escolhe,
// qual arquivo antigo pode ser apagado, o contrato da rota e a foto nos comentarios.

const model = await import("../src/server/member-area/student-avatar-model.ts");
const header = await import("../src/server/member-area/image-header.ts");
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

/** Assinatura PNG + chunk IHDR (33 bytes): largura e altura big-endian. */
function pngHeader(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  bytes.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
  bytes.set([(height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff], 20);
  bytes.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
  return bytes;
}

/**
 * JPEG como o Safari gera: SOI, APP0 (JFIF), uma tabela DQT a pular, um enchimento ff ff e o SOFn com
 * altura e largura. `progressive` troca SOF0 por SOF2 (c2).
 */
function jpegHeader(width, height, { progressive = false } = {}) {
  const sof = progressive ? 0xc2 : 0xc0;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    0xff, 0xdb, 0x00, 0x05, 0x00, 0x01, 0x02,
    0xff, 0xff,
    0xff, sof, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00
  ]);
}

function dataUrl(mimeType, bytes) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function webpDataUrl(width, height) {
  return dataUrl("image/webp", vp8xHeader(width, height));
}

/** Data URL de `bytes` bytes de conteudo, no tipo pedido (so o tamanho importa para a escolha). */
function sizedDataUrl(mimeType, bytes) {
  return dataUrl(mimeType, Buffer.alloc(bytes, 1));
}

test("foto do perfil: aceita WebP quadrado entre o minimo e 512 px, dentro do teto de tamanho", () => {
  const ok = (width, height) => model.describeAvatarImageProblem(model.decodeAvatarDataUrl(webpDataUrl(width, height)));

  assert.equal(ok(512, 512), null);
  assert.equal(ok(limits.AVATAR_MIN_SOURCE_SIZE, limits.AVATAR_MIN_SOURCE_SIZE), null);
  assert.equal(ok(300, 301), null, "um pixel de diferenca do arredondamento do recorte passa");
  assert.match(ok(512, 400), /quadrada/);
  assert.match(ok(600, 600), /entre/);
  assert.match(ok(100, 100), /entre/);

  assert.deepEqual(model.decodeAvatarDataUrl(webpDataUrl(512, 512)), { bytes: vp8xHeader(512, 512), mimeType: "image/webp" });
  assert.equal(model.decodeAvatarDataUrl("data:image/gif;base64,R0lGODlh"), null, "GIF nao entra");
  assert.equal(model.decodeAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz4="), null, "SVG nao entra");
  assert.equal(model.decodeAvatarDataUrl("https://cdn/foto.webp"), null, "link externo nao entra");
  assert.equal(model.decodeAvatarDataUrl("data:image/webp;base64,AAAA AAAA"), null, "espaco no base64 nao entra");
  assert.equal(model.decodeAvatarDataUrl(`data:image/webp;base64,${"A".repeat(limits.AVATAR_MAX_DATA_URL_LENGTH)}`), null);
  assert.match(model.describeAvatarImageProblem(null), /WebP, JPG ou PNG/);
  assert.match(model.describeAvatarImageProblem({ bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "image/webp" }), /ler/);

  const big = new Uint8Array(limits.AVATAR_MAX_BYTES + 1);
  big.set(vp8xHeader(512, 512), 0);
  assert.match(model.describeAvatarImageProblem({ bytes: big, mimeType: "image/webp" }), /grande demais/);
});

test("foto do perfil: aceita JPEG e PNG quadrados (Safari, iPhone e iPad), lendo a medida no cabecalho", () => {
  const problem = (mimeType, bytes) => model.describeAvatarImageProblem(model.decodeAvatarDataUrl(dataUrl(mimeType, bytes)));

  assert.equal(problem("image/jpeg", jpegHeader(512, 512)), null);
  assert.equal(problem("image/jpeg", jpegHeader(256, 256, { progressive: true })), null, "JPEG progressivo (SOF2)");
  assert.equal(problem("image/png", pngHeader(512, 512)), null);
  assert.equal(problem("image/png", pngHeader(limits.AVATAR_MIN_SOURCE_SIZE, limits.AVATAR_MIN_SOURCE_SIZE)), null);
  assert.match(problem("image/jpeg", jpegHeader(512, 384)), /quadrada/);
  assert.match(problem("image/png", pngHeader(1024, 1024)), /entre/);
  assert.match(problem("image/png", pngHeader(120, 120)), /entre/);

  // O tipo declarado tem de bater com os bytes: PNG dizendo ser JPEG (ou WebP) nao passa.
  assert.match(problem("image/jpeg", pngHeader(512, 512)), /ler/);
  assert.match(problem("image/webp", pngHeader(512, 512)), /ler/);
  assert.match(problem("image/png", jpegHeader(512, 512)), /ler/);

  assert.deepEqual(header.readPngDimensions(pngHeader(300, 200)), { height: 200, width: 300 });
  assert.equal(header.readPngDimensions(pngHeader(300, 200).slice(0, 20)), null, "PNG cortado");
  assert.deepEqual(header.readJpegDimensions(jpegHeader(640, 480)), { height: 480, width: 640 });
  assert.equal(header.readJpegDimensions(jpegHeader(640, 480).slice(0, 30)), null, "JPEG cortado antes do SOF");
  assert.equal(header.readJpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01])), null, "dados sem SOF");
  assert.equal(header.readJpegDimensions(new Uint8Array([0xff, 0xd8, 0x00, 0xc0, 0x00, 0x11])), null, "byte fora do lugar");

  const big = new Uint8Array(limits.AVATAR_MAX_BYTES + 1);
  big.set(pngHeader(512, 512), 0);
  assert.match(model.describeAvatarImageProblem({ bytes: big, mimeType: "image/png" }), /grande demais/, "PNG tem o mesmo teto");
});

test("foto do perfil: o navegador manda WebP quando gera, senao JPEG, senao PNG (WebKit devolve PNG no lugar do WebP)", () => {
  const KB = 1024;
  // Tamanho cai com a qualidade: 0,82 -> 123 KB ... 0,58 -> 87 KB (primeira abaixo do alvo de 90 KB).
  const sizeFor = (quality) => Math.round(quality * 150 * KB);

  // Chrome, Edge, Firefox: gera WebP; desce a qualidade ate caber no alvo e nunca pede JPEG.
  const chromeCalls = [];
  const chrome = limits.encodeAvatar((type, quality) => {
    chromeCalls.push([type, quality]);
    return sizedDataUrl(type, sizeFor(quality));
  });
  assert.equal(chrome.ok, true);
  assert.equal(chrome.mimeType, "image/webp");
  assert.equal(limits.avatarDataUrlByteLength(chrome.dataUrl), sizeFor(0.58));
  assert.deepEqual(chromeCalls, [0.82, 0.76, 0.7, 0.64, 0.58].map((quality) => ["image/webp", quality]));

  // Safari (e todo navegador no iPhone e iPad): toDataURL("image/webp") devolve PNG; JPEG sai normal.
  const safariCalls = [];
  const safari = limits.encodeAvatar((type, quality) => {
    safariCalls.push([type, quality]);
    return type === "image/jpeg" ? sizedDataUrl("image/jpeg", sizeFor(quality)) : sizedDataUrl("image/png", 400 * KB);
  });
  assert.equal(safari.ok, true);
  assert.equal(safari.mimeType, "image/jpeg");
  assert.equal(limits.avatarDataUrlByteLength(safari.dataUrl), sizeFor(0.58));
  assert.deepEqual(safariCalls[0], ["image/webp", 0.82], "pede WebP uma vez e desiste");
  assert.deepEqual(safariCalls.slice(1), [0.82, 0.76, 0.7, 0.64, 0.58].map((quality) => ["image/jpeg", quality]));

  // Navegador que so gera PNG: vale o PNG se couber no teto do servidor; senao "grande demais".
  assert.deepEqual(limits.encodeAvatar(() => sizedDataUrl("image/png", 120 * KB)), {
    dataUrl: sizedDataUrl("image/png", 120 * KB),
    mimeType: "image/png",
    ok: true
  });
  assert.deepEqual(limits.encodeAvatar(() => sizedDataUrl("image/png", 400 * KB)), { error: "too_large", ok: false });

  // Nenhuma qualidade cabe no alvo: vale a menor, desde que passe no teto; acima do teto, "grande demais".
  const heavy = limits.encodeAvatar((type, quality) => sizedDataUrl(type, Math.round(quality * 190 * KB)));
  assert.equal(heavy.ok, true);
  assert.equal(limits.avatarDataUrlByteLength(heavy.dataUrl), Math.round(0.46 * 190 * KB));
  assert.deepEqual(limits.encodeAvatar((type, quality) => sizedDataUrl(type, Math.round(quality * 400 * KB))), { error: "too_large", ok: false });

  // Canvas vazio ("data:,") ou formato desconhecido: sem o que enviar.
  assert.deepEqual(limits.encodeAvatar(() => "data:,"), { error: "unsupported", ok: false });

  assert.equal(limits.avatarDataUrlType("data:image/jpeg;base64,/9j/"), "image/jpeg");
  assert.equal(limits.avatarDataUrlType("data:image/gif;base64,R0lG"), null);
  assert.deepEqual(Object.keys(limits.AVATAR_FORMATS).sort(), ["image/jpeg", "image/png", "image/webp"]);
});

test("foto do perfil: so apaga arquivo antigo da propria pasta do aluno", () => {
  const base = "https://abc.supabase.co/storage/v1/object/public/content-assets";
  const user = "11111111-2222-3333-4444-555555555555";

  assert.equal(model.avatarObjectPathFromUrl(`${base}/avatars/${user}/aa11.webp`, user), `avatars/${user}/aa11.webp`);
  assert.equal(model.avatarObjectPathFromUrl(`${base}/avatars/${user}/aa11.jpg`, user), `avatars/${user}/aa11.jpg`, "JPEG do Safari");
  assert.equal(model.avatarObjectPathFromUrl(`${base}/avatars/${user}/aa11.png`, user), `avatars/${user}/aa11.png`);
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
  // Erro ao apagar a foto antiga vai para o log e nao desfaz a troca.
  assert.match(store, /const \{ error \} = await getSupabaseAdminClient\(\)\.storage\.from\("content-assets"\)\.remove\(\[objectPath\]\);\s+if \(error\) \{\s+console\.error\("\[perfil\] limpeza da foto antiga"/);
});

test("foto nos comentarios: trocar ou remover atualiza os comentarios do proprio aluno, e foto que nao carrega vira iniciais", () => {
  const store = readFileSync(new URL("../src/server/member-area/student-avatar.ts", import.meta.url), "utf8");
  const lesson = readFileSync(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");

  // Chave de servico (a RLS nao abre lesson_comments para o aluno), so nas linhas deste autor.
  assert.match(store, /getSupabaseAdminClient\(\)\.from\("lesson_comments"\)\.update\(\{ author_avatar_url: avatarUrl \}\)\.eq\("author_id", userId\)/);
  assert.equal((store.match(/await syncCommentAuthorAvatar\(userId, /g) ?? []).length, 2, "ao gravar e ao remover");
  assert.match(store, /await syncCommentAuthorAvatar\(userId, avatarUrl\)/);
  assert.match(store, /await syncCommentAuthorAvatar\(userId, null\)/);

  // CommentAvatar: a foto e uma <Image> com onError que volta para as iniciais, nao um background-image.
  const commentAvatar = /function CommentAvatar\([\s\S]*?\n}\n/.exec(lesson)?.[0] ?? "";
  assert.match(commentAvatar, /useState<string \| null>\(null\)/);
  assert.match(commentAvatar, /onError=\{\(\) => setFailedSrc\(imageSrc\)\}/);
  assert.match(commentAvatar, /\{imageSrc \? \(\s*<Image/);
  assert.match(commentAvatar, /\{avatar\.label\}/);
  assert.doesNotMatch(commentAvatar, /backgroundImage/);
});
