import { defineConfig, devices } from "@playwright/test";
import { loadEnvFile } from "./tests/support/db.mjs";

// Testes de ponta a ponta (docs/18 §2.1 e §2.4): navegador real contra o app buildado na porta 3100 e o
// Supabase LOCAL (`npm run db:start` antes). O projeto "setup" entra uma vez por persona e guarda a
// sessao em tests/e2e/.auth; os outros projetos reaproveitam. Chromium e WebKit (motor do Safari, do
// iPhone e do iPad).

// Supabase LOCAL (.env.test.local) para o Playwright, os testes e o servidor do app que ele sobe.
loadEnvFile();

const port = process.env.E2E_PORT ?? "3100";
const baseURL = `http://127.0.0.1:${port}`;
const sessaoDaAluna = "tests/e2e/.auth/aluna.json";

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results",
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts$/ },
    {
      dependencies: ["setup"],
      name: "chromium",
      testMatch: /.*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], storageState: sessaoDaAluna }
    },
    {
      dependencies: ["setup"],
      name: "webkit",
      testMatch: /.*\.spec\.ts$/,
      use: { ...devices["Desktop Safari"], storageState: sessaoDaAluna }
    }
  ],
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL,
    locale: "pt-BR",
    screenshot: "only-on-failure",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "node tests/support/e2e-server.mjs",
    reuseExistingServer: !process.env.CI,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 300_000,
    url: `${baseURL}/login`
  },
  workers: 1
});
