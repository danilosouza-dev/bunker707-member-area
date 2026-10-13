import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Barra lateral, menu da conta e regras puras do topo da area do aluno (rodada "aluno v2").

const model = await import("../src/components/member/shell/member-shell-model.ts");
const navigation = await import("../src/lib/member-navigation.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const appShellSource = read("src/components/app-shell.tsx");
const sidebarSource = read("src/components/member/shell/member-sidebar.tsx");
const accountMenuSource = read("src/components/member/shell/member-account-menu.tsx");
const iconsSource = read("src/components/member/shell/member-navigation-icons.ts");
const modelSource = read("src/components/member/shell/member-shell-model.ts");

const flatten = (sections) => sections.flatMap((section) => section.items);

test("barra lateral: grupos e itens saem da fonte unica, todos com destino real", () => {
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
  assert.match(modelSource, /MEMBER_NAVIGATION_GROUPS\.map/);
  assert.match(modelSource, /isMemberNavigationItemActive\(item\.href, pathname\)/);
});

test("item ativo segue a rota (com subrotas) e a previa do produtor vai em todos os links", () => {
  const items = flatten(model.getMemberSidebarSections("/perfil/acessos", "student_with_access"));

  assert.deepEqual(items.filter((item) => item.active).map((item) => item.key), ["profile"]);

  for (const item of items) {
    assert.match(item.href, /\?accessPreview=student_with_access$/);
  }

  assert.equal(items.find((item) => item.key === "home")?.href, "/?accessPreview=student_with_access");
  // Pagina de curso ou aula nao marca item; prefixo parcial tambem nao.
  assert.equal(flatten(model.getMemberSidebarSections("/conteudo/curso-1/aulas/modulo-1")).some((item) => item.active), false);
  assert.equal(flatten(model.getMemberSidebarSections("/perfil-x")).some((item) => item.active), false);
  assert.equal(flatten(model.getMemberSidebarSections("/minhas-compras?aba=cursos")).find((item) => item.active)?.key, "purchases");
});

test("menu da conta: Perfil, Minhas compras e Suporte (o Sair fica no proprio menu)", () => {
  assert.deepEqual(
    model.getMemberAccountMenuLinks("/minhas-compras").map((link) => [link.label, link.href, link.active]),
    [
      ["Perfil", "/perfil", false],
      ["Minhas compras", "/minhas-compras", true],
      ["Suporte", "/suporte", false]
    ]
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

test("app-shell usa a nova barra lateral e o menu da conta, sem lista propria nem botoes mortos", () => {
  assert.match(appShellSource, /import \{ MemberSidebar \} from "@\/components\/member\/shell\/member-sidebar";/);
  assert.match(appShellSource, /import \{ MemberAccountMenu \} from "@\/components\/member\/shell\/member-account-menu";/);
  assert.doesNotMatch(appShellSource, /const navigationItems = \[/);
  assert.doesNotMatch(appShellSource, /\bTrophy\b|\bBell\b/, "trofeu e sino sem funcao sairam do topo (fase 2)");
  assert.doesNotMatch(appShellSource, /cursor-default text-zinc-500/);
  // Navegacao do trilho, da gaveta e do menu da conta salva progresso e favoritos antes de trocar de pagina.
  assert.match(appShellSource, /onNavigate=\{\(event, href\) => handleProgressAwareNavigation\(event, href, true\)\}/);
  assert.match(appShellSource, /onNavigate=\{\(event, href\) => handleProgressAwareNavigation\(event, href\)\}/);
  assert.match(appShellSource, /onSignOut=\{\(\) => void handleSignOut\(\)\}/);
  // Botao do menu: anuncia a gaveta; o botao que abriu (trilho ou topo) recebe o foco de volta.
  assert.match(appShellSource, /aria-controls=\{sidebarId\}/);
  assert.match(appShellSource, /aria-expanded=\{sidebarOpen\}/);
  assert.match(appShellSource, /ref=\{menuButtonRef\}/);
  assert.match(appShellSource, /onClick=\{\(event\) => openSidebar\(event\.currentTarget\)\}/);
  assert.match(appShellSource, /onOpenMenu=\{\(\) => openSidebar\(railMenuButtonRef\.current\)\}/);
  assert.match(appShellSource, /returnFocusRef=\{sidebarTriggerRef\}/);
  // Bloco do produtor so para quem pode usar a visualizacao como aluno.
  assert.match(appShellSource, /producerPanel=\{showPreviewControl \? \(/);
  assert.match(sidebarSource, /\{producerPanel \? </);
});

test("gaveta acessivel: inert fechada, dialogo modal, Esc, foco preso e rolagem travada", () => {
  assert.match(sidebarSource, /inert=\{!open\}/);
  assert.match(sidebarSource, /role="dialog"/);
  assert.match(sidebarSource, /aria-modal="true"/);
  assert.match(sidebarSource, /aria-label="Menu"/);
  assert.match(sidebarSource, /event\.key === "Escape"/);
  assert.match(sidebarSource, /event\.key !== "Tab"/);
  assert.match(sidebarSource, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(sidebarSource, /querySelector<HTMLElement>\("\[data-member-sidebar-item\]"\)\?\.focus\(\)/);
  assert.match(sidebarSource, /body\.style\.overflow = "hidden"/);
  assert.match(sidebarSource, /w-\[min\(300px,86vw\)\]/);
  assert.match(sidebarSource, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(sidebarSource, /motion-reduce:transition-none/);
});

test("itens da gaveta: todos sao links, ativo neutro (fundo cinza, negrito), grupos so com linha", () => {
  assert.match(sidebarSource, /getMemberSidebarSections\(pathname, accessPreviewMode\)/);
  assert.match(sidebarSource, /aria-current=\{item\.active \? "page" : undefined\}/);
  assert.match(sidebarSource, /href=\{item\.href\}\s*onClick=\{\(event\) => onNavigate\(event, item\.href\)\}/);
  // Referencia do produtor (13/10/2026): ativo e um retangulo cinza com texto em negrito, sem barra nem
  // icone vermelho; inativo em peso regular; o nome do grupo so para leitor de tela, com uma linha entre grupos.
  assert.doesNotMatch(sidebarSource, /var\(--accent\)/, "sem vermelho na gaveta");
  assert.match(sidebarSource, /item\.active \? "bg-white\/\[0\.1\] font-bold text-white" : "font-normal text-zinc-300/);
  assert.match(sidebarSource, /h-12 items-center/);
  assert.match(sidebarSource, /<p className="sr-only" id=\{sectionTitleId\}>/);
  assert.match(sidebarSource, /sectionIndex > 0 \? <hr aria-hidden="true"/);
  assert.match(sidebarSource, /strokeWidth=\{1\.5\}/);
  // Nenhum item desativado (antes: 5 itens cinza sem destino).
  assert.equal(sidebarSource.match(/\sdisabled(?:=\{[^}]*\}|(?=[\s>]))/g), null);
  // Perfil e Sair ficam so no menu da conta do topo (pedido do produtor, 13/10/2026).
  assert.doesNotMatch(sidebarSource, /MemberAvatar|Ver perfil|onSignOut/);
  // Topo da gaveta: hamburguer que fecha e logo inteira.
  assert.match(sidebarSource, /aria-label="Fechar menu"[\s\S]*?<Menu aria-hidden="true"/);
  assert.match(sidebarSource, /src=\{logoImage\}/);
});

test("cada destino tem icone proprio; a bussola fica reservada para a IA Diretor", () => {
  for (const item of navigation.MEMBER_NAVIGATION_ITEMS) {
    assert.match(iconsSource, new RegExp(`\\b${item.key}: [A-Z][A-Za-z]+,?\\n`), `icone de ${item.label}`);
  }

  assert.match(iconsSource, /Record<MemberNavigationKey, LucideIcon>/);
  assert.doesNotMatch(iconsSource, /import \{[^}]*\bCompass\b[^}]*\} from "lucide-react"/);
});

test("menu da conta: fecha fora/Esc/Tab, setas percorrem e o Esc nao chega na IA Diretor", () => {
  assert.match(accountMenuSource, /getMemberAccountMenuLinks\(pathname, accessPreviewMode\)/);
  assert.match(accountMenuSource, /aria-expanded=\{open\}/);
  assert.match(accountMenuSource, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(accountMenuSource, /event\.key === "Escape" && open[\s\S]*?event\.stopPropagation\(\);\s*closeMenu\(true\);/);
  assert.match(accountMenuSource, /event\.key === "ArrowDown"/);
  assert.match(accountMenuSource, /event\.relatedTarget instanceof Node && event\.currentTarget\.contains\(event\.relatedTarget\)/);
  assert.match(accountMenuSource, /onNavigate\(event, link\.href\)/);
  assert.match(accountMenuSource, /onClick=\{onSignOut\}/);
  assert.match(accountMenuSource, /\{signingOut \? "Saindo\.\.\." : "Sair"\}/);
  // O topo tem overflow-hidden: o painel do menu e fixed para nao ser cortado.
  assert.match(accountMenuSource, /className="fixed right-4 top-\[60px\]/);
});

test("trilho de icones no computador: simbolo, hamburguer, sem empurrar o conteudo (pedido do produtor)", () => {
  const railSource = read("src/components/member/shell/member-rail.tsx");
  const notificationsSource = read("src/components/member/shell/member-notifications-menu.tsx");

  assert.match(railSource, /hidden w-\[80px\][^"]*md:flex/, "trilho fixo de 80 px so a partir de 768 px");
  assert.match(railSource, /fill=\{item\.active \? "currentColor" : "none"\}/, "ativo com icone preenchido");
  assert.match(railSource, /\/brand\/icon-bunker\.svg/, "recolhido mostra so o simbolo");
  assert.match(railSource, /getMemberSidebarSections\(pathname, accessPreviewMode\)/, "mesma fonte de rotas da gaveta");
  assert.match(railSource, /aria-current=\{item\.active \? "page" : undefined\}/);
  assert.match(railSource, /title=\{item\.label\}/);
  assert.match(railSource, /onClick=\{\(event\) => onNavigate\(event, item\.href\)\}/);
  assert.doesNotMatch(railSource, /\bSun\b|\bMoon\b/, "sempre escuro, sem troca de tema");

  // Posicao do menu (Marca > Estilo): com o menu no cabecalho nao ha trilho nem recuo de 80 px.
  assert.match(appShellSource, /<header className=\{cn\("fixed left-0 right-0 top-0 z-40 overflow-hidden", !menuInHeader && "md:left-\[80px\]"\)\}>/);
  assert.match(appShellSource, /<main className=\{cn\(!menuInHeader && "md:pl-\[80px\]"\)\}>/, "conteudo ao lado do trilho; a gaveta abre por cima");
  assert.match(appShellSource, /\{menuInHeader \? null : \(\s*<MemberRail/);
  // Menu no cabecalho: links escritos a partir de 1024 px (estilo Netflix) e hamburguer so abaixo disso.
  assert.match(appShellSource, /<nav aria-label="Navegação principal" className="ml-3 hidden min-w-0 items-center gap-1 lg:flex">/);
  assert.match(appShellSource, /menuInHeader \? "lg:hidden" : "md:hidden"/);
  assert.match(appShellSource, /style=\{memberStyleCssVars\(style\)\}/, "cantos e botoes entram como variaveis CSS no raiz");
  assert.match(appShellSource, /<MemberNotificationsMenu /, "lembretes no topo, ao lado da conta");
  assert.match(notificationsSource, /Nenhum lembrete por enquanto\./, "sem lembrete inventado");
});
