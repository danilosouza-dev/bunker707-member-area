import "server-only";

// Fatos de cada aluno para avaliar o segmento dos avisos (src/server/communications/audience-model.ts).
// Mesmas leituras e a mesma conta da lista de Alunos (src/server/students/queries.ts, buildStudentIndex):
// acessos abertos agora, aulas publicadas concluidas sobre o que o aluno pode estudar, ultimo estudo,
// ritmo e turmas; mais os comentarios por janela (RPC communication_comment_counts). A equipe
// (admin_roles) fica de fora aqui, antes de qualquer regra: nunca entra na contagem nem recebe aviso.
//
// Leitura unica por chamada (previa no editor, publicar, job do tick); a escala prevista e de centenas a
// poucos milhares de alunos, como a lista de Alunos (que avisa quando passar a hora de ir para uma RPC).
//
// v2 (docs/23 §7): regra "o que fez com a notificacao X" le as linhas do sino SO dos avisos citados
// (loadMessageFacts, chave "campaign:<id>"), e context.messageKeys diz quais foram lidos: chave fora dele
// nunca combina. loadAudienceFactsFor monta os mesmos fatos so para alguns alunos (lote do motor dos
// fluxos, em pedacos de 150), com a mesma conta (buildStudentFacts).
//
// Quem pode da live por regras (docs/30 §1.6): a regra "Participação em lives" le as lives de cada aluno pela RPC
// communication_webinar_facts (migracao 202610300001), so quando alguma regra pede (opcao `webinars`), e
// context.webinarFactsLoaded diz que a leitura foi feita: sem ela (ou num banco sem a migracao) a regra nunca
// combina, nem negada.
//
// Webinarios v4b (docs/30 §1.6): a lista de chaves que chega aqui (collectMessageCampaignIds) traz tambem
// "webinar:<id>" das regras "webinar_follow_up" (o "Webinário" da fase 4). Os avisos seguem pelas linhas do sino; os
// webinarios, pelos fatos do follow-up (loadWebinarFollowUpFacts em src/server/webinars/follow-up-queries.ts),
// juntados em facts.webinarFollowUps, e "webinar:<id>" entra em context.messageKeys so quando o webinario foi lido
// (apagado ou banco sem a migracao: a regra nao combina). As duas leituras convivem ate a unificacao das regras.

import { sanitizeProfileAvatarUrl } from "@/server/member-area/student-pages-model";
import { accessStateOf, isAccessOpen, paceOf } from "@/server/students/model";
import {
  fetchCohortMemberships,
  fetchEntitlements,
  fetchProfiles,
  fetchProfilesByIds,
  fetchProgressRows,
  fetchPublishedLessonIndex,
  fetchStaffUserIds,
  type CohortMembershipRow,
  type EntitlementRow,
  type ProfileRow,
  type ProgressRow
} from "@/server/students/store";
import { loadWebinarFollowUpFacts, type WebinarFollowUpRead } from "@/server/webinars/follow-up-queries";
import {
  buildCommentRanks,
  messageRefKey,
  webinarIdOfKey,
  webinarRuleKey,
  type AudienceAccessFact,
  type AudienceCommentCounts,
  type AudienceContext,
  type AudienceStudentFacts,
  type AudienceWebinarFacts,
  type MessageFact
} from "./audience-model";
import { assertNoDbError, chunksOf, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
import { isReactionId, POLL_OPTION_ID } from "./interactions-model";

export type AudiencePerson = { avatarUrl: string | null; name: string };

export type LoadedAudience = {
  context: AudienceContext;
  facts: AudienceStudentFacts[];
  /** Nome e foto de cada aluno (amostra da previa no editor). */
  people: Map<string, AudiencePerson>;
};

const NO_NAME = "Sem nome";
const ZERO_COMMENTS: AudienceCommentCounts = { d7: 0, d30: 0, d90: 0, total: 0 };

type CommentCountRow = {
  author_id: string | null;
  comments_7d: number | string | null;
  comments_30d: number | string | null;
  comments_90d: number | string | null;
  comments_total: number | string | null;
};

const count = (value: number | string | null) => Number(value ?? 0) || 0;

/** Linhas por pedido: o teto do PostgREST (max_rows = 1000) tambem corta o resultado de RPC, sem erro. */
export const COMMENT_COUNTS_PAGE = 1_000;

/** Alunos por leitura em loadAudienceFactsFor (filtros `in` vao na URL; o lote do motor tem 150). */
export const AUDIENCE_FACTS_CHUNK = 150;

/** Linhas do sino por pagina em loadMessageFacts (teto do PostgREST). */
export const MESSAGE_FACTS_PAGE = 1_000;

/**
 * Comentarios por janela, uma linha por aluno que comentou, lidos em paginas de 1000 em ordem de autor
 * (sem paginar, quem passasse do teto contaria zero e o ranking sairia errado). Banco sem a migracao
 * 202610200001 conta zero para todo mundo.
 */
export async function fetchCommentCounts(db: CommunicationsDb): Promise<Map<string, AudienceCommentCounts>> {
  const counts = new Map<string, AudienceCommentCounts>();

  for (let from = 0; ; from += COMMENT_COUNTS_PAGE) {
    const { data, error } = await db
      .rpc("communication_comment_counts")
      .order("author_id")
      .range(from, from + COMMENT_COUNTS_PAGE - 1);

    if (error) {
      if (isMissingCommunicationSchema(error)) {
        console.error("[comunicacao] contagem de comentarios indisponivel (migracao 202610200001 pendente).");
        return new Map();
      }

      throw new Error(`Comunicacao: comentarios por aluno: ${error.message}`);
    }

    const rows = (data ?? []) as CommentCountRow[];

    for (const row of rows) {
      if (row.author_id) {
        counts.set(row.author_id, {
          d7: count(row.comments_7d),
          d30: count(row.comments_30d),
          d90: count(row.comments_90d),
          total: count(row.comments_total)
        });
      }
    }

    if (rows.length < COMMENT_COUNTS_PAGE) {
      return counts;
    }
  }
}

function groupBy<Row>(rows: readonly Row[], key: (row: Row) => string) {
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);

    if (group) {
      group.push(row);
    } else {
      groups.set(id, [row]);
    }
  }

  return groups;
}

function timeOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

/** Aulas publicadas concluidas por conteudo (so as que continuam publicadas contam). */
function completedByContentOf(rows: readonly ProgressRow[], lessonIndex: Map<string, Set<string>>) {
  const completed: Record<string, Set<string>> = {};

  for (const row of rows) {
    const published = lessonIndex.get(row.content_id);

    if (!published) {
      continue;
    }

    const set = (completed[row.content_id] ??= new Set<string>());

    for (const lessonId of row.completed_lesson_ids ?? []) {
      if (published.has(lessonId)) {
        set.add(lessonId);
      }
    }
  }

  return Object.fromEntries(Object.entries(completed).map(([contentId, set]) => [contentId, set.size]));
}

function lastStudiedOf(rows: readonly ProgressRow[]) {
  let latest: string | null = null;

  for (const row of rows) {
    if (!latest || row.updated_at > latest) {
      latest = row.updated_at;
    }
  }

  return latest;
}

/** Colunas do acesso que os fatos usam (as do RPC de fatos do lote do motor tambem servem). */
export type AudienceEntitlementRow = Pick<
  EntitlementRow,
  "created_at" | "ends_at" | "starts_at" | "status" | "target_id" | "target_type" | "user_id"
>;

/** Conteudos que o aluno pode estudar agora ("platform" abre tudo que tem aula), como em Alunos. */
function openContentIds(openRows: readonly AudienceEntitlementRow[], lessonIndex: Map<string, Set<string>>) {
  if (openRows.some((row) => row.target_type === "platform")) {
    return Array.from(lessonIndex.keys());
  }

  return Array.from(new Set(openRows.map((row) => row.target_id)));
}

/** Acessos abertos agora (o RPC de fatos do lote devolve todos, abertos ou nao). */
export function openAccessRows<Row extends AudienceEntitlementRow>(rows: readonly Row[], now: number): Row[] {
  return rows.filter((row) => isAccessOpen(accessStateOf({ endsAt: row.ends_at, now, startsAt: row.starts_at, status: row.status })));
}

/**
 * Acessos abertos de um aluno como fatos. `gainedAt` = greatest(created_at, starts_at): quando o acesso
 * passou a valer de fato (importacao pode ter starts_at no passado; acesso futuro so vale do inicio).
 */
export function accessFactsOf(openRows: readonly AudienceEntitlementRow[]): AudienceAccessFact[] {
  return openRows.flatMap((row) => {
    const startsAt = timeOf(row.starts_at);

    if (startsAt === null) {
      return [];
    }

    const createdAt = timeOf(row.created_at);

    return [
      {
        endsAt: timeOf(row.ends_at),
        gainedAt: createdAt === null ? startsAt : Math.max(createdAt, startsAt),
        productId: row.target_type === "platform" ? "platform" : row.target_id,
        startsAt
      }
    ];
  });
}

/**
 * Fatos so com os acessos (sem perfil, progresso, turmas, entrada nem comentarios), para quando nenhuma regra usa o
 * resto: o lote do motor dos fluxos e o "Quem pode" da live com regras so de acesso ou de lives.
 */
export function accessOnlyFacts(userId: string, rows: readonly AudienceEntitlementRow[], now: number): AudienceStudentFacts {
  return {
    accesses: accessFactsOf(openAccessRows(rows, now)),
    cohortIds: [],
    comments: ZERO_COMMENTS,
    completedByContent: {},
    completedLessons: 0,
    lastSignInAt: null,
    lastStudiedAt: null,
    pace: "never_started",
    totalLessons: 0,
    userId
  };
}

export type StudentFactsSources = {
  comments: ReadonlyMap<string, AudienceCommentCounts>;
  /** Acessos dos alunos (abertos ou nao: o filtro de "aberto agora" fica aqui). */
  entitlements: readonly AudienceEntitlementRow[];
  lessonIndex: Map<string, Set<string>>;
  memberships: readonly CohortMembershipRow[];
  now: number;
  profiles: readonly ProfileRow[];
  progressRows: readonly ProgressRow[];
  staff: ReadonlySet<string>;
};

/**
 * Fatos e nome de cada aluno a partir das linhas ja lidas, sem a equipe. A mesma conta para todos os
 * alunos (loadAudienceFacts) e para alguns (loadAudienceFactsFor).
 */
export function buildStudentFacts(sources: StudentFactsSources): { facts: AudienceStudentFacts[]; people: Map<string, AudiencePerson> } {
  const { lessonIndex, now } = sources;
  const openByUser = groupBy(openAccessRows(sources.entitlements, now), (row) => row.user_id);
  const progressByUser = groupBy(sources.progressRows, (row) => row.user_id);
  const membershipsByUser = groupBy(sources.memberships, (row) => row.user_id);
  const facts: AudienceStudentFacts[] = [];
  const people = new Map<string, AudiencePerson>();

  for (const profile of sources.profiles) {
    if (sources.staff.has(profile.id)) {
      continue;
    }

    const open = openByUser.get(profile.id) ?? [];
    const rows = progressByUser.get(profile.id) ?? [];
    const contentIds = openContentIds(open, lessonIndex);
    const openProductIds = new Set(contentIds);
    const completedByContent = completedByContentOf(rows, lessonIndex);
    let completedLessons = 0;
    let totalLessons = 0;

    for (const contentId of contentIds) {
      totalLessons += lessonIndex.get(contentId)?.size ?? 0;
      completedLessons += completedByContent[contentId] ?? 0;
    }

    const lastStudiedAt = lastStudiedOf(rows);

    facts.push({
      accesses: accessFactsOf(open),
      cohortIds: Array.from(
        new Set((membershipsByUser.get(profile.id) ?? []).filter((row) => openProductIds.has(row.product_id)).map((row) => row.cohort_id))
      ),
      comments: sources.comments.get(profile.id) ?? ZERO_COMMENTS,
      completedByContent,
      completedLessons,
      // v3b-2: o "No primeiro acesso" do pop-up (a coluna ja vem em PROFILE_COLUMNS: nenhuma leitura nova).
      createdAt: timeOf(profile.created_at),
      lastSignInAt: timeOf(profile.last_sign_in_at),
      lastStudiedAt: timeOf(lastStudiedAt),
      pace: paceOf({ completedLessons, lastStudiedAt, now, totalLessons }),
      totalLessons,
      userId: profile.id
    });
    people.set(profile.id, { avatarUrl: sanitizeProfileAvatarUrl(profile.avatar_url), name: profile.full_name?.trim() || NO_NAME });
  }

  return { facts, people };
}

function lessonTotalsOf(lessonIndex: Map<string, Set<string>>) {
  return Object.fromEntries(Array.from(lessonIndex, ([contentId, lessons]) => [contentId, lessons.size]));
}

/* ------------------------------------------------------------------------------------------------
 * Linhas do sino dos avisos citados por regras "message" (docs/23 §7)
 * ---------------------------------------------------------------------------------------------- */

/** userId -> { "campaign:<id>": o que o aluno fez com aquele aviso }. */
export type MessageFactsByUser = Map<string, Record<string, MessageFact>>;

type MessageRow = {
  audio_completed_at: string | null;
  audio_started_at: string | null;
  campaign_id: string;
  clicked_at: string | null;
  created_at: string;
  expires_at: string;
  hidden_at: string | null;
  id: string;
  opened_at: string | null;
  poll_choice: unknown;
  reaction: string | null;
  response: string | null;
  seen_at: string | null;
  user_id: string;
};

const MESSAGE_ROW_COLUMNS =
  "id,user_id,campaign_id,created_at,expires_at,seen_at,opened_at,clicked_at,response,audio_started_at,audio_completed_at,reaction,poll_choice,hidden_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids de aviso validos, sem repeticao e em ordem (o filtro `in` nao aceita id fora do formato; "webinar:<id>" fica de fora). */
function campaignIdsOf(campaignIds: readonly string[] | undefined) {
  return Array.from(new Set((campaignIds ?? []).filter((id) => typeof id === "string" && UUID.test(id)))).sort();
}

/** v4b: ids dos webinarios das chaves "webinar:<id>" (validos, sem repeticao e em ordem). */
export function webinarIdsOfKeys(keys: readonly string[] | undefined) {
  return Array.from(
    new Set(
      (keys ?? []).flatMap((key) => {
        const id = webinarIdOfKey(key);

        return id && UUID.test(id) ? [id] : [];
      })
    )
  ).sort();
}

/** v3a: ids das opcoes votadas (so texto no formato do id; outra coisa = nao votou). */
function pollChoiceOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const choice = value.filter((id): id is string => typeof id === "string" && POLL_OPTION_ID.test(id));

  return choice.length > 0 ? choice : null;
}

/**
 * Uma linha do sino como fato (datas em texto ISO). `visibleAt` = greatest(created_at, sent_at do aviso):
 * o envio grava em lotes enquanto o aviso esta "sending" e o sino so mostra depois do "sent". Linha que
 * ja traz `visible_at` (o RPC de fatos do lote do motor, 7.9) usa esse valor. v3a (docs/24 §6): reacao
 * (so um id do catalogo), voto (so ids no formato) e exclusao do sino, lidos com tolerancia (a 7.9 da
 * 0002 nao manda essas chaves: ausente = nao reagiu, nao votou, nao excluiu).
 */
export function messageFactOf(row: {
  audio_completed_at: string | null;
  audio_started_at: string | null;
  clicked_at: string | null;
  created_at?: string | null;
  expires_at: string;
  hidden_at?: string | null;
  opened_at: string | null;
  poll_choice?: unknown;
  reaction?: string | null;
  response: string | null;
  seen_at: string | null;
  sent_at?: string | null;
  visible_at?: string | null;
}): MessageFact {
  const createdAt = timeOf(row.created_at);
  const sentAt = timeOf(row.sent_at);
  const visibleAt = timeOf(row.visible_at) ?? (createdAt === null ? (sentAt ?? 0) : sentAt === null ? createdAt : Math.max(createdAt, sentAt));

  return {
    audioCompletedAt: timeOf(row.audio_completed_at),
    audioStartedAt: timeOf(row.audio_started_at),
    clickedAt: timeOf(row.clicked_at),
    expiresAt: timeOf(row.expires_at) ?? visibleAt,
    hiddenAt: timeOf(row.hidden_at),
    openedAt: timeOf(row.opened_at),
    pollChoice: pollChoiceOf(row.poll_choice),
    reaction: isReactionId(row.reaction) ? row.reaction : null,
    response: row.response === "accepted" || row.response === "declined" ? row.response : null,
    seenAt: timeOf(row.seen_at),
    visibleAt
  };
}

/**
 * Linhas do sino (fora as de teste) dos avisos citados, por aluno, com a chave "campaign:<id>". So conta
 * aviso enviado e nao excluido (o sino so mostra esses; "Retirar" ja apaga as linhas): aviso em envio,
 * cancelado ou que nao existe fica sem linha, e quem avalia le "nao recebeu". Paginas de 1000 em ordem
 * de id (sem o corte silencioso do PostgREST); com `userIds`, so as linhas desses alunos (pedacos de
 * 150). Usada por loadAudienceFacts, loadAudienceFactsFor e pelo carregador por chave do tick
 * (facts-loader.ts), que le cada aviso uma vez por tick.
 */
export async function loadMessageFacts(
  db: CommunicationsDb,
  campaignIds: readonly string[],
  options: { userIds?: readonly string[] } = {}
): Promise<MessageFactsByUser> {
  const byUser: MessageFactsByUser = new Map();
  const ids = campaignIdsOf(campaignIds);

  if (ids.length === 0 || options.userIds?.length === 0) {
    return byUser;
  }

  const campaigns = await db.from("campaigns").select("id,status,sent_at,deleted_at").in("id", ids);
  assertNoDbError(campaigns.error, "Comunicacao: avisos das regras de notificacao");

  const sentAt = new Map<string, string | null>();

  for (const campaign of (campaigns.data ?? []) as { deleted_at: string | null; id: string; sent_at: string | null; status: string }[]) {
    if (campaign.status === "sent" && !campaign.deleted_at) {
      sentAt.set(campaign.id, campaign.sent_at);
    }
  }

  const liveIds = ids.filter((id) => sentAt.has(id));
  const userChunks = options.userIds ? chunksOf(Array.from(new Set(options.userIds)).sort(), AUDIENCE_FACTS_CHUNK) : [null];

  if (liveIds.length === 0) {
    return byUser;
  }

  for (const users of userChunks) {
    for (let after: string | null = null; ; ) {
      let query = db.from("notifications").select(MESSAGE_ROW_COLUMNS).in("campaign_id", liveIds).eq("is_test", false);

      if (users) {
        query = query.in("user_id", users);
      }

      if (after) {
        query = query.gt("id", after);
      }

      const { data, error } = await query.order("id").limit(MESSAGE_FACTS_PAGE);
      assertNoDbError(error, "Comunicacao: linhas do sino das regras de notificacao");

      const rows = (data ?? []) as MessageRow[];

      for (const row of rows) {
        const facts = byUser.get(row.user_id) ?? {};

        facts[messageRefKey({ campaignId: row.campaign_id, kind: "campaign" })] = messageFactOf({ ...row, sent_at: sentAt.get(row.campaign_id) ?? null });
        byUser.set(row.user_id, facts);
      }

      if (rows.length < MESSAGE_FACTS_PAGE) {
        break;
      }

      after = rows[rows.length - 1].id;
    }
  }

  return byUser;
}

/**
 * Junta as linhas dos avisos aos fatos ja montados e marca as chaves como lidas (context.messageKeys),
 * para todos os avaliados: quem nao tem linha "nao recebeu". Devolve um novo LoadedAudience (os fatos de
 * quem tem linha sao copiados; os demais sao os mesmos objetos).
 */
export function attachMessageFacts(loaded: LoadedAudience, campaignIds: readonly string[], messages: MessageFactsByUser): LoadedAudience {
  const keys = campaignIdsOf(campaignIds).map((campaignId) => messageRefKey({ campaignId, kind: "campaign" }));
  const messageKeys = new Set([...(loaded.context.messageKeys ?? []), ...keys]);
  const facts = loaded.facts.map((fact) => {
    const own = messages.get(fact.userId);

    return own ? { ...fact, messages: { ...fact.messages, ...own } } : fact;
  });

  return { ...loaded, context: { ...loaded.context, messageKeys }, facts };
}

/* ------------------------------------------------------------------------------------------------
 * Lives de cada aluno: regra "Participação em lives" (docs/30 §1.6)
 * ---------------------------------------------------------------------------------------------- */

/** userId -> lives em que entrou na sala e em que garantiu vaga (ids dos webinarios, em ordem). */
export type WebinarFactsByUser = Map<string, AudienceWebinarFacts>;

/** Alunos por pagina da RPC communication_webinar_facts (o teto do PostgREST tambem corta RPC, sem erro). */
export const WEBINAR_FACTS_PAGE = 1_000;

/** Uma linha por aluno: as lives em que garantiu vaga e as em que entrou na sala (null = nenhuma). */
type WebinarFactsRow = { attended: readonly (string | null)[] | null; registered: readonly (string | null)[] | null; user_id: string | null };

function webinarIdsOf(list: readonly (string | null)[] | null | undefined): string[] {
  return Array.isArray(list) ? Array.from(new Set(list.filter((id): id is string => typeof id === "string" && id !== ""))).sort() : [];
}

/**
 * As lives de cada aluno pela RPC communication_webinar_facts (sem a equipe; a RPC une a vaga 'registered', a
 * presenca resumida das sessoes ao vivo e gravadas e as amostras da sessao em andamento; o replay nao conta), uma
 * linha por aluno. Todos os alunos: paginas de 1000 alunos por chave (p_after = o ultimo id da pagina anterior; a RPC
 * escolhe os proximos pelos indices por user_id, entao cada pagina custa o mesmo e ninguem pula de pagina se uma vaga
 * mudar no meio; uma pagina menor que 1000 e a ultima). Com `userIds`, so estes alunos (pedacos de 150, uma chamada
 * cada; [] = nada lido). Banco sem a migracao 202610300001: null (quem chama deixa context.webinarFactsLoaded de fora
 * e a regra nunca combina). Outros erros sobem.
 */
export async function loadWebinarFacts(db: CommunicationsDb, options: { userIds?: readonly string[] } = {}): Promise<WebinarFactsByUser | null> {
  const byUser: WebinarFactsByUser = new Map();
  const userChunks = options.userIds ? chunksOf(Array.from(new Set(options.userIds.filter((id) => UUID.test(id)))).sort(), AUDIENCE_FACTS_CHUNK) : [null];

  if (options.userIds && userChunks.length === 0) {
    return byUser;
  }

  for (const users of userChunks) {
    let after: string | null = null;

    for (;;) {
      const { data, error } = await db
        .rpc("communication_webinar_facts", users ? { p_user_ids: users } : { p_after: after, p_limit: WEBINAR_FACTS_PAGE })
        .order("user_id");

      if (error) {
        if (isMissingCommunicationSchema(error)) {
          console.error("[comunicacao] lives de cada aluno indisponiveis (migracao 202610300001 pendente).");
          return null;
        }

        throw new Error(`Comunicacao: lives de cada aluno: ${error.message}`);
      }

      const rows = (data ?? []) as WebinarFactsRow[];

      for (const row of rows) {
        if (!row.user_id) {
          continue;
        }

        const attended = webinarIdsOf(row.attended);
        const registered = webinarIdsOf(row.registered);

        if (attended.length > 0 || registered.length > 0) {
          byUser.set(row.user_id, { attended, registered });
        }
      }

      const last = rows.at(-1)?.user_id ?? null;

      // Com ids, uma chamada basta; todos: ate a pagina menor que 1000 (o id da ultima linha e a chave da proxima).
      if (users || rows.length < WEBINAR_FACTS_PAGE || !last || (after !== null && last <= after)) {
        break;
      }

      after = last;
    }
  }

  return byUser;
}

/**
 * Junta as lives aos fatos ja montados e marca a leitura (context.webinarFactsLoaded) para todos os avaliados:
 * quem nao tem linha "nunca participou nem garantiu vaga". `webinars` null (banco sem a migracao) devolve o
 * mesmo LoadedAudience, sem a marca. Os fatos de quem tem linha sao copiados; os demais sao os mesmos objetos.
 */
export function attachWebinarFacts(loaded: LoadedAudience, webinars: WebinarFactsByUser | null): LoadedAudience {
  if (!webinars) {
    return loaded;
  }

  const facts = loaded.facts.map((fact) => {
    const own = webinars.get(fact.userId);

    return own ? { ...fact, webinars: own } : fact;
  });

  return { ...loaded, context: { ...loaded.context, webinarFactsLoaded: true }, facts };
}

/* ------------------------------------------------------------------------------------------------
 * v4b: os fatos dos webinarios citados por regras "webinar_follow_up" (o "Webinário" da fase 4)
 * ---------------------------------------------------------------------------------------------- */

const NOTHING_READ: WebinarFollowUpRead = { byUser: new Map(), loadedIds: [] };

/**
 * Junta os fatos dos webinarios lidos aos fatos ja montados e marca "webinar:<id>" em context.messageKeys (so os
 * lidos: um webinario apagado continua fora, e a regra nao combina). Devolve um novo LoadedAudience (os fatos de quem
 * tem linha sao copiados; os demais sao os mesmos objetos).
 */
export function attachWebinarFollowUpFacts(loaded: LoadedAudience, read: WebinarFollowUpRead): LoadedAudience {
  if (read.loadedIds.length === 0) {
    return loaded;
  }

  const messageKeys = new Set([...(loaded.context.messageKeys ?? []), ...read.loadedIds.map(webinarRuleKey)]);
  const facts = loaded.facts.map((fact) => {
    const own = read.byUser.get(fact.userId);

    return own ? { ...fact, webinarFollowUps: { ...fact.webinarFollowUps, ...own } } : fact;
  });

  return { ...loaded, context: { ...loaded.context, messageKeys }, facts };
}

/* ------------------------------------------------------------------------------------------------
 * Carregadores
 * ---------------------------------------------------------------------------------------------- */

export type AudienceFactsOptions = {
  /**
   * Avisos citados por regras "o que fez com a notificacao X" (collectMessageCampaignIds); [] = nenhum. v4b: as
   * chaves "webinar:<id>" das regras "webinar_follow_up" vem na mesma lista e trazem os fatos do webinario.
   */
  messageCampaignIds?: readonly string[];
  /**
   * Le as lives de cada aluno (regra "Participação em lives"; audienceFactNeeds(...).webinars). Sem isto, nada e
   * lido e a regra nunca combina.
   */
  webinars?: boolean;
};

/** Todos os alunos (fora a equipe), com as linhas do sino so dos avisos pedidos. */
export async function loadAudienceFacts(
  db: CommunicationsDb,
  now: Date | number = Date.now(),
  options: AudienceFactsOptions = {}
): Promise<LoadedAudience> {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const messageCampaignIds = campaignIdsOf(options.messageCampaignIds);
  const webinarIds = webinarIdsOfKeys(options.messageCampaignIds);
  const [profiles, staff, entitlements, progressRows, lessonIndex, memberships, comments, messages, webinars, webinarFollowUps] = await Promise.all([
    fetchProfiles(db),
    fetchStaffUserIds(db),
    fetchEntitlements(db),
    fetchProgressRows(db),
    fetchPublishedLessonIndex(db),
    fetchCohortMemberships(db),
    fetchCommentCounts(db),
    loadMessageFacts(db, messageCampaignIds),
    options.webinars ? loadWebinarFacts(db) : Promise.resolve(null),
    webinarIds.length > 0 ? loadWebinarFollowUpFacts(db, webinarIds) : Promise.resolve(NOTHING_READ)
  ]);
  const { facts, people } = buildStudentFacts({ comments, entitlements, lessonIndex, memberships, now: nowMs, profiles, progressRows, staff });
  const loaded: LoadedAudience = {
    context: {
      commentRanks: buildCommentRanks(facts),
      lessonTotals: lessonTotalsOf(lessonIndex),
      messageKeys: new Set<string>(),
      now: nowMs
    },
    facts,
    people
  };

  return attachWebinarFollowUpFacts(attachWebinarFacts(attachMessageFacts(loaded, messageCampaignIds, messages), webinars), webinarFollowUps);
}

export type AudienceFactsForOptions = AudienceFactsOptions & {
  /**
   * Contagem de comentarios ja lida neste tick (cache do motor). Sem ela, le a contagem quando
   * `comments` nao e "none".
   */
  commentCounts?: ReadonlyMap<string, AudienceCommentCounts>;
  /**
   * Comentarios: "none" (zero para todos, sem leitura), "counts" (a contagem de cada um) ou "ranked"
   * (mais o ranking "top N", entre TODOS os alunos fora a equipe, como em loadAudienceFacts). Padrao
   * "ranked".
   */
  comments?: "counts" | "none" | "ranked";
  /**
   * Acessos destes alunos ja lidos (o RPC de fatos do lote do motor, abertos ou nao). Sem eles, le os
   * acessos pelos ids.
   */
  entitlements?: readonly AudienceEntitlementRow[];
  /** Indice de aulas publicadas ja lido neste tick (cache do motor). Sem ele, le. */
  lessonIndex?: Map<string, Set<string>>;
  /** Quem e da equipe (o RPC de fatos do lote ja traz). Sem isso, le admin_roles. */
  staff?: ReadonlySet<string>;
  /**
   * As lives destes alunos ja lidas (loadWebinarFacts, ou null num banco sem a migracao). Sem elas e com
   * `webinars`, le pelos ids.
   */
  webinarFacts?: WebinarFactsByUser | null;
};

/**
 * Os mesmos fatos de loadAudienceFacts, so para estes alunos (o lote do motor dos fluxos): perfis,
 * progresso, turmas e acessos pelos ids, em pedacos de 150. A equipe fica de fora; id sem perfil nao
 * aparece em `facts`. O ranking "top N" de comentarios e sempre entre todos os alunos.
 */
export async function loadAudienceFactsFor(
  db: CommunicationsDb,
  userIds: readonly string[],
  now: Date | number = Date.now(),
  options: AudienceFactsForOptions = {}
): Promise<LoadedAudience> {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const ids = Array.from(new Set(userIds.filter(Boolean))).sort();
  const messageCampaignIds = campaignIdsOf(options.messageCampaignIds);
  const webinarIds = webinarIdsOfKeys(options.messageCampaignIds);
  const commentsMode = options.comments ?? "ranked";
  const readRows = async (chunk: string[]) => {
    const [profiles, progressRows, memberships, entitlements] = await Promise.all([
      fetchProfilesByIds(db, chunk),
      fetchProgressRows(db, { userIds: chunk }),
      fetchCohortMemberships(db, { userIds: chunk }),
      options.entitlements ? Promise.resolve([]) : fetchEntitlements(db, { userIds: chunk })
    ]);

    return { entitlements, memberships, profiles, progressRows };
  };
  const [chunks, staff, lessonIndex, comments, messages, webinars, webinarFollowUps] = await Promise.all([
    (async () => {
      const results = [];

      for (const chunk of chunksOf(ids, AUDIENCE_FACTS_CHUNK)) {
        results.push(await readRows(chunk));
      }

      return results;
    })(),
    options.staff ? Promise.resolve(options.staff) : ids.length > 0 ? fetchStaffUserIds(db) : Promise.resolve(new Set<string>()),
    options.lessonIndex ? Promise.resolve(options.lessonIndex) : fetchPublishedLessonIndex(db),
    options.commentCounts
      ? Promise.resolve(options.commentCounts)
      : commentsMode === "none" || ids.length === 0
        ? Promise.resolve(new Map<string, AudienceCommentCounts>())
        : fetchCommentCounts(db),
    loadMessageFacts(db, messageCampaignIds, { userIds: ids }),
    options.webinarFacts !== undefined
      ? Promise.resolve(options.webinarFacts)
      : options.webinars
        ? loadWebinarFacts(db, { userIds: ids })
        : Promise.resolve(null),
    webinarIds.length > 0 && ids.length > 0 ? loadWebinarFollowUpFacts(db, webinarIds, { userIds: ids }) : Promise.resolve(NOTHING_READ)
  ]);
  const wanted = new Set(ids);
  const { facts, people } = buildStudentFacts({
    comments: commentsMode === "none" ? new Map() : comments,
    entitlements: options.entitlements ? options.entitlements.filter((row) => wanted.has(row.user_id)) : chunks.flatMap((chunk) => chunk.entitlements),
    lessonIndex,
    memberships: chunks.flatMap((chunk) => chunk.memberships),
    now: nowMs,
    profiles: chunks.flatMap((chunk) => chunk.profiles),
    progressRows: chunks.flatMap((chunk) => chunk.progressRows),
    staff
  });
  const rankEntries =
    commentsMode === "ranked"
      ? Array.from(comments, ([userId, counts]) => ({ comments: counts, userId })).filter((entry) => !staff.has(entry.userId))
      : [];
  const loaded: LoadedAudience = {
    context: {
      commentRanks: buildCommentRanks(rankEntries),
      lessonTotals: lessonTotalsOf(lessonIndex),
      messageKeys: new Set<string>(),
      now: nowMs
    },
    facts,
    people
  };

  return attachWebinarFollowUpFacts(attachWebinarFacts(attachMessageFacts(loaded, messageCampaignIds, messages), webinars), webinarFollowUps);
}
