import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Guardas do Modo TV (regras de seguranca e de produto que se leem no codigo; docs/18 §1.2). O
// comportamento das rotas esta em tests/integration/modo-tv.test.mjs e o fluxo de conectar a TV em
// tests/e2e/aluno-assiste-na-tv.spec.ts.

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await source("../supabase/migrations/202607150003_lesson_tv_mode.sql");
const tvSessions = await source("../src/server/video/tv-sessions.ts");
const receiver = await source("../src/components/tv-receiver-experience.tsx");
const control = await source("../src/components/lesson-tv-control.tsx");
const tvPage = await source("../src/app/tv/page.tsx");

test("guarda: codigo de conexao e token da TV ficam so no servidor (tabela fechada para o navegador, token so como hash)", () => {
  assert.match(migration, /alter table public\.tv_sessions enable row level security/);
  assert.match(migration, /revoke all on public\.tv_sessions from anon, authenticated/);
  assert.doesNotMatch(migration, /create policy[^;]+tv_sessions/i, "nenhuma policy abre tv_sessions para o navegador");
  assert.doesNotMatch(migration, /^\s*receiver_token\s+text/m, "o token da TV nao e guardado em texto, so o hash");
  assert.match(migration, /grant execute on function public\.connect_tv_session\(text, text\) to service_role/);
  assert.match(tvSessions, /^import "server-only";/m, "o modulo das sessoes de TV so roda no servidor");
});

test("guarda: as mensagens que o aluno ve no Modo TV nao citam o provedor do video", () => {
  for (const [name, text] of [["tv-sessions.ts", tvSessions], ["tv-receiver-experience.tsx", receiver], ["lesson-tv-control.tsx", control]]) {
    assert.doesNotMatch(text, /(?:TvSessionError|setError|setSyncError|new Error)\(\s*"[^"]*YouTube/i, `${name}: mensagem com o nome do provedor`);
  }

  assert.doesNotMatch(control, /youtu\.be|youtube\.com|youtube-nocookie/, "o controle remoto nao tem link para o provedor");
});

test("guarda: a pagina publica /tv nao entra em buscadores", () => {
  assert.match(tvPage, /robots: \{ follow: false, index: false \}/);
});
