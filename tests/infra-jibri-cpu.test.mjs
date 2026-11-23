import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// A CPU da maquina do gravador (docs/30 §6.7; docs/20 §8B.10; docs/18 §2.2): o cpu-amostras.sh anota a CPU a cada 5 s
// no host, o jibri-up o liga sem segurar o SSH, e o finalize.sh manda o resumo de 30 s no aviso de fim (o campo `cpu`).
// Nasceu no teste das pecas da Live gravada (o plano A, abandonado em 15/11/2026, A62) e fica: e a medida para escolher
// o tamanho do gravador (A26). E a guarda de que o plano A saiu da instancia inteiro.

const root = new URL("../", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

test("o comando que liga as amostras de CPU volta na hora e deixa o laco rodando (o jibri-up de 15/11/2026 parou nele)", { skip: process.platform !== "linux" && "o setsid é do Linux (util-linux)" }, async () => {
  // O SSH so devolve o controle quando ninguem mais segura a saida do comando remoto. Roda o mesmo texto do jibri.sh num
  // bash com a saida num cano, como o sshd faz: o cano tem de fechar logo, com o laco das amostras vivo.
  const comando = /rsh "\$target" "(cd '\$JIBRI_REMOTE_DIR' && [^\n]*cpu-amostras\.sh[^\n]*?)" \|\| true/.exec(read("infra/cloud/jibri.sh"))?.[1];
  assert.ok(comando, "o jibri.sh liga as amostras pelo rsh");
  const pasta = mkdtempSync(join(tmpdir(), "amostras-"));
  writeFileSync(join(pasta, "cpu-amostras.sh"), 'echo $$ > "$(dirname "$0")/pid"\nwhile :; do sleep 1; done\n');
  try {
    const inicio = Date.now();
    const filho = spawn("bash", ["-c", comando.replaceAll("$JIBRI_REMOTE_DIR", pasta)], { stdio: ["ignore", "pipe", "pipe"] });
    filho.stdout.resume();
    filho.stderr.resume();
    const fechou = await new Promise((resolve) => {
      const prazo = setTimeout(() => resolve(false), 5_000);
      filho.on("close", () => {
        clearTimeout(prazo);
        resolve(true);
      });
    });
    const passou = Date.now() - inicio;
    let pid = "";
    for (let i = 0; i < 50 && !pid; i += 1) {
      pid = existsSync(join(pasta, "pid")) ? readFileSync(join(pasta, "pid"), "utf8").trim() : "";
      if (!pid) await new Promise((r) => setTimeout(r, 100));
    }
    const vivo = Boolean(pid) && spawnSync("kill", ["-0", pid]).status === 0;
    // Limpa antes de conferir: com a saida presa, o laco e o cano segurariam o processo do teste.
    if (pid) spawnSync("kill", [pid]);
    filho.stdout.destroy();
    filho.stderr.destroy();
    assert.ok(fechou && passou < 5_000, "a saida continuou presa: o rsh do jibri-up nunca voltaria");
    assert.ok(vivo, "o laco das amostras comecou e continua rodando depois que o comando voltou");
  } finally {
    rmSync(pasta, { force: true, recursive: true });
  }
});

test("a CPU do gravador: as amostras a cada 5 s no host e o resumo de 30 s que o finalize.sh manda no aviso de fim", () => {
  const amostras = join(root, "infra/jitsi/jibri/cpu-amostras.sh");
  assert.ok((statSync(amostras).mode & 0o111) !== 0);
  assert.equal(spawnSync("sh", ["-n", amostras]).status, 0);
  const jibri = read("infra/cloud/jibri.sh");
  assert.match(jibri, /rcopy "\$JITSI_DIR\/jibri\/cpu-amostras\.sh"/);
  assert.match(jibri, /\{ setsid nohup sh \.\/cpu-amostras\.sh >\/dev\/null 2>&1 < \/dev\/null & \}" \|\| true/, "fora do SSH, e uma falha nunca impede a gravacao");
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
  assert.match(finalize, /cpu=\$\(cpu_json "\$\{CPU_LOG:-\/storage\/cpu\.log\}"\)\n\[ -n "\$cpu" \] && body="\$body,\\"cpu\\":\$cpu"\n/, "o resumo entra no aviso");
  assert.match(finalize, /fluidez=\$\(fluidez_json\)\n\[ -n "\$fluidez" \] && body="\$body,\\"fluidez\\":\$fluidez"\nbody="\$body\}"/, "a fluidez tambem, antes de fechar o corpo");
});

test("o plano A saiu inteiro: nem arquivo no gravador, nem receptor, nem rota, nem servico, e o deploy tira o container que ficou", () => {
  for (const caminho of ["infra/jitsi/web/bunker707-pecas.js", "infra/jitsi/pecas"]) assert.equal(existsSync(join(root, caminho)), false, `${caminho} saiu`);
  const custom = read("infra/jitsi/web/custom-config.js");
  assert.doesNotMatch(custom, /pecas/i, "o carregador das pecas saiu do config.js");
  const compose = read("infra/jitsi/docker-compose.yml");
  assert.doesNotMatch(compose, /pecas/i, "nem o servico do receptor nem a montagem do arquivo");
  assert.doesNotMatch(read("infra/jitsi/caddy/Caddyfile"), /pecas/i, "nem a rota /pecas/");
  assert.doesNotMatch(read("infra/jitsi/scripts/smoke.sh"), /pecas/i, "nem a conferencia do deploy");
  assert.doesNotMatch(read("infra/jitsi/scripts/volumes.sh"), /pecas/i, "nem a pasta dos dados");
  const deploy = read("infra/cloud/deploy.sh");
  // O `up -d` nao tira um container que o compose ja nao conhece.
  assert.match(deploy, /remote "docker rm -f bunker707-meet-pecas >\/dev\/null 2>&1 \|\| true"/, "o deploy tira o receptor que ficou rodando");
  assert.ok(deploy.indexOf("caddy reload --config /etc/caddy/Caddyfile") > deploy.indexOf("reconnect_focus'\""), "o deploy recarrega o Caddy depois do up -d (o up nao o recria quando so o Caddyfile muda)");
  // O deploy troca o Caddyfile por um arquivo novo (git archive | tar): montado como arquivo, o container continua com
  // o de antes e o reload le a configuracao velha (o deploy-meet de 15/11/2026). Montada a pasta, o reload ve o novo.
  const borda = compose.slice(compose.indexOf("\n  caddy:"), compose.indexOf("\nnetworks:"));
  assert.match(borda, /- \.\/caddy:\/etc\/caddy:ro/, "o Caddy monta a pasta, para o reload ler o Caddyfile novo");
  assert.doesNotMatch(borda, /\.\/caddy\/Caddyfile:/, "nada de montar o arquivo sozinho");
});

test("a fluidez do gravador (docs/30 A65): o finalize.sh tira do log do navegador as linhas bunker707-fluidez, as mais novas, como lista de textos", { skip: spawnSync("python3", ["--version"]).status !== 0 && "sem python3" }, () => {
  const finalize = read("infra/jitsi/jibri/finalize.sh");
  const funcao = /\nfluidez_json\(\) \{\n[\s\S]*?\nPY\n\}\n/.exec(finalize)[0];
  const pasta = mkdtempSync(join(tmpdir(), "fluidez-"));
  try {
    // O formato do log do navegador do Jibri: a mensagem do console entre aspas, depois de console-api.
    const linha = (n) => `2026-11-15 20:10:${String(n).padStart(2, "0")}.000 INFO: [52] browser.log: [INFO] console-api 2:1234 "bunker707-fluidez t=${1794770000 + n} m=tela pintou=29.8 perdeu=0 raf=60 | tela* VP9 libvpx 1080p rec=30 dec=29.9 drop=0 ms=4.1 fz=0 jb=40"`;
    writeFileSync(join(pasta, "browser.0.txt"), ["2026-11-15 20:09:59.000 INFO: [52] outra coisa", ...Array.from({ length: 130 }, (_, n) => linha(n))].join("\n") + "\n");
    const out = spawnSync("sh", ["-c", `${funcao}\nBROWSER_LOGS='${pasta}' fluidez_json`], { encoding: "utf8" }).stdout.trim();
    const lista = JSON.parse(out);
    assert.equal(lista.length, 120, "as 120 mais novas");
    assert.equal(lista.at(-1), `t=${1794770000 + 129} m=tela pintou=29.8 perdeu=0 raf=60 | tela* VP9 libvpx 1080p rec=30 dec=29.9 drop=0 ms=4.1 fz=0 jb=40`);
    assert.ok(Buffer.byteLength(out) < 26000, "cabe no aviso (o app aceita 64 KB)");
    assert.equal(spawnSync("sh", ["-c", `${funcao}\nBROWSER_LOGS=/nao/existe fluidez_json`], { encoding: "utf8" }).stdout, "", "sem o log, nada");
  } finally {
    rmSync(pasta, { force: true, recursive: true });
  }
});
