// As guardas da imagem do pacote de uma escola (docs/32 §11.5; docs/20 §9D.6), no workflow pacote-escola.yml, sobre a
// pasta /app tirada da imagem (docker create + docker cp). Fica do nosso lado: nao vai no pacote.
//
//   node infra/kit/conferir-imagem.mjs --pasta app/ --raizes '<json>' --emissor https://licencas-api... \
//       --site https://alunos.escola.com.br --api https://api.alunos.escola.com.br --chave sb_publishable_... \
//       [--proibido <valor> ...]
//
// Para (codigo 1) quando:
//   - a licenca nao saiu gravada no codigo do servidor: sobrou leitura de process.env.BUNKER_LICENSING_*, ou falta uma
//     raiz ou o endereco do Emissor (o build com BUNKER_LICENSING_MODE=enforce grava os tres);
//   - o endereco da escola nao saiu gravado no servidor, ou o da API e a chave publicavel no codigo do navegador;
//   - aparece uma chave nossa de analise de uso ou de erros: um --proibido (as variaveis do repositorio que a nossa
//     producao usa), uma chave do PostHog (phc_...) ou um DSN do Sentry;
//   - a imagem leva a pasta src/ ou um mapa de fonte com o codigo original (sourcesContent).
// E mostra, sem parar, o que ainda cita bunker707.com.br (fora o endereco do Emissor e os da propria escola, esperados): a
// marca branca ainda nao chegou a todo lugar (docs/32 §6 e §11.5).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

function sair(mensagem) {
  process.stderr.write(`ERRO: ${mensagem}\n`);
  process.exit(1);
}

function* arquivos(pasta) {
  if (!existsSync(pasta)) return;
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    const estado = statSync(caminho);
    if (estado.isDirectory()) yield* arquivos(caminho);
    else if (estado.isFile()) yield caminho;
  }
}

const TEXTO = /\.(js|mjs|cjs|json|html|rsc|txt|map|css|body|meta)$/;

/** Le os textos de uma parte da imagem: [caminho relativo, conteudo]. */
function textos(raiz, partes) {
  const lista = [];
  for (const parte of partes) {
    const alvo = join(raiz, parte);
    const caminhos = existsSync(alvo) && statSync(alvo).isFile() ? [alvo] : [...arquivos(alvo)];
    for (const caminho of caminhos) {
      if (TEXTO.test(caminho)) lista.push([relative(raiz, caminho).split(sep).join("/"), readFileSync(caminho, "utf8")]);
    }
  }
  return lista;
}

export function conferirImagem({ pasta, raizes, emissor, site, api, chave, proibidos = [] }) {
  const problemas = [];
  const avisos = [];
  if (!existsSync(join(pasta, "server.js")) || !existsSync(join(pasta, ".next", "server"))) {
    return { problemas: [`${pasta} nao e a pasta /app de uma imagem do app (sem server.js ou .next/server).`], avisos };
  }
  if (existsSync(join(pasta, "src"))) problemas.push("a imagem leva a pasta src/ (o codigo-fonte nunca vai ao comprador).");

  const servidor = textos(pasta, [".next/server", "server.js"]);
  const navegador = textos(pasta, [".next/static"]);
  const tudo = [...servidor, ...navegador, ...textos(pasta, ["public"])];
  const em = (lista, valor) => lista.some(([, conteudo]) => conteudo.includes(valor));

  // A licenca gravada no codigo do servidor (next.config.ts, chave env).
  const lendo = servidor.filter(([, conteudo]) => conteudo.includes("process.env.BUNKER_LICENSING_")).map(([caminho]) => caminho);
  if (lendo.length) problemas.push(`a licenca nao saiu gravada: o codigo do servidor ainda le process.env.BUNKER_LICENSING_* (${lendo.slice(0, 3).join(", ")}).`);
  for (const raiz of raizes) {
    if (!em(servidor, raiz.publicKey)) problemas.push(`a raiz ${raiz.rid} nao esta gravada no codigo do servidor (o build saiu sem BUNKER_LICENSING_ROOTS?).`);
  }
  if (!em(servidor, emissor)) problemas.push(`o endereco do Emissor (${emissor}) nao esta gravado no codigo do servidor.`);

  // Os valores publicos da escola.
  if (!em(servidor, site)) problemas.push(`o endereco da escola (${site}) nao esta gravado no codigo do servidor (NEXT_PUBLIC_SITE_URL).`);
  if (!em(navegador, api)) problemas.push(`o endereco da API (${api}) nao esta no codigo do navegador (NEXT_PUBLIC_SUPABASE_URL).`);
  if (!em(navegador, chave)) problemas.push("a chave publicavel da escola nao esta no codigo do navegador (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).");

  // Nenhuma chave nossa de analise de uso ou de erros (D19).
  for (const valor of proibidos.filter((v) => v && v.trim().length >= 8)) {
    const onde = tudo.filter(([, conteudo]) => conteudo.includes(valor.trim())).map(([caminho]) => caminho);
    if (onde.length) problemas.push(`uma chave nossa de analise ou de erros esta na imagem (${onde.slice(0, 3).join(", ")}).`);
  }
  for (const [nome, padrao] of [["uma chave do PostHog (phc_...)", /\bphc_[A-Za-z0-9]{20,}/], ["um DSN do Sentry", /https:\/\/[0-9a-f]{16,}@[^\s"'`/]*sentry\.io\/\d+/]]) {
    const onde = tudo.filter(([, conteudo]) => padrao.test(conteudo)).map(([caminho]) => caminho);
    if (onde.length) problemas.push(`${nome} na imagem (${onde.slice(0, 3).join(", ")}).`);
  }

  // Mapas de fonte so sem o codigo original.
  const mapas = tudo.filter(([caminho, conteudo]) => caminho.endsWith(".map") && conteudo.includes('"sourcesContent"')).map(([caminho]) => caminho);
  if (mapas.length) problemas.push(`mapa de fonte com o codigo original (${mapas.slice(0, 3).join(", ")}).`);

  // O que ainda cita o nosso dominio, fora o Emissor e os enderecos da propria escola (esperados; a escola do ensaio fica
  // na nossa zona).
  const host = new URL(emissor).host;
  const esperados = [host, new URL(site).host, new URL(api).host].sort((a, b) => b.length - a.length);
  const citam = tudo
    .map(([caminho, conteudo]) => [caminho, (esperados.reduce((t, h) => t.replaceAll(h, ""), conteudo).match(/bunker707\.com\.br/g) ?? []).length])
    .filter(([, n]) => n > 0);
  if (citam.length) {
    avisos.push(`ainda citam bunker707.com.br (fora o Emissor, ${host}, e a propria escola): ${citam.length} arquivo(s): ${citam.slice(0, 8).map(([c, n]) => `${c} (${n})`).join(", ")}${citam.length > 8 ? ", ..." : ""}.`);
  }
  return { problemas, avisos };
}

function principal(argv) {
  const opcoes = { proibidos: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const valor = () => (i + 1 < argv.length ? argv[++i] : sair(`${a} precisa de um valor.`));
    if (a === "--pasta") opcoes.pasta = valor();
    else if (a === "--raizes") opcoes.raizes = valor();
    else if (a === "--emissor") opcoes.emissor = valor();
    else if (a === "--site") opcoes.site = valor();
    else if (a === "--api") opcoes.api = valor();
    else if (a === "--chave") opcoes.chave = valor();
    else if (a === "--proibido") opcoes.proibidos.push(valor());
    else sair(`opcao desconhecida: ${a}`);
  }
  for (const nome of ["pasta", "raizes", "emissor", "site", "api", "chave"]) if (!opcoes[nome]) sair(`falta --${nome}.`);
  let raizes;
  try {
    raizes = JSON.parse(opcoes.raizes);
  } catch {
    sair("--raizes nao e JSON.");
  }
  const { problemas, avisos } = conferirImagem({ ...opcoes, raizes });
  for (const aviso of avisos) process.stdout.write(`AVISO: ${aviso}\n`);
  if (problemas.length) sair(`a imagem nao serve para a escola:\n  - ${problemas.join("\n  - ")}`);
  process.stdout.write(`Imagem conferida: licenca gravada (enforce, ${raizes.length} raizes, ${opcoes.emissor}), o endereco, a API e a chave publicavel da escola, sem chave nossa de analise ou de erros, sem src/ e sem mapa com o codigo.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal(process.argv.slice(2));
}
