import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractYouTubePlayerConfig,
  fetchYouTubeStreams,
  isValidPlatformResourceId,
  isValidYouTubeVideoId,
  parseYouTubePlayerStreams,
  validateGoogleVideoStreamUrl
} from "../src/server/video/youtube-streams.ts";

const streamsRouteSource = await readFile(
  new URL("../src/app/api/video/youtube/streams/route.ts", import.meta.url),
  "utf8"
);

const videoId = "abcdefghijk";
const fixedNowMilliseconds = Date.UTC(2026, 6, 15, 3, 0, 0);
const fixedNowSeconds = Math.floor(fixedNowMilliseconds / 1_000);

function streamUrl({
  expiresAtSeconds = fixedNowSeconds + 3_600,
  host = "rr1---sn-a5meknzz.googlevideo.com",
  itag = 137,
  path = "/videoplayback"
} = {}) {
  return `https://${host}${path}?expire=${expiresAtSeconds}&itag=${itag}&signature=test`;
}

function adaptiveFormat(overrides = {}) {
  return {
    bitrate: 4_500_000,
    height: 1080,
    itag: 137,
    mimeType: 'video/mp4; codecs="avc1.640028"',
    qualityLabel: "1080p",
    url: streamUrl(),
    width: 1920,
    ...overrides
  };
}

function playerPayload(adaptiveFormats) {
  return { streamingData: { adaptiveFormats } };
}

test("stream input accepts only strict media and platform resource ids", () => {
  assert.equal(isValidYouTubeVideoId(videoId), true);
  assert.equal(isValidYouTubeVideoId("abcdefghij"), false);
  assert.equal(isValidYouTubeVideoId("abcdefghijk?x"), false);
  assert.equal(isValidYouTubeVideoId("../abcdefgh"), false);

  assert.equal(isValidPlatformResourceId("course-curso-1-mqfz7vcx"), true);
  assert.equal(isValidPlatformResourceId("5f6e5c76-9927-46bc-a612-e3b1fd0992d1"), true);
  assert.equal(isValidPlatformResourceId(""), false);
  assert.equal(isValidPlatformResourceId(" lesson-1"), false);
  assert.equal(isValidPlatformResourceId("lesson/../../admin"), false);
  assert.equal(isValidPlatformResourceId("x".repeat(161)), false);
});

test("watch configuration extraction is bounded to public key and visitor values", () => {
  assert.deepEqual(extractYouTubePlayerConfig(`
    <script>{
      "INNERTUBE_API_KEY":"PublicApiKeyForTests1234567890",
      "VISITOR_DATA":"VisitorDataForTests_123%3D"
    }</script>
  `), {
    apiKey: "PublicApiKeyForTests1234567890",
    visitorData: "VisitorDataForTests_123%3D"
  });

  assert.deepEqual(extractYouTubePlayerConfig(`
    "INNERTUBE_API_KEY":"short",
    "VISITOR_DATA":"bad visitor data"
  `), { apiKey: null, visitorData: null });
});

test("direct media URLs are HTTPS, signed, expiring and restricted to googlevideo", () => {
  const parsed = validateGoogleVideoStreamUrl(streamUrl(), fixedNowMilliseconds);

  assert.equal(parsed.url, streamUrl());
  assert.equal(parsed.expiresAtMilliseconds, (fixedNowSeconds + 3_600) * 1_000);

  const rejectedUrls = [
    streamUrl({ host: "googlevideo.com.attacker.invalid" }),
    streamUrl({ host: "evilgooglevideo.com" }),
    streamUrl({ path: "/redirect" }),
    streamUrl().replace("https:", "http:"),
    `https://user:password@rr1---sn-a5meknzz.googlevideo.com/videoplayback?expire=${fixedNowSeconds + 3_600}`,
    `https://rr1---sn-a5meknzz.googlevideo.com/videoplayback?itag=137`,
    streamUrl({ expiresAtSeconds: fixedNowSeconds - 1 }),
    streamUrl({ expiresAtSeconds: fixedNowSeconds + (25 * 60 * 60) })
  ];

  for (const url of rejectedUrls) {
    assert.throws(
      () => validateGoogleVideoStreamUrl(url, fixedNowMilliseconds),
      (error) => error?.status === 502 && /stream_(?:url|expiration)$/.test(error?.code)
    );
  }
});

test("player response returns one descending variant per label, preferring MP4 H264", () => {
  const result = parseYouTubePlayerStreams(playerPayload([
    adaptiveFormat({
      bitrate: 8_000_000,
      itag: 248,
      mimeType: 'video/webm; codecs="vp9"',
      url: streamUrl({ itag: 248 })
    }),
    adaptiveFormat({
      bitrate: 4_500_000,
      itag: 137,
      mimeType: 'video/mp4; codecs="avc1.640028"',
      url: streamUrl({ itag: 137 })
    }),
    adaptiveFormat({
      bitrate: 2_500_000,
      height: 720,
      itag: 247,
      mimeType: 'video/webm; codecs="vp9"',
      qualityLabel: "720p",
      url: streamUrl({ expiresAtSeconds: fixedNowSeconds + 3_700, itag: 247 }),
      width: 1280
    }),
    adaptiveFormat({
      bitrate: 9_000_000,
      height: 1440,
      itag: 271,
      mimeType: 'video/webm; codecs="vp9"',
      qualityLabel: "1440p",
      url: streamUrl({ host: "attacker.invalid", itag: 271 }),
      width: 2560
    }),
    {
      bitrate: 128_000,
      itag: 140,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      url: streamUrl({ expiresAtSeconds: fixedNowSeconds + 3_500, itag: 140 })
    },
    {
      bitrate: 160_000,
      itag: 251,
      mimeType: 'audio/webm; codecs="opus"',
      url: streamUrl({ expiresAtSeconds: fixedNowSeconds + 3_400, itag: 251 })
    }
  ]), fixedNowMilliseconds);

  assert.deepEqual(result, {
    audio: {
      bitrate: 160_000,
      itag: 251,
      mimeType: 'audio/webm; codecs="opus"',
      url: streamUrl({ expiresAtSeconds: fixedNowSeconds + 3_400, itag: 251 })
    },
    expiresAt: new Date((fixedNowSeconds + 3_400) * 1_000).toISOString(),
    qualities: [
      {
        bitrate: 4_500_000,
        height: 1080,
        itag: 137,
        label: "1080p",
        mimeType: 'video/mp4; codecs="avc1.640028"',
        url: streamUrl({ itag: 137 }),
        width: 1920
      },
      {
        bitrate: 2_500_000,
        height: 720,
        itag: 247,
        label: "720p",
        mimeType: 'video/webm; codecs="vp9"',
        url: streamUrl({ expiresAtSeconds: fixedNowSeconds + 3_700, itag: 247 }),
        width: 1280
      }
    ]
  });
});

test("player response requires separate usable audio and video", () => {
  assert.throws(
    () => parseYouTubePlayerStreams(playerPayload([
      adaptiveFormat()
    ]), fixedNowMilliseconds),
    (error) => error?.code === "usable_streams_unavailable"
  );

  assert.throws(
    () => parseYouTubePlayerStreams(playerPayload([{
      bitrate: 128_000,
      itag: 140,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      url: streamUrl({ itag: 140 })
    }]), fixedNowMilliseconds),
    (error) => error?.code === "usable_streams_unavailable"
  );
});

test("stream fetch uses watch configuration and the bounded Android VR client", async () => {
  const expiresAtSeconds = Math.floor(Date.now() / 1_000) + 3_600;
  const apiKey = "PublicApiKeyForTests1234567890";
  const visitorData = "VisitorDataForTests_123%3D";
  const calls = [];
  const mediaUrl = streamUrl({ expiresAtSeconds });
  const fetchImpl = async (input, init) => {
    const url = new URL(input.toString());
    calls.push({ init, url });

    if (url.pathname === "/watch") {
      return new Response(`<script>{"INNERTUBE_API_KEY":"${apiKey}","VISITOR_DATA":"${visitorData}"}</script>`);
    }

    return new Response(JSON.stringify(playerPayload([
      adaptiveFormat({ url: mediaUrl }),
      {
        bitrate: 128_000,
        itag: 140,
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        url: streamUrl({ expiresAtSeconds, itag: 140 })
      }
    ])));
  };

  const result = await fetchYouTubeStreams({ fetchImpl, videoId });

  assert.equal(result.qualities[0].label, "1080p");
  assert.equal(result.audio.itag, 140);
  assert.equal(calls.length, 2, "the server must not request or retransmit media bytes");
  assert.equal(calls[0].url.origin, "https://www.youtube.com");
  assert.equal(calls[0].url.pathname, "/watch");
  assert.equal(calls[0].url.searchParams.get("v"), videoId);
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[1].url.pathname, "/youtubei/v1/player");
  assert.equal(calls[1].url.searchParams.get("key"), apiKey);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.cache, "no-store");
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(calls[1].init.headers["X-YouTube-Client-Name"], "28");
  assert.equal(calls[1].init.headers["X-YouTube-Client-Version"], "1.65.10");
  assert.equal(calls[1].init.headers["X-Goog-Visitor-Id"], visitorData);
  const requestBody = JSON.parse(calls[1].init.body);
  assert.equal(requestBody.context.client.clientName, "ANDROID_VR");
  assert.equal(requestBody.context.client.clientVersion, "1.65.10");
  assert.equal(requestBody.context.client.visitorData, visitorData);
  assert.equal(requestBody.videoId, videoId);
});

test("stream fetch rejects oversized responses, missing config and total timeout", async () => {
  await assert.rejects(
    fetchYouTubeStreams({
      fetchImpl: async () => new Response("x", {
        headers: { "Content-Length": String(3 * 1024 * 1024 + 1) },
        status: 200
      }),
      videoId
    }),
    (error) => error?.code === "upstream_payload_too_large" && error?.status === 502
  );

  await assert.rejects(
    fetchYouTubeStreams({
      fetchImpl: async () => new Response("<html>No public player config</html>"),
      videoId
    }),
    (error) => error?.code === "player_config_unavailable" && error?.status === 502
  );

  await assert.rejects(
    fetchYouTubeStreams({
      fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
      timeoutMs: 5,
      videoId
    }),
    (error) => error?.code === "upstream_timeout" && error?.status === 504
  );
});

test("stream route authenticates, authorizes the lesson and never caches or mutates", () => {
  assert.match(streamsRouteSource, /export async function GET\(request: Request\)/);
  assert.doesNotMatch(streamsRouteSource, /export async function (?:POST|PUT|PATCH|DELETE)/);
  assert.match(streamsRouteSource, /await requireApiUser\(\)/);
  assert.doesNotMatch(streamsRouteSource, /searchParams\.get\("videoId"\)/);
  assert.match(streamsRouteSource, /isValidYouTubeVideoId\(videoId\)/);
  assert.match(streamsRouteSource, /isValidPlatformResourceId\(contentId\)/);
  assert.match(streamsRouteSource, /isValidPlatformResourceId\(lessonId\)/);
  assert.match(streamsRouteSource, /const access = await requireLessonAccess\(\{ contentId, lessonId, userId: auth\.user\.id \}\)/);
  assert.match(streamsRouteSource, /const videoId = getStoredYouTubeVideoId\(access\.videoConfig\)/);
  assert.match(streamsRouteSource, /Video da aula nao encontrado/);
  assert.match(streamsRouteSource, /private, no-store, max-age=0/);
  assert.match(streamsRouteSource, /export const dynamic = "force-dynamic"/);
  assert.match(streamsRouteSource, /jsonRouteError\(/);
  assert.ok(
    streamsRouteSource.indexOf("await requireLessonAccess") < streamsRouteSource.indexOf("await fetchYouTubeStreams"),
    "access must be checked before upstream stream discovery"
  );
});
