import assert from "node:assert/strict";
import test, { after } from "node:test";

import { criarInfraDeMentira, faltamBinarios, limparInfraDeMentira, record } from "./fixtures/infra-de-mentira.mjs";

// O provedor netcup + Vultr + Cloudflare R2 (docs/20 §8D; docs/21 §11), escolhido pela variavel PROVEDOR=netcup depois que a
// conta da Hetzner ficou bloqueada em 26/11/2026. Os servidores fixos sao VPS da netcup (os IPs vem das variaveis
// NETCUP_*_IP), o gravador por hora nasce e morre na Vultr pela API, chamada de dentro do servidor C (o unico IP que a
// chave aceita), e o backup vai para o R2. Aqui os scripts de verdade rodam contra a Vultr, a Cloudflare e as maquinas de
// mentira de tests/fixtures/infra-de-mentira.mjs.

after(limparInfraDeMentira);

const skip = faltamBinarios.length ? `faltam ${faltamBinarios.join(", ")}` : false;
const SESSAO = "6e0b699c-f66c-42fc-8b10-ae0706fc2af7";
const GRAVADOR = `bunker707-jibri-${SESSAO}`;
const WEBHOOK = "https://membros.exemplo.com.br/api/webhooks/recorder";
const CHAVE_VULTR = "chave-vultr-de-teste-ABCDEFGHIJKLMNOPQRSTUV";
const IPS = { NETCUP_MEMBROS_IP: "203.0.113.21", NETCUP_MEET_IP: "203.0.113.22", NETCUP_MARKETING_IP: "203.0.113.23" };
const ENV_DO_C = { JIBRI_RECORDER_PASSWORD: "senha-recorder-de-teste", JIBRI_XMPP_PASSWORD: "senha-xmpp-de-teste", JITSI_IMAGE_VERSION: "stable-11248", PUBLIC_URL: "https://meet.exemplo.com.br" };

function envNetcup(extra = {}) {
  return {
    PROVEDOR: "netcup",
    ...IPS,
    VULTR_API_KEY: CHAVE_VULTR,
    VULTR_API_KEY_DE_TESTE: CHAVE_VULTR,
    CONFIRMADO: "sim",
    JIBRI_SECRETS: `WEBINAR_RECORDER_WEBHOOK_SECRET=segredo-do-gravador-com-mais-de-32-caracteres-0001\nBUNNY_LIBRARY_ID=42\nBUNNY_API_KEY=bunny-chave-de-teste\nWEBINAR_RECORDER_WEBHOOK_URL=${WEBHOOK}`,
    SESSAO,
    SHIM_RECORDER_URL: WEBHOOK,
    SSH_SHIM_ENV: JSON.stringify(ENV_DO_C),
    ...extra
  };
}

const avisos = (calls) => calls.filter((c) => c.tool === "curl" && c.url === WEBHOOK && c.method === "POST").map((c) => JSON.parse(c.data).state);
const regras5222 = (calls) => calls.filter((c) => c.tool === "ssh" && c.target === `deploy@${IPS.NETCUP_MEET_IP}` && c.command.includes("XMPP so do Jibri"));

test("netcup: jibri-up cria o gravador na Vultr pelo servidor C, com a chave so pela entrada do SSH, abre a 5222 do C so para ele e avisa ready; nada vai a Hetzner", { skip }, () => {
  const conta = criarInfraDeMentira();
  const result = conta.runScript("jibri.sh", envNetcup(), ["up"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = conta.calls();
  const vultr = conta.vultr();

  assert.equal(calls.filter((c) => c.tool === "hcloud").length, 0, "nenhuma chamada a Hetzner");
  const criacao = vultr.chamadas.find((c) => c.method === "POST");
  assert.equal(criacao.body.label, GRAVADOR);
  assert.equal(criacao.body.plan, "vhp-8c-16gb-amd");
  assert.equal(criacao.body.region, "ewr");
  assert.equal(criacao.body.os_id, 2284, "Ubuntu 24.04");
  assert.match(Buffer.from(criacao.body.user_data, "base64").toString(), /^#cloud-config/, "o cloud-init do gravador vai como user_data");
  assert.doesNotMatch(Buffer.from(criacao.body.user_data, "base64").toString(), /senha-|segredo-|bunny-chave/, "nenhum segredo no user_data");
  assert.ok(vultr.chamadas.every((c) => c.alvo === `deploy@${IPS.NETCUP_MEET_IP}`), "toda chamada a Vultr sai do servidor C");
  assert.ok(vultr.chamadas.every((c) => c.chavePelaEntrada && !c.chaveNoComando), "a chave so pela entrada do SSH, nunca no comando");
  assert.ok(!calls.some((c) => c.tool === "ssh" && c.command.includes(CHAVE_VULTR)), "a chave nunca aparece num comando remoto");
  assert.ok(!(result.stdout + result.stderr).includes(CHAVE_VULTR), "a chave nunca vai para a saida");

  const ipGravador = vultr.instances.find((i) => i.label === GRAVADOR).main_ip;
  assert.ok(calls.some((c) => c.tool === "ssh" && c.target === `deploy@${ipGravador}` && c.command.includes("docker compose up -d")), "o gravador sobe na maquina da Vultr");
  const ufw = regras5222(calls);
  assert.ok(ufw.some((c) => c.command.includes(ipGravador)), "a 5222 do C aberta no ufw para o IP do gravador");
  assert.deepEqual(avisos(calls), ["ready"]);
  assert.match(result.stdout, /USD 0\.1320\/h/, "o custo na moeda da Vultr");
});

test("netcup: sem estoque em plano e local nenhum, jibri-up avisa unavailable e nao deixa maquina", { skip }, () => {
  const tudo = ["vhp-8c-16gb-amd", "vhp-8c-16gb-intel", "vc2-6c-16gb"].flatMap((p) => ["ewr", "atl"].map((r) => `${p}@${r}`));
  const conta = criarInfraDeMentira({ vultr: { indisponivel: tudo } });
  const result = conta.runScript("jibri.sh", envNetcup(), ["up"]);
  assert.notEqual(result.status, 0);
  assert.equal(conta.vultr().instances.length, 0);
  assert.equal(conta.vultr().chamadas.filter((c) => c.method === "POST").length, tudo.length, "tentou cada plano em cada local");
  assert.deepEqual(avisos(conta.calls()), ["unavailable"]);
});

test("netcup: o gravador que nao fica pronto e apagado na Vultr e o app recebe unavailable", { skip }, () => {
  const conta = criarInfraDeMentira();
  const result = conta.runScript("jibri.sh", envNetcup({ SSH_SHIM_UNHEALTHY: "1" }), ["up"]);
  assert.notEqual(result.status, 0);
  assert.ok(conta.vultr().chamadas.some((c) => c.method === "DELETE"), "a maquina criada nesta execucao foi apagada");
  assert.equal(conta.vultr().instances.length, 0);
  assert.deepEqual(avisos(conta.calls()), ["unavailable"]);
});

test("netcup: jibri-down apaga o gravador com a gravacao na Bunny, fecha a 5222 dele e avisa gone", { skip }, () => {
  const inst = { id: "00000099-0000-4000-8000-000000000000", label: GRAVADOR, plan: "vhp-8c-16gb-amd", region: "ewr", main_ip: "198.51.100.99", status: "active", date_created: "2026-11-27T10:00:00+00:00" };
  const conta = criarInfraDeMentira({ vultr: { instances: [inst] } });
  const result = conta.runScript("jibri.sh", envNetcup({ SHIM_RECORDER_STATUS: "uploaded" }), ["down"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(conta.vultr().instances.length, 0);
  assert.ok(conta.vultr().chamadas.some((c) => c.method === "DELETE" && c.url === `/instances/${inst.id}`));
  const ufw = regras5222(conta.calls());
  assert.ok(ufw.length > 0 && !ufw.at(-1).command.includes(inst.main_ip), "a regra da 5222 refeita sem o IP do gravador apagado");
  assert.deepEqual(avisos(conta.calls()), ["gone"]);
});

test("netcup: preparar exige CONFIRMADO=sim e so existe com PROVEDOR=netcup", { skip }, () => {
  const conta = criarInfraDeMentira();
  const semOk = conta.runScript("provision.sh", envNetcup({ CONFIRMADO: "" }), ["preparar"]);
  assert.notEqual(semOk.status, 0);
  assert.match(semOk.stderr, /CONFIRMADO=sim/);
  const naHetzner = conta.runScript("provision.sh", { CONFIRMADO: "sim" }, ["preparar"]);
  assert.notEqual(naHetzner.status, 0);
  assert.match(naHetzner.stderr, /PROVEDOR=netcup/);
  const provisionNaNetcup = conta.runScript("provision.sh", envNetcup(), []);
  assert.notEqual(provisionNaNetcup.status, 0, "com netcup, provision nao cria servidor");
  assert.equal(conta.calls().filter((c) => c.tool === "hcloud").length, 0);
});

test("netcup: preparar faz o bootstrap como root em cada servidor, fecha 80/443 do membros e do Mautic para fora da Cloudflare e aponta o DNS para os IPs novos, sem o IPv6 antigo", { skip }, () => {
  const conta = criarInfraDeMentira({
    records: [record("membros.bunker707.com.br", "A", "192.0.2.1", true), record("membros.bunker707.com.br", "AAAA", "2001:db8:a1::1", true), record("meet.bunker707.com.br", "AAAA", "2001:db8:a3::1", false)]
  });
  const result = conta.runScript("provision.sh", envNetcup(), ["preparar"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = conta.calls();
  assert.equal(calls.filter((c) => c.tool === "hcloud").length, 0);
  for (const ip of Object.values(IPS)) {
    assert.ok(calls.some((c) => c.tool === "ssh" && c.target === `root@${ip}` && c.command.includes("bash /root/bootstrap.sh")), `bootstrap em ${ip}`);
  }
  const soCloudflare = (ip) => calls.some((c) => c.tool === "ssh" && c.target === `root@${ip}` && c.command.includes("comment 'Cloudflare'"));
  assert.ok(soCloudflare(IPS.NETCUP_MEMBROS_IP) && soCloudflare(IPS.NETCUP_MARKETING_IP), "membros e Mautic so pela Cloudflare");
  assert.ok(!soCloudflare(IPS.NETCUP_MEET_IP), "a sala (DNS puro, WebRTC) fica aberta");

  const dns = conta.cf().records;
  const a = (nome) => dns.filter((r) => r.name === `${nome}.bunker707.com.br` && r.type === "A").map((r) => [r.content, r.proxied]);
  assert.deepEqual(a("membros"), [[IPS.NETCUP_MEMBROS_IP, true]]);
  assert.deepEqual(a("api"), [[IPS.NETCUP_MEMBROS_IP, true]]);
  assert.deepEqual(a("meet"), [[IPS.NETCUP_MEET_IP, false]]);
  assert.deepEqual(a("marketing"), [[IPS.NETCUP_MARKETING_IP, true]]);
  assert.equal(dns.filter((r) => r.type === "AAAA").length, 0, "o IPv6 da Hetzner sai do DNS");
});

test("netcup: sem o IP do servidor a etapa para e diz qual variavel gravar", { skip }, () => {
  const conta = criarInfraDeMentira();
  const result = conta.runScript("jibri.sh", envNetcup({ NETCUP_MEET_IP: "" }), ["up"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /NETCUP_MEET_IP|provision-meet|nao existe/);
  const invalido = conta.runScript("status.sh", envNetcup({ NETCUP_MEMBROS_IP: "1.2.3.4; rm -rf /" }), []);
  assert.notEqual(invalido.status, 0);
  assert.match(invalido.stderr, /nao e um IPv4/);
});
