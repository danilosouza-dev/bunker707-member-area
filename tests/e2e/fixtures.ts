import { createHash } from "node:crypto";
import { test as base, expect, type BrowserContext } from "@playwright/test";
import {
  ESCOLA_DE_TESTE,
  SENHA_DE_TESTE,
  apagarContaDeTeste,
  apagarProdutosDeTeste,
  contasDeTeste,
  definirCapaDoProduto,
  limparComentarios,
  limparComunicacao,
  limparConfiguracoesDeTeste,
  limparFotoDoPerfil,
  limparProgresso,
  limparSessoesDeTv
} from "../fixtures/escola-de-teste.mjs";
import { pngQuadrado } from "../support/imagem-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";

// Base dos testes de ponta a ponta: o navegador so fala com a maquina. Qualquer pedido para fora
// (YouTube, PostHog, Sentry, fontes, CDNs) e cortado antes de sair. O player do YouTube continua
// desenhado na pagina; so o video nao carrega, e nenhum teste depende dele.
/** Corta qualquer pedido do navegador que nao seja para a propria maquina. */
export async function bloquearRedeExterna(context: BrowserContext) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort("blockedbyclient"));
}

export const test = base.extend({
  context: async ({ context }, run) => {
    await bloquearRedeExterna(context);
    await run(context);
  }
});

export { expect };

/**
 * Cada arquivo de teste comeca do zero: apaga progresso, favoritos e atividade das contas de aluno (a
 * escola de teste ja foi garantida pelo setup). Use em `test.beforeAll`, porque os arquivos compartilham
 * o banco local e a ordem em que rodam nao pode mudar o resultado. So le as contas, nunca as altera:
 * mexer na conta no Auth derruba o login guardado pelo setup.
 */
export async function zerarProgressoDosAlunos() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparProgresso(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
}

/** Apaga as sessoes de TV (e os eventos delas) das contas de aluno. */
export async function zerarSessoesDeTv() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparSessoesDeTv(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
}

/** Apaga os comentarios escritos por todas as contas de teste (alunos e equipe). */
export async function zerarComentariosDeTeste() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparComentarios(db, Object.values(contas).map((conta) => conta.id));
}

/** Tira a foto do perfil das contas de aluno (perfil, comentarios e bucket). */
export async function zerarFotoDosAlunos() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparFotoDoPerfil(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
}

/** Apaga uma conta criada por um teste de navegador (sai da equipe e some do Auth local). */
export async function apagarConta(email: string) {
  await apagarContaDeTeste(createLocalAdminClient(), email);
}

/** Apaga os produtos criados por um teste de navegador (titulo com o prefixo), com modulos e aulas. */
export async function apagarProdutos(prefixoDoTitulo: string) {
  await apagarProdutosDeTeste(createLocalAdminClient(), prefixoDoTitulo);
}

/**
 * Capa do produto por arranjo: enviar a capa pela tela exige recorte em WebP (o WebKit nao gera) e
 * links externos sao cortados nos testes; a capa entra direto no banco, como um link https.
 */
export async function definirCapa(tituloDoProduto: string) {
  await definirCapaDoProduto(createLocalAdminClient(), tituloDoProduto);
}

/** Volta o destaque, as fileiras e a tela de entrar ao padrao (apaga o que um teste publicou). */
export async function zerarAreaDeMembros() {
  await limparConfiguracoesDeTeste(createLocalAdminClient(), ["hero", "homeSections", "loginPage"]);
}

/**
 * Apaga fluxos, avisos, pop-ups, notificacoes e visitas de pagina das contas de teste (docs/22 e docs/23;
 * os fluxos primeiro, como em limparComunicacao). Use em `test.beforeAll` E em `test.afterAll` de quem
 * publica algo: um pop-up esquecido abre na home dos outros arquivos (e um dialogo a mais confunde quem
 * procura "o" dialogo da pagina); uma notificacao muda o nome do sino.
 */
export async function zerarComunicacao() {
  await limparComunicacao(createLocalAdminClient());
}

export type EstadoDoPopUp = {
  dismissedAt: string | null;
  impressions: number;
  snoozeCount: number;
  snoozedUntil: string | null;
};

/** O que a aluna fez com o pop-up de titulo dado, lido do banco (null: o pop-up nao existe ou ela nao esta no segmento). */
export async function estadoDoPopUpDaAluna(titulo: string): Promise<EstadoDoPopUp | null> {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  const campanha = await db.from("campaigns").select("id").eq("kind", "popup").eq("title", titulo).is("deleted_at", null).maybeSingle();

  if (campanha.error) {
    throw new Error(`Lendo o pop-up "${titulo}": ${campanha.error.message}`);
  }

  if (!campanha.data) {
    return null;
  }

  const entrega = await db
    .from("campaign_deliveries")
    .select("dismissed_at,impressions,snooze_count,snoozed_until")
    .eq("campaign_id", campanha.data.id)
    .eq("user_id", contas.aluna.id)
    .maybeSingle();

  if (entrega.error) {
    throw new Error(`Lendo o estado do pop-up da aluna: ${entrega.error.message}`);
  }

  return entrega.data
    ? {
        dismissedAt: entrega.data.dismissed_at,
        impressions: entrega.data.impressions,
        snoozeCount: entrega.data.snooze_count,
        snoozedUntil: entrega.data.snoozed_until
      }
    : null;
}

/**
 * Devolve o pop-up para a aluna como se ela nunca o tivesse visto (arranjo para testar outra saida do
 * mesmo pop-up: o limite de 24 h conta a ultima vez que ela viu qualquer pop-up).
 */
export async function reabrirPopUpParaAluna(titulo: string) {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  const campanha = await db.from("campaigns").select("id").eq("kind", "popup").eq("title", titulo).is("deleted_at", null).single();

  if (campanha.error) {
    throw new Error(`Lendo o pop-up "${titulo}": ${campanha.error.message}`);
  }

  const result = await db
    .from("campaign_deliveries")
    .update({ clicked_at: null, dismissed_at: null, first_seen_at: null, impressions: 0, last_seen_at: null, snooze_count: 0, snoozed_until: null })
    .eq("campaign_id", campanha.data.id)
    .eq("user_id", contas.aluna.id);

  if (result.error) {
    throw new Error(`Reabrindo o pop-up para a aluna: ${result.error.message}`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Comunicacao v2 (docs/23 §8.3): tick, fluxos, foto de quem envia, audio e validade
 * ---------------------------------------------------------------------------------------------- */

const enderecoDoApp = `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;

/**
 * Roda o tick de minuto do app agora (POST /api/jobs/tick com o token local de tests/support/db.mjs), como o
 * pg_cron faria: envia o que venceu, matricula quem recebeu a notificacao de origem e decide as tarefas dos
 * fluxos. Falha alta se o tick nao terminar verde.
 */
export async function rodarTick() {
  const token = process.env.JOBS_TICK_TOKEN;

  if (!token) {
    throw new Error("JOBS_TICK_TOKEN vazio: o playwright.config.ts carrega o token local por loadEnvFile().");
  }

  const resposta = await fetch(`${enderecoDoApp}/api/jobs/tick`, { headers: { authorization: `Bearer ${token}` }, method: "POST" });
  const corpo = (await resposta.json().catch(() => null)) as { failed?: string[]; ok?: boolean; ran?: string[] } | null;

  if (!resposta.ok || !corpo?.ok) {
    throw new Error(`O tick falhou (${resposta.status}): ${JSON.stringify(corpo)}`);
  }

  return corpo;
}

/** Id do fluxo pelo nome (construtor) ou pelo titulo da notificacao de origem (notificacoes seguintes). */
export async function idDoFluxo(input: { aviso: string } | { nome: string }) {
  const db = createLocalAdminClient();

  if ("nome" in input) {
    const fluxo = unwrap(await db.from("communication_flows").select("id").eq("name", input.nome).is("deleted_at", null).maybeSingle(), `Lendo o fluxo "${input.nome}"`);

    if (!fluxo) {
      throw new Error(`O fluxo "${input.nome}" nao existe.`);
    }

    return (fluxo as { id: string }).id;
  }

  const aviso = unwrap(
    await db.from("campaigns").select("id").eq("title", input.aviso).is("flow_id", null).is("deleted_at", null).maybeSingle(),
    `Lendo o aviso "${input.aviso}"`
  );

  if (!aviso) {
    throw new Error(`O aviso "${input.aviso}" nao existe.`);
  }

  const fluxo = unwrap(
    await db.from("communication_flows").select("id").eq("source_campaign_id", (aviso as { id: string }).id).is("deleted_at", null).maybeSingle(),
    `Lendo as notificacoes seguintes de "${input.aviso}"`
  );

  if (!fluxo) {
    throw new Error(`O aviso "${input.aviso}" nao tem notificacoes seguintes.`);
  }

  return (fluxo as { id: string }).id;
}

type TarefaPendente = { anchor_at: string; deadline_at: string | null; node_id: string; user_id: string };
type PassoDoFluxo = { anchor: "expires" | "previous" | "sent"; id: string; offset_minutes: number };

/**
 * Traz para agora as tarefas pendentes do fluxo (docs/23 §8.3). Mexer so em due_at nao adianta: o motor
 * recalcula o horario a partir de anchor_at e so adiaria de novo. Cada tarefa volta no tempo pela propria
 * distancia ate agora (anchor_at e deadline_at juntos, not_before limpo), entao o horario recalculado e agora
 * e o prazo guarda a distancia. A distancia sai do horario de verdade (anchor_at + espera, ou anchor_at -
 * espera no "antes de vencer", como dueFromAnchor), nunca do due_at: num minuto :00/:15/:30/:45 a varredura
 * do objetivo poe due_at = agora nas pendentes de um fluxo com objetivo, e o due_at nao diz mais quando ela
 * sai. A ordem e sempre: tick (matricula ou envia) -> adiantarFluxo -> tick. Devolve quantas tarefas adiantou.
 */
export async function adiantarFluxo(flowId: string) {
  const db = createLocalAdminClient();
  const agora = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const pendentes = unwrap(
    await db.from("communication_flow_tasks").select("node_id,user_id,anchor_at,deadline_at").eq("flow_id", flowId).eq("status", "pending"),
    "Lendo as tarefas pendentes do fluxo"
  ) as TarefaPendente[];
  const passos = unwrap(
    await db.from("communication_flow_nodes").select("id,anchor,offset_minutes").eq("flow_id", flowId),
    "Lendo os passos do fluxo"
  ) as PassoDoFluxo[];
  const passoPorId = new Map(passos.map((passo) => [passo.id, passo]));
  const horarioDe = (tarefa: TarefaPendente) => {
    const passo = passoPorId.get(tarefa.node_id);
    const espera = (passo?.offset_minutes ?? 0) * 60_000;

    return Date.parse(tarefa.anchor_at) + (passo?.anchor === "expires" ? -espera : espera);
  };
  const tarefas = pendentes.filter((tarefa) => horarioDe(tarefa) > agora);

  for (const tarefa of tarefas) {
    const distancia = horarioDe(tarefa) - agora;

    unwrap(
      await db
        .from("communication_flow_tasks")
        .update({
          anchor_at: iso(Date.parse(tarefa.anchor_at) - distancia),
          deadline_at: tarefa.deadline_at ? iso(Date.parse(tarefa.deadline_at) - distancia) : null,
          due_at: iso(agora),
          not_before: null
        })
        .eq("node_id", tarefa.node_id)
        .eq("user_id", tarefa.user_id)
        .eq("status", "pending"),
      "Adiantando uma tarefa do fluxo"
    );
  }

  return tarefas.length;
}

/**
 * Da ao produtor de teste uma foto de perfil, como o /perfil grava: um PNG pequeno no bucket publico
 * (avatars/{id}/{hash}.png) e o endereco em profiles.avatar_url. Devolve o endereco (o src que o sino desenha:
 * o Supabase local e http, fora do otimizador do next/image). Desfaca com tirarFotoDoProdutor.
 */
export async function fotoDoProdutor() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  const bytes = pngQuadrado(200);
  const caminho = `avatars/${contas.produtor.id}/${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.png`;

  unwrap(await db.storage.from("content-assets").upload(caminho, bytes, { contentType: "image/png", upsert: true }), "Enviando a foto do produtor");
  const endereco = db.storage.from("content-assets").getPublicUrl(caminho).data.publicUrl;
  unwrap(await db.from("profiles").update({ avatar_url: endereco }).eq("id", contas.produtor.id), "Gravando a foto do produtor");

  return endereco;
}

/** Tira a foto do perfil do produtor de teste (perfil e bucket). */
export async function tirarFotoDoProdutor() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparFotoDoPerfil(db, [contas.produtor.id]);
}

/**
 * Audio de teste em memoria: WAV PCM de 16 bits, mono, 8 kHz, com `segundos` de um tom que sobe e desce (a
 * forma de onda nao sai reta). O produtor envia pela tela ("Enviar arquivo"), que grava no bucket
 * communication-audio.
 */
export function gerarAudioDeTeste(segundos = 2) {
  const taxa = 8_000;
  const amostras = Math.round(taxa * segundos);
  const wav = Buffer.alloc(44 + amostras * 2);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + amostras * 2, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(taxa, 24);
  wav.writeUInt32LE(taxa * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(amostras * 2, 40);

  for (let index = 0; index < amostras; index += 1) {
    const tempo = index / taxa;
    const volume = 0.25 + 0.6 * Math.abs(Math.sin(Math.PI * tempo * 1.5));
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * tempo) * volume * 32_767), 44 + index * 2);
  }

  return { buffer: wav, mimeType: "audio/wav", name: "aviso-de-teste.wav" };
}

/**
 * Volta no tempo as notificacoes de um aviso (todas as contas): created_at e expires_at juntos, pela mesma
 * distancia, entao expires_at > created_at continua valendo. Com 2 dias, uma notificacao de "1 dia" vence.
 */
export async function envelhecerNotificacao(tituloDoAviso: string, milissegundos: number) {
  const db = createLocalAdminClient();
  const avisos = unwrap(await db.from("campaigns").select("id").eq("title", tituloDoAviso).is("deleted_at", null), `Lendo o aviso "${tituloDoAviso}"`) as {
    id: string;
  }[];

  if (avisos.length === 0) {
    throw new Error(`O aviso "${tituloDoAviso}" nao existe.`);
  }

  const linhas = unwrap(
    await db
      .from("notifications")
      .select("id,created_at,expires_at")
      .in(
        "campaign_id",
        avisos.map((aviso) => aviso.id)
      ),
    "Lendo as notificacoes do aviso"
  ) as { created_at: string; expires_at: string; id: string }[];

  for (const linha of linhas) {
    unwrap(
      await db
        .from("notifications")
        .update({
          created_at: new Date(Date.parse(linha.created_at) - milissegundos).toISOString(),
          expires_at: new Date(Date.parse(linha.expires_at) - milissegundos).toISOString()
        })
        .eq("id", linha.id),
      "Envelhecendo uma notificacao"
    );
  }

  return linhas.length;
}

/** Pessoa da equipe com nome comprido (o nome encurta na linha de quem envia, a 375 px). */
export const PROFESSOR_DE_NOME_LONGO = { email: "prof.carlos.albuquerque@bunker707.test", nome: "Prof. Carlos Lima de Albuquerque" } as const;

/** Cria (ou reaproveita) a conta do professor de nome comprido e o coloca na equipe (Professor do curso de teste). */
export async function garantirProfessorDeNomeLongo() {
  const db = createLocalAdminClient();
  const lista = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (lista.error) {
    throw new Error(`Lendo contas: ${lista.error.message}`);
  }

  let id = lista.data.users.find((user) => user.email?.toLowerCase() === PROFESSOR_DE_NOME_LONGO.email)?.id ?? null;

  if (!id) {
    const criado = await db.auth.admin.createUser({
      email: PROFESSOR_DE_NOME_LONGO.email,
      email_confirm: true,
      password: SENHA_DE_TESTE,
      user_metadata: { full_name: PROFESSOR_DE_NOME_LONGO.nome }
    });

    if (criado.error || !criado.data.user) {
      throw new Error(`Criando o professor de nome comprido: ${criado.error?.message ?? "sem usuario"}`);
    }

    id = criado.data.user.id;
  }

  unwrap(
    await db.from("profiles").upsert({ email: PROFESSOR_DE_NOME_LONGO.email, full_name: PROFESSOR_DE_NOME_LONGO.nome, id }, { onConflict: "id" }),
    "Gravando o perfil do professor de nome comprido"
  );
  unwrap(
    await db
      .from("admin_roles")
      .upsert({ permissions: { productIds: [ESCOLA_DE_TESTE.curso.id] }, role: "instructor", user_id: id }, { onConflict: "user_id" }),
    "Colocando o professor de nome comprido na equipe"
  );

  return { ...PROFESSOR_DE_NOME_LONGO, id };
}

/** Tira o professor de nome comprido da equipe e apaga a conta (depois de zerarComunicacao). */
export async function apagarProfessorDeNomeLongo() {
  await apagarContaDeTeste(createLocalAdminClient(), PROFESSOR_DE_NOME_LONGO.email);
}
