import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import {
  getYouTubeUnofficialStreamsMode,
  isYouTubeUnofficialStreamsEnabled,
  parseYouTubeUnofficialStreamsMode,
  youTubeUnofficialStreamsDisabledCode,
  youTubeUnofficialStreamsEnvName
} from "../src/server/video/feature-flags.ts";

// Import dinamico: precisa acontecer depois do hook de resolucao importado acima.
const { fetchYouTubeStreams } = await import("../src/server/video/youtube-streams.ts");

const envName = "YOUTUBE_UNOFFICIAL_STREAMS";
const videoId = "abcdefghijk";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  streamsServerSource,
  lessonStreamsRouteSource,
  receiverStreamsRouteSource,
  lessonCaptionsRouteSource,
  receiverCaptionsRouteSource,
  captionsServerSource
] = await Promise.all([
  source("../src/server/video/youtube-streams.ts"),
  source("../src/app/api/video/youtube/streams/route.ts"),
  source("../src/app/api/tv/receiver/[sessionId]/streams/route.ts"),
  source("../src/app/api/video/youtube/captions/route.ts"),
  source("../src/app/api/tv/receiver/[sessionId]/captions/route.ts"),
  source("../src/server/video/youtube-captions.ts")
]);

// Valor bruto da env -> modo esperado. Inclui sinonimos que NAO sao aceitos como "on".
const flagCases = [
  [undefined, "on"],
  ["", "on"],
  ["   ", "on"],
  ["on", "on"],
  ["ON", "on"],
  [" On ", "on"],
  ["off", "off"],
  ["OFF", "off"],
  ["  off\n", "off"],
  ["false", "off"],
  ["0", "off"],
  ["disabled", "off"],
  ["true", "off"],
  ["onn", "off"]
];

async function withFlag(value, run) {
  const original = process.env[envName];

  if (value === undefined) {
    delete process.env[envName];
  } else {
    process.env[envName] = value;
  }

  try {
    return await run();
  } finally {
    if (original === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = original;
    }
  }
}

function recordingFetch() {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(String(input));
    throw new Error("network disabled in test");
  };

  return { calls, fetchImpl };
}

test("flag name and disabled code match the public contract", () => {
  assert.equal(youTubeUnofficialStreamsEnvName, envName);
  assert.equal(youTubeUnofficialStreamsDisabledCode, "youtube_unofficial_streams_disabled");
});

test("flag defaults to on and only an explicit on (or empty) keeps it on", () => {
  for (const [value, expected] of flagCases) {
    assert.equal(parseYouTubeUnofficialStreamsMode(value), expected, `value ${JSON.stringify(value)}`);
    assert.equal(
      getYouTubeUnofficialStreamsMode(value === undefined ? {} : { [envName]: value }),
      expected,
      `env ${JSON.stringify(value)}`
    );
  }

  assert.equal(isYouTubeUnofficialStreamsEnabled({}), true);
  assert.equal(isYouTubeUnofficialStreamsEnabled({ [envName]: "on" }), true);
  assert.equal(isYouTubeUnofficialStreamsEnabled({ [envName]: "off" }), false);
});

test("flag reads process.env at call time, so a changed value applies without reimporting", async () => {
  await withFlag(undefined, () => assert.equal(isYouTubeUnofficialStreamsEnabled(), true));
  await withFlag("off", () => assert.equal(isYouTubeUnofficialStreamsEnabled(), false));
  await withFlag("on", () => assert.equal(isYouTubeUnofficialStreamsEnabled(), true));
});

test("fetchYouTubeStreams with the flag off fails safely before any upstream request", async () => {
  await withFlag("off", async () => {
    for (const candidateVideoId of [videoId, "not-a-video-id"]) {
      const { calls, fetchImpl } = recordingFetch();

      await assert.rejects(
        fetchYouTubeStreams({ fetchImpl, videoId: candidateVideoId }),
        (error) => {
          assert.equal(error.name, "YouTubeStreamsError");
          assert.equal(error.code, youTubeUnofficialStreamsDisabledCode);
          assert.equal(error.status, 404);
          assert.doesNotMatch(error.message, /youtube/i, "public message stays provider-agnostic");
          return true;
        }
      );
      assert.deepEqual(calls, [], "no request may reach YouTube while the flag is off");
    }
  });
});

test("fetchYouTubeStreams reads the flag only through feature-flags.ts", () => {
  assert.match(
    streamsServerSource,
    /import \{[^}]*\bisYouTubeUnofficialStreamsEnabled\b[^}]*\} from "\.\/feature-flags(?:\.ts)?"/
  );
  assert.doesNotMatch(
    streamsServerSource,
    /YOUTUBE_UNOFFICIAL_STREAMS|youtube_unofficial_streams_disabled/,
    "no second copy of the flag rule or of the disabled code"
  );
});

test("both stream routes answer 404 with the disabled code before session, database or YouTube work", () => {
  const disabledResponse = /\{ error: youTubeUnofficialStreamsDisabledCode \}[^\n]*404/;

  for (const [routeSource, firstWork] of [
    [lessonStreamsRouteSource, "await requireApiUser()"],
    [receiverStreamsRouteSource, "await getTvReceiverSession("]
  ]) {
    const flagCheck = routeSource.indexOf("if (!isYouTubeUnofficialStreamsEnabled())");

    assert.ok(flagCheck > 0, "route must check the flag");
    assert.ok(flagCheck < routeSource.indexOf(firstWork), `flag must be checked before ${firstWork}`);
    assert.ok(flagCheck < routeSource.indexOf("await fetchYouTubeStreams"));
    assert.match(routeSource, disabledResponse);
    assert.match(routeSource, /from "@\/server\/video\/feature-flags"/);
    assert.match(routeSource, /private, no-store, max-age=0/);
  }
});

test("captions stay available for the Tutor transcript regardless of the stream flag", () => {
  for (const captionsSource of [lessonCaptionsRouteSource, receiverCaptionsRouteSource, captionsServerSource]) {
    assert.doesNotMatch(captionsSource, /YOUTUBE_UNOFFICIAL_STREAMS|isYouTubeUnofficialStreamsEnabled|feature-flags/);
  }
});
