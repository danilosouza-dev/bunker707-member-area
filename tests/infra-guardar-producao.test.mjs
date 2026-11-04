import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test, { after } from "node:test";

import { cloudDir, criarInfraDeMentira as setup, faltamBinarios as missing, hzCall, hzCalls, limparInfraDeMentira, oldImage, record, serverFixture } from "./fixtures/infra-de-mentira.mjs";

// Guardar a producao em snapshot e trazer de volta (infra/cloud/snapshot.sh e restaurar.sh; docs/20 §4A.7, decisao
// de 03/11/2026). Os scripts de verdade rodam contra a Hetzner, a Cloudflare e os servidores de mentira de
// tests/fixtures/infra-de-mentira.mjs, com um log so, na ordem em que aconteceu. Nada fala com a rede.

after(limparInfraDeMentira);

function productionOn() {
  return {
    servers: [serverFixture("bunker707-membros", "membros", 1), serverFixture("bunker707-marketing", "marketing", 2), serverFixture("bunker707-meet", "meet", 3)],
    images: [oldImage(501, "membros", "2026-10-20T10:00:00.000Z"), oldImage(502, "membros", "2026-10-25T10:00:00.000Z")],
    records: [
      record("membros.bunker707.com.br", "A", "192.0.2.1", true),
      record("membros.bunker707.com.br", "AAAA", "2001:db8:a1::1", true),
      record("api.bunker707.com.br", "A", "192.0.2.1", true),
      record("studio.bunker707.com.br", "A", "192.0.2.1", true),
      record("marketing.bunker707.com.br", "A", "192.0.2.2", true),
      record("meet.bunker707.com.br", "A", "192.0.2.3", false),
      record("www.bunker707.com.br", "CNAME", "site.exemplo.com", true)
    ]
  };
}

test("snapshot guarda os tres papeis: backup novo antes de qualquer imagem, desliga pelo sistema, imagem protegida com tipo e local, apaga so depois e fica com os 2 mais novos", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const env = setup(productionOn());
  const result = env.runScript("snapshot.sh", { CONFIRMAR: "apagar" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = env.calls();
  const state = env.hz();

  assert.deepEqual(state.servers, [], "os tres servidores apagados");
  const firstImage = hzCall(calls, "server create-image");
  const backups = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.tool === "ssh" && c.command.includes("systemctl start"));
  assert.deepEqual(backups.map(({ c }) => [c.target, c.command.match(/'(bunker707[^']*\.service)'/)[1]]), [
    ["deploy@192.0.2.1", "bunker707-backup.service"],
    ["deploy@192.0.2.2", "bunker707-mautic-backup.service"]
  ], "backup do A e do B, nenhum no C (sem dado de aluno)");
  assert.ok(backups.every(({ i }) => i < firstImage), "todos os backups terminam antes da primeira imagem");

  for (const [role, name] of [["membros", "bunker707-membros"], ["marketing", "bunker707-marketing"], ["meet", "bunker707-meet"]]) {
    const shutdown = hzCall(calls, `server shutdown ${name}`);
    const image = hzCall(calls, `server create-image ${name}`);
    const del = hzCall(calls, `server delete ${name}`);
    assert.ok(shutdown >= 0 && shutdown < image && image < del, `${name}: desliga, faz a imagem e so entao apaga`);
    const newest = state.images.filter((i) => i.labels.papel === role).sort((a, b) => a.created.localeCompare(b.created)).at(-1);
    assert.deepEqual(newest.labels, { app: "bunker707", papel: role, origem: name, tipo: "cx23", local: "fsn1" });
    assert.equal(newest.protection.delete, true, `${role}: o snapshot novo fica protegido contra exclusao`);
  }
  assert.equal(hzCall(calls, "server poweroff"), -1, "o desligar pelo sistema respondeu: a energia nao e cortada");

  const membrosImages = state.images.filter((i) => i.labels.papel === "membros").map((i) => i.id);
  assert.equal(membrosImages.length, 2, "ficam os 2 mais novos do membros");
  assert.ok(!membrosImages.includes(501) && membrosImages.includes(502), "o mais velho (501) sai, mesmo protegido; o 502 fica");
  assert.ok(hzCall(calls, "image disable-protection 501") < hzCall(calls, "image delete 501"));

  assert.deepEqual(env.cf().records.map((r) => r.name), ["www.bunker707.com.br"], "so os nomes dos papeis guardados somem");
  const closed = state.firewalls.find((f) => f.name === "bunker707-membros-fw").rules;
  assert.ok(!closed.some((r) => r.port === "22"), "a porta 22 do A termina fechada");
  assert.match(result.stdout, /total: [\d.]+ GB, cerca de EUR [\d.]+ por mes/);
});

test("snapshot para antes de apagar qualquer coisa: backup que falha, gravador vivo, sem CONFIRMAR ou PAPEIS errado", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const backupFails = setup(productionOn());
  const failed = backupFails.runScript("snapshot.sh", { CONFIRMAR: "apagar", SSH_SHIM_BACKUP_FAIL: "1" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /O backup do bunker707-membros falhou; nada foi apagado/);
  assert.equal(backupFails.hz().servers.length, 3, "os tres continuam");
  assert.ok(backupFails.hz().servers.every((s) => s.status === "running"), "e ligados");
  assert.equal(hzCall(backupFails.calls(), "server create-image"), -1);
  assert.equal(hzCall(backupFails.calls(), "server shutdown"), -1);

  const live = productionOn();
  live.servers.push({ ...serverFixture("bunker707-jibri-sessao-1", "jibri", 9), labels: { app: "bunker707", papel: "jibri", sessao: "sessao-1" } });
  const withRecorder = setup(live);
  const blocked = withRecorder.runScript("snapshot.sh", { CONFIRMAR: "apagar" });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Gravador vivo \(bunker707-jibri-sessao-1\)/);
  assert.equal(hzCall(withRecorder.calls(), "server shutdown"), -1, "nada desligado com a live no ar");
  assert.ok(!withRecorder.calls().some((c) => c.tool === "ssh"), "nem o backup comeca");

  const onlyMembros = withRecorder.runScript("snapshot.sh", { CONFIRMAR: "apagar", PAPEIS: "membros" });
  assert.equal(onlyMembros.status, 0, onlyMembros.stderr);
  assert.deepEqual(withRecorder.hz().servers.map((s) => s.name).sort(), ["bunker707-jibri-sessao-1", "bunker707-marketing", "bunker707-meet"], "PAPEIS=membros guarda so o A");
  assert.deepEqual(withRecorder.cf().records.map((r) => r.name).sort(), ["marketing.bunker707.com.br", "meet.bunker707.com.br", "www.bunker707.com.br"]);

  const noConfirm = setup(productionOn());
  const refused = noConfirm.runScript("snapshot.sh");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /CONFIRMAR=apagar/);
  assert.deepEqual(noConfirm.calls(), [], "sem confirmacao nada e chamado");
  const wrongRole = noConfirm.runScript("snapshot.sh", { CONFIRMAR: "apagar", PAPEIS: "membros banco" });
  assert.equal(wrongRole.status, 1);
  assert.match(wrongRole.stderr, /PAPEIS: 'banco' nao e um papel desta producao/);
  assert.deepEqual(noConfirm.calls(), []);
});

test("snapshot que nao fica pronto: o servidor nao e apagado e volta a ligar", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const env = setup({ servers: [serverFixture("bunker707-meet", "meet", 3)], imageStatus: "creating", records: [record("meet.bunker707.com.br", "A", "192.0.2.3", false)] });
  const result = env.runScript("snapshot.sh", { CONFIRMAR: "apagar", SNAPSHOT_WAIT_TRIES: "3" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Snapshot \d+ nao ficou disponivel; o bunker707-meet NAO foi apagado e foi ligado de novo/);
  const calls = env.calls();
  assert.deepEqual(env.hz().servers.map((s) => [s.name, s.status]), [["bunker707-meet", "running"]]);
  assert.ok(hzCall(calls, "server shutdown bunker707-meet") < hzCall(calls, "server poweron bunker707-meet"));
  assert.equal(hzCall(calls, "server delete"), -1);
  assert.deepEqual(env.cf().records.map((r) => r.name), ["meet.bunker707.com.br"], "o DNS fica");
});

test("restaurar volta no tipo e no local do snapshot, refaz o DNS do papel, o IP do JVB e roda o smoke; avisa quando a main andou", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const images = [
    oldImage(601, "membros", "2026-11-01T10:00:00.000Z"),
    oldImage(602, "membros", "2026-11-03T10:00:00.000Z"),
    oldImage(603, "marketing", "2026-11-03T10:01:00.000Z"),
    oldImage(604, "meet", "2026-11-03T10:02:00.000Z")
  ];
  const env = setup({ images, unavailable: ["cx23@fsn1"] });
  const result = env.runScript("restaurar.sh", { SSH_SHIM_COMMIT: "0000000000000000000000000000000000000000" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = env.calls();
  const servers = env.hz().servers;

  assert.deepEqual(servers.map((s) => [s.name, s.server_type.name, s.location.name, s.image]), [
    ["bunker707-membros", "cx23", "nbg1", 602],
    ["bunker707-marketing", "cx23", "nbg1", 603],
    ["bunker707-meet", "cx23", "nbg1", 604]
  ], "o snapshot mais novo de cada papel, no cx23 de origem; sem estoque em fsn1, vai para o proximo local");
  assert.ok(hzCalls(calls, "server create").every((c) => c.args.includes("cx23")), "nenhuma tentativa em outro tipo");
  assert.match(result.stdout, /preco: EUR 6\.4900\/mes/);

  const ip = Object.fromEntries(servers.map((s) => [s.name, s.public_net.ipv4.ip]));
  const dns = Object.fromEntries(env.cf().records.filter((r) => r.type === "A").map((r) => [r.name, [r.content, r.proxied]]));
  assert.deepEqual(dns, {
    "membros.bunker707.com.br": [ip["bunker707-membros"], true],
    "api.bunker707.com.br": [ip["bunker707-membros"], true],
    "studio.bunker707.com.br": [ip["bunker707-membros"], true],
    "marketing.bunker707.com.br": [ip["bunker707-marketing"], true],
    "meet.bunker707.com.br": [ip["bunker707-meet"], false]
  }, "o Jitsi fica sem proxy (WebRTC nao passa pela Cloudflare)");
  assert.deepEqual(env.cf().settings, { ssl: "strict", always_use_https: "off" });

  const onMeet = calls.filter((c) => c.tool === "ssh" && c.target === `deploy@${ip["bunker707-meet"]}`).map((c) => c.command);
  const b64 = Buffer.from(ip["bunker707-meet"]).toString("base64");
  const setEnv = onMeet.findIndex((c) => c.includes("'/opt/bunker707/infra/jitsi/.env' 'JVB_ADVERTISE_IPS'") && c.includes(b64));
  const up = onMeet.findIndex((c) => c.includes("infra/jitsi/docker-compose.yml --profile borda up -d") && c.includes("reconnect_focus"));
  const smoke = onMeet.findIndex((c) => c.includes("infra/jitsi/scripts/smoke.sh"));
  assert.ok(setEnv >= 0 && setEnv < up && up < smoke, `no C: o IP novo no .env, o stack de pe e o smoke (${JSON.stringify(onMeet)})`);

  const onMembros = calls.filter((c) => c.tool === "ssh" && c.target === `deploy@${ip["bunker707-membros"]}`).map((c) => c.command);
  assert.ok(onMembros.some((c) => c.includes("docker compose -f infra/compose/docker-compose.yml up -d")));
  assert.ok(onMembros.some((c) => c.includes("bash infra/scripts/smoke.sh")));
  assert.ok(calls.filter((c) => c.tool === "ssh" && c.target === `deploy@${ip["bunker707-marketing"]}`).some((c) => c.command.includes("infra/mautic/scripts/smoke.sh")));
  assert.match(result.stdout, /se a main andou, rode deploy-membros da main/);
  assert.equal(env.hz().images.length, 4, "os snapshots ficam depois da volta (continuam sendo a copia)");
  assert.ok(env.hz().firewalls.every((f) => !f.rules.some((r) => r.port === "22")), "a 22 termina fechada nos tres");
});

test("restaurar nunca sobe num tipo mais caro sozinho; PAPEIS=meet traz so o Jitsi; tipo com disco menor que o snapshot e recusado", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const images = [oldImage(701, "membros", "2026-11-03T10:00:00.000Z"), oldImage(702, "meet", "2026-11-03T10:01:00.000Z")];
  const noStock = setup({ images, unavailable: ["cx23@fsn1", "cx23@nbg1", "cx23@hel1"] });
  const refused = noStock.runScript("restaurar.sh");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Sem estoque de cx23 em fsn1 nbg1 hel1\. Nada mais caro foi criado/);
  assert.deepEqual(noStock.hz().servers, []);
  assert.ok(hzCalls(noStock.calls(), "server create").every((c) => c.args.includes("cx23")), "nem tentou o cx33 ou o cpx32");

  const twoRoles = setup({ images: [...images, oldImage(703, "marketing", "2026-11-03T10:02:00.000Z")] });
  // Pelo run.sh, como o workflow chama: as opcoes vem separadas por espaco, entao varios papeis vao por virgula.
  const viaRun = spawnSync("bash", [join(cloudDir, "run.sh"), "restaurar"], { encoding: "utf8", env: { ...process.env, ...twoRoles.envFor({ OPCOES: "PAPEIS=marketing,membros" }) } });
  assert.equal(viaRun.status, 0, viaRun.stdout + viaRun.stderr);
  assert.deepEqual(twoRoles.hz().servers.map((s) => s.name), ["bunker707-membros", "bunker707-marketing"], "dois papeis por virgula nas opcoes do workflow, na ordem de sempre; o meet fica guardado");

  const meetOnly = setup({ images });
  const meet = meetOnly.runScript("restaurar.sh", { PAPEIS: "meet" });
  assert.equal(meet.status, 0, meet.stdout + meet.stderr);
  assert.deepEqual(meetOnly.hz().servers.map((s) => s.name), ["bunker707-meet"]);
  assert.deepEqual(meetOnly.cf().records.map((r) => r.name), ["meet.bunker707.com.br", "meet.bunker707.com.br"], "A e AAAA so do meet");
  assert.deepEqual(meetOnly.cf().settings, {}, "sem mexer no TLS da zona quando so o C volta");

  const bigDisk = setup({ images: [oldImage(801, "membros", "2026-11-03T10:00:00.000Z", { disk_size: 80, labels: { app: "bunker707", papel: "membros", tipo: "cx33", local: "fsn1" } })] });
  const forcedSmall = bigDisk.runScript("restaurar.sh", { MEMBROS_TYPE: "cx23", PAPEIS: "membros" });
  assert.equal(forcedSmall.status, 1);
  assert.match(forcedSmall.stderr, /O cx23 tem disco de 40 GB e o snapshot 801 precisa de 80 GB/);
  assert.deepEqual(bigDisk.hz().servers, []);

  const existing = setup({ images, servers: [serverFixture("bunker707-membros", "membros", 1)] });
  const skip = existing.runScript("restaurar.sh", { PAPEIS: "membros" });
  assert.equal(skip.status, 0, skip.stderr);
  assert.match(skip.stdout, /ja existe; nada a restaurar/);
  assert.equal(hzCall(existing.calls(), "server create"), -1);
});

test("com a producao guardada, deploy-membros e jibri-up mandam restaurar em vez de provisionar do zero", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const env = setup({ images: [oldImage(901, "membros", "2026-11-03T10:00:00.000Z"), oldImage(902, "meet", "2026-11-03T10:01:00.000Z")] });
  const deploy = env.runScript("deploy.sh", {}, ["membros"]);
  assert.equal(deploy.status, 1);
  assert.match(deploy.stderr, /A producao do membros esta guardada em snapshot: rode a etapa restaurar e depois este deploy de novo/);
  const deployMeet = env.runScript("deploy.sh", {}, ["meet"]);
  assert.match(deployMeet.stderr, /rode a etapa restaurar \(PAPEIS=meet traz so o Jitsi\)/);
  const jibri = env.runScript("jibri.sh", { CONFIRMADO: "sim", SESSAO: "sessao-1", JIBRI_SECRETS: "WEBINAR_RECORDER_WEBHOOK_SECRET=s\nBUNNY_LIBRARY_ID=1\nBUNNY_API_KEY=k" }, ["up"]);
  assert.equal(jibri.status, 1);
  assert.match(jibri.stderr, /esta guardado em snapshot: rode restaurar com PAPEIS=meet antes/);
  assert.ok(!env.calls().some((c) => c.tool === "hcloud" && c.args[1] === "create"), "nada criado");
});
