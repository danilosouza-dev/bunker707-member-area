import { createHash } from "node:crypto";
import { test as base, expect, type Browser, type BrowserContext, type Page, type Request } from "@playwright/test";
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
  clickedAt: string | null;
  /** v3b-1: vezes no dia de Sao Paulo de lastSeenAt ("Limitar por dia"). */
  dayImpressions: number;
  dismissedAt: string | null;
  impressions: number;
  lastSeenAt: string | null;
  snoozeCount: number;
  snoozedUntil: string | null;
};

/**
 * O que a aluna (ou outra conta de teste) fez com o pop-up de titulo dado, lido do banco (null: o pop-up nao
 * existe ou ela nao esta no segmento).
 */
export async function estadoDoPopUpDaAluna(titulo: string, chave: ChaveDaConta = "aluna"): Promise<EstadoDoPopUp | null> {
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
    .select("clicked_at,day_impressions,dismissed_at,impressions,last_seen_at,snooze_count,snoozed_until")
    .eq("campaign_id", campanha.data.id)
    .eq("user_id", contas[chave].id)
    .maybeSingle();

  if (entrega.error) {
    throw new Error(`Lendo o estado do pop-up da aluna: ${entrega.error.message}`);
  }

  return entrega.data
    ? {
        clickedAt: entrega.data.clicked_at,
        dayImpressions: entrega.data.day_impressions,
        dismissedAt: entrega.data.dismissed_at,
        impressions: entrega.data.impressions,
        lastSeenAt: entrega.data.last_seen_at,
        snoozeCount: entrega.data.snooze_count,
        snoozedUntil: entrega.data.snoozed_until
      }
    : null;
}

/**
 * Devolve o pop-up para a aluna como se ela nunca o tivesse visto (arranjo para testar outra saida do
 * mesmo pop-up: sem isso, "Quantas vezes" do pop-up decide se ele volta).
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
    .update({
      clicked_at: null,
      day_impressions: 0,
      dismissed_at: null,
      first_seen_at: null,
      impressions: 0,
      impressions_before_reshow: 0,
      last_seen_at: null,
      reshown_at: null,
      snooze_count: 0,
      snoozed_until: null,
      snoozes_before_reshow: 0
    })
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

/* ------------------------------------------------------------------------------------------------
 * Comunicacao v3a (docs/24 §11): notificacao enviada com enquete, reacoes, resposta e cartao clicavel;
 * pop-up visto ha mais tempo; contador de pedidos do navegador
 * ---------------------------------------------------------------------------------------------- */

const UMA_HORA = 3_600_000;

type ContaDeTeste = { email: string; id: string; nome: string };
type ChaveDaConta = keyof typeof ESCOLA_DE_TESTE.contas;

/** Uma conta de teste pela chave (aluna, alunoSemAcesso, produtor...), com o id do Auth local. */
export async function contaDeTeste(chave: ChaveDaConta): Promise<ContaDeTeste> {
  const contas = (await contasDeTeste(createLocalAdminClient())) as Record<ChaveDaConta, ContaDeTeste>;

  return contas[chave];
}

/** Id do aviso (notificacao ou pop-up, fora de fluxo, nao excluido) pelo titulo. */
export async function idDoAviso(titulo: string) {
  const db = createLocalAdminClient();
  const aviso = unwrap(
    await db.from("campaigns").select("id").eq("title", titulo).is("flow_id", null).is("deleted_at", null).maybeSingle(),
    `Lendo o aviso "${titulo}"`
  ) as { id: string } | null;

  if (!aviso) {
    throw new Error(`O aviso "${titulo}" nao existe.`);
  }

  return aviso.id;
}

/** O que a equipe escolheu no aviso (fora de fluxo, nao excluido): a lixeira do sino e o tempo no sino. */
export async function avisoNoBanco(titulo: string) {
  const db = createLocalAdminClient();
  const aviso = unwrap(
    await db.from("campaigns").select("allow_hide,valid_until,validity_minutes").eq("title", titulo).is("flow_id", null).is("deleted_at", null).maybeSingle(),
    `Lendo o aviso "${titulo}"`
  ) as { allow_hide: boolean; valid_until: string | null; validity_minutes: number | null } | null;

  if (!aviso) {
    throw new Error(`O aviso "${titulo}" nao existe.`);
  }

  return aviso;
}

export type EnqueteDeTeste = {
  closesAt?: string | null;
  multiple?: boolean;
  options: { id: string; label: string }[];
  question: string;
  showResults?: boolean;
};

export type NotificacaoDeTeste = {
  /** Destino (Para onde leva): pagina da area (mesma aba) ou link (nova aba). */
  destino?: { href: string; label: string; novaAba?: boolean };
  /** Como o aluno chega la (docs/24 §1.2); so com destino. Padrao: "button". */
  display?: "button" | "button_and_card" | "card";
  /** Ha quantos minutos chegou (ordem no sino: a mais nova primeiro). Padrao 30. */
  minutosAtras?: number;
  /** Quem recebe (uma linha no sino de cada). Padrao: so a aluna. */
  para?: ChaveDaConta[];
  /** "Permitir que o aluno exclua do sino" (campaigns.allow_hide). Padrao true (o padrao do banco). */
  podeExcluir?: boolean;
  poll?: EnqueteDeTeste | null;
  /** Permitir reacoes. Padrao false (o padrao do banco; a tela liga nas notificacoes novas). */
  reactions?: boolean;
  /** Aceitar/Recusar com os textos dados. */
  response?: { aceitar: string; recusar: string } | null;
  texto?: string;
  titulo: string;
};

/**
 * Notificacao ja enviada pelo produtor de teste (docs/24 §11), gravada direto no banco como o envio deixa:
 * o aviso "Enviado" (sent_at, quantos receberam) e uma linha no sino de cada conta de `para`. Mais rapido
 * que montar na tela e cobre o que a tela ainda nao cria sozinha numa so passada (enquete, reacoes, modo do
 * cartao e resposta juntos). Devolve o id do aviso. Desfaca com zerarComunicacao.
 */
export async function enviarNotificacao(input: NotificacaoDeTeste) {
  const db = createLocalAdminClient();
  const contas = (await contasDeTeste(db)) as Record<ChaveDaConta, ContaDeTeste>;
  const para = input.para ?? ["aluna"];
  const minutosAtras = input.minutosAtras ?? 30;
  const chegou = new Date(Date.now() - minutosAtras * 60_000).toISOString();
  const poll = input.poll
    ? {
        closesAt: input.poll.closesAt ?? null,
        multiple: input.poll.multiple ?? false,
        options: input.poll.options,
        question: input.poll.question,
        showResults: input.poll.showResults ?? true
      }
    : null;
  const [aviso] = unwrap(
    await db
      .from("campaigns")
      .insert({
        accept_label: input.response?.aceitar ?? null,
        allow_hide: input.podeExcluir ?? true,
        allow_reactions: input.reactions ?? false,
        audience: { kind: "everyone" },
        audience_count: para.length,
        body: input.texto ?? "",
        created_by: contas.produtor.id,
        cta_display: input.destino ? (input.display ?? "button") : "button",
        cta_href: input.destino?.href ?? null,
        cta_label: input.destino?.label ?? null,
        cta_target: input.destino ? (input.destino.novaAba ? "new_tab" : "same_tab") : null,
        decline_label: input.response?.recusar ?? null,
        kind: "inbox",
        poll,
        recipients_count: para.length,
        response_mode: input.response ? "accept_decline" : "none",
        send_at: chegou,
        sent_at: chegou,
        status: "sent",
        title: input.titulo,
        updated_by: contas.produtor.id
      })
      .select("id"),
    `Gravando a notificacao "${input.titulo}"`
  ) as { id: string }[];

  unwrap(
    await db.from("notifications").insert(
      para.map((chave) => ({
        campaign_id: aviso.id,
        created_at: chegou,
        dedupe_key: `campaign:${aviso.id}`,
        expires_at: new Date(Date.parse(chegou) + 90 * 24 * UMA_HORA).toISOString(),
        kind: "notice",
        user_id: contas[chave].id
      }))
    ),
    `Gravando o sino de "${input.titulo}"`
  );

  return aviso.id;
}

/**
 * Volta no tempo o que um aluno viu de um pop-up (first_seen_at e last_seen_at), em horas: com 25 h, o limite
 * de 1 pop-up a cada 24 h deixa de valer para ele e so a regra do proprio pop-up decide (Uma vez, Até o aluno
 * clicar, Não mostrar de novo, Mostrar de novo). Devolve quantas linhas mudou (0: ele nunca viu).
 */
export async function envelhecerPopup(campaignId: string, userId: string, horas: number) {
  const db = createLocalAdminClient();
  const entrega = unwrap(
    await db.from("campaign_deliveries").select("first_seen_at,last_seen_at").eq("campaign_id", campaignId).eq("user_id", userId).maybeSingle(),
    "Lendo o pop-up do aluno"
  ) as { first_seen_at: string | null; last_seen_at: string | null } | null;

  if (!entrega?.last_seen_at) {
    return 0;
  }

  const antes = (iso: string | null) => (iso ? new Date(Date.parse(iso) - horas * UMA_HORA).toISOString() : null);
  unwrap(
    await db
      .from("campaign_deliveries")
      .update({ first_seen_at: antes(entrega.first_seen_at), last_seen_at: antes(entrega.last_seen_at) })
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    "Envelhecendo o pop-up do aluno"
  );

  return 1;
}

export type ContadorDePedidos = {
  /** Quando cada pedido saiu (Date.now() no processo do teste), na ordem. */
  readonly inicios: readonly number[];
  parar(): void;
  readonly total: number;
  zerar(): void;
};

/**
 * Conta os pedidos que o navegador faz para um caminho (o padrao casa com o pathname inteiro, sem a busca),
 * por metodo (padrao GET). Ex.: contarPedidos(page, /^\/api\/notifications$/) conta a lista do sino e nao o
 * resumo nem as escritas.
 */
export function contarPedidos(page: Page, padrao: RegExp, metodo = "GET"): ContadorDePedidos {
  const inicios: number[] = [];
  const ouvir = (request: Request) => {
    if (request.method() === metodo && padrao.test(new URL(request.url()).pathname)) {
      inicios.push(Date.now());
    }
  };

  page.on("request", ouvir);

  return {
    inicios,
    parar: () => {
      page.off("request", ouvir);
    },
    get total() {
      return inicios.length;
    },
    zerar: () => {
      inicios.length = 0;
    }
  };
}

export type LinhaDoSino = {
  clicked_at: string | null;
  created_at: string;
  expires_at: string | null;
  hidden_at: string | null;
  opened_at: string | null;
  poll_choice: string[] | null;
  reaction: string | null;
  read_at: string | null;
  response: string | null;
  seen_at: string | null;
};

/** A linha do sino de uma conta para o aviso de titulo dado, lida do banco (null: nao recebeu). */
export async function linhaDoSino(titulo: string, chave: ChaveDaConta = "aluna"): Promise<LinhaDoSino | null> {
  const db = createLocalAdminClient();
  const conta = await contaDeTeste(chave);
  const avisos = unwrap(await db.from("campaigns").select("id").eq("title", titulo), `Lendo o aviso "${titulo}"`) as { id: string }[];

  if (avisos.length === 0) {
    return null;
  }

  return unwrap(
    await db
      .from("notifications")
      .select("clicked_at,created_at,expires_at,hidden_at,opened_at,poll_choice,reaction,read_at,response,seen_at")
      .in(
        "campaign_id",
        avisos.map((aviso) => aviso.id)
      )
      .eq("user_id", conta.id)
      .eq("is_test", false)
      .maybeSingle(),
    "Lendo a linha do sino"
  ) as LinhaDoSino | null;
}

/* ------------------------------------------------------------------------------------------------
 * Comunicacao v3b-1 (docs/25 §8): pop-up com paginas, momento, frequencia e como fechar; historico do
 * pop-up; video da aula trocado para testar o player de fora (iframe)
 * ---------------------------------------------------------------------------------------------- */

const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";

export type FrequenciaDoPopUp =
  | { mode: "once" }
  | { everyMinutes?: number | null; maxPerDay?: number | null; maxTotal?: number | null; mode: "repeat"; stopOn?: "click" | "never" };

export type PopUpDeTeste = {
  /** Botao do pop-up (Para onde leva). Padrao: sem botao. */
  botao?: { href: string; label: string } | null;
  /** Segundos depois de abrir a pagina (ou de concluir a aula). Padrao 3. */
  depoisDe?: number;
  /** Nunca nestas paginas (padroes de popup-display-model.ts). Padrao: nenhuma. */
  excecoes?: string[];
  /** "Como fechar". Padrao "any" (no X ou clicando fora). */
  fechar?: "any" | "x_only";
  /** "Quantas vezes". Padrao: Uma vez. */
  frequencia?: FrequenciaDoPopUp;
  /** Comeca (ISO); null = ao publicar. */
  inicio?: string | null;
  /** "Volta em" do "Lembrar depois", em minutos; null = sem "Lembrar depois". Padrao 1.440 (24 h). */
  lembrarEm?: number | null;
  /** Onde aparece (padroes de popup-display-model.ts). Padrao ["home"]. */
  paginas?: string[];
  /** Quando aparece. Padrao "page_load". */
  quando?: "lesson_completed" | "page_load";
  texto?: string;
  titulo: string;
};

/**
 * Publica um pop-up para todos os alunos como o produtor faria (docs/25 §8): o rascunho entra no banco com
 * as configuracoes (mais rapido que montar os dois cards na tela, e cobre combinacoes que a tela monta em
 * varios passos) e a publicacao e feita pela tela, com a sessao do produtor: "Publicar pop-up" roda a Server
 * Action, que conta o segmento, prepara as linhas dos alunos e renova a lista de pop-ups no ar (60 s em
 * cache no servidor; gravar direto no banco nao a renova). Devolve o id do pop-up. Desfaca com
 * zerarComunicacao.
 */
export async function publicarPopUp(browser: Browser, input: PopUpDeTeste) {
  const db = createLocalAdminClient();
  const contas = (await contasDeTeste(db)) as Record<ChaveDaConta, ContaDeTeste>;
  const frequencia = input.frequencia ?? { mode: "once" };
  const repete = frequencia.mode === "repeat";
  const [rascunho] = unwrap(
    await db
      .from("campaigns")
      .insert({
        allow_snooze: input.lembrarEm !== null,
        audience: { kind: "everyone" },
        body: input.texto ?? "",
        created_by: contas.produtor.id,
        cta_href: input.botao?.href ?? null,
        cta_label: input.botao?.label ?? null,
        cta_target: input.botao ? "same_tab" : null,
        kind: "popup",
        popup_close: input.fechar ?? "any",
        popup_delay_seconds: input.depoisDe ?? 3,
        popup_every_minutes: repete ? (frequencia.everyMinutes ?? null) : null,
        popup_exclude_pages: input.excecoes ?? [],
        popup_frequency: frequencia.mode,
        popup_max_per_day: repete ? (frequencia.maxPerDay ?? null) : null,
        popup_max_total: repete ? (frequencia.maxTotal ?? null) : null,
        popup_pages: input.paginas ?? ["home"],
        popup_repeat: repete ? "until_action" : "once",
        popup_snooze_minutes: input.lembrarEm ?? 1_440,
        popup_stop_on: repete ? (frequencia.stopOn ?? (input.botao ? "click" : "never")) : null,
        popup_trigger: input.quando ?? "page_load",
        starts_at: input.inicio ?? null,
        status: "draft",
        title: input.titulo,
        updated_by: contas.produtor.id
      })
      .select("id"),
    `Gravando o rascunho do pop-up "${input.titulo}"`
  ) as { id: string }[];

  const contexto = await browser.newContext({ baseURL: enderecoDoApp, locale: "pt-BR", storageState: SESSAO_DO_PRODUTOR, timezoneId: "America/Sao_Paulo" });
  await bloquearRedeExterna(contexto);

  try {
    const pagina = await contexto.newPage();
    await pagina.goto(`/admin/comunicacao/avisos/${rascunho.id}`);
    await pagina.waitForLoadState("networkidle");
    await expect(pagina.getByLabel("Título", { exact: true })).toHaveValue(input.titulo);
    await pagina.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
    await expect(pagina.getByText(/^Pop-up publicado\./)).toBeVisible();
    await expect(pagina).toHaveURL(new RegExp(`/admin/comunicacao/avisos/${rascunho.id}$`));
  } finally {
    await contexto.close();
  }

  return rascunho.id;
}

export type EventoDoPopUp = { event_type: string; metadata: Record<string, unknown> };

/** O historico (student_events) de um pop-up para uma conta, na ordem em que aconteceu. */
export async function eventosDoPopUp(campaignId: string, chave: ChaveDaConta = "aluna"): Promise<EventoDoPopUp[]> {
  const db = createLocalAdminClient();
  const conta = await contaDeTeste(chave);

  return unwrap(
    await db
      .from("student_events")
      .select("event_type,metadata")
      .eq("entity_type", "campaign")
      .eq("entity_id", campaignId)
      .eq("user_id", conta.id)
      .order("occurred_at", { ascending: true }),
    "Lendo o historico do pop-up"
  ) as EventoDoPopUp[];
}

/**
 * Troca o video de uma aula de teste direto no banco (o player de fora, em iframe: Vimeo, Bunny, Mux) e
 * devolve o que estava la, para voltar depois. A area do aluno le o catalogo de um cache de 60 s: quem chama
 * espera a pagina da aula mostrar o player novo (esperarPlayerDaAula).
 */
export async function trocarVideoDaAula(lessonId: string, video: Record<string, unknown>) {
  const db = createLocalAdminClient();
  const antes = unwrap(await db.from("lessons").select("video_config").eq("id", lessonId).single(), "Lendo o video da aula") as {
    video_config: Record<string, unknown> | null;
  };

  unwrap(await db.from("lessons").update({ video_config: video }).eq("id", lessonId), "Trocando o video da aula");

  return antes.video_config;
}

/**
 * Recarrega a pagina da aula ate o palco mostrar o tipo de player pedido (o catalogo da area do aluno fica
 * 60 s em cache e se renova no pedido seguinte ao vencimento). Ate 2 minutos.
 */
export async function esperarPlayerDaAula(page: Page, endereco: string, tipo: "iframe" | "native" | "youtube") {
  await expect
    .poll(
      async () => {
        await page.goto(endereco);
        return page.locator("[data-lesson-player-stage]").getAttribute("data-lesson-player-kind");
      },
      { intervals: [5_000], timeout: 120_000 }
    )
    .toBe(tipo);
}

type PlanoDoResumo = { asOf: string; plan: { id: string; notBefore: string | null; trigger: string }[] | null } | null;

/**
 * Recarrega a home (a memoria do navegador comeca vazia) e devolve os ids dos pop-ups que o plano da aluna
 * deixa abrir agora (docs/25 §4.4: o resumo com `?page=home` traz o plano, sem conteudo; um pop-up adiado,
 * dispensado ou ja visto em "Uma vez" nao entra ou vem com notBefore no futuro).
 */
export async function popUpsQueAbremNaHome(page: Page) {
  // O resumo da home sai 1,5 s depois de carregar: esperar so depois de a pagina nova assumir nunca pega o da
  // pagina anterior ainda no ar.
  await page.reload({ waitUntil: "commit" });
  const resumo = await page.waitForResponse((response) => response.url().includes("/api/notifications/summary?page=home"));
  const { data } = (await resumo.json()) as { data: { popups?: PlanoDoResumo } };
  const asOf = Date.parse(data.popups?.asOf ?? "");

  return (data.popups?.plan ?? [])
    .filter((item) => item.trigger === "page_load" && (item.notBefore === null || Date.parse(item.notBefore) <= asOf))
    .map((item) => item.id);
}

/* ------------------------------------------------------------------------------------------------
 * Design do pop-up (docs/26 §8): o que o editor gravou, lido do banco
 * ---------------------------------------------------------------------------------------------- */

export type DesignDoPopUpNoBanco = {
  /** Fontes enviadas que o design usa, resolvidas na biblioteca (a familia bf_ que o navegador registra). */
  fontes: { family: string; id: string; name: string }[];
  id: string;
  /** A imagem do aviso: a capa do video (o quadro tirado pelo editor quando nao havia imagem). */
  imagem: string | null;
  /** O design gravado (null = Padrão). */
  design: {
    blocks: Record<string, unknown>[];
    /** Fundo do cartao: cor, degradê ou a imagem (com `url`, `position`, `dim` e a cor de apoio). */
    card: { background: { kind: string; url?: string } & Record<string, unknown> };
    fonts: string[];
    media: {
      /** Degradê: totalmente escuro em `end` (% da midia, do topo), comecando `height` antes. */
      fade: { color: string; enabled: boolean; end: number; height: number };
      kind: string;
      video: { mimeType: string; path: string; url: string } | null;
    };
  } | null;
};

/**
 * O design Personalizado de um pop-up como ficou no banco depois de salvar/publicar pela tela: o design, a capa e
 * as fontes enviadas (familia bf_) que ele usa. Falha se o pop-up nao existe.
 */
export async function designDoPopUpNoBanco(titulo: string): Promise<DesignDoPopUpNoBanco> {
  const db = createLocalAdminClient();
  const linha = unwrap(
    await db.from("campaigns").select("id,image_url,popup_design").eq("kind", "popup").eq("title", titulo).is("deleted_at", null).single(),
    `Lendo o design do pop-up "${titulo}"`
  ) as { id: string; image_url: string | null; popup_design: DesignDoPopUpNoBanco["design"] };
  const ids = linha.popup_design?.fonts ?? [];
  const fontes = ids.length
    ? (unwrap(await db.from("communication_fonts").select("id,family_key,name").in("id", ids), "Lendo as fontes do design") as { family_key: string; id: string; name: string }[])
    : [];

  return {
    design: linha.popup_design,
    fontes: fontes.map((fonte) => ({ family: fonte.family_key, id: fonte.id, name: fonte.name })),
    id: linha.id,
    imagem: linha.image_url
  };
}
