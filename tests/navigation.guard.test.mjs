import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Guardas da navegacao da area do aluno (regras de arquitetura; docs/18 §1.2): toda navegacao
// programatica passa pelo roteador com feedback (salva progresso e favoritos antes de sair e mostra o
// estado "Abrindo..."), e o layout raiz monta esse feedback uma vez so, com um estado de carregamento
// acessivel. O comportamento da navegacao em si esta nos fluxos de ponta a ponta.

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("guarda: telas do aluno e de entrar navegam pelo roteador com feedback, nunca pelo useRouter cru do Next", async () => {
  const files = [
    "../src/components/app-shell.tsx",
    "../src/components/content-card.tsx",
    "../src/components/content-row.tsx",
    "../src/components/content-details-modal.tsx",
    "../src/components/lesson-experience.tsx",
    "../src/components/login-experience.tsx",
    "../src/components/password-change-experience.tsx"
  ];

  for (const file of files) {
    const text = await source(file);
    assert.match(text, /useNavigationFeedbackRouter/, `${file} sem o roteador com feedback`);
    assert.doesNotMatch(text, /import \{ useRouter \} from "next\/navigation"/, `${file} usa o useRouter cru`);
  }
});

test("guarda: o layout raiz monta o feedback de navegacao uma vez e o carregamento de rota e anunciado ao leitor de tela", async () => {
  const layout = await source("../src/app/layout.tsx");
  const loading = await source("../src/app/loading.tsx");

  assert.match(layout, /<NavigationFeedbackProvider>\{children\}<\/NavigationFeedbackProvider>/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-live="polite"/);
  assert.match(loading, /data-route-loading/);
});

test("guarda: entrar no admin vindo do login, da troca de senha ou da area do aluno recarrega a pagina", async () => {
  // O navegador aplica a Permissions-Policy do documento carregado: quando ela liberava o microfone so em /admin,
  // numa troca de rota "Gravar agora" dos avisos ficava bloqueado (docs/22 §4.5). Desde 30/10/2026 a politica e a
  // mesma em todo o app (next.config.ts, docs/30 I10); o carregamento inteiro continua.
  const login = await source("../src/components/login-experience.tsx");
  const passwordChange = await source("../src/components/password-change-experience.tsx");
  const appShell = await source("../src/components/app-shell.tsx");
  const support = await source("../src/components/member/pages/support-view.tsx");

  assert.match(login, /if \(isAdminPath\(path\)\) \{\s*window\.location\.replace\(path\);/);
  assert.equal(login.match(/leaveLogin\(router, await getPostLoginRedirectPath\(/g)?.length, 3, "sessao ja aberta, mudanca de sessao e e-mail e senha");
  assert.doesNotMatch(login, /router\.replace\(await getPostLoginRedirectPath/);
  assert.match(passwordChange, /if \(isAdminPath\(destination\)\) \{\s*window\.location\.replace\(destination\);/);

  const navigation = appShell.match(/function handleProgressAwareNavigation[\s\S]*?\n  \}/u)?.[0] ?? "";
  assert.match(
    navigation,
    /await flushPendingSavedItemChanges\(\);[\s\S]*if \(isAdminPath\(href\)\) \{\s*window\.location\.assign\(href\);\s*return;\s*\}\s*router\.push\(href\);/,
    "salva progresso e favoritos antes de carregar o admin"
  );
  assert.match(support, /<a className=\{memberButtonClassName\(\{ size: "sm" \}\)\} href="\/admin\/area-de-membros\/login">/);
});
