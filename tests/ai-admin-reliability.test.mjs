import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  accountLinkSource,
  connectionsManagerSource,
  providerConnectionsSource,
  providerAdapterSource,
  providerSettingsSource,
  usageDashboardSource
] = await Promise.all([
  readSource("../src/server/ai/account-link.ts"),
  readSource("../src/components/admin/settings/ai-connections-manager.tsx"),
  readSource("../src/server/ai/provider-connections.ts"),
  readSource("../src/server/ai/provider-adapter.ts"),
  readSource("../src/components/admin/settings/ai-provider-settings.tsx"),
  readSource("../src/components/admin/settings/ai-usage-dashboard.tsx")
]);

test("expired and cancelled OAuth sessions persist their terminal state when remote cleanup fails", () => {
  assert.match(accountLinkSource, /cleanupAccountGatewayOAuthBestEffort/);
  assert.match(accountLinkSource, /account_gateway_http_404[\s\S]*?status: "already_absent"/);
  assert.match(accountLinkSource, /cleanup_error_code:[\s\S]*?cleanup_status:/);
  assert.match(accountLinkSource, /status: "failed"[\s\S]*?oauth_timeout/);
  assert.match(accountLinkSource, /status: "cancelled"[\s\S]*?oauth_cleanup_failed_after_cancel/);
});

test("connected-account status polling never overlaps requests", () => {
  assert.match(connectionsManagerSource, /nextPollTimeout = window\.setTimeout\(\(\) => void poll\(\), 2_000\)/);
  assert.match(connectionsManagerSource, /signal: controller\.signal/);
  assert.match(connectionsManagerSource, /controller\.abort\(\)/);
  assert.doesNotMatch(connectionsManagerSource, /setInterval\(\(\) => void poll\(\), 2_000\)/);
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

test("usage period changes only after the matching summary is loaded", () => {
  assert.match(providerSettingsSource, /setUsage\(payload\.data\);\s*setUsageDays\(Number\.isInteger\(payload\.data\.days\) \? payload\.data\.days : days\)/);
  assert.match(providerSettingsSource, /function changeUsageDays\(days: number\) \{\s*void loadUsage\(days\);\s*\}/);
  assert.match(usageDashboardSource, /days=\{Number\.isInteger\(summary\.days\) \? summary\.days : days\}/);
});

test("Gemini authenticates with a header instead of exposing the API key in the URL", () => {
  assert.match(providerAdapterSource, /"x-goog-api-key": config\.apiKey/);
  assert.doesNotMatch(providerAdapterSource, /searchParams\.set\("key", config\.apiKey\)/);
});
