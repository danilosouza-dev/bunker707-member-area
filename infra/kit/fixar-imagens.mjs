#!/usr/bin/env node
// Fixa as imagens de terceiros do compose do kit pelo resumo (docs/32 §11.6; docs/20 §9C).
//
// O compose do kit (infra/compose/docker-compose.kit.yml) usa as mesmas versoes da nossa producao
// (infra/compose/docker-compose.yml), que recebe toda versao primeiro, mas presas pelo resumo (tag@sha256): todo
// comprador baixa exatamente a mesma imagem, mesmo que alguem publique outra coisa com a mesma etiqueta depois.
// Este script le a etiqueta de cada servico na producao, pergunta ao registry o resumo do indice (a lista de
// plataformas, o mesmo resumo que o `docker pull` confere), baixa o indice e confere o sha256 dele, e reescreve a linha
// `image:` do kit. Roda na nossa maquina ou na rotina de versao, nunca no servidor do comprador.
//
//   node infra/kit/fixar-imagens.mjs              reescreve o compose do kit
//   node infra/kit/fixar-imagens.mjs --conferir   so confere (sai 1 se algo mudou no registry ou na producao)
//
// So o Docker Hub, onde moram todas as imagens de hoje. A guarda tests/kit-compose.test.mjs confere, sem rede, que as
// etiquetas do kit sao as da producao e que todo resumo tem o formato certo.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PASTA_COMPOSE = new URL("../compose/", import.meta.url);
const ARQUIVO_PRODUCAO = new URL("docker-compose.yml", PASTA_COMPOSE);
const ARQUIVO_KIT = new URL("docker-compose.kit.yml", PASTA_COMPOSE);
const ACEITA_INDICE = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json"
].join(", ");

/** As linhas `image:` de cada servico (dois espacos de recuo sob `services:`), sem parser de YAML. */
export function imagensDosServicos(fonte) {
  const corpo = fonte.slice(fonte.indexOf("\nservices:\n"));
  const imagens = {};
  let atual = null;
  for (const linha of corpo.split("\n").slice(2)) {
    const servico = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(linha);
    if (servico) {
      atual = servico[1];
      continue;
    }
    if (/^\S/.test(linha)) break; // o proximo bloco de cima (volumes:) ja nao e servico
    const imagem = /^ {4}image: (\S+)\s*$/.exec(linha);
    if (atual && imagem) imagens[atual] = imagem[1];
  }
  return imagens;
}

/** Separa `repo:tag@sha256:...` (o registry so pode ser o Docker Hub). */
export function separarReferencia(ref) {
  const m = /^([a-z0-9][a-z0-9._/-]*):([A-Za-z0-9._-]+)(?:@(sha256:[0-9a-f]{64}))?$/.exec(ref);
  if (!m) return null;
  return { repositorio: m[1], tag: m[2], resumo: m[3] ?? null };
}

/** Troca a linha `image:` de um servico no texto do compose, sem mexer em mais nada. */
export function trocarImagem(fonte, servico, novaRef) {
  const inicio = fonte.indexOf(`\n  ${servico}:\n`);
  if (inicio < 0) throw new Error(`servico ${servico} nao esta no compose`);
  const fim = fonte.slice(inicio + 1).search(/\n {2}[a-z][a-z0-9-]*:\n|\n\S/);
  const bloco = fonte.slice(inicio, fim < 0 ? fonte.length : inicio + 1 + fim);
  const novo = bloco.replace(/^( {4}image: )\S+$/m, `$1${novaRef}`);
  if (novo === bloco) throw new Error(`servico ${servico} sem linha image:`);
  return fonte.slice(0, inicio) + novo + fonte.slice(inicio + bloco.length);
}

async function resumoNoDockerHub(repositorio, tag) {
  const repo = repositorio.includes("/") ? repositorio : `library/${repositorio}`;
  const respostaToken = await fetch(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`);
  if (!respostaToken.ok) throw new Error(`${repositorio}: o Docker Hub recusou o token (${respostaToken.status})`);
  const { token } = await respostaToken.json();
  const resposta = await fetch(`https://registry-1.docker.io/v2/${repo}/manifests/${tag}`, {
    headers: { Accept: ACEITA_INDICE, Authorization: `Bearer ${token}` }
  });
  if (!resposta.ok) throw new Error(`${repositorio}:${tag}: o registry respondeu ${resposta.status}`);
  const corpo = Buffer.from(await resposta.arrayBuffer());
  const resumo = resposta.headers.get("docker-content-digest");
  const conferido = `sha256:${createHash("sha256").update(corpo).digest("hex")}`;
  if (resumo !== conferido) throw new Error(`${repositorio}:${tag}: o resumo anunciado (${resumo}) nao e o do indice baixado (${conferido})`);
  const plataformas = (JSON.parse(corpo.toString("utf8")).manifests ?? []).map((m) => `${m.platform?.os}/${m.platform?.architecture}`);
  if (!plataformas.includes("linux/amd64")) throw new Error(`${repositorio}:${tag}: o indice nao tem linux/amd64`);
  return resumo;
}

async function principal(argumentos) {
  const conferir = argumentos.includes("--conferir");
  const producao = imagensDosServicos(readFileSync(ARQUIVO_PRODUCAO, "utf8"));
  let kit = readFileSync(ARQUIVO_KIT, "utf8");
  let diferencas = 0;
  for (const [servico, refKit] of Object.entries(imagensDosServicos(kit))) {
    if (servico === "app") continue; // a imagem do app vem do Pacote da versao, nao de um registry
    const atual = separarReferencia(refKit);
    const daProducao = separarReferencia(producao[servico] ?? "");
    if (!atual || !daProducao) throw new Error(`${servico}: imagem fora do formato repo:tag (kit ${refKit}, producao ${producao[servico]})`);
    const resumo = await resumoNoDockerHub(daProducao.repositorio, daProducao.tag);
    const nova = `${daProducao.repositorio}:${daProducao.tag}@${resumo}`;
    if (nova === refKit) {
      console.log(`  ok      ${servico.padEnd(9)} ${nova}`);
      continue;
    }
    diferencas += 1;
    console.log(`  ${conferir ? "MUDOU" : "trocado"} ${servico.padEnd(9)} ${refKit} -> ${nova}`);
    kit = trocarImagem(kit, servico, nova);
  }
  if (conferir) {
    if (diferencas) {
      console.error(`${diferencas} imagem(ns) do kit diferente(s) da producao ou do registry: rode sem --conferir.`);
      process.exit(1);
    }
    console.log("O kit esta com os resumos de hoje.");
    return;
  }
  if (diferencas) writeFileSync(ARQUIVO_KIT, kit);
  console.log(diferencas ? `${diferencas} imagem(ns) trocada(s) em ${ARQUIVO_KIT.pathname}.` : "Nada mudou.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2)).catch((erro) => {
    console.error(`ERRO: ${erro.message}`);
    process.exit(1);
  });
}
