import { combineChunks, createChunks, createServerClient, stringFromBase64URL, stringToBase64URL } from "@supabase/ssr";
import { ESCOLA_DE_TESTE, SENHA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";
import { readLocalSupabaseConfig } from "../support/local-db.mjs";
import { expect, test } from "./fixtures";

// Desde 17/10/2026 (PR #91) o proxy nao consulta o Auth em /api/*: quem renova a sessao vencida nessas
// rotas e o proprio handler (getUser() do cliente do servidor) e quem devolve o cookie novo e o setAll
// de src/server/auth/supabase.ts. Este teste prova isso pelo HTTP do app buildado: a aluna com o token
// de acesso vencido continua logada, recebe o cookie renovado e o cookie novo vale na chamada seguinte.
// Faz um login proprio (outra sessao no Auth local) para nao girar o refresh token guardado pelo setup.

test.use({ storageState: { cookies: [], origins: [] } });

type Cookie = { name: string; value: string };
type Sessao = { access_token: string; expires_at: number; refresh_token: string };

const PREFIXO_BASE64 = "base64-";

/** Entra como a aluna pelo mesmo cliente do app e devolve a chave e a sessao gravadas no cookie. */
async function entrarComoAluna() {
  const { anonKey, url } = readLocalSupabaseConfig();
  let gravados: Cookie[] = [];
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => gravados,
      setAll: (lista) => {
        const porNome = new Map(gravados.map((cookie) => [cookie.name, cookie]));

        for (const { name, value } of lista) {
          if (value) {
            porNome.set(name, { name, value });
          } else {
            porNome.delete(name);
          }
        }

        gravados = [...porNome.values()];
      }
    }
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: ESCOLA_DE_TESTE.contas.aluna.email,
    password: SENHA_DE_TESTE
  });

  expect(error).toBeNull();

  const chave = gravados.map((cookie) => cookie.name.replace(/\.\d+$/, "")).find((nome) => nome.endsWith("-auth-token"));
  expect(chave, "o login precisa gravar o cookie sb-...-auth-token").toBeDefined();

  const sessao = await lerSessao(chave as string, gravados);
  expect(sessao).not.toBeNull();

  return { chave: chave as string, sessao: sessao as Sessao };
}

async function lerSessao(chave: string, cookies: Cookie[]): Promise<Sessao | null> {
  const bruto = await combineChunks(chave, (nome) => cookies.find((cookie) => cookie.name === nome)?.value ?? null);

  if (!bruto) {
    return null;
  }

  return JSON.parse(bruto.startsWith(PREFIXO_BASE64) ? stringFromBase64URL(bruto.slice(PREFIXO_BASE64.length)) : bruto);
}

function cookiesDaSessao(chave: string, sessao: Sessao): Cookie[] {
  return createChunks(chave, `${PREFIXO_BASE64}${stringToBase64URL(JSON.stringify(sessao))}`);
}

function cabecalhoCookie(cookies: Cookie[]) {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

/** Cookies com valor que a resposta grava (os pedacos apagados vem vazios ou com Max-Age=0). */
function cookiesGravados(setCookies: string[], chave: string): Cookie[] {
  return setCookies
    .filter((linha) => !/;\s*max-age=0(;|$)/i.test(linha))
    .map((linha) => {
      const [par] = linha.split(";");
      const igual = par.indexOf("=");

      return { name: par.slice(0, igual).trim(), value: decodeURIComponent(par.slice(igual + 1).trim()) };
    })
    .filter(({ name, value }) => value && (name === chave || name.startsWith(`${chave}.`)));
}

test("aluna com o token de acesso vencido continua logada em /api: o handler renova a sessao e o cookie novo vale na chamada seguinte", async ({ baseURL }) => {
  const { chave, sessao } = await entrarComoAluna();
  const agora = Math.floor(Date.now() / 1000);
  // Vencida para o cliente do Supabase: expires_at no passado obriga o getUser() a renovar pelo refresh token.
  const vencida = { ...sessao, expires_at: agora - 60 };
  const rota = new URL("/api/guide/conversations", baseURL);

  const primeira = await fetch(rota, { headers: { cookie: cabecalhoCookie(cookiesDaSessao(chave, vencida)) }, redirect: "manual" });

  expect(primeira.status, "a rota que exige sessao responde 200 mesmo com o token vencido").toBe(200);

  const renovados = cookiesGravados(primeira.headers.getSetCookie(), chave);
  expect(renovados.length, "a resposta precisa devolver o cookie de sessao renovado").toBeGreaterThan(0);

  const nova = await lerSessao(chave, renovados);
  expect(nova?.expires_at ?? 0).toBeGreaterThan(agora);
  expect(nova?.access_token).not.toBe(sessao.access_token);
  expect(nova?.refresh_token).not.toBe(sessao.refresh_token);

  // O navegador manda o cookie novo no pedido seguinte: a sessao continua valendo sem novo login.
  const segunda = await fetch(rota, { headers: { cookie: cabecalhoCookie(renovados) }, redirect: "manual" });

  expect(segunda.status).toBe(200);
  expect(await segunda.json()).toHaveProperty("data");
});
