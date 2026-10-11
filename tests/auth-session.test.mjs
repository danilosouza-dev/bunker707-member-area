import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { defaultAuthSessionStrategy, parseAuthSessionStrategy } = await import("../src/lib/auth/session-strategy.ts");
const sessionSource = await readFile(new URL("../src/server/auth/session.ts", import.meta.url), "utf8");
const guardsSource = await readFile(new URL("../src/server/auth/guards.ts", import.meta.url), "utf8");
const envExampleSource = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("AUTH_SESSION_STRATEGY defaults to getUser and only opts into claims explicitly", () => {
  assert.equal(defaultAuthSessionStrategy, "user");
  assert.equal(parseAuthSessionStrategy(undefined), "user");
  assert.equal(parseAuthSessionStrategy(null), "user");
  assert.equal(parseAuthSessionStrategy(""), "user");
  assert.equal(parseAuthSessionStrategy("user"), "user");
  assert.equal(parseAuthSessionStrategy("session"), "user");
  assert.equal(parseAuthSessionStrategy("claims"), "claims");
  assert.equal(parseAuthSessionStrategy(" Claims "), "claims");
  assert.match(envExampleSource, /^AUTH_SESSION_STRATEGY=/m);
});

test("server session is validated once per request and never trusts getSession", () => {
  assert.match(sessionSource, /import \{ cache \} from "react";/);
  assert.match(sessionSource, /export const getAuthenticatedUser = cache\(async \(\)/);
  assert.match(sessionSource, /export const getAdminRoleForUser = cache\(async \(userId: string\)/);
  assert.match(sessionSource, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(sessionSource, /auth\.getSession\(/);
  assert.match(guardsSource, /const user = await getAuthenticatedUser\(\);/);
  assert.doesNotMatch(guardsSource, /auth\.get(User|Session|Claims)\(/);
});
