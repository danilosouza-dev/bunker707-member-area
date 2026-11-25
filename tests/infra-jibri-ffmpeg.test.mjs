import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// O ffmpeg da gravacao (docs/30 D138; docs/18 §2.2). A imagem do Jibri (stable-11248) traz o ffmpeg 7.1, e nele a entrada
// de audio segura a captura da tela: a tela mostra 30 imagens por segundo e o arquivo sai com 3 a 6 (a live de 24/11/2026
// e a bancada de 25/11/2026). O gravador passa a gravar com o 6.1, compilado do codigo oficial pelo ffmpeg-gravacao.sh e
// montado a frente do da imagem. Aqui: o script da compilacao (o que ele baixa, confere e compila, e como reage ao
// Docker), o caminho do binario ate o Jibri, e as duas medidas novas do aviso de fim (a versao que gravou e as imagens
// diferentes por segundo do arquivo). A prova de que o arquivo sai fluido e a bancada (gravador-bancada.yml), que grava
// de verdade com a imagem.

const root = new URL("../", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

const build = read("infra/jitsi/jibri/ffmpeg-gravacao.sh");
const compose = read("infra/jitsi/jibri/docker-compose.yml");
const custom = read("infra/jitsi/jibri/custom-jibri.conf");
const finalize = read("infra/jitsi/jibri/finalize.sh");
const jibriSh = read("infra/cloud/jibri.sh");

test("ffmpeg-gravacao.sh compila uma versao anterior a 7, do site oficial, conferida pelo sha256 antes de abrir, so com o que a gravacao usa", () => {
  const version = /^version="\$\{FFMPEG_VERSAO:-(\d+)\.(\d+)(?:\.\d+)?\}"$/m.exec(build);
  assert.ok(version, "a versao fica numa linha so, trocavel por FFMPEG_VERSAO");
  assert.ok(Number(version[1]) < 7, `o agendador que segura a captura entrou no ffmpeg 7.0 (versao pedida: ${version[1]}.${version[2]})`);
  assert.match(build, /^sha256="\$\{FFMPEG_SHA256:-[0-9a-f]{64}\}"$/m, "o resumo do pacote do codigo fica fixado");
  assert.match(build, /curl -fsSL --retry 3 -o "ffmpeg-\$version\.tar\.xz" "https:\/\/ffmpeg\.org\/releases\/ffmpeg-\$version\.tar\.xz"/, "do site oficial");
  const confere = build.indexOf('echo "$sha256  ffmpeg-$version.tar.xz" | sha256sum -c -');
  assert.ok(confere > 0 && confere < build.indexOf('tar -xJf "ffmpeg-$version.tar.xz"'), "confere o resumo antes de abrir o pacote");
  assert.match(build, /^base="debian:trixie-slim"$/m, "a mesma base da imagem do Jibri: o binario usa as bibliotecas que ela ja tem");
  // O comando de gravacao do Jibri: tela (x11grab) + pulse -> x264 + aac -> mp4.
  for (const piece of ["--enable-indev=xcbgrab,pulse", "--enable-encoder=libx264,aac", "--enable-libx264", "--enable-libpulse", "--enable-libxcb-shm", "--enable-filter=aresample,scale,format,aformat"]) {
    assert.ok(build.includes(piece), `${piece} na compilacao`);
  }
  assert.match(build, /--enable-muxer=mp4,/);
  assert.match(build, /--disable-network/, "o binario da gravacao nao fala com a rede");
});

test("ffmpeg-gravacao.sh fora do container: entrega o binario, nao repete quando o Docker terminou sem ele e tenta 3 vezes quando o Docker falha", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunker707-ffmpeg-"));
  try {
    mkdirSync(join(dir, "bin"));
    // Um docker de mentira: conta as chamadas e faz o que DOCKER_MODO pedir.
    writeFileSync(
      join(dir, "bin", "docker"),
      '#!/bin/sh\necho x >> "$CONTA"\nsaida=""\nfor a in "$@"; do case "$a" in *:/saida) saida="${a%:/saida}" ;; esac; done\ncase "$DOCKER_MODO" in\n  ok) printf \'#!/bin/sh\\n\' > "$saida/ffmpeg"; chmod 755 "$saida/ffmpeg"; echo "ffmpeg version 6.1.6" ;;\n  vazio) : ;;\n  falha) exit 1 ;;\nesac\n',
    );
    chmodSync(join(dir, "bin", "docker"), 0o755);
    const run = (modo) => {
      const conta = join(dir, `conta-${modo}`);
      const out = join(dir, `saida-${modo}`);
      const result = spawnSync("bash", [join(root, "infra/jitsi/jibri/ffmpeg-gravacao.sh"), out], {
        encoding: "utf8",
        env: { ...process.env, CONTA: conta, DOCKER_MODO: modo, FFMPEG_GRAVACAO_ESPERA: "0", PATH: `${join(dir, "bin")}:${process.env.PATH}` },
      });
      return { calls: existsSync(conta) ? readFileSync(conta, "utf8").trim().split("\n").length : 0, out, result };
    };

    const ok = run("ok");
    assert.equal(ok.result.status, 0, ok.result.stderr);
    assert.equal(ok.calls, 1);
    assert.ok(existsSync(join(ok.out, "ffmpeg")), "o binario fica na pasta pedida");

    const vazio = run("vazio");
    assert.equal(vazio.result.status, 1);
    assert.equal(vazio.calls, 1, "o Docker terminou bem sem o binario: repetir nao muda nada");
    assert.match(vazio.result.stderr, /terminou sem o binario/);

    const falha = run("falha");
    assert.equal(falha.result.status, 1);
    assert.equal(falha.calls, 3, "falha do Docker (rede, espelho fora): tres tentativas");

    const semPasta = spawnSync("bash", [join(root, "infra/jitsi/jibri/ffmpeg-gravacao.sh")], { encoding: "utf8" });
    assert.notEqual(semPasta.status, 0, "sem a pasta de saida, recusa");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("o binario chega ao Jibri: o compose o monta a frente do ffmpeg da imagem, o custom-jibri.conf aponta para ele e o jibri-up copia os dois antes de subir", () => {
  assert.match(compose, /^\s+- \.\/ffmpeg:\/usr\/local\/bin\/ffmpeg:ro$/m, "/usr/local/bin vem antes de /usr/bin no PATH do Jibri");
  assert.match(compose, /^\s+- \.\/custom-jibri\.conf:\/config\/custom-jibri\.conf:ro$/m, "a imagem inclui o /config/custom-jibri.conf no fim do jibri.conf dela");
  assert.match(custom, /^jibri\.ffmpeg\.ffmpeg-binary = "\/usr\/local\/bin\/ffmpeg"$/m, "o mesmo caminho da montagem");
  assert.doesNotMatch(custom.replace(/^\/\/.*$/gm, ""), /\{\{|\$\{/, "so a chave: nada que o HOCON ou o tpl tente resolver");

  const comeca = jibriSh.indexOf('bash "$JITSI_DIR/jibri/ffmpeg-gravacao.sh" "$ffdir" > "$ffdir/build.log" 2>&1 &');
  const espera = jibriSh.indexOf('if wait "$ffpid" && [ -x "$ffdir/ffmpeg" ]; then');
  const copia = jibriSh.indexOf('rcopy "$ffdir/ffmpeg" "$target:$JIBRI_REMOTE_DIR/ffmpeg"');
  const copiaConf = jibriSh.indexOf('rcopy "$JITSI_DIR/jibri/custom-jibri.conf" "$target:$JIBRI_REMOTE_DIR/custom-jibri.conf"');
  const sobe = jibriSh.indexOf('docker compose up -d"');
  assert.ok(comeca > 0 && comeca < jibriSh.indexOf('log "2/6 Servidor $name"'), "a compilacao comeca em segundo plano antes de criar a maquina");
  assert.ok(comeca < espera && espera < copia && copia < sobe && copiaConf > 0 && copiaConf < sobe, "espera a compilacao, copia os dois e so entao sobe");
  // Sem o binario, um atalho para o ffmpeg da imagem: o compose monta o arquivo de todo jeito.
  assert.ok(jibriSh.includes(`printf '#!/bin/sh\\nexec /usr/bin/ffmpeg "$@"\\n' > "$ffdir/ffmpeg"; chmod 755 "$ffdir/ffmpeg"`));
});

/** As duas funcoes novas do finalize.sh, tiradas do arquivo e rodadas num sh com um ffmpeg de mentira. */
function finalizeFunctions() {
  const start = finalize.indexOf("ffmpeg_gravou() {");
  const end = finalize.indexOf("sign() {");
  assert.ok(start > 0 && end > start, "as funcoes ficam antes do sign()");
  return finalize.slice(start, end);
}

test("finalize.sh: a versao do ffmpeg que gravou sai do registro do Jibri, e as imagens por segundo do arquivo saem de tres janelas contadas com o ffmpeg da imagem", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunker707-finalize-"));
  try {
    writeFileSync(join(dir, "ffmpeg.0.txt"), "2026-11-25 03:07:01.000 INFO: [52] ffmpeg.call() ffmpeg version 6.1.6 Copyright (c) 2000-2026 the FFmpeg developers\n");
    // O ffmpeg de mentira: anota os argumentos e responde como o de verdade, com o total de quadros mantidos.
    writeFileSync(join(dir, "ffmpeg"), '#!/bin/sh\necho "$*" >> "$ARGS"\nprintf \'frame=  100 fps=0.0\\rframe=  %s fps=0.0 q=-0.0 Lsize=N/A\\n\' "$MANTIDOS" >&2\n');
    chmodSync(join(dir, "ffmpeg"), 0o755);
    const run = (script, env = {}) =>
      spawnSync("sh", ["-c", `set -u\n${finalizeFunctions()}\n${script}`], { encoding: "utf8", env: { ...process.env, ARGS: join(dir, "args"), FFMPEG_CONTAGEM: join(dir, "ffmpeg"), FFMPEG_LOGS: dir, MANTIDOS: "600", ...env } });

    const gravou = run("ffmpeg_gravou");
    assert.equal(gravou.stdout.trim(), "6.1.6", gravou.stderr);
    // Sem a versao no registro do Jibri (o aviso do teste de 25/11/2026 veio sem ela): a do binario que o Jibri usa.
    mkdirSync(join(dir, "vazio"));
    writeFileSync(join(dir, "gravador"), '#!/bin/sh\necho "ffmpeg version 6.1.6 Copyright (c) 2000-2026 the FFmpeg developers"\n');
    chmodSync(join(dir, "gravador"), 0o755);
    assert.equal(run("ffmpeg_gravou", { FFMPEG_GRAVADOR: join(dir, "gravador"), FFMPEG_LOGS: join(dir, "vazio") }).stdout.trim(), "6.1.6");
    assert.equal(run("ffmpeg_gravou", { FFMPEG_GRAVADOR: join(dir, "nao-existe"), FFMPEG_LOGS: join(dir, "vazio") }).stdout.trim(), "", "sem registro e sem binario, nada");

    const longa = run("duration=6369; file=/x/live.mp4; imagens_json");
    assert.equal(longa.stdout, "[[636,30.0],[3184,30.0],[5413,30.0]]", longa.stderr);
    const args = readFileSync(join(dir, "args"), "utf8").trim().split("\n");
    assert.equal(args.length, 3);
    assert.match(args[0], /^-nostdin -v info -ss 636 -t 20 -i \/x\/live\.mp4 -vf mpdecimate -an -f null -$/, "o limite antes do -i: com a tela parada o ffmpeg nao ficaria esperando");

    assert.equal(run("duration=6369; file=/x/live.mp4; imagens_json", { MANTIDOS: "120" }).stdout, "[[636,6.0],[3184,6.0],[5413,6.0]]", "a live de 24/11/2026 teria saido assim");
    assert.equal(run("duration=30; file=/x/curta.mp4; imagens_json", { MANTIDOS: "450" }).stdout, "[[3,30.0],[15,30.0],[15,30.0]]", "gravacao curta: janelas de metade da duracao, nunca alem do fim");
    assert.equal(run("duration=null; file=/x/a.mp4; imagens_json").stdout, "", "sem a duracao, nada");
    assert.equal(run("duration=8; file=/x/a.mp4; imagens_json").stdout, "", "curta demais, nada");
    assert.equal(run("duration=100; file=/x/a.mp4; imagens_json", { FFMPEG_CONTAGEM: join(dir, "nao-existe") }).stdout, "", "sem o ffmpeg da contagem, nada");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
  // As duas medidas entram no corpo do aviso so quando existem (o app guarda o corpo cru).
  assert.ok(finalize.includes(`[ -n "$gravou" ] && body="$body,\\"ffmpeg\\":\\"$(json_str "$gravou")\\""`));
  assert.ok(finalize.includes(`[ -n "$imagens" ] && body="$body,\\"imagens\\":$imagens"`));
});
