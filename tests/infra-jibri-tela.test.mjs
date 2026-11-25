import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// A tela virtual do gravador (docs/30 D137; docs/18 §2.2). O Chrome do Jibri desenha no ritmo da tela do Xorg, e o ffmpeg
// filma essa tela a 30 quadros. O arquivo da imagem (stable-11248) da 10 Hz em 1920x1080 e 25 Hz em 1280x720: a live de
// 24/11/2026 saiu com 10 imagens por segundo, cada uma repetida 3 vezes no arquivo. O nosso xorg-video-dummy.conf, montado
// por cima do da imagem, poe os dois tamanhos a 60 Hz. Aqui: a conta da taxa de cada modo, o arquivo como o tpl da imagem
// o entrega ao Xorg, e o caminho dele ate a maquina (o compose monta, o jibri-up copia antes de subir).

const root = new URL("../", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

const template = read("infra/jitsi/jibri/xorg-video-dummy.conf");
const compose = read("infra/jitsi/jibri/docker-compose.yml");
const envExample = read("infra/jitsi/jibri/.env.example");
const jibriSh = read("infra/cloud/jibri.sh");

/** Os modos de um xorg.conf: nome, relogio em MHz e os oito numeros da linha, com a taxa em Hz que o Xorg calcula. */
function modelines(text) {
  const found = [];
  for (const m of text.matchAll(/^[ \t]*Modeline[ \t]+"([^"]+)"[ \t]+([\d.]+)((?:[ \t]+\d+){8})[ \t]*$/gim)) {
    const [hDisplay, hSyncStart, hSyncEnd, hTotal, vDisplay, vSyncStart, vSyncEnd, vTotal] = m[3].trim().split(/\s+/).map(Number);
    const clockMHz = Number(m[2]);
    found.push({
      clockMHz,
      hDisplay,
      hSyncEnd,
      hSyncStart,
      hSyncKHz: (clockMHz * 1000) / hTotal,
      hTotal,
      name: m[1],
      refreshHz: (clockMHz * 1e6) / (hTotal * vTotal),
      vDisplay,
      vSyncEnd,
      vSyncStart,
      vTotal,
    });
  }
  return found;
}

/** O que o tpl da imagem faz com o arquivo: a primeira linha guarda o tamanho (o do ambiente ou o padrao) e some; o
 * `| quote` vira o tamanho entre aspas. Qualquer outra chave dupla quebraria o tpl: aqui ela reprova. */
function render(env = {}) {
  const head = /^\{\{ \$JIBRI_RECORDING_RESOLUTION := \.Env\.JIBRI_RECORDING_RESOLUTION \| default "(\d+x\d+)" -\}\}\n/.exec(template);
  assert.ok(head, "a primeira linha e a da imagem: o tamanho vem de JIBRI_RECORDING_RESOLUTION");
  const size = env.JIBRI_RECORDING_RESOLUTION || head[1];
  const body = template.slice(head[0].length).replaceAll("{{ $JIBRI_RECORDING_RESOLUTION | quote }}", JSON.stringify(size));
  assert.doesNotMatch(body, /\{\{|\}\}/, "nenhuma outra chave de modelo no arquivo (nem em comentario): o tpl tentaria executar");
  return body;
}

/** Os tamanhos em que o gravador pode subir: o padrao do compose, o do exemplo, o do jibri-up e a reserva cpx32. */
function recordingSizes() {
  const sizes = new Set();
  sizes.add(/JIBRI_RECORDING_RESOLUTION: "\$\{JIBRI_RECORDING_RESOLUTION:-(\d+x\d+)\}"/.exec(compose)?.[1]);
  sizes.add(/^JIBRI_RECORDING_RESOLUTION=(\d+x\d+)$/m.exec(envExample)?.[1]);
  sizes.add(/^JIBRI_RECORDING_RESOLUTION="\$\{JIBRI_RECORDING_RESOLUTION:-(\d+x\d+)\}"$/m.exec(jibriSh)?.[1]);
  for (const m of jibriSh.matchAll(/\bresolution="(\d+x\d+)"/g)) sizes.add(m[1]);
  assert.ok(!sizes.has(undefined), "o tamanho da gravacao saiu de um dos quatro lugares conhecidos");
  return [...sizes].sort();
}

test("a conta da taxa: os modos da imagem dao 10 Hz em 1920x1080 e 25 Hz em 1280x720 (o defeito de 24/11/2026)", () => {
  // As duas linhas do xorg-video-dummy.conf da imagem na tag fixada (docker-jitsi-meet stable-11248), copiadas como dado.
  const daImagem = modelines('  Modeline "1920x1080" 23.53 1920 1952 2040 2072 1080 1106 1108 1135\n  Modeline "1280x720" 27.41 1280 1312 1416 1448 720 737 740 757\n');
  assert.deepEqual(daImagem.map((m) => `${m.name} ${m.refreshHz.toFixed(1)}`), ["1920x1080 10.0", "1280x720 25.0"]);
});

test("todo tamanho em que o gravador sobe tem um modo so, a 60 Hz, que o driver da tela virtual aceita", () => {
  assert.deepEqual(recordingSizes(), ["1280x720", "1920x1080"]);
  const framerate = Number(/JIBRI_RECORDING_FRAMERATE: "\$\{JIBRI_RECORDING_FRAMERATE:-(\d+)\}"/.exec(compose)?.[1]);
  assert.equal(framerate, 30, "o ffmpeg do gravador filma a tela a 30 quadros");

  for (const size of recordingSizes()) {
    const rendered = render({ JIBRI_RECORDING_RESOLUTION: size });
    assert.match(rendered, new RegExp(`^\\s+Modes "${size}"$`, "m"), `o modo da tela e o de nome ${size}`);
    const modes = modelines(rendered).filter((m) => m.name === size);
    assert.equal(modes.length, 1, `um modo so com o nome ${size}: com dois, qual vale depende do Xorg`);
    const [mode] = modes;
    const [width, height] = size.split("x").map(Number);
    assert.deepEqual([mode.hDisplay, mode.vDisplay], [width, height], "o modo tem o tamanho do nome");
    assert.ok(mode.hDisplay <= mode.hSyncStart && mode.hSyncStart <= mode.hSyncEnd && mode.hSyncEnd <= mode.hTotal, "os quatro numeros da linha em ordem");
    assert.ok(mode.vDisplay <= mode.vSyncStart && mode.vSyncStart <= mode.vSyncEnd && mode.vSyncEnd <= mode.vTotal, "os quatro numeros das linhas em ordem");
    // 60 Hz, o dobro dos quadros do ffmpeg: nunca menos que os quadros da gravacao (o defeito era 10 para 30).
    assert.ok(Math.abs(mode.refreshHz - 60) < 0.05, `${size} a 60 Hz (deu ${mode.refreshHz.toFixed(2)})`);
    assert.ok(mode.refreshHz >= framerate * 2 - 0.05, "a tela no dobro do ritmo da gravacao");
    // O driver dummy aceita relogio de 11 a 300 MHz (dummy_driver.c: minClock 11000, maxClock 300000).
    assert.ok(mode.clockMHz >= 11 && mode.clockMHz <= 300, `relogio de ${mode.clockMHz} MHz dentro do que o driver aceita`);
    // E as faixas do monitor declaradas no proprio arquivo.
    const hRange = /^\s+HorizSync\s+([\d.]+) - ([\d.]+)$/m.exec(rendered);
    const vRange = /^\s+VertRefresh\s+([\d.]+) - ([\d.]+)$/m.exec(rendered);
    assert.ok(hRange && vRange, "as faixas do monitor estao no arquivo");
    assert.ok(mode.hSyncKHz >= Number(hRange[1]) && mode.hSyncKHz <= Number(hRange[2]), "dentro do HorizSync");
    assert.ok(mode.refreshHz >= Number(vRange[1]) && mode.refreshHz <= Number(vRange[2]), "dentro do VertRefresh");
  }
});

test("sem o tamanho no ambiente o arquivo sobe em 1920x1080, e nenhum modo dele fica abaixo dos quadros da gravacao", () => {
  const rendered = render();
  assert.match(rendered, /^\s+Modes "1920x1080"$/m);
  for (const mode of modelines(rendered)) assert.ok(mode.refreshHz >= 30, `${mode.name} a ${mode.refreshHz.toFixed(1)} Hz: um modo lento aqui volta a travar a gravacao`);
  assert.match(rendered, /^\s+Driver "dummy"$/m);
  assert.match(rendered, /^\s+Screen\s+"dummy_screen"$/m);
});

test("o arquivo chega ao Xorg do gravador: o compose monta por cima do da imagem e o jibri-up copia antes de subir", () => {
  assert.match(compose, /^\s+- \.\/xorg-video-dummy\.conf:\/defaults\/xorg-video-dummy\.conf:ro$/m, "por cima do arquivo que o script de partida da imagem passa pelo tpl");
  const copia = jibriSh.indexOf('rcopy "$JITSI_DIR/jibri/xorg-video-dummy.conf" "$target:$JIBRI_REMOTE_DIR/xorg-video-dummy.conf"');
  assert.ok(copia > 0, "o jibri-up copia o arquivo para a maquina");
  // Sem o arquivo na maquina, o Docker cria uma pasta com o nome dele e o Xorg do gravador nao sobe.
  assert.ok(copia < jibriSh.indexOf("docker compose up -d\""), "antes do up -d");
  assert.match(jibriSh, /echo "  tela virtual: \$\(rsh "\$target" "grep -h -o 'Modeline \\"\$\{resolution\}\\"x\[0-9\.\]\*' [^\n]*xorg\.log' 2>\/dev\/null[^\n]*\|\| true\)"/, "o preparo mostra o modo que o Xorg registrou, sem nunca parar por isso");
});

test("jibri-status.sh mostra os modos que o Xorg registrou, e diz quando o registro ainda nao tem a linha", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunker707-jibri-tela-"));
  try {
    copyFileSync(join(root, "infra/jitsi/scripts/jibri-status.sh"), join(dir, "jibri-status.sh"));
    writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
    // Um docker de mentira: o gravador saudavel, como a API do Jibri responde.
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "docker"), '#!/bin/sh\ncase "$*" in *" exec "*) printf \'%s\' \'{"status":{"busyStatus":"IDLE","health":{"healthStatus":"HEALTHY","details":{}}}}\' ;; esac\n');
    chmodSync(join(dir, "bin", "docker"), 0o755);
    const status = () => spawnSync("bash", [join(dir, "jibri-status.sh")], { encoding: "utf8", env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` } });

    const semRegistro = status();
    assert.equal(semRegistro.status, 0, semRegistro.stderr);
    assert.match(semRegistro.stdout, /==> Tela virtual \(xorg\.log\)\n {2}\(sem a linha do modo no xorg\.log\)\n/);

    mkdirSync(join(dir, "volumes/storage/jibri/logs"), { recursive: true });
    writeFileSync(
      join(dir, "volumes/storage/jibri/logs/xorg.log"),
      '[    10.1] (II) DUMMY(0): Modeline "1920x1080"x60.0  148.50  1920 2008 2052 2200  1080 1084 1089 1125 (67.5 kHz b)\n[    10.1] (II) DUMMY(0): Modeline "1920x1080"x60.0  148.50  1920 2008 2052 2200  1080 1084 1089 1125 (67.5 kHz b)\n',
    );
    const comRegistro = status();
    assert.equal(comRegistro.status, 0, comRegistro.stderr);
    assert.match(comRegistro.stdout, /==> Tela virtual \(xorg\.log\)\n {2}Modeline "1920x1080"x60\.0\n==> Gravacoes/, "uma linha por modo, sem repetir");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
