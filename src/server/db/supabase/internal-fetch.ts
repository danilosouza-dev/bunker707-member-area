// O servidor do app fala com o Supabase pela rede interna quando SUPABASE_INTERNAL_URL existe (o kit do produto
// licenciado, docs/32 §11.7; infra/compose/docker-compose.kit.yml).
//
// Sem ela, o servidor do app chama o Supabase pelo endereco publico (NEXT_PUBLIC_SUPABASE_URL), que passa pelo DNS e
// pelo certificado do Caddy: com um dos dois errado no servidor do comprador, o app ficava sem banco com o banco de pe,
// e o diagnostico via "banco fora". Com ela (http://api-gw:8000 no compose do kit), toda chamada do servidor ao Auth,
// ao PostgREST e ao Storage vai direto ao gateway, pela rede do compose.
//
// O cliente do Supabase continua configurado com o endereco publico, de proposito: o nome do cookie da sessao
// (sb-<primeiro rotulo do host>-auth-token, o mesmo do navegador), as URLs publicas do Storage e os links montados no
// servidor continuam os que o navegador conhece. So o transporte muda, pelo `global.fetch` do supabase-js, que o Auth,
// o PostgREST e o Storage usam.
//
// Vazia (a Vercel, a dev, os testes e a nossa producao hoje): nada muda. Sem NEXT_PUBLIC_, a variavel nunca chega ao
// navegador. Modulo puro, sem alias de caminho: o proxy e os testes tambem o carregam.

type Fetch = typeof fetch;

const cache = new Map<string, Fetch>();

function semEspacos(valor: string | null | undefined) {
  const limpo = (valor ?? "").replace(/\s+/g, "");
  return limpo.length > 0 ? limpo : undefined;
}

/** O endereco sem a barra do fim (`https://api.escola.com`), so http ou https, sem usuario, senha, busca ou ancora. */
function enderecoBase(valor: string, nome: string) {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`${nome} invalido: use http://host:porta ou https://host.`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new Error(`${nome} invalido: use http://host:porta ou https://host, sem usuario, senha ou parametros.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Um fetch que leva ao endereco interno os pedidos feitos ao endereco publico do Supabase e deixa o resto como esta.
 * Devolve undefined quando nao ha endereco interno (o cliente usa o fetch de sempre).
 */
export function createSupabaseInternalFetch(publicUrl: string, internalUrl: string | null | undefined, baseFetch?: Fetch): Fetch | undefined {
  const interno = semEspacos(internalUrl);
  if (!interno) return undefined;
  const de = enderecoBase(publicUrl, "NEXT_PUBLIC_SUPABASE_URL");
  const para = enderecoBase(interno, "SUPABASE_INTERNAL_URL");
  const buscar: Fetch = baseFetch ?? ((entrada, opcoes) => fetch(entrada, opcoes));

  return (entrada, opcoes) => {
    const endereco = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    // Fronteira exata do endereco: https://api.escola.com.outro.site nunca casa com https://api.escola.com.
    const casa = endereco === de || endereco.startsWith(`${de}/`) || endereco.startsWith(`${de}?`);
    if (!casa) return buscar(entrada, opcoes);
    const destino = `${para}${endereco.slice(de.length)}`;
    if (typeof entrada === "string" || entrada instanceof URL) return buscar(destino, opcoes);
    return buscar(new Request(destino, entrada), opcoes);
  };
}

/**
 * As opcoes `global` dos clientes do Supabase no servidor (o proxy, a sessao e o cliente administrativo): o fetch
 * interno quando SUPABASE_INTERNAL_URL esta no ambiente, nada quando nao esta. Nunca use no cliente do navegador.
 */
export function supabaseServerGlobalOptions(publicUrl: string): { fetch?: Fetch } {
  const interno = semEspacos(process.env.SUPABASE_INTERNAL_URL);
  if (!interno) return {};
  const chave = `${publicUrl}\n${interno}`;
  let buscar = cache.get(chave);
  if (!buscar) {
    buscar = createSupabaseInternalFetch(publicUrl, interno) as Fetch;
    cache.set(chave, buscar);
  }
  return { fetch: buscar };
}
