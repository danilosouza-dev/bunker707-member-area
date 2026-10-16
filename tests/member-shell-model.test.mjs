import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras puras do topo da area do aluno: grupos e itens da barra lateral (fonte unica da navegacao),
// item ativo pela rota, previa do produtor nos links, menu da conta, saudacao e historico da IA
// Diretor. O que e tela (gaveta, menu, botoes) esta em tests/e2e/aluno-menu-e-ia-diretor.spec.ts.

const model = await import("../src/components/member/shell/member-shell-model.ts");
const navigation = await import("../src/lib/member-navigation.ts");

const flatten = (sections) => sections.flatMap((section) => section.items);

test("barra lateral: grupos Estudar e Conta e ajuda, itens da fonte unica, todos com destino real", () => {
  const sections = model.getMemberSidebarSections("/");

  assert.deepEqual(sections.map((section) => section.label), ["Estudar", "Conta e ajuda"]);
  assert.deepEqual(
    flatten(sections).map((item) => [item.key, item.label, item.href]),
    navigation.MEMBER_NAVIGATION_ITEMS.map((item) => [item.key, item.label, item.href])
  );

  for (const item of flatten(sections)) {
    assert.match(item.href, /^\/[a-z-]*$/, `${item.label} precisa de uma rota real`);
  }

  assert.deepEqual(flatten(sections).filter((item) => item.active).map((item) => item.key), ["home"]);
});

test("item ativo segue a rota (com subrotas); pagina de aula e prefixo parcial nao marcam; a previa do produtor vai em todos os links", () => {
  const items = flatten(model.getMemberSidebarSections("/perfil/acessos", "student_with_access"));

  assert.deepEqual(items.filter((item) => item.active).map((item) => item.key), ["profile"]);

  for (const item of items) {
    assert.match(item.href, /\?accessPreview=student_with_access$/);
  }

  assert.equal(items.find((item) => item.key === "home")?.href, "/?accessPreview=student_with_access");
  assert.equal(flatten(model.getMemberSidebarSections("/conteudo/curso-1/aulas/modulo-1")).some((item) => item.active), false);
  assert.equal(flatten(model.getMemberSidebarSections("/perfil-x")).some((item) => item.active), false);
  assert.equal(flatten(model.getMemberSidebarSections("/minhas-compras?aba=cursos")).find((item) => item.active)?.key, "purchases");
});

test("menu da conta: Perfil, Minhas compras e Suporte, com o ativo marcado e a previa do produtor nos links", () => {
  assert.deepEqual(
    model.getMemberAccountMenuLinks("/minhas-compras").map((link) => [link.label, link.href, link.active]),
    [["Perfil", "/perfil", false], ["Minhas compras", "/minhas-compras", true], ["Suporte", "/suporte", false]]
  );
  assert.deepEqual(
    model.getMemberAccountMenuLinks("/", "producer").map((link) => link.href),
    ["/perfil?accessPreview=producer", "/minhas-compras?accessPreview=producer", "/suporte?accessPreview=producer"]
  );
});

test("primeiro nome e saudacao da IA Diretor", () => {
  assert.equal(model.getMemberFirstName("  Ana Paula Souza "), "Ana");
  assert.equal(model.getDirectorGreeting("Ana Paula Souza"), "Olá, Ana");
  assert.equal(model.getDirectorGreeting("   "), "Olá!");
  assert.equal(model.getDirectorGreeting(undefined), "Olá!");
});

test("historico da IA Diretor agrupado por dia civil em Sao Paulo, na ordem do servidor", () => {
  const now = Date.parse("2026-10-11T15:00:00.000Z"); // 12:00 em Sao Paulo
  const conversations = [
    { id: "a", lastMessageAt: "2026-10-11T03:30:00.000Z" }, // 00:30 do dia 11 em SP
    { id: "b", lastMessageAt: "2026-10-11T02:30:00.000Z" }, // 23:30 do dia 10 em SP: ontem, nao hoje
    { id: "c", lastMessageAt: "2026-10-06T12:00:00.000Z" },
    { id: "d", lastMessageAt: "2026-09-20T12:00:00.000Z" },
    { id: "e", lastMessageAt: "2026-06-01T12:00:00.000Z" },
    { id: "f", lastMessageAt: "data invalida" }
  ];

  assert.deepEqual(
    model.groupDirectorConversations(conversations, now).map((group) => [group.label, group.items.map((item) => item.id)]),
    [
      ["Hoje", ["a"]],
      ["Ontem", ["b"]],
      ["Últimos 7 dias", ["c"]],
      ["Últimos 30 dias", ["d"]],
      ["Mais antigas", ["e", "f"]]
    ]
  );
  assert.deepEqual(model.groupDirectorConversations([], now), []);
});

test("linha de cada chat e contador do campo da IA Diretor", () => {
  const now = Date.parse("2026-10-11T15:00:00.000Z");

  assert.equal(model.describeDirectorConversation({ lastMessageAt: "2026-10-11T13:00:00.000Z", messageCount: 6 }, now), "há 2 horas · 6 mensagens");
  assert.equal(model.describeDirectorConversation({ lastMessageAt: "2026-10-10T13:00:00.000Z", messageCount: 1 }, now), "ontem · 1 mensagem");
  assert.equal(model.describeDirectorConversation({ lastMessageAt: "", messageCount: 0 }, now), "Sem mensagens");
  assert.equal(model.DIRECTOR_MESSAGE_LIMIT, 4000);
  assert.equal(model.getDirectorCounterLabel(10), "");
  assert.equal(model.getDirectorCounterLabel(3599), "");
  assert.equal(model.getDirectorCounterLabel(3600), "3.600/4.000");
});
