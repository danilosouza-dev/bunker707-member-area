import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { shouldBlockLessonPageKeyboardShortcut } from "../src/lib/lesson-page-deterrence.ts";

const lessonSource = await readFile(
  new URL("../src/components/lesson-experience.tsx", import.meta.url),
  "utf8"
);
const platformStoreSource = await readFile(
  new URL("../src/server/db/platform-store.ts", import.meta.url),
  "utf8"
);
const streamsRouteSource = await readFile(
  new URL("../src/app/api/video/youtube/streams/route.ts", import.meta.url),
  "utf8"
);
const captionsRouteSource = await readFile(
  new URL("../src/app/api/video/youtube/captions/route.ts", import.meta.url),
  "utf8"
);

function shortcut(overrides = {}) {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides
  };
}

test("lesson deterrence recognizes context-menu, DevTools and source shortcuts", () => {
  assert.equal(shouldBlockLessonPageKeyboardShortcut(shortcut({ code: "F12", key: "F12" })), true);
  assert.equal(shouldBlockLessonPageKeyboardShortcut(shortcut({ key: "ContextMenu" })), true);
  assert.equal(shouldBlockLessonPageKeyboardShortcut(shortcut({ key: "F10", shiftKey: true })), true);

  for (const key of ["c", "i", "j", "k"]) {
    assert.equal(
      shouldBlockLessonPageKeyboardShortcut(shortcut({ ctrlKey: true, key, shiftKey: true })),
      true
    );
    assert.equal(
      shouldBlockLessonPageKeyboardShortcut(shortcut({ altKey: true, key, metaKey: true })),
      true
    );
  }

  assert.equal(shouldBlockLessonPageKeyboardShortcut(shortcut({ ctrlKey: true, key: "u" })), true);
  assert.equal(
    shouldBlockLessonPageKeyboardShortcut(shortcut({ altKey: true, key: "u", metaKey: true })),
    true
  );
});

test("lesson deterrence preserves normal typing, copy and browser shortcuts unrelated to inspection", () => {
  assert.equal(shouldBlockLessonPageKeyboardShortcut(shortcut({ key: "a" })), false);
  assert.equal(shouldBlockLessonPageKeyboardShortcut(shortcut({ ctrlKey: true, key: "c" })), false);
  assert.equal(shouldBlockLessonPageKeyboardShortcut(shortcut({ ctrlKey: true, key: "l" })), false);
  assert.equal(shouldBlockLessonPageKeyboardShortcut(shortcut({ ctrlKey: true, key: "r" })), false);
  assert.equal(
    shouldBlockLessonPageKeyboardShortcut(shortcut({ ctrlKey: true, key: "u", shiftKey: true })),
    false
  );
});

test("lesson experience blocks the context menu and inspection shortcuts for the full mounted page", () => {
  assert.match(lessonSource, /document\.addEventListener\("contextmenu", blockContextMenu, true\)/);
  assert.match(lessonSource, /window\.addEventListener\("keydown", blockInspectionShortcut, true\)/);
  assert.match(lessonSource, /shouldBlockLessonPageKeyboardShortcut\(event\)/);
  assert.match(lessonSource, /document\.removeEventListener\("contextmenu", blockContextMenu, true\)/);
  assert.match(lessonSource, /window\.removeEventListener\("keydown", blockInspectionShortcut, true\)/);
});

test("student lesson payload and auxiliary requests avoid redundant YouTube watch URLs", () => {
  const sanitizerStart = platformStoreSource.indexOf("function minimizeStudentYouTubeVideoConfigs");
  const sanitizerEnd = platformStoreSource.indexOf("function getVideoThumbnailUrl", sanitizerStart);
  const sanitizerSource = platformStoreSource.slice(sanitizerStart, sanitizerEnd);

  assert.notEqual(sanitizerStart, -1);
  assert.match(sanitizerSource, /assetId: videoId/);
  assert.match(sanitizerSource, /provider: "youtube" as const/);
  assert.doesNotMatch(sanitizerSource, /url:/);
  assert.match(platformStoreSource, /minimizeStudentYouTubeVideoConfigs\([\s\S]*?applySavedStateToModules/);

  for (const routeSource of [streamsRouteSource, captionsRouteSource]) {
    assert.doesNotMatch(routeSource, /searchParams\.get\("videoId"\)/);
    assert.match(routeSource, /const videoId = getStoredYouTubeVideoId\(access\.videoConfig\)/);
    assert.match(routeSource, /await requireLessonAccess\(\{ contentId, lessonId, userId: auth\.user\.id \}\)/);
  }

  assert.doesNotMatch(
    lessonSource,
    /new URLSearchParams\(\{[\s\S]{0,180}videoId: activeYouTubeVideoId[\s\S]{0,80}\}\)/
  );
});
