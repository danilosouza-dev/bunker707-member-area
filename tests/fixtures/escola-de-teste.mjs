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
    alunoSemAcesso: { email: "aluno.sem-acesso@bunker707.test", nome: "Aluno Sem Acesso" },
    analista: { email: "analista.teste@bunker707.test", nome: "Analista de Teste" },
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
    id: "teste-curso-bloqueado",
    titulo: "Curso de Teste: Bloqueado"
  }
};

const VIDEO_DE_TESTE = { provider: "youtube", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" };

function contentItemRows() {
  const { curso, cursoBloqueado } = ESCOLA_DE_TESTE;

  return [
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
  const { curso, cursoBloqueado } = ESCOLA_DE_TESTE;

  return [
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
      id: "teste-modulo-bloqueado-1",
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
  const { curso } = ESCOLA_DE_TESTE;

  return [
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
      id: "teste-aula-bloqueada-1",
      module_id: "teste-modulo-bloqueado-1",
      sort_order: 1,
      status: "published",
      title: "Aula 1: Introdução",
      video_config: VIDEO_DE_TESTE
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

  // Equipe: produtor e dono da escola; analista so le. Alunos nunca entram em admin_roles.
  unwrap(
    await db.from("admin_roles").upsert(
      [
        { permissions: {}, role: "owner", user_id: contas.produtor.id },
        { permissions: {}, role: "analyst", user_id: contas.analista.id }
      ],
      { onConflict: "user_id" }
    ),
    "Gravando equipe de teste"
  );
  unwrap(
    await db.from("admin_roles").delete().in("user_id", [contas.aluna.id, contas.alunoSemAcesso.id]),
    "Tirando alunos de teste da equipe"
  );

  unwrap(await db.from("content_items").upsert(contentItemRows(), { onConflict: "id" }), "Gravando cursos de teste");
  unwrap(await db.from("course_modules").upsert(moduleRows(), { onConflict: "id" }), "Gravando modulos de teste");
  unwrap(await db.from("lessons").upsert(lessonRows(), { onConflict: "id" }), "Gravando aulas de teste");

  // Acesso: a aluna comprou o curso; o aluno sem acesso nao tem nada.
  unwrap(
    await db.from("entitlements").upsert(
      {
        ends_at: null,
        source_event_id: "escola-de-teste:aluna:curso-agentes",
        source_provider: "manual",
        starts_at: "2026-01-01T00:00:00.000Z",
        status: "active",
        target_id: ESCOLA_DE_TESTE.curso.id,
        target_type: "standalone_course",
        user_id: contas.aluna.id
      },
      { onConflict: "user_id,source_event_id" }
    ),
    "Gravando acesso da aluna de teste"
  );
  unwrap(
    await db.from("entitlements").delete().eq("user_id", contas.alunoSemAcesso.id),
    "Tirando acessos do aluno sem acesso"
  );

  return contas;
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
