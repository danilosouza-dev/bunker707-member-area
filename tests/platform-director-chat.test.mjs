import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directorSource = await readFile(
  new URL("../src/components/platform-director-chat.tsx", import.meta.url),
  "utf8"
);
const appShellSource = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");

test("the authenticated member shell mounts the IA Diretor outside lesson-specific UI", () => {
  assert.match(appShellSource, /import \{ PlatformDirectorChat \} from "@\/components\/platform-director-chat"/);
  assert.match(appShellSource, /<main>\{children\}<\/main>[\s\S]*?<PlatformDirectorChat/);
  assert.match(appShellSource, /onNavigate=\{handleDirectorNavigation\}/);
  assert.match(appShellSource, /!sidebarOpen \? <PlatformDirectorChat/);
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
  assert.match(directorSource, /<Compass className="h-full w-full"/);
  assert.match(directorSource, /<Sparkles className="absolute -right-1 -top-1/);
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
