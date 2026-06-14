import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/content-card.tsx", import.meta.url), "utf8");

test("home locked vertical cards use a dark circular overlay with a white lock", () => {
  assert.match(source, /home-cover-card-lock-badge/);
  assert.match(source, /rounded-full/);
  assert.match(source, /bg-black\/65/);
  assert.match(source, /text-white/);
  assert.match(source, /backdrop-blur-\[2px\]/);
  assert.match(source, /import \{ Bell, Bookmark, ChevronDown, Lock, Play, ShoppingCart \} from "lucide-react";/);
  assert.match(source, /Lock className="h-\[1\.15rem\] w-\[1\.15rem\] stroke-\[3\.1\]/);
  assert.doesNotMatch(source, /LockKeyhole/);
  assert.doesNotMatch(source, /fill-current stroke-\[2\.75\]/);
  assert.doesNotMatch(source, /text-black drop-shadow-\[0_1px_5px_rgba\(255,255,255,0\.78\)\]/);
});
