import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Configuracoes › Tutor IA: regras puras das telas novas (src/components/admin/v2/settings/ai-settings-model.ts).
// Os limites espelham a validacao do servidor (src/server/ai/provider-config.ts).

const ai = await import("../src/components/admin/v2/settings/ai-settings-model.ts");
const period = await import("../src/components/admin/v2/period.ts");

test("provedor no endereco: so os tres conhecidos, o resto cai no padrao", () => {
  assert.equal(ai.parseAiProviderParam("openai"), "openai");
  assert.equal(ai.parseAiProviderParam(["anthropic", "openai"]), "anthropic");

  for (const invalid of ["chatgpt", "", null, undefined, [], ["x"]]) {
    assert.equal(ai.parseAiProviderParam(invalid), "gemini", JSON.stringify(invalid));
  }

  assert.equal(ai.parseAiProviderParam("x", "openai"), "openai");
  assert.equal(ai.getAiProviderMeta("anthropic").shortLabel, "Claude");
});

test("politica: numeros aceitam virgula, inteiros e limites com mensagem em portugues", () => {
  assert.equal(ai.parseLocaleNumber("0,3"), 0.3);
  assert.equal(ai.parseLocaleNumber(" 1 200 "), 1200);
  assert.ok(Number.isNaN(ai.parseLocaleNumber("abc")));
  assert.ok(Number.isNaN(ai.parseLocaleNumber("1e3")));

  assert.equal(ai.validateAiPolicyNumber("temperature", "0,5"), null);
  assert.equal(ai.validateAiPolicyNumber("temperature", "1,5"), "Use um valor entre 0 e 1.");
  assert.equal(ai.validateAiPolicyNumber("dailyQuestionLimit", "2,5"), "Use um número inteiro.");
  assert.equal(ai.validateAiPolicyNumber("dailyQuestionLimit", "0"), "Use um valor entre 1 e 10.000.");
  assert.equal(ai.validateAiPolicyNumber("maxOutputTokens", ""), "Informe um número.");
  assert.equal(ai.validateAiPolicyNumber("priority", "-1000"), null);

  assert.equal(ai.validateAiModel("  "), "Informe o modelo.");
  assert.equal(ai.validateAiModel("gpt-4.1-mini"), null);
  assert.equal(ai.validateAiModel("modelo\u0000"), "Modelo inválido.");
});

test("politica: formulario padrao, corpo do PUT e alteracao", () => {
  const empty = ai.makeAiPolicyForm("openai");
  assert.equal(empty.defaultModel, "gpt-4.1-mini");
  assert.equal(empty.enabled, true);
  assert.equal(empty.temperature, "0,2", "virgula decimal na tela");
  assert.deepEqual(ai.validateAiPolicyForm(empty), {});

  const form = { ...empty, dailyQuestionLimit: "30", temperature: "0,4" };
  assert.deepEqual(ai.aiPolicyFormToPayload("openai", form), {
    contextMaxCharacters: 60000,
    dailyQuestionLimit: 30,
    defaultModel: "gpt-4.1-mini",
    enabled: true,
    isDefault: false,
    maxOutputTokens: 900,
    monthlyQuestionLimit: 10000,
    priority: 0,
    provider: "openai",
    temperature: 0.4
  });
  assert.equal(ai.isAiPolicyFormDirty(empty, form), true);
  assert.equal(ai.isAiPolicyFormDirty(empty, { ...empty }), false);
  assert.deepEqual(Object.keys(ai.validateAiPolicyForm({ ...empty, defaultModel: "", temperature: "x" })).sort(), ["defaultModel", "temperature"]);
});

test("estado da conexao em palavras do produtor", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const base = { cooldownUntil: null, healthTier: "healthy", status: "active" };

  assert.deepEqual(ai.describeAiConnectionState(base, now), { label: "Funcionando", tone: "success" });
  assert.deepEqual(ai.describeAiConnectionState({ ...base, status: "paused" }, now), { label: "Pausada", tone: "muted" });
  assert.deepEqual(ai.describeAiConnectionState({ ...base, status: "needs_attention" }, now), { label: "Precisa de atenção", tone: "error" });
  assert.deepEqual(ai.describeAiConnectionState({ ...base, cooldownUntil: "2026-10-10T12:05:00Z" }, now), { label: "Em espera", tone: "warning" });
  assert.deepEqual(ai.describeAiConnectionState({ ...base, cooldownUntil: "2026-10-10T11:00:00Z" }, now), { label: "Funcionando", tone: "success" });
  assert.deepEqual(ai.describeAiConnectionState({ ...base, healthTier: "draining" }, now), { label: "Instável", tone: "warning" });
});

test("hub de Configuracoes: Conectado so com provedor ligado e conexao ativa", () => {
  const gemini = { enabled: true, provider: "gemini", status: "configured" };

  assert.deepEqual(ai.summarizeAiSetup([], []), { label: "Em configuração", tone: "warning" });
  assert.deepEqual(ai.summarizeAiSetup([gemini], []), { label: "Em configuração", tone: "warning" });
  assert.deepEqual(ai.summarizeAiSetup([gemini], [{ provider: "gemini", status: "active" }]), { label: "Conectado", tone: "success" });
  assert.deepEqual(ai.summarizeAiSetup([gemini], [{ provider: "gemini", status: "paused" }]), { label: "Precisa de atenção", tone: "error" });
  assert.deepEqual(
    ai.summarizeAiSetup([{ ...gemini, enabled: false }], [{ provider: "gemini", status: "active" }]),
    { label: "Em configuração", tone: "warning" },
    "provedor desligado nao conta"
  );
  assert.deepEqual(
    ai.summarizeAiSetup([gemini], [{ provider: "openai", status: "active" }]),
    { label: "Em configuração", tone: "warning" },
    "conexao de outro provedor nao liga o Gemini"
  );
});

test("seletor de provedores resume politica e conexoes", () => {
  const configs = [{ ...ai.makeAiPolicyForm("gemini"), defaultModel: "gemini-x", enabled: true, isDefault: true, provider: "gemini" }];
  const connections = [
    { authMode: "api_key", provider: "openai", status: "active" },
    { authMode: "account_gateway", provider: "openai", status: "paused" },
    { authMode: "api_key", provider: "openai", status: "paused" }
  ];

  const policy = ai.buildAiProviderEntries("policy", configs, connections);
  assert.deepEqual(policy[0], { detail: "gemini-x", provider: "gemini", status: { label: "Primeiro da fila", tone: "success" } });
  assert.deepEqual(policy[1].status, { label: "Não configurado", tone: "muted" });

  const links = ai.buildAiProviderEntries("connections", configs, connections);
  assert.deepEqual(links[1], { detail: "2 chaves · 1 conta", provider: "openai", status: { label: "1 ativa", tone: "success" } });
  assert.deepEqual(links[0], { detail: "Nenhuma conexão", provider: "gemini", status: { label: "Sem conexão", tone: "muted" } });
});

test("consumo: serie diaria completa (dias sem uso em zero) e numeros em pt-BR", () => {
  const now = new Date("2026-10-10T15:00:00Z");
  const series = ai.buildAiUsageSeries(
    [
      { answers: 3, date: "2026-10-08", inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      { answers: 1, date: "2026-10-10T00:00:00Z", inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      { answers: 9, date: "2026-09-01", inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    ],
    3,
    now
  );

  assert.deepEqual(
    series.map((point) => [point.date, point.label, point.totalTokens, point.answers]),
    [
      ["2026-10-08", "08/10", 150, 3],
      ["2026-10-09", "09/10", 0, 0],
      ["2026-10-10", "10/10", 15, 1]
    ],
    "dia fora do periodo fica de fora"
  );
  assert.equal(ai.buildAiUsageSeries([], 0, now).length, 1, "periodo minimo de um dia");
  assert.equal(ai.buildAiUsageSeries([], 1000, now).length, 365, "periodo maximo de um ano");

  assert.equal(ai.aiFailureRate(0, 0), null);
  assert.equal(ai.aiFailureRate(97, 3), 3);
  assert.equal(ai.aiFailureRate(2, 1), 33.3);
  assert.equal(ai.formatAiNumber(1234567), "1.234.567");
  assert.equal(ai.formatAiCompact(9999), "9.999");
  assert.equal(ai.formatAiCompact(1_250_000).replace(/\s/g, " "), "1,3 mi", "Intl usa espaco fino entre numero e unidade");
  assert.equal(ai.formatAiDateTime(null), "Nunca");
  assert.equal(ai.formatAiDateTime("lixo", "—"), "—");
  assert.equal(ai.formatAiDateTime("2026-10-10T15:00:00Z"), "10/10/2026, 12:00");
});

test("consumo por periodo: um ponto por hora ate 3 dias e por dia acima, no fuso da escola", () => {
  // Sabado, 10/10/2026, 12:30 em Sao Paulo.
  const now = new Date("2026-10-10T15:30:00Z");
  const hoje = period.resolveAdminPeriod({ kind: "preset", preset: "hoje" }, now);
  const hourly = ai.buildAiUsageBucketSeries(
    [
      { answers: 2, bucket: "2026-10-10T09", inputTokens: 40, outputTokens: 20, totalTokens: 60 },
      { answers: 1, bucket: "2026-10-10T12", inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      { answers: 7, bucket: "2026-10-09T23", inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    ],
    period.listAdminPeriodBuckets(hoje)
  );

  assert.equal(hoje.granularity, "hour");
  assert.equal(hourly.length, 13, "00h ate a hora em curso (12h)");
  assert.deepEqual(
    hourly.filter((point) => point.totalTokens > 0).map((point) => [point.key, point.label, point.totalTokens, point.answers]),
    [
      ["2026-10-10T09", "9h", 60, 2],
      ["2026-10-10T12", "12h", 10, 1]
    ],
    "hora de ontem fica de fora; horas sem uso entram com zero"
  );
  assert.equal(hourly[9].longLabel, "Sábado, 10 de outubro, 9h");

  const week = period.resolveAdminPeriod({ kind: "preset", preset: "7d" }, now);
  const daily = ai.buildAiUsageBucketSeries(
    [{ answers: "3", bucket: "2026-10-05", inputTokens: "100", outputTokens: "50", totalTokens: "150" }],
    period.listAdminPeriodBuckets(week)
  );

  assert.equal(week.granularity, "day");
  assert.deepEqual(daily.map((point) => point.label), ["04/10", "05/10", "06/10", "07/10", "08/10", "09/10", "10/10"]);
  assert.deepEqual(daily[1], {
    answers: 3,
    inputTokens: 100,
    key: "2026-10-05",
    label: "05/10",
    longLabel: "Segunda-feira, 5 de outubro",
    outputTokens: 50,
    totalTokens: 150
  });
  assert.equal(daily[0].totalTokens, 0);

  const range = period.resolveAdminPeriod({ from: "2026-09-28", kind: "range", to: "2026-10-04" }, now);
  assert.deepEqual(
    ai.buildAiUsageBucketSeries([], period.listAdminPeriodBuckets(range)).map((point) => point.key),
    ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"],
    "intervalo fechado do calendario, virando o mes"
  );
});

test("consumo por periodo: a pagina le ?periodo= com o modelo novo e avisa sem a migracao", async () => {
  const page = await readFile(new URL("../src/app/admin/(v2)/configuracoes/ia/consumo/page.tsx", import.meta.url), "utf8");
  const view = await readFile(new URL("../src/components/admin/v2/settings/ai-usage-view.tsx", import.meta.url), "utf8");
  const reader = await readFile(new URL("../src/server/ai/usage-analytics.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/202610120002_ai_usage_between.sql", import.meta.url), "utf8");

  assert.match(page, /readAdminPeriod\(params, now\)/);
  assert.match(page, /getAIUsageSummaryBetween\(/);
  assert.match(page, /<PendingMigrationNotice migration=\{AI_USAGE_BETWEEN_MIGRATION\}/);
  assert.match(page, /nowIso=\{now\.toISOString\(\)\}/);
  assert.doesNotMatch(page, /parseAdminPeriod\(|describeAdminPeriod/, "nada do filtro antigo 7 · 30 · 90");
  assert.match(view, /listAdminPeriodBuckets\(resolved\)/);
  assert.match(view, /resolveAdminPeriod\(parseAdminPeriodParam\(param, now\), now\)/);
  assert.match(reader, /AI_USAGE_BETWEEN_MIGRATION = "202610120002"/);
  assert.match(reader, /toDbError\(result\.error, "Consumo de IA"\)/);

  // Migracao: copia da funcao antiga (security definer), intervalo [inicio, fim), baldes no fuso da escola.
  assert.match(migration, /create or replace function public\.get_ai_usage_summary_between\(/);
  assert.match(migration, /security definer\s+set search_path = public/);
  assert.match(migration, /message\.created_at >= p_start\s+and message\.created_at < p_end/);
  assert.match(migration, /to_char\(message\.created_at at time zone 'America\/Sao_Paulo', 'YYYY-MM-DD"T"HH24'\)/);
  assert.match(migration, /p_granularity not in \('hour', 'day'\)/);
  assert.match(
    migration,
    /revoke all on function public\.get_ai_usage_summary_between\(timestamptz, timestamptz, text, text\)\s+from public, anon, authenticated;/
  );
  assert.match(migration, /grant execute on function public\.get_ai_usage_summary_between\(timestamptz, timestamptz, text, text\)\s+to service_role;/);
  assert.doesNotMatch(migration, /grant execute[^;]*to (?:anon|authenticated)/);
});
