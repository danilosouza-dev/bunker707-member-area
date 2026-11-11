// Monta o Pacote da versao (docs/32 §11.4 e §11.6; docs/20 §9D), do nosso lado: no CI ou na maquina da equipe, nunca no
// servidor do comprador (nao vai no pacote).
//
//   node infra/kit/montar-pacote.mjs --versao 1.0.0 --app app.tar --saida pacote/ \
//       [--imagem terceiros.tar ...] [--instalacao alunos.escola.com.br [--instalacao-api api.alunos.escola.com.br]
//        --chave-publicavel sb_publishable_...] [--assinar chave-do-pacote.pem]
//
// - Copia do repositorio so o que o servidor usa (uma lista fechada, abaixo): o kit (infra/kit), o compose do kit com o
//   Caddy, o Envoy, os modelos de e-mail e os scripts de inicio do banco (infra/compose), os scripts reaproveitados
//   (infra/scripts) e as migracoes (supabase/migrations). Recusa src/, tests/, docs/, infra/cloud/, o Emissor, .env e
//   chave privada, mesmo que alguem os ponha na lista.
// - As imagens vem prontas de `docker save` (a do app e, se quiser, as de terceiros): copiadas para imagens/, com o
//   sha256 do arquivo, o id da imagem (o resumo da configuracao, que o `docker image inspect` mostra depois do
//   `docker load`) e as tags, lidos do manifest.json de dentro do arquivo. No lote fundador, a imagem e por Instalacao
//   (--instalacao e --instalacao-api, os dois enderecos gravados nela): o instalador recusa o pacote noutro endereco, e
//   grava no arquivo de segredos a chave publicavel que a imagem traz (--chave-publicavel, publica; o workflow
//   pacote-escola a deriva do endereco, infra/kit/pacote-escola.mjs).
// - Escreve MANIFESTO.json: formato 1, produto, versao, data, commit, instalacao, imagens, imagens de terceiros do compose
//   (presas pelo resumo) e o sha256, o tamanho e o modo de cada arquivo.
// - --assinar: assina o MANIFESTO.json com uma chave Ed25519 (PEM, cifrada com a senha em PACOTE_SENHA_DA_CHAVE) e grava
//   MANIFESTO.json.assinatura (base64 dos 64 bytes). O instalador confere com o openssl quando o kit.conf tem a chave
//   publica (KIT_CHAVE_DO_PACOTE). A cerimonia dessa chave e quem assina ainda estao em aberto (docs/32 §11.6).
//   --chave-publica imprime a chave publica no formato do kit.conf.
// Depois: `tar -czf pacote-1.0.0.tgz -C pacote .`; no servidor, abrir em /opt/<nome> e rodar o instalador de la.

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_DO_REPOSITORIO = fileURLToPath(new URL("../../", import.meta.url));
export const FORMATO = 1;
export const PRODUTO = "area-de-membros";

/** O que vai no pacote: pastas inteiras (so arquivos, sem subpastas, salvo dito) e arquivos soltos. */
export const LISTA_DO_PACOTE = [
  { pasta: "infra/kit", fora: ["fixar-imagens.mjs", "montar-pacote.mjs", "pacote-escola.mjs", "conferir-imagem.mjs"] },
  { arquivo: "infra/compose/docker-compose.kit.yml" },
  { arquivo: "infra/compose/.env.example" },
  { arquivo: "infra/compose/generate-secrets.mjs" },
  { arquivo: "infra/compose/caddy/Caddyfile.kit" },
  { arquivo: "infra/compose/caddy/cloudflare-trusted-proxies.caddyfile" },
  { pasta: "infra/compose/caddy/frente" },
  { pasta: "infra/compose/volumes/api/envoy" },
  { pasta: "infra/compose/volumes/auth-templates", so: /\.html$/ },
  // Os scripts de inicio do banco que o compose do kit monta (sem os do Realtime, do Logflare e do Supavisor).
  { arquivo: "infra/compose/volumes/db/webhooks.sql" },
  { arquivo: "infra/compose/volumes/db/roles.sql" },
  { arquivo: "infra/compose/volumes/db/jwt.sql" },
  { arquivo: "infra/compose/volumes/storage/.gitkeep" },
  { arquivo: "infra/scripts/lib.sh" },
  { arquivo: "infra/scripts/bootstrap.sh" },
  { arquivo: "infra/scripts/restore.sh" },
  { arquivo: "infra/scripts/smoke.sh" },
  { pasta: "supabase/migrations", so: /^\d+_.+\.sql$/ }
];

/** Nunca no pacote (docs/32 §11.6): o codigo-fonte, os testes, os documentos, a nossa infra, o Emissor e segredo. */
export function caminhoProibido(caminho) {
  return (
    /^(src|tests|docs|services|scripts|infra\/cloud|infra\/terraform|infra\/mautic|infra\/licencas|infra\/jitsi)\//.test(caminho) ||
    /(^|\/)\.env($|\.(?!example$))/.test(caminho) ||
    /\.(pem|key|p12|pfx)$/i.test(caminho) ||
    /(^|\/)(__pycache__|node_modules|\.git)(\/|$)/.test(caminho) ||
    /bunker-licensing/.test(caminho)
  );
}

function sair(mensagem) {
  process.stderr.write(`ERRO: ${mensagem}\n`);
  process.exit(1);
}

const sha256 = (dados) => createHash("sha256").update(dados).digest("hex");

/** Os arquivos da lista, relativos a raiz do repositorio, em ordem. */
export function arquivosDaLista(raiz = RAIZ_DO_REPOSITORIO) {
  const arquivos = [];
  for (const item of LISTA_DO_PACOTE) {
    if (item.arquivo) {
      if (!existsSync(join(raiz, item.arquivo))) sair(`falta ${item.arquivo} no repositorio.`);
      arquivos.push(item.arquivo);
      continue;
    }
    for (const nome of readdirSync(join(raiz, item.pasta)).sort()) {
      const caminho = `${item.pasta}/${nome}`;
      const estado = lstatSync(join(raiz, caminho));
      if (!estado.isFile() || (item.fora ?? []).includes(nome) || (item.so && !item.so.test(nome)) || nome.endsWith(".pyc")) continue;
      arquivos.push(caminho);
    }
  }
  for (const caminho of arquivos) {
    if (caminhoProibido(caminho)) sair(`${caminho} nao pode ir no pacote (codigo-fonte, testes, documentos, a nossa infra ou segredo).`);
  }
  return arquivos;
}

/** O id (sha256:...) e as tags de cada imagem de um arquivo do `docker save`, pelo manifest.json de dentro dele. */
export function imagensDoArquivo(arquivoTar) {
  const r = spawnSync("tar", ["-xOf", arquivoTar, "manifest.json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) sair(`${arquivoTar} nao e um arquivo do docker save (sem manifest.json): ${r.stderr.trim()}`);
  let lista;
  try {
    lista = JSON.parse(r.stdout);
  } catch {
    sair(`o manifest.json de ${arquivoTar} nao e JSON.`);
  }
  return lista.map((item) => {
    const hex = /([0-9a-f]{64})(?:\.json)?$/.exec(String(item.Config ?? ""))?.[1];
    if (!hex || !Array.isArray(item.RepoTags) || item.RepoTags.length === 0) sair(`${arquivoTar}: imagem sem id ou sem tag (rode o docker save com o nome:tag).`);
    return { id: `sha256:${hex}`, tags: item.RepoTags };
  });
}

/** As imagens de terceiros do compose do kit, presas pelo resumo (so para leitura; o compose ja as fixa). */
function imagensDeTerceiros(raiz) {
  const compose = readFileSync(join(raiz, "infra/compose/docker-compose.kit.yml"), "utf8");
  return [...compose.matchAll(/^\s+image:\s*(\S+@sha256:[0-9a-f]{64})\s*$/gm)].map((m) => m[1]);
}

/** A chave publica (Ed25519) no formato do kit.conf: o DER do SubjectPublicKeyInfo em base64, numa linha. */
export function chavePublicaDoKit(chavePrivadaOuPublica) {
  const publica = chavePrivadaOuPublica?.type === "public" ? chavePrivadaOuPublica : createPublicKey(chavePrivadaOuPublica);
  return publica.export({ type: "spki", format: "der" }).toString("base64");
}

export function montarPacote({ raiz = RAIZ_DO_REPOSITORIO, saida, versao, app, imagens = [], instalacao = null, instalacaoApi = null, chavePublicavel = null, chavePrivada = null, criadoEm = new Date(), commit = null, chavesSeguintes = [] }) {
  if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(versao ?? "")) sair("--versao precisa ser como 1.0.0.");
  if (!app) sair("--app precisa do arquivo da imagem do app (docker save).");
  if (instalacao && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(instalacao)) sair("--instalacao e o endereco da escola, como alunos.escola.com.br.");
  if (instalacaoApi && (!instalacao || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(instalacaoApi))) sair("--instalacao-api e o endereco da API da escola, como api.alunos.escola.com.br, junto com --instalacao.");
  if (chavePublicavel && (!instalacao || !/^sb_publishable_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{8}$/.test(chavePublicavel))) sair("--chave-publicavel e a chave publicavel gravada na imagem da escola (sb_publishable_...), junto com --instalacao.");
  if (existsSync(saida) && readdirSync(saida).length > 0) sair(`a pasta ${saida} nao esta vazia.`);
  mkdirSync(saida, { recursive: true });

  const arquivos = arquivosDaLista(raiz).map((caminho) => {
    const origem = join(raiz, caminho);
    const destino = join(saida, ...caminho.split("/"));
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(origem, destino);
    const modo = (statSync(origem).mode & 0o111) !== 0 ? 0o755 : 0o644;
    chmodSync(destino, modo);
    const dados = readFileSync(destino);
    return { caminho, bytes: dados.length, sha256: sha256(dados), modo: modo.toString(8) };
  });

  mkdirSync(join(saida, "imagens"), { recursive: true });
  const listaDeImagens = [];
  for (const [papel, arquivoTar] of [["app", app], ...imagens.map((i) => ["terceiros", i])]) {
    const dentro = imagensDoArquivo(arquivoTar);
    if (papel === "app" && dentro.length !== 1) sair("o arquivo da imagem do app precisa ter uma imagem so.");
    const nome = papel === "app" ? "app.tar" : `terceiros-${listaDeImagens.length}.tar`;
    const destino = join(saida, "imagens", nome);
    copyFileSync(arquivoTar, destino);
    chmodSync(destino, 0o644);
    const dados = readFileSync(destino);
    for (const imagem of dentro) {
      listaDeImagens.push({ papel, arquivo: `imagens/${nome}`, bytes: dados.length, sha256: sha256(dados), id: imagem.id, tags: imagem.tags });
    }
  }

  const manifesto = {
    formato: FORMATO,
    produto: PRODUTO,
    versao,
    criado_em: criadoEm.toISOString().replace(/\.\d{3}Z$/, "Z"),
    commit,
    instalacao,
    instalacao_api: instalacaoApi,
    chave_publicavel: chavePublicavel,
    imagens: listaDeImagens,
    imagens_de_terceiros: imagensDeTerceiros(raiz),
    chaves_seguintes: chavesSeguintes,
    arquivos
  };
  const texto = `${JSON.stringify(manifesto, null, 2)}\n`;
  writeFileSync(join(saida, "MANIFESTO.json"), texto, { mode: 0o644 });
  if (chavePrivada) {
    const assinatura = sign(null, Buffer.from(texto), chavePrivada).toString("base64");
    writeFileSync(join(saida, "MANIFESTO.json.assinatura"), `${assinatura}\n`, { mode: 0o644 });
  }
  return manifesto;
}

function principal(argv) {
  const opcoes = { imagens: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const valor = () => {
      if (i + 1 >= argv.length) sair(`${a} precisa de um valor.`);
      return argv[++i];
    };
    if (a === "--versao") opcoes.versao = valor();
    else if (a === "--app") opcoes.app = valor();
    else if (a === "--imagem") opcoes.imagens.push(valor());
    else if (a === "--saida") opcoes.saida = valor();
    else if (a === "--instalacao") opcoes.instalacao = valor();
    else if (a === "--instalacao-api") opcoes.instalacaoApi = valor();
    else if (a === "--chave-publicavel") opcoes.chavePublicavel = valor();
    else if (a === "--assinar") opcoes.assinar = valor();
    else if (a === "--chave-publica") opcoes.chavePublica = valor();
    else if (a === "--commit") opcoes.commit = valor();
    else if (a === "-h" || a === "--help") {
      process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 28).join("\n") + "\n");
      process.exit(0);
    } else sair(`opcao desconhecida: ${a}`);
  }
  const senha = process.env.PACOTE_SENHA_DA_CHAVE || undefined;
  if (opcoes.chavePublica) {
    process.stdout.write(`${chavePublicaDoKit(createPrivateKey({ key: readFileSync(opcoes.chavePublica), passphrase: senha }))}\n`);
    return;
  }
  if (!opcoes.saida) sair("--saida precisa da pasta do pacote.");
  const chavePrivada = opcoes.assinar ? createPrivateKey({ key: readFileSync(opcoes.assinar), passphrase: senha }) : null;
  if (chavePrivada && chavePrivada.asymmetricKeyType !== "ed25519") sair("a chave do pacote precisa ser Ed25519.");
  const commit = opcoes.commit ?? (spawnSync("git", ["-C", RAIZ_DO_REPOSITORIO, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim() || null);
  const manifesto = montarPacote({ ...opcoes, chavePrivada, commit });
  const relativa = relative(process.cwd(), opcoes.saida) || ".";
  process.stdout.write(
    `Pacote ${manifesto.versao} em ${relativa}${sep}: ${manifesto.arquivos.length} arquivos e ${manifesto.imagens.length} imagem(ns)` +
      `${chavePrivada ? ", manifesto assinado" : ", sem assinatura"}.\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal(process.argv.slice(2));
}
