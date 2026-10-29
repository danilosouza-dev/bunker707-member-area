import { createHash } from "node:crypto";
import { test as base, expect, type Browser, type BrowserContext, type Locator, type Page, type Request } from "@playwright/test";
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
import { templateMediaUse } from "../../src/server/communications/media-refs";
import { storedPopupDesignAssetPaths } from "../../src/server/communications/popup-design-router";
import { templateDesignModeOf, type TemplatePayload } from "../../src/server/communications/template-model";
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

/**
 * Apaga uma conta criada por um teste de navegador (sai da equipe e some do Auth local). Antes, os modelos da
 * Comunicacao que ela criou (docs/28): o `on delete set null` deixaria a linha sem dono, fora do alcance de
 * limparComunicacao, e o limite de 200 modelos e da escola inteira.
 */
export async function apagarConta(email: string) {
  const db = createLocalAdminClient();
  await apagarModelosDaConta(db, email);
  await apagarContaDeTeste(db, email);
}

/** Os modelos (communication_templates) criados pela conta do e-mail dado. Banco sem a migracao: nada a apagar. */
async function apagarModelosDaConta(db: ReturnType<typeof createLocalAdminClient>, email: string) {
  const perfil = unwrap(await db.from("profiles").select("id").eq("email", email.toLowerCase()).maybeSingle(), `Lendo a conta ${email}`) as {
    id: string;
  } | null;

  if (!perfil) {
    return;
  }

  const { error } = await db.from(TABELA_DE_MODELOS).delete().eq("created_by", perfil.id);

  if (error && !/does not exist|Could not find/i.test(error.message)) {
    throw new Error(`Apagando os modelos de ${email}: ${error.message}`);
  }
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
 * Apaga fluxos, modelos (docs/28), avisos, pop-ups, notificacoes e visitas de pagina das contas de teste (docs/22
 * e docs/23; os fluxos primeiro e os modelos antes dos avisos, como em limparComunicacao). Use em `test.beforeAll`
 * E em `test.afterAll` de quem publica algo: um pop-up esquecido abre na home dos outros arquivos (e um dialogo a
 * mais confunde quem procura "o" dialogo da pagina); uma notificacao muda o nome do sino; um modelo esquecido
 * vira menu no "Novo aviso" dos outros arquivos. Livre (docs/27): depois, as imagens enviadas no editor Livre
 * (`communications/free/` no bucket de imagens) que nenhum aviso nem modelo que ficou usa. Chame antes de apagar
 * qualquer conta temporaria (apagarConta tambem apaga os modelos dela).
 */
export async function zerarComunicacao() {
  const db = createLocalAdminClient();
  await limparComunicacao(db);
  await apagarImagensDoLivreSemUso(db);
}

const PASTA_DO_LIVRE = "communications/free";

/**
 * As imagens do Livre que nenhum aviso gravado nem modelo que sobrou usa (as dos testes; nunca as de um aviso ou de
 * um modelo que ficou no banco, de quem desenvolve ou de outro arquivo de teste). Os modelos sao lidos pelo jsonb
 * cru (templateMediaUse, a mesma leitura da limpeza do servidor), inclusive os excluidos: errar para o lado de
 * guardar so custa espaco no bucket local.
 */
async function apagarImagensDoLivreSemUso(db: ReturnType<typeof createLocalAdminClient>) {
  const linhas = unwrap(await db.from("campaigns").select("popup_design").not("popup_design", "is", null), "Lendo os designs que ficaram") as {
    popup_design: unknown;
  }[];
  const usadas = new Set(linhas.flatMap((linha) => storedPopupDesignAssetPaths(linha.popup_design)));

  for (const caminho of await caminhosDosModelos(db)) {
    usadas.add(caminho);
  }
  const caminhos: string[] = [];

  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.storage.from("content-assets").list(PASTA_DO_LIVRE, { limit: 100, offset });

    if (error) {
      throw new Error(`Listando as imagens do Livre: ${error.message}`);
    }

    caminhos.push(...(data ?? []).filter((item) => item.id !== null).map((item) => `${PASTA_DO_LIVRE}/${item.name}`));

    if (!data || data.length < 100) {
      break;
    }
  }

  const semUso = caminhos.filter((caminho) => !usadas.has(caminho));

  if (semUso.length > 0) {
    const { error } = await db.storage.from("content-assets").remove(semUso);

    if (error) {
      throw new Error(`Apagando as imagens do Livre: ${error.message}`);
    }
  }
}

const TABELA_DE_MODELOS = "communication_templates";
const BUCKET_DE_IMAGENS = "content-assets";

/** Os caminhos no bucket de imagens que os modelos gravados citam (de 20 em 20: o payload pode ter ate 768 KB). */
async function caminhosDosModelos(db: ReturnType<typeof createLocalAdminClient>) {
  const caminhos: string[] = [];

  for (let offset = 0; ; offset += 20) {
    const { data, error } = await db.from(TABELA_DE_MODELOS).select("id,payload").order("id").range(offset, offset + 19);

    if (error) {
      if (/does not exist|Could not find/i.test(error.message)) {
        return caminhos;
      }

      throw new Error(`Lendo os modelos que ficaram: ${error.message}`);
    }

    for (const linha of (data ?? []) as { payload: unknown }[]) {
      caminhos.push(...templateMediaUse(linha).refs.filter((ref) => ref.bucket === BUCKET_DE_IMAGENS).map((ref) => ref.path));
    }

    if (!data || data.length < 20) {
      return caminhos;
    }
  }
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

/** O titulo e a versao (updated_at) de um aviso pelo id: confere que nada gravou o aviso. Falha se nao existe. */
export async function versaoDoAviso(id: string) {
  const db = createLocalAdminClient();

  return unwrap(await db.from("campaigns").select("title,updated_at").eq("id", id).single(), `Lendo a versão do aviso ${id}`) as {
    title: string;
    updated_at: string;
  };
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
  /**
   * v3b-2 (docs/29 §2.2): so com `quando: "first_login"`, os produtos de "A primeira vez com estes produtos" (ids de
   * content_items); vazio ou sem a chave = "A primeira vez na área".
   */
  produtosDoPrimeiroAcesso?: string[];
  /** Quando aparece. Padrao "page_load". v3b-2: "No primeiro acesso" e "Ao concluir um curso". */
  quando?: "course_completed" | "first_login" | "lesson_completed" | "page_load";
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
  const id = await gravarRascunhoDePopUp(input);
  const { fechar, pagina } = await abrirComoProdutor(browser);

  try {
    await pagina.goto(`/admin/comunicacao/avisos/${id}`);
    await pagina.waitForLoadState("networkidle");
    await expect(pagina.getByLabel("Título", { exact: true })).toHaveValue(input.titulo);
    await pagina.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
    await expect(pagina.getByText(/^Pop-up publicado\./)).toBeVisible();
    await expect(pagina).toHaveURL(new RegExp(`/admin/comunicacao/avisos/${id}$`));
  } finally {
    await fechar();
  }

  return id;
}

/**
 * Espera a navegacao de depois de "Publicar pop-up" pelo editor assentar: o editor mostra o toast e so entao faz o
 * router.push para a pagina do aviso, que passa a abrir o relatorio ("Publicar pop-up" some e "Detalhes" aparece).
 * Um page.goto logo depois do toast e interrompido por essa navegacao ("interrupted by another navigation", no
 * WebKit do CI): chame isto antes de trocar de pagina.
 */
export async function esperarAvisoPublicado(page: Page) {
  await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { exact: true, name: "Publicar pop-up" })).toHaveCount(0);
  await expect(page.getByRole("region", { exact: true, name: "Detalhes" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/**
 * Grava o pop-up para todos os alunos direto no banco, como o editor salva (o rascunho de publicarPopUp). Com
 * `aguardandoAprovacao`, como o pedido de aprovacao deixa (v3b-2: o toast de aprovar pela lista). Devolve o id.
 * Desfaca com zerarComunicacao.
 */
export async function gravarRascunhoDePopUp(input: PopUpDeTeste & { aguardandoAprovacao?: boolean }) {
  const db = createLocalAdminClient();
  const contas = (await contasDeTeste(db)) as Record<ChaveDaConta, ContaDeTeste>;
  const frequencia = input.frequencia ?? { mode: "once" };
  const repete = frequencia.mode === "repeat";
  const agora = new Date().toISOString();
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
        // v3b-2: o check campaigns_popup_access_v3b2 so aceita produtos no "No primeiro acesso".
        ...(input.quando === "first_login" ? { popup_access_products: input.produtosDoPrimeiroAcesso ?? [] } : {}),
        ...(input.aguardandoAprovacao ? { requested_at: agora, requested_by: contas.produtor.id } : {}),
        starts_at: input.inicio ?? null,
        status: input.aguardandoAprovacao ? "pending_approval" : "draft",
        title: input.titulo,
        updated_by: contas.produtor.id
      })
      .select("id"),
    `Gravando o rascunho do pop-up "${input.titulo}"`
  ) as { id: string }[];

  return rascunho.id;
}

/**
 * Uma aba do produtor de teste (a sessao guardada pelo setup), com a rede de fora cortada, para um teste que ja usa
 * a pagina da aluna. Feche com `fechar()`.
 */
export async function abrirComoProdutor(browser: Browser, opcoes: { viewport?: { height: number; width: number } } = {}) {
  const contexto = await browser.newContext({
    baseURL: enderecoDoApp,
    locale: "pt-BR",
    storageState: SESSAO_DO_PRODUTOR,
    timezoneId: "America/Sao_Paulo",
    ...(opcoes.viewport ? { viewport: opcoes.viewport } : {})
  });
  await bloquearRedeExterna(contexto);

  return { contexto, fechar: () => contexto.close(), pagina: await contexto.newPage() };
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
 * Espera a entrada da janela do pop-up acabar (docs/27 §13.11.1): a janela nasce com o data-starting-style (opacidade 0
 * e escala de 95 %) e cresce em 200 ms. O toBeVisible ja passa com opacidade 0 e o boundingBox mede a caixa com a
 * escala do meio do caminho; quem mede a janela ou clica por coordenada espera aqui. Com menos movimento, passa logo.
 * Serve tambem para o painel do sino, que cresce de 95 % a 100 % ao abrir (a transicao lista scale).
 */
export async function janelaParada(popUp: Locator) {
  await expect
    .poll(() =>
      popUp.evaluate((element) => {
        const janela = element.closest("[data-member-popup]") ?? element;
        return !janela.hasAttribute("data-starting-style") && getComputedStyle(janela).opacity === "1" && janela.getAnimations().length === 0;
      })
    )
    .toBe(true);
}

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
    /** O X: a cor (com o alfa que a opacidade grava) e o fundo. */
    close: { background: string; color: string };
    fonts: string[];
    /** Os links do rodape: a cor e se o "Não mostrar de novo" aparece. */
    links: { color: string; showDismiss: boolean };
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

/* ------------------------------------------------------------------------------------------------
 * Modelos da Comunicacao (docs/28): o que a tela gravou e os cenarios montados direto no banco
 * ---------------------------------------------------------------------------------------------- */

export type ModeloNoBanco = {
  created_by: string | null;
  design_mode: "custom" | "free" | null;
  id: string;
  kind: "design" | "inbox" | "popup";
  name: string;
  /** O jsonb gravado (versao 1, formato de template-model.ts), sem passar pelo parse. */
  payload: Record<string, unknown>;
  updated_at: string;
};

/** O modelo nao excluido de nome dado, como ficou no banco (falha se nao existe ou se ha mais de um). */
export async function modeloNoBanco(nome: string): Promise<ModeloNoBanco> {
  const db = createLocalAdminClient();
  const linha = unwrap(
    await db.from(TABELA_DE_MODELOS).select("created_by,design_mode,id,kind,name,payload,updated_at").eq("name", nome).is("deleted_at", null).maybeSingle(),
    `Lendo o modelo "${nome}"`
  ) as ModeloNoBanco | null;

  if (!linha) {
    throw new Error(`O modelo "${nome}" nao existe.`);
  }

  return linha;
}

/** Quantos modelos nao excluidos tem o nome dado (0 depois de excluir pela tela). */
export async function contarModelosNoBanco(nome: string) {
  const db = createLocalAdminClient();
  const { count, error } = await db.from(TABELA_DE_MODELOS).select("id", { count: "exact", head: true }).eq("name", nome).is("deleted_at", null);

  if (error) {
    throw new Error(`Contando os modelos "${nome}": ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Monta um modelo direto no banco (cenarios de lista, busca e filtro): SEMPRE com `created_by` do produtor de teste
 * (@bunker707.test), para limparComunicacao apagar. O tipo e o modo do design saem do payload, como no servidor.
 * Devolve o id. Desfaca com zerarComunicacao.
 */
export async function criarModeloNoBanco(payload: TemplatePayload, nome: string) {
  const db = createLocalAdminClient();
  const produtor = await contaDeTeste("produtor");
  const linha = unwrap(
    await db
      .from(TABELA_DE_MODELOS)
      .insert({ created_by: produtor.id, design_mode: templateDesignModeOf(payload), kind: payload.kind, name: nome, payload, updated_by: produtor.id })
      .select("id")
      .single(),
    `Gravando o modelo "${nome}"`
  ) as { id: string };

  return linha.id;
}

/** Os registros "communication.template_used" do aviso (docs/28 §4.8): os modelos de onde ele veio. */
export async function modelosUsadosNoAviso(campaignId: string) {
  const db = createLocalAdminClient();

  return unwrap(
    await db.from("admin_audit_log").select("metadata").eq("action", "communication.template_used").eq("entity_type", "campaign").eq("entity_id", campaignId),
    "Lendo a auditoria do modelo usado"
  ) as { metadata: { created?: boolean; template_ids?: string[] } }[];
}

/** Os ids dos passos (communication_flow_nodes) de um fluxo: os das notificacoes seguintes gravadas. */
export async function idsDosPassosDoFluxo(flowId: string) {
  const db = createLocalAdminClient();
  const passos = unwrap(await db.from("communication_flow_nodes").select("id").eq("flow_id", flowId), "Lendo os passos do fluxo") as { id: string }[];

  return passos.map((passo) => passo.id);
}

/** O segmento ("Para quem") gravado no aviso (fora de fluxo, nao excluido). */
export async function segmentoDoAviso(titulo: string) {
  const db = createLocalAdminClient();
  const aviso = unwrap(
    await db.from("campaigns").select("audience").eq("title", titulo).is("flow_id", null).is("deleted_at", null).single(),
    `Lendo o segmento do aviso "${titulo}"`
  ) as { audience: unknown };

  return aviso.audience;
}

/* ------------------------------------------------------------------------------------------------
 * Comunicacao v3b-2 (docs/29 §9.3): hora marcada, "No primeiro acesso", "Ao concluir um curso", relatorio do
 * pop-up e as paginas falsas dos players de fora (Vimeo e Player.js) servidas nas URLs reais
 * ---------------------------------------------------------------------------------------------- */

/** source_event_id dos acessos liberados por estes testes (um por conta e produto). */
function eventoDoAcessoDeTeste(chave: ChaveDaConta, productId: string) {
  return `e2e-v3b2:${chave}:${productId}`;
}

/**
 * Libera agora o produto para a conta (uma linha de entitlements criada agora, ativa, sem fim), como uma venda
 * aprovada: o "ganhou acesso" do "No primeiro acesso" e o created_at/starts_at dela. Uma linha que sobrou de uma
 * rodada anterior sai antes (a linha e sempre nova). Desfaca com tirarAcessoDeTeste.
 */
export async function liberarAcessoDeTeste(chave: ChaveDaConta, productId: string) {
  const db = createLocalAdminClient();
  const conta = await contaDeTeste(chave);
  const evento = eventoDoAcessoDeTeste(chave, productId);
  const agora = new Date().toISOString();

  unwrap(await db.from("entitlements").delete().eq("user_id", conta.id).eq("source_event_id", evento), "Tirando o acesso de teste anterior");
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: evento,
      source_provider: "manual",
      starts_at: agora,
      status: "active",
      target_id: productId,
      target_type: "standalone_course",
      user_id: conta.id
    }),
    `Liberando ${productId} para ${conta.email}`
  );
}

/** Tira o acesso liberado por liberarAcessoDeTeste (apaga a linha; os acessos da escola de teste ficam). */
export async function tirarAcessoDeTeste(chave: ChaveDaConta, productId: string) {
  const db = createLocalAdminClient();
  const conta = await contaDeTeste(chave);

  unwrap(
    await db.from("entitlements").delete().eq("user_id", conta.id).eq("source_event_id", eventoDoAcessoDeTeste(chave, productId)),
    `Tirando ${productId} de ${conta.email}`
  );
}

/**
 * Recalcula agora quem ve o pop-up (o segmento e, no "No primeiro acesso", quem conta como aluno novo): zera
 * audience_refreshed_at (nulo vence qualquer faixa do recalculo, docs/29 §4.7) e roda o tick do app.
 */
export async function recalcularPopUp(campaignId: string) {
  const db = createLocalAdminClient();

  unwrap(await db.from("campaigns").update({ audience_refreshed_at: null }).eq("id", campaignId), "Pedindo o recalculo do pop-up");
  await rodarTick();
}

/**
 * Grava direto as aulas concluidas da conta num conteudo (lesson_progress.completed_lesson_ids, a lista inteira,
 * como a rota de progresso grava): arranjo para "Ao concluir um curso" (todas menos a ultima). Desfaca com
 * zerarProgressoDosAlunos.
 */
export async function concluirAulasDaAluna(contentId: string, lessonIds: string[], chave: ChaveDaConta = "aluna") {
  const db = createLocalAdminClient();
  const conta = await contaDeTeste(chave);

  unwrap(
    await db
      .from("lesson_progress")
      .upsert({ completed_lesson_ids: lessonIds, content_id: contentId, updated_at: new Date().toISOString(), user_id: conta.id }, { onConflict: "user_id,content_id" }),
    `Concluindo aulas de ${contentId}`
  );
}

/** As aulas concluidas da conta num conteudo, lidas do banco ([] sem linha). */
export async function aulasConcluidasDaAluna(contentId: string, chave: ChaveDaConta = "aluna") {
  const db = createLocalAdminClient();
  const conta = await contaDeTeste(chave);
  const linha = unwrap(
    await db.from("lesson_progress").select("completed_lesson_ids").eq("user_id", conta.id).eq("content_id", contentId).maybeSingle(),
    "Lendo as aulas concluidas"
  ) as { completed_lesson_ids: string[] } | null;

  return linha?.completed_lesson_ids ?? [];
}

export type LinhaDoRelatorio = { item: string; metric: string; students: number; total: number };

/** Os numeros do relatorio do pop-up como o banco devolve (RPC communication_popup_report, so service role). */
export async function relatorioDoPopUp(campaignId: string): Promise<LinhaDoRelatorio[]> {
  const db = createLocalAdminClient();
  const linhas = unwrap(await db.rpc("communication_popup_report", { p_campaign_id: campaignId }), "Lendo o relatorio do pop-up") as {
    item: string;
    metric: string;
    students: number | string;
    total: number | string;
  }[];

  return linhas.map((linha) => ({ item: linha.item, metric: linha.metric, students: Number(linha.students), total: Number(linha.total) }));
}

/** O momento (occurred_at) de cada evento do historico do pop-up para a conta, na ordem. */
export async function horariosDoPopUp(campaignId: string, chave: ChaveDaConta = "aluna") {
  const db = createLocalAdminClient();
  const conta = await contaDeTeste(chave);

  return unwrap(
    await db
      .from("student_events")
      .select("event_type,occurred_at")
      .eq("entity_type", "campaign")
      .eq("entity_id", campaignId)
      .eq("user_id", conta.id)
      .order("occurred_at", { ascending: true }),
    "Lendo os horarios do historico do pop-up"
  ) as { event_type: string; occurred_at: string }[];
}

export type OpcoesDoPlayerFalso = {
  /** Duracao do video em segundos (o tempo do "Terminar"). Padrao 120. */
  duracao?: number;
  /**
   * Manda o `ready` so este tempo depois de carregar (ms), como a Bunny legada (o receptor nasce no `loadeddata`).
   * Padrao: no `load`.
   */
  prontoDepoisDe?: number;
};

type ConfigDoPlayerFalso = Required<OpcoesDoPlayerFalso> & {
  /** Os formatos das mensagens: os do player (vimeo ou playerjs); os dois na pagina de outra origem. */
  protocolos: ("playerjs" | "vimeo")[];
  /** Manda os eventos mesmo sem inscricao (a pagina de outra origem, que ninguem ouve). */
  semInscricao: boolean;
};

/**
 * A pagina falsa de um player de fora: botoes Tocar, Pausar e Terminar e o estado ("carregando", "pronto" depois
 * de responder o getPaused, que e o que confirma a ponte do lado da aula). Fala como o player de verdade (docs/29
 * §4.4): manda para window.parent com a targetOrigin da origem do referrer; no Vimeo, `{event:"ready"}` so no
 * `load`, o `ping` respondido com `{method:"ping"}` (nunca com ready), inscricoes `addEventListener` e
 * `{method:"getPaused",value}`; no Player.js, texto JSON com context "player.js", ready no `load` e de novo a quem
 * se inscreve no `ready`, inscricoes com `listener` e a resposta do getPaused com o listener pedido. Os eventos so
 * saem para quem se inscreveu.
 */
function htmlDoPlayerFalso(config: ConfigDoPlayerFalso) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Player de teste</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; background: #111; color: #fff; font: 14px sans-serif; }
  button { min-height: 44px; padding: 0 16px; font: inherit; }
</style>
</head>
<body>
<button id="tocar" type="button">Tocar</button>
<button id="pausar" type="button">Pausar</button>
<button id="terminar" type="button">Terminar</button>
<p id="estado" role="status">carregando</p>
<p id="tempo" data-testid="tempo">0</p>
<p id="som" data-testid="som">som</p>
<p id="ultimo-salto" data-testid="ultimo-salto"></p>
<script>
(() => {
  const CONFIG = ${JSON.stringify(config)};
  const VERSAO = "0.1.0";
  // A janela da aula (o pai direto); sem ancestorOrigins, a origem do referrer, como os players fazem.
  const destino = (() => {
    if (location.ancestorOrigins && location.ancestorOrigins.length > 0) {
      return location.ancestorOrigins[0];
    }
    try {
      return new URL(document.referrer).origin;
    } catch {
      return "*";
    }
  })();
  const estado = document.getElementById("estado");
  const tempo = document.getElementById("tempo");
  const som = document.getElementById("som");
  const ultimoSalto = document.getElementById("ultimo-salto");
  const inscritos = new Map();
  const parametros = new URLSearchParams(location.search);
  // A sala da Live gravada (docs/30 §6.6) abre o player com autoplay=true&muted=true: a pagina falsa toca sozinha,
  // sem som, e anda 1 s por segundo. O t= do endereco e ignorado de proposito: a trava da sala precisa recolocar o
  // player no segundo certo (setCurrentTime), e o teste le o salto em #ultimo-salto.
  const autoplay = parametros.get("autoplay") === "true";
  let pausado = true;
  let segundos = 0;
  let mudo = parametros.get("muted") === "true";
  som.textContent = mudo ? "mudo" : "som";

  function mostrarTempo() {
    tempo.textContent = String(Math.floor(segundos));
  }

  setInterval(() => {
    if (!pausado && autoplay) {
      segundos += 1;
      mostrarTempo();
      emitir("timeupdate");
    }
  }, 1000);

  function postar(mensagem) {
    window.parent.postMessage(mensagem, destino);
  }

  function prontoPlayerJs(listener) {
    const mensagem = { context: "player.js", version: VERSAO, event: "ready", value: { src: location.href, events: ["play", "pause", "ended", "timeupdate"], methods: ["play", "pause", "getPaused"] } };
    return JSON.stringify(listener ? { ...mensagem, listener } : mensagem);
  }

  function pronto() {
    if (CONFIG.protocolos.includes("vimeo")) {
      postar({ event: "ready", player_id: "player-de-teste" });
    }
    if (CONFIG.protocolos.includes("playerjs")) {
      postar(prontoPlayerJs(null));
    }
  }

  function emitir(nome) {
    const tempo = { seconds: segundos, duration: CONFIG.duracao };
    if (CONFIG.protocolos.includes("vimeo") && (CONFIG.semInscricao || inscritos.has(nome))) {
      postar({ event: nome, data: { ...tempo, percent: CONFIG.duracao > 0 ? segundos / CONFIG.duracao : 0 } });
    }
    if (CONFIG.protocolos.includes("playerjs") && (CONFIG.semInscricao || inscritos.has(nome))) {
      const mensagem = { context: "player.js", version: VERSAO, event: nome, listener: inscritos.get(nome) ?? undefined };
      postar(JSON.stringify(nome === "timeupdate" || nome === "ended" || nome === "seeked" ? { ...mensagem, value: tempo } : mensagem));
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) {
      return;
    }
    let dados = event.data;
    if (typeof dados === "string") {
      try {
        dados = JSON.parse(dados);
      } catch {
        return;
      }
    }
    if (!dados || typeof dados !== "object") {
      return;
    }
    if (CONFIG.protocolos[0] === "vimeo") {
      if (dados.method === "ping") {
        postar({ method: "ping" });
      } else if (dados.method === "addEventListener" && typeof dados.value === "string") {
        inscritos.set(dados.value, true);
      } else if (dados.method === "getPaused") {
        postar({ method: "getPaused", value: pausado });
        estado.textContent = "pronto";
      }
      return;
    }
    if (dados.context !== "player.js") {
      return;
    }
    if (dados.method === "addEventListener" && typeof dados.value === "string") {
      if (dados.value === "ready") {
        postar(prontoPlayerJs(dados.listener));
      } else {
        inscritos.set(dados.value, typeof dados.listener === "string" ? dados.listener : null);
      }
    } else if (dados.method === "getPaused") {
      postar(JSON.stringify({ context: "player.js", version: VERSAO, event: "getPaused", value: pausado, listener: dados.listener }));
      estado.textContent = "pronto";
    } else if (dados.method === "getCurrentTime") {
      postar(JSON.stringify({ context: "player.js", version: VERSAO, event: "getCurrentTime", value: segundos, listener: dados.listener }));
    } else if (dados.method === "setCurrentTime" && typeof dados.value === "number") {
      // Os comandos da sala travada (docs/30 §6.6): o salto fica visivel para o teste.
      segundos = dados.value;
      ultimoSalto.textContent = String(Math.round(dados.value));
      mostrarTempo();
      emitir("seeked");
      emitir("timeupdate");
    } else if (dados.method === "play") {
      pausado = false;
      emitir("play");
    } else if (dados.method === "pause") {
      pausado = true;
      emitir("pause");
    } else if (dados.method === "mute") {
      mudo = true;
      som.textContent = "mudo";
    } else if (dados.method === "unmute") {
      mudo = false;
      som.textContent = "som";
    }
  });

  document.getElementById("tocar").addEventListener("click", () => {
    pausado = false;
    segundos = Math.max(segundos, 1);
    emitir("play");
    emitir("timeupdate");
  });
  document.getElementById("pausar").addEventListener("click", () => {
    pausado = true;
    emitir("pause");
  });
  document.getElementById("terminar").addEventListener("click", () => {
    pausado = true;
    segundos = CONFIG.duracao;
    emitir("timeupdate");
    emitir("ended");
  });

  function comecar() {
    pronto();
    if (autoplay) {
      pausado = false;
      mostrarTempo();
      emitir("play");
    }
  }

  window.addEventListener("load", () => {
    if (CONFIG.prontoDepoisDe > 0) {
      setTimeout(comecar, CONFIG.prontoDepoisDe);
    } else {
      comecar();
    }
  });
})();
</script>
</body>
</html>`;
}

/** Serve a pagina falsa em toda URL da origem (so o documento; o resto da 404, nunca sai da maquina). */
async function servirPlayerFalso(page: Page, origem: string, config: ConfigDoPlayerFalso) {
  const html = htmlDoPlayerFalso(config);

  // page.route vence o corte de rede do contexto (bloquearRedeExterna): o iframe fica com a origem verdadeira.
  await page.route(`${origem}/**`, (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill({ body: html, contentType: "text/html; charset=utf-8", status: 200 })
      : route.fulfill({ body: "", status: 404 })
  );
}

/**
 * O player do Vimeo de mentira em https://player.vimeo.com/** (docs/29 §4.4 e §9.3): o iframe da aula com Vimeo carrega
 * esta pagina com a origem verdadeira, e a conferencia de origem da ponte e exercitada de verdade.
 */
export async function paginaFalsaDoVimeo(page: Page, opcoes: OpcoesDoPlayerFalso = {}) {
  await servirPlayerFalso(page, "https://player.vimeo.com", {
    duracao: opcoes.duracao ?? 120,
    prontoDepoisDe: opcoes.prontoDepoisDe ?? 0,
    protocolos: ["vimeo"],
    semInscricao: false
  });
}

/**
 * O player Player.js de mentira (Bunny e Mux) na origem dada (https://iframe.mediadelivery.net,
 * https://player.mediadelivery.net ou https://player.mux.com). `redirecionarDe`: o endereco gravado na aula leva a
 * mesma pagina nesta origem (o iframe.mediadelivery.net que passa a levar ao player novo, crítica 28 da docs/29): o
 * src fica numa origem e as mensagens chegam da outra, do mesmo grupo.
 */
export async function paginaFalsaPlayerJs(page: Page, origem: string, opcoes: OpcoesDoPlayerFalso & { redirecionarDe?: string } = {}) {
  await servirPlayerFalso(page, origem, {
    duracao: opcoes.duracao ?? 120,
    prontoDepoisDe: opcoes.prontoDepoisDe ?? 0,
    protocolos: ["playerjs"],
    semInscricao: false
  });

  if (opcoes.redirecionarDe) {
    // O documento do endereco gravado troca a si mesmo pelo da outra origem (um 302 do page.route nao serve: o
    // Playwright nao intercepta o pedido redirecionado, que sairia para a rede).
    const html = `<!doctype html><meta charset="utf-8"><title>Redirecionando</title><script>location.replace(${JSON.stringify(origem)} + location.pathname + location.search);</script>`;

    await page.route(`${opcoes.redirecionarDe}/**`, (route) =>
      route.request().resourceType() === "document"
        ? route.fulfill({ body: html, contentType: "text/html; charset=utf-8", status: 200 })
        : route.fulfill({ body: "", status: 404 })
    );
  }
}

/**
 * Um player de fora que a pagina nao le (vimeo colado de outro site, outra origem): manda os eventos nos dois
 * formatos, sem esperar inscricao, para window.parent. Ninguem do lado da aula deve ouvir.
 */
export async function paginaFalsaDeOutroPlayer(page: Page, origem: string, opcoes: OpcoesDoPlayerFalso = {}) {
  await servirPlayerFalso(page, origem, {
    duracao: opcoes.duracao ?? 120,
    prontoDepoisDe: opcoes.prontoDepoisDe ?? 0,
    protocolos: ["vimeo", "playerjs"],
    semInscricao: true
  });
}

/** O player de fora da aula (o iframe do palco). No WebKit, clicar la dentro so por aqui. */
export function playerDeFora(page: Page) {
  return page.frameLocator("[data-lesson-player-stage] iframe");
}

/** Espera a pagina falsa do player responder o getPaused (a ponte do lado da aula confirma com essa resposta). */
export async function esperarPlayerDeForaPronto(page: Page) {
  await expect(playerDeFora(page).locator("#estado")).toHaveText("pronto", { timeout: 20_000 });
}

/**
 * Toca na capa do player de fora (o botao transparente "Reproduzir aula" por cima do iframe, que some quando a
 * aula comeca). Clica ate ela sumir: o primeiro clique logo depois de abrir a pagina pode chegar antes da hidratacao.
 */
export async function tocarNaCapaDoPlayer(page: Page) {
  const capa = page.locator("[data-lesson-player-stage]").locator("..").getByRole("button", { exact: true, name: "Reproduzir aula" });

  await expect(async () => {
    if (await capa.isVisible()) {
      await capa.click({ timeout: 2_000 });
    }
    await expect(capa).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Segura a resposta do resumo do sino (GET /api/notifications/summary, que traz o plano dos pop-ups) ate `soltar()`.
 * O "Quanto tempo depois" conta da montagem da pagina; segurando o plano, o teste faz o que precisa antes de o host
 * poder armar, sem depender de a pagina (e o player de fora) carregar antes desse tempo, como no WebKit do CI.
 */
export async function segurarResumoDoSino(page: Page) {
  let soltar: () => void = () => undefined;
  const solto = new Promise<void>((resolve) => {
    soltar = resolve;
  });

  await page.route(/\/api\/notifications\/summary(\?|$)/, async (route) => {
    await solto;
    await route.continue();
  });

  return { soltar };
}
