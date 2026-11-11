import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

// Midia do Storage guardada pelo caminho (docs/32 §11.5; src/server/db/storage-paths.ts): a base do Supabase, o que o
// banco guarda e o que a leitura devolve, as bordas (endereco assinado, imagem transformada, query, outra origem,
// maquina parecida, base com caminho, texto que so cita um endereco, aspa escapada), a troca no texto JSON comparada
// com a troca valor a valor em JSONs sorteados, e o fetch dos clientes: so /rest/v1/ muda, o corpo que vai ao banco
// leva o caminho, o que volta leva o endereco inteiro, e um cliente de verdade do supabase-js entrega o endereco inteiro.

const paths = await import("../src/server/db/storage-paths.ts");

const BASE = "https://api.bunker707.com.br";
const OBJETO = `${BASE}/storage/v1/object/public/content-assets/content/curso-ia/cover/0123456789abcdef01234567.webp`;
const GUARDADO = "/storage/v1/object/public/content-assets/content/curso-ia/cover/0123456789abcdef01234567.webp";
const TRANSFORMADA = `${BASE}/storage/v1/render/image/public/content-assets/avatars/u1/abc.webp?width=96&height=96&resize=cover`;
const ASSINADO = `${BASE}/storage/v1/object/sign/content-assets/privado/x.pdf?token=eyJhbGciOiJIUzI1NiJ9.e30.abc`;
const AUTENTICADO = `${BASE}/storage/v1/object/authenticated/content-assets/x.webp`;
const NUVEM = "https://abcdefghijklmnop.supabase.co/storage/v1/object/public/content-assets/content/x/cover/0123456789abcdef01234567.webp";
const YOUTUBE = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg";

test("a base do Supabase: origem e caminho sem barra no fim, normalizada como o getPublicUrl; o resto nao serve", () => {
  assert.equal(paths.storageBaseOf(BASE), BASE);
  assert.equal(paths.storageBaseOf(`${BASE}/`), BASE);
  assert.equal(paths.storageBaseOf("  HTTPS://API.Bunker707.com.br:443/  "), BASE, "maquina minuscula, sem a porta padrao");
  assert.equal(paths.storageBaseOf("http://127.0.0.1:55321"), "http://127.0.0.1:55321", "o Supabase local dos testes");
  assert.equal(paths.storageBaseOf("http://[::1]:8000/"), "http://[::1]:8000");
  assert.equal(paths.storageBaseOf("https://escola.exemplo.com.br/supabase/"), "https://escola.exemplo.com.br/supabase", "base com caminho");
  for (const ruim of [null, undefined, "", "   ", "api.bunker707.com.br", "ftp://api.bunker707.com.br", `${BASE}?x=1`, `${BASE}#a`, "https://user:senha@api.bunker707.com.br", "https://api.bunker707.com.br/a b", "https://exa\"mple.com", `https://${"a".repeat(2_100)}.com`]) {
    assert.equal(paths.storageBaseOf(ruim), null, String(ruim));
  }
});

test("o que o banco guarda: so o endereco do nosso Storage (objeto publico e imagem transformada, com a query) perde a base", () => {
  assert.equal(paths.toStoredStorageUrl(OBJETO, BASE), GUARDADO);
  assert.equal(paths.toStoredStorageUrl(`${OBJETO}?v=2`, BASE), `${GUARDADO}?v=2`, "a query fica");
  assert.equal(paths.toStoredStorageUrl(TRANSFORMADA, BASE), TRANSFORMADA.slice(BASE.length), "a imagem transformada guarda as medidas");

  const ficam = [
    [ASSINADO, "endereco assinado (temporario, com token)"],
    [AUTENTICADO, "objeto que pede sessao"],
    [NUVEM, "outra origem (outro projeto do Supabase)"],
    [YOUTUBE, "terceiro"],
    [OBJETO.replace("https://", "http://"), "outro protocolo"],
    [OBJETO.replace(BASE, `${BASE}:8443`), "outra porta"],
    [OBJETO.replace(BASE, `${BASE}.golpe.com`), "maquina que comeca igual"],
    [OBJETO.replace(BASE, "https://API.bunker707.com.br"), "maiuscula (o upload nunca gera)"],
    [`${BASE}/storage/v1/object/publico/content-assets/x.webp`, "rota parecida"],
    [`${BASE}/hero/capa.webp`, "outro caminho da mesma maquina"],
    [GUARDADO, "ja guardado: nunca converte duas vezes"],
    ["/hero/bunker-707-red-front-hero.png", "arquivo do public/"],
    ["data:image/webp;base64,AAAA", "imagem inline"],
    [`Veja ${OBJETO}`, "texto que so cita o endereco"],
    ["", "vazio"]
  ];

  for (const [valor, motivo] of ficam) {
    assert.equal(paths.toStoredStorageUrl(valor, BASE), valor, motivo);
  }

  assert.equal(paths.toStoredStorageUrl(OBJETO, null), OBJETO, "sem base, nada muda");
});

test("base com caminho: so o endereco debaixo dela vira caminho", () => {
  const base = "https://escola.exemplo.com.br/supabase";
  assert.equal(paths.toStoredStorageUrl(`${base}/storage/v1/object/public/b/a.webp`, base), "/storage/v1/object/public/b/a.webp");
  assert.equal(paths.toStoredStorageUrl("https://escola.exemplo.com.br/storage/v1/object/public/b/a.webp", base), "https://escola.exemplo.com.br/storage/v1/object/public/b/a.webp");
  assert.equal(paths.toPublicStorageUrl("/storage/v1/object/public/b/a.webp", base), `${base}/storage/v1/object/public/b/a.webp`);
});

test("o que a leitura devolve: o caminho guardado ganha a base; o endereco inteiro antigo, de qualquer origem, volta como esta", () => {
  assert.equal(paths.toPublicStorageUrl(GUARDADO, BASE), OBJETO);
  assert.equal(paths.toPublicStorageUrl(`${GUARDADO}?v=2`, BASE), `${OBJETO}?v=2`);
  assert.equal(paths.toPublicStorageUrl(TRANSFORMADA.slice(BASE.length), BASE), TRANSFORMADA);
  assert.equal(paths.toPublicStorageUrl(GUARDADO, "https://novo-endereco.exemplo.com"), OBJETO.replace(BASE, "https://novo-endereco.exemplo.com"), "a Instalacao mudou de endereco: a leitura acompanha");

  for (const valor of [OBJETO, NUVEM, YOUTUBE, ASSINADO, "/hero/capa.webp", "/storage/v1/object/sign/x", "", "storage/v1/object/public/b/x"]) {
    assert.equal(paths.toPublicStorageUrl(valor, BASE), valor, valor);
  }

  assert.equal(paths.toPublicStorageUrl(GUARDADO, null), GUARDADO, "sem base, nada muda");
  assert.equal(paths.isStoredStorageUrl(GUARDADO), true);
  assert.equal(paths.isStoredStorageUrl(OBJETO), false);
  assert.equal(paths.isStoredStorageUrl(null), false);

  for (const valor of [OBJETO, `${OBJETO}?v=2`, TRANSFORMADA]) {
    assert.equal(paths.toPublicStorageUrl(paths.toStoredStorageUrl(valor, BASE), BASE), valor, "ida e volta exata");
  }
});

test("no texto JSON: so o texto que comeca com o endereco muda; aspa escapada, texto que cita no meio e outra origem ficam", () => {
  const corpo = JSON.stringify({
    avatar_url: OBJETO,
    body: `Olha a capa: ${OBJETO}`,
    citacao: `"${OBJETO}" entre aspas`,
    design: { card: { background: { kind: "image", url: TRANSFORMADA } }, lista: [OBJETO, NUVEM, YOUTUBE, ASSINADO] },
    escapada: `x\\"${OBJETO}`,
    image: GUARDADO
  });
  const guardado = JSON.parse(paths.storedJsonText(corpo, BASE));

  assert.deepEqual(guardado, {
    avatar_url: GUARDADO,
    body: `Olha a capa: ${OBJETO}`,
    citacao: `"${OBJETO}" entre aspas`,
    design: { card: { background: { kind: "image", url: TRANSFORMADA.slice(BASE.length) } }, lista: [GUARDADO, NUVEM, YOUTUBE, ASSINADO] },
    escapada: `x\\"${OBJETO}`,
    image: GUARDADO
  });

  const lido = JSON.parse(paths.publicJsonText(JSON.stringify(guardado), BASE));
  assert.deepEqual(lido, { ...JSON.parse(corpo), image: OBJETO }, "na volta, o caminho que ja estava guardado tambem vira endereco");
  assert.equal(paths.storedJsonText(corpo, null), corpo);
  assert.equal(paths.publicJsonText(JSON.stringify(guardado), null), JSON.stringify(guardado));
  assert.equal(paths.publicJsonText('{"a":"\\"/storage/v1/object/public/b/x"}', BASE), '{"a":"\\"/storage/v1/object/public/b/x"}', "aspa escapada nao abre texto");
});

/** Gerador simples e reproduzivel (mulberry32). */
function sorteio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const TEXTOS = [OBJETO, `${OBJETO}?v=1`, TRANSFORMADA, GUARDADO, NUVEM, YOUTUBE, ASSINADO, AUTENTICADO, "", "ação", "aspas \" e barra \\", `\\${OBJETO}`, `"${OBJETO}`, `${OBJETO}"`, "\u2028", "/storage/v1/object/public/", `${BASE}/storage/v1/`, "\\\"/storage/v1/object/public/x"];

function jsonSorteado(proximo, profundidade = 0) {
  const r = proximo();
  if (profundidade > 4 || r < 0.35) return TEXTOS[Math.floor(proximo() * TEXTOS.length)];
  if (r < 0.45) return [null, true, false, 0, -1.5, 42][Math.floor(proximo() * 6)];
  if (r < 0.7) return Array.from({ length: Math.floor(proximo() * 4) }, () => jsonSorteado(proximo, profundidade + 1));
  return Object.fromEntries(Array.from({ length: Math.floor(proximo() * 4) }, (_, i) => [`k${i}`, jsonSorteado(proximo, profundidade + 1)]));
}

function cadaTexto(valor, troca) {
  if (typeof valor === "string") return troca(valor);
  if (Array.isArray(valor)) return valor.map((item) => cadaTexto(item, troca));
  if (valor && typeof valor === "object") return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, cadaTexto(item, troca)]));
  return valor;
}

test("2.000 JSONs sorteados: a troca no texto e igual a troca valor a valor, nas duas pontas, e a ida e volta e exata", () => {
  const proximo = sorteio(707);

  for (let i = 0; i < 2_000; i += 1) {
    const valor = jsonSorteado(proximo);
    const texto = JSON.stringify(valor);
    const guardado = JSON.parse(paths.storedJsonText(texto, BASE));

    assert.deepEqual(guardado, cadaTexto(valor, (item) => paths.toStoredStorageUrl(item, BASE)), texto);
    assert.deepEqual(JSON.parse(paths.publicJsonText(texto, BASE)), cadaTexto(valor, (item) => paths.toPublicStorageUrl(item, BASE)), texto);
    // O que o app grava e le de volta e o que ele mandou, a nao ser o caminho que ja vinha sem base (vira endereco).
    assert.deepEqual(JSON.parse(paths.publicJsonText(JSON.stringify(guardado), BASE)), cadaTexto(valor, (item) => paths.toPublicStorageUrl(item, BASE)), texto);
  }
});

/** Um fetch falso: guarda o pedido e responde o que o teste mandar. */
function fetchFalso(resposta) {
  const pedidos = [];
  const fetch = async (input, init) => {
    pedidos.push({ body: init?.body, init, input: String(input), method: init?.method ?? "GET" });
    return typeof resposta === "function" ? resposta(String(input), init) : resposta.clone();
  };
  return { fetch, pedidos };
}

const json = (corpo, init = {}) =>
  new Response(JSON.stringify(corpo), { headers: { "content-length": "999", "content-range": "0-0/1", "content-type": "application/json; charset=utf-8", ...init.headers }, status: init.status ?? 200 });

test("o fetch dos clientes: pedido ao PostgREST leva o caminho, a resposta volta com o endereco inteiro, status e cabecalhos ficam", async () => {
  const falso = fetchFalso(json([{ avatar_url: GUARDADO, foto_antiga: NUVEM }], { status: 201 }));
  const fetch = paths.createStoragePathsFetch(`${BASE}/`, falso.fetch);
  const resposta = await fetch(`${BASE}/rest/v1/profiles?id=eq.1`, { body: JSON.stringify({ avatar_url: OBJETO, nome: "Ana" }), headers: { prefer: "return=representation" }, method: "PATCH" });

  assert.deepEqual(JSON.parse(falso.pedidos[0].body), { avatar_url: GUARDADO, nome: "Ana" });
  assert.equal(falso.pedidos[0].init.headers.prefer, "return=representation", "o resto do pedido vai igual");
  assert.equal(resposta.status, 201);
  assert.equal(resposta.headers.get("content-range"), "0-0/1", "a contagem continua no cabecalho");
  assert.equal(resposta.headers.get("content-length"), null, "o tamanho mudou");
  assert.deepEqual(await resposta.json(), [{ avatar_url: OBJETO, foto_antiga: NUVEM }]);
});

test("o fetch dos clientes: rpc tambem; Auth, Storage, funcoes, Request e as tabelas de fora ficam como estao", async () => {
  const corpo = JSON.stringify({ p_image: OBJETO });
  const respostaGuardada = json({ image: GUARDADO });

  const rpc = fetchFalso(respostaGuardada);
  const viaRpc = await paths.createStoragePathsFetch(BASE, rpc.fetch)(`${BASE}/rest/v1/rpc/admin_patch_product_settings`, { body: corpo, method: "POST" });
  assert.deepEqual(JSON.parse(rpc.pedidos[0].body), { p_image: GUARDADO });
  assert.deepEqual(await viaRpc.json(), { image: OBJETO });

  for (const caminho of ["/auth/v1/token?grant_type=password", "/storage/v1/object/content-assets/x.webp", "/functions/v1/algo", "/rest/v1/webinar_offer_variants?on_conflict=offer_id,label"]) {
    const falso = fetchFalso(respostaGuardada);
    const resposta = await paths.createStoragePathsFetch(BASE, falso.fetch)(`${BASE}${caminho}`, { body: corpo, method: "POST" });
    assert.equal(falso.pedidos[0].body, corpo, caminho);
    assert.deepEqual(await resposta.json(), { image: GUARDADO }, caminho);
  }

  const request = fetchFalso(respostaGuardada);
  const viaRequest = await paths.createStoragePathsFetch(BASE, request.fetch)(new Request(`${BASE}/rest/v1/profiles`), undefined);
  assert.deepEqual(await viaRequest.json(), { image: GUARDADO }, "Request inteiro (o supabase-js nunca manda) passa direto");

  const url = fetchFalso(respostaGuardada);
  const viaUrl = await paths.createStoragePathsFetch(BASE, url.fetch)(new URL(`${BASE}/rest/v1/profiles?select=avatar_url`));
  assert.deepEqual(await viaUrl.json(), { image: OBJETO }, "URL tambem e pedido ao PostgREST");
});

test("o fetch dos clientes: 204, HEAD, CSV e plano passam sem ler o corpo; sem endereco do Supabase valido, nada muda", async () => {
  const semCorpo = new Response(null, { status: 204 });
  const vazio = fetchFalso(() => semCorpo);
  assert.equal(await paths.createStoragePathsFetch(BASE, vazio.fetch)(`${BASE}/rest/v1/profiles`, { body: "{}", method: "PATCH" }), semCorpo);

  for (const tipo of ["text/csv", "application/vnd.pgrst.plan+text"]) {
    const original = new Response(`image\n${GUARDADO}`, { headers: { "content-type": tipo } });
    const falso = fetchFalso(() => original);
    assert.equal(await paths.createStoragePathsFetch(BASE, falso.fetch)(`${BASE}/rest/v1/content_items`), original, tipo);
  }

  for (const ruim of [undefined, "", "nao e endereco", `${BASE}?a=1`]) {
    const falso = fetchFalso(json({ image: GUARDADO }));
    const resposta = await paths.createStoragePathsFetch(ruim, falso.fetch)(`${BASE}/rest/v1/profiles`, { body: JSON.stringify({ avatar_url: OBJETO }), method: "POST" });
    assert.deepEqual(JSON.parse(falso.pedidos[0].body), { avatar_url: OBJETO }, String(ruim));
    assert.deepEqual(await resposta.json(), { image: GUARDADO }, String(ruim));
  }
});

test("um cliente de verdade do supabase-js: grava o caminho, le o endereco inteiro, com .single() e a contagem", async () => {
  const banco = new Map([["1", { avatar_url: GUARDADO, id: "1" }]]);
  const falso = fetchFalso((input, init) => {
    const url = new URL(input);
    if (init?.method === "PATCH") {
      const linha = { ...banco.get("1"), ...JSON.parse(init.body) };
      banco.set("1", linha);
      // .single(): o PostgREST devolve o objeto, nao a lista.
      return new Headers(init.headers).get("accept")?.includes("vnd.pgrst.object") ? json(linha) : json([linha]);
    }
    assert.match(url.pathname, /\/rest\/v1\/profiles$/);
    return json([...banco.values()], { headers: { "content-range": "0-0/1" } });
  });
  const cliente = createClient(BASE, "sb_publishable_teste", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: paths.createStoragePathsFetch(BASE, falso.fetch) }
  });

  const lido = await cliente.from("profiles").select("id,avatar_url", { count: "exact" });
  assert.equal(lido.error, null);
  assert.deepEqual(lido.data, [{ avatar_url: OBJETO, id: "1" }]);
  assert.equal(lido.count, 1);

  const novo = OBJETO.replace("cover/", "cover-nova/");
  const gravado = await cliente.from("profiles").update({ avatar_url: novo }).eq("id", "1").select("avatar_url").single();
  assert.equal(gravado.error, null);
  assert.equal(gravado.data.avatar_url, novo, "o app ve o endereco inteiro");
  assert.equal(banco.get("1").avatar_url, novo.slice(BASE.length), "o banco guarda o caminho");
});
