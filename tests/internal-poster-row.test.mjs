import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sectionSource = await readFile(new URL("../src/components/content-structure-section.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("internal poster cards render as a single horizontal row with arrow controls", () => {
  assert.match(sectionSource, /function InternalPosterRow/);
  assert.match(sectionSource, /overflow-x-auto/);
  assert.match(sectionSource, /scrollBy/);
  assert.match(sectionSource, /ChevronLeft/);
  assert.match(sectionSource, /ChevronRight/);
  assert.doesNotMatch(sectionSource, /function InternalPosterGrid/);
  assert.doesNotMatch(sectionSource, /flex flex-wrap gap-\[0\.75rem\]/);
});

test("internal poster card hover keeps the card stable and zooms only the image", () => {
  assert.match(cssSource, /\.internal-poster-card\.group:hover \.home-cover-card-surface \{\s*box-shadow: 0 18px 52px rgba\(0, 0, 0, 0\.36\);\s*transform: translate3d\(0, 0, 0\) scale\(1\);/);
  assert.match(cssSource, /\.internal-poster-card\.group:hover \.home-cover-card-image \{\s*transform: scale\(1\.06\);/);
});
