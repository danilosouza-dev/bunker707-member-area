import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8").catch(() => "");
}

const dashboardSource = await readSource("../src/components/admin-dashboard.tsx");
const feedbackSource = await readSource("../src/components/admin/admin-operation-feedback.tsx");
const loadingSource = await readSource("../src/app/admin/loading.tsx");
const moderationSource = await readSource("../src/components/admin/moderation/moderation-command-center.tsx");

test("admin operations expose persistent and accessible pending, success and error feedback", () => {
  assert.match(feedbackSource, /AdminOperationProvider/);
  assert.match(feedbackSource, /runAdminOperation/);
  assert.match(feedbackSource, /activeOperationsRef/);
  assert.match(feedbackSource, /status: "pending"/);
  assert.match(feedbackSource, /status: "success"/);
  assert.match(feedbackSource, /status: "error"/);
  assert.match(feedbackSource, /aria-live=/);
  assert.match(feedbackSource, /role=\{feedback\.status === "error" \? "alert" : "status"\}/);
  assert.match(feedbackSource, /animate-spin/);
  assert.match(feedbackSource, /pendingKeys/);
});

test("admin route has an explicit loading state before dashboard data is ready", () => {
  assert.match(loadingSource, /aria-busy="true"/);
  assert.match(loadingSource, /role="status"/);
  assert.match(loadingSource, /Carregando o CRM Bunker707/);
  assert.match(loadingSource, /LoaderCircle/);
  assert.match(loadingSource, /animate-spin/);
});

test("catalog and structure mutations use named feedback and local busy buttons", () => {
  assert.match(dashboardSource, /<AdminOperationProvider>/);

  for (const key of [
    "catalog:content:save",
    "catalog:module:save",
    "catalog:lesson:save",
    "structure:module:save",
    "structure:lesson:save",
    "structure:cohort:save"
  ]) {
    assert.match(dashboardSource, new RegExp(key.replaceAll(":", "\\:")));
  }

  for (const label of [
    "Salvando item...",
    "Salvando modulo...",
    "Salvando aula...",
    "Criando modulo...",
    "Criando aula...",
    "Criando turma..."
  ]) {
    assert.match(dashboardSource, new RegExp(label.replaceAll(".", "\\.")));
  }

  assert.match(dashboardSource, /aria-busy=\{isSavingContent\}/);
  assert.match(dashboardSource, /aria-busy=\{isSavingModule\}/);
  assert.match(dashboardSource, /aria-busy=\{isSavingLesson\}/);
  assert.match(dashboardSource, /LoaderCircle className="h-4 w-4 animate-spin"/);
  assert.match(dashboardSource, /catalog:image:module/);
});

test("shared producer settings and moderation also report persistence status", () => {
  for (const key of ["students:save", "agents:save", "integrations:save", "combos:save:"]) {
    assert.match(dashboardSource, new RegExp(key.replaceAll(":", "\\:")));
  }

  assert.match(moderationSource, /useAdminOperation/);
  assert.match(moderationSource, /runAdminOperation\(`moderation:\$\{key\}`/);
  assert.match(moderationSource, /Atualizando a moderacao do comentario/);
  assert.match(moderationSource, /Regra de moderacao salva/);
});
