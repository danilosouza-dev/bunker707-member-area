import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directorSource = await readFile(
  new URL("../src/components/platform-director-chat.tsx", import.meta.url),
  "utf8"
);
const appShellSource = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const directorPartsSource = await readFile(
  new URL("../src/components/member/shell/director-parts.tsx", import.meta.url),
  "utf8"
);

test("the authenticated member shell mounts the IA Diretor outside lesson-specific UI", () => {
  assert.doesNotMatch(appShellSource, /import \{ PlatformDirectorChat \} from "@\/components\/platform-director-chat"/);
  assert.match(appShellSource, /const PlatformDirectorChat = dynamic\(\s*\(\) => import\("@\/components\/platform-director-chat"\)/);
  assert.match(appShellSource, /ssr: false/);
  assert.match(appShellSource, /<main className=\{cn\(!menuInHeader && "md:pl-\[80px\]"\)\}>\{children\}<\/main>[\s\S]*?<PlatformDirectorChat/);
  assert.match(appShellSource, /onNavigate=\{handleDirectorNavigation\}/);
  assert.match(appShellSource, /!sidebarOpen \? \(\s*directorRequested \? \(\s*<PlatformDirectorChat defaultOpen=\{directorOpenOnMount\}/);
  assert.match(appShellSource, /<PlatformDirectorLauncher onActivate=\{activateDirectorChat\}/);
  assert.match(appShellSource, /handleProgressAwareNavigation\(event, withAccessPreviewParam\(href, accessPreviewMode\)\)/);
});

test("IA Diretor has its own persistent multi-chat API flow", () => {
  assert.match(directorSource, /fetch\("\/api\/guide\/conversations"/);
  assert.match(directorSource, /`\/api\/guide\/conversations\/\$\{encodeURIComponent\(conversationId\)\}`/);
  assert.match(directorSource, /`\/api\/guide\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/messages`/);
  assert.match(directorSource, /method: "PATCH"/);
  assert.match(directorSource, /method: "DELETE"/);
  assert.match(directorSource, /Novo chat|Criar novo chat com a IA Diretor/);
  assert.match(directorSource, /Renomear chat/);
  assert.match(directorSource, /Excluir chat/);
  assert.match(directorSource, /Suas conversas com a IA Diretor ficam salvas no seu histórico\./);
  assert.doesNotMatch(directorSource, /\/api\/tutor\//);
});

test("IA Diretor renders safe Markdown and only authorized member references as navigation", () => {
  assert.match(directorSource, /from "react-markdown"/);
  assert.match(directorSource, /from "remark-gfm"/);
  assert.match(directorSource, /remarkPlugins=\{\[remarkGfm\]\} skipHtml/);
  assert.match(directorSource, /function isAuthorizedMemberHref/);
  assert.match(directorSource, /pathname\.startsWith\("\/conteudo\/"\)/);
  assert.match(directorSource, /\(message\.references \?\? \[\]\)\.filter/);
  assert.match(directorSource, /handleReferenceNavigation\(event, reference\.href\)/);
  assert.match(directorSource, /onNavigate\(event, href\)/);
  assert.match(directorSource, /<span className="font-medium text-zinc-100 underline/);
  assert.doesNotMatch(directorSource, /<a[^>]+href=\{href\}/);
});

test("IA Diretor uses a distinct accessible floating and mobile-fullscreen experience", () => {
  // A marca (bussola + estrela) mora em director-parts e e a mesma no lancador estatico e no painel.
  assert.match(directorPartsSource, /<Compass className="h-full w-full"/);
  assert.match(directorPartsSource, /<Sparkles className="absolute -right-1 -top-1/);
  assert.match(directorSource, /import \{[^}]*\bDirectorIcon\b[^}]*\} from "@\/components\/member\/shell\/director-parts"/);
  assert.match(appShellSource, /<DirectorIcon className="size-6" \/>/);
  assert.match(directorSource, /aria-label=\{open \? "Fechar IA Diretor" : "Abrir IA Diretor"\}/);
  assert.match(directorSource, /aria-controls=\{panelId\}/);
  assert.match(directorSource, /aria-expanded=\{open\}/);
  assert.match(directorSource, /role="dialog"/);
  assert.match(directorSource, /aria-modal=\{mobile\}/);
  assert.match(directorSource, /max-sm:inset-0 max-sm:h-dvh max-sm:w-screen max-sm:rounded-none/);
  assert.match(directorSource, /overflow-x-hidden overflow-y-auto/);
  assert.match(directorSource, /flex min-w-0 max-w-full items-start gap-3/);
  assert.match(directorSource, /event\.key === "Escape"/);
  assert.match(directorSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(directorSource, /Orientação sobre seus cursos e trilhas/);
  assert.match(directorSource, /Encontre aulas, descubra o que estudar e organize seu próximo passo\./);
  assert.doesNotMatch(directorSource, /Tutor IA desta aula|transcri[cç][aã]o/i);
});

test("IA Diretor v2: saudação pelo nome, histórico agrupado e campo que cresce", () => {
  // O AppShell passa o primeiro nome; a saudação sai da regra pura (member-shell-model).
  assert.match(appShellSource, /<PlatformDirectorChat defaultOpen=\{directorOpenOnMount\} onNavigate=\{handleDirectorNavigation\} studentName=\{student\.name\} \/>/);
  assert.match(directorSource, /getDirectorGreeting\(studentName\)/);
  assert.match(directorSource, /Sugestões para começar/);

  // Painel flutuante de 420 px com raio de 16 px no computador; tela cheia com áreas seguras no celular.
  assert.match(directorSource, /w-\[min\(420px,calc\(100vw-3rem\)\)\]/);
  assert.match(directorSource, /rounded-2xl border border-white\/10 bg-\[var\(--panel\)\]/);
  assert.match(directorSource, /max-sm:pt-\[calc\(0\.75rem\+env\(safe-area-inset-top\)\)\]/);
  assert.match(directorSource, /pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(directorSource, /motion-reduce:animate-none/);

  // Histórico no próprio painel, agrupado por dia (São Paulo) e com data relativa.
  assert.match(directorSource, /groupDirectorConversations\(conversations, historyNow\)/);
  assert.match(directorSource, /describeDirectorConversation\(conversation, historyNow\)/);
  assert.match(directorSource, /setHistoryNow\(Date\.now\(\)\)/);
  assert.doesNotMatch(directorSource, /formatConversationDate|toLocaleDateString/);

  // Campo em pílula: cresce até ~6 linhas, Enter envia (sem cortar acentuação/IME), contador perto do limite.
  assert.match(directorSource, /input\.style\.height = `\$\{Math\.min\(input\.scrollHeight, composerMaxHeight\)\}px`/);
  assert.match(directorSource, /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/);
  assert.match(directorSource, /maxLength=\{DIRECTOR_MESSAGE_LIMIT\}/);
  assert.match(directorSource, /getDirectorCounterLabel\(question\.length\)/);

  // Indisponível: o motivo aparece no lugar das sugestões (não escondido abaixo delas).
  assert.match(directorSource, /availability\.available \? \([\s\S]*?Sugestões para começar[\s\S]*?\) : \([\s\S]*?availability\.reason \?\? "A IA Diretor não está disponível agora\."/);

  // Dicas dos botões são próprias; nada de title nativo.
  assert.doesNotMatch(directorSource, /\stitle=\{/);
  assert.doesNotMatch(directorPartsSource, /\stitle=\{/);
});

test("IA Diretor: trocar ou criar chat não recarrega a lista nem apaga a mensagem otimista", () => {
  const loadGuide = directorSource.match(/const loadGuide = React\.useCallback\([\s\S]*?\n  \}, \[([^\]]*)\]\);/u);

  assert.ok(loadGuide, "loadGuide precisa existir");
  assert.equal(loadGuide[1].trim(), "loadConversation");
  assert.match(loadGuide[0], /activeConversationIdRef\.current/);
  assert.match(directorSource, /activeConversationIdRef\.current = activeConversationId;/);
});
