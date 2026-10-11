import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Area de membros > Login: o que fica salvo em platform_settings.loginPage, a validacao, a montagem do
// que o /login desenha (com o padrao quando nada foi publicado), a gravacao com checagem de versao e o
// cache do /login. Sem banco e sem Next: platform_settings em memoria e um unstable_cache que so anota
// a chave e as tags.

globalThis.__loginCacheStub = { calls: [] };

// Registrado depois dos ganchos de admin-action-stubs, entao roda antes deles.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") {
      const source = `export function unstable_cache(fn, keyParts, options) {
        globalThis.__loginCacheStub.calls.push({ keyParts, options });
        return (...args) => fn(...args);
      }
      export function updateTag() {}
      export function revalidateTag() {}`;

      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    return nextResolve(specifier, context);
  }
});

const loginConfig = await import("../src/lib/login-config.ts");
const model = await import("../src/server/member-area/login-model.ts");
const { saveLoginPage } = await import("../src/server/member-area/login-actions.ts");
const queries = await import("../src/server/member-area/login-queries.ts");
const { describeForbidden } = await import("../src/server/auth/roles.ts");

const loginPageSource = await readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const loginExperienceSource = await readFile(new URL("../src/components/login-experience.tsx", import.meta.url), "utf8");
const loginActionsSource = await readFile(new URL("../src/server/member-area/login-actions.ts", import.meta.url), "utf8");
const loginEditorSource = await readFile(new URL("../src/components/admin/v2/member-area/login/login-editor.tsx", import.meta.url), "utf8");

const OWNER = { role: "owner", user: { id: "00000000-0000-4000-8000-000000000001" } };
const OLD = "2026-10-11T09:00:00.123456+00:00";
const STORAGE_URL = "https://projeto.supabase.co/storage/v1/object/public/content-assets/platform/login-side/abc.webp";

function settings(overrides = {}) {
  return { ...model.defaultLoginPageSettings(), ...overrides };
}

function accepts(value) {
  return model.loginPageSettingsSchema.safeParse(value).success;
}

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

async function quietly(run) {
  const original = { error: console.error, warn: console.warn };
  const logged = [];
  console.error = (...args) => logged.push(["error", ...args]);
  console.warn = (...args) => logged.push(["warn", ...args]);

  try {
    return { logged, value: await run() };
  } finally {
    console.error = original.error;
    console.warn = original.warn;
  }
}

test.beforeEach(() => {
  actionStubs.role = OWNER;
  actionStubs.invalidations.length = 0;
  actionStubs.db = null;
});

/* ------------------------------------------------------------------------------------------------
 * O que fica salvo
 * ---------------------------------------------------------------------------------------------- */

test("o padrao e o /login de antes: astronauta dividido, tom escuro, Google ligado, sem link de ajuda", () => {
  const value = model.DEFAULT_LOGIN_PAGE_SETTINGS;

  assert.equal(accepts(value), true);
  assert.equal(value.version, 1);
  assert.equal(value.template, "split-visual-right");
  assert.equal(value.panelTone, "dark");
  assert.equal(value.googleEnabled, true);
  assert.equal(value.supportHref, null);
  assert.equal(value.sideImage.url, null);
  assert.equal(value.supportLabel, "Ainda não tem acesso?");
  assert.match(value.quote, /No Bunker, a IA vira método\./);
  assert.ok(Object.isFrozen(value), "o padrao nao pode ser alterado por engano");
  assert.notEqual(model.defaultLoginPageSettings().sideImage, value.sideImage, "a copia editavel nao divide objetos com o padrao");
});

test("imagem gravada: so link https ou imagem do app; nunca data URL, http://, javascript: ou //host", () => {
  const withSide = (url) => accepts(settings({ sideImage: { alt: "", url } }));

  assert.equal(withSide(STORAGE_URL), true);
  assert.equal(withSide("/login/bunker-astronaut-login.png"), true);
  assert.equal(withSide(null), true);
  assert.equal(withSide("data:image/webp;base64,AAAA"), false);
  assert.equal(withSide("http://exemplo.com/a.webp"), false);
  assert.equal(withSide("javascript:alert(1)"), false);
  assert.equal(withSide("//exemplo.com/a.webp"), false);
  assert.equal(accepts(settings({ backgroundImage: { alt: "", url: "data:image/png;base64,AAAA" } })), false);
});

test("link de ajuda: https:// ou mailto: com e-mail valido; texto do link obrigatorio quando ha link", () => {
  const withHref = (supportHref) => accepts(settings({ supportHref }));

  assert.equal(withHref("https://wa.me/5511999999999"), true);
  assert.equal(withHref("mailto:suporte@bunker707.com"), true);
  assert.equal(withHref(null), true);
  assert.equal(withHref("http://bunker707.com"), false);
  assert.equal(withHref("javascript:alert(1)"), false);
  assert.equal(withHref("//evil.com"), false);
  assert.equal(withHref("mailto:nao-e-email"), false);
  assert.equal(withHref("mailto:a@b.com?bcc=todos@x.com"), false);
  assert.equal(withHref("https://usuario:senha@exemplo.com"), false);

  const noLabel = model.loginPageSettingsSchema.safeParse(settings({ supportHref: "https://wa.me/55", supportLinkLabel: "  " }));
  assert.equal(noLabel.success, false);
  assert.deepEqual(noLabel.error.issues[0].path, ["supportLinkLabel"]);
});

test("limites de texto, modelo e tom conhecidos, textos aparados", () => {
  assert.equal(accepts(settings({ quote: "a".repeat(160) })), true);
  assert.equal(accepts(settings({ quote: "a".repeat(161) })), false);
  assert.equal(accepts(settings({ quoteDetail: "a".repeat(241) })), false);
  assert.equal(accepts(settings({ formTitle: "a".repeat(81) })), false);
  assert.equal(accepts(settings({ formSubtitle: "a".repeat(201) })), false);
  assert.equal(accepts(settings({ supportLabel: "a".repeat(61) })), false);
  assert.equal(accepts(settings({ supportLinkLabel: "a".repeat(41) })), false);
  assert.equal(accepts(settings({ sideImage: { alt: "a".repeat(161), url: null } })), false);
  assert.equal(accepts(settings({ template: "pagina-nova" })), false);
  assert.equal(accepts(settings({ panelTone: "neon" })), false);
  assert.equal(accepts(settings({ version: 2 })), false);

  const parsed = model.loginPageSettingsSchema.parse(settings({ formTitle: "  Bem-vindo  " }));
  assert.equal(parsed.formTitle, "Bem-vindo");
});

test("parseStoredLoginPage: ausente, outra versao ou campo invalido voltam o padrao; o valido volta igual", () => {
  for (const value of [null, undefined, "texto", [], { version: 2 }, { ...settings(), panelTone: "neon" }]) {
    const result = model.parseStoredLoginPage(value);
    assert.equal(result.valid, false);
    assert.equal(model.isLoginSettingsEqual(result.settings, model.DEFAULT_LOGIN_PAGE_SETTINGS), true);
  }

  const saved = settings({ formTitle: "Entre", googleEnabled: false, sideImage: { alt: "Mesa", url: STORAGE_URL }, template: "split-visual-left" });
  const result = model.parseStoredLoginPage({ ...saved, campoAntigo: "ignorado" });
  assert.equal(result.valid, true);
  assert.deepEqual(result.settings, saved);
});

/* ------------------------------------------------------------------------------------------------
 * O que o /login desenha
 * ---------------------------------------------------------------------------------------------- */

test("resolveLoginPageConfig: modelo dividido usa a imagem lateral, a frase e o enquadramento certo", () => {
  const padrao = model.resolveLoginPageConfig(model.DEFAULT_LOGIN_PAGE_SETTINGS, { logoImage: "/brand/logo-bunker.svg" });

  assert.equal(padrao.template, "split-visual-right");
  assert.equal(padrao.visual.imageSrc, "/login/bunker-astronaut-login.png");
  assert.equal(padrao.visual.objectPosition, "72% center", "a imagem padrao mantem o enquadramento de hoje");
  assert.equal(padrao.visual.alt, loginConfig.DEFAULT_LOGIN_VISUAL_ALT);
  assert.match(padrao.visual.title, /IA vira método/);
  assert.deepEqual(padrao.providers, ["google"]);
  assert.equal(padrao.form.supportHref, null, "sem link a linha de ajuda some");
  assert.equal(padrao.form.emailLabel, "E-mail");

  const enviada = model.resolveLoginPageConfig(
    settings({ quote: "Frase", quoteDetail: "Apoio", sideImage: { alt: "", url: STORAGE_URL }, template: "split-visual-left" }),
    { logoImage: null }
  );
  assert.equal(enviada.visual.imageSrc, STORAGE_URL);
  assert.equal(enviada.visual.objectPosition, "center", "imagem recortada fica centralizada");
  assert.equal(enviada.visual.alt, "", "imagem enviada sem descricao e decorativa");
  assert.equal(enviada.visual.title, "Frase");
  assert.equal(enviada.visual.description, "Apoio");
  assert.equal(enviada.logo.src, null, "Marca sem logo: o nome aparece em texto");
});

test("resolveLoginPageConfig: modelo sobre a imagem usa a imagem de fundo e nao mostra a frase", () => {
  const value = settings({
    backgroundImage: { alt: "Fundo", url: "https://cdn.exemplo.com/fundo.webp" },
    googleEnabled: false,
    panelTone: "glass",
    sideImage: { alt: "", url: STORAGE_URL },
    supportHref: "mailto:suporte@bunker707.com",
    supportLabel: "Precisa de ajuda?",
    supportLinkLabel: "Escreva para nós",
    template: "center-glass"
  });
  const config = model.resolveLoginPageConfig(value, { logoImage: "https://cdn.exemplo.com/logo.png" });

  assert.equal(config.visual.imageSrc, "https://cdn.exemplo.com/fundo.webp");
  assert.equal(config.visual.alt, "Fundo");
  assert.equal(config.visual.title, "");
  assert.equal(config.visual.description, "");
  assert.deepEqual(config.providers, [], "Google desligado");
  assert.equal(config.panelTone, "glass");
  assert.equal(config.logo.src, "https://cdn.exemplo.com/logo.png");
  assert.equal(config.form.supportHref, "mailto:suporte@bunker707.com");
  assert.equal(config.form.supportLabel, "Precisa de ajuda?");
  assert.equal(config.form.supportCta, "Escreva para nós");

  const semImagem = model.resolveLoginPageConfig(settings({ template: "side-glass-right" }), { logoImage: null });
  assert.equal(semImagem.visual.imageSrc, "/login/bunker-astronaut-login.png");
});

test("link inseguro gravado por fora (SQL manual) nunca chega ao /login", () => {
  const config = model.resolveLoginPageConfig({ ...settings(), supportHref: "javascript:alert(1)" }, { logoImage: null });
  assert.equal(config.form.supportHref, null);
  assert.equal(loginConfig.isAllowedLoginSupportHref("javascript:alert(1)"), false);
  assert.equal(loginConfig.isAllowedLoginSupportHref("https://wa.me/55"), true);
});

test("getLoginPageConfig do admin antigo continua: modelo pelo nome, tom do modelo, nomes com acento", () => {
  assert.equal(loginConfig.getLoginPageConfig().template, "split-visual-right");
  assert.equal(loginConfig.getLoginPageConfig("center-glass").panelTone, "glass");
  assert.equal(loginConfig.getLoginPageConfig("qualquer").template, "split-visual-right");
  assert.deepEqual(loginConfig.loginTemplateOptions.map((option) => option.name), [
    "Formulário à esquerda",
    "Imagem à esquerda",
    "Central sobre a imagem",
    "Lateral sobre a imagem"
  ]);
  assert.deepEqual(
    model.LOGIN_TEMPLATE_GALLERY.map((item) => [item.id, item.imageSlot, item.showsQuote]),
    [
      ["split-visual-right", "loginSide", true],
      ["split-visual-left", "loginSide", true],
      ["center-glass", "loginBackground", false],
      ["side-glass-right", "loginBackground", false]
    ]
  );
  assert.deepEqual(model.LOGIN_TONE_OPTIONS.map((option) => option.label), ["Escuro", "Translúcido", "Claro"]);
});

/* ------------------------------------------------------------------------------------------------
 * Regras do editor
 * ---------------------------------------------------------------------------------------------- */

test("trocar de modelo: o tom acompanha enquanto nao foi escolhido; as duas imagens ficam guardadas", () => {
  const start = settings({ backgroundImage: { alt: "", url: "https://cdn.exemplo.com/f.webp" }, sideImage: { alt: "", url: STORAGE_URL } });

  const glass = model.applyLoginTemplate(start, "center-glass");
  assert.equal(glass.template, "center-glass");
  assert.equal(glass.panelTone, "glass", "tom padrao do modelo novo");
  assert.equal(glass.sideImage.url, STORAGE_URL, "a imagem lateral nao some");

  const back = model.applyLoginTemplate(glass, "split-visual-left");
  assert.equal(back.panelTone, "dark");

  const custom = model.applyLoginTemplate(settings({ panelTone: "light" }), "side-glass-right");
  assert.equal(custom.panelTone, "light", "tom escolhido pelo produtor fica");
  assert.equal(model.applyLoginTemplate(start, "split-visual-right"), start, "mesmo modelo nao muda nada");
});

test("campo Link da ajuda: e-mail vira mailto:, https passa, o resto e recusado com a frase do produtor", () => {
  assert.deepEqual(model.parseSupportLinkInput(""), { href: null, ok: true });
  assert.deepEqual(model.parseSupportLinkInput("   "), { href: null, ok: true });
  assert.deepEqual(model.parseSupportLinkInput(" fulano@x.com "), { href: "mailto:fulano@x.com", ok: true });
  assert.deepEqual(model.parseSupportLinkInput("mailto:fulano@x.com"), { href: "mailto:fulano@x.com", ok: true });
  assert.deepEqual(model.parseSupportLinkInput("https://wa.me/5511999999999"), { href: "https://wa.me/5511999999999", ok: true });

  for (const bad of ["http://bunker707.com", "javascript:alert(1)", "//evil.com", "www.bunker707.com", "fulano@"]) {
    const result = model.parseSupportLinkInput(bad);
    assert.equal(result.ok, false, bad);
    assert.match(result.message, /https:\/\/ ou um e-mail/);
  }

  assert.equal(model.supportLinkInputValue("mailto:fulano@x.com"), "fulano@x.com");
  assert.equal(model.supportLinkInputValue("https://wa.me/55"), "https://wa.me/55");
  assert.equal(model.supportLinkInputValue(null), "");
});

test("Recarregar depois de um conflito: o que o produtor mudou fica, o resto segue o servidor", () => {
  const before = settings();
  const draft = settings({ formTitle: "Meu título", sideImage: { alt: "", url: STORAGE_URL } });
  const server = settings({ googleEnabled: false, quote: "Frase nova do colega" });
  const rebased = model.rebaseLoginDraft(before, draft, server);

  assert.equal(rebased.formTitle, "Meu título");
  assert.equal(rebased.sideImage.url, STORAGE_URL);
  assert.equal(rebased.googleEnabled, false);
  assert.equal(rebased.quote, "Frase nova do colega");
  assert.equal(model.isLoginSettingsEqual(model.rebaseLoginDraft(before, before, server), server), true);
});

test("erros do servidor viram erros por campo da tela", () => {
  assert.deepEqual(
    model.loginFieldErrors({ "settings.quote": ["Use no máximo 160 caracteres."], "settings.sideImage.url": ["Escolha uma imagem.", "outra"] }),
    { quote: "Use no máximo 160 caracteres.", "sideImage.url": "Escolha uma imagem." }
  );
  assert.deepEqual(model.loginFieldErrors(undefined), {});
});

/* ------------------------------------------------------------------------------------------------
 * Publicar (Server Action)
 * ---------------------------------------------------------------------------------------------- */

test("publicar pela primeira vez cria so a chave loginPage e invalida o cache do /login", async () => {
  const hero = { key: "hero", updated_at: OLD, value: { enabled: true, image: "/hero/a.png" } };
  const db = createSettingsDb([hero]);
  actionStubs.db = db;
  const value = settings({ formTitle: "  Entre  ", template: "center-glass", panelTone: "glass" });

  const result = await saveLoginPage({ expectedUpdatedAt: null, settings: value });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.settings.formTitle, "Entre");
  assert.match(result.data.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(db.calls.map((call) => [call.op, call.value.key ?? "loginPage"]), [["insert", "loginPage"]]);
  assert.deepEqual(db.rows.find((row) => row.key === "hero"), hero, "outras chaves nao mudam");
  assert.equal(db.rows.find((row) => row.key === "loginPage").value.template, "center-glass");
  assert.deepEqual(actionStubs.invalidations, [{ from: "action", target: "login" }]);
});

test("publicar com a versao lida atualiza; versao velha vira 409 sem gravar nem invalidar", async () => {
  const db = createSettingsDb([{ key: "loginPage", updated_at: OLD, value: settings() }]);
  actionStubs.db = db;

  const ok = await saveLoginPage({ expectedUpdatedAt: OLD, settings: settings({ googleEnabled: false }) });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(db.rows[0].value.googleEnabled, false);

  actionStubs.invalidations.length = 0;
  const stale = await saveLoginPage({ expectedUpdatedAt: OLD, settings: settings({ formTitle: "Atrasado" }) });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.match(stale.error, /mudou em outra tela/);
  assert.equal(db.rows[0].value.formTitle, "", "nada foi apagado");
  assert.deepEqual(actionStubs.invalidations, []);

  const created = await saveLoginPage({ expectedUpdatedAt: null, settings: settings() });
  assert.equal(created.status, 409, "alguem ja tinha publicado: nao sobrescreve");
});

test("analista (sem storefront.write) recebe 403 e nada e gravado", async () => {
  const db = createSettingsDb();
  actionStubs.db = db;
  assert.match(loginActionsSource, /runAdminAction\("storefront\.write", saveLoginPageSchema/);

  Object.defineProperty(actionStubs, "role", {
    configurable: true,
    get() {
      throw Object.assign(new Error(describeForbidden("storefront.write")), { name: "AdminPermissionError", status: 403 });
    }
  });

  try {
    const result = await saveLoginPage({ expectedUpdatedAt: null, settings: settings() });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(db.calls.length, 0);
    assert.deepEqual(actionStubs.invalidations, []);
  } finally {
    Object.defineProperty(actionStubs, "role", { configurable: true, enumerable: true, value: OWNER, writable: true });
  }
});

test("dado invalido volta 400 com o erro no campo certo, sem tocar no banco", async () => {
  const db = createSettingsDb();
  actionStubs.db = db;

  const badLink = await saveLoginPage({ expectedUpdatedAt: null, settings: settings({ supportHref: "javascript:alert(1)" }) });
  assert.equal(badLink.status, 400);
  assert.ok(badLink.fieldErrors["settings.supportHref"]);
  assert.deepEqual(model.loginFieldErrors(badLink.fieldErrors), { supportHref: "Use um link que comece com https:// ou um e-mail." });

  const dataUrl = await saveLoginPage({ expectedUpdatedAt: null, settings: settings({ sideImage: { alt: "", url: "data:image/webp;base64,AAAA" } }) });
  assert.equal(dataUrl.status, 400);
  assert.ok(dataUrl.fieldErrors["settings.sideImage.url"], "imagem tem que subir antes; data URL nunca vai ao banco");

  const badVersion = await saveLoginPage({ expectedUpdatedAt: "ontem", settings: settings() });
  assert.equal(badVersion.status, 400);
  assert.equal(db.calls.length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Leitura: editor e /login (cache e padrao)
 * ---------------------------------------------------------------------------------------------- */

test("o /login le em cache com a tag do login e a do catalogo, revalidando a cada hora", () => {
  const call = globalThis.__loginCacheStub.calls.find((entry) => entry.keyParts?.includes("login-page"));

  assert.ok(call, "unstable_cache foi usado");
  assert.deepEqual(call.keyParts, ["member-area", "login-page", "v1"]);
  assert.deepEqual(call.options.tags, ["member-area-login", "catalog"]);
  assert.equal(call.options.revalidate, 3_600);
});

test("o /login mostra o publicado com a logo da Marca", async () => {
  actionStubs.db = createSettingsDb([
    { key: "loginPage", updated_at: OLD, value: settings({ googleEnabled: false, panelTone: "glass", template: "side-glass-right" }) },
    { key: "branding", updated_at: OLD, value: { logoImage: null } }
  ]);

  const config = await queries.getLoginPageConfigForRequest();
  assert.equal(config.template, "side-glass-right");
  assert.equal(config.panelTone, "glass");
  assert.deepEqual(config.providers, []);
  assert.equal(config.logo.src, null, "Marca sem logo");
});

test("o /login cai no padrao quando nada foi publicado, quando o salvo e invalido e quando o banco falha", async () => {
  actionStubs.db = createSettingsDb();
  const empty = await queries.getLoginPageConfigForRequest();
  assert.deepEqual(empty, queries.defaultLoginPageConfig());
  assert.equal(empty.logo.src, "/brand/logo-bunker.svg");

  actionStubs.db = createSettingsDb([{ key: "loginPage", updated_at: OLD, value: { version: 1, template: "inventado" } }]);
  const invalid = await quietly(() => queries.getLoginPageConfigForRequest());
  assert.equal(invalid.value.template, "split-visual-right");
  assert.equal(invalid.logged.filter(([level]) => level === "warn").length, 1);
  const again = await quietly(() => queries.getLoginPageConfigForRequest());
  assert.equal(again.logged.length, 0, "o aviso sai uma vez so");

  actionStubs.db = null;
  const broken = await quietly(() => queries.getLoginPageConfigForRequest());
  assert.deepEqual(broken.value, queries.defaultLoginPageConfig());
  assert.equal(broken.logged[0][0], "error");
});

test("o editor recebe a versao, a logo e o aviso de configuracao invalida", async () => {
  actionStubs.db = createSettingsDb([{ key: "branding", updated_at: OLD, value: { logoImage: "https://cdn.exemplo.com/l.png" } }]);
  const never = await queries.getLoginEditorData();
  assert.equal(never.updatedAt, null);
  assert.equal(never.storedWasInvalid, false);
  assert.equal(never.logoImage, "https://cdn.exemplo.com/l.png");
  assert.equal(model.isLoginSettingsEqual(never.settings, model.DEFAULT_LOGIN_PAGE_SETTINGS), true);

  actionStubs.db = createSettingsDb([{ key: "loginPage", updated_at: OLD, value: { version: 1 } }]);
  const invalid = await queries.getLoginEditorData();
  assert.equal(invalid.storedWasInvalid, true);
  assert.equal(invalid.updatedAt, OLD, "publicar por cima usa a versao da linha que existe");
  assert.equal(invalid.logoImage, "/brand/logo-bunker.svg", "sem Marca salva: logo padrao");
});

/* ------------------------------------------------------------------------------------------------
 * Codigo do /login e do componente do aluno
 * ---------------------------------------------------------------------------------------------- */

test("o /login nao le mais ?template= e usa a configuracao publicada", () => {
  assert.doesNotMatch(loginPageSource, /resolvedSearchParams\??\.template|template\?: string/);
  assert.doesNotMatch(loginPageSource, /getLoginPageConfig\(/);
  assert.match(loginPageSource, /const config = await getLoginPageConfigForRequest\(\);/);
  assert.match(loginPageSource, /initialErrorMessage=\{readAuthLinkError\(resolvedSearchParams\?\.erro\)\}/);
});

test("LoginExperience responde ao container, aceita a altura da previa e nao toca a sessao na previa", () => {
  assert.match(loginExperienceSource, /className="@container"/);
  assert.match(loginExperienceSource, /--member-preview-vh/);
  assert.doesNotMatch(loginExperienceSource, /[\s"'`{](?:sm|md|lg|xl):[\w[-]/, "nada de breakpoint da janela: a previa usa container query");
  assert.doesNotMatch(loginExperienceSource, /min-h-screen|h-screen|100vh-/);
  assert.match(
    loginExperienceSource,
    /if \(!authConfigured \|\| preview\) \{\s*return;\s*\}\s*let active = true;\s*const supabase = createBrowserSupabaseClient\(\);/
  );
  assert.match(loginExperienceSource, /async function handleSubmit\(event: FormEvent<HTMLFormElement>\) \{\s*event\.preventDefault\(\);\s*if \(preview\) \{\s*return;/);
  assert.doesNotMatch(loginExperienceSource, /href="#"/, "linha de ajuda sem link morto");
  assert.doesNotMatch(loginExperienceSource, /id="login-(?:email|password)"/, "ids unicos por useId (varias previas na mesma pagina)");
  assert.match(loginExperienceSource, /rel=\{supportOpensNewTab \? "noopener noreferrer" : undefined\}/);
});

test("a tela do editor publica pela Server Action e sobe imagens antes de gravar", () => {
  assert.match(loginEditorSource, /saveLoginPage\(\{ expectedUpdatedAt: previous\.updatedAt, settings: parsed\.data \}\)/);
  assert.match(loginEditorSource, /uploadMemberAreaImage\(\{ image: value, slot:/);
  assert.match(loginEditorSource, /saveLabel="Publicar login"/);
  assert.doesNotMatch(loginEditorSource, /window\.confirm/);
});

/* ------------------------------------------------------------------------------------------------
 * Revisao da rodada: tom claro legivel, frase do tom, barra de publicar e cache do roteador
 * ---------------------------------------------------------------------------------------------- */

test("tom claro: mensagens, divisória e botões do formulário têm cor própria (não somem no painel claro)", () => {
  const tones = /const panelToneClasses = \{[\s\S]*?\n\} as const;/.exec(loginExperienceSource)?.[0] ?? "";
  const light = tones.slice(tones.indexOf("light: {"));

  for (const key of ["error", "notice", "warning", "divider", "iconButton", "forgot", "forgotUnderline"]) {
    assert.match(light, new RegExp(`\\b${key}: "`), `tom claro define ${key}`);
  }

  assert.match(light, /error: "border-red-200 bg-red-50 text-red-700"/);
  assert.match(light, /notice: "border-emerald-200 bg-emerald-50 text-emerald-800"/);
  assert.match(light, /warning: "border-amber-200 bg-amber-50 text-amber-900"/);
  assert.doesNotMatch(light, /text-(?:red|emerald|amber)-100|hover:text-white|bg-white\/10/, "nada pensado para fundo escuro no tom claro");

  // O formulário usa as classes do tom, não cores fixas.
  assert.match(loginExperienceSource, /\$\{tone\.error\}`\} role="alert"/);
  assert.match(loginExperienceSource, /\$\{tone\.notice\}`\} role="status"/);
  assert.match(loginExperienceSource, /\$\{tone\.warning\}/);
  assert.match(loginExperienceSource, /\$\{tone\.iconButton\}/);
  assert.equal(loginExperienceSource.match(/\$\{tone\.divider\}/g)?.length, 2);
  const form = loginExperienceSource.slice(loginExperienceSource.indexOf('aria-label="Formulário de login"'));
  assert.doesNotMatch(form, /text-red-100|text-emerald-100|text-amber-100|hover:text-white"|bg-white\/10"/);
});

test("frase do tom translúcido depende do modelo: com a imagem ao lado, só no celular ela fica atrás", () => {
  assert.equal(model.loginToneHint("glass", "center-glass"), "Painel translúcido: a imagem aparece por trás do formulário.");
  assert.equal(model.loginToneHint("glass", "side-glass-right"), "Painel translúcido: a imagem aparece por trás do formulário.");
  assert.equal(model.loginToneHint("glass", "split-visual-right"), "Painel translúcido: no celular, a imagem aparece por trás do formulário.");
  assert.equal(model.loginToneHint("glass", "split-visual-left"), "Painel translúcido: no celular, a imagem aparece por trás do formulário.");
  assert.equal(model.loginToneHint("dark", "split-visual-right"), model.LOGIN_TONE_HINTS.dark);
  assert.equal(model.loginToneHint("light", "center-glass"), model.LOGIN_TONE_HINTS.light);
  assert.match(loginEditorSource, /loginToneHint\(draft\.panelTone, draft\.template\)/);
});

test("editor do login: configuração inválida não abre a barra; publicar e desfazer atualizam o roteador", () => {
  const dirtyLine = /const dirty = [^\n]+/.exec(loginEditorSource)?.[0] ?? "";
  assert.doesNotMatch(dirtyLine, /storedInvalid/, "só o que o produtor mudou abre a barra (e o aviso de sair)");
  assert.match(loginEditorSource, /Publicar o padrão/);
  assert.match(loginEditorSource, /useWarnBeforeUnload\(dirty\)/);

  const publish = loginEditorSource.slice(loginEditorSource.indexOf("async function publish()"));
  assert.match(publish.slice(0, publish.indexOf("const saveBarError")), /adminToast\.dismiss\(undoToast\.current\)[\s\S]*router\.refresh\(\);/);
  const undo = loginEditorSource.slice(loginEditorSource.indexOf("async function undoPublish("), loginEditorSource.indexOf("async function publish()"));
  assert.match(undo, /router\.refresh\(\);/);
  assert.match(undo, /if \(result\.status === 409\) \{[\s\S]*?UNDO_OUTDATED/, "desfazer de um toast velho não vira conflito da tela");
});
