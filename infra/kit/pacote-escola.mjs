// Os valores publicos do pacote de uma escola do lote fundador (docs/32 §11.5; docs/20 §9D.6), para o workflow
// .github/workflows/pacote-escola.yml. Fica do nosso lado: nao vai no pacote.
//
//   node infra/kit/pacote-escola.mjs --endereco alunos.escola.com.br [--endereco-api api.alunos.escola.com.br] \
//       --versao 1.0.0 [--raizes infra/licencas/raizes.json] [--saida "$GITHUB_OUTPUT"]
//
// A imagem do fundador e gerada para um endereco: o Next grava no codigo, na hora do build, o endereco da escola
// (NEXT_PUBLIC_SITE_URL), o da API (NEXT_PUBLIC_SUPABASE_URL, api.<endereco>) e a chave publicavel do Supabase
// (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY). Desses, so a chave publicavel precisa bater com o arquivo de segredos do
// servidor, e ela nao sai do segredo JWT da escola: e um texto opaco que o gateway (o Envoy) so compara com o
// SUPABASE_PUBLISHABLE_KEY do .env antes de trocar pela chave anon, assinada no servidor. Por isso ela e escolhida
// aqui, derivada do endereco (a mesma em toda versao da escola; publica por natureza, ja que vai no JavaScript do
// navegador), vai no manifesto do pacote e o instalador a grava no .env. O segredo JWT, a chave de servico e todas as
// senhas nascem no servidor da escola e nunca saem dele: nada aqui e segredo, e nada daqui pede o servidor antes.
//
// Saida: CHAVE=VALOR, um por linha (no arquivo de --saida, o GITHUB_OUTPUT, ou na tela): endereco, endereco_api,
// site_url, supabase_url, chave_publicavel, raizes (o JSON numa linha), emissor_url, versao, tag (a imagem do app) e
// artefato (o nome do artefato do GitHub). Para com uma linha em portugues e codigo 1 quando algo nao serve.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAIZ_DO_REPOSITORIO = fileURLToPath(new URL("../../", import.meta.url));
/** A API do Emissor gravada no produto vendido (docs/32 §11.2); trocar pede versao nova para todos. */
export const EMISSOR_URL = "https://licencas-api.bunker707.com.br";
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const VERSAO = /^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/;

function sair(mensagem) {
  process.stderr.write(`ERRO: ${mensagem}\n`);
  process.exit(1);
}

/** O endereco como o instalador o normaliza: sem https://, sem barra, minusculo. */
export function normalizarHost(texto) {
  return String(texto ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * A chave publicavel da escola, no formato das chaves opacas do Supabase self-hosted (o mesmo do
 * infra/compose/generate-secrets.mjs: o prefixo, 22 caracteres e um resumo de 8 sobre "supabase-self-hosted|"), com os 22
 * caracteres tirados do endereco: a mesma em toda versao da mesma escola. E publica (vai no navegador), entao derivar do
 * endereco nao entrega nada que a pagina da escola ja nao mostre.
 */
export function chavePublicavelDaEscola(endereco) {
  const meio = createHash("sha256").update(`bunker-members/chave-publicavel/v1|${endereco}`).digest("base64url").slice(0, 22);
  const intermediaria = `sb_publishable_${meio}`;
  const resumo = createHash("sha256").update(`supabase-self-hosted|${intermediaria}`).digest("base64url").slice(0, 8);
  return `${intermediaria}_${resumo}`;
}

/** As raizes publicas do arquivo da cerimonia (infra/licencas/raizes.json), de 1 a 4, numa linha de JSON. */
export function raizesDoArquivo(caminho) {
  if (!existsSync(caminho)) sair(`falta ${caminho}: rode a etapa cerimonia-licencas e grave, num commit, as raizes publicas que ela imprime (docs/20 §8C.8).`);
  let lista;
  try {
    lista = JSON.parse(readFileSync(caminho, "utf8"));
  } catch {
    sair(`${caminho} nao e JSON.`);
  }
  const ok = Array.isArray(lista) && lista.length >= 1 && lista.length <= 4 && new Set(lista.map((r) => r?.rid)).size === lista.length &&
    lista.every((r) => r && Object.keys(r).sort().join() === "publicKey,rid" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(r.rid) && /^[A-Za-z0-9_-]{43}$/.test(r.publicKey));
  if (!ok) sair(`${caminho} precisa ser a lista de 1 a 4 raizes publicas da cerimonia, so com rid e publicKey.`);
  return JSON.stringify(lista);
}

export function valoresDoPacote({ endereco, enderecoApi, versao, raizes = `${RAIZ_DO_REPOSITORIO}infra/licencas/raizes.json` }) {
  const escola = normalizarHost(endereco);
  if (!HOST.test(escola)) sair(`--endereco precisa ser o endereco da escola, como alunos.escola.com.br (veio ${endereco ?? "nada"}).`);
  const api = normalizarHost(enderecoApi || `api.${escola}`);
  if (!HOST.test(api) || api === escola) sair(`--endereco-api precisa ser outro nome, como api.${escola} (veio ${enderecoApi}).`);
  if (!VERSAO.test(versao ?? "")) sair(`--versao precisa ser como 1.0.0 (veio ${versao ?? "nada"}).`);
  return {
    endereco: escola,
    endereco_api: api,
    site_url: `https://${escola}`,
    supabase_url: `https://${api}`,
    chave_publicavel: chavePublicavelDaEscola(escola),
    raizes: raizesDoArquivo(raizes),
    emissor_url: EMISSOR_URL,
    versao,
    tag: `membros/app:${versao}`,
    artefato: `pacote-${escola}-${versao}`
  };
}

function principal(argv) {
  const opcoes = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const valor = () => (i + 1 < argv.length ? argv[++i] : sair(`${a} precisa de um valor.`));
    if (a === "--endereco") opcoes.endereco = valor();
    else if (a === "--endereco-api") opcoes.enderecoApi = valor();
    else if (a === "--versao") opcoes.versao = valor();
    else if (a === "--raizes") opcoes.raizes = valor();
    else if (a === "--saida") opcoes.saida = valor();
    else sair(`opcao desconhecida: ${a}`);
  }
  const valores = valoresDoPacote(opcoes);
  const texto = Object.entries(valores).map(([chave, valor]) => `${chave}=${valor}`).join("\n") + "\n";
  if (opcoes.saida) appendFileSync(opcoes.saida, texto);
  else process.stdout.write(texto);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal(process.argv.slice(2));
}
