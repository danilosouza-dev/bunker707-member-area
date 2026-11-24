import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";

// O link aberto dos webinarios (docs/30 §14, D127 a D134; docs/18 §3) contra o banco e o Auth LOCAIS de verdade, com a
// migracao 202611190001 aplicada: a entrada cria a conta de convidado pela API administrativa do Auth (o e-mail
// inventado em .invalid e aceito), o navegador entra com o e-mail e a senha devolvidos (signInWithPassword com a chave
// publica, como o formulario), o JWT traz app_metadata.webinar_guest, o perfil fica com is_guest e o e-mail de contato,
// a linha de webinar_guests guarda o aceite; o acesso so ao webinario dele; a lista de Alunos sem ele; e o convidado
// logado nao le webinar_guests nem tira a propria marca (so o service_role).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const { enterByOpenLink } = await import("../../src/server/webinars/guests.ts");
const { hasWebinarAccess, loadStudentAccessFacts } = await import("../../src/server/webinars/access.ts");
const { webinarFromRow, WEBINAR_COLUMNS } = await import("../../src/server/webinars/rows.ts");
const { fetchProfiles } = await import("../../src/server/students/store.ts");

const produtor = contas.produtor;
const ABERTO = { id: "bbbbbbbb-0000-4000-8000-0000000000c1", slug: "teste-link-aberto", titulo: "Live de Teste: Link aberto" };
const FECHADO = { id: "bbbbbbbb-0000-4000-8000-0000000000c2", slug: "teste-link-fechado", titulo: "Live de Teste: Link fechado" };
const criadas = [];

async function seed() {
  const agora = Date.now();
  unwrap(
    await db.from("webinars").upsert(
      [
        {
          access_mode: "product",
          created_by: produtor.id,
          host_user_id: produtor.id,
          id: ABERTO.id,
          kind: "live",
          product_id: "produto-que-ninguem-tem",
          published_at: new Date(agora - 60_000).toISOString(),
          room_settings: { chatMode: "open", openLink: { email: "optional", enabled: true, name: "required", phone: "off" } },
          scheduled_at: new Date(agora + 3_600_000).toISOString(),
          slug: ABERTO.slug,
          status: "published",
          title: ABERTO.titulo
        },
        {
          access_mode: "everyone",
          created_by: produtor.id,
          host_user_id: produtor.id,
          id: FECHADO.id,
          kind: "live",
          published_at: new Date(agora - 60_000).toISOString(),
          // Gravadas juntas, as duas linhas mandam as mesmas colunas: sem a chave, o PostgREST mandaria nulo.
          product_id: null,
          room_settings: { chatMode: "open" },
          scheduled_at: new Date(agora + 3_600_000).toISOString(),
          slug: FECHADO.slug,
          status: "published",
          title: FECHADO.titulo
        }
      ],
      { onConflict: "id" }
    ),
    "Gravando as lives"
  );
}

before(async () => {
  await limparWebinarios(db);
  await seed();
});

after(async () => {
  actAs(null);
  for (const userId of criadas) {
    await db.auth.admin.deleteUser(userId);
  }
  await limparWebinarios(db);
});

test("a entrada pelo link cria o convidado, que entra pelo navegador e so ve o webinario dele", async () => {
  const outcome = await enterByOpenLink(
    { address: "127.0.0.9", body: { consent: true, email: "visitante.teste@exemplo.com", name: "Visitante Teste", source: "grupo" }, slug: ABERTO.slug },
    db
  );
  assert.equal(outcome.ok, true, JSON.stringify(outcome));

  const navegador = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = await navegador.auth.signInWithPassword({ email: outcome.credentials.email, password: outcome.credentials.password });
  assert.equal(login.error, null, login.error?.message);
  const guestId = login.data.user.id;
  criadas.push(guestId);
  assert.deepEqual(login.data.user.app_metadata.webinar_guest, { slug: ABERTO.slug, webinar_id: ABERTO.id });

  const perfil = unwrap(await db.from("profiles").select("id,email,full_name,is_guest").eq("id", guestId).single(), "Lendo o perfil do convidado");
  assert.deepEqual(perfil, { email: "visitante.teste@exemplo.com", full_name: "Visitante Teste", id: guestId, is_guest: true });

  const linha = unwrap(await db.from("webinar_guests").select("webinar_id,full_name,email,phone,consent_text,consent_at,source").eq("user_id", guestId).single(), "Lendo a entrada");
  assert.equal(linha.webinar_id, ABERTO.id);
  assert.equal(linha.phone, null, "o telefone nao foi pedido");
  assert.match(linha.consent_text, /Link aberto/);
  assert.ok(linha.consent_at);
  assert.equal(linha.source, "grupo");

  // O acesso: so o webinario dele (o "Quem tem o produto" nao o deixaria entrar sem o link).
  const rows = unwrap(await db.from("webinars").select(WEBINAR_COLUMNS).in("id", [ABERTO.id, FECHADO.id]), "Lendo as lives");
  const webinars = rows.map((row) => webinarFromRow(row));
  const facts = await loadStudentAccessFacts(db, guestId, webinars);
  assert.equal(facts.guestWebinarId, ABERTO.id);
  assert.equal(hasWebinarAccess(facts, webinars.find((webinar) => webinar.id === ABERTO.id)), true);
  assert.equal(hasWebinarAccess(facts, webinars.find((webinar) => webinar.id === FECHADO.id)), false, "nem o webinario Todos");

  // O aluno sem o produto entra no aberto pelo link.
  const aluno = await loadStudentAccessFacts(db, contas.alunoSemAcesso.id, webinars);
  assert.equal(hasWebinarAccess(aluno, webinars.find((webinar) => webinar.id === ABERTO.id)), true);

  // A lista de Alunos sem o convidado.
  const alunos = await fetchProfiles(db);
  assert.equal(alunos.some((row) => row.id === guestId), false);
  assert.ok(alunos.some((row) => row.id === contas.aluna.id));

  // O convidado logado nao le a lista nem tira a propria marca.
  const lista = await navegador.from("webinar_guests").select("id");
  assert.ok(lista.error || (lista.data ?? []).length === 0, "webinar_guests e so do service_role");
  const tirar = await navegador.from("profiles").update({ is_guest: false }).eq("id", guestId);
  assert.ok(tirar.error, "o aluno nunca muda is_guest");
  const depois = unwrap(await db.from("profiles").select("is_guest").eq("id", guestId).single(), "Relendo a marca");
  assert.equal(depois.is_guest, true);
});

test("sem nada pedido entra como Convidado; o webinario sem o link recusa sem criar conta", async () => {
  unwrap(
    await db.from("webinars").update({ room_settings: { openLink: { email: "off", enabled: true, name: "off", phone: "off" } } }).eq("id", ABERTO.id),
    "Tirando os campos"
  );
  const outcome = await enterByOpenLink({ address: "127.0.0.10", body: {}, slug: ABERTO.slug }, db);
  assert.equal(outcome.ok, true);
  const navegador = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = await navegador.auth.signInWithPassword({ email: outcome.credentials.email, password: outcome.credentials.password });
  assert.equal(login.error, null, login.error?.message);
  criadas.push(login.data.user.id);
  const perfil = unwrap(await db.from("profiles").select("email,full_name,is_guest").eq("id", login.data.user.id).single(), "Lendo o perfil");
  assert.deepEqual(perfil, { email: null, full_name: "Convidado", is_guest: true });

  await assert.rejects(enterByOpenLink({ address: "127.0.0.11", body: { name: "Ana" }, slug: FECHADO.slug }, db), (error) => error.status === 404);
  const depois = await db.from("webinar_guests").select("id", { count: "exact", head: true }).eq("webinar_id", FECHADO.id);
  assert.equal(depois.error, null);
  assert.equal(depois.count ?? 0, 0);
});
