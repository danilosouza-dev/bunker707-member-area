import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

const {
  getYouTubeEmbedFrameGeometry,
  getYouTubeEmbedFrameStyle,
  youTubeEmbedTargetHeight,
  youTubeEmbedWidthMultiplier
} = await import("../src/lib/youtube-embed-sizing.ts");

test("embed frame grows to 1080 CSS pixels tall and shrinks back to the stage", () => {
  const geometry = getYouTubeEmbedFrameGeometry({ stageHeight: 514, stageWidth: 913 });

  assert.ok(geometry);
  assert.equal(geometry.height, youTubeEmbedTargetHeight);
  assert.ok(Math.abs(geometry.scale - 514 / 1080) < 1e-9);
  assert.equal(Math.round(geometry.height * geometry.scale), 514, "visual height must match the stage");
  assert.equal(Math.round(geometry.width * geometry.scale), 913 * youTubeEmbedWidthMultiplier, "visual width keeps the 3x crop");
});

test("embed frame uses the same CSS height on phones, where the stage is tiny", () => {
  const phone = getYouTubeEmbedFrameGeometry({ stageHeight: 188, stageWidth: 335 });

  assert.equal(phone?.height, youTubeEmbedTargetHeight);
  assert.equal(Math.round((phone?.width ?? 0) * (phone?.scale ?? 0)), 335 * youTubeEmbedWidthMultiplier);
});

test("embed frame keeps the stage size when it is already large or when data saving is on", () => {
  const large = getYouTubeEmbedFrameGeometry({ stageHeight: 1200, stageWidth: 2133 });
  const saveData = getYouTubeEmbedFrameGeometry({ saveData: true, stageHeight: 514, stageWidth: 913 });

  assert.deepEqual(large, { height: 1200, scale: 1, width: 2133 * youTubeEmbedWidthMultiplier });
  assert.deepEqual(saveData, { height: 514, scale: 1, width: 913 * youTubeEmbedWidthMultiplier });
});

test("embed frame geometry rejects an unmeasured stage", () => {
  assert.equal(getYouTubeEmbedFrameGeometry({ stageHeight: 0, stageWidth: 913 }), null);
  assert.equal(getYouTubeEmbedFrameGeometry({ stageHeight: 514, stageWidth: Number.NaN }), null);
});

test("embed frame style scales from the top center so the frame stays centered and top-aligned", () => {
  const style = getYouTubeEmbedFrameStyle({ height: 1080, scale: 514 / 1080, width: 5755 });

  assert.equal(style.height, "1080px");
  assert.equal(style.width, "5755px");
  assert.equal(style.transformOrigin, "top center");
  assert.match(style.transform, /^translateX\(-50%\) scale\(0\.475926\)$/);
});
