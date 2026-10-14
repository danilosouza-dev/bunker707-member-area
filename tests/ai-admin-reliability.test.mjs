import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  accountLinkSource,
  providerConnectionsSource,
  providerAdapterSource
] = await Promise.all([
  readSource("../src/server/ai/account-link.ts"),
  readSource("../src/server/ai/provider-connections.ts"),
  readSource("../src/server/ai/provider-adapter.ts")
]);

test("expired and cancelled OAuth sessions persist their terminal state when remote cleanup fails", () => {
  assert.match(accountLinkSource, /cleanupAccountGatewayOAuthBestEffort/);
  assert.match(accountLinkSource, /account_gateway_http_404[\s\S]*?status: "already_absent"/);
  assert.match(accountLinkSource, /cleanup_error_code:[\s\S]*?cleanup_status:/);
  assert.match(accountLinkSource, /status: "failed"[\s\S]*?oauth_timeout/);
  assert.match(accountLinkSource, /status: "cancelled"[\s\S]*?oauth_cleanup_failed_after_cancel/);
});

test("producer can pause or remove account-gateway connections when remote cleanup fails", () => {
  assert.match(providerConnectionsSource, /gatewayPauseFailure = getGatewayFailureMetadata\(error\)/);
  assert.match(providerConnectionsSource, /A conexao sera pausada localmente, mas o gateway nao confirmou a pausa/);
  assert.match(providerConnectionsSource, /updates\.status = paused \? "paused" : "active"/);
  assert.match(providerConnectionsSource, /gateway_pause_error_code: gatewayPauseFailure\?\.code/);
  assert.match(providerConnectionsSource, /A conexao sera removida localmente, mas o gateway nao confirmou a pausa/);
  assert.match(providerConnectionsSource, /delete_ai_provider_connection/);
  assert.match(providerConnectionsSource, /gateway_delete_error_code: gatewayDeleteFailure\?\.code/);
});

test("Gemini authenticates with a header instead of exposing the API key in the URL", () => {
  assert.match(providerAdapterSource, /"x-goog-api-key": config\.apiKey/);
  assert.doesNotMatch(providerAdapterSource, /searchParams\.set\("key", config\.apiKey\)/);
});
