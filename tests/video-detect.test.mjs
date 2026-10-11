import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

const { detectLessonVideo, looksLikeVideoLink, VIDEO_PROVIDER_NOTICES } = await import("../src/lib/video-detect.ts");
const { normalizeLessonVideoConfig } = await import("../src/lib/video-embed.ts");

function config(input, options) {
  const result = detectLessonVideo(input, options);
  assert.equal(result.ok, true, `${input}: ${result.message ?? ""}`);
  return result;
}

test("YouTube em todas as formas comuns vira id + link canonico, com aviso da logo", () => {
  const id = "dQw4w9WgXcQ";
  const expected = { assetId: id, provider: "youtube", url: `https://www.youtube.com/watch?v=${id}` };

  for (const input of [
    `https://www.youtube.com/watch?v=${id}&t=42s`,
    `https://youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `<iframe width="560" src="https://www.youtube.com/embed/${id}" frameborder="0"></iframe>`
  ]) {
    const result = config(input);
    assert.deepEqual(result.config, expected, input);
    assert.equal(result.notice, "YouTube — a logo e o título do YouTube aparecem no player.");
    assert.equal(result.tone, "warning");
  }

  assert.equal(detectLessonVideo("https://www.youtube.com/playlist?list=PL123").ok, false);
  assert.equal(detectLessonVideo("https://www.youtube.com/watch?v=curto").ok, false);
});

test("Vimeo, Bunny e Mux viram o formato que o player do aluno ja le", () => {
  assert.deepEqual(config("https://vimeo.com/123456789").config, {
    assetId: "123456789",
    provider: "vimeo",
    url: "https://vimeo.com/123456789"
  });
  assert.equal(config("https://vimeo.com/123456789/abcdef1234").config.assetId, "123456789", "link nao listado");
  assert.equal(config("https://player.vimeo.com/video/987654?h=abc").config.assetId, "987654");
  assert.equal(config("https://vimeo.com/123456789").notice, "Vimeo — ative a restrição por domínio no Vimeo.");

  const guid = "0f4d7c5e-1234-4abc-9def-0123456789ab";
  for (const input of [
    `https://iframe.mediadelivery.net/embed/12345/${guid}?autoplay=false`,
    `https://iframe.mediadelivery.net/play/12345/${guid}`,
    `https://player.mediadelivery.net/embed/12345/${guid}`
  ]) {
    assert.deepEqual(config(input).config, {
      assetId: guid,
      provider: "bunny",
      url: `https://iframe.mediadelivery.net/embed/12345/${guid}`
    }, input);
  }
  assert.equal(config(`https://iframe.mediadelivery.net/embed/12345/${guid}`).tone, "neutral");

  assert.deepEqual(config("https://stream.mux.com/AbCdEf0123456789xyz.m3u8").config, {
    assetId: "AbCdEf0123456789xyz",
    provider: "mux",
    url: "https://player.mux.com/AbCdEf0123456789xyz"
  });
});

test("arquivo direto vira link direto; outros links pedem 'Outro provedor'", () => {
  assert.deepEqual(config("https://cdn.escola.com/aulas/01.mp4").config, {
    provider: "custom_url",
    url: "https://cdn.escola.com/aulas/01.mp4"
  });

  const unknown = detectLessonVideo("https://www.loom.com/share/abc");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "unknown_link");

  assert.deepEqual(config("https://www.loom.com/embed/abc", { allowEmbedCode: true }).config, {
    provider: "embed_code",
    url: "https://www.loom.com/embed/abc"
  });
  assert.deepEqual(config('<iframe src="https://fast.wistia.net/embed/iframe/xyz?a=1&amp;b=2"></iframe>', { allowEmbedCode: true }).config, {
    provider: "embed_code",
    url: "https://fast.wistia.net/embed/iframe/xyz?a=1&b=2"
  });
  assert.equal(detectLessonVideo('<iframe src="https://fast.wistia.net/embed/iframe/xyz"></iframe>').ok, false);
});

test("entradas invalidas explicam o motivo", () => {
  assert.equal(detectLessonVideo("   ").reason, "empty");
  assert.equal(detectLessonVideo("http://youtu.be/dQw4w9WgXcQ").reason, "not_https");
  assert.equal(detectLessonVideo('<iframe src="http://x.com/v"></iframe>', { allowEmbedCode: true }).reason, "invalid_embed");
  assert.equal(detectLessonVideo("javascript:alert(1)").reason, "unknown_link");
  assert.equal(detectLessonVideo("https://user:senha@vimeo.com/123").ok, false);
  assert.equal(detectLessonVideo("dQw4w9WgXcQ").ok, false, "id solto nao e link");
  assert.equal(detectLessonVideo(`https://youtu.be/${"a".repeat(20_000)}`).reason, "too_long");
});

test("todo resultado reconhecido passa pela validacao que o servidor ja usa", () => {
  for (const input of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://vimeo.com/123456789",
    "https://iframe.mediadelivery.net/embed/1/0f4d7c5e-1234-4abc-9def-0123456789ab",
    "https://stream.mux.com/AbCdEf0123456789xyz",
    "https://cdn.escola.com/a.webm"
  ]) {
    const result = config(input);
    assert.deepEqual(normalizeLessonVideoConfig(result.config), result.config, input);
  }

  const embed = config("https://www.loom.com/embed/abc", { allowEmbedCode: true });
  assert.deepEqual(normalizeLessonVideoConfig(embed.config), embed.config);
  assert.equal(Object.keys(VIDEO_PROVIDER_NOTICES).length, 6);
});

test("looksLikeVideoLink separa link de titulo", () => {
  assert.equal(looksLikeVideoLink(" https://youtu.be/dQw4w9WgXcQ "), true);
  assert.equal(looksLikeVideoLink("<iframe src='x'></iframe>"), true);
  assert.equal(looksLikeVideoLink("Boas-vindas"), false);
  assert.equal(looksLikeVideoLink("Veja https://x.com"), false);
});
