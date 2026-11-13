import assert from "node:assert/strict";
import test, { after } from "node:test";

import { criarInfraDeMentira, faltamBinarios, hzCall, limparInfraDeMentira, serverFixture } from "./fixtures/infra-de-mentira.mjs";

// O gravador por hora que falha no preparo (infra/cloud/jibri.sh; docs/20 §8B.5, docs/30 §6.7). Em 03/11/2026 um
// jibri-up parou no passo 5 com "permission denied" no Docker e a maquina (cpx42, EUR 0,13/h) ficou ligada 18 h: a
// conexao SSH reaproveitada (ControlMaster) foi aberta antes do cloud-init por o deploy no grupo docker, e nada apagava
// um gravador que nao chegou a ficar pronto. Aqui o jibri.sh de verdade roda contra a Hetzner, o app e as maquinas de
// mentira de tests/fixtures/infra-de-mentira.mjs.

after(limparInfraDeMentira);

const skip = faltamBinarios.length ? `faltam ${faltamBinarios.join(", ")}` : false;
const SESSAO = "6e0b699c-f66c-42fc-8b10-ae0706fc2af7";
const GRAVADOR = `bunker707-jibri-${SESSAO}`;
const WEBHOOK = "https://membros.exemplo.com.br/api/webhooks/recorder";
const ENV_DO_C = { JIBRI_RECORDER_PASSWORD: "senha-recorder-de-teste", JIBRI_XMPP_PASSWORD: "senha-xmpp-de-teste", JITSI_IMAGE_VERSION: "stable-11248", PUBLIC_URL: "https://meet.exemplo.com.br" };

function contaComOC(extra = {}) {
  return criarInfraDeMentira({ servers: [serverFixture("bunker707-meet", "meet", 3)], ...extra });
}

function envDoGravador(extra = {}) {
  return {
    CONFIRMADO: "sim",
    JIBRI_SECRETS: `WEBINAR_RECORDER_WEBHOOK_SECRET=segredo-do-gravador-com-mais-de-32-caracteres-0001\nBUNNY_LIBRARY_ID=42\nBUNNY_API_KEY=bunny-chave-de-teste\nWEBINAR_RECORDER_WEBHOOK_URL=${WEBHOOK}`,
    SESSAO,
    SHIM_RECORDER_URL: WEBHOOK,
    SSH_SHIM_ENV: JSON.stringify(ENV_DO_C),
    ...extra
  };
}

const avisos = (calls) => calls.filter((c) => c.tool === "curl" && c.url === WEBHOOK && c.method === "POST").map((c) => JSON.parse(c.data).state);
const sshIndex = (calls, predicate) => calls.findIndex((c) => c.tool === "ssh" && predicate(c));
const regras5222 = (state) => (state.firewalls.find((f) => f.name === "bunker707-meet-fw")?.rules ?? []).filter((r) => r.port === "5222");

test("jibri-up troca a conexao SSH depois do cloud-init (o grupo docker passa a valer), confere o Docker e so entao sobe o gravador; pronto, avisa ready e nada e apagado", { skip }, () => {
  const conta = contaComOC();
  const result = conta.runScript("jibri.sh", envDoGravador(), ["up"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = conta.calls();
  const ip = conta.hz().servers.find((s) => s.name === GRAVADOR).public_net.ipv4.ip;
  const alvo = `deploy@${ip}`;

  const cloudInit = sshIndex(calls, (c) => c.target === alvo && c.command.includes(".cloud-init-done"));
  const troca = sshIndex(calls, (c) => c.target === alvo && c.control === "exit");
  const docker = sshIndex(calls, (c) => c.target === alvo && c.command.includes("docker info"));
  const sobe = sshIndex(calls, (c) => c.target === alvo && c.command.includes("docker compose up -d"));
  assert.ok(cloudInit >= 0 && cloudInit < troca && troca < docker && docker < sobe, `depois do cloud-init: fecha a conexao mestra, confere o Docker e sobe (${[cloudInit, troca, docker, sobe]})`);

  assert.deepEqual(avisos(calls), ["ready"]);
  assert.ok(conta.hz().servers.some((s) => s.name === GRAVADOR), "o gravador pronto fica ligado");
  assert.equal(regras5222(conta.hz()).length, 1, "a 5222 do C aberta para o gravador vivo");
});

// 13/11/2026: dois jibri-up seguidos criaram a maquina, o Jibri ficou HEALTHY em 3 s (o log dele mostrava), e a espera
// desistiu em 5 min e apagou tudo. O Jibri so escuta a API no 127.0.0.1 do proprio container, e a espera perguntava pelo
// host. A maquina de mentira responde como a de verdade: so quem pergunta por dentro do container recebe a saude.
test("jibri-up pergunta a saude por dentro do container (docker compose exec), na pasta do gravador; pelo host a porta nunca responde", { skip }, () => {
  const conta = contaComOC();
  const result = conta.runScript("jibri.sh", envDoGravador(), ["up"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = conta.calls();
  const alvo = `deploy@${conta.hz().servers.find((s) => s.name === GRAVADOR).public_net.ipv4.ip}`;
  const perguntas = calls.filter((c) => c.tool === "ssh" && c.target === alvo && c.command.includes("/jibri/api/v1.0/health"));
  assert.equal(perguntas.length, 1, "saudavel na primeira pergunta: uma so, sem esperar os 5 min");
  assert.match(perguntas[0].command, /^cd '\/opt\/jibri' && docker compose exec -T jibri curl -fsS --max-time 5 'http:\/\/127\.0\.0\.1:2222\/jibri\/api\/v1\.0\/health'/);
  assert.match(result.stdout, /saude: .*HEALTHY/);
  assert.deepEqual(avisos(calls), ["ready"]);
});

test("jibri-up sem saude: a falha mostra a ultima resposta da pergunta e o estado do container antes do log do Jibri", { skip }, () => {
  const conta = contaComOC();
  const result = conta.runScript("jibri.sh", envDoGravador({ SSH_SHIM_UNHEALTHY: "1" }), ["up"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ultima resposta da saude: \(vazia\)/);
  const calls = conta.calls();
  const estado = sshIndex(calls, (c) => c.command.includes("docker compose ps --format"));
  const registro = sshIndex(calls, (c) => c.command.includes("docker compose logs --no-color --tail 60 jibri"));
  assert.ok(estado >= 0 && estado < registro, `o estado do container sai antes do log (${[estado, registro]})`);
});

test("jibri-up que falha depois de criar a maquina (Jibri sem saude, Docker sem resposta): apaga a maquina e o firewall dela, tira a 5222 do C e avisa unavailable", { skip }, () => {
  for (const [motivo, falha] of [["sem saude em 5 min", { SSH_SHIM_UNHEALTHY: "1" }], ["Docker sem resposta para o deploy", { SSH_SHIM_NO_DOCKER: "1" }], ["docker compose up recusado", { SSH_SHIM_COMPOSE_FAIL: "1" }]]) {
    const conta = contaComOC();
    const result = conta.runScript("jibri.sh", envDoGravador(falha), ["up"]);
    assert.equal(result.status, 1, `${motivo}: a etapa falha (${result.stdout}${result.stderr})`);
    const state = conta.hz();
    assert.ok(!state.servers.some((s) => s.name === GRAVADOR), `${motivo}: a maquina criada nesta execucao e apagada`);
    assert.ok(!state.firewalls.some((f) => f.name === `${GRAVADOR}-fw`), `${motivo}: o firewall dela tambem`);
    assert.equal(regras5222(state).length, 0, `${motivo}: a 5222 do C volta a ficar fechada`);
    assert.deepEqual(avisos(conta.calls()), ["unavailable"], `${motivo}: o app recebe unavailable (o console mostra a reserva na hora)`);
    assert.match(result.stdout + result.stderr, /apagando a maquina/);
    assert.ok(state.servers.some((s) => s.name === "bunker707-meet"), "o servidor C nunca e tocado");
  }
});

test("jibri-up que falha nao apaga um gravador que ja existia antes da execucao, e MANTER_SE_FALHAR=1 deixa a maquina nova para investigar", { skip }, () => {
  const existente = serverFixture(GRAVADOR, "jibri", 9, { labels: { app: "bunker707", papel: "jibri", sessao: SESSAO }, server_type: { name: "cpx42" } });
  const conta = contaComOC({ servers: [serverFixture("bunker707-meet", "meet", 3), existente] });
  const rerun = conta.runScript("jibri.sh", envDoGravador({ SSH_SHIM_UNHEALTHY: "1" }), ["up"]);
  assert.equal(rerun.status, 1);
  assert.ok(conta.hz().servers.some((s) => s.name === GRAVADOR), "pode estar gravando uma live: nunca apagado por esta execucao");
  assert.equal(hzCall(conta.calls(), `server delete ${GRAVADOR}`), -1);
  assert.deepEqual(avisos(conta.calls()), [], "nem avisa unavailable: a maquina continua la");

  const investigar = contaComOC();
  const mantida = investigar.runScript("jibri.sh", envDoGravador({ MANTER_SE_FALHAR: "1", SSH_SHIM_UNHEALTHY: "1" }), ["up"]);
  assert.equal(mantida.status, 1);
  assert.ok(investigar.hz().servers.some((s) => s.name === GRAVADOR), "MANTER_SE_FALHAR=1: a maquina fica");
  assert.match(mantida.stdout + mantida.stderr, /MANTER_SE_FALHAR=1/);
  assert.deepEqual(avisos(investigar.calls()), ["unavailable"], "o app sabe que nao ha gravador pronto");
});

test("jibri-down: com o app em preparing e nenhum MP4 na maquina, apaga; com SO_SE_PREPARANDO=sim e o gravador que ficou pronto, nao apaga; MP4 sem envio segura sempre", { skip }, () => {
  const gravador = () => serverFixture(GRAVADOR, "jibri", 9, { labels: { app: "bunker707", papel: "jibri", sessao: SESSAO }, server_type: { name: "cpx42" } });
  const firewalls = [{ name: "bunker707-meet-fw", applied_to: [], rules: [] }, { name: `${GRAVADOR}-fw`, applied_to: [], rules: [] }];

  const preparando = criarInfraDeMentira({ firewalls, servers: [serverFixture("bunker707-meet", "meet", 3), gravador()] });
  const apagado = preparando.runScript("jibri.sh", envDoGravador({ SHIM_RECORDER_STATUS: "preparing" }), ["down"]);
  assert.equal(apagado.status, 0, apagado.stdout + apagado.stderr);
  assert.ok(!preparando.hz().servers.some((s) => s.name === GRAVADOR), "preparing sem MP4: nao havia gravacao, apaga");
  assert.deepEqual(avisos(preparando.calls()), ["gone"]);

  const pronto = criarInfraDeMentira({ firewalls, servers: [serverFixture("bunker707-meet", "meet", 3), gravador()] });
  const poupado = pronto.runScript("jibri.sh", envDoGravador({ SHIM_RECORDER_STATUS: "ready", SO_SE_PREPARANDO: "sim" }), ["down"]);
  assert.equal(poupado.status, 0, "o job do app nao falha: o gravador so saiu do preparo");
  assert.ok(pronto.hz().servers.some((s) => s.name === GRAVADOR), "SO_SE_PREPARANDO: o gravador que ficou pronto fica");
  assert.match(poupado.stdout, /saiu do preparo/);
  assert.equal(hzCall(pronto.calls(), `server delete ${GRAVADOR}`), -1);

  const comArquivo = criarInfraDeMentira({ firewalls, servers: [serverFixture("bunker707-meet", "meet", 3), gravador()] });
  const seguro = comArquivo.runScript("jibri.sh", envDoGravador({ SHIM_RECORDER_STATUS: "preparing", SO_SE_PREPARANDO: "sim", SSH_SHIM_PENDING_MP4: "/opt/jibri/volumes/storage/jibri/recordings/x/sala_2026-11-03-00-52-00.mp4" }), ["down"]);
  assert.equal(seguro.status, 1);
  assert.ok(comArquivo.hz().servers.some((s) => s.name === GRAVADOR), "um MP4 sem envio nunca some");
  assert.match(seguro.stderr, /Nao apago/);
});
