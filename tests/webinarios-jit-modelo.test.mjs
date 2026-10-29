import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// "Comeca quando voce entra", a parte pura (docs/30 §1.2, §1.6, §2.2, §2.7, A14 e D25; docs/18 §2.5): o horario
// seguinte nas bordas (no limite exato, no ultimo minuto, no fim da janela), a janela de horas de Sao Paulo, a virada
// do dia (a meia-noite e o horario de ontem que ainda corre), o fuso (10:00 em Sao Paulo e 13:00 UTC), a entrada
// atrasada (nula = ate o fim do video; com minutos, ate aquele minuto), a escolha da rota, o que a pagina mostra e o
// publicar sem hora marcada.

const jit = await import("../src/server/webinars/jit-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { defaultJitSettings } = await import("../src/server/webinars/model.ts");
const { WEBINAR_MESSAGES } = await import("../src/server/webinars/schemas.ts");

const MIN = 60_000;
const HOUR = 60 * MIN;
const regras = (extra = {}) => ({ ...defaultJitSettings(), enabled: true, ...extra });
/** Um instante pela hora de Sao Paulo (UTC-3, sem horario de verao desde 2019). */
const sp = (texto) => Date.parse(`${texto}-03:00`);
const iso = (texto) => new Date(sp(texto)).toISOString();

test("fuso de Sao Paulo: 10:00 la e 13:00 UTC; o dia de Sao Paulo vai das 03:00 UTC as 03:00 UTC do dia seguinte", () => {
  assert.equal(jit.saoPauloWallToMs({ day: 29, month: 10, year: 2026 }, 10 * 60), Date.parse("2026-10-29T13:00:00.000Z"));
  assert.deepEqual(jit.saoPauloWallClock(Date.parse("2026-10-30T02:30:00.000Z")), { day: 29, minuteOfDay: 23 * 60 + 30, month: 10, year: 2026 }, "23:30 em Sao Paulo ainda e dia 29");
  assert.deepEqual(jit.jitDayRange(Date.parse("2026-10-30T02:30:00.000Z")), { fromIso: "2026-10-29T03:00:00.000Z", toIso: "2026-10-30T03:00:00.000Z" });
  assert.deepEqual(jit.jitDayRange(Date.parse("2026-10-30T03:00:00.000Z")), { fromIso: "2026-10-30T03:00:00.000Z", toIso: "2026-10-31T03:00:00.000Z" }, "meia-noite em Sao Paulo ja e o dia 30");

  const slots = jit.jitSlotsOfDay(regras({ endHour: 10, everyMinutes: 30, startHour: 8 }), { day: 29, month: 10, year: 2026 });
  assert.deepEqual(
    slots.map((ms) => new Date(ms).toISOString()),
    ["2026-10-29T11:00:00.000Z", "2026-10-29T11:30:00.000Z", "2026-10-29T12:00:00.000Z", "2026-10-29T12:30:00.000Z"],
    "08:00, 08:30, 09:00 e 09:30: o fim (10:00) fica fora"
  );
  assert.equal(jit.isJitSlot(regras(), sp("2026-10-29T10:15:00")), true);
  assert.equal(jit.isJitSlot(regras(), sp("2026-10-29T10:07:00")), false, "fora do limite de 15 min");
  assert.equal(jit.isJitSlot(regras(), sp("2026-10-29T07:45:00")), false, "antes da janela");
  assert.equal(jit.isJitSlot(regras({ everyMinutes: 60 }), sp("2026-10-29T10:30:00")), false, "a cada 60 min so na hora cheia");
});

test("o proximo horario e o atual: no meio, no limite exato, no ultimo minuto; a sala do proximo abre 15 min antes", () => {
  const meio = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:07:00"), settings: regras() });
  assert.deepEqual(meio.current, { atMs: sp("2026-10-29T10:00:00"), iso: iso("2026-10-29T10:00:00") });
  assert.deepEqual(meio.next, { atMs: sp("2026-10-29T10:15:00"), iso: iso("2026-10-29T10:15:00") });
  assert.equal(meio.minutesUntilNext, 8);
  assert.equal(meio.nextRoomOpen, true);
  assert.equal(meio.running, true);
  assert.equal(meio.currentAcceptsEntry, true, "Entrada atrasada nula: ate o fim do video");

  const limite = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:15:00"), settings: regras({ lateJoinMinutes: 0 }) });
  assert.equal(limite.current?.iso, iso("2026-10-29T10:15:00"), "no limite exato, o horario que comeca agora e o atual");
  assert.equal(limite.next?.iso, iso("2026-10-29T10:30:00"));
  assert.equal(limite.currentAcceptsEntry, true, "com 0 min, so no proprio segundo");

  const ultimoMinuto = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:14:30"), settings: regras() });
  assert.equal(ultimoMinuto.minutesUntilNext, 1, "30 s viram 1 min, nunca 0");

  const aCada60 = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:05:00"), settings: regras({ everyMinutes: 60 }) });
  assert.equal(aCada60.next?.iso, iso("2026-10-29T11:00:00"));
  assert.equal(aCada60.minutesUntilNext, 55);
  assert.equal(aCada60.nextRoomOpen, false, "a sala abre so 15 min antes");
  assert.equal(aCada60.running, true, "a sequencia continua: as sessoes estao correndo");

  const aCada30 = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:44:59"), settings: regras({ everyMinutes: 30 }) });
  assert.equal(aCada30.next?.iso, iso("2026-10-29T11:00:00"));
  assert.equal(aCada30.nextRoomOpen, false, "15 min e 1 s antes ainda nao");
  assert.equal(jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:45:00"), settings: regras({ everyMinutes: 30 }) }).nextRoomOpen, true, "15 min antes abre");
});

test("entrada atrasada: nula vale ate o fim do video; com minutos, ate aquele minuto (como canJoinSimulated)", () => {
  const agora = sp("2026-10-29T10:07:00");
  assert.equal(jit.nextJitSlot({ durationMs: HOUR, nowMs: agora, settings: regras({ lateJoinMinutes: 5 }) }).currentAcceptsEntry, false, "7 min depois, com 5");
  assert.equal(jit.nextJitSlot({ durationMs: HOUR, nowMs: agora, settings: regras({ lateJoinMinutes: 7 }) }).currentAcceptsEntry, true, "7 min depois, com 7");
  assert.equal(jit.nextJitSlot({ durationMs: 6 * MIN, nowMs: agora, settings: regras() }).currentAcceptsEntry, false, "o video de 6 min ja acabou");
  assert.equal(jit.nextJitSlot({ durationMs: 7 * MIN, nowMs: agora, settings: regras() }).currentAcceptsEntry, false, "no ultimo instante do video, acabou");
  assert.equal(jit.nextJitSlot({ nowMs: agora, settings: regras() }).currentAcceptsEntry, true, "sem a duracao, so a Entrada atrasada conta");
});

test("janela de horas: antes do inicio, no fim, a virada do dia e o horario de ontem que ainda corre depois da meia-noite", () => {
  const antes = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T07:50:00"), settings: regras() });
  assert.equal(antes.next?.iso, iso("2026-10-29T08:00:00"));
  assert.equal(antes.minutesUntilNext, 10);
  assert.equal(antes.current?.iso, iso("2026-10-28T22:45:00"), "o ultimo horario de ontem");
  assert.equal(antes.currentAcceptsEntry, false, "ja acabou faz horas");
  assert.equal(antes.running, true, "10 min antes do primeiro horario: a sequencia ja vale");

  const cedo = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T07:30:00"), settings: regras() });
  assert.equal(cedo.running, false, "30 min antes, fora do horario");
  assert.equal(cedo.nextRoomOpen, false);

  const fim = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T22:50:00"), settings: regras() });
  assert.equal(fim.current?.iso, iso("2026-10-29T22:45:00"), "o ultimo horario da janela (o fim, 23:00, fica fora)");
  assert.equal(fim.next?.iso, iso("2026-10-30T08:00:00"), "o proximo e amanha no inicio da janela");
  assert.equal(fim.minutesUntilNext, 9 * 60 + 10);
  assert.equal(fim.running, false);

  const meiaNoite = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-30T00:10:00"), settings: regras({ endHour: 24, everyMinutes: 30, startHour: 20 }) });
  assert.equal(meiaNoite.current?.iso, iso("2026-10-29T23:30:00"), "o horario de ontem continua sendo o atual");
  assert.equal(meiaNoite.currentAcceptsEntry, true, "40 min de um video de 60, ate o fim");
  assert.equal(meiaNoite.next?.iso, iso("2026-10-30T20:00:00"));

  const diaInteiro = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T23:59:00"), settings: regras({ endHour: 24, startHour: 0 }) });
  assert.equal(diaInteiro.next?.iso, iso("2026-10-30T00:00:00"), "0 a 24 h: a virada do dia e so mais um horario");
  assert.equal(diaInteiro.minutesUntilNext, 1);

  const invalida = jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:00:00"), settings: regras({ endHour: 8, startHour: 8 }) });
  assert.deepEqual(invalida, { current: null, currentAcceptsEntry: false, minutesUntilNext: null, next: null, nextRoomOpen: false, running: false }, "janela vazia: nada");
});

test("a escolha da rota: o atual quando aceita; senao o proximo com a sala aberta; senao nada", () => {
  const atual = jit.jitEntryChoice(jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:03:00"), settings: regras({ lateJoinMinutes: 5 }) }));
  assert.deepEqual(atual, { slot: { atMs: sp("2026-10-29T10:00:00"), iso: iso("2026-10-29T10:00:00") }, which: "current" });

  const proximo = jit.jitEntryChoice(jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:07:00"), settings: regras({ lateJoinMinutes: 5 }) }));
  assert.deepEqual(proximo, { slot: { atMs: sp("2026-10-29T10:15:00"), iso: iso("2026-10-29T10:15:00") }, which: "next" });

  assert.equal(jit.jitEntryChoice(jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T10:07:00"), settings: regras({ everyMinutes: 60, lateJoinMinutes: 5 }) })), null, "o proximo e as 11:00: a sala ainda nao abriu");
  assert.equal(jit.jitEntryChoice(jit.nextJitSlot({ durationMs: HOUR, nowMs: sp("2026-10-29T03:00:00"), settings: regras() })), null, "madrugada, fora da janela");
});

test("a pagina do aluno: 'A próxima sessão começa em {n} min' com o Entrar; a sessao que ja comecou; fora do horario", () => {
  const proxima = jit.jitPageState({ durationMs: HOUR, nowMs: sp("2026-10-29T10:07:00"), settings: regras({ lateJoinMinutes: 5 }) });
  assert.deepEqual(proxima, { kind: "next", minutes: 8, roomOpen: true, slotIso: iso("2026-10-29T10:15:00"), timeLabel: "10:15" });
  assert.equal(jit.jitPageSentence(proxima), "A próxima sessão começa em 8 min");
  assert.equal(jit.jitPageSentence(proxima), WEBINAR_COPY.jit.aluno.proximaSessaoEm(8));
  assert.equal(jit.jitCanEnter(proxima), true);

  const comecou = jit.jitPageState({ durationMs: HOUR, nowMs: sp("2026-10-29T10:03:00"), settings: regras({ lateJoinMinutes: 5 }) });
  assert.deepEqual(comecou, { kind: "current", slotIso: iso("2026-10-29T10:00:00"), timeLabel: "10:00" });
  assert.equal(jit.jitPageSentence(comecou), "A sessão das 10:00 já começou. Entre agora.");
  assert.equal(jit.jitCanEnter(comecou), true);

  const longe = jit.jitPageState({ durationMs: HOUR, nowMs: sp("2026-10-29T10:07:00"), settings: regras({ everyMinutes: 60, lateJoinMinutes: 5 }) });
  assert.equal(longe.kind, "next");
  assert.equal(longe.roomOpen, false);
  assert.equal(jit.jitCanEnter(longe), false, "o Entrar liga sozinho 15 min antes");

  const fora = jit.jitPageState({ durationMs: HOUR, nowMs: sp("2026-10-29T05:00:00"), settings: regras({ startHour: 9 }) });
  assert.deepEqual(fora, { kind: "closed", nextIso: iso("2026-10-29T09:00:00"), opensLabel: "09:00" });
  assert.equal(jit.jitPageSentence(fora), "As sessões abrem a partir das 09:00 (horário de Brasília).");
  assert.equal(jit.jitCanEnter(fora), false);
});

test("o resto do app: a sessao jit, o publicar sem hora marcada so com o just-in-time ligado na Live gravada, a frase da Revisao", () => {
  assert.equal(jit.isJitSession({ jit: true }), true);
  assert.equal(jit.isJitSession({ jit: false }), false);
  assert.equal(jit.isJitSession({}), false);

  const problemas = [
    { message: WEBINAR_MESSAGES.recordingRequired, path: "recordingVideoUrl" },
    { message: WEBINAR_MESSAGES.sessionsRequired, path: "sessions" },
    { message: WEBINAR_MESSAGES.pastDate, path: "sessions" }
  ];
  assert.deepEqual(jit.withJitPublishProblems(problemas, { jit: { enabled: true }, kind: "simulated" }).map((item) => item.path), ["recordingVideoUrl"], "o video continua obrigatorio");
  assert.equal(jit.withJitPublishProblems(problemas, { jit: { enabled: false }, kind: "simulated" }).length, 3);
  assert.equal(jit.withJitPublishProblems(problemas, { jit: null, kind: "simulated" }).length, 3);
  assert.equal(jit.withJitPublishProblems(problemas, { jit: { enabled: true }, kind: "live" }).length, 3, "so a Live gravada");

  assert.equal(jit.jitSummary(regras()), "Começa quando você entra: a cada 15 min, das 08:00 às 23:00 (horário de Brasília)");
});

test("o contador do card na Inicio e o Entrar da pagina nao levam model.ts, room-model.ts nem as frases do editor ao navegador (JS inicial do Inicio)", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  // Os imports e reexports de valor (nao `import type`) relativos e por "@/", de arquivo em arquivo.
  const reachedFrom = (start) => {
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) {
        return;
      }
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const [, spec] of source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)) {
        const base = spec.startsWith("@/") ? resolve(root, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
        const target = base && [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((path) => existsSync(path));
        if (target) {
          visit(target);
        }
      }
    };
    visit(resolve(root, start));
    return [...seen].map((path) => path.slice(root.length + 1));
  };

  // O contador esta no card da Inicio: nem as frases do editor. O Entrar fica so na pagina do webinario, que ja le
  // WEBINAR_COPY (com todas as frases do JIT); dele, so o modelo.
  const heavy = ["src/server/webinars/jit-model.ts", "src/server/webinars/model.ts", "src/server/webinars/room-model.ts"];
  for (const [start, forbidden] of [
    ["src/components/member/webinars/jit/jit-countdown.tsx", [...heavy, "src/lib/webinar-copy-v4/jit.ts", "src/lib/webinar-copy.ts"]],
    ["src/components/member/webinars/jit/jit-enter.tsx", heavy]
  ]) {
    const reached = reachedFrom(start);
    assert.ok(reached.includes("src/server/webinars/jit-clock.ts"), `${start}: ${reached.join(", ")}`);
    for (const file of forbidden) {
      assert.ok(!reached.includes(file), `${start} nao alcanca ${file}`);
    }
  }
  const clock = reachedFrom("src/server/webinars/jit-clock.ts").sort();
  assert.deepEqual(
    clock,
    ["src/lib/webinar-copy-v4/jit-aluno.ts", "src/lib/webinar-time.ts", "src/server/webinars/jit-clock.ts", "src/server/webinars/jit-limits.ts", "src/server/webinars/room-opens.ts"],
    "o relogio so le modulos folha"
  );

  // Uma constante e uma frase so: model.ts, room-model.ts, jit.ts e jit-model.ts reexportam as dos modulos folha.
  const { JIT_LIMITS } = await import("../src/server/webinars/model.ts");
  const leafLimits = await import("../src/server/webinars/jit-limits.ts");
  const { ROOM_OPENS_MINUTES_BEFORE } = await import("../src/server/webinars/room-model.ts");
  const leafRoom = await import("../src/server/webinars/room-opens.ts");
  const { JIT_COPY } = await import("../src/lib/webinar-copy-v4/jit.ts");
  const aluno = await import("../src/lib/webinar-copy-v4/jit-aluno.ts");
  const relogio = await import("../src/server/webinars/jit-clock.ts");
  assert.equal(JIT_LIMITS, leafLimits.JIT_LIMITS);
  assert.equal(ROOM_OPENS_MINUTES_BEFORE, leafRoom.ROOM_OPENS_MINUTES_BEFORE);
  assert.equal(ROOM_OPENS_MINUTES_BEFORE, 15);
  assert.equal(JIT_COPY.aluno, aluno.JIT_ALUNO_COPY);
  assert.equal(JIT_COPY.card.horaDe, aluno.jitHoraDe);
  assert.equal(WEBINAR_COPY.jit.aluno, aluno.JIT_ALUNO_COPY);
  for (const name of ["jitPageState", "jitPageSentence", "jitCanEnter", "nextJitSlot", "jitEntryChoice", "jitDayRange", "jitSlotsOfDay", "isJitSlot", "saoPauloWallClock", "saoPauloWallToMs"]) {
    assert.equal(jit[name], relogio[name], `jit-model reexporta ${name} de jit-clock`);
  }
});
