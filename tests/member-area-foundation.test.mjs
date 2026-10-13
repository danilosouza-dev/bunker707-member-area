import assert from "node:assert/strict";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Fundacao da Area de membros (login, destaque da home, modulos): medidas de imagem iguais no cliente e
// no servidor, politica de cache, referencias de imagem, gravacao com checagem de versao em
// platform_settings e o upload de imagem. Sem banco: um platform_settings em memoria.

const crop = await import("../src/components/admin/v2/products/cover-crop.ts");
const webp = await import("../src/server/catalog/webp.ts");
const schemas = await import("../src/server/member-area/schemas.ts");
const cacheTags = await import("../src/server/member-area/cache-tags.ts");
const store = await import("../src/server/member-area/settings-store.ts");
const { uploadMemberAreaImage } = await import("../src/server/member-area/image-actions.ts");
const { toActionError } = await import("../src/lib/action-result.ts");
const { MemberAreaConflictError } = await import("../src/server/member-area/errors.ts");

/** Cabecalho WebP VP8X (32 bytes) com o canvas pedido: o leitor do servidor so olha o cabecalho. */
function vp8xHeader(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x38, 0x0a, 0x00, 0x00], 4);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
}

function webpDataUrl(width, height) {
  return `data:image/webp;base64,${Buffer.from(vp8xHeader(width, height)).toString("base64")}`;
}

/* ------------------------------------------------------------------------------------------------
 * Medidas de imagem
 * ---------------------------------------------------------------------------------------------- */

test("cada slot de imagem tem a mesma medida no recorte do cliente e na checagem do servidor", () => {
  assert.deepEqual(Object.keys(crop.IMAGE_SPECS).sort(), Object.keys(webp.IMAGE_UPLOAD_SPECS).sort());

  for (const [slot, spec] of Object.entries(crop.IMAGE_SPECS)) {
    const server = webp.IMAGE_UPLOAD_SPECS[slot];
    assert.deepEqual([spec.outputWidth, spec.outputHeight], [server.width, server.height], slot);
    assert.equal(spec.minWidth, server.minWidth, `${slot}: menor origem aceita igual nos dois lados`);
    assert.ok(Math.abs(spec.minWidth / spec.minHeight - spec.outputWidth / spec.outputHeight) < 0.001, `${slot}: minimo na proporcao`);
    // O maior texto que o cliente aceita cabe no teto de bytes do servidor.
    assert.ok(Math.floor((spec.maxDataUrlLength * 3) / 4) <= server.maxBytes, `${slot}: teto do cliente cabe no servidor`);
    assert.ok(spec.maxBytes < server.maxBytes, `${slot}: alvo abaixo do teto`);
  }

  assert.deepEqual([crop.IMAGE_SPECS.loginSide.outputWidth, crop.IMAGE_SPECS.loginSide.outputHeight], [1200, 1500]);
  assert.deepEqual([crop.IMAGE_SPECS.loginBackground.outputWidth, crop.IMAGE_SPECS.loginBackground.outputHeight], [1920, 1080]);
  assert.equal(crop.IMAGE_SPECS.loginSide.orientation, "portrait");
  assert.equal(crop.IMAGE_SPECS.loginBackground.orientation, "landscape");
  assert.equal(crop.aspectRatioOf(crop.IMAGE_SPECS.cover), "720 / 1080");
});

test("o teto de texto de cada upload da area de membros e o mesmo do recorte", () => {
  for (const slot of schemas.MEMBER_AREA_UPLOAD_SLOTS) {
    assert.equal(schemas.maxDataUrlLengthFor(slot), crop.IMAGE_SPECS[slot].maxDataUrlLength, slot);
  }
});

test("imagens grandes do login aceitam ate o teto proprio, e capa e destaque continuam em 150 KB", () => {
  const dataUrl = (bytes) => `data:image/webp;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;
  const big = dataUrl(300 * 1024);

  assert.deepEqual(crop.chooseEncodedImage([big]), { error: "too_large", ok: false }, "padrao de produto");
  assert.deepEqual(crop.chooseEncodedImage([big], crop.IMAGE_SPECS.loginBackground), { dataUrl: big, ok: true });
  assert.deepEqual(crop.chooseEncodedImage([dataUrl(500 * 1024)], crop.IMAGE_SPECS.loginSide), { error: "too_large", ok: false });

  assert.equal(webp.checkProductImage("loginSide", vp8xHeader(1200, 1500)).ok, true);
  assert.equal(webp.checkProductImage("loginBackground", vp8xHeader(1920, 1080)).ok, true);
  assert.match(webp.checkProductImage("loginSide", vp8xHeader(1920, 1080)).message, /1200×1500/);
  assert.equal(webp.checkProductImage("cover", new Uint8Array(webp.MAX_PRODUCT_IMAGE_BYTES + 1)).ok, false);
});

/* ------------------------------------------------------------------------------------------------
 * Cache e referencias de imagem
 * ---------------------------------------------------------------------------------------------- */

test("invalidacao: login usa a propria tag (updateTag na acao) e a home delega para o catalogo", () => {
  assert.deepEqual(cacheTags.planMemberAreaInvalidation("login", "action"), { api: "updateTag", tag: "member-area-login" });
  assert.deepEqual(cacheTags.planMemberAreaInvalidation("login", "route"), { api: "revalidateTag", profile: "max", tag: "member-area-login" });
  assert.deepEqual(cacheTags.planMemberAreaInvalidation("home", "action"), { api: "catalog", from: "action" });
  assert.throws(() => cacheTags.planMemberAreaInvalidation("vitrine", "action"));
  assert.throws(() => cacheTags.planMemberAreaInvalidation("login", "job"));
  assert.deepEqual([...cacheTags.LOGIN_PAGE_CACHE_TAGS], ["member-area-login", "catalog"]);
});

test("referencia de imagem gravada: link https ou imagem padrao do app, nunca data URL", () => {
  const ok = (value) => schemas.memberAreaImageRefSchema.safeParse(value).success;

  assert.equal(ok("https://abc.supabase.co/storage/v1/object/public/content-assets/platform/login-side/x.webp"), true);
  assert.equal(ok("/login/bunker-astronaut-login.png"), true);
  assert.equal(ok("/hero/bunker-707-red-front-hero.png"), true);
  assert.equal(ok("/brand/logo-bunker.svg"), true);
  assert.equal(ok("data:image/webp;base64,AAAA"), false);
  assert.equal(ok("http://exemplo.com/a.png"), false);
  assert.equal(ok("javascript:alert(1)"), false);
  assert.equal(ok("//exemplo.com/a.png"), false);
  assert.equal(ok("/api/qualquer.png"), false);
  assert.equal(schemas.settingVersionSchema.safeParse(null).success, true);
  assert.equal(schemas.settingVersionSchema.safeParse("2026-10-11T10:00:00.000+00:00").success, true);
  assert.equal(schemas.settingVersionSchema.safeParse("ontem").success, false);
});

/* ------------------------------------------------------------------------------------------------
 * platform_settings com checagem de versao
 * ---------------------------------------------------------------------------------------------- */

/** platform_settings em memoria com a superficie que settings-store usa (filtros eq/in reais). */
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

test("ler: chave ausente vira { exists: false } e varias chaves saem numa consulta", async () => {
  actionStubs.db = createSettingsDb([{ key: "hero", updated_at: OLD, value: { enabled: true, image: "/hero/a.png" } }]);

  assert.deepEqual(await store.readPlatformSetting("loginPage"), { exists: false, updatedAt: null, value: null });
  const many = await store.readPlatformSettings(["hero", "loginPage"]);
  assert.deepEqual(many.hero, { exists: true, updatedAt: OLD, value: { enabled: true, image: "/hero/a.png" } });
  assert.equal(many.loginPage.exists, false);
});

test("gravar com a versao lida atualiza e devolve a versao nova; versao velha vira 409", async () => {
  const db = createSettingsDb([{ key: "loginPage", updated_at: OLD, value: { version: 1 } }]);
  actionStubs.db = db;
  const now = new Date("2026-10-11T10:00:00.000Z");

  const saved = await store.writePlatformSettingGuarded("loginPage", { version: 1, template: "center-glass" }, OLD, now);
  assert.equal(saved.updatedAt, now.toISOString());
  assert.deepEqual(db.rows[0].value, { template: "center-glass", version: 1 });

  await assert.rejects(store.writePlatformSettingGuarded("loginPage", { version: 1 }, OLD), (error) => {
    assert.ok(error instanceof MemberAreaConflictError);
    const failure = toActionError(error);
    assert.equal(failure.status, 409);
    assert.match(failure.error, /Recarregue/);
    return true;
  });
  assert.deepEqual(db.rows[0].value, { template: "center-glass", version: 1 }, "nada foi apagado");
});

test("primeira gravacao cria a chave; se alguem criou antes, 409", async () => {
  const db = createSettingsDb();
  actionStubs.db = db;

  const created = await store.writePlatformSettingGuarded("loginPage", { version: 1 }, null, new Date("2026-10-11T11:00:00.000Z"));
  assert.equal(created.updatedAt, "2026-10-11T11:00:00.000Z");
  assert.equal(db.rows.length, 1);

  await assert.rejects(store.writePlatformSettingGuarded("loginPage", { version: 2 }, null), MemberAreaConflictError);
  assert.deepEqual(db.rows[0].value, { version: 1 });
});

test("versao: mesmo instante em formatos diferentes vale; chave que surgiu ou sumiu nao vale", async () => {
  assert.equal(store.isSameSettingVersion({ exists: true, updatedAt: "2026-10-11T10:00:00+00:00" }, "2026-10-11T10:00:00.000Z"), true);
  assert.equal(store.isSameSettingVersion({ exists: true, updatedAt: OLD }, "2026-10-11T09:00:01.000Z"), false);
  assert.equal(store.isSameSettingVersion({ exists: false, updatedAt: null }, null), true);
  assert.equal(store.isSameSettingVersion({ exists: true, updatedAt: OLD }, null), false);
  assert.equal(store.isSameSettingVersion({ exists: false, updatedAt: null }, OLD), false);

  actionStubs.db = createSettingsDb([{ key: "homeSections", updated_at: OLD, value: [] }]);
  await store.assertPlatformSettingVersion("homeSections", OLD);
  await assert.rejects(store.assertPlatformSettingVersion("homeSections", null), MemberAreaConflictError);
});

/* ------------------------------------------------------------------------------------------------
 * Upload de imagem
 * ---------------------------------------------------------------------------------------------- */

function createStorageDb() {
  const uploads = [];

  return {
    storage: {
      from(bucket) {
        return {
          getPublicUrl(path) {
            return { data: { publicUrl: `https://projeto.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
          },
          async upload(path, bytes, options) {
            uploads.push({ bucket, options, path, size: bytes.length });
            return { error: null };
          }
        };
      }
    },
    uploads
  };
}

test("upload: confere a medida no cabecalho, envia ao Storage na pasta do slot e devolve so a URL", async () => {
  const db = createStorageDb();
  actionStubs.db = db;
  actionStubs.role = { role: "editor", user: { id: "00000000-0000-4000-8000-000000000001" } };

  const result = await uploadMemberAreaImage({ image: webpDataUrl(1200, 1500), slot: "loginSide" });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.slot, "loginSide");
  assert.match(result.data.url, /^https:\/\/projeto\.supabase\.co\/storage\/v1\/object\/public\/content-assets\/platform\/login-side\/[a-f0-9]{24}\.webp$/);
  assert.equal(db.uploads.length, 1);
  assert.equal(db.uploads[0].options.contentType, "image/webp");
});

test("upload: medida errada vira erro no campo, sem enviar nada", async () => {
  const db = createStorageDb();
  actionStubs.db = db;

  const wrong = await uploadMemberAreaImage({ image: webpDataUrl(1920, 720), slot: "loginBackground" });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 400);
  assert.match(wrong.fieldErrors.image[0], /1920×1080/);

  const notWebp = await uploadMemberAreaImage({ image: "data:image/png;base64,iVBORw0KGgo=", slot: "hero" });
  assert.equal(notWebp.ok, false);
  assert.equal(notWebp.status, 400);

  const unknownSlot = await uploadMemberAreaImage({ image: webpDataUrl(720, 1040), slot: "cover" });
  assert.equal(unknownSlot.ok, false, "capa de modulo nao passa por aqui");
  assert.equal(db.uploads.length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Gravacao de "estado desejado" (aparencia do admin antigo sobre o destaque)
 * ---------------------------------------------------------------------------------------------- */

/** Faz "outra tela" gravar a chave logo antes das primeiras `times` gravacoes nossas. */
function interruptWrites(db, times, mutate) {
  const originalFrom = db.from;
  let count = 0;

  db.from = (table) => {
    const chain = originalFrom(table);
    const update = chain.update;
    const insert = chain.insert;
    const interrupt = () => {
      if (count < times) {
        count += 1;
        mutate(db.rows, count);
      }
    };

    chain.update = (value) => {
      interrupt();
      return update(value);
    };
    chain.insert = (value) => {
      interrupt();
      return insert(value);
    };
    return chain;
  };

  return () => count;
}

test("estado desejado: aplica sobre o valor gravado agora e grava com a versao lida", async () => {
  const db = createSettingsDb([{ key: "hero", updated_at: OLD, value: { cta: { href: "/", label: "Começar" }, enabled: true, image: "/hero/a.png" } }]);
  actionStubs.db = db;
  const now = new Date("2026-10-11T10:00:00.000Z");

  const saved = await store.updatePlatformSettingLatest("hero", (current) => ({ ...current.value, image: "https://cdn.exemplo.com/b.webp" }), () => now);

  assert.equal(saved.updatedAt, now.toISOString());
  assert.deepEqual(db.rows[0].value, { cta: { href: "/", label: "Começar" }, enabled: true, image: "https://cdn.exemplo.com/b.webp" });
  assert.deepEqual(saved.value, db.rows[0].value);
});

test("estado desejado: alguem grava no meio; rele e aplica de novo, e o que o outro gravou fica", async () => {
  const NEWER = "2026-10-11T09:30:00.000Z";
  const db = createSettingsDb([{ key: "hero", updated_at: OLD, value: { enabled: true, image: "/hero/a.png" } }]);
  const interruptions = interruptWrites(db, 1, (rows) => {
    // A tela Destaque publica botao e titulo enquanto a imagem do admin antigo subia.
    rows[0].updated_at = NEWER;
    rows[0].value = { ...rows[0].value, cta: { href: "/minhas-compras", label: "Ver cursos" }, title: "Nova turma" };
  });
  actionStubs.db = db;

  const saved = await store.updatePlatformSettingLatest("hero", (current) => ({ ...current.value, image: "https://cdn.exemplo.com/b.webp" }));

  assert.equal(interruptions(), 1);
  assert.deepEqual(db.rows[0].value, {
    cta: { href: "/minhas-compras", label: "Ver cursos" },
    enabled: true,
    image: "https://cdn.exemplo.com/b.webp",
    title: "Nova turma"
  });
  assert.notEqual(saved.updatedAt, NEWER);
});

test("estado desejado: mudou duas vezes seguidas vira 409 e nada nosso e gravado", async () => {
  const db = createSettingsDb([{ key: "hero", updated_at: OLD, value: { enabled: true, image: "/hero/a.png" } }]);
  interruptWrites(db, 2, (rows, count) => {
    rows[0].updated_at = `2026-10-11T09:3${count}:00.000Z`;
    rows[0].value = { ...rows[0].value, title: `do outro ${count}` };
  });
  actionStubs.db = db;

  await assert.rejects(
    store.updatePlatformSettingLatest("hero", (current) => ({ ...current.value, image: "https://cdn.exemplo.com/b.webp" })),
    MemberAreaConflictError
  );
  assert.deepEqual(db.rows[0].value, { enabled: true, image: "/hero/a.png", title: "do outro 2" });
});

test("estado desejado: chave ausente e criada; validacao que falha nao grava nada", async () => {
  const db = createSettingsDb();
  actionStubs.db = db;

  await assert.rejects(
    store.updatePlatformSettingLatest("hero", () => {
      throw Object.assign(new Error("Envie uma imagem."), { status: 400 });
    }),
    /Envie uma imagem/
  );
  assert.equal(db.calls.length, 0);

  const created = await store.updatePlatformSettingLatest("hero", (current) => ({ enabled: current.exists, image: "/hero/a.png" }));
  assert.deepEqual(db.rows, [{ key: "hero", updated_at: created.updatedAt, value: { enabled: false, image: "/hero/a.png" } }]);
});
