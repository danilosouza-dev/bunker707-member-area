import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda de arquitetura (docs/18 §1.2: conferencia de texto so vale como guarda, em arquivo .guard): a folha da
// instancia do motor (docs/31 §3), o que a monta e serve e o ?v= do carregador. O que a folha faz no DOM so os prints
// do spike provam; o carregador tem teste de comportamento em tests/infra-jitsi.test.mjs.
const here = dirname(fileURLToPath(import.meta.url));
const jitsiDir = join(here, "..", "infra", "jitsi");
const read = (path) => readFileSync(path, "utf8");
const css = read(join(jitsiDir, "web", "bunker707.css"));
const customConfig = read(join(jitsiDir, "web", "custom-config.js"));

test("a folha: os dois temas, o fundo da pagina pelo tema, nenhum nome do motor, nada de fora e nenhum token morto", () => {
  assert.doesNotMatch(css, /jitsi/i, "nada cita o motor (D2)");
  assert.match(css, /:root \{[^}]*--bunker-bg: #141414;/, "o escuro e o fundo da area");
  assert.match(css, /html\[data-bunker-theme="light"\] \{[^}]*--bunker-bg: #f4f4f3;/, "o claro e o fundo claro da sala (docs/31 V2-11)");
  assert.match(css, /html,\s*body \{\s*background: var\(--bunker-bg\) !important;/, "o fundo da pagina do iframe segue o tema");
  assert.ok(!/@import|url\(\s*["']?(https?:)?\/\//.test(css), "a folha nao puxa nada de fora, nem por endereco sem esquema (CSP e privacidade)");
  for (const name of new Set([...css.matchAll(/^\s*(--bunker-[a-z-]+):/gm)].map((m) => m[1]))) {
    assert.ok(css.includes(`var(${name})`), `${name} definida e nunca usada`);
  }
});

test("a folha: o cartao do palco, a grade sem o cartao preto, o botao de recolher some, miniaturas redondas, anel verde, puxador no lugar", () => {
  assert.match(css, /#largeVideoContainer \{[^}]*border-radius: var\(--bunker-radius\);/, "o video grande vira o cartao do palco");
  assert.match(css, /#largeVideoWrapper \{[^}]*box-shadow: none !important;/);
  assert.match(css, /\.tile-view #largeVideoContainer,\s*\.stage-filmstrip #largeVideoContainer \{[^}]*background: transparent !important;/, "na grade e no palco duplo o cartao preto sai de baixo da grade");
  assert.match(css, /\.filmstrip \.toggleFilmstripContainer \{[^}]*display: none !important;/, "o aluno nao recolhe a coluna por fora da pagina");
  assert.match(css, /\[data-testid="stage-display-name"\] \{[^}]*display: none !important;/, "rede de seguranca: hideDominantSpeakerBadge ja tira o nome do palco");
  assert.match(css, /\.filmstrip__videos \.videocontainer \{[^}]*border-radius: var\(--bunker-radius-tile\) !important;/);
  assert.match(css, /\.filmstrip__videos \.videocontainer video,/, "o <video> da miniatura local e neto (#localVideoWrapper): seletor descendente, nao filho");
  assert.match(css, /\.videocontainer\.dominant-speaker \.active-speaker-indicator \{[^}]*box-shadow: inset 0 0 0 2px var\(--bunker-speaking\) !important;/);
  // O puxador fica no lugar (a largura dele entra na conta do video grande), so invisivel e sem ponteiro.
  assert.match(css, /\.resizable-filmstrip \.dragHandleContainer \{[^}]*visibility: hidden !important;[^}]*pointer-events: none !important;/);
  assert.doesNotMatch(css, /dragHandleContainer[^}]*display: none/, "display: none tiraria 9 px da conta do motor");
});

test("a folha: nada de margem, tamanho, borda, inset ou transformacao em regra que alcance as miniaturas (a lista virtual do motor mede por JS)", () => {
  const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2] }))
    .filter((b) => /\.filmstrip__videos|\.videocontainer|#filmstripRemoteVideosContainer|#filmstripLocalVideo|#remoteVideos|\.remote-videos|#localVideoWrapper/.test(b.selector))
    .filter((b) => !/::(after|before)/.test(b.selector));
  assert.ok(blocks.length >= 3, "a guarda achou as regras das miniaturas");
  for (const { selector, body } of blocks) {
    assert.doesNotMatch(
      body,
      /(^|[\s;])(min-|max-|border-)?(margin|width|height|padding|inset|inline-size|block-size|flex-basis|transform)(-[a-z]+)*\s*:/m,
      `${selector}: medida na miniatura desalinha a coluna (altura + 4 px por item)`
    );
  }
  // Os ::after sao camadas absolutas dentro da miniatura: inset 0 e so o encaixe da camada, nunca uma medida.
  for (const m of css.matchAll(/[^{}]*::after\s*\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /(^|[\s;])(margin|width|height|padding|min-|max-|transform)/m);
  }
});

test("montagem e smoke: a folha no nginx do web (somente leitura), servida em /css, conferida pelo sha256 e pelo ?v= do config.js servido; o deploy recria o web", () => {
  const compose = read(join(jitsiDir, "docker-compose.yml"));
  assert.match(compose, /- \.\/web\/bunker707\.css:\/usr\/share\/jitsi-meet\/css\/bunker707\.css:ro/, "a folha montada no nginx do web, somente leitura");
  const smoke = read(join(jitsiDir, "scripts", "smoke.sh"));
  assert.match(smoke, /css_sha=\$\(sha256sum "\$css_file" \| cut -c1-64\); css_v=\$\{css_sha:0:8\}/, "o smoke calcula o v pela folha do commit");
  assert.match(smoke, /check "css\/bunker707\.css[^"]*" 200 "\$public_url\/css\/bunker707\.css"/, "o smoke confere que a folha e servida");
  assert.match(smoke, /served_sha=\$\(curl [^\n]*"\$public_url\/css\/bunker707\.css\?v=\$css_v"[^\n]*\| sha256sum/, "e que a servida e a do commit");
  assert.match(smoke, /"css\/bunker707\.css\?v=\$css_v"; do/, "e que o config.js servido traz o carregador com o v atual");
  const deploy = read(join(here, "..", "infra", "cloud", "deploy.sh"));
  assert.match(deploy, /up -d --force-recreate --no-deps web"\n\s+remote "\$jitsi_compose up -d && /, "o web e recriado no deploy-meet com o stack no ar: o config.js servido so muda na partida dele");
});

test("o ?v= do carregador e o comeco do sha256 da folha: mudou a folha, muda o endereco (o nginx guarda /css/* por um ano com ?v=)", () => {
  const v = createHash("sha256").update(readFileSync(join(jitsiDir, "web", "bunker707.css"))).digest("hex").slice(0, 8);
  assert.match(customConfig, new RegExp(`link\\.href = '/css/bunker707\\.css\\?v=${v}';`), `a folha mudou: troque o v em custom-config.js para ${v}`);
});
