import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Area de membros > Destaque (banner do topo da home): validacao do botao e do video, ida e volta
// entre o que esta gravado em platform_settings.hero e o rascunho do editor, o que a home do aluno
// desenha (resolveHomeHero) e a Server Action saveHomeHero com um platform_settings em memoria.

const model = await import("../src/server/member-area/home-hero-model.ts");
const links = await import("../src/server/member-area/home-hero-links.ts");
const { saveHomeHero } = await import("../src/server/member-area/home-hero-actions.ts");
const { canRole } = await import("../src/server/auth/roles.ts");

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const STORAGE = "https://projeto.supabase.co/storage/v1/object/public/content-assets/platform/home-hero";
const IMAGE = `${STORAGE}/a1b2c3.webp`;
const POSTER = `${STORAGE}/d4e5f6.webp`;
const VIDEO = "https://vz-123.b-cdn.net/abc/play_720p.mp4";

/** Destaque como o admin antigo grava hoje (platform-store.ts defaultHero + Marca). */
const LEGACY_HERO = Object.freeze({
  enabled: true,
  image: "/hero/bunker-707-red-front-hero.png",
  mediaType: "image",
  purpose: "school-brand",
  visibility: { badge: false, description: false, title: false }
});

function draft(overrides = {}) {
  return { ...model.DEFAULT_HOME_HERO_DRAFT, ...overrides };
}

/* ------------------------------------------------------------------------------------------------
 * Links do botao e do video
 * ---------------------------------------------------------------------------------------------- */

test("botão: aceita caminho da área e https; recusa outro site, api, javascript, http, mailto e espaço", () => {
  const ok = (value) => model.heroCtaHrefSchema.safeParse(value).success;

  for (const value of ["/", "/minhas-compras", "/favoritos", "/conteudo/curso-ia", "/conteudo/curso-ia?aba=modulos#inicio", "https://exemplo.com/x"]) {
    assert.equal(ok(value), true, value);
    assert.equal(links.isSafeHeroCtaHref(value), true, value);
  }

  for (const value of ["//evil.com", "/\\evil", "javascript:alert(1)", "http://x.com", "mailto:a@b.c", "/api/x", "/api", "/minhas compras", "https://exemplo.com/a b", "", "evil.com", "https://user:senha@exemplo.com"]) {
    assert.equal(ok(value), false, value);
    assert.equal(links.isSafeHeroCtaHref(value), false, value);
  }

  assert.equal(ok(`/${"a".repeat(links.HERO_CTA_INTERNAL_MAX)}`), false, "caminho longo demais");
  assert.match(model.heroCtaHrefSchema.safeParse("http://x.com").error.issues[0].message, /https:\/\//);
  assert.match(model.heroCtaHrefSchema.safeParse("/api/x").error.issues[0].message, /não é uma página/);
});

test("vídeo: só link https direto de .mp4, .webm ou .mov (antes de ? ou #)", () => {
  const ok = (value) => model.heroVideoLinkSchema.safeParse(value).success;

  assert.equal(ok(VIDEO), true);
  assert.equal(ok("https://cdn.exemplo.com/v/abertura.webm?token=1"), true);
  assert.equal(ok("https://cdn.exemplo.com/v/abertura.MOV#t=2"), true);
  assert.equal(ok("http://cdn.exemplo.com/v.mp4"), false);
  assert.equal(ok("https://www.youtube.com/watch?v=abc"), false);
  assert.equal(ok("https://cdn.exemplo.com/playlist.m3u8"), false);
  assert.equal(ok("/hero/video.mp4"), false);
  assert.equal(ok("data:video/mp4;base64,AAAA"), false);
  assert.match(model.heroVideoLinkSchema.safeParse("https://youtu.be/abc").error.issues[0].message, /\.mp4, \.webm ou \.mov/);
});

test("para onde leva: o modo sai do endereço gravado e o padrão de aba segue o tipo de link", () => {
  assert.deepEqual(links.describeCtaDestination(""), { mode: "product", productId: null });
  assert.deepEqual(links.describeCtaDestination("/conteudo/curso-ia"), { mode: "product", productId: "curso-ia" });
  assert.deepEqual(links.describeCtaDestination("/minhas-compras"), { href: "/minhas-compras", mode: "page" });
  assert.deepEqual(links.describeCtaDestination("/conteudo/curso-ia/aulas/m1"), { href: "/conteudo/curso-ia/aulas/m1", mode: "page" });
  assert.deepEqual(links.describeCtaDestination("https://exemplo.com"), { href: "https://exemplo.com", mode: "external" });
  assert.equal(links.productHref("curso-ia"), "/conteudo/curso-ia");
  assert.equal(links.productIdFromHref(links.productHref("bootcamp_2026")), "bootcamp_2026");
  assert.equal(links.defaultCtaTarget("/favoritos"), "same_tab");
  assert.equal(links.defaultCtaTarget("https://exemplo.com"), "new_tab");
  assert.equal(links.homePageLabel("/"), "Início");
  assert.deepEqual(
    links.HOME_PAGE_LINKS.map((page) => page.href),
    ["/", "/minhas-compras", "/favoritos"]
  );
});

/* ------------------------------------------------------------------------------------------------
 * Rascunho: validacao
 * ---------------------------------------------------------------------------------------------- */

test("rascunho: o padrão passa; ligado sem imagem, vídeo sem link ou sem capa e “Mostrar” sem texto não passam", () => {
  assert.deepEqual(model.validateHomeHeroDraft(model.DEFAULT_HOME_HERO_DRAFT), {});

  assert.match(model.validateHomeHeroDraft(draft({ image: null })).image, /imagem padrão/);
  assert.deepEqual(Object.keys(model.validateHomeHeroDraft(draft({ mediaType: "video" }))).sort(), ["poster", "videoUrl"]);
  assert.deepEqual(model.validateHomeHeroDraft(draft({ mediaType: "video", poster: POSTER, videoUrl: VIDEO })), {});
  assert.match(model.validateHomeHeroDraft(draft({ showBadge: true })).badge, /Escreva o selo/);
  assert.match(model.validateHomeHeroDraft(draft({ showTitle: true, title: "   " })).title, /Escreva o título/);
  assert.match(model.validateHomeHeroDraft(draft({ showDescription: true })).description, /descrição/);

  const cta = model.validateHomeHeroDraft(draft({ showCta: true }));
  assert.match(cta.ctaLabel, /texto do botão/);
  assert.match(cta.ctaHref, /para onde/);
  assert.deepEqual(model.validateHomeHeroDraft(draft({ ctaHref: "", ctaLabel: "Começar", showCta: false })), {}, "botão desligado pode ficar sem destino");
});

test("rascunho: desligado não exige imagem nem textos, mas continua recusando link inseguro e texto longo", () => {
  assert.deepEqual(model.validateHomeHeroDraft(draft({ enabled: false, image: null, mediaType: "video", showBadge: true })), {});

  const errors = model.validateHomeHeroDraft(
    draft({ ctaHref: "javascript:alert(1)", enabled: false, image: "data:image/webp;base64,AAAA", title: "x".repeat(91) })
  );
  assert.match(errors.ctaHref, /https:\/\//);
  assert.match(errors.image, /https:\/\//, "data URL nunca vai para o banco");
  assert.match(errors.title, /no máximo 90/);
  assert.deepEqual(model.HERO_TEXT_LIMITS, { badge: 40, ctaLabel: 32, description: 240, title: 90 });
  assert.equal(model.validateHomeHeroDraft(draft({ badge: "x".repeat(41) })).badge, "Use no máximo 40 caracteres.");
  assert.equal(model.validateHomeHeroDraft(draft({ ctaLabel: "x".repeat(33) })).ctaLabel, "Use no máximo 32 caracteres.");
});

test("erros da Server Action viram erro do campo do rascunho", () => {
  assert.deepEqual(
    model.heroFieldErrorsFrom({ "expectedUpdatedAt": ["Recarregue"], "hero.poster": ["Escolha a capa do vídeo."], "hero.videoUrl": ["Cole o link do vídeo.", "outro"] }),
    { poster: "Escolha a capa do vídeo.", videoUrl: "Cole o link do vídeo." }
  );
  assert.deepEqual(model.heroFieldErrorsFrom(undefined), {});
});

/* ------------------------------------------------------------------------------------------------
 * Gravado <-> rascunho
 * ---------------------------------------------------------------------------------------------- */

test("sem nada gravado ou com o destaque padrão do admin antigo, o editor abre no padrão", () => {
  assert.deepEqual(model.heroDraftFromStored(undefined), model.DEFAULT_HOME_HERO_DRAFT);
  assert.deepEqual(model.heroDraftFromStored(null), model.DEFAULT_HOME_HERO_DRAFT);
  assert.deepEqual(model.heroDraftFromStored("lixo"), model.DEFAULT_HOME_HERO_DRAFT);
  assert.deepEqual(model.heroDraftFromStored(LEGACY_HERO), model.DEFAULT_HOME_HERO_DRAFT);
});

test("rascunho lê o legado com a mesma regra de “Mostrar” da home e deduz vídeo pelo link", () => {
  const withTexts = model.heroDraftFromStored({ badge: " Novo ", description: "Texto", image: IMAGE, mediaType: "image", title: "Título", visibility: { title: false } });
  assert.equal(withTexts.badge, "Novo");
  assert.equal(withTexts.showBadge, true, "sem escolha gravada: mostra quando há texto");
  assert.equal(withTexts.showTitle, false, "escolha gravada vale");
  assert.equal(withTexts.title, "Título", "texto escondido continua guardado");
  assert.equal(withTexts.showDescription, true);

  const marcaVideo = model.heroDraftFromStored({ enabled: true, image: VIDEO, mediaType: "video" });
  assert.equal(marcaVideo.mediaType, "video");
  assert.equal(marcaVideo.videoUrl, VIDEO);
  assert.equal(marcaVideo.image, null);
  assert.equal(marcaVideo.poster, null);
  assert.match(model.validateHomeHeroDraft(marcaVideo).poster, /capa do vídeo/, "vídeo antigo sem capa pede a capa ao publicar");

  assert.equal(model.heroDraftFromStored({ image: "https://cdn.exemplo.com/v.webm" }).mediaType, "video");
  assert.equal(model.heroDraftFromStored({ enabled: false, image: 42 }).image, null);
  assert.equal(model.heroDraftFromStored({ enabled: false }).enabled, false);
});

test("gravar preserva purpose e chaves desconhecidas; ida e volta devolve o mesmo rascunho", () => {
  const raw = { ...LEGACY_HERO, futuro: { a: 1 }, purpose: "editorial-highlight", visibility: { ...LEGACY_HERO.visibility, extra: true } };
  const drafts = [
    model.DEFAULT_HOME_HERO_DRAFT,
    draft({
      badge: "Nova turma",
      ctaHref: "/conteudo/curso-ia",
      ctaLabel: "Começar agora",
      description: "Aulas práticas.",
      image: IMAGE,
      showBadge: true,
      showCta: true,
      showDescription: true,
      showTitle: true,
      title: "A IA vira método"
    }),
    draft({ ctaHref: "https://vendas.exemplo.com", ctaLabel: "Garantir vaga", ctaTarget: "new_tab", image: null, mediaType: "video", poster: POSTER, showCta: true, videoUrl: VIDEO }),
    draft({ enabled: false, image: null, title: "Guardado", showTitle: false }),
    draft({ ctaHref: "/favoritos", ctaLabel: "Ver", ctaTarget: "new_tab", showCta: false })
  ];

  for (const current of drafts) {
    const stored = model.buildStoredHero(raw, current);
    assert.equal(stored.purpose, "editorial-highlight");
    assert.deepEqual(stored.futuro, { a: 1 });
    assert.equal(stored.visibility.extra, true);
    assert.deepEqual(model.heroDraftFromStored(stored), current, JSON.stringify(current));
  }

  const video = model.buildStoredHero(raw, drafts[2]);
  assert.equal(video.image, VIDEO, "com vídeo, image continua sendo o link do vídeo (contrato do legado)");
  assert.equal(video.poster, POSTER);
  assert.deepEqual(video.cta, { href: "https://vendas.exemplo.com", label: "Garantir vaga", target: "new_tab" });
  assert.equal(video.visibility.cta, true);

  const backToImage = model.buildStoredHero(video, drafts[1]);
  assert.equal("poster" in backToImage, false, "imagem não leva capa de vídeo");
  assert.equal(model.buildStoredHero({ ...raw, cta: { href: "/", label: "x", target: "same_tab" } }, model.DEFAULT_HOME_HERO_DRAFT).cta, undefined);
  assert.equal(model.buildStoredHero(undefined, model.DEFAULT_HOME_HERO_DRAFT).purpose, "school-brand");
});

test("normalizar antes de gravar: some o que não vale para o modo e “Mostrar” sem texto desliga", () => {
  const mixed = draft({ image: IMAGE, mediaType: "video", poster: POSTER, showBadge: true, videoUrl: VIDEO });
  assert.deepEqual(model.normalizeHeroDraft(mixed), { ...mixed, image: null, showBadge: false });

  const image = model.normalizeHeroDraft(draft({ image: IMAGE, poster: POSTER, videoUrl: VIDEO }));
  assert.equal(image.poster, null);
  assert.equal(image.videoUrl, null);
  assert.equal(model.normalizeHeroDraft(draft({ ctaLabel: "Ir", showCta: true })).showCta, false, "botão sem destino não aparece");
  assert.equal(model.normalizeHeroDraft(draft({ ctaTarget: "new_tab" })).ctaTarget, "same_tab");
});

test("a rota da Marca (espalha o hero gravado e troca só imagem/estado) não apaga botão nem capa", async () => {
  const stored = model.buildStoredHero(
    undefined,
    draft({ ctaHref: "/conteudo/curso-ia", ctaLabel: "Começar", image: null, mediaType: "video", poster: POSTER, showCta: true, videoUrl: VIDEO })
  );
  // Mesmo formato de updatePlatformAppearance (src/server/db/platform-store.ts).
  const afterLogoOnly = { ...stored };
  const afterDisable = { ...stored, enabled: false };
  const afterEnable = { ...afterDisable, enabled: true, image: stored.image, mediaType: stored.mediaType };

  for (const hero of [afterLogoOnly, afterDisable, afterEnable]) {
    const resolved = model.resolveHomeHero(hero);
    assert.deepEqual(resolved.cta, { href: "/conteudo/curso-ia", label: "Começar", target: "same_tab" });
    assert.equal(resolved.poster, POSTER);
  }

  const platformStore = await readSource("../src/server/db/platform-store.ts");
  const applyHero = platformStore.slice(platformStore.indexOf("function applyAppearanceToHero"));
  assert.match(applyHero, /return \{ \.\.\.current, enabled: false \};/);
  assert.match(applyHero, /return \{\s*\.\.\.current,\s*enabled: true,/);
  const appearance = platformStore.slice(platformStore.indexOf("export async function updatePlatformAppearance"));
  assert.match(appearance, /updatePlatformSettingLatest\("hero", \(current\) =>/, "rele o destaque gravado agora, depois do envio da imagem");
});

/* ------------------------------------------------------------------------------------------------
 * Home do aluno
 * ---------------------------------------------------------------------------------------------- */

test("home: hero do legado sai igual; lixo vira o padrão", () => {
  assert.deepEqual(model.resolveHomeHero(LEGACY_HERO), LEGACY_HERO);

  const legacyTexts = { badge: "Novo", description: "", enabled: true, image: IMAGE, mediaType: "image", purpose: "school-brand", title: "Título", visibility: { title: true } };
  assert.deepEqual(model.resolveHomeHero(legacyTexts), legacyTexts);
  assert.deepEqual(model.resolveHomeHero({ image: IMAGE, mediaType: "image", purpose: "school-brand" }), { image: IMAGE, mediaType: "image", purpose: "school-brand" });

  for (const garbage of [undefined, null, "x", 42, []]) {
    assert.deepEqual(model.resolveHomeHero(garbage), model.DEFAULT_HOME_HERO_CONFIG, String(garbage));
  }

  assert.equal(model.isHeroVisible(model.resolveHomeHero(LEGACY_HERO)), true);
  assert.equal(model.isHeroVisible(model.resolveHomeHero({ ...LEGACY_HERO, enabled: false })), false);
});

test("home: botão com link inseguro ou sem texto some; vídeo traz a capa; mídia estranha não é desenhada", () => {
  const withCta = (cta) => model.resolveHomeHero({ ...LEGACY_HERO, cta, visibility: { cta: true } });

  assert.deepEqual(withCta({ href: "/minhas-compras", label: "Minhas compras", target: "same_tab" }).cta, { href: "/minhas-compras", label: "Minhas compras", target: "same_tab" });
  assert.deepEqual(withCta({ href: "https://exemplo.com", label: "Saiba mais" }).cta, { href: "https://exemplo.com", label: "Saiba mais", target: "new_tab" }, "aba padrão para link externo");

  for (const href of ["javascript:alert(1)", "//evil.com", "/\\evil", "http://x.com", "/api/admin/students", "data:text/html,oi", "/minhas compras"]) {
    assert.equal(withCta({ href, label: "Clique", target: "same_tab" }).cta, undefined, href);
  }

  assert.equal(withCta({ href: "/", label: "  " }).cta, undefined, "sem texto");
  assert.equal(withCta("lixo").cta, undefined);

  const video = model.resolveHomeHero({ enabled: true, image: VIDEO, mediaType: "video", poster: POSTER, purpose: "school-brand" });
  assert.equal(video.poster, POSTER);
  assert.equal(model.resolveHomeHero({ ...LEGACY_HERO, poster: POSTER }).poster, undefined, "capa só com vídeo");
  assert.equal(model.resolveHomeHero({ image: VIDEO, mediaType: "video", poster: "javascript:alert(1)" }).poster, undefined);

  const unsafeImage = model.resolveHomeHero({ ...LEGACY_HERO, image: "javascript:alert(1)" });
  assert.equal(unsafeImage.image, "");
  assert.equal(model.isHeroVisible(unsafeImage), false);
});

test("prévia: o rascunho vira o que a home vai desenhar, com a imagem recém-recortada na hora", () => {
  const pending = "data:image/webp;base64,UklGRg==";
  const preview = model.previewHeroFromDraft(draft({ ctaHref: "/favoritos", ctaLabel: "Favoritos", showCta: true }), { image: pending });

  assert.equal(preview.image, pending);
  assert.deepEqual(preview.cta, { href: "/favoritos", label: "Favoritos", target: "same_tab" });
  assert.equal(model.isHeroVisible(model.previewHeroFromDraft(draft({ image: null }))), false);
  assert.equal(model.previewHeroFromDraft(draft({ ctaHref: "javascript:x", ctaLabel: "x", showCta: true })).cta, undefined);
});

/* ------------------------------------------------------------------------------------------------
 * Server Action
 * ---------------------------------------------------------------------------------------------- */

/** platform_settings em memoria (mesma superficie de tests/member-area-foundation.test.mjs). */
function createSettingsDb(initial = []) {
  const rows = initial.map((row) => ({ ...row }));
  const calls = [];

  function query() {
    const filters = [];
    let op = "select";
    let payload = null;
    let returning = false;
    const matches = (row) => filters.every((filter) => filter(row));
    const run = () => {
      if (op === "insert") {
        if (rows.some((row) => row.key === payload.key)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }

        rows.push({ ...payload });
        return { data: returning ? [{ key: payload.key, updated_at: payload.updated_at }] : null, error: null };
      }

      if (op === "update") {
        const hit = rows.filter(matches);
        hit.forEach((row) => Object.assign(row, payload));
        return { data: hit.map((row) => ({ key: row.key, updated_at: row.updated_at })), error: null };
      }

      return { data: rows.filter(matches).map((row) => ({ ...row })), error: null };
    };
    const chain = {
      eq(column, value) {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in(column, values) {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      insert(value) {
        op = "insert";
        payload = value;
        calls.push({ op, value });
        return chain;
      },
      async maybeSingle() {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      select() {
        if (op !== "select") {
          returning = true;
        }
        return chain;
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
      update(value) {
        op = "update";
        payload = value;
        calls.push({ op, value });
        return chain;
      }
    };

    return chain;
  }

  return { calls, from: () => query(), rows };
}

const OLD = "2026-10-11T09:00:00.123456+00:00";
const USER = { id: "00000000-0000-4000-8000-000000000001" };

/** Papel da sessao com a tabela real de permissoes (o dublê de requireRole nao confere a acao). */
function sessionWithRole(role) {
  Object.defineProperty(actionStubs, "role", {
    configurable: true,
    enumerable: true,
    get() {
      if (!canRole(role, "storefront.write")) {
        throw Object.assign(new Error("Seu papel não pode mudar a área de membros."), { name: "AdminPermissionError", status: 403 });
      }

      return { role, user: USER };
    }
  });
}

function baseRows() {
  return [
    { key: "hero", updated_at: OLD, value: { ...LEGACY_HERO, purpose: "editorial-highlight" } },
    { key: "branding", updated_at: OLD, value: { logoImage: null } },
    { key: "homeSections", updated_at: OLD, value: [{ id: "minhas-compras" }] }
  ];
}

const PUBLISHABLE = draft({ badge: "Nova turma", ctaHref: "/conteudo/curso-ia", ctaLabel: "Começar agora", image: IMAGE, showBadge: true, showCta: true });

test("saveHomeHero: analista e suporte não publicam (403) e nada é gravado", async () => {
  assert.equal(canRole("analyst", "storefront.write"), false);
  assert.equal(canRole("support", "storefront.write"), false);

  for (const role of ["analyst", "support"]) {
    const db = createSettingsDb(baseRows());
    actionStubs.db = db;
    actionStubs.invalidations = [];
    sessionWithRole(role);

    const result = await saveHomeHero({ expectedUpdatedAt: OLD, hero: PUBLISHABLE });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403, role);
    assert.equal(db.calls.length, 0);
    assert.deepEqual(actionStubs.invalidations, []);
  }
});

test("saveHomeHero: versão velha vira 409 sem gravar nada", async () => {
  const db = createSettingsDb(baseRows());
  actionStubs.db = db;
  actionStubs.invalidations = [];
  sessionWithRole("editor");

  const result = await saveHomeHero({ expectedUpdatedAt: "2026-10-11T08:00:00.000Z", hero: PUBLISHABLE });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /Recarregue/);
  assert.deepEqual(db.rows, baseRows(), "nenhuma chave mudou");
  assert.deepEqual(actionStubs.invalidations, []);
});

test("saveHomeHero: publica só a chave hero, preserva purpose, invalida a home e devolve a versão nova", async () => {
  const db = createSettingsDb(baseRows());
  actionStubs.db = db;
  actionStubs.invalidations = [];
  sessionWithRole("owner");

  const result = await saveHomeHero({ expectedUpdatedAt: OLD, hero: { ...PUBLISHABLE, badge: "  Nova turma  " } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data.hero, PUBLISHABLE, "rascunho devolvido como ficou gravado (texto aparado)");
  assert.notEqual(result.data.updatedAt, OLD);

  const [hero, branding, homeSections] = db.rows;
  assert.equal(hero.key, "hero");
  assert.equal(hero.updated_at, result.data.updatedAt);
  assert.equal(hero.value.purpose, "editorial-highlight");
  assert.deepEqual(hero.value.cta, { href: "/conteudo/curso-ia", label: "Começar agora", target: "same_tab" });
  assert.equal(hero.value.image, IMAGE);
  assert.deepEqual(branding, baseRows()[1]);
  assert.deepEqual(homeSections, baseRows()[2]);
  assert.deepEqual(db.calls.map((call) => call.op), ["update"]);
  assert.deepEqual(actionStubs.invalidations, [{ from: "action", target: "home" }]);
  assert.deepEqual(model.resolveHomeHero(hero.value).cta, { href: "/conteudo/curso-ia", label: "Começar agora", target: "same_tab" });
});

test("saveHomeHero: primeira publicação cria a chave (versão nula); se alguém criou antes, 409", async () => {
  const db = createSettingsDb();
  actionStubs.db = db;
  actionStubs.invalidations = [];
  sessionWithRole("admin");

  const created = await saveHomeHero({ expectedUpdatedAt: null, hero: PUBLISHABLE });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].value.purpose, "school-brand");

  const again = await saveHomeHero({ expectedUpdatedAt: null, hero: model.DEFAULT_HOME_HERO_DRAFT });
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);
  assert.deepEqual(db.rows[0].value.cta.label, "Começar agora", "nada foi apagado");
});

test("saveHomeHero: vídeo sem capa, link inseguro ou data URL voltam como erro do campo (400)", async () => {
  const db = createSettingsDb(baseRows());
  actionStubs.db = db;
  actionStubs.invalidations = [];
  sessionWithRole("editor");

  const noPoster = await saveHomeHero({ expectedUpdatedAt: OLD, hero: draft({ image: null, mediaType: "video", videoUrl: VIDEO }) });
  assert.equal(noPoster.ok, false);
  assert.equal(noPoster.status, 400);
  assert.deepEqual(noPoster.fieldErrors["hero.poster"], ["Escolha a capa do vídeo."]);
  assert.deepEqual(model.heroFieldErrorsFrom(noPoster.fieldErrors), { poster: "Escolha a capa do vídeo." });

  const unsafe = await saveHomeHero({ expectedUpdatedAt: OLD, hero: { ...PUBLISHABLE, ctaHref: "//evil.com" } });
  assert.equal(unsafe.status, 400);
  assert.ok(unsafe.fieldErrors["hero.ctaHref"]);

  const inline = await saveHomeHero({ expectedUpdatedAt: OLD, hero: { ...PUBLISHABLE, image: "data:image/webp;base64,AAAA" } });
  assert.equal(inline.status, 400);
  assert.ok(inline.fieldErrors["hero.image"]);

  assert.equal(db.calls.length, 0);
  assert.deepEqual(actionStubs.invalidations, []);
});

/* ------------------------------------------------------------------------------------------------
 * Leitura do codigo: home do aluno, componente e Marca
 * ---------------------------------------------------------------------------------------------- */

test("home do aluno resolve o destaque antes de desenhar e o componente segue o contrato de prévia", async () => {
  const page = await readSource("../src/app/page.tsx");
  assert.match(page, /const hero = resolveHomeHero\(storedHero\)/);
  assert.match(page, /const heroVisible = isHeroVisible\(hero\)/);
  assert.match(page, /<HeroSection accessPreviewMode=\{accessPreviewMode\} hero=\{hero\} \/>/);

  const section = (await readSource("../src/components/hero-section.tsx")).replace(/^\s*\/\/.*$/gm, "");
  assert.match(section, /className="@container relative z-\[1\] min-h-\[var\(--member-hero-min-h\)\]/);
  assert.doesNotMatch(section, /\b(?:sm|md|lg|xl):/, "nada de variante da janela: a prévia tem outra largura");
  assert.match(section, /rel="noopener noreferrer" target="_blank"/);
  assert.match(section, /motion-reduce:hidden/);
  assert.match(section, /motion-reduce:block/);
  assert.match(section, /isSafeHeroCtaHref\(hero\.cta\.href\)/);
  assert.match(section, /preload=\{preloadHeroImage\}/);
  assert.match(section, /const preloadHeroImage = !preview &&/);
});

test("Marca não edita mais o banner e aponta para Destaque", async () => {
  const brand = await readSource("../src/components/admin/v2/storefront/brand-editor.tsx");
  assert.doesNotMatch(brand, /Banner da home/);
  assert.doesNotMatch(brand, /heroEnabled: true|heroImage:/);
  assert.match(brand, /A imagem do topo da home agora fica em Destaque\./);
  assert.match(brand, /href="\/admin\/area-de-membros\/destaque"/);

  const skeletons = await readSource("../src/components/admin/v2/storefront/storefront-skeletons.tsx");
  const brandSkeleton = skeletons.slice(skeletons.indexOf("export function BrandSkeleton"));
  assert.doesNotMatch(brandSkeleton, /aspect-\[16\/6\]/);
});

test("tela Destaque: página com guard e skeleton, textos sem jargão", async () => {
  const page = await readSource("../src/app/admin/(v2)/area-de-membros/destaque/page.tsx");
  assert.match(page, /await requirePageArea\("membros"\)/);
  assert.match(page, /can\(access, "storefront\.write"\)/);
  assert.match(page, /Não foi possível carregar o destaque/);
  assert.match(await readSource("../src/app/admin/(v2)/area-de-membros/destaque/loading.tsx"), /HeroSkeleton/);

  const ui = (
    await Promise.all(
      ["hero-editor.tsx", "cta-field.tsx", "fields.tsx", "hero-preview.tsx", "hero-skeleton.tsx"].map((file) =>
        readSource(`../src/components/admin/v2/member-area/home-hero/${file}`)
      )
    )
  )
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // Textos visiveis: texto entre tags do JSX e strings de uma linha com espaco ou acento (menos classes CSS).
  const isClassList = (value) => value.split(/\s+/).every((token) => /^[a-z0-9@:[\]/#%.()_!>*-]*$/.test(token));
  const visible = [
    ...[...ui.matchAll(/>([^<>{}();=]+)</g)].map((match) => match[1].replace(/\s+/g, " ").trim()),
    ...[...ui.matchAll(/"([^"\n]*)"/g), ...ui.matchAll(/`([^`\n]*)`/g)].map((match) => match[1]).filter((value) => /[ À-ÿ]/.test(value) && !isClassList(value))
  ].filter(Boolean);

  assert.ok(visible.includes("Usar a imagem padrão"), "a extração enxerga os textos da tela");
  for (const word of [/\bhero\b/i, /\bcta\b/i, /\btemplate\b/i, /\bslug\b/i, /\bupload\b/i, /\bentitlement\b/i]) {
    assert.deepEqual(visible.filter((value) => word.test(value)), [], String(word));
  }
});

/* ------------------------------------------------------------------------------------------------
 * Editor: conflito, desfazer, "Mostrar" e layout (revisao da rodada)
 * ---------------------------------------------------------------------------------------------- */

test("Recarregar depois de um 409: o que o produtor mudou fica, o resto segue o servidor", () => {
  const before = draft({ badge: "Nova turma", showBadge: true, title: "Antigo" });
  const mine = { ...before, ctaHref: "/minhas-compras", ctaLabel: "Ver cursos", showCta: true, title: "Meu título" };
  const theirs = { ...before, description: "Publicado na outra aba", image: IMAGE, showDescription: true, title: "Título do outro" };

  const rebased = model.rebaseHeroDraft(before, mine, theirs);

  assert.equal(rebased.title, "Meu título", "campo que eu mudei fica o meu");
  assert.deepEqual([rebased.ctaHref, rebased.ctaLabel, rebased.showCta], ["/minhas-compras", "Ver cursos", true]);
  assert.deepEqual([rebased.description, rebased.showDescription, rebased.image], ["Publicado na outra aba", true, IMAGE], "o resto segue o servidor");
  assert.equal(model.isHeroDraftEqual(model.rebaseHeroDraft(before, before, theirs), theirs), true, "sem mudanças: igual ao servidor");
});

test("“Mostrar” liga sozinho quando o produtor escreve num campo vazio; desligar de propósito continua valendo", () => {
  const empty = draft();

  const typedTitle = model.autoShowFilledFields(empty, { ...empty, title: "N" });
  assert.equal(typedTitle.showTitle, true, "título digitado aparece na prévia e na home");
  assert.equal(typedTitle.showBadge, false);

  const typedBadgeAndDescription = model.autoShowFilledFields(empty, { ...empty, badge: "Novo", description: "Texto" });
  assert.deepEqual([typedBadgeAndDescription.showBadge, typedBadgeAndDescription.showDescription], [true, true]);

  // Já tinha texto e o produtor desligou: continuar digitando não liga de novo.
  const hidden = draft({ showTitle: false, title: "Escondido" });
  assert.equal(model.autoShowFilledFields(hidden, { ...hidden, title: "Escondido mesmo" }).showTitle, false);
  // Apagar o texto (e desligar) não liga nada.
  const cleared = model.autoShowFilledFields(typedTitle, { ...typedTitle, showTitle: false, title: "" });
  assert.equal(cleared.showTitle, false);
  // Só espaços não conta como texto.
  assert.equal(model.autoShowFilledFields(empty, { ...empty, title: "   " }).showTitle, false);

  // Botão: liga quando texto e destino ficam completos (em qualquer ordem).
  const labelOnly = model.autoShowFilledFields(empty, { ...empty, ctaLabel: "Começar" });
  assert.equal(labelOnly.showCta, false, "sem destino ainda");
  assert.equal(model.autoShowFilledFields(labelOnly, { ...labelOnly, ctaHref: "/conteudo/curso-ia" }).showCta, true);
  const offOnPurpose = draft({ ctaHref: "/", ctaLabel: "Início", showCta: false });
  assert.equal(model.autoShowFilledFields(offOnPurpose, { ...offOnPurpose, ctaLabel: "Início já" }).showCta, false);
});

test("editor do Destaque: Recarregar mantém o rascunho e sempre limpa o aviso; desfazer velho não vira conflito", async () => {
  const editor = await readSource("../src/components/admin/v2/member-area/home-hero/hero-editor.tsx");
  const fields = await readSource("../src/components/admin/v2/member-area/home-hero/fields.tsx");

  assert.match(editor, /setDraft\(rebaseHeroDraft\(published, draft, data\.draft\)\)/);
  assert.doesNotMatch(editor, /setDraft\(data\.draft\)/, "Recarregar não descarta o rascunho");
  assert.match(editor, /O que você mudou aqui continua no rascunho\./);
  assert.match(editor, /setFailure\(null\);\s*router\.refresh\(\);/, "Recarregar sempre limpa o aviso");
  assert.match(editor, /result\.status === 409\s*\?\s*\{ message: UNDO_OUTDATED, status: 0 \}/);
  assert.match(editor, /adminToast\.dismiss\(undoToast\.current\)/, "publicar de novo tira o Desfazer da publicação anterior");
  assert.match(editor, /setDraft\(\(current\) => autoShowFilledFields\(current, \{ \.\.\.current, \.\.\.next \}\)\)/);
  assert.match(fields, /Escondido na home: ligue “Mostrar” para o aluno ver\./);

  // Duas colunas a partir de 1024 px, como o Login (prévia ao lado do formulário).
  assert.match(editor, /lg:grid-cols-\[minmax\(0,480px\)_minmax\(0,1fr\)\] xl:grid-cols-\[minmax\(0,560px\)_minmax\(0,1fr\)\]/);
  assert.match(editor, /lg:sticky lg:top-20/);
});

/* ------------------------------------------------------------------------------------------------
 * Luz de fundo (cor atras do destaque)
 * ---------------------------------------------------------------------------------------------- */

test("luz de fundo: automática por padrão; cor escolhida vai e volta do gravado e chega à home", async () => {
  assert.equal(model.DEFAULT_HOME_HERO_DRAFT.glowColor, null, "sem cor = automática (medida na imagem)");
  assert.deepEqual(model.validateHomeHeroDraft(draft({ glowColor: "#E50914" })), {});
  assert.match(model.validateHomeHeroDraft(draft({ glowColor: "vermelho" })).glowColor, /cor válida/);

  const stored = model.buildStoredHero(undefined, draft({ glowColor: "#E50914" }));
  assert.equal(stored.glowColor, "#e50914", "gravado em minúsculas");
  assert.equal(model.heroDraftFromStored(stored).glowColor, "#e50914");
  assert.equal(model.resolveHomeHero(stored).glowColor, "#e50914");
  assert.equal(model.previewHeroFromDraft(draft({ glowColor: "#3b82f6" })).glowColor, "#3b82f6", "a prévia mostra a cor na hora");
  assert.equal(model.buildStoredHero({ glowColor: "#e50914" }, draft({ glowColor: null })).glowColor, undefined, "voltar para automática apaga a cor gravada");
  assert.equal(model.resolveHomeHero({ ...stored, glowColor: "red" }).glowColor, undefined, "valor estranho = automática");
  assert.equal(model.heroDraftFromStored({ ...stored, glowColor: 12 }).glowColor, null);

  const editor = await readSource("../src/components/admin/v2/member-area/home-hero/hero-editor.tsx");
  assert.match(editor, /title="Luz de fundo"/);
  assert.match(editor, /name="destaque-luz"/);
  assert.match(editor, /value=\{draft\.glowColor \? "custom" : "auto"\}/);
  const fields = await readSource("../src/components/admin/v2/member-area/home-hero/fields.tsx");
  assert.match(fields, /type="color"/, "qualquer cor pelo seletor do navegador");
  assert.match(fields, /aria-label="Cores prontas"/);
});
