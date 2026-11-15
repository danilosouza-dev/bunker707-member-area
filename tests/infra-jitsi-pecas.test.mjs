import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, webcrypto } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import vm from "node:vm";

// As pecas da Live gravada em teste (docs/30 A62; docs/20 §8B.7; docs/18 §2.2). O arquivo do gravador
// (infra/jitsi/web/bunker707-pecas.js) grava a camera e a tela de quem apresenta em pecas separadas e manda os pedacos,
// assinados com a senha do usuario do gravador, ao receptor do servidor C (infra/jitsi/pecas/receptor.py), pelo mesmo
// endereco da sala. Aqui: o receptor de verdade (Python), o arquivo do gravador rodando com dubles, e um pedaco que o
// arquivo assinou chegando ao receptor; a CPU que o gravador anota e o resumo que o finalize.sh manda; e a ligacao na
// instancia (o carregador, o compose, o Caddy, a conferencia do deploy).

const root = new URL("../", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const SALA = "w-00000000-0000-4000-8000-000000000001-abcdefghijkmnpqr";
const WEBINAR = "00000000-0000-4000-8000-000000000001";
const SENHA = "senha-do-gravador-de-teste";
const python = spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;

let dados;
let porta;
let receptor;
const url = (path) => `http://127.0.0.1:${porta}${path}`;
const assinatura = (sala, arquivo, seq, ts, corpo, segredo = SENHA) =>
  createHmac("sha256", segredo).update(`${sala}\n${arquivo}\n${seq}\n${ts}\n${createHash("sha256").update(corpo).digest("hex")}`).digest("hex");
async function mandar(arquivo, seq, corpo, opcoes = {}) {
  const ts = opcoes.ts ?? Date.now();
  const sala = opcoes.sala ?? SALA;
  const headers = { "X-Pecas-Assinatura": opcoes.assinatura ?? assinatura(sala, arquivo, seq, ts, corpo), "X-Pecas-Seq": String(seq), "X-Pecas-Ts": String(ts) };
  return fetch(url(`/pecas/${sala}/${arquivo}`), { body: corpo, headers, method: "POST" });
}

before(async () => {
  if (!python) return;
  dados = mkdtempSync(join(tmpdir(), "pecas-"));
  writeFileSync(join(dados, "ativas.txt"), `# o webinario do teste\n${WEBINAR}\nnao-e-id\n`);
  porta = 18000 + Math.floor(Math.random() * 2000);
  receptor = spawn("python3", [join(root, "infra/jitsi/pecas/receptor.py")], {
    env: { ...process.env, PECAS_DIR: dados, PECAS_MAX_PEDACO_MB: "1", PECAS_MIN_LIVRE_GB: "0", PECAS_PORTA: String(porta), PECAS_SEGREDO: SENHA },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("o receptor nao subiu")), 10_000);
    receptor.stdout.on("data", (chunk) => { if (String(chunk).includes("escutando")) { clearTimeout(timer); resolve(); } });
  });
});
after(() => {
  receptor?.kill();
  if (dados) rmSync(dados, { force: true, recursive: true });
});

test("o receptor: so as salas dos webinarios da lista, na ordem, assinadas com a senha do gravador", { skip: !python && "sem python3" }, async () => {
  assert.equal((await fetch(url(`/pecas/ativo?sala=${SALA}`))).status, 204, "o webinario da lista");
  assert.equal((await fetch(url(`/pecas/ativo?sala=${SALA.toUpperCase()}`))).status, 204, "a sala sem diferenca de caixa");
  assert.equal((await fetch(url("/pecas/ativo?sala=w-11111111-0000-4000-8000-000000000001-abcdefghijkmnpqr"))).status, 404, "fora da lista");
  assert.equal((await fetch(url("/pecas/ativo?sala=../../etc"))).status, 404);
  assert.equal((await fetch(url("/qualquer"))).status, 404);

  assert.equal((await mandar("camera.webm", 0, Buffer.from("AAA"))).status, 204);
  assert.equal((await mandar("camera.webm", 1, Buffer.from("BBB"))).status, 204);
  assert.equal((await mandar("camera.webm", 1, Buffer.from("BBB"))).status, 200, "o mesmo pedaco de novo (a tentativa depois de uma queda): nada se repete");
  assert.equal((await mandar("camera.webm", 3, Buffer.from("DDD"))).status, 409, "um buraco na ordem");
  assert.equal(readFileSync(join(dados, SALA, "camera.webm"), "utf8"), "AAABBB", "os pedacos, na ordem, uma vez cada");
  assert.equal((await mandar("tela.webm", 0, Buffer.from("T"))).status, 204, "cada arquivo tem a propria ordem");

  assert.equal((await mandar("camera.webm", 2, Buffer.from("CCC"), { assinatura: "0".repeat(64) })).status, 401, "assinatura errada");
  const outra = Date.now();
  assert.equal((await mandar("camera.webm", 2, Buffer.from("CCC"), { assinatura: assinatura(SALA, "camera.webm", 2, outra, Buffer.from("CCC"), "outra-senha"), ts: outra })).status, 401, "a senha de outro");
  const velho = Date.now() - 11 * 60 * 1000;
  assert.equal((await mandar("camera.webm", 2, Buffer.from("CCC"), { ts: velho })).status, 401, "um pedido velho (mais de 10 min) nao vale de novo");
  assert.equal((await mandar("camera.webm", 2, Buffer.from("CCC"), { sala: "w-11111111-0000-4000-8000-000000000001-abcdefghijkmnpqr" })).status, 403, "assinado, mas a sala esta fora da lista");
  assert.equal((await mandar("senha.txt", 0, Buffer.from("x"))).status, 404, "so os quatro arquivos");
  assert.equal((await mandar("camera.webm", 2, Buffer.alloc(1024 * 1024 + 1))).status, 413, "pedaco grande demais");
  assert.equal((await mandar("camera.webm", 2, Buffer.from("CCC"))).status, 204, "a ordem continua de onde parou");
  assert.equal(readFileSync(join(dados, SALA, "camera.webm"), "utf8"), "AAABBBCCC");
  assert.equal(readFileSync(join(dados, SALA, "camera.webm.seq"), "utf8"), "3", "a ordem fica no disco: um receptor reiniciado continua dela");
});

test("o receptor nao aceita nada sem a senha configurada", { skip: !python && "sem python3" }, async () => {
  const pasta = mkdtempSync(join(tmpdir(), "pecas-sem-"));
  writeFileSync(join(pasta, "ativas.txt"), `${WEBINAR}\n`);
  const p = 20000 + Math.floor(Math.random() * 2000);
  const child = spawn("python3", [join(root, "infra/jitsi/pecas/receptor.py")], { env: { ...process.env, PECAS_DIR: pasta, PECAS_PORTA: String(p), PECAS_SEGREDO: "" }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve) => child.stdout.on("data", (chunk) => String(chunk).includes("escutando") && resolve()));
    const ts = Date.now();
    const r = await fetch(`http://127.0.0.1:${p}/pecas/${SALA}/camera.webm`, { body: "x", headers: { "X-Pecas-Assinatura": assinatura(SALA, "camera.webm", 0, ts, Buffer.from("x"), ""), "X-Pecas-Seq": "0", "X-Pecas-Ts": String(ts) }, method: "POST" });
    assert.equal(r.status, 503);
    assert.equal(existsSync(join(pasta, SALA)), false);
  } finally {
    child.kill();
    rmSync(pasta, { force: true, recursive: true });
  }
});

/** O arquivo do gravador num navegador de mentira: a sala, o localStorage do Jibri, o fetch e os gravadores sao dubles. */
function gravador({ ativo = true, senha = SENHA } = {}) {
  const pedidos = [];
  const gravadores = [];
  const qualidade = [];
  const faixa = (type, videoType, source) => ({ getSourceName: () => source, getTrack: () => ({ id: source }), getType: () => type, getVideoType: () => videoType, isMuted: () => false });
  const apresentador = { getRole: () => "moderator", getTracks: () => [faixa("video", "camera", "p1-v0"), faixa("video", "desktop", "p1-v1"), faixa("audio", null, "p1-a0")], isHidden: () => false };
  const room = { getParticipants: () => [apresentador], isJoined: () => true, on() {}, setReceiverConstraints: (c) => qualidade.push(c) };
  const elemento = () => ({ play: () => Promise.resolve(), requestVideoFrameCallback() {}, style: {}, videoHeight: 0, videoWidth: 0 });
  const window = {
    __bunker707PecasBaseMs: 0,
    addEventListener() {},
    APP: { conference: { _room: room, roomName: SALA } },
    JitsiMeetJS: { events: { conference: { TRACK_ADDED: "a", TRACK_MUTE_CHANGED: "c", TRACK_REMOVED: "b", USER_JOINED: "d", USER_LEFT: "e", USER_ROLE_CHANGED: "f" } } },
    localStorage: { getItem: (k) => (k === "xmpp_password_override" ? senha : null) },
    location: { pathname: `/${SALA}` }
  };
  const context = {
    AudioContext: class { createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{}] } }; } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } resume() { return Promise.resolve(); } },
    console,
    crypto: webcrypto,
    document: {
      body: { appendChild() {} },
      createElement: (tag) => (tag === "canvas" ? { captureStream: () => ({ getVideoTracks: () => [{}] }), getContext: () => ({ drawImage() {}, fillRect() {} }) } : elemento()),
      documentElement: {}
    },
    fetch: async (u, init = {}) => {
      if (String(u).startsWith("/pecas/ativo")) return { status: ativo ? 204 : 404 };
      pedidos.push({ body: Buffer.from(init.body), headers: init.headers, url: String(u) });
      return { status: 204 };
    },
    MediaRecorder: class { constructor(stream, opts) { this.opts = opts; gravadores.push(this); } start(ms) { this.ms = ms; } stop() {} },
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } },
    performance: { now: () => Date.now() },
    setInterval: () => 0,
    // O prazo maximo de 4 h do arquivo nao segura o processo do teste.
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; },
    TextEncoder,
    Uint8Array,
    window
  };
  window.__proto__ = context;
  vm.runInNewContext(read("infra/jitsi/web/bunker707-pecas.js"), context);
  return { gravadores, pedidos, qualidade, room, window };
}
const esperarAte = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };

test("o arquivo do gravador: fora da lista, sem a senha do Jibri ou fora do gravador, nao grava nada", async () => {
  const fora = gravador({ ativo: false });
  await esperarAte(() => fora.window.__bunker707Pecas.estado !== "esperando");
  assert.equal(fora.window.__bunker707Pecas.estado, "desligado");
  assert.equal(fora.gravadores.length, 0);
  assert.equal(fora.pedidos.length, 0);

  const semSenha = gravador({ senha: null });
  await esperarAte(() => semSenha.window.__bunker707Pecas.estado !== "esperando");
  assert.equal(semSenha.window.__bunker707Pecas.estado, "sem-senha");
  assert.equal(semSenha.gravadores.length, 0);
});

test("o arquivo do gravador: duas pecas que comecam juntas, em pedacos de 2 s, e um pedaco assinado que o receptor aceita", { skip: !python && "sem python3" }, async () => {
  const g = gravador();
  await esperarAte(() => g.window.__bunker707Pecas.estado === "gravando" && g.pedidos.length > 0);
  assert.equal(g.window.__bunker707Pecas.estado, "gravando");
  assert.deepEqual(g.gravadores.map((r) => [r.opts.mimeType, r.ms]), [["video/webm;codecs=vp8,opus", 2000], ["video/webm;codecs=vp8", 2000]], "a camera com o audio e a tela, os dois com o mesmo pedaco");
  const inicio = g.pedidos.find((p) => p.url.endsWith("/linha-do-tempo.jsonl"));
  assert.ok(inicio, "a marca de comeco da linha do tempo");
  assert.equal(inicio.url, `/pecas/${SALA}/linha-do-tempo.jsonl`, "no mesmo endereco da sala: nada de rede para a propria maquina");
  const marca = JSON.parse(inicio.body.toString());
  assert.equal(marca.kind, "start");
  assert.equal(marca.t, 0);
  // A assinatura que o arquivo fez e a que o receptor confere.
  assert.equal(inicio.headers["X-Pecas-Assinatura"], assinatura(SALA, "linha-do-tempo.jsonl", inicio.headers["X-Pecas-Seq"], inicio.headers["X-Pecas-Ts"], inicio.body));
  const r = await fetch(url(inicio.url), { body: inicio.body, headers: inicio.headers, method: "POST" });
  assert.equal(r.status, 204, "o receptor de verdade aceita o pedaco assinado pelo arquivo");
  // A qualidade: a camera em 720p e a tela em 1080p, por cima do que a tela do gravador pede (sem isso, com a tela no
  // palco, a camera chega em 180p).
  // Os objetos nascem dentro do vm (outro Object): comparados pelo JSON.
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const ultima = plain(g.qualidade.at(-1));
  assert.deepEqual(ultima.constraints, { "p1-v0": { maxHeight: 720 }, "p1-v1": { maxHeight: 1080 } });
  assert.deepEqual([...ultima.onStageSources].sort(), ["p1-v0", "p1-v1"]);
  g.room.setReceiverConstraints({ constraints: { "p2-v0": { maxHeight: 180 } }, lastN: 9, onStageSources: ["p1-v1"] });
  assert.deepEqual(plain(g.qualidade.at(-1)), { constraints: { "p1-v0": { maxHeight: 720 }, "p1-v1": { maxHeight: 1080 }, "p2-v0": { maxHeight: 180 } }, lastN: 9, onStageSources: ["p1-v1", "p1-v0"] }, "o pedido do motor continua, com o nosso por cima");
});

test("a ligacao na instancia: so o gravador carrega o arquivo, o receptor atras do Caddy, a conferencia do deploy", () => {
  const custom = read("infra/jitsi/web/custom-config.js");
  const pecas = readFileSync(join(root, "infra/jitsi/web/bunker707-pecas.js"));
  const v = createHash("sha256").update(pecas).digest("hex").slice(0, 8);
  const loader = /\/\/ bunker707:pecas-loader:inicio\n([\s\S]*?)\/\/ bunker707:pecas-loader:fim\n/.exec(custom);
  assert.ok(loader);
  assert.match(loader[1], new RegExp(`script\\.src = '/libs/bunker707-pecas\\.js\\?v=${v}';`), `o ?v= e o comeco do sha256 do arquivo (${v})`);
  const run = (hash) => {
    const head = { children: [], appendChild(element) { this.children.push(element); } };
    vm.runInNewContext(custom, { config: { videoQuality: {} }, document: { createElement: (tag) => ({ tag }), documentElement: { setAttribute() {} }, head }, window: { location: { hash } } });
    return head.children.filter((element) => element.tag === "script" && element.src.startsWith("/libs/bunker707-pecas.js")).length;
  };
  assert.equal(run("#config.iAmRecorder=true&config.externalConnectUrl=null"), 1, "o gravador");
  assert.equal(run("#jitsi_meet_external_api_id=0&config.bunkerTheme=%22dark%22"), 0, "nunca o iframe do aluno nem o console");
  assert.equal(run(""), 0);
  assert.doesNotMatch(custom, /<\/?script|<!--/i, "o nome da tag nunca escrito: o arquivo entra inline no index.html");

  const compose = read("infra/jitsi/docker-compose.yml");
  assert.match(compose, /- \.\/web\/bunker707-pecas\.js:\/usr\/share\/jitsi-meet\/libs\/bunker707-pecas\.js:ro/);
  const servico = /\n  pecas:\n([\s\S]*?)\n\n/.exec(compose)?.[1] ?? "";
  assert.match(servico, /image: python:3\.12\.16-alpine/, "a imagem com a versao exata");
  assert.match(servico, /read_only: true/);
  assert.match(servico, /user: "1000:1000"/);
  assert.match(servico, /PECAS_SEGREDO: "\$\{JIBRI_RECORDER_PASSWORD\}"/, "a mesma senha que o Jibri usa e poe no localStorage");
  assert.match(servico, /- \.\/pecas\/receptor\.py:\/app\/receptor\.py:ro/);
  assert.match(servico, /- \.\/volumes\/pecas:\/dados/);
  assert.doesNotMatch(servico, /ports:/, "nenhuma porta publicada: so o Caddy chega nele");
  const caddy = read("infra/jitsi/caddy/Caddyfile");
  assert.match(caddy, /handle \/pecas\/\* \{\n\t\treverse_proxy pecas:8099\n\t\}/, "so o caminho /pecas/ vai ao receptor");
  assert.match(caddy, /handle \{\n\t\treverse_proxy web:8000 \{/, "o resto continua no Jitsi");
  assert.match(read("infra/jitsi/scripts/volumes.sh"), /dirs=\([^)]*\bpecas\b[^)]*\)/, "a pasta do receptor nasce do uid 1000");
  const deploy = read("infra/cloud/deploy.sh");
  assert.ok(deploy.indexOf("caddy reload --config /etc/caddy/Caddyfile") > deploy.indexOf("reconnect_focus'\""), "o deploy recarrega o Caddy depois do up -d (o up nao o recria quando so o Caddyfile muda)");
  const smoke = read("infra/jitsi/scripts/smoke.sh");
  assert.match(smoke, /check "pecas\/ativo \(o receptor das pecas\)" "204\|404"/);
  assert.match(smoke, /"libs\/bunker707-pecas\.js\?v=\$pecas_v"/, "o config.js servido liga a versao do commit");
});

test("o arquivo do gravador nunca le nada alem da senha do proprio Jibri e nunca fala com a propria maquina", () => {
  const fonte = read("infra/jitsi/web/bunker707-pecas.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"])\/\/.*$/gm, "$1");
  assert.deepEqual([...fonte.matchAll(/localStorage\.getItem\('([^']+)'\)/g)].map((m) => m[1]), ["xmpp_password_override"]);
  assert.doesNotMatch(fonte, /127\.0\.0\.1|localhost|http:\/\//, "o Chrome 153 pediria permissao (Local Network Access)");
  assert.deepEqual([...new Set([...fonte.matchAll(/fetch\('([^'?]+)/g)].map((m) => m[1]))].sort(), ["/pecas/", "/pecas/ativo"], "so o receptor, no mesmo endereco");
  assert.match(fonte, /nome \+ '\\n' \+ arquivo \+ '\\n' \+ n \+ '\\n' \+ ts \+ '\\n' \+ resumo/, "o mesmo texto que o receptor assina");
});

test("a CPU do gravador: as amostras a cada 5 s no host e o resumo de 30 s que o finalize.sh manda no aviso de fim", () => {
  const amostras = join(root, "infra/jitsi/jibri/cpu-amostras.sh");
  assert.ok((statSync(amostras).mode & 0o111) !== 0);
  assert.equal(spawnSync("sh", ["-n", amostras]).status, 0);
  const jibri = read("infra/cloud/jibri.sh");
  assert.match(jibri, /rcopy "\$JITSI_DIR\/jibri\/cpu-amostras\.sh"/);
  assert.match(jibri, /setsid nohup sh \.\/cpu-amostras\.sh >\/dev\/null 2>&1 < \/dev\/null &" \|\| true/, "fora do SSH, e uma falha nunca impede a gravacao");
  assert.ok(jibri.indexOf("cpu-amostras.sh >/dev/null") > jibri.indexOf("docker compose up -d\""), "depois de subir o gravador");

  const finalize = read("infra/jitsi/jibri/finalize.sh");
  const funcao = /\ncpu_json\(\) \{\n[\s\S]*?\n\}\n/.exec(finalize)[0];
  const pasta = mkdtempSync(join(tmpdir(), "cpu-"));
  try {
    const t = 1_794_709_000;
    const linhas = ["# nucleos 8"];
    // Ocupado 400 e ocioso 100 a cada 5 s: 80%. Depois, ocioso so: 0%.
    for (let i = 0; i <= 12; i++) linhas.push(`${t + i * 5} cpu ${i * 400} 0 0 ${i * 100 + 100000} 0 0 0 0 0 0`);
    for (let i = 13; i <= 24; i++) linhas.push(`${t + i * 5} cpu ${12 * 400} 0 0 ${12 * 100 + 100000 + (i - 12) * 500} 0 0 0 0 0 0`);
    writeFileSync(join(pasta, "cpu.log"), `${linhas.join("\n")}\n`);
    const out = spawnSync("sh", ["-c", `${funcao}\ncpu_json "${join(pasta, "cpu.log")}"`], { encoding: "utf8" }).stdout;
    const resumo = JSON.parse(out);
    assert.equal(resumo.nucleos, 8);
    assert.ok(resumo.amostras.every(([quando]) => quando % 30 === 0), "de 30 em 30 s");
    assert.equal(resumo.amostras[0][1], 80);
    assert.equal(resumo.amostras.at(-1)[1], 0);
    assert.equal(spawnSync("sh", ["-c", `${funcao}\ncpu_json /nao/existe`], { encoding: "utf8" }).stdout, "", "sem o arquivo, nada");
  } finally {
    rmSync(pasta, { force: true, recursive: true });
  }
  assert.match(finalize, /cpu=\$\(cpu_json "\$\{CPU_LOG:-\/storage\/cpu\.log\}"\)\n\[ -n "\$cpu" \] && body="\$body,\\"cpu\\":\$cpu"\nbody="\$body\}"/, "o resumo entra no aviso, antes de fechar o corpo");
});
