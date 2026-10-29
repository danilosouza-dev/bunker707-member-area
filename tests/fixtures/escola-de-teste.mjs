import { unwrap } from "../support/local-db.mjs";

// Escola de teste (docs/18 §2.5): uma escola ficticia, pequena e previsivel, criada do zero no
// Supabase LOCAL por `npm run db:start`. Nenhum dado aqui e de pessoa real; os e-mails usam o
// dominio reservado .test, que nunca entrega nada. A funcao `seedEscolaDeTeste` e idempotente:
// pode rodar quantas vezes for preciso que o resultado e o mesmo.

/** Senha das contas de teste. So vale no Supabase local; nunca use em conta real. */
export const SENHA_DE_TESTE = "bunker707-teste-2026";

export const ESCOLA_DE_TESTE = {
  contas: {
    aluna: { email: "aluna.teste@bunker707.test", nome: "Aluna de Teste" },
    /** Comprou o curso, mas o acesso terminou ontem. */
    alunaAcessoExpirado: { email: "aluna.expirada@bunker707.test", nome: "Aluna Acesso Expirado" },
    alunoSemAcesso: { email: "aluno.sem-acesso@bunker707.test", nome: "Aluno Sem Acesso" },
    analista: { email: "analista.teste@bunker707.test", nome: "Analista de Teste" },
    /** Equipe com alcance so no curso comprado pela aluna (Professor). */
    professor: { email: "professor.teste@bunker707.test", nome: "Professor de Teste" },
    produtor: { email: "produtor.teste@bunker707.test", nome: "Produtor de Teste" }
  },
  /** Curso que a aluna comprou: 2 modulos, 3 aulas publicadas. */
  curso: {
    aulas: {
      aula1: "teste-aula-1",
      aula2: "teste-aula-2",
      aula3: "teste-aula-3"
    },
    id: "teste-curso-agentes",
    modulos: {
      modulo1: "teste-modulo-1",
      modulo2: "teste-modulo-2"
    },
    titulo: "Curso de Teste: Agentes de IA"
  },
  /** Curso a venda que ninguem comprou: aparece bloqueado para a aluna. */
  cursoBloqueado: {
    aulas: { aula1: "teste-aula-bloqueada-1" },
    id: "teste-curso-bloqueado",
    modulos: { modulo1: "teste-modulo-bloqueado-1" },
    titulo: "Curso de Teste: Bloqueado"
  },
  /** Materiais de apoio (lesson_materials) das aulas de teste. */
  materiais: {
    apostila: "aaaaaaaa-0000-4000-8000-000000000001",
    checklist: "aaaaaaaa-0000-4000-8000-000000000002",
    daAulaFutura: "aaaaaaaa-0000-4000-8000-000000000004",
    rascunho: "aaaaaaaa-0000-4000-8000-000000000003"
  },
  /** Curso que a aluna tambem comprou: 1 aula liberada, 1 com data futura e 1 em rascunho. */
  cursoLiberacao: {
    aulas: {
      futura: "teste-aula-futura",
      liberada: "teste-aula-liberada",
      rascunho: "teste-aula-rascunho"
    },
    id: "teste-curso-liberacao",
    modulos: { modulo1: "teste-modulo-liberacao-1" },
    titulo: "Curso de Teste: Liberação"
  }
};

/** Data fixa de liberacao da aula futura (bem longe, para o teste nunca virar). */
export const DATA_DE_LIBERACAO_FUTURA = "2099-01-01T12:00:00.000Z";

/** Inicio dos acessos de teste: meio-dia UTC, para cair em 01/01/2026 tambem no fuso da escola (Sao Paulo). */
export const INICIO_DO_ACESSO = "2026-01-01T12:00:00.000Z";

const VIDEO_DE_TESTE = { provider: "youtube", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" };

function contentItemRows() {
  const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;

  return [
    {
      access_label: null,
      access_model: "closed",
      bucket: "courses",
      commerce_scope: "sellable_product",
      description: "Curso ficticio com aulas em liberacao e em rascunho.",
      eyebrow: "Curso",
      id: cursoLiberacao.id,
      image: "/hero/bunker-707-red-front-hero.png",
      is_locked: false,
      kind: "Curso",
      lessons_label: "2 aulas",
      listing: "listed",
      progress: 0,
      publication_status: "published",
      purchase_label: "Comprar",
      purchase_url: "https://exemplo.test/comprar/liberacao",
      sort_order: 3,
      status: "Bloqueado",
      title: cursoLiberacao.titulo
    },
    {
      access_label: null,
      access_model: "closed",
      bucket: "courses",
      commerce_scope: "sellable_product",
      description: "Curso ficticio da escola de teste. Serve so para os testes automatizados.",
      eyebrow: "Curso",
      id: curso.id,
      image: "/hero/bunker-ai-hero.png",
      is_locked: false,
      kind: "Curso",
      lessons_label: "3 aulas",
      listing: "listed",
      progress: 0,
      publication_status: "published",
      purchase_label: "Comprar",
      purchase_url: "https://exemplo.test/comprar/agentes",
      sort_order: 1,
      status: "Bloqueado",
      title: curso.titulo
    },
    {
      access_label: null,
      access_model: "closed",
      bucket: "courses",
      commerce_scope: "sellable_product",
      description: "Curso ficticio que a aluna de teste nao comprou.",
      eyebrow: "Curso",
      id: cursoBloqueado.id,
      image: "/hero/bunker-707-neon-hero.png",
      is_locked: false,
      kind: "Curso",
      lessons_label: "1 aula",
      listing: "listed",
      progress: 0,
      publication_status: "published",
      purchase_label: "Comprar",
      purchase_url: "https://exemplo.test/comprar/bloqueado",
      sort_order: 2,
      status: "Bloqueado",
      title: cursoBloqueado.titulo
    }
  ];
}

function moduleRows() {
  const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;

  return [
    {
      description: "Modulo do curso de liberacao.",
      eyebrow: "Módulo 1",
      id: cursoLiberacao.modulos.modulo1,
      image: "/hero/bunker-707-red-front-hero.png",
      meta: "2 aulas",
      owner_id: cursoLiberacao.id,
      owner_kind: "Curso",
      progress: 0,
      sort_order: 1,
      status: "published",
      title: "Módulo 1: Liberação"
    },
    {
      description: "Primeiro modulo do curso de teste.",
      eyebrow: "Módulo 1",
      id: curso.modulos.modulo1,
      image: "/hero/bunker-707-neon-hero.png",
      meta: "2 aulas",
      owner_id: curso.id,
      owner_kind: "Curso",
      progress: 0,
      sort_order: 1,
      status: "published",
      title: "Módulo 1: Fundamentos"
    },
    {
      description: "Segundo modulo do curso de teste.",
      eyebrow: "Módulo 2",
      id: curso.modulos.modulo2,
      image: "/hero/bunker-707-red-neon-hero.png",
      meta: "1 aula",
      owner_id: curso.id,
      owner_kind: "Curso",
      progress: 0,
      sort_order: 2,
      status: "published",
      title: "Módulo 2: Na prática"
    },
    {
      description: "Modulo do curso bloqueado.",
      eyebrow: "Módulo 1",
      id: cursoBloqueado.modulos.modulo1,
      image: "/hero/bunker-707-neon-hero.png",
      meta: "1 aula",
      owner_id: cursoBloqueado.id,
      owner_kind: "Curso",
      progress: 0,
      sort_order: 1,
      status: "published",
      title: "Módulo 1: Introdução"
    }
  ];
}

function lessonRows() {
  const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;

  return [
    {
      completed: false,
      description: "Aula liberada na hora.",
      duration: "5 min",
      id: cursoLiberacao.aulas.liberada,
      module_id: cursoLiberacao.modulos.modulo1,
      release_rule: { mode: "immediate" },
      sort_order: 1,
      status: "published",
      title: "Aula liberada",
      video_config: VIDEO_DE_TESTE
    },
    {
      completed: false,
      description: "Aula com data de liberacao no futuro.",
      duration: "5 min",
      id: cursoLiberacao.aulas.futura,
      module_id: cursoLiberacao.modulos.modulo1,
      release_rule: { fixedDate: DATA_DE_LIBERACAO_FUTURA, mode: "fixed_date" },
      sort_order: 2,
      status: "published",
      title: "Aula com liberação futura",
      video_config: VIDEO_DE_TESTE
    },
    {
      completed: false,
      description: "Aula ainda em rascunho: o aluno nao ve.",
      duration: "5 min",
      id: cursoLiberacao.aulas.rascunho,
      module_id: cursoLiberacao.modulos.modulo1,
      sort_order: 3,
      status: "draft",
      title: "Aula em rascunho",
      video_config: VIDEO_DE_TESTE
    },
    {
      completed: false,
      description: "O que e um agente de IA e por que ele importa.",
      duration: "10 min",
      id: curso.aulas.aula1,
      module_id: curso.modulos.modulo1,
      sort_order: 1,
      status: "published",
      title: "Aula 1: O que é um agente",
      video_config: VIDEO_DE_TESTE
    },
    {
      completed: false,
      description: "As pecas de um agente: modelo, ferramentas e memoria.",
      duration: "12 min",
      id: curso.aulas.aula2,
      module_id: curso.modulos.modulo1,
      sort_order: 2,
      status: "published",
      title: "Aula 2: As peças de um agente",
      video_config: VIDEO_DE_TESTE
    },
    {
      completed: false,
      description: "Montando o primeiro agente do zero.",
      duration: "15 min",
      id: curso.aulas.aula3,
      module_id: curso.modulos.modulo2,
      sort_order: 1,
      status: "published",
      title: "Aula 3: Seu primeiro agente",
      video_config: VIDEO_DE_TESTE
    },
    {
      completed: false,
      description: "Aula do curso bloqueado.",
      duration: "8 min",
      id: cursoBloqueado.aulas.aula1,
      module_id: cursoBloqueado.modulos.modulo1,
      sort_order: 1,
      status: "published",
      title: "Aula 1: Introdução",
      video_config: VIDEO_DE_TESTE
    }
  ];
}

function materialRows() {
  const { curso, cursoLiberacao, materiais } = ESCOLA_DE_TESTE;

  return [
    {
      description: "Resumo da aula em PDF.",
      file_size_bytes: 120_000,
      file_type: "pdf",
      file_url: "https://exemplo.test/materiais/apostila-aula-1.pdf",
      id: materiais.apostila,
      lesson_id: curso.aulas.aula1,
      sort_order: 1,
      status: "published",
      title: "Apostila da aula 1",
      unlock_rule: "none"
    },
    {
      description: "Libera depois de assistir metade da aula.",
      file_type: "document",
      file_url: "https://exemplo.test/materiais/checklist-aula-1.docx",
      id: materiais.checklist,
      lesson_id: curso.aulas.aula1,
      sort_order: 2,
      status: "published",
      title: "Checklist da aula 1",
      unlock_rule: "lesson_progress",
      unlock_threshold: 50
    },
    {
      description: "Ainda em rascunho: o aluno nao ve.",
      file_type: "link",
      file_url: "https://exemplo.test/materiais/rascunho",
      id: materiais.rascunho,
      lesson_id: curso.aulas.aula1,
      sort_order: 3,
      status: "draft",
      title: "Material em rascunho",
      unlock_rule: "none"
    },
    {
      description: "Material de uma aula que ainda nao foi liberada.",
      file_type: "pdf",
      file_url: "https://exemplo.test/materiais/aula-futura.pdf",
      id: materiais.daAulaFutura,
      lesson_id: cursoLiberacao.aulas.futura,
      sort_order: 1,
      status: "published",
      title: "Material da aula futura",
      unlock_rule: "none"
    }
  ];
}

async function findAccountByEmail(db, email) {
  const { users } = unwrap(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Lendo contas de teste");

  return users.find((user) => user.email?.toLowerCase() === email) ?? null;
}

/**
 * Cria a conta no Auth local, com e-mail confirmado e a senha de teste. Conta que ja existe fica como
 * esta: trocar a senha (mesmo pela mesma) derruba as sessoes abertas, e os testes de navegador
 * reaproveitam o login guardado. Para recriar do zero, `npm run db:reset`.
 */
async function ensureAccount(db, conta) {
  const existing = await findAccountByEmail(db, conta.email);

  if (existing) {
    return existing.id;
  }

  const { user } = unwrap(
    await db.auth.admin.createUser({
      email: conta.email,
      email_confirm: true,
      password: SENHA_DE_TESTE,
      user_metadata: { full_name: conta.nome }
    }),
    `Criando a conta ${conta.email}`
  );

  return user.id;
}

/**
 * Objeto no formato do usuario autenticado (AuthenticatedUser do app), para passar a getHomePageData,
 * getLessonPageData e companhia nos testes de integracao.
 */
export function usuarioDeTeste(conta) {
  return {
    app_metadata: { provider: "email", providers: ["email"] },
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    email: conta.email,
    id: conta.id,
    user_metadata: { full_name: conta.nome }
  };
}

/** As contas de teste ja criadas (`{ aluna, ... }`, cada uma `{ email, id, nome }`), sem gravar nada. */
export async function contasDeTeste(db) {
  const contas = {};

  for (const [chave, conta] of Object.entries(ESCOLA_DE_TESTE.contas)) {
    const existing = await findAccountByEmail(db, conta.email);

    if (!existing) {
      throw new Error(`A conta de teste ${conta.email} nao existe. Rode \`npm run db:seed\`.`);
    }

    contas[chave] = { ...conta, id: existing.id };
  }

  return contas;
}

/**
 * Cria a escola de teste no Supabase local e devolve as contas com os ids do Auth:
 * `{ aluna, alunoSemAcesso, analista, produtor }`, cada uma `{ email, id, nome }`.
 */
export async function seedEscolaDeTeste(db) {
  const contas = {};

  for (const [chave, conta] of Object.entries(ESCOLA_DE_TESTE.contas)) {
    contas[chave] = { ...conta, id: await ensureAccount(db, conta) };
  }

  unwrap(
    await db.from("profiles").upsert(
      Object.values(contas).map((conta) => ({ email: conta.email, full_name: conta.nome, id: conta.id })),
      { onConflict: "id" }
    ),
    "Gravando perfis de teste"
  );

  // Equipe: produtor e dono da escola; analista so le; professor so alcanca o curso da aluna.
  // Alunos nunca entram em admin_roles.
  unwrap(
    await db.from("admin_roles").upsert(
      [
        { permissions: {}, role: "owner", user_id: contas.produtor.id },
        { permissions: {}, role: "analyst", user_id: contas.analista.id },
        { permissions: { productIds: [ESCOLA_DE_TESTE.curso.id] }, role: "instructor", user_id: contas.professor.id }
      ],
      { onConflict: "user_id" }
    ),
    "Gravando equipe de teste"
  );
  unwrap(
    await db
      .from("admin_roles")
      .delete()
      .in("user_id", [contas.aluna.id, contas.alunoSemAcesso.id, contas.alunaAcessoExpirado.id]),
    "Tirando alunos de teste da equipe"
  );

  unwrap(await db.from("content_items").upsert(contentItemRows(), { onConflict: "id" }), "Gravando cursos de teste");
  unwrap(await db.from("course_modules").upsert(moduleRows(), { onConflict: "id" }), "Gravando modulos de teste");
  unwrap(await db.from("lessons").upsert(lessonRows(), { onConflict: "id" }), "Gravando aulas de teste");
  unwrap(await db.from("lesson_materials").upsert(materialRows(), { onConflict: "id" }), "Gravando materiais de teste");

  // Acesso: a aluna comprou dois cursos; a aluna expirada comprou o curso, mas o acesso acabou ontem;
  // o aluno sem acesso nao tem nada.
  const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  unwrap(
    await db.from("entitlements").upsert(
      [
        {
          ends_at: null,
          source_event_id: "escola-de-teste:aluna:curso-agentes",
          source_provider: "manual",
          starts_at: INICIO_DO_ACESSO,
          status: "active",
          target_id: ESCOLA_DE_TESTE.curso.id,
          target_type: "standalone_course",
          user_id: contas.aluna.id
        },
        {
          ends_at: null,
          source_event_id: "escola-de-teste:aluna:curso-liberacao",
          source_provider: "manual",
          starts_at: INICIO_DO_ACESSO,
          status: "active",
          target_id: ESCOLA_DE_TESTE.cursoLiberacao.id,
          target_type: "standalone_course",
          user_id: contas.aluna.id
        },
        {
          ends_at: ontem,
          source_event_id: "escola-de-teste:expirada:curso-agentes",
          source_provider: "manual",
          starts_at: INICIO_DO_ACESSO,
          status: "active",
          target_id: ESCOLA_DE_TESTE.curso.id,
          target_type: "standalone_course",
          user_id: contas.alunaAcessoExpirado.id
        }
      ],
      { onConflict: "user_id,source_event_id" }
    ),
    "Gravando acessos de teste"
  );
  unwrap(
    await db.from("entitlements").delete().eq("user_id", contas.alunoSemAcesso.id),
    "Tirando acessos do aluno sem acesso"
  );

  return contas;
}

/** Apaga os produtos criados por um teste (titulo comecando com o prefixo): modulos e aulas vao junto. */
export async function apagarProdutosDeTeste(db, prefixoDoTitulo) {
  unwrap(await db.from("content_items").delete().like("title", `${prefixoDoTitulo}%`), "Apagando produtos de teste");
}

/** Capa de um produto por arranjo do teste (um link https, que o app guarda como esta). */
export async function definirCapaDoProduto(db, titulo, image = "https://exemplo.test/capas/produto-de-teste.webp") {
  unwrap(await db.from("content_items").update({ image }).eq("title", titulo), "Definindo a capa do produto de teste");
}

/** Apaga configuracoes da area de membros gravadas por um teste (platform_settings), para a home e o login voltarem ao padrao. */
export async function limparConfiguracoesDeTeste(db, keys) {
  unwrap(await db.from("platform_settings").delete().in("key", keys), "Limpando configuracoes de teste");
}

/** Apaga uma conta criada por um teste (por e-mail), se existir: sai da equipe e some do Auth. */
export async function apagarContaDeTeste(db, email) {
  const existing = await findAccountByEmail(db, email.toLowerCase());

  if (existing) {
    unwrap(await db.from("admin_roles").delete().eq("user_id", existing.id), "Tirando a conta de teste da equipe");
    unwrap(await db.auth.admin.deleteUser(existing.id), `Apagando a conta ${email}`);
  }
}

/** Tira a foto do perfil das contas informadas: limpa profiles.avatar_url e apaga os arquivos do bucket. */
export async function limparFotoDoPerfil(db, userIds) {
  unwrap(await db.from("profiles").update({ avatar_url: null }).in("id", userIds), "Limpando foto do perfil");
  unwrap(await db.from("lesson_comments").update({ author_avatar_url: null }).in("author_id", userIds), "Limpando foto nos comentarios");

  for (const userId of userIds) {
    const { data } = await db.storage.from("content-assets").list(`avatars/${userId}`);
    const paths = (data ?? []).map((object) => `avatars/${userId}/${object.name}`);

    if (paths.length > 0) {
      unwrap(await db.storage.from("content-assets").remove(paths), "Apagando fotos do bucket");
    }
  }
}

/** Apaga os comentarios (e, por cascata, reacoes e denuncias) escritos pelas contas informadas. */
export async function limparComentarios(db, userIds) {
  unwrap(await db.from("lesson_comments").delete().in("author_id", userIds), "Limpando comentarios de teste");
}

/** Apaga as conversas (e mensagens) do Tutor IA e da IA Diretor das contas informadas. */
export async function limparConversasDeIa(db, userIds) {
  unwrap(await db.from("ai_messages").delete().in("user_id", userIds), "Limpando mensagens de IA de teste");
  unwrap(await db.from("ai_conversations").delete().in("user_id", userIds), "Limpando conversas de IA de teste");
}

/** Apaga a transcricao, os trechos e o perfil de IA de uma aula (o Tutor volta a ficar sem conteudo). */
export async function limparTranscricaoDeTeste(db, lessonId) {
  unwrap(await db.from("lesson_ai_profiles").delete().eq("lesson_id", lessonId), "Limpando perfil de IA da aula de teste");
  unwrap(await db.from("content_chunks").delete().eq("lesson_id", lessonId), "Limpando trechos da aula de teste");
  unwrap(await db.from("lesson_transcripts").delete().eq("lesson_id", lessonId), "Limpando transcricao da aula de teste");
}

/** Apaga toda configuracao de provedor de IA do banco local (politicas e conexoes). */
export async function limparProvedoresDeIa(db) {
  unwrap(await db.from("ai_provider_connections").delete().not("id", "is", null), "Limpando conexoes de IA de teste");
  unwrap(await db.from("ai_provider_configs").delete().not("provider", "is", null), "Limpando politicas de IA de teste");
}

/** Apaga as sessoes de TV (e os eventos dessas sessoes) das contas informadas. */
export async function limparSessoesDeTv(db, userIds) {
  unwrap(await db.from("student_events").delete().in("user_id", userIds).eq("entity_type", "tv_session"), "Limpando eventos de TV de teste");
  unwrap(await db.from("tv_sessions").delete().in("user_id", userIds), "Limpando sessoes de TV de teste");
}

/* ------------------------------------------------------------------------------------------------
 * Vendas (Configuracoes > Vendas, migracao 202610170003)
 * ---------------------------------------------------------------------------------------------- */

/** Pacote de teste vendido pela Hotmart: libera o curso de liberacao e o curso bloqueado de uma vez. */
export const PACOTE_DE_TESTE = {
  id: "teste-pacote-vendas",
  nome: "Pacote de Teste: Vendas",
  produtos: [ESCOLA_DE_TESTE.cursoLiberacao.id, ESCOLA_DE_TESTE.cursoBloqueado.id]
};

/** Desconecta todas as plataformas (token apagado, situacao "nao conectada"), como no banco recem-migrado. */
export async function desconectarVendas(db) {
  unwrap(
    await db
      .from("integration_settings")
      .update({ events: [], last_error: null, last_sync_at: null, secret: null, secret_status: "missing", secret_updated_at: null, status: "not_configured", webhook_url: null })
      .in("provider", ["hotmart", "ticto", "kiwify"]),
    "Desconectando plataformas de venda de teste"
  );
}

/** Liga um codigo de uma plataforma (hotmart, ticto) a um produto da escola (arranjo direto no banco, sem passar pela tela). */
export async function ligarProdutoNaPlataforma(db, { codigo, plataforma = "hotmart", produtoId }) {
  unwrap(await db.from("sales_product_links").delete().eq("provider", plataforma).eq("product_id", produtoId), "Tirando codigo antigo do produto");
  unwrap(await db.from("sales_product_links").delete().eq("provider", plataforma).eq("external_product_id", codigo), "Tirando codigo repetido");
  unwrap(
    await db.from("sales_product_links").insert({ external_product_id: codigo, product_id: produtoId, provider: plataforma }),
    `Ligando produto de teste a ${plataforma}`
  );
}

/** Liga um codigo da Hotmart a um produto da escola. */
export async function ligarProdutoNaHotmart(db, { codigo, produtoId }) {
  return ligarProdutoNaPlataforma(db, { codigo, plataforma: "hotmart", produtoId });
}

/** Garante o pacote de teste (ativo, com os dois cursos) ligado ao codigo informado na plataforma (Hotmart por padrao). */
export async function garantirPacoteDeTeste(db, codigoNaPlataforma, plataforma = "hotmart") {
  unwrap(
    await db
      .from("product_combos")
      .upsert({ cohort_name: "Turma A", description: "Pacote ficticio da escola de teste.", id: PACOTE_DE_TESTE.id, name: PACOTE_DE_TESTE.nome, status: "active" }, { onConflict: "id" }),
    "Gravando pacote de teste"
  );
  unwrap(await db.from("product_combo_items").delete().eq("combo_id", PACOTE_DE_TESTE.id), "Limpando produtos do pacote de teste");
  unwrap(
    await db.from("product_combo_items").insert(PACOTE_DE_TESTE.produtos.map((productId, index) => ({ combo_id: PACOTE_DE_TESTE.id, product_id: productId, sort_order: index }))),
    "Gravando produtos do pacote de teste"
  );
  unwrap(await db.from("sales_product_links").delete().eq("provider", plataforma).eq("external_product_id", codigoNaPlataforma), "Tirando codigo repetido do pacote");
  unwrap(
    await db
      .from("sales_product_links")
      .upsert({ combo_id: PACOTE_DE_TESTE.id, external_product_id: codigoNaPlataforma, provider: plataforma }, { onConflict: "provider,combo_id" }),
    `Ligando pacote de teste a ${plataforma}`
  );
}

/**
 * Apaga o que os testes de vendas criaram: eventos recebidos com o prefixo, ligacoes de codigo dos
 * produtos de teste e o pacote de teste. As contas dos compradores saem por apagarContaDeTeste.
 */
export async function limparVendasDeTeste(db, { prefixoDoEvento = "teste-", codigos = [] } = {}) {
  unwrap(await db.from("webhook_events").delete().like("external_event_id", `${prefixoDoEvento}%`), "Limpando vendas recebidas de teste");
  // Vinculos venda -> acesso das compras ficticias (transacoes de teste comecam com HP-).
  unwrap(await db.from("sale_grants").delete().like("transaction_id", "HP-%"), "Limpando vínculos de venda de teste");

  if (codigos.length > 0) {
    unwrap(await db.from("sales_product_links").delete().in("external_product_id", codigos), "Limpando codigos de teste (qualquer plataforma)");
  }

  unwrap(await db.from("sales_product_links").delete().eq("combo_id", PACOTE_DE_TESTE.id), "Limpando codigo do pacote de teste");
  unwrap(await db.from("product_combos").delete().eq("id", PACOTE_DE_TESTE.id), "Apagando pacote de teste");
}

/** Apaga progresso, favoritos e atividade das contas informadas (os testes comecam do zero). */
export async function limparProgresso(db, userIds) {
  for (const table of ["lesson_progress", "saved_items", "student_daily_activity"]) {
    const result = await db.from(table).delete().in("user_id", userIds);

    if (result.error && !/does not exist|Could not find/i.test(result.error.message)) {
      throw new Error(`Limpando ${table}: ${result.error.message}`);
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Comunicacao (avisos, sino e pop-ups; migracoes 202610200001 e 202610200002)
 * ---------------------------------------------------------------------------------------------- */

/** Contas da escola de teste e as criadas pelos testes (todas com e-mail @bunker707.test). */
async function idsDasContasDeTeste(db) {
  const result = await db.from("profiles").select("id").ilike("email", "%@bunker707.test");

  if (result.error) {
    throw new Error(`Lendo contas de teste: ${result.error.message}`);
  }

  return (result.data ?? []).map((row) => row.id);
}

/**
 * Apaga o que os testes gravaram na Comunicacao: fluxos criados pelas contas de teste (passos, passagens,
 * tarefas e o conteudo dos passos saem junto, por cascata), os modelos (docs/28), avisos criados por elas (com o
 * sino e os pop-ups deles, por cascata) e as notificacoes, estados de pop-up e visitas de pagina das contas de
 * teste. A ordem importa: um passo aponta para o conteudo (campaigns) sem cascata, entao apagar os avisos
 * antes dos fluxos falharia (23503); os modelos saem antes dos avisos. Banco sem a migracao: nada a limpar.
 *
 * Modelos: toda linha de modelo semeada por teste leva `created_by` de uma conta @bunker707.test, e todo teste que
 * apaga uma conta temporaria (apagarContaDeTeste) chama esta funcao ANTES: o `on delete set null` deixaria a linha
 * sem dono para sempre, fora do alcance desta limpeza, e o limite de 200 modelos e da escola inteira.
 */
export async function limparComunicacao(db) {
  const ids = await idsDasContasDeTeste(db);

  if (ids.length === 0) {
    return;
  }

  const etapas = [
    ["Apagando fluxos de teste", () => db.from("communication_flows").delete().in("created_by", ids)],
    // Design do pop-up (docs/26): fontes enviadas pelas contas de teste (os arquivos no Storage ficam com o teste).
    ["Apagando fontes de teste", () => db.from("communication_fonts").delete().in("created_by", ids)],
    // Modelos (docs/28; migracao 202610250001): antes dos avisos.
    ["Apagando modelos de teste", () => db.from("communication_templates").delete().in("created_by", ids)],
    ["Apagando avisos de teste", () => db.from("campaigns").delete().in("created_by", ids)],
    ["Apagando notificacoes de teste", () => db.from("notifications").delete().in("user_id", ids)],
    ["Apagando estados de pop-up de teste", () => db.from("campaign_deliveries").delete().in("user_id", ids)],
    ["Apagando visitas de pagina de teste", () => db.from("member_page_visits").delete().in("user_id", ids)]
  ];

  for (const [contexto, etapa] of etapas) {
    const result = await etapa();

    if (result.error && !/does not exist|Could not find/i.test(result.error.message)) {
      throw new Error(`${contexto}: ${result.error.message}`);
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Webinarios (docs/30; migracao 202610280001)
 * ---------------------------------------------------------------------------------------------- */

/** Uma Live ao vivo publicada para todos, apresentada pelo produtor, com Garantir vaga ligado. */
export const WEBINARIO_DE_TESTE = {
  descricao: "Uma live de boas-vindas da escola de teste, com perguntas ao vivo.",
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  sessaoId: "bbbbbbbb-0000-4000-8000-000000000002",
  slug: "teste-live-de-boas-vindas",
  titulo: "Live de Teste: Boas-vindas"
};

/**
 * Grava o webinario de teste (e a sessao `live`) marcado para daqui a 3 dias, em hora cheia. Idempotente: a
 * hora marcada e refeita a cada chamada, entao a contagem regressiva nunca vence entre uma rodada e outra.
 * Pede as contas da escola (seedEscolaDeTeste antes). Banco sem a migracao: erro claro.
 */
export async function seedWebinarioDeTeste(db) {
  const contas = await contasDeTeste(db);
  const horaMarcada = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  horaMarcada.setUTCMinutes(0, 0, 0);
  const scheduledAt = horaMarcada.toISOString();
  const agora = new Date().toISOString();

  unwrap(
    await db.from("webinars").upsert(
      {
        access_mode: "everyone",
        cancel_reason: null,
        cancelled_at: null,
        created_by: contas.produtor.id,
        deleted_at: null,
        description: WEBINARIO_DE_TESTE.descricao,
        duration_minutes: 60,
        host_user_id: contas.produtor.id,
        id: WEBINARIO_DE_TESTE.id,
        kind: "live",
        published_at: agora,
        registration_required: true,
        scheduled_at: scheduledAt,
        show_banner: true,
        show_on_home: true,
        slug: WEBINARIO_DE_TESTE.slug,
        status: "published",
        title: WEBINARIO_DE_TESTE.titulo
      },
      { onConflict: "id" }
    ),
    "Gravando webinario de teste"
  );
  unwrap(
    await db.from("webinar_sessions").upsert(
      {
        ended_at: null,
        id: WEBINARIO_DE_TESTE.sessaoId,
        kind: "live",
        scheduled_at: scheduledAt,
        started_at: null,
        status: "scheduled",
        webinar_id: WEBINARIO_DE_TESTE.id
      },
      { onConflict: "id" }
    ),
    "Gravando sessao do webinario de teste"
  );

  return { scheduledAt };
}

/** As sessoes dos webinarios de teste (slug "teste-"); banco sem a migracao: nenhuma. */
async function sessoesDosWebinariosDeTeste(db) {
  const webinarios = await db.from("webinars").select("id").like("slug", "teste-%");

  if (webinarios.error || (webinarios.data ?? []).length === 0) {
    return [];
  }

  const sessoes = await db
    .from("webinar_sessions")
    .select("id")
    .in(
      "webinar_id",
      webinarios.data.map((row) => row.id)
    );

  return sessoes.error ? [] : (sessoes.data ?? []).map((row) => row.id);
}

/**
 * Apaga o que os testes gravaram nos webinarios: as vagas, os aceites do chat e os banimentos das contas de teste,
 * os pedidos do gravador das sessoes de teste e os webinarios de teste (slug "teste-"; sessoes, vagas, removidos e
 * silenciados saem por cascata). Banco sem a migracao: nada a limpar.
 */
export async function limparWebinarios(db) {
  const ids = await idsDasContasDeTeste(db);
  const sessoes = await sessoesDosWebinariosDeTeste(db);
  const nada = () => Promise.resolve({ error: null });
  const etapas = [
    ["Apagando vagas de teste", () => (ids.length === 0 ? nada() : db.from("webinar_registrations").delete().in("user_id", ids))],
    // Fase 2: o aceite do chat e por aluno (nao sai com o webinario) e as palavras bloqueadas de teste tambem.
    ["Apagando aceites de chat de teste", () => (ids.length === 0 ? nada() : db.from("webinar_chat_consents").delete().in("user_id", ids))],
    ["Apagando palavras bloqueadas de teste", () => db.from("lesson_comment_blocked_words").delete().like("word", "teste-%")],
    // Fase 3 (migracao 202610290002): removido e silenciado saem com a sessao (cascata), mas o banimento de todos os
    // webinarios e por aluno, e o pedido do gravador fica com session_id nulo quando a sessao some (on delete set null):
    // os das sessoes de teste saem antes do webinario, e os de sessao desconhecida (ids de teste "bbbbbbbb-") tambem.
    ["Apagando removidos e silenciados de teste", () => (ids.length === 0 ? nada() : db.from("webinar_session_bans").delete().in("user_id", ids))],
    ["Apagando banidos de teste", () => (ids.length === 0 ? nada() : db.from("webinar_user_bans").delete().in("user_id", ids))],
    ["Apagando pedidos do gravador de teste", () => (sessoes.length === 0 ? nada() : db.from("webinar_recording_events").delete().in("session_id", sessoes))],
    ["Apagando pedidos do gravador sem sessao de teste", () => db.from("webinar_recording_events").delete().is("session_id", null).like("payload->>sessionId", "bbbbbbbb-%")],
    ["Apagando webinarios de teste", () => db.from("webinars").delete().like("slug", "teste-%")]
  ];

  for (const [contexto, etapa] of etapas) {
    const result = await etapa();

    if (result.error && !/does not exist|Could not find/i.test(result.error.message)) {
      throw new Error(`${contexto}: ${result.error.message}`);
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Webinarios, fase 2 (docs/30 §1.6 e §3.4; migracao 202610290001): uma Live gravada ja encerrada
 * ---------------------------------------------------------------------------------------------- */

/** Uma Live gravada publicada para todos, com uma sessao encerrada ha pouco (presenca congelada e lista por aluno). */
export const LIVE_GRAVADA_DE_TESTE = {
  gravacaoId: "bbbbbbbb-0000-4000-8000-000000000013",
  id: "bbbbbbbb-0000-4000-8000-000000000011",
  sessaoId: "bbbbbbbb-0000-4000-8000-000000000012",
  slug: "teste-live-gravada-encerrada",
  titulo: "Live Gravada de Teste: Encerrada"
};

/**
 * Grava a Live gravada de teste com uma sessao `simulated` encerrada ha 90 min (30 min de video): a curva de
 * presenca congelada (2 alunos ate o minuto 5, 1 ate o fim), o resumo por aluno em webinar_attendance (a aluna ate
 * o fim, o aluno sem acesso saiu aos 5 min), as duas vagas, duas mensagens e uma reacao da aluna. E o que a aba
 * Relatorio e o CSV leem. Idempotente (upsert pelos ids fixos; mensagens, reacoes e vagas da sessao sao refeitas).
 * Pede as contas da escola (seedEscolaDeTeste antes) e `limparWebinarios` apaga tudo pelo slug "teste-".
 */
export async function seedLiveGravadaEncerradaDeTeste(db) {
  const contas = await contasDeTeste(db);
  const { gravacaoId, id, sessaoId, slug, titulo } = LIVE_GRAVADA_DE_TESTE;
  const inicio = new Date(Date.now() - 2 * 60 * 60 * 1000);
  inicio.setUTCSeconds(0, 0);
  const fim = new Date(inicio.getTime() + 30 * 60 * 1000);
  const emSegundos = (segundos) => new Date(inicio.getTime() + segundos * 1000).toISOString();
  const buckets = Array.from({ length: 60 }, (_, b) => ({ b, n: b < 10 ? 2 : 1 }));
  const presenceCurve = {
    avgPresent: 1.2,
    bucketSeconds: 30,
    buckets,
    durationMs: 1_800_000,
    frozenAt: fim.toISOString(),
    peak: { b: 0, n: 2 },
    reachedEnd: 1,
    unique: 2,
    watchAvg: 1050,
    watchMax: 1800
  };

  unwrap(
    await db.from("webinars").upsert(
      {
        access_mode: "everyone",
        cancel_reason: null,
        cancelled_at: null,
        created_by: contas.produtor.id,
        deleted_at: null,
        description: "Uma live gravada da escola de teste, ja encerrada, para o relatorio.",
        duration_minutes: 30,
        host_user_id: contas.produtor.id,
        id,
        kind: "simulated",
        published_at: emSegundos(-86_400),
        registration_required: true,
        scheduled_at: null,
        show_banner: true,
        show_on_home: true,
        slug,
        status: "published",
        title: titulo
      },
      { onConflict: "id" }
    ),
    "Gravando a live gravada de teste"
  );
  unwrap(
    await db.from("webinar_recordings").upsert(
      {
        bunny_library_id: "1",
        bunny_video_id: "teste-live-gravada-encerrada",
        duration_seconds: 1800,
        embed_url: "https://iframe.mediadelivery.net/embed/1/teste-live-gravada-encerrada",
        id: gravacaoId,
        provider: "bunny",
        session_id: null,
        source: "bunny",
        status: "ready",
        webinar_id: id
      },
      { onConflict: "id" }
    ),
    "Gravando o video da live gravada de teste"
  );
  unwrap(
    await db.from("webinar_sessions").upsert(
      {
        ended_at: fim.toISOString(),
        id: sessaoId,
        kind: "simulated",
        presence_curve: presenceCurve,
        recording_id: gravacaoId,
        scheduled_at: inicio.toISOString(),
        script_fired_at: inicio.toISOString(),
        show_live_badge: false,
        started_at: inicio.toISOString(),
        status: "ended",
        webinar_id: id
      },
      { onConflict: "id" }
    ),
    "Gravando a sessao encerrada de teste"
  );
  unwrap(
    await db.from("webinar_attendance").upsert(
      [
        { entries: 1, first_at: emSegundos(10), last_at: emSegundos(1790), max_bucket: 59, reached_end: true, seconds: 1800, session_id: sessaoId, user_id: contas.aluna.id },
        { entries: 1, first_at: emSegundos(10), last_at: emSegundos(300), max_bucket: 9, reached_end: false, seconds: 300, session_id: sessaoId, user_id: contas.alunoSemAcesso.id }
      ],
      { onConflict: "session_id,user_id" }
    ),
    "Gravando a presenca por aluno de teste"
  );

  for (const [contexto, apaga] of [
    ["Apagando as vagas da live gravada de teste", () => db.from("webinar_registrations").delete().eq("webinar_id", id)],
    ["Apagando as mensagens da sessao de teste", () => db.from("webinar_chat_messages").delete().eq("session_id", sessaoId)],
    ["Apagando as reacoes da sessao de teste", () => db.from("webinar_reactions").delete().eq("session_id", sessaoId)]
  ]) {
    unwrap(await apaga(), contexto);
  }

  unwrap(
    await db.from("webinar_registrations").insert([
      { registered_at: emSegundos(-3600), session_id: sessaoId, source: "email", status: "registered", user_id: contas.aluna.id, webinar_id: id },
      { registered_at: emSegundos(-1800), session_id: sessaoId, source: null, status: "registered", user_id: contas.alunoSemAcesso.id, webinar_id: id }
    ]),
    "Gravando as vagas da live gravada de teste"
  );
  unwrap(
    await db.from("webinar_chat_messages").insert([
      { approved: true, author_user_id: contas.aluna.id, body: "Boa noite, pessoal!", created_at: emSegundos(30), display_name: "Aluna T.", kind: "message", master: false, offset_ms: 30_000, role: "student", session_id: sessaoId, source: "audience", webinar_id: id },
      { approved: true, author_user_id: contas.aluna.id, body: "Esse exemplo ficou claro.", created_at: emSegundos(90), display_name: "Aluna T.", kind: "message", master: false, offset_ms: 90_000, role: "student", session_id: sessaoId, source: "audience", webinar_id: id }
    ]),
    "Gravando as mensagens da sessao de teste"
  );
  unwrap(await db.from("webinar_reactions").insert({ created_at: emSegundos(60), offset_ms: 60_000, reaction: "fire", session_id: sessaoId, user_id: contas.aluna.id }), "Gravando a reacao da sessao de teste");

  return { endedAt: fim.toISOString(), startedAt: inicio.toISOString() };
}

/* ------------------------------------------------------------------------------------------------
 * Live gravada no ar (docs/30 §1.6; migracao 202610290001): a sala do aluno (fase 2a)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Uma Live gravada publicada para todos, NO AR: a sessao `simulated` que comecou ha pouco, a live de origem (encerrada,
 * com a gravacao da Bunny e a ancora de 5 s) e duas linhas da linha mestre: "cedo" no segundo 100 do video
 * (105 s na live) e "tarde" aos 20 minutos. O endereco do player e um embed real da Bunny que os testes de ponta a
 * ponta cobrem com a pagina falsa (paginaFalsaPlayerJs).
 */
export const LIVE_GRAVADA_NO_AR_DE_TESTE = {
  descricao: "Uma live gravada da escola de teste, reexibida em horario marcado.",
  gravacaoId: "bbbbbbbb-0000-4000-8000-000000000021",
  id: "bbbbbbbb-0000-4000-8000-000000000020",
  mensagens: { cedo: "bbbbbbbb-0000-4000-8000-000000000025", tarde: "bbbbbbbb-0000-4000-8000-000000000026" },
  origemId: "bbbbbbbb-0000-4000-8000-000000000023",
  sessaoId: "bbbbbbbb-0000-4000-8000-000000000022",
  slug: "teste-live-gravada-no-ar",
  textos: { cedo: "oi da live real", tarde: "ate mais tarde" },
  titulo: "Live de Teste: Gravada no ar",
  videoUrl: "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc"
};

/**
 * Grava a Live gravada de teste. `comecouHa` (ms) e quanto a sessao ja comecou (padrao 90 s: quem entra cai no
 * minuto certo); negativo marca para o futuro (a espera). Idempotente: a hora marcada e refeita a cada chamada.
 * Pede as contas da escola (seedEscolaDeTeste antes). Banco sem a migracao 202610290001: erro claro.
 */
export async function seedLiveGravadaDeTeste(db, { comecouHa = 90_000, duracaoSegundos = 3600, seloAoVivo = true } = {}) {
  const contas = await contasDeTeste(db);
  const agora = Date.now();
  const scheduledAt = new Date(agora - comecouHa).toISOString();
  const origemEm = new Date(agora - 30 * 24 * 60 * 60 * 1000);
  const origemIso = origemEm.toISOString();
  const { id, gravacaoId, mensagens, origemId, sessaoId, slug, textos, titulo, videoUrl } = LIVE_GRAVADA_NO_AR_DE_TESTE;

  unwrap(
    await db.from("webinars").upsert(
      {
        access_mode: "everyone",
        cancel_reason: null,
        cancelled_at: null,
        created_by: contas.produtor.id,
        deleted_at: null,
        description: LIVE_GRAVADA_NO_AR_DE_TESTE.descricao,
        duration_minutes: Math.max(15, Math.round(duracaoSegundos / 60)),
        host_user_id: contas.produtor.id,
        id,
        kind: "simulated",
        published_at: origemIso,
        registration_required: false,
        room_settings: { anonymousQuestions: true, chatMode: "open", displayName: "first_name_initial" },
        scheduled_at: scheduledAt,
        show_banner: false,
        show_on_home: true,
        slug,
        status: "published",
        title: titulo
      },
      { onConflict: "id" }
    ),
    "Gravando a live gravada de teste"
  );
  // A live de origem primeiro (a gravacao aponta para ela), depois a gravacao, depois a sessao gravada.
  unwrap(
    await db.from("webinar_sessions").upsert(
      { ended_at: new Date(origemEm.getTime() + duracaoSegundos * 1000).toISOString(), id: origemId, kind: "live", recording_anchor_at: origemIso, scheduled_at: origemIso, started_at: origemIso, status: "ended", webinar_id: id },
      { onConflict: "id" }
    ),
    "Gravando a live de origem de teste"
  );
  unwrap(
    await db.from("webinar_recordings").upsert(
      { anchor_offset_ms: 5000, bunny_library_id: "12345", bunny_video_id: "0b1c2d3e-aaaa-4bbb-8ccc-123456789abc", duration_seconds: duracaoSegundos, embed_url: videoUrl, id: gravacaoId, provider: "bunny", session_id: origemId, source: "upload", status: "ready", webinar_id: id },
      { onConflict: "id" }
    ),
    "Gravando o video da live gravada de teste"
  );
  unwrap(
    await db.from("webinar_sessions").upsert(
      { chat_mode: "open", chat_slow_mode_seconds: null, ended_at: null, id: sessaoId, kind: "simulated", recording_id: gravacaoId, scheduled_at: scheduledAt, show_live_badge: seloAoVivo, source_session_id: origemId, started_at: null, status: "scheduled", webinar_id: id },
      { onConflict: "id" }
    ),
    "Gravando a sessao gravada de teste"
  );
  unwrap(
    await db.from("webinar_chat_messages").upsert(
      [
        { approved: true, author_user_id: null, body: textos.cedo, created_at: new Date(origemEm.getTime() + 105_000).toISOString(), display_name: "Bia C.", id: mensagens.cedo, kind: "message", master: true, offset_ms: 105_000, role: "student", session_id: origemId, source: "original", webinar_id: id },
        { approved: true, author_user_id: null, body: textos.tarde, created_at: new Date(origemEm.getTime() + 20 * 60_000).toISOString(), display_name: "Bia C.", id: mensagens.tarde, kind: "message", master: true, offset_ms: 20 * 60_000 + 5000, role: "student", session_id: origemId, source: "original", webinar_id: id }
      ],
      { onConflict: "id" }
    ),
    "Gravando a linha mestre de teste"
  );

  return { scheduledAt };
}

/* ------------------------------------------------------------------------------------------------
 * Live ao vivo (docs/30 §1.3, §1.4, §5.1, §5.4 e §8.1; migracao 202610290002): a sala, o token e o gravador (fase 3)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O ambiente da sala ao vivo nos testes (docs/30 §7.3 e §10.1): o hostname do Jitsi proprio (um .test que nunca
 * resolve: o navegador do e2e recebe o external_api.js falso por page.route), os dois segredos de 48 caracteres SO de
 * teste (nunca valem fora da maquina nem do CI) e o duble do pedido ao GitHub (WEBINAR_RECORDER_DISPATCH=fake, que so vale
 * fora da producao: os testes do Node e o `next dev`; o `next start` do e2e roda como producao e, sem GITHUB_INFRA_TOKEN,
 * fica sem adaptador: nenhum jibri-up de verdade sai em caso nenhum). O .env.test.local deixa essas chaves vazias (tests/support/db.mjs); quem roda o teste preenche
 * so o que esta vazio com ambienteDaSalaAoVivo, e o servidor do e2e (tests/support/e2e-server.mjs) faz o mesmo antes do
 * build, que le WEBINAR_MEET_DOMAIN na Permissions-Policy (next.config.ts).
 */
export const AMBIENTE_DA_SALA_AO_VIVO_DE_TESTE = {
  WEBINAR_JWT_APP_ID: "bunker707",
  WEBINAR_JWT_SECRET: "teste-jwt-da-sala-ao-vivo-bunker707-sem-uso-real",
  WEBINAR_MEET_DOMAIN: "meet.bunker707.test",
  WEBINAR_RECORDER_DISPATCH: "fake",
  WEBINAR_RECORDER_WEBHOOK_SECRET: "teste-webhook-do-gravador-bunker707-sem-uso-real"
};

/**
 * Preenche no `env` (process.env por padrao) cada chave da sala ao vivo que esta vazia ou ausente com o valor de teste
 * e devolve os valores que valem: o que ja vinha preenchido (um segredo local do desenvolvedor) fica, e o teste assina
 * e confere com o mesmo valor que o app le.
 */
export function ambienteDaSalaAoVivo(env = process.env) {
  const efetivo = {};

  for (const [chave, padrao] of Object.entries(AMBIENTE_DA_SALA_AO_VIVO_DE_TESTE)) {
    if (!env[chave] || !String(env[chave]).trim()) {
      env[chave] = padrao;
    }

    efetivo[chave] = env[chave];
  }

  return efetivo;
}

/**
 * Uma Live ao vivo publicada para todos, apresentada pelo produtor, com o professor como co-apresentador e o analista
 * na Equipe da sala (webinar_presenters `team`; a caixa "Pode remover e silenciar na sala" pela opcao `equipeModera`),
 * camera de aluno permitida, palco em 720p e a sessao `live` com um nome de sala no formato de newRoomName
 * (`w-<webinario>-<16 letras do alfabeto sem l, o, 0 e 1>`). Sem "Gravar automaticamente" (o tick nao pede maquina).
 */
export const LIVE_AO_VIVO_DE_TESTE = {
  coApresentador: "professor",
  descricao: "Uma live ao vivo da escola de teste, com camera, mao levantada e gravacao.",
  equipe: "analista",
  id: "bbbbbbbb-0000-4000-8000-000000000030",
  roomName: "w-bbbbbbbb-0000-4000-8000-000000000030-testemesaviva234",
  sessaoId: "bbbbbbbb-0000-4000-8000-000000000031",
  slug: "teste-live-ao-vivo",
  titulo: "Live de Teste: Ao vivo"
};

/**
 * Grava a Live ao vivo de teste com a sessao na situacao pedida: `scheduled` (marcada para daqui a 10 min, a sala
 * fechada: Abrir a sala e o caminho), `waiting` (a sala aberta pela equipe, a Sessao de pratica; a hora marcada
 * `comecouHa` atras) ou `live` (no ar desde `comecouHa`, padrao 60 s). Sempre do zero: gravador `none`, sem ancora, sem
 * "Gravar" na fila, sala destrancada, e sem removidos, silenciados, pedidos do gravador, gravacao, chat, reacoes,
 * perguntas, enquetes ou presenca da sessao de antes. Idempotente. Pede as contas da escola (seedEscolaDeTeste antes);
 * banco sem a 202610290002: erro claro. `limparWebinarios` apaga tudo pelo slug "teste-".
 */
export async function seedLiveAoVivoDeTeste(db, { comecouHa = 60_000, equipeModera = false, status = "live" } = {}) {
  const contas = await contasDeTeste(db);
  const { id, roomName, sessaoId, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
  const agora = Date.now();
  const horaMarcada = new Date(status === "scheduled" ? agora + 10 * 60_000 : agora - comecouHa);
  horaMarcada.setUTCMilliseconds(0);
  const scheduledAt = horaMarcada.toISOString();
  const startedAt = status === "live" ? scheduledAt : null;

  unwrap(
    await db.from("webinars").upsert(
      {
        access_mode: "everyone",
        allow_student_camera: true,
        auto_record: false,
        cancel_reason: null,
        cancelled_at: null,
        capacity: null,
        created_by: contas.produtor.id,
        deleted_at: null,
        description: LIVE_AO_VIVO_DE_TESTE.descricao,
        duration_minutes: 60,
        host_user_id: contas.produtor.id,
        id,
        kind: "live",
        published_at: new Date(agora - 24 * 60 * 60_000).toISOString(),
        quality: { screenFps: 30, stage: 720 },
        registration_required: false,
        room_settings: {
          anonymousQuestions: true,
          chatMode: "open",
          displayName: "first_name_initial",
          newCommentsVisible: true,
          polls: true,
          practiceSession: true,
          questions: true,
          reactions: true,
          slowModeSeconds: null,
          waitingRoom: false
        },
        scheduled_at: scheduledAt,
        show_banner: true,
        show_on_home: false,
        slug,
        status: "published",
        title: titulo
      },
      { onConflict: "id" }
    ),
    "Gravando a live ao vivo de teste"
  );

  // O que sobrou de uma rodada anterior desta sessao sai antes (a sessao fica, com o mesmo nome de sala).
  for (const [contexto, apaga] of [
    ["Apagando removidos e silenciados da live de teste", () => db.from("webinar_session_bans").delete().eq("session_id", sessaoId)],
    ["Apagando pedidos do gravador da live de teste", () => db.from("webinar_recording_events").delete().eq("session_id", sessaoId)],
    ["Apagando a gravacao da live de teste", () => db.from("webinar_recordings").delete().eq("session_id", sessaoId)],
    ["Apagando o chat da live de teste", () => db.from("webinar_chat_messages").delete().eq("session_id", sessaoId)],
    ["Apagando as reacoes da live de teste", () => db.from("webinar_reactions").delete().eq("session_id", sessaoId)],
    ["Apagando as perguntas da live de teste", () => db.from("webinar_questions").delete().eq("session_id", sessaoId)],
    ["Apagando as enquetes da live de teste", () => db.from("webinar_polls").delete().eq("webinar_id", id)],
    ["Apagando a presenca da live de teste", () => db.from("webinar_presence_samples").delete().eq("session_id", sessaoId)]
  ]) {
    const result = await apaga();

    if (result.error && !/does not exist|Could not find/i.test(result.error.message)) {
      throw new Error(`${contexto}: ${result.error.message}`);
    }
  }

  unwrap(
    await db.from("webinar_sessions").upsert(
      {
        chat_mode: "open",
        chat_slow_mode_seconds: null,
        ended_at: null,
        id: sessaoId,
        kind: "live",
        recorder_alerted_at: null,
        recorder_release_requested_at: null,
        recorder_requested_at: null,
        recorder_status: "none",
        recording_anchor_at: null,
        recording_id: null,
        recording_requested_at: null,
        room_locked: false,
        room_name: roomName,
        scheduled_at: scheduledAt,
        started_at: startedAt,
        status,
        webinar_id: id
      },
      { onConflict: "id" }
    ),
    "Gravando a sessao da live ao vivo de teste (a migracao 202610290002 esta aplicada?)"
  );
  unwrap(
    await db.from("webinar_presenters").upsert(
      [
        { can_moderate_room: false, role: "co_host", user_id: contas[LIVE_AO_VIVO_DE_TESTE.coApresentador].id, valid_until: null, webinar_id: id },
        { can_moderate_room: equipeModera, role: "team", user_id: contas[LIVE_AO_VIVO_DE_TESTE.equipe].id, valid_until: null, webinar_id: id }
      ],
      { onConflict: "webinar_id,user_id" }
    ),
    "Gravando o co-apresentador e a Equipe da live ao vivo de teste"
  );

  return { scheduledAt, startedAt };
}
