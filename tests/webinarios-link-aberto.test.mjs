import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";
import "./support/transpile-tsx.mjs";
import { scriptedDb, webinarRow } from "./support/webinarios-banco-falso.mjs";

// O link aberto dos webinarios (docs/30 §14, D127 a D134; docs/18 §2.2; pedido do produtor de 23/11/2026: "Eu quero ter
// um link para mandar para pessoas que queiram participar sem ser alunos", "pode ser 1 como pode ser 100 ou mais"),
// sem banco:
// - a chave em room_settings.openLink: o padrao desligado, a leitura que ignora o estranho, o rascunho que grava no
//   mesmo jsonb sem perder as chaves da sala e o zod que aceita o editor de antes (sem a chave);
// - o formulario contra o que a equipe pediu (Nao pedir ignorado, Opcional vazio nulo, Obrigatorio recusado), o
//   telefone so com digitos, o e-mail conferido e o aceite obrigatorio quando a pessoa da e-mail ou telefone;
// - o convidado pelo app_metadata (o slug so no formato do webinario) e as paginas que ele abre;
// - o acesso: com o link ligado, o aluno logado e o convidado deste webinario entram; o convidado de outro webinario e
//   o convidado com o link desligado nao; sem o link, o Quem pode de sempre;
// - a entrada (enterByOpenLink) num banco falso: a conta com o app_metadata, o perfil com a marca e o e-mail de contato,
//   a linha com o aceite; o link desligado, o rascunho e o robo recusados sem criar nada; a conta sai quando a marca
//   falha; o teto por endereco;
// - a simulacao escondida com o link ligado (CDC, docs/30 §8.6) e o CSV da lista;
// - a lista de Alunos e a busca por e-mail sem o convidado.

const linkModel = await import("../src/server/webinars/open-link-model.ts");
const access = await import("../src/server/webinars/access.ts");
const rows = await import("../src/server/webinars/rows.ts");
const schemas = await import("../src/server/webinars/schemas.ts");
const model = await import("../src/server/webinars/model.ts");
const guests = await import("../src/server/webinars/guests.ts");

const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const OUTRO = "aaaaaaaa-1111-4111-8111-222222222222";
const ALUNA = "cccccccc-3333-4333-8333-333333333333";
const AGORA = Date.parse("2026-11-23T15:00:00.000Z");

const LIGADO = { email: "required", enabled: true, name: "required", phone: "optional" };
const entrada = (body) => guestEntryBody(body);

function guestEntryBody(body) {
  return linkModel.guestEntryBodySchema.parse(body);
}

test("a chave do link aberto: padrao desligado, leitura tolerante e gravada no room_settings sem perder a sala", () => {
  assert.deepEqual(linkModel.defaultOpenLink(), { email: "off", enabled: false, name: "required", phone: "off" });
  assert.deepEqual(linkModel.openLinkOfRoomSettings(null), linkModel.defaultOpenLink());
  assert.deepEqual(linkModel.openLinkOfRoomSettings({ openLink: "sim" }), linkModel.defaultOpenLink());
  assert.deepEqual(linkModel.openLinkOfRoomSettings({ openLink: { email: "talvez", enabled: "true", name: "off", phone: "required" } }), {
    email: "off",
    enabled: false,
    name: "off",
    phone: "required"
  });

  const webinar = rows.webinarFromRow(webinarRow({ room_settings: { chatMode: "moderated", openLink: LIGADO } }));
  assert.deepEqual(webinar.openLink, LIGADO);
  assert.equal(webinar.roomSettings.chatMode, "moderated");

  const patch = rows.webinarRowPatch({ ...model.emptyWebinarDraft("simulated"), openLink: LIGADO, title: "Live" });
  assert.deepEqual(patch.room_settings.openLink, LIGADO);
  assert.equal(patch.room_settings.chatMode, "open");

  // O webinario de antes (sem a chave) continua fechado.
  assert.equal(rows.webinarFromRow(webinarRow()).openLink.enabled, false);
});

test("o zod do rascunho aceita o editor de antes (sem openLink) e recusa um modo que nao existe", () => {
  const draft = { ...model.emptyWebinarDraft("simulated"), title: "Live" };
  delete draft.openLink;
  const parsed = schemas.webinarDraftSchema.safeParse(draft);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.openLink, linkModel.defaultOpenLink());

  const wrong = schemas.webinarDraftSchema.safeParse({ ...draft, openLink: { ...LIGADO, phone: "talvez" } });
  assert.equal(wrong.success, false);
});

test("o formulario segue o que a equipe pediu", () => {
  const titulo = "Live de agentes";

  // Obrigatorio vazio recusa; aceite obrigatorio com contato.
  const vazio = linkModel.validateGuestEntry(LIGADO, entrada({}), titulo);
  assert.equal(vazio.ok, false);
  assert.equal(vazio.errors.name, linkModel.GUEST_MESSAGES.nameRequired);
  assert.equal(vazio.errors.email, linkModel.GUEST_MESSAGES.emailRequired);
  assert.equal(vazio.errors.phone, undefined);

  const semAceite = linkModel.validateGuestEntry(LIGADO, entrada({ email: "ana@exemplo.com", name: "Ana Souza" }), titulo);
  assert.equal(semAceite.ok, false);
  assert.deepEqual(Object.keys(semAceite.errors), ["consent"]);

  const certo = linkModel.validateGuestEntry(LIGADO, entrada({ consent: true, email: " Ana@Exemplo.com ", name: "  Ana   Souza ", phone: "(11) 98765-4321", source: "grupo" }), titulo);
  assert.equal(certo.ok, true);
  assert.deepEqual(certo.entry, {
    consentText: linkModel.guestConsentText(titulo),
    email: "ana@exemplo.com",
    name: "Ana Souza",
    phone: "11987654321",
    source: "grupo"
  });
  assert.match(certo.entry.consentText, /Live de agentes/);

  // E-mail e telefone errados.
  const errados = linkModel.validateGuestEntry(LIGADO, entrada({ consent: true, email: "ana@", name: "Ana", phone: "123" }), titulo);
  assert.equal(errados.errors.email, linkModel.GUEST_MESSAGES.email);
  assert.equal(errados.errors.phone, linkModel.GUEST_MESSAGES.phone);
  assert.equal(linkModel.normalizeGuestPhone("+55 11 98765-4321"), "+5511987654321");

  // Nada pedido: entra sem nada e sem aceite; o que veio e ignorado (nem gravado).
  const nada = { email: "off", enabled: true, name: "off", phone: "off" };
  const livre = linkModel.validateGuestEntry(nada, entrada({ email: "x@y.com", name: "Zé" }), titulo);
  assert.deepEqual(livre, { entry: { consentText: null, email: null, name: null, phone: null, source: null }, ok: true });

  // Opcional vazio fica nulo e nao pede aceite.
  const opcional = { email: "optional", enabled: true, name: "optional", phone: "off" };
  assert.deepEqual(linkModel.validateGuestEntry(opcional, entrada({}), titulo), {
    entry: { consentText: null, email: null, name: null, phone: null, source: null },
    ok: true
  });
  assert.equal(linkModel.openLinkAsksContact(opcional), true);
  assert.equal(linkModel.openLinkAsksContact(nada), false);
});

test("o convidado pelo app_metadata e as paginas que ele abre", () => {
  assert.deepEqual(linkModel.guestIdentityOf({ webinar_guest: { slug: "live-de-agentes", webinar_id: WEBINAR } }), { slug: "live-de-agentes", webinarId: WEBINAR });
  assert.equal(linkModel.guestIdentityOf({ webinar_guest: { slug: "../admin", webinar_id: WEBINAR } }), null);
  assert.equal(linkModel.guestIdentityOf({ provider: "email" }), null);
  assert.equal(linkModel.isGuestUser({ app_metadata: {} }), false);

  for (const path of ["/webinarios/live-de-agentes", "/webinarios/live-de-agentes/sala", "/webinarios/live-de-agentes/entrar", "/login", "/auth/callback"]) {
    assert.equal(linkModel.guestAllowedPath(path), true, path);
  }
  for (const path of ["/", "/webinarios", "/perfil", "/conteudo/x", "/admin", "/webinarios/live/outra/coisa", "/minhas-compras"]) {
    assert.equal(linkModel.guestAllowedPath(path), false, path);
  }
  assert.equal(linkModel.openLinkAnonymousPath("/webinarios/live-de-agentes"), true);
  assert.equal(linkModel.openLinkAnonymousPath("/webinarios/live-de-agentes/entrar"), true);
  assert.equal(linkModel.openLinkAnonymousPath("/webinarios/live-de-agentes/sala"), false);
  assert.equal(linkModel.openLinkAnonymousPath("/webinarios"), false);
  assert.equal(linkModel.webinarEntryPath("live-de-agentes"), "/webinarios/live-de-agentes/entrar");
});

test("o acesso: com o link ligado entram o aluno logado e o convidado deste webinario; o de outro, nunca", () => {
  const base = { anchoredWebinarIds: new Set(), entitlements: [], isStaff: false, loaded: null, now: AGORA, userId: ALUNA };
  const fechado = { accessMode: "product", audience: { kind: "everyone" }, id: WEBINAR, productId: "curso-x" };
  const aberto = { ...fechado, openLink: { enabled: true } };

  assert.equal(access.hasWebinarAccess(base, fechado), false);
  assert.equal(access.hasWebinarAccess(base, aberto), true);

  const convidado = { ...base, guestWebinarId: WEBINAR };
  assert.equal(access.hasWebinarAccess(convidado, aberto), true);
  // O link desligado depois: o convidado nao entra mais, nem num webinario "Todos".
  assert.equal(access.hasWebinarAccess(convidado, { ...fechado, accessMode: "everyone", productId: null }), false);
  // Outro webinario, mesmo aberto.
  assert.equal(access.hasWebinarAccess(convidado, { ...aberto, id: OUTRO }), false);
  // A equipe sempre.
  assert.equal(access.hasWebinarAccess({ ...base, isStaff: true }, fechado), true);
});

test("loadStudentAccessFacts le o convidado e nao le acessos nem segmento dele", async () => {
  const db = scriptedDb((query) => {
    if (query.table === "admin_roles") {
      return { data: null, error: null };
    }
    if (query.table === "webinar_guests") {
      return { data: { webinar_id: WEBINAR }, error: null };
    }
    throw new Error(`consulta inesperada: ${query.table}`);
  });
  const facts = await access.loadStudentAccessFacts(db, ALUNA, [{ accessMode: "product", audience: { kind: "everyone" }, id: WEBINAR, productId: "curso-x" }], AGORA);
  assert.equal(facts.guestWebinarId, WEBINAR);
  assert.deepEqual(
    db.queries.map((query) => query.table).sort(),
    ["admin_roles", "webinar_guests"]
  );

  // Banco sem a migracao: ninguem e convidado.
  const antigo = scriptedDb((query) => {
    if (query.table === "webinar_guests") {
      return { data: null, error: { code: "42P01", message: 'relation "public.webinar_guests" does not exist' } };
    }
    return { data: query.table === "entitlements" ? [] : null, error: null };
  });
  const semMigracao = await access.loadStudentAccessFacts(antigo, ALUNA, [{ accessMode: "everyone", audience: { kind: "everyone" }, id: WEBINAR, productId: null }], AGORA);
  assert.equal(semMigracao.guestWebinarId ?? null, null);
});

/** Banco falso da entrada: o webinario pelo slug, a contagem, o perfil, a linha e o Auth. */
function bancoDaEntrada({ markFails = false, room = { openLink: LIGADO }, row = {} } = {}) {
  const criadas = [];
  const apagadas = [];
  const db = scriptedDb((query) => {
    if (query.table === "webinars") {
      return { data: webinarRow({ room_settings: room, ...row }), error: null };
    }
    if (query.table === "webinar_guests" && query.op === "select") {
      return { count: 3, data: null, error: null };
    }
    if (query.table === "profiles" && query.op === "upsert") {
      return markFails ? { data: null, error: { code: "XX000", message: "falhou" } } : { data: null, error: null };
    }
    if (query.table === "webinar_guests" && query.op === "insert") {
      return { data: null, error: null };
    }
    throw new Error(`consulta inesperada: ${query.table} ${query.op}`);
  });
  db.auth = {
    admin: {
      async createUser(input) {
        criadas.push(input);
        return { data: { user: { id: "dddddddd-4444-4444-8444-444444444444" } }, error: null };
      },
      async deleteUser(id) {
        apagadas.push(id);
        return { error: null };
      }
    }
  };
  return { apagadas, criadas, db };
}

let endereco = 0;
const novoEndereco = () => `10.0.0.${++endereco}`;

test("a entrada cria a conta de convidado presa ao webinario, com a marca e o aceite", async () => {
  const { criadas, db } = bancoDaEntrada();
  const outcome = await guests.enterByOpenLink(
    { address: novoEndereco(), body: { consent: true, email: "ana@exemplo.com", name: "Ana Souza", phone: "11987654321", source: "anuncio" }, now: new Date(AGORA), slug: "live-de-agentes" },
    db
  );

  assert.equal(outcome.ok, true);
  assert.match(outcome.credentials.email, /^convidado-[0-9a-f-]{36}@convidados\.invalid$/);
  assert.ok(outcome.credentials.password.length >= 24);
  assert.equal(outcome.credentials.slug, "live-de-agentes");

  assert.equal(criadas.length, 1);
  assert.deepEqual(criadas[0].app_metadata, { webinar_guest: { slug: "live-de-agentes", webinar_id: WEBINAR } });
  assert.equal(criadas[0].email_confirm, true);
  assert.deepEqual(criadas[0].user_metadata, { full_name: "Ana Souza" });

  const perfil = db.queries.find((query) => query.table === "profiles");
  assert.deepEqual(perfil.payload, { email: "ana@exemplo.com", full_name: "Ana Souza", id: "dddddddd-4444-4444-8444-444444444444", is_guest: true, phone: "11987654321" });
  const linha = db.queries.find((query) => query.table === "webinar_guests" && query.op === "insert");
  assert.equal(linha.payload.webinar_id, WEBINAR);
  assert.equal(linha.payload.consent_at, new Date(AGORA).toISOString());
  assert.equal(linha.payload.consent_text, linkModel.guestConsentText("Live de agentes"));
  assert.equal(linha.payload.source, "anuncio");
});

test("sem nome, o chat mostra Convidado; com o campo faltando, 422 sem criar nada", async () => {
  const nada = bancoDaEntrada({ room: { openLink: { email: "off", enabled: true, name: "off", phone: "off" } } });
  const outcome = await guests.enterByOpenLink({ address: novoEndereco(), body: {}, now: new Date(AGORA), slug: "live-de-agentes" }, nada.db);
  assert.equal(outcome.ok, true);
  assert.equal(nada.criadas[0].user_metadata.full_name, "Convidado");
  assert.equal(nada.db.queries.find((query) => query.table === "profiles").payload.email, null);

  const falta = bancoDaEntrada();
  const recusa = await guests.enterByOpenLink({ address: novoEndereco(), body: { name: "Ana" }, now: new Date(AGORA), slug: "live-de-agentes" }, falta.db);
  assert.equal(recusa.ok, false);
  assert.ok(recusa.errors.email);
  assert.equal(falta.criadas.length, 0);
});

test("link desligado, rascunho, cancelado e robo: nada e criado", async () => {
  for (const caso of [{ room: { openLink: { ...LIGADO, enabled: false } } }, { row: { status: "draft" } }, { row: { cancelled_at: new Date(AGORA).toISOString() } }]) {
    const { criadas, db } = bancoDaEntrada(caso);
    await assert.rejects(
      guests.enterByOpenLink({ address: novoEndereco(), body: { consent: true, email: "a@b.com", name: "Ana" }, now: new Date(AGORA), slug: "live-de-agentes" }, db),
      (error) => error.status === 404
    );
    assert.equal(criadas.length, 0);
  }

  const robo = bancoDaEntrada();
  await assert.rejects(
    guests.enterByOpenLink({ address: novoEndereco(), body: { consent: true, email: "a@b.com", name: "Ana", website: "http://spam" }, now: new Date(AGORA), slug: "live-de-agentes" }, robo.db),
    (error) => error.status === 400
  );
  assert.equal(robo.criadas.length, 0);
});

test("sem a marca no perfil, a conta sai", async () => {
  const { apagadas, db } = bancoDaEntrada({ markFails: true });
  await assert.rejects(guests.enterByOpenLink({ address: novoEndereco(), body: { consent: true, email: "a@b.com", name: "Ana" }, now: new Date(AGORA), slug: "live-de-agentes" }, db));
  assert.deepEqual(apagadas, ["dddddddd-4444-4444-8444-444444444444"]);
});

test("o teto por endereco: 30 entradas por minuto, depois 429", async () => {
  const ip = novoEndereco();
  for (let index = 0; index < 30; index += 1) {
    const { db } = bancoDaEntrada();
    const outcome = await guests.enterByOpenLink({ address: ip, body: { consent: true, email: `a${index}@b.com`, name: "Ana" }, now: new Date(AGORA), slug: "live-de-agentes" }, db);
    assert.equal(outcome.ok, true);
  }
  const { criadas, db } = bancoDaEntrada();
  await assert.rejects(
    guests.enterByOpenLink({ address: ip, body: { consent: true, email: "z@b.com", name: "Ana" }, now: new Date(AGORA), slug: "live-de-agentes" }, db),
    (error) => error.status === 429
  );
  assert.equal(criadas.length, 0);
  assert.equal(guests.requestAddress(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
});

test("com o link ligado, nada simulado para ninguem (CDC) e o CSV da lista", () => {
  assert.equal(linkModel.simulationHidden({ openLink: { enabled: true } }), true);
  assert.equal(linkModel.simulationHidden({ openLink: { enabled: false } }), false);
  assert.equal(linkModel.simulationHidden({}), false);

  const linhas = linkModel.guestCsvRows(
    [
      { consentAt: "2026-11-23T15:00:00.000Z", consentText: "x", createdAt: "2026-11-23T15:00:00.000Z", email: "ana@exemplo.com", name: "Ana Souza", phone: "11987654321", source: "grupo" },
      { consentAt: null, consentText: null, createdAt: "2026-11-23T16:00:00.000Z", email: null, name: null, phone: null, source: null }
    ],
    (iso) => (iso ? `quando ${iso.slice(11, 16)}` : "")
  );
  assert.deepEqual(linhas, [
    ["quando 15:00", "Ana Souza", "ana@exemplo.com", "11987654321", "sim", "quando 15:00", "grupo"],
    ["quando 16:00", "Convidado", "", "", "não", "", ""]
  ]);
});

test("as rotas e as paginas: o convidado so onde o webinario pede, e a lista de Alunos sem ele", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  assert.match(read("src/server/webinars/room-route.ts"), /requireApiUser\(\{ allowGuest: true \}\)/);
  for (const route of ["src/app/api/webinars/[id]/register/route.ts", "src/app/api/webinars/[id]/session/route.ts", "src/app/api/webinars/preferences/route.ts"]) {
    assert.match(read(route), /allowGuest: true/, route);
  }
  // Nenhuma outra rota aceita o convidado.
  const guards = read("src/server/auth/guards.ts");
  assert.match(guards, /options\.allowGuest \? await getAuthenticatedUserOrGuest\(\) : await getAuthenticatedUser\(\)/);
  const session = read("src/server/auth/session.ts");
  assert.match(session, /return user && !isGuestUser\(user\) \? user : null;/);

  const store = read("src/server/students/store.ts");
  assert.match(store, /return withoutGuests\(rows\);/);
  assert.match(store, /return row && row\.is_guest !== true \? withoutGuests\(\[row\]\)\[0\] : null;/);

  // A simulacao: as duas rotas e o selo.
  assert.match(read("src/app/api/webinars/[id]/simulation/route.ts"), /simulationHidden\(room\.webinar\)/);
  assert.match(read("src/app/api/webinars/[id]/audience/route.ts"), /simulationHidden\(room\.webinar\)/);
  assert.match(read("src/server/webinars/room-queries.ts"), /showLiveBadge: session\.showLiveBadge && !simulationHidden\(context\.webinar\)/);

  // O proxy manda o convidado de volta e deixa as paginas do link aberto decidirem.
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /openLinkAnonymousPath\(pathname\)/);
  assert.match(proxy, /guestAllowedPath\(pathname\)/);

  // A migracao: a marca e a tabela so do service_role.
  const migration = read("supabase/migrations/202611190001_webinars_link_aberto.sql");
  assert.match(migration, /add column if not exists is_guest boolean not null default false/);
  assert.match(migration, /alter table public\.webinar_guests enable row level security;/);
  assert.match(migration, /revoke all on public\.webinar_guests from anon, authenticated;/);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""), /\b(delete from|truncate|drop (table|column|index|policy)|create policy)\b/i);
});

test("a busca de aluno por e-mail nunca devolve o convidado que deu o mesmo e-mail", async () => {
  const studentsStore = await import("../src/server/students/store.ts");
  const perfil = (extra) => ({ avatar_url: null, created_at: "2026-11-01T00:00:00.000Z", email: "ana@exemplo.com", full_name: "Ana", id: ALUNA, last_sign_in_at: null, phone: null, ...extra });

  const aluna = scriptedDb(() => ({ data: perfil({ is_guest: false }), error: null }));
  assert.deepEqual(await studentsStore.fetchProfileByEmail(aluna, "ana@exemplo.com"), perfil({}));
  // O aluno vem antes do convidado (order by is_guest): so sobra o convidado quando nao ha aluno.
  assert.ok(aluna.queries[0].filters.some(([method, column]) => method === "order" && column === "is_guest"));

  const convidado = scriptedDb(() => ({ data: perfil({ is_guest: true }), error: null }));
  assert.equal(await studentsStore.fetchProfileByEmail(convidado, "ana@exemplo.com"), null);
});

test("o card Quem pode so mostra o link depois de publicar: no rascunho o endereco ainda muda com o titulo (D135)", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AccessCard } = await import("../src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx");
  const draft = { ...model.emptyWebinarDraft("live"), openLink: LIGADO, title: "Live" };
  const desenhar = (saved) =>
    renderToStaticMarkup(
      createElement(AccessCard, {
        audienceDescription: "",
        audienceErrors: {},
        countState: { status: "incomplete" },
        disabled: false,
        draft,
        errorFor: () => undefined,
        now: AGORA,
        onBlur: () => undefined,
        onChange: () => undefined,
        onRetryCount: () => undefined,
        options: { cohorts: [], notices: [], products: [], productsLoaded: true, segments: [], webinars: [] },
        pickerItems: [],
        saved,
        webinarId: WEBINAR
      })
    );

  // Rascunho salvo (o caso do teste do produtor): nada de link para copiar, so a frase.
  const rascunho = desenhar({ published: false, slug: "copia-de-live" });
  assert.doesNotMatch(rascunho, /data-webinar-open-link-url/);
  assert.doesNotMatch(rascunho, /\/webinarios\/copia-de-live\/entrar/);
  assert.match(rascunho, /data-webinar-open-link-pending/);
  assert.match(rascunho, /O link aparece depois de publicar/);

  // Publicado: o link (a origem do navegador fica vazia no servidor) e o Copiar.
  const publicado = desenhar({ published: true, slug: "live-de-agentes" });
  assert.match(publicado, /data-webinar-open-link-url[^>]*>\/webinarios\/live-de-agentes\/entrar</);
  assert.doesNotMatch(publicado, /data-webinar-open-link-pending/);

  // Webinario novo, nunca salvo: a frase tambem.
  assert.match(desenhar(null), /O link aparece depois de publicar/);
});

test("o cartao do link compartilhado leva a capa, o titulo e a descricao do webinario (D136)", () => {
  const capa = "https://exemplo.com/capa.jpg";
  const cartao = linkModel.openLinkShareMetadata({ coverUrl: capa, description: "  Uma landing page\n\ncom IA. ", title: " Live de agentes " }, "Entre na live pelo link.");

  assert.equal(cartao.title, "Live de agentes");
  assert.equal(cartao.description, "Uma landing page com IA.");
  assert.deepEqual(cartao.openGraph.images, [{ alt: "Live de agentes", url: capa }]);
  assert.equal(cartao.openGraph.title, "Live de agentes");
  assert.equal(cartao.openGraph.description, "Uma landing page com IA.");
  assert.equal(cartao.twitter.card, "summary_large_image");

  // Sem capa, nenhuma imagem; sem descricao, a frase; descricao longa, cortada.
  const simples = linkModel.openLinkShareMetadata({ coverUrl: null, description: null, title: "Live" }, "Entre na live pelo link.");
  assert.deepEqual(simples.openGraph.images, []);
  assert.equal(simples.twitter.card, "summary");
  assert.equal(simples.description, "Entre na live pelo link.");
  const longa = linkModel.openLinkShareMetadata({ coverUrl: null, description: "a".repeat(500), title: "Live" }, "x");
  assert.equal(longa.description.length, 200);
  assert.ok(longa.description.endsWith("…"));
});

test("a pagina do formulario monta o cartao so do webinario publicado com o link ligado (D136)", async () => {
  const aberto = scriptedDb(() => ({ data: webinarRow({ cover_url: "https://exemplo.com/capa.jpg", room_settings: { openLink: LIGADO }, status: "published" }), error: null }));
  assert.equal((await guests.loadOpenLinkWebinar(aberto, "live-de-agentes")).coverUrl, "https://exemplo.com/capa.jpg");

  for (const fechado of [{ room_settings: { openLink: LIGADO }, status: "draft" }, { room_settings: { openLink: { ...LIGADO, enabled: false } }, status: "published" }]) {
    assert.equal(await guests.loadOpenLinkWebinar(scriptedDb(() => ({ data: webinarRow(fechado), error: null })), "live-de-agentes"), null);
  }
});
