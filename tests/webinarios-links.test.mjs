import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Os links da sala e do console dos webinarios (especificacao "Na tela", §8.1; docs/30 §8.3), src/lib/webinar-links.ts:
// - safeHttpsUrl so aceita `https://` com maquina de verdade (com ponto), sem usuario nem senha, sem espaco, aspas,
//   menor e maior, crase nem barra invertida, ate o limite do lugar (500; o QR Code, 240), e devolve o proprio texto;
//   `javascript:`, `data:`, `http:`, endereco relativo e qualquer coisa que nao e texto voltam null;
// - linkSegments: com `links: false` (mensagem de aluno, personagem de aluno do roteiro, Assistente) tudo e texto; com
//   `links: true` (a equipe), ate 5 enderecos viram link, a pontuacao do fim fica de fora, o texto visivel e igual ao
//   href e juntar os pedacos devolve a mensagem inteira.

const { WEBINAR_LINK_MAX_LENGTH, WEBINAR_LINKS_PER_MESSAGE, linkDomain, linkSegments, safeHttpsUrl } = await import("../src/lib/webinar-links.ts");

const juntar = (segments) => segments.map((segment) => segment.text).join("");
const links = (segments) => segments.filter((segment) => segment.kind === "link");

test("safeHttpsUrl aceita https com maquina de verdade e devolve o proprio texto (sem espacos nas pontas)", () => {
  assert.equal(safeHttpsUrl("https://bunker707.com.br/curso"), "https://bunker707.com.br/curso");
  assert.equal(safeHttpsUrl("  https://pay.hotmart.com/X123?off=abc#topo  "), "https://pay.hotmart.com/X123?off=abc#topo");
  // Nao normaliza: o que a equipe escreveu e o que aparece e fica gravado.
  assert.equal(safeHttpsUrl("https://Exemplo.com"), "https://Exemplo.com");
  assert.equal(safeHttpsUrl("https://exemplo.com.br:8443/a"), "https://exemplo.com.br:8443/a");
});

test("safeHttpsUrl recusa javascript:, data:, http:, relativo, usuario e senha, maquina sem ponto, caracteres que enganam e o que nao e texto", () => {
  for (const ruim of [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://exemplo.com",
    "HTTPS://exemplo.com",
    "https:exemplo.com",
    "//exemplo.com/a",
    "/curso",
    "exemplo.com",
    "https://usuario:senha@exemplo.com",
    "https://usuario@exemplo.com",
    "https://bunker707.com.br@golpe.com",
    "https://localhost/a",
    "https://intranet/a",
    "https://.exemplo.com",
    "https://exemplo..com",
    "https://golpe.com\\@bunker707.com.br",
    "https://exemplo.com/a b",
    "https://exemplo.com/\"onmouseover=x",
    "https://exemplo.com/<script>",
    "https://exemplo.com/`x`",
    "https://exemplo.com/\u0000",
    "https://",
    "",
    "   "
  ]) {
    assert.equal(safeHttpsUrl(ruim), null, ruim);
  }
  for (const naoTexto of [null, undefined, 42, {}, ["https://exemplo.com"]]) {
    assert.equal(safeHttpsUrl(naoTexto), null);
  }
});

test("safeHttpsUrl: ate 500 caracteres; o limite do lugar vale (o QR Code, 240), nunca acima de 500", () => {
  const base = "https://exemplo.com/";
  const com = (total) => base + "a".repeat(total - base.length);
  assert.equal(WEBINAR_LINK_MAX_LENGTH, 500);
  assert.equal(safeHttpsUrl(com(500)), com(500));
  assert.equal(safeHttpsUrl(com(501)), null);
  assert.equal(safeHttpsUrl(com(240), 240), com(240));
  assert.equal(safeHttpsUrl(com(241), 240), null);
  assert.equal(safeHttpsUrl(com(501), 10_000), null, "o limite do lugar nunca passa de 500");
});

test("linkDomain: a maquina sem o www (o nome do QR Code para o leitor de tela e o nome padrao do item)", () => {
  assert.equal(linkDomain("https://www.bunker707.com.br/aula?x=1"), "bunker707.com.br");
  assert.equal(linkDomain("https://pay.hotmart.com/X"), "pay.hotmart.com");
  assert.equal(linkDomain("javascript:alert(1)"), null);
  assert.equal(linkDomain(null), null);
});

test("linkSegments com links: false (aluno, personagem de aluno, Assistente): a mensagem inteira e texto, mesmo com https://", () => {
  const texto = "olhem https://golpe.com/premio agora";
  assert.deepEqual(linkSegments(texto, { links: false }), [{ kind: "text", text: texto }]);
  assert.deepEqual(linkSegments("", { links: true }), []);
  assert.deepEqual(linkSegments("sem link nenhum", { links: true }), [{ kind: "text", text: "sem link nenhum" }]);
});

test("linkSegments com links: true: o endereco vira link com o proprio texto, a pontuacao do fim fica de fora, nada se perde", () => {
  const texto = "Inscreva-se em https://bunker707.com.br/turma. Duvidas? (veja https://bunker707.com.br/faq) ou https://exemplo.com/a_(b)!";
  const segments = linkSegments(texto, { links: true });
  assert.equal(juntar(segments), texto, "juntar os pedacos devolve a mensagem");
  assert.deepEqual(
    links(segments).map((segment) => segment.href),
    ["https://bunker707.com.br/turma", "https://bunker707.com.br/faq", "https://exemplo.com/a_(b)"]
  );
  for (const link of links(segments)) {
    assert.equal(link.text, link.href, "o texto visivel e o proprio endereco");
  }
  assert.deepEqual(segments[0], { kind: "text", text: "Inscreva-se em " });
});

test("linkSegments: so https:// seguro vira link (http, javascript e o https com usuario continuam texto) e nunca no meio de uma palavra", () => {
  const texto = "a http://exemplo.com b javascript:alert(1) c https://bunker707.com.br@golpe.com d xhttps://exemplo.com e https://ok.com.br";
  const segments = linkSegments(texto, { links: true });
  assert.equal(juntar(segments), texto);
  assert.deepEqual(links(segments).map((segment) => segment.href), ["https://ok.com.br"]);
});

test("linkSegments: ate 5 links por mensagem; o sexto em diante fica como texto", () => {
  const enderecos = Array.from({ length: 7 }, (_, index) => `https://site${index}.com.br`);
  const texto = enderecos.join(" ");
  const segments = linkSegments(texto, { links: true });
  assert.equal(WEBINAR_LINKS_PER_MESSAGE, 5);
  assert.equal(juntar(segments), texto);
  assert.deepEqual(links(segments).map((segment) => segment.href), enderecos.slice(0, 5));
  assert.equal(segments.at(-1).kind, "text");
  assert.ok(segments.at(-1).text.includes(enderecos[5]) && segments.at(-1).text.includes(enderecos[6]));
});
