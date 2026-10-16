import assert from "node:assert/strict";
import { before, test } from "node:test";
import { actAs, actAsSignedIn } from "../support/integration-hooks.mjs";
import { pngQuadradoDataUrl } from "../support/imagem-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  ESCOLA_DE_TESTE,
  SENHA_DE_TESTE,
  limparComentarios,
  limparFotoDoPerfil,
  seedEscolaDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Foto do perfil contra o banco e o Storage LOCAIS de verdade (docs/18 §3.1 "Perfil e foto"): a rota
// PUT/DELETE /api/profile/avatar grava a foto no bucket, o endereco no perfil (com a sessao da aluna e a
// RLS valendo), carimba os comentarios dela e apaga a foto antiga; a leitura do menu entrega a foto.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const avatarRoute = await import("../../src/app/api/profile/avatar/route.ts");
const commentsRoute = await import("../../src/app/api/comments/lessons/[lessonId]/route.ts");
const { getAppShellData } = await import("../../src/server/db/platform-store.ts");

const { curso } = ESCOLA_DE_TESTE;
const aula = curso.aulas.aula2;
const PASTA_DA_FOTO = `/storage/v1/object/public/content-assets/avatars/${contas.aluna.id}/`;

function enviarFoto(image) {
  return avatarRoute.PUT(new Request("http://localhost/api/profile/avatar", {
    body: JSON.stringify({ image }),
    headers: { "content-type": "application/json" },
    method: "PUT"
  }));
}

async function fotoNoPerfil() {
  return unwrap(await db.from("profiles").select("avatar_url").eq("id", contas.aluna.id).single(), "Lendo perfil").avatar_url;
}

async function arquivoExiste(url) {
  const response = await fetch(url);
  return response.status === 200;
}

before(async () => {
  await limparFotoDoPerfil(db, [contas.aluna.id]);
  await limparComentarios(db, [contas.aluna.id]);
});

let primeiraFoto;
let comentarioId;

test("sem sessao, a rota responde 401", async () => {
  actAs(null);
  assert.equal((await enviarFoto(pngQuadradoDataUrl(320))).status, 401);
});

test("foto fora da regra e recusada com a frase para o aluno: nao quadrada, pequena demais, formato errado", async () => {
  await actAsSignedIn(contas.aluna, SENHA_DE_TESTE);

  const pequena = await enviarFoto(pngQuadradoDataUrl(100));
  assert.equal(pequena.status, 400);
  assert.match((await pequena.json()).error, /entre 160 e 512 px/);

  const texto = await enviarFoto("data:text/plain;base64,b2xh");
  assert.equal(texto.status, 400);
  assert.match((await texto.json()).error, /WebP, JPG ou PNG/);

  const lixo = await enviarFoto("data:image/png;base64,AAAA");
  assert.equal(lixo.status, 400);
  assert.match((await lixo.json()).error, /Não conseguimos ler/);

  assert.equal(await fotoNoPerfil(), null, "nada gravado");
});

test("a aluna comenta sem foto; o comentario sai com as iniciais (sem endereco de foto)", async () => {
  await actAsSignedIn(contas.aluna, SENHA_DE_TESTE);
  const response = await commentsRoute.POST(new Request(`http://localhost/api/comments/lessons/${aula}`, {
    body: JSON.stringify({ body: "Comentário antes da foto.", contentId: curso.id }),
    headers: { "content-type": "application/json" },
    method: "POST"
  }), { params: Promise.resolve({ lessonId: aula }) });

  assert.equal(response.status, 201);
  const comment = (await response.json()).data;
  comentarioId = comment.id;
  assert.equal(comment.authorAvatarUrl, undefined);
});

test("enviar a foto: vai para o bucket na pasta da aluna, o perfil guarda o endereco, o comentario antigo ganha a foto e o menu mostra", async () => {
  await actAsSignedIn(contas.aluna, SENHA_DE_TESTE);
  const response = await enviarFoto(pngQuadradoDataUrl(320));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  primeiraFoto = payload.data.avatarUrl;
  assert.ok(primeiraFoto.includes(PASTA_DA_FOTO), `foto na pasta da aluna: ${primeiraFoto}`);
  assert.match(primeiraFoto, /\.png$/, "extensao do formato enviado");
  assert.equal(await arquivoExiste(primeiraFoto), true, "o arquivo esta publico no bucket");
  assert.equal(await fotoNoPerfil(), primeiraFoto);

  const comment = unwrap(await db.from("lesson_comments").select("author_avatar_url").eq("id", comentarioId).single(), "Lendo comentario");
  assert.equal(comment.author_avatar_url, primeiraFoto, "comentarios antigos passam a apontar para a foto nova");

  const shell = await getAppShellData(globalThis.__integrationSession.user);
  assert.equal(shell.student.avatarUrl, primeiraFoto, "o menu do topo le a foto do perfil");
});

test("trocar a foto: a nova entra e a antiga e apagada do bucket", async () => {
  await actAsSignedIn(contas.aluna, SENHA_DE_TESTE);
  const response = await enviarFoto(pngQuadradoDataUrl(256));

  assert.equal(response.status, 200);
  const segundaFoto = (await response.json()).data.avatarUrl;
  assert.notEqual(segundaFoto, primeiraFoto);
  assert.equal(await fotoNoPerfil(), segundaFoto);
  assert.equal(await arquivoExiste(segundaFoto), true);
  assert.equal(await arquivoExiste(primeiraFoto), false, "a foto antiga nao fica no bucket");
  primeiraFoto = segundaFoto;
});

test("remover a foto: volta para as iniciais no perfil, no comentario e no menu, e o arquivo some", async () => {
  await actAsSignedIn(contas.aluna, SENHA_DE_TESTE);
  const response = await avatarRoute.DELETE();

  assert.equal(response.status, 200);
  assert.equal(await fotoNoPerfil(), null);
  const comment = unwrap(await db.from("lesson_comments").select("author_avatar_url").eq("id", comentarioId).single(), "Lendo comentario");
  assert.equal(comment.author_avatar_url, null);
  assert.equal(await arquivoExiste(primeiraFoto), false);

  const shell = await getAppShellData(globalThis.__integrationSession.user);
  assert.equal(shell.student.avatarUrl, null);
});
