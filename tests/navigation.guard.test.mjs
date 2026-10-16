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
