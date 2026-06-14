import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rowSource = await readFile(new URL("../src/components/content-row.tsx", import.meta.url), "utf8");
const cardSource = await readFile(new URL("../src/components/content-card.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("home vertical card rows use tighter spacing", () => {
  assert.match(rowSource, /const rowGap = variant === "vertical" \? "gap-\[0\.75rem\]" : "gap-\[1\.5rem\]";/);
  assert.match(rowSource, /\$\{rowGap\}/);
});

test("home vertical card hover expands the card without inner image zoom", () => {
  assert.match(cardSource, /home-row-cover-card group/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-surface \{\s*transform: translate3d\(0, -8px, 0\) scale\(1\.14\);/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-image \{\s*transform: scale\(1\);/);
  assert.match(cssSource, /\.home-row-cover-card\.group:hover \.home-cover-card-image \{\s*transform: scale\(1\) !important;/);
});
