// Roteiro do k6 para infra/cloud/carga.sh: cada aluno virtual entra com a sessao do aluno de teste e navega
// home -> curso -> aula -> minhas compras, com pausa curta entre as paginas. Pedidos pelo dominio publico
// (Cloudflare), como o navegador; so o HTML das paginas (estaticos e video ficam na Cloudflare e na Bunny).
import { check, sleep } from "k6";
import encoding from "k6/encoding";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL;
const API = __ENV.API_URL;
const SENHA = open(__ENV.SENHA_ARQUIVO).trim();
const VUS = Number(__ENV.VUS || 100);
const PAUSA_MIN = Number(__ENV.PAUSA_MIN || 1);
const PAUSA_MAX = Number(__ENV.PAUSA_MAX || 4);
// Cookie de sessao do @supabase/ssr: sb-<primeiro rotulo do host da API>-auth-token, "base64-" + JSON da
// sessao em base64url, em pedacos de 3180 caracteres (.0, .1, ...) quando nao cabe num so.
// (o k6 nao tem URL global: o host sai por expressao regular.)
const COOKIE = `sb-${API.replace(/^https?:\/\//, "").split(/[.:/]/)[0]}-auth-token`;
const PEDACO = 3180;

const paginas = {
  aula: "/conteudo/carga-curso/aulas/carga-modulo-1?lessonId=carga-aula-2",
  compras: "/minhas-compras",
  curso: "/conteudo/carga-curso",
  home: "/"
};
const tempos = Object.fromEntries(Object.keys(paginas).map((nome) => [nome, new Trend(`pagina_${nome}`, true)]));
const semSessao = new Counter("sem_sessao");

export const options = {
  scenarios: {
    alunos: {
      executor: "ramping-vus",
      gracefulRampDown: "30s",
      stages: [
        { duration: __ENV.RAMPA || "1m", target: VUS },
        { duration: __ENV.DURACAO || "3m", target: VUS },
        { duration: __ENV.DESCIDA || "30s", target: 0 }
      ],
      startVUs: 0
    }
  },
  summaryTrendStats: ["med", "p(90)", "p(95)", "max"],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    pagina_aula: ["p(95)<2000"],
    pagina_compras: ["p(95)<2000"],
    pagina_curso: ["p(95)<2000"],
    pagina_home: ["p(95)<2000"],
    sem_sessao: ["count==0"]
  },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 bunker707-carga"
};

// Um login so (o Auth limita logins por IP); todos os alunos virtuais usam a mesma sessao.
export function setup() {
  const resposta = http.post(`${API}/auth/v1/token?grant_type=password`, JSON.stringify({ email: __ENV.EMAIL, password: SENHA }), {
    headers: { "Content-Type": "application/json", apikey: __ENV.PUBLISHABLE_KEY }
  });
  if (resposta.status !== 200) throw new Error(`login do aluno de teste falhou: HTTP ${resposta.status}`);
  const valor = `base64-${encoding.b64encode(JSON.stringify(resposta.json()), "rawurl")}`;
  const cookies = {};
  if (valor.length <= PEDACO) cookies[COOKIE] = valor;
  else for (let i = 0; i * PEDACO < valor.length; i += 1) cookies[`${COOKIE}.${i}`] = valor.slice(i * PEDACO, (i + 1) * PEDACO);
  return { cookies };
}

export default function (dados) {
  // O k6 zera os cookies de cada aluno virtual a cada iteracao: a sessao entra de novo em toda volta.
  const jar = http.cookieJar();
  for (const [nome, valor] of Object.entries(dados.cookies)) jar.set(BASE, nome, valor, { path: "/", secure: BASE.startsWith("https://") });
  for (const [nome, caminho] of Object.entries(paginas)) {
    const resposta = http.get(`${BASE}${caminho}`, { tags: { pagina: nome } });
    tempos[nome].add(resposta.timings.duration);
    const logado = !resposta.url.includes("/login");
    if (!logado) semSessao.add(1);
    check(resposta, { [`${nome}: 200 com sessao`]: (r) => r.status === 200 && logado });
    sleep(PAUSA_MIN + Math.random() * (PAUSA_MAX - PAUSA_MIN));
  }
}
